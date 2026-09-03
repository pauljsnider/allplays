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
const cacheKeyInvalidationVersions = new Map<string, number>();
const logger = createLogger('app-data-cache');

type LoadCachedAppDataOptions<T> = {
  ttlMs?: number;
  force?: boolean;
  persist?: boolean;
  maxStaleMs?: number;
  staleWhileRevalidate?: boolean;
  onRefresh?: (value: T) => void;
  onBackgroundRefresh?: (value: T) => void;
  onRefreshError?: (error: unknown) => void;
  shouldCache?: (value: T) => boolean;
};

type StoredCacheEntry = {
  version: 3;
  value: unknown;
  expiresAt: number;
};

const privateReplayCacheFields = new Set([
  'replayVideo',
  'recordedVideo',
  'videoReplay',
  'rawReplayState',
  'replayVideoUrl',
  'recordedVideoUrl',
  'videoReplayUrl',
  'archivedVideoUrl',
  'replayVideoPublicUrl',
  'replayVideoPosterUrl',
  'replayVideoTitle',
  'replayVideoDurationMs',
  'replayStatus',
  'recordedReplayStatus',
  'videoReplayStatus',
  'replayVideoFallbackDisabled'
]);

/**
 * Cached app summaries may be hydrated while older servers or browser SDK
 * persistence still expose legacy replay aliases. Keep only the safe marker
 * fields in memory and localStorage; replay capabilities are resolved through
 * a non-cached callable at the moment they are used.
 */
export function sanitizeAppDataCacheValue<T>(value: T): T {
  const seen = new WeakMap<object, unknown>();
  const sanitize = (candidate: unknown): unknown => {
    if (!candidate || typeof candidate !== 'object' || candidate instanceof Date) return candidate;
    if (seen.has(candidate)) return seen.get(candidate);
    if (Array.isArray(candidate)) {
      const result: unknown[] = [];
      seen.set(candidate, result);
      let changed = false;
      candidate.forEach((entry) => {
        const sanitizedEntry = sanitize(entry);
        result.push(sanitizedEntry);
        if (sanitizedEntry !== entry) changed = true;
      });
      if (!changed) {
        seen.set(candidate, candidate);
        return candidate;
      }
      return result;
    }
    const source = candidate as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    seen.set(candidate, result);
    let changed = false;
    const isScheduleEvent = (source.type === 'game' || source.type === 'practice')
      && ('date' in source || 'eventKey' in source)
      && ('id' in source || 'gameId' in source);
    Object.entries(source).forEach(([key, entry]) => {
      if (privateReplayCacheFields.has(key) || (isScheduleEvent && key === 'videoUrl')) {
        changed = true;
        return;
      }
      const sanitizedEntry = sanitize(entry);
      result[key] = sanitizedEntry;
      if (sanitizedEntry !== entry) changed = true;
    });
    if (!changed) {
      seen.set(candidate, candidate);
      return candidate;
    }
    return result;
  };
  return sanitize(value) as T;
}

export function getParentScheduleSummaryCacheKey(userId: string) {
  return `app-schedule-summary:${userId}`;
}

export function getParentHomeSecondaryCacheKey(userId: string) {
  return `home-secondary:${userId}`;
}

export function getTeamsSummaryBootstrapCacheKey(userId: string) {
  return `teams-summary-bootstrap:${userId}`;
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
    onBackgroundRefresh,
    onRefreshError,
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
    && existing
    && hasCachedValue(existing)
    && existing.expiresAt + maxStaleMs > now
  ) {
    const refreshPromise = loadAndStoreCachedAppData(key, loader, existing, {
      ttlMs,
      persist,
      onRefresh: onRefresh || onBackgroundRefresh
        ? (value) => {
          onRefresh?.(value);
          onBackgroundRefresh?.(value);
        }
        : undefined,
      shouldCache
    });
    refreshPromise.catch((error) => {
      logger.warn('Background refresh failed.', { error });
      onRefreshError?.(error);
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
  cacheKeyInvalidationVersions.set(key, getCacheKeyInvalidationVersion(key) + 1);
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
  const loadKeyInvalidationVersion = getCacheKeyInvalidationVersion(key);
  const promise = loader().then((loadedValue) => {
    const value = sanitizeAppDataCacheValue(loadedValue);
    if (
      loadInvalidationVersion !== cacheInvalidationVersion
      || loadKeyInvalidationVersion !== getCacheKeyInvalidationVersion(key)
    ) {
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

function getCacheKeyInvalidationVersion(key: string) {
  return cacheKeyInvalidationVersions.get(key) ?? 0;
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
  if (getCacheKeyInvalidationVersion(key) > 0) return null;

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

  if (!parsed || parsed.version !== 3 || !Number.isFinite(parsed.expiresAt)) {
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
      version: 3,
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

  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (!key?.startsWith(storagePrefix)) continue;
      const cacheKey = fromStorageKey(key);
      if (!prefix || cacheKey.startsWith(prefix)) {
        storage.removeItem(key);
      }
    }
  } catch (error) {
    logger.warn('Unable to remove cached data.', { error });
  }
}

function removeStoredCacheEntry(key: string) {
  const storage = getCacheStorage();
  if (!storage) return;
  try {
    storage.removeItem(toStorageKey(key));
  } catch (error) {
    logger.warn('Unable to remove cached data.', { error });
  }
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
  if (typeof originalValue === 'number' && !Number.isFinite(originalValue)) {
    return {
      __type: 'NonFiniteNumber',
      value: Number.isNaN(originalValue) ? 'NaN' : originalValue > 0 ? 'Infinity' : '-Infinity'
    };
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
  if (
    value
    && typeof value === 'object'
    && (value as { __type?: unknown }).__type === 'NonFiniteNumber'
  ) {
    const marker = value as { value?: unknown };
    if (marker.value === 'NaN') return Number.NaN;
    if (marker.value === 'Infinity') return Number.POSITIVE_INFINITY;
    if (marker.value === '-Infinity') return Number.NEGATIVE_INFINITY;
  }
  return value;
}
