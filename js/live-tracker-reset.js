export function buildLiveResetEvent({
  period = 'Q1',
  gameClockMs = 0,
  homeScore = 0,
  awayScore = 0,
  onCourt = [],
  bench = [],
  createdBy = null,
  description = 'Tracker reset. Live viewer state cleared.'
} = {}) {
  return {
    type: 'reset',
    description,
    period,
    gameClockMs,
    homeScore,
    awayScore,
    onCourt: Array.isArray(onCourt) ? [...onCourt] : [],
    bench: Array.isArray(bench) ? [...bench] : [],
    stats: {},
    opponentStats: {},
    createdBy
  };
}
