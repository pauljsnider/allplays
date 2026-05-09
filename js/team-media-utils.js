import { hasFullTeamAccess } from './team-access.js';

export function canManageTeamMedia(user, team) {
    return hasFullTeamAccess(user, team);
}

export function normalizeMediaOrderIds(ids = []) {
    return Array.from(new Set((Array.isArray(ids) ? ids : [])
        .map((id) => String(id || '').trim())
        .filter(Boolean)));
}

export function buildReorderUpdates(ids = []) {
    return normalizeMediaOrderIds(ids).map((id, index) => ({ id, order: index }));
}

export function normalizeSelectedMediaIds(ids = []) {
    return normalizeMediaOrderIds(ids);
}

export function buildMoveUpdates(ids = [], targetFolderId, startOrder = 0) {
    const folderId = String(targetFolderId || '').trim();
    if (!folderId) {
        throw new Error('Choose a destination folder.');
    }

    const firstOrder = Number.isFinite(Number(startOrder)) ? Number(startOrder) : 0;
    return normalizeSelectedMediaIds(ids).map((id, index) => ({
        id,
        folderId,
        order: firstOrder + index
    }));
}

export function buildBulkDeleteUpdates(ids = []) {
    return normalizeSelectedMediaIds(ids).map((id) => ({ id, deleted: true }));
}

export function isSafeTeamMediaUrl(value) {
    try {
        const url = new URL(String(value || '').trim());
        return ['http:', 'https:'].includes(url.protocol);
    } catch (error) {
        return false;
    }
}

export function sortByMediaOrder(items = []) {
    return [...items].sort((a, b) => {
        const aOrder = Number.isFinite(Number(a?.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
        const bOrder = Number.isFinite(Number(b?.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return String(a?.name || a?.title || a?.id || '').localeCompare(String(b?.name || b?.title || b?.id || ''));
    });
}
