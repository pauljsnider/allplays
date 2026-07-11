const RESPONSE_SUMMARY_KEYS = {
  going: 'going',
  maybe: 'maybe',
  not_going: 'notGoing'
};
const SUMMARY_COUNT_KEYS = ['going', 'maybe', 'notGoing', 'notResponded'];
const PUBLIC_SUMMARY_KEYS = [...SUMMARY_COUNT_KEYS, 'total'];

function buildPublicRsvpSummaryProjection(summary = {}) {
  return Object.fromEntries(PUBLIC_SUMMARY_KEYS
    .filter((key) => Number.isInteger(summary[key]) && summary[key] >= 0)
    .map((key) => [key, summary[key]]));
}

function buildPublicRsvpSummaryDelta({ summary, playerId, previousResponse, previousResponseVerified = false, nextResponse } = {}) {
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

  if (!playerId || !Array.isArray(summary.notRespondedPlayerIds)) return null;
  const normalizedPlayerId = String(playerId);
  const wasNotResponded = summary.notRespondedPlayerIds.map(String).includes(normalizedPlayerId);
  if ((!previousResponse && !wasNotResponded) || (previousResponse && (!previousResponseVerified || wasNotResponded))) return null;
  nextSummary.notRespondedPlayerIds = summary.notRespondedPlayerIds
    .filter((id) => String(id) !== normalizedPlayerId);

  if (previousKey === nextKey) return nextSummary;
  if (nextSummary[previousKey] < 1) return null;
  nextSummary[previousKey] -= 1;
  nextSummary[nextKey] += 1;
  return nextSummary;
}

function buildPublicRsvpSummaryJobPlan({ jobId, playerId, response, playerState = {}, summary } = {}) {
  if (!jobId || playerState.latestJobId !== jobId) {
    return { mode: 'obsolete', summary: null };
  }
  if (playerState.appliedJobId === jobId && playerState.appliedResponse === response) {
    return { mode: 'already_applied', summary: null };
  }
  if (playerState.appliedJobId) {
    return { mode: 'recompute', summary: null };
  }
  const appliedResponse = RESPONSE_SUMMARY_KEYS[playerState.appliedResponse]
    ? playerState.appliedResponse
    : '';
  const nextSummary = buildPublicRsvpSummaryDelta({
    summary,
    playerId,
    previousResponse: appliedResponse,
    previousResponseVerified: false,
    nextResponse: response
  });
  return nextSummary
    ? { mode: 'delta', summary: nextSummary }
    : { mode: 'recompute', summary: null };
}

async function refreshPublicRsvpSummary({ tryApplyDelta, recomputeSummary, persistSummary }) {
  if (await tryApplyDelta()) return 'delta';
  const summary = await recomputeSummary();
  await persistSummary(summary);
  return 'recompute';
}

module.exports = {
  buildPublicRsvpSummaryProjection,
  buildPublicRsvpSummaryDelta,
  buildPublicRsvpSummaryJobPlan,
  refreshPublicRsvpSummary
};
