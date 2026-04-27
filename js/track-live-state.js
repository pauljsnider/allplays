import { getDefaultLivePeriod } from './live-sport-config.js';

export function summarizePersistedTrackingState({
  eventsCount = 0,
  statsCount = 0,
  liveEventsCount = 0,
  hasScores = false,
  hasOpponentStats = false,
  hasLiveFlag = false
} = {}) {
  const parts = [];
  if (eventsCount > 0) parts.push(`${eventsCount} event(s)`);
  if (statsCount > 0) parts.push(`${statsCount} player stat record(s)`);
  if (liveEventsCount > 0) parts.push(`${liveEventsCount} live event(s)`);
  if (hasScores) parts.push('saved score');
  if (hasOpponentStats) parts.push('opponent stats');
  if (hasLiveFlag) parts.push('live status');

  const hasPersistedData = parts.length > 0;
  return {
    hasPersistedData,
    parts,
    summary: parts.join(', ') || 'tracked data'
  };
}

export function buildTrackLiveResetUpdate({
  currentGame = {},
  currentConfig = null,
  period,
  liveLineup = { onCourt: [], bench: [] },
  liveResetAt = Date.now()
} = {}) {
  const onCourt = Array.isArray(liveLineup?.onCourt) ? [...liveLineup.onCourt] : [];
  const bench = Array.isArray(liveLineup?.bench) ? [...liveLineup.bench] : [];
  return {
    homeScore: 0,
    awayScore: 0,
    period: period || getDefaultLivePeriod({ game: currentGame, config: currentConfig }),
    liveLineup: { onCourt, bench },
    opponentStats: {},
    liveStatus: 'scheduled',
    liveHasData: false,
    liveResetAt,
    servingTeam: 'home',
    opponent: currentGame?.opponent,
    opponentTeamId: currentGame?.opponentTeamId || '',
    opponentTeamName: currentGame?.opponentTeamName || '',
    opponentTeamPhoto: currentGame?.opponentTeamPhoto || ''
  };
}

export async function runTrackLiveResetPersistence({
  publishResetEvent,
  updateResetState,
  cleanupPersistedState,
  logWarn = () => {},
  logError = () => {}
} = {}) {
  if (typeof publishResetEvent === 'function') {
    try {
      await publishResetEvent();
    } catch (error) {
      logWarn('Failed to publish reset event:', error);
    }
  }

  if (typeof updateResetState === 'function') {
    try {
      await updateResetState();
    } catch (error) {
      logError('Error updating game reset state:', error);
    }
  }

  if (typeof cleanupPersistedState === 'function') {
    try {
      await cleanupPersistedState();
    } catch (error) {
      logWarn('Failed to clear persisted tracking records during reset:', error);
    }
  }
}
