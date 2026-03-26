const GAME_DAY_ENTRY_GRACE_MS = 3 * 60 * 60 * 1000;

function getGameDate(game) {
    if (!game || !game.date) return null;
    return game.date.toDate ? game.date.toDate() : new Date(game.date);
}

function getNormalizedStatus(game) {
    return String(game?.status || '').toLowerCase();
}

function getNormalizedLiveStatus(game) {
    return String(game?.liveStatus || '').toLowerCase();
}

function isCancelled(game) {
    return getNormalizedStatus(game) === 'cancelled';
}

function isCompleted(game) {
    return getNormalizedStatus(game) === 'completed' || getNormalizedLiveStatus(game) === 'completed';
}

function canHonorRequestedGame(game, now) {
    if (!game || isCancelled(game)) return false;
    if (isCompleted(game)) return true;

    const date = getGameDate(game);
    if (!date) return true;

    const cutoff = new Date(now.getTime() - GAME_DAY_ENTRY_GRACE_MS);
    return date >= cutoff;
}

export function pickBestGameId(games, requestedGameId, now = new Date()) {
    const list = (games || []).filter((game) => game && game.id && game.type !== 'practice');

    if (!list.length) return null;

    if (requestedGameId) {
        const exact = list.find((game) => game.id === requestedGameId);
        if (canHonorRequestedGame(exact, now)) {
            return exact.id;
        }
    }

    const cutoff = new Date(now.getTime() - GAME_DAY_ENTRY_GRACE_MS);

    const live = list.find((game) => getNormalizedLiveStatus(game) === 'live');
    if (live) return live.id;

    const scheduledFuture = list
        .filter((game) => !isCancelled(game) && !isCompleted(game))
        .map((game) => ({ game, date: getGameDate(game) }))
        .filter((entry) => entry.date && entry.date >= cutoff)
        .sort((a, b) => a.date - b.date);
    if (scheduledFuture.length) return scheduledFuture[0].game.id;

    const recent = list
        .filter((game) => !isCancelled(game))
        .map((game) => ({ game, date: getGameDate(game) }))
        .filter((entry) => entry.date)
        .sort((a, b) => b.date - a.date);
    if (recent.length) return recent[0].game.id;

    return list[0].id;
}

export function buildGameDayUrl(teamId, gameId) {
    if (!teamId || !gameId) return null;
    return `game-day.html?teamId=${encodeURIComponent(teamId)}&gameId=${encodeURIComponent(gameId)}`;
}

export function normalizeGameDayUrl(teamId, gameId, browser = window) {
    const normalized = buildGameDayUrl(teamId, gameId);
    if (!normalized) return;

    const { location, history } = browser;
    if (
        location?.pathname?.endsWith('/game-day.html') &&
        `${location.pathname}${location.search}` === `/${normalized}`
    ) {
        return;
    }

    history?.replaceState?.({}, '', normalized);
}
