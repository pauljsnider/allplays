import { expect, test } from '@playwright/test';
import path from 'node:path';

import { readPagesSecurityMetaPolicies } from '../../scripts/stage-pages-bundle.mjs';

const stagedArtifactEnabled = process.env.SMOKE_PAGES_STAGED_ARTIFACT === 'true';
const expectedSiteKey = process.env.SMOKE_EXPECTED_APP_CHECK_SITE_KEY || '';
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
        expect(runtimeConfig).toMatchObject({
            appCheck: {
                enabled: true,
                isTokenAutoRefreshEnabled: true
            }
        });
        expect(runtimeConfig.appCheck.recaptchaEnterpriseSiteKey).toMatch(/^[A-Za-z0-9_-]{10,200}$/);
        expect(expectedSiteKey).toMatch(/^[A-Za-z0-9_-]{10,200}$/);
        expect(runtimeConfig.appCheck.recaptchaEnterpriseSiteKey === expectedSiteKey).toBe(true);

        for (const path of [
            '/.well-known/apple-app-site-association',
            '/.well-known/assetlinks.json'
        ]) {
            const response = await request.get(path);
            expect(response.status()).toBe(404);
        }
    });

    test('boots the staged React production bundle without failed executable assets', async ({ page }) => {
        const fatalErrors = [];
        const failedAssets = [];

        page.on('pageerror', (error) => {
            fatalErrors.push(error.message);
        });
        page.on('requestfailed', (request) => {
            if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
                failedAssets.push(
                    `${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.trim()
                );
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
                const firstScript = document.head.querySelector('script');
                const csp = cspTags[0];
                const referrer = referrerTags[0];
                return {
                    cspCount: cspTags.length,
                    referrerCount: referrerTags.length,
                    csp: csp?.getAttribute('content') || '',
                    referrer: referrer?.getAttribute('content') || '',
                    cspBeforeFirstScript: !firstScript || Boolean(
                        csp && (csp.compareDocumentPosition(firstScript) & Node.DOCUMENT_POSITION_FOLLOWING)
                    ),
                    referrerBeforeFirstScript: !firstScript || Boolean(
                        referrer && (referrer.compareDocumentPosition(firstScript) & Node.DOCUMENT_POSITION_FOLLOWING)
                    )
                };
            });

            expect(securityMeta).toMatchObject({
                cspCount: 1,
                referrerCount: 1,
                referrer: 'strict-origin-when-cross-origin',
                cspBeforeFirstScript: true,
                referrerBeforeFirstScript: true
            });
            expect(securityMeta.csp).not.toMatch(/(?:^|;)\s*frame-ancestors(?:\s|;|$)/i);
            expect(securityMeta.csp).not.toContain("'unsafe-eval'");
            expect(securityMeta.csp).toBe(
                widgetPolicy ? securityPolicies.widgetScoreboardCsp : securityPolicies.defaultCsp
            );
        });
    }
});
