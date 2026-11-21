import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');

function chatModelLoader(loadAiModule, getApp) {
    const source = read('team-chat.html');
    const start = source.indexOf('        async function getAiModel() {');
    const end = source.indexOf('\n        function parseJsonObject', start);
    const fn = source.slice(start, end).replace("import('./js/firebase-ai.js?v=1')", 'loadAiModule()');
    return new Function('loadAiModule', 'getApp', `let aiModelCache = null; ${fn}; return getAiModel;`)(loadAiModule, getApp);
}

function fixture() {
    const model = { generateContent: vi.fn() };
    const getAI = vi.fn(() => ({}));
    const getGenerativeModel = vi.fn(() => model);
    const sdk = { getAI, getGenerativeModel, GoogleAIBackend: class {} };
    return { sdk, model, getAI, getGenerativeModel };
}

describe('optional AI is outside legacy startup', () => {
    it.each(['edit-schedule.html', 'team-chat.html'])('%s has no eager AI import', name => {
        const source = read(name);
        expect(source).not.toMatch(/import\s*\{[^}]*\}\s*from\s*['"]\.\/js\/firebase-ai\.js/s);
        expect(source).toContain("await import('./js/firebase-ai.js?v=1')");
    });

    it('loads chat AI only on request and shares a model across concurrent/repeated calls', async () => {
        const f = fixture();
        let resolve;
        const load = vi.fn(() => new Promise(r => { resolve = r; }));
        // Browser module import caches one module; simulate simultaneous completion.
        const pending = new Promise(r => { resolve = r; });
        load.mockImplementation(() => pending);
        const getApp = vi.fn(() => ({}));
        const getModel = chatModelLoader(load, getApp);
        expect(load).not.toHaveBeenCalled();
        const first = getModel();
        const second = getModel();
        resolve(f.sdk);
        expect(await first).toBe(f.model);
        expect(await second).toBe(f.model);
        expect(await getModel()).toBe(f.model);
        expect(f.getGenerativeModel).toHaveBeenCalledOnce();
        expect(getApp).toHaveBeenCalledOnce();
        expect(f.getGenerativeModel).toHaveBeenCalledWith(expect.anything(), { model: 'gemini-2.5-flash' });
    });

    it('propagates loading/model errors without caching a false success', async () => {
        const f = fixture();
        const load = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(f.sdk);
        const getModel = chatModelLoader(load, () => ({}));
        await expect(getModel()).rejects.toThrow('unavailable');
        f.getGenerativeModel.mockImplementationOnce(() => { throw new Error('model failed'); });
        await expect(getModel()).rejects.toThrow('model failed');
        expect(await getModel()).toBe(f.model);
    });
});
