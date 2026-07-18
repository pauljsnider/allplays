const MAX_IMAGE_URL_LENGTH = 2048;

const FIREBASE_IMAGE_HOSTS = new Set([
    'firebasestorage.googleapis.com',
    'storage.googleapis.com'
]);
const FIRST_PARTY_FIREBASE_STORAGE_BUCKETS = new Set([
    'game-flow-c6311.firebasestorage.app',
    'game-flow-img.firebasestorage.app'
]);

function hasTrustedHostname(hostname, { exactHosts = new Set(), suffixes = [] } = {}) {
    const normalized = String(hostname || '').toLowerCase();
    if (!normalized || normalized.endsWith('.')) return false;
    if (exactHosts.has(normalized)) return true;
    return suffixes.some((suffix) => normalized.endsWith(suffix) && normalized.length > suffix.length);
}

function resolveTrustedHttpsImageUrl(value, trustPolicy) {
    if (typeof value !== 'string' || value.length === 0 || value.length > MAX_IMAGE_URL_LENGTH) return '';
    if (value.trim() !== value || /[\s<>"'`\\\u0000-\u001f\u007f]/.test(value)) return '';

    try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
        if (parsed.port && parsed.port !== '443') return '';
        if (!hasTrustedHostname(parsed.hostname, trustPolicy)) return '';
        return parsed.href;
    } catch (error) {
        return '';
    }
}

export function resolveSafeProfilePhotoUrl(value) {
    return resolveTrustedHttpsImageUrl(value, {
        exactHosts: new Set([...FIREBASE_IMAGE_HOSTS, 'allplays.ai', 'www.allplays.ai']),
        suffixes: ['.googleusercontent.com', '.firebasestorage.app']
    });
}

function isFirstPartyFirebaseStorageUrl(value) {
    try {
        const parsed = new URL(value);
        const hostname = parsed.hostname.toLowerCase();
        if (FIRST_PARTY_FIREBASE_STORAGE_BUCKETS.has(hostname)) return true;

        return [...FIRST_PARTY_FIREBASE_STORAGE_BUCKETS].some((bucket) => {
            if (hostname === 'firebasestorage.googleapis.com') {
                return parsed.pathname.startsWith(`/v0/b/${bucket}/o/`);
            }
            if (hostname === 'storage.googleapis.com') {
                return parsed.pathname.startsWith(`/${bucket}/`) ||
                    parsed.pathname.startsWith(`/download/storage/v1/b/${bucket}/o/`);
            }
            return false;
        });
    } catch (error) {
        return false;
    }
}

export function resolveSafeProfilePhotoWriteUrl(value) {
    const safeUrl = resolveSafeProfilePhotoUrl(value);
    if (!safeUrl || safeUrl !== value) return '';

    const hostname = new URL(safeUrl).hostname.toLowerCase();
    if (hostname === 'allplays.ai' || hostname === 'www.allplays.ai' || hostname.endsWith('.googleusercontent.com')) {
        return safeUrl;
    }
    return isFirstPartyFirebaseStorageUrl(safeUrl) ? safeUrl : '';
}

export function resolveSafeDrillDiagramUrl(value) {
    return resolveTrustedHttpsImageUrl(value, {
        exactHosts: FIREBASE_IMAGE_HOSTS,
        suffixes: ['.firebasestorage.app']
    });
}

export function createSafeImageElement({
    documentRef = globalThis.document,
    url,
    resolveUrl,
    alt = '',
    className = '',
    onLoadError = null
} = {}) {
    if (!documentRef || typeof resolveUrl !== 'function') return null;
    const safeUrl = resolveUrl(url);
    if (!safeUrl) return null;

    const image = documentRef.createElement('img');
    image.src = safeUrl;
    image.alt = String(alt || '');
    image.className = String(className || '');
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    if (typeof onLoadError === 'function') {
        image.addEventListener('error', () => onLoadError(image), { once: true });
    }
    return image;
}
