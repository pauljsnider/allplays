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
    return `${timestamp}_${sanitizeProfilePhotoPathSegment(fileName, 'profile-photo')}`;
}

export function buildUserProfilePhotoPath(userId, fileName, timestamp = Date.now()) {
    return `profile-photos/users/${requireProfilePhotoPathSegment(userId, 'User')}/${buildProfilePhotoFileName(fileName, timestamp)}`;
}

export function buildPlayerProfilePhotoPath(teamId, playerId, userId, fileName, timestamp = Date.now()) {
    return `profile-photos/teams/${requireProfilePhotoPathSegment(teamId, 'Team')}/players/${requireProfilePhotoPathSegment(playerId, 'Player')}/${requireProfilePhotoPathSegment(userId, 'User')}/${buildProfilePhotoFileName(fileName, timestamp)}`;
}

export function buildTeamProfilePhotoPath(teamId, userId, fileName, timestamp = Date.now()) {
    return `profile-photos/teams/${requireProfilePhotoPathSegment(teamId, 'Team')}/team/${requireProfilePhotoPathSegment(userId, 'User')}/${buildProfilePhotoFileName(fileName, timestamp)}`;
}
