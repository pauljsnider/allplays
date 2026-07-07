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

    await page.route('https://cdn.tailwindcss.com/**', (route) => route.fulfill({
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

async function openGameDay(page, baseURL) {
    await page.goto(buildUrl(baseURL, '/game-day.html?teamId=team-1&gameId=game-1'), {
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
