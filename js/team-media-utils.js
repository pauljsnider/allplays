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

export function getTeamMediaItemUrl(item = {}) {
    return String(item.downloadUrl || item.url || item.src || '').trim();
}

export function isSafeTeamMediaPhoto(item = {}) {
    const url = getTeamMediaItemUrl(item);
    if (!isSafeTeamMediaUrl(url)) return false;
    const type = String(item.type || '').toLowerCase();
    const contentType = String(item.contentType || item.mimeType || '').toLowerCase();
    return ['photo', 'image', 'team-photo'].includes(type)
        || contentType.startsWith('image/')
        || /\.(avif|gif|jpe?g|png|webp)(\?|#|$)/i.test(url);
}

export function getTeamMediaUploaderName(item = {}) {
    return String(item.uploadedByName || item.uploaderName || item.createdByName || item.authorName || '').trim();
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
