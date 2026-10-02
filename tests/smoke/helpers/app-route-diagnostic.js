import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const routeTimings = new WeakMap();
const tools = ['access', 'household', 'fees', 'calendar', 'share', 'registrations', 'certificates'];

function routeTemplate(url) {
    try {
        const route = new URL(url).hash.slice(1).split('?')[0];
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
    return ['ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_RESET', 'ERR_ABORTED', 'ERR_FAILED',
        'ERR_NAME_NOT_RESOLVED', 'ERR_TIMED_OUT'].find((kind) => String(message).includes(kind)) || '[redacted]';
}

function assetPath(url) {
    try {
        const { pathname } = new URL(url);
        const chunk = pathname.match(/^\/app\/assets\/(FeesTool|ParentTools|index)-[A-Za-z0-9_-]{8}\.js$/);
        if (chunk) return `/app/assets/${chunk[1]}-[hash].js`;
        if (['/js/officiating-slots.js', '/js/firebase-auth.js'].includes(pathname)) return pathname;
    } catch { /* Unrecognized URLs are omitted. */ }
    return '[other-asset]';
}

export async function withAppFailureDiagnostic(session, testInfo, callback) {
    const { page } = session;
    const startedAt = Date.now();
    routeTimings.delete(page);
    const events = [];
    const record = (event) => { if (events.length < 40) events.push({ elapsedMs: Date.now() - startedAt, ...event }); };
    const listeners = {
        pageerror: (error) => record({ type: 'pageerror', error: errorKind(error.message) }),
        requestfailed: (request) => {
            if (['script', 'stylesheet', 'document'].includes(request.resourceType())) {
                record({ type: 'requestfailed', asset: assetPath(request.url()), error: errorKind(request.failure()?.errorText) });
            }
        },
        response: (response) => {
            if (response.status() >= 400 && ['script', 'stylesheet', 'document'].includes(response.request().resourceType())) {
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
                    const timing = routeTimings.get(page);
                    const file = testInfo.outputPath('app-route-diagnostic.json');
                    await mkdir(path.dirname(file), { recursive: true });
                    await writeFile(file, JSON.stringify({
                        retry: testInfo.retry, elapsedMs: Date.now() - startedAt,
                        route: routeTemplate(page.url()), activeTabs: activeTabs.filter(Boolean), state,
                        navigation: timing ? { route: routeTemplate(timing.url), elapsedMs: Date.now() - timing.startedAt,
                            shellMs: timing.shellMs ?? null, panelMs: timing.panelMs ?? null } : null,
                        events
                    }, null, 2));
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
