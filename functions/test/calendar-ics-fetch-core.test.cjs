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

function createHandlerHarness({ maxRequests = 2, maxForceRefreshRequests = 1 } = {}) {
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
  const handler = createCalendarIcsFetchHandler({
    cache,
    checkRateLimit: (req) => normalLimiter(req, now),
    checkForceRefreshRateLimit: (req) => forceRefreshLimiter(req, now),
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
        text: async () => 'BEGIN:VCALENDAR\nEND:VCALENDAR'
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
