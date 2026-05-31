type CacheEntry<T> = {
  value?: T;
  promise?: Promise<T>;
  expiresAt: number;
};

const defaultTtlMs = 60 * 1000;
const cache = new Map<string, CacheEntry<unknown>>();

export function getCachedAppData<T>(key: string): T | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry?.value || entry.expiresAt <= Date.now()) return null;
  return entry.value;
}

export function loadCachedAppData<T>(
  key: string,
  loader: () => Promise<T>,
  { ttlMs = defaultTtlMs, force = false }: { ttlMs?: number; force?: boolean } = {}
): Promise<T> {
  const now = Date.now();
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (!force && existing?.value && existing.expiresAt > now) {
    return Promise.resolve(existing.value);
  }
  if (!force && existing?.promise) {
    return existing.promise;
  }

  const promise = loader().then((value) => {
    cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs
    });
    return value;
  }).catch((error) => {
    const current = cache.get(key);
    if (current?.promise === promise) {
      cache.delete(key);
    }
    throw error;
  });

  cache.set(key, {
    promise,
    expiresAt: now + ttlMs
  });
  return promise;
}

export function clearAppDataCache(prefix = '') {
  [...cache.keys()].forEach((key) => {
    if (!prefix || key.startsWith(prefix)) {
      cache.delete(key);
    }
  });
}
