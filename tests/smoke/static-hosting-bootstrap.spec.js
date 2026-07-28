import { test } from '@playwright/test';
import { PUBLIC_HOMEPAGE_GAMES_URL } from '../../js/public-homepage-games.js';
import { assertPageBootsWithoutFatalErrors } from './helpers/boot-path.js';
import {
    getAuthenticatedSmokePages,
    getPreviewBootPages,
    getPublicSmokePages,
    getSmokeContext
} from './page-registry.js';

async function loginWithPassword(page, baseURL, email, password) {
    await page.goto(`${baseURL}/app/#/auth`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in' }).last().click();
    await page.waitForURL((url) => url.pathname === '/app/' && !url.hash.startsWith('#/auth'), { timeout: 20000 });
    await page.waitForTimeout(1000);
}

const smokeContext = getSmokeContext();
const previewSmokeRuntime = process.env.SMOKE_EXPECTED_FIREBASE_RUNTIME_TARGET === 'preview-smoke';
const previewRuntimeIgnoredErrors = previewSmokeRuntime
    ? [/Installations:.*API key not valid/i]
    : [];

async function stubHomepageEndpointForBootIsolation(page) {
    await page.route(PUBLIC_HOMEPAGE_GAMES_URL, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                version: 1,
                live: [],
                upcoming: [],
                replays: []
            })
        });
    });
}

test.describe('public smoke pages', () => {
    for (const definition of getPublicSmokePages()) {
        test(`${definition.name} renders`, async ({ page, baseURL }) => {
            if (definition.name === 'homepage') {
                await stubHomepageEndpointForBootIsolation(page);
            }
            await assertPageBootsWithoutFatalErrors(page, {
                baseURL,
                ...definition,
                ignoredConsoleErrors: [
                    ...(definition.ignoredConsoleErrors || []),
                    ...previewRuntimeIgnoredErrors
                ]
            });
        });
    }
});

test.describe('preview boot smoke pages', () => {
    for (const definition of getPreviewBootPages(smokeContext)) {
        test(`${definition.name} boots without fatal runtime errors`, async ({ page, baseURL }) => {
            await assertPageBootsWithoutFatalErrors(page, {
                baseURL,
                ...definition,
                expectedAttributes: (
                    previewSmokeRuntime
                    && definition.name === 'player details without game context'
                )
                    ? []
                    : definition.expectedAttributes,
                ignoredConsoleErrors: [
                    ...(definition.ignoredConsoleErrors || []),
                    ...previewRuntimeIgnoredErrors
                ]
            });
        });
    }
});

test.describe('authenticated smoke pages', () => {
    test.skip(
        previewSmokeRuntime || !smokeContext.authEmail || !smokeContext.authPassword,
        'Authenticated smoke requires a configured non-isolated Firebase runtime.'
    );
    test.setTimeout(300_000);

    test('authenticated coach and parent pages render', async ({ page, baseURL }) => {
        await loginWithPassword(page, baseURL, smokeContext.authEmail, smokeContext.authPassword);

        for (const definition of getAuthenticatedSmokePages(smokeContext)) {
            await test.step(definition.name, async () => {
                await assertPageBootsWithoutFatalErrors(page, {
                    baseURL,
                    ...definition
                });
            });
        }
    });
});
