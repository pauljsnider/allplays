import {
    CustomProvider,
    ReCaptchaEnterpriseProvider,
    getToken,
    initializeAppCheck
} from './vendor/firebase-app-check.js';
import { resolveAppCheckRuntimeConfig } from './firebase-runtime-config.js?v=16';
import { registerPrimaryAppCheckContext } from './firebase-app-check-rest.js?v=1';

export {
    getPrimaryAppCheckHeaders,
    getPrimaryAppCheckToken,
    isPrimaryFirebaseRestRequest
} from './firebase-app-check-rest.js?v=1';

const INITIALIZATIONS_KEY = '__allplaysAppCheckInitializations';
const STATUS_KEY = '__ALLPLAYS_APP_CHECK_STATUS__';
const NATIVE_TOKEN_FALLBACK_TTL_MS = 10 * 60 * 1000;
const NATIVE_TOKEN_TIMEOUT_MS = 1500;
const NATIVE_TOKEN_RETRY_COOLDOWN_MS = 30 * 1000;

function getInitializations() {
    if (!globalThis[INITIALIZATIONS_KEY]) {
        globalThis[INITIALIZATIONS_KEY] = new Map();
    }
    return globalThis[INITIALIZATIONS_KEY];
}

export function isCapacitorNativeRuntime() {
    const protocol = typeof window !== 'undefined' ? window.location?.protocol : '';
    if (protocol === 'capacitor:' || protocol === 'ionic:') {
        return true;
    }

    const capacitor = typeof window !== 'undefined' ? window.Capacitor : null;
    if (!capacitor) return false;
    if (typeof capacitor.isNativePlatform === 'function') {
        return capacitor.isNativePlatform();
    }
    return capacitor.getPlatform?.() === 'ios' || capacitor.getPlatform?.() === 'android';
}

function isLocalBrowserRuntime() {
    if (typeof window === 'undefined') return false;
    return ['localhost', '127.0.0.1', '[::1]'].includes(window.location?.hostname);
}

function safeErrorDetails(error) {
    return {
        code: typeof error?.code === 'string' ? error.code : undefined,
        // SDK errors can contain request context. Keep diagnostics useful without
        // ever copying a token or credential-shaped value into logs/status.
        message: 'App Check operation failed.'
    };
}

function reportStatus(status) {
    const sanitizedStatus = {
        timestamp: new Date().toISOString(),
        ...status
    };
    globalThis[STATUS_KEY] = sanitizedStatus;

    if (status.state === 'failed' || status.state === 'token-error') {
        console.warn('[app-check] Firebase App Check could not attest this client.', sanitizedStatus);
    } else if (status.state !== 'token-ready') {
        console.info?.('[app-check] Firebase App Check status.', sanitizedStatus);
    }

    if (typeof globalThis.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
        globalThis.dispatchEvent(new globalThis.CustomEvent('allplays:app-check-status', {
            detail: sanitizedStatus
        }));
    }
    return sanitizedStatus;
}

function monitorToken(appCheck, provider) {
    void getToken(appCheck, false).then(() => {
        reportStatus({ state: 'token-ready', provider });
    }).catch((error) => {
        reportStatus({ state: 'token-error', provider, error: safeErrorDetails(error) });
    });
}

export function normalizeNativeAppCheckToken(result, now = Date.now()) {
    const nativeExpiry = Number(result?.expireTimeMillis);
    let jwtExpiry;
    if (!(Number.isFinite(nativeExpiry) && nativeExpiry > now)) {
        try {
            const payload = String(result?.token || '').split('.')[1];
            if (payload && typeof globalThis.atob === 'function') {
                const normalizedPayload = payload.replace(/-/g, '+').replace(/_/g, '/');
                const padding = '='.repeat((4 - (normalizedPayload.length % 4)) % 4);
                const expirationSeconds = Number(JSON.parse(
                    globalThis.atob(normalizedPayload + padding)
                )?.exp);
                const expirationMillis = expirationSeconds * 1000;
                if (Number.isFinite(expirationMillis) && expirationMillis > now) {
                    jwtExpiry = expirationMillis;
                }
            }
        } catch (_error) {
            // A native token should be a JWT, but expiry metadata is optional.
            // Keep malformed payloads fail-open without logging token contents.
        }
    }

    const expireTimeMillis = Number.isFinite(nativeExpiry) && nativeExpiry > now
        ? nativeExpiry
        : jwtExpiry || now + NATIVE_TOKEN_FALLBACK_TTL_MS;

    return {
        token: result?.token,
        expireTimeMillis
    };
}

function createNativeTokenUnavailableError() {
    return new Error('Native App Check attestation is temporarily unavailable.');
}

function withNativeTokenTimeout(promise) {
    let timeoutId;
    const timeout = new Promise((_, reject) => {
        timeoutId = globalThis.setTimeout(() => {
            reject(createNativeTokenUnavailableError());
        }, NATIVE_TOKEN_TIMEOUT_MS);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    });
}

/**
 * Keep native attestation best-effort while App Check is in monitoring mode.
 * A platform provider can take tens of seconds to reject an emulator, an
 * unsupported device, or a temporarily rate-limited install. Firebase SDK
 * reads must not serialize behind that optional attempt. Share one bounded
 * request, cool down failures, and retain a token that arrives after the
 * caller's availability timeout so the next request can recover.
 */
export function createNativeAppCheckTokenLoader(FirebaseAppCheck) {
    let cachedToken = null;
    let inFlight = null;
    let retryAfter = 0;

    return async (forceRefresh = false) => {
        const now = Date.now();
        if (!forceRefresh && cachedToken?.token && cachedToken.expireTimeMillis > now) {
            return cachedToken;
        }
        if (!forceRefresh && now < retryAfter) {
            throw createNativeTokenUnavailableError();
        }
        if (inFlight) return inFlight;

        const nativeRequest = Promise.resolve()
            .then(() => FirebaseAppCheck.getToken({ forceRefresh }))
            .then((result) => {
                const normalized = normalizeNativeAppCheckToken(result);
                if (typeof normalized.token !== 'string' || !normalized.token) {
                    throw createNativeTokenUnavailableError();
                }
                cachedToken = normalized;
                retryAfter = 0;
                return normalized;
            });

        inFlight = withNativeTokenTimeout(nativeRequest)
            .catch(() => {
                if (!cachedToken?.token || cachedToken.expireTimeMillis <= Date.now()) {
                    retryAfter = Date.now() + NATIVE_TOKEN_RETRY_COOLDOWN_MS;
                }
                throw createNativeTokenUnavailableError();
            })
            .finally(() => {
                inFlight = null;
            });
        return inFlight;
    };
}

export async function initializeNativeAppCheck(app, config) {
    const { FirebaseAppCheck } = await import('@capacitor-firebase/app-check');
    const useDebugProvider = config.nativeDebug === true;
    const isIos = typeof window !== 'undefined'
        && window.Capacitor?.getPlatform?.() === 'ios';
    const isTokenAutoRefreshEnabled = config.isTokenAutoRefreshEnabled !== false;
    if (isIos) {
        // AppDelegate installs the iOS factory before FirebaseApp.configure().
        // Calling initialize() here would attempt to replace it too late.
        await FirebaseAppCheck.setTokenAutoRefreshEnabled({
            enabled: isTokenAutoRefreshEnabled
        });
    } else {
        await FirebaseAppCheck.initialize({
            debugToken: useDebugProvider,
            isTokenAutoRefreshEnabled
        });
    }

    const providerName = useDebugProvider ? 'native-debug' : 'native-attestation';
    const loadNativeToken = createNativeAppCheckTokenLoader(FirebaseAppCheck);
    let activated = false;
    const activateBridge = () => {
        if (activated) return;
        activated = true;
        let hasSuppliedStartupToken = false;
        const provider = new CustomProvider({
            getToken: () => {
                // Activation is gated on one valid native token. Supply that
                // cached token for the JavaScript SDK's initial acquisition so
                // startup does not perform a duplicate attestation. Every later
                // provider request is a renewal and must bypass the native cache
                // to avoid an immediate proactive-refresh loop near expiry.
                const forceRefresh = hasSuppliedStartupToken;
                hasSuppliedStartupToken = true;
                return loadNativeToken(forceRefresh);
            }
        });
        const appCheck = initializeAppCheck(app, {
            provider,
            isTokenAutoRefreshEnabled
        });
        registerPrimaryAppCheckContext({
            tokenGetter: (forceRefresh) => getToken(appCheck, forceRefresh)
        });
        reportStatus({ state: 'token-ready', provider: providerName });
    };
    const attemptBridgeActivation = () => {
        void loadNativeToken()
            .then(activateBridge)
            .catch((error) => {
                reportStatus({ state: 'token-error', provider: providerName, error: safeErrorDetails(error) });
                globalThis.setTimeout(attemptBridgeActivation, NATIVE_TOKEN_RETRY_COOLDOWN_MS);
            });
    };

    // Do not register the JavaScript App Check provider until native
    // attestation has produced a real token. Firebase SDKs wait on a registered
    // provider before every request; installing it early turns a monitoring-only
    // rollout into a data-path outage whenever the platform attester stalls.
    attemptBridgeActivation();
    return reportStatus({
        state: 'initialized',
        provider: providerName
    });
}

function initializeWebAppCheck(app, config) {
    const siteKey = config.recaptchaEnterpriseSiteKey;
    if (!siteKey) {
        return reportStatus({
            state: 'skipped',
            reason: 'recaptcha-enterprise-site-key-missing',
            provider: 'web'
        });
    }

    const localDebugToken = isLocalBrowserRuntime()
        ? (config.debugToken || true)
        : false;
    if (localDebugToken) {
        globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN = localDebugToken;
    }

    const appCheck = initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(siteKey),
        isTokenAutoRefreshEnabled: config.isTokenAutoRefreshEnabled !== false
    });
    registerPrimaryAppCheckContext({
        tokenGetter: (forceRefresh) => getToken(appCheck, forceRefresh)
    });
    monitorToken(appCheck, localDebugToken ? 'web-debug' : 'recaptcha-enterprise');
    return reportStatus({
        state: 'initialized',
        provider: localDebugToken ? 'web-debug' : 'recaptcha-enterprise'
    });
}

async function initializeOnce(app) {
    const config = await resolveAppCheckRuntimeConfig();
    if (config.enabled === false) {
        return reportStatus({ state: 'disabled', reason: 'runtime-config' });
    }

    try {
        return isCapacitorNativeRuntime()
            ? await initializeNativeAppCheck(app, config)
            : initializeWebAppCheck(app, config);
    } catch (error) {
        return reportStatus({
            state: 'failed',
            provider: isCapacitorNativeRuntime() ? 'native' : 'web',
            error: safeErrorDetails(error)
        });
    }
}

/**
 * Installs App Check before Firebase services are created. Initialization is
 * intentionally fail-open until Firebase console metrics show every supported
 * client attesting successfully; console enforcement is the separate fail-closed
 * rollout gate.
 */
export function initializePrimaryAppCheck(app) {
    registerPrimaryAppCheckContext({ options: app?.options || {} });
    const initializations = getInitializations();
    if (!initializations.has(app)) {
        initializations.set(app, initializeOnce(app));
    }
    const initialization = initializations.get(app);
    registerPrimaryAppCheckContext({ initialization });
    return initialization;
}

export function getAppCheckStatus() {
    return globalThis[STATUS_KEY] || null;
}
