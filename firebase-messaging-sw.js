/* global importScripts, firebase */

importScripts('https://www.gstatic.com/firebasejs/12.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging-compat.js');

const CONFIG_CACHE_NAME = 'allplays-push-config-v1';
const CONFIG_CACHE_KEY = '/__allplays/push/firebase-config.json';
const FIREBASE_INIT_JSON_URL = '/__/firebase/init.json';
const ALLOWED_CLICK_HOSTS = new Set([
    self.location.hostname.toLowerCase(),
    'allplays.ai',
    'www.allplays.ai',
    'localhost',
    '127.0.0.1'
]);

function isValidFirebaseConfig(config) {
    if (!config || typeof config !== 'object') return false;
    const requiredFields = ['apiKey', 'authDomain', 'projectId', 'messagingSenderId', 'appId'];
    return requiredFields.every((field) => typeof config[field] === 'string' && config[field].trim().length > 0);
}

async function readCachedFirebaseConfig() {
    if (typeof caches === 'undefined') return null;
    try {
        const cache = await caches.open(CONFIG_CACHE_NAME);
        const response = await cache.match(CONFIG_CACHE_KEY);
        if (!response) return null;
        const config = await response.json();
        return isValidFirebaseConfig(config) ? config : null;
    } catch {
        return null;
    }
}

async function writeCachedFirebaseConfig(config) {
    if (typeof caches === 'undefined' || !isValidFirebaseConfig(config)) return;
    try {
        const cache = await caches.open(CONFIG_CACHE_NAME);
        await cache.put(CONFIG_CACHE_KEY, new Response(JSON.stringify(config), {
            headers: { 'Content-Type': 'application/json' }
        }));
    } catch {
        // Non-fatal: runtime config can still be used for this session.
    }
}

async function fetchFirebaseConfigFromHosting() {
    const response = await fetch(FIREBASE_INIT_JSON_URL, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Failed to load Firebase config (${response.status})`);
    }
    const config = await response.json();
    if (!isValidFirebaseConfig(config)) {
        throw new Error('Firebase config payload was invalid');
    }
    return config;
}

async function resolveFirebaseConfig() {
    const cachedConfig = await readCachedFirebaseConfig();
    try {
        const hostedConfig = await fetchFirebaseConfigFromHosting();
        await writeCachedFirebaseConfig(hostedConfig);
        return hostedConfig;
    } catch (error) {
        if (cachedConfig) return cachedConfig;
        throw error;
    }
}

function normalizeNotificationLink(rawLink) {
    const link = typeof rawLink === 'string' ? rawLink.trim() : '';
    if (!link) return '/';

    try {
        const parsed = new URL(link, self.location.origin);
        const protocolAllowed = parsed.protocol === 'https:' || parsed.protocol === 'http:';
        const hostAllowed = ALLOWED_CLICK_HOSTS.has(parsed.hostname.toLowerCase());
        if (!protocolAllowed || !hostAllowed) return '/';

        if (parsed.origin === self.location.origin) {
            return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
        }
        return parsed.toString();
    } catch {
        return '/';
    }
}

function registerBackgroundMessageHandler(messaging) {
    messaging.onBackgroundMessage((payload) => {
        const title = payload?.notification?.title || 'ALL PLAYS Update';
        const body = payload?.notification?.body || '';
        const link = payload?.fcmOptions?.link || payload?.data?.link || '/';

        self.registration.showNotification(title, {
            body,
            data: { link: normalizeNotificationLink(link) }
        });
    });
}

let messagingInitialization = null;

function ensureMessagingInitialized() {
    if (messagingInitialization) return messagingInitialization;

    messagingInitialization = resolveFirebaseConfig()
        .then((firebaseConfig) => {
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }
            const messaging = firebase.messaging();
            registerBackgroundMessageHandler(messaging);
            return messaging;
        })
        .catch((error) => {
            console.error('Failed to initialize Firebase Messaging in service worker:', error);
            return null;
        });

    return messagingInitialization;
}

self.addEventListener('message', (event) => {
    if (event.data?.type !== 'ALLPLAYS_INIT_FIREBASE_CONFIG') return;
    const firebaseConfig = event.data?.firebaseConfig;
    if (!isValidFirebaseConfig(firebaseConfig)) return;

    event.waitUntil((async () => {
        await writeCachedFirebaseConfig(firebaseConfig);
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
            registerBackgroundMessageHandler(firebase.messaging());
        }
    })());
});

ensureMessagingInitialized();

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = normalizeNotificationLink(event.notification?.data?.link || '/');
    event.waitUntil(clients.openWindow(link));
});
