import { test, expect } from '@playwright/test';
import { buildDiamondStatConfigSnapshotHash } from '../../js/diamond-stat-presentation.js';

const STORE_KEY = '__playerGameContextStore';

function createScenario({ requestedGameHasStats = true, playerHasParticipatedGames = true } = {}) {
    const olderPlayerStats = playerHasParticipatedGames && requestedGameHasStats
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
        };
    const newerPlayerStats = playerHasParticipatedGames
        ? {
            playerName: 'Ava Cole',
            playerNumber: '3',
            stats: { pts: 24, reb: 6, ast: 5 },
            timeMs: 900000,
            participated: true
        }
        : {
            playerName: 'Ava Cole',
            playerNumber: '3',
            stats: { pts: 0, reb: 0, ast: 0 },
            timeMs: 0,
            didNotPlay: true,
            participated: false
        };

    return {
        team: {
            id: 'team-1',
            name: 'Comets',
            sport: 'Basketball',
            isPublic: true,
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
                p1: olderPlayerStats,
                p2: {
                    playerName: 'Mia Diaz',
                    playerNumber: '5',
                    stats: requestedGameHasStats ? { pts: 8, reb: 7, ast: 1 } : { pts: 9, reb: 5, ast: 2 },
                    timeMs: 600000,
                    participated: true
                }
            },
            'newer-game': {
                p1: newerPlayerStats,
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
            'older-game': playerHasParticipatedGames && requestedGameHasStats
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
            'newer-game': playerHasParticipatedGames ? [
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
            ] : []
        }
    };
}

function createDiamondMixedScenario() {
    const scenario = createScenario();
    const instanceId = '00000000-0000-4000-8000-000000000001';
    const checkpointHash = `sha256:${'a'.repeat(64)}`;
    const projectionHash = `sha256:${'c'.repeat(64)}`;
    scenario.team.sport = 'Baseball';
    scenario.configs[0] = {
        id: 'cfg-1',
        baseType: 'Baseball',
        columns: ['H'],
        statDefinitions: [{ id: 'h', label: 'H', scope: 'player', visibility: 'public', type: 'base' }]
    };
    const configHash = buildDiamondStatConfigSnapshotHash({
        teamId: scenario.team.id,
        configId: scenario.configs[0].id,
        config: scenario.configs[0]
    });
    scenario.games[0] = {
        ...scenario.games[0],
        teamId: 'team-1',
        trackingEngine: 'diamond-v2',
        diamondProjectionStatus: 'current',
        diamondProjectionRevision: 8,
        diamondProjectionComplete: true,
        diamondScorebookInstanceId: instanceId,
        diamondProjectionCheckpointHash: checkpointHash,
        diamondStatConfigSnapshotHash: configHash,
        diamondProjectionHash: projectionHash
    };
    scenario.aggregatedStatsByGame['older-game'].p1 = {
        schemaVersion: 1,
        trackingEngine: 'diamond-v2',
        projectionSchemaVersion: 1,
        playerId: 'p1',
        sourceRevision: 8,
        checkpointHash,
        complete: true,
        participated: true,
        participationStatus: 'appeared',
        participationSource: 'diamond-v2',
        playerName: 'Ava Cole',
        playerNumber: '3',
        publicStatIds: ['h'],
        stats: { h: 1 },
        observedStats: {},
        derivedStats: {},
        observedDerivedStats: {},
        statCoverage: { h: 'complete' },
        statSources: { h: ['event-8'] },
        sourcePlayIds: ['event-8'],
        unavailableDerivedStats: [],
        missingStatFamilies: [],
        coverage: { batting: 'complete' },
        teamId: 'team-1',
        diamondGameId: 'older-game',
        instanceId,
        diamondScorebookInstanceId: instanceId,
        projectionGeneration: instanceId,
        statConfigSnapshotHash: configHash,
        projectionHash
    };
    delete scenario.aggregatedStatsByGame['older-game'].p2;
    scenario.diamondReplays = {
        'older-game': {
            instanceId,
            game: { trackingEngine: 'diamond-v2' },
            events: [{
                id: 'event-8',
                revision: 8,
                inning: 6,
                half: 'bottom',
                description: 'Plate appearance: walk off single',
                createdAt: '2026-03-01T21:08:00.000Z',
                isCorrection: false,
                isScoringPlay: true,
                score: { home: 3, away: 2 }
            }],
            nextCursor: null,
            complete: true,
            truncated: false,
            sourceRevision: 8,
            projectionToken: `current:8:${projectionHash}`,
            diamondStats: { status: 'complete' }
        }
    };
    return scenario;
}

function createMixedDiamondConfigScenario() {
    const scenario = createDiamondMixedScenario();
    const instanceId = '00000000-0000-4000-8000-000000000002';
    const checkpointHash = `sha256:${'d'.repeat(64)}`;
    const projectionHash = `sha256:${'e'.repeat(64)}`;
    const config = {
        id: 'cfg-2',
        baseType: 'Baseball',
        columns: ['HR'],
        statDefinitions: [
            { id: 'h', label: 'H', scope: 'player', visibility: 'private', type: 'base' },
            { id: 'hr', label: 'HR', scope: 'player', visibility: 'public', type: 'base' }
        ]
    };
    const configHash = buildDiamondStatConfigSnapshotHash({
        teamId: scenario.team.id,
        configId: config.id,
        config
    });
    scenario.configs.push(config);
    scenario.games[1] = {
        ...scenario.games[1],
        teamId: 'team-1',
        statTrackerConfigId: config.id,
        trackingEngine: 'diamond-v2',
        diamondProjectionStatus: 'current',
        diamondProjectionRevision: 9,
        diamondProjectionComplete: true,
        diamondScorebookInstanceId: instanceId,
        diamondProjectionCheckpointHash: checkpointHash,
        diamondStatConfigSnapshotHash: configHash,
        diamondProjectionHash: projectionHash
    };
    scenario.aggregatedStatsByGame['newer-game'] = {
        p1: {
            schemaVersion: 1,
            trackingEngine: 'diamond-v2',
            projectionSchemaVersion: 1,
            playerId: 'p1',
            sourceRevision: 9,
            checkpointHash,
            complete: true,
            participated: true,
            participationStatus: 'appeared',
            participationSource: 'diamond-v2',
            playerName: 'Ava Cole',
            playerNumber: '3',
            publicStatIds: ['hr'],
            stats: { hr: 1 },
            observedStats: {},
            derivedStats: {},
            observedDerivedStats: {},
            statCoverage: { hr: 'complete' },
            statSources: {},
            sourcePlayIds: [],
            unavailableDerivedStats: [],
            missingStatFamilies: [],
            coverage: { batting: 'complete' },
            teamId: 'team-1',
            diamondGameId: 'newer-game',
            instanceId,
            diamondScorebookInstanceId: instanceId,
            projectionGeneration: instanceId,
            statConfigSnapshotHash: configHash,
            projectionHash
        }
    };
    scenario.diamondReplays['newer-game'] = {
        instanceId,
        game: { trackingEngine: 'diamond-v2' },
        events: [],
        nextCursor: null,
        complete: true,
        truncated: false,
        sourceRevision: 9,
        projectionToken: `current:9:${projectionHash}`,
        diamondStats: { status: 'complete' }
    };
    return scenario;
}

async function installMocks(page, scenario, { playerShareStatus = 200, fullAccess = true, accessLevel = 'full' } = {}) {
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

        export async function getPlayers() {
            return clone(loadStore().players || []);
        }

        export async function getGames() {
            return clone(loadStore().games || []);
        }

        export async function getConfigs() {
            const store = loadStore();
            store.configReadCount = (store.configReadCount || 0) + 1;
            saveStore(store);
            return clone(store.normalizedConfigs || store.configs || []);
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
            return { url: '', path: '' };
        }

        export async function deleteLegacyImageUpload() {}
    `;

    const firebaseModule = `
        const STORE_KEY = ${JSON.stringify(STORE_KEY)};

        function loadStore() {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        }

        function clone(value) {
            return JSON.parse(JSON.stringify(value));
        }

        function saveStore(store) {
            localStorage.setItem(STORE_KEY, JSON.stringify(store));
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

            if (path.endsWith('/statTrackerConfigs')) {
                store.configReadCount = (store.configReadCount || 0) + 1;
                saveStore(store);
                return createSnapshot((store.rawConfigs || store.configs || []).map((config) => [
                    config.id,
                    config,
                    path + '/' + config.id
                ]));
            }

            if (path.endsWith('/publicPlayerStats') && store.denyDiamondStatRead === true) {
                store.diamondStatReadPaths = [...(store.diamondStatReadPaths || []), path];
                saveStore(store);
                throw Object.assign(new Error('Diamond stat generation is not readable.'), { code: 'permission-denied' });
            }

            if (path.endsWith('/aggregatedStats') || path.endsWith('/publicPlayerStats')) {
                return createSnapshot(Object.entries(store.aggregatedStatsByGame?.[gameId] || {}).map(([id, data]) => [
                    id,
                    data,
                    path + '/' + id
                ]));
            }

            if (path.endsWith('/events')) {
                store.eventReadPaths = [...(store.eventReadPaths || []), path];
                saveStore(store);
                const game = (store.games || []).find((entry) => entry.id === gameId);
                if (game?.trackingEngine === 'diamond-v2') {
                    throw new Error('Diamond player reports must not read the legacy event collection.');
                }
                return createSnapshot((store.eventsByGame?.[gameId] || []).map((event, index) => [
                    'event-' + index,
                    event,
                    'teams/team-1/games/' + gameId + '/events/event-' + index
                ]));
            }

            return createSnapshot([]);
        }

        export const db = {};
        export const functions = {};

        export function httpsCallable(_functions, name) {
            return async (payload) => {
                const store = loadStore();
                store.callableCalls = [...(store.callableCalls || []), { name, payload: clone(payload) }];
                saveStore(store);
                if (name === 'getPublicDiamondGame') {
                    return { data: clone(store.diamondReplays?.[payload.gameId] || {}) };
                }
                return { data: { status: 'unavailable' } };
            };
        }

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

        export async function shareOrCopy(payload) {
            window.__lastPlayerShare = payload;
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
            return { hasAccess: true, accessLevel: ${JSON.stringify(accessLevel)}, exitUrl: 'team.html#teamId=team-1' };
        }
    `;

    const teamAccessModule = `
        export function hasFullTeamAccess() {
            return ${JSON.stringify(fullAccess)};
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
    await page.route(/\/js\/team-admin-banner\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: bannerModule }));
    await page.route(/\/js\/team-access\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: teamAccessModule }));
    await page.route(/\/js\/premium-entitlements\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: premiumModule }));
    await page.route(/\/player-card(?:\?.*)?$/, (route) => route.fulfill({
        status: playerShareStatus,
        contentType: 'text/html',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: ''
    }));
}

async function openRequestedPlayerGame(page, baseURL, scenario) {
    await installMocks(page, scenario);
    await page.goto(`${baseURL}/player.html#teamId=team-1&gameId=older-game&playerId=p1`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#player-header')).toContainText('Ava Cole');
    await expect(page.locator('body')).not.toContainText(/Player not found|Error loading player details/i);
}

test('mixed Diamond player report uses sanitized replay while legacy games keep their event collection', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const scenario = createDiamondMixedScenario();
    await installMocks(page, scenario, { fullAccess: false, accessLevel: 'member' });

    await page.goto(`${baseURL}/player.html#teamId=team-1&gameId=older-game&playerId=p1`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#player-header')).toContainText('Ava Cole');
    await expect(page.locator('#player-events')).toContainText('Plate appearance: walk off single');
    await expect(page.locator('#player-events')).toContainText('Bottom 6');
    const store = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
    expect(store.eventReadPaths).toEqual(['teams/team-1/games/newer-game/events']);
    expect(store.callableCalls).toContainEqual({
        name: 'getPublicDiamondGame',
        payload: { teamId: 'team-1', gameId: 'older-game', cursor: null, limit: 200 }
    });
    expect(pageErrors).toEqual([]);
});

test('mixed Diamond configs keep each game bound to its own public stat IDs', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const scenario = createMixedDiamondConfigScenario();
    await installMocks(page, scenario, { fullAccess: false, accessLevel: 'member' });

    await page.goto(`${baseURL}/player.html#teamId=team-1&gameId=older-game&playerId=p1`, { waitUntil: 'domcontentloaded' });

    const olderGameCard = page.locator('#game-stats .group', { hasText: 'vs. Owls' });
    const newerGameCard = page.locator('#game-stats .group', { hasText: 'vs. Rockets' });
    await expect(olderGameCard.getByText('H', { exact: true }).locator('..')).toContainText('1');
    await expect(olderGameCard.getByText('HR', { exact: true }).locator('..')).toContainText('—');
    await expect(newerGameCard.getByText('H', { exact: true }).locator('..')).toContainText('—');
    await expect(newerGameCard.getByText('HR', { exact: true }).locator('..')).toContainText('1');
    await expect(page.locator('#season-stats')).toContainText('Observed');
    const store = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
    expect(store.eventReadPaths || []).toEqual([]);
    expect(pageErrors).toEqual([]);
});

test('Diamond player season validates the exact raw config instead of a normalized view', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const scenario = createDiamondMixedScenario();
    scenario.rawConfigs = structuredClone(scenario.configs);
    scenario.normalizedConfigs = scenario.configs.map((config) => ({
        ...config,
        statDefinitions: [
            ...config.statDefinitions,
            { id: 'ghost', label: 'Ghost', scope: 'player', visibility: 'public', type: 'base' }
        ]
    }));
    await installMocks(page, scenario, { fullAccess: false, accessLevel: 'member' });

    await page.goto(`${baseURL}/player.html#teamId=team-1&gameId=older-game&playerId=p1`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#player-header')).toContainText('Ava Cole');
    await expect(page.locator('main')).not.toContainText('Diamond statistic definitions could not be verified.');
    await expect.poll(async () => {
        const store = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
        return store.configReadCount;
    }).toBe(1);
    expect(pageErrors).toEqual([]);
});

test('Diamond player season retries an unresolved config and offers a working accessible retry', async ({ page, baseURL }) => {
    const pageErrors = [];
    let pageLoads = 0;
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('request', (request) => {
        if (new URL(request.url()).pathname.endsWith('/player.html')) pageLoads += 1;
    });
    const scenario = createDiamondMixedScenario();
    scenario.configs = [];
    await installMocks(page, scenario, { fullAccess: false, accessLevel: 'member' });

    await page.goto(`${baseURL}/player.html#teamId=team-1&gameId=older-game&playerId=p1`, { waitUntil: 'domcontentloaded' });

    const retry = page.getByRole('button', {
        name: 'Retry loading Diamond statistic definitions'
    });
    await expect(retry).toBeVisible();
    await expect(page.getByText('Diamond statistic definitions could not be verified.')).toBeVisible();
    await expect.poll(async () => {
        const store = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
        return store.configReadCount;
    }).toBe(2);
    const box = await retry.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);

    await retry.click();
    await expect.poll(() => pageLoads).toBeGreaterThanOrEqual(2);
    await expect(retry).toBeVisible();
    expect(pageErrors).toEqual([]);
});

test('denied Diamond stat head stays retryable and never becomes an authoritative empty event history', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const scenario = createDiamondMixedScenario();
    scenario.denyDiamondStatRead = true;
    scenario.eventsByGame['newer-game'] = [];
    await installMocks(page, scenario, { fullAccess: false, accessLevel: 'member' });

    await page.goto(`${baseURL}/player.html#teamId=team-1&gameId=older-game&playerId=p1`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#player-header')).toContainText('Ava Cole');
    await expect(page.locator('#player-events')).toContainText('Diamond play-by-play could not be refreshed completely.');
    await expect(page.locator('#player-events')).toContainText('Refresh this page to retry.');
    await expect(page.locator('#player-events')).not.toContainText('No events recorded for this player');
    const store = await page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
    expect(store.diamondStatReadPaths).toEqual([
        `teams/team-1/games/older-game/diamondStatGenerations/${scenario.games[0].diamondScorebookInstanceId}/publicPlayerStats`
    ]);
    expect(store.eventReadPaths).toEqual(['teams/team-1/games/newer-game/events']);
    expect(store.callableCalls || []).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'getPublicDiamondGame' })
    ]));
    expect(pageErrors).toEqual([]);
});

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

test('normal player page does not synthesize a current game card without participated games', async ({ page, baseURL }) => {
    await installMocks(page, createScenario({ playerHasParticipatedGames: false }));
    await page.goto(`${baseURL}/player.html#teamId=team-1&playerId=p1`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#player-header')).toContainText('Ava Cole');
    await expect(page.locator('#player-game-insights-section')).toBeHidden();
    await expect(page.locator('#game-stats')).toContainText('No statistics available');
    await expect(page.locator('#game-stats')).not.toContainText('vs. Owls');
    await expect(page.locator('#game-stats')).not.toContainText('Current');
});

test('public player page shares the clean preview URL after the server approves it', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await openRequestedPlayerGame(page, baseURL, createScenario({ requestedGameHasStats: true }));

    expect(pageErrors).toEqual([]);
    await expect(page.locator('#player-share-action')).toBeVisible();
    await page.locator('#share-player-page').click();
    await expect(page.locator('#player-share-status')).toHaveText('Player link copied.');
    const payload = await page.evaluate(() => window.__lastPlayerShare);
    expect(payload).toEqual({
        title: 'Ava Cole #3 — Comets',
        text: "View Ava Cole's player page on ALL PLAYS.",
        url: 'https://share.allplays.ai/player-card?teamId=team-1&playerId=p1&gameId=older-game',
        clipboardText: 'Ava Cole #3 — Comets\nhttps://share.allplays.ai/player-card?teamId=team-1&playerId=p1&gameId=older-game'
    });
});

test('public player page keeps sharing hidden when the server rejects the preview', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await installMocks(page, createScenario(), { playerShareStatus: 404 });
    await page.goto(`${baseURL}/player.html#teamId=team-1&playerId=p1`, { waitUntil: 'domcontentloaded' });

    expect(pageErrors).toEqual([]);
    await expect(page.locator('#player-header')).toContainText('Ava Cole');
    await expect(page.locator('#player-share-action')).toBeHidden();
});
