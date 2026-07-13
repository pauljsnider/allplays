import { test, expect } from '@playwright/test';

// Workflow/E2E security test: drive the edit-roster bulk-AI import flow with a
// malicious player name and confirm the rendered proposed-changes input escapes
// it (no injected node, no fired handler). Uses the REAL escapeHtml so this
// genuinely exercises the fix at edit-roster.html:2410.

const MALICIOUS_NAME = '"><img src=x onerror="window.__xssFired=true">';
const MALICIOUS_NUMBER = '"><img src=y onerror="window.__xssFired=true">';

// Real escapeHtml from js/utils.js — inlined so the stub does NOT neuter the fix.
const UTILS_STUB = `
export function renderHeader() {}
export function renderFooter() {}
export function getUrlParams() {
    return { teamId: 'team-1' };
}
export function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return String(unsafe)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
`;

const DB_STUB = `
export async function getTeam(teamId) {
    return { id: teamId, name: 'Test Team', ownerId: 'user-1', adminEmails: [] };
}
export async function getPlayers() { return []; }
export async function getPlayersWithPrivateRosterContacts() { return []; }
export async function addPlayer() {}
export async function applyRosterCsvImportOperations(_teamId, operations) {
    return operations.map((operation, index) => ({ ...operation, playerId: operation.playerId || 'player-' + (index + 1) }));
}
export async function deactivatePlayer() {}
export async function reactivatePlayer() {}
export async function getGames() { return []; }
export async function uploadPlayerPhoto() { return 'https://example.test/photo.png'; }
export async function updatePlayer() {}
export async function setPlayerPrivateRosterProfileFields() {}
export async function inviteParent() { return {}; }
export async function removeParentFromPlayer() {}
export async function getUsersByParentPlayerKey() { return []; }
export async function getUsersByParentTeamId() { return []; }
export async function getAllUsers() { return []; }
export async function getUnreadChatCount() { return 0; }
export async function getRosterFieldDefinitions() { return []; }
export async function saveRosterFieldDefinition() {}
export async function disableRosterFieldDefinition() {}
export async function reorderRosterFieldDefinitions() {}
export async function listTeamParentMembershipRequests() { return []; }
export async function approveParentMembershipRequest() {}
export async function denyParentMembershipRequest() {}
export async function listTeamRegistrationForms() { return []; }
export async function listTeamRegistrationReviews() { return []; }
export async function approveTeamRegistration() {}
export async function rejectTeamRegistration() {}
export async function extendTeamRegistrationOffer() {}
export async function acceptTeamRegistrationOffer() {}
export async function releaseTeamRegistrationWaitlist() {}
export async function listTeamTrackingItems() { return []; }
export async function createTeamTrackingItem() { return 'tracking-item-1'; }
export async function listTeamTrackingStatuses() { return []; }
export async function setTeamTrackingStatus() {}
`;

const AUTH_STUB = `
export function checkAuth(callback) {
    callback({ uid: 'user-1', email: 'coach@example.com', isAdmin: false });
}
`;

const INVITE_EMAIL_STUB = `export async function queueInviteEmail() { return { queued: true }; }`;

const TEAM_ACCESS_STUB = `
export function hasFullTeamAccess() { return true; }
export function normalizeTeamPermissions() {
    return { scorekeeping: { mode: 'all', memberIds: [] }, streaming: { mode: 'all', memberIds: [] } };
}
`;

const TEAM_ADMIN_BANNER_STUB = `export function renderTeamAdminBanner() {}`;

const FIREBASE_APP_STUB = `
export function getApp() { return {}; }
export function _getProvider() { return { isInitialized: () => false, getImmediate: () => ({}), get: () => Promise.resolve({}), initialize: () => ({}) }; }
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
    object(value) { return value; },
    array(value) { return value; },
    string() { return { type: 'string' }; }
};
export function getAI() { return {}; }
export function getGenerativeModel() {
    return {
        async generateContent() {
            return {
                response: {
                    text() {
                        return JSON.stringify({
                            operations: [
                                { action: 'add', player: { name: ${JSON.stringify(MALICIOUS_NAME)}, number: ${JSON.stringify(MALICIOUS_NUMBER)} } }
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
    await page.route(/\/js\/invite-email\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: INVITE_EMAIL_STUB }));
    await page.route(/\/js\/team-access\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ACCESS_STUB }));
    await page.route(/\/js\/team-admin-banner\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ADMIN_BANNER_STUB }));
    await page.route(/\/js\/vendor\/firebase-app\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_APP_STUB }));
    await page.route(/\/js\/vendor\/firebase-ai\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_AI_STUB }));
}

test('malicious AI-imported player name is escaped in proposed changes (no XSS)', async ({ page, baseURL }) => {
    page.on('dialog', (dialog) => dialog.accept());

    await mockEditRosterDependencies(page);
    await page.goto(`${baseURL}/edit-roster.html?teamId=team-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#team-name-display')).toHaveText('Test Team');

    await page.click('#tab-bulk-ai');
    await expect(page.locator('#content-bulk-ai')).toBeVisible();

    await page.fill('#bulk-text-input', '#12 malicious');
    await page.click('#process-ai-btn');
    await expect(page.locator('#proposed-changes-section')).toBeVisible();

    const nameInput = page.locator('#proposed-changes-list input[placeholder="Player Name"]');
    const numberInput = page.locator('#proposed-changes-list input[placeholder="Number (optional)"]');
    // The full payloads are preserved as inert input values (proves both the name
    // and the jersey number were escaped into the attribute, not parsed as markup).
    await expect(nameInput).toHaveValue(MALICIOUS_NAME);
    await expect(numberInput).toHaveValue(MALICIOUS_NUMBER);

    // No injected element and no fired handler from either field.
    expect(await page.locator('#proposed-changes-list img').count()).toBe(0);
    expect(await page.evaluate(() => window.__xssFired)).toBeFalsy();
});
