const FIREBASE_INIT_JSON_URL = '/__/firebase/init.json';
const REQUIRED_FIREBASE_FIELDS = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'];
const OPTIONAL_FIREBASE_FIELDS = ['storageBucket', 'measurementId'];
const DEFAULT_PRIMARY_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc',
    authDomain: 'game-flow-c6311.firebaseapp.com',
    projectId: 'game-flow-c6311',
    storageBucket: 'game-flow-c6311.firebasestorage.app',
    messagingSenderId: '1030107289033',
    appId: '1:1030107289033:web:7154238712942475143046',
    measurementId: 'G-E48D0L8L40'
};
const DEFAULT_IMAGE_FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCxeLIe1ZcbX_GH5TEg1MBo8vmxGs6cttE',
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

    try {
        return await fetchFirebaseConfigFromHosting();
    } catch (error) {
        console.warn('Falling back to bundled Firebase config.', error);
        return { ...DEFAULT_PRIMARY_FIREBASE_CONFIG };
    }
}

export function resolveImageFirebaseConfig() {
    const globalConfig = readGlobalConfig();
    const imageConfig = normalizeFirebaseConfig(
        globalConfig.firebaseImages || globalConfig.firebaseImage || window.ALLPLAYS_FIREBASE_IMAGE_CONFIG
    );
    if (imageConfig) {
        return imageConfig;
    }

    return { ...DEFAULT_IMAGE_FIREBASE_CONFIG };
}
