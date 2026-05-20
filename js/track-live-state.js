import { serverTimestamp } from './vendor/firebase-firestore.js';
import { getDefaultLivePeriod, isFootballSport } from './live-sport-config.js';

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
  liveResetAt = serverTimestamp()
} = {}) {
  const onCourt = Array.isArray(liveLineup?.onCourt) ? [...liveLineup.onCourt] : [];
  const bench = Array.isArray(liveLineup?.bench) ? [...liveLineup.bench] : [];
  const resetPeriod = period || getDefaultLivePeriod({ game: currentGame, config: currentConfig });
  const resetUpdate = {
    homeScore: 0,
    awayScore: 0,
    period: resetPeriod,
    liveClockMs: 0,
    liveClockRunning: false,
    liveClockPeriod: resetPeriod,
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

  if (isFootballSport({ game: currentGame, config: currentConfig })) {
    resetUpdate.liveFootballState = { possession: 'home', down: '1', distance: '10', yardLine: '' };
  }

  return resetUpdate;
}

function normalizeNonNegativeMs(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
}

export function resolveTrackLiveClockResume({
  currentGame = {},
  currentPeriod = '',
  fallbackPeriod = getDefaultLivePeriod({ game: currentGame }),
  now = Date.now()
} = {}) {
  const savedClockMs = normalizeNonNegativeMs(currentGame?.liveClockMs);
  const savedUpdatedAt = normalizeNonNegativeMs(currentGame?.liveClockUpdatedAt);
  const isRunning = currentGame?.liveClockRunning === true;
  const elapsedSinceLastSync = isRunning && savedUpdatedAt > 0
    ? Math.max(0, normalizeNonNegativeMs(now) - savedUpdatedAt)
    : 0;
  const liveClockPeriod = String(currentGame?.liveClockPeriod || '').trim();
  const savedPeriod = String(currentGame?.period || '').trim();

  return {
    elapsed: savedClockMs + elapsedSinceLastSync,
    currentPeriod: liveClockPeriod || savedPeriod || currentPeriod || fallbackPeriod,
    wasRunning: isRunning
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
