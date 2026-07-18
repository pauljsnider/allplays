const PRIMARY_INITIALIZATION_KEY = '__allplaysPrimaryAppCheckInitialization';
const PRIMARY_OPTIONS_KEY = '__allplaysPrimaryFirebaseOptions';
const PRIMARY_TOKEN_GETTER_KEY = '__allplaysPrimaryAppCheckTokenGetter';
const STATUS_KEY = '__ALLPLAYS_APP_CHECK_STATUS__';

export function registerPrimaryAppCheckContext({ initialization, options, tokenGetter } = {}) {
    if (initialization) globalThis[PRIMARY_INITIALIZATION_KEY] = initialization;
    if (options) globalThis[PRIMARY_OPTIONS_KEY] = { ...options };
    if (typeof tokenGetter === 'function') globalThis[PRIMARY_TOKEN_GETTER_KEY] = tokenGetter;
}

function reportTokenError() {
    const status = {
        timestamp: new Date().toISOString(),
        state: 'token-error',
        provider: 'rest',
        error: { message: 'App Check operation failed.' }
    };
    globalThis[STATUS_KEY] = status;
    console.warn('[app-check] Firebase App Check token was unavailable for a REST request.', status);

    if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
        globalThis.dispatchEvent(new globalThis.CustomEvent('allplays:app-check-status', {
            detail: status
        }));
    }
}

/**
 * Returns the current primary-project App Check token when one is available.
 * REST fallbacks intentionally remain fail-open during monitoring: acquisition
 * failures return null and never expose an SDK error or token in status/logs.
 */
export async function getPrimaryAppCheckToken(forceRefresh = false) {
    try {
        const initialization = globalThis[PRIMARY_INITIALIZATION_KEY];
        if (initialization) await initialization;

        const tokenGetter = globalThis[PRIMARY_TOKEN_GETTER_KEY];
        if (typeof tokenGetter !== 'function') return null;
        const result = await tokenGetter(forceRefresh === true);
        if (result?.error != null || result?.internalError != null) {
            reportTokenError();
            return null;
        }
        return typeof result?.token === 'string' && result.token ? result.token : null;
    } catch (_error) {
        reportTokenError();
        return null;
    }
}

export function isPrimaryFirebaseRestRequest(requestUrl) {
    const options = globalThis[PRIMARY_OPTIONS_KEY];
    if (!options?.projectId || typeof requestUrl !== 'string' || !requestUrl) return false;

    let url;
    try {
        url = new URL(requestUrl, globalThis.location?.origin || 'https://allplays.invalid');
    } catch (_error) {
        return false;
    }

    const host = url.hostname.toLowerCase();
    const projectId = String(options.projectId);
    if (host === 'identitytoolkit.googleapis.com' || host === 'securetoken.googleapis.com') {
        return Boolean(options.apiKey) && url.searchParams.get('key') === String(options.apiKey);
    }
    if (host === 'firestore.googleapis.com') {
        return decodeURIComponent(url.pathname).startsWith(`/v1/projects/${projectId}/`);
    }
    if (host === 'firebasestorage.googleapis.com') {
        const bucket = String(options.storageBucket || '');
        return Boolean(bucket) && decodeURIComponent(url.pathname).startsWith(`/v0/b/${bucket}/`);
    }
    if (host.endsWith('.cloudfunctions.net')) {
        return host.endsWith(`-${projectId.toLowerCase()}.cloudfunctions.net`);
    }
    return false;
}

export async function getPrimaryAppCheckHeaders(headers = {}, requestUrl = '') {
    if (!isPrimaryFirebaseRestRequest(requestUrl)) return { ...headers };
    const token = await getPrimaryAppCheckToken(false);
    return token
        ? { ...headers, 'X-Firebase-AppCheck': token }
        : { ...headers };
}
