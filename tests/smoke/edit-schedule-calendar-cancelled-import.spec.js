import { test, expect } from '@playwright/test';
import { buildUrl, createBootIssueCollector } from './helpers/boot-path.js';

const DB_STUB = `
export async function getTeam(teamId) {
    return {
        id: teamId,
        name: 'Wildcats',
        ownerId: 'user-1',
        adminEmails: [],
        calendarUrls: ['https://calendar.example.test/team.ics'],
        scheduleNotifications: {}
    };
}
export async function getTeams() { return []; }
export async function getGames() { return []; }
export async function getEvents() { return []; }
export async function addGame() { return 'game-1'; }
export async function updateGame() {}
export async function updateTeam() {}
export async function deleteGame() {}
export async function addPractice() { return 'practice-1'; }
export async function updateEvent() {}
export async function deleteEvent() {}
export async function getConfigs() { return []; }
export async function addCalendarToTeam() {}
export async function removeCalendarFromTeam() {}
export async function getTrackedCalendarEventUids() { return []; }
export async function cancelOccurrence() {}
export async function updateOccurrence() {}
export async function restoreOccurrence() {}
export async function clearOccurrenceOverride() {}
export async function updateSeries() {}
export async function deleteSeries() {}
export async function getUnreadChatCount() { return 0; }
export async function getPracticeSessions() { return []; }
export async function cancelGame() { return { cancelled: false }; }
export async function getLatestGameAssignments() { return {}; }
export async function postChatMessage() {}
export async function getRsvpBreakdownByPlayer() { return {}; }
`;

const UTILS_STUB = `
const calendarEvents = [
    {
        uid: 'cancelled-game-1',
        dtstart: new Date('2026-03-05T18:00:00.000Z'),
        summary: 'Wildcats vs Cancelled Lions',
        location: 'Field 1',
        status: 'CANCELLED',
        isPractice: false
    },
    {
        uid: 'cancelled-practice-1',
        dtstart: new Date('2026-03-06T17:30:00.000Z'),
        summary: '[CANCELED] Team Practice',
        location: 'Main Gym',
        isPractice: true
    }
];

export function renderHeader() {}
export function renderFooter() {}
export function getUrlParams() {
    return { teamId: 'team-1' };
}
export function formatDate(date) {
    return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC'
    });
}
export function formatShortDate(date) {
    return formatDate(date);
}
export function formatTime(date) {
    return new Date(date).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC'
    });
}
export function formatTimeRange(start, end) {
    return end ? formatTime(start) + ' - ' + formatTime(end) : formatTime(start);
}
export function getDefaultEndTime() {
    return '19:00';
}
export async function fetchAndParseCalendar() {
    return calendarEvents;
}
export function extractOpponent(summary, teamName = '') {
    const cleaned = String(summary || '').replace(/^\s*\[(?:CANCELED|CANCELLED)\]\s*/i, '');
    return cleaned.replace(new RegExp('^' + teamName + '\\s+vs\\.?\\s+', 'i'), '');
}
export function isPracticeEvent(summary) {
    return /practice|training|skills club/i.test(summary || '');
}
export function getCalendarEventStatus(event) {
    const status = String(event?.status || '').trim().toUpperCase();
    if (status === 'CANCELLED' || status === 'CANCELED') return 'cancelled';
    return /\[(?:CANCELED|CANCELLED)\]/i.test(String(event?.summary || '')) ? 'cancelled' : 'scheduled';
}
export function getCalendarEventTrackingId(event) {
    return event?.id || event?.uid || '';
}
export function isTrackedCalendarEvent() {
    return false;
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
export async function shareOrCopy() {}
export function escapeHtml(value) {
    return String(value ?? '');
}
`;

const AUTH_STUB = `
export function checkAuth(callback) {
    callback({ uid: 'user-1', email: 'coach@example.com', displayName: 'Coach' });
}
`;

const TEAM_ADMIN_BANNER_STUB = `
export function renderTeamAdminBanner() {}
`;

const TEAM_ACCESS_STUB = `
export function getTeamAccessInfo() {
    return { hasAccess: true, accessLevel: 'full' };
}
`;

const LIVE_GAME_STATE_STUB = `
export function resolvePreferredStatConfigId() {
    return null;
}
`;

const CANCEL_GAME_STUB = `
export async function cancelScheduledGame() {
    return { cancelled: false, notificationError: null };
}
`;

const PRACTICE_PAYLOAD_STUB = `
export function applyPracticeRecurrenceFields(payload) {
    return payload;
}
`;

const PRACTICE_SUBMIT_STUB = `
export async function savePracticeForm() {
    return { success: true };
}
`;

const FIREBASE_STUB = `
export const Timestamp = {
    fromDate(date) {
        return { toDate: () => date };
    }
};
export function deleteField() {
    return Symbol('deleteField');
}
`;

const FIREBASE_APP_STUB = `
export function getApp() {
    return {};
}
`;

const FIREBASE_AI_STUB = `
export class GoogleAIBackend {}
export const Schema = {
    object(value) { return value; },
    array(value) { return value; },
    string() { return { type: 'string' }; },
    number() { return { type: 'number' }; },
    boolean() { return { type: 'boolean' }; }
};
export function getAI() {
    return {};
}
export function getGenerativeModel() {
    return {
        async generateContent() {
            return {
                response: {
                    text() {
                        return '{}';
                    }
                }
            };
        }
    };
}
`;

const TOURNAMENT_STUB = `
export function collectTournamentAdvancementPatches() {
    return [];
}
export function describeTournamentSource() {
    return '';
}
`;

const SCHEDULE_NOTIFICATIONS_STUB = `
export function normalizeScheduleNotificationSettings(settings = {}) {
    return { enabled: false, reminderHours: 24, ...settings };
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
`;

const SCHEDULE_CSV_IMPORT_STUB = `
export const SCHEDULE_CSV_IMPORT_FIELDS = [];
export function buildScheduleImportPreview() {
    return [];
}
export function inferScheduleCsvMapping() {
    return {};
}
export function normalizeScheduleImportDraft() {
    return {};
}
export function parseCsvText() {
    return [];
}
`;

async function mockEditScheduleDependencies(page) {
    await page.route('**/js/db.js?v=20', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: DB_STUB }));
    await page.route('**/js/utils.js?v=10', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: UTILS_STUB }));
    await page.route('**/js/auth.js?v=10', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: AUTH_STUB }));
    await page.route('**/js/team-admin-banner.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ADMIN_BANNER_STUB }));
    await page.route('**/js/team-access.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TEAM_ACCESS_STUB }));
    await page.route('**/js/live-game-state.js?v=3', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: LIVE_GAME_STATE_STUB }));
    await page.route('**/js/edit-schedule-cancel-game.js?v=1', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: CANCEL_GAME_STUB }));
    await page.route('**/js/edit-schedule-practice-payload.js?v=1', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: PRACTICE_PAYLOAD_STUB }));
    await page.route('**/js/edit-schedule-practice-submit.js?v=1', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: PRACTICE_SUBMIT_STUB }));
    await page.route('**/js/firebase.js?v=10', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_STUB }));
    await page.route('**/js/vendor/firebase-app.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_APP_STUB }));
    await page.route('**/js/vendor/firebase-ai.js', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_AI_STUB }));
    await page.route('**/js/tournament-brackets.js?v=1', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: TOURNAMENT_STUB }));
    await page.route('**/js/schedule-notifications.js?v=1', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: SCHEDULE_NOTIFICATIONS_STUB }));
    await page.route('**/js/schedule-csv-import.js?v=2', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: SCHEDULE_CSV_IMPORT_STUB }));
}

test('cancelled imported calendar events stay visible but hide track and plan actions', async ({ page, baseURL }) => {
    await mockEditScheduleDependencies(page);
    const issues = createBootIssueCollector(page, { baseURL });

    await page.goto(buildUrl(baseURL, '/edit-schedule.html#teamId=team-1'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#schedule-list')).toBeVisible();

    const cancelledGameRow = page.locator('#schedule-list > div', { hasText: 'Cancelled Lions' });
    const cancelledPracticeRow = page.locator('#schedule-list > div', { hasText: 'Team Practice' });

    await expect(cancelledGameRow).toContainText('Cancelled');
    await expect(cancelledPracticeRow).toContainText('Cancelled');

    await expect(cancelledGameRow.locator('.line-through')).toHaveCount(2);
    await expect(cancelledPracticeRow.locator('.line-through')).toHaveCount(2);

    await expect(cancelledGameRow.getByRole('button', { name: 'Track' })).toHaveCount(0);
    await expect(cancelledPracticeRow.getByRole('link', { name: 'Plan Practice' })).toHaveCount(0);

    await expect(page.getByRole('button', { name: 'Track' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Plan Practice' })).toHaveCount(0);

    expect(issues).toEqual([]);
});
