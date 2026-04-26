const BASEBALL_SPORTS = new Set(['baseball', 'softball']);

function normalizeSport(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeInning(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeHalf(value) {
    return String(value || '').trim().toLowerCase() === 'bottom' ? 'bottom' : 'top';
}

function normalizeCount(value, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(max, parsed));
}

function normalizeScore(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeBases(bases = {}) {
    return {
        first: !!bases.first,
        second: !!bases.second,
        third: !!bases.third
    };
}

function countOccupiedBases(bases = {}) {
    return [bases.first, bases.second, bases.third].filter(Boolean).length;
}

function addRuns(state, runs) {
    if (!runs) return { ...state };
    if (state.half === 'top') {
        return { ...state, awayScore: state.awayScore + runs };
    }
    return { ...state, homeScore: state.homeScore + runs };
}

function resetCount(state) {
    return { ...state, balls: 0, strikes: 0 };
}

function advanceHalfInning(state) {
    const nextHalf = state.half === 'top' ? 'bottom' : 'top';
    const nextInning = state.half === 'bottom' ? state.inning + 1 : state.inning;
    return {
        ...state,
        inning: nextInning,
        half: nextHalf,
        balls: 0,
        strikes: 0,
        outs: 0,
        bases: normalizeBases()
    };
}

function describeScoreChange(state, nextState) {
    const homeDelta = nextState.homeScore - state.homeScore;
    const awayDelta = nextState.awayScore - state.awayScore;
    const runs = homeDelta + awayDelta;
    if (runs <= 0) return '';
    return `, ${runs} run${runs === 1 ? '' : 's'} scored`;
}

function applyWalk(state) {
    const bases = normalizeBases(state.bases);
    const runs = bases.first && bases.second && bases.third ? 1 : 0;
    const nextBases = {
        first: true,
        second: bases.first || bases.second,
        third: bases.third || (bases.first && bases.second)
    };
    let nextState = resetCount({ ...state, bases: nextBases });
    nextState = addRuns(nextState, runs);
    return {
        state: nextState,
        description: `Walk${describeScoreChange(state, nextState)}`
    };
}

function applyHit(state, basesAdvanced, label) {
    const bases = normalizeBases(state.bases);
    let runs = 0;
    let nextBases = normalizeBases();

    if (basesAdvanced === 1) {
        runs = bases.third ? 1 : 0;
        nextBases = {
            first: true,
            second: bases.first,
            third: bases.second
        };
    } else if (basesAdvanced === 2) {
        runs = (bases.third ? 1 : 0) + (bases.second ? 1 : 0);
        nextBases = {
            first: false,
            second: true,
            third: bases.first
        };
    } else if (basesAdvanced === 3) {
        runs = countOccupiedBases(bases);
        nextBases = {
            first: false,
            second: false,
            third: true
        };
    } else {
        runs = countOccupiedBases(bases) + 1;
    }

    let nextState = resetCount({ ...state, bases: nextBases });
    nextState = addRuns(nextState, runs);
    return {
        state: nextState,
        description: `${label}${describeScoreChange(state, nextState)}`
    };
}

function applyOut(state, label = 'Out') {
    const outs = state.outs + 1;
    if (outs >= 3) {
        const nextState = advanceHalfInning({ ...state, outs });
        return {
            state: nextState,
            description: `${label}, side retired. Now ${getBaseballPeriodLabel(nextState)}`
        };
    }

    const nextState = resetCount({ ...state, outs });
    return {
        state: nextState,
        description: `${label} ${outs}`
    };
}

export function isBaseballScorekeepingSport(sport) {
    return BASEBALL_SPORTS.has(normalizeSport(sport));
}

export function createBaseballLiveState({
    inning = 1,
    half = 'top',
    balls = 0,
    strikes = 0,
    outs = 0,
    bases = {},
    homeScore = 0,
    awayScore = 0
} = {}) {
    return {
        inning: normalizeInning(inning),
        half: normalizeHalf(half),
        balls: normalizeCount(balls, 3),
        strikes: normalizeCount(strikes, 2),
        outs: normalizeCount(outs, 2),
        bases: normalizeBases(bases),
        homeScore: normalizeScore(homeScore),
        awayScore: normalizeScore(awayScore)
    };
}

export function parseBaseballPeriodLabel(label) {
    const match = String(label || '').trim().toUpperCase().match(/^([TB])(\d+)$/);
    if (!match) return null;
    return {
        half: match[1] === 'B' ? 'bottom' : 'top',
        inning: normalizeInning(match[2])
    };
}

export function getBaseballPeriodLabel(state = {}) {
    const halfPrefix = normalizeHalf(state.half) === 'bottom' ? 'B' : 'T';
    return `${halfPrefix}${normalizeInning(state.inning)}`;
}

export function getBaseballSituationSummary(state = {}) {
    const normalized = createBaseballLiveState(state);
    const occupied = [];
    if (normalized.bases.first) occupied.push('1B');
    if (normalized.bases.second) occupied.push('2B');
    if (normalized.bases.third) occupied.push('3B');
    return `${getBaseballPeriodLabel(normalized)} ${normalized.balls}-${normalized.strikes}, ${normalized.outs} out${normalized.outs === 1 ? '' : 's'}, ${occupied.join('/') || 'bases empty'}`;
}

export function applyBaseballScorekeepingAction(state = {}, action = '') {
    const normalized = createBaseballLiveState(state);
    const actionType = String(action?.type || action || '').trim();

    if (actionType === 'ball') {
        if (normalized.balls >= 3) return applyWalk({ ...normalized, balls: 3 });
        const nextState = { ...normalized, balls: normalized.balls + 1 };
        return {
            state: nextState,
            description: `Ball ${nextState.balls}`
        };
    }

    if (actionType === 'strike') {
        if (normalized.strikes >= 2) return applyOut({ ...normalized, strikes: 2 }, 'Strikeout');
        const nextState = { ...normalized, strikes: normalized.strikes + 1 };
        return {
            state: nextState,
            description: `Strike ${nextState.strikes}`
        };
    }

    if (actionType === 'foul') {
        const nextState = {
            ...normalized,
            strikes: Math.min(2, normalized.strikes + 1)
        };
        return {
            state: nextState,
            description: `Foul ball (${nextState.balls}-${nextState.strikes})`
        };
    }

    if (actionType === 'walk') return applyWalk(normalized);
    if (actionType === 'single') return applyHit(normalized, 1, 'Single');
    if (actionType === 'double') return applyHit(normalized, 2, 'Double');
    if (actionType === 'triple') return applyHit(normalized, 3, 'Triple');
    if (actionType === 'homeRun') return applyHit(normalized, 4, 'Home run');
    if (actionType === 'out') return applyOut(normalized);

    if (actionType === 'clearBases') {
        const nextState = {
            ...normalized,
            bases: normalizeBases()
        };
        return {
            state: nextState,
            description: 'Bases cleared'
        };
    }

    return {
        state: normalized,
        description: 'Unsupported baseball scorekeeping action'
    };
}
