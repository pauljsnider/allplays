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

function parseCalendarMonthLabel(label) {
    const trimmed = String(label || '').trim();
    const match = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (!match) {
        throw new Error(`Unexpected calendar month label: ${trimmed}`);
    }

    const [, monthName, yearText] = match;
    const monthIndex = new Date(`${monthName} 1, 2000`).getMonth();
    if (Number.isNaN(monthIndex)) {
        throw new Error(`Unable to parse calendar month label: ${trimmed}`);
    }

    return new Date(Date.UTC(Number(yearText), monthIndex, 1));
}

function buildDbStub({
    team,
    games,
    trackedUids,
    publicCalendarEvents = [],
    configs = [],
    configReadMode = 'success',
    privateRsvps = [],
    deferRsvps = false
}) {
    return `
const team = ${JSON.stringify(team)};
const games = ${JSON.stringify(games)};
const trackedUids = ${JSON.stringify(trackedUids)};
const publicCalendarEvents = ${JSON.stringify(publicCalendarEvents)};
const configs = ${JSON.stringify(configs)};
const configReadMode = ${JSON.stringify(configReadMode)};
const privateRsvps = ${JSON.stringify(privateRsvps)};
const deferRsvps = ${JSON.stringify(deferRsvps)};

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

export async function getPublicTeamCalendarEvents() {
    return clone(publicCalendarEvents).map((event) => ({
        ...event,
        dtstart: new Date(event.dtstart),
        dtend: event.dtend ? new Date(event.dtend) : null
    }));
}

export async function getConfigs() {
    window.__getConfigsCalls = (window.__getConfigsCalls || 0) + 1;
    if (configReadMode === 'reject') {
        throw new Error('classic config unavailable');
    }
    return clone(configs);
}

export async function getTrackedCalendarEventUids() {
    return clone(trackedUids);
}

export async function getUnreadChatCounts() {
    return {};
}

export async function postChatMessage() {
    return undefined;
}

export async function getUserProfile() {
    return null;
}

export async function getAllUsers() {
    return [];
}

export async function saveTeamAvailabilityPreferences() {
    return undefined;
}

export async function grantScorekeeperAccess() {
    return undefined;
}

export async function revokeScorekeeperAccess() {
    return undefined;
}

export async function grantStreamScoreAccess() {
    return undefined;
}

export async function revokeStreamScoreAccess() {
    return undefined;
}

export async function getRsvps() {
    window.__teamRsvpReadCalls = (window.__teamRsvpReadCalls || 0) + 1;
    if (!deferRsvps) return clone(privateRsvps);
    window.__pendingTeamRsvpReads ||= [];
    return new Promise((resolve) => {
        window.__pendingTeamRsvpReads.push(() => resolve(clone(privateRsvps)));
        window.__resolveNextTeamRsvpRead = () => window.__pendingTeamRsvpReads.shift()?.();
    });
}

export async function getRsvpSummaries() {
    return new Map();
}

export async function submitRsvp() {
    return undefined;
}

export async function getMyRsvp() {
    return null;
}

export async function getMyRsvps() {
    return [];
}

export async function getLocalAttractionSponsors() {
    return [];
}

export async function getAdSpaceSponsors() {
    return [];
}

export async function getPublicTrackingItems() {
    return [];
}

export async function getPlayerTrackingStatuses() {
    return [];
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

export function expandRecurrence(events = []) {
    return Array.isArray(events) ? events : [];
}

export function escapeHtml(value) {
    return String(value ?? '');
}

export async function shareOrCopy() {}
`;
}

function buildAuthStub({ authenticatedManager = false } = {}) {
    const initialUser = authenticatedManager
        ? { uid: 'manager-1', email: 'manager@example.test' }
        : null;
    return `
const initialUser = ${JSON.stringify(initialUser)};
export function checkAuth(callback) {
    window.__emitTeamAuth = (user) => callback(user);
    callback(initialUser);
}
`;
}

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
export async function aggregateSeasonStatsByPlayerId() {
    return {};
}

export function buildPlayerLeaderboardSnapshot() {
    return null;
}

export function selectAnalyticsConfig() {
    return null;
}
`;

const ANALYTICS_STAT_STUB = `
export async function aggregateSeasonStatsByPlayerId({ games = [], seasonLabel = '', loadGameStats } = {}) {
    for (const game of games) {
        const gameYear = String(new Date(game.date).getUTCFullYear());
        if (!seasonLabel || seasonLabel === gameYear) {
            await loadGameStats(game);
        }
    }
    return {};
}

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

function buildFirebaseStub({ deferPrivateCalendarToken = false } = {}) {
    return `
export const db = {};
export const functions = {};
const deferPrivateCalendarToken = ${JSON.stringify(deferPrivateCalendarToken)};

export function httpsCallable(_functions, name) {
    return async (data) => {
        window.__privateCalendarCallableCalls ||= [];
        window.__privateCalendarCallableCalls.push({ name, data });
        if (name === 'getPrivateTeamCalendarFeedToken' && deferPrivateCalendarToken) {
            window.__pendingPrivateCalendarTokens ||= [];
            return new Promise((resolve) => {
                window.__pendingPrivateCalendarTokens.push(resolve);
                window.__resolveNextPrivateCalendarToken = (token = 'stale-private-calendar-token') => {
                    window.__pendingPrivateCalendarTokens.shift()?.({ data: { token } });
                };
            });
        }
        return { data: { token: 'private-calendar-token' } };
    };
}

export function collection(_db, path) {
    return { path };
}

export function query(ref) {
    return ref;
}

export function where() {
    return {};
}

export function orderBy() {
    return null;
}

export async function getDocs(ref) {
    if (String(ref?.path || '').endsWith('/statTrackerConfigs')) {
        window.__getConfigsCalls = (window.__getConfigsCalls || 0) + 1;
    }
    return {
        empty: true,
        docs: [],
        forEach() {}
    };
}
`;
}

const TEAM_ADMIN_BANNER_STUB = `
export function renderTeamAdminBanner() {}

export function getTeamAccessInfo() {
    return { hasAccess: false };
}
`;

const TOURNAMENT_STANDINGS_STUB = `
export function computeTournamentPoolStandings() {
    return [];
}
`;

const ROSTER_FIELD_PRIVACY_STUB = `
export function getVisibleRosterFieldValues() {
    return {};
}
`;

const AVAILABILITY_PREFERENCES_STUB = `
export function buildAvailabilityNoteRows() {
    const rsvps = arguments[0];
    return (Array.isArray(rsvps) ? rsvps : [])
        .filter((entry) => typeof entry?.note === 'string' && entry.note.trim())
        .map((entry) => ({
            displayName: entry.displayName || 'Team member',
            note: entry.note.trim()
        }));
}

export function formatAvailabilityCutoff() {
    return 'No cutoff';
}

export function isAvailabilityLocked() {
    return false;
}

export function normalizeAvailabilityPreferences(preferences = {}) {
    return {
        cutoffMinutesBeforeStart: 0,
        noteVisibility: 'admins',
        ...preferences
    };
}
`;

const SCHEDULE_NOTIFICATIONS_STUB = `
export function buildAvailabilityReminderRecipients() {
    return [];
}

export function buildRsvpReminderMessage() {
    return '';
}
`;

const TEAM_PASS_STUB = `
export function renderTeamPassCard() {}
`;

const PLAYER_TRACKING_SUMMARY_STUB = `
export function getVisiblePlayerTrackingSummary() {
    return [];
}
`;

const TEAM_STAFF_PERMISSIONS_STUB = `
export function renderTeamStaffPermissionsSection() {}
`;

const LOCAL_ATTRACTIONS_STUB = `
export function normalizeExternalWebsiteUrl(value) {
    return value || '';
}

export function selectRotatingSponsor(sponsors = []) {
    return Array.isArray(sponsors) ? sponsors[0] || null : null;
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
        body: `
window.tailwind = window.tailwind || { config: {} };
const smokeStyles = document.createElement('style');
smokeStyles.textContent = '.min-h-11 { min-height: 2.75rem; }';
document.head.appendChild(smokeStyles);
`
    }));
    await page.route('**/js/db.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: buildDbStub(scenario)
    }));
    await page.route('**/js/utils.js?v=*', (route) => route.fulfill({
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
    await page.route(/\/js\/stat-leaderboards\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: scenario.enableAnalyticsLoad ? ANALYTICS_STAT_STUB : STAT_STUB
    }));
    await page.route('**/js/season-record.js', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: SEASON_RECORD_STUB
    }));
    await page.route('**/js/auth.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: buildAuthStub(scenario)
    }));
    await page.route(/\/js\/firebase\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: buildFirebaseStub(scenario)
    }));
    await page.route('**/js/team-admin-banner.js*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: scenario.authenticatedManager
            ? 'export function renderTeamAdminBanner() {} export function getTeamAccessInfo() { return { hasAccess: true, accessLevel: "full" }; }'
            : TEAM_ADMIN_BANNER_STUB
    }));
    await page.route('**/js/tournament-standings.js?v=4', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: TOURNAMENT_STANDINGS_STUB
    }));
    await page.route('**/js/roster-field-privacy.js', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ROSTER_FIELD_PRIVACY_STUB
    }));
    await page.route('**/js/availability-preferences.js?v=1', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: AVAILABILITY_PREFERENCES_STUB
    }));
    await page.route('**/js/schedule-notifications.js?v=6', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: SCHEDULE_NOTIFICATIONS_STUB
    }));
    await page.route('**/js/local-attractions.js?v=2', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: LOCAL_ATTRACTIONS_STUB
    }));
    await page.route('**/js/premium-entitlements.js*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: scenario.enableAnalyticsLoad
            ? 'export async function readTeamPremiumEntitlement() { return { state: "active" }; } export function renderPremiumGateState() { return false; }'
            : 'export async function readTeamPremiumEntitlement() { return null; } export function renderPremiumGateState() {}'
    }));
    await page.route('**/js/team-pass.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: TEAM_PASS_STUB
    }));
    await page.route('**/js/player-tracking-summary.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: PLAYER_TRACKING_SUMMARY_STUB
    }));
    await page.route('**/js/team-staff-permissions.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: TEAM_STAFF_PERMISSIONS_STUB
    }));
}

test('team Diamond config mismatch retries twice per load and exposes a reload-safe retry action', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
        const nextLoad = Number(window.sessionStorage.getItem('team-config-document-loads') || 0) + 1;
        window.sessionStorage.setItem('team-config-document-loads', String(nextLoad));
    });
    const completedDate = addDays(new Date(), -2, 18);
    const scenario = {
        team: { name: 'Diamond Team', sport: 'Baseball' },
        games: [{
            id: 'diamond-game-1',
            date: makeIso(completedDate),
            type: 'game',
            status: 'completed',
            homeScore: 4,
            awayScore: 2,
            trackingEngine: 'diamond-v2',
            statTrackerConfigId: 'diamond-config',
            diamondStatConfigSnapshotHash: `sha256:${'a'.repeat(64)}`
        }],
        configs: [{
            id: 'diamond-config',
            diamondPublicTeamStatIds: [],
            statDefinitions: [{ id: 'h', scope: 'player', visibility: 'public' }]
        }],
        trackedUids: [],
        calendarEvents: [],
        enableAnalyticsLoad: true,
        authenticatedManager: true
    };

    await mockTeamPageModules(page, scenario);
    await page.goto(buildUrl(baseURL, '/team.html#teamId=team-a'), { waitUntil: 'domcontentloaded' });

    const alert = page.getByRole('alert');
    const retryButton = page.getByRole('button', { name: 'Retry loading Diamond statistic definitions' });
    await expect(alert).toContainText('Diamond statistic definitions could not be verified.');
    await expect(retryButton).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__getConfigsCalls)).toBe(2);
    const target = await retryButton.boundingBox();
    expect(target).not.toBeNull();
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(pageErrors).toEqual([]);

    await retryButton.click();
    await expect.poll(() => page.evaluate(() => Number(window.sessionStorage.getItem('team-config-document-loads')))).toBe(2);
    await expect(page.getByRole('alert')).toContainText('Diamond statistic definitions could not be verified.');
    await expect(page.getByRole('button', { name: 'Retry loading Diamond statistic definitions' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__getConfigsCalls)).toBe(2);
    expect(await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.type)).toBe('reload');
    expect(pageErrors).toEqual([]);
});

test('team classic config read rejection reaches the generic error path without a Diamond retry', async ({ page, baseURL }) => {
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const scenario = {
        team: { name: 'Classic Team', sport: 'Soccer' },
        games: [{
            id: 'classic-game-1',
            date: makeIso(addDays(new Date(), -2, 18)),
            type: 'game',
            status: 'completed',
            homeScore: 2,
            awayScore: 1,
            trackingEngine: 'standard'
        }],
        configReadMode: 'reject',
        trackedUids: [],
        calendarEvents: [],
        enableAnalyticsLoad: true
    };

    await mockTeamPageModules(page, scenario);
    await page.goto(buildUrl(baseURL, '/team.html#teamId=team-a'), { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#team-header')).toContainText('Classic Team');
    await expect.poll(() => page.evaluate(() => window.__getConfigsCalls)).toBe(1);
    await expect.poll(() => consoleErrors.some((message) => message.includes('classic config unavailable'))).toBe(true);
    await expect(page.locator('[data-retry-diamond-config]')).toHaveCount(0);
    await expect(page.locator('#configured-team-leaderboards-section')).toHaveText('');
    expect(pageErrors).toEqual([]);
});

async function gotoCalendarMonth(page, fromDate, targetDate) {
    void fromDate;

    for (let index = 0; index < 24; index += 1) {
        const currentLabel = await page.locator('#schedule-calendar-month-label').textContent();
        const visibleMonth = parseCalendarMonthLabel(currentLabel);
        const delta = monthDelta(visibleMonth, targetDate);

        if (delta === 0) {
            return;
        }

        await page.locator(delta > 0 ? '#schedule-calendar-next' : '#schedule-calendar-prev').click();
    }

    throw new Error(`Unable to navigate calendar to ${targetDate.toISOString()}`);
}

test('team schedule calendar shows only practices in the dedicated practice filter and modal', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
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
    await page.waitForLoadState('load');

    expect(pageErrors).toEqual([]);
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

test('team private sync provisions before enabling popup-safe provider actions', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
        window.__ALLPLAYS_CONFIG__ = {
            teamCalendarFeedFunctionUrl: 'https://functions.example.test/teamCalendarFeed'
        };
        window.__calendarProviderUrls = [];
        window.open = (url) => {
            window.__calendarProviderUrls.push(String(url));
            return null;
        };
    });
    await mockTeamPageModules(page, {
        team: { name: 'Team A', sport: 'Soccer' },
        games: [],
        trackedUids: [],
        calendarEvents: [],
        authenticatedManager: true
    });
    await page.goto(buildUrl(baseURL, '/team.html#teamId=team-a'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    expect(pageErrors).toEqual([]);
    await expect(page.locator('#team-header')).toContainText('Team A');
    await page.locator('#sync-calendar').click();
    await expect(page.locator('#sync-calendar-feedback')).toContainText('Choose where to subscribe');
    await expect(page.locator('#sync-calendar-google')).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.__privateCalendarCallableCalls)).toEqual([{
        name: 'getPrivateTeamCalendarFeedToken',
        data: { teamId: 'team-a' }
    }]);

    await page.locator('#sync-calendar-google').click();
    await expect.poll(() => page.evaluate(() => window.__calendarProviderUrls)).toEqual([
        'https://calendar.google.com/calendar/render?cid=https%3A%2F%2Ffunctions.example.test%2FteamCalendarFeed%3FteamId%3Dteam-a%26token%3Dprivate-calendar-token'
    ]);
    await expect.poll(() => page.evaluate(() => window.__privateCalendarCallableCalls)).toHaveLength(1);
});

for (const transition of [
    {
        label: 'UID change',
        nextUser: { uid: 'manager-2', email: 'other-manager@example.test' }
    },
    {
        label: 'sign-out',
        nextUser: null
    }
]) {
    test(`team ${transition.label} synchronously clears private UI and rejects held A reads`, async ({ page, baseURL }) => {
        const pageErrors = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));
        const upcomingDate = addDays(new Date(), 5, 18);
        await page.addInitScript(() => {
            window.__ALLPLAYS_CONFIG__ = {
                teamCalendarFeedFunctionUrl: 'https://functions.example.test/teamCalendarFeed'
            };
        });
        await mockTeamPageModules(page, {
            team: {
                name: 'Private Team A',
                sport: 'Soccer',
                availabilityPreferences: { noteVisibility: 'admins' }
            },
            games: [{
                id: 'private-game-1',
                opponent: 'Rivals',
                location: 'Private Field',
                type: 'game',
                status: 'scheduled',
                date: makeIso(upcomingDate)
            }],
            trackedUids: [],
            calendarEvents: [],
            authenticatedManager: true,
            deferRsvps: true,
            deferPrivateCalendarToken: true,
            privateRsvps: [{
                displayName: 'Manager A child',
                note: 'manager-a-private-note'
            }]
        });
        await page.goto(buildUrl(baseURL, '/team.html#teamId=team-a'), { waitUntil: 'domcontentloaded' });

        await expect.poll(() => page.evaluate(() => window.__teamRsvpReadCalls || 0)).toBe(1);
        await expect(page.locator('#sync-calendar')).toBeVisible();
        await page.locator('#sync-calendar').click();
        await expect.poll(() => page.evaluate(() => window.__privateCalendarCallableCalls?.length || 0)).toBe(1);
        await expect(page.locator('#sync-calendar-modal')).not.toHaveClass(/hidden/);

        const immediate = await page.evaluate((nextUser) => {
            const dayModal = document.getElementById('schedule-day-modal');
            const dayTitle = document.getElementById('schedule-day-modal-title');
            const dayContent = document.getElementById('schedule-day-modal-content');
            dayModal?.classList.remove('hidden');
            if (dayTitle) dayTitle.textContent = 'Manager A private day';
            if (dayContent) dayContent.innerHTML = '<p>manager-a-private-note</p>';
            document.getElementById('team-nav-banner').innerHTML = '<p>manager-a-private-nav</p>';
            document.getElementById('team-pass-container').innerHTML = '<p>manager-a-private-pass</p>';
            document.getElementById('availability-settings-section').innerHTML = '<p>manager-a-private-settings</p>';
            document.getElementById('team-staff-permissions-section').innerHTML = '<p>manager-a-private-staff</p>';
            window.__emitTeamAuth(nextUser);
            return {
                dayModalHidden: dayModal?.classList.contains('hidden'),
                dayTitle: dayTitle?.textContent,
                dayContent: dayContent?.textContent,
                syncModalHidden: document.getElementById('sync-calendar-modal')?.classList.contains('hidden'),
                syncFeedback: document.getElementById('sync-calendar-feedback')?.textContent,
                syncActionsDisabled: ['sync-calendar-apple', 'sync-calendar-google', 'sync-calendar-copy']
                    .every((id) => document.getElementById(id)?.disabled),
                syncButtonHidden: document.getElementById('sync-calendar')?.classList.contains('hidden'),
                nav: document.getElementById('team-nav-banner')?.textContent,
                pass: document.getElementById('team-pass-container')?.textContent,
                availability: document.getElementById('availability-settings-section')?.textContent,
                staff: document.getElementById('team-staff-permissions-section')?.textContent,
                roster: document.getElementById('roster-list')?.textContent,
                schedule: document.getElementById('schedule-list')?.textContent,
                controlsDisabled: ['download-ics', 'print-schedule', 'schedule-view-list']
                    .every((id) => document.getElementById(id)?.disabled)
            };
        }, transition.nextUser);

        expect(immediate).toEqual({
            dayModalHidden: true,
            dayTitle: '',
            dayContent: '',
            syncModalHidden: true,
            syncFeedback: '',
            syncActionsDisabled: true,
            syncButtonHidden: true,
            nav: '',
            pass: '',
            availability: '',
            staff: '',
            roster: '',
            schedule: '',
            controlsDisabled: true
        });

        await page.evaluate(() => {
            window.__resolveNextTeamRsvpRead?.();
            window.__resolveNextPrivateCalendarToken?.('manager-a-private-token');
        });
        await page.waitForTimeout(50);

        await expect(page.locator('body')).not.toContainText('manager-a-private-note');
        await expect(page.locator('#sync-calendar-modal')).toHaveClass(/hidden/);
        await expect(page.locator('#sync-calendar-feedback')).toHaveText('');
        await expect(page.locator('#sync-calendar-apple')).toBeDisabled();
        await expect(page.locator('#sync-calendar-google')).toBeDisabled();
        await expect(page.locator('#sync-calendar-copy')).toBeDisabled();
        expect(pageErrors).toEqual([]);
    });
}

test('public team schedule uses projected calendar events without a browser-visible feed URL', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const now = new Date();
    const practiceDate = addDays(now, 7, 18);
    const scenario = {
        team: {
            name: 'Public Team',
            sport: 'Soccer',
            isPublic: true,
            hasCalendarSources: true
        },
        games: [],
        trackedUids: [],
        calendarEvents: [],
        publicCalendarEvents: [{
            id: 'opaque-calendar-event',
            uid: 'opaque-calendar-event',
            dtstart: makeIso(practiceDate),
            summary: 'Public Team Practice',
            location: 'Public Gym',
            status: 'SCHEDULED',
            isPublicProjection: true
        }]
    };

    await mockTeamPageModules(page, scenario);
    await page.goto(buildUrl(baseURL, '/team.html#teamId=team-a'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    expect(pageErrors).toEqual([]);
    await expect(page.locator('#team-header')).toContainText('Public Team');
    await page.locator('#schedule-view-calendar').click();
    await page.locator('#schedule-filter-upcoming-practices').click();
    await gotoCalendarMonth(page, now, practiceDate);

    const dayCell = page.locator(`[data-schedule-day="${practiceDate.getUTCDate()}"]`);
    await expect(dayCell).toContainText('Practice');
    await dayCell.click();
    await expect(page.locator('#schedule-day-modal-content')).toContainText('Public Gym');
});

test('team schedule print uses the selected range and black-and-white layout', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const now = new Date();
    const inRangeGameDate = addDays(now, 7, 18);
    const inRangePracticeDate = addDays(now, 10, 17);
    const outOfRangeDate = addDays(now, 45, 18);
    const scenario = {
        team: {
            name: 'Team A',
            sport: 'Soccer',
            calendarUrls: []
        },
        games: [
            {
                id: 'game-1',
                opponent: 'Rivals FC',
                location: 'Field 1',
                type: 'game',
                status: 'scheduled',
                date: makeIso(inRangeGameDate)
            },
            {
                id: 'practice-1',
                title: 'Practice',
                location: 'Gym 1',
                type: 'practice',
                status: 'scheduled',
                date: makeIso(inRangePracticeDate)
            },
            {
                id: 'game-2',
                opponent: 'Late FC',
                location: 'Field 2',
                type: 'game',
                status: 'scheduled',
                date: makeIso(outOfRangeDate)
            }
        ],
        trackedUids: [],
        calendarEvents: []
    };

    await page.addInitScript(() => {
        window.__printCalls = 0;
        window.print = () => {
            window.__printCalls += 1;
        };
    });
    await mockTeamPageModules(page, scenario);
    await page.goto(buildUrl(baseURL, '/team.html#teamId=team-a'), { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load');

    expect(pageErrors).toEqual([]);
    await expect(page.locator('#team-header')).toContainText('Team A');
    await page.locator('#show-practices').check();
    await page.locator('#schedule-filter-all-upcoming').click();

    const dialogValues = [
        inRangeGameDate.toISOString().slice(0, 10),
        inRangePracticeDate.toISOString().slice(0, 10),
        'all',
        true
    ];
    page.on('dialog', async (dialog) => {
        const value = dialogValues.shift();
        if (dialog.type() === 'confirm') {
            await (value ? dialog.accept() : dialog.dismiss());
            return;
        }
        await dialog.accept(String(value));
    });

    await page.locator('#print-schedule-options').scrollIntoViewIfNeeded();
    await page.locator('#print-schedule-options').click({ force: true });

    await expect.poll(() => page.evaluate(() => window.__printCalls)).toBe(1);
    await expect(page.locator('#schedule-print-container')).toHaveClass(/schedule-print-bw/);
    await expect(page.locator('#schedule-print-container tbody tr')).toHaveCount(2);
    await expect(page.locator('#schedule-print-container')).toContainText('Rivals FC');
    await expect(page.locator('#schedule-print-container')).toContainText('Practice');
    await expect(page.locator('#schedule-print-container')).not.toContainText('Late FC');
});

test('team schedule keeps tracked duplicates and cancelled items out of the wrong filter buckets', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const now = new Date();
    const completedDate = addDays(now, -5, 18);
    const upcomingDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 10, 18, 0, 0, 0));
    const cancelledDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 11, 18, 0, 0, 0));
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
    await page.waitForLoadState('load');

    expect(pageErrors).toEqual([]);
    await page.locator('#schedule-filter-recent-results').click();
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
    await expect(page.locator('#schedule-calendar-grid')).toContainText('vs Storm');
    await expect(page.locator('#schedule-calendar-grid')).not.toContainText('Duplicate FC');
});
