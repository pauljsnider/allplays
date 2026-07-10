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

function toMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'object' && Number.isFinite(value.seconds)) {
    const nanos = Number.isFinite(value.nanoseconds) ? value.nanoseconds : 0;
    return (value.seconds * 1000) + Math.floor(nanos / 1000000);
  }
  return null;
}

function formatTrackGameTime(gameClockMs) {
  const safeMs = Math.max(0, Number(gameClockMs) || 0);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function normalizeTrackLiveText(value) {
  return String(value || '').trim();
}

function buildResumeLogText(event) {
  const description = normalizeTrackLiveText(event?.description);
  if (event?.type === 'clock_pause') {
    return 'Game stopped';
  }
  return description;
}

function isHydratableLogEventType(type) {
  return [
    'baseball',
    'clock_pause',
    'clock_start',
    'football_play',
    'football_score',
    'goal',
    'note',
    'period_change',
    'stat',
    'undo',
    'volleyball'
  ].includes(type);
}

function buildResumeUndoData(event) {
  const type = normalizeTrackLiveText(event?.type);
  if (type === 'stat' || type === 'goal') {
    const undoData = {
      type,
      playerId: event?.playerId || null,
      statKey: event?.statKey || null,
      value: Number(event?.value || 0),
      isOpponent: Boolean(event?.isOpponent)
    };

    if (type === 'goal') {
      undoData.teamSide = normalizeTrackLiveText(event?.teamSide) || null;
      undoData.liveNoteId = normalizeTrackLiveText(event?.liveNoteId) || null;
      undoData.liveNoteText = normalizeTrackLiveText(event?.liveNoteText) || null;
    }

    return undoData;
  }

  return null;
}

function parseUndoTarget(description) {
  const clean = normalizeTrackLiveText(description);
  const match = clean.match(/^Undo:\s*(.+)$/i);
  return match ? normalizeTrackLiveText(match[1]) : '';
}

function removeLastMatchingText(entries, targetText) {
  const clean = normalizeTrackLiveText(targetText);
  if (!clean) return;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (normalizeTrackLiveText(entries[index]?.text) === clean) {
      entries.splice(index, 1);
      return;
    }
  }
}

export function buildTrackLiveResumeState({
  liveEvents = [],
  buildGoalNoteText = (event) => normalizeTrackLiveText(event?.note),
  now = () => Date.now()
} = {}) {
  if (!Array.isArray(liveEvents) || liveEvents.length === 0) {
    return {
      gameLog: [],
      liveNotes: [],
      summaryText: ''
    };
  }

  const orderedEvents = liveEvents
    .map((event, index) => ({
      event,
      index,
      createdAtMs: toMillis(event?.createdAt)
    }))
    .sort((a, b) => {
      if (a.createdAtMs !== null && b.createdAtMs !== null && a.createdAtMs !== b.createdAtMs) {
        return a.createdAtMs - b.createdAtMs;
      }
      if (a.createdAtMs !== null && b.createdAtMs === null) return -1;
      if (a.createdAtMs === null && b.createdAtMs !== null) return 1;
      return a.index - b.index;
    });

  const gameLog = [];
  const liveNotes = [];

  orderedEvents.forEach(({ event, index, createdAtMs }) => {
    const type = normalizeTrackLiveText(event?.type);
    const timestamp = createdAtMs ?? now();
    const baseEntry = {
      period: normalizeTrackLiveText(event?.period),
      time: formatTrackGameTime(event?.gameClockMs),
      timestamp
    };

    if (type === 'reset') {
      gameLog.length = 0;
      liveNotes.length = 0;
      return;
    }

    if (type === 'undo') {
      removeLastMatchingText(gameLog, parseUndoTarget(event?.description));
      removeLastMatchingText(liveNotes, event?.removedNote);

      const correctionText = normalizeTrackLiveText(event?.description);
      if (correctionText && !parseUndoTarget(correctionText)) {
        gameLog.push({
          ...baseEntry,
          text: correctionText
        });
      }
      return;
    }

    if (type === 'note') {
      const noteText = normalizeTrackLiveText(event?.note);
      if (noteText) {
        liveNotes.push({
          ...baseEntry,
          id: normalizeTrackLiveText(event?.liveNoteId) || `resume-note-${index}`,
          text: noteText,
          type: normalizeTrackLiveText(event?.noteType) || 'text'
        });
      }
    }

    if (type === 'goal') {
      const goalNoteText = normalizeTrackLiveText(buildGoalNoteText(event));
      if (goalNoteText) {
        liveNotes.push({
          ...baseEntry,
          id: normalizeTrackLiveText(event?.liveNoteId) || `resume-goal-note-${index}`,
          text: goalNoteText,
          type: 'goal'
        });
      }
    }

    if (type === 'clock_sync') {
      return;
    }

    if (!isHydratableLogEventType(type)) {
      return;
    }

    const text = buildResumeLogText(event);
    if (!text) return;

    gameLog.push({
      ...baseEntry,
      text,
      undoData: buildResumeUndoData(event)
    });
  });

  return {
    gameLog: gameLog.slice().reverse(),
    liveNotes: liveNotes.slice().reverse(),
    summaryText: liveNotes.map((entry) => entry.text).join('\n')
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
