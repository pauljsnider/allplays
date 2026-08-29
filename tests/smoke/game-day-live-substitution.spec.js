import { test, expect } from '@playwright/test';

import { buildUrl } from './helpers/boot-path.js';

const STORE_KEY = '__gameDayLiveSubstitutionStore';

function createScenario(overrides = {}) {
    return {
        team: {
            id: 'team-1',
            name: 'Comets',
            sport: 'Soccer',
            ownerId: 'coach-1',
            adminEmails: ['coach@example.com']
        },
        game: {
            id: 'game-1',
            opponent: 'Rockets',
            date: '2026-04-14T19:00:00.000Z',
            status: 'live',
            liveStatus: 'live',
            gamePlan: {
                formationId: 'soccer-9v9',
                numPeriods: 2,
                isPublished: true,
                lineups: {
                    'H1-keeper': 'p1',
                    'H1-striker': 'p2'
                },
                publishedLineups: {
                    'H1-keeper': 'p1',
                    'H1-striker': 'p2'
                }
            }
        },
        players: [
            { id: 'p1', name: 'Avery Lee', number: '1' },
            { id: 'p2', name: 'Blake Stone', number: '9' },
            { id: 'p3', name: 'Casey Vale', number: '14' }
        ],
        configs: [],
        user: {
            uid: 'coach-1',
            email: 'coach@example.com'
        },
        coachesOnlyNote: {
            text: 'Force play toward the sideline.',
            updatedAt: '2026-04-14T18:00:00.000Z',
            updatedBy: 'coach-1'
        },
        coachesOnlyNoteReadCalls: 0,
        coachesOnlyNoteWriteCalls: [],
        teamContextCalls: [],
        updateCalls: [],
        ...overrides
    };
}

async function installModuleMocks(page) {
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

        export async function getGameDayTeamContext(teamId, gameId = null) {
            const store = loadStore();
            store.teamContextCalls = store.teamContextCalls || [];
            store.teamContextCalls.push({ teamId, gameId });
            saveStore(store);
            return clone(store.team);
        }

        export async function getGame() {
            return clone(loadStore().game);
        }

        export async function getPlayers() {
            return clone(loadStore().players || []);
        }

        export async function getGames() {
            return [clone(loadStore().game)];
        }

        export async function getConfigs() {
            return clone(loadStore().configs || []);
        }

        export async function getMyRsvp() {
            return null;
        }

        export async function getRsvpBreakdownByPlayer() {
            return {};
        }

        export async function getAggregatedStatsForGames() {
            return {};
        }

        export async function updateGame(teamId, gameId, patch) {
            const store = loadStore();
            const clonedPatch = clone(patch);
            store.game = { ...(store.game || {}), ...clonedPatch };
            store.updateCalls = store.updateCalls || [];
            store.updateCalls.push({ teamId, gameId, patch: clonedPatch });
            saveStore(store);
        }

        export async function logStatEvent() {
            return null;
        }

        export async function updatePlayerStats() {
            return null;
        }

        export async function broadcastLiveEvent() {
            return null;
        }

        export function subscribeGame(_teamId, _gameId, callback) {
            callback(clone(loadStore().game));
            return () => {};
        }

        export function subscribeLiveEvents(_teamId, _gameId, callback) {
            callback([]);
            return () => {};
        }

        export function subscribeAggregatedStats(_teamId, _gameId, callback) {
            callback({});
            return () => {};
        }

        export async function setGameLiveStatus() {
            return null;
        }

        export async function submitRsvpForPlayer() {
            return null;
        }

        export async function postChatMessage() {
            return null;
        }
    `;

    const utilsModule = `
        export function renderHeader(container) {
            if (container) container.innerHTML = '<div data-test-id="mock-header"></div>';
        }

        export function renderFooter(container) {
            if (container) container.innerHTML = '<div data-test-id="mock-footer"></div>';
        }

        export function getUrlParams() {
            const raw = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.search.slice(1);
            return Object.fromEntries(new URLSearchParams(raw));
        }

        export function formatDate(value) {
            return String(value || '').slice(0, 10);
        }

        export function formatTime(value) {
            return String(value || '').slice(11, 16);
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
        const STORE_KEY = ${JSON.stringify(STORE_KEY)};

        export function checkAuth(callback) {
            const store = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
            callback(store.user || null);
        }
    `;

    const teamAdminBannerModule = `
        export function renderTeamAdminBanner(container) {
            if (container) container.innerHTML = '<div data-test-id="mock-team-banner"></div>';
        }

        export function getTeamAccessInfo() {
            return { hasAccess: true, accessLevel: 'full', exitUrl: 'team.html' };
        }
    `;

    const firebaseAppModule = `
        export function getApp() {
            return {};
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

    const firebaseModule = `
        const STORE_KEY = ${JSON.stringify(STORE_KEY)};
        export const db = {};

        function loadStore() {
            return JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
        }

        function saveStore(store) {
            localStorage.setItem(STORE_KEY, JSON.stringify(store));
        }

        export function doc(_db, ...segments) {
            return { path: segments.join('/') };
        }

        export async function getDoc(reference) {
            const store = loadStore();
            store.coachesOnlyNoteReadCalls = (store.coachesOnlyNoteReadCalls || 0) + 1;
            saveStore(store);
            if (store.coachesOnlyNoteLoadError) throw new Error('Private note read failed');
            const note = store.coachesOnlyNote;
            return {
                exists() { return !!note; },
                data() { return note ? JSON.parse(JSON.stringify(note)) : undefined; },
                ref: reference
            };
        }

        export async function setDoc(reference, payload) {
            const store = loadStore();
            if (store.coachesOnlyNoteSaveError) throw new Error('Private note save failed');
            const saved = {
                ...payload,
                updatedAt: new Date().toISOString()
            };
            store.coachesOnlyNote = saved;
            store.coachesOnlyNoteWriteCalls = store.coachesOnlyNoteWriteCalls || [];
            store.coachesOnlyNoteWriteCalls.push({ path: reference.path, payload: saved });
            saveStore(store);
        }

        export function serverTimestamp() {
            return { type: 'server-timestamp' };
        }
    `;

    await page.route(/^https:\/\/cdn\.tailwindcss\.com(?:\/.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.tailwind = window.tailwind || {};'
    }));

    await page.route(/\/js\/telemetry\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));

    await page.route(/\/js\/db\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dbModule
    }));

    await page.route(/\/js\/utils\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: utilsModule
    }));

    await page.route(/\/js\/auth\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: authModule
    }));

    await page.route(/\/js\/firebase\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: firebaseModule
    }));

    await page.route(/\/js\/vendor\/firebase-firestore\.js$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: firebaseModule.replace('export async function getDoc(', 'export async function getDocFromServer(')
    }));

    await page.route(/\/js\/team-admin-banner\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: teamAdminBannerModule
    }));

    await page.route(/\/js\/vendor\/firebase-app\.js$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: firebaseAppModule
    }));

    await page.route(/\/js\/vendor\/firebase-ai\.js$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: firebaseAiModule
    }));
}

async function seedScenario(page, baseURL, scenario = createScenario()) {
    await page.goto(buildUrl(baseURL, '/game-day.html'), {
        waitUntil: 'domcontentloaded'
    });
    await page.evaluate(({ storeKey, value }) => {
        localStorage.removeItem(storeKey);
        localStorage.setItem(storeKey, JSON.stringify(value));
    }, { storeKey: STORE_KEY, value: scenario });
}

async function openGameDay(page, baseURL, gameId = 'game-1') {
    await page.goto(buildUrl(baseURL, `/game-day.html?teamId=team-1&gameId=${encodeURIComponent(gameId)}`), {
        waitUntil: 'domcontentloaded'
    });
    await expect(page.locator('#game-day-view')).toBeVisible();
    await expect(page.locator('#sub-out-select')).toBeVisible();
}

async function getStore(page) {
    return page.evaluate((storeKey) => {
        return JSON.parse(localStorage.getItem(storeKey) || '{}');
    }, STORE_KEY);
}

test.beforeEach(async ({ page }) => {
    await installModuleMocks(page);
});

test('applies a live Game Day substitution through the browser controls', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL);
    await openGameDay(page, baseURL);

    await expect(page.locator('#sub-out-select')).toContainText('Avery Lee');
    await expect(page.locator('#sub-out-select')).toContainText('Blake Stone');
    await expect(page.locator('#sub-in-select')).toContainText('Casey Vale');
    await expect(page.locator('#sub-in-select')).not.toContainText('Blake Stone');

    await expect(page.locator('#field-diagram-container .field-player', { hasText: 'Blake' })).toHaveCount(1);
    await expect(page.locator('#bench-on-field')).toContainText('Casey Vale');

    await page.locator('#sub-out-select').selectOption('p2');
    await page.locator('#sub-in-select').selectOption('p3');
    await page.getByRole('button', { name: 'Apply Sub' }).click();

    await expect.poll(async () => {
        const store = await getStore(page);
        return store.updateCalls?.length || 0;
    }, { timeout: 2500 }).toBeGreaterThanOrEqual(2);

    const store = await getStore(page);
    const rotationCall = store.updateCalls.find((call) => call.patch?.rotationActual);
    expect(rotationCall).toBeDefined();
    expect(rotationCall).toMatchObject({
        teamId: 'team-1',
        gameId: 'game-1',
        patch: {
            rotationPlan: {
                H1: {
                    keeper: 'p1',
                    striker: 'p3'
                }
            }
        }
    });

    const substitutionRows = Object.values(rotationCall.patch.rotationActual.H1).flat();
    expect(substitutionRows).toHaveLength(1);
    expect(substitutionRows[0]).toMatchObject({
        position: 'striker',
        out: 'Blake Stone',
        outId: 'p2',
        outPlayerId: 'p2',
        in: 'Casey Vale',
        inId: 'p3',
        inPlayerId: 'p3'
    });
    expect(substitutionRows[0].appliedAt).toEqual(expect.any(String));

    const coachingCall = store.updateCalls.find((call) => call.patch?.coachingNotes);
    expect(coachingCall).toBeDefined();
    expect(coachingCall.patch.coachingNotes.at(-1)).toMatchObject({
        text: 'Sub: Blake Stone → Casey Vale',
        type: 'substitution',
        period: 'H1'
    });

    await expect(page.locator('#field-diagram-container .field-player', { hasText: 'Casey' })).toHaveCount(1);
    await expect(page.locator('#bench-on-field')).toContainText('Blake Stone');
    await expect(page.locator('#bench-on-field')).not.toContainText('Casey Vale');
    await expect(page.locator('#sub-out-select')).toContainText('Casey Vale');
    await expect(page.locator('#sub-in-select')).toContainText('Blake Stone');
    await expect(page.locator('#coaching-log-list')).toContainText('Sub: Blake Stone → Casey Vale');
});

test('loads, saves, and reloads a manager-only game note', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await seedScenario(page, baseURL);
    await openGameDay(page, baseURL);

    expect(pageErrors).toEqual([]);
    const panel = page.locator('#coaches-only-note-panel');
    const input = page.locator('#coaches-only-note-input');
    await expect(panel).toBeVisible();
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('Force play toward the sideline.');

    await input.fill('Press after every backward pass.');
    await page.getByRole('button', { name: 'Save private note' }).click();
    await expect(page.locator('#coaches-only-note-status')).toHaveText('Private note saved.');

    let store = await getStore(page);
    expect(store.coachesOnlyNoteWriteCalls).toEqual([
        expect.objectContaining({
            path: 'teams/team-1/games/game-1/coachNotes/main',
            payload: expect.objectContaining({
                text: 'Press after every backward pass.',
                updatedBy: 'coach-1'
            })
        })
    ]);

    await page.reload({ waitUntil: 'domcontentloaded' });
    expect(pageErrors).toEqual([]);
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('Press after every backward pass.');
    store = await getStore(page);
    expect(store.coachesOnlyNoteReadCalls).toBeGreaterThanOrEqual(2);
});

test('boots an encoded shared game and stores its team-private note beneath the physical shared game', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const sharedGamePath = 'organizations/org-1/sharedGames/shared-game-1';
    const sharedGameId = `shared_${encodeURIComponent(sharedGamePath)}`;
    await seedScenario(page, baseURL, createScenario({
        game: {
            ...createScenario().game,
            id: sharedGameId,
            sharedGamePath,
            _sharedGamePath: sharedGamePath
        }
    }));
    await openGameDay(page, baseURL, sharedGameId);

    expect(pageErrors).toEqual([]);
    const input = page.locator('#coaches-only-note-input');
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('Force play toward the sideline.');
    await input.fill('Shared-game private plan.');
    await page.getByRole('button', { name: 'Save private note' }).click();
    await expect(page.locator('#coaches-only-note-status')).toHaveText('Private note saved.');

    const store = await getStore(page);
    expect(store.teamContextCalls).toEqual([
        { teamId: 'team-1', gameId: null }
    ]);
    expect(store.coachesOnlyNoteWriteCalls).toEqual([
        expect.objectContaining({
            path: `${sharedGamePath}/coachNotes/team-1`,
            payload: expect.objectContaining({
                text: 'Shared-game private plan.',
                updatedBy: 'coach-1'
            })
        })
    ]);
    expect(pageErrors).toEqual([]);
});

test('fails closed on a private-note read error and hydrates only after Retry succeeds', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await seedScenario(page, baseURL, createScenario({ coachesOnlyNoteLoadError: true }));
    await openGameDay(page, baseURL);

    expect(pageErrors).toEqual([]);
    const input = page.locator('#coaches-only-note-input');
    await expect(input).toBeDisabled();
    await expect(page.locator('#coaches-only-note-status')).toContainText('Editing is disabled');

    await page.evaluate((storeKey) => {
        const store = JSON.parse(localStorage.getItem(storeKey) || '{}');
        store.coachesOnlyNoteLoadError = false;
        store.coachesOnlyNote = {
            text: 'Recovered private note',
            updatedAt: new Date().toISOString(),
            updatedBy: 'coach-1'
        };
        localStorage.setItem(storeKey, JSON.stringify(store));
    }, STORE_KEY);
    await page.getByRole('button', { name: 'Retry' }).click();

    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('Recovered private note');
    expect(pageErrors).toEqual([]);
});

test('preserves the private-note draft when saving fails', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await seedScenario(page, baseURL, createScenario({ coachesOnlyNoteSaveError: true }));
    await openGameDay(page, baseURL);

    expect(pageErrors).toEqual([]);
    const input = page.locator('#coaches-only-note-input');
    await expect(input).toBeEnabled();
    await input.fill('Keep this private draft');
    await page.getByRole('button', { name: 'Save private note' }).click();

    await expect(page.locator('#coaches-only-note-status')).toContainText('Your draft is still here');
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue('Keep this private draft');
    const store = await getStore(page);
    expect(store.coachesOnlyNoteWriteCalls).toEqual([]);
    expect(pageErrors).toEqual([]);
});
