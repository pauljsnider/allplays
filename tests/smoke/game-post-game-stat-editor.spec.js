import { test, expect } from '@playwright/test';

const STORE_KEY = '__gamePostGameStatEditorStore';

function createScenario() {
    return {
        team: {
            id: 'team-1',
            name: 'Comets',
            ownerId: 'owner-1',
            adminEmails: ['coach@example.com'],
            sport: 'Basketball'
        },
        game: {
            id: 'game-1',
            opponent: 'Rockets',
            date: '2026-04-03',
            status: 'completed',
            liveStatus: 'completed',
            statTrackerConfigId: 'cfg-1',
            homeScore: 38,
            awayScore: 32,
            opponentStats: {},
            summary: 'Completed game.'
        },
        players: [
            { id: 'p1', name: 'Ava Cole', number: '3' },
            { id: 'p2', name: 'Mia Diaz', number: '5' }
        ],
        config: {
            id: 'cfg-1',
            columns: ['PTS', 'REB', 'AST'],
            statDefinitions: [
                { id: 'pts', label: 'PTS', scope: 'player', visibility: 'public', type: 'base' },
                { id: 'reb', label: 'REB', scope: 'player', visibility: 'public', type: 'base' },
                { id: 'ast', label: 'AST', scope: 'player', visibility: 'public', type: 'base' },
                { id: 'effort', label: 'EFFORT', scope: 'player', visibility: 'private', type: 'base' }
            ]
        },
        aggregatedStats: {
            p1: {
                playerName: 'Ava Cole',
                playerNumber: '3',
                stats: { pts: 10, reb: 4, ast: 2 },
                timeMs: 540000,
                didNotPlay: false,
                participated: true
            },
            p2: {
                playerName: 'Mia Diaz',
                playerNumber: '5',
                stats: { pts: 6, reb: 1, ast: 3 },
                timeMs: 420000,
                didNotPlay: false,
                participated: true
            }
        },
        privatePlayerStats: {
            p1: { stats: { effort: 7 } },
            p2: { stats: { effort: 5 } }
        },
        teamStats: {},
        setCompletedGamePlayerStatsCalls: []
    };
}

async function installMocks(page, scenario) {
    await page.addInitScript(({ storeKey, value }) => {
        localStorage.setItem(storeKey, JSON.stringify(value));
    }, { storeKey: STORE_KEY, value: scenario });

    await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));

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

        export async function getTeam() {
            return clone(loadStore().team);
        }

        export async function getGame() {
            return clone(loadStore().game);
        }

        export async function getPlayers() {
            return clone(loadStore().players || []);
        }

        export async function getUnreadChatCounts() {
            return {};
        }

        export async function getUserProfile() {
            return { isAdmin: false };
        }

        export async function updateGame(_teamId, _gameId, patch) {
            const store = loadStore();
            store.game = { ...(store.game || {}), ...clone(patch) };
            saveStore(store);
        }

        export async function uploadStatSheetPhoto() {
            return '';
        }

        export async function getTeamStatsForGame() {
            return clone(loadStore().teamStats || {});
        }

        export async function setCompletedGameTeamStats(_teamId, _gameId, payload) {
            const store = loadStore();
            store.teamStats = clone(payload.stats || {});
            saveStore(store);
        }

        export async function setCompletedGamePlayerStats(teamId, gameId, playerId, payload) {
            const store = loadStore();
            store.setCompletedGamePlayerStatsCalls = store.setCompletedGamePlayerStatsCalls || [];
            store.setCompletedGamePlayerStatsCalls.push({ teamId, gameId, playerId, payload: clone(payload) });
            saveStore(store);
        }
    `;

    const firebaseModule = `
        const STORE_KEY = ${JSON.stringify(STORE_KEY)};

        function loadStore() {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
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
                docs,
                size: docs.length,
                forEach(callback) {
                    docs.forEach((doc) => callback(doc));
                }
            };
        }

        function collectionPath(teamId, gameId, name, docId = '') {
            return 'teams/' + teamId + '/games/' + gameId + '/' + name + (docId ? '/' + docId : '');
        }

        function buildSnapshot(path) {
            const store = loadStore();

            if (path.endsWith('/aggregatedStats')) {
                return createSnapshot(Object.entries(store.aggregatedStats || {}).map(([id, data]) => [
                    id,
                    data,
                    collectionPath(store.team.id, store.game.id, 'aggregatedStats', id)
                ]));
            }

            if (path.endsWith('/privatePlayerStats')) {
                return createSnapshot(Object.entries(store.privatePlayerStats || {}).map(([id, data]) => [
                    id,
                    data,
                    collectionPath(store.team.id, store.game.id, 'privatePlayerStats', id)
                ]));
            }

            if (path.endsWith('/statTrackerConfigs')) {
                return createSnapshot(store.config ? [[
                    store.config.id,
                    store.config,
                    'teams/' + store.team.id + '/statTrackerConfigs/' + store.config.id
                ]] : []);
            }

            if (path.endsWith('/events')) {
                return createSnapshot([]);
            }

            return createSnapshot([]);
        }

        export const db = {};

        export function collection(_db, path) {
            return { path };
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
    `;

    const utilsModule = `
        export function renderHeader(container) {
            if (container) container.innerHTML = '<div data-testid="header"></div>';
        }

        export function renderFooter(container) {
            if (container) container.innerHTML = '<div data-testid="footer"></div>';
        }

        export function getUrlParams() {
            const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.search.slice(1);
            return Object.fromEntries(new URLSearchParams(raw));
        }

        export function formatDate(value) {
            return String(value || '');
        }

        export function formatShortDate(value) {
            return String(value || '');
        }

        export function escapeHtml(value) {
            return String(value || '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
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
            if (container) container.innerHTML = '<div data-testid="team-banner"></div>';
        }

        export function getTeamAccessInfo() {
            return { hasAccess: true, accessLevel: 'full', exitUrl: 'team.html#teamId=team-1' };
        }
    `;

    const insightsModule = `
        export async function generateGameInsights() {
            return { teamTakeaways: [], playerSignals: [] };
        }
    `;

    const liveGameStateModule = `
        export function resolveLiveStatConfig({ configs = [], game = {} } = {}) {
            return configs.find((config) => config.id === game.statTrackerConfigId) || configs[0] || null;
        }
    `;

    const liveGameVideoModule = `
        export function buildHighlightShareUrl() {
            return '';
        }

        export function normalizeGameRecapHighlightClips() {
            return [];
        }

        export function resolveReplayVideoOptions() {
            return { hasVideo: false, replayState: { status: 'unavailable', title: 'Replay unavailable' } };
        }
    `;

    await page.route(/\/js\/db\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: dbModule }));
    await page.route(/\/js\/firebase\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseModule }));
    await page.route(/\/js\/utils\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: utilsModule }));
    await page.route(/\/js\/auth\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: authModule }));
    await page.route(/\/js\/team-admin-banner\.js$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: bannerModule }));
    await page.route(/\/js\/post-game-insights\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: insightsModule }));
    await page.route(/\/js\/live-game-state\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: liveGameStateModule }));
    await page.route(/\/js\/live-game-video\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: liveGameVideoModule }));
}

async function readStore(page) {
    return page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
}

test('completed-game stat editor saves corrections and DNP state through real controls', async ({ page, baseURL }) => {
    await installMocks(page, createScenario());

    await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });

    const tableRows = page.locator('#stats-body tr');
    await expect(tableRows).toHaveCount(2);
    await expect(tableRows.first()).toContainText('Ava Cole');
    await expect(tableRows.first()).toContainText('10');
    await expect(tableRows.first()).not.toContainText('EFFORT');

    await page.locator('#edit-stats-btn').click();
    await expect(page.locator('#stats-editor-panel')).toBeVisible();
    await expect(page.locator('#stats-editor-player-name')).toHaveText('Ava Cole');
    await expect(page.locator('[data-stat-field="pts"]')).toHaveValue('10');
    await expect(page.locator('[data-stat-field="effort"]')).toHaveValue('7');

    await page.locator('[data-stat-field="pts"]').fill('14');
    await page.locator('[data-stat-field="reb"]').fill('6');
    await page.locator('[data-stat-field="effort"]').fill('9');
    await page.locator('#stats-save-next-btn').click();

    await expect(page.locator('#stats-editor-player-name')).toHaveText('Mia Diaz');
    await expect(tableRows.first()).toContainText('14');
    await expect(tableRows.first()).toContainText('6');
    await expect(page.locator('#stats-header-row')).not.toContainText('EFFORT');

    let store = await readStore(page);
    expect(store.setCompletedGamePlayerStatsCalls).toHaveLength(1);
    expect(store.setCompletedGamePlayerStatsCalls[0]).toMatchObject({
        teamId: 'team-1',
        gameId: 'game-1',
        playerId: 'p1',
        payload: {
            playerName: 'Ava Cole',
            playerNumber: '3',
            stats: { pts: 14, reb: 6, ast: 2, effort: 9, fouls: 0 },
            didNotPlay: false,
            participated: true,
            participationStatus: 'appeared',
            participationSource: 'post-game-stat-editor',
            timeMs: 540000
        }
    });

    await expect(page.locator('[data-stat-field="pts"]')).toHaveValue('6');
    await expect(page.locator('[data-stat-field="effort"]')).toHaveValue('5');
    await page.locator('#stats-dnp-toggle').check();
    await expect(page.locator('[data-stat-field="pts"]')).toBeDisabled();
    await expect(page.locator('[data-stat-field="pts"]')).toHaveValue('0');
    await expect(page.locator('[data-stat-field="effort"]')).toBeDisabled();
    await expect(page.locator('[data-stat-field="effort"]')).toHaveValue('0');

    await page.locator('#stats-save-btn').click();

    await expect(tableRows.nth(1)).toContainText('Mia Diaz');
    await expect(tableRows.nth(1)).toContainText('DNP');
    await expect(tableRows.nth(1).locator('td').nth(2)).toHaveText('—');
    await expect(tableRows.nth(1).locator('td').nth(5)).toHaveText('—');
    await expect(tableRows.nth(1).locator('td').nth(6)).toHaveText('—');

    store = await readStore(page);
    expect(store.setCompletedGamePlayerStatsCalls).toHaveLength(2);
    expect(store.setCompletedGamePlayerStatsCalls[1]).toMatchObject({
        teamId: 'team-1',
        gameId: 'game-1',
        playerId: 'p2',
        payload: {
            playerName: 'Mia Diaz',
            playerNumber: '5',
            stats: { pts: 0, reb: 0, ast: 0, effort: 0, fouls: 0 },
            didNotPlay: true,
            participated: false,
            participationStatus: 'did-not-appear',
            participationSource: '',
            timeMs: 0
        }
    });
});
