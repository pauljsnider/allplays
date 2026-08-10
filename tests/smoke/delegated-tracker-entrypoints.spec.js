import { test, expect } from '@playwright/test';

const DB_STUB = `
const team = {
    id: 'team-1',
    name: 'Private Comets',
    sport: 'Basketball',
    isPublic: false,
    isDelegatedTeamContext: true,
    delegatedAccess: { full: false, scorekeeping: true, streaming: true },
    teamPermissions: {
        scorekeeping: { mode: 'selected', memberIds: ['helper-1'] },
        streaming: { mode: 'selected', memberIds: ['helper-1'] }
    }
};

export async function getGameDayTeamContext() {
    window.__DELEGATED_TEAM_CONTEXT_COUNT__ = (window.__DELEGATED_TEAM_CONTEXT_COUNT__ || 0) + 1;
    return team;
}
export async function getTeam() {
    window.__CANONICAL_TEAM_READ_COUNT__ = (window.__CANONICAL_TEAM_READ_COUNT__ || 0) + 1;
    throw Object.assign(new Error('Canonical team read denied'), { code: 'permission-denied' });
}
export async function getGame() {
    return {
        id: 'game-1',
        opponent: 'Rockets',
        date: '2026-08-10T19:00:00.000Z',
        status: 'scheduled',
        liveStatus: 'scheduled',
        statTrackerConfigId: 'config-1',
        opponentStats: {}
    };
}
export async function getPlayers() { return [{ id: 'player-1', name: 'Avery', number: '4' }]; }
export async function getConfigs() { return [{ id: 'config-1', name: 'Basketball', baseType: 'Basketball', columns: ['PTS'] }]; }
export async function getMyRsvp() { return null; }
export async function logStatEvent() {}
export async function updatePlayerStats() {}
export async function updateGame() {}
export async function deleteDoc() {}
export async function broadcastLiveEvent() {}
export async function setGameLiveStatus() {}
export async function postLiveChatMessage() {}
export function subscribeLiveChat() { return () => {}; }
export function collection(_db, path) { return { path }; }
export function query(ref) { return ref; }
export async function getDocs() {
    return { docs: [], size: 0, empty: true, forEach() {} };
}
`;

const UTILS_STUB = `
export function renderHeader() {}
export function renderFooter() {}
export function getUrlParams() {
    const raw = window.location.hash.startsWith('#')
        ? window.location.hash.slice(1)
        : window.location.search.slice(1);
    return Object.fromEntries(new URLSearchParams(raw));
}
export function escapeHtml(value) { return String(value ?? ''); }
export function formatDate(value) { return String(value ?? '').slice(0, 10); }
`;

const AUTH_STUB = `
export function checkAuth(callback) {
    callback({ uid: 'helper-1', email: 'helper@example.com' });
}
`;

const FIREBASE_STUB = `
export const db = {};
export function writeBatch() { return { set() {}, update() {}, delete() {}, commit: async () => {} }; }
export function doc(_db, path) { return { path }; }
export async function setDoc() {}
export async function addDoc() { return { id: 'event-1' }; }
export function onSnapshot(_ref, callback) { callback({ docs: [], empty: true, forEach() {} }); return () => {}; }
export function orderBy() { return {}; }
`;

test.beforeEach(async ({ page }) => {
    await page.route('https://cdn.tailwindcss.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.tailwind = window.tailwind || {};'
    }));
    await page.route(/\/js\/db\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: DB_STUB }));
    await page.route(/\/js\/utils\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: UTILS_STUB }));
    await page.route(/\/js\/auth\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: AUTH_STUB }));
    await page.route(/\/js\/firebase\.js(?:\?v=\d+)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_STUB }));
    await page.route(/\/js\/vendor\/firebase-app\.js$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'export function getApp() { return {}; }'
    }));
});

for (const [label, path] of [
    ['standard score sheet', '/track.html#teamId=team-1&gameId=game-1'],
    ['live tracker', '/track-live.html#teamId=team-1&gameId=game-1']
]) {
    test(`delegated helper boots the ${label} without a canonical team read`, async ({ page, baseURL }) => {
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));

        await page.goto(`${baseURL}${path}`, { waitUntil: 'domcontentloaded' });

        await expect(page.locator('#game-title')).toHaveText('vs. Rockets');
        expect(pageErrors).toEqual([]);
        await expect.poll(() => page.evaluate(() => window.__DELEGATED_TEAM_CONTEXT_COUNT__ || 0)).toBe(1);
        await expect.poll(() => page.evaluate(() => window.__CANONICAL_TEAM_READ_COUNT__ || 0)).toBe(0);
    });
}
