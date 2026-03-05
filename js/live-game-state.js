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

export function applyResetEventState(currentState, event) {
  const period = event?.period || currentState?.period || 'Q1';
  const onCourt = Array.isArray(event?.onCourt) ? [...event.onCourt] : [];
  const bench = Array.isArray(event?.bench) ? [...event.bench] : [];
  return {
    ...currentState,
    homeScore: Number.isFinite(event?.homeScore) ? event.homeScore : 0,
    awayScore: Number.isFinite(event?.awayScore) ? event.awayScore : 0,
    period,
    gameClockMs: Number.isFinite(event?.gameClockMs) ? event.gameClockMs : 0,
    events: [],
    eventIds: new Set(),
    stats: {},
    opponentStats: {},
    onCourt,
    bench,
    lastStatChange: null,
    scoringRun: { team: null, points: 0 },
    lastRunAnnounced: 0
  };
}
