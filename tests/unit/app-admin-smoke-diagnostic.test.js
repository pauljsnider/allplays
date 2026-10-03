import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({ tests: [], issues: [], signIn: vi.fn(), route: vi.fn() }));
vi.mock('@playwright/test', async () => {
    const { expect } = await import('vitest');
    const test = (name, callback) => harness.tests.push(callback);
    test.skip = test.use = test.setTimeout = () => {};
    test.describe = { configure() {} };
    return { expect, test };
});
vi.mock('../smoke/helpers/app-auth.js', () => ({
    AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS: 240_000,
    getAppSmokeConfig: () => ({ appBaseUrl: 'https://allplays.ai/app/', adminEmail: 'private-email', adminPassword: 'private-password' }),
    collectAppRuntimeIssues: () => harness.issues,
    signInToApp: (...args) => harness.signIn(...args),
    assertAuthenticatedAppRoute: (...args) => harness.route(...args),
    redactSmokeDiagnostic: (issue) => issue
}));
await import('../smoke/app-admin-core.spec.js');

describe('admin smoke diagnostic lifecycle', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it.each(['authentication', 'route', 'console'])('retains failures from %s with the original assertion and safe artifact', async (stage) => {
        const folder = await mkdtemp(path.join(os.tmpdir(), 'admin-smoke-diagnostic-'));
        const page = new EventEmitter();
        const locator = { isVisible: async () => false, first() { return this; } };
        page.locator = page.getByText = page.getByRole = () => locator;
        page.url = () => 'https://private-user:private-password@allplays.ai/app/?key=private-key#/home?team=private-id';
        const failure = Error('private assertion details');
        const forbidden = vi.fn(() => { throw Error('private payload read'); });
        const request = {
            resourceType: () => 'fetch',
            url: () => 'https://private-user:private-password@identitytoolkit.googleapis.com/private-id?key=private-key',
            failure: () => ({ errorText: 'net::ERR_CONNECTION_RESET private-password private-email' }),
            headers: forbidden, allHeaders: forbidden, postData: forbidden, postDataJSON: forbidden
        };
        harness.issues = stage === 'console' ? ['console:503'] : [];
        harness.signIn.mockImplementation(async () => {
            // Emitted during sign-in, before Home assertions begin.
            page.emit('response', { request: () => request, status: () => 503, url: request.url,
                headers: forbidden, allHeaders: forbidden, headerValue: forbidden, body: forbidden, text: forbidden });
            page.emit('requestfailed', request);
            if (stage === 'authentication') throw failure;
            return { authenticatedHomeStartedAt: Date.now() };
        });
        harness.route.mockImplementation(async () => { if (stage === 'route') throw failure; });
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            const result = await harness.tests[0]({ page }, { retry: 0, outputPath: (name) => path.join(folder, name) }).catch((error) => error);
            if (stage === 'console') expect(result).toBeInstanceOf(Error);
            else expect(result).toBe(failure);
            const text = await readFile(path.join(folder, 'app-route-diagnostic.json'), 'utf8');
            expect(JSON.parse(text).events).toMatchObject([
                { type: 'response', resourceType: 'fetch', service: 'firebase-auth', status: 503 },
                { type: 'requestfailed', resourceType: 'fetch', service: 'firebase-auth', error: 'ERR_CONNECTION_RESET' }
            ]);
            expect(text).not.toMatch(/private|https:|googleapis|cookie|authorization|bearer|key=/i);
            expect(log).toHaveBeenCalledWith(`SMOKE_FAILURE_DIAGNOSTIC ${text}`);
            expect(forbidden).not.toHaveBeenCalled();
            expect(page.eventNames()).toEqual([]);
        } finally { await rm(folder, { recursive: true, force: true }); }
    });
});
