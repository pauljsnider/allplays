// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeApp, deleteApp } from '../../js/vendor/firebase-app.js';
import { CustomProvider, initializeAppCheck, getToken as getSdkToken } from '../../js/vendor/firebase-app-check.js';
import { getAI as getRawAI, getGenerativeModel as getRawModel } from '../../js/vendor/firebase-ai.js';
import { getAI, getGenerativeModel } from '../../js/firebase-ai.js';
import { registerPrimaryAppCheckContext } from '../../js/firebase-app-check-rest.js';

let app;
let token;
let getToken;
const prompt = [{ text: 'Parse the synthetic roster.' }, { inlineData: { mimeType: 'image/png', data: 'fixture' } }];
const success = () => new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '{"operations":[]}' }] } }] }), { status: 200 });
const rejection = (status = 401) => new Response(JSON.stringify({ error: { message: 'Firebase App Check token is invalid' } }), { status });

beforeEach(() => {
    app = initializeApp({ apiKey: 'test-public-key', projectId: 'demo-ai', appId: `test-${Math.random()}` }, `ai-test-${Math.random()}`);
    token = 'initial-fixture-token';
    getToken = vi.fn(async (force) => ({ token: force ? (token = 'renewed-fixture-token') : token }));
    globalThis.fetch = vi.fn().mockImplementation(async () => success());
    registerPrimaryAppCheckContext({ initialization: Promise.resolve(), tokenGetter: getToken, tokenPreparer: async () => {} });
});

afterEach(async () => {
    await deleteApp(app);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete globalThis.__allplaysPrimaryAppCheckInitialization;
    delete globalThis.__allplaysPrimaryAppCheckTokenGetter;
    delete globalThis.__allplaysPrimaryAppCheckTokenPreparer;
});

function installProvider() {
    let calls = 0;
    const appCheck = initializeAppCheck(app, { provider: new CustomProvider({ getToken: async () => {
        token = calls++ ? 'renewed-fixture-token' : 'initial-fixture-token';
        return { token, expireTimeMillis: Date.now() + 3600000 };
    } }), isTokenAutoRefreshEnabled: false });
    getToken.mockImplementation((force) => getSdkToken(appCheck, force));
}

describe('shared Firebase AI attestation', () => {
    it('reproduces the vendored SDK snapshot bug when AI precedes App Check', async () => {
        const raw = getRawAI(app);
        installProvider();
        await getRawModel(raw, { model: 'gemini-2.5-flash' }).generateContent(prompt);
        expect(fetch.mock.calls[0][1].headers.get('X-Firebase-AppCheck')).toBeNull();
    });

    it('waits for native readiness before constructing the real SDK service', async () => {
        let ready;
        registerPrimaryAppCheckContext({ tokenPreparer: () => new Promise((resolve) => { ready = () => { installProvider(); resolve(); }; }) });
        const model = getGenerativeModel(getAI(app), { model: 'gemini-2.5-flash' });
        const result = model.generateContent(prompt);
        await vi.waitFor(() => expect(ready).toBeTypeOf('function'));
        expect(fetch).not.toHaveBeenCalled();
        ready();
        await result;
        expect(fetch.mock.calls[0][1].headers.get('X-Firebase-AppCheck')).toBe(token);
        expect(JSON.parse(fetch.mock.calls[0][1].body).contents[0].parts).toEqual(prompt);
    });

    it.each([null, { token: 'placeholder', error: new Error('secret-token') }, { token: 'placeholder', internalError: {} }])('does not transmit prompts with unavailable or error tokens (%j)', async (result) => {
        getToken.mockResolvedValue(result);
        await expect(getGenerativeModel(getAI(app), { model: 'gemini-2.5-flash' }).generateContent(prompt)).rejects.toMatchObject({ code: 'ai/app-check-unavailable' });
        expect(fetch).not.toHaveBeenCalled();
    });

    it('bounds a stalled initialization and never sends a late request', async () => {
        vi.useFakeTimers();
        let ready;
        registerPrimaryAppCheckContext({ initialization: new Promise((resolve) => { ready = resolve; }) });
        const result = expect(getGenerativeModel(getAI(app), { model: 'gemini-2.5-flash' }).generateContent(prompt)).rejects.toMatchObject({ code: 'ai/app-check-unavailable' });
        await vi.advanceTimersByTimeAsync(10000);
        await result;
        ready();
        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).not.toHaveBeenCalled();
    });

    it.each([401, 403])('refreshes once for an explicit App Check %i rejection and preserves the prompt', async (status) => {
        installProvider();
        fetch.mockResolvedValueOnce(rejection(status)).mockImplementation(async () => success());
        await getGenerativeModel(getAI(app), { model: 'gemini-2.5-flash' }).generateContent(prompt);
        expect(getToken.mock.calls.map(([force]) => force)).toEqual([false, true]);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch.mock.calls[0][1].body).toEqual(fetch.mock.calls[1][1].body);
        expect(fetch.mock.calls[0][1].headers.get('X-Firebase-AppCheck')).toBe('initial-fixture-token');
        expect(fetch.mock.calls[1][1].headers.get('X-Firebase-AppCheck')).toBe('renewed-fixture-token');
    });

    it('stops after a rejected retry with a sanitized actionable error', async () => {
        installProvider();
        fetch.mockImplementation(async () => rejection());
        const result = getGenerativeModel(getAI(app), { model: 'gemini-2.5-flash' }).generateContent(prompt);
        await expect(result).rejects.toMatchObject({ code: 'ai/app-check-unavailable', message: expect.stringContaining('manual entry or CSV import') });
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('does not retry inference when refreshing the rejected token fails', async () => {
        installProvider();
        getToken.mockImplementation(async (force) => force ? null : { token });
        fetch.mockImplementation(async () => rejection());
        await expect(getGenerativeModel(getAI(app), { model: 'gemini-2.5-flash' }).generateContent(prompt)).rejects.toMatchObject({ code: 'ai/app-check-unavailable' });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('coalesces concurrent rejection recovery without replaying either generation more than once', async () => {
        installProvider();
        let count = 0;
        fetch.mockImplementation(async () => ++count <= 2 ? rejection() : success());
        const model = getGenerativeModel(getAI(app), { model: 'gemini-2.5-flash' });
        await Promise.all([model.generateContent('first'), model.generateContent('second')]);
        expect(getToken.mock.calls.filter(([force]) => force)).toHaveLength(1);
        expect(fetch).toHaveBeenCalledTimes(4);
    });

    it.each([400, 401, 403, 429, 500, 503])('does not replay unrelated HTTP %i failures', async (status) => {
        installProvider();
        fetch.mockImplementation(async () => new Response(JSON.stringify({ error: { message: 'Other failure' } }), { status }));
        await expect(getGenerativeModel(getAI(app), { model: 'gemini-2.5-flash' }).generateContent(prompt)).rejects.toBeDefined();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(getToken).toHaveBeenCalledTimes(1);
    });

    it('does not replay an ambiguous network failure', async () => {
        installProvider();
        fetch.mockRejectedValue(new TypeError('Network failed'));
        await expect(getGenerativeModel(getAI(app), { model: 'gemini-2.5-flash' }).generateContent(prompt)).rejects.toBeDefined();
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
