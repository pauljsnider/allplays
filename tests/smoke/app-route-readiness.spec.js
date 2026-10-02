import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { assertAuthenticatedAppRoute, collectAppRuntimeIssues, openAuthenticatedAppRoute } from './helpers/app-auth.js';
import { withAppFailureDiagnostic } from './helpers/app-route-diagnostic.js';

const base = 'http://smoke.invalid/app/';
const route = '/parent-tools/fees';
const options = { heading: 'Family workflows', panelHeading: 'Team fees', seededFees: true };
const shell = '<main><h1>Family workflows</h1><nav aria-label="Family tools"><a aria-current="page" href="#/parent-tools/fees">Fees</a></nav><div id="panel">Loading parent tool</div></main>';
const header = '<h2>Team fees</h2>';
const fee = '<section><div>Seeded fee</div><div>Amount</div><div>Due</div></section>';

async function mockShell(page, panel = 'Loading parent tool') {
    await page.route('http://smoke.invalid/**', (request) => request.fulfill({ contentType: 'text/html', body: shell.replace('Loading parent tool', panel) }));
}

async function diagnosticFailure(page, testInfo, callback) {
    const original = await withAppFailureDiagnostic({ page }, testInfo, callback).catch((error) => error);
    expect(original).toBeInstanceOf(Error);
    return { original, diagnostic: JSON.parse(await readFile(testInfo.outputPath('app-route-diagnostic.json'), 'utf8')) };
}

test('shared shell can mount immediately and fee panel after five seconds within the route budget', async ({ page }) => {
    await mockShell(page);
    await page.addInitScript(({ header, fee }) => {
        window.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => { document.querySelector('#panel').innerHTML = header + fee; }, 5_200);
        });
    }, { header, fee });
    const started = Date.now();
    await openAuthenticatedAppRoute(page, base, route, options);
    expect(Date.now() - started).toBeGreaterThanOrEqual(5_200);
    expect(Date.now() - started).toBeLessThan(25_000);
});

for (const panel of [header + '<div>Loading fees</div>', header + '<div>No fees in this view</div>', header + '<div role="alert">Unable to load fees.</div>']) {
    test(`fee header alone cannot pass: ${panel}`, async ({ page }, testInfo) => {
        await mockShell(page, panel);
        await page.goto(base + '#' + route);
        const { diagnostic } = await diagnosticFailure(page, testInfo, () => assertAuthenticatedAppRoute(page, route, { ...options, deadline: Date.now() + 350 }));
        expect(diagnostic.route).toBe(route);
        expect(diagnostic.state.feesLoading || diagnostic.state.feesEmpty || diagnostic.state.feesError).toBe(true);
    });
}

test('fee header waits for content instead of passing during loading', async ({ page }) => {
    await mockShell(page, header + '<div>Loading fees</div>');
    await page.goto(base + '#' + route);
    let ready = false;
    const pending = assertAuthenticatedAppRoute(page, route, options).then(() => { ready = true; });
    await page.waitForTimeout(200);
    expect(ready).toBe(false);
    await page.locator('#panel').evaluate((panel, html) => { panel.innerHTML = html; }, header + fee);
    await pending;
});

for (const transport of ['503', 'connectionclosed']) {
    test(`never-mounted panel and ${transport} fail with sanitized diagnostics`, async ({ page }, testInfo) => {
        await mockShell(page);
        await page.route('**/app/assets/FeesTool-12345678.js*', (request) => transport === '503'
            ? request.fulfill({ status: 503, body: 'unavailable' }) : request.abort('connectionclosed'));
        const issues = collectAppRuntimeIssues(page);
        const { diagnostic } = await diagnosticFailure(page, testInfo, async () => {
            await page.goto(base + '#' + route);
            await page.evaluate(() => {
                const script = document.createElement('script');
                script.src = '/app/assets/FeesTool-12345678.js?token=secret'; document.body.append(script);
            });
            await expect.poll(() => issues.length).toBeGreaterThan(0);
            await assertAuthenticatedAppRoute(page, route, { ...options, deadline: Date.now() + 350 });
        });
        expect(diagnostic.state.panelLoading).toBe(true);
        expect(diagnostic.events).toContainEqual(expect.objectContaining(transport === '503'
            ? { type: 'response', status: 503 } : { type: 'requestfailed', error: 'ERR_CONNECTION_CLOSED' }));
        expect(JSON.stringify(diagnostic)).not.toContain('secret');
        // Real transport errors still fail the existing runtime assertion even if UI recovers.
        await page.locator('#panel').evaluate((panel, html) => { panel.innerHTML = html; }, header + fee);
        await assertAuthenticatedAppRoute(page, route, options);
        expect(issues.length).toBeGreaterThan(0);
    });
}

test('panel never mounting exhausts the original 25-second route budget', async ({ page }, testInfo) => {
    await mockShell(page);
    const started = Date.now();
    const { diagnostic } = await diagnosticFailure(page, testInfo, () => openAuthenticatedAppRoute(page, base, route, options));
    expect(Date.now() - started).toBeLessThan(28_000);
    expect(diagnostic.navigation.elapsedMs).toBeGreaterThanOrEqual(24_000);
    expect(diagnostic.navigation.panelMs).toBeNull();
    expect(diagnostic.activeTabs).toEqual(['fees']);
});

test('callback failure preserves identity, redacts secrets, and records redirect state', async ({ page }, testInfo) => {
    await mockShell(page, header);
    const failure = new Error('short-password person@example.com Bearer abc private name');
    const { original, diagnostic } = await diagnosticFailure(page, testInfo, async () => {
        await page.goto(base + '#/auth?token=secret');
        await page.evaluate(() => { setTimeout(() => { throw new Error('short-password person@example.com private name'); }, 0); });
        await page.waitForTimeout(50);
        throw failure;
    });
    expect(original).toBe(failure);
    expect(diagnostic.route).toBe('/auth');
    expect(diagnostic.events).toContainEqual(expect.objectContaining({ type: 'pageerror', error: '[redacted]' }));
    expect(JSON.stringify(diagnostic)).not.toMatch(/secret|short-password|person@|private name|Bearer/);
    await expect(withAppFailureDiagnostic({ page }, { outputPath: () => { throw Error('disk failure'); } }, () => { throw failure; })).rejects.toBe(failure);
});

for (const state of ['Player not found', 'Error loading player details']) {
    test(`baseline readiness timeout retains ${state} and transport evidence`, async ({ page }, testInfo) => {
        const { assertPageBootsWithoutFatalErrors } = await import('./helpers/boot-path.js');
        await page.route('http://smoke.invalid/**', (request) => request.fulfill({
            contentType: 'text/html', body: `<main><div>${state}</div></main><script>console.error('Error loading player details: private-person secret-token');</script>`
        }));
        await page.route('**/js/firebase-auth.js*', (request) => request.abort('connectionclosed'));
        await page.addInitScript(() => window.addEventListener('DOMContentLoaded', () => {
            const script = document.createElement('script'); script.src = '/js/firebase-auth.js?token=secret-token'; document.body.append(script);
        }));
        const failure = await assertPageBootsWithoutFatalErrors(page, {
            baseURL: 'http://smoke.invalid/', path: 'player.html?teamId=private-team&playerId=private-person',
            readySelectors: ['#player-header'], testInfo
        }).catch((error) => error);
        expect(failure).toBeInstanceOf(AggregateError);
        const text = await readFile(testInfo.outputPath('boot-path-diagnostic.json'), 'utf8');
        const diagnostic = JSON.parse(text);
        expect(diagnostic).toMatchObject({ route: '/player.html', state: {
            playerHeaderAttached: false, playerNotFound: state === 'Player not found', playerLoadError: state === 'Error loading player details'
        } });
        expect(diagnostic.events).toContainEqual(expect.objectContaining({ type: 'response', status: 200, asset: '/player.html' }));
        expect(diagnostic.events).toContainEqual(expect.objectContaining({ type: 'requestfailed', error: 'ERR_CONNECTION_CLOSED' }));
        expect(diagnostic.events).toContainEqual(expect.objectContaining({ type: 'console', error: 'player-load-failed' }));
        expect(text).not.toMatch(/private-team|private-person|secret-token|teamId|playerId/);
    });
}
