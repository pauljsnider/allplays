"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBattingSide = getBattingSide;
exports.createInitialDiamondState = createInitialDiamondState;
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
const LIFECYCLES = ['configured', 'ready', 'active', 'suspended', 'final', 'correction'];
const POSITIONS = [
    'P',
    'C',
    '1B',
    '2B',
    '3B',
    'SS',
    'LF',
    'LCF',
    'CF',
    'RCF',
    'RF',
    'DP',
    'FLEX',
    'EH',
    'EP'
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
        coverage: { ...state.coverage }
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
function validateAdvanceShape(advance) {
    requireId(advance.runnerId, 'runnerId');
    requireMember(advance.from, BASES, 'runner source');
    requireMember(advance.to, DESTINATIONS, 'runner destination');
    requireMember(advance.cause, ADVANCE_CAUSES, 'runner advance cause');
    if (advance.outKind !== undefined)
        requireMember(advance.outKind, OUT_KINDS, 'out kind');
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
        inning: { number: 1, half: 'top', outs: 0, balls: 0, strikes: 0, pitchesInPlateAppearance: 0 },
        score: { home: 0, away: 0 },
        inningRuns: {},
        bases: { ...EMPTY_BASES },
        lineups: { home: cloneLineup(EMPTY_LINEUP), away: cloneLineup(EMPTY_LINEUP) },
        nextBatterSlot: { home: 0, away: 0 },
        coverage: initialCoverage(config.captureMode),
        suspendedReason: null,
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
    if (defensivePitcher && defensivePitcher !== pitcher) {
        throw new contracts_1.DiamondDomainError('unexpected-pitcher', `${pitcher} is not the current defensive pitcher.`);
    }
    return side;
}
function validateFieldingIds(fielding) {
    if (fielding.putoutBy)
        requireId(fielding.putoutBy, 'putoutBy');
    if (fielding.passedBallBy)
        requireId(fielding.passedBallBy, 'passedBallBy');
    const assists = fielding.assists ?? [];
    if (assists.length > 4)
        throw new contracts_1.DiamondDomainError('invalid-fielding-chain', 'At most four assists may be recorded.');
    const assistIds = assists.map((id) => requireId(id, 'assist playerId'));
    if (new Set(assistIds).size !== assistIds.length) {
        throw new contracts_1.DiamondDomainError('invalid-fielding-chain', 'A fielder cannot receive duplicate assists on one play.');
    }
    const errors = fielding.errors ?? [];
    if (errors.length > 4)
        throw new contracts_1.DiamondDomainError('invalid-fielding-chain', 'At most four errors may be recorded.');
    errors.forEach((error) => requireId(error.playerId, 'error playerId'));
    if (fielding.location !== undefined && String(fielding.location).length > 80) {
        throw new contracts_1.DiamondDomainError('invalid-fielding-chain', 'Batted-ball location must be at most 80 characters.');
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
    const thirdOutCancelsRuns = playEndsHalf && moves.some((move) => move.to === 'out' && (move.outKind === 'force' || move.outKind === 'batter_runner'));
    let runs = 0;
    moves.forEach((move) => {
        if (move.to === 'out')
            return;
        if (move.to === 'home') {
            if (playEndsHalf && move.countsRun === undefined) {
                throw new contracts_1.DiamondDomainError('run-timing-required', 'Every potential run on a third-out play must explicitly declare whether it counts.');
            }
            if (thirdOutCancelsRuns && move.countsRun !== false) {
                throw new contracts_1.DiamondDomainError('run-cannot-count', 'A run cannot count when the third out is a force out or the batter-runner is retired before first.');
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
function reduceSubstitution(state, payload, reentry) {
    requireLifecycle(state, ['active'], reentry ? 're-enter' : 'substitute');
    const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
    const side = requireSide(payload.side);
    if (payload.defensivePosition)
        requireMember(payload.defensivePosition, POSITIONS, 'defensive position');
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
    if (slot.activePlayerId !== outgoingPlayerId) {
        throw new contracts_1.DiamondDomainError('substitution-mismatch', 'The outgoing player is not active in that batting slot.');
    }
    if (order.some((entry, entryIndex) => entryIndex !== index && entry.activePlayerId === incomingPlayerId)) {
        throw new contracts_1.DiamondDomainError('duplicate-active-player', 'The incoming player is already active in the batting order.');
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
        starterReentriesUsed: slot.starterReentriesUsed + (reentry ? 1 : 0),
        substitutions: [...slot.substitutions, incomingPlayerId]
    };
    const lineup = state.lineups[side];
    return {
        ...state,
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
    (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
    requireInteger(state.revision, 'state.revision', 0, Number.MAX_SAFE_INTEGER);
    requireInteger(state.inning.number, 'inning number', 1, 999);
    requireInteger(state.inning.outs, 'outs', 0, 3);
    requireInteger(state.inning.balls, 'balls', 0, 4);
    requireInteger(state.inning.strikes, 'strikes', 0, 3);
    requireInteger(state.inning.pitchesInPlateAppearance, 'pitches in plate appearance', 0, Number.MAX_SAFE_INTEGER);
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
            requireMember(entry.battingRole, ['regular', 'dp', 'flex', 'eh', 'ep'], 'batting role');
        });
        const defensivePlayers = Object.entries(state.lineups[side].defense).map(([position, playerId]) => {
            requireMember(position, POSITIONS, 'defensive position');
            return requireId(playerId, 'defensive playerId');
        });
        if (new Set(defensivePlayers).size !== defensivePlayers.length) {
            throw new contracts_1.DiamondDomainError('invalid-defense', `${side} defense contains a duplicate player.`);
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
            const side = requireSide(action.payload.side);
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
                battingRole: requireMember(entry.battingRole ?? 'regular', ['regular', 'dp', 'flex', 'eh', 'ep'], 'batting role'),
                starterReentriesUsed: 0,
                substitutions: []
            }))
                .sort((left, right) => left.slot - right.slot);
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
            const side = requireSide(action.payload.side);
            if (!Array.isArray(action.payload.assignments) || action.payload.assignments.length > 10) {
                throw new contracts_1.DiamondDomainError('invalid-defense', 'A defensive alignment may contain at most ten assignments.');
            }
            const players = action.payload.assignments.map((assignment) => requireId(assignment.playerId, 'defender playerId'));
            const positions = action.payload.assignments.map((assignment) => requireMember(assignment.position, POSITIONS, 'defensive position'));
            if (new Set(players).size !== players.length || new Set(positions).size !== positions.length) {
                throw new contracts_1.DiamondDomainError('invalid-defense', 'Defensive players and positions must be unique.');
            }
            const defense = Object.fromEntries(action.payload.assignments.map((assignment) => [assignment.position, assignment.playerId]));
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
            requireLifecycle(state, ['ready', 'active'], 'set DP/FLEX');
            const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
            if (!profile.dpFlex.enabled)
                throw new contracts_1.DiamondDomainError('rule-not-enabled', 'DP/FLEX is disabled by this profile.');
            const dpPlayerId = requireId(action.payload.dpPlayerId, 'dpPlayerId');
            const flexPlayerId = requireId(action.payload.flexPlayerId, 'flexPlayerId');
            const side = requireSide(action.payload.side);
            const flexDefensivePosition = requireMember(action.payload.flexDefensivePosition, POSITIONS, 'FLEX defensive position');
            if (dpPlayerId === flexPlayerId)
                throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'DP and FLEX must be different players.');
            const slot = state.lineups[side].battingOrder.find((entry) => entry.slot === action.payload.dpBattingSlot);
            if (!slot || slot.activePlayerId !== dpPlayerId) {
                throw new contracts_1.DiamondDomainError('invalid-dp-flex', 'The DP must occupy the declared batting slot.');
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
            if (!state.lineups.home.battingOrder.length || !state.lineups.away.battingOrder.length) {
                throw new contracts_1.DiamondDomainError('missing-lineup', 'Both teams need a batting lineup before the game starts.');
            }
            next = { ...next, lifecycle: 'active' };
            break;
        }
        case 'record_pitch': {
            requireLifecycle(state, ['active'], 'record pitch');
            if (state.inning.outs >= 3)
                throw new contracts_1.DiamondDomainError('half-inning-complete', 'Advance the half inning first.');
            validateBatterAndPitcher(state, action.payload.batterId, action.payload.pitcherId);
            requireMember(action.payload.result, PITCH_RESULTS, 'pitch result');
            if (state.inning.balls >= 4 || state.inning.strikes >= 3) {
                throw new contracts_1.DiamondDomainError('plate-appearance-pending', 'Resolve the plate appearance before recording another pitch.');
            }
            let balls = state.inning.balls;
            let strikes = state.inning.strikes;
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
            next = markPitchObserved({
                ...next,
                inning: {
                    ...next.inning,
                    balls: Math.min(balls, 4),
                    strikes: Math.min(strikes, 3),
                    pitchesInPlateAppearance: state.inning.pitchesInPlateAppearance + 1
                }
            });
            break;
        }
        case 'record_plate_appearance': {
            requireLifecycle(state, ['active'], 'record plate appearance');
            if (state.inning.outs >= 3)
                throw new contracts_1.DiamondDomainError('half-inning-complete', 'Advance the half inning first.');
            const side = validateBatterAndPitcher(state, action.payload.batterId, action.payload.pitcherId);
            if (BASES.some((base) => state.bases[base]?.runnerId === action.payload.batterId)) {
                throw new contracts_1.DiamondDomainError('batter-on-base', 'The current batter is already recorded as a base runner.');
            }
            validateOutcomeDestination(state, action.payload.result, action.payload.batterAdvance.to);
            const batterOutKind = resolveBatterOutKind(action.payload.result, action.payload.batterAdvance.to, action.payload.batterAdvance.outKind);
            if (action.payload.fielding)
                validateFieldingIds(action.payload.fielding);
            if (!Array.isArray(action.payload.runnerAdvances)) {
                throw new contracts_1.DiamondDomainError('invalid-runner-advances', 'runnerAdvances must be an array.');
            }
            if (action.payload.runnerAdvances.length > 3) {
                throw new contracts_1.DiamondDomainError('too-many-runner-advances', 'A plate appearance may move at most three existing runners.');
            }
            const batterMove = {
                runnerId: action.payload.batterId,
                from: 'batter',
                to: action.payload.batterAdvance.to,
                countsRun: action.payload.batterAdvance.countsRun,
                chargedToPitcherId: action.payload.batterAdvance.responsiblePitcherId ?? action.payload.pitcherId,
                courtesyForPlayerId: null,
                outKind: batterOutKind
            };
            const runnerMoves = action.payload.runnerAdvances.map((advance) => {
                validateAdvanceShape(advance);
                const placement = state.bases[requireMember(advance.from, BASES, 'runner source')];
                return {
                    runnerId: advance.runnerId,
                    from: advance.from,
                    to: advance.to,
                    countsRun: advance.countsRun,
                    chargedToPitcherId: advance.responsiblePitcherId ?? placement?.chargedToPitcherId ?? action.payload.pitcherId,
                    courtesyForPlayerId: placement?.courtesyForPlayerId ?? null,
                    outKind: advance.outKind
                };
            });
            next = applyMoves(state, side, [batterMove, ...runnerMoves], action.payload.outsOnPlay, action.eventId ?? null);
            const orderLength = state.lineups[side].battingOrder.length;
            next = {
                ...next,
                inning: { ...next.inning, balls: 0, strikes: 0, pitchesInPlateAppearance: 0 },
                nextBatterSlot: { ...next.nextBatterSlot, [side]: (state.nextBatterSlot[side] + 1) % orderLength }
            };
            next = markPartial(next, action.payload.omissions);
            const scoringAdvances = [action.payload.batterAdvance, ...action.payload.runnerAdvances].filter((advance) => advance.to === 'home' && advance.countsRun !== false);
            if (scoringAdvances.some((advance) => advance.earned === undefined)) {
                next = markPartial(next, ['pitching']);
            }
            if (action.payload.runsBattedIn === undefined && scoringAdvances.some((advance) => advance.rbi === undefined)) {
                next = markPartial(next, ['batting']);
            }
            if (state.captureMode === 'full' && state.inning.pitchesInPlateAppearance === 0) {
                next = markPartial(next, ['pitches']);
            }
            if (state.captureMode === 'full' && !action.payload.fielding && action.payload.outsOnPlay > 0) {
                next = markPartial(next, ['fielding']);
            }
            break;
        }
        case 'advance_runner': {
            requireLifecycle(state, ['active'], 'advance runner');
            validateAdvanceShape(action.payload);
            const runnerId = requireId(action.payload.runnerId, 'runnerId');
            const placement = state.bases[action.payload.from];
            if (!placement || placement.runnerId !== runnerId) {
                throw new contracts_1.DiamondDomainError('runner-not-on-base', `${runnerId} is not on ${action.payload.from}.`);
            }
            if (action.payload.fielding)
                validateFieldingIds(action.payload.fielding);
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
            next = markPartial(next, action.payload.omissions);
            if (action.payload.to === 'home' && action.payload.countsRun !== false && action.payload.earned === undefined) {
                next = markPartial(next, ['pitching']);
            }
            break;
        }
        case 'record_fielding': {
            requireLifecycle(state, ['active', 'correction'], 'record fielding');
            requireId(action.payload.playEventId, 'playEventId');
            validateFieldingIds(action.payload.fielding);
            next = markFieldingObserved(next);
            break;
        }
        case 'record_scoring_judgment': {
            requireLifecycle(state, ['active', 'correction'], 'record scoring judgment');
            requireId(action.payload.playEventId, 'playEventId');
            if (action.payload.runnerId)
                requireId(action.payload.runnerId, 'runnerId');
            if (action.payload.responsiblePitcherId)
                requireId(action.payload.responsiblePitcherId, 'responsiblePitcherId');
            if (action.payload.pitcherOfRecord) {
                requireSide(action.payload.pitcherOfRecord.side, 'pitcherOfRecord.side');
                requireId(action.payload.pitcherOfRecord.playerId, 'pitcherOfRecord.playerId');
                requireMember(action.payload.pitcherOfRecord.decision, ['win', 'loss', 'save'], 'pitcher decision');
            }
            break;
        }
        case 'advance_half_inning': {
            requireLifecycle(state, ['active'], 'advance half inning');
            if (state.inning.outs !== 3) {
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
                    pitchesInPlateAppearance: 0
                },
                bases: { ...EMPTY_BASES }
            };
            break;
        }
        case 'place_tiebreaker_runner': {
            requireLifecycle(state, ['active'], 'place tiebreaker runner');
            const profile = (0, rules_1.requireDiamondRulesProfile)(state.rulesProfileId, state.rulesProfileVersion);
            const side = requireSide(action.payload.side);
            const base = requireMember(action.payload.base, BASES, 'tiebreaker base');
            if (!profile.tiebreaker.enabled || state.inning.number < profile.tiebreaker.startInning) {
                throw new contracts_1.DiamondDomainError('rule-not-enabled', 'The tiebreaker runner is not active for this inning.');
            }
            if (side !== getBattingSide(state) || base !== profile.tiebreaker.runnerBase) {
                throw new contracts_1.DiamondDomainError('invalid-tiebreaker-runner', 'The tiebreaker runner must use the configured batting side and base.');
            }
            if (state.bases[base]) {
                throw new contracts_1.DiamondDomainError('occupied-base', 'The configured tiebreaker base is already occupied.');
            }
            const runnerId = requireId(action.payload.runnerId, 'runnerId');
            next = {
                ...next,
                bases: {
                    ...next.bases,
                    [base]: {
                        runnerId,
                        chargedToPitcherId: action.payload.chargedToPitcherId
                            ? requireId(action.payload.chargedToPitcherId, 'chargedToPitcherId')
                            : null,
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
            requireLifecycle(state, ['ready', 'active', 'suspended', 'correction'], 'scorer handoff');
            next = { ...next, currentScorerUid: requireId(action.payload.toUid, 'toUid') };
            break;
        }
        case 'suspend': {
            requireLifecycle(state, ['active'], 'suspend');
            next = { ...next, lifecycle: 'suspended', suspendedReason: requireText(action.payload.reason, 'reason', 300) };
            break;
        }
        case 'resume': {
            requireLifecycle(state, ['suspended'], 'resume');
            next = { ...next, lifecycle: 'active', suspendedReason: null };
            break;
        }
        case 'finalize': {
            requireLifecycle(state, ['active', 'correction'], 'finalize');
            if (action.payload.confirmed !== true) {
                throw new contracts_1.DiamondDomainError('confirmation-required', 'Finalization requires explicit confirmation.');
            }
            next = { ...next, lifecycle: 'final', finalConfirmedAtRevision: state.revision + 1, suspendedReason: null };
            break;
        }
        case 'reopen_for_correction': {
            requireLifecycle(state, ['final'], 'reopen for correction');
            requireText(action.payload.reason, 'reason', 300);
            next = { ...next, lifecycle: 'correction', finalConfirmedAtRevision: null };
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
            requireText(action.payload.code, 'decision code', 80);
            requireText(action.payload.description, 'decision description', 500);
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
