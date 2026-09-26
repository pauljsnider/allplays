import { expect, test } from '@playwright/test';
import path from 'node:path';

import {
    createAppCheckRuntimeConfig,
    isAppCheckEnforcementReady,
    isDiamondScorebookUiRolloutEnabled,
    readPagesSecurityMetaPolicies,
    resolveStagedFirebaseRuntimeConfig
} from '../../scripts/stage-pages-bundle.mjs';

const stagedArtifactEnabled = process.env.SMOKE_PAGES_STAGED_ARTIFACT === 'true';
const expectedEnforcementReady = isAppCheckEnforcementReady(
    process.env.SMOKE_EXPECTED_APP_CHECK_ENFORCEMENT_READY
);
const expectedSiteKey = process.env.SMOKE_EXPECTED_APP_CHECK_SITE_KEY || '';
const expectedDiamondScorebookUiEnabled = isDiamondScorebookUiRolloutEnabled(
    process.env.SMOKE_EXPECTED_DIAMOND_SCOREBOOK_UI_ENABLED
);
const expectedFirebaseRuntimeTarget = process.env.SMOKE_EXPECTED_FIREBASE_RUNTIME_TARGET || '';
const previewSmokeRuntime = expectedFirebaseRuntimeTarget === 'preview-smoke';
const securityPolicies = readPagesSecurityMetaPolicies(path.resolve(import.meta.dirname, '../..'));

test.describe('exact staged GitHub Pages artifact', () => {
    test.skip(!stagedArtifactEnabled, 'SMOKE_PAGES_STAGED_ARTIFACT=true is required');

    test('serves required hidden runtime files and no placeholder mobile claims', async ({ request }) => {
        const noJekyllResponse = await request.get('/.nojekyll');
        expect(noJekyllResponse.status()).toBe(200);
        expect(await noJekyllResponse.text()).toBe('');

        const runtimeConfigResponse = await request.get('/.well-known/allplays-runtime-config.json');
        expect(runtimeConfigResponse.status()).toBe(200);
        const runtimeConfig = await runtimeConfigResponse.json();
        expect(runtimeConfig).toEqual(createAppCheckRuntimeConfig(expectedSiteKey, {
            enforcementReady: expectedEnforcementReady,
            firebaseConfig: resolveStagedFirebaseRuntimeConfig(expectedFirebaseRuntimeTarget),
            diamondScorebookUiEnabled: expectedDiamondScorebookUiEnabled
        }));
        if (expectedEnforcementReady) {
            expect(expectedSiteKey).toMatch(/^[A-Za-z0-9_-]{10,200}$/);
        }

        for (const path of [
            '/.well-known/apple-app-site-association',
            '/.well-known/assetlinks.json',
            '/github_run_log.txt',
            '/playwright.smoke.config.js',
            '/test-family-sharing.html',
            '/test-fix-recurring-rsvp.html',
            '/test-fix-schedule-drills.html',
            '/test-foul-tracking.html',
            '/test-game-day.html',
            '/test-pr-changes.html',
            '/test-results.png',
            '/test-statsheet-mapping.html',
            '/test-track-finish-batch-limit.js',
            '/test-track-live.html',
            '/test-track-zero-stat-player-history.js',
            '/test-workflow-mobile-toc-active-state.html',
            '/test-youtube-stream.html',
            '/vite.config.js',
            '/vitest.config.ts'
        ]) {
            const response = await request.get(path);
            expect(response.status()).toBe(404);
        }
    });

    test('legacy launch helper consumes the staged flag without a runtime-config request', async ({ page }) => {
        let runtimeConfigRequests = 0;
        await page.route('**/.well-known/allplays-runtime-config.json', async (route) => {
            runtimeConfigRequests += 1;
            await route.abort();
        });
        await page.route('**/__launch-feature-meta-smoke.html', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: `<!doctype html>
                    <html>
                        <head>
                            <meta name="allplays-diamond-scorebook-ui-enabled" content="${expectedDiamondScorebookUiEnabled ? 'true' : 'false'}">
                        </head>
                        <body>
                            <script type="module">
                                import { isDiamondScorebookUiEnabled } from '/js/launch-features.js?v=3';
                                document.body.dataset.stagedDiamond = String(isDiamondScorebookUiEnabled());
                                window.__ALLPLAYS_CONFIG__ = { diamondScorebookUiEnabled: false };
                                document.body.dataset.overriddenDiamond = String(isDiamondScorebookUiEnabled());
                            </script>
                        </body>
                    </html>`
            });
        });

        const response = await page.goto('/__launch-feature-meta-smoke.html', {
            waitUntil: 'domcontentloaded'
        });
        expect(response?.status()).toBe(200);
        await expect(page.locator('body')).toHaveAttribute(
            'data-staged-diamond',
            expectedDiamondScorebookUiEnabled ? 'true' : 'false'
        );
        await expect(page.locator('body')).toHaveAttribute('data-overridden-diamond', 'false');
        expect(runtimeConfigRequests).toBe(0);
    });

    test('boots the staged React production bundle without failed executable assets', async ({ page }) => {
        const fatalErrors = [];
        const failedAssets = [];
        const externalAttestationRequests = [];

        page.on('pageerror', (error) => {
            if (
                previewSmokeRuntime
                && /Installations:.*API key not valid/i.test(error.message)
            ) {
                return;
            }
            fatalErrors.push(error.message);
        });
        page.on('requestfailed', (request) => {
            if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
                failedAssets.push(
                    `${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.trim()
                );
            }
        });
        page.on('request', (request) => {
            const url = new URL(request.url());
            if (
                (url.hostname === 'www.google.com' && url.pathname.includes('/recaptcha/'))
                || url.hostname === 'content-firebaseappcheck.googleapis.com'
                || url.hostname === 'recaptchaenterprise.googleapis.com'
            ) {
                externalAttestationRequests.push(request.url());
            }
        });

        const response = await page.goto('/app/#/auth', { waitUntil: 'domcontentloaded' });
        expect(response?.status()).toBe(200);
        await expect(page).toHaveTitle(/ALL PLAYS APP/i);
        await expect(page.locator('#root')).not.toBeEmpty();
        await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
        await expect(page.locator('input[type="email"]')).toBeVisible();
        await expect(page.locator('input[type="password"]')).toBeVisible();

        expect(fatalErrors).toEqual([]);
        expect(failedAssets).toEqual([]);
        if (!expectedEnforcementReady) {
            await expect.poll(() => page.evaluate(
                () => globalThis.__ALLPLAYS_APP_CHECK_STATUS__?.state
            )).toBe('disabled');
            expect(externalAttestationRequests).toEqual([]);
        }
    });

    for (const { name, path, widgetPolicy } of [
        { name: 'legacy root', path: '/', widgetPolicy: false },
        { name: 'React app', path: '/app/', widgetPolicy: false },
        { name: 'scoreboard widget', path: '/widget-scoreboard.html', widgetPolicy: true }
    ]) {
        test(`${name} document has one early compatible security meta pair`, async ({ page }) => {
            const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
            expect(response?.status()).toBe(200);

            const securityMeta = await page.evaluate(() => {
                const cspTags = [...document.querySelectorAll(
                    'head meta[http-equiv="Content-Security-Policy"]'
                )];
                const referrerTags = [...document.querySelectorAll('head meta[name="referrer"]')];
                const diamondLaunchTags = [...document.querySelectorAll(
                    'head meta[name="allplays-diamond-scorebook-ui-enabled"]'
                )];
                const firstScript = document.head.querySelector('script');
                const csp = cspTags[0];
                const referrer = referrerTags[0];
                const diamondLaunch = diamondLaunchTags[0];
                return {
                    cspCount: cspTags.length,
                    referrerCount: referrerTags.length,
                    diamondLaunchCount: diamondLaunchTags.length,
                    csp: csp?.getAttribute('content') || '',
                    referrer: referrer?.getAttribute('content') || '',
                    diamondLaunch: diamondLaunch?.getAttribute('content') || '',
                    cspBeforeFirstScript: !firstScript || Boolean(
                        csp && (csp.compareDocumentPosition(firstScript) & Node.DOCUMENT_POSITION_FOLLOWING)
                    ),
                    referrerBeforeFirstScript: !firstScript || Boolean(
                        referrer && (referrer.compareDocumentPosition(firstScript) & Node.DOCUMENT_POSITION_FOLLOWING)
                    ),
                    diamondLaunchBeforeFirstScript: !firstScript || Boolean(
                        diamondLaunch && (diamondLaunch.compareDocumentPosition(firstScript) & Node.DOCUMENT_POSITION_FOLLOWING)
                    )
                };
            });

            expect(securityMeta).toMatchObject({
                cspCount: 1,
                referrerCount: 1,
                diamondLaunchCount: 1,
                referrer: 'strict-origin-when-cross-origin',
                diamondLaunch: expectedDiamondScorebookUiEnabled ? 'true' : 'false',
                cspBeforeFirstScript: true,
                referrerBeforeFirstScript: true,
                diamondLaunchBeforeFirstScript: true
            });
            expect(securityMeta.csp).not.toMatch(/(?:^|;)\s*frame-ancestors(?:\s|;|$)/i);
            expect(securityMeta.csp).not.toContain("'unsafe-eval'");
            expect(securityMeta.csp).toBe(
                widgetPolicy ? securityPolicies.widgetScoreboardCsp : securityPolicies.defaultCsp
            );
        });
    }
});
