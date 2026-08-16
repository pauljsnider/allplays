import { test, expect } from '@playwright/test';
import { buildUrl, createBootIssueCollector } from './helpers/boot-path.js';

const DB_STUB = `
const state = () => window.__organizationScheduleTestState;

export async function getTeam(teamId) {
    return state().teams.find((team) => team.id === teamId) || null;
}
export async function getTeams() { return state().teams; }
export async function getUserTeamsWithAccess() { return state().teams; }
export async function getGames(teamId) {
    const testState = state();
    if (testState.delayPreCancellationRefresh && testState.cancelCalls.length === 0) {
        const games = (testState.gamesByTeam[teamId] || []).map((game) => ({ ...game }));
        testState.delayedRefreshCaptures += 1;
        await new Promise((resolve) => testState.delayedRefreshResolvers.push(resolve));
        testState.delayedRefreshReturns += 1;
        return games;
    }
    if (testState.failRefreshAfterCancellation && testState.cancelCalls.length > 0) {
        throw new Error('Schedule refresh unavailable');
    }
    return testState.gamesByTeam[teamId] || [];
}
export async function getGame(teamId, gameId) {
    return (state().gamesByTeam[teamId] || []).find((game) => game.id === gameId) || null;
}
export async function addGame() { return 'created-game'; }
export async function cancelGame(teamId, gameId, userId) {
    const testState = state();
    testState.cancelCalls.push({ teamId, gameId, userId });
    const source = (testState.gamesByTeam[teamId] || []).find((game) => game.id === gameId);
    const counterpart = source
        ? (testState.gamesByTeam[source.sharedScheduleOpponentTeamId] || [])
            .find((game) => game.id === source.sharedScheduleOpponentGameId)
        : null;
    if (source) source.status = 'cancelled';
    if (counterpart && !testState.sourceOnlyCancellation) counterpart.status = 'cancelled';
}
export async function postChatMessage(teamId) {
    state().notificationTeamIds.push(teamId);
    if (state().failNotifications && teamId === 'team-2') {
        throw new Error('Team 2 chat unavailable');
    }
}
export async function createOrganizationBlackout() {}
export async function createVenueAvailability() {}
export async function createVenueBlackout() {}
export async function listOrganizationScheduleControls() {
    return { availability: [], organizationBlackouts: [], venueBlackouts: [] };
}
`;

const UTILS_STUB = `
export function renderHeader() {}
export function renderFooter() {}
export function getUrlParams() {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    return Object.fromEntries(new URLSearchParams(hash).entries());
}
`;

const AUTH_STUB = `
export function checkAuth(callback) {
    Promise.resolve().then(() => callback({
        uid: 'admin-1',
        email: 'admin@example.com',
        displayName: 'Admin Example',
        isAdmin: true
    }));
}
`;

const TEAM_ACCESS_STUB = `
export function getTeamAccessInfo() {
    return { hasAccess: true, accessLevel: 'full' };
}
`;

const FIREBASE_STUB = `
export const db = {};
export const functions = {};
export const Timestamp = {
    now() { return { toDate: () => new Date() }; },
    fromDate(date) { return { toDate: () => date }; }
};
export function collection() { return {}; }
export function doc() { return {}; }
export async function addDoc() { return { id: 'created' }; }
export async function deleteDoc() {}
export async function updateDoc() {}
export async function getDocs() { return { docs: [] }; }
export function httpsCallable() {
    return async () => ({ data: { publishedCount: 1 } });
}
`;

const CANCELLATION_STUB = `
export async function cancelScheduledGame(options) {
    const testState = window.__organizationScheduleTestState;
    testState.helperCalls.push({
        teamId: options.teamId,
        gameId: options.gameId,
        counterpartTeamId: options.counterpartTeamId,
        counterpartOpponent: options.counterpartOpponent
    });
    try {
        await options.cancelGame(options.teamId, options.gameId, options.user.uid);
    } catch (error) {
        return { cancelled: false, error: error.message };
    }
    const failures = [];
    for (const teamId of [options.teamId, options.counterpartTeamId]) {
        try {
            await options.postChatMessage(teamId, { text: 'cancelled' });
        } catch (error) {
            failures.push(error.message);
        }
    }
    return {
        cancelled: true,
        notificationError: failures.length ? failures.join('; ') : null
    };
}
`;

async function mockModules(page) {
    const routes = [
        ['**/js/db.js*', DB_STUB],
        ['**/js/utils.js*', UTILS_STUB],
        ['**/js/auth.js*', AUTH_STUB],
        ['**/js/team-access.js*', TEAM_ACCESS_STUB],
        ['**/js/firebase.js*', FIREBASE_STUB],
        ['**/js/edit-schedule-cancel-game.js*', CANCELLATION_STUB],
        ['**/js/telemetry.js*', '']
    ];
    for (const [url, body] of routes) {
        await page.route(url, (route) => route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body
        }));
    }
}

async function seedState(page, {
    failNotifications = false,
    failRefreshAfterCancellation = false,
    sourceOnlyCancellation = false
} = {}) {
    await page.addInitScript((options) => {
        const source = {
            id: 'source-1',
            type: 'game',
            date: '2026-09-01T18:00:00.000Z',
            location: 'Main Field',
            status: 'scheduled',
            isHome: true,
            sharedScheduleId: 'shared-team-1-source-1',
            sharedScheduleOpponentTeamId: 'team-2',
            sharedScheduleOpponentGameId: 'mirror-1'
        };
        const counterpart = {
            id: 'mirror-1',
            type: 'game',
            date: '2026-09-01T18:00:00.000Z',
            location: 'Main Field',
            status: 'scheduled',
            isHome: false,
            sharedScheduleId: 'shared-team-1-source-1',
            sharedScheduleSourceTeamId: 'team-1',
            sharedScheduleOpponentTeamId: 'team-1',
            sharedScheduleOpponentGameId: 'source-1'
        };
        window.__organizationScheduleTestState = {
            teams: [
                { id: 'team-1', name: 'Alpha', ownerId: 'org-1' },
                { id: 'team-2', name: 'Bravo', ownerId: 'org-1' }
            ],
            gamesByTeam: { 'team-1': [source], 'team-2': [counterpart] },
            cancelCalls: [],
            helperCalls: [],
            notificationTeamIds: [],
            failNotifications: options.failNotifications,
            failRefreshAfterCancellation: options.failRefreshAfterCancellation,
            sourceOnlyCancellation: options.sourceOnlyCancellation,
            delayPreCancellationRefresh: false,
            delayedRefreshCaptures: 0,
            delayedRefreshReturns: 0,
            delayedRefreshResolvers: []
        };
    }, { failNotifications, failRefreshAfterCancellation, sourceOnlyCancellation });
}

test('reviews and cancels one reciprocal organization matchup', async ({ page, baseURL }) => {
    await mockModules(page);
    await seedState(page);
    const bootIssues = createBootIssueCollector(page, { baseURL });
    await page.goto(buildUrl(baseURL, '/organization-schedule.html#teamId=team-1'), { waitUntil: 'domcontentloaded' });

    await expect(page.locator('[data-shared-schedule-id]')).toHaveCount(1);
    expect(bootIssues).toEqual([]);
    const row = page.locator('[data-shared-schedule-id="shared-team-1-source-1"]');
    await expect(row).toContainText('Alpha');
    await expect(row).toContainText('Bravo');
    await expect(row).toContainText('Main Field');
    await expect(row).toContainText('Scheduled');
    await expect(row.locator('a')).toHaveCount(2);

    page.once('dialog', (dialog) => dialog.dismiss());
    await row.getByRole('button', { name: 'Cancel' }).click();
    expect(await page.evaluate(() => window.__organizationScheduleTestState.cancelCalls)).toEqual([]);

    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Cancel' }).click();
    await expect(row).toContainText('Cancelled');
    await expect(row.getByRole('button', { name: 'Cancel' })).toHaveCount(0);

    const state = await page.evaluate(() => window.__organizationScheduleTestState);
    expect(state.helperCalls).toEqual([{
        teamId: 'team-1',
        gameId: 'source-1',
        counterpartTeamId: 'team-2',
        counterpartOpponent: 'Alpha'
    }]);
    expect(state.cancelCalls).toEqual([{ teamId: 'team-1', gameId: 'source-1', userId: 'admin-1' }]);
    expect(state.notificationTeamIds).toEqual(['team-1', 'team-2']);
    expect(state.gamesByTeam['team-1'][0].status).toBe('cancelled');
    expect(state.gamesByTeam['team-2'][0].status).toBe('cancelled');
    await expect(page.locator('[data-shared-schedule-id]')).toHaveCount(1);
});

test('reports notification partial failure without claiming cancellation success', async ({ page, baseURL }) => {
    await mockModules(page);
    await seedState(page, { failNotifications: true });
    const bootIssues = createBootIssueCollector(page, { baseURL });
    await page.goto(buildUrl(baseURL, '/organization-schedule.html#teamId=team-1'), { waitUntil: 'domcontentloaded' });

    const row = page.locator('[data-shared-schedule-id="shared-team-1-source-1"]');
    await expect(row).toBeVisible();
    expect(bootIssues).toEqual([]);
    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.locator('#organization-access-alert')).toContainText('Matchup cancelled, but team notifications were incomplete.');
    await expect(page.locator('#organization-success')).toBeHidden();
    await expect(row).toContainText('Cancelled');
});

test('reports one-sided cancellation for retry without notifications or success', async ({ page, baseURL }) => {
    await mockModules(page);
    await seedState(page, { sourceOnlyCancellation: true });
    const bootIssues = createBootIssueCollector(page, { baseURL });
    await page.goto(buildUrl(baseURL, '/organization-schedule.html#teamId=team-1'), { waitUntil: 'domcontentloaded' });

    const row = page.locator('[data-shared-schedule-id="shared-team-1-source-1"]');
    await expect(row).toBeVisible();
    expect(bootIssues).toEqual([]);
    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.locator('#organization-access-alert')).toContainText('Cancellation is incomplete. Please retry.');
    await expect(page.locator('#organization-success')).toBeHidden();
    await expect(row).toContainText('Cancellation incomplete');
    await expect(row.getByRole('button', { name: 'Retry cancellation' })).toBeEnabled();
    const state = await page.evaluate(() => window.__organizationScheduleTestState);
    expect(state.notificationTeamIds).toEqual([]);
    expect(state.gamesByTeam['team-1'][0].status).toBe('cancelled');
    expect(state.gamesByTeam['team-2'][0].status).toBe('scheduled');
});

test('keeps verified cancellation disabled when the organization refresh fails', async ({ page, baseURL }) => {
    await mockModules(page);
    await seedState(page, { failRefreshAfterCancellation: true });
    const bootIssues = createBootIssueCollector(page, { baseURL });
    await page.goto(buildUrl(baseURL, '/organization-schedule.html#teamId=team-1'), { waitUntil: 'domcontentloaded' });

    const row = page.locator('[data-shared-schedule-id="shared-team-1-source-1"]');
    await expect(row).toBeVisible();
    expect(bootIssues).toEqual([]);
    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.locator('#organization-access-alert')).toContainText('Matchup cancelled, but the organization list could not refresh.');
    await expect(page.locator('#organization-success')).toBeHidden();
    await expect(row).toContainText('Cancelled');
    await expect(row.getByRole('button', { name: /Cancel/ })).toHaveCount(0);
});

test('ignores an overlapping pre-cancellation refresh after verified cancellation', async ({ page, baseURL }) => {
    await mockModules(page);
    await seedState(page, { failRefreshAfterCancellation: true });
    const bootIssues = createBootIssueCollector(page, { baseURL });
    await page.goto(buildUrl(baseURL, '/organization-schedule.html#teamId=team-1'), { waitUntil: 'domcontentloaded' });

    const row = page.locator('[data-shared-schedule-id="shared-team-1-source-1"]');
    await expect(row).toBeVisible();
    expect(bootIssues).toEqual([]);
    await page.evaluate(() => { window.__organizationScheduleTestState.delayPreCancellationRefresh = true; });
    await page.getByRole('button', { name: 'Refresh published matchups' }).click();
    await expect.poll(() => page.evaluate(() => window.__organizationScheduleTestState.delayedRefreshCaptures)).toBe(2);

    page.once('dialog', (dialog) => dialog.accept());
    await row.getByRole('button', { name: 'Cancel' }).click();
    await expect(row).toContainText('Cancelled');

    await page.evaluate(() => {
        const testState = window.__organizationScheduleTestState;
        testState.delayPreCancellationRefresh = false;
        testState.delayedRefreshResolvers.splice(0).forEach((resolve) => resolve());
    });
    await expect.poll(() => page.evaluate(() => window.__organizationScheduleTestState.delayedRefreshReturns)).toBe(2);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    await expect(row).toContainText('Cancelled');
    await expect(row.getByRole('button', { name: /Cancel/ })).toHaveCount(0);
    expect(await page.evaluate(() => window.__organizationScheduleTestState.cancelCalls)).toHaveLength(1);
});
