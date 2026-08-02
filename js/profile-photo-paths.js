function sanitizeProfilePhotoPathSegment(value, fallback = '') {
    const sanitized = String(value || '')
        .trim()
        .replace(/[^\w.-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return sanitized || fallback;
}

function requireProfilePhotoPathSegment(value, label) {
    const sanitized = sanitizeProfilePhotoPathSegment(value);
    if (!sanitized) {
        throw new Error(`${label} is required for this profile photo upload.`);
    }
    return sanitized;
}

function buildProfilePhotoFileName(fileName, timestamp = Date.now()) {
    const extensionMatch = sanitizeProfilePhotoPathSegment(fileName).match(/\.([A-Za-z0-9]{1,10})$/);
    const extension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : '';
    return `${timestamp}_profile-photo${extension}`;
}

export function buildUserProfilePhotoPath(userId, fileName, timestamp = Date.now()) {
    return `profile-photos/users/${requireProfilePhotoPathSegment(userId, 'User')}/${buildProfilePhotoFileName(fileName, timestamp)}`;
}

export function buildPlayerProfilePhotoPath(teamId, playerId, fileName, timestamp = Date.now()) {
    return `profile-photos/teams/${requireProfilePhotoPathSegment(teamId, 'Team')}/players/${requireProfilePhotoPathSegment(playerId, 'Player')}/${buildProfilePhotoFileName(fileName, timestamp)}`;
}

export function buildTeamProfilePhotoPath(teamId, fileName, timestamp = Date.now()) {
    return `profile-photos/teams/${requireProfilePhotoPathSegment(teamId, 'Team')}/team/${buildProfilePhotoFileName(fileName, timestamp)}`;
}
