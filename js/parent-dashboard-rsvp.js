function uniqNonEmpty(values) {
    return [...new Set((Array.isArray(values) ? values : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean))];
}

function parseChildIds(childIds) {
    if (Array.isArray(childIds)) return uniqNonEmpty(childIds);
    if (typeof childIds === 'string') {
        return uniqNonEmpty(childIds.split(','));
    }
    return [];
}

function normalizeRsvpResponse(response) {
    const value = String(response || '').trim().toLowerCase();
    if (value === 'going' || value === 'maybe' || value === 'not_going') return value;
    return 'not_responded';
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function extractRsvpPlayerIds(rsvp) {
    const direct = uniqNonEmpty(rsvp?.playerIds);
    if (direct.length > 0) return direct;
    return uniqNonEmpty([rsvp?.playerId, rsvp?.childId]);
}

function extractEventPlayerIds(event) {
    return uniqNonEmpty([
        event?.childId,
        event?.playerId,
        ...parseChildIds(event?.childIds)
    ]);
}

function getScopedRsvpPlayerIds(allScheduleEvents, teamId, gameId) {
    const events = Array.isArray(allScheduleEvents) ? allScheduleEvents : [];
    return uniqNonEmpty(
        events
            .filter((event) => event?.teamId === teamId && event?.id === gameId)
            .flatMap((event) => extractEventPlayerIds(event))
    );
}

export function resolveRsvpPlayerIdsForSubmission(allScheduleEvents, teamId, gameId, childContext = {}) {
    const allowedPlayerIds = getScopedRsvpPlayerIds(allScheduleEvents, teamId, gameId);
    const allowedSet = new Set(allowedPlayerIds);
    const sanitizeToAllowedScope = (ids) => ids.filter((id) => allowedSet.has(id));
    const throwScopeError = () => {
        throw new Error('Select a child in this game before submitting RSVP.');
    };

    const selectedChildId = String(childContext?.selectedChildId || '').trim();
    if (selectedChildId) {
        const scoped = sanitizeToAllowedScope([selectedChildId]);
        if (scoped.length === 0) throwScopeError();
        return scoped;
    }

    const explicitChildId = String(childContext?.childId || '').trim();
    if (explicitChildId) {
        const scoped = sanitizeToAllowedScope([explicitChildId]);
        if (scoped.length === 0) throwScopeError();
        return scoped;
    }

    const explicitChildIds = parseChildIds(childContext?.childIds);
    if (explicitChildIds.length > 0) {
        const scoped = sanitizeToAllowedScope(explicitChildIds);
        if (scoped.length === 0) throwScopeError();
        return scoped;
    }

    if (allowedPlayerIds.length === 1) return allowedPlayerIds;
    throwScopeError();
}

export function resolveCalendarRsvpPlayerIdsForSubmission(allScheduleEvents, teamId, gameId, childContext = {}, fallbackPlayerIds = []) {
    const explicitChildId = String(childContext?.selectedChildId || childContext?.childId || '').trim();
    const explicitChildIds = parseChildIds(childContext?.childIds);
    const scopedPlayerIds = getScopedRsvpPlayerIds(allScheduleEvents, teamId, gameId);

    if (!explicitChildId && explicitChildIds.length === 0 && scopedPlayerIds.length === 0) {
        return uniqNonEmpty(fallbackPlayerIds);
    }

    return resolveRsvpPlayerIdsForSubmission(allScheduleEvents, teamId, gameId, childContext);
}

export function resolveMyRsvpByChildForGame(allScheduleEvents, teamId, gameId, rsvps, userId) {
    const events = Array.isArray(allScheduleEvents) ? allScheduleEvents : [];
    const scopedPlayerIds = uniqNonEmpty(
        events
            .filter((event) => event?.teamId === teamId && event?.id === gameId)
            .map((event) => event?.childId || event?.playerId)
    );
    const scopedSet = new Set(scopedPlayerIds);
    const byChild = new Map();

    (Array.isArray(rsvps) ? rsvps : []).forEach((rsvp) => {
        if ((rsvp?.userId || '') !== userId) return;
        const response = normalizeRsvpResponse(rsvp?.response);
        if (response === 'not_responded') return;
        const respondedAtMillis = toMillis(rsvp?.respondedAt);
        const resolvedPlayerIds = extractRsvpPlayerIds(rsvp);
        const playerIdsForHydration = resolvedPlayerIds.length > 0 ? resolvedPlayerIds : scopedPlayerIds;

        playerIdsForHydration.forEach((playerId) => {
            if (!scopedSet.has(playerId)) return;
            const existing = byChild.get(playerId);
            if (!existing || respondedAtMillis >= existing.respondedAtMillis) {
                byChild.set(playerId, {
                    response,
                    respondedAtMillis
                });
            }
        });
    });

    return Object.fromEntries(
        Array.from(byChild.entries()).map(([playerId, value]) => [playerId, value.response])
    );
}
