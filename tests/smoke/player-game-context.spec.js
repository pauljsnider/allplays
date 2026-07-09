import { test, expect } from '@playwright/test';

const STORE_KEY = '__playerGameContextStore';

function createScenario({ requestedGameHasStats = true } = {}) {
    return {
        team: {
            id: 'team-1',
            name: 'Comets',
            sport: 'Basketball',
            ownerId: 'coach-1',
            adminEmails: ['coach@example.com']
        },
        players: [
            { id: 'p1', name: 'Ava Cole', number: '3', position: 'Guard' },
            { id: 'p2', name: 'Mia Diaz', number: '5', position: 'Forward' }
        ],
        games: [
            {
                id: 'older-game',
                opponent: 'Owls',
                date: '2026-03-01',
                status: 'completed',
                liveStatus: 'completed',
                statTrackerConfigId: 'cfg-1'
            },
            {
                id: 'newer-game',
                opponent: 'Rockets',
                date: '2026-03-08',
                status: 'completed',
                liveStatus: 'completed',
                statTrackerConfigId: 'cfg-1'
            }
        ],
        configs: [
            {
                id: 'cfg-1',
                baseType: 'Basketball',
                columns: ['pts', 'reb', 'ast'],
                statDefinitions: [
                    { id: 'pts', label: 'PTS', scope: 'player', visibility: 'public', type: 'base', topStat: true },
                    { id: 'reb', label: 'REB', scope: 'player', visibility: 'public', type: 'base' },
                    { id: 'ast', label: 'AST', scope: 'player', visibility: 'public', type: 'base' }
                ]
            }
        ],
        aggregatedStatsByGame: {
            'older-game': {
                p1: requestedGameHasStats
                    ? {
                        playerName: 'Ava Cole',
                        playerNumber: '3',
                        stats: { pts: 12, reb: 4, ast: 3 },
                        timeMs: 720000,
                        participated: true
                    }
                    : {
                        playerName: 'Ava Cole',
                        playerNumber: '3',
                        stats: { pts: 0, reb: 0, ast: 0 },
                        timeMs: 0,
                        didNotPlay: true,
                        participated: false
                    },
                p2: {
                    playerName: 'Mia Diaz',
                    playerNumber: '5',
                    stats: requestedGameHasStats ? { pts: 8, reb: 7, ast: 1 } : { pts: 9, reb: 5, ast: 2 },
                    timeMs: 600000,
                    participated: true
                }
            },
            'newer-game': {
                p1: {
                    playerName: 'Ava Cole',
                    playerNumber: '3',
                    stats: { pts: 24, reb: 6, ast: 5 },
                    timeMs: 900000,
                    participated: true
                },
                p2: {
                    playerName: 'Mia Diaz',
                    playerNumber: '5',
                    stats: { pts: 6, reb: 3, ast: 2 },
                    timeMs: 500000,
                    participated: true
                }
            }
        },
        eventsByGame: {
            'older-game': requestedGameHasStats
                ? [
                    {
                        playerId: 'p1',
                        statKey: 'pts',
                        value: 2,
                        period: 'Q4',
                        clock: '2:18',
                        gameTime: '2:18',
                        text: 'Ava Cole made jumper',
                        timestamp: { seconds: 1772400001 }
                    }
                ]
                : [],
            'newer-game': [
                {
                    playerId: 'p1',
                    statKey: 'pts',
                    value: 3,
                    period: 'Q4',
                    clock: '1:14',
                    gameTime: '1:14',
                    text: 'Ava Cole made 3-pointer',
                    timestamp: { seconds: 1773000001 }
                }
            ]
        }
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

        function clone(value) {
            return JSON.parse(JSON.stringify(value));
        }

        export async function getTeam() {
            return clone(loadStore().team);
        }

        export async function getPlayers() {
            return clone(loadStore().players || []);
        }

        export async function getGames() {
            return clone(loadStore().games || []);
        }

        export async function getConfigs() {
            return clone(loadStore().configs || []);
        }

        export async function getRosterFieldDefinitions() {
            return [];
        }

        export async function getUnreadChatCounts() {
            return {};
        }

        export async function getUserProfile() {
            return { coachOf: ['team-1'], isAdmin: false };
        }

        export async function getGame(teamId, gameId) {
            return clone((loadStore().games || []).find((game) => game.id === gameId) || null);
        }

        export async function getPlayerPrivateProfile() {
            return null;
        }

        export async function updatePlayerProfile() {
            return {};
        }

        export async function updatePlayerPrivateProfile() {
            return {};
        }

        export async function uploadPlayerPhoto() {
            return '';
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

        function extractGameId(path) {
            return String(path || '').match(/\\/games\\/([^/]+)\\//)?.[1] || '';
        }

        function buildSnapshot(path) {
            const store = loadStore();
            const gameId = extractGameId(path);

            if (path.endsWith('/aggregatedStats')) {
                return createSnapshot(Object.entries(store.aggregatedStatsByGame?.[gameId] || {}).map(([id, data]) => [
                    id,
                    data,
                    'teams/team-1/games/' + gameId + '/aggregatedStats/' + id
                ]));
            }

            if (path.endsWith('/events')) {
                return createSnapshot((store.eventsByGame?.[gameId] || []).map((event, index) => [
                    'event-' + index,
                    event,
                    'teams/team-1/games/' + gameId + '/events/event-' + index
                ]));
            }

            return createSnapshot([]);
        }

        export const db = {};

        export function collection(_db, path) {
            return { path };
        }

        export function doc(_db, ...segments) {
            return { path: segments.join('/') };
        }

        export async function getDoc() {
            return { exists: () => false, data: () => null };
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

        export function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
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

    const teamAccessModule = `
        export function hasFullTeamAccess() {
            return true;
        }
    `;

    const premiumModule = `
        export async function readAccountPremiumEntitlement() {
            return { state: 'locked', reason: 'test' };
        }

        export function renderPremiumGateState(container) {
            if (container) container.innerHTML = '<div data-testid="premium-gate"></div>';
            return true;
        }
    `;

    await page.route(/\/js\/db\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: dbModule }));
    await page.route(/\/js\/firebase\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseModule }));
    await page.route(/\/js\/utils\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: utilsModule }));
    await page.route(/\/js\/auth\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: authModule }));
    await page.route(/\/js\/team-admin-banner\.js$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: bannerModule }));
    await page.route(/\/js\/team-access\.js$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: teamAccessModule }));
    await page.route(/\/js\/premium-entitlements\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: premiumModule }));
}

async function openRequestedPlayerGame(page, baseURL, scenario) {
    await installMocks(page, scenario);
    await page.goto(`${baseURL}/player.html#teamId=team-1&gameId=older-game&playerId=p1`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#player-header')).toContainText('Ava Cole');
    await expect(page.locator('body')).not.toContainText(/Player not found|Error loading player details/i);
}

test('game-context player page renders insights for the requested older game', async ({ page, baseURL }) => {
    await openRequestedPlayerGame(page, baseURL, createScenario({ requestedGameHasStats: true }));

    const insightsSection = page.locator('#player-game-insights-section');
    await expect(insightsSection).toBeVisible();
    await expect(insightsSection).toContainText('Selected game: Owls');
    await expect(insightsSection).toContainText(/Scoring load|All-around impact|Workload|Closing presence/);
    await expect(page.locator('#game-stats')).toContainText('vs. Owls');
    await expect(page.locator('#game-stats')).toContainText('vs. Rockets');

    const olderGameCard = page.locator('#game-stats .group', { hasText: 'vs. Owls' });
    const newerGameCard = page.locator('#game-stats .group', { hasText: 'vs. Rockets' });
    await expect(olderGameCard).toContainText('Current');
    await expect(newerGameCard).not.toContainText('Current');
});

test('game-context player page honors requested DNP game over newer stats', async ({ page, baseURL }) => {
    await openRequestedPlayerGame(page, baseURL, createScenario({ requestedGameHasStats: false }));

    await expect(page.locator('#player-game-insights-section')).toBeVisible();
    await expect(page.locator('#player-game-insights-section')).toContainText('No player-specific insights are available for this game yet.');
    await expect(page.locator('#game-stats')).toContainText('vs. Owls');
    await expect(page.locator('#game-stats')).toContainText('vs. Rockets');

    const requestedGameCard = page.locator('#game-stats .group', { hasText: 'vs. Owls' });
    const newerGameCard = page.locator('#game-stats .group', { hasText: 'vs. Rockets' });
    await expect(requestedGameCard).toContainText('Current');
    await expect(newerGameCard).not.toContainText('Current');
});
