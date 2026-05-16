import { expect, test } from '@playwright/test';

const AUTH_STUB = `
export function checkAuth(callback) {
  callback(null);
}
`;

const DB_STUB = `
const teams = [
  { id: 'alpha', name: 'Alpha Soccer', sport: 'Soccer', description: 'Open play', isPublic: true, city: 'Denver', state: 'CO' },
  { id: 'current', name: 'Kansas City Current', sport: 'Soccer', description: 'Midwest club', isPublic: true, city: 'Kansas City', state: 'MO' }
];

window.__teamSearchCalls = [];

export async function getTeams(options = {}) {
  window.__teamSearchCalls.push(options);
  const filter = String(options.locationFilter || '').trim().toLowerCase();
  if (!filter) {
    return teams;
  }
  return teams.filter((team) => [team.name, team.city, team.state, team.zip].filter(Boolean).join(' ').toLowerCase().includes(filter));
}
`;

const UTILS_STUB = `
export function renderHeader(container) {
  container.innerHTML = '<header>ALL PLAYS</header>';
}

export function renderFooter(container) {
  container.innerHTML = '<footer></footer>';
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

export function getSafeImageUrl(value) {
  return value || '';
}

export async function resolveZip() {
  return null;
}
`;

test('browse teams location search submits filters and clear restores all teams', async ({ page, baseURL }) => {
    await page.route('**/js/auth.js?v=*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: AUTH_STUB }));
    await page.route('**/js/db.js?v=*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: DB_STUB }));
    await page.route('**/js/telemetry.js?v=*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await page.route('**/js/utils.js?v=*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: UTILS_STUB }));

    await page.goto(`${baseURL}/teams.html`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Alpha Soccer')).toBeVisible();
    await expect(page.getByText('Kansas City Current')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__teamSearchCalls)).toEqual([{}]);

    await page.locator('#location-search-input').fill('Kansas');
    await page.locator('#search-button').click();

    await expect(page.getByText('Kansas City Current')).toBeVisible();
    await expect(page.getByText('Alpha Soccer')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__teamSearchCalls.at(-1))).toEqual({ locationFilter: 'Kansas' });
    expect(new URL(page.url()).pathname).toMatch(/\/teams\.html$/);

    await page.locator('#clear-search-button').click();

    await expect(page.getByText('Alpha Soccer')).toBeVisible();
    await expect(page.getByText('Kansas City Current')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__teamSearchCalls.at(-1))).toEqual({});
});
