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
        if (['/js/officiating-slots.js', '/js/firebase-auth.js', '/js/vendor/firebase-auth.js', '/player.html', '/team.html'].includes(pathname)) return pathname;
    } catch { /* Unrecognized URLs are omitted. */ }
    return '[other-asset]';
}

export async function withAppFailureDiagnostic(session, testInfo, callback, { baseline = false } = {}) {
    const { page } = session;
    const startedAt = Date.now();
    routeTimings.delete(page);
    const events = [];
    const record = (event) => { if (events.length < 40) events.push({ elapsedMs: Date.now() - startedAt, ...event }); };
    const resourceTypes = baseline ? ['script', 'stylesheet', 'document', 'fetch', 'xhr'] : ['script', 'stylesheet', 'document'];
    const listeners = {
        console: (message) => {
            if (baseline && message.type() === 'error') record({ type: 'console', error: errorKind(message.text()) });
        },
        pageerror: (error) => record({ type: 'pageerror', error: errorKind(error.message) }),
        requestfailed: (request) => {
            if (resourceTypes.includes(request.resourceType())) {
                record({ type: 'requestfailed', asset: assetPath(request.url()), error: errorKind(request.failure()?.errorText) });
            }
        },
        response: (response) => {
            if ((response.status() >= 400 || (baseline && response.request().resourceType() === 'document')) && resourceTypes.includes(response.request().resourceType())) {
                record({ type: 'response', asset: assetPath(response.url()), status: response.status() });
            }
        }
    };
    for (const [event, listener] of Object.entries(listeners)) page.on(event, listener);
    try {
        return await callback(page);
    } catch (failure) {
        // Diagnostics are best effort and must never replace the original failure.
        let timer;
        try {
            await Promise.race([
                (async () => {
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
                    const timing = routeTimings.get(page);
                    const file = testInfo.outputPath(baseline ? 'boot-path-diagnostic.json' : 'app-route-diagnostic.json');
                    await mkdir(path.dirname(file), { recursive: true });
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
        finally { clearTimeout(timer); }
        throw failure;
    } finally {
        for (const [event, listener] of Object.entries(listeners)) page.off(event, listener);
    }
}
