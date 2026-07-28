import { expect, test } from '@playwright/test';
import {
    collectAppRuntimeIssues,
    createAuthenticatedStorageState,
    getAppSmokeConfig,
    openAuthenticatedAppRoute,
    redactSmokeDiagnostic
} from './helpers/app-auth.js';

const config = getAppSmokeConfig();
const enabled = Boolean(config.appBaseUrl) &&
    ['production', 'extended-production'].includes(process.env.SMOKE_SUITE || '');
const secrets = [config.adminEmail, config.adminPassword];

test.skip(!enabled, 'Platform-admin workflow runs only in production smoke');
test.describe.configure({ mode: 'serial' });

let adminStorageState;

test.beforeAll(async ({ browser }) => {
    expect(config.adminEmail, 'SMOKE_ADMIN_EMAIL is required').toBeTruthy();
    expect(config.adminPassword, 'SMOKE_ADMIN_PASSWORD is required').toBeTruthy();
    adminStorageState = await createAuthenticatedStorageState(browser, {
        appBaseUrl: config.appBaseUrl,
        email: config.adminEmail,
        password: config.adminPassword,
        roleLabel: 'platform admin'
    });
});

test('platform admin Home loads without a platform-wide team fanout', async ({ browser }) => {
    const context = await browser.newContext({
        storageState: adminStorageState,
        serviceWorkers: 'block'
    });
    const page = await context.newPage();
    const issues = collectAppRuntimeIssues(page, secrets);
    const startedAt = Date.now();
    try {
        await openAuthenticatedAppRoute(page, config.appBaseUrl, '/home', {
            heading: 'Your day'
        });
        expect(Date.now() - startedAt, 'Platform-admin Home should become usable within 20 seconds').toBeLessThan(20_000);
        expect(issues.map((issue) => redactSmokeDiagnostic(issue, secrets))).toEqual([]);
    } finally {
        await context.close();
    }
});
