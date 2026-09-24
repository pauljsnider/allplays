import { expect, test } from '@playwright/test';

function captureUnexpectedPageErrors(page) {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  return pageErrors;
}

test('legacy family page boots from the server projection without requesting raw token data', async ({ page, baseURL }) => {
  const pageErrors = captureUnexpectedPageErrors(page);
  await page.addInitScript(() => {
    window.__familyShareProjectionSmoke = { projectionCalls: 0, rawTokenCalls: 0, payloads: [] };
  });
  await page.route(/https:\/\/www\.googletagmanager\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/https:\/\/cdn\.tailwindcss\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tailwind = {};' }));
  await page.route(/\/js\/telemetry\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/\/js\/schedule-watch-cta\.js(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'export function hasReplayVideoEvidence() { return false; } export function resolveScheduleWatchCta() { return null; }'
  }));
  await page.route(/\/js\/utils\.js(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      export function renderHeader() {}
      export function renderFooter() {}
      export function escapeHtml(value) { return String(value || ''); }
      export async function fetchAndParseCalendar() { throw new Error('raw calendar fetch must not run'); }
      export function extractOpponent(value) { return String(value || ''); }
      export function isPracticeEvent(value) { return /practice/i.test(String(value || '')); }
      export function expandRecurrence() { return []; }
      export function getCalendarEventTrackingId(value) { return value?.uid || ''; }
      export function isTrackedCalendarEvent() { return false; }
    `
  }));
  await page.route(/\/js\/db\.js(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      export async function getFamilyShareView() {
        window.__familyShareProjectionSmoke.projectionCalls += 1;
        const payload = {
          projectionVersion: 2,
          presentation: { label: 'Projected Family', expiresAt: '2100-08-01T00:00:00.000Z' },
          children: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' }],
          teams: [{ teamId: 'team-1', teamName: 'Bears', games: [{ id: 'game-1', type: 'game', date: '2100-07-20T18:00:00.000Z', opponent: 'Comets', location: 'Court 1' }] }],
          externalEvents: [],
          calendarWarnings: []
        };
        window.__familyShareProjectionSmoke.payloads.push(JSON.stringify(payload));
        return payload;
      }
      export async function getFamilyShareToken() {
        window.__familyShareProjectionSmoke.rawTokenCalls += 1;
        throw new Error('raw token access forbidden');
      }
      export async function resolveFamilyShareTokenChildren() { return []; }
      export async function getTeam() { throw new Error('direct team read forbidden'); }
      export async function getGames() { throw new Error('direct games read forbidden'); }
      export async function getTrackedCalendarEventUids() { throw new Error('direct tracking read forbidden'); }
    `
  }));

  await page.goto(`${baseURL}/family.html?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, { waitUntil: 'domcontentloaded' });

  expect(pageErrors).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Projected Family' })).toBeVisible();
  await expect(page.getByText('Pat Star').first()).toBeVisible();
  await expect(page.getByText('vs. Comets')).toBeVisible();
  const evidence = await page.evaluate(() => window.__familyShareProjectionSmoke);
  expect(evidence.projectionCalls).toBe(1);
  expect(evidence.rawTokenCalls).toBe(0);
  expect(evidence.payloads.join('')).not.toContain('ownerUserId');
  expect(evidence.payloads.join('')).not.toContain('extraCalendarUrls');
  expect(evidence.payloads.join('')).not.toContain('SENTINEL');
});

test('legacy family page does not reopen raw token reads after an authoritative projection rejection', async ({ page, baseURL }) => {
  const pageErrors = captureUnexpectedPageErrors(page);
  await page.addInitScript(() => {
    window.__familyShareProjectionSmoke = { projectionCalls: 0, rawTokenCalls: 0 };
  });
  await page.route(/https:\/\/www\.googletagmanager\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/https:\/\/cdn\.tailwindcss\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tailwind = {};' }));
  await page.route(/\/js\/telemetry\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/\/js\/schedule-watch-cta\.js(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'export function hasReplayVideoEvidence() { return false; } export function resolveScheduleWatchCta() { return null; }'
  }));
  await page.route(/\/js\/utils\.js(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      export function renderHeader() {}
      export function renderFooter() {}
      export function escapeHtml(value) { return String(value || ''); }
      export async function fetchAndParseCalendar() { return []; }
      export function extractOpponent(value) { return String(value || ''); }
      export function isPracticeEvent() { return false; }
      export function expandRecurrence() { return []; }
      export function getCalendarEventTrackingId() { return ''; }
      export function isTrackedCalendarEvent() { return false; }
    `
  }));
  await page.route(/\/js\/db\.js(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      export async function getFamilyShareView() {
        window.__familyShareProjectionSmoke.projectionCalls += 1;
        throw { code: 'functions/permission-denied', details: { reason: 'revoked' } };
      }
      export async function getFamilyShareToken() {
        window.__familyShareProjectionSmoke.rawTokenCalls += 1;
        return { active: true, label: 'Must not render', children: [] };
      }
      export async function resolveFamilyShareTokenChildren() { return []; }
      export async function getTeam() { return null; }
      export async function getGames() { return []; }
      export async function getTrackedCalendarEventUids() { return []; }
    `
  }));

  await page.goto(`${baseURL}/family.html?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, { waitUntil: 'domcontentloaded' });

  expect(pageErrors).toEqual([]);
  await expect(page.getByRole('heading', { name: 'This link has been revoked' })).toBeVisible();
  const evidence = await page.evaluate(() => window.__familyShareProjectionSmoke);
  expect(evidence.projectionCalls).toBe(1);
  expect(evidence.rawTokenCalls).toBe(0);
});

test('legacy family page shows a retry message without fallback reads after projection throttling', async ({ page, baseURL }) => {
  const pageErrors = captureUnexpectedPageErrors(page);
  await page.addInitScript(() => {
    window.__familyShareProjectionSmoke = { projectionCalls: 0, rawTokenCalls: 0, childCalls: 0, scheduleReads: 0 };
  });
  await page.route(/https:\/\/www\.googletagmanager\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/https:\/\/cdn\.tailwindcss\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tailwind = {};' }));
  await page.route(/\/js\/telemetry\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/\/js\/schedule-watch-cta\.js(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'export function hasReplayVideoEvidence() { return false; } export function resolveScheduleWatchCta() { return null; }'
  }));
  await page.route(/\/js\/utils\.js(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      export function renderHeader() {}
      export function renderFooter() {}
      export function escapeHtml(value) { return String(value || ''); }
      export async function fetchAndParseCalendar() { throw new Error('calendar fallback forbidden'); }
      export function extractOpponent(value) { return String(value || ''); }
      export function isPracticeEvent() { return false; }
      export function expandRecurrence() { return []; }
      export function getCalendarEventTrackingId() { return ''; }
      export function isTrackedCalendarEvent() { return false; }
    `
  }));
  await page.route(/\/js\/db\.js(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      export async function getFamilyShareView() {
        window.__familyShareProjectionSmoke.projectionCalls += 1;
        throw { code: 'functions/resource-exhausted', details: { retryAfterSeconds: 29 } };
      }
      export async function getFamilyShareToken() {
        window.__familyShareProjectionSmoke.rawTokenCalls += 1;
        throw new Error('raw token fallback forbidden');
      }
      export async function resolveFamilyShareTokenChildren() {
        window.__familyShareProjectionSmoke.childCalls += 1;
        return [];
      }
      export async function getTeam() { window.__familyShareProjectionSmoke.scheduleReads += 1; return null; }
      export async function getGames() { window.__familyShareProjectionSmoke.scheduleReads += 1; return []; }
      export async function getTrackedCalendarEventUids() { window.__familyShareProjectionSmoke.scheduleReads += 1; return []; }
    `
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseURL}/family.html?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, { waitUntil: 'domcontentloaded' });

  expect(pageErrors).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Family page temporarily busy' })).toBeVisible();
  await expect(page.getByText('Please wait about 29 seconds, then retry.')).toBeVisible();
  expect(await page.evaluate(() => window.__familyShareProjectionSmoke)).toEqual({
    projectionCalls: 1,
    rawTokenCalls: 0,
    childCalls: 0,
    scheduleReads: 0
  });
});

test('legacy family page shows replay CTAs only for publicly accessible completed games', async ({ page, baseURL }) => {
  const pageErrors = captureUnexpectedPageErrors(page);
  await page.route(/https:\/\/www\.googletagmanager\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/https:\/\/cdn\.tailwindcss\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'window.tailwind = {};' }));
  await page.route(/\/js\/telemetry\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/\/js\/utils\.js(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      export function renderHeader() {}
      export function renderFooter() {}
      export function escapeHtml(value) { return String(value || ''); }
      export async function fetchAndParseCalendar() { throw new Error('raw calendar fetch must not run'); }
      export function extractOpponent(value) { return String(value || ''); }
      export function isPracticeEvent(value) { return /practice/i.test(String(value || '')); }
      export function expandRecurrence() { return []; }
      export function getCalendarEventTrackingId(value) { return value?.uid || ''; }
      export function isTrackedCalendarEvent() { return false; }
    `
  }));
  await page.route(/\/js\/db\.js(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      export async function getFamilyShareView() {
        const longSharedPath = 'organizations/' + 'o'.repeat(128) + '/sharedGames/' + 'g'.repeat(128);
        const longSharedId = 'shared_' + encodeURIComponent(longSharedPath);
        const game = (id, opponent, status, liveStatus, hasReplayVideo, canOpenPublicViewer = true) => ({
          id,
          gameId: id,
          type: 'game',
          teamId: 'team-1',
          date: '2100-07-20T18:00:00.000Z',
          opponent,
          location: 'Court 1',
          status,
          liveStatus,
          hasReplayVideo,
          canOpenPublicViewer
        });
        return {
          projectionVersion: 2,
          presentation: { label: 'Replay Family', expiresAt: '2100-08-01T00:00:00.000Z' },
          children: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' }],
          teams: [{
            teamId: 'team-1',
            teamName: 'Bears',
            games: [
              game('canonical-replay', 'Canonical Replay', 'completed', 'scheduled', true),
              game('completed-live', 'Completed Live', 'completed', 'live', true),
              game('completed-cancelled', 'Completed Cancelled', 'completed', 'cancelled', true),
              game('cancelled-game', 'Cancelled Game', 'cancelled', 'scheduled', true),
              game('reverse-lifecycle', 'Reverse Lifecycle', 'scheduled', 'completed', true),
              game('no-evidence', 'No Evidence', 'completed', 'scheduled', false),
              game('private-replay', 'Private Replay', 'completed', 'scheduled', true, false),
              game('timeline-replay', 'Timeline Replay', null, 'completed', false),
              game(longSharedId, 'Long Shared Replay', 'completed', 'scheduled', true)
            ]
          }],
          externalEvents: [],
          calendarWarnings: []
        };
      }
      export async function getFamilyShareToken() { throw new Error('raw token access forbidden'); }
      export async function resolveFamilyShareTokenChildren() { return []; }
      export async function getTeam() { throw new Error('direct team read forbidden'); }
      export async function getGames() { throw new Error('direct games read forbidden'); }
      export async function getTrackedCalendarEventUids() { throw new Error('direct tracking read forbidden'); }
    `
  }));

  await page.goto(`${baseURL}/family.html?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`, { waitUntil: 'domcontentloaded' });

  expect(pageErrors).toEqual([]);
  const cardFor = (opponent) => page.locator('#schedule-list > div').filter({ hasText: `vs. ${opponent}` });
  const canonicalCard = cardFor('Canonical Replay');
  await expect(canonicalCard.getByRole('link', { name: 'Watch Replay' })).toHaveAttribute(
    'href',
    'live-game.html?teamId=team-1&gameId=canonical-replay&replay=true'
  );
  for (const opponent of [
    'Completed Live',
    'Completed Cancelled',
    'Cancelled Game',
    'Reverse Lifecycle',
    'No Evidence',
    'Private Replay'
  ]) {
    await expect(cardFor(opponent).getByRole('link', { name: 'Watch Replay' })).toHaveCount(0);
  }
  await expect(cardFor('Timeline Replay').getByRole('link', { name: 'Watch Replay' })).toHaveCount(1);
  const longSharedPath = `organizations/${'o'.repeat(128)}/sharedGames/${'g'.repeat(128)}`;
  const longSharedId = `shared_${encodeURIComponent(longSharedPath)}`;
  await expect(cardFor('Long Shared Replay').getByRole('link', { name: 'Watch Replay' })).toHaveAttribute(
    'href',
    `live-game.html?teamId=team-1&gameId=${encodeURIComponent(longSharedId)}&replay=true`
  );
  await expect(page.getByRole('link', { name: 'Watch Replay' })).toHaveCount(3);
});
