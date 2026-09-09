import {
  DIAMOND_REDUCER_VERSION,
  DIAMOND_SCHEMA_VERSION,
  DIAMOND_STAT_CATALOG_VERSION,
  DiamondDomainError,
  type DiamondBase,
  type DiamondBases,
  type DiamondBattingRole,
  type DiamondCommandPayloadMap,
  type DiamondCommandType,
  type DiamondCoverage,
  type DiamondCoverageMap,
  type DiamondDefensivePosition,
  type DiamondDestination,
  type DiamondEffectiveEvent,
  type DiamondFieldingChain,
  type DiamondFinalizationReason,
  type DiamondGameState,
  type DiamondLedgerConfig,
  type DiamondLineupSlot,
  type DiamondRunnerAdvance,
  type DiamondRunnerPlacement,
  type DiamondRuleDecisionCode,
  type DiamondRulesProfile,
  type DiamondSide,
  type DiamondStatFamily,
  type DiamondTeamLineup
} from './contracts';
import { requireDiamondRulesProfile } from './rules';

export type DiamondReducerAction = {
  [K in DiamondCommandType]: Readonly<{
    type: K;
    payload: DiamondCommandPayloadMap[K];
    eventId?: string;
  }>;
}[DiamondCommandType];

const EMPTY_BASES: DiamondBases = Object.freeze({ first: null, second: null, third: null });
const EMPTY_LINEUP: DiamondTeamLineup = Object.freeze({
  battingOrder: Object.freeze([]),
  defense: Object.freeze({}),
  dpFlex: null
});
const BASES: readonly DiamondBase[] = ['first', 'second', 'third'];
const COVERAGE_VALUES: readonly DiamondCoverage[] = ['complete', 'partial', 'not_collected'];
const SIDES = ['home', 'away'] as const;
const LIFECYCLES: readonly DiamondGameState['lifecycle'][] = [
  'configured',
  'ready',
  'active',
  'suspended',
  'final',
  'correction',
  'cancelled'
];
const FIELDING_POSITIONS: readonly DiamondDefensivePosition[] = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'CF', 'RCF', 'RF'];
const BATTING_ROLES: readonly DiamondBattingRole[] = ['regular', 'dh', 'dp', 'flex', 'eh', 'ep'];
const RULE_DECISION_CODES: readonly DiamondRuleDecisionCode[] = [
  'coverage_adjustment',
  'end_half_inning_run_limit',
  'end_game_time_limit',
  'end_game_weather',
  'end_game_forfeit_home',
  'end_game_forfeit_away'
];
const PITCH_RESULTS: readonly DiamondCommandPayloadMap['record_pitch']['result'][] = [
  'ball',
  'called_strike',
  'swinging_strike',
  'foul',
  'foul_bunt',
  'in_play',
  'hit_by_pitch',
  'catcher_interference',
  'illegal_pitch',
  'balk',
  'pickoff_attempt'
];
const TERMINAL_PITCH_RESULTS: readonly DiamondCommandPayloadMap['record_pitch']['result'][] = [
  'in_play',
  'hit_by_pitch',
  'catcher_interference'
];
const PLATE_APPEARANCE_RESULTS: readonly DiamondCommandPayloadMap['record_plate_appearance']['result'][] = [
  'single',
  'double',
  'triple',
  'home_run',
  'walk',
  'intentional_walk',
  'hit_by_pitch',
  'strikeout',
  'reached_on_error',
  'fielders_choice',
  'sacrifice_bunt',
  'sacrifice_fly',
  'interference',
  'dropped_third_strike',
  'ground_out',
  'fly_out',
  'line_out',
  'double_play',
  'triple_play'
];
const DESTINATIONS: readonly DiamondDestination[] = ['first', 'second', 'third', 'home', 'out', 'stay'];
const ADVANCE_CAUSES: readonly DiamondCommandPayloadMap['advance_runner']['cause'][] = [
  'batted_ball',
  'walk',
  'hit_by_pitch',
  'stolen_base',
  'caught_stealing',
  'pickoff',
  'wild_pitch',
  'passed_ball',
  'balk',
  'illegal_pitch',
  'defensive_indifference',
  'error',
  'obstruction',
  'force_out',
  'tag_out',
  'appeal_out',
  'courtesy_runner',
  'tiebreaker',
  'other'
];
const OUT_KINDS: readonly NonNullable<DiamondCommandPayloadMap['advance_runner']['outKind']>[] = [
  'force',
  'tag',
  'appeal',
  'batter_runner',
  'strikeout',
  'catch'
];
const SCORING_CREDIT_FIELDS = ['countsRun', 'earned', 'rbi', 'responsiblePitcherId'] as const;
const BATTER_ADVANCE_FIELDS = new Set(['to', 'cause', 'outKind', ...SCORING_CREDIT_FIELDS]);
const RUNNER_ADVANCE_FIELDS = new Set(['runnerId', 'from', 'to', 'cause', 'outKind', ...SCORING_CREDIT_FIELDS]);
const STANDALONE_RUNNER_ADVANCE_FIELDS = new Set([...RUNNER_ADVANCE_FIELDS, 'fielding', 'omissions']);
const FIELDING_FIELDS = new Set(['putoutBy', 'assists', 'errors', 'passedBallBy', 'doublePlay', 'triplePlay', 'battedBall', 'location']);
const FIELDING_ATTACHMENT_FIELDS = new Set(['playEventId', 'fielding']);
const SCORING_JUDGMENT_FIELDS = new Set(['playEventId', 'runnerId', 'earned', 'rbi', 'responsiblePitcherId', 'pitcherOfRecord']);
const PITCHER_DECISION_FIELDS = new Set(['side', 'playerId', 'decision']);

function cloneLineup(lineup: DiamondTeamLineup): DiamondTeamLineup {
  return {
    battingOrder: lineup.battingOrder.map((entry) => ({
      ...entry,
      substitutions: [...entry.substitutions]
    })),
    defense: { ...lineup.defense },
    dpFlex: lineup.dpFlex ? { ...lineup.dpFlex } : null
  };
}

function cloneState(state: DiamondGameState): DiamondGameState {
  return {
    ...state,
    inning: { ...state.inning },
    score: { ...state.score },
    inningRuns: { ...state.inningRuns },
    bases: {
      first: state.bases.first ? { ...state.bases.first } : null,
      second: state.bases.second ? { ...state.bases.second } : null,
      third: state.bases.third ? { ...state.bases.third } : null
    },
    lineups: {
      home: cloneLineup(state.lineups.home),
      away: cloneLineup(state.lineups.away)
    },
    nextBatterSlot: { ...state.nextBatterSlot },
    coverage: { ...state.coverage },
    halfInningEnd: state.halfInningEnd ? { ...state.halfInningEnd } : null,
    gameEndDecision: state.gameEndDecision ? { ...state.gameEndDecision } : null,
    finalizationReason: state.finalizationReason ? { ...state.finalizationReason } : null,
    cancellation: state.cancellation ? { ...state.cancellation } : null
  };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((child) => deepFreeze(child));
  }
  return value;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new DiamondDomainError('invalid-id', `${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || normalized.includes('/')) {
    throw new DiamondDomainError('invalid-id', `${label} must be nonempty, slash-free, and at most 128 characters.`);
  }
  return normalized;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DiamondDomainError('invalid-object', `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireOnlyFields(value: Record<string, unknown>, fields: ReadonlySet<string>, label: string) {
  if (Object.keys(value).some((key) => !fields.has(key))) {
    throw new DiamondDomainError('invalid-object', `${label} contains unsupported fields.`);
  }
}

function requireOptionalBoolean(value: unknown, label: string) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new DiamondDomainError('invalid-boolean', `${label} must be a boolean when provided.`);
  }
}

function validateScoringCredit(value: Record<string, unknown>, label: string) {
  requireOptionalBoolean(value.countsRun, `${label}.countsRun`);
  requireOptionalBoolean(value.earned, `${label}.earned`);
  requireOptionalBoolean(value.rbi, `${label}.rbi`);
  if (value.responsiblePitcherId !== undefined) {
    requireId(value.responsiblePitcherId, `${label}.responsiblePitcherId`);
  }
}

function validateOmissions(value: unknown) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 7) {
    throw new DiamondDomainError('invalid-stat-family', 'omissions must be a bounded stat-family array.');
  }
  const families = value.map((family) => requireMember(family, Object.keys(initialCoverage('full')) as DiamondStatFamily[], 'stat family'));
  if (new Set(families).size !== families.length) {
    throw new DiamondDomainError('invalid-stat-family', 'omissions cannot contain duplicate stat families.');
  }
}

function requireText(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== 'string') throw new DiamondDomainError('invalid-text', `${label} must be a string.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw new DiamondDomainError('invalid-text', `${label} must be between 1 and ${String(maximum)} characters.`);
  }
  return normalized;
}

function requireInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new DiamondDomainError('invalid-number', `${label} must be an integer between ${String(minimum)} and ${String(maximum)}.`);
  }
  return Number(value);
}

function requireMember<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new DiamondDomainError('invalid-enum', `${label} is not supported.`);
  }
  return value as T;
}

function requireSide(value: unknown, label = 'side'): DiamondSide {
  return requireMember(value, SIDES, label);
}

export function isDiamondDeliveredPitch(result: DiamondCommandPayloadMap['record_pitch']['result']): boolean {
  return result !== 'balk' && result !== 'pickoff_attempt';
}

export function isDiamondTerminalPitchResult(result: DiamondCommandPayloadMap['record_pitch']['result'] | null): boolean {
  return result !== null && TERMINAL_PITCH_RESULTS.includes(result);
}

function hasCompletePitchOutcomeEvidence(
  state: DiamondGameState,
  result: DiamondCommandPayloadMap['record_plate_appearance']['result']
): boolean {
  if (state.captureMode !== 'full') return true;
  if (result === 'intentional_walk') return true;
  if (result === 'walk') return state.inning.balls === 4;
  if (result === 'strikeout' || result === 'dropped_third_strike') return state.inning.strikes === 3;
  if (result === 'hit_by_pitch') return state.inning.lastPitchResult === 'hit_by_pitch';
  if (result === 'interference') return state.inning.lastPitchResult === 'catcher_interference';
  return state.inning.lastPitchResult === 'in_play';
}

function requireEventId(value: unknown, label: string): string {
  return requireId(value, label);
}

function requireBattingRole(profile: DiamondRulesProfile, value: unknown, options: Readonly<{ initialLineup?: boolean }> = {}) {
  const role = requireMember(value, BATTING_ROLES, 'batting role');
  if (role === 'dh' && !profile.allowsDh) {
    throw new DiamondDomainError('rule-not-enabled', 'The selected rules profile does not allow a designated hitter.');
  }
  if (role === 'eh' && !profile.allowsEh) {
    throw new DiamondDomainError('rule-not-enabled', 'The selected rules profile does not allow an extra hitter.');
  }
  if (role === 'ep' && !profile.allowsEp) {
    throw new DiamondDomainError('rule-not-enabled', 'The selected rules profile does not allow an extra player.');
  }
  if ((role === 'dp' || role === 'flex') && !profile.dpFlex.enabled) {
    throw new DiamondDomainError('rule-not-enabled', 'The selected rules profile does not allow DP/FLEX.');
  }
  if (role === 'flex' && options.initialLineup) {
    throw new DiamondDomainError(
      'invalid-dp-flex',
      'The starting FLEX is linked through set_dp_flex and does not occupy a separate batting slot.'
    );
  }
  return role;
}

function validateBattingRoleCounts(entries: readonly Readonly<{ battingRole: DiamondBattingRole }>[]) {
  const count = (role: DiamondBattingRole) => entries.filter((entry) => entry.battingRole === role).length;
  if (count('dh') > 1) throw new DiamondDomainError('invalid-lineup-role', 'A lineup may contain at most one designated hitter.');
  if (count('dp') > 1) throw new DiamondDomainError('invalid-dp-flex', 'A lineup may contain at most one DP batting slot.');
}

function validateBatterAdvanceShape(value: unknown) {
  const advance = requireRecord(value, 'batterAdvance');
  requireOnlyFields(advance, BATTER_ADVANCE_FIELDS, 'batterAdvance');
  requireMember(advance.to, DESTINATIONS, 'batter destination');
  if (advance.cause !== undefined) requireMember(advance.cause, ADVANCE_CAUSES, 'batter advance cause');
  if (advance.outKind !== undefined) requireMember(advance.outKind, OUT_KINDS, 'batter out kind');
  validateScoringCredit(advance, 'batterAdvance');
}

function validateRunnerDestination(from: DiamondBase, to: DiamondDestination) {
  if (to === 'stay' || to === 'home' || to === 'out') return;
  if (BASES.indexOf(to) <= BASES.indexOf(from)) {
    throw new DiamondDomainError(
      'invalid-runner-destination',
      `A runner on ${from} must stay, advance to a later base, reach home, or be recorded out.`
    );
  }
}

function validateAdvanceShape(value: unknown, options: Readonly<{ standalone?: boolean }> = {}) {
  const advance = requireRecord(value, 'runner advance');
  requireOnlyFields(advance, options.standalone ? STANDALONE_RUNNER_ADVANCE_FIELDS : RUNNER_ADVANCE_FIELDS, 'runner advance');
  requireId(advance.runnerId, 'runnerId');
  const from = requireMember(advance.from, BASES, 'runner source');
  const to = requireMember(advance.to, DESTINATIONS, 'runner destination');
  validateRunnerDestination(from, to);
  requireMember(advance.cause, ADVANCE_CAUSES, 'runner advance cause');
  if (advance.outKind !== undefined) requireMember(advance.outKind, OUT_KINDS, 'out kind');
  validateScoringCredit(advance, 'runner advance');
  if (advance.to === 'out' && !advance.outKind) {
    throw new DiamondDomainError('missing-out-kind', 'A runner recorded out must include an out kind.');
  }
  if (advance.to !== 'out' && advance.outKind) {
    throw new DiamondDomainError('invalid-out-kind', 'Only an out destination may include an out kind.');
  }
}

function oppositeSide(side: DiamondSide): DiamondSide {
  return side === 'home' ? 'away' : 'home';
}

export function getBattingSide(state: DiamondGameState): DiamondSide {
  return state.inning.half === 'top' ? 'away' : 'home';
}

function getInningKey(state: DiamondGameState): string {
  return `${state.inning.half === 'top' ? 'T' : 'B'}${String(state.inning.number)}`;
}

function currentHalfRuns(state: DiamondGameState): number {
  return state.inningRuns[getInningKey(state)] ?? 0;
}

function halfInningEnded(state: DiamondGameState): boolean {
  return state.inning.outs === 3 || state.halfInningEnd !== null;
}

function pristineCurrentHalf(state: DiamondGameState): boolean {
  return (
    state.inning.outs === 0 &&
    state.inning.balls === 0 &&
    state.inning.strikes === 0 &&
    state.inning.pitchesInPlateAppearance === 0 &&
    currentHalfRuns(state) === 0 &&
    BASES.every((base) => state.bases[base] === null)
  );
}

function automaticEndingHasEqualOpportunity(state: DiamondGameState, minimumInning: number, leader: DiamondSide): boolean {
  if (state.inning.number < minimumInning) return false;
  if (leader === 'home') {
    return state.inning.half === 'bottom' || halfInningEnded(state) || (state.inning.number > minimumInning && pristineCurrentHalf(state));
  }
  if (state.inning.half === 'bottom') return halfInningEnded(state);
  return state.inning.number > minimumInning && pristineCurrentHalf(state);
}

function automaticDiamondFinalizationReason(state: DiamondGameState): DiamondFinalizationReason | null {
  if (state.score.home === state.score.away) return null;
  const leader: DiamondSide = state.score.home > state.score.away ? 'home' : 'away';
  const differential = Math.abs(state.score.home - state.score.away);
  const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
  const runAhead = profile.runAheadRules.some(
    (rule) => differential >= rule.runDifferential && automaticEndingHasEqualOpportunity(state, rule.afterInning, leader)
  );
  if (runAhead) return { kind: 'run-ahead', decisionEventId: null };

  if (leader === 'home' && state.inning.number >= profile.scheduledInnings && state.inning.half === 'bottom') {
    return {
      kind: currentHalfRuns(state) > 0 ? 'walkoff' : 'regulation',
      decisionEventId: null
    };
  }
  if (automaticEndingHasEqualOpportunity(state, profile.scheduledInnings, leader)) {
    return { kind: 'regulation', decisionEventId: null };
  }
  return null;
}

export function getDiamondFinalizationReason(state: DiamondGameState): DiamondFinalizationReason | null {
  if (state.gameEndDecision) {
    return {
      kind: state.gameEndDecision.reason,
      decisionEventId: state.gameEndDecision.decisionEventId
    };
  }
  return automaticDiamondFinalizationReason(state);
}

function requireNoGameEndingCondition(state: DiamondGameState, nextAction: string) {
  const ending = getDiamondFinalizationReason(state);
  if (!ending) return;
  if (state.gameEndDecision) {
    throw new DiamondDomainError('game-end-decision-recorded', `Finalize the recorded game-ending decision before ${nextAction}.`);
  }
  throw new DiamondDomainError('game-ending-condition-met', `Finalize the ${ending.kind} result before ${nextAction}.`);
}

function currentHalfReachedRunLimit(state: DiamondGameState) {
  const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
  return profile.inningRunLimit !== null && currentHalfRuns(state) >= profile.inningRunLimit;
}

function requireOpenHalfForPlay(state: DiamondGameState, options: Readonly<{ allowPendingTiebreakerPlacement?: boolean }> = {}) {
  requireNoGameEndingCondition(state, 'adding another play');
  if (state.inning.outs >= 3 || state.halfInningEnd) {
    throw new DiamondDomainError('half-inning-complete', 'Advance the half inning before adding another play.');
  }
  const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
  if (currentHalfReachedRunLimit(state)) {
    throw new DiamondDomainError(
      'run-limit-decision-required',
      'Record the scorer or umpire run-limit decision before adding another play.'
    );
  }
  if (
    !options.allowPendingTiebreakerPlacement &&
    profile.tiebreaker.enabled &&
    state.inning.number >= profile.tiebreaker.startInning &&
    pristineCurrentHalf(state)
  ) {
    throw new DiamondDomainError(
      'tiebreaker-runner-required',
      'Place the configured previous-batter tiebreaker runner before recording the first play.'
    );
  }
}

function initialCoverage(mode: 'quick' | 'full'): DiamondCoverageMap {
  if (mode === 'full') {
    return {
      batting: 'complete',
      baserunning: 'complete',
      pitching: 'complete',
      fielding: 'complete',
      situational: 'complete',
      pitches: 'complete',
      sensors: 'not_collected'
    };
  }
  return {
    batting: 'complete',
    baserunning: 'complete',
    pitching: 'partial',
    fielding: 'not_collected',
    situational: 'partial',
    pitches: 'not_collected',
    sensors: 'not_collected'
  };
}

export function createInitialDiamondState(config: DiamondLedgerConfig): DiamondGameState {
  requireId(config.teamId, 'teamId');
  requireId(config.gameId, 'gameId');
  requireId(config.rulesProfileId, 'rulesProfileId');
  requireDiamondRulesProfile(config.rulesProfileId, config.rulesProfileVersion);
  if (config.captureMode !== 'quick' && config.captureMode !== 'full') {
    throw new DiamondDomainError('invalid-capture-mode', 'Capture mode must be quick or full.');
  }

  return deepFreeze({
    schemaVersion: DIAMOND_SCHEMA_VERSION,
    reducerVersion: DIAMOND_REDUCER_VERSION,
    statCatalogVersion: DIAMOND_STAT_CATALOG_VERSION,
    teamId: config.teamId,
    gameId: config.gameId,
    rulesProfileId: config.rulesProfileId,
    rulesProfileVersion: config.rulesProfileVersion,
    captureMode: config.captureMode,
    lifecycle: 'configured',
    revision: 0,
    currentScorerUid: null,
    inning: {
      number: 1,
      half: 'top',
      outs: 0,
      balls: 0,
      strikes: 0,
      pitchesInPlateAppearance: 0,
      lastPitchResult: null
    },
    score: { home: 0, away: 0 },
    inningRuns: {},
    bases: { ...EMPTY_BASES },
    lineups: { home: cloneLineup(EMPTY_LINEUP), away: cloneLineup(EMPTY_LINEUP) },
    nextBatterSlot: { home: 0, away: 0 },
    coverage: initialCoverage(config.captureMode),
    suspendedReason: null,
    halfInningEnd: null,
    gameEndDecision: null,
    finalizationReason: null,
    cancellation: null,
    finalConfirmedAtRevision: null,
    checkpointHash: ''
  } satisfies DiamondGameState);
}

function requireLifecycle(state: DiamondGameState, allowed: readonly DiamondGameState['lifecycle'][], action: string) {
  if (!allowed.includes(state.lifecycle)) {
    throw new DiamondDomainError('invalid-lifecycle', `${action} is not allowed while the scorebook is ${state.lifecycle}.`);
  }
}

function markPartial(state: DiamondGameState, families: readonly DiamondStatFamily[] | undefined): DiamondGameState {
  if (!families?.length) return state;
  const coverage = { ...state.coverage };
  families.forEach((family) => {
    if (!(family in coverage)) throw new DiamondDomainError('invalid-stat-family', `Unknown stat family ${family}.`);
    coverage[family] = 'partial';
  });
  return { ...state, coverage };
}

function markPitchObserved(state: DiamondGameState): DiamondGameState {
  if (state.coverage.pitches !== 'not_collected') return state;
  return { ...state, coverage: { ...state.coverage, pitches: 'partial' } };
}

function markFieldingObserved(state: DiamondGameState): DiamondGameState {
  if (state.coverage.fielding !== 'not_collected') return state;
  return { ...state, coverage: { ...state.coverage, fielding: 'partial' } };
}

function withPartialCoverage(coverage: DiamondCoverageMap, families: readonly DiamondStatFamily[] | undefined) {
  const next = { ...coverage };
  families?.forEach((family) => {
    next[family] = 'partial';
  });
  return next;
}

function fieldingChainsForPlay(
  event: DiamondEffectiveEvent,
  attached: ReadonlyMap<string, readonly DiamondFieldingChain[]>,
  inline?: DiamondFieldingChain
) {
  return [
    ...(inline ? [inline] : []),
    ...(attached.get(event.sourceEventId) ?? []),
    ...(event.eventId === event.sourceEventId ? [] : (attached.get(event.eventId) ?? []))
  ];
}

export function validateDiamondMergedFieldingOutCredit(fieldings: readonly DiamondFieldingChain[], actualOutCount: number): void {
  const putoutPlayers = new Set(fieldings.flatMap((fielding) => (fielding.putoutBy ? [fielding.putoutBy] : [])));
  if (putoutPlayers.size > actualOutCount) {
    throw new DiamondDomainError(
      'fielding-outs-mismatch',
      `Putout fielding evidence names ${String(putoutPlayers.size)} fielders for ${String(actualOutCount)} actual outs.`
    );
  }
}

export function deriveDiamondPutoutCredits(
  fieldings: readonly DiamondFieldingChain[],
  actualOutCount: number
): ReadonlyMap<string, number> {
  validateDiamondMergedFieldingOutCredit(fieldings, actualOutCount);
  const putoutPlayers = new Set(fieldings.flatMap((fielding) => (fielding.putoutBy ? [fielding.putoutBy] : [])));
  const assistPlayers = new Set(fieldings.flatMap((fielding) => fielding.assists ?? []));
  const credits = new Map<string, number>(Array.from(putoutPlayers, (playerId) => [playerId, 1] as const));
  if (actualOutCount > 1 && putoutPlayers.size === 1 && assistPlayers.size === 0) {
    credits.set(putoutPlayers.values().next().value!, actualOutCount);
  }
  return credits;
}

function hasCompletePutoutEvidence(fieldings: readonly DiamondFieldingChain[], actualOutCount: number) {
  const creditedOuts = Array.from(deriveDiamondPutoutCredits(fieldings, actualOutCount).values()).reduce(
    (total, count) => total + count,
    0
  );
  return creditedOuts === actualOutCount;
}

function judgmentsForPlay(
  event: DiamondEffectiveEvent,
  attached: ReadonlyMap<string, readonly DiamondCommandPayloadMap['record_scoring_judgment'][]>
) {
  return [
    ...(attached.get(event.sourceEventId) ?? []),
    ...(event.eventId === event.sourceEventId ? [] : (attached.get(event.eventId) ?? []))
  ];
}

function latestRunnerJudgmentBoolean(
  judgments: readonly DiamondCommandPayloadMap['record_scoring_judgment'][],
  runnerId: string,
  field: 'earned' | 'rbi'
) {
  for (let index = judgments.length - 1; index >= 0; index -= 1) {
    const judgment = judgments[index];
    if ((!judgment.runnerId || judgment.runnerId === runnerId) && typeof judgment[field] === 'boolean') {
      return judgment[field];
    }
  }
  return undefined;
}

export type DiamondAggregateRbiInference = Readonly<{
  explicitTrueCount: number;
  unattributedCount: number;
  unattributedValue: boolean | undefined;
}>;

export function deriveDiamondAggregateRbiInference(
  scoringAdvances: readonly Readonly<{ rbi?: boolean }>[],
  runsBattedIn: number
): DiamondAggregateRbiInference {
  const explicitTrueCount = scoringAdvances.filter((advance) => advance.rbi === true).length;
  const unattributedCount = scoringAdvances.filter((advance) => advance.rbi === undefined).length;
  const residual = runsBattedIn - explicitTrueCount;
  const unattributedValue =
    unattributedCount > 0 && residual === 0 ? false : unattributedCount > 0 && residual === unattributedCount ? true : undefined;
  return { explicitTrueCount, unattributedCount, unattributedValue };
}

/**
 * Coverage is evidence-derived from the effective ledger, so a later attachment
 * can resolve one omitted judgment and voiding that attachment revokes it again.
 */
export type DiamondCoverageEventState = Readonly<{
  event: DiamondEffectiveEvent;
  before: DiamondGameState;
  after: DiamondGameState;
}>;

export function deriveDiamondCoverageFromEventStates(
  initialState: DiamondGameState,
  eventStates: readonly DiamondCoverageEventState[]
): DiamondCoverageMap {
  let coverage: DiamondCoverageMap = { ...initialState.coverage };
  const fieldingByPlay = new Map<string, DiamondFieldingChain[]>();
  const judgmentsByPlay = new Map<string, DiamondCommandPayloadMap['record_scoring_judgment'][]>();

  eventStates.forEach(({ event }) => {
    if (event.type === 'record_fielding') {
      const payload = event.payload as DiamondCommandPayloadMap['record_fielding'];
      fieldingByPlay.set(payload.playEventId, [...(fieldingByPlay.get(payload.playEventId) ?? []), payload.fielding]);
    }
    if (event.type === 'record_scoring_judgment') {
      const payload = event.payload as DiamondCommandPayloadMap['record_scoring_judgment'];
      judgmentsByPlay.set(payload.playEventId, [...(judgmentsByPlay.get(payload.playEventId) ?? []), payload]);
    }
  });

  eventStates.forEach(({ event, before }) => {
    if (event.type === 'record_pitch' && isDiamondDeliveredPitch((event.payload as DiamondCommandPayloadMap['record_pitch']).result)) {
      if (coverage.pitches === 'not_collected') coverage = { ...coverage, pitches: 'partial' };
    }
    if (event.type === 'record_fielding' && coverage.fielding === 'not_collected') {
      coverage = { ...coverage, fielding: 'partial' };
    }
    if (event.type === 'rules_decision') {
      coverage = withPartialCoverage(coverage, (event.payload as DiamondCommandPayloadMap['rules_decision']).affectedFamilies);
    }
    if (event.type === 'record_plate_appearance') {
      const payload = event.payload as DiamondCommandPayloadMap['record_plate_appearance'];
      coverage = withPartialCoverage(coverage, payload.omissions);
      if (payload.fielding && coverage.fielding === 'not_collected') coverage = { ...coverage, fielding: 'partial' };
      const fieldingChains = fieldingChainsForPlay(event, fieldingByPlay, payload.fielding);
      validateDiamondMergedFieldingOutCredit(fieldingChains, payload.outsOnPlay);
      const judgments = judgmentsForPlay(event, judgmentsByPlay);
      const scoringAdvances = [{ runnerId: payload.batterId, ...payload.batterAdvance }, ...payload.runnerAdvances].filter(
        (advance) => advance.to === 'home' && advance.countsRun !== false
      );
      if (
        scoringAdvances.some((advance) => {
          const judgment = latestRunnerJudgmentBoolean(judgments, advance.runnerId, 'earned');
          return typeof (judgment ?? advance.earned) !== 'boolean';
        })
      ) {
        coverage = { ...coverage, pitching: 'partial' };
      }
      if (
        payload.runsBattedIn === undefined &&
        scoringAdvances.some((advance) => {
          const judgment = latestRunnerJudgmentBoolean(judgments, advance.runnerId, 'rbi');
          return typeof (judgment ?? advance.rbi) !== 'boolean';
        })
      ) {
        coverage = { ...coverage, batting: 'partial' };
      }
      if (initialState.captureMode === 'full' && !hasCompletePitchOutcomeEvidence(before, payload.result)) {
        coverage = { ...coverage, pitches: 'partial' };
      }
      if (initialState.captureMode === 'full') {
        if (payload.outsOnPlay > 0 && !hasCompletePutoutEvidence(fieldingChains, payload.outsOnPlay)) {
          coverage = { ...coverage, fielding: 'partial' };
        }
        if (payload.result === 'reached_on_error' && !fieldingChains.some((chain) => Boolean(chain.errors?.length))) {
          coverage = { ...coverage, fielding: 'partial' };
        }
      }
    }
    if (event.type === 'advance_runner') {
      const payload = event.payload as DiamondCommandPayloadMap['advance_runner'];
      coverage = withPartialCoverage(coverage, payload.omissions);
      if (payload.fielding && coverage.fielding === 'not_collected') coverage = { ...coverage, fielding: 'partial' };
      const fieldingChains = fieldingChainsForPlay(event, fieldingByPlay, payload.fielding);
      validateDiamondMergedFieldingOutCredit(fieldingChains, payload.to === 'out' ? 1 : 0);
      if (payload.to === 'home' && payload.countsRun !== false) {
        const judgment = latestRunnerJudgmentBoolean(judgmentsForPlay(event, judgmentsByPlay), payload.runnerId, 'earned');
        if (typeof (judgment ?? payload.earned) !== 'boolean') coverage = { ...coverage, pitching: 'partial' };
      }
      if (initialState.captureMode === 'full' && payload.to === 'out') {
        if (!hasCompletePutoutEvidence(fieldingChains, 1)) coverage = { ...coverage, fielding: 'partial' };
      }
    }
  });
  return deepFreeze(coverage);
}

export function deriveDiamondCoverageFromEvents(
  initialState: DiamondGameState,
  events: readonly DiamondEffectiveEvent[]
): DiamondCoverageMap {
  let state = cloneState(initialState);
  const eventStates = events.map((event): DiamondCoverageEventState => {
    const before = state;
    state = reduceDiamondEvent(state, { type: event.type, payload: event.payload, eventId: event.eventId } as DiamondReducerAction);
    state = setDiamondStateRevision(state, event.revision);
    return { event, before, after: state };
  });
  return deriveDiamondCoverageFromEventStates(initialState, eventStates);
}

function expectedBatter(state: DiamondGameState, side = getBattingSide(state)): DiamondLineupSlot {
  const order = state.lineups[side].battingOrder;
  if (!order.length) throw new DiamondDomainError('missing-lineup', `${side} batting lineup is empty.`);
  return order[state.nextBatterSlot[side] % order.length];
}

function validateBatterAndPitcher(state: DiamondGameState, batterId: string, pitcherId: string): DiamondSide {
  const side = getBattingSide(state);
  const batter = requireId(batterId, 'batterId');
  const pitcher = requireId(pitcherId, 'pitcherId');
  if (expectedBatter(state, side).activePlayerId !== batter) {
    throw new DiamondDomainError('unexpected-batter', `${batter} is not the current batter.`);
  }
  const defensivePitcher = state.lineups[oppositeSide(side)].defense.P;
  if (!defensivePitcher) {
    throw new DiamondDomainError('missing-defensive-pitcher', 'Set the defensive pitcher before recording a pitch or plate appearance.');
  }
  if (defensivePitcher !== pitcher) {
    throw new DiamondDomainError('unexpected-pitcher', `${pitcher} is not the current defensive pitcher.`);
  }
  return side;
}

function validateFieldingIds(value: unknown) {
  const fielding = requireRecord(value, 'fielding');
  requireOnlyFields(fielding, FIELDING_FIELDS, 'fielding');
  if (fielding.putoutBy !== undefined) requireId(fielding.putoutBy, 'putoutBy');
  if (fielding.passedBallBy !== undefined) requireId(fielding.passedBallBy, 'passedBallBy');
  requireOptionalBoolean(fielding.doublePlay, 'fielding.doublePlay');
  requireOptionalBoolean(fielding.triplePlay, 'fielding.triplePlay');
  if (fielding.doublePlay === true && fielding.triplePlay === true) {
    throw new DiamondDomainError('invalid-fielding-chain', 'A fielding chain cannot be both a double play and a triple play.');
  }
  if (fielding.battedBall !== undefined) {
    requireMember(fielding.battedBall, ['ground', 'line', 'fly', 'bunt', 'unknown'], 'batted ball');
  }
  if (fielding.assists !== undefined && !Array.isArray(fielding.assists)) {
    throw new DiamondDomainError('invalid-fielding-chain', 'Fielding assists must be an array.');
  }
  const assists = fielding.assists ?? [];
  if (assists.length > 4) throw new DiamondDomainError('invalid-fielding-chain', 'At most four assists may be recorded.');
  const assistIds = assists.map((id) => requireId(id, 'assist playerId'));
  if (new Set(assistIds).size !== assistIds.length) {
    throw new DiamondDomainError('invalid-fielding-chain', 'A fielder cannot receive duplicate assists on one play.');
  }
  if (fielding.errors !== undefined && !Array.isArray(fielding.errors)) {
    throw new DiamondDomainError('invalid-fielding-chain', 'Fielding errors must be an array.');
  }
  const errors = fielding.errors ?? [];
  if (errors.length > 4) throw new DiamondDomainError('invalid-fielding-chain', 'At most four errors may be recorded.');
  errors.forEach((value, index) => {
    const error = requireRecord(value, `fielding.errors[${String(index)}]`);
    requireOnlyFields(error, new Set(['playerId', 'kind']), `fielding.errors[${String(index)}]`);
    requireId(error.playerId, 'error playerId');
    if (error.kind !== undefined) requireMember(error.kind, ['fielding', 'throwing'], 'error kind');
  });
  if (fielding.location !== undefined && (typeof fielding.location !== 'string' || fielding.location.length > 80)) {
    throw new DiamondDomainError('invalid-fielding-chain', 'Batted-ball location must be a string of at most 80 characters.');
  }
}

export function validateDiamondFieldingOutCredit(fielding: DiamondFieldingChain | undefined, actualOutCount: number) {
  if (!fielding) return;
  if (fielding.doublePlay === true && actualOutCount !== 2) {
    throw new DiamondDomainError(
      'fielding-outs-mismatch',
      `Double-play fielding credit requires exactly two actual outs; this play records ${String(actualOutCount)}.`
    );
  }
  if (fielding.triplePlay === true && actualOutCount !== 3) {
    throw new DiamondDomainError(
      'fielding-outs-mismatch',
      `Triple-play fielding credit requires exactly three actual outs; this play records ${String(actualOutCount)}.`
    );
  }
}

function knownPlayerIds(lineup: DiamondTeamLineup) {
  return new Set([
    ...lineup.battingOrder.flatMap((entry) => [entry.activePlayerId, entry.starterPlayerId, ...entry.substitutions]),
    ...Object.values(lineup.defense).filter((playerId): playerId is string => Boolean(playerId)),
    ...(lineup.dpFlex ? [lineup.dpFlex.dpPlayerId, lineup.dpFlex.flexPlayerId] : [])
  ]);
}

function currentBattingParticipantIds(state: DiamondGameState) {
  const battingIds = knownPlayerIds(state.lineups[getBattingSide(state)]);
  BASES.forEach((base) => {
    const placement = state.bases[base];
    if (!placement) return;
    battingIds.add(placement.runnerId);
    if (placement.courtesyForPlayerId) battingIds.add(placement.courtesyForPlayerId);
  });
  return battingIds;
}

function validateInlineFieldingParticipants(state: DiamondGameState, value: DiamondFieldingChain) {
  const fieldingSide = oppositeSide(getBattingSide(state));
  const defense = state.lineups[fieldingSide].defense;
  const activeDefenders = new Set(Object.values(defense).filter((playerId): playerId is string => Boolean(playerId)));
  const battingParticipants = currentBattingParticipantIds(state);
  const creditedIds = [
    value.putoutBy,
    ...(value.assists ?? []),
    ...(value.errors ?? []).map((error) => error.playerId),
    value.passedBallBy
  ].filter((playerId): playerId is string => Boolean(playerId));
  if (creditedIds.some((playerId) => !activeDefenders.has(playerId) || battingParticipants.has(playerId))) {
    throw new DiamondDomainError(
      'invalid-fielding-participant',
      'Inline fielding credit must identify an unambiguous player in the active defense for this play.'
    );
  }
  if (value.passedBallBy !== undefined && defense.C !== value.passedBallBy) {
    throw new DiamondDomainError('invalid-fielding-participant', 'A passed ball must be charged to the active defensive catcher.');
  }
}

function validateInlineResponsiblePitcher(
  state: DiamondGameState,
  suppliedPitcherId: string | undefined,
  expectedPitcherId: string | null,
  label: string
) {
  if (suppliedPitcherId === undefined) return;
  if (!expectedPitcherId) {
    throw new DiamondDomainError(
      'pitcher-responsibility-unavailable',
      `${label} cannot assign pitcher responsibility when the runner's canonical responsibility was not collected. Add a scoring judgment instead.`
    );
  }
  if (suppliedPitcherId !== expectedPitcherId) {
    throw new DiamondDomainError(
      'unexpected-responsible-pitcher',
      `${label} must retain the runner's canonical responsible pitcher (${expectedPitcherId}).`
    );
  }
  if (currentBattingParticipantIds(state).has(suppliedPitcherId)) {
    throw new DiamondDomainError(
      'responsible-pitcher-role-mismatch',
      `${label} must identify a pitcher unambiguously recorded for the defensive team.`
    );
  }
}

function validateOutcomeDestination(
  state: DiamondGameState,
  result: DiamondCommandPayloadMap['record_plate_appearance']['result'],
  destination: DiamondDestination
) {
  requireMember(result, PLATE_APPEARANCE_RESULTS, 'plate appearance result');
  requireMember(destination, DESTINATIONS, 'batter destination');
  const exactDestinations: Partial<Record<typeof result, DiamondDestination>> = {
    single: 'first',
    double: 'second',
    triple: 'third',
    home_run: 'home',
    walk: 'first',
    intentional_walk: 'first',
    hit_by_pitch: 'first',
    ground_out: 'out',
    fly_out: 'out',
    line_out: 'out',
    sacrifice_bunt: 'out',
    sacrifice_fly: 'out',
    double_play: 'out',
    triple_play: 'out'
  };
  const expected = exactDestinations[result];
  if (expected && destination !== expected) {
    throw new DiamondDomainError('invalid-batter-destination', `${result} requires batter destination ${expected}.`);
  }
  if (result === 'strikeout' && !['out', 'first'].includes(destination)) {
    throw new DiamondDomainError('invalid-batter-destination', 'A strikeout batter must be out or reach first.');
  }
  // An ordinary strikeout may encode a dropped-third reach to first. The named
  // result also supports a later-base destination when the same play includes
  // an error, but both use the pre-play eligibility snapshot here.
  const advancesOnDroppedThirdStrike =
    (result === 'strikeout' && destination === 'first') || (result === 'dropped_third_strike' && destination !== 'out');
  if (advancesOnDroppedThirdStrike) {
    const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
    if (!profile.droppedThirdStrike.enabled) {
      throw new DiamondDomainError('rule-not-enabled', 'Dropped-third-strike advancement is disabled by this profile.');
    }
    if (profile.droppedThirdStrike.disallowWhenFirstOccupiedWithFewerThanTwoOuts && state.bases.first && state.inning.outs < 2) {
      throw new DiamondDomainError(
        'dropped-third-strike-ineligible',
        'The batter cannot advance on a dropped third strike with first occupied and fewer than two outs.'
      );
    }
  }
}

function resolveBatterOutKind(
  result: DiamondCommandPayloadMap['record_plate_appearance']['result'],
  destination: DiamondDestination,
  supplied: DiamondCommandPayloadMap['record_plate_appearance']['batterAdvance']['outKind']
) {
  if (destination !== 'out') {
    if (supplied) throw new DiamondDomainError('invalid-out-kind', 'Only an out destination may include an out kind.');
    return undefined;
  }
  if (supplied) return requireMember(supplied, OUT_KINDS, 'batter out kind');
  if (result === 'strikeout' || result === 'dropped_third_strike') return 'strikeout' as const;
  if (result === 'fly_out' || result === 'line_out' || result === 'sacrifice_fly') return 'catch' as const;
  if (result === 'ground_out' || result === 'sacrifice_bunt' || result === 'double_play' || result === 'triple_play') {
    return 'batter_runner' as const;
  }
  throw new DiamondDomainError('missing-out-kind', 'An out batter destination requires an out kind.');
}

type Move = Readonly<{
  runnerId: string;
  from: DiamondBase | 'batter';
  to: DiamondDestination;
  countsRun?: boolean;
  chargedToPitcherId: string | null;
  courtesyForPlayerId: string | null;
  outKind?: DiamondCommandPayloadMap['advance_runner']['outKind'];
}>;

function validateFinalRunnerOrder(state: DiamondGameState, moves: readonly Move[]) {
  const moveBySource = new Map(moves.map((move) => [move.from, move]));
  const survivingRunners: Array<Readonly<{ originRank: number; destinationRank: number }>> = [];
  const addSurvivor = (from: DiamondBase | 'batter', originRank: number) => {
    const move = moveBySource.get(from);
    const destination = move?.to ?? from;
    if (destination === 'out') return;
    const resolvedDestination = destination === 'stay' ? from : destination;
    const destinationRank = resolvedDestination === 'home' ? BASES.length + 1 : BASES.indexOf(resolvedDestination as DiamondBase) + 1;
    survivingRunners.push({ originRank, destinationRank });
  };

  if (moveBySource.has('batter')) addSurvivor('batter', 0);
  BASES.forEach((base, index) => {
    if (state.bases[base]) addSurvivor(base, index + 1);
  });
  survivingRunners.sort((left, right) => left.originRank - right.originRank);
  for (let trailingIndex = 0; trailingIndex < survivingRunners.length; trailingIndex += 1) {
    for (let precedingIndex = trailingIndex + 1; precedingIndex < survivingRunners.length; precedingIndex += 1) {
      if (survivingRunners[trailingIndex]!.destinationRank > survivingRunners[precedingIndex]!.destinationRank) {
        throw new DiamondDomainError(
          'runner-order-violation',
          'A trailing runner cannot pass a preceding runner; mark the appropriate runner out.'
        );
      }
    }
  }
}

function validateCompleteExtraBaseHitRunnerResolution(
  state: DiamondGameState,
  result: DiamondCommandPayloadMap['record_plate_appearance']['result'],
  runnerMoves: readonly Move[]
) {
  if (result !== 'triple' && result !== 'home_run') return;
  BASES.forEach((base) => {
    const placement = state.bases[base];
    if (!placement) return;
    const matchingMoves = runnerMoves.filter((move) => move.from === base);
    if (matchingMoves.length === 0) {
      throw new DiamondDomainError('incomplete-hit-runner-resolution', `${result} must explicitly resolve the runner occupying ${base}.`);
    }
    if (matchingMoves.length > 1) {
      throw new DiamondDomainError('duplicate-runner-source', 'Each runner source may appear only once per play.');
    }
    if (matchingMoves[0].runnerId !== placement.runnerId) {
      throw new DiamondDomainError('runner-not-on-base', `${matchingMoves[0].runnerId} is not on ${base}.`);
    }
    if (matchingMoves[0].to !== 'home' && matchingMoves[0].to !== 'out') {
      throw new DiamondDomainError('invalid-hit-runner-destination', `${result} must resolve every occupied runner to home or out.`);
    }
  });
}

function validateSacrificeEvidence(
  state: DiamondGameState,
  result: DiamondCommandPayloadMap['record_plate_appearance']['result'],
  runnerMoves: readonly Move[]
) {
  if (result !== 'sacrifice_bunt' && result !== 'sacrifice_fly') return;
  if (state.inning.outs >= 2) {
    throw new DiamondDomainError('sacrifice-with-two-outs', 'A sacrifice cannot be recorded with two outs before the play.');
  }
  const matchingLiveRunnerMoves = runnerMoves.filter(
    (move) => move.from !== 'batter' && state.bases[move.from]?.runnerId === move.runnerId
  );
  if (result === 'sacrifice_fly') {
    if (!matchingLiveRunnerMoves.some((move) => move.to === 'home' && move.countsRun !== false)) {
      throw new DiamondDomainError('sacrifice-evidence-missing', 'A sacrifice fly requires a runner whose run scores on the play.');
    }
    return;
  }
  if (
    !matchingLiveRunnerMoves.some(
      (move) =>
        (move.to === 'home' && move.countsRun !== false) ||
        (BASES.includes(move.to as DiamondBase) && BASES.indexOf(move.to as DiamondBase) > BASES.indexOf(move.from as DiamondBase))
    )
  ) {
    throw new DiamondDomainError('sacrifice-evidence-missing', 'A sacrifice bunt requires an existing runner to advance safely.');
  }
}

function validateNamedMultiOutResult(
  state: DiamondGameState,
  result: DiamondCommandPayloadMap['record_plate_appearance']['result'],
  moves: readonly Move[],
  outsOnPlay: number
) {
  const requiredOuts = result === 'double_play' ? 2 : result === 'triple_play' ? 3 : null;
  if (requiredOuts === null) return;
  requireInteger(outsOnPlay, 'outsOnPlay', 0, 3);
  const actualOuts = moves.filter((move) => move.to === 'out').length;
  if (outsOnPlay !== requiredOuts || actualOuts !== requiredOuts) {
    throw new DiamondDomainError('result-outs-mismatch', `${result} requires exactly ${String(requiredOuts)} actual outs.`);
  }
  if (state.inning.outs + requiredOuts > 3) {
    throw new DiamondDomainError('result-outs-exceed-inning', `${result} cannot record more outs than remain in the inning.`);
  }
}

function applyMoves(
  state: DiamondGameState,
  side: DiamondSide,
  moves: readonly Move[],
  outsOnPlay: number,
  reachedOnEventId: string | null
): DiamondGameState {
  requireInteger(outsOnPlay, 'outsOnPlay', 0, 3);
  if (state.inning.outs + outsOnPlay > 3) {
    throw new DiamondDomainError('too-many-outs', 'A play cannot produce more than three total outs.');
  }
  const sources = moves.map((move) => move.from);
  if (new Set(sources).size !== sources.length) {
    throw new DiamondDomainError('duplicate-runner-source', 'Each runner source may appear only once per play.');
  }
  const runnerIds = moves.map((move) => requireId(move.runnerId, 'runnerId'));
  if (new Set(runnerIds).size !== runnerIds.length) {
    throw new DiamondDomainError('duplicate-runner', 'Each runner may move only once per play.');
  }
  const recordedOuts = moves.filter((move) => move.to === 'out').length;
  if (recordedOuts !== outsOnPlay) {
    throw new DiamondDomainError(
      'outs-mismatch',
      `outsOnPlay (${String(outsOnPlay)}) must match runner and batter outs (${String(recordedOuts)}).`
    );
  }

  const bases: Record<DiamondBase, DiamondRunnerPlacement | null> = {
    first: state.bases.first ? { ...state.bases.first } : null,
    second: state.bases.second ? { ...state.bases.second } : null,
    third: state.bases.third ? { ...state.bases.third } : null
  };
  moves.forEach((move) => {
    if (move.from === 'batter') return;
    const placement = bases[move.from];
    if (!placement || placement.runnerId !== move.runnerId) {
      throw new DiamondDomainError('runner-not-on-base', `${move.runnerId} is not on ${move.from}.`);
    }
    bases[move.from] = null;
  });

  const playEndsHalf = state.inning.outs + outsOnPlay === 3;
  const possibleThirdOuts = moves.filter((move) => move.to === 'out');
  // A non-counting home advance is meaningful only when this play records the
  // third out. Move arrays have stable serialization but no chronological
  // meaning, so keep countsRun as the scorer's explicit timing judgment and
  // reject a counted run only when every possible third out necessarily cancels
  // it. Auditing the exact third out would require a future versioned payload
  // field, never array order.
  const thirdOutCancelsRuns =
    playEndsHalf &&
    possibleThirdOuts.length > 0 &&
    possibleThirdOuts.every((move) => move.from === 'batter' || move.outKind === 'force' || move.outKind === 'batter_runner');
  let runs = 0;
  moves.forEach((move) => {
    if (move.to === 'out') return;
    if (move.to === 'home') {
      if (!playEndsHalf && move.countsRun === false) {
        throw new DiamondDomainError(
          'run-nullification-requires-third-out',
          'A run may be marked not counting only on a play that records the third out.'
        );
      }
      if (playEndsHalf && move.countsRun === undefined) {
        throw new DiamondDomainError(
          'run-timing-required',
          'Every potential run on a third-out play must explicitly declare whether it counts.'
        );
      }
      if (thirdOutCancelsRuns && move.countsRun !== false) {
        throw new DiamondDomainError(
          'run-cannot-count',
          'A run cannot count when every possible third out is a force out or retires the batter before first.'
        );
      }
      if (move.countsRun !== false) runs += 1;
      return;
    }
    const destination = move.to === 'stay' ? move.from : move.to;
    if (destination === 'batter') {
      throw new DiamondDomainError('invalid-runner-destination', 'A batter cannot remain at the batter source.');
    }
    if (bases[destination]) {
      throw new DiamondDomainError('occupied-base', `${destination} would contain two runners.`);
    }
    bases[destination] = {
      runnerId: move.runnerId,
      chargedToPitcherId: move.chargedToPitcherId,
      courtesyForPlayerId: move.courtesyForPlayerId,
      reachedOnEventId
    };
  });
  validateFinalRunnerOrder(state, moves);

  const inningKey = getInningKey(state);
  return {
    ...state,
    inning: { ...state.inning, outs: state.inning.outs + outsOnPlay },
    bases,
    score: { ...state.score, [side]: state.score[side] + runs },
    inningRuns: { ...state.inningRuns, [inningKey]: (state.inningRuns[inningKey] ?? 0) + runs }
  };
}

function replaceDefensePlayer(
  defense: DiamondTeamLineup['defense'],
  outgoingPlayerId: string,
  incomingPlayerId: string,
  requestedPosition?: DiamondDefensivePosition
) {
  const next = { ...defense };
  const currentPosition = Object.entries(next).find(([, playerId]) => playerId === outgoingPlayerId)?.[0] as
    DiamondDefensivePosition | undefined;
  if (currentPosition) delete next[currentPosition];
  if (requestedPosition) {
    const occupant = next[requestedPosition];
    if (occupant && occupant !== outgoingPlayerId) {
      throw new DiamondDomainError('occupied-position', `${requestedPosition} is already occupied.`);
    }
    next[requestedPosition] = incomingPlayerId;
  } else if (currentPosition) {
    next[currentPosition] = incomingPlayerId;
  }
  return next;
}

function transferLiveSubstitutedRunner(
  state: DiamondGameState,
  side: DiamondSide,
  outgoingPlayerId: string,
  incomingPlayerId: string
): DiamondGameState['bases'] {
  const liveBattingHalf =
    side === getBattingSide(state) && state.inning.outs < 3 && state.halfInningEnd === null && getDiamondFinalizationReason(state) === null;
  if (!liveBattingHalf) return state.bases;

  const incomingBase = BASES.find((base) => state.bases[base]?.runnerId === incomingPlayerId);
  if (incomingBase) {
    throw new DiamondDomainError('incoming-runner-on-base', 'The incoming substitute is already occupying a base.');
  }
  const outgoingBase = BASES.find((base) => state.bases[base]?.runnerId === outgoingPlayerId);
  if (!outgoingBase) return state.bases;
  const placement = state.bases[outgoingBase]!;
  return {
    ...state.bases,
    [outgoingBase]: { ...placement, runnerId: incomingPlayerId }
  };
}

function reduceSubstitution(
  state: DiamondGameState,
  payload: DiamondCommandPayloadMap['substitute'] | DiamondCommandPayloadMap['re_enter'],
  reentry: boolean
): DiamondGameState {
  requireLifecycle(state, ['active'], reentry ? 're-enter' : 'substitute');
  requireNoGameEndingCondition(state, reentry ? 're-entering a starter' : 'making a substitution');
  const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
  const side = requireSide(payload.side);
  if (payload.defensivePosition) requireMember(payload.defensivePosition, FIELDING_POSITIONS, 'defensive position');
  const order = state.lineups[side].battingOrder.map((entry) => ({ ...entry, substitutions: [...entry.substitutions] }));
  const index = order.findIndex((entry) => entry.slot === payload.battingSlot);
  if (index < 0) throw new DiamondDomainError('unknown-lineup-slot', 'The batting slot does not exist.');
  const slot = order[index];
  const outgoingPlayerId = reentry
    ? (payload as DiamondCommandPayloadMap['re_enter']).replacedPlayerId
    : (payload as DiamondCommandPayloadMap['substitute']).outgoingPlayerId;
  const incomingPlayerId = reentry
    ? (payload as DiamondCommandPayloadMap['re_enter']).starterPlayerId
    : (payload as DiamondCommandPayloadMap['substitute']).incomingPlayerId;
  requireId(outgoingPlayerId, 'outgoingPlayerId');
  requireId(incomingPlayerId, 'incomingPlayerId');
  if (outgoingPlayerId === incomingPlayerId) {
    throw new DiamondDomainError('substitution-no-op', 'The incoming and outgoing players must be different.');
  }
  if (slot.activePlayerId !== outgoingPlayerId) {
    throw new DiamondDomainError('substitution-mismatch', 'The outgoing player is not active in that batting slot.');
  }
  if (order.some((entry, entryIndex) => entryIndex !== index && entry.activePlayerId === incomingPlayerId)) {
    throw new DiamondDomainError('duplicate-active-player', 'The incoming player is already active in the batting order.');
  }
  const lineup = state.lineups[side];
  const dpFlex = lineup.dpFlex;
  if (dpFlex) {
    const pair = new Set([dpFlex.dpPlayerId, dpFlex.flexPlayerId]);
    const touchesPair = pair.has(outgoingPlayerId) || pair.has(incomingPlayerId);
    if (touchesPair) {
      if (
        slot.slot !== dpFlex.dpBattingSlot ||
        !pair.has(outgoingPlayerId) ||
        !pair.has(incomingPlayerId) ||
        outgoingPlayerId === incomingPlayerId
      ) {
        throw new DiamondDomainError(
          'unsupported-dp-flex-substitution',
          'This reducer supports only a direct DP/FLEX exchange in their linked batting slot.'
        );
      }
      if (incomingPlayerId === dpFlex.flexPlayerId && !profile.dpFlex.flexMayBatForDpOnly) {
        throw new DiamondDomainError('rule-not-enabled', 'This rules profile does not allow the FLEX to bat for the DP.');
      }
      if (payload.defensivePosition && payload.defensivePosition !== dpFlex.flexDefensivePosition) {
        throw new DiamondDomainError('invalid-dp-flex', 'A DP/FLEX exchange may use only the configured FLEX defensive position.');
      }
    }
  }
  if (reentry) {
    if (slot.starterPlayerId !== incomingPlayerId) {
      throw new DiamondDomainError('invalid-reentry', 'Only the starter assigned to this slot may re-enter.');
    }
    if (!profile.freeSubstitution && slot.starterReentriesUsed >= profile.starterReentryLimit) {
      throw new DiamondDomainError('reentry-limit', 'The rules profile does not permit another starter re-entry.');
    }
  }
  order[index] = {
    ...slot,
    activePlayerId: incomingPlayerId,
    battingRole:
      dpFlex && slot.slot === dpFlex.dpBattingSlot && incomingPlayerId === dpFlex.flexPlayerId
        ? 'flex'
        : dpFlex && slot.slot === dpFlex.dpBattingSlot && incomingPlayerId === dpFlex.dpPlayerId
          ? 'dp'
          : slot.battingRole,
    starterReentriesUsed: slot.starterReentriesUsed + (reentry ? 1 : 0),
    substitutions: [...slot.substitutions, incomingPlayerId]
  };
  const bases = transferLiveSubstitutedRunner(state, side, outgoingPlayerId, incomingPlayerId);
  const defense = replaceDefensePlayer(lineup.defense, outgoingPlayerId, incomingPlayerId, payload.defensivePosition);
  if (!defense.P) {
    throw new DiamondDomainError('missing-defensive-pitcher', 'An active substitution must leave the defensive pitcher position occupied.');
  }
  return {
    ...state,
    bases,
    lineups: {
      ...state.lineups,
      [side]: {
        ...lineup,
        battingOrder: order,
        defense
      }
    }
  };
}

export function validateDiamondState(state: DiamondGameState): DiamondGameState {
  if (
    state.schemaVersion !== DIAMOND_SCHEMA_VERSION ||
    state.reducerVersion !== DIAMOND_REDUCER_VERSION ||
    state.statCatalogVersion !== DIAMOND_STAT_CATALOG_VERSION
  ) {
    throw new DiamondDomainError('state-version-mismatch', 'Diamond state versions are not supported.');
  }
  requireMember(state.lifecycle, LIFECYCLES, 'state lifecycle');
  requireMember(state.captureMode, ['quick', 'full'], 'state capture mode');
  requireId(state.teamId, 'state.teamId');
  requireId(state.gameId, 'state.gameId');
  const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
  requireInteger(state.revision, 'state.revision', 0, Number.MAX_SAFE_INTEGER);
  requireInteger(state.inning.number, 'inning number', 1, 999);
  requireInteger(state.inning.outs, 'outs', 0, 3);
  requireInteger(state.inning.balls, 'balls', 0, 4);
  requireInteger(state.inning.strikes, 'strikes', 0, 3);
  requireInteger(state.inning.pitchesInPlateAppearance, 'pitches in plate appearance', 0, Number.MAX_SAFE_INTEGER);
  if (state.inning.lastPitchResult !== null) {
    requireMember(state.inning.lastPitchResult, PITCH_RESULTS.filter(isDiamondDeliveredPitch), 'last delivered pitch result');
  }
  requireInteger(state.score.home, 'home score', 0, Number.MAX_SAFE_INTEGER);
  requireInteger(state.score.away, 'away score', 0, Number.MAX_SAFE_INTEGER);
  const baseRunners = BASES.flatMap((base) => (state.bases[base] ? [state.bases[base]!.runnerId] : []));
  if (new Set(baseRunners).size !== baseRunners.length) {
    throw new DiamondDomainError('duplicate-base-runner', 'One runner cannot occupy multiple bases.');
  }
  (['home', 'away'] as const).forEach((side) => {
    const order = state.lineups[side].battingOrder;
    const slots = order.map((entry) => entry.slot);
    const players = order.map((entry) => entry.activePlayerId);
    if (new Set(slots).size !== slots.length || new Set(players).size !== players.length) {
      throw new DiamondDomainError('invalid-lineup', `${side} lineup contains duplicate slots or active players.`);
    }
    order.forEach((entry) => {
      requireInteger(entry.slot, 'batting slot', 1, 25);
      requireId(entry.activePlayerId, 'activePlayerId');
      requireId(entry.starterPlayerId, 'starterPlayerId');
      requireBattingRole(profile, entry.battingRole);
    });
    validateBattingRoleCounts(order);
    const defensivePlayers = Object.entries(state.lineups[side].defense).map(([position, playerId]) => {
      requireMember(position, FIELDING_POSITIONS, 'defensive position');
      return requireId(playerId, 'defensive playerId');
    });
    if (new Set(defensivePlayers).size !== defensivePlayers.length) {
      throw new DiamondDomainError('invalid-defense', `${side} defense contains a duplicate player.`);
    }
    const dpFlex = state.lineups[side].dpFlex;
    if (!dpFlex) {
      if (order.some((entry) => entry.battingRole === 'flex')) {
        throw new DiamondDomainError('invalid-dp-flex', 'A FLEX batter requires an established DP/FLEX pairing.');
      }
      if (state.lifecycle !== 'configured' && state.lifecycle !== 'ready' && order.some((entry) => entry.battingRole === 'dp')) {
        throw new DiamondDomainError('invalid-dp-flex', 'A started lineup with a DP must include an established DP/FLEX pairing.');
      }
      return;
    }
    if (!profile.dpFlex.enabled) {
      throw new DiamondDomainError('rule-not-enabled', 'The selected rules profile does not allow DP/FLEX.');
    }
    const dpPlayerId = requireId(dpFlex.dpPlayerId, 'DP playerId');
    const flexPlayerId = requireId(dpFlex.flexPlayerId, 'FLEX playerId');
    if (dpPlayerId === flexPlayerId) throw new DiamondDomainError('invalid-dp-flex', 'DP and FLEX must be different players.');
    requireInteger(dpFlex.dpBattingSlot, 'DP batting slot', 1, 25);
    const flexPosition = requireMember(dpFlex.flexDefensivePosition, FIELDING_POSITIONS, 'FLEX defensive position');
    const dpSlot = order.find((entry) => entry.slot === dpFlex.dpBattingSlot);
    if (!dpSlot || dpSlot.starterPlayerId !== dpPlayerId) {
      throw new DiamondDomainError('invalid-dp-flex', 'The configured DP must be the starter in the linked batting slot.');
    }
    if (dpSlot.activePlayerId !== dpPlayerId && dpSlot.activePlayerId !== flexPlayerId) {
      throw new DiamondDomainError('invalid-dp-flex', 'Only the configured DP or FLEX may occupy the linked batting slot.');
    }
    const expectedRole: DiamondBattingRole = dpSlot.activePlayerId === flexPlayerId ? 'flex' : 'dp';
    if (dpSlot.battingRole !== expectedRole) {
      throw new DiamondDomainError('invalid-dp-flex', 'The linked batting role does not match the active DP/FLEX player.');
    }
    const pairAppearsElsewhere = order.some(
      (entry) =>
        entry.slot !== dpFlex.dpBattingSlot &&
        [entry.activePlayerId, entry.starterPlayerId, ...entry.substitutions].some(
          (playerId) => playerId === dpPlayerId || playerId === flexPlayerId
        )
    );
    if (pairAppearsElsewhere) {
      throw new DiamondDomainError('invalid-dp-flex', 'DP and FLEX may participate in only their linked batting slot.');
    }
    const flexPositionPlayer = state.lineups[side].defense[flexPosition];
    if (flexPositionPlayer !== flexPlayerId && flexPositionPlayer !== dpPlayerId) {
      throw new DiamondDomainError('invalid-dp-flex', 'The configured FLEX defensive position must contain the DP or FLEX.');
    }
  });
  Object.values(state.coverage).forEach((coverage) => {
    if (!COVERAGE_VALUES.includes(coverage)) {
      throw new DiamondDomainError('invalid-coverage', `Invalid coverage value ${String(coverage)}.`);
    }
  });
  if (state.lifecycle !== 'configured' && !state.currentScorerUid) {
    throw new DiamondDomainError('missing-scorer', 'An activated scorebook must have a current scorer.');
  }
  if (state.halfInningEnd) {
    requireMember(state.halfInningEnd.reason, ['run-limit'], 'half-inning end reason');
    requireEventId(state.halfInningEnd.decisionEventId, 'half-inning decisionEventId');
    if (profile.inningRunLimit === null || currentHalfRuns(state) < profile.inningRunLimit) {
      throw new DiamondDomainError('invalid-run-limit-decision', 'The current half inning has not reached its configured run limit.');
    }
  }
  if (state.gameEndDecision) {
    requireMember(state.gameEndDecision.reason, ['time-limit', 'weather', 'forfeit'], 'game-end decision reason');
    requireEventId(state.gameEndDecision.decisionEventId, 'game-end decisionEventId');
    if (state.gameEndDecision.reason === 'time-limit' && profile.timeLimitMinutes === null) {
      throw new DiamondDomainError('invalid-game-end-decision', 'The pinned rules profile does not define a time limit.');
    }
    if (state.gameEndDecision.reason === 'forfeit') {
      requireSide(state.gameEndDecision.awardedSide, 'forfeit awarded side');
    } else if (state.gameEndDecision.awardedSide !== null) {
      throw new DiamondDomainError('invalid-game-end-decision', 'Only a forfeit decision may name an awarded side.');
    }
  }
  if (state.cancellation) {
    requireText(state.cancellation.reason, 'cancellation reason', 300);
    requireEventId(state.cancellation.decisionEventId, 'cancellation decisionEventId');
  }
  if (state.lifecycle === 'cancelled') {
    if (!state.cancellation) throw new DiamondDomainError('invalid-cancellation', 'A cancelled game requires an audited cancellation.');
    if (state.gameEndDecision || state.finalizationReason || state.finalConfirmedAtRevision !== null) {
      throw new DiamondDomainError('invalid-cancellation', 'A cancelled game cannot also be finalized.');
    }
    if (state.suspendedReason !== null) {
      throw new DiamondDomainError('invalid-cancellation', 'A cancelled game cannot retain a suspended-state reason.');
    }
  } else if (state.cancellation) {
    throw new DiamondDomainError('invalid-cancellation', 'Cancellation evidence is valid only for a cancelled game.');
  }
  if (state.lifecycle === 'final') {
    if (!state.finalizationReason || state.finalConfirmedAtRevision === null) {
      throw new DiamondDomainError('invalid-finalization', 'A final game requires an audited finalization reason.');
    }
    requireInteger(state.finalConfirmedAtRevision, 'finalization revision', 1, Number.MAX_SAFE_INTEGER);
    const eligible = getDiamondFinalizationReason({ ...state, finalizationReason: null });
    if (
      !eligible ||
      eligible.kind !== state.finalizationReason.kind ||
      eligible.decisionEventId !== state.finalizationReason.decisionEventId
    ) {
      throw new DiamondDomainError('invalid-finalization', 'The stored finalization reason is not supported by the game state.');
    }
  } else if (state.finalizationReason || state.finalConfirmedAtRevision !== null) {
    throw new DiamondDomainError('invalid-finalization', 'Only a final game may retain a confirmed finalization reason.');
  }
  return state;
}

export function reduceDiamondEvent(state: DiamondGameState, action: DiamondReducerAction): DiamondGameState {
  validateDiamondState(state);
  let next = cloneState(state);

  switch (action.type) {
    case 'activate': {
      requireLifecycle(state, ['configured'], 'activate');
      const scorer = requireId(action.payload.initialScorerUid, 'initialScorerUid');
      if (action.payload.captureMode !== 'quick' && action.payload.captureMode !== 'full') {
        throw new DiamondDomainError('invalid-capture-mode', 'Capture mode must be quick or full.');
      }
      next = {
        ...next,
        lifecycle: 'ready',
        captureMode: action.payload.captureMode,
        currentScorerUid: scorer,
        coverage: initialCoverage(action.payload.captureMode)
      };
      break;
    }
    case 'set_lineup': {
      requireLifecycle(state, ['ready'], 'set lineup');
      requireNoGameEndingCondition(state, 'changing the lineup');
      const side = requireSide(action.payload.side);
      const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
      if (state.lineups[side].dpFlex) {
        throw new DiamondDomainError('dp-flex-already-configured', 'Set the batting lineup before configuring DP/FLEX.');
      }
      if (!Array.isArray(action.payload.entries) || action.payload.entries.length < 1 || action.payload.entries.length > 25) {
        throw new DiamondDomainError('invalid-lineup', 'A lineup must contain between 1 and 25 batting entries.');
      }
      const slots = action.payload.entries.map((entry) => requireInteger(entry.slot, 'batting slot', 1, 25));
      const players = action.payload.entries.map((entry) => requireId(entry.playerId, 'lineup playerId'));
      if (new Set(slots).size !== slots.length || new Set(players).size !== players.length) {
        throw new DiamondDomainError('invalid-lineup', 'Lineup slots and players must be unique.');
      }
      const ordered = action.payload.entries
        .map((entry) => ({
          slot: entry.slot,
          activePlayerId: entry.playerId,
          starterPlayerId: entry.playerId,
          displayName: entry.displayName?.trim() || undefined,
          jerseyNumber: entry.jerseyNumber?.trim() || undefined,
          battingRole: requireBattingRole(profile, entry.battingRole ?? 'regular', { initialLineup: true }),
          starterReentriesUsed: 0,
          substitutions: [] as string[]
        }))
        .sort((left, right) => left.slot - right.slot);
      validateBattingRoleCounts(ordered);
      next = {
        ...next,
        lineups: {
          ...next.lineups,
          [side]: { ...next.lineups[side], battingOrder: ordered }
        },
        nextBatterSlot: { ...next.nextBatterSlot, [side]: 0 }
      };
      break;
    }
    case 'set_defensive_alignment': {
      requireLifecycle(state, ['ready', 'active'], 'set defensive alignment');
      requireNoGameEndingCondition(state, 'changing the defensive alignment');
      if (state.lifecycle === 'active' && currentHalfReachedRunLimit(state)) {
        throw new DiamondDomainError(
          'run-limit-decision-required',
          'Record the scorer or umpire run-limit decision before changing the defensive alignment.'
        );
      }
      const side = requireSide(action.payload.side);
      if (!Array.isArray(action.payload.assignments) || action.payload.assignments.length > 10) {
        throw new DiamondDomainError('invalid-defense', 'A defensive alignment may contain at most ten assignments.');
      }
      const players = action.payload.assignments.map((assignment) => requireId(assignment.playerId, 'defender playerId'));
      const positions = action.payload.assignments.map((assignment) =>
        requireMember(assignment.position, FIELDING_POSITIONS, 'defensive position')
      );
      if (new Set(players).size !== players.length || new Set(positions).size !== positions.length) {
        throw new DiamondDomainError('invalid-defense', 'Defensive players and positions must be unique.');
      }
      const defense = Object.fromEntries(
        action.payload.assignments.map((assignment) => [assignment.position, assignment.playerId])
      ) as Partial<Record<DiamondDefensivePosition, string>>;
      if (state.lifecycle === 'active') {
        const priorPlayers = Object.values(state.lineups[side].defense).filter(Boolean).sort();
        const nextPlayers = Object.values(defense).filter(Boolean).sort();
        if (priorPlayers.length !== nextPlayers.length || priorPlayers.some((playerId, index) => playerId !== nextPlayers[index])) {
          throw new DiamondDomainError(
            'defensive-personnel-change-requires-substitution',
            'Active defensive personnel changes require a substitution or re-entry command.'
          );
        }
        if (!defense.P) {
          throw new DiamondDomainError('missing-defensive-pitcher', 'An active defensive alignment must identify the pitcher.');
        }
      }
      next = {
        ...next,
        lineups: {
          ...next.lineups,
          [side]: { ...next.lineups[side], defense }
        }
      };
      break;
    }
    case 'set_dp_flex': {
      requireLifecycle(state, ['ready'], 'set DP/FLEX');
      requireNoGameEndingCondition(state, 'changing the DP/FLEX pairing');
      const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
      if (!profile.dpFlex.enabled) throw new DiamondDomainError('rule-not-enabled', 'DP/FLEX is disabled by this profile.');
      const side = requireSide(action.payload.side);
      if (state.lineups[side].dpFlex) {
        throw new DiamondDomainError('dp-flex-already-configured', 'DP/FLEX is already configured for this side.');
      }
      const dpPlayerId = requireId(action.payload.dpPlayerId, 'dpPlayerId');
      const flexPlayerId = requireId(action.payload.flexPlayerId, 'flexPlayerId');
      const flexDefensivePosition = requireMember(action.payload.flexDefensivePosition, FIELDING_POSITIONS, 'FLEX defensive position');
      if (dpPlayerId === flexPlayerId) throw new DiamondDomainError('invalid-dp-flex', 'DP and FLEX must be different players.');
      const slot = state.lineups[side].battingOrder.find((entry) => entry.slot === action.payload.dpBattingSlot);
      if (!slot || slot.activePlayerId !== dpPlayerId || slot.starterPlayerId !== dpPlayerId || slot.battingRole !== 'dp') {
        throw new DiamondDomainError('invalid-dp-flex', 'The declared batting slot must contain the starting player with the DP role.');
      }
      if (
        state.lineups[side].battingOrder.some((entry) =>
          [entry.activePlayerId, entry.starterPlayerId, ...entry.substitutions].includes(flexPlayerId)
        )
      ) {
        throw new DiamondDomainError('invalid-dp-flex', 'The starting FLEX cannot also occupy a batting slot.');
      }
      const existingFlexPosition = Object.entries(state.lineups[side].defense).find(([, playerId]) => playerId === flexPlayerId)?.[0];
      if (existingFlexPosition && existingFlexPosition !== flexDefensivePosition) {
        throw new DiamondDomainError('invalid-dp-flex', 'The FLEX is already assigned to a different defensive position.');
      }
      const defensiveOccupant = state.lineups[side].defense[flexDefensivePosition];
      if (defensiveOccupant && defensiveOccupant !== flexPlayerId) {
        throw new DiamondDomainError('occupied-position', `${flexDefensivePosition} is already occupied.`);
      }
      next = {
        ...next,
        lineups: {
          ...next.lineups,
          [side]: {
            ...next.lineups[side],
            dpFlex: {
              dpPlayerId,
              flexPlayerId,
              dpBattingSlot: action.payload.dpBattingSlot,
              flexDefensivePosition
            },
            defense: {
              ...next.lineups[side].defense,
              [flexDefensivePosition]: flexPlayerId
            }
          }
        }
      };
      break;
    }
    case 'start': {
      requireLifecycle(state, ['ready'], 'start');
      requireNoGameEndingCondition(state, 'starting the game');
      if (!state.lineups.home.battingOrder.length || !state.lineups.away.battingOrder.length) {
        throw new DiamondDomainError('missing-lineup', 'Both teams need a batting lineup before the game starts.');
      }
      (['home', 'away'] as const).forEach((side) => {
        if (!state.lineups[side].defense.P) {
          throw new DiamondDomainError('missing-defensive-pitcher', `${side} must set a defensive pitcher before the game starts.`);
        }
        if (state.lineups[side].battingOrder.some((entry) => entry.battingRole === 'dp') && !state.lineups[side].dpFlex) {
          throw new DiamondDomainError('missing-dp-flex', `${side} must configure its DP/FLEX pairing before the game starts.`);
        }
      });
      next = { ...next, lifecycle: 'active' };
      break;
    }
    case 'record_pitch': {
      requireLifecycle(state, ['active'], 'record pitch');
      requireOpenHalfForPlay(state);
      if (state.inning.outs >= 3) throw new DiamondDomainError('half-inning-complete', 'Advance the half inning first.');
      validateBatterAndPitcher(state, action.payload.batterId, action.payload.pitcherId);
      requireMember(action.payload.result, PITCH_RESULTS, 'pitch result');
      if (state.inning.balls >= 4 || state.inning.strikes >= 3 || isDiamondTerminalPitchResult(state.inning.lastPitchResult)) {
        throw new DiamondDomainError('plate-appearance-pending', 'Resolve the plate appearance before recording another pitch.');
      }
      let balls = state.inning.balls;
      let strikes = state.inning.strikes;
      const deliveredPitch = isDiamondDeliveredPitch(action.payload.result);
      if (action.payload.result === 'ball') balls += 1;
      if (action.payload.result === 'called_strike' || action.payload.result === 'swinging_strike') strikes += 1;
      if (action.payload.result === 'foul' && strikes < 2) strikes += 1;
      if (action.payload.result === 'foul_bunt') strikes += 1;
      if (action.payload.result === 'illegal_pitch') {
        const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
        if (profile.illegalPitchPolicy !== 'configurable') balls += 1;
      }
      next = {
        ...next,
        inning: {
          ...next.inning,
          balls: Math.min(balls, 4),
          strikes: Math.min(strikes, 3),
          pitchesInPlateAppearance: state.inning.pitchesInPlateAppearance + (deliveredPitch ? 1 : 0),
          lastPitchResult: deliveredPitch ? action.payload.result : state.inning.lastPitchResult
        }
      };
      if (deliveredPitch) next = markPitchObserved(next);
      break;
    }
    case 'record_plate_appearance': {
      requireLifecycle(state, ['active'], 'record plate appearance');
      requireOpenHalfForPlay(state);
      if (state.inning.outs >= 3) throw new DiamondDomainError('half-inning-complete', 'Advance the half inning first.');
      const side = validateBatterAndPitcher(state, action.payload.batterId, action.payload.pitcherId);
      if (BASES.some((base) => state.bases[base]?.runnerId === action.payload.batterId)) {
        throw new DiamondDomainError('batter-on-base', 'The current batter is already recorded as a base runner.');
      }
      validateBatterAdvanceShape(action.payload.batterAdvance);
      validateOutcomeDestination(state, action.payload.result, action.payload.batterAdvance.to);
      const batterOutKind = resolveBatterOutKind(
        action.payload.result,
        action.payload.batterAdvance.to,
        action.payload.batterAdvance.outKind
      );
      if (action.payload.fielding) {
        validateFieldingIds(action.payload.fielding);
        validateInlineFieldingParticipants(state, action.payload.fielding);
      }
      if (!Array.isArray(action.payload.runnerAdvances)) {
        throw new DiamondDomainError('invalid-runner-advances', 'runnerAdvances must be an array.');
      }
      validateOmissions(action.payload.omissions);
      if (action.payload.runnerAdvances.length > 3) {
        throw new DiamondDomainError('too-many-runner-advances', 'A plate appearance may move at most three existing runners.');
      }
      if (action.payload.runsBattedIn !== undefined) {
        requireInteger(action.payload.runsBattedIn, 'runsBattedIn', 0, 4);
      }
      const batterMove: Move = {
        runnerId: action.payload.batterId,
        from: 'batter',
        to: action.payload.batterAdvance.to,
        countsRun: action.payload.batterAdvance.countsRun,
        chargedToPitcherId: action.payload.batterAdvance.responsiblePitcherId ?? action.payload.pitcherId,
        courtesyForPlayerId: null,
        outKind: batterOutKind
      };
      validateInlineResponsiblePitcher(
        state,
        action.payload.batterAdvance.responsiblePitcherId,
        action.payload.pitcherId,
        'The batter advance'
      );
      const runnerMoves: Move[] = action.payload.runnerAdvances.map((advance: DiamondRunnerAdvance) => {
        validateAdvanceShape(advance);
        const placement = state.bases[requireMember(advance.from, BASES, 'runner source')];
        validateInlineResponsiblePitcher(
          state,
          advance.responsiblePitcherId,
          placement?.chargedToPitcherId ?? null,
          `The advance for ${advance.runnerId}`
        );
        return {
          runnerId: advance.runnerId,
          from: advance.from,
          to: advance.to,
          countsRun: advance.countsRun,
          chargedToPitcherId: placement ? (advance.responsiblePitcherId ?? placement.chargedToPitcherId) : action.payload.pitcherId,
          courtesyForPlayerId: placement?.courtesyForPlayerId ?? null,
          outKind: advance.outKind
        };
      });
      const moves = [batterMove, ...runnerMoves];
      validateCompleteExtraBaseHitRunnerResolution(state, action.payload.result, runnerMoves);
      validateSacrificeEvidence(state, action.payload.result, runnerMoves);
      validateNamedMultiOutResult(state, action.payload.result, moves, action.payload.outsOnPlay);
      const actualOutCount = moves.filter((move) => move.to === 'out').length;
      validateDiamondFieldingOutCredit(action.payload.fielding, actualOutCount);
      validateDiamondMergedFieldingOutCredit(action.payload.fielding ? [action.payload.fielding] : [], actualOutCount);
      next = applyMoves(state, side, moves, action.payload.outsOnPlay, action.eventId ?? null);
      const orderLength = state.lineups[side].battingOrder.length;
      next = {
        ...next,
        inning: { ...next.inning, balls: 0, strikes: 0, pitchesInPlateAppearance: 0, lastPitchResult: null },
        nextBatterSlot: { ...next.nextBatterSlot, [side]: (state.nextBatterSlot[side] + 1) % orderLength }
      };
      if (action.payload.fielding) next = markFieldingObserved(next);
      next = markPartial(next, action.payload.omissions);
      const scoringAdvances = [action.payload.batterAdvance, ...action.payload.runnerAdvances].filter(
        (advance) => advance.to === 'home' && advance.countsRun !== false
      );
      if (action.payload.runsBattedIn !== undefined) {
        const { explicitTrueCount, unattributedCount } = deriveDiamondAggregateRbiInference(scoringAdvances, action.payload.runsBattedIn);
        if (action.payload.runsBattedIn < explicitTrueCount || action.payload.runsBattedIn > explicitTrueCount + unattributedCount) {
          throw new DiamondDomainError(
            'invalid-rbi',
            'runsBattedIn must agree with every explicit runner RBI value and cannot exceed the unattributed scoring runners.'
          );
        }
      }
      if (scoringAdvances.some((advance) => advance.earned === undefined)) {
        next = markPartial(next, ['pitching']);
      }
      if (action.payload.runsBattedIn === undefined && scoringAdvances.some((advance) => advance.rbi === undefined)) {
        next = markPartial(next, ['batting']);
      }
      if (state.captureMode === 'full' && !hasCompletePitchOutcomeEvidence(state, action.payload.result)) {
        next = markPartial(next, ['pitches']);
      }
      const missingFullFielding =
        action.payload.outsOnPlay > 0 &&
        !hasCompletePutoutEvidence(action.payload.fielding ? [action.payload.fielding] : [], action.payload.outsOnPlay);
      const missingReachedOnErrorFielder = action.payload.result === 'reached_on_error' && !action.payload.fielding?.errors?.length;
      if (state.captureMode === 'full' && (missingFullFielding || missingReachedOnErrorFielder)) {
        next = markPartial(next, ['fielding']);
      }
      break;
    }
    case 'advance_runner': {
      requireLifecycle(state, ['active'], 'advance runner');
      requireOpenHalfForPlay(state);
      validateAdvanceShape(action.payload, { standalone: true });
      const runnerId = requireId(action.payload.runnerId, 'runnerId');
      const placement = state.bases[action.payload.from];
      if (!placement || placement.runnerId !== runnerId) {
        throw new DiamondDomainError('runner-not-on-base', `${runnerId} is not on ${action.payload.from}.`);
      }
      if (action.payload.fielding) {
        validateFieldingIds(action.payload.fielding);
        validateInlineFieldingParticipants(state, action.payload.fielding);
        validateDiamondFieldingOutCredit(action.payload.fielding, action.payload.to === 'out' ? 1 : 0);
        validateDiamondMergedFieldingOutCredit([action.payload.fielding], action.payload.to === 'out' ? 1 : 0);
      }
      validateOmissions(action.payload.omissions);
      validateInlineResponsiblePitcher(
        state,
        action.payload.responsiblePitcherId,
        placement.chargedToPitcherId,
        `The advance for ${runnerId}`
      );
      next = applyMoves(
        state,
        getBattingSide(state),
        [
          {
            runnerId,
            from: action.payload.from,
            to: action.payload.to,
            countsRun: action.payload.countsRun,
            chargedToPitcherId: action.payload.responsiblePitcherId ?? placement.chargedToPitcherId,
            courtesyForPlayerId: placement.courtesyForPlayerId,
            outKind: action.payload.outKind
          }
        ],
        action.payload.to === 'out' ? 1 : 0,
        action.eventId ?? placement.reachedOnEventId
      );
      if (action.payload.fielding) next = markFieldingObserved(next);
      next = markPartial(next, action.payload.omissions);
      if (action.payload.to === 'home' && action.payload.countsRun !== false && action.payload.earned === undefined) {
        next = markPartial(next, ['pitching']);
      }
      if (
        state.captureMode === 'full' &&
        action.payload.to === 'out' &&
        !hasCompletePutoutEvidence(action.payload.fielding ? [action.payload.fielding] : [], 1)
      ) {
        next = markPartial(next, ['fielding']);
      }
      break;
    }
    case 'record_fielding': {
      requireLifecycle(state, ['active', 'correction'], 'record fielding');
      const attachment = requireRecord(action.payload, 'fielding attachment');
      requireOnlyFields(attachment, FIELDING_ATTACHMENT_FIELDS, 'fielding attachment');
      requireId(action.payload.playEventId, 'playEventId');
      validateFieldingIds(action.payload.fielding);
      next = markFieldingObserved(next);
      break;
    }
    case 'record_scoring_judgment': {
      requireLifecycle(state, ['active', 'correction'], 'record scoring judgment');
      const judgment = requireRecord(action.payload, 'scoring judgment');
      requireOnlyFields(judgment, SCORING_JUDGMENT_FIELDS, 'scoring judgment');
      requireId(action.payload.playEventId, 'playEventId');
      requireOptionalBoolean(action.payload.earned, 'earned');
      requireOptionalBoolean(action.payload.rbi, 'rbi');
      if (action.payload.runnerId !== undefined) requireId(action.payload.runnerId, 'runnerId');
      if (action.payload.responsiblePitcherId !== undefined) requireId(action.payload.responsiblePitcherId, 'responsiblePitcherId');
      if (action.payload.pitcherOfRecord !== undefined) {
        const decision = requireRecord(action.payload.pitcherOfRecord, 'pitcherOfRecord');
        requireOnlyFields(decision, PITCHER_DECISION_FIELDS, 'pitcherOfRecord');
        requireSide(decision.side, 'pitcherOfRecord.side');
        requireId(decision.playerId, 'pitcherOfRecord.playerId');
        requireMember(decision.decision, ['win', 'loss', 'save'], 'pitcher decision');
      }
      break;
    }
    case 'advance_half_inning': {
      requireLifecycle(state, ['active'], 'advance half inning');
      if (state.gameEndDecision) {
        throw new DiamondDomainError('game-end-decision-recorded', 'Finalize the recorded game-ending decision instead of advancing.');
      }
      const ending = automaticDiamondFinalizationReason(state);
      if (ending) {
        throw new DiamondDomainError('game-ending-condition-met', `Finalize the ${ending.kind} result instead of advancing.`);
      }
      if (state.inning.outs !== 3 && !state.halfInningEnd) {
        throw new DiamondDomainError('half-inning-not-complete', 'A half inning advances only after the third out.');
      }
      const top = state.inning.half === 'top';
      next = {
        ...next,
        inning: {
          number: top ? state.inning.number : state.inning.number + 1,
          half: top ? 'bottom' : 'top',
          outs: 0,
          balls: 0,
          strikes: 0,
          pitchesInPlateAppearance: 0,
          lastPitchResult: null
        },
        bases: { ...EMPTY_BASES },
        halfInningEnd: null
      };
      break;
    }
    case 'place_tiebreaker_runner': {
      requireLifecycle(state, ['active'], 'place tiebreaker runner');
      requireOpenHalfForPlay(state, { allowPendingTiebreakerPlacement: true });
      const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
      const side = requireSide(action.payload.side);
      const base = requireMember(action.payload.base, BASES, 'tiebreaker base');
      if (!profile.tiebreaker.enabled || state.inning.number < profile.tiebreaker.startInning) {
        throw new DiamondDomainError('rule-not-enabled', 'The tiebreaker runner is not active for this inning.');
      }
      if (side !== getBattingSide(state) || base !== profile.tiebreaker.runnerBase) {
        throw new DiamondDomainError('invalid-tiebreaker-runner', 'The tiebreaker runner must use the configured batting side and base.');
      }
      if (!pristineCurrentHalf(state)) {
        throw new DiamondDomainError(
          'invalid-tiebreaker-runner',
          'The tiebreaker runner must be placed before the first play of the half inning.'
        );
      }
      if (state.bases[base]) {
        throw new DiamondDomainError('occupied-base', 'The configured tiebreaker base is already occupied.');
      }
      const runnerId = requireId(action.payload.runnerId, 'runnerId');
      const order = state.lineups[side].battingOrder;
      if (!order.length) throw new DiamondDomainError('missing-lineup', `${side} batting lineup is empty.`);
      const previousBatterIndex = (state.nextBatterSlot[side] - 1 + order.length) % order.length;
      const expectedRunnerId = order[previousBatterIndex].activePlayerId;
      if (profile.tiebreaker.runnerSelection === 'previous-batter' && runnerId !== expectedRunnerId) {
        throw new DiamondDomainError(
          'invalid-tiebreaker-runner',
          `The tiebreaker runner must be the previous scheduled batter (${expectedRunnerId}).`
        );
      }
      const currentPitcherId = state.lineups[oppositeSide(side)].defense.P;
      if (!currentPitcherId) {
        throw new DiamondDomainError(
          'missing-defensive-pitcher',
          'The tiebreaker runner requires the current defensive pitcher before placement.'
        );
      }
      const suppliedPitcherId =
        action.payload.chargedToPitcherId === undefined ? undefined : requireId(action.payload.chargedToPitcherId, 'chargedToPitcherId');
      const chargedToPitcherId = suppliedPitcherId ?? currentPitcherId;
      validateInlineResponsiblePitcher(state, chargedToPitcherId, currentPitcherId, 'The tiebreaker runner');
      next = {
        ...next,
        bases: {
          ...next.bases,
          [base]: {
            runnerId,
            chargedToPitcherId,
            courtesyForPlayerId: null,
            reachedOnEventId: action.eventId ?? null
          }
        }
      };
      break;
    }
    case 'substitute': {
      next = reduceSubstitution(state, action.payload, false);
      break;
    }
    case 're_enter': {
      next = reduceSubstitution(state, action.payload, true);
      break;
    }
    case 'add_courtesy_runner': {
      requireLifecycle(state, ['active'], 'add courtesy runner');
      requireOpenHalfForPlay(state);
      const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
      const side = requireSide(action.payload.side);
      const base = requireMember(action.payload.base, BASES, 'courtesy runner base');
      const forRole = requireMember(action.payload.forRole, ['pitcher', 'catcher'], 'courtesy runner role');
      if (!profile.courtesyRunner[forRole]) {
        throw new DiamondDomainError('rule-not-enabled', `Courtesy runners for ${forRole}s are disabled.`);
      }
      if (side !== getBattingSide(state)) {
        throw new DiamondDomainError('invalid-courtesy-runner', 'A courtesy runner may replace only a runner on the batting team.');
      }
      const forPlayerId = requireId(action.payload.forPlayerId, 'forPlayerId');
      const runnerId = requireId(action.payload.runnerId, 'runnerId');
      const placement = state.bases[base];
      if (!placement || placement.runnerId !== forPlayerId) {
        throw new DiamondDomainError('runner-not-on-base', 'The pitcher or catcher is not on the declared base.');
      }
      const position = forRole === 'pitcher' ? 'P' : 'C';
      if (state.lineups[side].defense[position] !== forPlayerId) {
        throw new DiamondDomainError('invalid-courtesy-runner', `The replaced player is not the recorded ${position}.`);
      }
      if (BASES.some((base) => state.bases[base]?.runnerId === runnerId)) {
        throw new DiamondDomainError('duplicate-base-runner', 'The courtesy runner is already on base.');
      }
      next = {
        ...next,
        bases: {
          ...next.bases,
          [base]: {
            ...placement,
            runnerId,
            courtesyForPlayerId: forPlayerId
          }
        }
      };
      break;
    }
    case 'scorer_handoff': {
      requireLifecycle(state, ['ready', 'active', 'suspended', 'final', 'correction'], 'scorer handoff');
      next = { ...next, currentScorerUid: requireId(action.payload.toUid, 'toUid') };
      break;
    }
    case 'suspend': {
      requireLifecycle(state, ['active'], 'suspend');
      requireNoGameEndingCondition(state, 'suspending the game');
      next = { ...next, lifecycle: 'suspended', suspendedReason: requireText(action.payload.reason, 'reason', 300) };
      break;
    }
    case 'resume': {
      requireLifecycle(state, ['suspended'], 'resume');
      requireNoGameEndingCondition(state, 'resuming the game');
      next = { ...next, lifecycle: 'active', suspendedReason: null };
      break;
    }
    case 'cancel': {
      requireLifecycle(state, ['ready', 'active', 'suspended'], 'cancel');
      if (action.payload.confirmed !== true) {
        throw new DiamondDomainError('confirmation-required', 'Cancellation requires explicit confirmation.');
      }
      if (state.gameEndDecision || automaticDiamondFinalizationReason(state)) {
        throw new DiamondDomainError('finalization-required', 'This game has an official ending condition and must be finalized instead.');
      }
      next = {
        ...next,
        lifecycle: 'cancelled',
        suspendedReason: null,
        cancellation: {
          reason: requireText(action.payload.reason, 'cancellation reason', 300),
          decisionEventId: requireEventId(action.eventId, 'cancellation eventId')
        }
      };
      break;
    }
    case 'finalize': {
      requireLifecycle(state, ['ready', 'active', 'suspended', 'correction'], 'finalize');
      if (action.payload.confirmed !== true) {
        throw new DiamondDomainError('confirmation-required', 'Finalization requires explicit confirmation.');
      }
      const reason = getDiamondFinalizationReason(state);
      if (!reason) {
        throw new DiamondDomainError(
          'finalization-not-eligible',
          'Finalization requires regulation completion, a walkoff, a run-ahead result, or an explicit supported game-end decision.'
        );
      }
      next = {
        ...next,
        lifecycle: 'final',
        finalizationReason: reason,
        finalConfirmedAtRevision: state.revision + 1,
        suspendedReason: null
      };
      break;
    }
    case 'reopen_for_correction': {
      requireLifecycle(state, ['final'], 'reopen for correction');
      requireText(action.payload.reason, 'reason', 300);
      next = { ...next, lifecycle: 'correction', finalizationReason: null, finalConfirmedAtRevision: null };
      break;
    }
    case 'private_note': {
      requireLifecycle(state, ['ready', 'active', 'suspended', 'final', 'correction'], 'private note');
      requireText(action.payload.text, 'note', 2_000);
      if (action.payload.attachedEventId) requireId(action.payload.attachedEventId, 'attachedEventId');
      if (action.payload.visibility !== undefined) {
        requireMember(action.payload.visibility, ['staff-private'], 'note visibility');
      }
      break;
    }
    case 'rules_decision': {
      requireLifecycle(state, ['ready', 'active', 'suspended', 'correction'], 'rules decision');
      const code = requireMember(action.payload.code, RULE_DECISION_CODES, 'rules decision code');
      requireText(action.payload.description, 'decision description', 500);
      const decisionEventId = requireEventId(action.eventId, 'rules decision eventId');
      if (code === 'coverage_adjustment') {
        if (!action.payload.affectedFamilies?.length) {
          throw new DiamondDomainError('invalid-coverage-adjustment', 'A coverage adjustment must name at least one stat family.');
        }
      } else if (code === 'end_half_inning_run_limit') {
        requireLifecycle(state, ['active'], 'record a run-limit ending');
        const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
        if (profile.inningRunLimit === null) {
          throw new DiamondDomainError('rule-not-enabled', 'This rules profile does not define an inning run limit.');
        }
        if (state.halfInningEnd) {
          throw new DiamondDomainError('half-inning-complete', 'The current half inning already has an ending decision.');
        }
        if (state.gameEndDecision || automaticDiamondFinalizationReason(state)) {
          throw new DiamondDomainError(
            'finalization-required',
            'Finalize the game-ending condition instead of ending only the half inning.'
          );
        }
        if (currentHalfRuns(state) < profile.inningRunLimit) {
          throw new DiamondDomainError(
            'run-limit-not-reached',
            `The current half inning has not reached its ${String(profile.inningRunLimit)}-run limit.`
          );
        }
        next = {
          ...next,
          halfInningEnd: { reason: 'run-limit', decisionEventId }
        };
      } else {
        const isForfeit = code === 'end_game_forfeit_home' || code === 'end_game_forfeit_away';
        const allowedLifecycles: readonly DiamondGameState['lifecycle'][] = isForfeit
          ? ['ready', 'active', 'suspended', 'correction']
          : ['active', 'suspended', 'correction'];
        requireLifecycle(state, allowedLifecycles, 'record a game-ending decision');
        if (state.gameEndDecision) {
          throw new DiamondDomainError('game-end-decision-exists', 'A game-ending decision is already recorded.');
        }
        if (automaticDiamondFinalizationReason(state)) {
          throw new DiamondDomainError('finalization-required', 'Finalize the existing automatic game-ending condition instead.');
        }
        const reason = code === 'end_game_time_limit' ? 'time-limit' : code === 'end_game_weather' ? 'weather' : 'forfeit';
        if (reason === 'time-limit') {
          const profile = requireDiamondRulesProfile(state.rulesProfileId, state.rulesProfileVersion);
          if (profile.timeLimitMinutes === null) {
            throw new DiamondDomainError('rule-not-enabled', 'This rules profile does not define a time limit.');
          }
        }
        next = {
          ...next,
          gameEndDecision: {
            reason,
            decisionEventId,
            awardedSide: code === 'end_game_forfeit_home' ? 'home' : code === 'end_game_forfeit_away' ? 'away' : null
          }
        };
      }
      next = markPartial(next, action.payload.affectedFamilies);
      break;
    }
    case 'void_event':
    case 'supersede_event': {
      requireLifecycle(state, ['active', 'correction'], action.type === 'void_event' ? 'void event' : 'supersede event');
      requireId(action.payload.targetEventId, 'targetEventId');
      requireText(action.payload.reason, 'reason', 500);
      break;
    }
    default: {
      const exhaustive: never = action;
      throw new DiamondDomainError('unsupported-command', `Unsupported command ${String(exhaustive)}.`);
    }
  }

  return deepFreeze(validateDiamondState(next));
}

export function setDiamondStateRevision(
  state: DiamondGameState,
  revision: number,
  checkpointHash = state.checkpointHash
): DiamondGameState {
  return deepFreeze(
    validateDiamondState({
      ...cloneState(state),
      revision: requireInteger(revision, 'revision', 0, Number.MAX_SAFE_INTEGER),
      checkpointHash
    })
  );
}

export function cloneDiamondState(state: DiamondGameState): DiamondGameState {
  return deepFreeze(cloneState(state));
}

export function runnerAdvanceToMove(advance: DiamondRunnerAdvance, placement: DiamondRunnerPlacement): Move {
  return {
    runnerId: advance.runnerId,
    from: advance.from,
    to: advance.to,
    countsRun: advance.countsRun,
    chargedToPitcherId: advance.responsiblePitcherId ?? placement.chargedToPitcherId,
    courtesyForPlayerId: placement.courtesyForPlayerId,
    outKind: advance.outKind
  };
}
