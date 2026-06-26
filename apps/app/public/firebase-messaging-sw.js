/* global self, caches, Response, fetch, URL, clients, importScripts, firebase, console */

importScripts('https://www.gstatic.com/firebasejs/12.6.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.6.0/firebase-messaging-compat.js');

const CONFIG_CACHE_VERSION = 'v2';
const CONFIG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CONFIG_CACHE_NAME = `allplays-push-config-${CONFIG_CACHE_VERSION}`;
const CONFIG_CACHE_KEY = '/__allplays/push/firebase-config.json';
const FIREBASE_INIT_JSON_URL = '/__/firebase/init.json';
const WEB_PUSH_NOTIFICATION_ICON = '/img/logo_small.png';
const WEB_PUSH_NOTIFICATION_BADGE = '/img/logo_small.png';
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
        const cached = await response.json();
        if (cached?.version !== CONFIG_CACHE_VERSION) return null;
        if (!Number.isFinite(cached?.cachedAt) || Date.now() - cached.cachedAt > CONFIG_CACHE_TTL_MS) return null;
        return isValidFirebaseConfig(cached.config) ? cached.config : null;
    } catch {
        return null;
    }
}

async function writeCachedFirebaseConfig(config) {
    if (typeof caches === 'undefined' || !isValidFirebaseConfig(config)) return;
    try {
        const cache = await caches.open(CONFIG_CACHE_NAME);
        await cache.put(CONFIG_CACHE_KEY, new Response(JSON.stringify({
            version: CONFIG_CACHE_VERSION,
            cachedAt: Date.now(),
            config
        }), {
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

    if (link.startsWith('/')) {
        return link;
    }

    try {
        const parsed = new URL(link);
        const host = parsed.hostname.toLowerCase();
        const hostAllowed = ALLOWED_CLICK_HOSTS.has(host);
        const isLocalDevHost = host === 'localhost' || host === '127.0.0.1';
        const protocolAllowed = parsed.protocol === 'https:' || (isLocalDevHost && parsed.protocol === 'http:');
        if (!protocolAllowed || !hostAllowed) return '/';

        return parsed.toString();
    } catch {
        return '/';
    }
}

function normalizeAppRoute(rawRoute) {
    const route = typeof rawRoute === 'string' ? rawRoute.trim() : '';
    if (!route.startsWith('/') || route.startsWith('//')) return '';
    return route;
}

function buildAppRouteNotificationLink(rawRoute) {
    const appRoute = normalizeAppRoute(rawRoute);
    if (!appRoute) return '';
    return new URL(`/app/#${appRoute}`, self.location.origin).toString();
}

function registerBackgroundMessageHandler(messaging) {
    messaging.onBackgroundMessage((payload) => {
        const title = payload?.notification?.title || 'ALL PLAYS Update';
        const body = payload?.notification?.body || '';
        const link = buildAppRouteNotificationLink(payload?.data?.appRoute)
            || payload?.fcmOptions?.link
            || payload?.data?.link
            || '/';
        const icon = payload?.notification?.icon || payload?.data?.icon || WEB_PUSH_NOTIFICATION_ICON;
        const badge = payload?.notification?.badge || payload?.data?.badge || WEB_PUSH_NOTIFICATION_BADGE;

        self.registration.showNotification(title, {
            body,
            icon,
            badge,
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
