export const DIAMOND_ENGINE = 'diamond-v2';
export const DIAMOND_POLICY_MODES = Object.freeze(['disabled', 'internal', 'pilot', 'enabled']);

const TERMINAL_GAME_STATES = new Set(['completed', 'final', 'cancelled', 'canceled', 'deleted']);
const DIAMOND_SPORTS = new Set(['baseball', 'softball', 'fastpitch', 'fastpitch softball']);

function compactText(value, maxLength = 256) {
    if (typeof value !== 'string' && typeof value !== 'number') return '';
    return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function normalizeDiamondSport(value) {
    const sport = compactText(value, 64).toLowerCase();
    if (sport === 'baseball') return 'baseball';
    if (sport === 'softball' || sport === 'fastpitch' || sport === 'fastpitch softball') return 'softball';
    return '';
}

export function normalizeDiamondPolicy(policy) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
        return { mode: 'disabled', revision: 0, teamIds: [], reason: 'missing-policy' };
    }
    const mode = compactText(policy.mode, 24).toLowerCase();
    const revision = Number(policy.revision);
    if (!DIAMOND_POLICY_MODES.includes(mode) || !Number.isInteger(revision) || revision < 1) {
        return { mode: 'disabled', revision: 0, teamIds: [], reason: 'invalid-policy' };
    }
    const teamIds = Array.isArray(policy.teamIds)
        ? [...new Set(policy.teamIds.map((id) => compactText(id, 128)).filter(Boolean))].slice(0, 500)
        : [];
    return { mode, revision, teamIds, reason: null };
}

export function hasMeaningfulLegacyTracking(game = {}) {
    if (!game || typeof game !== 'object' || Array.isArray(game)) return false;
    const status = compactText(game.status || game.liveStatus, 32).toLowerCase();
    const scoreIsMeaningful = [game.homeScore, game.awayScore, game.teamScore, game.opponentScore]
        .some((value) => Number.isFinite(Number(value)) && Number(value) !== 0);
    const collectionEvidence = [
        game.hasLegacyEvents,
        game.hasLegacyAggregates,
        game.hasLegacyLiveEvents,
        game.hasLegacyTeamStats,
        game.hasLegacyPrivatePlayerStats
    ].some((value) => value === true);
    const stateEvidence = Boolean(
        game.liveBaseballState ||
        game.currentPeriod ||
        game.liveClockRunning ||
        game.trackingStartedAt ||
        game.trackerStartedAt
    );
    return TERMINAL_GAME_STATES.has(status) || scoreIsMeaningful || collectionEvidence || stateEvidence;
}

export function resolveDiamondGameRoute({
    team = {},
    game = {},
    policy = null,
    teamSettings = null,
    canManage = false,
    canScore = false
} = {}) {
    const engine = compactText(game.trackingEngine, 64);
    const sport = normalizeDiamondSport(game.sport || team.sport);

    if (engine === DIAMOND_ENGINE) {
        return {
            engine: DIAMOND_ENGINE,
            scorer: canScore ? 'diamond' : 'read-only',
            viewer: 'diamond',
            canActivate: false,
            reason: canScore ? null : 'read-only-access'
        };
    }
    if (engine) {
        return {
            engine,
            scorer: 'blocked',
            viewer: 'classic',
            canActivate: false,
            reason: 'unknown-engine'
        };
    }

    const normalizedPolicy = normalizeDiamondPolicy(policy);
    const activeTeam = team.active !== false && team.archived !== true &&
        !['archived', 'inactive', 'disabled'].includes(compactText(team.status, 32).toLowerCase());
    const optedIn = teamSettings?.enabled === true;
    const cohortAllowed = normalizedPolicy.mode === 'enabled' ||
        (['internal', 'pilot'].includes(normalizedPolicy.mode) && normalizedPolicy.teamIds.includes(compactText(team.id, 128)));
    const eligible = Boolean(
        sport &&
        activeTeam &&
        optedIn &&
        cohortAllowed &&
        canManage &&
        canScore &&
        game.isDbGame !== false &&
        game.isSharedGame !== true &&
        !hasMeaningfulLegacyTracking(game)
    );

    return {
        engine: 'legacy',
        scorer: 'legacy',
        viewer: 'classic',
        canActivate: eligible,
        reason: eligible
            ? null
            : !sport
                ? 'unsupported-sport'
                : !activeTeam
                    ? 'inactive-team'
                    : normalizedPolicy.mode === 'disabled'
                        ? normalizedPolicy.reason || 'policy-disabled'
                        : !cohortAllowed
                            ? 'team-not-in-cohort'
                            : !optedIn
                                ? 'team-not-opted-in'
                                : !canManage || !canScore
                                    ? 'insufficient-access'
                                    : game.isSharedGame === true
                                        ? 'shared-game-not-eligible'
                                        : hasMeaningfulLegacyTracking(game)
                                            ? 'legacy-data-present'
                                            : 'game-not-eligible'
    };
}

export function buildDiamondTrackerUrl(teamId, gameId) {
    const team = encodeURIComponent(compactText(teamId, 128));
    const game = encodeURIComponent(compactText(gameId, 1000));
    return `/app/#/schedule/${team}/${game}/diamond-v2`;
}

export function buildDiamondViewerUrl({ teamId, gameId, replay = false, clipStart = null, clipEnd = null } = {}) {
    const params = new URLSearchParams({
        teamId: compactText(teamId, 128),
        gameId: compactText(gameId, 1000)
    });
    if (replay === true || replay === 'true' || replay === '1') params.set('replay', 'true');
    const start = Number(clipStart);
    const end = Number(clipEnd);
    if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && end > start) {
        params.set('clipStart', String(start));
        params.set('clipEnd', String(end));
    }
    return `/live-game-diamond-v2.html?${params.toString()}`;
}
