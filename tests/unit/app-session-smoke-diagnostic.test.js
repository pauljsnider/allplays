import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ tests: [], beforeAll: null, afterAll: null, info: null, route: vi.fn() }));
vi.mock('@playwright/test', async () => {
    const { expect } = await import('vitest');
    expect.extend({
        toBeVisible: () => ({ pass: true, message: () => 'mocked readiness' }),
        toContainText: () => ({ pass: false, message: () => 'mocked readiness' })
    });
    expect.poll = (callback) => expect(callback());
    const test = (_name, callback) => harness.tests.push(callback);
    test.skip = test.setTimeout = () => {};
    test.beforeAll = (callback) => { harness.beforeAll = callback; };
    test.afterAll = (callback) => { harness.afterAll = callback; };
    test.info = () => harness.info;
    test.describe = { configure() {} };
    return { expect, test };
});
vi.mock('../smoke/helpers/app-auth.js', async (importOriginal) => ({
    ...await importOriginal(),
    getAppSmokeConfig: () => ({ appBaseUrl: 'https://allplays.ai/app/', staffEmail: 'private-staff',
        staffPassword: 'private-password', parentEmail: 'private-parent', parentPassword: 'private-password',
        teamId: 'private-team', playerId: 'private-player', gameId: 'private-game',
        eventId: 'private-event', registrationFormId: 'private-form' }),
    assertAuthenticatedAppRoute: async () => {},
    assertNotificationInbox: async () => {},
    openAuthenticatedAppRoute: (...args) => harness.route(...args)
}));
await import('../smoke/app-authenticated-core.spec.js');
const { createAuthenticatedAppSession, closeAuthenticatedAppSession } = await import('../smoke/helpers/app-auth.js');

const forbidden = () => { throw Error('private payload read'); };
function emit403(page) {
    const url = 'https://firestore.googleapis.com/private-document?token=private-token';
    page.emit('response', { status: () => 403, url: () => url,
        request: () => ({ resourceType: () => 'fetch', url: () => url, headers: forbidden, postData: forbidden }),
        headers: forbidden, allHeaders: forbidden, headerValue: forbidden, body: forbidden, text: forbidden });
    page.emit('console', { type: () => 'error', text: () => 'Failed to load resource: 403' });
}
function mockPage(onAuth) {
    const page = new EventEmitter();
    page.route = '/auth';
    const locator = { isVisible: async () => false, first() { return this; }, last() { return this; },
        inputValue: async () => 'fixture', fill: async () => {}, scrollIntoViewIfNeeded: async () => {},
        click: async () => { page.route = '/home'; }, boundingBox: async () => ({ y: 0, height: 10 }) };
    page.locator = page.getByText = page.getByPlaceholder = page.getByLabel = () => locator;
    page.getByRole = (role) => role === 'navigation'
        ? { ...locator, boundingBox: async () => ({ y: 100, height: 10 }) } : locator;
    page.goto = async () => { await onAuth?.(page); };
    page.setViewportSize = page.reload = async () => {};
    page.url = () => `https://private-user:private-password@allplays.ai/app/?key=private-key#${page.route}`;
    return page;
}
let folder, pages, contexts;
function browserFor(...callbacks) {
    let index = 0;
    return { newContext: async () => {
        const page = mockPage(callbacks[index++]);
        const context = { newPage: async () => page, close: vi.fn(async () => {}) };
        pages.push(page); contexts.push(context);
        return context;
    } };
}
async function artifact(index) {
    const text = await readFile(path.join(folder, `app-route-diagnostic-session-${index}.json`), 'utf8')
        .catch(async (error) => {
            // Baseline control: inspect its original artifact, so failures prove
            // missing events rather than only the new per-session filename.
            if (error.code !== 'ENOENT') throw error;
            return readFile(path.join(folder, 'app-route-diagnostic.json'), 'utf8');
        });
    expect(text).not.toMatch(/private|https:|googleapis|cookie|authorization|bearer|token=/i);
    return JSON.parse(text);
}
describe('session-lifetime diagnostics through actual auth setup and core spec', () => {
    beforeEach(async () => {
        pages = []; contexts = [];
        folder = await mkdtemp(path.join(os.tmpdir(), 'session-smoke-diagnostic-'));
        harness.info = { retry: 0, outputPath: (name) => path.join(folder, name), attach: vi.fn(async () => {}) };
        harness.route.mockImplementation(async (page, _base, route) => { page.route = route; });
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });
    afterEach(async () => { vi.restoreAllMocks(); await rm(folder, { recursive: true, force: true }); });
    it('retains staff sign-in 403 when the accumulated assertion fails later at /help', async () => {
        await harness.beforeAll({ browser: browserFor(emit403, undefined) });
        await expect(harness.tests[0]()).rejects.toThrow();
        const diagnostic = await artifact(0);
        expect(diagnostic.route).toBe('/help');
        expect(diagnostic.events).toMatchObject([{ status: 403, service: 'firestore', responseTimeRoute: '/auth' }]);
        expect(diagnostic.sessionIndex).toBe(0);
        expect((await artifact(1)).events).toEqual([]);
        await harness.afterAll();
        expect(pages[0].listenerCount('response')).toBe(1); // original runtime issue collector only
    });
    it('retains an idle parent 403 during staff workflow for the later parent assertion', async () => {
        await harness.beforeAll({ browser: browserFor() });
        harness.route.mockImplementation(async (page, _base, route) => {
            page.route = route;
            if (page === pages[0] && route === '/help') emit403(pages[1]);
        });
        await harness.tests[0]();
        await expect(harness.tests[1]()).rejects.toThrow();
        expect((await artifact(1)).events).toMatchObject([{ status: 403, responseTimeRoute: '/home' }]);
        expect((await artifact(0)).events).toEqual([]);
        await harness.afterAll();
    });
    it('attaches idle parent evidence even when a staff failure skips the parent test', async () => {
        await harness.beforeAll({ browser: browserFor() });
        harness.route.mockImplementation(async (page) => { emit403(pages[1]); throw Error('unchanged assertion'); });
        await expect(harness.tests[0]()).rejects.toThrow('unchanged assertion');
        expect((await artifact(1)).events).toMatchObject([{ status: 403 }]);
        expect((await artifact(0)).events).toEqual([]);
        await harness.afterAll();
    });
    it('attaches failed sign-in and successful peer evidence before closing both contexts', async () => {
        await expect(harness.beforeAll({ browser: browserFor((page) => { emit403(page); throw Error('setup failed'); }) }))
            .rejects.toThrow('Authenticated smoke session setup failed');
        expect((await artifact(0)).events).toMatchObject([{ status: 403, responseTimeRoute: '/auth' }]);
        expect((await artifact(1)).events).toEqual([]);
        expect(harness.info.attach).toHaveBeenCalledTimes(2);
        for (const context of contexts) expect(context.close).toHaveBeenCalledOnce();
        for (const page of pages) expect(page.listenerCount('response')).toBe(1);
    });
    it('bounds events at 40, reports drops, and stops recording after disposal', async () => {
        const session = await createAuthenticatedAppSession(browserFor(), {
            appBaseUrl: 'https://allplays.ai/app/', email: 'private-email', password: 'private-password', roleLabel: 'staff'
        }, { diagnosticTestInfo: harness.info });
        for (let index = 0; index < 43; index++) emit403(session.page);
        await session.failureDiagnostic.attach(harness.info);
        expect((await artifact(0)).events).toHaveLength(40);
        expect((await artifact(0)).droppedEvents).toBe(3);
        await closeAuthenticatedAppSession(session);
        emit403(session.page);
        await session.failureDiagnostic.attach(harness.info);
        expect((await artifact(0)).droppedEvents).toBe(3);
    });
});
