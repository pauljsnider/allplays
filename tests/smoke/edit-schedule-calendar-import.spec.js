import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../..');

let server;
let serverOrigin;

const moduleSources = {
    '/js/db.js': `
const state = () => window.__editScheduleTestState || {};

export async function getTeam() {
    return state().team || null;
}

export async function getTeams() {
    return state().teams || [];
}

export async function getGames() {
    return [];
}

export async function getEvents() {
    return state().dbEvents || [];
}

export async function addGame() {
    return 'game-created';
}

export async function updateGame() {}
export async function updateTeam() {}
export async function deleteGame() {}
export async function addPractice() { return 'practice-created'; }
export async function updateEvent() {}
export async function deleteEvent() {}
export async function getConfigs() { return []; }
export async function addCalendarToTeam() {}
export async function removeCalendarFromTeam() {}
export async function getTrackedCalendarEventUids() { return state().trackedUids || []; }
export async function cancelOccurrence() {}
export async function updateOccurrence() {}
export async function restoreOccurrence() {}
export async function clearOccurrenceOverride() {}
export async function updateSeries() {}
export async function deleteSeries() {}
export async function getUnreadChatCount() { return 0; }
export async function getPracticeSessions() { return state().practiceSessions || []; }
export async function cancelGame() {}
export async function getLatestGameAssignments() { return []; }
export async function postChatMessage() {}
export async function getRsvpBreakdownByPlayer() {
    return {
        grouped: { going: [], maybe: [], not_going: [], not_responded: [] },
        counts: { going: 0, maybe: 0, notGoing: 0, notResponded: 0 }
    };
}
`,
    '/js/utils.js': `
const state = () => window.__editScheduleTestState || {};

function normalizeDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function format(value, options) {
    const date = normalizeDate(value);
    if (!date) return '';
    return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(date);
}

export function renderHeader(container) {
    if (container) container.innerHTML = '<div>Header</div>';
}

export function renderFooter(container) {
    if (container) container.innerHTML = '<div>Footer</div>';
}

export function getUrlParams() {
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    return Object.fromEntries(new URLSearchParams(hash).entries());
}

export function formatDate(value) {
    return format(value, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatShortDate(value) {
    return formatDate(value);
}

export function formatTime(value) {
    return format(value, { hour: 'numeric', minute: '2-digit' });
}

export function formatTimeRange(start, end) {
    const normalizedStart = normalizeDate(start);
    const normalizedEnd = normalizeDate(end);
    if (!normalizedStart || !normalizedEnd) return '';
    return \`\${formatTime(normalizedStart)} - \${formatTime(normalizedEnd)}\`;
}

export function getDefaultEndTime() {
    return '';
}

export async function fetchAndParseCalendar(url) {
    return (state().calendarEventsByUrl || {})[url] || [];
}

export function extractOpponent(summary, teamName) {
    const cleanSummary = String(summary || '');
    const prefix = \`\${teamName || ''} vs \`;
    return cleanSummary.startsWith(prefix) ? cleanSummary.slice(prefix.length) : cleanSummary;
}

export function isPracticeEvent(summary) {
    return /practice|training/i.test(String(summary || ''));
}

export function getCalendarEventStatus(event) {
    if (String(event?.status || '').toLowerCase() === 'cancelled') return 'cancelled';
    if (/\\[(?:canceled|cancelled)\\]/i.test(String(event?.summary || ''))) return 'cancelled';
    return 'confirmed';
}

export function getCalendarEventTrackingId(event) {
    return event?.uid || event?.id || '';
}

export function isTrackedCalendarEvent(event, trackedIds = []) {
    return trackedIds.includes(getCalendarEventTrackingId(event));
}

export function generateSeriesId() {
    return 'series-1';
}

export function expandRecurrence() {
    return [];
}

export function formatRecurrence() {
    return '';
}

export async function shareOrCopy() {
    return true;
}

export function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
`,
    '/js/auth.js': `
export function checkAuth(callback) {
    Promise.resolve().then(() => callback({
        uid: 'coach-1',
        email: 'coach@example.com',
        displayName: 'Coach Example'
    }));
}
`,
    '/js/team-admin-banner.js': `
export function renderTeamAdminBanner(container) {
    if (container) container.innerHTML = '<div>Banner</div>';
}
`,
    '/js/team-access.js': `
export function getTeamAccessInfo() {
    return { hasAccess: true, accessLevel: 'full' };
}
`,
    '/js/live-game-state.js': `
export function resolvePreferredStatConfigId() {
    return null;
}
`,
    '/js/edit-schedule-cancel-game.js': `
export async function cancelScheduledGame() {
    return { cancelled: false, error: 'not implemented in test' };
}
`,
    '/js/edit-schedule-practice-payload.js': `
export function applyPracticeRecurrenceFields() {}
`,
    '/js/edit-schedule-practice-submit.js': `
export async function savePracticeForm() {
    return { savedPracticeId: 'practice-created' };
}
`,
    '/js/firebase.js': `
export const Timestamp = {
    fromDate(date) {
        return {
            toDate() {
                return date;
            }
        };
    }
};

export function deleteField() {
    return '__delete_field__';
}
`,
    '/js/vendor/firebase-app.js': `
export function getApp() {
    return {};
}
`,
    '/js/vendor/firebase-ai.js': `
export function getAI() {
    return {};
}

export function getGenerativeModel() {
    return {};
}

export const GoogleAIBackend = {};
export const Schema = {};
`,
    '/js/tournament-brackets.js': `
export function collectTournamentAdvancementPatches() {
    return [];
}

export function describeTournamentSource() {
    return '';
}
`,
    '/js/schedule-notifications.js': `
export function normalizeScheduleNotificationSettings() {
    return { enabled: false, reminderHours: 24 };
}

export function buildScheduleNotificationMetadata() {
    return {};
}

export function buildScheduleChangeMessage() {
    return '';
}

export function buildRsvpReminderMessage() {
    return '';
}
`,
    '/js/schedule-csv-import.js': `
export const SCHEDULE_CSV_IMPORT_FIELDS = [];
export function buildScheduleImportPreview() { return []; }
export function inferScheduleCsvMapping() { return {}; }
export function normalizeScheduleImportDraft() { return {}; }
export function parseCsvText() { return []; }
`
};

function contentTypeFor(filePath) {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
    if (filePath.endsWith('.png')) return 'image/png';
    return 'text/plain; charset=utf-8';
}

async function startStaticServer() {
    server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, 'http://127.0.0.1');
            let pathname = decodeURIComponent(url.pathname);
            if (pathname === '/') pathname = '/index.html';
            const filePath = path.join(repoRoot, pathname);
            const body = await readFile(filePath);
            res.writeHead(200, { 'content-type': contentTypeFor(filePath) });
            res.end(body);
        } catch (error) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end(String(error));
        }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    serverOrigin = `http://127.0.0.1:${address.port}`;
}

async function stopStaticServer() {
    if (!server) return;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    server = null;
    serverOrigin = null;
}

async function registerRoutes(page) {
    await page.route('https://www.googletagmanager.com/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript; charset=utf-8',
            body: ''
        });
    });

    await page.route('https://cdn.tailwindcss.com/**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript; charset=utf-8',
            body: 'window.tailwind = window.tailwind || { config: {} };'
        });
    });

    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== serverOrigin) {
            await route.continue();
            return;
        }

        const source = moduleSources[url.pathname];
        if (!source) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: 'application/javascript; charset=utf-8',
            body: source
        });
    });
}

function buildState(overrides = {}) {
    return {
        team: {
            id: 'team-1',
            name: 'Wildcats',
            sport: 'soccer',
            calendarUrls: ['https://calendar.test/team.ics']
        },
        teams: [],
        dbEvents: [],
        trackedUids: [],
        practiceSessions: [],
        calendarEventsByUrl: {},
        ...overrides
    };
}

function hashParamsFromHref(href) {
    const url = new URL(href, serverOrigin);
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    return new URLSearchParams(hash);
}

test.beforeAll(async () => {
    await startStaticServer();
});

test.afterAll(async () => {
    await stopStaticServer();
});

test.describe('edit schedule imported calendar rows', () => {
    test.beforeEach(async ({ page }) => {
        await registerRoutes(page);
    });

    test('renders imported practice rows with practice planning context', async ({ page }) => {
        const eventStart = '2030-04-04T19:00:00.000Z';
        const eventEnd = '2030-04-04T20:30:00.000Z';

        await page.addInitScript((state) => {
            window.__editScheduleTestState = state;
            window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
        }, buildState({
            calendarEventsByUrl: {
                'https://calendar.test/team.ics': [
                    {
                        uid: 'practice-uid-1',
                        dtstart: eventStart,
                        dtend: eventEnd,
                        summary: 'Evening Practice',
                        location: 'Training Field'
                    }
                ]
            }
        }));

        await page.goto(`${serverOrigin}/edit-schedule.html#teamId=team-1`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'Upcoming Practices' }).click();

        const scheduleList = page.locator('#schedule-list');
        await expect(scheduleList).toContainText('Calendar');
        await expect(scheduleList).toContainText('Practice');
        await expect(scheduleList).toContainText('Evening Practice');
        await expect(scheduleList).toContainText('Training Field');
        await expect(scheduleList).toContainText('Plan Practice');
        await expect(scheduleList).not.toContainText('Track');

        const importedPracticeRow = scheduleList.locator('div').filter({ hasText: 'Evening Practice' }).first();
        await expect(importedPracticeRow).toContainText('Training Field');

        const planLink = scheduleList.getByRole('link', { name: 'Plan Practice' });
        await expect(planLink).toHaveAttribute('href', /drills\.html#/);

        const params = hashParamsFromHref(await planLink.getAttribute('href'));
        expect(params.get('teamId')).toBe('team-1');
        expect(params.get('eventId')).toBe('practice-uid-1');
        expect(params.get('eventDate')).toBe('2030-04-04');
        expect(params.get('eventDuration')).toBe('90');
        expect(params.get('eventLocation')).toBe('Training Field');
        expect(params.get('eventTitle')).toBe('Evening Practice');
    });

    test('suppresses tracked and conflicting imports while rendering cancelled rows without actions', async ({ page }) => {
        await page.addInitScript((state) => {
            window.__editScheduleTestState = state;
            window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
        }, buildState({
            dbEvents: [
                {
                    id: 'db-existing-game',
                    type: 'game',
                    date: '2030-04-06T18:00:00.000Z',
                    opponent: 'Existing Opponent',
                    location: 'Main Field'
                }
            ],
            trackedUids: ['tracked-uid'],
            calendarEventsByUrl: {
                'https://calendar.test/team.ics': [
                    {
                        uid: 'tracked-uid',
                        dtstart: '2030-04-05T18:00:00.000Z',
                        dtend: '2030-04-05T20:00:00.000Z',
                        summary: 'Wildcats vs Tigers',
                        location: 'Field 1'
                    },
                    {
                        uid: 'conflict-uid',
                        dtstart: '2030-04-06T18:00:30.000Z',
                        dtend: '2030-04-06T20:00:30.000Z',
                        summary: 'Wildcats vs Bears',
                        location: 'Field 2'
                    },
                    {
                        uid: 'cancelled-uid',
                        dtstart: '2030-04-07T18:00:00.000Z',
                        dtend: '2030-04-07T20:00:00.000Z',
                        summary: '[CANCELED] Wildcats vs Storm',
                        location: 'Field 3',
                        status: 'CANCELLED'
                    }
                ]
            }
        }));

        await page.goto(`${serverOrigin}/edit-schedule.html#teamId=team-1`, { waitUntil: 'domcontentloaded' });

        const scheduleList = page.locator('#schedule-list');
        await expect(scheduleList).toContainText('Storm');
        await expect(scheduleList).toContainText('Cancelled');
        await expect(scheduleList).not.toContainText('Tigers');
        await expect(scheduleList).not.toContainText('Bears');

        const cancelledRow = scheduleList.locator('div').filter({ hasText: 'Storm' }).first();
        await expect(cancelledRow).not.toContainText('Track');
        await expect(cancelledRow).not.toContainText('Plan Practice');
    });
});
