const { test } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_TTL_MS,
  DEFAULT_MAX_ENTRIES,
  createCalendarIcsCache,
  fetchCalendarIcsWithCache
} = require('../calendar-ics-fetch-core.cjs');

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
