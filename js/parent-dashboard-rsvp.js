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

export function resolveRsvpPlayerIdsForSubmission(allScheduleEvents, teamId, gameId, childContext = {}) {
    const events = Array.isArray(allScheduleEvents) ? allScheduleEvents : [];
    const allowedPlayerIds = uniqNonEmpty(
        events
            .filter((event) => event?.teamId === teamId && event?.id === gameId)
            .map((event) => event?.childId || event?.playerId)
    );
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
