import { test } from '@playwright/test';
import { assertPageBootsWithoutFatalErrors } from './helpers/boot-path.js';
import {
    getAuthenticatedSmokePages,
    getPreviewBootPages,
    getPublicSmokePages,
    getSmokeContext
} from './page-registry.js';

async function loginWithPassword(page, baseURL, email, password) {
    await page.goto(`${baseURL}/login.html`, { waitUntil: 'domcontentloaded' });
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(password);
    await Promise.all([
        page.waitForURL((url) => !url.pathname.endsWith('/login.html'), { timeout: 20000 }),
        page.locator('#submit-btn').click()
    ]);
    await page.waitForTimeout(1000);
}

const smokeContext = getSmokeContext();

test.describe('public smoke pages', () => {
    for (const definition of getPublicSmokePages()) {
        test(`${definition.name} renders`, async ({ page, baseURL }) => {
            await assertPageBootsWithoutFatalErrors(page, {
                baseURL,
                path: definition.path,
                titlePatterns: definition.titlePatterns,
                readySelectors: definition.readySelectors,
                forbiddenTexts: definition.forbiddenTexts
            });
        });
    }
});

test.describe('preview boot smoke pages', () => {
    for (const definition of getPreviewBootPages(smokeContext)) {
        test(`${definition.name} boots without fatal runtime errors`, async ({ page, baseURL }) => {
            await assertPageBootsWithoutFatalErrors(page, {
                baseURL,
                path: definition.path,
                titlePatterns: definition.titlePatterns,
                readySelectors: definition.readySelectors,
                forbiddenTexts: definition.forbiddenTexts
            });
        });
    }
});

test.describe('authenticated smoke pages', () => {
    test.skip(!smokeContext.authEmail || !smokeContext.authPassword, 'SMOKE_AUTH_EMAIL and SMOKE_AUTH_PASSWORD are required');
    test.setTimeout(300_000);

    test('authenticated coach and parent pages render', async ({ page, baseURL }) => {
        await loginWithPassword(page, baseURL, smokeContext.authEmail, smokeContext.authPassword);

        for (const definition of getAuthenticatedSmokePages(smokeContext)) {
            await test.step(definition.name, async () => {
                await assertPageBootsWithoutFatalErrors(page, {
                    baseURL,
                    path: definition.path,
                    titlePatterns: definition.titlePatterns,
                    readySelectors: definition.readySelectors,
                    forbiddenTexts: definition.forbiddenTexts
                });
            });
        }
    });
});
