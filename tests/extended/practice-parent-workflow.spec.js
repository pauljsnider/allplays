const { test, expect } = require('@playwright/test');

const FUTURE_START_ISO = '2099-05-18T18:00:00.000Z';
const FUTURE_END_ISO = '2099-05-18T19:30:00.000Z';
const FUTURE_START_B_ISO = '2099-05-19T18:00:00.000Z';
const PAST_START_ISO = '2000-03-02T17:00:00.000Z';

const sharedNoopModules = {
  gtmRoute: 'https://www.googletagmanager.com/**',
  firebaseSource: String.raw`
export const Timestamp = {
  fromDate(value) {
    return {
      _value: value,
      toDate() {
        return value;
      }
    };
  }
};
`,
  firebaseAppSource: String.raw`
export function getApp() {
  return {};
}
`,
  firebaseAiSource: String.raw`
export const GoogleAIBackend = {};
export const Schema = {};
export function getAI() {
  return {};
}
export function getGenerativeModel() {
  return {};
}
`
};

async function installSchedulePracticeMocks(page, state = {}) {
  await page.addInitScript((initState) => {
    window.__practiceWorkflowState = initState;
    window.__practiceWorkflowCalls = {
      getPracticeSessions: []
    };
  }, state);

  const authSource = String.raw`
const getState = () => globalThis.__practiceWorkflowState || {};

export function checkAuth(callback) {
  const user = getState().user || {
    uid: 'coach-1',
    email: 'coach@example.com'
  };
  setTimeout(() => callback(user), 0);
  return () => {};
}
`;

  const dbSource = String.raw`
const getState = () => globalThis.__practiceWorkflowState || {};
const calls = () => globalThis.__practiceWorkflowCalls || { getPracticeSessions: [] };

export async function getTeam(teamId) {
  return getState().team || {
    id: teamId,
    ownerId: 'coach-1',
    name: 'All Stars',
    sport: 'Soccer',
    adminEmails: [],
    calendarUrls: []
  };
}

export async function getTeams() {
  return getState().teams || [];
}

export async function getGames() {
  return [];
}

export async function getEvents() {
  return getState().events || [];
}

export async function addGame() { return 'game-new'; }
export async function updateGame() {}
export async function deleteGame() {}
export async function addPractice() { return 'practice-new'; }
export async function updateEvent() {}
export async function deleteEvent() {}

export async function getConfigs() {
  return getState().configs || [];
}

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

export async function getPracticeSessions(teamId) {
  calls().getPracticeSessions.push({ teamId });
  return getState().practiceSessions || [];
}

export async function cancelGame() {}
export async function getLatestGameAssignments() { return []; }
export async function postChatMessage() {}
export async function getRsvpBreakdownByPlayer() {
  return {
    grouped: { going: [], maybe: [], not_going: [], not_responded: [] },
    counts: { going: 0, maybe: 0, notGoing: 0, notResponded: 0 }
  };
}
`;

  const utilsSource = String.raw`
export function renderHeader(container) {
  if (container) container.setAttribute('data-rendered', 'header');
}

export function renderFooter(container) {
  if (container) container.setAttribute('data-rendered', 'footer');
}

export function getUrlParams() {
  const raw = (window.location.hash || '').replace(/^#/, '');
  return Object.fromEntries(new URLSearchParams(raw));
}

export function formatDate(value) {
  const d = value?.toDate ? value.toDate() : new Date(value);
  return d.toISOString().slice(0, 10);
}

export function formatShortDate(value) {
  return formatDate(value);
}

export function formatTime(value) {
  const d = value?.toDate ? value.toDate() : new Date(value);
  return d.toISOString().slice(11, 16);
}

export function formatTimeRange(start, end) {
  if (!start || !end) return '';
  return formatTime(start) + ' - ' + formatTime(end);
}

export function getDefaultEndTime() {
  return '19:00';
}

export async function fetchAndParseCalendar() {
  return [];
}

export function extractOpponent(summary) {
  return String(summary || '').replace(/^vs\.?\s*/i, '').trim() || 'Opponent';
}

export function isPracticeEvent(summary) {
  return /practice/i.test(String(summary || ''));
}

export function generateSeriesId() {
  return 'series-1';
}

export function expandRecurrence() {
  return [];
}

export function formatRecurrence() {
  return 'Weekly';
}

export async function shareOrCopy() {
  return { status: 'copied' };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
`;

  const teamAdminBannerSource = String.raw`
export function renderTeamAdminBanner(container) {
  if (container) container.setAttribute('data-rendered', 'team-banner');
}
`;

  await page.route(/\/js\/auth\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: authSource });
  });
  await page.route(/\/js\/db\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: dbSource });
  });
  await page.route(/\/js\/utils\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: utilsSource });
  });
  await page.route(/\/js\/team-admin-banner\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: teamAdminBannerSource });
  });
  await page.route(/\/js\/firebase\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: sharedNoopModules.firebaseSource });
  });
  await page.route(/\/js\/vendor\/firebase-app\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: sharedNoopModules.firebaseAppSource });
  });
  await page.route(/\/js\/vendor\/firebase-ai\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: sharedNoopModules.firebaseAiSource });
  });
  await page.route(sharedNoopModules.gtmRoute, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
}

async function gotoSchedule(page, state = {}) {
  await installSchedulePracticeMocks(page, state);
  await page.goto('/edit-schedule.html#teamId=team-a');
  await expect(page.locator('#team-name-display')).toHaveText(/All Stars/);
}

async function showUpcomingPractices(page) {
  await page.locator('button[data-schedule-filter="upcoming-practices"]').click();
}

async function installDrillsMocks(page, state = {}) {
  await page.addInitScript((initState) => {
    window.__drillsWorkflowState = initState;
    window.__drillsWorkflowCalls = {
      upsertPracticeSessionForEvent: [],
      updatePracticeAttendance: []
    };
  }, state);

  const authSource = String.raw`
const getState = () => globalThis.__drillsWorkflowState || {};

export async function requireAuth() {
  return getState().user || {
    uid: 'coach-1',
    email: 'coach@example.com'
  };
}
`;

  const teamAdminBannerSource = String.raw`
export function renderTeamAdminBanner(container) {
  if (container) container.setAttribute('data-rendered', 'team-banner');
}

export function getTeamAccessInfo() {
  return { hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' };
}
`;

  const drillConstantsSource = String.raw`
export const DRILL_TYPES = ['Technical', 'Tactical', 'Game'];
export const DRILL_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
export const DRILL_TYPE_COLORS = { Technical: 'blue', Tactical: 'amber', Game: 'emerald' };
export function getAllSkillTags() { return ['Passing', 'Shooting']; }
`;

  const dbSource = String.raw`
const getState = () => globalThis.__drillsWorkflowState || {};
const calls = () => globalThis.__drillsWorkflowCalls || { upsertPracticeSessionForEvent: [], updatePracticeAttendance: [] };

function toDate(value) {
  if (!value) return new Date();
  if (value.toDate) return value.toDate();
  return new Date(value);
}

function buildSessionPayload(eventId, payload) {
  return {
    id: getState().createdSessionId || 'session-created',
    eventId,
    homePacketGenerated: false,
    homePacketContent: { blocks: [] },
    ...payload,
    date: payload.date || new Date(),
    blocks: Array.isArray(payload.blocks) ? payload.blocks : [],
    attendance: payload.attendance || null
  };
}

export async function getTeam(teamId) {
  return getState().team || { id: teamId, ownerId: 'coach-1', name: 'All Stars', sport: 'Soccer', adminEmails: [] };
}

export async function getGames() { return []; }
export async function getPlayers() { return getState().players || []; }
export async function getUserProfile() { return getState().profile || {}; }
export async function getGameEvents() { return []; }
export async function getAggregatedStatsForGames() { return []; }
export async function getDrills() { return []; }
export async function getTeamDrills() { return []; }
export async function getDrill() { return null; }
export async function createDrill() { return 'drill-1'; }
export async function updateDrill() {}
export async function deleteDrill() {}
export async function uploadDrillDiagram() { return null; }
export async function getDrillFavorites() { return []; }
export async function addDrillFavorite() {}
export async function removeDrillFavorite() {}
export async function createPracticeSession() { return 'session-ad-hoc'; }
export async function updatePracticeSession() {}

export async function getPracticeSessionByEvent(_teamId, eventId) {
  const byEvent = getState().existingSessionByEvent || {};
  return byEvent[eventId] || null;
}

export async function upsertPracticeSessionForEvent(teamId, eventId, payload) {
  calls().upsertPracticeSessionForEvent.push({ teamId, eventId, payload });
  const created = buildSessionPayload(eventId, payload);
  const byEvent = getState().existingSessionByEvent || {};
  byEvent[eventId] = created;
  getState().existingSessionByEvent = byEvent;
  return created.id;
}

export async function updatePracticeAttendance(teamId, sessionId, attendance) {
  calls().updatePracticeAttendance.push({ teamId, sessionId, attendance });
}

export async function getPracticeSessions() {
  return getState().practiceSessions || [];
}

export async function getPracticePacketCompletions(_teamId, sessionId) {
  const map = getState().packetCompletionsBySessionId || {};
  return map[sessionId] || [];
}

export async function savePracticeTemplate() {}
export async function getPracticeTemplates() { return []; }
export async function deletePracticeTemplate() {}
`;

  const utilsSource = String.raw`
export function renderHeader(container) {
  if (container) container.setAttribute('data-rendered', 'header');
}

export function renderFooter(container) {
  if (container) container.setAttribute('data-rendered', 'footer');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function shareOrCopy() {
  return { status: 'copied' };
}
`;

  await page.route(/\/js\/auth\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: authSource });
  });
  await page.route(/\/js\/db\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: dbSource });
  });
  await page.route(/\/js\/utils\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: utilsSource });
  });
  await page.route(/\/js\/team-admin-banner\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: teamAdminBannerSource });
  });
  await page.route(/\/js\/drill-constants\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: drillConstantsSource });
  });
  await page.route(/\/js\/vendor\/firebase-app\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: sharedNoopModules.firebaseAppSource });
  });
  await page.route(/\/js\/vendor\/firebase-ai\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: sharedNoopModules.firebaseAiSource });
  });
  await page.route(sharedNoopModules.gtmRoute, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
}

async function gotoDrills(page, state = {}, hash = 'teamId=team-a&eventId=practice-1&source=edit-schedule&eventDate=2099-05-18&eventDuration=75&eventTitle=Evening%20Practice') {
  await installDrillsMocks(page, state);
  await page.goto(`/drills.html#${hash}`);
  await expect(page.locator('#main-content')).toBeVisible();
}

async function installParentDashboardMocks(page, state = {}) {
  await page.addInitScript((initState) => {
    window.__parentWorkflowState = initState;
    window.__parentWorkflowCalls = {
      upsertPracticePacketCompletion: [],
      updateUserProfile: []
    };
  }, state);

  const authSource = String.raw`
const getState = () => globalThis.__parentWorkflowState || {};

export async function requireAuth() {
  return getState().user || {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Parent One'
  };
}

export function checkAuth(callback) {
  setTimeout(() => callback(getState().user || {
    uid: 'parent-1',
    email: 'parent@example.com',
    displayName: 'Parent One'
  }), 0);
}
`;

  const dbSource = String.raw`
const getState = () => globalThis.__parentWorkflowState || {};
const calls = () => globalThis.__parentWorkflowCalls || { upsertPracticePacketCompletion: [], updateUserProfile: [] };

export async function getParentDashboardData() {
  return { children: getState().children || [] };
}

export async function redeemParentInvite() {}

export async function getTeam(teamId) {
  const map = getState().teamsById || {};
  return map[teamId] || { id: teamId, name: 'All Stars', calendarUrls: [] };
}

export async function getGames(teamId) {
  const map = getState().gamesByTeamId || {};
  return map[teamId] || [];
}

export async function getTrackedCalendarEventUids() { return []; }

export async function getUnreadChatCounts() {
  return getState().unreadByTeam || {};
}

export async function getPracticeSessions(teamId) {
  const map = getState().practiceSessionsByTeamId || {};
  return map[teamId] || [];
}

export async function getPracticePacketCompletions(teamId, sessionId) {
  const byTeam = getState().practicePacketCompletions || {};
  const key = teamId + '::' + sessionId;
  return byTeam[key] || [];
}

export async function upsertPracticePacketCompletion(teamId, sessionId, payload) {
  calls().upsertPracticePacketCompletion.push({ teamId, sessionId, payload });
}

export async function updateUserProfile(userId, payload) {
  calls().updateUserProfile.push({ userId, payload });
}

export async function getUserProfile() {
  return getState().profile || {
    parentTeamIds: [],
    parentOf: []
  };
}

export async function submitRsvp() {
  return { going: 0, maybe: 0, notGoing: 0, notResponded: 0, total: 0 };
}

export async function getMyRsvp() {
  return null;
}
`;

  const utilsSource = String.raw`
export function renderHeader(container) {
  if (container) container.setAttribute('data-rendered', 'header');
}

export function renderFooter(container) {
  if (container) container.setAttribute('data-rendered', 'footer');
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function fetchAndParseCalendar() {
  return [];
}

export function extractOpponent(summary) {
  return String(summary || '').replace(/^vs\.?\s*/i, '').trim() || 'Opponent';
}

export function isPracticeEvent(summary) {
  return /practice/i.test(String(summary || ''));
}
`;

  await page.route(/\/js\/auth\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: authSource });
  });
  await page.route(/\/js\/db\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: dbSource });
  });
  await page.route(/\/js\/utils\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: utilsSource });
  });
  await page.route(sharedNoopModules.gtmRoute, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
}

async function gotoParentDashboard(page, state = {}) {
  await installParentDashboardMocks(page, state);
  await page.goto('/parent-dashboard.html');
  await expect(page.locator('#schedule-list')).toContainText(/All Stars|No events/);
}

test.describe('Practice + parent workflow suite @extended', () => {
  test.describe('Schedule linkage coverage', () => {
    test('practice rows expose Plan Practice link with event context params', async ({ page }) => {
      await gotoSchedule(page, {
        events: [
          {
            id: 'practice-1',
            type: 'practice',
            title: 'Evening Practice',
            date: FUTURE_START_ISO,
            end: FUTURE_END_ISO,
            location: 'Main Gym'
          }
        ],
        practiceSessions: []
      });

      await showUpcomingPractices(page);

      const href = await page.locator('a', { hasText: 'Plan Practice' }).first().getAttribute('href');
      expect(href).toContain('drills.html#');
      expect(href).toContain('teamId=team-a');
      expect(href).toContain('eventId=practice-1');
      expect(href).toContain('source=edit-schedule');
      expect(href).toContain('eventDate=2099-05-18');
      expect(href).toContain('eventDuration=90');
    });

    test('practice row shows no linked plan summary when no event session exists', async ({ page }) => {
      await gotoSchedule(page, {
        events: [
          {
            id: 'practice-1',
            type: 'practice',
            title: 'Evening Practice',
            date: FUTURE_START_ISO,
            end: FUTURE_END_ISO,
            location: 'Main Gym'
          }
        ],
        practiceSessions: []
      });

      await showUpcomingPractices(page);
      await expect(page.locator('#schedule-list')).toContainText('No linked practice plan yet');
    });

    test('practice row shows linked status + block count + duration summary', async ({ page }) => {
      await gotoSchedule(page, {
        events: [
          {
            id: 'practice-1',
            type: 'practice',
            title: 'Evening Practice',
            date: FUTURE_START_ISO,
            end: FUTURE_END_ISO,
            location: 'Main Gym'
          }
        ],
        practiceSessions: [
          {
            id: 'session-1',
            eventId: 'practice-1',
            status: 'active',
            duration: 80,
            blocks: [{ id: 'b1' }, { id: 'b2' }]
          }
        ]
      });

      await showUpcomingPractices(page);
      await expect(page.locator('#schedule-list')).toContainText('active');
      await expect(page.locator('#schedule-list')).toContainText('Plan: 2 blocks • 80 min');
    });

    test('upcoming-practices filter excludes game rows and keeps practice rows', async ({ page }) => {
      await gotoSchedule(page, {
        events: [
          {
            id: 'game-1',
            type: 'game',
            opponent: 'Rockets',
            date: FUTURE_START_ISO,
            location: 'Court 1',
            status: 'scheduled'
          },
          {
            id: 'practice-1',
            type: 'practice',
            title: 'Evening Practice',
            date: FUTURE_START_B_ISO,
            end: FUTURE_END_ISO,
            location: 'Main Gym'
          }
        ],
        practiceSessions: []
      });

      await showUpcomingPractices(page);

      await expect(page.locator('#schedule-list')).toContainText('Evening Practice');
      await expect(page.locator('#schedule-list')).not.toContainText('vs. Rockets');
    });
  });

  test.describe('Drills event session + attendance coverage', () => {
    test('event-linked drills load locks session date and creates missing event session', async ({ page }) => {
      await gotoDrills(page, {
        players: [
          { id: 'p1', name: 'Ava' },
          { id: 'p2', name: 'Mia' }
        ],
        existingSessionByEvent: {}
      });

      await expect(page.locator('#session-date')).toBeDisabled();
      await expect(page.locator('#session-date')).toHaveValue('2099-05-18');

      const calls = await page.evaluate(() => window.__drillsWorkflowCalls.upsertPracticeSessionForEvent);
      expect(calls).toHaveLength(1);
      expect(calls[0].eventId).toBe('practice-1');
      expect(calls[0].payload.title).toBe('Evening Practice');
      expect(calls[0].payload.duration).toBe(75);
    });

    test('existing event session hydrates attendance counts from persisted data', async ({ page }) => {
      await gotoDrills(page, {
        players: [
          { id: 'p1', name: 'Ava' },
          { id: 'p2', name: 'Mia' }
        ],
        existingSessionByEvent: {
          'practice-2': {
            id: 'session-2',
            eventId: 'practice-2',
            date: FUTURE_START_ISO,
            duration: 60,
            blocks: [],
            attendance: {
              rosterSize: 2,
              checkedInCount: 1,
              players: [
                { playerId: 'p1', displayName: 'Ava', status: 'present' },
                { playerId: 'p2', displayName: 'Mia', status: 'absent' }
              ]
            }
          }
        }
      }, 'teamId=team-a&eventId=practice-2&source=edit-schedule&eventDate=2099-05-18&eventDuration=60&eventTitle=Practice%202');

      await expect(page.locator('#attendance-count')).toHaveText('1 / 2 checked in');
      await expect(page.locator('#practice-attendance-summary')).toHaveText('Checked in: 1/2');
    });

    test('attendance status changes persist via updatePracticeAttendance call', async ({ page }) => {
      await gotoDrills(page, {
        players: [
          { id: 'p1', name: 'Ava' },
          { id: 'p2', name: 'Mia' }
        ],
        existingSessionByEvent: {
          'practice-3': {
            id: 'session-3',
            eventId: 'practice-3',
            date: FUTURE_START_ISO,
            duration: 60,
            blocks: [],
            attendance: {
              rosterSize: 2,
              checkedInCount: 2,
              players: [
                { playerId: 'p1', displayName: 'Ava', status: 'present' },
                { playerId: 'p2', displayName: 'Mia', status: 'present' }
              ]
            }
          }
        }
      }, 'teamId=team-a&eventId=practice-3&source=edit-schedule&eventDate=2099-05-18&eventDuration=60&eventTitle=Practice%203');

      await page.locator('[data-player-id="p2"] button', { hasText: 'Absent' }).click();

      await expect(page.locator('#attendance-count')).toHaveText('1 / 2 checked in');
      const calls = await page.evaluate(() => window.__drillsWorkflowCalls.updatePracticeAttendance);
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[calls.length - 1].sessionId).toBe('session-3');
      const updatedPlayer = calls[calls.length - 1].attendance.players.find((p) => p.playerId === 'p2');
      expect(updatedPlayer.status).toBe('absent');
    });

    test('home packet panel shows parent completion rollup for matching session', async ({ page }) => {
      await gotoDrills(page, {
        players: [
          { id: 'p1', name: 'Ava' },
          { id: 'p2', name: 'Mia' }
        ],
        existingSessionByEvent: {
          'practice-4': {
            id: 'session-4',
            eventId: 'practice-4',
            date: FUTURE_START_ISO,
            duration: 60,
            blocks: [],
            attendance: {
              rosterSize: 2,
              checkedInCount: 2,
              players: [
                { playerId: 'p1', displayName: 'Ava', status: 'present' },
                { playerId: 'p2', displayName: 'Mia', status: 'present' }
              ]
            },
            homePacketGenerated: true,
            homePacketContent: {
              blocks: [
                { drillTitle: 'Passing Circuit', type: 'Technical', duration: 20, description: 'Wall passing' }
              ]
            }
          }
        },
        packetCompletionsBySessionId: {
          'session-4': [
            { childId: 'p1', childName: 'Ava', status: 'completed' }
          ]
        }
      }, 'teamId=team-a&eventId=practice-4&source=edit-schedule&eventDate=2099-05-18&eventDuration=60&eventTitle=Practice%204');

      await page.getByRole('button', { name: 'Home Packet' }).click();
      await expect(page.locator('#home-packet-completion-summary')).toHaveText('Parent completions: 1 (Ava)');
    });
  });

  test.describe('Parent dashboard packet + filter coverage', () => {
    const parentState = {
      user: {
        uid: 'parent-1',
        email: 'parent@example.com',
        displayName: 'Parent One'
      },
      profile: {
        parentTeamIds: ['team-a'],
        parentOf: [{ teamId: 'team-a', playerId: 'p1', playerName: 'Ava' }]
      },
      children: [
        {
          teamId: 'team-a',
          teamName: 'All Stars',
          playerId: 'p1',
          playerName: 'Ava',
          childId: 'p1'
        }
      ],
      teamsById: {
        'team-a': { id: 'team-a', name: 'All Stars', calendarUrls: [] }
      },
      gamesByTeamId: {
        'team-a': [
          {
            id: 'game-1',
            type: 'game',
            date: FUTURE_START_ISO,
            opponent: 'Rockets',
            location: 'Court 1',
            status: 'scheduled'
          },
          {
            id: 'practice-1',
            type: 'practice',
            title: 'Evening Practice',
            date: FUTURE_START_B_ISO,
            end: FUTURE_END_ISO,
            location: 'Main Gym',
            status: 'scheduled'
          },
          {
            id: 'game-old',
            type: 'game',
            date: PAST_START_ISO,
            opponent: 'Old Team',
            location: 'Old Gym',
            status: 'completed'
          }
        ]
      },
      practiceSessionsByTeamId: {
        'team-a': [
          {
            id: 'session-1',
            eventId: 'practice-1',
            title: 'Evening Practice',
            date: FUTURE_START_B_ISO,
            location: 'Main Gym',
            homePacketGenerated: true,
            homePacketContent: {
              blocks: [
                { drillTitle: 'Passing Circuit', type: 'Technical', duration: 20, description: 'Wall passing' }
              ],
              totalMinutes: 20
            },
            attendance: {
              rosterSize: 2,
              checkedInCount: 1,
              editedAt: FUTURE_START_B_ISO,
              players: [
                { playerId: 'p1', status: 'present' },
                { playerId: 'p2', status: 'absent' }
              ]
            }
          }
        ]
      },
      practicePacketCompletions: {
        'team-a::session-1': []
      }
    };

    test('upcoming-games filter keeps only game cards', async ({ page }) => {
      await gotoParentDashboard(page, parentState);

      await page.locator('#schedule-filter-upcoming-games').click();
      await expect(page.locator('#schedule-list')).toContainText('Game');
      await expect(page.locator('#schedule-list')).not.toContainText('Practice');
    });

    test('upcoming-practices filter keeps only practice cards', async ({ page }) => {
      await gotoParentDashboard(page, parentState);

      await page.locator('#schedule-filter-upcoming-practices').click();
      await expect(page.locator('#schedule-list')).toContainText('Practice');
      await expect(page.locator('#schedule-list')).not.toContainText('Game');
    });

    test('practice packet card renders attendance + packet row with Mark Complete action', async ({ page }) => {
      await gotoParentDashboard(page, parentState);

      await expect(page.locator('#practice-packets-card')).toContainText('Practice Attendance & Home Packet');
      await expect(page.locator('#practice-packets-list')).toContainText('Home Packet: 1 drill · 20 min');
      await expect(page.locator('#practice-packets-list')).toContainText('Attendance: 1/2 present');
      await expect(page.locator('#practice-packets-list')).toContainText('Mark Complete: Ava');
    });

    test('mark complete updates packet row state and records completion write call', async ({ page }) => {
      await gotoParentDashboard(page, parentState);

      await page.locator('#practice-packets-list button', { hasText: 'Mark Complete: Ava' }).click();

      await expect(page.locator('#practice-packets-list')).toContainText('Completed: Ava');
      await expect(page.locator('#practice-packets-list')).toContainText('Packet Completed: 1/1');

      const calls = await page.evaluate(() => window.__parentWorkflowCalls.upsertPracticePacketCompletion);
      expect(calls).toHaveLength(1);
      expect(calls[0].teamId).toBe('team-a');
      expect(calls[0].sessionId).toBe('session-1');
      expect(calls[0].payload.childId).toBe('p1');
    });
  });
});
