const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_ICS_BYTES = 2 * 1024 * 1024;

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
    if (!hasCalendarIcsRequestInFlight(cache, key) && entry?.expiresAt <= now) {
      cache.entries.delete(key);
    }
  }

  while (cache.entries.size > cache.maxEntries) {
    const oldestKey = [...cache.entries.keys()]
      .find((key) => !hasCalendarIcsRequestInFlight(cache, key));
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
    entries: new Map(),
    inFlight: new Map()
  };
}

function getCalendarIcsInFlightMap(cache) {
  if (!(cache.inFlight instanceof Map)) {
    cache.inFlight = new Map();
  }
  return cache.inFlight;
}

function getCalendarIcsFlightKey(cacheKey, forceRefresh) {
  return `${forceRefresh ? 'force' : 'normal'}:${cacheKey}`;
}

function hasCalendarIcsRequestInFlight(cache, cacheKey) {
  if (!(cache?.inFlight instanceof Map)) return false;
  return cache.inFlight.has(getCalendarIcsFlightKey(cacheKey, false)) ||
    cache.inFlight.has(getCalendarIcsFlightKey(cacheKey, true));
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
  const inFlight = getCalendarIcsInFlightMap(cache);
  const flightKey = getCalendarIcsFlightKey(cacheKey, forceRefresh);
  if (!forceRefresh && cachedEntry?.icsText && cachedEntry.expiresAt > now) {
    return {
      source: 'cache',
      fetchedAt: cachedEntry.fetchedAt,
      icsText: cachedEntry.icsText
    };
  }

  // Same-mode callers coalesce. Normal and forced refreshes remain separate:
  // normal callers may accept stale data after an upstream failure, while a
  // forced caller must surface that failure and never inherit stale fallback.
  const existingPromise = inFlight.get(flightKey);
  if (existingPromise) {
    return existingPromise;
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
      if (inFlight.get(flightKey) === fetchPromise) {
        inFlight.delete(flightKey);
      }
    }
  })();

  inFlight.set(flightKey, fetchPromise);

  return fetchPromise;
}

function createCalendarIcsFetchHandler({
  cache,
  checkRateLimit,
  checkForceRefreshRateLimit,
  checkTargetRateLimit,
  isAllowedOrigin,
  writeCorsHeaders,
  normalizeTargetUrl,
  fetchWithTimeout,
  normalizeIcsText,
  maxIcsBytes = DEFAULT_MAX_ICS_BYTES
}) {
  return async function fetchCalendarIcsHandler(req, res) {
    writeCorsHeaders(req, res);

    if (!isAllowedOrigin(req.headers?.origin)) {
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

    const forceRefresh = String(req.query?.forceRefresh || '').toLowerCase() === 'true';
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
      const rawUrl = req.query?.url;
      const normalizedUrl = await normalizeTargetUrl(rawUrl);

      const result = await fetchCalendarIcsWithCache({
        cache,
        cacheKey: normalizedUrl.url,
        forceRefresh,
        fetchIcs: async () => {
          if (typeof checkTargetRateLimit === 'function') {
            const targetLimit = await checkTargetRateLimit(normalizedUrl, req);
            if (!targetLimit.allowed) {
              const rateLimitError = new Error('Too many upstream requests for this calendar');
              rateLimitError.statusCode = 429;
              rateLimitError.retryAfterSeconds = targetLimit.retryAfterSeconds;
              throw rateLimitError;
            }
          }

          const response = await fetchWithTimeout(normalizedUrl.url, normalizedUrl.hostname, normalizedUrl.publicIps);
          if (!response.ok) {
            const upstreamError = new Error(`Calendar fetch failed: ${response.status} ${response.statusText}`);
            upstreamError.statusCode = 502;
            throw upstreamError;
          }

          const rawText = await response.text();
          if (typeof rawText !== 'string' || Buffer.byteLength(rawText, 'utf8') > maxIcsBytes) {
            const oversizedError = new Error('Calendar response exceeded the size limit');
            oversizedError.statusCode = 413;
            throw oversizedError;
          }
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
      if (error?.retryAfterSeconds) {
        res.set('Retry-After', String(error.retryAfterSeconds));
      }
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
  DEFAULT_MAX_ICS_BYTES,
  createCalendarIcsCache,
  fetchCalendarIcsWithCache,
  createCalendarIcsFetchHandler
};
