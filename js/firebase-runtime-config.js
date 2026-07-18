const FIREBASE_INIT_JSON_URL = '/__/firebase/init.json';
const ALLPLAYS_RUNTIME_CONFIG_PATH = '.well-known/allplays-runtime-config.json';
const REQUIRED_FIREBASE_FIELDS = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'];
const OPTIONAL_FIREBASE_FIELDS = ['storageBucket', 'measurementId'];
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
    if (typeof window !== 'undefined' && window.location?.origin) {
        const { origin, pathname = '/' } = window.location;
        candidates.add(new URL(`/${ALLPLAYS_RUNTIME_CONFIG_PATH}`, origin).href);

        const appSegment = pathname.indexOf('/app/');
        if (appSegment >= 0) {
            candidates.add(new URL(`${pathname.slice(0, appSegment + 1)}${ALLPLAYS_RUNTIME_CONFIG_PATH}`, origin).href);
        } else if (window.location.hostname?.endsWith('.github.io')) {
            const repositoryBase = pathname.split('/').filter(Boolean)[0];
            if (repositoryBase) {
                candidates.add(new URL(`/${repositoryBase}/${ALLPLAYS_RUNTIME_CONFIG_PATH}`, origin).href);
            }
        }
    } else {
        try {
            candidates.add(new URL(`../${ALLPLAYS_RUNTIME_CONFIG_PATH}`, import.meta.url).href);
        } catch (_error) {
            // Some test and native runtimes do not expose a usable import URL.
        }
    }

    return [...candidates].filter((candidate) => candidate.startsWith('http:') || candidate.startsWith('https:'));
}

async function fetchAllPlaysRuntimeConfig() {
    for (const url of runtimeConfigCandidates()) {
        try {
            const response = await fetch(url, { cache: 'no-store' });
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

export async function resolvePrimaryFirebaseConfig() {
    try {
        const hostedConfig = await fetchFirebaseConfigFromHosting();
        return hostedConfig;
    } catch (error) {
        const globalConfig = readGlobalConfig();
        const inlineConfig = normalizeFirebaseConfig(
            globalConfig.firebase || globalConfig.firebasePrimary || readWindowGlobal('ALLPLAYS_FIREBASE_CONFIG')
        );
        if (inlineConfig) {
            console.warn('Falling back to inline Firebase config after hosted init lookup failed.', error);
            return inlineConfig;
        }

        console.warn('Falling back to bundled Firebase config.', error);
        return { ...DEFAULT_PRIMARY_FIREBASE_CONFIG };
    }
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
