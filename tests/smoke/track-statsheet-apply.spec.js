import { test, expect } from '@playwright/test';

const STORE_KEY = '__trackStatsheetSmokeStore';

function buildUrl(baseURL, path) {
    const url = new URL(path, `${baseURL}/`);
    url.searchParams.set('cb', String(Date.now()));
    return url.toString();
}

function createScenario(overrides = {}) {
    return {
        team: {
            id: 'team-1',
            name: 'Comets',
            sport: 'Basketball'
        },
        game: {
            id: 'game-1',
            opponent: 'Rockets',
            date: '2026-04-03',
            statTrackerConfigId: 'cfg-basketball',
            status: 'scheduled',
            homeScore: 0,
            awayScore: 0,
            opponentStats: {}
        },
        players: [
            { id: 'p1', name: 'Ava Cole', number: '3' },
            { id: 'p2', name: 'Mia Diaz', number: '5' }
        ],
        config: {
            id: 'cfg-basketball',
            columns: ['PTS', 'REB', 'AST']
        },
        aiResponse: {
            homePlayers: [
                { number: '3', name: 'Ava Cole', totalPoints: 12, fouls: 2 },
                { number: '55', name: 'Mystery Player', totalPoints: 7, fouls: 1 }
            ],
            visitorPlayers: [
                { number: '10', name: 'River Stone', totalPoints: 15, fouls: 4 },
                { number: '11', name: 'Kai North', totalPoints: 9, fouls: 2 }
            ],
            scores: {
                homeFinal: 19,
                visitorFinal: 24
            }
        },
        aggregatedStats: {},
        events: {},
        liveEvents: {},
        privatePlayerStats: {},
        deleteCalls: [],
        batchOps: [],
        commitCalls: 0,
        confirmResponses: [],
        confirmMessages: [],
        confirmResults: [],
        alerts: [],
        ...overrides
    };
}

async function installModuleMocks(page) {
    await page.addInitScript(({ storeKey }) => {
        function loadStore() {
            try {
                return JSON.parse(window.localStorage.getItem(storeKey) || '{}');
            } catch (error) {
                return {};
            }
        }

        function saveStore(next) {
            window.localStorage.setItem(storeKey, JSON.stringify(next));
        }

        window.alert = (message) => {
            const store = loadStore();
            store.alerts = store.alerts || [];
            store.alerts.push(String(message));
            saveStore(store);
        };

        window.confirm = (message) => {
            const store = loadStore();
            store.confirmMessages = store.confirmMessages || [];
            store.confirmResults = store.confirmResults || [];
            store.confirmResponses = store.confirmResponses || [];
            store.confirmMessages.push(String(message));
            const next = store.confirmResponses.length > 0 ? !!store.confirmResponses.shift() : true;
            store.confirmResults.push(next);
            saveStore(store);
            return next;
        };
    }, { storeKey: STORE_KEY });

    const dbModule = `
        const STORE_KEY = ${JSON.stringify(STORE_KEY)};

        function loadStore() {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        }

        function saveStore(store) {
            localStorage.setItem(STORE_KEY, JSON.stringify(store));
        }

        function clone(value) {
            return JSON.parse(JSON.stringify(value));
        }

        function createSnapshot(entries) {
            const docs = entries.map(([id, data, path]) => ({
                id,
                ref: { path },
                data() {
                    return clone(data);
                }
            }));

            return {
                size: docs.length,
                docs,
                forEach(callback) {
                    docs.forEach((doc) => callback(doc));
                }
            };
        }

        function createCollectionPath(teamId, gameId, collectionName, docId = '') {
            const suffix = docId ? '/' + docId : '';
            return 'teams/' + teamId + '/games/' + gameId + '/' + collectionName + suffix;
        }

        function buildSnapshot(path) {
            const store = loadStore();

            if (path.endsWith('/events')) {
                return createSnapshot(Object.entries(store.events || {}).map(([id, data]) => [id, data, createCollectionPath(store.team.id, store.game.id, 'events', id)]));
            }

            if (path.endsWith('/aggregatedStats')) {
                return createSnapshot(Object.entries(store.aggregatedStats || {}).map(([id, data]) => [id, data, createCollectionPath(store.team.id, store.game.id, 'aggregatedStats', id)]));
            }

            if (path.endsWith('/liveEvents')) {
                return createSnapshot(Object.entries(store.liveEvents || {}).map(([id, data]) => [id, data, createCollectionPath(store.team.id, store.game.id, 'liveEvents', id)]));
            }

            if (path.endsWith('/privatePlayerStats')) {
                return createSnapshot(Object.entries(store.privatePlayerStats || {}).map(([id, data]) => [id, data, createCollectionPath(store.team.id, store.game.id, 'privatePlayerStats', id)]));
            }

            if (path.endsWith('/statTrackerConfigs')) {
                const config = store.config ? [[store.config.id, store.config, 'teams/' + store.team.id + '/statTrackerConfigs/' + store.config.id]] : [];
                return createSnapshot(config);
            }

            return createSnapshot([]);
        }

        export async function getTeam() {
            return clone(loadStore().team);
        }

        export async function getGame() {
            return clone(loadStore().game);
        }

        export async function getPlayers() {
            return clone(loadStore().players || []);
        }

        export async function getConfigs() {
            const store = loadStore();
            return store.config ? [clone(store.config)] : [];
        }

        export async function getGames() {
            const store = loadStore();
            return [clone(store.game)];
        }

        export async function getRosterFieldDefinitions() {
            return [];
        }

        export async function updatePlayerProfile() {
            return null;
        }

        export async function updatePlayerPrivateProfile() {
            return null;
        }

        export async function getPlayerPrivateProfile() {
            return null;
        }

        export async function uploadPlayerPhoto() {
            return '';
        }

        export function collection(_db, path) {
            return { path };
        }

        export async function getDocs(ref) {
            return buildSnapshot(ref.path);
        }

        export async function deleteDoc(ref) {
            const store = loadStore();
            const parts = String(ref.path || '').split('/');
            const collectionName = parts[parts.length - 2];
            const docId = parts[parts.length - 1];

            store.deleteCalls = store.deleteCalls || [];
            store.deleteCalls.push(ref.path);

            if (collectionName === 'events') {
                delete (store.events || {})[docId];
            }
            if (collectionName === 'aggregatedStats') {
                delete (store.aggregatedStats || {})[docId];
            }
            if (collectionName === 'liveEvents') {
                delete (store.liveEvents || {})[docId];
            }
            if (collectionName === 'privatePlayerStats') {
                delete (store.privatePlayerStats || {})[docId];
            }

            saveStore(store);
        }

        export async function uploadStatSheetPhoto() {
            const store = loadStore();
            store.uploadCount = (store.uploadCount || 0) + 1;
            saveStore(store);
            return 'https://img.test/statsheet.png';
        }

        export async function updateGame(_teamId, _gameId, patch) {
            const store = loadStore();
            store.game = { ...(store.game || {}), ...clone(patch) };
            store.updateCalls = store.updateCalls || [];
            store.updateCalls.push(clone(patch));
            saveStore(store);
        }

        export async function getUnreadChatCounts() {
            return {};
        }

        export async function getUserProfile() {
            return null;
        }

        export async function getTeamStatsForGame() {
            return {};
        }

        export async function setCompletedGamePlayerStats() {
            return null;
        }

        export async function setCompletedGameTeamStats() {
            return null;
        }
    `;

    const firebaseModule = `
        const STORE_KEY = ${JSON.stringify(STORE_KEY)};

        function loadStore() {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        }

        function saveStore(store) {
            localStorage.setItem(STORE_KEY, JSON.stringify(store));
        }

        function clone(value) {
            return JSON.parse(JSON.stringify(value));
        }

        function createSnapshot(entries) {
            const docs = entries.map(([id, data, path]) => ({
                id,
                ref: { path },
                data() {
                    return clone(data);
                }
            }));

            return {
                size: docs.length,
                docs,
                forEach(callback) {
                    docs.forEach((doc) => callback(doc));
                }
            };
        }

        function createCollectionPath(teamId, gameId, collectionName, docId = '') {
            const suffix = docId ? '/' + docId : '';
            return 'teams/' + teamId + '/games/' + gameId + '/' + collectionName + suffix;
        }

        function buildSnapshot(path) {
            const store = loadStore();

            if (path.endsWith('/events')) {
                return createSnapshot(Object.entries(store.events || {}).map(([id, data]) => [id, data, createCollectionPath(store.team.id, store.game.id, 'events', id)]));
            }

            if (path.endsWith('/aggregatedStats')) {
                return createSnapshot(Object.entries(store.aggregatedStats || {}).map(([id, data]) => [id, data, createCollectionPath(store.team.id, store.game.id, 'aggregatedStats', id)]));
            }

            if (path.endsWith('/liveEvents')) {
                return createSnapshot(Object.entries(store.liveEvents || {}).map(([id, data]) => [id, data, createCollectionPath(store.team.id, store.game.id, 'liveEvents', id)]));
            }

            if (path.endsWith('/privatePlayerStats')) {
                return createSnapshot(Object.entries(store.privatePlayerStats || {}).map(([id, data]) => [id, data, createCollectionPath(store.team.id, store.game.id, 'privatePlayerStats', id)]));
            }

            if (path.endsWith('/statTrackerConfigs')) {
                const config = store.config ? [[store.config.id, store.config, 'teams/' + store.team.id + '/statTrackerConfigs/' + store.config.id]] : [];
                return createSnapshot(config);
            }

            return createSnapshot([]);
        }

        export const db = {};

        export function collection(_db, path) {
            return { path };
        }

        export function doc(_db, path, maybeId) {
            return { path: maybeId ? path + '/' + maybeId : path };
        }

        export function query(ref) {
            return ref;
        }

        export function orderBy() {
            return null;
        }

        export async function getDocs(ref) {
            return buildSnapshot(ref.path);
        }

        export async function getDoc() {
            return {
                exists() { return false; },
                data() { return null; }
            };
        }

        export function writeBatch() {
            const operations = [];

            return {
                set(ref, data) {
                    operations.push({ type: 'set', path: ref.path, data: clone(data) });
                },
                update(ref, data) {
                    operations.push({ type: 'update', path: ref.path, data: clone(data) });
                },
                async commit() {
                    const store = loadStore();
                    store.commitCalls = (store.commitCalls || 0) + 1;
                    store.batchOps = store.batchOps || [];
                    store.batchOps.push(...operations.map((operation) => clone(operation)));

                    operations.forEach((operation) => {
                        if (operation.path.includes('/aggregatedStats/')) {
                            const playerId = operation.path.split('/').pop();
                            store.aggregatedStats = store.aggregatedStats || {};
                            store.aggregatedStats[playerId] = clone(operation.data);
                            return;
                        }

                        if (operation.path.includes('/games/')) {
                            store.game = { ...(store.game || {}), ...clone(operation.data) };
                        }
                    });

                    saveStore(store);
                }
            };
        }

        export async function setDoc() {
            return null;
        }
    `;

    const utilsModule = `
        export function renderHeader(container) {
            if (container) {
                container.innerHTML = '<div data-test-id="mock-header"></div>';
            }
        }

        export function renderFooter(container) {
            if (container) {
                container.innerHTML = '<div data-test-id="mock-footer"></div>';
            }
        }

        export function getUrlParams() {
            const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.search.slice(1);
            return Object.fromEntries(new URLSearchParams(raw));
        }

        export function escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        export function formatDate(value) {
            return String(value || '');
        }

        export function formatShortDate(value) {
            return String(value || '');
        }

        export async function shareOrCopy() {
            return { status: 'copied' };
        }
    `;

    const authModule = `
        export function checkAuth(callback) {
            callback({ uid: 'coach-1', email: 'coach@example.com' });
        }
    `;

    const bannerModule = `
        export function renderTeamAdminBanner(container) {
            if (container) {
                container.innerHTML = '';
            }
        }

        export function getTeamAccessInfo() {
            return {
                hasAccess: false,
                accessLevel: 'none',
                exitUrl: 'team.html'
            };
        }
    `;

    const firebaseImagesModule = `
        export async function ensureImageAuth() {
            return { uid: 'image-user' };
        }

        export function getImageAuthError() {
            return null;
        }
    `;

    const firebaseAppModule = `
        export function getApp() {
            return {};
        }
    `;

    const firebaseAiModule = `
        const STORE_KEY = ${JSON.stringify(STORE_KEY)};

        function loadStore() {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        }

        export class GoogleAIBackend {}

        export const Schema = {
            object(value) { return value; },
            array(value) { return value; },
            string() { return {}; },
            number() { return {}; }
        };

        export function getAI() {
            return {};
        }

        export function getGenerativeModel() {
            return {
                async generateContent() {
                    const store = loadStore();
                    return {
                        response: {
                            text() {
                                return JSON.stringify(store.aiResponse || {});
                            }
                        }
                    };
                }
            };
        }
    `;

    const insightsModule = `
        export async function generateGameInsights() {
            return { teamTakeaways: [], playerSignals: [] };
        }

        export function generatePlayerGameInsights() {
            return [];
        }
    `;

    const liveGameStateModule = `
        export function resolveLiveStatConfig({ configs = [], game = {} } = {}) {
            return configs.find((config) => config.id === game.statTrackerConfigId) || configs[0] || null;
        }
    `;

    const rosterProfileFieldsModule = `
        export function collectRosterProfileValues() { return {}; }
        export function getRosterProfileValues() { return {}; }
        export function normalizeRosterFieldDefinitions() { return []; }
        export function renderRosterProfileFields(container) { if (container) container.innerHTML = ''; }
        export function validateRosterProfileValues() { return { ok: true, values: {} }; }
    `;

    const teamAccessModule = `
        export function hasFullTeamAccess() { return true; }
    `;

    const rosterFieldPrivacyModule = `
        export function getVisibleRosterFieldValues() { return []; }
        export function getRosterFieldAccess() { return {}; }
    `;

    const premiumEntitlementsModule = `
        export async function readAccountPremiumEntitlement() { return { state: 'active' }; }
        export function renderPremiumGateState() { return false; }
    `;

    await page.route(/\/js\/db\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: dbModule });
    });

    await page.route(/\/js\/firebase\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseModule });
    });

    await page.route(/\/js\/utils\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: utilsModule });
    });

    await page.route(/\/js\/auth\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: authModule });
    });

    await page.route(/\/js\/team-admin-banner\.js$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: bannerModule });
    });

    await page.route(/\/js\/firebase-images\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseImagesModule });
    });

    await page.route(/\/js\/vendor\/firebase-app\.js$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseAppModule });
    });

    await page.route(/\/js\/vendor\/firebase-ai\.js$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseAiModule });
    });

    await page.route(/\/js\/post-game-insights\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: insightsModule });
    });

    await page.route(/\/js\/live-game-state\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: liveGameStateModule });
    });

    await page.route(/\/js\/roster-profile-fields\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: rosterProfileFieldsModule });
    });

    await page.route(/\/js\/team-access\.js$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: teamAccessModule });
    });

    await page.route(/\/js\/roster-field-privacy\.js$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: rosterFieldPrivacyModule });
    });

    await page.route(/\/js\/premium-entitlements\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: premiumEntitlementsModule });
    });
}

async function seedScenario(page, baseURL, scenario) {
    await page.goto(buildUrl(baseURL, '/track-statsheet.html'), {
        waitUntil: 'domcontentloaded'
    });
    await page.evaluate(({ storeKey, value }) => {
        localStorage.setItem(storeKey, JSON.stringify(value));
    }, { storeKey: STORE_KEY, value: scenario });
}

async function analyzeStatsheet(page, baseURL) {
    await page.goto(buildUrl(baseURL, '/track-statsheet.html#teamId=team-1&gameId=game-1'), {
        waitUntil: 'domcontentloaded'
    });

    await page.locator('#stat-sheet-input').setInputFiles({
        name: 'statsheet.png',
        mimeType: 'image/png',
        buffer: Buffer.from('fake-image')
    });
    await page.locator('#analyze-btn').click();
    await page.locator('#home-rows tr').nth(1).waitFor();
}

async function applyStatsheet(page, baseURL) {
    await analyzeStatsheet(page, baseURL);
    await page.locator('#apply-btn').click();
    await expect(page.locator('#apply-status')).toHaveText('Stats saved! Now you can add a game summary.');
    await expect(page.locator('#summary-section')).not.toHaveClass(/hidden/);
}

test.beforeEach(async ({ page }) => {
    await installModuleMocks(page);
});

test('defers score and side controls until statsheet analysis completes', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL, createScenario());

    await page.goto(buildUrl(baseURL, '/track-statsheet.html#teamId=team-1&gameId=game-1'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#home-score-input')).toBeHidden();
    await expect(page.locator('#visitor-score-input')).toBeHidden();
    await expect(page.locator('#swap-toggle')).toBeHidden();

    await page.locator('#stat-sheet-input').setInputFiles({
        name: 'statsheet.png',
        mimeType: 'image/png',
        buffer: Buffer.from('fake-image')
    });
    await page.locator('#analyze-btn').click();
    await page.locator('#home-rows tr').nth(1).waitFor();

    await expect(page.locator('#home-score-input')).toBeVisible();
    await expect(page.locator('#visitor-score-input')).toBeVisible();
    await expect(page.locator('#swap-toggle')).toBeVisible();
    await expect(page.locator('#home-score-input')).toHaveValue('19');
    await expect(page.locator('#visitor-score-input')).toHaveValue('24');
});

test('applies matched rows while unmatched home rows stay available for review', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL, createScenario());
    await analyzeStatsheet(page, baseURL);

    const unmatchedRow = page.locator('#home-rows tr').nth(1);
    await expect(unmatchedRow.locator('input[data-field="include"]')).not.toBeChecked();
    await expect(unmatchedRow.locator('select[data-field="mappedPlayerId"]')).toHaveValue('');

    await page.locator('#apply-btn').click();

    await expect(page.locator('#apply-status')).toHaveText('Stats saved! Now you can add a game summary.');
    await expect(page.locator('#summary-section')).not.toHaveClass(/hidden/);
    await expect(page.locator('#apply-btn')).toBeVisible();

    const matchedOnlyState = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
    expect(matchedOnlyState.alerts || []).not.toContain('Please map every included home row to a roster player or uncheck it.');
    expect(matchedOnlyState.commitCalls).toBe(1);
    expect(matchedOnlyState.aggregatedStats).toEqual({
        p1: {
            playerName: 'Ava Cole',
            playerNumber: '3',
            participated: true,
            participationStatus: 'appeared',
            participationSource: 'statsheet-import',
            stats: { pts: 12, fouls: 2 }
        }
    });

    await unmatchedRow.locator('input[data-field="include"]').check();
    await unmatchedRow.locator('select[data-field="mappedPlayerId"]').selectOption('p2');
    await page.locator('#home-score-input').fill('21');

    await page.locator('#apply-btn').click();
    await expect(page.locator('#apply-status')).toHaveText('Stats saved! Now you can add a game summary.');

    const savedState = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
    expect(savedState.commitCalls).toBe(2);
    expect(savedState.uploadCount).toBe(1);
    expect(savedState.aggregatedStats).toEqual({
        p1: {
            playerName: 'Ava Cole',
            playerNumber: '3',
            participated: true,
            participationStatus: 'appeared',
            participationSource: 'statsheet-import',
            stats: { pts: 12, fouls: 2 }
        },
        p2: {
            playerName: 'Mia Diaz',
            playerNumber: '5',
            participated: true,
            participationStatus: 'appeared',
            participationSource: 'statsheet-import',
            stats: { pts: 7, fouls: 1 }
        }
    });
    expect(savedState.game.homeScore).toBe(21);
    expect(savedState.game.awayScore).toBe(24);
    expect(savedState.game.status).toBe('completed');
    expect(savedState.game.statSheetPhotoUrl).toBe('https://img.test/statsheet.png');
    expect(savedState.game.opponentStats).toEqual({
        statsheet_1: { name: 'River Stone', number: '10', pts: 15, fouls: 4 },
        statsheet_2: { name: 'Kai North', number: '11', pts: 9, fouls: 2 }
    });

});

test('saves the post-apply game summary before opening the game report', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL, createScenario());
    await applyStatsheet(page, baseURL);

    const summary = 'Comets rallied in the fourth quarter behind disciplined defense.';
    await page.locator('#summary-notes').fill(summary);
    await page.locator('#save-continue-btn').click();

    await expect(page.locator('#summary-status')).toHaveText('Summary saved!');
    await expect.poll(async () => {
        const store = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
        return store.updateCalls || [];
    }).toEqual([{ summary }]);
    await expect(page).toHaveURL(/\/game\.html#teamId=team-1&gameId=game-1$/);
});

test('skips an empty post-apply summary without a second game update', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL, createScenario());
    await applyStatsheet(page, baseURL);

    await expect(page.locator('#summary-notes')).toHaveValue('');
    await page.locator('#skip-summary-btn').click();

    await expect(page).toHaveURL(/\/game\.html#teamId=team-1&gameId=game-1$/);
    const store = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
    expect(store.updateCalls || []).toEqual([]);
});

test('prevents apply when analysis finds no uniquely matched home rows', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL, createScenario({
        aiResponse: {
            homePlayers: [
                { number: '55', name: 'Mystery Player', totalPoints: 7, fouls: 1 },
                { number: '56', name: 'Unknown Guard', totalPoints: 4, fouls: 0 }
            ],
            visitorPlayers: [
                { number: '10', name: 'River Stone', totalPoints: 11, fouls: 2 }
            ],
            scores: {
                homeFinal: 11,
                visitorFinal: 11
            }
        }
    }));
    await analyzeStatsheet(page, baseURL);

    await expect(page.locator('#home-rows input[data-field="include"]')).toHaveCount(2);
    await expect(page.locator('#home-rows input[data-field="include"]').first()).not.toBeChecked();
    await expect(page.locator('#home-rows input[data-field="include"]').nth(1)).not.toBeChecked();

    await page.locator('#apply-btn').click();

    const savedState = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
    expect(savedState.alerts).toContain('Please review or map at least one home player before applying.');
    expect(savedState.commitCalls).toBe(0);
});

test('keeps zero-stat statsheet import appearances in player history', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL, createScenario({
        players: [
            { id: 'p1', name: 'Ava Cole', number: '3' },
            { id: 'p2', name: 'Mia Diaz', number: '5' },
            { id: 'p3', name: 'Zoe Quinn', number: '0' }
        ],
        aiResponse: {
            homePlayers: [
                { number: '3', name: 'Ava Cole', totalPoints: 12, fouls: 2 },
                { number: '0', name: 'Zoe Quinn', totalPoints: 0, fouls: 0 }
            ],
            visitorPlayers: [
                { number: '10', name: 'River Stone', totalPoints: 15, fouls: 4 }
            ],
            scores: {
                homeFinal: 12,
                visitorFinal: 15
            }
        }
    }));

    await analyzeStatsheet(page, baseURL);
    await page.locator('#apply-btn').click();
    await expect(page.locator('#apply-status')).toHaveText('Stats saved! Now you can add a game summary.');

    const savedState = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
    expect(savedState.aggregatedStats.p3).toEqual({
        playerName: 'Zoe Quinn',
        playerNumber: '0',
        participated: true,
        participationStatus: 'appeared',
        participationSource: 'statsheet-import',
        stats: { pts: 0, fouls: 0 }
    });

    await page.goto(buildUrl(baseURL, '/player.html#teamId=team-1&playerId=p3'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#season-stats')).toContainText('Games Played:');
    await expect(page.locator('#season-stats')).toContainText('1');
    await expect(page.locator('#game-stats')).toContainText('vs. Rockets');
    await expect(page.locator('#game-stats')).toContainText('0');
    await expect(page.locator('#game-stats')).not.toContainText('No statistics available');
});

test('respects overwrite confirmation and renders rewritten stats on the game report', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL, createScenario({
        aggregatedStats: {
            legacyPlayer: {
                playerName: 'Old Player',
                playerNumber: '99',
                stats: { pts: 99, reb: 1, ast: 1, fouls: 5 }
            }
        },
        events: {
            oldEvent: { type: 'score', timestamp: 1 }
        },
        liveEvents: {
            oldLiveEvent: { type: 'assist', timestamp: 2 }
        },
        privatePlayerStats: {
            oldPrivateStat: { playerId: 'p1', notes: 'private stale data' }
        },
        confirmResponses: [false, true]
    }));

    await analyzeStatsheet(page, baseURL);
    await page.locator('#home-rows tr').nth(1).locator('input[data-field="include"]').check();
    await page.locator('#home-rows tr').nth(1).locator('select[data-field="mappedPlayerId"]').selectOption('p2');

    await page.locator('#apply-btn').click();

    let store = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
    expect(store.confirmMessages).toEqual([
        'This game already has tracked data. Replace it with the stat sheet results?'
    ]);
    expect(store.confirmResults).toEqual([false]);
    expect(store.deleteCalls).toEqual([]);
    expect(store.commitCalls).toBe(0);
    expect(store.aggregatedStats.legacyPlayer.stats.pts).toBe(99);
    expect(store.events.oldEvent.type).toBe('score');
    expect(store.liveEvents.oldLiveEvent.type).toBe('assist');
    expect(store.privatePlayerStats.oldPrivateStat.notes).toBe('private stale data');
    await expect(page.locator('#apply-status')).toHaveText('Cancelled.');

    await page.locator('#apply-btn').click();
    await expect(page.locator('#apply-status')).toHaveText('Stats saved! Now you can add a game summary.');

    store = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
    expect(store.confirmResults).toEqual([false, true]);
    expect(store.deleteCalls).toEqual([
        'teams/team-1/games/game-1/events/oldEvent',
        'teams/team-1/games/game-1/aggregatedStats/legacyPlayer',
        'teams/team-1/games/game-1/liveEvents/oldLiveEvent',
        'teams/team-1/games/game-1/privatePlayerStats/oldPrivateStat'
    ]);
    expect(store.commitCalls).toBe(1);
    expect(store.events).toEqual({});
    expect(store.liveEvents).toEqual({});
    expect(store.privatePlayerStats).toEqual({});
    expect(Object.keys(store.aggregatedStats)).toEqual(['p1', 'p2']);
    expect(store.batchOps).toEqual(expect.arrayContaining([
        expect.objectContaining({
            type: 'set',
            path: 'teams/team-1/games/game-1/aggregatedStats/p1'
        }),
        expect.objectContaining({
            type: 'set',
            path: 'teams/team-1/games/game-1/aggregatedStats/p2'
        }),
        expect.objectContaining({
            type: 'update',
            path: 'teams/team-1/games/game-1',
            data: expect.objectContaining({
                status: 'completed',
                homeScore: 19,
                awayScore: 24
            })
        })
    ]));

    await page.goto(buildUrl(baseURL, '/game.html#teamId=team-1&gameId=game-1'), {
        waitUntil: 'domcontentloaded'
    });

    await page.locator('#stats-body tr').first().waitFor();
    await expect(page.locator('#game-header')).toContainText('Comets');
    await expect(page.locator('#game-header')).toContainText('Rockets');
    await expect(page.locator('#stats-body')).toContainText('Ava Cole');
    await expect(page.locator('#stats-body')).toContainText('Mia Diaz');
    await expect(page.locator('#stats-body')).toContainText('12');
    await expect(page.locator('#stats-body')).toContainText('7');
    await expect(page.locator('#stats-body tr').first().locator('td').nth(3)).toContainText('—');
    await expect(page.locator('#stats-body tr').first().locator('td').nth(4)).toContainText('—');
    await expect(page.locator('#opponent-stats-body')).toContainText('River Stone');
    await expect(page.locator('#opponent-stats-body')).toContainText('Kai North');
    await expect(page.locator('#opponent-stats-body')).toContainText('15');
    await expect(page.locator('#opponent-stats-body')).toContainText('9');
    await expect(page.locator('#opponent-stats-body tr').first().locator('td').nth(3)).toContainText('—');
    await expect(page.locator('#opponent-stats-body tr').first().locator('td').nth(4)).toContainText('—');
});
