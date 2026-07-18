import { expect, test } from '@playwright/test';

test('legacy family page boots from the server projection without requesting raw token data', async ({ page, baseURL }) => {
  await page.addInitScript(() => {
    window.__familyShareProjectionSmoke = { projectionCalls: 0, rawTokenCalls: 0, payloads: [] };
  });
  await page.route(/https:\/\/www\.googletagmanager\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/https:\/\/cdn\.tailwindcss\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/\/js\/telemetry\.js(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.route(/\/js\/schedule-watch-cta\.js(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'export function resolveScheduleWatchCta() { return null; }'
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
