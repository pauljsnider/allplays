export function resolveOpponentDisplayName(game) {
  const opponent = String(game?.opponent || '').trim();
  if (opponent) return opponent;
  const linkedName = String(game?.opponentTeamName || '').trim();
  if (linkedName) return linkedName;
  return 'Opponent';
}

export function normalizeLiveStatColumns(columns) {
  const normalized = Array.isArray(columns)
    ? columns.map((column) => String(column || '').trim().toUpperCase()).filter(Boolean)
    : [];
  if (normalized.length) return normalized;
  return ['PTS', 'REB', 'AST', 'STL', 'TO'];
}

function normalizeSportLabel(value) {
  return String(value || '').trim().toLowerCase();
}

export function resolveLiveStatColumns({ columns = [], configs = [], game = null, team = null } = {}) {
  const directColumns = normalizeLiveStatColumns(columns);
  if (Array.isArray(columns) && columns.length) return directColumns;

  const safeConfigs = Array.isArray(configs) ? configs : [];
  const desiredSport = normalizeSportLabel(game?.sport || team?.sport);
  const configId = String(game?.statTrackerConfigId || '').trim();

  if (configId) {
    const configMatch = safeConfigs.find((config) => String(config?.id || '').trim() === configId);
    if (Array.isArray(configMatch?.columns) && configMatch.columns.length) {
      return normalizeLiveStatColumns(configMatch.columns);
    }
  }

  if (desiredSport) {
    const sportMatch = safeConfigs.find((config) => (
      normalizeSportLabel(config?.baseType) === desiredSport &&
      Array.isArray(config?.columns) &&
      config.columns.length
    ));
    if (sportMatch) {
      return normalizeLiveStatColumns(sportMatch.columns);
    }
  }

  if (safeConfigs.length === 1 && Array.isArray(safeConfigs[0]?.columns) && safeConfigs[0].columns.length) {
    return normalizeLiveStatColumns(safeConfigs[0].columns);
  }

  return directColumns;
}

export function applyResetEventState(currentState, event) {
  const period = event?.period || currentState?.period || 'Q1';
  const onCourt = Array.isArray(event?.onCourt) ? [...event.onCourt] : [];
  const bench = Array.isArray(event?.bench) ? [...event.bench] : [];
  const priorEventIds = currentState?.eventIds instanceof Set
    ? new Set(currentState.eventIds)
    : new Set();
  return {
    ...currentState,
    homeScore: Number.isFinite(event?.homeScore) ? event.homeScore : 0,
    awayScore: Number.isFinite(event?.awayScore) ? event.awayScore : 0,
    period,
    gameClockMs: Number.isFinite(event?.gameClockMs) ? event.gameClockMs : 0,
    events: [],
    // Keep already-seen ids so pre-reset events are not replayed into fresh state.
    eventIds: priorEventIds,
    stats: {},
    opponentStats: {},
    onCourt,
    bench,
    lastStatChange: null,
    scoringRun: { team: null, points: 0 },
    lastRunAnnounced: 0
  };
}

export function shouldResetViewerFromGameDoc(gameDoc = {}, currentState = {}) {
  const isScheduledReset =
    gameDoc?.liveStatus === 'scheduled' &&
    !gameDoc?.liveHasData &&
    (Number(gameDoc?.homeScore) || 0) === 0 &&
    (Number(gameDoc?.awayScore) || 0) === 0;

  if (!isScheduledReset) return false;

  const hasEvents = Array.isArray(currentState?.events) && currentState.events.length > 0;
  const hasHomeStats = !!(currentState?.stats && Object.keys(currentState.stats).length > 0);
  const hasOpponentStats = !!(currentState?.opponentStats && Object.keys(currentState.opponentStats).length > 0);
  const hasScore = (Number(currentState?.homeScore) || 0) > 0 || (Number(currentState?.awayScore) || 0) > 0;

  return hasEvents || hasHomeStats || hasOpponentStats || hasScore;
}

export function isLiveEventVisibleForResetBoundary(event = {}, resetBoundaryMs = 0) {
  if (!resetBoundaryMs) return true;

  if (event?.type === 'reset') return true;

  const createdAt = event?.createdAt;
  let eventMs = null;
  if (typeof createdAt === 'number') {
    eventMs = createdAt;
  } else if (createdAt && typeof createdAt.toMillis === 'function') {
    eventMs = createdAt.toMillis();
  }

  if (!Number.isFinite(eventMs)) return true;
  return eventMs >= resetBoundaryMs;
}
