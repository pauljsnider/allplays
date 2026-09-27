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

function createProfilePhotoUploadNonce() {
    const secureCrypto = globalThis.crypto;
    if (typeof secureCrypto?.randomUUID === 'function') {
        return secureCrypto.randomUUID().replace(/-/g, '');
    }
    if (typeof secureCrypto?.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        secureCrypto.getRandomValues(bytes);
        return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    }
    throw new Error('Secure random values are required for profile photo uploads.');
}

function buildProfilePhotoFileName(fileName, timestamp = Date.now(), nonce = createProfilePhotoUploadNonce()) {
    const extensionMatch = sanitizeProfilePhotoPathSegment(fileName).match(/\.([A-Za-z0-9]{1,10})$/);
    const extension = extensionMatch ? `.${extensionMatch[1].toLowerCase()}` : '';
    return `${timestamp}_${requireProfilePhotoPathSegment(nonce, 'Upload attempt')}_profile-photo${extension}`;
}

export function validateProfilePhotoFile(file, { maxBytes = 10 * 1024 * 1024 } = {}) {
    const mimeType = String(file?.type || '').trim().toLowerCase();
    const size = Number(file?.size);
    const maximumSize = Number(maxBytes);

    if (!mimeType.startsWith('image/')) {
        throw new Error('Please select an image file.');
    }
    if (!Number.isFinite(size) || size <= 0) {
        throw new Error('Please select a non-empty image file.');
    }
    if (!Number.isFinite(maximumSize) || maximumSize <= 0 || size > maximumSize) {
        throw new Error(`Image size must be ${Math.floor(maximumSize / (1024 * 1024))} MB or smaller.`);
    }
}

export function buildUserProfilePhotoPath(userId, fileName, timestamp = Date.now(), nonce) {
    return `profile-photos/users/${requireProfilePhotoPathSegment(userId, 'User')}/${buildProfilePhotoFileName(fileName, timestamp, nonce)}`;
}

export function buildPlayerProfilePhotoPath(teamId, playerId, fileName, timestamp = Date.now(), nonce) {
    return `profile-photos/teams/${requireProfilePhotoPathSegment(teamId, 'Team')}/players/${requireProfilePhotoPathSegment(playerId, 'Player')}/${buildProfilePhotoFileName(fileName, timestamp, nonce)}`;
}

export function buildTeamProfilePhotoPath(teamId, fileName, timestamp = Date.now(), nonce) {
    return `profile-photos/teams/${requireProfilePhotoPathSegment(teamId, 'Team')}/team/${buildProfilePhotoFileName(fileName, timestamp, nonce)}`;
}
