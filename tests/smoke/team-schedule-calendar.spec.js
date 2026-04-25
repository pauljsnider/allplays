import { test, expect } from '@playwright/test';

function buildUrl(baseURL, path) {
    const url = new URL(path, `${baseURL}/`);
    url.searchParams.set('cb', String(Date.now()));
    return url.toString();
}

function makeIso(date) {
    return date.toISOString();
}

function addDays(baseDate, days, hour = 18) {
    const next = new Date(baseDate);
    next.setUTCDate(next.getUTCDate() + days);
    next.setUTCHours(hour, 0, 0, 0);
    return next;
}

function monthDelta(fromDate, toDate) {
    return ((toDate.getUTCFullYear() - fromDate.getUTCFullYear()) * 12)
        + (toDate.getUTCMonth() - fromDate.getUTCMonth());
}

function buildDbStub({ team, games, trackedUids }) {
    return `
const team = ${JSON.stringify(team)};
const games = ${JSON.stringify(games)};
const trackedUids = ${JSON.stringify(trackedUids)};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export async function getTeam(teamId) {
    return { ...clone(team), id: teamId };
}

export async function getPlayers() {
    return [];
}

export async function getGames() {
    return clone(games);
}

export async function getConfigs() {
    return [];
}

export async function getTrackedCalendarEventUids() {
    return clone(trackedUids);
}

export async function getUnreadChatCounts() {
    return {};
}

export async function getUserProfile() {
    return null;
}
`;
}

function buildUtilsStub({ calendarEvents, teamId = 'team-a' }) {
    return `
const calendarEvents = ${JSON.stringify(calendarEvents)};

function toDate(value) {
    return value instanceof Date ? value : new Date(value);
}

export function renderHeader() {}
export function renderFooter() {}

export function getUrlParams() {
    return { teamId: ${JSON.stringify(teamId)} };
}

export function formatDate(value) {
    return toDate(value).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    });
}

export function formatShortDate(value) {
    return formatDate(value);
}

export function formatTime(value) {
    return toDate(value).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit'
    });
}

export async function fetchAndParseCalendar() {
    return calendarEvents.map((event) => ({
        ...event,
        dtstart: new Date(event.dtstart)
    }));
}

export function extractOpponent(summary, teamName = '') {
    const clean = String(summary || '')
        .replace(/\\[CANCELED\\]\\s*/gi, '')
        .replace(/\\s+/g, ' ')
        .trim();

    if (/practice/i.test(clean)) {
        return clean.replace(new RegExp(teamName, 'ig'), '').trim() || 'Practice';
    }

    const withoutTeam = teamName ? clean.replace(new RegExp(teamName, 'ig'), '').trim() : clean;
    const versusMatch = withoutTeam.match(/(?:vs\\.?|v\\.?|@)\\s*(.+)$/i);
    if (versusMatch) {
        return versusMatch[1].trim();
    }

    return withoutTeam || clean || 'Opponent';
}

export function isPracticeEvent(summary) {
    return /practice/i.test(String(summary || ''));
}

export function isTrackedCalendarEvent(event, trackedUids) {
    return Boolean(event?.uid) && Array.isArray(trackedUids) && trackedUids.includes(event.uid);
}

export function escapeHtml(value) {
    return String(value ?? '');
}

export async function shareOrCopy() {}
`;
}

const AUTH_STUB = `
export function checkAuth(callback) {
    callback(null);
}
`;

const LEAGUE_STUB = `
export async function fetchLeagueStandings() {
    return { ok: false, rows: [], match: null };
}
`;

const NATIVE_STUB = `
export function computeNativeStandings() {
    return [];
}
`;

const STAT_STUB = `
export function buildPlayerLeaderboardSnapshot() {
    return null;
}

export function selectAnalyticsConfig() {
    return null;
}
`;

const SEASON_RECORD_STUB = `
function toDate(value) {
    return value?.toDate ? value.toDate() : new Date(value);
}

export function calculateSeasonRecord(games, options = {}) {
    const selectedSeason = String(options.seasonLabel || '');
    const filtered = (Array.isArray(games) ? games : []).filter((game) => {
        const date = toDate(game.date);
        return !selectedSeason || String(date.getUTCFullYear()) === selectedSeason;
    }).filter((game) => game.status === 'completed' && game.type !== 'practice');

    return filtered.reduce((record, game) => {
        if (Number(game.homeScore) > Number(game.awayScore)) {
            record.wins += 1;
        } else if (Number(game.homeScore) < Number(game.awayScore)) {
            record.losses += 1;
        } else {
            record.ties += 1;
        }
        return record;
    }, { wins: 0, losses: 0, ties: 0 });
}

export function listSeasonLabels(games) {
    const labels = Array.from(new Set((Array.isArray(games) ? games : []).map((game) => String(toDate(game.date).getUTCFullYear()))));
    return labels.sort().reverse();
}
`;

const FIREBASE_STUB = `
export const db = {};

export function collection() {
    return {};
}

export async function getDocs() {
    return {
        empty: true,
        docs: [],
        forEach() {}
    };
}
`;

const TEAM_ADMIN_BANNER_STUB = `
export function renderTeamAdminBanner() {}

export function getTeamAccessInfo() {
    return { hasAccess: false };
}
`;

async function mockTeamPageModules(page, scenario) {
    await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));
    await page.route('https://cdn.tailwindcss.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.tailwind = window.tailwind || { config: {} };'
    }));
    await page.route('**/js/db.js?v=15', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: buildDbStub(scenario)
    }));
    await page.route('**/js/utils.js?v=10', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: buildUtilsStub(scenario)
    }));
    await page.route('**/js/league-standings.js?v=1', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: LEAGUE_STUB
    }));
    await page.route('**/js/native-standings.js?v=1', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: NATIVE_STUB
    }));
    await page.route('**/js/stat-leaderboards.js?v=1', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: STAT_STUB
    }));
    await page.route('**/js/season-record.js', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: SEASON_RECORD_STUB
    }));
    await page.route('**/js/auth.js?v=12', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: AUTH_STUB
    }));
    await page.route('**/js/firebase.js?v=10', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: FIREBASE_STUB
    }));
    await page.route('**/js/team-admin-banner.js', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: TEAM_ADMIN_BANNER_STUB
    }));
}

async function gotoCalendarMonth(page, fromDate, targetDate) {
    const delta = monthDelta(fromDate, targetDate);
    if (delta > 0) {
        for (let index = 0; index < delta; index += 1) {
            await page.locator('#schedule-calendar-next').click();
        }
    } else if (delta < 0) {
        for (let index = 0; index < Math.abs(delta); index += 1) {
            await page.locator('#schedule-calendar-prev').click();
        }
    }
}

test('team schedule calendar shows only practices in the dedicated practice filter and modal', async ({ page, baseURL }) => {
    const now = new Date();
    const sharedDate = addDays(now, 7, 18);
    const scenario = {
        team: {
            name: 'Team A',
            sport: 'Soccer',
            calendarUrls: ['https://calendar.test/team-a.ics']
        },
        games: [
            {
                id: 'game-1',
                opponent: 'Rivals FC',
                location: 'Field 1',
                type: 'game',
                status: 'scheduled',
                date: makeIso(sharedDate)
            }
        ],
        trackedUids: [],
        calendarEvents: [
            {
                uid: 'practice-1',
                dtstart: makeIso(new Date(sharedDate.getTime() + (60 * 60 * 1000))),
                summary: 'Team A Practice',
                location: 'Gym 1',
                status: 'CONFIRMED'
            }
        ]
    };

    await mockTeamPageModules(page, scenario);
    await page.goto(buildUrl(baseURL, '/team.html#teamId=team-a'), { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#team-header')).toContainText('Team A');

    await page.locator('#schedule-view-calendar').click();
    await page.locator('#schedule-filter-upcoming-practices').click();
    await gotoCalendarMonth(page, now, sharedDate);

    const dayCell = page.locator(`[data-schedule-day="${sharedDate.getUTCDate()}"]`);
    await expect(dayCell).toContainText('Practice');
    await expect(dayCell).not.toContainText('Rivals FC');

    await dayCell.click();

    await expect(page.locator('#schedule-day-modal')).not.toHaveClass(/hidden/);
    await expect(page.locator('#schedule-day-modal-content')).toContainText('Practice');
    await expect(page.locator('#schedule-day-modal-content')).toContainText('Gym 1');
    await expect(page.locator('#schedule-day-modal-content')).not.toContainText('Rivals FC');
});

test('team schedule keeps tracked duplicates and cancelled items out of the wrong filter buckets', async ({ page, baseURL }) => {
    const now = new Date();
    const completedDate = addDays(now, -5, 18);
    const upcomingDate = addDays(now, 5, 18);
    const cancelledDate = addDays(now, 6, 18);
    const scenario = {
        team: {
            name: 'Team A',
            sport: 'Soccer',
            calendarUrls: ['https://calendar.test/team-a.ics']
        },
        games: [
            {
                id: 'completed-1',
                opponent: 'Falcons',
                location: 'Stadium 1',
                type: 'game',
                status: 'completed',
                homeScore: 3,
                awayScore: 1,
                date: makeIso(completedDate)
            }
        ],
        trackedUids: ['tracked-uid-1'],
        calendarEvents: [
            {
                uid: 'tracked-uid-1',
                dtstart: makeIso(addDays(now, 4, 18)),
                summary: 'Team A vs Duplicate FC',
                location: 'Hidden Field',
                status: 'CONFIRMED'
            },
            {
                uid: 'upcoming-uid-1',
                dtstart: makeIso(upcomingDate),
                summary: 'Team A vs Meteors',
                location: 'Field 2',
                status: 'CONFIRMED'
            },
            {
                uid: 'cancelled-uid-1',
                dtstart: makeIso(cancelledDate),
                summary: '[CANCELED] Team A vs Storm',
                location: 'Field 3',
                status: 'CANCELLED'
            }
        ]
    };

    await mockTeamPageModules(page, scenario);
    await page.goto(buildUrl(baseURL, '/team.html#teamId=team-a'), { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#schedule-list')).toContainText('Falcons');
    await expect(page.locator('#schedule-list')).not.toContainText('Meteors');
    await expect(page.locator('#schedule-list')).not.toContainText('Storm');
    await expect(page.locator('#schedule-list')).not.toContainText('Duplicate FC');

    await page.locator('#schedule-filter-all-upcoming').click();
    await expect(page.locator('#schedule-list')).toContainText('Meteors');
    await expect(page.locator('#schedule-list')).not.toContainText('Storm');
    await expect(page.locator('#schedule-list')).not.toContainText('Duplicate FC');
    await expect(page.locator('#schedule-list')).not.toContainText('Falcons');

    await page.locator('#schedule-view-calendar').click();
    await gotoCalendarMonth(page, now, upcomingDate);
    await expect(page.locator('#schedule-calendar-grid')).toContainText('vs Meteors');
    await expect(page.locator('#schedule-calendar-grid')).not.toContainText('Storm');
    await expect(page.locator('#schedule-calendar-grid')).not.toContainText('Duplicate FC');

    await page.locator('#schedule-filter-past-events').click();
    await page.locator('#schedule-view-list').click();
    await expect(page.locator('#schedule-list')).toContainText('Falcons');
    await expect(page.locator('#schedule-list')).toContainText('Storm');
    await expect(page.locator('#schedule-list')).not.toContainText('Meteors');
    await expect(page.locator('#schedule-list')).not.toContainText('Duplicate FC');

    await page.locator('#schedule-view-calendar').click();
    await gotoCalendarMonth(page, upcomingDate, cancelledDate);
    await expect(page.locator('#schedule-calendar-grid')).toContainText('vs Storm');
    await expect(page.locator('#schedule-calendar-grid')).not.toContainText('Duplicate FC');
});
