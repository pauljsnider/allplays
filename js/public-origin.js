const DEFAULT_PUBLIC_ORIGIN = 'https://allplays.ai';

function isLocalIpv4(hostname) {
    const parts = hostname.split('.').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127
        || (a === 169 && b === 254)
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168);
}

function isDeviceOnlyHost(hostname) {
    const host = hostname.toLowerCase().replace(/\.$/, '');
    if (host.startsWith('[')) {
        const address = host.slice(1, -1);
        if (address === '::' || address === '::1' || /^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/.test(address)) return true;
        // URL normalizes IPv4-mapped IPv6 addresses into two hexadecimal groups.
        const mapped = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
        if (!mapped) return false;
        const high = parseInt(mapped[1], 16);
        const low = parseInt(mapped[2], 16);
        return isLocalIpv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return !host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local')
        || isLocalIpv4(host);
}

// Shared links must work on the recipient's device, including when generated
// inside a Capacitor shell or a local development server. Keep real web hosts
// (including previews and their ports), but never export a device-only origin.
export function resolvePublicOrigin(value = globalThis.location?.origin) {
    try {
        const url = new URL(String(value || DEFAULT_PUBLIC_ORIGIN));
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
            || isDeviceOnlyHost(url.hostname)) return DEFAULT_PUBLIC_ORIGIN;
        return url.origin;
    } catch {
        return DEFAULT_PUBLIC_ORIGIN;
    }
}
