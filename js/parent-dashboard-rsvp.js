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

    const explicitChildId = String(childContext?.childId || '').trim();
    if (explicitChildId) return sanitizeToAllowedScope([explicitChildId]);

    const explicitChildIds = parseChildIds(childContext?.childIds);
    if (explicitChildIds.length > 0) return sanitizeToAllowedScope(explicitChildIds);

    return allowedPlayerIds;
}
