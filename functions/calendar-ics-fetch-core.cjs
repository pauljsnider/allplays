const DEFAULT_TTL_MS = 5 * 60 * 1000;

function normalizeTtlMs(ttlMs) {
  const parsed = Number(ttlMs);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_TTL_MS;
}

function createCalendarIcsCache({ ttlMs = DEFAULT_TTL_MS } = {}) {
  return {
    ttlMs: normalizeTtlMs(ttlMs),
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
      cache.entries.set(cacheKey, nextEntry);
      return {
        source: 'live',
        fetchedAt: nextEntry.fetchedAt,
        icsText: nextEntry.icsText
      };
    } catch (error) {
      const staleEntry = cache.entries.get(cacheKey);
      if (staleEntry?.icsText) {
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

  cache.entries.set(cacheKey, {
    ...(cachedEntry || {}),
    promise: fetchPromise
  });

  return fetchPromise;
}

module.exports = {
  DEFAULT_TTL_MS,
  createCalendarIcsCache,
  fetchCalendarIcsWithCache
};
