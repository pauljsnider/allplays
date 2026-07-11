function toMillis(value) {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function isPlayerSpecificOverride(rsvp, playerId) {
    const userId = String(rsvp?.userId || '').trim();
    const documentId = String(rsvp?.id || '').trim();
    return Boolean(userId && documentId === `${userId}__${playerId}`);
}

export function selectLatestRsvpByPlayer({
    rsvps,
    fallbackByUser,
    normalizeResponse,
    resolvePlayerIds,
    includePlayerId
}) {
    const latestByPlayer = new Map();
    if (!Array.isArray(rsvps)) return latestByPlayer;
    const latestByResponderAndPlayer = new Map();
    const latestSequenceByPlayer = new Map();

    const shouldIncludePlayerId = typeof includePlayerId === 'function'
        ? includePlayerId
        : () => true;

    rsvps.forEach((rsvp, sequence) => {
        const responseKey = normalizeResponse(rsvp?.response);
        const nextMillis = toMillis(rsvp?.respondedAt);
        const responderUserId = rsvp?.userId || null;
        const responderKey = String(responderUserId || rsvp?.id || '').trim();
        const playerIds = Array.from(new Set(
            (resolvePlayerIds(rsvp, fallbackByUser) || [])
                .filter((id) => shouldIncludePlayerId(id))
        ));
        if (!playerIds.length) return;

        playerIds.forEach((playerId) => {
            const candidateKey = `${responderKey}\u0000${playerId}`;
            const playerSpecific = isPlayerSpecificOverride(rsvp, playerId);
            const existing = latestByResponderAndPlayer.get(candidateKey);
            if (existing) {
                if (existing.playerSpecific !== playerSpecific) {
                    if (existing.playerSpecific) return;
                } else if (nextMillis < existing.respondedAtMillis || (nextMillis === existing.respondedAtMillis && sequence < existing.sequence)) {
                    return;
                }
            }
            latestByResponderAndPlayer.set(candidateKey, {
                playerId,
                responseKey,
                respondedAt: rsvp?.respondedAt || null,
                respondedAtMillis: nextMillis,
                note: rsvp?.note || null,
                responderUserId,
                playerSpecific,
                sequence
            });
        });
    });

    latestByResponderAndPlayer.forEach((candidate) => {
        const existing = latestByPlayer.get(candidate.playerId);
        if (existing && (candidate.respondedAtMillis < existing.respondedAtMillis
            || (candidate.respondedAtMillis === existing.respondedAtMillis && candidate.sequence < latestSequenceByPlayer.get(candidate.playerId)))) return;
        const { playerSpecific: _playerSpecific, sequence, ...publicEntry } = candidate;
        latestByPlayer.set(candidate.playerId, publicEntry);
        latestSequenceByPlayer.set(candidate.playerId, sequence);
    });

    return latestByPlayer;
}

export function computeEffectiveRsvpSummary({
    rsvps,
    activeRosterIds,
    fallbackByUser,
    normalizeResponse,
    resolvePlayerIds
}) {
    const summary = { going: 0, maybe: 0, notGoing: 0, notResponded: 0, total: 0, notRespondedPlayerIds: [] };
    if (!Array.isArray(rsvps) || !(activeRosterIds instanceof Set) || activeRosterIds.size === 0) {
        summary.total = activeRosterIds instanceof Set ? activeRosterIds.size : 0;
        summary.notResponded = summary.total;
        summary.notRespondedPlayerIds = activeRosterIds instanceof Set ? Array.from(activeRosterIds) : [];
        return summary;
    }

    const latestByPlayer = selectLatestRsvpByPlayer({
        rsvps,
        fallbackByUser,
        normalizeResponse,
        resolvePlayerIds,
        includePlayerId: (playerId) => activeRosterIds.has(playerId)
    });

    latestByPlayer.forEach((entry) => {
        if (entry.responseKey === 'going') summary.going += 1;
        else if (entry.responseKey === 'maybe') summary.maybe += 1;
        else if (entry.responseKey === 'not_going') summary.notGoing += 1;
    });

    summary.total = activeRosterIds.size;
    const respondedPlayerIds = new Set();
    latestByPlayer.forEach((entry) => {
        if (entry.responseKey !== 'not_responded') {
            respondedPlayerIds.add(entry.playerId);
        }
    });
    summary.notRespondedPlayerIds = Array.from(activeRosterIds).filter(
        (playerId) => !respondedPlayerIds.has(playerId)
    );
    summary.notResponded = summary.notRespondedPlayerIds.length;
    return summary;
}
