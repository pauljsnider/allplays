const RESPONSE_SUMMARY_KEYS = {
  going: 'going',
  maybe: 'maybe',
  not_going: 'notGoing'
};
const SUMMARY_COUNT_KEYS = ['going', 'maybe', 'notGoing', 'notResponded'];

function buildPublicRsvpSummaryDelta({ summary, playerId, previousResponse, nextResponse } = {}) {
  const nextKey = RESPONSE_SUMMARY_KEYS[nextResponse];
  const previousKey = previousResponse ? RESPONSE_SUMMARY_KEYS[previousResponse] : 'notResponded';
  if (!summary || typeof summary !== 'object' || !nextKey || !previousKey) return null;

  const nextSummary = { ...summary };
  for (const key of SUMMARY_COUNT_KEYS) {
    if (!Number.isInteger(summary[key]) || summary[key] < 0) return null;
  }

  const total = SUMMARY_COUNT_KEYS.reduce((sum, key) => sum + summary[key], 0);
  if (summary.total !== undefined && (!Number.isInteger(summary.total) || summary.total !== total)) {
    return null;
  }

  if (summary.notRespondedPlayerIds !== undefined) {
    if (!playerId || !Array.isArray(summary.notRespondedPlayerIds)) return null;
    const normalizedPlayerId = String(playerId);
    const wasNotResponded = summary.notRespondedPlayerIds.map(String).includes(normalizedPlayerId);
    if ((!previousResponse && !wasNotResponded) || (previousResponse && wasNotResponded)) return null;
    nextSummary.notRespondedPlayerIds = summary.notRespondedPlayerIds
      .filter((id) => String(id) !== normalizedPlayerId);
  }

  if (previousKey === nextKey) return nextSummary;
  if (nextSummary[previousKey] < 1) return null;
  nextSummary[previousKey] -= 1;
  nextSummary[nextKey] += 1;
  return nextSummary;
}

async function refreshPublicRsvpSummary({ tryApplyDelta, recomputeSummary, persistSummary }) {
  if (await tryApplyDelta()) return 'delta';
  const summary = await recomputeSummary();
  await persistSummary(summary);
  return 'recompute';
}

function schedulePublicRsvpSummaryRefresh(refresh, onError = () => {}) {
  Promise.resolve()
    .then(refresh)
    .catch(onError);
}

module.exports = {
  buildPublicRsvpSummaryDelta,
  refreshPublicRsvpSummary,
  schedulePublicRsvpSummaryRefresh
};
