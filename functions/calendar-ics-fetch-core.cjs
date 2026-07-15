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

function createCalendarIcsFetchHandler({
  cache,
  checkRateLimit,
  checkForceRefreshRateLimit,
  isAllowedOrigin,
  writeCorsHeaders,
  normalizeTargetUrl,
  fetchWithTimeout,
  normalizeIcsText
}) {
  return async function fetchCalendarIcsHandler(req, res) {
    writeCorsHeaders(req, res);

    if (!isAllowedOrigin(req.headers.origin)) {
      res.status(403).json({ ok: false, error: 'Origin not allowed' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const forceRefresh = String(req.query.forceRefresh || '').toLowerCase() === 'true';
    const rateLimits = [checkRateLimit];
    if (forceRefresh) {
      rateLimits.push(checkForceRefreshRateLimit);
    }

    for (const checkLimit of rateLimits) {
      const rateLimit = checkLimit(req);
      if (!rateLimit.allowed) {
        res.set('Retry-After', String(rateLimit.retryAfterSeconds));
        res.status(429).json({ ok: false, error: 'Too many calendar fetch requests' });
        return;
      }
    }

    try {
      const rawUrl = req.query.url;
      const normalizedUrl = await normalizeTargetUrl(rawUrl);

      const result = await fetchCalendarIcsWithCache({
        cache,
        cacheKey: normalizedUrl.url,
        forceRefresh,
        fetchIcs: async () => {
          const response = await fetchWithTimeout(normalizedUrl.url, normalizedUrl.hostname, normalizedUrl.publicIps);
          if (!response.ok) {
            const upstreamError = new Error(`Calendar fetch failed: ${response.status} ${response.statusText}`);
            upstreamError.statusCode = 502;
            throw upstreamError;
          }

          const rawText = await response.text();
          const icsText = normalizeIcsText(rawText);

          if (!icsText.includes('BEGIN:VCALENDAR')) {
            const invalidIcsError = new Error('Response was not valid ICS');
            invalidIcsError.statusCode = 502;
            throw invalidIcsError;
          }

          return {
            fetchedAt: new Date().toISOString(),
            icsText
          };
        }
      });

      res.status(200).json({
        ok: true,
        source: result.source,
        fetchedAt: result.fetchedAt,
        icsText: result.icsText
      });
    } catch (error) {
      res.status(error?.statusCode || 400).json({
        ok: false,
        error: error?.message || 'Unknown error'
      });
    }
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  DEFAULT_MAX_ENTRIES,
  createCalendarIcsCache,
  fetchCalendarIcsWithCache,
  createCalendarIcsFetchHandler
};
