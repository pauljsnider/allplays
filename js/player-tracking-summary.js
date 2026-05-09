function cleanString(value) {
    return String(value ?? '').trim();
}

export function isPublicTrackingItem(item = {}) {
    const visibility = cleanString(item.visibility || item.access || '').toLowerCase();
    if (visibility === 'private' || visibility === 'admin') return false;
    if (item.isPrivate === true || item.private === true) return false;
    return item.public === true || item.isPublic === true || visibility === 'public';
}

export function normalizeTrackingItem(item = {}) {
    const id = cleanString(item.id || item.itemId || item.trackingItemId);
    return {
        ...item,
        id,
        title: cleanString(item.title || item.name || item.label || 'Tracking item'),
        description: cleanString(item.description || item.note || ''),
        sortOrder: Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : 9999,
        isPublic: isPublicTrackingItem(item)
    };
}

export function normalizeTrackingStatus(status = {}) {
    const itemId = cleanString(status.itemId || status.trackingItemId || status.id);
    const playerId = cleanString(status.playerId || status.childId || status.memberId);
    const value = cleanString(status.status || status.state).toLowerCase();
    const isComplete = status.complete === true || status.completed === true || status.isComplete === true || value === 'complete' || value === 'completed' || value === 'done';
    return {
        ...status,
        itemId,
        playerId,
        isComplete
    };
}

export function getVisiblePlayerTrackingSummary({ items = [], statuses = [], playerIds = [] } = {}) {
    const allowedPlayerIds = new Set((Array.isArray(playerIds) ? playerIds : [])
        .map(cleanString)
        .filter(Boolean));
    const publicItems = (Array.isArray(items) ? items : [])
        .map(normalizeTrackingItem)
        .filter((item) => item.id && item.isPublic)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    const publicItemIds = new Set(publicItems.map((item) => item.id));
    const statusByPlayerAndItem = new Map();

    (Array.isArray(statuses) ? statuses : [])
        .map(normalizeTrackingStatus)
        .filter((status) => status.itemId && status.playerId && publicItemIds.has(status.itemId) && allowedPlayerIds.has(status.playerId))
        .forEach((status) => {
            statusByPlayerAndItem.set(`${status.playerId}::${status.itemId}`, status);
        });

    return Array.from(allowedPlayerIds).map((playerId) => ({
        playerId,
        items: publicItems.map((item) => ({
            ...item,
            status: statusByPlayerAndItem.get(`${playerId}::${item.id}`) || null,
            isComplete: statusByPlayerAndItem.get(`${playerId}::${item.id}`)?.isComplete === true
        }))
    }));
}
