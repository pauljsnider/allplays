import { getDefaultLivePeriod } from './live-sport-config.js';

export function buildLiveResetEvent({
  period,
  gameClockMs = 0,
  homeScore = 0,
  awayScore = 0,
  onCourt = [],
  bench = [],
  sport = '',
  periods = null,
  createdBy = null,
  description = 'Tracker reset. Live viewer state cleared.'
} = {}) {
  return {
    type: 'reset',
    description,
    period: period || getDefaultLivePeriod({ sport, periods }),
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
