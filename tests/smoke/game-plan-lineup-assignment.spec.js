import { test, expect } from '@playwright/test';

import { buildUrl } from './helpers/boot-path.js';

const STORE_KEY = '__gamePlanLineupSmokeStore';

function createScenario(overrides = {}) {
    return {
        team: {
            id: 'team-1',
            name: 'Comets',
            sport: 'Basketball',
            ownerId: 'coach-1'
        },
        game: {
            id: 'game-1',
            opponent: 'Rockets',
            date: '2026-08-01T15:00:00.000Z',
            status: 'scheduled',
            gamePlan: {
                formationId: 'basketball-5v5',
                numPeriods: 4,
                periodDuration: 8,
                subTimes: [4],
                lineups: {}
            }
        },
        players: [
            { id: 'p1', name: 'Ava Cole', number: '3' },
            { id: 'p2', name: 'Mia Diaz', number: '5' },
            { id: 'p3', name: 'Zoe Quinn', number: '8' }
        ],
        updateCalls: [],
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

        export async function getTeam() {
            return clone(loadStore().team);
        }

        export async function getPlayers() {
            return clone(loadStore().players || []);
        }

        export async function getGames() {
            return [clone(loadStore().game)];
        }

        export async function getGame() {
            return clone(loadStore().game);
        }

        export async function getEvents() {
            return [clone(loadStore().game)];
        }

        export async function getTrackedCalendarEventUids() {
            return [];
        }

        export async function updateGame(_teamId, _gameId, patch) {
            const store = loadStore();
            store.game = { ...(store.game || {}), ...clone(patch) };
            store.updateCalls = store.updateCalls || [];
            store.updateCalls.push(clone(patch));
            saveStore(store);
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
            return new Date(value).toISOString().slice(0, 10);
        }

        export function formatTime(value) {
            return new Date(value).toISOString().slice(11, 16);
        }

        export async function fetchAndParseCalendar() {
            return [];
        }

        export function extractOpponent(summary) {
            return summary || '';
        }

        export function isPracticeEvent() {
            return false;
        }

        export function isTrackedCalendarEvent() {
            return false;
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

    const teamAccessModule = `
        export function getTeamAccessInfo() {
            return {
                hasAccess: true,
                accessLevel: 'full',
                exitUrl: 'team.html'
            };
        }
    `;

    await page.route(/\/js\/db\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: dbModule });
    });

    await page.route(/\/js\/utils\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: utilsModule });
    });

    await page.route(/\/js\/auth\.js\?v=\d+$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: authModule });
    });

    await page.route(/\/js\/team-access\.js$/, async (route) => {
        await route.fulfill({ status: 200, contentType: 'application/javascript', body: teamAccessModule });
    });
}

async function seedScenario(page, baseURL, scenario = createScenario()) {
    await page.goto(buildUrl(baseURL, '/game-plan.html'), {
        waitUntil: 'domcontentloaded'
    });
    await page.evaluate(({ storeKey, value }) => {
        localStorage.setItem(storeKey, JSON.stringify(value));
    }, { storeKey: STORE_KEY, value: scenario });
}

async function openPlanner(page, baseURL) {
    await page.goto(buildUrl(baseURL, '/game-plan.html#teamId=team-1'), {
        waitUntil: 'domcontentloaded'
    });

    await page.locator('#game-selector').selectOption('game-1');
    await expect(page.locator('#step-lineup')).toBeVisible();
    await expect(page.locator('#player-pool .player-card')).toHaveCount(3);
}

async function dragAndDrop(page, sourceSelector, targetSelector) {
    await page.evaluate(({ sourceSelector, targetSelector }) => {
        const source = document.querySelector(sourceSelector);
        const target = document.querySelector(targetSelector);
        if (!source || !target) {
            throw new Error(`Missing drag source or target: ${sourceSelector} -> ${targetSelector}`);
        }

        const dataTransfer = new DataTransfer();
        source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
        source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer }));
    }, { sourceSelector, targetSelector });
}

async function getStore(page) {
    return page.evaluate((storeKey) => {
        try {
            return JSON.parse(localStorage.getItem(storeKey) || '{}');
        } catch (error) {
            return {};
        }
    }, STORE_KEY);
}

test.beforeEach(async ({ page }) => {
    await installModuleMocks(page);
});

test('assigns a player, updates bench and summary, and blocks duplicate same-interval drops', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL);
    await openPlanner(page, baseURL);

    const firstCell = '.sub-cell[data-cell-key="1-4-pg"]';
    const duplicateCell = '.sub-cell[data-cell-key="1-4-sg"]';

    await expect(page.locator('#bench-1-4')).toContainText('Ava Cole');
    await dragAndDrop(page, '#player-pool .player-card[data-player-id="p1"]', firstCell);

    await expect(page.locator(`${firstCell} .player-chip[data-player-id="p1"]`)).toContainText('Ava Cole');
    await expect(page.locator('#bench-1-4')).not.toContainText('Ava Cole');
    await expect(page.locator('#bench-1-8')).toContainText('Ava Cole');
    await expect(page.locator('#playing-time-summary')).toContainText('Ava Cole');
    await expect(page.locator('#playing-time-summary')).toContainText('4');

    await expect.poll(async () => {
        const store = await getStore(page);
        return store.updateCalls?.at(-1)?.gamePlan?.lineups || {};
    }, { timeout: 2500 }).toEqual({ '1-4-pg': 'p1' });

    await dragAndDrop(page, '#player-pool .player-card[data-player-id="p1"]', duplicateCell);

    await expect(page.locator(`${firstCell} .player-chip[data-player-id="p1"]`)).toHaveCount(1);
    await expect(page.locator(`${duplicateCell} .player-chip[data-player-id="p1"]`)).toHaveCount(0);

    const savedState = await getStore(page);
    expect(savedState.alerts).toContain('That player is already in this column. Use another player or clear first.');
    expect(savedState.updateCalls?.at(-1)?.gamePlan?.lineups).toEqual({ '1-4-pg': 'p1' });
});

test('moves an assigned chip within the same interval without duplicating the player', async ({ page, baseURL }) => {
    await seedScenario(page, baseURL);
    await openPlanner(page, baseURL);

    await dragAndDrop(page, '#player-pool .player-card[data-player-id="p1"]', '.sub-cell[data-cell-key="1-4-pg"]');
    await expect.poll(async () => (await getStore(page)).updateCalls?.length || 0, { timeout: 2500 }).toBeGreaterThan(0);

    await dragAndDrop(
        page,
        '.sub-cell[data-cell-key="1-4-pg"] .player-chip[data-player-id="p1"]',
        '.sub-cell[data-cell-key="1-4-sg"]'
    );

    await expect(page.locator('.sub-cell[data-interval="1-4"] .player-chip[data-player-id="p1"]')).toHaveCount(1);
    await expect(page.locator('.sub-cell[data-cell-key="1-4-pg"] .player-chip[data-player-id="p1"]')).toHaveCount(0);
    await expect(page.locator('.sub-cell[data-cell-key="1-4-sg"] .player-chip[data-player-id="p1"]')).toHaveCount(1);

    await expect.poll(async () => {
        const store = await getStore(page);
        return store.updateCalls?.at(-1)?.gamePlan?.lineups || {};
    }, { timeout: 2500 }).toEqual({ '1-4-sg': 'p1' });
});
