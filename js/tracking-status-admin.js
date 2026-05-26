export function normalizeTrackingItemDraft(draft = {}) {
    const title = String(draft.title || '').trim();
    if (!title) {
        throw new Error('Tracking item title is required');
    }

    return {
        name: title,
        visibility: 'private',
        status: 'active',
        active: true,
        archived: false
    };
}

export function getActiveRosterPlayers(players = []) {
    return players.filter((player) => player && player.active !== false);
}

export function mergeTrackingStatusRows(players = [], statuses = []) {
    const statusByPlayerId = new Map();
    statuses.forEach((status) => {
        const playerId = status?.playerId || status?.id;
        if (playerId) {
            statusByPlayerId.set(playerId, status);
        }
    });

    return getActiveRosterPlayers(players).map((player) => {
        const status = statusByPlayerId.get(player.id) || {};
        const complete = status.complete === true || status.status === 'complete';
        return {
            player,
            status,
            complete
        };
    });
}

export function summarizeTrackingStatus(rows = []) {
    const total = rows.length;
    const complete = rows.filter((row) => row.complete === true).length;
    return {
        total,
        complete,
        incomplete: Math.max(total - complete, 0)
    };
}

export function buildTrackingStatusPayload({ teamId, itemId, player, complete, actorId, actorEmail } = {}) {
    if (!teamId) throw new Error('Team ID is required');
    if (!itemId) throw new Error('Tracking item ID is required');
    if (!player?.id) throw new Error('Player is required');

    return {
        teamId,
        trackingItemId: itemId,
        playerId: player.id,
        playerName: player.name || '',
        playerNumber: player.number || '',
        memberType: 'player',
        status: complete ? 'complete' : 'incomplete',
        complete: complete === true,
        updatedBy: actorId || null,
        updatedByEmail: actorEmail || null
    };
}
