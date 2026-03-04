function toMillis(value) {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function computeEffectiveRsvpSummary({
    rsvps,
    activeRosterIds,
    fallbackByUser,
    normalizeResponse,
    resolvePlayerIds
}) {
    const summary = { going: 0, maybe: 0, notGoing: 0, notResponded: 0, total: 0 };
    if (!Array.isArray(rsvps) || !(activeRosterIds instanceof Set) || activeRosterIds.size === 0) {
        summary.total = activeRosterIds instanceof Set ? activeRosterIds.size : 0;
        summary.notResponded = summary.total;
        return summary;
    }

    const latestByPlayer = new Map();

    rsvps.forEach((rsvp) => {
        const responseKey = normalizeResponse(rsvp?.response);
        const nextMillis = toMillis(rsvp?.respondedAt);
        const playerIds = Array.from(new Set(
            (resolvePlayerIds(rsvp, fallbackByUser) || [])
                .filter((id) => activeRosterIds.has(id))
        ));
        if (!playerIds.length) return;

        playerIds.forEach((playerId) => {
            const existing = latestByPlayer.get(playerId);
            if (existing && nextMillis < existing.respondedAtMillis) return;
            latestByPlayer.set(playerId, {
                responseKey,
                respondedAtMillis: nextMillis
            });
        });
    });

    latestByPlayer.forEach((entry) => {
        if (entry.responseKey === 'going') summary.going += 1;
        else if (entry.responseKey === 'maybe') summary.maybe += 1;
        else if (entry.responseKey === 'not_going') summary.notGoing += 1;
    });

    summary.total = activeRosterIds.size;
    const respondedCount = summary.going + summary.maybe + summary.notGoing;
    summary.notResponded = Math.max(0, summary.total - respondedCount);
    return summary;
}
