import { test, expect } from '@playwright/test';

const DB_STUB = `
export async function getTeam(teamId) {
    return { id: teamId, name: 'Test Team', ownerId: 'user-1', adminEmails: [] };
}
export async function getPlayers() {
    return [];
}
export async function addPlayer() {}
export async function deactivatePlayer() {}
export async function reactivatePlayer() {}
export async function getGames() {
    return [];
}
export async function uploadPlayerPhoto() {
    return 'https://example.test/photo.png';
}
export async function updatePlayer() {}
export async function inviteParent() {
    return {};
}
export async function removeParentFromPlayer() {}
export async function getAllUsers() {
    return [];
}
export async function getUnreadChatCount() {
    return 0;
}
export async function listTeamParentMembershipRequests() {
    return [];
}
export async function approveParentMembershipRequest() {}
export async function denyParentMembershipRequest() {}
`;

const UTILS_STUB = `
export function renderHeader() {}
export function renderFooter() {}
export function getUrlParams() {
    return { teamId: 'team-1' };
}
export function escapeHtml(value) {
    return value;
}
`;

const AUTH_STUB = `
export function checkAuth(callback) {
    callback({ uid: 'user-1', email: 'coach@example.com', isAdmin: false });
}
export async function sendInviteEmail() {}
`;

const TEAM_ACCESS_STUB = `
export function hasFullTeamAccess() {
    return true;
}
`;

const TEAM_ADMIN_BANNER_STUB = `
export function renderTeamAdminBanner() {}
`;

const FIREBASE_APP_STUB = `
export function getApp() {
    return {};
}
`;

const FIREBASE_AI_STUB = `
export class GoogleAIBackend {}
export const Schema = {
    object(value) {
        return value;
    },
    array(value) {
        return value;
    },
    string() {
        return { type: 'string' };
    }
};
export function getAI() {
    return {};
}
export function getGenerativeModel() {
    return {
        async generateContent(promptParts) {
            const normalizedParts = promptParts.map((part) => typeof part === 'string'
                ? { type: 'text', value: part }
                : { type: 'inlineData', mimeType: part?.inlineData?.mimeType || null });
            globalThis.__bulkAiCalls = globalThis.__bulkAiCalls || [];
            globalThis.__bulkAiCalls.push(normalizedParts);
            return {
                response: {
                    text() {
                        return JSON.stringify({
                            operations: [
                                {
                                    action: 'add',
                                    player: {
                                        name: 'Avery Carter',
                                        number: '12'
                                    }
                                }
                            ]
                        });
                    }
                }
            };
        }
    };
}
`;

async function mockEditRosterDependencies(page) {
    await page.route('**/js/db.js?v=15', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: DB_STUB }));
    await page.route('**/js/utils.js?v=8', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: UTILS_STUB }));
    await page.route('**/js/auth.js?v=10', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: AUTH_STUB }));
    await page.route('**/js/team-access.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ACCESS_STUB }));
    await page.route('**/js/team-admin-banner.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ADMIN_BANNER_STUB }));
    await page.route('**/js/vendor/firebase-app.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_APP_STUB }));
    await page.route('**/js/vendor/firebase-ai.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_AI_STUB }));
}

async function openBulkAiTab(page, baseURL) {
    await mockEditRosterDependencies(page);
    await page.goto(`${baseURL}/edit-roster.html?teamId=team-1`, { waitUntil: 'domcontentloaded' });
    await page.click('#tab-bulk-ai');
}

async function uploadRosterImage(page) {
    await page.setInputFiles('#roster-image-input', {
        name: 'roster.png',
        mimeType: 'image/png',
        buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aFEAAAAASUVORK5CYII=',
            'base64'
        )
    });
    await expect(page.locator('#roster-image-preview')).toBeVisible();
    await expect(page.locator('#roster-image-preview-img')).toHaveAttribute('src', /data:image\/png;base64,/);
}

test('bulk AI cancel clears stale image state before another run', async ({ page, baseURL }) => {
    const dialogs = [];
    page.on('dialog', async (dialog) => {
        dialogs.push(dialog.message());
        await dialog.accept();
    });

    await openBulkAiTab(page, baseURL);
    await uploadRosterImage(page);

    await page.click('#process-ai-btn');
    await expect(page.locator('#proposed-changes-section')).toBeVisible();
    await expect(page.locator('#changes-count')).toHaveText('1 change');

    await page.click('#cancel-changes-btn');

    await expect(page.locator('#proposed-changes-section')).toBeHidden();
    await expect(page.locator('#bulk-text-input')).toHaveValue('');

    const fileCount = await page.evaluate(() => document.getElementById('roster-image-input').files.length);
    expect(fileCount).toBe(0);
    await expect(page.locator('#roster-image-preview')).toBeHidden();
    await expect(page.locator('#roster-image-preview-img')).toHaveAttribute('src', '');

    await page.click('#process-ai-btn');
    expect(dialogs.at(-1)).toBe('Please upload an image or paste roster text');

    const aiCallCount = await page.evaluate(() => (globalThis.__bulkAiCalls || []).length);
    expect(aiCallCount).toBe(1);
});

test('fresh run after cancel only uses newly entered input', async ({ page, baseURL }) => {
    await openBulkAiTab(page, baseURL);
    await uploadRosterImage(page);

    await page.click('#process-ai-btn');
    await expect(page.locator('#proposed-changes-section')).toBeVisible();

    await page.click('#cancel-changes-btn');
    await page.fill('#bulk-text-input', '#22 Jordan Reed');
    await page.click('#process-ai-btn');

    const aiCalls = await page.evaluate(() => globalThis.__bulkAiCalls || []);
    expect(aiCalls).toHaveLength(2);
    expect(aiCalls[1]).toHaveLength(1);
    expect(aiCalls[1][0].type).toBe('text');
    expect(aiCalls[1][0].value).toContain('#22 Jordan Reed');
});
