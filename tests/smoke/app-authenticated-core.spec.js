import { expect, test } from '@playwright/test';
import {
    AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS,
    assertAuthenticatedAppRoute,
    assertNotificationInbox,
    buildAppSmokeUrl,
    closeAuthenticatedAppSession,
    createAuthenticatedAppSessions,
    getAppSmokeConfig,
    openAuthenticatedAppRoute,
    redactSmokeDiagnostic
} from './helpers/app-auth.js';

const config = getAppSmokeConfig();
const suite = process.env.SMOKE_SUITE || '';
const enabled = Boolean(config.appBaseUrl) && ['production', 'extended-production'].includes(suite);
const secretValues = [
    config.staffEmail,
    config.staffPassword,
    config.parentEmail,
    config.parentPassword
];

test.skip(!enabled, 'Credentialed core workflows run only in production or extended-production smoke');
test.describe.configure({ mode: 'serial' });

let staffSession;
let parentWorkflowSession;

test.beforeAll(async ({ browser }) => {
    test.setTimeout(AUTHENTICATED_SMOKE_SETUP_TIMEOUT_MS);
    for (const [name, value] of Object.entries({
        SMOKE_TEAM_ID: config.teamId,
        SMOKE_PLAYER_ID: config.playerId,
        SMOKE_GAME_ID: config.gameId,
        SMOKE_EVENT_ID: config.eventId,
        SMOKE_REGISTRATION_FORM_ID: config.registrationFormId
    })) {
        expect(value, `${name} is required for meaningful production fixture assertions`).toBeTruthy();
    }
    expect(
        config.staffEmail.trim().toLowerCase(),
        'Staff and parent smoke accounts must be distinct for cross-role access checks'
    ).not.toBe(config.parentEmail.trim().toLowerCase());

    [staffSession, parentWorkflowSession] = await createAuthenticatedAppSessions(browser, [
        {
            appBaseUrl: config.appBaseUrl,
            email: config.staffEmail,
            password: config.staffPassword,
            roleLabel: 'staff'
        },
        {
            appBaseUrl: config.appBaseUrl,
            email: config.parentEmail,
            password: config.parentPassword,
            roleLabel: 'parent'
        }
    ]);
});

test.afterAll(async () => {
    await Promise.all([
        closeAuthenticatedAppSession(staffSession),
        closeAuthenticatedAppSession(parentWorkflowSession)
    ]);
});

async function withAuthenticatedPage(session, callback) {
    const { page, issues } = session;
    await callback(page);
    expect(issues.map((issue) => redactSmokeDiagnostic(issue, secretValues))).toEqual([]);
}

test('staff account reaches every critical app workflow with smoke fixtures', async () => {
    test.setTimeout(240_000);
    await withAuthenticatedPage(staffSession, async (page) => {
        const teamPath = `/teams/${encodeURIComponent(config.teamId)}`;
        await assertAuthenticatedAppRoute(page, '/home', { heading: 'Your day' });
        await openAuthenticatedAppRoute(page, config.appBaseUrl, '/teams', { requiredHref: teamPath });
        await openAuthenticatedAppRoute(page, config.appBaseUrl, teamPath);
        await openAuthenticatedAppRoute(page, config.appBaseUrl, `${teamPath}?tab=roster`, {
            forbidden: [/Unable to load/i, /Team not found/i, /No players have been added yet/i],
            requiredHref: `/players/${encodeURIComponent(config.teamId)}/${encodeURIComponent(config.playerId)}`
        });
        await openAuthenticatedAppRoute(page, config.appBaseUrl, `${teamPath}/edit`, { heading: /Team settings|Edit team/ });
        await openAuthenticatedAppRoute(page, config.appBaseUrl, `/schedule?teamId=${encodeURIComponent(config.teamId)}`, {
            heading: /Schedule|Your team calendar/,
            requiredHref: `/schedule/${encodeURIComponent(config.teamId)}/${encodeURIComponent(config.eventId)}`
        });
        await openAuthenticatedAppRoute(page, config.appBaseUrl, `/messages/${encodeURIComponent(config.teamId)}`, { heading: 'Conversations' });
        await expect(page.locator('.chat-composer-textarea')).toBeVisible({ timeout: 20_000 });
        await openAuthenticatedAppRoute(page, config.appBaseUrl, `${teamPath}/fees`, { heading: 'Manage fee balances' });
        await expect(page.locator('main')).not.toContainText('No fee recipients');
        await openAuthenticatedAppRoute(
            page,
            config.appBaseUrl,
            `${teamPath}/registrations/${encodeURIComponent(config.registrationFormId)}`
        );
        await expect(page.getByText('Participant details', { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('main')).not.toContainText('No applications are available for this form yet.');
        await openAuthenticatedAppRoute(page, config.appBaseUrl, `${teamPath}/media`);
        await expect(page.getByRole('button', { name: 'Photo', exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(page.locator('main')).not.toContainText('No albums are available yet.');
        await openAuthenticatedAppRoute(page, config.appBaseUrl, `${teamPath}/certificates`, { heading: 'Awards studio' });
        await openAuthenticatedAppRoute(
            page,
            config.appBaseUrl,
            `/officials?teamId=${encodeURIComponent(config.teamId)}`,
            {
                heading: 'Assignments',
                requiredHref: `/schedule/${encodeURIComponent(config.teamId)}/${encodeURIComponent(config.gameId)}`
            }
        );
        await openAuthenticatedAppRoute(page, config.appBaseUrl, '/profile/settings');
        await openAuthenticatedAppRoute(page, config.appBaseUrl, '/help', { heading: 'Find guides without leaving the app' });
        await assertNotificationInbox(page);
    });
});

test('parent account reaches every critical family workflow with linked fixtures', async () => {
    test.setTimeout(210_000);
    await withAuthenticatedPage(parentWorkflowSession, async (page) => {
        const playerPath = `/players/${encodeURIComponent(config.teamId)}/${encodeURIComponent(config.playerId)}`;
        await assertAuthenticatedAppRoute(page, '/home', {
            heading: 'Your day',
            requiredHref: playerPath
        });
        await openAuthenticatedAppRoute(page, config.appBaseUrl, `/schedule?teamId=${encodeURIComponent(config.teamId)}`, {
            heading: /Schedule|Your team calendar/,
            requiredHref: `/schedule/${encodeURIComponent(config.teamId)}/${encodeURIComponent(config.eventId)}`
        });
        await openAuthenticatedAppRoute(page, config.appBaseUrl, `/messages/${encodeURIComponent(config.teamId)}`, { heading: 'Conversations' });
        await expect(page.locator('.chat-composer-textarea')).toBeVisible({ timeout: 20_000 });
        await openAuthenticatedAppRoute(page, config.appBaseUrl, '/parent-tools/registrations', { heading: 'Family workflows' });
        await expect(page.getByText('Registrations', { exact: true }).first()).toBeVisible();
        await expect(page.locator('main')).not.toContainText('No open registrations');
        await openAuthenticatedAppRoute(page, config.appBaseUrl, '/parent-tools/fees', { heading: 'Family workflows' });
        await expect(page.getByText('Team fees', { exact: true })).toBeVisible();
        await expect(page.locator('main')).not.toContainText('No fees in this view');
        await openAuthenticatedAppRoute(page, config.appBaseUrl, '/parent-tools/access', { heading: 'Family workflows' });
        await expect(page.getByText('Access requests', { exact: true })).toBeVisible();
        await openAuthenticatedAppRoute(page, config.appBaseUrl, '/parent-tools/household', { heading: 'Family workflows' });
        await expect(page.getByText('Create invite', { exact: true })).toBeVisible();
        await openAuthenticatedAppRoute(page, config.appBaseUrl, '/parent-tools/share', { heading: 'Family workflows' });
        await expect(page.getByText('Family share', { exact: true })).toBeVisible();
        await openAuthenticatedAppRoute(page, config.appBaseUrl, '/parent-tools/certificates', { heading: 'Family workflows' });
        await expect(page.getByText('Awards', { exact: true })).toBeVisible();
        await expect(page.locator('main')).not.toContainText('No published awards');
        await openAuthenticatedAppRoute(page, config.appBaseUrl, playerPath);
        await openAuthenticatedAppRoute(page, config.appBaseUrl, '/profile/settings');
        await assertNotificationInbox(page);
    });
});

test('role boundaries, logout, refresh persistence, and signed-out rejection hold', async () => {
    await withAuthenticatedPage(parentWorkflowSession, async (page) => {
        await page.goto(buildAppSmokeUrl(config.appBaseUrl, `/teams/${encodeURIComponent(config.teamId)}/fees`));
        await expect(page.getByText(/Admin access required|Only team owners|access denied/i).first()).toBeVisible({ timeout: 25_000 });

        await page.goto(buildAppSmokeUrl(config.appBaseUrl, '/home'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('heading', { name: 'Your day' })).toBeVisible({ timeout: 20_000 });
        await page.getByRole('button', { name: 'Sign out' }).first().click();
        await expect.poll(() => new URL(page.url()).hash, { timeout: 20_000 }).toMatch(/^#\/(?:auth|home)(?:\?|$)/);
        await page.goto(buildAppSmokeUrl(config.appBaseUrl, `/players/${encodeURIComponent(config.teamId)}/${encodeURIComponent(config.playerId)}`));
        await expect.poll(() => new URL(page.url()).hash, { timeout: 20_000 }).toMatch(/^#\/auth(?:\?|$)/);
    });
});
