const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildPublicRsvpSummaryProjection,
  refreshPublicRsvpSummary
} = require('../public-rsvp-summary-core.cjs');

test('public RSVP summary projection strips the private player ledger', () => {
  const summary = {
    going: 1,
    maybe: 0,
    notGoing: 1,
    notResponded: 2,
    total: 4,
    notRespondedPlayerIds: ['player-private-1', 'player-private-2']
  };

  assert.deepEqual(buildPublicRsvpSummaryProjection(summary), {
    going: 1,
    maybe: 0,
    notGoing: 1,
    notResponded: 2,
    total: 4
  });
});

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

test('public RSVP summary refresh remains pending until durable fallback work settles', async () => {
  let release;
  let persisted = false;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });

  const lifecycle = refreshPublicRsvpSummary({
    tryApplyDelta: async () => false,
    recomputeSummary: async () => {
      await blocked;
      return { going: 1 };
    },
    persistSummary: async () => {
      persisted = true;
    }
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(persisted, false);
  release();
  assert.equal(await lifecycle, 'recompute');
  assert.equal(persisted, true);
});
