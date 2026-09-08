"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDiamondDeliveredPitch = isDiamondDeliveredPitch;
exports.getBattingSide = getBattingSide;
exports.getDiamondFinalizationReason = getDiamondFinalizationReason;
exports.createInitialDiamondState = createInitialDiamondState;
exports.deriveDiamondCoverageFromEvents = deriveDiamondCoverageFromEvents;
exports.validateDiamondState = validateDiamondState;
exports.reduceDiamondEvent = reduceDiamondEvent;
exports.setDiamondStateRevision = setDiamondStateRevision;
exports.cloneDiamondState = cloneDiamondState;
exports.runnerAdvanceToMove = runnerAdvanceToMove;
const contracts_1 = require("./contracts");
const rules_1 = require("./rules");
const EMPTY_BASES = Object.freeze({ first: null, second: null, third: null });
const EMPTY_LINEUP = Object.freeze({
    battingOrder: Object.freeze([]),
    defense: Object.freeze({}),
    dpFlex: null
});
const BASES = ['first', 'second', 'third'];
const COVERAGE_VALUES = ['complete', 'partial', 'not_collected'];
const SIDES = ['home', 'away'];
const LIFECYCLES = [
    'configured',
    'ready',
    'active',
    'suspended',
    'final',
    'correction',
    'cancelled'
];
const FIELDING_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'LCF', 'CF', 'RCF', 'RF'];
const BATTING_ROLES = ['regular', 'dh', 'dp', 'flex', 'eh', 'ep'];
const RULE_DECISION_CODES = [
    'coverage_adjustment',
    'end_half_inning_run_limit',
    'end_game_time_limit',
    'end_game_weather',
    'end_game_forfeit_home',
    'end_game_forfeit_away'
];
const PITCH_RESULTS = [
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
const PLATE_APPEARANCE_RESULTS = [
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
const DESTINATIONS = ['first', 'second', 'third', 'home', 'out', 'stay'];
const ADVANCE_CAUSES = [
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
const OUT_KINDS = [
    'force',
    'tag',
    'appeal',
    'batter_runner',
    'strikeout',
    'catch'
];
const SCORING_CREDIT_FIELDS = ['countsRun', 'earned', 'rbi', 'responsiblePitcherId'];
const BATTER_ADVANCE_FIELDS = new Set(['to', 'cause', 'outKind', ...SCORING_CREDIT_FIELDS]);
const RUNNER_ADVANCE_FIELDS = new Set(['runnerId', 'from', 'to', 'cause', 'outKind', ...SCORING_CREDIT_FIELDS]);
const STANDALONE_RUNNER_ADVANCE_FIELDS = new Set([...RUNNER_ADVANCE_FIELDS, 'fielding', 'omissions']);
const FIELDING_FIELDS = new Set(['putoutBy', 'assists', 'errors', 'passedBallBy', 'doublePlay', 'triplePlay', 'battedBall', 'location']);
const FIELDING_ATTACHMENT_FIELDS = new Set(['playEventId', 'fielding']);
const SCORING_JUDGMENT_FIELDS = new Set(['playEventId', 'runnerId', 'earned', 'rbi', 'responsiblePitcherId', 'pitcherOfRecord']);
const PITCHER_DECISION_FIELDS = new Set(['side', 'playerId', 'decision']);
function cloneLineup(lineup) {
    return {
        battingOrder: lineup.battingOrder.map((entry) => ({
            ...entry,
            substitutions: [...entry.substitutions]
        })),
        defense: { ...lineup.defense },
        dpFlex: lineup.dpFlex ? { ...lineup.dpFlex } : null
    };
}
function cloneState(state) {
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
function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
        Object.freeze(value);
        Object.values(value).forEach((child) => deepFreeze(child));
    }
    return value;
}
function requireId(value, label) {
    if (typeof value !== 'string')
        throw new contracts_1.DiamondDomainError('invalid-id', `${label} must be a string.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > 128 || normalized.includes('/')) {
        throw new contracts_1.DiamondDomainError('invalid-id', `${label} must be nonempty, slash-free, and at most 128 characters.`);
    }
    return normalized;
}
function requireRecord(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new contracts_1.DiamondDomainError('invalid-object', `${label} must be an object.`);
    }
    return value;
}
function requireOnlyFields(value, fields, label) {
    if (Object.keys(value).some((key) => !fields.has(key))) {
        throw new contracts_1.DiamondDomainError('invalid-object', `${label} contains unsupported fields.`);
    }
}
function requireOptionalBoolean(value, label) {
    if (value !== undefined && typeof value !== 'boolean') {
        throw new contracts_1.DiamondDomainError('invalid-boolean', `${label} must be a boolean when provided.`);
    }
}
function validateScoringCredit(value, label) {
    requireOptionalBoolean(value.countsRun, `${label}.countsRun`);
    requireOptionalBoolean(value.earned, `${label}.earned`);
    requireOptionalBoolean(value.rbi, `${label}.rbi`);
    if (value.responsiblePitcherId !== undefined) {
        requireId(value.responsiblePitcherId, `${label}.responsiblePitcherId`);
    }
}
function validateOmissions(value) {
    if (value === undefined)
        return;
    if (!Array.isArray(value) || value.length > 7) {
        throw new contracts_1.DiamondDomainError('invalid-stat-family', 'omissions must be a bounded stat-family array.');
    }
    const families = value.map((family) => requireMember(family, Object.keys(initialCoverage('full')), 'stat family'));
    if (new Set(families).size !== families.length) {
        throw new contracts_1.DiamondDomainError('invalid-stat-family', 'omissions cannot contain duplicate stat families.');
    }
}
function requireText(value, label, maximum = 500) {
    if (typeof value !== 'string')
        throw new contracts_1.DiamondDomainError('invalid-text', `${label} must be a string.`);
    const normalized = value.trim();
    if (!normalized || normalized.length > maximum) {
        throw new contracts_1.DiamondDomainError('invalid-text', `${label} must be between 1 and ${String(maximum)} characters.`);
    }
    return normalized;
}
function requireInteger(value, label, minimum, maximum) {
    if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
        throw new contracts_1.DiamondDomainError('invalid-number', `${label} must be an integer between ${String(minimum)} and ${String(maximum)}.`);
    }
    return Number(value);
}
function requireMember(value, values, label) {
    if (typeof value !== 'string' || !values.includes(value)) {
        throw new contracts_1.DiamondDomainError('invalid-enum', `${label} is not supported.`);
    }
    return value;
}
function requireSide(value, label = 'side') {
    return requireMember(value, SIDES, label);
}
function isDiamondDeliveredPitch(result) {
    return result !== 'balk' && result !== 'pickoff_attempt';
}
function hasCompletePitchOutcomeEvidence(state, result) {
    if (state.captureMode !== 'full')
        return true;
    if (result === 'intentional_walk')
        return true;
    if (result === 'walk')
        return state.inning.balls === 4;
    if (result === 'strikeout' || result === 'dropped_third_strike')
        return state.inning.strikes === 3;
    if (result === 'hit_by_pitch')
        return state.inning.lastPitchResult === 'hit_by_pitch';
    if (result === 'interference')
        return state.inning.lastPitchResult === 'catcher_interference';
    return state.inning.lastPitchResult === 'in_play';
}
function requireEventId(value, label) {
    return requireId(value, label);
}
function requireBattingRole(profile, value, options = {}) {
    const role = requireMember(value, BATTING_ROLES, 'batting role');
    if (role === 'dh' && !profile.allowsDh) {
        throw new contracts_1.DiamondDomainError('rule-not-enabled', 'The selected rules profile does not allow a designated hitter.');
    }
    if (role === 'eh' && !profile.allowsEh) {
        throw new contracts_1.DiamondDomainError('rule-not-enabled', 'The selected rules profile does not allow an extra hitter.');
    }
    if (role === 'ep' && !profile.allowsEp) {
        throw new contracts_1.DiamondDomainError('rule-not-enabled', 'The selected rules profile does not allow an extra player.');
    }
    if ((role === 'dp' || role === 'flex') && !profile.dpFlex.enabled) {
        throw new contracts_1.DiamondDomainError('rule-not-enabled', 'The selected rules profile does not allow DP/FLEX.');
    }
    if (role === 'flex' && options.initialLineup) {
        throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'The starting FLEX is linked through set_dp_flex and does not occupy a separate batting slot.');
    }
    return role;
}
function validateBattingRoleCounts(entries) {
    const count = (role) => entries.filter((entry) => entry.battingRole === role).length;
    if (count('dh') > 1)
        throw new contracts_1.DiamondDomainError('invalid-lineup-role', 'A lineup may contain at most one designated hitter.');
    if (count('dp') > 1)
        throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'A lineup may contain at most one DP batting slot.');
}
function validateBatterAdvanceShape(value) {
    const advance = requireRecord(value, 'batterAdvance');
    requireOnlyFields(advance, BATTER_ADVANCE_FIELDS, 'batterAdvance');
    requireMember(advance.to, DESTINATIONS, 'batter destination');
    if (advance.cause !== undefined)
        requireMember(advance.cause, ADVANCE_CAUSES, 'batter advance cause');
    if (advance.outKind !== undefined)
        requireMember(advance.outKind, OUT_KINDS, 'batter out kind');
    validateScoringCredit(advance, 'batterAdvance');
}
function validateAdvanceShape(value, options = {}) {
    const advance = requireRecord(value, 'runner advance');
    requireOnlyFields(advance, options.standalone ? STANDALONE_RUNNER_ADVANCE_FIELDS : RUNNER_ADVANCE_FIELDS, 'runner advance');
    requireId(advance.runnerId, 'runnerId');
    requireMember(advance.from, BASES, 'runner source');
    requireMember(advance.to, DESTINATIONS, 'runner destination');
    requireMember(advance.cause, ADVANCE_CAUSES, 'runner advance cause');
    if (advance.outKind !== undefined)
        requireMember(advance.outKind, OUT_KINDS, 'out kind');
    validateScoringCredit(advance, 'runner advance');
    if (advance.to === 'out' && !advance.outKind) {
        throw new contracts_1.DiamondDomainError('missing-out-kind', 'A runner recorded out must include an out kind.');
    }
    if (advance.to !== 'out' && advance.outKind) {
        throw new contracts_1.DiamondDomainError('invalid-out-kind', 'Only an out destination may include an out kind.');
    }
}
function oppositeSide(side) {
    return side === 'home' ? 'away' : 'home';
}
function getBattingSide(state) {
    return state.inning.half === 'top' ? 'away' : 'home';
}
function getInningKey(state) {
    return `${state.inning.half === 'top' ? 'T' : 'B'}${String(state.inning.number)}`;
}
function currentHalfRuns(state) {
    return state.inningRuns[getInningKey(state)] ?? 0;
}
function halfInningEnded(state) {
    return state.inning.outs === 3 || state.halfInningEnd !== null;
}
function pristineCurrentHalf(state) {
    return (state.inning.outs === 0 &&
        state.inning.balls === 0 &&
        state.inning.strikes === 0 &&
        state.inning.pitchesInPlateAppearance === 0 &&
        currentHalfRuns(state) === 0 &&
        BASES.every((base) => state.bases[base] === null));
}
function automaticEndingHasEqualOpportunity(state, minimumInning, leader) {
    if (state.inning.number < minimumInning)
        return false;
    if (leader === 'home') {
        return state.inning.half === 'bottom' || halfInningEnded(state) || (state.inning.number > minimumInning && pristineCurrentHalf(state));
    }
    if (state.inning.half === 'bottom')
        return halfInningEnded(state);
    return state.inning.number > minimumInning && pristineCurrentHalf(state);
}
function automaticDiamondFinalizationReason(state) {
    if (state.score.home === state.score.away)
        return null;
    const leader = state.score.home > state.score.away ? 'home' : 'away';
    const differential = Math.abs(state.score.home - state.score.away);
    const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
    const runAhead = profile.runAheadRules.some((rule) => differential >= rule.runDifferential && automaticEndingHasEqualOpportunity(state, rule.afterInning, leader));
    if (runAhead)
        return { kind: 'run-ahead', decisionEventId: null };
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
function getDiamondFinalizationReason(state) {
    if (state.gameEndDecision) {
        return {
            kind: state.gameEndDecision.reason,
            decisionEventId: state.gameEndDecision.decisionEventId
        };
    }
    return automaticDiamondFinalizationReason(state);
}
function requireNoGameEndingCondition(state, nextAction) {
    const ending = getDiamondFinalizationReason(state);
    if (!ending)
        return;
    if (state.gameEndDecision) {
        throw new contracts_1.DiamondDomainError('game-end-decision-recorded', `Finalize the recorded game-ending decision before ${nextAction}.`);
    }
    throw new contracts_1.DiamondDomainError('game-ending-condition-met', `Finalize the ${ending.kind} result before ${nextAction}.`);
}
function currentHalfReachedRunLimit(state) {
    const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
    return profile.inningRunLimit !== null && currentHalfRuns(state) >= profile.inningRunLimit;
}
function requireOpenHalfForPlay(state, options = {}) {
    requireNoGameEndingCondition(state, 'adding another play');
    if (state.inning.outs >= 3 || state.halfInningEnd) {
        throw new contracts_1.DiamondDomainError('half-inning-complete', 'Advance the half inning before adding another play.');
    }
    const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
    if (currentHalfReachedRunLimit(state)) {
        throw new contracts_1.DiamondDomainError('run-limit-decision-required', 'Record the scorer or umpire run-limit decision before adding another play.');
    }
    if (!options.allowPendingTiebreakerPlacement &&
        profile.tiebreaker.enabled &&
        state.inning.number >= profile.tiebreaker.startInning &&
        pristineCurrentHalf(state)) {
        throw new contracts_1.DiamondDomainError('tiebreaker-runner-required', 'Place the configured previous-batter tiebreaker runner before recording the first play.');
    }
}
function initialCoverage(mode) {
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
function createInitialDiamondState(config) {
    requireId(config.teamId, 'teamId');
    requireId(config.gameId, 'gameId');
    requireId(config.rulesProfileId, 'rulesProfileId');
    (0, rules_1.requireDiamondRulesProfile)(config.rulesProfileId, config.rulesProfileVersion);
    if (config.captureMode !== 'quick' && config.captureMode !== 'full') {
        throw new contracts_1.DiamondDomainError('invalid-capture-mode', 'Capture mode must be quick or full.');
    }
    return deepFreeze({
        schemaVersion: contracts_1.DIAMOND_SCHEMA_VERSION,
        reducerVersion: contracts_1.DIAMOND_REDUCER_VERSION,
        statCatalogVersion: contracts_1.DIAMOND_STAT_CATALOG_VERSION,
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
    });
}
function requireLifecycle(state, allowed, action) {
    if (!allowed.includes(state.lifecycle)) {
        throw new contracts_1.DiamondDomainError('invalid-lifecycle', `${action} is not allowed while the scorebook is ${state.lifecycle}.`);
    }
}
function markPartial(state, families) {
    if (!families?.length)
        return state;
    const coverage = { ...state.coverage };
    families.forEach((family) => {
        if (!(family in coverage))
            throw new contracts_1.DiamondDomainError('invalid-stat-family', `Unknown stat family ${family}.`);
        coverage[family] = 'partial';
    });
    return { ...state, coverage };
}
function markPitchObserved(state) {
    if (state.coverage.pitches !== 'not_collected')
        return state;
    return { ...state, coverage: { ...state.coverage, pitches: 'partial' } };
}
function markFieldingObserved(state) {
    if (state.coverage.fielding !== 'not_collected')
        return state;
    return { ...state, coverage: { ...state.coverage, fielding: 'partial' } };
}
function withPartialCoverage(coverage, families) {
    const next = { ...coverage };
    families?.forEach((family) => {
        next[family] = 'partial';
    });
    return next;
}
function fieldingChainsForPlay(event, attached, inline) {
    return [
        ...(inline ? [inline] : []),
        ...(attached.get(event.sourceEventId) ?? []),
        ...(event.eventId === event.sourceEventId ? [] : (attached.get(event.eventId) ?? []))
    ];
}
function judgmentsForPlay(event, attached) {
    return [
        ...(attached.get(event.sourceEventId) ?? []),
        ...(event.eventId === event.sourceEventId ? [] : (attached.get(event.eventId) ?? []))
    ];
}
function latestRunnerJudgmentBoolean(judgments, runnerId, field) {
    for (let index = judgments.length - 1; index >= 0; index -= 1) {
        const judgment = judgments[index];
        if ((!judgment.runnerId || judgment.runnerId === runnerId) && typeof judgment[field] === 'boolean') {
            return judgment[field];
        }
    }
    return undefined;
}
/**
 * Coverage is evidence-derived from the effective ledger, so a later attachment
 * can resolve one omitted judgment and voiding that attachment revokes it again.
 */
function deriveDiamondCoverageFromEvents(initialState, events) {
    let coverage = { ...initialState.coverage };
    const fieldingByPlay = new Map();
    const judgmentsByPlay = new Map();
    events.forEach((event) => {
        if (event.type === 'record_fielding') {
            const payload = event.payload;
            fieldingByPlay.set(payload.playEventId, [...(fieldingByPlay.get(payload.playEventId) ?? []), payload.fielding]);
        }
        if (event.type === 'record_scoring_judgment') {
            const payload = event.payload;
            judgmentsByPlay.set(payload.playEventId, [...(judgmentsByPlay.get(payload.playEventId) ?? []), payload]);
        }
    });
    let state = cloneState(initialState);
    events.forEach((event) => {
        const before = state;
        if (event.type === 'record_pitch' && isDiamondDeliveredPitch(event.payload.result)) {
            if (coverage.pitches === 'not_collected')
                coverage = { ...coverage, pitches: 'partial' };
        }
        if (event.type === 'record_fielding' && coverage.fielding === 'not_collected') {
            coverage = { ...coverage, fielding: 'partial' };
        }
        if (event.type === 'rules_decision') {
            coverage = withPartialCoverage(coverage, event.payload.affectedFamilies);
        }
        if (event.type === 'record_plate_appearance') {
            const payload = event.payload;
            coverage = withPartialCoverage(coverage, payload.omissions);
            if (payload.fielding && coverage.fielding === 'not_collected')
                coverage = { ...coverage, fielding: 'partial' };
            const judgments = judgmentsForPlay(event, judgmentsByPlay);
            const scoringAdvances = [{ runnerId: payload.batterId, ...payload.batterAdvance }, ...payload.runnerAdvances].filter((advance) => advance.to === 'home' && advance.countsRun !== false);
            if (scoringAdvances.some((advance) => {
                const judgment = latestRunnerJudgmentBoolean(judgments, advance.runnerId, 'earned');
                return typeof (judgment ?? advance.earned) !== 'boolean';
            })) {
                coverage = { ...coverage, pitching: 'partial' };
            }
            if (payload.runsBattedIn === undefined &&
                scoringAdvances.some((advance) => {
                    const judgment = latestRunnerJudgmentBoolean(judgments, advance.runnerId, 'rbi');
                    return typeof (judgment ?? advance.rbi) !== 'boolean';
                })) {
                coverage = { ...coverage, batting: 'partial' };
            }
            if (initialState.captureMode === 'full' && !hasCompletePitchOutcomeEvidence(before, payload.result)) {
                coverage = { ...coverage, pitches: 'partial' };
            }
            if (initialState.captureMode === 'full') {
                const chains = fieldingChainsForPlay(event, fieldingByPlay, payload.fielding);
                if (payload.outsOnPlay > 0 && !chains.some((chain) => Boolean(chain.putoutBy))) {
                    coverage = { ...coverage, fielding: 'partial' };
                }
                if (payload.result === 'reached_on_error' && !chains.some((chain) => Boolean(chain.errors?.length))) {
                    coverage = { ...coverage, fielding: 'partial' };
                }
            }
        }
        if (event.type === 'advance_runner') {
            const payload = event.payload;
            coverage = withPartialCoverage(coverage, payload.omissions);
            if (payload.fielding && coverage.fielding === 'not_collected')
                coverage = { ...coverage, fielding: 'partial' };
            if (payload.to === 'home' && payload.countsRun !== false) {
                const judgment = latestRunnerJudgmentBoolean(judgmentsForPlay(event, judgmentsByPlay), payload.runnerId, 'earned');
                if (typeof (judgment ?? payload.earned) !== 'boolean')
                    coverage = { ...coverage, pitching: 'partial' };
            }
            if (initialState.captureMode === 'full' && payload.to === 'out') {
                const chains = fieldingChainsForPlay(event, fieldingByPlay, payload.fielding);
                if (!chains.some((chain) => Boolean(chain.putoutBy)))
                    coverage = { ...coverage, fielding: 'partial' };
            }
        }
        state = reduceDiamondEvent(state, { type: event.type, payload: event.payload, eventId: event.eventId });
        state = setDiamondStateRevision(state, event.revision);
    });
    return deepFreeze(coverage);
}
function expectedBatter(state, side = getBattingSide(state)) {
    const order = state.lineups[side].battingOrder;
    if (!order.length)
        throw new contracts_1.DiamondDomainError('missing-lineup', `${side} batting lineup is empty.`);
    return order[state.nextBatterSlot[side] % order.length];
}
function validateBatterAndPitcher(state, batterId, pitcherId) {
    const side = getBattingSide(state);
    const batter = requireId(batterId, 'batterId');
    const pitcher = requireId(pitcherId, 'pitcherId');
    if (expectedBatter(state, side).activePlayerId !== batter) {
        throw new contracts_1.DiamondDomainError('unexpected-batter', `${batter} is not the current batter.`);
    }
    const defensivePitcher = state.lineups[oppositeSide(side)].defense.P;
    if (!defensivePitcher) {
        throw new contracts_1.DiamondDomainError('missing-defensive-pitcher', 'Set the defensive pitcher before recording a pitch or plate appearance.');
    }
    if (defensivePitcher !== pitcher) {
        throw new contracts_1.DiamondDomainError('unexpected-pitcher', `${pitcher} is not the current defensive pitcher.`);
    }
    return side;
}
function validateFieldingIds(value) {
    const fielding = requireRecord(value, 'fielding');
    requireOnlyFields(fielding, FIELDING_FIELDS, 'fielding');
    if (fielding.putoutBy !== undefined)
        requireId(fielding.putoutBy, 'putoutBy');
    if (fielding.passedBallBy !== undefined)
        requireId(fielding.passedBallBy, 'passedBallBy');
    requireOptionalBoolean(fielding.doublePlay, 'fielding.doublePlay');
    requireOptionalBoolean(fielding.triplePlay, 'fielding.triplePlay');
    if (fielding.doublePlay === true && fielding.triplePlay === true) {
        throw new contracts_1.DiamondDomainError('invalid-fielding-chain', 'A fielding chain cannot be both a double play and a triple play.');
    }
    if (fielding.battedBall !== undefined) {
        requireMember(fielding.battedBall, ['ground', 'line', 'fly', 'bunt', 'unknown'], 'batted ball');
    }
    if (fielding.assists !== undefined && !Array.isArray(fielding.assists)) {
        throw new contracts_1.DiamondDomainError('invalid-fielding-chain', 'Fielding assists must be an array.');
    }
    const assists = fielding.assists ?? [];
    if (assists.length > 4)
        throw new contracts_1.DiamondDomainError('invalid-fielding-chain', 'At most four assists may be recorded.');
    const assistIds = assists.map((id) => requireId(id, 'assist playerId'));
    if (new Set(assistIds).size !== assistIds.length) {
        throw new contracts_1.DiamondDomainError('invalid-fielding-chain', 'A fielder cannot receive duplicate assists on one play.');
    }
    if (fielding.errors !== undefined && !Array.isArray(fielding.errors)) {
        throw new contracts_1.DiamondDomainError('invalid-fielding-chain', 'Fielding errors must be an array.');
    }
    const errors = fielding.errors ?? [];
    if (errors.length > 4)
        throw new contracts_1.DiamondDomainError('invalid-fielding-chain', 'At most four errors may be recorded.');
    errors.forEach((value, index) => {
        const error = requireRecord(value, `fielding.errors[${String(index)}]`);
        requireOnlyFields(error, new Set(['playerId', 'kind']), `fielding.errors[${String(index)}]`);
        requireId(error.playerId, 'error playerId');
        if (error.kind !== undefined)
            requireMember(error.kind, ['fielding', 'throwing'], 'error kind');
    });
    if (fielding.location !== undefined && (typeof fielding.location !== 'string' || fielding.location.length > 80)) {
        throw new contracts_1.DiamondDomainError('invalid-fielding-chain', 'Batted-ball location must be a string of at most 80 characters.');
    }
}
function knownPlayerIds(lineup) {
    return new Set([
        ...lineup.battingOrder.flatMap((entry) => [entry.activePlayerId, entry.starterPlayerId, ...entry.substitutions]),
        ...Object.values(lineup.defense).filter((playerId) => Boolean(playerId)),
        ...(lineup.dpFlex ? [lineup.dpFlex.dpPlayerId, lineup.dpFlex.flexPlayerId] : [])
    ]);
}
function currentBattingParticipantIds(state) {
    const battingIds = knownPlayerIds(state.lineups[getBattingSide(state)]);
    BASES.forEach((base) => {
        const placement = state.bases[base];
        if (!placement)
            return;
        battingIds.add(placement.runnerId);
        if (placement.courtesyForPlayerId)
            battingIds.add(placement.courtesyForPlayerId);
    });
    return battingIds;
}
function validateInlineFieldingParticipants(state, value) {
    const fieldingSide = oppositeSide(getBattingSide(state));
    const defense = state.lineups[fieldingSide].defense;
    const activeDefenders = new Set(Object.values(defense).filter((playerId) => Boolean(playerId)));
    const battingParticipants = currentBattingParticipantIds(state);
    const creditedIds = [
        value.putoutBy,
        ...(value.assists ?? []),
        ...(value.errors ?? []).map((error) => error.playerId),
        value.passedBallBy
    ].filter((playerId) => Boolean(playerId));
    if (creditedIds.some((playerId) => !activeDefenders.has(playerId) || battingParticipants.has(playerId))) {
        throw new contracts_1.DiamondDomainError('invalid-fielding-participant', 'Inline fielding credit must identify an unambiguous player in the active defense for this play.');
    }
    if (value.passedBallBy !== undefined && defense.C !== value.passedBallBy) {
        throw new contracts_1.DiamondDomainError('invalid-fielding-participant', 'A passed ball must be charged to the active defensive catcher.');
    }
}
function validateInlineResponsiblePitcher(state, suppliedPitcherId, expectedPitcherId, label) {
    if (suppliedPitcherId === undefined)
        return;
    if (!expectedPitcherId) {
        throw new contracts_1.DiamondDomainError('pitcher-responsibility-unavailable', `${label} cannot assign pitcher responsibility when the runner's canonical responsibility was not collected. Add a scoring judgment instead.`);
    }
    if (suppliedPitcherId !== expectedPitcherId) {
        throw new contracts_1.DiamondDomainError('unexpected-responsible-pitcher', `${label} must retain the runner's canonical responsible pitcher (${expectedPitcherId}).`);
    }
    if (currentBattingParticipantIds(state).has(suppliedPitcherId)) {
        throw new contracts_1.DiamondDomainError('responsible-pitcher-role-mismatch', `${label} must identify a pitcher unambiguously recorded for the defensive team.`);
    }
}
function validateOutcomeDestination(state, result, destination) {
    requireMember(result, PLATE_APPEARANCE_RESULTS, 'plate appearance result');
    requireMember(destination, DESTINATIONS, 'batter destination');
    const exactDestinations = {
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
        throw new contracts_1.DiamondDomainError('invalid-batter-destination', `${result} requires batter destination ${expected}.`);
    }
    if (result === 'strikeout' && !['out', 'first'].includes(destination)) {
        throw new contracts_1.DiamondDomainError('invalid-batter-destination', 'A strikeout batter must be out or reach first.');
    }
    if (result === 'dropped_third_strike' && destination !== 'out') {
        const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
        if (!profile.droppedThirdStrike.enabled) {
            throw new contracts_1.DiamondDomainError('rule-not-enabled', 'Dropped-third-strike advancement is disabled by this profile.');
        }
        if (profile.droppedThirdStrike.disallowWhenFirstOccupiedWithFewerThanTwoOuts && state.bases.first && state.inning.outs < 2) {
            throw new contracts_1.DiamondDomainError('dropped-third-strike-ineligible', 'The batter cannot advance on a dropped third strike with first occupied and fewer than two outs.');
        }
    }
}
function validateResultSpecificOutCount(result, outsOnPlay) {
    const requiredOuts = result === 'double_play' ? 2 : result === 'triple_play' ? 3 : null;
    if (requiredOuts !== null && outsOnPlay !== requiredOuts) {
        throw new contracts_1.DiamondDomainError('invalid-result-out-count', `${result} requires exactly ${String(requiredOuts)} outs on the play.`);
    }
}
function resolveBatterOutKind(result, destination, supplied) {
    if (destination !== 'out') {
        if (supplied)
            throw new contracts_1.DiamondDomainError('invalid-out-kind', 'Only an out destination may include an out kind.');
        return undefined;
    }
    if (supplied)
        return requireMember(supplied, OUT_KINDS, 'batter out kind');
    if (result === 'strikeout' || result === 'dropped_third_strike')
        return 'strikeout';
    if (result === 'fly_out' || result === 'line_out' || result === 'sacrifice_fly')
        return 'catch';
    if (result === 'ground_out' || result === 'sacrifice_bunt' || result === 'double_play' || result === 'triple_play') {
        return 'batter_runner';
    }
    throw new contracts_1.DiamondDomainError('missing-out-kind', 'An out batter destination requires an out kind.');
}
function validateMandatoryExtraBaseHitAdvances(state, result, runnerMoves) {
    if (result !== 'triple' && result !== 'home_run')
        return;
    for (const base of BASES) {
        const placement = state.bases[base];
        if (!placement)
            continue;
        const move = runnerMoves.find((candidate) => candidate.from === base && candidate.runnerId === placement.runnerId);
        if (!move) {
            throw new contracts_1.DiamondDomainError('missing-mandatory-runner-advance', `${result} must resolve the runner on ${base}.`);
        }
        if (move.to !== 'home' && move.to !== 'out') {
            throw new contracts_1.DiamondDomainError('invalid-mandatory-runner-destination', `${result} must advance the runner on ${base} home or record that runner out.`);
        }
    }
}
function applyMoves(state, side, moves, outsOnPlay, reachedOnEventId) {
    requireInteger(outsOnPlay, 'outsOnPlay', 0, 3);
    if (state.inning.outs + outsOnPlay > 3) {
        throw new contracts_1.DiamondDomainError('too-many-outs', 'A play cannot produce more than three total outs.');
    }
    const sources = moves.map((move) => move.from);
    if (new Set(sources).size !== sources.length) {
        throw new contracts_1.DiamondDomainError('duplicate-runner-source', 'Each runner source may appear only once per play.');
    }
    const runnerIds = moves.map((move) => requireId(move.runnerId, 'runnerId'));
    if (new Set(runnerIds).size !== runnerIds.length) {
        throw new contracts_1.DiamondDomainError('duplicate-runner', 'Each runner may move only once per play.');
    }
    const recordedOuts = moves.filter((move) => move.to === 'out').length;
    if (recordedOuts !== outsOnPlay) {
        throw new contracts_1.DiamondDomainError('outs-mismatch', `outsOnPlay (${String(outsOnPlay)}) must match runner and batter outs (${String(recordedOuts)}).`);
    }
    const bases = {
        first: state.bases.first ? { ...state.bases.first } : null,
        second: state.bases.second ? { ...state.bases.second } : null,
        third: state.bases.third ? { ...state.bases.third } : null
    };
    moves.forEach((move) => {
        if (move.from === 'batter')
            return;
        const placement = bases[move.from];
        if (!placement || placement.runnerId !== move.runnerId) {
            throw new contracts_1.DiamondDomainError('runner-not-on-base', `${move.runnerId} is not on ${move.from}.`);
        }
        bases[move.from] = null;
    });
    const playEndsHalf = state.inning.outs + outsOnPlay === 3;
    const possibleThirdOuts = moves.filter((move) => move.to === 'out');
    // Move arrays have stable serialization but no chronological meaning. Keep
    // countsRun as the scorer's explicit timing judgment and reject it only when
    // every possible third out necessarily cancels the run. Auditing the exact
    // third out would require a future versioned payload field, never array order.
    const thirdOutCancelsRuns = playEndsHalf &&
        possibleThirdOuts.length > 0 &&
        possibleThirdOuts.every((move) => move.from === 'batter' || move.outKind === 'force' || move.outKind === 'batter_runner');
    let runs = 0;
    moves.forEach((move) => {
        if (move.to === 'out')
            return;
        if (move.to === 'home') {
            if (playEndsHalf && move.countsRun === undefined) {
                throw new contracts_1.DiamondDomainError('run-timing-required', 'Every potential run on a third-out play must explicitly declare whether it counts.');
            }
            if (thirdOutCancelsRuns && move.countsRun !== false) {
                throw new contracts_1.DiamondDomainError('run-cannot-count', 'A run cannot count when every possible third out is a force out or retires the batter before first.');
            }
            if (move.countsRun !== false)
                runs += 1;
            return;
        }
        const destination = move.to === 'stay' ? move.from : move.to;
        if (destination === 'batter') {
            throw new contracts_1.DiamondDomainError('invalid-runner-destination', 'A batter cannot remain at the batter source.');
        }
        if (bases[destination]) {
            throw new contracts_1.DiamondDomainError('occupied-base', `${destination} would contain two runners.`);
        }
        bases[destination] = {
            runnerId: move.runnerId,
            chargedToPitcherId: move.chargedToPitcherId,
            courtesyForPlayerId: move.courtesyForPlayerId,
            reachedOnEventId
        };
    });
    const inningKey = getInningKey(state);
    return {
        ...state,
        inning: { ...state.inning, outs: state.inning.outs + outsOnPlay },
        bases,
        score: { ...state.score, [side]: state.score[side] + runs },
        inningRuns: { ...state.inningRuns, [inningKey]: (state.inningRuns[inningKey] ?? 0) + runs }
    };
}
function replaceDefensePlayer(defense, outgoingPlayerId, incomingPlayerId, requestedPosition) {
    const next = { ...defense };
    const currentPosition = Object.entries(next).find(([, playerId]) => playerId === outgoingPlayerId)?.[0];
    if (currentPosition)
        delete next[currentPosition];
    if (requestedPosition) {
        const occupant = next[requestedPosition];
        if (occupant && occupant !== outgoingPlayerId) {
            throw new contracts_1.DiamondDomainError('occupied-position', `${requestedPosition} is already occupied.`);
        }
        next[requestedPosition] = incomingPlayerId;
    }
    else if (currentPosition) {
        next[currentPosition] = incomingPlayerId;
    }
    return next;
}
function transferLiveSubstitutedRunner(state, side, outgoingPlayerId, incomingPlayerId) {
    const liveBattingHalf = side === getBattingSide(state) && state.inning.outs < 3 && state.halfInningEnd === null && getDiamondFinalizationReason(state) === null;
    if (!liveBattingHalf)
        return state.bases;
    const incomingBase = BASES.find((base) => state.bases[base]?.runnerId === incomingPlayerId);
    if (incomingBase) {
        throw new contracts_1.DiamondDomainError('incoming-runner-on-base', 'The incoming substitute is already occupying a base.');
    }
    const outgoingBase = BASES.find((base) => state.bases[base]?.runnerId === outgoingPlayerId);
    if (!outgoingBase)
        return state.bases;
    const placement = state.bases[outgoingBase];
    return {
        ...state.bases,
        [outgoingBase]: { ...placement, runnerId: incomingPlayerId }
    };
}
function reduceSubstitution(state, payload, reentry) {
    requireLifecycle(state, ['active'], reentry ? 're-enter' : 'substitute');
    requireNoGameEndingCondition(state, reentry ? 're-entering a starter' : 'making a substitution');
    const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
    const side = requireSide(payload.side);
    if (payload.defensivePosition)
        requireMember(payload.defensivePosition, FIELDING_POSITIONS, 'defensive position');
    const order = state.lineups[side].battingOrder.map((entry) => ({ ...entry, substitutions: [...entry.substitutions] }));
    const index = order.findIndex((entry) => entry.slot === payload.battingSlot);
    if (index < 0)
        throw new contracts_1.DiamondDomainError('unknown-lineup-slot', 'The batting slot does not exist.');
    const slot = order[index];
    const outgoingPlayerId = reentry
        ? payload.replacedPlayerId
        : payload.outgoingPlayerId;
    const incomingPlayerId = reentry
        ? payload.starterPlayerId
        : payload.incomingPlayerId;
    requireId(outgoingPlayerId, 'outgoingPlayerId');
    requireId(incomingPlayerId, 'incomingPlayerId');
    if (outgoingPlayerId === incomingPlayerId) {
        throw new contracts_1.DiamondDomainError('substitution-no-op', 'The incoming and outgoing players must be different.');
    }
    if (slot.activePlayerId !== outgoingPlayerId) {
        throw new contracts_1.DiamondDomainError('substitution-mismatch', 'The outgoing player is not active in that batting slot.');
    }
    if (order.some((entry, entryIndex) => entryIndex !== index && entry.activePlayerId === incomingPlayerId)) {
        throw new contracts_1.DiamondDomainError('duplicate-active-player', 'The incoming player is already active in the batting order.');
    }
    const lineup = state.lineups[side];
    const dpFlex = lineup.dpFlex;
    if (dpFlex) {
        const pair = new Set([dpFlex.dpPlayerId, dpFlex.flexPlayerId]);
        const touchesPair = pair.has(outgoingPlayerId) || pair.has(incomingPlayerId);
        if (touchesPair) {
            if (slot.slot !== dpFlex.dpBattingSlot ||
                !pair.has(outgoingPlayerId) ||
                !pair.has(incomingPlayerId) ||
                outgoingPlayerId === incomingPlayerId) {
                throw new contracts_1.DiamondDomainError('unsupported-dp-flex-substitution', 'This reducer supports only a direct DP/FLEX exchange in their linked batting slot.');
            }
            if (incomingPlayerId === dpFlex.flexPlayerId && !profile.dpFlex.flexMayBatForDpOnly) {
                throw new contracts_1.DiamondDomainError('rule-not-enabled', 'This rules profile does not allow the FLEX to bat for the DP.');
            }
            if (payload.defensivePosition && payload.defensivePosition !== dpFlex.flexDefensivePosition) {
                throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'A DP/FLEX exchange may use only the configured FLEX defensive position.');
            }
        }
    }
    if (reentry) {
        if (slot.starterPlayerId !== incomingPlayerId) {
            throw new contracts_1.DiamondDomainError('invalid-reentry', 'Only the starter assigned to this slot may re-enter.');
        }
        if (!profile.freeSubstitution && slot.starterReentriesUsed >= profile.starterReentryLimit) {
            throw new contracts_1.DiamondDomainError('reentry-limit', 'The rules profile does not permit another starter re-entry.');
        }
    }
    order[index] = {
        ...slot,
        activePlayerId: incomingPlayerId,
        battingRole: dpFlex && slot.slot === dpFlex.dpBattingSlot && incomingPlayerId === dpFlex.flexPlayerId
            ? 'flex'
            : dpFlex && slot.slot === dpFlex.dpBattingSlot && incomingPlayerId === dpFlex.dpPlayerId
                ? 'dp'
                : slot.battingRole,
        starterReentriesUsed: slot.starterReentriesUsed + (reentry ? 1 : 0),
        substitutions: [...slot.substitutions, incomingPlayerId]
    };
    const bases = transferLiveSubstitutedRunner(state, side, outgoingPlayerId, incomingPlayerId);
    return {
        ...state,
        bases,
        lineups: {
            ...state.lineups,
            [side]: {
                ...lineup,
                battingOrder: order,
                defense: replaceDefensePlayer(lineup.defense, outgoingPlayerId, incomingPlayerId, payload.defensivePosition)
            }
        }
    };
}
function validateDiamondState(state) {
    if (state.schemaVersion !== contracts_1.DIAMOND_SCHEMA_VERSION ||
        state.reducerVersion !== contracts_1.DIAMOND_REDUCER_VERSION ||
        state.statCatalogVersion !== contracts_1.DIAMOND_STAT_CATALOG_VERSION) {
        throw new contracts_1.DiamondDomainError('state-version-mismatch', 'Diamond state versions are not supported.');
    }
    requireMember(state.lifecycle, LIFECYCLES, 'state lifecycle');
    requireMember(state.captureMode, ['quick', 'full'], 'state capture mode');
    requireId(state.teamId, 'state.teamId');
    requireId(state.gameId, 'state.gameId');
    const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
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
    const baseRunners = BASES.flatMap((base) => (state.bases[base] ? [state.bases[base].runnerId] : []));
    if (new Set(baseRunners).size !== baseRunners.length) {
        throw new contracts_1.DiamondDomainError('duplicate-base-runner', 'One runner cannot occupy multiple bases.');
    }
    ['home', 'away'].forEach((side) => {
        const order = state.lineups[side].battingOrder;
        const slots = order.map((entry) => entry.slot);
        const players = order.map((entry) => entry.activePlayerId);
        if (new Set(slots).size !== slots.length || new Set(players).size !== players.length) {
            throw new contracts_1.DiamondDomainError('invalid-lineup', `${side} lineup contains duplicate slots or active players.`);
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
            throw new contracts_1.DiamondDomainError('invalid-defense', `${side} defense contains a duplicate player.`);
        }
        const dpFlex = state.lineups[side].dpFlex;
        if (!dpFlex) {
            if (order.some((entry) => entry.battingRole === 'flex')) {
                throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'A FLEX batter requires an established DP/FLEX pairing.');
            }
            if (state.lifecycle !== 'configured' && state.lifecycle !== 'ready' && order.some((entry) => entry.battingRole === 'dp')) {
                throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'A started lineup with a DP must include an established DP/FLEX pairing.');
            }
            return;
        }
        if (!profile.dpFlex.enabled) {
            throw new contracts_1.DiamondDomainError('rule-not-enabled', 'The selected rules profile does not allow DP/FLEX.');
        }
        const dpPlayerId = requireId(dpFlex.dpPlayerId, 'DP playerId');
        const flexPlayerId = requireId(dpFlex.flexPlayerId, 'FLEX playerId');
        if (dpPlayerId === flexPlayerId)
            throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'DP and FLEX must be different players.');
        requireInteger(dpFlex.dpBattingSlot, 'DP batting slot', 1, 25);
        const flexPosition = requireMember(dpFlex.flexDefensivePosition, FIELDING_POSITIONS, 'FLEX defensive position');
        const dpSlot = order.find((entry) => entry.slot === dpFlex.dpBattingSlot);
        if (!dpSlot || dpSlot.starterPlayerId !== dpPlayerId) {
            throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'The configured DP must be the starter in the linked batting slot.');
        }
        if (dpSlot.activePlayerId !== dpPlayerId && dpSlot.activePlayerId !== flexPlayerId) {
            throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'Only the configured DP or FLEX may occupy the linked batting slot.');
        }
        const expectedRole = dpSlot.activePlayerId === flexPlayerId ? 'flex' : 'dp';
        if (dpSlot.battingRole !== expectedRole) {
            throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'The linked batting role does not match the active DP/FLEX player.');
        }
        const pairAppearsElsewhere = order.some((entry) => entry.slot !== dpFlex.dpBattingSlot &&
            [entry.activePlayerId, entry.starterPlayerId, ...entry.substitutions].some((playerId) => playerId === dpPlayerId || playerId === flexPlayerId));
        if (pairAppearsElsewhere) {
            throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'DP and FLEX may participate in only their linked batting slot.');
        }
        const flexPositionPlayer = state.lineups[side].defense[flexPosition];
        if (flexPositionPlayer !== flexPlayerId && flexPositionPlayer !== dpPlayerId) {
            throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'The configured FLEX defensive position must contain the DP or FLEX.');
        }
    });
    Object.values(state.coverage).forEach((coverage) => {
        if (!COVERAGE_VALUES.includes(coverage)) {
            throw new contracts_1.DiamondDomainError('invalid-coverage', `Invalid coverage value ${String(coverage)}.`);
        }
    });
    if (state.lifecycle !== 'configured' && !state.currentScorerUid) {
        throw new contracts_1.DiamondDomainError('missing-scorer', 'An activated scorebook must have a current scorer.');
    }
    if (state.halfInningEnd) {
        requireMember(state.halfInningEnd.reason, ['run-limit'], 'half-inning end reason');
        requireEventId(state.halfInningEnd.decisionEventId, 'half-inning decisionEventId');
        if (profile.inningRunLimit === null || currentHalfRuns(state) < profile.inningRunLimit) {
            throw new contracts_1.DiamondDomainError('invalid-run-limit-decision', 'The current half inning has not reached its configured run limit.');
        }
    }
    if (state.gameEndDecision) {
        requireMember(state.gameEndDecision.reason, ['time-limit', 'weather', 'forfeit'], 'game-end decision reason');
        requireEventId(state.gameEndDecision.decisionEventId, 'game-end decisionEventId');
        if (state.gameEndDecision.reason === 'time-limit' && profile.timeLimitMinutes === null) {
            throw new contracts_1.DiamondDomainError('invalid-game-end-decision', 'The pinned rules profile does not define a time limit.');
        }
        if (state.gameEndDecision.reason === 'forfeit') {
            requireSide(state.gameEndDecision.awardedSide, 'forfeit awarded side');
        }
        else if (state.gameEndDecision.awardedSide !== null) {
            throw new contracts_1.DiamondDomainError('invalid-game-end-decision', 'Only a forfeit decision may name an awarded side.');
        }
    }
    if (state.cancellation) {
        requireText(state.cancellation.reason, 'cancellation reason', 300);
        requireEventId(state.cancellation.decisionEventId, 'cancellation decisionEventId');
    }
    if (state.lifecycle === 'cancelled') {
        if (!state.cancellation)
            throw new contracts_1.DiamondDomainError('invalid-cancellation', 'A cancelled game requires an audited cancellation.');
        if (state.gameEndDecision || state.finalizationReason || state.finalConfirmedAtRevision !== null) {
            throw new contracts_1.DiamondDomainError('invalid-cancellation', 'A cancelled game cannot also be finalized.');
        }
        if (state.suspendedReason !== null) {
            throw new contracts_1.DiamondDomainError('invalid-cancellation', 'A cancelled game cannot retain a suspended-state reason.');
        }
    }
    else if (state.cancellation) {
        throw new contracts_1.DiamondDomainError('invalid-cancellation', 'Cancellation evidence is valid only for a cancelled game.');
    }
    if (state.lifecycle === 'final') {
        if (!state.finalizationReason || state.finalConfirmedAtRevision === null) {
            throw new contracts_1.DiamondDomainError('invalid-finalization', 'A final game requires an audited finalization reason.');
        }
        requireInteger(state.finalConfirmedAtRevision, 'finalization revision', 1, Number.MAX_SAFE_INTEGER);
        const eligible = getDiamondFinalizationReason({ ...state, finalizationReason: null });
        if (!eligible ||
            eligible.kind !== state.finalizationReason.kind ||
            eligible.decisionEventId !== state.finalizationReason.decisionEventId) {
            throw new contracts_1.DiamondDomainError('invalid-finalization', 'The stored finalization reason is not supported by the game state.');
        }
    }
    else if (state.finalizationReason || state.finalConfirmedAtRevision !== null) {
        throw new contracts_1.DiamondDomainError('invalid-finalization', 'Only a final game may retain a confirmed finalization reason.');
    }
    return state;
}
function reduceDiamondEvent(state, action) {
    validateDiamondState(state);
    let next = cloneState(state);
    switch (action.type) {
        case 'activate': {
            requireLifecycle(state, ['configured'], 'activate');
            const scorer = requireId(action.payload.initialScorerUid, 'initialScorerUid');
            if (action.payload.captureMode !== 'quick' && action.payload.captureMode !== 'full') {
                throw new contracts_1.DiamondDomainError('invalid-capture-mode', 'Capture mode must be quick or full.');
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
            const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
            if (state.lineups[side].dpFlex) {
                throw new contracts_1.DiamondDomainError('dp-flex-already-configured', 'Set the batting lineup before configuring DP/FLEX.');
            }
            if (!Array.isArray(action.payload.entries) || action.payload.entries.length < 1 || action.payload.entries.length > 25) {
                throw new contracts_1.DiamondDomainError('invalid-lineup', 'A lineup must contain between 1 and 25 batting entries.');
            }
            const slots = action.payload.entries.map((entry) => requireInteger(entry.slot, 'batting slot', 1, 25));
            const players = action.payload.entries.map((entry) => requireId(entry.playerId, 'lineup playerId'));
            if (new Set(slots).size !== slots.length || new Set(players).size !== players.length) {
                throw new contracts_1.DiamondDomainError('invalid-lineup', 'Lineup slots and players must be unique.');
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
                substitutions: []
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
                throw new contracts_1.DiamondDomainError('run-limit-decision-required', 'Record the scorer or umpire run-limit decision before changing the defensive alignment.');
            }
            const side = requireSide(action.payload.side);
            if (!Array.isArray(action.payload.assignments) || action.payload.assignments.length > 10) {
                throw new contracts_1.DiamondDomainError('invalid-defense', 'A defensive alignment may contain at most ten assignments.');
            }
            const players = action.payload.assignments.map((assignment) => requireId(assignment.playerId, 'defender playerId'));
            const positions = action.payload.assignments.map((assignment) => requireMember(assignment.position, FIELDING_POSITIONS, 'defensive position'));
            if (new Set(players).size !== players.length || new Set(positions).size !== positions.length) {
                throw new contracts_1.DiamondDomainError('invalid-defense', 'Defensive players and positions must be unique.');
            }
            const defense = Object.fromEntries(action.payload.assignments.map((assignment) => [assignment.position, assignment.playerId]));
            if (state.lifecycle === 'active') {
                const priorPlayers = Object.values(state.lineups[side].defense).filter(Boolean).sort();
                const nextPlayers = Object.values(defense).filter(Boolean).sort();
                if (priorPlayers.length !== nextPlayers.length || priorPlayers.some((playerId, index) => playerId !== nextPlayers[index])) {
                    throw new contracts_1.DiamondDomainError('defensive-personnel-change-requires-substitution', 'Active defensive personnel changes require a substitution or re-entry command.');
                }
                if (!defense.P) {
                    throw new contracts_1.DiamondDomainError('missing-defensive-pitcher', 'An active defensive alignment must identify the pitcher.');
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
            const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
            if (!profile.dpFlex.enabled)
                throw new contracts_1.DiamondDomainError('rule-not-enabled', 'DP/FLEX is disabled by this profile.');
            const side = requireSide(action.payload.side);
            if (state.lineups[side].dpFlex) {
                throw new contracts_1.DiamondDomainError('dp-flex-already-configured', 'DP/FLEX is already configured for this side.');
            }
            const dpPlayerId = requireId(action.payload.dpPlayerId, 'dpPlayerId');
            const flexPlayerId = requireId(action.payload.flexPlayerId, 'flexPlayerId');
            const flexDefensivePosition = requireMember(action.payload.flexDefensivePosition, FIELDING_POSITIONS, 'FLEX defensive position');
            if (dpPlayerId === flexPlayerId)
                throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'DP and FLEX must be different players.');
            const slot = state.lineups[side].battingOrder.find((entry) => entry.slot === action.payload.dpBattingSlot);
            if (!slot || slot.activePlayerId !== dpPlayerId || slot.starterPlayerId !== dpPlayerId || slot.battingRole !== 'dp') {
                throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'The declared batting slot must contain the starting player with the DP role.');
            }
            if (state.lineups[side].battingOrder.some((entry) => [entry.activePlayerId, entry.starterPlayerId, ...entry.substitutions].includes(flexPlayerId))) {
                throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'The starting FLEX cannot also occupy a batting slot.');
            }
            const existingFlexPosition = Object.entries(state.lineups[side].defense).find(([, playerId]) => playerId === flexPlayerId)?.[0];
            if (existingFlexPosition && existingFlexPosition !== flexDefensivePosition) {
                throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'The FLEX is already assigned to a different defensive position.');
            }
            const defensiveOccupant = state.lineups[side].defense[flexDefensivePosition];
            if (defensiveOccupant && defensiveOccupant !== flexPlayerId) {
                throw new contracts_1.DiamondDomainError('occupied-position', `${flexDefensivePosition} is already occupied.`);
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
                throw new contracts_1.DiamondDomainError('missing-lineup', 'Both teams need a batting lineup before the game starts.');
            }
            ['home', 'away'].forEach((side) => {
                if (!state.lineups[side].defense.P) {
                    throw new contracts_1.DiamondDomainError('missing-defensive-pitcher', `${side} must set a defensive pitcher before the game starts.`);
                }
                if (state.lineups[side].battingOrder.some((entry) => entry.battingRole === 'dp') && !state.lineups[side].dpFlex) {
                    throw new contracts_1.DiamondDomainError('missing-dp-flex', `${side} must configure its DP/FLEX pairing before the game starts.`);
                }
            });
            next = { ...next, lifecycle: 'active' };
            break;
        }
        case 'record_pitch': {
            requireLifecycle(state, ['active'], 'record pitch');
            requireOpenHalfForPlay(state);
            if (state.inning.outs >= 3)
                throw new contracts_1.DiamondDomainError('half-inning-complete', 'Advance the half inning first.');
            validateBatterAndPitcher(state, action.payload.batterId, action.payload.pitcherId);
            requireMember(action.payload.result, PITCH_RESULTS, 'pitch result');
            if (state.inning.balls >= 4 || state.inning.strikes >= 3) {
                throw new contracts_1.DiamondDomainError('plate-appearance-pending', 'Resolve the plate appearance before recording another pitch.');
            }
            let balls = state.inning.balls;
            let strikes = state.inning.strikes;
            const deliveredPitch = isDiamondDeliveredPitch(action.payload.result);
            if (action.payload.result === 'ball')
                balls += 1;
            if (action.payload.result === 'called_strike' || action.payload.result === 'swinging_strike')
                strikes += 1;
            if (action.payload.result === 'foul' && strikes < 2)
                strikes += 1;
            if (action.payload.result === 'foul_bunt')
                strikes += 1;
            if (action.payload.result === 'illegal_pitch') {
                const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
                if (profile.illegalPitchPolicy !== 'configurable')
                    balls += 1;
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
            if (deliveredPitch)
                next = markPitchObserved(next);
            break;
        }
        case 'record_plate_appearance': {
            requireLifecycle(state, ['active'], 'record plate appearance');
            requireOpenHalfForPlay(state);
            if (state.inning.outs >= 3)
                throw new contracts_1.DiamondDomainError('half-inning-complete', 'Advance the half inning first.');
            const side = validateBatterAndPitcher(state, action.payload.batterId, action.payload.pitcherId);
            if (BASES.some((base) => state.bases[base]?.runnerId === action.payload.batterId)) {
                throw new contracts_1.DiamondDomainError('batter-on-base', 'The current batter is already recorded as a base runner.');
            }
            validateBatterAdvanceShape(action.payload.batterAdvance);
            validateOutcomeDestination(state, action.payload.result, action.payload.batterAdvance.to);
            const batterOutKind = resolveBatterOutKind(action.payload.result, action.payload.batterAdvance.to, action.payload.batterAdvance.outKind);
            if (action.payload.fielding) {
                validateFieldingIds(action.payload.fielding);
                validateInlineFieldingParticipants(state, action.payload.fielding);
            }
            if (!Array.isArray(action.payload.runnerAdvances)) {
                throw new contracts_1.DiamondDomainError('invalid-runner-advances', 'runnerAdvances must be an array.');
            }
            validateOmissions(action.payload.omissions);
            if (action.payload.runnerAdvances.length > 3) {
                throw new contracts_1.DiamondDomainError('too-many-runner-advances', 'A plate appearance may move at most three existing runners.');
            }
            if (action.payload.runsBattedIn !== undefined) {
                requireInteger(action.payload.runsBattedIn, 'runsBattedIn', 0, 4);
            }
            const outsOnPlay = requireInteger(action.payload.outsOnPlay, 'outsOnPlay', 0, 3);
            validateResultSpecificOutCount(action.payload.result, outsOnPlay);
            const batterMove = {
                runnerId: action.payload.batterId,
                from: 'batter',
                to: action.payload.batterAdvance.to,
                countsRun: action.payload.batterAdvance.countsRun,
                chargedToPitcherId: action.payload.batterAdvance.responsiblePitcherId ?? action.payload.pitcherId,
                courtesyForPlayerId: null,
                outKind: batterOutKind
            };
            validateInlineResponsiblePitcher(state, action.payload.batterAdvance.responsiblePitcherId, action.payload.pitcherId, 'The batter advance');
            const runnerMoves = action.payload.runnerAdvances.map((advance) => {
                validateAdvanceShape(advance);
                const placement = state.bases[requireMember(advance.from, BASES, 'runner source')];
                validateInlineResponsiblePitcher(state, advance.responsiblePitcherId, placement?.chargedToPitcherId ?? null, `The advance for ${advance.runnerId}`);
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
            validateMandatoryExtraBaseHitAdvances(state, action.payload.result, runnerMoves);
            next = applyMoves(state, side, [batterMove, ...runnerMoves], outsOnPlay, action.eventId ?? null);
            const orderLength = state.lineups[side].battingOrder.length;
            next = {
                ...next,
                inning: { ...next.inning, balls: 0, strikes: 0, pitchesInPlateAppearance: 0, lastPitchResult: null },
                nextBatterSlot: { ...next.nextBatterSlot, [side]: (state.nextBatterSlot[side] + 1) % orderLength }
            };
            if (action.payload.fielding)
                next = markFieldingObserved(next);
            next = markPartial(next, action.payload.omissions);
            const scoringAdvances = [action.payload.batterAdvance, ...action.payload.runnerAdvances].filter((advance) => advance.to === 'home' && advance.countsRun !== false);
            if (action.payload.runsBattedIn !== undefined && action.payload.runsBattedIn > scoringAdvances.length) {
                throw new contracts_1.DiamondDomainError('invalid-rbi', 'runsBattedIn cannot exceed the runners whose runs count on the play.');
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
            const missingFullFielding = outsOnPlay > 0 && !action.payload.fielding?.putoutBy;
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
                throw new contracts_1.DiamondDomainError('runner-not-on-base', `${runnerId} is not on ${action.payload.from}.`);
            }
            if (action.payload.fielding) {
                validateFieldingIds(action.payload.fielding);
                validateInlineFieldingParticipants(state, action.payload.fielding);
            }
            validateOmissions(action.payload.omissions);
            validateInlineResponsiblePitcher(state, action.payload.responsiblePitcherId, placement.chargedToPitcherId, `The advance for ${runnerId}`);
            next = applyMoves(state, getBattingSide(state), [
                {
                    runnerId,
                    from: action.payload.from,
                    to: action.payload.to,
                    countsRun: action.payload.countsRun,
                    chargedToPitcherId: action.payload.responsiblePitcherId ?? placement.chargedToPitcherId,
                    courtesyForPlayerId: placement.courtesyForPlayerId,
                    outKind: action.payload.outKind
                }
            ], action.payload.to === 'out' ? 1 : 0, action.eventId ?? placement.reachedOnEventId);
            if (action.payload.fielding)
                next = markFieldingObserved(next);
            next = markPartial(next, action.payload.omissions);
            if (action.payload.to === 'home' && action.payload.countsRun !== false && action.payload.earned === undefined) {
                next = markPartial(next, ['pitching']);
            }
            if (state.captureMode === 'full' && action.payload.to === 'out' && !action.payload.fielding?.putoutBy) {
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
            if (action.payload.runnerId !== undefined)
                requireId(action.payload.runnerId, 'runnerId');
            if (action.payload.responsiblePitcherId !== undefined)
                requireId(action.payload.responsiblePitcherId, 'responsiblePitcherId');
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
                throw new contracts_1.DiamondDomainError('game-end-decision-recorded', 'Finalize the recorded game-ending decision instead of advancing.');
            }
            const ending = automaticDiamondFinalizationReason(state);
            if (ending) {
                throw new contracts_1.DiamondDomainError('game-ending-condition-met', `Finalize the ${ending.kind} result instead of advancing.`);
            }
            if (state.inning.outs !== 3 && !state.halfInningEnd) {
                throw new contracts_1.DiamondDomainError('half-inning-not-complete', 'A half inning advances only after the third out.');
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
            const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
            const side = requireSide(action.payload.side);
            const base = requireMember(action.payload.base, BASES, 'tiebreaker base');
            if (!profile.tiebreaker.enabled || state.inning.number < profile.tiebreaker.startInning) {
                throw new contracts_1.DiamondDomainError('rule-not-enabled', 'The tiebreaker runner is not active for this inning.');
            }
            if (side !== getBattingSide(state) || base !== profile.tiebreaker.runnerBase) {
                throw new contracts_1.DiamondDomainError('invalid-tiebreaker-runner', 'The tiebreaker runner must use the configured batting side and base.');
            }
            if (!pristineCurrentHalf(state)) {
                throw new contracts_1.DiamondDomainError('invalid-tiebreaker-runner', 'The tiebreaker runner must be placed before the first play of the half inning.');
            }
            if (state.bases[base]) {
                throw new contracts_1.DiamondDomainError('occupied-base', 'The configured tiebreaker base is already occupied.');
            }
            const runnerId = requireId(action.payload.runnerId, 'runnerId');
            const order = state.lineups[side].battingOrder;
            if (!order.length)
                throw new contracts_1.DiamondDomainError('missing-lineup', `${side} batting lineup is empty.`);
            const previousBatterIndex = (state.nextBatterSlot[side] - 1 + order.length) % order.length;
            const expectedRunnerId = order[previousBatterIndex].activePlayerId;
            if (profile.tiebreaker.runnerSelection === 'previous-batter' && runnerId !== expectedRunnerId) {
                throw new contracts_1.DiamondDomainError('invalid-tiebreaker-runner', `The tiebreaker runner must be the previous scheduled batter (${expectedRunnerId}).`);
            }
            const currentPitcherId = state.lineups[oppositeSide(side)].defense.P;
            if (!currentPitcherId) {
                throw new contracts_1.DiamondDomainError('missing-defensive-pitcher', 'The tiebreaker runner requires the current defensive pitcher before placement.');
            }
            const suppliedPitcherId = action.payload.chargedToPitcherId === undefined ? undefined : requireId(action.payload.chargedToPitcherId, 'chargedToPitcherId');
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
            const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
            const side = requireSide(action.payload.side);
            const base = requireMember(action.payload.base, BASES, 'courtesy runner base');
            const forRole = requireMember(action.payload.forRole, ['pitcher', 'catcher'], 'courtesy runner role');
            if (!profile.courtesyRunner[forRole]) {
                throw new contracts_1.DiamondDomainError('rule-not-enabled', `Courtesy runners for ${forRole}s are disabled.`);
            }
            if (side !== getBattingSide(state)) {
                throw new contracts_1.DiamondDomainError('invalid-courtesy-runner', 'A courtesy runner may replace only a runner on the batting team.');
            }
            const forPlayerId = requireId(action.payload.forPlayerId, 'forPlayerId');
            const runnerId = requireId(action.payload.runnerId, 'runnerId');
            const placement = state.bases[base];
            if (!placement || placement.runnerId !== forPlayerId) {
                throw new contracts_1.DiamondDomainError('runner-not-on-base', 'The pitcher or catcher is not on the declared base.');
            }
            const position = forRole === 'pitcher' ? 'P' : 'C';
            if (state.lineups[side].defense[position] !== forPlayerId) {
                throw new contracts_1.DiamondDomainError('invalid-courtesy-runner', `The replaced player is not the recorded ${position}.`);
            }
            if (BASES.some((base) => state.bases[base]?.runnerId === runnerId)) {
                throw new contracts_1.DiamondDomainError('duplicate-base-runner', 'The courtesy runner is already on base.');
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
                throw new contracts_1.DiamondDomainError('confirmation-required', 'Cancellation requires explicit confirmation.');
            }
            if (state.gameEndDecision || automaticDiamondFinalizationReason(state)) {
                throw new contracts_1.DiamondDomainError('finalization-required', 'This game has an official ending condition and must be finalized instead.');
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
                throw new contracts_1.DiamondDomainError('confirmation-required', 'Finalization requires explicit confirmation.');
            }
            const reason = getDiamondFinalizationReason(state);
            if (!reason) {
                throw new contracts_1.DiamondDomainError('finalization-not-eligible', 'Finalization requires regulation completion, a walkoff, a run-ahead result, or an explicit supported game-end decision.');
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
            requireText(action.payload.text, 'note', 2000);
            if (action.payload.attachedEventId)
                requireId(action.payload.attachedEventId, 'attachedEventId');
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
                    throw new contracts_1.DiamondDomainError('invalid-coverage-adjustment', 'A coverage adjustment must name at least one stat family.');
                }
            }
            else if (code === 'end_half_inning_run_limit') {
                requireLifecycle(state, ['active'], 'record a run-limit ending');
                const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
                if (profile.inningRunLimit === null) {
                    throw new contracts_1.DiamondDomainError('rule-not-enabled', 'This rules profile does not define an inning run limit.');
                }
                if (state.halfInningEnd) {
                    throw new contracts_1.DiamondDomainError('half-inning-complete', 'The current half inning already has an ending decision.');
                }
                if (state.gameEndDecision || automaticDiamondFinalizationReason(state)) {
                    throw new contracts_1.DiamondDomainError('finalization-required', 'Finalize the game-ending condition instead of ending only the half inning.');
                }
                if (currentHalfRuns(state) < profile.inningRunLimit) {
                    throw new contracts_1.DiamondDomainError('run-limit-not-reached', `The current half inning has not reached its ${String(profile.inningRunLimit)}-run limit.`);
                }
                next = {
                    ...next,
                    halfInningEnd: { reason: 'run-limit', decisionEventId }
                };
            }
            else {
                const isForfeit = code === 'end_game_forfeit_home' || code === 'end_game_forfeit_away';
                const allowedLifecycles = isForfeit
                    ? ['ready', 'active', 'suspended', 'correction']
                    : ['active', 'suspended', 'correction'];
                requireLifecycle(state, allowedLifecycles, 'record a game-ending decision');
                if (state.gameEndDecision) {
                    throw new contracts_1.DiamondDomainError('game-end-decision-exists', 'A game-ending decision is already recorded.');
                }
                if (automaticDiamondFinalizationReason(state)) {
                    throw new contracts_1.DiamondDomainError('finalization-required', 'Finalize the existing automatic game-ending condition instead.');
                }
                const reason = code === 'end_game_time_limit' ? 'time-limit' : code === 'end_game_weather' ? 'weather' : 'forfeit';
                if (reason === 'time-limit') {
                    const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
                    if (profile.timeLimitMinutes === null) {
                        throw new contracts_1.DiamondDomainError('rule-not-enabled', 'This rules profile does not define a time limit.');
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
            const exhaustive = action;
            throw new contracts_1.DiamondDomainError('unsupported-command', `Unsupported command ${String(exhaustive)}.`);
        }
    }
    return deepFreeze(validateDiamondState(next));
}
function setDiamondStateRevision(state, revision, checkpointHash = state.checkpointHash) {
    return deepFreeze(validateDiamondState({
        ...cloneState(state),
        revision: requireInteger(revision, 'revision', 0, Number.MAX_SAFE_INTEGER),
        checkpointHash
    }));
}
function cloneDiamondState(state) {
    return deepFreeze(cloneState(state));
}
function runnerAdvanceToMove(advance, placement) {
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
