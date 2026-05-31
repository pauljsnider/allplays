export type BaseballHalfInning = 'top' | 'bottom';

export interface BaseballBases {
  first: boolean;
  second: boolean;
  third: boolean;
}

export interface BaseballLiveState {
  inning: number;
  half: BaseballHalfInning;
  balls: number;
  strikes: number;
  outs: number;
  bases: BaseballBases;
  homeScore: number;
  awayScore: number;
}

export interface BaseballScoringResult {
  state: BaseballLiveState;
  description: string;
}

function normalizePositiveInteger(value: unknown, fallback: number, max?: number) {
  const parsed = Number.parseInt(String(value), 10);
  const normalized = Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  return typeof max === 'number' ? Math.min(normalized, max) : normalized;
}

function normalizeInning(value: unknown) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeHalf(value: unknown): BaseballHalfInning {
  return String(value || '').trim().toLowerCase() === 'bottom' ? 'bottom' : 'top';
}

function normalizeBases(bases: Partial<BaseballBases> = {}): BaseballBases {
  return {
    first: bases.first === true,
    second: bases.second === true,
    third: bases.third === true
  };
}

export function createBaseballLiveState(state: Partial<BaseballLiveState> = {}): BaseballLiveState {
  return {
    inning: normalizeInning(state.inning),
    half: normalizeHalf(state.half),
    balls: normalizePositiveInteger(state.balls, 0, 3),
    strikes: normalizePositiveInteger(state.strikes, 0, 2),
    outs: normalizePositiveInteger(state.outs, 0, 2),
    bases: normalizeBases(state.bases),
    homeScore: normalizePositiveInteger(state.homeScore, 0),
    awayScore: normalizePositiveInteger(state.awayScore, 0)
  };
}

function resetCount(state: BaseballLiveState): BaseballLiveState {
  return { ...state, balls: 0, strikes: 0 };
}

function addRuns(state: BaseballLiveState, runs: number): BaseballLiveState {
  if (runs <= 0) return state;
  if (state.half === 'top') {
    return { ...state, awayScore: state.awayScore + runs };
  }
  return { ...state, homeScore: state.homeScore + runs };
}

function describeScoreChange(previous: BaseballLiveState, next: BaseballLiveState) {
  const runs = (next.homeScore - previous.homeScore) + (next.awayScore - previous.awayScore);
  if (runs <= 0) return '';
  return `, ${runs} run${runs === 1 ? '' : 's'} scored`;
}

export function applyWalk(state: Partial<BaseballLiveState>): BaseballScoringResult {
  const normalized = createBaseballLiveState(state);
  const { bases } = normalized;
  const runs = bases.first && bases.second && bases.third ? 1 : 0;
  const nextBases: BaseballBases = {
    first: true,
    second: bases.first || bases.second,
    third: bases.third || (bases.first && bases.second)
  };
  const scoredState = addRuns(resetCount({ ...normalized, bases: nextBases }), runs);

  return {
    state: scoredState,
    description: `Walk${describeScoreChange(normalized, scoredState)}`
  };
}
