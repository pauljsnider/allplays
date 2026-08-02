export function createSecureUploadToken(cryptoSource: Crypto | undefined = globalThis.crypto) {
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
