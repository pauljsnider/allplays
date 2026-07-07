import { test, expect } from '@playwright/test';

import { buildUrl } from './helpers/boot-path.js';

const STORE_KEY = '__gameDayDelegatedScorekeeperStore';

function createScenario(overrides = {}) {
    return {
        team: {
            id: 'team-1',
            name: 'Comets',
            sport: 'Basketball',
            ownerId: 'coach-1',
            adminEmails: ['coach@example.com'],
            teamPermissions: {
                scorekeeping: {
                    mode: 'selected',
                    memberIds: ['scorekeeper-1']
                }
            }
        },
        game: {
            id: 'game-1',
            opponent: 'Rockets',
            date: '2026-04-03T18:00:00.000Z',
            status: 'scheduled',
            liveStatus: 'scheduled',
            statTrackerConfigId: 'cfg-basketball'
        },
        players: [
            { id: 'p1', name: 'Ava Cole', number: '3' },
            { id: 'p2', name: 'Mia Diaz', number: '5' }
        ],
        configs: [
            {
                id: 'cfg-basketball',
                name: 'Basketball',
                baseType: 'Basketball',
                columns: ['PTS', 'REB', 'AST']
            }
        ],
        user: {
            uid: 'scorekeeper-1',
            email: 'scorekeeper@example.com'
        },
        ...overrides
    };
}

async function installModuleMocks(page) {
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

        export async function updateGame() {
            return null;
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

async function seedScenario(page, baseURL, scenario) {
    await page.goto(buildUrl(baseURL, '/game-day.html'), {
        waitUntil: 'domcontentloaded'
    });
    await page.evaluate(({ storeKey, value }) => {
        localStorage.removeItem(storeKey);
        localStorage.setItem(storeKey, JSON.stringify(value));
    }, { storeKey: STORE_KEY, value: scenario });
}

async function openGameDay(page, baseURL) {
    await page.goto(buildUrl(baseURL, '/game-day.html#teamId=team-1&gameId=game-1'), {
        waitUntil: 'domcontentloaded'
    });
    await expect(page.getByText('Scorekeeping access')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open scorekeeper' })).toBeVisible();
}

async function expectManagementControlsHidden(page) {
    await expect(page.locator('#pre-game-view')).toHaveClass(/hidden/);
    await expect(page.locator('#game-day-view')).toHaveClass(/hidden/);
    await expect(page.locator('#game-subbanner')).toHaveClass(/hidden/);
    await expect(page.locator('a[href^="edit-roster.html"]')).toHaveCount(0);
    await expect(page.locator('a[href^="edit-schedule.html"]')).toHaveCount(0);
    await expect(page.locator('a[href^="edit-team.html"]')).toHaveCount(0);
    await expect(page.locator('a[href^="edit-config.html"]')).toHaveCount(0);
    await expect(page.locator('a[href*="section=staff-permissions"]')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
    await installModuleMocks(page);
});

test('delegated basketball scorekeeper sees limited Game Day access and opens basketball tracker', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL, createScenario());
    await openGameDay(page, baseURL);

    await expect(page.getByText('Roster management, schedule editing, team settings, and other coach/admin controls remain restricted.')).toBeVisible();
    await expectManagementControlsHidden(page);

    await page.getByRole('link', { name: 'Open scorekeeper' }).click();
    await expect(page).toHaveURL(/\/track-basketball\.html#teamId=team-1&gameId=game-1$/);
});

test('delegated non-basketball scorekeeper opens standard tracker', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL, createScenario({
        team: {
            ...createScenario().team,
            sport: 'Volleyball'
        },
        game: {
            ...createScenario().game,
            statTrackerConfigId: 'cfg-volleyball'
        },
        configs: [
            {
                id: 'cfg-volleyball',
                name: 'Volleyball',
                baseType: 'Volleyball',
                columns: ['K', 'A', 'D']
            }
        ]
    }));
    await openGameDay(page, baseURL);

    await expectManagementControlsHidden(page);

    await page.getByRole('link', { name: 'Open scorekeeper' }).click();
    await expect(page).toHaveURL(/\/track\.html#teamId=team-1&gameId=game-1$/);
});
