import { expect, test } from '@playwright/test';
import {
    AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS,
    closeAuthenticatedAppSession,
    createAuthenticatedAppSession,
    getAppSmokeConfig,
    redactSmokeDiagnostic
} from './helpers/app-auth.js';
import { assertPageBootsWithoutFatalErrors } from './helpers/boot-path.js';
import {
    getLegacyAuthenticatedSmokePages,
    getSmokeContext
} from './page-registry.js';

const appConfig = getAppSmokeConfig();
const smokeContext = getSmokeContext();
const legacyBaseUrl = process.env.SMOKE_BASE_URL || '';
const enabled = Boolean(appConfig.appBaseUrl) &&
    Boolean(legacyBaseUrl) &&
    ['production', 'extended-production'].includes(process.env.SMOKE_SUITE || '');
const secrets = [appConfig.staffEmail, appConfig.staffPassword];

test.skip(!enabled, 'Legacy authenticated workflows run only in production smoke');
test.describe.configure({ mode: 'serial' });

let staffSession;

test.beforeAll(async ({ browser }) => {
    test.setTimeout(AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS);
    expect(appConfig.staffEmail, 'SMOKE_STAFF_EMAIL is required').toBeTruthy();
    expect(appConfig.staffPassword, 'SMOKE_STAFF_PASSWORD is required').toBeTruthy();
    expect(smokeContext.teamId, 'SMOKE_TEAM_ID is required').toBeTruthy();
    staffSession = await createAuthenticatedAppSession(browser, {
        appBaseUrl: appConfig.appBaseUrl,
        email: appConfig.staffEmail,
        password: appConfig.staffPassword,
        roleLabel: 'legacy staff'
    });
});

test.afterAll(async () => {
    await closeAuthenticatedAppSession(staffSession);
});

test('staff account boots supported legacy authenticated workflows', async () => {
    test.setTimeout(120_000);
    const { page, issues } = staffSession;

    for (const definition of getLegacyAuthenticatedSmokePages(smokeContext)) {
        await test.step(definition.name, async () => {
            await assertPageBootsWithoutFatalErrors(page, {
                baseURL: legacyBaseUrl,
                ...definition
            });
        });
    }

    expect(issues.map((issue) => redactSmokeDiagnostic(issue, secrets))).toEqual([]);
});
