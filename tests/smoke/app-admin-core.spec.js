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

let adminSession;

test.beforeAll(async ({ browser }) => {
    test.setTimeout(AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS);
    expect(config.adminEmail, 'SMOKE_ADMIN_EMAIL is required').toBeTruthy();
    expect(config.adminPassword, 'SMOKE_ADMIN_PASSWORD is required').toBeTruthy();
    adminSession = await createAuthenticatedAppSession(browser, {
        appBaseUrl: config.appBaseUrl,
        email: config.adminEmail,
        password: config.adminPassword,
        roleLabel: 'platform admin'
    });
});

test.afterAll(async () => {
    await adminSession?.context.close();
});

test('platform admin Home loads without a platform-wide team fanout', async () => {
    const { page } = adminSession;
    const issues = collectAppRuntimeIssues(page, secrets);
    const startedAt = Date.now();
    await openAuthenticatedAppRoute(page, config.appBaseUrl, '/home', {
        heading: 'Your day'
    });
    expect(Date.now() - startedAt, 'Platform-admin Home should become usable within 20 seconds').toBeLessThan(20_000);
    expect(issues.map((issue) => redactSmokeDiagnostic(issue, secrets))).toEqual([]);
});
