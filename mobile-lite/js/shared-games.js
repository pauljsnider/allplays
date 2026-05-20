const SHARED_GAME_ID_PREFIX = 'shared_';
const LEGACY_SHARED_GAME_ID_PREFIX = 'shared::';

function toDisplayName(teamName, placeholderName) {
    const team = typeof teamName === 'string' ? teamName.trim() : '';
    if (team) return team;
    const placeholder = typeof placeholderName === 'string' ? placeholderName.trim() : '';
    if (placeholder) return placeholder;
    return 'TBD';
}

function toDateValue(value) {
    if (!value) return null;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.toDate === 'function') return value.toDate().getTime();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function buildSharedGameSyntheticId(sharedGamePath) {
    if (!sharedGamePath) {
        throw new Error('sharedGamePath is required');
    }
    return `${SHARED_GAME_ID_PREFIX}${encodeURIComponent(sharedGamePath)}`;
}

export function isSharedGameSyntheticId(gameId) {
    return typeof gameId === 'string'
        && (gameId.startsWith(SHARED_GAME_ID_PREFIX) || gameId.startsWith(LEGACY_SHARED_GAME_ID_PREFIX));
}

export function decodeSharedGameSyntheticId(gameId) {
    if (!isSharedGameSyntheticId(gameId)) return null;
    const prefix = gameId.startsWith(SHARED_GAME_ID_PREFIX)
        ? SHARED_GAME_ID_PREFIX
        : LEGACY_SHARED_GAME_ID_PREFIX;
    return decodeURIComponent(gameId.slice(prefix.length));
}

export function projectSharedGameForTeam(sharedGame, teamId) {
    if (!sharedGame || !teamId) return null;

    const isHome = sharedGame.homeTeamId === teamId;
    const isAway = sharedGame.awayTeamId === teamId;
    if (!isHome && !isAway) return null;

    const opponentTeamId = isHome ? (sharedGame.awayTeamId || null) : (sharedGame.homeTeamId || null);
    const opponentTeamName = isHome
        ? toDisplayName(sharedGame.awayTeamName, sharedGame.awayPlaceholderName)
        : toDisplayName(sharedGame.homeTeamName, sharedGame.homePlaceholderName);
    const opponentTeamPhoto = isHome
        ? (sharedGame.awayTeamPhoto || null)
        : (sharedGame.homeTeamPhoto || null);
    const sharedGamePath = sharedGame._sharedGamePath || null;

    return {
        ...sharedGame,
        id: buildSharedGameSyntheticId(sharedGamePath || `sharedGames/${sharedGame.id}`),
        sharedGameId: sharedGame.id || null,
        sharedGamePath,
        teamId,
        type: sharedGame.type || 'game',
        opponent: opponentTeamName,
        opponentTeamId,
        opponentTeamName,
        opponentTeamPhoto,
        isHome,
        isSharedGame: true,
        competitionType: sharedGame.competitionType || 'tournament',
        countsTowardSeasonRecord: sharedGame.countsTowardSeasonRecord !== false
    };
}

export function mergeGamesForTeam(teamGames = [], sharedGames = [], teamId) {
    const projectedSharedGames = sharedGames
        .map((sharedGame) => projectSharedGameForTeam(sharedGame, teamId))
        .filter(Boolean);
    const sharedIds = new Set(projectedSharedGames.map((game) => game.sharedGameId).filter(Boolean));

    const merged = teamGames.filter((game) => {
        if (!game) return false;
        if (!game.sharedGameId) return true;
        return !sharedIds.has(game.sharedGameId);
    });

    merged.push(...projectedSharedGames);

    merged.sort((a, b) => {
        const at = toDateValue(a?.date);
        const bt = toDateValue(b?.date);
        if (at === null && bt === null) return 0;
        if (at === null) return 1;
        if (bt === null) return -1;
        return at - bt;
    });

    return merged;
}
