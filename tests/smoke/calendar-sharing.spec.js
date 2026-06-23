import { test, expect } from '@playwright/test';

function buildUrl(baseURL, path) {
    const url = new URL(path, `${baseURL}/`);
    url.searchParams.set('cb', String(Date.now()));
    return url.toString();
}

const PUBLIC_FEED_URL = 'https://functions.example.test/publicTeamGamesIcs';

const DB_STUB = `
const teams = [
    { id: 'public-team', name: 'Comets', isPublic: true, active: true, adminEmails: ['coach@example.com'] },
    { id: 'private-team', name: 'Private Squad', isPublic: false, active: true, adminEmails: ['coach@example.com'] }
];

const gamesByTeam = {
    'public-team': [
        {
            id: 'public-game',
            type: 'game',
            opponent: 'Rockets',
            location: 'Main Field',
            date: '2026-06-24T18:00:00Z',
            visibility: 'public',
            status: 'scheduled'
        }
    ],
    'private-team': [
        {
            id: 'private-game',
            type: 'game',
            opponent: 'Closed Door',
            location: 'Practice Court',
            date: '2026-06-25T18:00:00Z',
            visibility: 'private',
            status: 'scheduled'
        }
    ]
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export async function getUserTeamsWithAccess() {
    return clone(teams);
}

export async function getParentTeams() {
    return [];
}

export async function getGames(teamId) {
    return clone(gamesByTeam[teamId] || []);
}

export async function getTeam(teamId) {
    return clone(teams.find((team) => team.id === teamId) || null);
}

export async function getTrackedCalendarEventUids() {
    return [];
}

export async function getUserProfile() {
    return { email: 'coach@example.com', parentOf: [] };
}

export async function submitRsvp() {
    return null;
}

export async function submitRsvpForPlayer() {
    return null;
}

export async function getMyRsvp() {
    return null;
}

export async function getRsvpSummaries() {
    return new Map();
}

export async function getRsvps() {
    return [];
}
`;

const UTILS_STUB = `
export function renderHeader() {}
export function renderFooter() {}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function formatDate(value) {
    return new Date(value).toLocaleDateString();
}

export function formatTime(value) {
    return new Date(value).toLocaleTimeString();
}

export async function fetchAndParseCalendar() {
    return [];
}

export function expandRecurrence() {
    return [];
}

export function buildGlobalCalendarIcsEvent(event) {
    return event;
}

export function isTrackedCalendarEvent() {
    return false;
}
`;

const AUTH_STUB = `
export async function requireAuth() {
    return { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach Test' };
}

export function checkAuth(callback) {
    callback({ uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach Test' });
}
`;

const CALENDAR_RSVP_STUB = `
export function buildLinkedPlayersByTeam() {
    return new Map();
}

export function resolveCalendarRsvpSubmission() {
    return { playerIds: [], submitMode: 'account' };
}
`;

const AVAILABILITY_STUB = `
export function buildAvailabilityNoteRows() {
    return [];
}

export function canViewAvailabilityNotes() {
    return false;
}

export function formatAvailabilityCutoff() {
    return 'No cutoff';
}

export function isAvailabilityLocked() {
    return false;
}

export function normalizeAvailabilityPreferences(preferences = {}) {
    return preferences;
}
`;

async function mockCalendarModules(page) {
    await page.addInitScript(({ publicFeedUrl }) => {
        const RealDate = Date;
        const fixedNow = new RealDate('2026-06-23T12:00:00Z').getTime();
        class FixedDate extends RealDate {
            constructor(...args) {
                if (args.length === 0) {
                    super(fixedNow);
                } else {
                    super(...args);
                }
            }

            static now() {
                return fixedNow;
            }

            static parse(value) {
                return RealDate.parse(value);
            }

            static UTC(...args) {
                return RealDate.UTC(...args);
            }
        }

        window.Date = FixedDate;
        window.__ALLPLAYS_CONFIG__ = { publicTeamGamesIcsFunctionUrl: publicFeedUrl };
        window.__fanFeedSmoke = { alerts: [], copied: [] };
        window.alert = (message) => {
            window.__fanFeedSmoke.alerts.push(String(message));
        };
        Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: async (value) => {
                    window.__fanFeedSmoke.copied.push(String(value));
                }
            },
            configurable: true
        });
    }, { publicFeedUrl: PUBLIC_FEED_URL });

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
    await page.route('**/js/telemetry.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));
    await page.route('**/js/db.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: DB_STUB
    }));
    await page.route('**/js/utils.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: UTILS_STUB
    }));
    await page.route('**/js/calendar-ics-sync.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'export function mergeGlobalCalendarIcsEvents() { return []; }'
    }));
    await page.route('**/js/auth.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: AUTH_STUB
    }));
    await page.route('**/js/calendar-rsvp.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: CALENDAR_RSVP_STUB
    }));
    await page.route('**/js/rsvp-hydration.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'export function applyRsvpHydration() {}'
    }));
    await page.route('**/js/availability-preferences.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: AVAILABILITY_STUB
    }));
    await page.route('**/js/schedule-print.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'export function getDefaultSchedulePrintOptions() { return {}; } export function printSchedule() {} export function promptSchedulePrintOptions() { return null; }'
    }));
}

test('calendar Fan Feed only copies for selected teams with public games', async ({ page, baseURL }) => {
    await mockCalendarModules(page);
    await page.goto(buildUrl(baseURL, '/calendar.html'), { waitUntil: 'domcontentloaded' });

    const teamFilter = page.locator('#team-filter');
    const fanFeedButton = page.locator('#public-games-feed');

    await expect(teamFilter).toContainText('Comets');
    await expect(teamFilter).toContainText('Private Squad');
    await expect(fanFeedButton).toBeHidden();

    await teamFilter.selectOption('private-team');
    await expect(fanFeedButton).toBeHidden();
    await page.evaluate(() => document.getElementById('public-games-feed')?.click());

    await expect.poll(() => page.evaluate(() => window.__fanFeedSmoke)).toMatchObject({
        alerts: ['Select a team with public games before copying the Fan Feed link.'],
        copied: []
    });

    await teamFilter.selectOption('public-team');
    await expect(fanFeedButton).toBeVisible();
    await fanFeedButton.click();

    await expect.poll(() => page.evaluate(() => window.__fanFeedSmoke)).toMatchObject({
        alerts: [
            'Select a team with public games before copying the Fan Feed link.',
            'Fan Feed URL copied.'
        ],
        copied: [`${PUBLIC_FEED_URL}?teamId=public-team`]
    });
});
