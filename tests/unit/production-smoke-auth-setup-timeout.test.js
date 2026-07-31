import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const helper = readFileSync('tests/smoke/helpers/app-auth.js', 'utf8');
const authenticatedCore = readFileSync('tests/smoke/app-authenticated-core.spec.js', 'utf8');
const adminCore = readFileSync('tests/smoke/app-admin-core.spec.js', 'utf8');
const authenticatedExtended = readFileSync('tests/smoke/app-authenticated-extended.spec.js', 'utf8');
const legacyAuthenticatedCore = readFileSync('tests/smoke/legacy-authenticated-core.spec.js', 'utf8');

describe('production smoke authenticated setup timeout', () => {
    it('uses an explicit bounded setup budget for every credentialed role suite', () => {
        expect(helper).toContain('export const AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS = 240_000;');

        for (const source of [authenticatedCore, adminCore, authenticatedExtended, legacyAuthenticatedCore]) {
            expect(source).toContain('AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS');
            expect(source).toMatch(
                /test\.beforeAll\(async \(\{ browser \}\) => \{\s+test\.setTimeout\(AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS\);/
            );

            const boundedSetup = source.slice(
                source.indexOf('test.beforeAll('),
                source.indexOf('test.afterAll(')
            );
            expect(boundedSetup).toMatch(/createAuthenticatedAppSession(?:s)?\(browser,/);
            expect(source).toMatch(/test\.afterAll\(async \(\) => \{[\s\S]*?closeAuthenticatedAppSession\(/);
        }

        for (const source of [authenticatedCore, authenticatedExtended]) {
            const boundedSetup = source.slice(
                source.indexOf('test.beforeAll('),
                source.indexOf('test.afterAll(')
            );
            expect(boundedSetup).toContain('createAuthenticatedAppSessions(browser, [');
        }
    });

    it('keeps Firebase authentication in a live context without serializing IndexedDB state', () => {
        const authenticatedSessionHelper = helper.slice(
            helper.indexOf('export async function createAuthenticatedAppSession'),
            helper.indexOf('export async function openAuthenticatedAppRoute')
        );

        expect(authenticatedSessionHelper).toContain(
            'const issues = collectAppRuntimeIssues(page, [credentials.email, credentials.password]);'
        );
        expect(authenticatedSessionHelper.indexOf('collectAppRuntimeIssues(')).toBeLessThan(
            authenticatedSessionHelper.indexOf('signInToApp(')
        );
        expect(authenticatedSessionHelper).toContain('return { context, page, issues, ...timing };');
        expect(authenticatedSessionHelper).toContain('Promise.allSettled(');
        expect(authenticatedSessionHelper).toContain('closeBrowserContextBounded(context)');
        expect(helper).toContain('smoke authentication failed while ${stage}');
        expect(helper).toContain('AUTHENTICATED_CONTEXT_CLOSE_TIMEOUT_MS = 5_000');
        expect(helper).toContain('timeoutId = setTimeout(resolve, AUTHENTICATED_CONTEXT_CLOSE_TIMEOUT_MS)');
        expect(authenticatedSessionHelper).not.toContain('storageState(');
        expect(authenticatedSessionHelper).not.toContain('page.reload(');

        for (const source of [authenticatedCore, adminCore, authenticatedExtended]) {
            expect(source).toContain('createAuthenticatedAppSession');
            expect(source).not.toContain('createAuthenticatedStorageState');
            expect(source).not.toContain('storageState:');
        }
    });

    it('returns immediately after authenticated navigation without waiting for vanished credential fields', () => {
        const signInHelper = helper.slice(
            helper.indexOf('export async function signInToApp'),
            helper.indexOf('async function closeBrowserContextBounded')
        );

        expect(signInHelper).toContain('return { authenticatedHomeStartedAt };');
        expect(signInHelper).not.toContain(".fill('')");
    });

    it('limits credential concurrency in the core post-deploy workflow', () => {
        const workflow = readFileSync('.github/workflows/post-deploy-smoke.yml', 'utf8');
        const scheduledWorkflow = readFileSync('.github/workflows/scheduled-prod-smoke.yml', 'utf8');

        expect(workflow).toMatch(
            /tests\/smoke\/app-admin-core\.spec\.js[\s\S]*?tests\/smoke\/app-authenticated-core\.spec\.js[\s\S]*?--workers=1/
        );
        expect(workflow).toMatch(
            /tests\/smoke\/app-admin-core\.spec\.js[\s\S]*?tests\/smoke\/app-authenticated-core\.spec\.js[\s\S]*?--retries=1/
        );
        expect(scheduledWorkflow).toMatch(
            /tests\/smoke\/app-admin-core\.spec\.js[\s\S]*?tests\/smoke\/app-authenticated-core\.spec\.js[\s\S]*?--workers=1/
        );
        expect(authenticatedCore).not.toContain('parentBoundarySession');
        expect(authenticatedCore).toContain('withAuthenticatedPage(parentWorkflowSession');
    });

    it('selects the singular media action without matching the plural media filter', () => {
        expect(authenticatedCore).toContain(
            "getByRole('button', { name: 'Photo', exact: true })"
        );
    });

    it('keeps the officials workflow team-scoped and backed by the seeded game', () => {
        expect(authenticatedCore).toContain(
            '`/officials?teamId=${encodeURIComponent(config.teamId)}`'
        );
        expect(authenticatedCore).toContain(
            'requiredHref: `/schedule/${encodeURIComponent(config.teamId)}/${encodeURIComponent(config.gameId)}`'
        );
        expect(authenticatedCore).not.toContain("openAuthenticatedAppRoute(page, config.appBaseUrl, '/officials'");
    });

    it('waits for asynchronously hydrated fixture links before failing a route', () => {
        const routeHelper = helper.slice(
            helper.indexOf('export async function assertAuthenticatedAppRoute'),
            helper.indexOf('export async function openAuthenticatedAppRoute')
        );

        expect(routeHelper).toContain('await expect.poll(');
        expect(routeHelper).toContain('timeout: 25_000');
        expect(routeHelper).toContain(
            'message: `Expected a meaningful fixture link containing ${requiredHref}`'
        );
        expect(routeHelper).not.toContain('const found = await');
    });

    it('asserts the initial authenticated Home route without navigating to the current URL', () => {
        const routeAssertions = [
            "assertAuthenticatedAppRoute(page, '/home'",
            "assertAuthenticatedAppRoute(page, '/home'",
            "assertAuthenticatedAppRoute(page, '/home'"
        ];

        for (const [source, assertion] of [
            [adminCore, routeAssertions[0]],
            [authenticatedCore, routeAssertions[1]],
            [authenticatedExtended, routeAssertions[2]]
        ]) {
            expect(source).toContain(assertion);
            expect(source).not.toContain("openAuthenticatedAppRoute(page, config.appBaseUrl, '/home'");
        }

        expect(helper).toMatch(
            /export async function openAuthenticatedAppRoute[\s\S]*?page\.goto\([\s\S]*?await assertAuthenticatedAppRoute\(page, route, options\);/
        );
    });

    it('checks the linked parent fixture in the Home Players section', () => {
        const parentWorkflow = authenticatedCore.slice(
            authenticatedCore.indexOf("test('parent account reaches"),
            authenticatedCore.indexOf("test('role boundaries")
        );

        expect(parentWorkflow).toContain("assertAuthenticatedAppRoute(page, '/home',");
        expect(parentWorkflow).toContain(
            "openAuthenticatedAppRoute(page, config.appBaseUrl, '/home?section=players'"
        );
        expect(parentWorkflow).toMatch(
            /\/home\?section=players'[\s\S]*?requiredHref: playerPath/
        );
        expect(parentWorkflow).not.toContain(
            "assertAuthenticatedAppRoute(page, '/home', {\n            heading: 'Your day',\n            requiredHref: playerPath"
        );
    });

    it('measures the initial admin Home transition from before the sign-in action', () => {
        expect(helper).toMatch(
            /const authenticatedHomeStartedAt = Date\.now\(\);[\s\S]*?await page\.getByRole\('button', \{ name: 'Sign in' \}\)/
        );
        expect(adminCore).toContain('Date.now() - authenticatedHomeStartedAt');
    });
});
