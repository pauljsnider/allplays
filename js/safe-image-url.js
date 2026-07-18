const MAX_IMAGE_URL_LENGTH = 2048;

const FIREBASE_IMAGE_HOSTS = new Set([
    'firebasestorage.googleapis.com',
    'storage.googleapis.com'
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
