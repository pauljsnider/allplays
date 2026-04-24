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

export async function uploadTeamPhoto() {
    return null;
}

export async function addConfig() {
    return 'cfg-1';
}

export async function getUnreadChatCount() {
    return 0;
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
`;

const ACCEPT_INVITE_DB_STUB = `
window.__acceptInviteCalls = [];

export async function validateAccessCode(code) {
    window.__acceptInviteCalls.push({ type: 'validate', code });
    return {
        valid: true,
        codeId: 'code-admin-1',
        type: 'admin_invite',
        data: {
            teamId: 'team-1'
        }
    };
}

export async function redeemParentInvite() {
    throw new Error('parent invite should not be redeemed in this scenario');
}

export async function redeemAdminInviteAtomically(codeId, userId, authEmail) {
    window.__acceptInviteCalls.push({ type: 'redeem', codeId, userId, authEmail });
    return {
        success: true,
        teamId: 'team-1',
        teamName: 'Tigers'
    };
}

export async function updateUserProfile() {
    return undefined;
}

export async function updateTeam() {
    return undefined;
}

export async function getTeam(teamId) {
    return {
        id: teamId,
        name: 'Tigers',
        ownerId: 'owner-1',
        adminEmails: ['coach@example.com']
    };
}

export async function getUserProfile() {
    return {
        email: 'coach@example.com'
    };
}

export async function markAccessCodeAsUsed() {
    return undefined;
}
`;

const ACCEPT_INVITE_AUTH_STUB = `
export function isEmailSignInLink() {
    return false;
}

export async function completeEmailLinkSignIn() {
    throw new Error('email link flow is not expected in this test');
}

export function checkAuth(callback) {
    callback({
        uid: 'admin-1',
        email: 'coach@example.com'
    });
}

export function getRedirectUrl() {
    return 'dashboard.html';
}
`;

const SHARED_UTILS_STUB = `
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
    await page.route(/\/dashboard\.html(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body><main data-testid="dashboard">Dashboard</main></body></html>'
    }));
}

async function mockEditTeamDependencies(page) {
    await mockExternalResources(page);
    await page.route('**/js/db.js?v=15', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: EDIT_TEAM_DB_STUB }));
    await page.route('**/js/utils.js?v=8', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: EDIT_TEAM_UTILS_STUB }));
    await page.route('**/js/auth.js?v=12', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: EDIT_TEAM_AUTH_STUB }));
    await page.route('**/js/team-admin-banner.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ADMIN_BANNER_STUB }));
    await page.route('**/js/live-stream-utils.js?v=1', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: LIVE_STREAM_UTILS_STUB }));
    await page.route('**/js/team-access.js?v=1', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ACCESS_STUB }));
}

async function mockAcceptInviteDependencies(page) {
    await mockExternalResources(page);
    await page.route('**/js/db.js?v=15', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: ACCEPT_INVITE_DB_STUB }));
    await page.route('**/js/auth.js?v=12', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: ACCEPT_INVITE_AUTH_STUB }));
    await page.route('**/js/utils.js?v=8', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: SHARED_UTILS_STUB }));
}

test('team management exposes the existing-user admin redemption fallback', async ({ page, baseURL }) => {
    await mockEditTeamDependencies(page);

    await page.goto(`${baseURL}/edit-team.html?teamId=team-1`, { waitUntil: 'domcontentloaded' });

    await page.locator('#add-admin-btn').click();
    await page.locator('#admin-email-input').fill('Coach@Example.com');
    await page.locator('#save-admin-btn').click();

    await expect(page.locator('#admin-invite-status')).toContainText('already has an account');
    await expect(page.locator('#admin-code-text')).toHaveText('EXIST111');
    await expect(page.locator('#admin-invite-code')).toBeVisible();
    await expect(page.locator('#admin-list')).toContainText('coach@example.com');

    expect(await page.evaluate(() => window.__lastAdminInvite)).toEqual({
        teamId: 'team-1',
        email: 'coach@example.com'
    });
    expect(await page.evaluate(() => window.__lastPersistedAdmin)).toEqual({
        teamId: 'team-1',
        email: 'coach@example.com'
    });
});

test('accept-invite redeems an admin invite into dashboard access', async ({ page, baseURL }) => {
    await mockAcceptInviteDependencies(page);

    await page.goto(`${baseURL}/accept-invite.html?code=EXIST111&type=admin`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#success-message')).toContainText("You've been added as an admin of Tigers!");
    expect(await page.evaluate(() => window.__acceptInviteCalls)).toEqual([
        { type: 'validate', code: 'EXIST111' },
        {
            type: 'redeem',
            codeId: 'code-admin-1',
            userId: 'admin-1',
            authEmail: 'coach@example.com'
        }
    ]);
    await expect(page).toHaveURL(/\/dashboard\.html$/);
});
