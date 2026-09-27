import { buildDiamondTeamSetup } from './diamond-rules-profiles.js?v=2';

// Static legacy pages do not have Vite's build-time environment. Keep their
// compatibility generation explicit and monotonic so the server can retire
// old clients without changing any legacy game's ownership.
export const DIAMOND_LEGACY_APP_BUILD = 2;

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

function callableErrorCode(error) {
    return String(error?.code || '').trim().toLowerCase().replace(/^functions\//, '');
}

function isRetryableCallableError(error) {
    const code = callableErrorCode(error);
    const message = String(error?.message || '');
    return ['deadline-exceeded', 'internal', 'network-request-failed', 'unavailable', 'unknown'].includes(code)
        || /(network|offline|timeout|timed out|unavailable|failed to fetch)/i.test(message);
}

async function invokeCallableWithRetry(name, payload, dependencies, maxAttempts = 2) {
    const callable = await getCallable(name, dependencies);
    let lastError = null;
    for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
        try {
            return await callable(payload);
        } catch (error) {
            lastError = error;
            if (!isRetryableCallableError(error) || attempt >= maxAttempts) throw error;
        }
    }
    throw lastError || new Error(`Unable to call ${name}.`);
}

function requireAuthoritativeCancellationSnapshot(value) {
    const snapshot = value?.data && typeof value.data === 'object' ? value.data : null;
    const state = snapshot?.state && typeof snapshot.state === 'object' ? snapshot.state : null;
    const instanceId = compactId(snapshot?.instanceId || state?.instanceId);
    const revision = Number(snapshot?.revision ?? state?.revision);
    const rulesProfileId = compactId(state?.rulesProfileId || snapshot?.rulesProfileId);
    const rulesProfileVersion = Number(state?.rulesProfileVersion ?? snapshot?.rulesProfileVersion);
    if (
        !snapshot
        || snapshot.authoritative !== true
        || !instanceId
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(instanceId)
        || !Number.isSafeInteger(revision)
        || revision < 0
        || !rulesProfileId
        || !Number.isSafeInteger(rulesProfileVersion)
        || rulesProfileVersion < 1
    ) {
        throw new Error('The server did not return an authoritative Diamond game revision. Refresh before cancelling.');
    }
    return {
        instanceId,
        revision,
        rulesProfileId,
        rulesProfileVersion,
        lifecycle: typeof state?.lifecycle === 'string' ? state.lifecycle.trim().toLowerCase() : ''
    };
}

function normalizeCancellationReason(value) {
    const reason = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
    if (!reason || reason.length > 300) {
        throw new TypeError('A cancellation reason of at most 300 characters is required.');
    }
    return reason;
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
        appBuild: DIAMOND_LEGACY_APP_BUILD,
        ...setup
    });
    const result = response?.data && typeof response.data === 'object' ? response.data : {};
    return {
        available: result.available === true,
        configured: result.configured === true,
        enabled: result.enabled === true,
        reason: typeof result.reason === 'string' ? result.reason : null,
        settings: result.settings && typeof result.settings === 'object'
            ? result.settings
            : result.configured === true
                ? {
                    enabled: result.enabled === true,
                    sport: result.sport,
                    rulesProfileId: result.rulesProfileId,
                    rulesProfileVersion: result.rulesProfileVersion,
                    captureMode: result.captureMode
                }
                : null
    };
}

export async function getDiamondGameAccess(teamId, gameId, dependencies = {}) {
    const normalizedTeamId = compactId(teamId);
    const normalizedGameId = compactId(gameId);
    if (!normalizedTeamId || !normalizedGameId) {
        throw new TypeError('Valid teamId and gameId values are required.');
    }
    const callable = await getCallable('getDiamondAccess', dependencies);
    const response = await callable({
        teamId: normalizedTeamId,
        gameId: normalizedGameId,
        appBuild: DIAMOND_LEGACY_APP_BUILD
    });
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
        appBuild: DIAMOND_LEGACY_APP_BUILD,
        captureMode: captureMode === 'full' ? 'full' : 'quick'
    });
    const result = response?.data && typeof response.data === 'object' ? response.data : {};
    if (result.activated !== true || result.trackingEngine !== 'diamond-v2') {
        throw new Error('The server did not confirm Diamond ownership for this game.');
    }
    return result;
}

export async function cancelDiamondGameForLegacy(teamId, gameId, options = {}, dependencies = {}) {
    const normalizedTeamId = compactId(teamId);
    const normalizedGameId = compactId(gameId);
    if (!normalizedTeamId || !normalizedGameId) {
        throw new TypeError('Valid teamId and gameId values are required.');
    }
    const reason = normalizeCancellationReason(
        Object.prototype.hasOwnProperty.call(options, 'reason')
            ? options.reason
            : 'Cancelled from schedule management.'
    );
    const stateResponse = await invokeCallableWithRetry('getDiamondState', {
        teamId: normalizedTeamId,
        gameId: normalizedGameId,
        visibility: 'private'
    }, dependencies);
    const snapshot = requireAuthoritativeCancellationSnapshot(stateResponse);
    if (snapshot.lifecycle === 'cancelled') {
        return { cancelled: true, outcome: 'duplicate', revision: snapshot.revision };
    }
    const command = {
        schemaVersion: 2,
        commandId: createSecureRequestId(dependencies.crypto || globalThis.crypto),
        teamId: normalizedTeamId,
        gameId: normalizedGameId,
        appBuild: DIAMOND_LEGACY_APP_BUILD,
        expectedInstanceId: snapshot.instanceId,
        expectedRevision: snapshot.revision,
        rulesProfileId: snapshot.rulesProfileId,
        rulesProfileVersion: snapshot.rulesProfileVersion,
        type: 'cancel',
        payload: { confirmed: true, reason }
    };
    let response;
    try {
        response = await invokeCallableWithRetry('submitDiamondCommand', command, dependencies);
    } catch (error) {
        if (!isRetryableCallableError(error)) throw error;
        try {
            const reconciledResponse = await invokeCallableWithRetry('getDiamondState', {
                teamId: normalizedTeamId,
                gameId: normalizedGameId,
                visibility: 'private'
            }, dependencies);
            const reconciled = requireAuthoritativeCancellationSnapshot(reconciledResponse);
            if (
                reconciled.instanceId === snapshot.instanceId
                && reconciled.lifecycle === 'cancelled'
                && reconciled.revision > snapshot.revision
            ) {
                return { cancelled: true, outcome: 'duplicate', revision: reconciled.revision };
            }
        } catch {
            // The original ambiguous callable error remains authoritative when
            // a private state reload cannot prove a later cancelled revision.
        }
        throw error;
    }
    const result = response?.data && typeof response.data === 'object' ? response.data : {};
    const revision = Number(result.revision);
    if (!['accepted', 'duplicate'].includes(result.outcome) || !Number.isSafeInteger(revision) || revision <= snapshot.revision) {
        const rejectionMessage = typeof result.rejection?.message === 'string' ? result.rejection.message.trim() : '';
        throw new Error(rejectionMessage || 'The server did not confirm Diamond game cancellation.');
    }
    return {
        cancelled: true,
        outcome: result.outcome,
        revision
    };
}
