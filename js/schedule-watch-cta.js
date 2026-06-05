function normalizeStatus(value) {
    return String(value || '').trim().toLowerCase();
}

function isPrivateGame(game) {
    return game?.isPrivate === true || normalizeStatus(game?.visibility) === 'private';
}

function isDeletedGame(game) {
    return normalizeStatus(game?.status) === 'deleted' || normalizeStatus(game?.liveStatus) === 'deleted';
}

function isCancelledGame(game) {
    return game?.isCancelled === true || normalizeStatus(game?.status) === 'cancelled';
}

export function resolveScheduleWatchCta(game) {
    if (!game || normalizeStatus(game.type) === 'practice') return null;
    if (isCancelledGame(game) || isDeletedGame(game) || isPrivateGame(game)) return null;

    const teamId = String(game.teamId || '').trim();
    const gameId = String(game.gameId || game.id || '').trim();
    if (!teamId || !gameId) return null;

    const liveStatus = normalizeStatus(game.liveStatus);
    if (liveStatus === 'completed') {
        return {
            kind: 'replay',
            label: 'Watch Replay',
            href: `live-game.html?teamId=${encodeURIComponent(teamId)}&gameId=${encodeURIComponent(gameId)}&replay=true`
        };
    }

    if (liveStatus === 'live') {
        return {
            kind: 'live',
            label: 'Watch Live',
            href: `live-game.html?teamId=${encodeURIComponent(teamId)}&gameId=${encodeURIComponent(gameId)}`
        };
    }

    return null;
}
