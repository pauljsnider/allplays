import { test, expect } from '@playwright/test';

const TEAM_ADMIN_BANNER_STUB = `
export function renderTeamAdminBanner(container) {
    if (container) {
        container.innerHTML = '<div data-testid="team-admin-banner"></div>';
    }
}
`;

const EDIT_TEAM_DB_STUB = `
export async function createTeam() {
    return 'team-1';
}

export async function updateTeam() {
    return undefined;
}

export async function getTeam(teamId) {
    return {
        id: teamId,
        name: 'Tigers',
        ownerId: 'owner-1',
        adminEmails: ['owner@example.com']
    };
}

export async function getUserProfile() {
    return { email: 'owner@example.com' };
}

export async function getUserTeamsWithAccess() {
    return [];
}

export async function getPlayers() {
    return [];
}

export async function getPlayerPrivateProfile() {
    return {};
}

export async function copySelectedPlayersForTeamRollover() {
    return { copiedCount: 0 };
}

export async function uploadTeamPhoto() {
    return { url: '', path: '' };
}

export async function deleteLegacyImageUpload() {}

export async function addConfig() {
    return 'cfg-1';
}

export async function getUnreadChatCount() {
    return 0;
}

export async function getAllUsers() {
    return [];
}

export async function getTeamAccessCodes() {
    return [];
}

export async function getConfigs() {
    return [];
}

export async function getGames() {
    return [];
}

export async function updateGame() {
    return undefined;
}

export async function getRegistrationSources() {
    return [];
}

export async function syncRegistrationProvider() {
    return {
        importedCount: 0,
        players: [],
        registrationSource: null
    };
}

export async function inviteAdmin(teamId, email) {
    window.__lastAdminInvite = { teamId, email };
    return {
        code: 'EXIST111',
        teamName: 'Tigers',
        existingUser: true
    };
}

export async function addTeamAdminEmail(teamId, email) {
    window.__lastPersistedAdmin = { teamId, email };
    return undefined;
}
`;

const EDIT_TEAM_UTILS_STUB = `
export function renderHeader(container) {
    if (container) {
        container.innerHTML = '<header data-testid="mock-header"></header>';
    }
}

export function renderFooter(container) {
    if (container) {
        container.innerHTML = '<footer data-testid="mock-footer"></footer>';
    }
}

export function getUrlParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        teamId: params.get('teamId')
    };
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
`;

const EDIT_TEAM_AUTH_STUB = `
export function checkAuth(callback) {
    callback({
        uid: 'owner-1',
        email: 'owner@example.com'
    });
}

export async function sendInviteEmail() {
    return { success: true };
}
`;

const LIVE_STREAM_UTILS_STUB = `
export function normalizeYouTubeEmbedUrl(url) {
    return url;
}
`;

const TEAM_ACCESS_STUB = `
export function hasFullTeamAccess() {
    return true;
}

export function normalizeAdminEmailList(adminEmails) {
    return Array.from(new Set((Array.isArray(adminEmails) ? adminEmails : [])
        .map((email) => String(email || '').trim().toLowerCase())
        .filter(Boolean)));
}

export function normalizeTeamPermissions() {
    return {
        scorekeeping: { mode: 'all_confirmed', memberIds: [] },
        streaming: { mode: 'all_confirmed', memberIds: [] }
    };
}

export function normalizeStreamVolunteerEmailList(streamVolunteerEmails) {
    return normalizeAdminEmailList(streamVolunteerEmails);
}
`;

async function mockExternalResources(page) {
    await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));
    await page.route('https://cdn.tailwindcss.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.tailwind = { config: {} };'
    }));
}

async function mockEditTeamDependencies(page) {
    await mockExternalResources(page);
    await page.route(/\/js\/db\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: EDIT_TEAM_DB_STUB }));
    await page.route(/\/js\/utils\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: EDIT_TEAM_UTILS_STUB }));
    await page.route(/\/js\/auth\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: EDIT_TEAM_AUTH_STUB }));
    await page.route('**/js/team-admin-banner.js*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ADMIN_BANNER_STUB }));
    await page.route('**/js/live-stream-utils.js?v=2', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: LIVE_STREAM_UTILS_STUB }));
    await page.route(/\/js\/team-access\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ACCESS_STUB }));
}

test('team management exposes the existing-user admin redemption fallback without granting access before redemption', async ({ page, baseURL }) => {
    await mockEditTeamDependencies(page);

    await page.goto(`${baseURL}/edit-team.html?teamId=team-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#admin-list')).toContainText('owner@example.com');

    await page.locator('#add-admin-btn').click();
    await page.locator('#admin-email-input').fill('Coach@Example.com');
    await page.locator('#save-admin-btn').click();

    await expect(page.locator('#admin-invite-status')).toContainText('already has an account');
    await expect(page.locator('#admin-code-text')).toHaveText('EXIST111');
    await expect(page.locator('#admin-invite-code')).toBeVisible();
    await expect(page.locator('#admin-list')).toContainText('owner@example.com');
    await expect(page.locator('#admin-list')).not.toContainText('coach@example.com');

    expect(await page.evaluate(() => window.__lastAdminInvite)).toEqual({
        teamId: 'team-1',
        email: 'coach@example.com'
    });
    expect(await page.evaluate(() => window.__lastPersistedAdmin)).toBeUndefined();
});

test('legacy admin invite preserves its code and type in the canonical app route', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/accept-invite.html?code=EXIST111&type=admin`, { waitUntil: 'domcontentloaded' });

    await expect.poll(() => new URL(page.url()).pathname).toBe('/app/');
    await expect.poll(() => new URL(page.url()).hash).toBe('#/accept-invite?code=EXIST111&type=admin');
});
