import {
    sanitizeTelemetryKey,
    sanitizeTelemetryProperties,
    sanitizeTelemetryText
} from './telemetry-utils.js?v=1';

const TELEMETRY_VERSION = '1.0.0';
const DEFAULT_ENDPOINT = 'https://us-central1-game-flow-c6311.cloudfunctions.net/collectTelemetry';
const MAX_QUEUE_SIZE = 40;
const MAX_BATCH_SIZE = 15;
const FLUSH_INTERVAL_MS = 5000;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;
const SCROLL_MILESTONES = [25, 50, 75, 90, 100];
const GLOBAL_KEY = '__allplaysTelemetry';
const SESSION_KEY = 'allplays.telemetry.session';
const VISITOR_KEY = 'allplays.telemetry.visitor';
const OPT_OUT_KEY = 'allplays.telemetry.optOut';

let endpoint = null;
let enabled = false;
let queue = [];
let flushTimer = null;
let userContext = { userId: null, signedIn: false };
let pageStartedAt = Date.now();
let lastScrollCheck = 0;
let capturedScrollMilestones = new Set();
let recentClicks = [];
let hasSentPageLeave = false;
let authContextInitialized = false;
let historyTrackingInitialized = false;
let globalListenersInitialized = false;
let localStorageAvailable = null;
let sessionStorageAvailable = null;
let visitorIdCache = null;
let sessionCache = null;
let lastSessionStorageWrite = 0;
let firebaseAuthModulePromise = null;

function loadFirebaseAuthModule() {
    if (!firebaseAuthModulePromise) {
        firebaseAuthModulePromise = import('./firebase.js?v=19')
            .then((module) => ({
                auth: module.auth,
                onAuthStateChanged: module.onAuthStateChanged
            }))
            .catch(() => null);
    }
    return firebaseAuthModulePromise;
}

function canUseStorage(storage, kind) {
    if (kind === 'local' && localStorageAvailable !== null) return localStorageAvailable;
    if (kind === 'session' && sessionStorageAvailable !== null) return sessionStorageAvailable;

    let available = false;
    try {
        const key = '__allplays_storage_test__';
        storage.setItem(key, '1');
        storage.removeItem(key);
        available = true;
    } catch (error) {
        available = false;
    }

    if (kind === 'local') localStorageAvailable = available;
    if (kind === 'session') sessionStorageAvailable = available;
    return available;
}

function randomId(prefix) {
    if (window.crypto?.randomUUID) {
        return `${prefix}_${window.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getLocalStorageValue(key) {
    if (!canUseStorage(window.localStorage, 'local')) return null;
    return window.localStorage.getItem(key);
}

function setLocalStorageValue(key, value) {
    if (!canUseStorage(window.localStorage, 'local')) return;
    window.localStorage.setItem(key, value);
}

function getSessionStorageValue(key) {
    if (!canUseStorage(window.sessionStorage, 'session')) return null;
    return window.sessionStorage.getItem(key);
}

function setSessionStorageValue(key, value) {
    if (!canUseStorage(window.sessionStorage, 'session')) return;
    window.sessionStorage.setItem(key, value);
}

function getVisitorId() {
    if (visitorIdCache) return visitorIdCache;

    const existing = getLocalStorageValue(VISITOR_KEY);
    visitorIdCache = existing || randomId('visitor');
    if (!existing) {
        setLocalStorageValue(VISITOR_KEY, visitorIdCache);
    }
    return visitorIdCache;
}

function getSessionId() {
    const now = Date.now();

    if (sessionCache?.id && now - sessionCache.lastSeen < SESSION_TIMEOUT_MS) {
        sessionCache.lastSeen = now;
        if (now - lastSessionStorageWrite >= SESSION_TOUCH_INTERVAL_MS) {
            setSessionStorageValue(SESSION_KEY, JSON.stringify(sessionCache));
            lastSessionStorageWrite = now;
        }
        return sessionCache.id;
    }

    const existing = getSessionStorageValue(SESSION_KEY);
    if (existing) {
        try {
            const parsed = JSON.parse(existing);
            if (parsed?.id && parsed?.lastSeen && now - parsed.lastSeen < SESSION_TIMEOUT_MS) {
                parsed.lastSeen = now;
                sessionCache = parsed;
                setSessionStorageValue(SESSION_KEY, JSON.stringify(sessionCache));
                lastSessionStorageWrite = now;
                return parsed.id;
            }
        } catch (error) {
            // Fall through and create a fresh session.
        }
    }

    sessionCache = { id: randomId('session'), startedAt: now, lastSeen: now };
    setSessionStorageValue(SESSION_KEY, JSON.stringify(sessionCache));
    lastSessionStorageWrite = now;
    return sessionCache.id;
}

function resolveEndpoint() {
    const config = window.__ALLPLAYS_CONFIG__ || {};
    const configuredEndpoint = config.telemetryEndpoint || window.ALLPLAYS_TELEMETRY_ENDPOINT;
    if (typeof configuredEndpoint === 'string' && configuredEndpoint.trim()) {
        return configuredEndpoint.trim();
    }

    const metaEndpoint = document.querySelector('meta[name="allplays-telemetry-endpoint"]')?.content;
    if (typeof metaEndpoint === 'string' && metaEndpoint.trim()) {
        return metaEndpoint.trim();
    }

    return DEFAULT_ENDPOINT;
}

function isLocalDevelopment() {
    return ['localhost', '127.0.0.1', '0.0.0.0', ''].includes(window.location.hostname);
}

function isTelemetryEnabled() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('telemetry') === '0') return false;
    if (params.get('telemetry') === '1') return true;
    if (getLocalStorageValue(OPT_OUT_KEY) === '1') return false;

    const config = window.__ALLPLAYS_CONFIG__ || {};
    if (config.telemetryEnabled === false || window.ALLPLAYS_TELEMETRY_ENABLED === false) {
        return false;
    }

    return !isLocalDevelopment() || config.telemetryEnabled === true || window.ALLPLAYS_TELEMETRY_ENABLED === true;
}

function getSafePath(url = window.location.href) {
    try {
        const parsed = new URL(url, window.location.origin);
        return parsed.pathname || '/';
    } catch (error) {
        return window.location.pathname || '/';
    }
}

function getQueryKeys() {
    return Array.from(new URLSearchParams(window.location.search).keys())
        .map((key) => sanitizeTelemetryKey(key))
        .filter(Boolean)
        .slice(0, 20);
}

function getSafeReferrer() {
    if (!document.referrer) return '';
    try {
        const referrer = new URL(document.referrer);
        if (referrer.origin !== window.location.origin) {
            return referrer.hostname;
        }
        return referrer.pathname || '/';
    } catch (error) {
        return '';
    }
}

function closestTrackableElement(target) {
    if (!(target instanceof Element)) return null;
    return target.closest('[data-telemetry-name], button, a, input, select, textarea, label, summary, [role="button"], [role="link"], [contenteditable="true"]');
}

function shouldIgnoreElement(element) {
    return !!element?.closest?.('[data-telemetry-ignore], [data-no-telemetry]');
}

function getElementText(element) {
    const explicitLabel = element.getAttribute('data-telemetry-label');
    if (explicitLabel) return sanitizeTelemetryText(explicitLabel, 80);

    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) return sanitizeTelemetryText(ariaLabel, 80);

    let text = '';
    if (element instanceof HTMLInputElement) {
        text = element.labels?.[0]?.textContent || element.placeholder || element.name || element.id || element.type;
    } else if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
        text = element.labels?.[0]?.textContent || element.placeholder || element.name || element.id || element.tagName.toLowerCase();
    } else {
        text = element.textContent || element.getAttribute('title') || element.getAttribute('alt') || '';
    }

    return sanitizeTelemetryText(text, 80);
}

function getHrefPath(element) {
    const href = element.getAttribute('href');
    if (!href) return '';
    try {
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin) {
            return url.hostname;
        }
        return url.pathname || '/';
    } catch (error) {
        return sanitizeTelemetryText(href, 80);
    }
}

function describeElement(element) {
    if (!element) return {};
    const tagName = element.tagName.toLowerCase();
    const classes = Array.from(element.classList || [])
        .filter((className) => !className.includes(':'))
        .slice(0, 5)
        .map((className) => sanitizeTelemetryKey(className));

    const dataName = element.getAttribute('data-telemetry-name') || element.getAttribute('data-analytics-name');
    const form = element.closest('form');

    return sanitizeTelemetryProperties({
        telemetryName: dataName || '',
        tagName,
        elementId: element.id || '',
        elementClasses: classes,
        role: element.getAttribute('role') || '',
        type: element.getAttribute('type') || '',
        name: element.getAttribute('name') || '',
        label: getElementText(element),
        href: tagName === 'a' ? getHrefPath(element) : '',
        formId: form?.id || '',
        formName: form?.getAttribute('name') || ''
    });
}

function buildBaseEvent(name, properties = {}) {
    const now = Date.now();
    return {
        id: randomId('event'),
        name: sanitizeTelemetryKey(name) || 'unknown',
        version: TELEMETRY_VERSION,
        sessionId: getSessionId(),
        visitorId: getVisitorId(),
        userId: userContext.userId,
        signedIn: userContext.signedIn,
        clientTimestamp: new Date(now).toISOString(),
        pagePath: getSafePath(),
        pageTitle: sanitizeTelemetryText(document.title, 120),
        queryKeys: getQueryKeys(),
        referrer: getSafeReferrer(),
        viewport: {
            width: window.innerWidth || 0,
            height: window.innerHeight || 0
        },
        screen: {
            width: window.screen?.width || 0,
            height: window.screen?.height || 0
        },
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        language: navigator.language || '',
        userAgent: sanitizeTelemetryText(navigator.userAgent || '', 240),
        properties: sanitizeTelemetryProperties(properties)
    };
}

function enqueue(event) {
    if (!enabled || !endpoint || !event) return;
    queue.push(event);
    if (queue.length > MAX_QUEUE_SIZE) {
        queue = queue.slice(queue.length - MAX_QUEUE_SIZE);
    }
    if (queue.length >= MAX_BATCH_SIZE) {
        scheduleFlush(0);
    } else {
        scheduleFlush(FLUSH_INTERVAL_MS);
    }
}

function scheduleFlush(delayMs) {
    if (flushTimer) {
        if (delayMs !== 0) return;
        window.clearTimeout(flushTimer);
    }
    flushTimer = window.setTimeout(flush, delayMs);
}

export function captureTelemetryEvent(name, properties = {}, options = {}) {
    const event = buildBaseEvent(name, properties);
    enqueue(event);
    if (options.flush) {
        flush(options.keepalive === true);
    }
    return event;
}

export async function sendEvents(events, keepalive = false) {
    const authToken = await getAuthToken();
    const payloadObject = {
        sentAt: new Date().toISOString(),
        events
    };
    if (authToken) {
        payloadObject.authToken = authToken;
    }
    const payload = JSON.stringify(payloadObject);

    if (keepalive && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: 'application/json' });
        if (navigator.sendBeacon(endpoint, blob)) return;
    }

    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: payload,
        keepalive
    });

    if (!response.ok) {
        throw new Error(`Telemetry request failed: ${response.status}`);
    }
}

export async function getAuthToken() {
    const firebaseAuth = await loadFirebaseAuthModule();
    const user = firebaseAuth?.auth?.currentUser;
    if (!user?.getIdToken) return null;

    try {
        return await user.getIdToken();
    } catch (error) {
        return null;
    }
}

export async function flush(keepalive = false) {
    if (flushTimer) {
        window.clearTimeout(flushTimer);
        flushTimer = null;
    }
    if (!enabled || !endpoint || queue.length === 0) return;

    const events = queue.splice(0, MAX_BATCH_SIZE);
    try {
        await sendEvents(events, keepalive);
    } catch (error) {
        queue = events.concat(queue).slice(0, MAX_QUEUE_SIZE);
    }

    if (!keepalive && queue.length > 0) {
        scheduleFlush(queue.length >= MAX_BATCH_SIZE ? 0 : FLUSH_INTERVAL_MS);
    }
}

function capturePageView() {
    hasSentPageLeave = false;
    pageStartedAt = Date.now();
    capturedScrollMilestones = new Set();
    captureTelemetryEvent('page_view', {
        hashPresent: !!window.location.hash,
        navigationType: performance.getEntriesByType?.('navigation')?.[0]?.type || ''
    });
}

function capturePerformance() {
    const navigation = performance.getEntriesByType?.('navigation')?.[0];
    if (!navigation) return;

    captureTelemetryEvent('page_performance', {
        domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
        loadMs: Math.round(navigation.loadEventEnd),
        transferSize: navigation.transferSize || 0
    });
}

function handleClick(event) {
    const element = closestTrackableElement(event.target);
    if (!element || shouldIgnoreElement(element)) return;

    const rect = element.getBoundingClientRect();
    captureTelemetryEvent('interaction_click', {
        ...describeElement(element),
        button: event.button,
        modifierKey: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
        targetXPercent: rect.width ? Math.round(((event.clientX - rect.left) / rect.width) * 100) : null,
        targetYPercent: rect.height ? Math.round(((event.clientY - rect.top) / rect.height) * 100) : null
    });

    trackRageClick(event, element);
}

function trackRageClick(event, element) {
    const now = Date.now();
    recentClicks = recentClicks
        .filter((click) => now - click.time < 1200)
        .slice(-4);
    recentClicks.push({ time: now, x: event.clientX, y: event.clientY });

    let clusteredClickCount = 0;
    recentClicks.forEach((click) => {
        if (Math.abs(click.x - event.clientX) < 30 && Math.abs(click.y - event.clientY) < 30) {
            clusteredClickCount += 1;
        }
    });

    if (clusteredClickCount >= 3) {
        captureTelemetryEvent('interaction_rage_click', {
            ...describeElement(element),
            clickCount: clusteredClickCount,
            x: event.clientX,
            y: event.clientY
        });
        recentClicks = [];
    }
}

function handleChange(event) {
    const element = closestTrackableElement(event.target);
    if (!element || shouldIgnoreElement(element)) return;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) return;

    const properties = describeElement(element);
    properties.hasValue = element.type === 'checkbox' || element.type === 'radio'
        ? element.checked
        : !!element.value;
    properties.valueLengthBucket = element.value ? Math.min(100, Math.ceil(element.value.length / 10) * 10) : 0;
    if (element instanceof HTMLInputElement && element.type === 'file') {
        properties.fileCount = element.files?.length || 0;
    }

    captureTelemetryEvent('interaction_change', properties);
}

function handleSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || shouldIgnoreElement(form)) return;

    captureTelemetryEvent('interaction_submit', {
        formId: form.id || '',
        formName: form.getAttribute('name') || '',
        method: form.getAttribute('method') || 'get',
        action: form.getAttribute('action') ? getSafePath(form.getAttribute('action')) : '',
        fieldCount: form.querySelectorAll('input, select, textarea').length
    });
}

function handleScroll() {
    const now = Date.now();
    if (now - lastScrollCheck < 500) return;
    lastScrollCheck = now;

    const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    const scrollable = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const depth = Math.min(100, Math.round((scrollTop / scrollable) * 100));
    const nextMilestone = SCROLL_MILESTONES.find((milestone) => depth >= milestone && !capturedScrollMilestones.has(milestone));

    if (nextMilestone) {
        capturedScrollMilestones.add(nextMilestone);
        captureTelemetryEvent('scroll_depth', { depthPercent: nextMilestone });
    }
}

function capturePageLeave() {
    if (hasSentPageLeave) return;
    hasSentPageLeave = true;
    captureTelemetryEvent('page_leave', {
        engagementMs: Date.now() - pageStartedAt,
        visibilityState: document.visibilityState
    }, { flush: true, keepalive: true });
}

function setupAuthContext() {
    if (authContextInitialized) return;
    authContextInitialized = true;

    loadFirebaseAuthModule().then((firebaseAuth) => {
        if (!firebaseAuth?.auth || !firebaseAuth?.onAuthStateChanged) return;
        firebaseAuth.onAuthStateChanged(firebaseAuth.auth, (user) => {
            userContext = {
                userId: user?.uid || null,
                signedIn: !!user
            };
            if (user) {
                captureTelemetryEvent('auth_context', { signedIn: true });
            }
        });
    });
}

function setupHistoryTracking() {
    if (historyTrackingInitialized) return;
    historyTrackingInitialized = true;

    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
        const result = originalPushState.apply(this, args);
        window.dispatchEvent(new Event('allplays:navigation'));
        return result;
    };

    history.replaceState = function (...args) {
        const result = originalReplaceState.apply(this, args);
        window.dispatchEvent(new Event('allplays:navigation'));
        return result;
    };

    window.addEventListener('popstate', capturePageView);
    window.addEventListener('hashchange', capturePageView);
    window.addEventListener('allplays:navigation', capturePageView);
}

function setupGlobalListeners() {
    if (globalListenersInitialized) return;
    globalListenersInitialized = true;

    document.addEventListener('click', handleClick, true);
    document.addEventListener('change', handleChange, true);
    document.addEventListener('submit', handleSubmit, true);
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('pagehide', capturePageLeave);
    document.addEventListener('visibilitychange', () => {
        captureTelemetryEvent('visibility_change', { visibilityState: document.visibilityState });
        if (document.visibilityState === 'hidden') {
            capturePageLeave();
        }
    });
    window.addEventListener('error', (event) => {
        captureTelemetryEvent('js_error', {
            message: event.message || '',
            source: getSafePath(event.filename || ''),
            line: event.lineno || 0,
            column: event.colno || 0
        }, { flush: true });
    });
    window.addEventListener('unhandledrejection', (event) => {
        captureTelemetryEvent('js_unhandled_rejection', {
            reason: event.reason?.message || event.reason || ''
        }, { flush: true });
    });
}

function exposeApi() {
    window.AllPlaysTelemetry = {
        capture: captureTelemetryEvent,
        flush,
        optOut() {
            setLocalStorageValue(OPT_OUT_KEY, '1');
            enabled = false;
            queue = [];
        },
        optIn() {
            setLocalStorageValue(OPT_OUT_KEY, '0');
            enabled = true;
            endpoint = resolveEndpoint();
            setupAuthContext();
            setupHistoryTracking();
            setupGlobalListeners();
            capturePageView();
        },
        getSessionId,
        getVisitorId
    };
}

function startTelemetry() {
    if (window[GLOBAL_KEY]?.started) return;

    window[GLOBAL_KEY] = { started: true };
    endpoint = resolveEndpoint();
    enabled = isTelemetryEnabled();
    exposeApi();

    if (!enabled || !endpoint) return;

    setupAuthContext();
    setupHistoryTracking();
    setupGlobalListeners();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', capturePageView, { once: true });
    } else {
        capturePageView();
    }

    window.addEventListener('load', () => {
        window.setTimeout(capturePerformance, 0);
    }, { once: true });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    startTelemetry();
}
