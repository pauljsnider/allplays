import { expect, test } from '@playwright/test';
import { installSmokeAppCheck, assertSmokeAppCheckReady } from './helpers/app-check.js';

// Entirely synthetic browser coverage: these requests never reach production.
const origin = 'https://allplays.ai';
const token = '11111111-2222-4333-8444-555555555555';
const env = { SMOKE_APP_CHECK_DEBUG_TOKEN: token, SMOKE_APP_CHECK_REQUIRED: '1' };

test('CI attestation installs before SDK startup and stays out of child frames and redirected origins', async ({ page }) => {
    await page.route('**/*', route => route.fulfill({
        contentType: 'text/html',
        body: `<script>globalThis.__ALLPLAYS_APP_CHECK_STATUS__ = {
            state: globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN ? 'token-ready' : 'disabled'
        };</script>${route.request().url().endsWith('/child') ? '' : '<iframe src="https://allplays.ai/child"></iframe>'}`
    }));
    const enabled = await installSmokeAppCheck(page, origin, env);
    await page.goto(`${origin}/app/`);
    await assertSmokeAppCheckReady(page, enabled);
    expect(await page.evaluate(() => globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN)).toBe(token);
    const child = page.frames().find(frame => frame.url().endsWith('/child'));
    expect(child).toBeTruthy();
    expect(await child.evaluate(() => globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN)).toBeUndefined();
    await page.goto('https://game-flow-c6311.web.app/child');
    expect(await page.evaluate(() => globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN)).toBeUndefined();
    await expect(assertSmokeAppCheckReady(page, enabled)).rejects.toThrow('did not obtain a valid token');
});

test('a rejected exchange fails even when the sign-in page renders', async ({ page }) => {
    await page.route('**/*', route => route.fulfill({
        contentType: 'text/html',
        body: '<h1>Sign in</h1><script>globalThis.__ALLPLAYS_APP_CHECK_STATUS__ = { state: "token-error" };</script>'
    }));
    const enabled = await installSmokeAppCheck(page, origin, env);
    await page.goto(`${origin}/app/`);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(assertSmokeAppCheckReady(page, enabled)).rejects.toThrow('exchange errors remain failures');
});
