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
                { id: 'effort', label: 'EFFORT', scope: 'player', visibility: 'private', type: 'base' },
                { id: 'turnovers', label: 'TURNOVERS', scope: 'team', visibility: 'public', type: 'base' }
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
        teamStats: { turnovers: 8 },
        setCompletedGamePlayerStatsCalls: []
    };
}

async function installMocks(page, scenario, { delayedAuth = false, accessLevel = 'full', directAccess = true } = {}) {
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
            const team = clone(loadStore().team);
            if (!${JSON.stringify(directAccess)}) team.__denyTestAccess = true;
            return team;
        }

        export async function getDelegatedTeamContext() {
            const store = loadStore();
            return clone(store.delegatedTeam || store.team);
        }

        export async function getGame() {
            const game = clone(loadStore().game);
            const linkedAt = game?.replayVideo?.linkedAt;
            if (typeof linkedAt === 'string' && !Number.isNaN(Date.parse(linkedAt))) {
                const millis = Date.parse(linkedAt);
                game.replayVideo.linkedAt = {
                    seconds: Math.floor(millis / 1000),
                    nanoseconds: (millis % 1000) * 1000000,
                    toDate() {
                        return new Date(millis);
                    }
                };
            }
            return game;
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

        export async function deleteUploadedMediaObjects() {}

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
        const DELETE_FIELD_SENTINEL = { __deleteField: true };

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

        export function doc(_db, ...segments) {
            return { path: segments.join('/') };
        }

        export function collection(_db, path) {
            return { path };
        }

        export function query(ref) {
            return ref;
        }

        export function orderBy() {
            return null;
        }

        export function deleteField() {
            return DELETE_FIELD_SENTINEL;
        }

        export async function getDocs(ref) {
            return buildSnapshot(ref.path);
        }

        export async function runTransaction(_db, callback) {
            const transaction = {
                async get() {
                    const game = clone(loadStore().game);
                    const linkedAt = game?.replayVideo?.linkedAt;
                    if (typeof linkedAt === 'string' && !Number.isNaN(Date.parse(linkedAt))) {
                        const millis = Date.parse(linkedAt);
                        game.replayVideo.linkedAt = {
                            seconds: Math.floor(millis / 1000),
                            nanoseconds: (millis % 1000) * 1000000,
                            toDate() {
                                return new Date(millis);
                            }
                        };
                    }
                    return {
                        exists() {
                            return Boolean(game);
                        },
                        data() {
                            return game;
                        }
                    };
                },
                update(_ref, patch) {
                    const store = loadStore();
                    store.game = { ...(store.game || {}) };
                    Object.entries(patch).forEach(([key, value]) => {
                        if (value?.__deleteField === true) {
                            delete store.game[key];
                        } else {
                            store.game[key] = clone(value);
                        }
                    });
                    saveStore(store);
                }
            };
            return callback(transaction);
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

        export async function shareOrCopy(input) {
            window.__GAME_SHARE_PAYLOADS__ = window.__GAME_SHARE_PAYLOADS__ || [];
            window.__GAME_SHARE_PAYLOADS__.push(input);
            return { status: 'copied' };
        }
    `;

    const authModule = delayedAuth ? `
        export function checkAuth(callback) {
            window.__GAME_AUTH_EVENTS__ = ['pending'];
            setTimeout(() => {
                window.__GAME_AUTH_EVENTS__.push('authenticated');
                callback({ uid: 'coach-1', email: 'coach@example.com' });
            }, 4000);
        }
    ` : `
        export function checkAuth(callback) {
            callback({ uid: 'coach-1', email: 'coach@example.com' });
        }
    `;

    const bannerModule = `
        export function renderTeamAdminBanner(container) {
            if (container) container.innerHTML = '<div data-testid="team-banner"></div>';
        }

        export function getTeamAccessInfo(_user, team) {
            if (team?.__denyTestAccess) {
                return { hasAccess: false, accessLevel: null, exitUrl: 'index.html' };
            }
            return { hasAccess: true, accessLevel: ${JSON.stringify(accessLevel)}, exitUrl: 'team.html#teamId=team-1' };
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

        export function resolveReplayVideoOptions({ game } = {}) {
            const replay = game?.replayVideo;
            if (replay?.provider === 'youtube' && replay?.status === 'ready' && replay?.videoId) {
                return {
                    mode: 'embed',
                    isRecordedReplay: true,
                    hasVideo: true,
                    sourceUrl: replay.embedUrl,
                    publicUrl: replay.publicUrl,
                    replayState: null
                };
            }
            const attachedClip = Array.isArray(game?.highlightClips)
                ? game.highlightClips.find((clip) => clip?.type === 'score-linked' && clip?.mediaUrl)
                : null;
            if (attachedClip) {
                return {
                    mode: 'recorded',
                    isRecordedReplay: false,
                    isAttachedClip: true,
                    hasVideo: true,
                    sourceUrl: attachedClip.mediaUrl,
                    publicUrl: attachedClip.mediaUrl,
                    replayState: null
                };
            }
            return { mode: 'none', hasVideo: false, replayState: { status: 'unavailable', title: 'Replay unavailable' } };
        }

        export function hasCompletedReplayLifecycle() { return true; }
    `;

    await page.route(/\/js\/db\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: dbModule }));
    await page.route(/\/js\/firebase\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseModule }));
    await page.route(/\/js\/utils\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: utilsModule }));
    await page.route(/\/js\/auth\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: authModule }));
    await page.route(/\/js\/team-admin-banner\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: bannerModule }));
    await page.route(/\/js\/post-game-insights\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: insightsModule }));
    await page.route(/\/js\/live-game-state\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: liveGameStateModule }));
    await page.route(/\/js\/live-game-video\.js\?v=\d+$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: liveGameVideoModule }));
}

async function readStore(page) {
    return page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
}

test('completed-game stat editor saves corrections and DNP state through real controls', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await installMocks(page, createScenario());

    await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => pageErrors).toEqual([]);

    await page.locator('#share-report-btn').click();
    await expect.poll(() => page.evaluate(() => window.__GAME_SHARE_PAYLOADS__?.[0]?.url)).toBe(
        'https://share.allplays.ai/report?teamId=team-1&gameId=game-1'
    );

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
    expect(pageErrors).toEqual([]);
});

test('late authentication refreshes manager controls and private edit data without duplicating report rows', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await installMocks(page, createScenario(), { delayedAuth: true });

    await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => pageErrors).toEqual([]);

    const publicRows = page.locator('#stats-body tr');
    await expect(publicRows).toHaveCount(2, { timeout: 5000 });
    await expect(publicRows.first()).toContainText('Ava Cole');
    await expect(page.locator('#summary-admin')).toBeHidden();
    await expect(page.locator('#stat-sheet-admin')).toBeHidden();
    await expect(page.locator('#edit-stats-btn')).toBeHidden();
    await expect(page.locator('#edit-team-stats-btn')).toBeHidden();
    await expect(page.locator('#stats-header-row')).not.toContainText('EFFORT');

    const publicShape = await page.evaluate(() => ({
        playerHeaders: document.querySelectorAll('#stats-header-row th').length,
        playerRows: document.querySelectorAll('#stats-body tr').length,
        opponentHeaders: document.querySelectorAll('#opponent-stats-header-row th').length,
        opponentRows: document.querySelectorAll('#opponent-stats-body tr').length
    }));

    await expect(page.locator('#summary-admin')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('#stat-sheet-admin')).toBeVisible();
    await expect(page.locator('#edit-stats-btn')).toBeVisible();
    await expect(page.locator('#edit-team-stats-btn')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__GAME_AUTH_EVENTS__)).toEqual(['pending', 'authenticated']);

    await page.locator('#edit-stats-btn').click();
    await expect(page.locator('#stats-editor-panel')).toBeVisible();
    await expect(page.locator('[data-stat-field="effort"]')).toHaveValue('7');
    await expect(page.locator('#stats-header-row')).not.toContainText('EFFORT');

    await expect.poll(() => page.evaluate(() => ({
        playerHeaders: document.querySelectorAll('#stats-header-row th').length,
        playerRows: document.querySelectorAll('#stats-body tr').length,
        opponentHeaders: document.querySelectorAll('#opponent-stats-header-row th').length,
        opponentRows: document.querySelectorAll('#opponent-stats-body tr').length
    }))).toEqual(publicShape);
    expect(pageErrors).toEqual([]);
});

test('completed-game manager links, replaces, and removes a YouTube replay', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('dialog', async (dialog) => dialog.accept());
    await page.setViewportSize({ width: 390, height: 844 });
    const scenario = createScenario();
    scenario.game.liveStatus = 'scheduled';
    scenario.game.recordedVideo = { url: 'https://cdn.example/older-replay.mp4' };
    scenario.game.replayVideoPublicUrl = 'https://video.example/older-replay';
    scenario.game.videoUrl = 'https://youtu.be/PK1HyC37doc';
    await installMocks(page, scenario);

    await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => pageErrors).toEqual([]);

    const replayAdmin = page.locator('#replay-video-admin');
    const replayAction = page.locator('#replay-report-action');
    await expect(replayAdmin).toBeVisible();
    await expect(page.locator('#replay-video-current')).toContainText('A non-YouTube replay is attached');
    await expect(replayAction).toContainText('Replay Unavailable');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.locator('#replay-video-url').fill('https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ');
    await page.locator('#replay-video-save').click();
    await expect(page.locator('#replay-video-status')).toContainText('Paste a valid YouTube video link');

    await page.locator('#replay-video-url').fill('https://www.youtube.com/watch?v=0IuY8Oryi1k&t=90');
    await page.locator('#replay-video-title').fill('Vipers vs Captains replay');
    await page.locator('#replay-video-save').click();
    await expect(page.locator('#replay-video-status')).toContainText('Replay linked');
    await expect(replayAction.getByRole('link', { name: 'Watch Replay' })).toBeVisible();

    let store = await readStore(page);
    expect(store.game.replayVideo).toMatchObject({
        provider: 'youtube',
        videoId: '0IuY8Oryi1k',
        embedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
        publicUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k',
        title: 'Vipers vs Captains replay',
        status: 'ready',
        linkedBy: 'coach-1'
    });
    expect(store.game.recordedVideo).toBeUndefined();
    expect(store.game.replayVideoPublicUrl).toBeUndefined();
    expect(store.game.videoUrl).toBe('https://youtu.be/PK1HyC37doc');

    await page.locator('#replay-video-url').fill('https://youtu.be/dQw4w9WgXcQ?si=replacement');
    await page.locator('#replay-video-title').fill('Replacement replay');
    await page.locator('#replay-video-save').click();
    await expect(page.locator('#replay-video-status')).toContainText('Replay linked');

    store = await readStore(page);
    expect(store.game.replayVideo).toMatchObject({
        provider: 'youtube',
        videoId: 'dQw4w9WgXcQ',
        publicUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Replacement replay',
        status: 'ready'
    });

    await page.locator('#replay-video-remove').click();
    await expect(page.locator('#replay-video-status')).toContainText('Replay removed');
    await expect(replayAction).toContainText('Replay Unavailable');

    store = await readStore(page);
    expect(store.game.replayVideo).toBeNull();
    expect(store.game.recordedVideo).toBeUndefined();
    expect(store.game.replayVideoPublicUrl).toBeUndefined();
    expect(store.game.videoUrl).toBe('https://youtu.be/PK1HyC37doc');
    expect(store.game.replayVideoFallbackDisabled).toBe(true);

    // A second write without refreshing must use the retained videoUrl and
    // tombstone in its CAS state, then clear only the tombstone on relink.
    await page.locator('#replay-video-url').fill('https://youtu.be/PK1HyC37doc');
    await page.locator('#replay-video-title').fill('Relinked replay');
    await page.locator('#replay-video-save').click();
    await expect(page.locator('#replay-video-status')).toContainText('Replay linked');
    store = await readStore(page);
    expect(store.game.replayVideo).toMatchObject({
        videoId: 'PK1HyC37doc',
        title: 'Relinked replay',
        status: 'ready'
    });
    expect(store.game.videoUrl).toBe('https://youtu.be/PK1HyC37doc');
    expect(store.game.replayVideoFallbackDisabled).toBeUndefined();
    expect(pageErrors).toEqual([]);
});

test('completed statsheet game with only an attached clip does not advertise a full replay', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const scenario = createScenario();
    scenario.game.liveStatus = 'scheduled';
    scenario.game.highlightClips = [{
        type: 'score-linked',
        title: 'Putback clip',
        mediaUrl: 'https://cdn.example.com/putback.mp4'
    }];
    await installMocks(page, scenario);

    await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => pageErrors).toEqual([]);

    const replayAction = page.locator('#replay-report-action');
    await expect(replayAction.getByRole('link', { name: 'Watch Replay' })).toHaveCount(0);
    await expect(replayAction).toContainText('Replay Unavailable');
    expect(pageErrors).toEqual([]);
});

test('manager can remove an existing replay after a final game is corrected to non-final', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('dialog', async (dialog) => dialog.accept());
    const scenario = createScenario();
    scenario.game.status = 'scheduled';
    scenario.game.liveStatus = 'scheduled';
    scenario.game.replayVideo = {
        provider: 'youtube',
        videoId: '0IuY8Oryi1k',
        embedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
        publicUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k',
        title: 'Correction cleanup replay',
        status: 'ready',
        linkedBy: 'coach-1',
        linkedAt: '2026-09-01T12:00:00.000Z'
    };
    await installMocks(page, scenario);

    await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => pageErrors).toEqual([]);

    await expect(page.locator('#replay-video-admin')).toBeVisible();
    await expect(page.locator('#replay-video-link-fields')).toBeHidden();
    await expect(page.locator('#replay-video-save')).toBeHidden();
    await expect(page.locator('#replay-video-remove')).toBeVisible();
    await expect(page.locator('#replay-video-help')).toContainText('no longer final');

    await page.locator('#replay-video-remove').click();
    await expect(page.locator('#replay-video-status')).toContainText('Replay removed');
    await expect(page.locator('#replay-video-admin')).toBeVisible();
    await expect(page.locator('#replay-video-status')).toBeVisible();
    await expect(page.locator('#replay-video-heading')).toBeFocused();

    const store = await readStore(page);
    expect(store.game.replayVideo).toBeNull();
    expect(pageErrors).toEqual([]);
});

test('delegated full manager can remove a stale replay when direct team access is unavailable', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('dialog', async (dialog) => dialog.accept());
    const scenario = createScenario();
    scenario.game.status = 'scheduled';
    scenario.game.liveStatus = 'scheduled';
    scenario.game.replayVideo = {
        provider: 'youtube',
        videoId: '0IuY8Oryi1k',
        embedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
        publicUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k',
        status: 'ready',
        linkedBy: 'coach-1',
        linkedAt: '2026-09-01T12:00:00.000Z'
    };
    scenario.delegatedTeam = {
        id: 'team-1',
        name: 'Comets',
        isDelegatedTeamContext: true,
        delegatedAccess: { full: true },
        teamPermissions: {
            videography: { mode: 'selected', memberIds: ['coach-1'] }
        }
    };
    await installMocks(page, scenario, { accessLevel: 'videographer', directAccess: false });

    await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => pageErrors).toEqual([]);
    await expect(page.locator('#replay-video-remove')).toBeVisible();

    await page.locator('#replay-video-remove').click();
    await expect(page.locator('#replay-video-status')).toContainText('Replay removed');

    const store = await readStore(page);
    expect(store.game.replayVideo).toBeNull();
    expect(pageErrors).toEqual([]);
});

test('replay transaction rejects a game that became a shared-schedule mirror after load', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await installMocks(page, createScenario());

    await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => pageErrors).toEqual([]);
    await expect(page.locator('#replay-video-admin')).toBeVisible();

    await page.evaluate((storeKey) => {
        const store = JSON.parse(localStorage.getItem(storeKey) || '{}');
        store.game.sharedScheduleId = 'shared_team-1_game-1';
        store.game.sharedScheduleOpponentTeamId = 'team-2';
        store.game.sharedScheduleOpponentGameId = 'game-2';
        localStorage.setItem(storeKey, JSON.stringify(store));
    }, STORE_KEY);

    await page.locator('#replay-video-url').fill('https://youtu.be/0IuY8Oryi1k');
    await page.locator('#replay-video-save').click();
    await expect(page.locator('#replay-video-status')).toContainText('now part of a shared schedule');

    const store = await readStore(page);
    expect(store.game.replayVideo).toBeUndefined();
    expect(pageErrors).toEqual([]);
});

test('legacy replay controls fail closed for a retained videographer ID when the mode is disabled', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const scenario = createScenario();
    scenario.team.teamPermissions = {
        videography: { mode: 'disabled', memberIds: ['coach-1'] }
    };
    await installMocks(page, scenario, { accessLevel: 'videographer' });

    await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => pageErrors).toEqual([]);
    await expect(page.locator('#replay-video-admin')).toBeHidden();
});

test('legacy replay controls do not offer a write for noncanonical uppercase lifecycle values', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const scenario = createScenario();
    scenario.game.status = 'FINAL';
    scenario.game.liveStatus = 'FINAL';
    await installMocks(page, scenario);

    await page.goto(`${baseURL}/game.html#teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => pageErrors).toEqual([]);
    await expect(page.locator('#replay-video-admin')).toBeHidden();
});
