const { test } = require('node:test');
const assert = require('node:assert');
const {
  DEFAULT_TTL_MS,
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
