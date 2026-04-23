const { test, expect } = require('@playwright/test');

const FUTURE_ISO = '2099-05-18T18:00:00.000Z';

const authModuleSource = String.raw`
const getState = () => globalThis.__scheduleRoutingState || {};

export function checkAuth(callback) {
  const state = getState();
  setTimeout(() => callback(state.user || { uid: 'coach-1', email: 'coach@example.com' }), 0);
  return () => {};
}
`;

const dbModuleSource = String.raw`
const getState = () => globalThis.__scheduleRoutingState || {};

const getCalls = () => {
  if (!globalThis.__scheduleRoutingCalls) {
    globalThis.__scheduleRoutingCalls = {
      addGame: []
    };
  }
  return globalThis.__scheduleRoutingCalls;
};

export async function getTeam(teamId) {
  const state = getState();
  return state.team || { id: teamId, ownerId: 'coach-1', name: 'All Stars', sport: 'Soccer', adminEmails: [], calendarUrls: [] };
}

export async function getTeams() {
  return getState().teams || [];
}

export async function getGames() {
  return [];
}

export async function getEvents() {
  return getState().games || [];
}

export async function addGame(teamId, payload) {
  getCalls().addGame.push({ teamId, payload });
  return getState().addedGameId || 'added-game-1';
}

export async function updateGame() {}
export async function deleteGame() {}
export async function addPractice() {}
export async function updateEvent() {}
export async function deleteEvent() {}

export async function getConfigs() {
  return getState().configs || [];
}

export async function addCalendarToTeam() {}
export async function removeCalendarFromTeam() {}
export async function getTrackedCalendarEventUids() { return getState().trackedCalendarUids || []; }
export async function cancelOccurrence() {}
export async function updateOccurrence() {}
export async function restoreOccurrence() {}
export async function clearOccurrenceOverride() {}
export async function updateSeries() {}
export async function deleteSeries() {}
export async function getUnreadChatCount() { return 0; }
export async function getPracticeSessions() { return []; }
export async function cancelGame() {}
export async function getLatestGameAssignments() { return []; }
export async function postChatMessage() {}
export async function getRsvpBreakdownByPlayer() { return {}; }
`;

const utilsModuleSource = String.raw`
const getState = () => globalThis.__scheduleRoutingState || {};

export function renderHeader(container) {
  if (container) container.setAttribute('data-rendered', 'header');
}

export function renderFooter(container) {
  if (container) container.setAttribute('data-rendered', 'footer');
}

export function getUrlParams() {
  const hash = window.location.hash || '';
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  return Object.fromEntries(new URLSearchParams(raw));
}

export function formatDate(value) {
  const d = new Date(value);
  return d.toISOString().slice(0, 10);
}

export function formatShortDate(value) {
  return formatDate(value);
}

export function formatTime(value) {
  const d = new Date(value);
  return d.toISOString().slice(11, 16);
}

export function formatTimeRange(start, end) {
  return formatTime(start) + ' - ' + formatTime(end);
}

export function getDefaultEndTime() {
  return '19:00';
}

export async function fetchAndParseCalendar() {
  return getState().calendarEvents || [];
}

export function extractOpponent(summary, teamName) {
  if (!summary) return 'TBD';
  return summary.replace(teamName || '', '').replace(/vs\.?/i, '').trim() || 'Opponent';
}

export function isPracticeEvent(summary) {
  return /practice/i.test(String(summary || ''));
}

export function generateSeriesId() {
  return 'series-id';
}

export function expandRecurrence() {
  return [];
}

export function formatRecurrence() {
  return 'Weekly';
}

export async function shareOrCopy() {
  return true;
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

const firebaseModuleSource = String.raw`
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
`;

const firebaseAppSource = String.raw`
export function getApp() {
  return {};
}
`;

const firebaseAiSource = String.raw`
export const GoogleAIBackend = {};
export const Schema = {};
export function getAI() {
  return {};
}
export function getGenerativeModel() {
  return {};
}
`;

function buildState(overrides = {}) {
  return {
    user: { uid: 'coach-1', email: 'coach@example.com' },
    team: {
      id: 'team-a',
      ownerId: 'coach-1',
      name: 'All Stars',
      sport: 'Soccer',
      adminEmails: [],
      calendarUrls: []
    },
    configs: [
      { id: 'cfg-soccer', name: 'Soccer Standard', baseType: 'soccer' },
      { id: 'cfg-basketball', name: 'Basketball Standard', baseType: 'basketball' },
      { id: 'cfg-basketball-caps', name: 'Basketball Alt', baseType: 'BASKETBALL' }
    ],
    games: [
      {
        id: 'game-1',
        type: 'game',
        status: 'scheduled',
        opponent: 'Rockets',
        location: 'Main Gym',
        date: FUTURE_ISO,
        statTrackerConfigId: 'cfg-soccer'
      }
    ],
    trackedCalendarUids: [],
    calendarEvents: [],
    addedGameId: 'added-game-1',
    ...overrides
  };
}

async function installScheduleRoutingMocks(page, stateOverrides = {}) {
  const state = buildState(stateOverrides);

  await page.addInitScript((initState) => {
    window.__scheduleRoutingState = initState;
    window.__scheduleRoutingCalls = {
      addGame: []
    };
    window.alert = () => {};
    window.confirm = () => true;
  }, state);

  await page.route(/\/js\/auth\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: authModuleSource });
  });

  await page.route(/\/js\/db\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: dbModuleSource });
  });

  await page.route(/\/js\/utils\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: utilsModuleSource });
  });

  await page.route(/\/js\/team-admin-banner\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: teamAdminBannerSource });
  });

  await page.route(/\/js\/firebase\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseModuleSource });
  });

  await page.route(/\/js\/vendor\/firebase-app\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseAppSource });
  });

  await page.route(/\/js\/vendor\/firebase-ai\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: firebaseAiSource });
  });

  await page.route('https://www.googletagmanager.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
}

async function gotoSchedule(page, overrides = {}) {
  await installScheduleRoutingMocks(page, overrides);
  await page.goto('/edit-schedule.html#teamId=team-a');
  await expect(page.locator('#team-name-display')).toHaveText('All Stars');
}

async function clickPrimaryTrackButton(page) {
  await expect(page.locator('.track-game-btn').first()).toBeVisible();
  await page.locator('.track-game-btn').first().click();
}

test.describe('Schedule/tracker routing suite @critical', () => {
  test('non-basketball game routes directly to standard tracker', async ({ page }) => {
    await gotoSchedule(page);

    await Promise.all([
      page.waitForURL(/\/track\.html#teamId=team-a&gameId=game-1$/),
      clickPrimaryTrackButton(page)
    ]);
  });

  test('basketball config opens tracker chooser modal', async ({ page }) => {
    await gotoSchedule(page, {
      games: [{ id: 'game-bball', type: 'game', status: 'scheduled', opponent: 'Hoops', location: 'Court 2', date: FUTURE_ISO, statTrackerConfigId: 'cfg-basketball' }]
    });

    await clickPrimaryTrackButton(page);

    await expect(page.locator('#basketball-tracker-modal')).toBeVisible();
    await expect(page).toHaveURL(/\/edit-schedule\.html#teamId=team-a$/);
  });

  test('basketball chooser standard option routes to track.html', async ({ page }) => {
    await gotoSchedule(page, {
      games: [{ id: 'game-standard', type: 'game', status: 'scheduled', opponent: 'Wolves', location: 'Court 3', date: FUTURE_ISO, statTrackerConfigId: 'cfg-basketball' }]
    });

    await clickPrimaryTrackButton(page);

    await Promise.all([
      page.waitForURL(/\/track\.html#teamId=team-a&gameId=game-standard$/),
      page.locator('#basketball-tracker-standard').click()
    ]);
  });

  test('basketball chooser beta option routes to track-basketball.html', async ({ page }) => {
    await gotoSchedule(page, {
      games: [{ id: 'game-beta', type: 'game', status: 'scheduled', opponent: 'Lions', location: 'Court 4', date: FUTURE_ISO, statTrackerConfigId: 'cfg-basketball' }]
    });

    await clickPrimaryTrackButton(page);

    await Promise.all([
      page.waitForURL(/\/track-basketball\.html#teamId=team-a&gameId=game-beta$/),
      page.locator('#basketball-tracker-beta').click()
    ]);
  });

  test('basketball chooser live option routes to live-tracker.html', async ({ page }) => {
    await gotoSchedule(page, {
      games: [{ id: 'game-live', type: 'game', status: 'scheduled', opponent: 'Jets', location: 'Court 5', date: FUTURE_ISO, statTrackerConfigId: 'cfg-basketball' }]
    });

    await clickPrimaryTrackButton(page);

    await Promise.all([
      page.waitForURL(/\/live-tracker\.html#teamId=team-a&gameId=game-live$/),
      page.locator('#basketball-tracker-live').click()
    ]);
  });

  test('basketball chooser photo option routes to track-statsheet.html', async ({ page }) => {
    await gotoSchedule(page, {
      games: [{ id: 'game-photo', type: 'game', status: 'scheduled', opponent: 'Storm', location: 'Court 6', date: FUTURE_ISO, statTrackerConfigId: 'cfg-basketball' }]
    });

    await clickPrimaryTrackButton(page);

    await Promise.all([
      page.waitForURL(/\/track-statsheet\.html#teamId=team-a&gameId=game-photo$/),
      page.locator('#basketball-tracker-photo').click()
    ]);
  });

  test('basketball chooser cancel closes modal and stays on schedule page', async ({ page }) => {
    await gotoSchedule(page, {
      games: [{ id: 'game-cancel', type: 'game', status: 'scheduled', opponent: 'Heat', location: 'Court 7', date: FUTURE_ISO, statTrackerConfigId: 'cfg-basketball' }]
    });

    await clickPrimaryTrackButton(page);
    await expect(page.locator('#basketball-tracker-modal')).toBeVisible();

    await page.locator('#basketball-tracker-cancel').click();

    await expect(page.locator('#basketball-tracker-modal')).toBeHidden();
    await expect(page).toHaveURL(/\/edit-schedule\.html#teamId=team-a$/);
  });

  test('chooser options do not route when no pending game is selected', async ({ page }) => {
    await gotoSchedule(page);

    await page.evaluate(() => {
      document.getElementById('basketball-tracker-modal')?.classList.remove('hidden');
    });

    await page.locator('#basketball-tracker-standard').click();

    await expect(page.locator('#basketball-tracker-modal')).toBeHidden();
    await expect(page).toHaveURL(/\/edit-schedule\.html#teamId=team-a$/);
  });

  test('team sport fallback opens chooser when game config is missing', async ({ page }) => {
    await gotoSchedule(page, {
      team: {
        id: 'team-a',
        ownerId: 'coach-1',
        name: 'All Stars',
        sport: 'Basketball',
        adminEmails: [],
        calendarUrls: []
      },
      games: [{ id: 'game-fallback', type: 'game', status: 'scheduled', opponent: 'Kings', location: 'Court 8', date: FUTURE_ISO }]
    });

    await clickPrimaryTrackButton(page);

    await expect(page.locator('#basketball-tracker-modal')).toBeVisible();
  });

  test('basketball detection is case-insensitive for config base type', async ({ page }) => {
    await gotoSchedule(page, {
      games: [{ id: 'game-case', type: 'game', status: 'scheduled', opponent: 'Bulls', location: 'Court 9', date: FUTURE_ISO, statTrackerConfigId: 'cfg-basketball-caps' }]
    });

    await clickPrimaryTrackButton(page);

    await expect(page.locator('#basketball-tracker-modal')).toBeVisible();
  });

  test('calendar-originated non-basketball track routes directly to standard tracker', async ({ page }) => {
    await gotoSchedule(page, { addedGameId: 'calendar-game-standard' });

    await page.selectOption('#statConfig', 'cfg-soccer');

    await Promise.all([
      page.waitForURL(/\/track\.html#teamId=team-a&gameId=calendar-game-standard$/),
      page.evaluate(() => window.trackCalendarEvent({
        uid: 'cal-1',
        summary: 'All Stars vs Falcons',
        location: 'North Gym',
        dtstart: '2099-05-19T18:00:00.000Z'
      }))
    ]);
  });

  test('calendar-originated basketball track opens chooser and preserves addGame payload', async ({ page }) => {
    await gotoSchedule(page, { addedGameId: 'calendar-game-basketball' });

    await page.selectOption('#statConfig', 'cfg-basketball');
    await page.evaluate(() => window.trackCalendarEvent({
      uid: 'cal-2',
      summary: 'All Stars vs Panthers',
      location: 'South Gym',
      dtstart: '2099-05-20T18:30:00.000Z'
    }));

    await expect(page.locator('#basketball-tracker-modal')).toBeVisible();

    const addGameCalls = await page.evaluate(() => window.__scheduleRoutingCalls.addGame);
    expect(addGameCalls).toHaveLength(1);
    expect(addGameCalls[0].teamId).toBe('team-a');
    expect(addGameCalls[0].payload.calendarEventUid).toBe('cal-2');
    expect(addGameCalls[0].payload.statTrackerConfigId).toBe('cfg-basketball');

    await Promise.all([
      page.waitForURL(/\/track-basketball\.html#teamId=team-a&gameId=calendar-game-basketball$/),
      page.locator('#basketball-tracker-beta').click()
    ]);
  });
});
