import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ tests: [], beforeAll: null, session: null, info: null, route: vi.fn() }));
vi.mock('@playwright/test', async () => {
    const { expect } = await import('vitest');
    expect.extend({
        toBeVisible: () => ({ pass: true, message: () => 'mocked browser visibility' }),
        toContainText: () => ({ pass: false, message: () => 'mocked browser text' })
    });
    const test = (name, callback) => harness.tests.push(callback);
    test.skip = test.setTimeout = test.afterAll = () => {};
    test.beforeAll = (callback) => { harness.beforeAll = callback; };
    test.info = () => harness.info;
    test.describe = { configure() {} };
    return { expect, test };
});
vi.mock('../smoke/helpers/app-auth.js', () => ({
    AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS: 240_000,
    getAppSmokeConfig: () => ({ appBaseUrl: 'https://allplays.ai/app/', staffEmail: 'private-staff',
        parentEmail: 'private-parent', teamId: 'private-team', playerId: 'private-player',
        gameId: 'private-game', eventId: 'private-event', registrationFormId: 'private-form' }),
    createAuthenticatedAppSessions: async () => [harness.session, harness.session],
    closeAuthenticatedAppSession: async () => {},
    assertAuthenticatedAppRoute: async () => {},
    assertNotificationInbox: async () => {},
    buildAppSmokeUrl: () => '',
    openAuthenticatedAppRoute: (...args) => harness.route(...args),
    redactSmokeDiagnostic: (issue) => issue
}));
await import('../smoke/app-authenticated-core.spec.js');

describe('authenticated core smoke request attribution', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it.each([
        ['firestore.googleapis.com', 'fetch', 'firestore'],
        ['firebasestorage.googleapis.com', 'image', 'firebase-storage'],
        ['private-host.invalid', 'xhr', '[other-service]']
    ])('retains a %s 403 from an earlier route without leaking request data', async (host, type, service) => {
        const folder = await mkdtemp(path.join(os.tmpdir(), 'core-smoke-403-'));
        const page = new EventEmitter();
        let route = '/home';
        const locator = { isVisible: async () => false, first() { return this; },
            inputValue: async () => 'fixture', fill: async () => {}, scrollIntoViewIfNeeded: async () => {},
            boundingBox: async () => ({ y: 0, height: 10 }) };
        page.locator = page.getByText = page.getByPlaceholder = () => locator;
        page.getByRole = (role) => role === 'navigation'
            ? { ...locator, boundingBox: async () => ({ y: 100, height: 10 }) } : locator;
        page.setViewportSize = page.reload = async () => {};
        page.url = () => `https://private-user:private-password@allplays.ai/app/?key=private-key#${route}`;
        const forbidden = vi.fn(() => { throw Error('private payload read'); });
        const url = `https://${host}/private-document?token=private-token`;
        const request = { resourceType: () => type, url: () => url,
            headers: forbidden, allHeaders: forbidden, postData: forbidden };
        harness.session = { page, issues: [] };
        harness.info = { retry: 0, outputPath: (name) => path.join(folder, name) };
        harness.route.mockImplementation(async (_page, _base, nextRoute) => {
            route = nextRoute;
            if (route.endsWith('/media')) {
                page.emit('response', { request: () => request, status: () => 403, url: () => url,
                    headers: forbidden, allHeaders: forbidden, headerValue: forbidden, body: forbidden, text: forbidden });
                harness.session.issues.push('console:Failed to load resource: the server responded with a status of 403 ()');
            }
        });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            await harness.beforeAll({ browser: {} });
            const failure = await harness.tests[0]().catch((error) => error);
            expect(failure).toBeInstanceOf(Error);
            expect(failure.actual).toEqual(harness.session.issues);
            expect(failure.expected).toEqual([]);
            const text = await readFile(path.join(folder, 'app-route-diagnostic.json'), 'utf8');
            const diagnostic = JSON.parse(text);
            expect(diagnostic.route).toBe('/help');
            expect(diagnostic.events).toMatchObject([{ type: 'response', status: 403,
                resourceType: type, service, responseTimeRoute: '/teams/:id/media', asset: '[other-asset]' }]);
            expect(text).not.toMatch(/private|https:|googleapis|cookie|authorization|bearer|token=/i);
            expect(log).toHaveBeenCalledWith(`SMOKE_FAILURE_DIAGNOSTIC ${text}`);
            expect(forbidden).not.toHaveBeenCalled();
            expect(page.eventNames()).toEqual([]);
        } finally { await rm(folder, { recursive: true, force: true }); }
    });
});
