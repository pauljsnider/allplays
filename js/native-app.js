const APP_MODE_QUERY_PARAM = 'app';
const APP_MODE_QUERY_VALUE = '1';
const APP_MODE_STORAGE_KEY = 'allplays-app-mode';
const APP_STYLESHEET_ID = 'allplays-app-mode-stylesheet';
const APP_STYLESHEET_HREF = 'css/mobile-app.css?v=4';
const CAPACITOR_CORE_PATH = '../vendor/capacitor-core.js';
const FORCE_APP_MODE_GLOBAL = '__ALLPLAYS_FORCE_APP_MODE__';

let capacitorModulePromise = null;
let appLinkRouterInstalled = false;

function getWindowObject() {
    return typeof window !== 'undefined' ? window : null;
}

function getCurrentUrl() {
    const windowObject = getWindowObject();
    if (!windowObject?.location) return null;

    try {
        return new URL(windowObject.location.href);
    } catch (_) {
        return null;
    }
}

function getSessionStorage() {
    try {
        return getWindowObject()?.sessionStorage || null;
    } catch (_) {
        return null;
    }
}

function getGlobalCapacitor() {
    const windowObject = getWindowObject();
    return windowObject?.Capacitor || globalThis.Capacitor || null;
}

function hasAppModeQueryParam() {
    const url = getCurrentUrl();
    return url?.searchParams?.get(APP_MODE_QUERY_PARAM) === APP_MODE_QUERY_VALUE;
}

function hasStoredAppMode() {
    return getSessionStorage()?.getItem(APP_MODE_STORAGE_KEY) === APP_MODE_QUERY_VALUE;
}

function hasForcedAppMode() {
    const windowObject = getWindowObject();
    return windowObject?.[FORCE_APP_MODE_GLOBAL] === true ||
        windowObject?.document?.querySelector?.('meta[name="allplays-app-mode"]')?.content === APP_MODE_QUERY_VALUE;
}

export function markAppMode() {
    getSessionStorage()?.setItem(APP_MODE_STORAGE_KEY, APP_MODE_QUERY_VALUE);
}

export function getNativePlatform() {
    if (hasForcedAppMode()) return 'native';

    const capacitor = getGlobalCapacitor();
    const platform = capacitor?.getPlatform?.();
    if (platform === 'ios' || platform === 'android') return platform;

    const protocol = getCurrentUrl()?.protocol || '';
    if (protocol === 'capacitor:') return 'native';

    return 'web';
}

export function isNativeApp() {
    if (hasForcedAppMode()) return true;

    const capacitor = getGlobalCapacitor();
    if (capacitor?.isNativePlatform?.()) return true;
    return getCurrentUrl()?.protocol === 'capacitor:';
}

export function isAppMode() {
    return hasForcedAppMode() || isNativeApp() || hasAppModeQueryParam() || hasStoredAppMode();
}

export function isSameOriginAppPage(href) {
    const windowObject = getWindowObject();
    if (!windowObject?.location || !href) return false;
    if (String(href).trim().startsWith('#')) return false;
    if (/^(mailto|tel|sms|javascript):/i.test(String(href))) return false;

    let url;
    try {
        url = new URL(href, windowObject.location.href);
    } catch (_) {
        return false;
    }

    const currentOrigin = windowObject.location.origin;
    if (url.origin !== currentOrigin) return false;

    const pathname = url.pathname || '';
    return pathname === '/' || pathname.endsWith('.html');
}

export function withAppContext(href) {
    if (!isAppMode() || !isSameOriginAppPage(href)) return href;

    const windowObject = getWindowObject();
    const url = new URL(href, windowObject.location.href);
    const pathname = url.pathname.replace(/^\/+/, '') || 'index.html';

    if (pathname === 'calendar.html') {
        url.pathname = 'parent-dashboard.html';
        url.hash = 'schedule-section';
    }

    url.searchParams.set(APP_MODE_QUERY_PARAM, APP_MODE_QUERY_VALUE);

    const appPathname = url.pathname.replace(/^\/+/, '') || 'index.html';
    return `${appPathname}${url.search}${url.hash}`;
}

export function getAppHomeUrl() {
    return withAppContext('parent-dashboard.html');
}

export function getAppScheduleUrl() {
    return withAppContext('parent-dashboard.html#schedule-section');
}

export function getAppMessagesUrl() {
    return withAppContext('messages.html');
}

export function getAppLoginUrl() {
    return isAppMode() ? withAppContext('index.html') : 'login.html';
}

export function getAppPostAuthRedirectUrl(defaultUrl = 'parent-dashboard.html') {
    if (!isAppMode()) return defaultUrl;
    const appRoute = /^(parent-dashboard|calendar|messages|team-chat)\.html(?:[?#].*)?$/i.test(String(defaultUrl || ''))
        ? defaultUrl
        : 'parent-dashboard.html';
    return withAppContext(appRoute);
}

function appendAppStylesheet() {
    const documentObject = typeof document !== 'undefined' ? document : null;
    if (!documentObject?.head || documentObject.getElementById(APP_STYLESHEET_ID)) return;

    const link = documentObject.createElement('link');
    link.id = APP_STYLESHEET_ID;
    link.rel = 'stylesheet';
    link.href = APP_STYLESHEET_HREF;
    documentObject.head.appendChild(link);
}

function applyBodyClasses() {
    const documentObject = typeof document !== 'undefined' ? document : null;
    if (!documentObject?.documentElement) return;

    documentObject.documentElement.classList.add('allplays-app-document');
    if (documentObject.body) {
        documentObject.body.classList.add('allplays-app-mode', `allplays-platform-${getNativePlatform()}`);
    }
}

function routeAnchorClick(event) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
    }

    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || anchor.target || anchor.hasAttribute('download') || anchor.dataset.noAppRoute === 'true') {
        return;
    }

    const routedHref = withAppContext(anchor.getAttribute('href'));
    if (routedHref === anchor.getAttribute('href')) return;

    event.preventDefault();
    getWindowObject().location.href = routedHref;
}

export function installAppLinkRouter() {
    if (appLinkRouterInstalled || !isAppMode()) return;
    const documentObject = typeof document !== 'undefined' ? document : null;
    if (!documentObject?.addEventListener) return;

    appLinkRouterInstalled = true;
    documentObject.addEventListener('click', routeAnchorClick);
}

export function applyNativeAppDocumentMode() {
    if (!isAppMode()) return;

    markAppMode();
    appendAppStylesheet();
    applyBodyClasses();
    installAppLinkRouter();

    if (typeof document !== 'undefined' && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyBodyClasses, { once: true });
    }
}

async function loadCapacitorModule() {
    if (!capacitorModulePromise) {
        capacitorModulePromise = import(CAPACITOR_CORE_PATH).catch((error) => {
            capacitorModulePromise = null;
            throw error;
        });
    }
    return capacitorModulePromise;
}

export async function signInWithNativeGoogle({ auth, GoogleAuthProvider, signInWithCredential } = {}) {
    const { Capacitor, registerPlugin } = await loadCapacitorModule();
    if (!Capacitor?.isNativePlatform?.() || !Capacitor?.isPluginAvailable?.('FirebaseAuthentication')) {
        throw new Error('Native Google sign-in is only available in the iOS or Android app.');
    }

    const FirebaseAuthentication = registerPlugin('FirebaseAuthentication');
    const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
    const idToken = result?.credential?.idToken;
    const accessToken = result?.credential?.accessToken;
    if (!idToken) {
        throw new Error('Google sign-in did not return an ID token.');
    }

    const credential = GoogleAuthProvider.credential(idToken, accessToken || undefined);
    return signInWithCredential(auth, credential);
}

applyNativeAppDocumentMode();
