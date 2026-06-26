import { test, expect } from '@playwright/test';

const STORE_KEY = '__liveTrackerSmokeStore';
const LOCAL_STATE_KEY = 'liveTrackerState:team-1:game-1';

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
            statTrackerConfigId: 'cfg-basketball',
            homeScore: 0,
            awayScore: 0,
            liveHasData: false,
            liveStatus: 'scheduled',
            liveLineup: {
                onCourt: ['p1'],
                bench: ['p2']
            },
            opponentStats: {}
        },
        players: [
            { id: 'p1', name: 'Ava Cole', number: '3' },
            { id: 'p2', name: 'Mia Diaz', number: '5' }
        ],
        config: {
            id: 'cfg-basketball',
            baseType: 'Basketball',
            columns: ['PTS', 'REB', 'AST']
        },
        aggregatedStats: {},
        liveEvents: {},
        confirmResponses: [],
        confirmMessages: [],
        confirmResults: [],
        alerts: [],
        gameStatusUpdates: [],
        ...overrides
    };
}

async function installModuleMocks(page) {
    await page.addInitScript(({ storeKey }) => {
        function loadStore() {
            try {
                return JSON.parse(window.localStorage.getItem(storeKey) || '{}');
            } catch {
                return {};
            }
        }

        function saveStore(store) {
            window.localStorage.setItem(storeKey, JSON.stringify(store));
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

        function livePath(collectionName, docId = '') {
            const suffix = docId ? '/' + docId : '';
            return 'teams/team-1/games/game-1/' + collectionName + suffix;
        }

        function orderedEntries(obj = {}) {
            return Object.entries(obj).sort(([, a], [, b]) => {
                return Number(a?.createdAt || 0) - Number(b?.createdAt || 0);
            });
        }

        export async function getTeam(teamId) {
            const store = loadStore();
            if (teamId === store.team?.id) return clone(store.team);
            if (teamId === store.game?.opponentTeamId) {
                return {
                    id: store.game.opponentTeamId,
                    name: store.game.opponentTeamName || store.game.opponent || 'Opponent',
                    photoUrl: store.game.opponentTeamPhoto || ''
                };
            }
            return null;
        }

        export async function getTeams() {
            return [];
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

        export function collection(_db, path) {
            return { path };
        }

        export function query(ref) {
            return ref;
        }

        export async function getDocs(ref) {
            const store = loadStore();
            const path = String(ref.path || '');
            if (path.endsWith('/aggregatedStats')) {
                return createSnapshot(Object.entries(store.aggregatedStats || {}).map(([id, data]) => [id, data, livePath('aggregatedStats', id)]));
            }
            if (path.endsWith('/liveEvents')) {
                return createSnapshot(orderedEntries(store.liveEvents || {}).map(([id, data]) => [id, data, livePath('liveEvents', id)]));
            }
            if (path.endsWith('/events')) {
                return createSnapshot([]);
            }
            return createSnapshot([]);
        }

        export async function deleteDoc(ref) {
            const store = loadStore();
            const parts = String(ref.path || '').split('/');
            const collectionName = parts[parts.length - 2];
            const docId = parts[parts.length - 1];
            if (collectionName === 'aggregatedStats') {
                delete (store.aggregatedStats || {})[docId];
            }
            if (collectionName === 'liveEvents') {
                delete (store.liveEvents || {})[docId];
            }
            saveStore(store);
        }

        export async function updateGame(_teamId, _gameId, patch) {
            const store = loadStore();
            store.game = { ...(store.game || {}), ...clone(patch) };
            saveStore(store);
        }

        export async function broadcastLiveEvent(_teamId, _gameId, event) {
            const store = loadStore();
            const eventId = event?.eventId || 'live-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            store.liveEvents = store.liveEvents || {};
            store.liveEvents[eventId] = {
                ...clone(event),
                eventId,
                createdAt: Number(event?.createdAt || Date.now())
            };
            saveStore(store);
            return { id: eventId };
        }

        export function subscribeLiveChat() {
            return () => {};
        }

        export async function postLiveChatMessage() {
            return null;
        }

        export async function setGameLiveStatus(_teamId, _gameId, status) {
            const store = loadStore();
            store.game = { ...(store.game || {}), liveStatus: status };
            store.gameStatusUpdates = store.gameStatusUpdates || [];
            store.gameStatusUpdates.push(status);
            saveStore(store);
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

        export const db = {};

        export function doc(_db, ...segments) {
            return { path: segments.filter((segment) => segment != null && segment !== '').join('/') };
        }

        export async function setDoc(ref, data, options = {}) {
            const store = loadStore();
            if (String(ref.path || '').includes('/aggregatedStats/')) {
                const playerId = String(ref.path || '').split('/').pop();
                store.aggregatedStats = store.aggregatedStats || {};
                store.aggregatedStats[playerId] = options.merge
                    ? { ...(store.aggregatedStats[playerId] || {}), ...clone(data) }
                    : clone(data);
            }
            saveStore(store);
        }

        export async function addDoc() {
            return { id: 'doc-' + Date.now() };
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
                delete(ref) {
                    operations.push({ type: 'delete', path: ref.path });
                },
                async commit() {
                    const store = loadStore();
                    store.batchOps = (store.batchOps || []).concat(clone(operations));
                    saveStore(store);
                }
            };
        }

        export function onSnapshot(_ref, callback) {
            const store = loadStore();
            callback({
                docs: [],
                size: 0,
                forEach() {},
                data() {
                    return clone(store.game || {});
                }
            });
            return () => {};
        }

        export function serverTimestamp() {
            return { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0, _methodName: 'serverTimestamp' };
        }
    `;

    const utilsModule = `
        export function getUrlParams() {
            const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '';
            const search = window.location.search.startsWith('?') ? window.location.search.slice(1) : '';
            const raw = hash || search;
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
    `;

    const authModule = `
        export function checkAuth(callback) {
            callback({ uid: 'coach-1', email: 'coach@example.com' });
        }
    `;

    const firebaseAiModule = `
        export class GoogleAIBackend {}
        export function getAI() { return {}; }
        export function getGenerativeModel() {
            return {
                async generateContent() {
                    return { response: { text() { return '{}'; } } };
                }
            };
        }
    `;

    const firebaseAppModule = `
        export function getApp() { return {}; }
    `;

    await page.route(/\/js\/db\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: dbModule });
    });

    await page.route(/\/js\/firebase\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseModule });
    });

    await page.route(/\/js\/utils\.js(?:\?v=\d+)?$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: utilsModule });
    });

    await page.route(/\/js\/auth\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: authModule });
    });

    await page.route(/\/js\/vendor\/firebase-ai\.js$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseAiModule });
    });

    await page.route(/\/js\/vendor\/firebase-app\.js$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseAppModule });
    });
}

async function seedScenario(page, baseURL, scenario) {
    await page.goto(buildUrl(baseURL, '/live-tracker.html'), {
        waitUntil: 'domcontentloaded'
    });
    await page.evaluate(({ storeKey, value }) => {
        localStorage.setItem(storeKey, JSON.stringify(value));
    }, { storeKey: STORE_KEY, value: scenario });
}

async function loadTracker(page, baseURL) {
    await page.goto(buildUrl(baseURL, '/live-tracker.html#teamId=team-1&gameId=game-1'), {
        waitUntil: 'domcontentloaded'
    });
    await expect(page.locator('#score-line')).toContainText('0 — 0');
}

async function readStore(page) {
    return page.evaluate((storeKey) => JSON.parse(localStorage.getItem(storeKey) || '{}'), STORE_KEY);
}

async function setConfirmResponses(page, responses) {
    await page.evaluate(({ storeKey, responses: nextResponses }) => {
        const store = JSON.parse(localStorage.getItem(storeKey) || '{}');
        store.confirmResponses = nextResponses;
        localStorage.setItem(storeKey, JSON.stringify(store));
    }, { storeKey: STORE_KEY, responses });
}

test.beforeEach(async ({ page }) => {
    await installModuleMocks(page);
});

test('adds a home foul through the live tracker and removes it from the log without changing score', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL, createScenario({
        aggregatedStats: {
            p1: {
                playerName: 'Ava Cole',
                playerNumber: '3',
                stats: { pts: 0, reb: 0, ast: 0, fouls: 3 },
                timeMs: 0
            }
        }
    }));

    await loadTracker(page, baseURL);
    await page.locator('#start-stop').click();

    const playerFoulButton = page.locator('#live-players button[data-player="p1"][data-stat="fouls"]');
    await expect(page.locator('#live-players')).toContainText('FLS 3');

    await playerFoulButton.click();
    await expect(page.locator('#live-players')).toContainText(/FLS 4.*⚠️/);

    await playerFoulButton.click();
    await expect(page.locator('#live-players')).toContainText(/FLS 5.*FOULED OUT!/);
    await expect(page.locator('#score-line')).toContainText('0 — 0');

    const foulLog = page.locator('#log-mobile > div').filter({ hasText: '#3 FOULS +1' }).first();
    await foulLog.getByTitle('Remove event').click();

    await expect(page.locator('#live-players')).toContainText(/FLS 4.*⚠️/);
    await expect(page.locator('#live-players')).not.toContainText('FOULED OUT!');
    await expect(page.locator('#score-line')).toContainText('0 — 0');

    await expect.poll(async () => {
        const store = await readStore(page);
        return store.aggregatedStats?.p1?.stats?.fouls;
    }).toBe(4);
});

test('persists an opponent foul across refresh and removes it cleanly after resume', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL, createScenario());
    await loadTracker(page, baseURL);
    await page.locator('#start-stop').click();
    await page.locator('#opponents-tab').click();

    const opponentName = 'Rival Guard';
    const firstOpponentCard = page.locator('#opp-cards-mobile > div').first();
    const nameInput = firstOpponentCard.locator('input[data-opp-edit="opp1"]');
    await nameInput.fill(opponentName);
    await nameInput.blur();
    await firstOpponentCard.locator('button[data-opp="opp1"][data-stat="fouls"]').click();

    await expect(firstOpponentCard).toContainText('FLS 1');
    await expect.poll(async () => {
        const store = await readStore(page);
        return store.game?.opponentStats?.opp1?.fouls;
    }).toBe(1);

    await expect.poll(async () => {
        const store = await readStore(page);
        return Object.values(store.liveEvents || {}).some((event) => event.playerId === 'opp1' && event.statKey === 'fouls' && Number(event.value) === 1);
    }).toBe(true);

    await page.evaluate((key) => localStorage.removeItem(key), LOCAL_STATE_KEY);
    await setConfirmResponses(page, [true]);
    await loadTracker(page, baseURL);

    await page.locator('#opponents-tab').click();
    const resumedOpponentCard = page.locator('#opp-cards-mobile > div').filter({ has: page.locator('input[data-opp-edit="opp1"]') }).first();
    await expect(resumedOpponentCard.locator('input[data-opp-edit="opp1"]')).toHaveValue(opponentName);
    await expect(resumedOpponentCard).toContainText('FLS 1');
    await expect(page.locator('#log-mobile')).toContainText(`Opp ${opponentName} FOULS +1`);

    const resumedOpponentLog = page.locator('#log-mobile > div').filter({ hasText: `Opp ${opponentName} FOULS +1` }).first();
    await resumedOpponentLog.getByTitle('Remove event').click();

    await expect(resumedOpponentCard).toContainText('FLS 0');
    await expect(page.locator('#log-mobile')).not.toContainText(`Opp ${opponentName} FOULS +1`);
    await expect(page.locator('#score-line')).toContainText('0 — 0');

    await expect.poll(async () => {
        const store = await readStore(page);
        return store.game?.opponentStats?.opp1?.fouls;
    }).toBe(0);

    await page.evaluate((key) => localStorage.removeItem(key), LOCAL_STATE_KEY);
    await setConfirmResponses(page, [true]);
    await loadTracker(page, baseURL);
    await page.locator('#opponents-tab').click();

    const refreshedOpponentCard = page.locator('#opp-cards-mobile > div').filter({ has: page.locator('input[data-opp-edit="opp1"]') }).first();
    await expect(refreshedOpponentCard.locator('input[data-opp-edit="opp1"]')).toHaveValue(opponentName);
    await expect(refreshedOpponentCard).toContainText('FLS 0');
    await expect(page.locator('#log-mobile')).not.toContainText(`Opp ${opponentName} FOULS +1`);
});
