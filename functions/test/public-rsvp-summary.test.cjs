const assert = require('node:assert/strict');
const test = require('node:test');
const {
  refreshPublicRsvpSummary,
  schedulePublicRsvpSummaryRefresh
} = require('../public-rsvp-summary-core.cjs');

test('public RSVP summary refresh uses a bounded delta without recomputing', async () => {
  let recomputeCount = 0;
  let persistCount = 0;

  const mode = await refreshPublicRsvpSummary({
    tryApplyDelta: async () => true,
    recomputeSummary: async () => {
      recomputeCount += 1;
      return {};
    },
    persistSummary: async () => {
      persistCount += 1;
    }
  });

  assert.equal(mode, 'delta');
  assert.equal(recomputeCount, 0);
  assert.equal(persistCount, 0);
});

test('public RSVP summary refresh falls back to recompute when the delta is unsafe', async () => {
  const summary = { going: 1, maybe: 0, notGoing: 0, notResponded: 2 };
  let persistedSummary = null;

  const mode = await refreshPublicRsvpSummary({
    tryApplyDelta: async () => false,
    recomputeSummary: async () => summary,
    persistSummary: async (value) => {
      persistedSummary = value;
    }
  });

  assert.equal(mode, 'recompute');
  assert.equal(persistedSummary, summary);
});

test('public RSVP summary scheduling returns before background work settles', async () => {
  let release;
  let settled = false;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });

  const result = schedulePublicRsvpSummaryRefresh(async () => {
    await blocked;
    settled = true;
  });

  assert.equal(result, undefined);
  assert.equal(settled, false);
  release();
  await blocked;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, true);
});
