import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { routeTimings, withAppFailureDiagnostic } from '../smoke/helpers/app-route-diagnostic.js';

const read = (file) => readFileSync(file, 'utf8');
const folders = [];
const safeHeaders = {
    date: 'Fri, 02 Oct 2026 12:34:56 GMT',
    'content-type': 'text/html; charset=utf-8',
    server: 'GitHub.com', via: '1.1 varnish', age: '0', 'x-cache': 'MISS, HIT',
    'x-served-by': 'cache-iad-kjyo7100055-IAD, cache-bfi19226-BFI',
    'x-github-request-id': 'ABCD:12345:ABCDEF:123456:68DE1234'
};

function mockPage() {
    const page = new EventEmitter();
    const locator = { isVisible: async () => false, count: async () => 0, first() { return this; } };
    page.locator = page.getByText = page.getByRole = () => locator;
    page.url = () => 'https://allplays.ai/player.html?id=private-fixture';
    return page;
}

function mockResponse({ url = 'https://allplays.ai/js/team-access.js?v=private-value', status = 503,
    type = 'script', headers = safeHeaders, protocol = 'HTTP/2.0', timing = {} } = {}) {
    return {
        url: () => url, status: () => status,
        request: () => ({ resourceType: () => type, timing: () => timing, url: () => url }),
        headerValue: vi.fn(async (name) => headers[name] ?? null),
        httpVersion: vi.fn(async () => protocol),
        allHeaders: vi.fn(), headers: vi.fn(), body: vi.fn(), text: vi.fn()
    };
}

async function diagnosticFolder() {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'response-diagnostic-test-'));
    folders.push(folder);
    return folder;
}

async function captureResponses(responses, { page = mockPage(), baseline = true, includeApiFailures = false } = {}) {
    const folder = await diagnosticFolder();
    const failure = Error('original failure with private-fixture');
    const result = await withAppFailureDiagnostic({ page }, { retry: 0, outputPath: (name) => path.join(folder, name) }, () => {
        for (const response of responses) page.emit('response', response);
        throw failure;
    }, { baseline, includeApiFailures }).catch((error) => error);
    expect(result).toBe(failure);
    expect(page.eventNames()).toEqual([]);
    const file = path.join(folder, baseline ? 'boot-path-diagnostic.json' : 'app-route-diagnostic.json');
    const text = await readFile(file, 'utf8');
    return { data: JSON.parse(text), text, file };
}

describe('authenticated smoke failure diagnostics', () => {
    beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
    afterEach(async () => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })));
    });

    it.each([true, false])('records exact public assets and validated failed-response metadata (baseline=%s)', async (baseline) => {
        const paths = ['/js/team-access.js', '/js/auth.js', '/js/edit-schedule-practice-payload.js', '/js/vendor/firebase-auth.js'];
        const responses = paths.map((asset) => mockResponse({ url: `https://user:private-password@allplays.ai${asset}?v=1&token=private-value#private-fragment`, timing: {
            domainLookupStart: 0, domainLookupEnd: 2.4, connectStart: -1, secureConnectionStart: NaN,
            connectEnd: Infinity, requestStart: 'private-value', responseStart: 123.4,
            responseEnd: 3_600_001, extra: 'private-value'
        } }));
        const { data, text } = await captureResponses(responses, { baseline });
        expect(data.events.map((event) => event.asset)).toEqual(paths);
        for (const event of data.events) {
            expect(event).toMatchObject({ type: 'response', status: 503, contentType: 'text/html',
                responseUtc: '2026-10-02T12:34:56.000Z', server: 'github.com', via: '1.1 varnish', ageSeconds: 0,
                cache: ['MISS', 'HIT'], servedBy: ['cache-iad-kjyo7100055-IAD', 'cache-bfi19226-BFI'],
                githubRequestId: safeHeaders['x-github-request-id'], protocol: 'HTTP/2.0',
                timingMs: { domainLookupStart: 0, domainLookupEnd: 2, responseStart: 123 } });
            expect(new Date(event.observedUtc).toISOString()).toBe(event.observedUtc);
        }
        expect(text).not.toMatch(/private-|allplays\.ai|https:|token|charset/);
        expect(console.log).toHaveBeenCalledWith(`SMOKE_FAILURE_DIAGNOSTIC ${text}`);
        for (const response of responses) {
            expect(response.headerValue.mock.calls.map(([name]) => name).sort()).toEqual(Object.keys(safeHeaders).sort());
            for (const name of ['allHeaders', 'headers', 'body', 'text']) expect(response[name]).not.toHaveBeenCalled();
        }
    });

    it('records opt-in API/media failure categories without private request data', async () => {
        const targets = [
            ['identitytoolkit.googleapis.com', 'firebase-auth', 'fetch'],
            ['securetoken.googleapis.com', 'firebase-token', 'xhr'],
            ['firestore.googleapis.com', 'firestore', 'fetch'],
            ['firebasestorage.googleapis.com', 'firebase-storage', 'image'],
            ['allplays.ai', 'app-host', 'font'],
            ['private-project.cloudfunctions.net', '[other-service]', 'media'],
            ['identitytoolkit.googleapis.com.private-host', '[other-service]', 'fetch']
        ];
        const responses = targets.map(([host, , type]) => mockResponse({
            url: `https://private-user:private-password@${host}/private-id?token=private-token#private-fragment`, type
        }));
        for (const response of responses) {
            const request = response.request();
            for (const method of ['headers', 'allHeaders', 'postData', 'postDataJSON']) {
                request[method] = vi.fn(() => { throw Error('private-data-access'); });
            }
            response.request = () => request;
        }
        const { data, text } = await captureResponses(responses, { baseline: false, includeApiFailures: true });
        expect(data.events.map(({ service, resourceType, status, asset }) => ({ service, resourceType, status, asset })))
            .toEqual(targets.map(([, service, resourceType]) => ({ service, resourceType, status: 503, asset: '[other-asset]' })));
        expect(text).not.toMatch(/private|https:|googleapis|cloudfunctions|token=|cookie|authorization|bearer/i);
        for (const response of responses) {
            for (const method of ['headers', 'allHeaders', 'postData', 'postDataJSON']) expect(response.request()[method]).not.toHaveBeenCalled();
            for (const method of ['headerValue', 'headers', 'allHeaders', 'body', 'text']) expect(response[method]).not.toHaveBeenCalled();
        }
    });

    it('omits malicious, oversized, malformed, and missing header values without coercion or partial copying', async () => {
        const malicious = ['private-fixture', 'person@example.com', 'https://private.example/?token=secret',
            'x'.repeat(161), '\r\nset-cookie: secret', 'é', 0, {}, ['HIT'], null];
        const responses = malicious.map((value) => mockResponse({
            headers: Object.fromEntries(Object.keys(safeHeaders).map((key) => [key, value])), protocol: value
        }));
        responses.push(mockResponse({ headers: {
            date: 'Sat, 02 Oct 2026 12:34:56 GMT', 'content-type': 'text/html; token=secret',
            server: 'GitHub.com private-fixture', via: '1.1 varnish (private-fixture)', age: '2147483648',
            'x-cache': 'MISS, private-fixture', 'x-served-by': 'cache-iad-kjyo7100055-IAD, private-fixture',
            'x-github-request-id': `${safeHeaders['x-github-request-id']}\n`
        }, protocol: 'HTTP/2.0\nsecret' }));
        const { data, text } = await captureResponses(responses);
        expect(data.events).toHaveLength(responses.length);
        for (const event of data.events) expect(Object.keys(event).sort()).toEqual(['asset', 'elapsedMs', 'observedUtc', 'status', 'type']);
        expect(text).not.toMatch(/private|secret|example|set-cookie/);
    });

    it('rejects invalid status values and never reads metadata for successful or unrecognized assets', async () => {
        const responses = [NaN, Infinity, '503', 399.5, 600, 0].map((status) => mockResponse({ status }));
        const unknownPaths = ['/js/private-fixture.js', '/js/auth.js/private-fixture', '/js/team-access.js.bak', '/js/edit-schedule-practice-payload.js/private-fixture'];
        responses.push(...unknownPaths.map((asset) => mockResponse({ url: `https://allplays.ai${asset}?token=secret` })));
        responses.push(mockResponse({ status: 200, type: 'document', url: 'https://allplays.ai/player.html?id=private-fixture' }));
        responses.push(mockResponse({ status: 200 }), mockResponse({ type: 'image' }));
        const { data, text } = await captureResponses(responses);
        expect(data.events.map(({ asset, status }) => ({ asset, status }))).toEqual([
            ...unknownPaths.map(() => ({ asset: '[other-asset]', status: 503 })), { asset: '/player.html', status: 200 }
        ]);
        expect(text).not.toMatch(/private|secret|example|githubRequestId|contentType/);
        for (const response of responses) expect(response.headerValue).not.toHaveBeenCalled();
    });

    it('handles unavailable and rejected metadata APIs independently, preserving the original failure', async () => {
        const absent = mockResponse();
        delete absent.headerValue;
        delete absent.httpVersion;
        absent.request = () => ({ resourceType: () => 'script' });
        const rejected = mockResponse();
        rejected.headerValue.mockImplementation((name) => {
            if (name === 'server') return Promise.resolve('GitHub.com');
            if (name === 'date') throw Error('private synchronous failure');
            return Promise.reject(Error('private asynchronous failure'));
        });
        rejected.httpVersion.mockRejectedValue(Error('private protocol failure'));
        const { data, text } = await captureResponses([absent, rejected]);
        expect(data.events[1].server).toBe('github.com');
        expect(Object.keys(data.events[0]).sort()).toEqual(['asset', 'elapsedMs', 'observedUtc', 'status', 'type']);
        expect(text).not.toMatch(/private|failure|protocol|responseUtc/);
    });

    it('caps events and metadata work at forty entries', async () => {
        const responses = Array.from({ length: 50 }, () => mockResponse());
        const { data, text } = await captureResponses(responses);
        expect(data.events).toHaveLength(40);
        expect(Buffer.byteLength(text)).toBeLessThan(40_000);
        for (const response of responses.slice(40)) {
            expect(response.headerValue).not.toHaveBeenCalled();
            expect(response.httpVersion).not.toHaveBeenCalled();
        }
    });

    it('times out asynchronous metadata while retaining settled fields and ignoring late completions', async () => {
        vi.useFakeTimers();
        let begin;
        let finish;
        const started = new Promise((resolve) => { begin = resolve; });
        const delayed = new Promise((resolve) => { finish = resolve; });
        const response = mockResponse();
        response.headerValue.mockImplementation((name) => {
            begin();
            return name === 'server' ? Promise.resolve('GitHub.com') : delayed;
        });
        response.httpVersion.mockReturnValue(new Promise(() => {}));
        const captured = captureResponses([response]);
        await started;
        await vi.advanceTimersByTimeAsync(250);
        const { data, text, file } = await captured;
        expect(data.events[0]).toMatchObject({ status: 503, server: 'github.com' });
        expect(data.events[0]).not.toHaveProperty('cache');
        finish('HIT');
        await vi.advanceTimersByTimeAsync(1_000);
        expect(await readFile(file, 'utf8')).toBe(text);
        expect(console.log).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves the one-second total timeout and prevents late artifact output', async () => {
        vi.useFakeTimers();
        const folder = await diagnosticFolder();
        const page = mockPage();
        let begin;
        let finish;
        const started = new Promise((resolve) => { begin = resolve; });
        const delayed = new Promise((resolve) => { finish = resolve; });
        page.locator = () => ({ isVisible: () => { begin(); return delayed; } });
        const failure = Error('original failure');
        const outputPath = vi.fn((name) => path.join(folder, name));
        const result = withAppFailureDiagnostic({ page }, { outputPath }, () => { throw failure; }).catch((error) => error);
        await started;
        await vi.advanceTimersByTimeAsync(1_000);
        expect(await result).toBe(failure);
        expect(page.eventNames()).toEqual([]);
        finish(false);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(outputPath).not.toHaveBeenCalled();
        expect(console.log).not.toHaveBeenCalled();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('preserves callback success and original failure when artifact output is unavailable', async () => {
        const page = mockPage();
        const response = mockResponse();
        const outputPath = vi.fn(() => { throw Error('private output failure'); });
        expect(await withAppFailureDiagnostic({ page }, { outputPath }, () => {
            page.emit('response', response);
            return 'successful callback';
        })).toBe('successful callback');
        expect(response.headerValue).not.toHaveBeenCalled();
        expect(outputPath).not.toHaveBeenCalled();
        const failure = Error('original');
        expect(await withAppFailureDiagnostic({ page }, { outputPath }, () => { throw failure; }).catch((error) => error)).toBe(failure);
        expect(page.eventNames()).toEqual([]);
    });

    it('redacts arbitrary values and routes even when the page is closed, preserving the original failure', async () => {
        const folder = await mkdtemp(path.join(os.tmpdir(), 'app-route-test-'));
        const page = new EventEmitter();
        const missing = { isVisible: async () => { throw Error('closed'); }, first() { return this; } };
        page.locator = page.getByText = page.getByRole = () => missing;
        page.url = () => 'https://secret@example.com/app/#/teams/private-person/fees?token=short';
        const failure = Error('do not serialize me');
        try {
            const result = await withAppFailureDiagnostic({ page }, { retry: 1, outputPath: (name) => path.join(folder, name) }, async () => {
                routeTimings.set(page, { startedAt: Date.now(), url: page.url() });
                for (const url of ['https://user:short@host/js/firebase-auth.js?apiKey=short', 'https://user:short@host/js/vendor/firebase-auth.js?token=short#secret', 'https://host/js/vendor/private-person.js', 'https://host/js/vendor/firebase-auth.js/private-person', 'https://host/private-person/secret.js', 'https://host/app/assets/FeesTool-12345678.js?token=short']) {
                    page.emit('requestfailed', { resourceType: () => 'script', url: () => url, failure: () => ({ errorText: 'ERR_CONNECTION_CLOSED token=short person@example.com' }) });
                }
                page.emit('pageerror', Error('Name: Private Person, bearer short, person@example.com'));
                throw failure;
            }).catch((error) => error);
            expect(result).toBe(failure);
            const text = await readFile(path.join(folder, 'app-route-diagnostic.json'), 'utf8');
            expect(text).not.toMatch(/short|secret|private-person|Private Person|example|do not serialize/);
            const resultData = JSON.parse(text);
            expect(resultData).toMatchObject({ retry: 1, route: '/teams/:id/fees', state: { feesLoading: null }, navigation: { route: '/teams/:id/fees' } });
            expect(resultData.events.map((event) => event.asset)).toEqual(['/js/firebase-auth.js', '/js/vendor/firebase-auth.js', '[other-asset]', '[other-asset]', '[other-asset]', '/app/assets/FeesTool-[hash].js', undefined]);
            expect(page.eventNames()).toEqual([]);
        } finally { await rm(folder, { recursive: true, force: true }); }
    });

    it('keeps runtime, seeded-content, role and strict flaky gates wired', () => {
        const source = read('tests/smoke/app-authenticated-core.spec.js');
        expect(source).toContain('await withAppFailureDiagnostic(session, test.info(), async () => {');
        expect(source).toContain('expect(issues.map((issue) => redactSmokeDiagnostic(issue, secretValues))).toEqual([])');
        expect(source).toContain("panelHeading: 'Team fees', seededFees: true");
        for (const assertion of ['Staff and parent smoke accounts must be distinct', 'Admin access required|Only team owners|access denied', "name: 'Sign out'"]) expect(source).toContain(assertion);
        const workflow = parse(read('.github/workflows/post-deploy-smoke.yml'));
        const steps = Object.values(workflow.jobs).flatMap((job) => job.steps || []);
        const core = steps.find((step) => step.id === 'canonical_core');
        expect(core.run).toContain('--retries=1');
        expect(core.run).toContain('--fail-on-flaky-tests');
        expect(steps.find((step) => step.name === 'Aggregate production smoke signals').if).toBe('always()');
    });
});
