import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const routeTimings = new WeakMap();
const tools = ['access', 'household', 'fees', 'calendar', 'share', 'registrations', 'certificates'];

function routeTemplate(url, baseline = false) {
    try {
        const parsed = new URL(url);
        if (baseline) return ['/player.html', '/team.html', '/live-game.html', '/index.html', '/'].includes(parsed.pathname) ? parsed.pathname : '[other-page]';
        const route = parsed.hash.slice(1).split('?')[0];
        if (/^\/(home|auth|verify-pending|teams|schedule|officials|help|profile\/settings)$/.test(route)) return route;
        if (tools.some((tool) => route === `/parent-tools/${tool}`)) return route;
        if (/^\/teams\/[^/]+(?:\/(edit|fees|media|certificates))?$/.test(route)) return route.replace(/^(\/teams\/)[^/]+/, '$1:id');
        if (/^\/teams\/[^/]+\/registrations\/[^/]+$/.test(route)) return '/teams/:id/registrations/:id';
        if (/^\/(players|schedule)\/[^/]+\/[^/]+$/.test(route)) return `/${route.split('/')[1]}/:id/:id`;
        if (/^\/messages\/[^/]+$/.test(route)) return '/messages/:id';
    } catch { /* Closed or unavailable page. */ }
    return '[other-route]';
}

// No arbitrary message or URL text enters an artifact. Unknown text is redacted
// in full, including short secrets, names and identifiers regexes cannot detect.
function errorKind(message) {
    if (/Error loading player details/i.test(String(message))) return 'player-load-failed';
    if (/Failed to fetch dynamically imported module/i.test(String(message))) return 'dynamic-import-failed';
    return ['ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_RESET', 'ERR_ABORTED', 'ERR_FAILED',
        'ERR_NAME_NOT_RESOLVED', 'ERR_TIMED_OUT'].find((kind) => String(message).includes(kind)) || '[redacted]';
}

function assetPath(url) {
    try {
        const { pathname } = new URL(url);
        const chunk = pathname.match(/^\/app\/assets\/(FeesTool|ParentTools|index)-[A-Za-z0-9_-]{8}\.js$/);
        if (chunk) return `/app/assets/${chunk[1]}-[hash].js`;
        if (['/js/officiating-slots.js', '/js/firebase-auth.js', '/js/vendor/firebase-auth.js',
            '/js/team-access.js', '/js/auth.js', '/js/edit-schedule-practice-payload.js',
            '/player.html', '/team.html'].includes(pathname)) return pathname;
    } catch { /* Unrecognized URLs are omitted. */ }
    return '[other-asset]';
}

// Fixed categories identify which service failed without serializing hosts,
// endpoint paths, project/document IDs, query strings or credentials.
function requestService(url) {
    try {
        const host = new URL(url).hostname;
        if (['allplays.ai', 'game-flow-c6311.web.app', 'game-flow-c6311.firebaseapp.com'].includes(host)) return 'app-host';
        if (host === 'identitytoolkit.googleapis.com') return 'firebase-auth';
        if (host === 'securetoken.googleapis.com') return 'firebase-token';
        if (host === 'firestore.googleapis.com') return 'firestore';
        if (host === 'firebasestorage.googleapis.com') return 'firebase-storage';
    } catch { /* Unknown requests retain only resource type and status. */ }
    return '[other-service]';
}

function responseHeader(name, value) {
    // Reject rather than truncate: even a short unknown token can be private.
    if (typeof value !== 'string' || value.length > 160 || /[^\x20-\x7e]/.test(value)) return undefined;
    if (name === 'date') {
        const date = new Date(value);
        if (value.length === 29 && date.getUTCFullYear() >= 2000 && date.getUTCFullYear() <= 2100 && date.toUTCString() === value) return date.toISOString();
    }
    if (name === 'content-type' && /^(?:text\/(?:html|plain|css|javascript)|application\/(?:javascript|json|octet-stream))(?:;\s*charset=(?:utf-8|iso-8859-1))?$/i.test(value)) return value.split(';')[0].toLowerCase();
    if (name === 'server' && /^(?:GitHub\.com|Varnish|nginx|Apache|cloudflare|envoy|Google Frontend|GSE|ESF|UploadServer)$/i.test(value)) return value.toLowerCase();
    if (name === 'via' && /^(?:1\.0|1\.1|2) (?:varnish|google|envoy)(?:, (?:1\.0|1\.1|2) (?:varnish|google|envoy)){0,3}$/i.test(value)) return value.toLowerCase();
    if (name === 'age' && /^(?:0|[1-9][0-9]{0,9})$/.test(value) && Number(value) <= 2_147_483_647) return Number(value);
    if (name === 'x-cache' && /^(?:HIT|MISS)(?:, (?:HIT|MISS)){0,3}$/.test(value)) return value.split(', ');
    if (name === 'x-served-by') {
        const nodes = value.split(', ');
        // Only recognizable public cache-node shapes, never arbitrary hostnames.
        if (nodes.length <= 4 && nodes.every((node) => /^cache-(?:[a-z]{3}[0-9]{4,5}|[a-z]{3}-[a-z]{4}[0-9]{7})-[A-Z]{3}$/.test(node))) return nodes;
    }
    if (name === 'x-github-request-id' && /^[A-F0-9]{4}:[A-F0-9]{1,8}:[A-F0-9]{1,8}:[A-F0-9]{1,8}:[A-F0-9]{8}$/i.test(value)) return value;
    return undefined;
}

async function collectResponseMetadata(responses) {
    const headers = {
        date: 'responseUtc', 'content-type': 'contentType', server: 'server', via: 'via',
        age: 'ageSeconds', 'x-cache': 'cache', 'x-served-by': 'servedBy', 'x-github-request-id': 'githubRequestId'
    };
    let accepting = true;
    let timer;
    // The fixed event/header limits bound work. This deadline leaves most of the
    // existing one-second diagnostic budget for state and artifact I/O.
    try {
        const pending = responses.flatMap(({ response, event }) => {
            try {
                const timing = response.request().timing();
                const safeTiming = {};
                for (const key of ['domainLookupStart', 'domainLookupEnd', 'connectStart', 'secureConnectionStart',
                    'connectEnd', 'requestStart', 'responseStart', 'responseEnd']) {
                    if (Number.isFinite(timing[key]) && timing[key] >= 0 && timing[key] <= 3_600_000) safeTiming[key] = Math.round(timing[key]);
                }
                if (Object.keys(safeTiming).length) event.timingMs = safeTiming;
            } catch { /* Timing is optional on closed or incomplete requests. */ }
            return [
                ...Object.entries(headers).map(([header, field]) => Promise.resolve()
                    .then(() => response.headerValue(header))
                    .then((value) => {
                        if (!accepting) return;
                        const safe = responseHeader(header, value);
                        if (safe !== undefined) event[field] = safe;
                    }).catch(() => {})),
                Promise.resolve().then(() => response.httpVersion()).then((value) => {
                    if (accepting && ['HTTP/1.0', 'HTTP/1.1', 'HTTP/2.0', 'HTTP/3.0', 'h2', 'h3'].includes(value)) event.protocol = value;
                }).catch(() => {})
            ];
        });
        await Promise.race([
            Promise.all(pending),
            new Promise((resolve) => { timer = setTimeout(resolve, 250); })
        ]);
    } finally {
        accepting = false;
        clearTimeout(timer);
    }
}

export async function withAppFailureDiagnostic(session, testInfo, callback, { baseline = false, includeApiFailures = false } = {}) {
    const { page } = session;
    const startedAt = Date.now();
    routeTimings.delete(page);
    const events = [];
    const responses = [];
    const record = (event) => {
        if (events.length >= 40) return undefined;
        const entry = { elapsedMs: Date.now() - startedAt, ...event };
        events.push(entry);
        return entry;
    };
    const resourceTypes = baseline ? ['script', 'stylesheet', 'document', 'fetch', 'xhr'] : ['script', 'stylesheet', 'document'];
    if (includeApiFailures) resourceTypes.push('fetch', 'xhr', 'image', 'media', 'font');
    const requestContext = (request) => {
        if (!includeApiFailures) return {};
        let route = '[other-route]';
        try { route = routeTemplate(page.url()); } catch { /* The page may have closed. */ }
        return { resourceType: request.resourceType(), service: requestService(request.url()), route };
    };
    const listeners = {
        console: (message) => {
            if (baseline && message.type() === 'error') record({ type: 'console', error: errorKind(message.text()) });
        },
        pageerror: (error) => record({ type: 'pageerror', error: errorKind(error.message) }),
        requestfailed: (request) => {
            if (resourceTypes.includes(request.resourceType())) {
                record({ ...requestContext(request), type: 'requestfailed', asset: assetPath(request.url()), error: errorKind(request.failure()?.errorText) });
            }
        },
        response: (response) => {
            const status = response.status();
            if (!Number.isInteger(status) || status < 100 || status > 599) return;
            if (!resourceTypes.includes(response.request().resourceType())) return;
            if (status < 400 && !(baseline && response.request().resourceType() === 'document')) return;
            const event = record({ ...requestContext(response.request()), type: 'response', asset: assetPath(response.url()), status, observedUtc: new Date().toISOString() });
            if (event && status >= 400 && event.asset !== '[other-asset]') responses.push({ response, event });
        }
    };
    for (const [event, listener] of Object.entries(listeners)) page.on(event, listener);
    try {
        return await callback(page);
    } catch (failure) {
        // Diagnostics are best effort and must never replace the original failure.
        for (const [event, listener] of Object.entries(listeners)) page.off(event, listener);
        let timer;
        let collecting = true;
        try {
            await Promise.race([
                (async () => {
                    await collectResponseMetadata(responses);
                    const visible = (locator) => locator.isVisible().catch(() => null);
                    const activeTabs = await Promise.all(tools.map(async (tool) => (
                        await visible(page.locator(`nav[aria-label="Family tools"] a[aria-current="page"][href="#/parent-tools/${tool}"]`)) ? tool : null
                    )));
                    const state = {};
                    for (const [name, text] of Object.entries({ panelLoading: 'Loading parent tool', feesLoading: 'Loading fees', feesEmpty: 'No fees in this view' })) {
                        state[name] = await visible(page.getByText(text, { exact: true }));
                    }
                    state.feesError = await visible(page.getByText('Unable to load fees.', { exact: true }));
                    state.alert = await visible(page.getByRole('alert').first());
                    if (baseline) {
                        state.playerHeaderAttached = await page.locator('#player-header').count().then((count) => count > 0).catch(() => null);
                        state.playerNotFound = await visible(page.getByText('Player not found', { exact: true }));
                        state.playerLoadError = await visible(page.getByText('Error loading player details', { exact: true }));
                        state.diamondConfigError = await visible(page.getByText('Diamond statistic definitions could not be verified.', { exact: true }));
                        state.mainVisible = await visible(page.locator('main'));
                    }
                    if (!collecting) return;
                    const timing = routeTimings.get(page);
                    const file = testInfo.outputPath(baseline ? 'boot-path-diagnostic.json' : 'app-route-diagnostic.json');
                    await mkdir(path.dirname(file), { recursive: true });
                    if (!collecting) return;
                    const diagnostic = JSON.stringify({
                        retry: testInfo.retry, elapsedMs: Date.now() - startedAt,
                        route: routeTemplate(page.url(), baseline), activeTabs: activeTabs.filter(Boolean), state,
                        navigation: timing ? { route: routeTemplate(timing.url), elapsedMs: Date.now() - timing.startedAt,
                            shellMs: timing.shellMs ?? null, panelMs: timing.panelMs ?? null } : null,
                        events
                    });
                    // Retain safe reporter evidence even if artifact upload is unavailable.
                    console.log(`SMOKE_FAILURE_DIAGNOSTIC ${diagnostic}`);
                    await writeFile(file, diagnostic);
                })(),
                new Promise((resolve) => { timer = setTimeout(resolve, 1_000); })
            ]);
        } catch { /* Preserve callback/assertion identity even if artifact I/O fails. */ }
        finally { collecting = false; clearTimeout(timer); }
        throw failure;
    } finally {
        for (const [event, listener] of Object.entries(listeners)) page.off(event, listener);
    }
}
