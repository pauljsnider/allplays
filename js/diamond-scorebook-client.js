import { buildDiamondTeamSetup } from './diamond-rules-profiles.js?v=1';

function compactId(value, maxLength = 128) {
    const id = typeof value === 'string' ? value.trim() : '';
    return id && id.length <= maxLength && !id.includes('/') ? id : '';
}

function createSecureRequestId(cryptoSource = globalThis.crypto) {
    if (cryptoSource && typeof cryptoSource.randomUUID === 'function') {
        const requestId = cryptoSource.randomUUID();
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
            return requestId.toLowerCase();
        }
    }
    if (cryptoSource && typeof cryptoSource.getRandomValues === 'function') {
        const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'));
        return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
    }
    throw new Error('Secure request IDs are unavailable. Reopen this page in a supported browser.');
}

async function getCallable(name, dependencies) {
    const firebase = dependencies.httpsCallable
        ? dependencies
        : await import('./firebase.js?v=4433195');
    return firebase.httpsCallable(firebase.functions, name);
}

export async function configureDiamondTeamForSport(teamId, sport, options = {}, dependencies = {}) {
    const normalizedTeamId = compactId(teamId);
    const setup = buildDiamondTeamSetup(sport, options);
    if (!normalizedTeamId || !setup) {
        return { available: false, configured: false, reason: 'unsupported-team-or-sport' };
    }

    const callable = await getCallable('configureDiamondTeam', dependencies);
    const response = await callable({
        requestId: createSecureRequestId(dependencies.crypto || globalThis.crypto),
        teamId: normalizedTeamId,
        ...setup
    });
    const result = response?.data && typeof response.data === 'object' ? response.data : {};
    return {
        available: result.available === true,
        configured: result.configured === true,
        reason: typeof result.reason === 'string' ? result.reason : null,
        settings: result.settings && typeof result.settings === 'object' ? result.settings : null
    };
}

export async function getDiamondGameAccess(teamId, gameId, dependencies = {}) {
    const normalizedTeamId = compactId(teamId);
    const normalizedGameId = compactId(gameId);
    if (!normalizedTeamId || !normalizedGameId) {
        throw new TypeError('Valid teamId and gameId values are required.');
    }
    const callable = await getCallable('getDiamondAccess', dependencies);
    const response = await callable({ teamId: normalizedTeamId, gameId: normalizedGameId });
    return response?.data && typeof response.data === 'object'
        ? response.data
        : { available: false, canActivate: false, canScore: false, reason: 'invalid-response' };
}

export async function activateDiamondGameForLegacy(teamId, gameId, captureMode = 'quick', dependencies = {}) {
    const normalizedTeamId = compactId(teamId);
    const normalizedGameId = compactId(gameId);
    if (!normalizedTeamId || !normalizedGameId) {
        throw new TypeError('Valid teamId and gameId values are required.');
    }
    const callable = await getCallable('activateDiamondGame', dependencies);
    const response = await callable({
        requestId: createSecureRequestId(dependencies.crypto || globalThis.crypto),
        teamId: normalizedTeamId,
        gameId: normalizedGameId,
        captureMode: captureMode === 'full' ? 'full' : 'quick'
    });
    const result = response?.data && typeof response.data === 'object' ? response.data : {};
    if (result.activated !== true || result.trackingEngine !== 'diamond-v2') {
        throw new Error('The server did not confirm Diamond ownership for this game.');
    }
    return result;
}
