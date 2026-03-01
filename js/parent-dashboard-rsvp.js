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
    const explicitChildId = String(childContext?.childId || '').trim();
    if (explicitChildId) return [explicitChildId];

    const explicitChildIds = parseChildIds(childContext?.childIds);
    if (explicitChildIds.length > 0) return explicitChildIds;

    const events = Array.isArray(allScheduleEvents) ? allScheduleEvents : [];
    return uniqNonEmpty(
        events
            .filter((event) => event?.teamId === teamId && event?.id === gameId)
            .map((event) => event?.childId || event?.playerId)
    );
}
