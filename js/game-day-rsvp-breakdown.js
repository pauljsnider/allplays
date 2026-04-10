function normalizeRsvpResponse(response) {
    if (response === 'going' || response === 'maybe' || response === 'not_going') {
        return response;
    }
    return 'not_responded';
}

function uniqueNonEmptyIds(ids) {
    if (!Array.isArray(ids)) return [];
    return Array.from(new Set(
        ids.filter((id) => typeof id === 'string' && id.trim())
    ));
}

function extractDirectRsvpPlayerIds(rsvp) {
    const direct = uniqueNonEmptyIds(rsvp?.playerIds);
    if (direct.length) return direct;
    const legacy = [];
    if (typeof rsvp?.playerId === 'string' && rsvp.playerId.trim()) legacy.push(rsvp.playerId.trim());
    if (typeof rsvp?.childId === 'string' && rsvp.childId.trim()) legacy.push(rsvp.childId.trim());
    return uniqueNonEmptyIds(legacy);
}

function resolveRsvpPlayerIds(rsvp, fallbackByUser) {
    const direct = extractDirectRsvpPlayerIds(rsvp);
    if (direct.length) return direct;
    const uid = rsvp?.userId || rsvp?.id;
    return uid ? uniqueNonEmptyIds(fallbackByUser.get(uid) || []) : [];
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function buildGameDayRsvpBreakdown({ players, rsvps, fallbackByUser = new Map() }) {
    const roster = Array.isArray(players) ? players : [];
    const responses = Array.isArray(rsvps) ? rsvps : [];

    const byPlayer = new Map();
    roster.forEach((player) => {
        byPlayer.set(player.id, {
            playerId: player.id,
            playerName: player.name || `#${player.number || ''}`.trim() || 'Unknown Player',
            playerNumber: player.number || '',
            response: 'not_responded',
            respondedAt: null,
            note: null,
            responderUserId: null
        });
    });

    responses.forEach((rsvp) => {
        const ids = resolveRsvpPlayerIds(rsvp, fallbackByUser);
        if (!ids.length) return;
        ids.forEach((playerId) => {
            let existing = byPlayer.get(playerId);
            if (!existing) {
                existing = {
                    playerId,
                    playerName: 'Former Player',
                    playerNumber: '',
                    response: 'not_responded',
                    respondedAt: null,
                    note: null,
                    responderUserId: null
                };
            }
            const existingMillis = toMillis(existing.respondedAt);
            const nextMillis = toMillis(rsvp.respondedAt);
            if (nextMillis < existingMillis) return;
            existing.response = normalizeRsvpResponse(rsvp.response);
            existing.respondedAt = rsvp.respondedAt || null;
            existing.note = rsvp.note || null;
            existing.responderUserId = rsvp.userId || null;
            byPlayer.set(playerId, existing);
        });
    });

    const grouped = {
        going: [],
        maybe: [],
        not_going: [],
        not_responded: []
    };

    Array.from(byPlayer.values())
        .sort((a, b) => {
            const an = (a.playerNumber ?? '').toString();
            const bn = (b.playerNumber ?? '').toString();
            const ai = Number.parseInt(an, 10);
            const bi = Number.parseInt(bn, 10);
            const aNum = Number.isFinite(ai);
            const bNum = Number.isFinite(bi);
            if (aNum && bNum && ai !== bi) return ai - bi;
            if (aNum && !bNum) return -1;
            if (!aNum && bNum) return 1;
            return (a.playerName || '').localeCompare(b.playerName || '');
        })
        .forEach((row) => {
            const key = row.response === 'going' || row.response === 'maybe' || row.response === 'not_going'
                ? row.response
                : 'not_responded';
            grouped[key].push(row);
        });

    return {
        grouped,
        counts: {
            going: grouped.going.length,
            maybe: grouped.maybe.length,
            notGoing: grouped.not_going.length,
            notResponded: grouped.not_responded.length,
            total: roster.length
        }
    };
}
