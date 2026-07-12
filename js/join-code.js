export const JOIN_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_LENGTH = 8;

const JOIN_CODE_TYPE_ALIASES = new Map([
    ['', ''],
    ['standard', 'standard'],
    ['site', 'standard'],
    ['parent', 'parent'],
    ['parent_invite', 'parent'],
    ['admin', 'admin'],
    ['admin_invite', 'admin'],
    ['household', 'household'],
    ['household_invite', 'household'],
    ['coparent', 'coparent'],
    ['co_parent', 'coparent'],
    ['co-parent', 'coparent'],
    ['coparent_invite', 'coparent']
]);

export function normalizeJoinCode(value) {
    return String(value || '').trim().toUpperCase();
}

export function isValidJoinCode(value) {
    const normalizedCode = normalizeJoinCode(value);
    return normalizedCode.length === JOIN_CODE_LENGTH && /^[A-Z0-9]+$/.test(normalizedCode);
}

export function normalizeJoinCodeType(value) {
    const normalizedType = String(value || '').trim().toLowerCase();
    return JOIN_CODE_TYPE_ALIASES.get(normalizedType) ?? '';
}

export function generateJoinCode(cryptoApi = globalThis.crypto || globalThis.msCrypto) {
    if (!cryptoApi?.getRandomValues) {
        throw new Error('Secure random number generation is not available in this browser.');
    }

    const maxUnbiasedValue = Math.floor(256 / JOIN_CODE_CHARS.length) * JOIN_CODE_CHARS.length;
    let code = '';

    while (code.length < JOIN_CODE_LENGTH) {
        const randomValues = new Uint8Array(JOIN_CODE_LENGTH - code.length);
        cryptoApi.getRandomValues(randomValues);
        for (const value of randomValues) {
            if (value >= maxUnbiasedValue) {
                continue;
            }
            code += JOIN_CODE_CHARS.charAt(value % JOIN_CODE_CHARS.length);
            if (code.length === JOIN_CODE_LENGTH) {
                break;
            }
        }
    }

    return code;
}

export function buildLegacyJoinUrl(code, type = '', origin = '') {
    const normalizedCode = normalizeJoinCode(code);
    if (!isValidJoinCode(normalizedCode)) {
        return '';
    }

    const searchParams = new URLSearchParams({ code: normalizedCode });
    const normalizedType = normalizeJoinCodeType(type);
    if (normalizedType) {
        searchParams.set('type', normalizedType);
    }

    const path = `accept-invite.html?${searchParams.toString()}`;
    if (!origin) {
        return path;
    }

    return new URL(`/${path}`, String(origin).replace(/\/$/, '')).toString();
}
