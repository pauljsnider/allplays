import { expect, test } from '@playwright/test';
import {
    AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS,
    assertAuthenticatedAppRoute,
    collectAppRuntimeIssues,
    signInToApp,
    getAppSmokeConfig,
    redactSmokeDiagnostic
} from './helpers/app-auth.js';
import { withAppFailureDiagnostic } from './helpers/app-route-diagnostic.js';

const config = getAppSmokeConfig();
const enabled = Boolean(config.appBaseUrl) &&
    ['production', 'extended-production'].includes(process.env.SMOKE_SUITE || '');
const secrets = [config.adminEmail, config.adminPassword];

test.skip(!enabled, 'Platform-admin workflow runs only in production smoke');
test.describe.configure({ mode: 'serial' });

// Start diagnostics before sign-in: runtime issues include authentication traffic.
// Playwright owns this test's context and closes it on success, failure or timeout.
test.use({ serviceWorkers: 'block' });

test('platform admin Home loads without a platform-wide team fanout', async ({ page }, testInfo) => {
    test.setTimeout(AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS + 30_000);
    expect(config.adminEmail, 'SMOKE_ADMIN_EMAIL is required').toBeTruthy();
    expect(config.adminPassword, 'SMOKE_ADMIN_PASSWORD is required').toBeTruthy();
    const issues = collectAppRuntimeIssues(page, secrets);
    await withAppFailureDiagnostic({ page }, testInfo, async () => {
        const { authenticatedHomeStartedAt } = await signInToApp(page, {
            appBaseUrl: config.appBaseUrl,
            email: config.adminEmail,
            password: config.adminPassword,
            roleLabel: 'platform admin'
        });
        await assertAuthenticatedAppRoute(page, '/home', {
            heading: 'Your day'
        });
        expect(
            Date.now() - authenticatedHomeStartedAt,
            'Platform-admin Home should become usable within 20 seconds of authentication'
        ).toBeLessThan(20_000);
        expect(issues.map((issue) => redactSmokeDiagnostic(issue, secrets))).toEqual([]);
    }, { includeApiFailures: true });
});
