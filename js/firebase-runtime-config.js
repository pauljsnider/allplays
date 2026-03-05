const FIREBASE_INIT_JSON_URL = '/__/firebase/init.json';
const REQUIRED_FIREBASE_FIELDS = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'];
const OPTIONAL_FIREBASE_FIELDS = ['storageBucket', 'measurementId'];

function readGlobalConfig() {
    return (typeof window !== 'undefined' && window.__ALLPLAYS_CONFIG__ && typeof window.__ALLPLAYS_CONFIG__ === 'object')
        ? window.__ALLPLAYS_CONFIG__
        : {};
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
    const response = await fetch(FIREBASE_INIT_JSON_URL, { cache: 'no-store' });
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
    const globalConfig = readGlobalConfig();
    const inlineConfig = normalizeFirebaseConfig(
        globalConfig.firebase || globalConfig.firebasePrimary || window.ALLPLAYS_FIREBASE_CONFIG
    );
    if (inlineConfig) {
        return inlineConfig;
    }

    return fetchFirebaseConfigFromHosting();
}

export function resolveImageFirebaseConfig() {
    const globalConfig = readGlobalConfig();
    const imageConfig = normalizeFirebaseConfig(
        globalConfig.firebaseImages || globalConfig.firebaseImage || window.ALLPLAYS_FIREBASE_IMAGE_CONFIG
    );
    if (imageConfig) {
        return imageConfig;
    }

    throw new Error(
        'Missing Firebase image config. Set window.__ALLPLAYS_CONFIG__.firebaseImages (or firebaseImage).'
    );
}
