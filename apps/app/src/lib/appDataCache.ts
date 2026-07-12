import { createLogger } from './logger';

type CacheEntry<T> = {
  value?: T;
  promise?: Promise<T>;
  expiresAt: number;
  hydratedFromStorage?: boolean;
};

const defaultTtlMs = 60 * 1000;
const defaultMaxStaleMs = 24 * 60 * 60 * 1000;
const storagePrefix = 'allplays:appDataCache:';
const cache = new Map<string, CacheEntry<unknown>>();
let cacheInvalidationVersion = 0;
const logger = createLogger('app-data-cache');

type LoadCachedAppDataOptions<T> = {
  ttlMs?: number;
  force?: boolean;
  persist?: boolean;
  maxStaleMs?: number;
  staleWhileRevalidate?: boolean;
  onRefresh?: (value: T) => void;
  shouldCache?: (value: T) => boolean;
};

type StoredCacheEntry = {
  version: 1;
  value: unknown;
  expiresAt: number;
};

export function getParentScheduleSummaryCacheKey(userId: string) {
  return `app-schedule-summary:${userId}`;
}

export function getCachedAppData<T>(key: string, { maxStaleMs = defaultMaxStaleMs }: { maxStaleMs?: number } = {}): T | null {
  const now = Date.now();
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry && hasCachedValue(entry)) {
    if (entry.expiresAt > now || (entry.hydratedFromStorage && entry.expiresAt + maxStaleMs > now)) {
      return entry.value as T;
    }
    return null;
  }

  const stored = readStoredCacheEntry<T>(key, now, maxStaleMs);
  if (!stored) return null;
  cache.set(key, stored);
  return stored.value as T;
}

export function loadCachedAppData<T>(
  key: string,
  loader: () => Promise<T>,
  {
    ttlMs = defaultTtlMs,
    force = false,
    persist = true,
    maxStaleMs = defaultMaxStaleMs,
    staleWhileRevalidate = false,
    onRefresh,
    shouldCache
  }: LoadCachedAppDataOptions<T> = {}
): Promise<T> {
  const now = Date.now();
  const existing = hydrateMemoryCache<T>(key, now, maxStaleMs);
  if (!force && existing && hasCachedValue(existing) && existing.expiresAt > now) {
    return Promise.resolve(existing.value);
  }
  if (!force && existing?.promise) {
    return existing.promise;
  }
  if (
    !force
    && staleWhileRevalidate
    && existing?.hydratedFromStorage
    && hasCachedValue(existing)
    && existing.expiresAt + maxStaleMs > now
  ) {
    const refreshPromise = loadAndStoreCachedAppData(key, loader, existing, { ttlMs, persist, onRefresh, shouldCache });
    refreshPromise.catch((error) => {
      logger.warn('Background refresh failed.', { error });
    });
    return Promise.resolve(existing.value as T);
  }

  return loadAndStoreCachedAppData(key, loader, existing, { ttlMs, persist, onRefresh, shouldCache });
}

export function clearAppDataCache(prefix = '') {
  cacheInvalidationVersion += 1;
  [...cache.keys()].forEach((key) => {
    if (!prefix || key.startsWith(prefix)) {
      cache.delete(key);
    }
  });

  removeStoredCacheEntries(prefix);
}

export function invalidateCachedAppData(key: string) {
  cacheInvalidationVersion += 1;
  cache.delete(key);
  removeStoredCacheEntry(key);
}

function loadAndStoreCachedAppData<T>(
  key: string,
  loader: () => Promise<T>,
  existing: CacheEntry<T> | undefined,
  {
    ttlMs,
    persist,
    onRefresh,
    shouldCache
  }: { ttlMs: number; persist: boolean; onRefresh?: (value: T) => void; shouldCache?: (value: T) => boolean }
) {
  const loadInvalidationVersion = cacheInvalidationVersion;
  const promise = loader().then((value) => {
    if (loadInvalidationVersion !== cacheInvalidationVersion) {
      const current = cache.get(key);
      if (current?.promise === promise) {
        if (existing && hasCachedValue(existing)) {
          cache.set(key, {
            value: existing.value,
            expiresAt: existing.expiresAt,
            hydratedFromStorage: existing.hydratedFromStorage
          });
        } else {
          cache.delete(key);
        }
      }
      onRefresh?.(value);
      return value;
    }

    if (shouldCache && !shouldCache(value)) {
      if (existing && hasCachedValue(existing)) {
        cache.set(key, {
          value: existing.value,
          expiresAt: existing.expiresAt,
          hydratedFromStorage: existing.hydratedFromStorage
        });
      } else {
        cache.delete(key);
      }
      onRefresh?.(value);
      return value;
    }

    const entry = {
      value,
      expiresAt: Date.now() + ttlMs,
      hydratedFromStorage: false
    };
    cache.set(key, entry);
    if (persist) writeStoredCacheEntry(key, entry);
    onRefresh?.(value);
    return value;
  }).catch((error) => {
    const current = cache.get(key);
    if (current?.promise === promise) {
      if (existing && hasCachedValue(existing)) {
        cache.set(key, {
          value: existing.value,
          expiresAt: existing.expiresAt,
          hydratedFromStorage: existing.hydratedFromStorage
        });
      } else {
        cache.delete(key);
      }
    }
    throw error;
  });

  cache.set(key, {
    ...(existing && hasCachedValue(existing) ? { value: existing.value } : {}),
    promise,
    expiresAt: existing?.expiresAt ?? Date.now() + ttlMs,
    hydratedFromStorage: existing?.hydratedFromStorage
  });
  return promise;
}

function hydrateMemoryCache<T>(key: string, now: number, maxStaleMs: number) {
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing) return existing;

  const stored = readStoredCacheEntry<T>(key, now, maxStaleMs);
  if (!stored) return undefined;
  cache.set(key, stored);
  return stored;
}

function readStoredCacheEntry<T>(key: string, now: number, maxStaleMs: number): CacheEntry<T> | null {
  const storage = getCacheStorage();
  if (!storage) return null;

  const storageKey = toStorageKey(key);
  let parsed: StoredCacheEntry | null = null;
  try {
    const raw = storage.getItem(storageKey);
    parsed = raw ? JSON.parse(raw, reviveCacheValue) : null;
  } catch (error) {
    logger.warn('Unable to read cached data.', { error });
    storage.removeItem(storageKey);
    return null;
  }

  if (!parsed || parsed.version !== 1 || !Number.isFinite(parsed.expiresAt)) {
    storage.removeItem(storageKey);
    return null;
  }

  if (parsed.expiresAt + maxStaleMs <= now) {
    storage.removeItem(storageKey);
    return null;
  }

  return {
    value: parsed.value as T,
    expiresAt: parsed.expiresAt,
    hydratedFromStorage: true
  };
}

function writeStoredCacheEntry<T>(key: string, entry: CacheEntry<T>) {
  if (!hasCachedValue(entry)) return;

  const storage = getCacheStorage();
  if (!storage) return;

  try {
    const stored: StoredCacheEntry = {
      version: 1,
      value: entry.value,
      expiresAt: entry.expiresAt
    };
    storage.setItem(toStorageKey(key), JSON.stringify(stored, replaceCacheValue));
  } catch (error) {
    logger.warn('Unable to persist cached data.', { error });
  }
}

function removeStoredCacheEntries(prefix: string) {
  const storage = getCacheStorage();
  if (!storage) return;

  for (let index = storage.length - 1; index >= 0; index -= 1) {
    const key = storage.key(index);
    if (!key?.startsWith(storagePrefix)) continue;
    const cacheKey = fromStorageKey(key);
    if (!prefix || cacheKey.startsWith(prefix)) {
      storage.removeItem(key);
    }
  }
}

function removeStoredCacheEntry(key: string) {
  const storage = getCacheStorage();
  if (!storage) return;
  storage.removeItem(toStorageKey(key));
}

function getCacheStorage() {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    if (
      !storage
      || typeof storage.getItem !== 'function'
      || typeof storage.setItem !== 'function'
      || typeof storage.removeItem !== 'function'
      || typeof storage.key !== 'function'
      || typeof storage.length !== 'number'
    ) {
      return null;
    }
    return storage;
  } catch {
    return null;
  }
}

function hasCachedValue<T>(entry: CacheEntry<T>): entry is CacheEntry<T> & { value: T } {
  return Object.prototype.hasOwnProperty.call(entry, 'value');
}

function toStorageKey(key: string) {
  return `${storagePrefix}${encodeURIComponent(key)}`;
}

function fromStorageKey(key: string) {
  return decodeURIComponent(key.slice(storagePrefix.length));
}

function replaceCacheValue(this: Record<string, unknown>, key: string, value: unknown) {
  const originalValue = key ? this[key] : value;
  if (originalValue instanceof Date) {
    return { __type: 'Date', value: originalValue.toISOString() };
  }
  return value;
}

function reviveCacheValue(_key: string, value: unknown) {
  if (
    value
    && typeof value === 'object'
    && (value as { __type?: unknown }).__type === 'Date'
    && typeof (value as { value?: unknown }).value === 'string'
  ) {
    return new Date((value as { value: string }).value);
  }
  return value;
}
