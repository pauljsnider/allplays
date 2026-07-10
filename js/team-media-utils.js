import { hasFullTeamAccess } from './team-access.js';

const VIDEO_HOST_PATTERNS = [
    /(^|\.)youtube\.com$/,
    /(^|\.)youtu\.be$/,
    /(^|\.)vimeo\.com$/
];

const TEAM_MEDIA_DOCUMENT_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv'
]);

const TEAM_MEDIA_DOCUMENT_EXTENSIONS = new Set([
    'pdf',
    'doc',
    'docx',
    'xls',
    'xlsx',
    'ppt',
    'pptx',
    'txt',
    'csv'
]);

const GENERIC_TEAM_MEDIA_DOCUMENT_TYPES = new Set([
    '',
    'application/octet-stream',
    'binary/octet-stream'
]);

export const TEAM_MEDIA_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const TEAM_MEDIA_VISIBILITIES = ['team', 'private'];

function asTrimmedString(value) {
    return String(value || '').trim();
}

function getHttpUrl(value) {
    const raw = asTrimmedString(value);
    if (!raw) return null;

    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        return url;
    } catch {
        return null;
    }
}

function getSafeVideoUrl(value) {
    const url = getHttpUrl(value);
    if (!url) return null;

    const host = url.hostname.toLowerCase();
    if (!VIDEO_HOST_PATTERNS.some((pattern) => pattern.test(host))) return null;
    return url.toString();
}

export function canManageTeamMedia(user, team) {
    if (hasFullTeamAccess(user, team)) return true;

    const teamId = asTrimmedString(team?.id);
    if (!user || !teamId) return false;

    return (Array.isArray(user.coachOf) ? user.coachOf : [])
        .map(asTrimmedString)
        .includes(teamId);
}

export function normalizeAlbumVisibility(value) {
    return asTrimmedString(value) === 'private' ? 'private' : 'team';
}

export function canReadTeamMediaAlbum(folder, canManage = false) {
    if (canManage) return true;
    return normalizeAlbumVisibility(folder?.visibility) === 'team';
}

export function canViewTeamMediaFolder(folder, accessLevel) {
    if (!folder) return false;
    if (accessLevel === 'full') return true;
    return ['parent', 'media'].includes(accessLevel) && canReadTeamMediaAlbum(folder, false);
}

function normalizeTeamMediaNotificationAlbumVisibility(folder = {}) {
    if (folder?.staffOnly === true) return 'private';
    const rawVisibility = folder?.visibility ?? folder?.albumVisibility;
    const normalized = asTrimmedString(rawVisibility).toLowerCase().replace(/[\s_]+/g, '-');
    if (['private', 'staff', 'staff-only'].includes(normalized)) return 'private';
    return normalizeAlbumVisibility(rawVisibility);
}

function normalizeTeamMediaAudienceList(value) {
    if (Array.isArray(value)) return value;
    if (value instanceof Set) return Array.from(value);
    if (typeof value === 'string') return value.split(',');
    return [];
}

function normalizeTeamMediaAudienceUserIds(value) {
    return Array.from(new Set(
        normalizeTeamMediaAudienceList(value)
            .map((entry) => asTrimmedString(entry))
            .filter(Boolean)
    ));
}

function normalizeTeamMediaAudienceRoles(value) {
    return Array.from(new Set(
        normalizeTeamMediaAudienceList(value)
            .map((entry) => asTrimmedString(entry).toLowerCase().replace(/[\s_]+/g, '-'))
            .map((role) => (['admin', 'coach', 'manager', 'owner'].includes(role) ? 'staff' : role))
            .filter((role) => ['parent', 'staff'].includes(role))
    ));
}

function getTeamMediaAudienceValue(source = {}, keys = []) {
    return keys.reduce((selected, key) => (selected == null ? source?.[key] : selected), undefined);
}

function getTeamMediaAudienceAccessLevel(user = {}) {
    const roles = normalizeTeamMediaAudienceRoles(user.roles);
    if (roles.includes('staff')) return 'full';
    if (roles.includes('parent')) return 'parent';
    return null;
}

function canAudienceUserViewTeamMediaAlbum(folder, user) {
    const visibility = normalizeTeamMediaNotificationAlbumVisibility(folder);
    return canViewTeamMediaFolder({ ...folder, visibility }, getTeamMediaAudienceAccessLevel(user));
}

export function resolveTeamMediaAlbumNotificationAudience(folder = {}, users = []) {
    const audienceSource = folder?.audienceContext && typeof folder.audienceContext === 'object'
        ? { ...folder.audienceContext, ...folder }
        : folder;
    const allowedUserIds = normalizeTeamMediaAudienceUserIds(getTeamMediaAudienceValue(audienceSource, [
        'allowedUserIds',
        'audienceUserIds',
        'visibleToUserIds',
        'userIds'
    ]));
    const allowedRoles = normalizeTeamMediaAudienceRoles(getTeamMediaAudienceValue(audienceSource, [
        'allowedRoles',
        'audienceRoles',
        'visibleToRoles',
        'roles'
    ]));
    const hasAudienceRestrictions = allowedUserIds.length > 0 || allowedRoles.length > 0;

    return (Array.isArray(users) ? users : []).filter((user) => {
        const uid = asTrimmedString(user?.uid);
        if (!uid || !canAudienceUserViewTeamMediaAlbum(audienceSource, user)) return false;
        if (!hasAudienceRestrictions) return true;

        const roles = normalizeTeamMediaAudienceRoles(user.roles);
        return allowedUserIds.includes(uid) || roles.some((role) => allowedRoles.includes(role));
    });
}

export function hasTeamMediaUploadGrant(user, teamId) {
    const normalizedTeamId = String(teamId || '').trim();
    if (!user || !normalizedTeamId) return false;

    return (Array.isArray(user.teamMediaUploadTeamIds) && user.teamMediaUploadTeamIds.includes(normalizedTeamId)) ||
        (Array.isArray(user.mediaUploadTeamIds) && user.mediaUploadTeamIds.includes(normalizedTeamId));
}

export function canContributeTeamMedia(user, team) {
    if (!user || !team) return false;
    if (canManageTeamMedia(user, team)) return true;
    const teamId = String(team.id || '').trim();
    if (!teamId) return false;
    return hasTeamMediaUploadGrant(user, teamId);
}

export function isSupportedTeamMediaVideoUrl(value) {
    return Boolean(getSafeVideoUrl(value));
}

function isAllowedTeamMediaFileSize(file) {
    return Number(file?.size || 0) > 0 && Number(file.size) <= TEAM_MEDIA_MAX_FILE_SIZE_BYTES;
}

export function isSupportedTeamMediaImage(file) {
    return Boolean(file && isAllowedTeamMediaFileSize(file) && String(file.type || '').startsWith('image/'));
}

export function isSupportedTeamMediaDocument(file) {
    if (!file || !isAllowedTeamMediaFileSize(file)) return false;

    const mimeType = String(file.type || '').toLowerCase();
    if (TEAM_MEDIA_DOCUMENT_TYPES.has(mimeType)) return true;
    if (!GENERIC_TEAM_MEDIA_DOCUMENT_TYPES.has(mimeType)) return false;

    const extension = String(file.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
    return TEAM_MEDIA_DOCUMENT_EXTENSIONS.has(extension);
}

export function isTeamMediaDocument(item = {}) {
    return String(item.type || '').toLowerCase() === 'file';
}

export function canDeleteTeamMediaItem(user, team, item) {
    if (!user || !item) return false;
    return canManageTeamMedia(user, team) || (['photo', 'file'].includes(item.type) && item.uploadedBy === user.uid);
}

export function normalizeTeamMediaFolderDraft(draft = {}) {
    const name = asTrimmedString(draft.name);
    const visibility = normalizeAlbumVisibility(draft.visibility);

    if (!name) {
        throw new Error('Album name is required.');
    }

    return {
        name,
        visibility
    };
}

export function normalizeTeamMediaVideoDraft(draft = {}) {
    const title = asTrimmedString(draft.title);
    const url = getSafeVideoUrl(draft.url);

    if (!title) {
        throw new Error('Video title is required.');
    }

    if (!url) {
        throw new Error('Enter a valid YouTube or Vimeo URL.');
    }

    return {
        title,
        url,
        type: 'video_link'
    };
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
    const runtimeUrl = String(item.url || item.src || '').trim();
    if (runtimeUrl) return runtimeUrl;
    if (asTrimmedString(item.storagePath)) return '';
    return String(item.downloadUrl || '').trim();
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
    return Boolean(getHttpUrl(value));
}

export function sortByMediaOrder(items = []) {
    return [...items].sort((a, b) => {
        const aOrder = Number.isFinite(Number(a?.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
        const bOrder = Number.isFinite(Number(b?.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return String(a?.name || a?.title || a?.id || '').localeCompare(String(b?.name || b?.title || b?.id || ''));
    });
}
