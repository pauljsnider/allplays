'use strict';
// Server counterpart of js/season-record.js, kept equivalent by regression tests.
function getTeamScorePair(game) {
  const orientation = String(game?.scoreOrientation || '').trim().toLowerCase();
  const isSharedMirror = !!String(game?.sharedScheduleSourceTeamId || '').trim();
  const hasLegacyTrackerPayload = game?.liveHasData === true
    || Object.prototype.hasOwnProperty.call(game || {}, 'opponentStats');
  const hasAppVenueTrackingMetadata = game?.liveStartedAt != null;

  // Shared mirrors and legacy trackers store team/opponent scores in the two
  // score fields. App/manual venue score writers store true home/away scores.
  // Prefer the persisted contract, while retaining a fallback for historical
  // tracker games completed before scoreOrientation was introduced.
  const useStoredScoreOrder = isSharedMirror
    || orientation === 'team-opponent'
    || (orientation !== 'venue' && hasLegacyTrackerPayload && !hasAppVenueTrackingMetadata)
    || game?.isHome !== false;
  return {
    teamScore: useStoredScoreOrder ? game?.homeScore : game?.awayScore,
    opponentScore: useStoredScoreOrder ? game?.awayScore : game?.homeScore
  };
}

module.exports = { getTeamScorePair };
