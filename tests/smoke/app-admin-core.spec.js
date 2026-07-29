import { expect, test } from '@playwright/test';
import {
    AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS,
    collectAppRuntimeIssues,
    createAuthenticatedAppSession,
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

test.beforeAll(async () => {
    test.setTimeout(AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS);
    expect(config.adminEmail, 'SMOKE_ADMIN_EMAIL is required').toBeTruthy();
    expect(config.adminPassword, 'SMOKE_ADMIN_PASSWORD is required').toBeTruthy();
});

test('platform admin Home loads without a platform-wide team fanout', async ({ browser }) => {
    test.setTimeout(60_000);
    const { context, page } = await createAuthenticatedAppSession(browser, {
        appBaseUrl: config.appBaseUrl,
        email: config.adminEmail,
        password: config.adminPassword,
        roleLabel: 'platform admin'
    });
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
