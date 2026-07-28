const FIREBASE_INIT_JSON_URL = '/__/firebase/init.json';
const ALLPLAYS_RUNTIME_CONFIG_PATH = '.well-known/allplays-runtime-config.json';
const REQUIRED_FIREBASE_FIELDS = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'];
const OPTIONAL_FIREBASE_FIELDS = ['storageBucket', 'measurementId'];
const CANONICAL_PRODUCTION_HOSTNAMES = new Set(['allplays.ai', 'www.allplays.ai']);
const PRODUCTION_FIREBASE_HOSTING_HOSTNAMES = new Set([
    'game-flow-c6311.web.app',
    'game-flow-c6311.firebaseapp.com'
]);
const DEFAULT_PRIMARY_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc',
    authDomain: 'game-flow-c6311.firebaseapp.com',
    projectId: 'game-flow-c6311',
    storageBucket: 'game-flow-c6311.firebasestorage.app',
    // Must match the project's real web app registration (see
    // /__/firebase/init.json on Firebase Hosting). The previous sender/app id
    // pair belonged to another project (game-flow-c6311's project number is
    // 982493478258), so Installations — and with it FCM web push and
    // Performance export — failed with 403 wherever this fallback was used
    // (GitHub Pages, local dev).
    messagingSenderId: '982493478258',
    appId: '1:982493478258:web:1f942c420cef6c40e8b1eb',
    measurementId: 'G-VTLSFV4PHW'
};
const DEFAULT_IMAGE_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCerM6cMh3M9wH6FcvbOjoBog4ukikWRZM',
    authDomain: 'game-flow-img.firebaseapp.com',
    projectId: 'game-flow-img',
    storageBucket: 'game-flow-img.firebasestorage.app',
    messagingSenderId: '340859680438',
    appId: '1:340859680438:web:4d00f571e8531907a11817',
    measurementId: 'G-FRVND6NT3C'
};
let runtimeConfigFetchPromise = null;
let runtimeConfigFetchKey = '';
let runtimeConfigFetchImplementation = null;

function readGlobalConfig() {
    return (typeof window !== 'undefined' && window.__ALLPLAYS_CONFIG__ && typeof window.__ALLPLAYS_CONFIG__ === 'object')
        ? window.__ALLPLAYS_CONFIG__
        : {};
}

function readWindowGlobal(name) {
    return typeof window !== 'undefined' ? window[name] : undefined;
}

function readViteEnvironment() {
    try {
        return import.meta.env || {};
    } catch (_error) {
        return {};
    }
}

function normalizeBoolean(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
    return undefined;
}

function normalizeAppCheckConfig(rawConfig) {
    if (!rawConfig || typeof rawConfig !== 'object') {
        return {};
    }

    const siteKey = rawConfig.recaptchaEnterpriseSiteKey || rawConfig.webSiteKey || rawConfig.siteKey;
    const debugToken = rawConfig.debugToken;
    const normalized = {
        enabled: normalizeBoolean(rawConfig.enabled),
        debug: normalizeBoolean(rawConfig.debug),
        isTokenAutoRefreshEnabled: normalizeBoolean(rawConfig.isTokenAutoRefreshEnabled)
    };

    if (typeof siteKey === 'string' && siteKey.trim()) {
        normalized.recaptchaEnterpriseSiteKey = siteKey.trim();
    }
    if (typeof debugToken === 'boolean') {
        normalized.debugToken = debugToken;
    } else if (typeof debugToken === 'string' && debugToken.trim()) {
        const normalizedDebugToken = debugToken.trim();
        normalized.debugToken = normalizedDebugToken.toLowerCase() === 'true'
            ? true
            : normalizedDebugToken.toLowerCase() === 'false'
                ? false
                : normalizedDebugToken;
    }

    return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value !== undefined));
}

function runtimeConfigCandidates() {
    const candidates = new Set();
    const runtimeLocation = typeof window !== 'undefined'
        ? window.location
        : globalThis.location;

    if (runtimeLocation?.origin) {
        const { origin, pathname = '/' } = runtimeLocation;
        candidates.add(new URL(`/${ALLPLAYS_RUNTIME_CONFIG_PATH}`, origin).href);

        const appSegment = pathname.indexOf('/app/');
        if (appSegment >= 0) {
            candidates.add(new URL(`${pathname.slice(0, appSegment + 1)}${ALLPLAYS_RUNTIME_CONFIG_PATH}`, origin).href);
        } else if (runtimeLocation.hostname?.endsWith('.github.io')) {
            const repositoryBase = pathname.split('/').filter(Boolean)[0];
            if (repositoryBase) {
                candidates.add(new URL(`/${repositoryBase}/${ALLPLAYS_RUNTIME_CONFIG_PATH}`, origin).href);
            }
        }
    }

    return [...candidates].filter((candidate) => candidate.startsWith('http:') || candidate.startsWith('https:'));
}

async function fetchAllPlaysRuntimeConfig() {
    const candidates = runtimeConfigCandidates();
    const fetchImplementation = globalThis.fetch;
    const fetchKey = candidates.join('|');
    if (
        runtimeConfigFetchPromise
        && runtimeConfigFetchKey === fetchKey
        && runtimeConfigFetchImplementation === fetchImplementation
    ) {
        return runtimeConfigFetchPromise;
    }

    runtimeConfigFetchKey = fetchKey;
    runtimeConfigFetchImplementation = fetchImplementation;
    runtimeConfigFetchPromise = (async () => {
        if (typeof fetchImplementation !== 'function') return {};
        for (const url of candidates) {
            try {
                const response = await fetchImplementation(url, { cache: 'no-store' });
                if (!response.ok) continue;
                const payload = await response.json();
                if (payload && typeof payload === 'object') {
                    return payload;
                }
            } catch (_error) {
                // Runtime config is optional until App Check console rollout is complete.
            }
        }
        return {};
    })();
    return runtimeConfigFetchPromise;
}

function normalizeFirebaseConfig(rawConfig) {
    if (!rawConfig || typeof rawConfig !== 'object') {
        return null;
    }

    const normalized = {};
    const supportedFields = [...REQUIRED_FIREBASE_FIELDS, ...OPTIONAL_FIREBASE_FIELDS];
    for (const field of supportedFields) {
        const value = rawConfig[field];
        if (typeof value === 'string' && value.trim()) {
            normalized[field] = value.trim();
        }
    }

    const hasRequiredFields = REQUIRED_FIREBASE_FIELDS.every((field) => typeof normalized[field] === 'string' && normalized[field].length > 0);
    return hasRequiredFields ? normalized : null;
}

function isCanonicalProductionHostname(hostname) {
    return CANONICAL_PRODUCTION_HOSTNAMES.has(String(hostname || '').trim().toLowerCase());
}

function isProductionFirebaseHostingHostname(hostname) {
    return PRODUCTION_FIREBASE_HOSTING_HOSTNAMES.has(String(hostname || '').trim().toLowerCase());
}

function isBundledProductionFirebaseConfig(config) {
    return config?.projectId === DEFAULT_PRIMARY_FIREBASE_CONFIG.projectId;
}

function isNativeRuntimeProtocol(protocol) {
    return protocol === 'capacitor:' || protocol === 'ionic:';
}

async function fetchFirebaseConfigFromHosting() {
    const baseUrl = (typeof window !== 'undefined' && window.location && window.location.origin)
        ? window.location.origin
        : 'http://localhost'; // Fallback for Node.js tests
    const absoluteUrl = new URL(FIREBASE_INIT_JSON_URL, baseUrl).href;
    const protocol = new URL(absoluteUrl).protocol;
    if (protocol !== 'http:' && protocol !== 'https:') {
        throw new Error(`Firebase Hosting init config is unavailable for ${protocol} origins`);
    }
    const response = await fetch(absoluteUrl, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Firebase config request failed (${response.status})`);
    }

    const payload = await response.json();
    const normalized = normalizeFirebaseConfig(payload);
    if (!normalized) {
        throw new Error('Firebase config payload is missing required fields');
    }

    return normalized;
}

async function fetchNonProductionFirebaseConfigFromHosting() {
    const config = await fetchFirebaseConfigFromHosting();
    if (isBundledProductionFirebaseConfig(config)) {
        throw new Error('Firebase Hosting init config points to production Firebase on a non-production host.');
    }
    return config;
}

async function fetchProductionFirebaseConfigFromHosting() {
    const config = await fetchFirebaseConfigFromHosting();
    if (!isBundledProductionFirebaseConfig(config)) {
        throw new Error('Firebase Hosting init config does not match the production Firebase project.');
    }
    return config;
}

export async function resolvePrimaryFirebaseConfig() {
    const runtimeHostname = typeof window !== 'undefined'
        ? window.location?.hostname
        : globalThis.location?.hostname;
    const runtimeProtocol = typeof window !== 'undefined'
        ? window.location?.protocol
        : globalThis.location?.protocol;
    const canonicalProductionHost = isCanonicalProductionHostname(runtimeHostname);
    const productionFirebaseHostingHost = isProductionFirebaseHostingHostname(runtimeHostname);
    const nativeRuntime = isNativeRuntimeProtocol(runtimeProtocol);
    const globalConfig = readGlobalConfig();
    const inlineConfig = normalizeFirebaseConfig(
        globalConfig.firebase || globalConfig.firebasePrimary || readWindowGlobal('ALLPLAYS_FIREBASE_CONFIG')
    );
    if (
        inlineConfig
        && (
            !isBundledProductionFirebaseConfig(inlineConfig)
            || canonicalProductionHost
            || productionFirebaseHostingHost
            || nativeRuntime
            || !runtimeHostname
        )
    ) {
        return inlineConfig;
    }

    if (nativeRuntime) {
        return { ...DEFAULT_PRIMARY_FIREBASE_CONFIG };
    }

    const localDevelopmentHost = runtimeHostname === 'localhost' || runtimeHostname === '127.0.0.1';
    const firebaseHostingHost = Boolean(
        runtimeHostname?.endsWith('.web.app')
        || runtimeHostname?.endsWith('.firebaseapp.com')
    );

    if (canonicalProductionHost) {
        const remoteConfig = await fetchAllPlaysRuntimeConfig();
        const remoteFirebaseConfig = normalizeFirebaseConfig(
            remoteConfig.firebase || remoteConfig.firebasePrimary
        );
        return remoteFirebaseConfig || { ...DEFAULT_PRIMARY_FIREBASE_CONFIG };
    }

    if (productionFirebaseHostingHost) {
        return fetchProductionFirebaseConfigFromHosting();
    }

    if (!runtimeHostname || localDevelopmentHost || firebaseHostingHost) {
        try {
            return await fetchNonProductionFirebaseConfigFromHosting();
        } catch (hostingError) {
            if (firebaseHostingHost) {
                throw hostingError;
            }

            const remoteConfig = await fetchAllPlaysRuntimeConfig();
            const remoteFirebaseConfig = normalizeFirebaseConfig(
                remoteConfig.firebase || remoteConfig.firebasePrimary
            );
            if (
                remoteFirebaseConfig
                && !isBundledProductionFirebaseConfig(remoteFirebaseConfig)
            ) {
                return remoteFirebaseConfig;
            }
            if (!runtimeHostname) {
                return { ...DEFAULT_PRIMARY_FIREBASE_CONFIG };
            }
            if (localDevelopmentHost) {
                throw new Error('Firebase config is unavailable for local development. Configure an explicit non-production Firebase project.');
            }
            throw hostingError;
        }
    }

    const remoteConfig = await fetchAllPlaysRuntimeConfig();
    const remoteFirebaseConfig = normalizeFirebaseConfig(
        remoteConfig.firebase || remoteConfig.firebasePrimary
    );
    if (
        remoteFirebaseConfig
        && !isBundledProductionFirebaseConfig(remoteFirebaseConfig)
    ) {
        return remoteFirebaseConfig;
    }
    throw new Error('Firebase config is unavailable for this non-production host.');
}

export function resolveImageFirebaseConfig() {
    const globalConfig = readGlobalConfig();
    const imageConfig = normalizeFirebaseConfig(
        globalConfig.firebaseImages || globalConfig.firebaseImage || readWindowGlobal('ALLPLAYS_FIREBASE_IMAGE_CONFIG')
    );
    if (imageConfig) {
        return imageConfig;
    }

    return { ...DEFAULT_IMAGE_FIREBASE_CONFIG };
}

export function isNativeAppCheckDebugBuild(viteEnvironment = {}) {
    return viteEnvironment.MODE === 'native-debug';
}

export async function resolveAppCheckRuntimeConfig() {
    const globalConfig = readGlobalConfig();
    const viteEnvironment = readViteEnvironment();
    const inlineConfig = globalConfig.appCheck || readWindowGlobal('ALLPLAYS_APP_CHECK_CONFIG');
    const remoteConfig = inlineConfig ? {} : await fetchAllPlaysRuntimeConfig();
    const configured = normalizeAppCheckConfig(
        inlineConfig || remoteConfig.appCheck
    );
    const viteConfig = normalizeAppCheckConfig({
        enabled: viteEnvironment.VITE_APP_CHECK_ENABLED,
        recaptchaEnterpriseSiteKey: viteEnvironment.VITE_APP_CHECK_RECAPTCHA_ENTERPRISE_SITE_KEY,
        debugToken: viteEnvironment.VITE_APP_CHECK_DEBUG_TOKEN,
        isTokenAutoRefreshEnabled: true
    });
    const nativeDebug = isNativeAppCheckDebugBuild(viteEnvironment);

    return {
        isTokenAutoRefreshEnabled: true,
        ...viteConfig,
        ...configured,
        // Native debug providers are build-time only. Runtime/remote config can
        // never switch a production binary to the bypass provider.
        nativeDebug
    };
}
