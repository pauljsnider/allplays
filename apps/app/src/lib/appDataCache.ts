import { createLogger } from './logger';
import { isNativeRuntime } from './nativeRuntime';
import {
  getNativeSecureItem,
  listNativeSecureKeys,
  removeNativeSecureItem,
  setNativeSecureItem
} from './nativeSecureStorage';

type CacheEntry<T> = {
  value?: T;
  promise?: Promise<T>;
  expiresAt: number;
  hydratedFromStorage?: boolean;
};

const defaultTtlMs = 60 * 1000;
const defaultMaxStaleMs = 24 * 60 * 60 * 1000;
const storagePrefix = 'allplays:appDataCache:';
const secureStoragePrefix = 'app-data-cache:';
const cache = new Map<string, CacheEntry<unknown>>();
const nativeStoredEntries = new Map<string, string>();
let cacheInvalidationVersion = 0;
const cacheKeyInvalidationVersions = new Map<string, number>();
const logger = createLogger('app-data-cache');
let persistenceInitialization: Promise<void> | null = null;
let persistenceQueue = Promise.resolve();

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

export function getParentHomeSecondaryCacheKey(userId: string) {
  return `home-secondary:${userId}`;
}

export function getTeamsSummaryBootstrapCacheKey(userId: string) {
  return `teams-summary-bootstrap:${userId}`;
}

/**
 * Hydrates encrypted native cache values before React renders. Browser cache
 * entries stay session-scoped, while iOS/Android use Keychain/Keystore-backed
 * storage so offline and stale-while-revalidate behavior survives app restarts
 * without leaving schedule, fee, or home data in WebView localStorage.
 */
export function initializeAppDataCachePersistence(): Promise<void> {
  persistenceInitialization ||= initializePersistence();
  return persistenceInitialization;
}

export async function flushAppDataCachePersistence(): Promise<void> {
  await initializeAppDataCachePersistence();
  await persistenceQueue;
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
  const promise = loader().then((value) => {
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

  let parsed: StoredCacheEntry | null = null;
  try {
    const raw = isNativeRuntime()
      ? nativeStoredEntries.get(key) || null
      : getCacheStorage()?.getItem(toStorageKey(key)) || null;
    parsed = raw ? JSON.parse(raw, reviveCacheValue) : null;
  } catch (error) {
    logger.warn('Unable to read cached data.', { error });
    removeStoredCacheEntry(key);
    return null;
  }

  if (!parsed || parsed.version !== 1 || !Number.isFinite(parsed.expiresAt)) {
    removeStoredCacheEntry(key);
    return null;
  }

  if (parsed.expiresAt + maxStaleMs <= now) {
    removeStoredCacheEntry(key);
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
  try {
    const stored: StoredCacheEntry = {
      version: 1,
      value: entry.value,
      expiresAt: entry.expiresAt
    };
    const serialized = JSON.stringify(stored, replaceCacheValue);
    if (isNativeRuntime()) {
      nativeStoredEntries.set(key, serialized);
      queuePersistence(() => setNativeSecureItem(toSecureStorageKey(key), serialized));
      return;
    }
    getCacheStorage()?.setItem(toStorageKey(key), serialized);
  } catch (error) {
    logger.warn('Unable to persist cached data.', { error });
  }
}

function removeStoredCacheEntries(prefix: string) {
  if (isNativeRuntime()) {
    [...nativeStoredEntries.keys()].forEach((key) => {
      if (!prefix || key.startsWith(prefix)) {
        nativeStoredEntries.delete(key);
        queuePersistence(() => removeNativeSecureItem(toSecureStorageKey(key)));
      }
    });
    queuePersistence(async () => {
      const keys = await listNativeSecureKeys();
      await Promise.all(keys
        .filter((storageKey) => storageKey.startsWith(secureStoragePrefix))
        .filter((storageKey) => !prefix || fromSecureStorageKey(storageKey).startsWith(prefix))
        .map((storageKey) => removeNativeSecureItem(storageKey)));
    });
    return;
  }

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
  if (isNativeRuntime()) {
    nativeStoredEntries.delete(key);
    queuePersistence(() => removeNativeSecureItem(toSecureStorageKey(key)));
    return;
  }

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
    const storage = window.sessionStorage;
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

function toSecureStorageKey(key: string) {
  return `${secureStoragePrefix}${encodeURIComponent(key)}`;
}

function fromSecureStorageKey(key: string) {
  return decodeURIComponent(key.slice(secureStoragePrefix.length));
}

function queuePersistence(operation: () => Promise<unknown>) {
  persistenceQueue = persistenceQueue
    .then(operation)
    .then(() => undefined)
    .catch((error) => {
      logger.warn('Unable to update encrypted cached data.', { error });
    });
}

async function initializePersistence() {
  if (typeof window === 'undefined') return;
  if (!isNativeRuntime()) {
    migrateLegacyBrowserCacheToSession();
    return;
  }

  try {
    const keys = await listNativeSecureKeys();
    await Promise.all(keys
      .filter((key) => key.startsWith(secureStoragePrefix))
      .map(async (storageKey) => {
        const serialized = await getNativeSecureItem(storageKey);
        if (serialized !== null) nativeStoredEntries.set(fromSecureStorageKey(storageKey), serialized);
      }));
    await migrateLegacyNativeCacheToSecureStorage();
  } catch (error) {
    // Cache persistence is an optimization. If the secure store is unavailable,
    // the app remains fully functional with its in-memory cache only.
    logger.warn('Unable to initialize encrypted native app-data cache.', { error });
    clearLegacyLocalCache();
  }
}

function getLegacyLocalCacheEntries() {
  const entries: Array<[string, string]> = [];
  try {
    const storage = window.localStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const storageKey = storage.key(index);
      if (!storageKey?.startsWith(storagePrefix)) continue;
      const serialized = storage.getItem(storageKey);
      if (serialized !== null) entries.push([fromStorageKey(storageKey), serialized]);
    }
  } catch {
    return [];
  }
  return entries;
}

function clearLegacyLocalCache() {
  try {
    const storage = window.localStorage;
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const storageKey = storage.key(index);
      if (storageKey?.startsWith(storagePrefix)) storage.removeItem(storageKey);
    }
  } catch {
    // Cleanup remains best-effort when WebView storage is disabled.
  }
}

function migrateLegacyBrowserCacheToSession() {
  const sessionStorage = getCacheStorage();
  if (!sessionStorage) {
    clearLegacyLocalCache();
    return;
  }
  getLegacyLocalCacheEntries().forEach(([key, serialized]) => {
    try {
      if (sessionStorage.getItem(toStorageKey(key)) === null) {
        sessionStorage.setItem(toStorageKey(key), serialized);
      }
    } catch (error) {
      logger.warn('Unable to migrate a legacy browser cache entry.', { error });
    }
  });
  clearLegacyLocalCache();
}

async function migrateLegacyNativeCacheToSecureStorage() {
  const legacyEntries = getLegacyLocalCacheEntries();
  try {
    await Promise.all(legacyEntries.map(async ([key, serialized]) => {
      if (!nativeStoredEntries.has(key)) {
        await setNativeSecureItem(toSecureStorageKey(key), serialized);
        nativeStoredEntries.set(key, serialized);
      }
    }));
  } finally {
    clearLegacyLocalCache();
  }
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
