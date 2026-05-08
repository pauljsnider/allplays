const VIDEO_HOST_PATTERNS = [
    /(^|\.)youtube\.com$/,
    /(^|\.)youtu\.be$/,
    /(^|\.)vimeo\.com$/
];

export const TEAM_MEDIA_VISIBILITIES = ['members', 'managers'];

function asTrimmedString(value) {
    return String(value || '').trim();
}

function getSafeUrl(value) {
    const raw = asTrimmedString(value);
    if (!raw) return null;

    try {
        const url = new URL(raw);
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
        const host = url.hostname.toLowerCase();
        if (!VIDEO_HOST_PATTERNS.some((pattern) => pattern.test(host))) return null;
        return url.toString();
    } catch {
        return null;
    }
}

export function isSupportedTeamMediaVideoUrl(value) {
    return Boolean(getSafeUrl(value));
}

export function normalizeTeamMediaFolderDraft(draft = {}) {
    const name = asTrimmedString(draft.name);
    const visibility = TEAM_MEDIA_VISIBILITIES.includes(draft.visibility) ? draft.visibility : 'members';

    if (!name) {
        throw new Error('Folder name is required.');
    }

    return {
        name,
        visibility
    };
}

export function normalizeTeamMediaVideoDraft(draft = {}) {
    const title = asTrimmedString(draft.title);
    const url = getSafeUrl(draft.url);

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

export function canViewTeamMediaFolder(folder, accessLevel) {
    if (!folder) return false;
    if (folder.visibility === 'managers') return accessLevel === 'full';
    return ['full', 'parent'].includes(accessLevel);
}
