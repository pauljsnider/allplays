import { selectLatestRsvpByPlayer } from './rsvp-summary.js';

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

    const latestByPlayer = selectLatestRsvpByPlayer({
        rsvps: responses,
        fallbackByUser,
        normalizeResponse: normalizeRsvpResponse,
        resolvePlayerIds: resolveRsvpPlayerIds
    });

    latestByPlayer.forEach((entry, playerId) => {
        const existing = byPlayer.get(playerId) || {
            playerId,
            playerName: 'Former Player',
            playerNumber: '',
            response: 'not_responded',
            respondedAt: null,
            note: null,
            responderUserId: null
        };
        existing.response = entry.responseKey;
        existing.respondedAt = entry.respondedAt;
        existing.note = entry.note;
        existing.responderUserId = entry.responderUserId;
        byPlayer.set(playerId, existing);
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
