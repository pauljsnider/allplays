function uniqNonEmpty(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))];
}

export function buildLinkedPlayersByTeam(parentLinks) {
    return (Array.isArray(parentLinks) ? parentLinks : []).reduce((acc, link) => {
        const teamId = String(link?.teamId || '').trim();
        const playerId = String(link?.playerId || '').trim();
        if (!teamId || !playerId) return acc;
        if (!acc.has(teamId)) acc.set(teamId, []);

        const existingIds = new Set(acc.get(teamId).map((player) => player.playerId));
        if (existingIds.has(playerId)) return acc;

        acc.get(teamId).push({
            playerId,
            playerName: String(link?.playerName || '').trim() || 'Player'
        });
        return acc;
    }, new Map());
}

export function resolveCalendarRsvpSubmission(linkedPlayersByTeam, teamId, selectedChildId = '') {
    const players = Array.isArray(linkedPlayersByTeam?.get(teamId)) ? linkedPlayersByTeam.get(teamId) : [];
    const allowedPlayerIds = uniqNonEmpty(players.map((player) => player?.playerId));
    if (allowedPlayerIds.length === 0) {
        throw new Error('No linked child is available for this team.');
    }

    const normalizedSelectedChildId = String(selectedChildId || '').trim();
    if (normalizedSelectedChildId) {
        if (!allowedPlayerIds.includes(normalizedSelectedChildId)) {
            throw new Error('Select a linked child for this team before submitting RSVP.');
        }
        return {
            playerIds: [normalizedSelectedChildId],
            submitMode: allowedPlayerIds.length > 1 ? 'player' : 'user'
        };
    }

    if (allowedPlayerIds.length === 1) {
        return {
            playerIds: allowedPlayerIds,
            submitMode: 'user'
        };
    }

    throw new Error('Select a child for this team before submitting RSVP.');
}
