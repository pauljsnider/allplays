import {
    CustomProvider,
    ReCaptchaEnterpriseProvider,
    getToken,
    initializeAppCheck
} from './vendor/firebase-app-check.js';
import { resolveAppCheckRuntimeConfig } from './firebase-runtime-config.js?v=11';
import { registerPrimaryAppCheckContext } from './firebase-app-check-rest.js?v=1';

export {
    getPrimaryAppCheckHeaders,
    getPrimaryAppCheckToken,
    isPrimaryFirebaseRestRequest
} from './firebase-app-check-rest.js?v=1';

const INITIALIZATIONS_KEY = '__allplaysAppCheckInitializations';
const STATUS_KEY = '__ALLPLAYS_APP_CHECK_STATUS__';

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

export async function initializeNativeAppCheck(app, config) {
    const { FirebaseAppCheck } = await import('@capacitor-firebase/app-check');
    const useDebugProvider = config.nativeDebug === true;
    await FirebaseAppCheck.initialize({
        debugToken: useDebugProvider,
        isTokenAutoRefreshEnabled: config.isTokenAutoRefreshEnabled !== false
    });

    const provider = new CustomProvider({
        getToken: () => FirebaseAppCheck.getToken({ forceRefresh: false })
    });
    const appCheck = initializeAppCheck(app, {
        provider,
        isTokenAutoRefreshEnabled: config.isTokenAutoRefreshEnabled !== false
    });
    registerPrimaryAppCheckContext({
        tokenGetter: (forceRefresh) => getToken(appCheck, forceRefresh)
    });
    monitorToken(appCheck, useDebugProvider ? 'native-debug' : 'native-attestation');
    return reportStatus({
        state: 'initialized',
        provider: useDebugProvider ? 'native-debug' : 'native-attestation'
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
