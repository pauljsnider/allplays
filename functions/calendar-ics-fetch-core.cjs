const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100;

function normalizeTtlMs(ttlMs) {
  const parsed = Number(ttlMs);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_TTL_MS;
}

function normalizeMaxEntries(maxEntries) {
  const parsed = Number(maxEntries);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_MAX_ENTRIES;
}

function pruneCalendarIcsCache(cache) {
  const now = Date.now();
  for (const [key, entry] of cache.entries) {
    if (!entry?.promise && entry?.expiresAt <= now) {
      cache.entries.delete(key);
    }
  }

  while (cache.entries.size > cache.maxEntries) {
    const oldestKey = cache.entries.keys().next().value;
    if (typeof oldestKey === 'undefined') {
      break;
    }
    cache.entries.delete(oldestKey);
  }
}

function setCalendarIcsCacheEntry(cache, cacheKey, entry) {
  cache.entries.delete(cacheKey);
  cache.entries.set(cacheKey, entry);
  pruneCalendarIcsCache(cache);
}

function createCalendarIcsCache({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  return {
    ttlMs: normalizeTtlMs(ttlMs),
    maxEntries: normalizeMaxEntries(maxEntries),
    entries: new Map()
  };
}

async function fetchCalendarIcsWithCache({ cache, cacheKey, forceRefresh = false, fetchIcs }) {
  if (!cache || !(cache.entries instanceof Map)) {
    throw new Error('A calendar cache is required');
  }
  if (typeof cacheKey !== 'string' || !cacheKey.trim()) {
    throw new Error('A cache key is required');
  }
  if (typeof fetchIcs !== 'function') {
    throw new Error('A fetchIcs function is required');
  }

  const now = Date.now();
  const cachedEntry = cache.entries.get(cacheKey);
  if (!forceRefresh && cachedEntry?.icsText && cachedEntry.expiresAt > now) {
    return {
      source: 'cache',
      fetchedAt: cachedEntry.fetchedAt,
      icsText: cachedEntry.icsText
    };
  }

  if (!forceRefresh && cachedEntry?.promise) {
    return cachedEntry.promise;
  }

  const fetchPromise = (async () => {
    try {
      const result = await fetchIcs();
      const nextFetchedAt = result?.fetchedAt || new Date().toISOString();
      const nextEntry = {
        icsText: result.icsText,
        fetchedAt: nextFetchedAt,
        expiresAt: Date.now() + cache.ttlMs
      };
      setCalendarIcsCacheEntry(cache, cacheKey, nextEntry);
      return {
        source: 'live',
        fetchedAt: nextEntry.fetchedAt,
        icsText: nextEntry.icsText
      };
    } catch (error) {
      const staleEntry = cache.entries.get(cacheKey);
      if (!forceRefresh && staleEntry?.icsText) {
        return {
          source: 'stale-cache',
          fetchedAt: staleEntry.fetchedAt,
          icsText: staleEntry.icsText
        };
      }
      throw error;
    } finally {
      const latestEntry = cache.entries.get(cacheKey);
      if (latestEntry?.promise === fetchPromise) {
        delete latestEntry.promise;
      }
    }
  })();

  setCalendarIcsCacheEntry(cache, cacheKey, {
    ...(cachedEntry || {}),
    promise: fetchPromise
  });

  return fetchPromise;
}

module.exports = {
  DEFAULT_TTL_MS,
  DEFAULT_MAX_ENTRIES,
  createCalendarIcsCache,
  fetchCalendarIcsWithCache
};
