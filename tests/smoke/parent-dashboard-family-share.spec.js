import { test, expect } from '@playwright/test';

const children = [
    { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9' },
    { teamId: 'team-2', teamName: 'Hawks', playerId: 'player-2', playerName: 'Sam Wing', playerNumber: '12' }
];

const dbStub = `
const children = ${JSON.stringify(children)};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export async function getParentDashboardData() {
    return { children: clone(children), dashboardState: null, registrationApplications: [] };
}
export async function redeemParentInvite() {}
export async function getTeam(teamId) { return { id: teamId, name: teamId }; }
export async function getTeams() { return []; }
export async function getPlayers() { return []; }
export async function getGames() { return []; }
export async function getTrackedCalendarEventUids() { return []; }
export async function getUnreadChatCounts() { return {}; }
export async function getPracticeSessions() { return []; }
export async function getPracticePacketCompletions() { return {}; }
export async function upsertPracticePacketCompletion() {}
export async function updateUserProfile() {}
export async function getUserProfile() { return { parentOf: clone(children) }; }
export async function submitRsvp() {}
export async function submitRsvpForPlayer() {}
export async function getRsvps() { return []; }
export async function getRsvpSummaries() { return new Map(); }
export async function createRideOffer() {}
export async function listRideOffersForEvent() { return []; }
export async function requestRideSpot() {}
export async function updateRideRequestStatus() {}
export async function closeRideOffer() {}
export async function cancelRideRequest() {}
export async function getAggregatedStatsForPlayer() { return {}; }
export async function createParentMembershipRequest() {}
export async function listMyParentMembershipRequests() { return []; }
export async function listParentTeamFeeRecipients() { return []; }
export async function listCertificatesForPlayer() { return []; }
export async function claimAssignmentSlot() {}
export async function releaseAssignmentClaim() {}
export async function getAssignmentClaims() { return {}; }
export async function inviteCoParentToAthlete() { return { code: 'COPARENT1' }; }
export async function createFamilyShareToken(ownerUserId, tokenChildren, label, extraCalendarUrls) {
    window.__familyShareWorkflow.creates.push({
        ownerUserId,
        children: clone(tokenChildren),
        label,
        extraCalendarUrls: clone(extraCalendarUrls)
    });
    window.__familyShareWorkflow.createdToken = {
        id: 'token-created',
        label,
        children: clone(tokenChildren),
        extraCalendarUrls: clone(extraCalendarUrls),
        createdAt: new Date('2026-07-05T12:00:00Z')
    };
    return 'token-created';
}
export async function listFamilyShareTokens(ownerUserId) {
    window.__familyShareWorkflow.listCalls.push(ownerUserId);
    return window.__familyShareWorkflow.createdToken ? [clone(window.__familyShareWorkflow.createdToken)] : [];
}
export async function revokeFamilyShareToken() {}
export async function updateFamilyShareTokenCalendars() {}
`;

const utilsStub = `
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
export async function fetchAndParseCalendar() { return []; }
export function extractOpponent(event) { return event?.opponent || ''; }
export function isPracticeEvent(event) { return event?.type === 'practice'; }
export function expandRecurrence(events = []) { return events; }
export function getCalendarEventTrackingId(event) { return event?.id || ''; }
export function isTrackedCalendarEvent() { return false; }
`;

const authStub = `
export async function requireAuth() {
    return { uid: 'parent-1', email: 'parent@example.test', displayName: 'Parent Test' };
}
export function checkAuth(callback) {
    callback({ uid: 'parent-1', email: 'parent@example.test', displayName: 'Parent Test' });
}
`;

const parentIncentivesStub = `
export async function getIncentiveRules() { return []; }
export async function saveIncentiveRule() {}
export async function toggleIncentiveRule() {}
export async function retireIncentiveRule() {}
export async function markGamePaid() {}
export async function unmarkGamePaid() {}
export async function getPaidGames() { return []; }
export function calculateEarnings() { return { totalCents: 0, rows: [] }; }
export function formatCents(cents = 0) { return '$' + (cents / 100).toFixed(2); }
export function getApplicableRulesForGame() { return []; }
export function getStatOptionsForTeam() { return []; }
export function renderIncentivesPanel() { return ''; }
export function renderRuleBuilder() { return ''; }
export function getCapSetting() { return null; }
export async function saveCapSetting() {}
`;

async function mockParentDashboardModules(page) {
    await page.addInitScript(() => {
        window.__familyShareWorkflow = { creates: [], listCalls: [], alerts: [], copied: [], createdToken: null };
        window.alert = (message) => window.__familyShareWorkflow.alerts.push(String(message));
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async (value) => window.__familyShareWorkflow.copied.push(String(value))
            }
        });
    });

    await page.route(/https:\/\/www\.googletagmanager\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await page.route(/https:\/\/cdn\.tailwindcss\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await page.route(/\/js\/db\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: dbStub }));
    await page.route(/\/js\/utils\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: utilsStub }));
    await page.route(/\/js\/auth\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: authStub }));
    await page.route(/\/js\/parent-incentives\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: parentIncentivesStub }));
    await page.route(/\/js\/schedule-watch-cta\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function resolveScheduleWatchCta() { return null; }' }));
    await page.route(/\/js\/parent-dashboard-packets\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function resolvePracticePacketSessionIdForEvent() { return ""; } export function resolvePracticePacketContextForEvent() { return null; } export function getScopedPracticePacketRow(row) { return row; } export function buildPracticePacketCompletionPayload() { return {}; }' }));
    await page.route(/\/js\/parent-dashboard-practice-sessions\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function filterVisiblePracticeSessions(sessions = []) { return sessions; }' }));
    await page.route(/\/js\/parent-dashboard-rsvp\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function resolveRsvpPlayerIdsForSubmission() { return []; } export function resolveMyRsvpByChildForGame() { return {}; }' }));
    await page.route(/\/js\/parent-dashboard-rsvp-controls\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function createParentDashboardRsvpController() { return {}; }' }));
    await page.route(/\/js\/rideshare-helpers\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function getEventRideshareSummary() { return { seatsLeft: 0, requests: 0, isFull: false }; } export function getOfferSeatInfo() { return { seatCountConfirmed: 0, seatCapacity: 0, seatsLeft: 0 }; }' }));
    await page.route(/\/js\/snack-helpers\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function mergeAssignmentsWithClaims(assignments = []) { return assignments; }' }));
    await page.route(/\/js\/parent-dashboard-rideshare-controls\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function resolveSelectedRideChildId({ defaultChildId }) { return defaultChildId || ""; } export function getRideOfferUiState() { return { myRequest: null, canRequest: false, statusText: "" }; } export function createRideRequestHandlers() { return {}; }' }));
    await page.route(/\/js\/rsvp-hydration\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function applyRsvpHydration() {}' }));
    await page.route(/\/js\/parent-dashboard-fees\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function handleParentTeamFeeCheckoutClick() {} export function renderParentTeamFees() { return ""; }' }));
    await page.route(/\/js\/stripe-service\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export async function initiateTeamFeeCheckout() { return {}; }' }));
    await page.route(/\/js\/family-plan\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export async function renderFamilyPlanSection(el) { if (el) el.innerHTML = ""; }' }));
    await page.route(/\/js\/availability-preferences\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function buildAvailabilityNoteRows() { return []; } export function formatAvailabilityCutoff() { return ""; } export function isAvailabilityLocked() { return false; } export function normalizeAvailabilityPreferences(value = {}) { return value; }' }));
}

test('parent dashboard creates family share links with hydrated children and extra calendars', async ({ page, baseURL }) => {
    await mockParentDashboardModules(page);

    await page.goto(`${baseURL}/parent-dashboard.html`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#new-share-link-btn')).toBeEnabled();
    await expect(page.locator('#share-links-list')).toContainText('No active share links yet');

    await page.locator('#new-share-link-btn').click();
    await expect(page.locator('#share-link-form')).not.toHaveClass(/hidden/);
    await expect(page.locator('#share-link-player-summary')).toContainText('2 linked players');

    await page.locator('#share-link-label').fill('Grandparents');
    await page.locator('#share-form-calendar-input').fill('webcal://league.example.test/calendar.ics');
    await page.locator('#share-form-calendar-add-btn').click();
    await expect.poll(() => page.evaluate(() => window.__familyShareWorkflow.alerts)).toEqual([
        'Please enter a valid URL starting with http:// or https://'
    ]);
    await expect.poll(() => page.evaluate(() => window.__familyShareWorkflow.creates.length)).toBe(0);

    const extraCalendarUrl = 'https://league.example.test/calendar.ics';
    await page.locator('#share-form-calendar-input').fill(extraCalendarUrl);
    await page.locator('#share-form-calendar-add-btn').click();
    await page.locator('#share-form-calendar-input').fill(extraCalendarUrl);
    await page.locator('#share-form-calendar-add-btn').click();
    await expect(page.locator('#share-form-calendar-list').getByText(extraCalendarUrl)).toHaveCount(1);

    await page.locator('#create-share-link-btn').click();

    await expect.poll(() => page.evaluate(() => window.__familyShareWorkflow.creates)).toEqual([{
        ownerUserId: 'parent-1',
        children,
        label: 'Grandparents',
        extraCalendarUrls: [extraCalendarUrl]
    }]);
    await expect(page.locator('#share-link-form')).toHaveClass(/hidden/);
    await expect(page.locator('#share-form-calendar-list').getByText(extraCalendarUrl)).toHaveCount(0);
    await expect(page.locator('#share-link-label')).toHaveValue('');
    await expect(page.locator('#share-link-workflow-status')).toContainText('Link created and copied to clipboard.');
    await expect(page.locator('#share-links-list')).toContainText('Grandparents');
    await expect(page.locator('#share-links-list')).toContainText('Extra Calendars (1)');
    await expect(page.locator('#share-links-list a', { hasText: 'Open' })).toHaveAttribute('href', `${baseURL}/app/#/family/token-created`);
    await expect.poll(() => page.evaluate(() => window.__familyShareWorkflow.copied)).toEqual([
        `${baseURL}/app/#/family/token-created`
    ]);
    await expect.poll(() => page.evaluate(() => window.__familyShareWorkflow.listCalls.length)).toBeGreaterThanOrEqual(2);
});
