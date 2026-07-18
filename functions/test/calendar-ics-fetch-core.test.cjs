const { test } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_TTL_MS,
  DEFAULT_MAX_ENTRIES,
  createCalendarIcsCache,
  fetchCalendarIcsWithCache,
  createCalendarIcsFetchHandler
} = require('../calendar-ics-fetch-core.cjs');
const { createInMemoryRateLimiter } = require('../rate-limit.cjs');

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function createHandlerHarness({
  maxRequests = 2,
  maxForceRefreshRequests = 1,
  maxTargetRequests = Number.POSITIVE_INFINITY,
  responseBody = 'BEGIN:VCALENDAR\nEND:VCALENDAR'
} = {}) {
  let normalizationCount = 0;
  let fetchCount = 0;
  let now = 1_000;
  const cache = createCalendarIcsCache();
  const normalLimiter = createInMemoryRateLimiter({ windowMs: 60_000, maxRequests, maxKeys: 10 });
  const forceRefreshLimiter = createInMemoryRateLimiter({
    windowMs: 60_000,
    maxRequests: maxForceRefreshRequests,
    maxKeys: 10
  });
  let targetRequests = 0;
  const handler = createCalendarIcsFetchHandler({
    cache,
    checkRateLimit: (req) => normalLimiter(req, now),
    checkForceRefreshRateLimit: (req) => forceRefreshLimiter(req, now),
    checkTargetRateLimit: () => {
      targetRequests += 1;
      return {
        allowed: targetRequests <= maxTargetRequests,
        retryAfterSeconds: 60
      };
    },
    isAllowedOrigin: () => true,
    writeCorsHeaders: (_req, res) => res.set('Cache-Control', 'no-store'),
    normalizeTargetUrl: async (url) => {
      normalizationCount += 1;
      return { url, hostname: 'example.com', publicIps: ['203.0.113.20'] };
    },
    fetchWithTimeout: async () => {
      fetchCount += 1;
      return {
        ok: true,
        headers: { 'content-type': 'text/calendar' },
        text: async () => responseBody
      };
    },
    normalizeIcsText: (text) => text
  });

  async function request({ forceRefresh = false, ip = '203.0.113.10', headers = {}, query } = {}) {
    const req = {
      method: 'GET',
      ip,
      headers,
      query: query === undefined ? {
        url: 'https://example.com/calendar.ics',
        ...(forceRefresh ? { forceRefresh: 'true' } : {})
      } : query
    };
    const res = createMockResponse();
    await handler(req, res);
    return res;
  }

  return {
    request,
    advanceTime(milliseconds) {
      now += milliseconds;
    },
    get normalizationCount() {
      return normalizationCount;
    },
    get fetchCount() {
      return fetchCount;
    },
    get targetRequests() {
      return targetRequests;
    }
  };
}

test('fetchCalendarIcsWithCache reuses a fresh cached response', async () => {
  const cache = createCalendarIcsCache();
  let fetchCount = 0;

  const fetchIcs = async () => {
    fetchCount += 1;
    return {
      fetchedAt: '2026-06-04T16:53:00.000Z',
      icsText: 'BEGIN:VCALENDAR\nEND:VCALENDAR'
    };
  };

  const first = await fetchCalendarIcsWithCache({
    cache,
    cacheKey: 'https://example.com/calendar.ics',
    fetchIcs
  });
  const second = await fetchCalendarIcsWithCache({
    cache,
    cacheKey: 'https://example.com/calendar.ics',
    fetchIcs
  });

  assert.strictEqual(fetchCount, 1);
  assert.strictEqual(first.source, 'live');
  assert.strictEqual(second.source, 'cache');
  assert.strictEqual(second.icsText, first.icsText);
});

test('fetchCalendarIcsWithCache honors forceRefresh', async () => {
  const cache = createCalendarIcsCache({ ttlMs: DEFAULT_TTL_MS });
  let fetchCount = 0;

  const fetchIcs = async () => {
    fetchCount += 1;
    return {
      fetchedAt: `2026-06-04T16:53:0${fetchCount}.000Z`,
      icsText: `BEGIN:VCALENDAR\nX-SEQ:${fetchCount}\nEND:VCALENDAR`
    };
  };

  await fetchCalendarIcsWithCache({
    cache,
    cacheKey: 'https://example.com/calendar.ics',
    fetchIcs
  });
  const refreshed = await fetchCalendarIcsWithCache({
    cache,
    cacheKey: 'https://example.com/calendar.ics',
    forceRefresh: true,
    fetchIcs
  });

  assert.strictEqual(fetchCount, 2);
  assert.strictEqual(refreshed.source, 'live');
  assert.match(refreshed.icsText, /X-SEQ:2/);
});

test('fetchCalendarIcsWithCache coalesces concurrent forced refreshes', async () => {
  const cache = createCalendarIcsCache();
  let fetchCount = 0;
  let releaseFetch;
  const fetchIcs = () => {
    fetchCount += 1;
    return new Promise((resolve) => {
      releaseFetch = () => resolve({
        fetchedAt: '2026-06-04T16:53:00.000Z',
        icsText: 'BEGIN:VCALENDAR\nEND:VCALENDAR'
      });
    });
  };

  const first = fetchCalendarIcsWithCache({ cache, cacheKey: 'https://example.com/team.ics', forceRefresh: true, fetchIcs });
  const second = fetchCalendarIcsWithCache({ cache, cacheKey: 'https://example.com/team.ics', forceRefresh: true, fetchIcs });
  assert.strictEqual(fetchCount, 1);
  releaseFetch();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepStrictEqual(secondResult, firstResult);
});

test('fetchCalendarIcsWithCache coalesces concurrent normal refreshes', async () => {
  const cache = createCalendarIcsCache();
  let fetchCount = 0;
  let releaseFetch;
  const fetchIcs = () => {
    fetchCount += 1;
    return new Promise((resolve) => {
      releaseFetch = () => resolve({
        fetchedAt: '2026-06-04T16:53:00.000Z',
        icsText: 'BEGIN:VCALENDAR\nEND:VCALENDAR'
      });
    });
  };

  const first = fetchCalendarIcsWithCache({ cache, cacheKey: 'https://example.com/normal.ics', fetchIcs });
  const second = fetchCalendarIcsWithCache({ cache, cacheKey: 'https://example.com/normal.ics', fetchIcs });
  assert.strictEqual(fetchCount, 1);
  releaseFetch();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.deepStrictEqual(secondResult, firstResult);
});

test('force refresh does not inherit stale fallback from a normal refresh in flight', async () => {
  const cache = createCalendarIcsCache({ ttlMs: 1 });
  const cacheKey = 'https://example.com/team.ics';
  await fetchCalendarIcsWithCache({
    cache,
    cacheKey,
    fetchIcs: async () => ({
      fetchedAt: '2026-06-04T16:53:00.000Z',
      icsText: 'BEGIN:VCALENDAR\nX-SEQ:stale\nEND:VCALENDAR'
    })
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  let rejectNormal;
  let normalFetchCount = 0;
  let forcedFetchCount = 0;
  const normalRefresh = fetchCalendarIcsWithCache({
    cache,
    cacheKey,
    fetchIcs: () => {
      normalFetchCount += 1;
      return new Promise((_resolve, reject) => { rejectNormal = reject; });
    }
  });
  const forcedRefresh = fetchCalendarIcsWithCache({
    cache,
    cacheKey,
    forceRefresh: true,
    fetchIcs: async () => {
      forcedFetchCount += 1;
      throw new Error('forced upstream timeout');
    }
  });
  const forcedFailure = assert.rejects(forcedRefresh, /forced upstream timeout/);

  assert.strictEqual(normalFetchCount, 1);
  assert.strictEqual(forcedFetchCount, 1);
  rejectNormal(new Error('normal upstream timeout'));

  const [normalResult] = await Promise.all([normalRefresh, forcedFailure]);
  assert.strictEqual(normalResult.source, 'stale-cache');
  assert.match(normalResult.icsText, /X-SEQ:stale/);
});

test('normal refresh retains stale fallback while a forced refresh is in flight', async () => {
  const cache = createCalendarIcsCache({ ttlMs: 1 });
  const cacheKey = 'https://example.com/inverse.ics';
  await fetchCalendarIcsWithCache({
    cache,
    cacheKey,
    fetchIcs: async () => ({
      fetchedAt: '2026-06-04T16:53:00.000Z',
      icsText: 'BEGIN:VCALENDAR\nX-SEQ:stale\nEND:VCALENDAR'
    })
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  let rejectForced;
  let normalFetchCount = 0;
  const forcedRefresh = fetchCalendarIcsWithCache({
    cache,
    cacheKey,
    forceRefresh: true,
    fetchIcs: () => new Promise((_resolve, reject) => { rejectForced = reject; })
  });
  const normalRefresh = fetchCalendarIcsWithCache({
    cache,
    cacheKey,
    fetchIcs: async () => {
      normalFetchCount += 1;
      throw new Error('normal upstream timeout');
    }
  });

  assert.strictEqual(normalFetchCount, 1);
  const normalResult = await normalRefresh;
  assert.strictEqual(normalResult.source, 'stale-cache');
  assert.match(normalResult.icsText, /X-SEQ:stale/);
  rejectForced(new Error('forced upstream timeout'));
  await assert.rejects(forcedRefresh, /forced upstream timeout/);
});

test('fetchCalendarIcsWithCache serves stale cache when refresh fails', async () => {
  const cache = createCalendarIcsCache({ ttlMs: 1 });
  let fetchCount = 0;

  const first = await fetchCalendarIcsWithCache({
    cache,
    cacheKey: 'https://example.com/calendar.ics',
    fetchIcs: async () => {
      fetchCount += 1;
      return {
        fetchedAt: '2026-06-04T16:53:00.000Z',
        icsText: 'BEGIN:VCALENDAR\nX-SEQ:1\nEND:VCALENDAR'
      };
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 5));

  const stale = await fetchCalendarIcsWithCache({
    cache,
    cacheKey: 'https://example.com/calendar.ics',
    fetchIcs: async () => {
      fetchCount += 1;
      throw new Error('upstream timeout');
    }
  });

  assert.strictEqual(fetchCount, 2);
  assert.strictEqual(first.source, 'live');
  assert.strictEqual(stale.source, 'stale-cache');
  assert.match(stale.icsText, /X-SEQ:1/);
});

test('fetchCalendarIcsWithCache does not serve stale cache during forceRefresh failures', async () => {
  const cache = createCalendarIcsCache({ ttlMs: 1 });

  await fetchCalendarIcsWithCache({
    cache,
    cacheKey: 'https://example.com/calendar.ics',
    fetchIcs: async () => ({
      fetchedAt: '2026-06-04T16:53:00.000Z',
      icsText: 'BEGIN:VCALENDAR\nX-SEQ:1\nEND:VCALENDAR'
    })
  });

  await new Promise((resolve) => setTimeout(resolve, 5));

  await assert.rejects(
    () => fetchCalendarIcsWithCache({
      cache,
      cacheKey: 'https://example.com/calendar.ics',
      forceRefresh: true,
      fetchIcs: async () => {
        throw new Error('upstream timeout');
      }
    }),
    /upstream timeout/
  );
});

test('createCalendarIcsCache evicts expired and oldest entries when maxEntries is reached', async () => {
  const cache = createCalendarIcsCache({ ttlMs: 1, maxEntries: 2 });

  await fetchCalendarIcsWithCache({
    cache,
    cacheKey: 'https://example.com/calendar-1.ics',
    fetchIcs: async () => ({
      fetchedAt: '2026-06-04T16:53:01.000Z',
      icsText: 'BEGIN:VCALENDAR\nX-SEQ:1\nEND:VCALENDAR'
    })
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await fetchCalendarIcsWithCache({
    cache,
    cacheKey: 'https://example.com/calendar-2.ics',
    fetchIcs: async () => ({
      fetchedAt: '2026-06-04T16:53:02.000Z',
      icsText: 'BEGIN:VCALENDAR\nX-SEQ:2\nEND:VCALENDAR'
    })
  });
  await fetchCalendarIcsWithCache({
    cache,
    cacheKey: 'https://example.com/calendar-3.ics',
    fetchIcs: async () => ({
      fetchedAt: '2026-06-04T16:53:03.000Z',
      icsText: 'BEGIN:VCALENDAR\nX-SEQ:3\nEND:VCALENDAR'
    })
  });

  assert.strictEqual(DEFAULT_MAX_ENTRIES > cache.maxEntries, true);
  assert.strictEqual(cache.entries.size, 2);
  assert.strictEqual(cache.entries.has('https://example.com/calendar-1.ics'), false);
  assert.strictEqual(cache.entries.has('https://example.com/calendar-2.ics'), true);
  assert.strictEqual(cache.entries.has('https://example.com/calendar-3.ics'), true);
});

test('calendar handler rate limits before normalization or outbound fetch and resets after the window', async () => {
  const harness = createHandlerHarness({ maxRequests: 2 });

  const live = await harness.request();
  const cached = await harness.request();
  const rejected = await harness.request();

  assert.strictEqual(live.statusCode, 200);
  assert.deepStrictEqual(Object.keys(live.body).sort(), ['fetchedAt', 'icsText', 'ok', 'source']);
  assert.strictEqual(live.body.ok, true);
  assert.strictEqual(live.body.source, 'live');
  assert.match(live.body.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.strictEqual(live.body.icsText, 'BEGIN:VCALENDAR\nEND:VCALENDAR');
  assert.strictEqual(cached.statusCode, 200);
  assert.strictEqual(cached.body.source, 'cache');
  assert.strictEqual(cached.body.fetchedAt, live.body.fetchedAt);
  assert.strictEqual(cached.body.icsText, live.body.icsText);
  assert.strictEqual(rejected.statusCode, 429);
  assert.strictEqual(rejected.headers['Retry-After'], '60');
  assert.strictEqual(harness.normalizationCount, 2);
  assert.strictEqual(harness.fetchCount, 1);

  harness.advanceTime(60_000);
  const afterReset = await harness.request();
  assert.strictEqual(afterReset.statusCode, 200);
  assert.strictEqual(afterReset.body.source, 'cache');
  assert.strictEqual(harness.normalizationCount, 3);
  assert.strictEqual(harness.fetchCount, 1);
});

test('calendar handler applies a stricter forceRefresh limit before expensive work', async () => {
  const harness = createHandlerHarness({ maxRequests: 10, maxForceRefreshRequests: 1 });

  const first = await harness.request({ forceRefresh: true });
  const rejected = await harness.request({ forceRefresh: true });

  assert.strictEqual(first.statusCode, 200);
  assert.strictEqual(first.body.source, 'live');
  assert.strictEqual(rejected.statusCode, 429);
  assert.strictEqual(rejected.headers['Retry-After'], '60');
  assert.strictEqual(harness.normalizationCount, 1);
  assert.strictEqual(harness.fetchCount, 1);
});

test('calendar handler rate limits outbound work by canonical target without charging cache hits', async () => {
  const harness = createHandlerHarness({ maxRequests: 10, maxTargetRequests: 1 });

  const live = await harness.request();
  const cached = await harness.request();
  const blockedRefresh = await harness.request({ forceRefresh: true });

  assert.strictEqual(live.statusCode, 200);
  assert.strictEqual(cached.statusCode, 200);
  assert.strictEqual(blockedRefresh.statusCode, 429);
  assert.strictEqual(blockedRefresh.headers['Retry-After'], '60');
  assert.strictEqual(harness.targetRequests, 2);
  assert.strictEqual(harness.fetchCount, 1);
});

test('calendar handler rejects oversized response text even if the fetch adapter regresses', async () => {
  const harness = createHandlerHarness({
    maxRequests: 10,
    responseBody: `BEGIN:VCALENDAR\n${'A'.repeat((2 * 1024 * 1024) + 1)}\nEND:VCALENDAR`
  });

  const response = await harness.request();

  assert.strictEqual(response.statusCode, 413);
  assert.strictEqual(response.body.ok, false);
  assert.match(response.body.error, /size limit/);
});

test('calendar handler safely rejects requests with missing headers and query objects', async () => {
  const harness = createHandlerHarness();

  const response = await harness.request({ headers: null, query: null });

  assert.strictEqual(response.statusCode, 400);
  assert.deepStrictEqual(response.body, {
    ok: false,
    error: 'A cache key is required'
  });
  assert.strictEqual(harness.normalizationCount, 1);
  assert.strictEqual(harness.fetchCount, 0);
});
