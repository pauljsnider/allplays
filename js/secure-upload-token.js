export function createSecureUploadToken(cryptoSource = globalThis.crypto) {
    if (typeof cryptoSource?.randomUUID === 'function') {
        return cryptoSource.randomUUID().replace(/-/g, '');
    }
    if (typeof cryptoSource?.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        cryptoSource.getRandomValues(bytes);
        return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    }
    throw new Error('Secure random values are required for uploads.');
}

export function requireSecureUploadToken(value) {
    const token = String(value || '').trim().replace(/[^\w.-]+/g, '_');
    if (!token) {
        throw new Error('A secure upload attempt identifier is required.');
    }
    return token;
}
