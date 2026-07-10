import { test, expect } from '@playwright/test';

const DB_STUB = `
export async function getTeam(teamId) {
    return { id: teamId, name: 'Test Team', ownerId: 'user-1', adminEmails: [] };
}
export async function getPlayers() {
    return [];
}
export async function getPlayersWithPrivateRosterContacts() {
    return globalThis.__rosterCsvSavedPlayers || [];
}
export async function addPlayer(_teamId, payload) {
    globalThis.__rosterCsvAdds = globalThis.__rosterCsvAdds || [];
    globalThis.__rosterCsvAdds.push(payload);
    return 'player-imported-1';
}
export async function applyRosterCsvImportOperations(teamId, operations) {
    globalThis.__rosterCsvAdds = globalThis.__rosterCsvAdds || [];
    globalThis.__rosterCsvPrivateWrites = globalThis.__rosterCsvPrivateWrites || [];
    globalThis.__rosterCsvSavedPlayers = globalThis.__rosterCsvSavedPlayers || [];
    return operations.map((operation, index) => {
        const playerId = operation.playerId || 'player-imported-' + (index + 1);
        if (operation.type === 'add') globalThis.__rosterCsvAdds.push(operation.payload);
        if (operation.privateRosterFields || operation.privateFamilyContacts) {
            globalThis.__rosterCsvPrivateWrites.push({
                teamId,
                playerId,
                fields: operation.privateRosterFields || {},
                contacts: operation.privateFamilyContacts || {}
            });
        }
        globalThis.__rosterCsvSavedPlayers.push({
            id: playerId,
            ...operation.payload,
            privateProfileParents: operation.privateFamilyContacts?.parents || [],
            privateProfileContacts: operation.privateFamilyContacts?.contacts || []
        });
        return { ...operation, playerId };
    });
}
export async function deactivatePlayer() {}
export async function reactivatePlayer() {}
export async function getGames() {
    return [];
}
export async function uploadPlayerPhoto() {
    return 'https://example.test/photo.png';
}
export async function updatePlayer() {}
export async function setPlayerPrivateRosterProfileFields(teamId, playerId, fields, contacts) {
    globalThis.__rosterCsvPrivateWrites = globalThis.__rosterCsvPrivateWrites || [];
    globalThis.__rosterCsvPrivateWrites.push({ teamId, playerId, fields, contacts });
}
export async function inviteParent(teamId, playerId, number, email, relation) {
    globalThis.__rosterCsvInvites = globalThis.__rosterCsvInvites || [];
    globalThis.__rosterCsvInvites.push({ teamId, playerId, number, email, relation });
    return { code: 'INVITE123', teamName: 'Test Team', playerName: 'Avery Lee', existingUser: false, autoLinked: false };
}
export async function removeParentFromPlayer() {}
export async function getAllUsers() {
    return [];
}
export async function getUnreadChatCount() {
    return 0;
}
export async function getRosterFieldDefinitions() {
    return [];
}
export async function saveRosterFieldDefinition() {}
export async function disableRosterFieldDefinition() {}
export async function reorderRosterFieldDefinitions() {}
export async function listTeamParentMembershipRequests() {
    return [];
}
export async function approveParentMembershipRequest() {}
export async function denyParentMembershipRequest() {}
export async function listTeamRegistrationForms() {
    return [];
}
export async function listTeamRegistrationReviews() {
    return [];
}
export async function approveTeamRegistration() {}
export async function rejectTeamRegistration() {}
export async function extendTeamRegistrationOffer() {}
export async function acceptTeamRegistrationOffer() {}
export async function releaseTeamRegistrationWaitlist() {}
export async function listTeamTrackingItems() {
    return [];
}
export async function createTeamTrackingItem() {
    return 'tracking-item-1';
}
export async function listTeamTrackingStatuses() {
    return [];
}
export async function setTeamTrackingStatus() {}
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
export async function sendInviteEmail(email, code, type, context) {
    globalThis.__rosterCsvEmails = globalThis.__rosterCsvEmails || [];
    globalThis.__rosterCsvEmails.push({ email, code, type, context });
}
`;

const TEAM_ACCESS_STUB = `
export function hasFullTeamAccess() {
    return true;
}
export function normalizeTeamPermissions() {
    return {
        scorekeeping: { mode: 'all', memberIds: [] },
        streaming: { mode: 'all', memberIds: [] }
    };
}
`;

const TEAM_ADMIN_BANNER_STUB = `
export function renderTeamAdminBanner() {}
`;

const FIREBASE_APP_STUB = `
export function getApp() {
    return {};
}
export function _getProvider() {
    return { isInitialized: () => false, getImmediate: () => ({}), get: () => Promise.resolve({}), initialize: () => ({}) };
}
export function _registerComponent() {}
export function _removeServiceInstance() {}
export function registerVersion() {}
export function _isFirebaseServerApp() { return false; }
export const SDK_VERSION = 'test';
`;

const FIREBASE_STUB = `
export const auth = { currentUser: { uid: 'user-1', email: 'coach@example.com' } };
export const db = {};
export const storage = {};
export function onAuthStateChanged(_auth, callback) { callback(auth.currentUser); return () => {}; }
export function collection() { return {}; }
export function doc() { return {}; }
export function getDoc() { return Promise.resolve({ exists: () => false, data: () => ({}) }); }
export function getDocs() { return Promise.resolve({ docs: [], empty: true, forEach() {} }); }
export function setDoc() { return Promise.resolve(); }
export function updateDoc() { return Promise.resolve(); }
export function addDoc() { return Promise.resolve({ id: 'doc-1' }); }
export function deleteDoc() { return Promise.resolve(); }
export function query() { return {}; }
export function where() { return {}; }
export function orderBy() { return {}; }
export function limit() { return {}; }
export function onSnapshot(_ref, next) { if (typeof next === 'function') next({ docs: [], empty: true, forEach() {} }); return () => {}; }
export function serverTimestamp() { return new Date(); }
export function writeBatch() { return { set() {}, update() {}, delete() {}, commit: () => Promise.resolve() }; }
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
    await page.route(/\/js\/telemetry\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await page.route(/\/js\/firebase\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_STUB }));
    await page.route(/\/js\/db\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: DB_STUB }));
    await page.route(/\/js\/utils\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: UTILS_STUB }));
    await page.route(/\/js\/auth\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: AUTH_STUB }));
    await page.route(/\/js\/team-access\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ACCESS_STUB }));
    await page.route(/\/js\/team-admin-banner\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ADMIN_BANNER_STUB }));
    await page.route(/\/js\/vendor\/firebase-app\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_APP_STUB }));
    await page.route(/\/js\/vendor\/firebase-ai\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_AI_STUB }));
}

async function openBulkAiTab(page, baseURL) {
    await mockEditRosterDependencies(page);
    await page.goto(`${baseURL}/edit-roster.html?teamId=team-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#team-name-display')).toHaveText('Test Team');
    await page.click('#tab-bulk-ai');
    await expect(page.locator('#content-bulk-ai')).toBeVisible();
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

test('CSV roster review saves family contacts and sends imported invitations', async ({ page, baseURL }) => {
    page.on('dialog', async (dialog) => dialog.accept());
    await openBulkAiTab(page, baseURL);
    await page.click('#tab-csv-import');
    await expect(page.locator('#content-csv-import')).toBeVisible();

    await page.fill('#roster-csv-input', [
        'Name,Number,Position,DOB,Parent Name,Parent Email,Parent Relation',
        'Avery Lee,4,Forward,2014-02-03,Pat Lee,pat@example.com,Mother'
    ].join('\n'));
    await page.click('#import-csv-btn');

    await expect(page.locator('#csv-import-preview')).toBeVisible();
    await expect(page.locator('#csv-import-preview')).toContainText('Review 1 planned player row');
    await expect(page.locator('#csv-import-preview')).toContainText('Pat Lee · Mother · pat@example.com');
    expect(await page.evaluate(() => (globalThis.__rosterCsvAdds || []).length)).toBe(0);

    await page.click('#import-csv-btn');
    await expect(page.locator('#csv-import-status')).toContainText('Imported 1 player row. Family invites: 1 emailed.');
    await expect(page.getByText('Imported family contacts', { exact: true })).toBeVisible();
    await expect(page.getByText('pat@example.com · Mother · Invite needed')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send / resend invite' })).toBeVisible();

    expect(await page.evaluate(() => globalThis.__rosterCsvAdds || [])).toEqual([
        expect.objectContaining({ name: 'Avery Lee', number: '4', position: 'Forward' })
    ]);
    expect(await page.evaluate(() => globalThis.__rosterCsvPrivateWrites || [])).toEqual([
        expect.objectContaining({
            playerId: 'player-imported-1',
            contacts: { parents: [expect.objectContaining({ email: 'pat@example.com', relation: 'Mother' })] }
        })
    ]);
    expect(await page.evaluate(() => globalThis.__rosterCsvInvites || [])).toEqual([
        expect.objectContaining({ playerId: 'player-imported-1', email: 'pat@example.com', relation: 'Mother' })
    ]);
    expect(await page.evaluate(() => globalThis.__rosterCsvEmails || [])).toEqual([
        expect.objectContaining({ email: 'pat@example.com', code: 'INVITE123', type: 'parent' })
    ]);
});
