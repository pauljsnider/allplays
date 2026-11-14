import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import { installSmokeAppCheck, assertSmokeAppCheckReady } from '../smoke/helpers/app-check.js';

const token = '11111111-2222-4333-8444-555555555555';
const env = { SMOKE_APP_CHECK_DEBUG_TOKEN: token, SMOKE_APP_CHECK_REQUIRED: '1' };
const origin = 'https://allplays.ai';

describe('protected CI browser attestation', () => {
    it('leaves preview and local browsers untouched without explicit CI credentials', async () => {
        const page = { addInitScript: vi.fn() };
        expect(await installSmokeAppCheck(page, 'http://localhost:4173', {})).toBe(false);
        await assertSmokeAppCheckReady({}, false);
        expect(page.addInitScript).not.toHaveBeenCalled();
    });

    it.each(['', 'true', 'generated-token', `${token}\n`])('rejects missing or malformed credentials without reflecting them', async (value) => {
        await expect(installSmokeAppCheck({}, origin, { ...env, SMOKE_APP_CHECK_DEBUG_TOKEN: value }))
            .rejects.toThrow('requires a registered SMOKE_APP_CHECK_DEBUG_TOKEN UUID');
    });

    it.each(['http://allplays.ai', 'https://allplays.ai.evil.test', 'https://evil.test',
        'https://user:secret@allplays.ai', 'https://game-flow-c6311--preview.web.app', 'not a URL'])
    ('refuses to install credentials on an unsafe origin: %s', async (url) => {
        const page = { addInitScript: vi.fn() };
        await expect(installSmokeAppCheck(page, url, env)).rejects.toThrow('allowlisted production HTTPS origin');
        expect(page.addInitScript).not.toHaveBeenCalled();
    });

    it('installs before navigation only in the exact top-level origin, including after redirects', async () => {
        let callback, args;
        const page = { addInitScript: vi.fn((fn, data) => { callback = fn; args = data; }) };
        expect(await installSmokeAppCheck(page, `${origin}/app/`, env)).toBe(true);
        function execute(frameOrigin, child = false) {
            const frame = { location: { origin: frameOrigin } };
            frame.top = child ? {} : frame;
            frame.globalThis = frame;
            runInNewContext(`(${callback.toString()})(args)`, { ...frame, args });
            return frame.FIREBASE_APPCHECK_DEBUG_TOKEN;
        }
        expect(execute(origin)).toBe(token);
        expect(execute(origin, true)).toBeUndefined();
        expect(execute('https://www.google.com', true)).toBeUndefined();
        expect(execute('https://game-flow-c6311.web.app')).toBeUndefined();
        expect(execute('https://evil.test')).toBeUndefined();
    });

    it('redacts init-script failures that may contain serialized secret arguments', async () => {
        const page = { addInitScript: vi.fn().mockRejectedValue(new Error(`serialized ${token}`)) };
        await expect(installSmokeAppCheck(page, origin, env)).rejects.toThrow('Could not install protected');
        await installSmokeAppCheck(page, origin, env).catch(error => expect(error.message).not.toContain(token));
    });

    it('requires token-ready, not merely an initialized provider', async () => {
        const page = { waitForFunction: vi.fn().mockResolvedValue({}), evaluate: vi.fn().mockResolvedValue(true) };
        await assertSmokeAppCheckReady(page, true);
        expect(page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), undefined, { timeout: 30_000 });
        expect(page.evaluate).toHaveBeenCalledOnce();
    });

    it.each(['token-error', 'disabled', 'error', 'initialized', undefined])('rejects unsuccessful exchange state %s', async state => {
        const page = {
            waitForFunction: vi.fn().mockResolvedValue({}),
            evaluate: vi.fn(fn => runInNewContext(`(${fn.toString()})()`, {
                __ALLPLAYS_APP_CHECK_STATUS__: { state }
            }))
        };
        await expect(assertSmokeAppCheckReady(page, true)).rejects.toThrow('did not obtain a valid token');
    });

    it('fails boundedly and redacts exchange errors, never turning a timeout into success', async () => {
        const page = { waitForFunction: vi.fn().mockRejectedValue(new Error(`timeout ${token}`)) };
        await assertSmokeAppCheckReady(page, true).catch(error => {
            expect(error.message).toContain('exchange errors remain failures');
            expect(error.message).not.toContain(token);
        });
    });
});

describe('production smoke secret boundary', () => {
    it.each(['post-deploy-smoke', 'scheduled-prod-smoke'])('exposes the credential only to protected browser steps: %s', name => {
        const workflow = parse(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
        const tokenSteps = [];
        for (const job of Object.values(workflow.jobs)) {
            expect(job.env?.SMOKE_APP_CHECK_DEBUG_TOKEN).toBeUndefined();
            for (const step of job.steps || []) {
                if (!step.env?.SMOKE_APP_CHECK_DEBUG_TOKEN) continue;
                expect(job.environment.name).toBe('production-smoke');
                expect(step.run).toContain('npx playwright test');
                expect(step.env.SMOKE_APP_CHECK_REQUIRED).toBe('1');
                expect(step.env.SMOKE_APP_CHECK_DEBUG_TOKEN).toBe('${{ secrets.SMOKE_APP_CHECK_DEBUG_TOKEN }}');
                expect(step.run).not.toContain('SMOKE_APP_CHECK_DEBUG_TOKEN');
                tokenSteps.push(step);
            }
        }
        expect(tokenSteps).toHaveLength(name === 'post-deploy-smoke' ? 3 : 1);
    });

    it('keeps secret-bearing browser traces and recordings off', () => {
        const config = readFileSync('playwright.smoke.config.js', 'utf8');
        for (const kind of ['trace', 'video', 'screenshot']) expect(config).toContain(`${kind}: 'off'`);
        const source = readFileSync('tests/smoke/helpers/app-check.js', 'utf8');
        expect(source).not.toContain('console.');
    });
});
