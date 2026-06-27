import { expect, test } from '@playwright/test';

const AUTH_STUB = `
export function checkAuth(callback) {
  callback(null);
}
`;

const DB_STUB = `
const pages = {
  browse: [
    { id: 'alpha', name: 'Alpha Soccer', sport: 'Soccer', description: 'Open play', isPublic: true, city: 'Denver', state: 'CO' }
  ],
  browseNext: [
    { id: 'current', name: 'Kansas City Current', sport: 'Soccer', description: 'Midwest club', isPublic: true, city: 'Kansas City', state: 'MO' }
  ],
  kansas: [
    { id: 'current', name: 'Kansas City Current', sport: 'Soccer', description: 'Midwest club', isPublic: true, zip: '64102', city: 'Kansas City', state: 'MO' }
  ],
  kansasNext: [
    { id: 'kc-wave', name: 'KC Wave', sport: 'Soccer', description: 'Second search page', isPublic: true, city: 'Kansas City', state: 'KS' }
  ]
};

window.__teamSearchCalls = [];
window.__runtimeZipFallbackCalls = 0;

export async function discoverPublicTeams(options = {}) {
  window.__teamSearchCalls.push(options);
  const filter = String(options.searchText || '').trim().toLowerCase();
  if (!filter) {
    if (options.cursor === 'page-2') {
      return { teams: pages.browseNext, nextCursor: null };
    }
    return { teams: pages.browse, nextCursor: 'page-2' };
  }
  if (filter.includes('kansas')) {
    if (options.cursor === 'search-page-2') {
      return { teams: pages.kansasNext, nextCursor: null };
    }
    return { teams: pages.kansas, nextCursor: 'search-page-2' };
  }
  return { teams: [], nextCursor: null };
}

export async function getTeams() {
  throw new Error('teams.html should use discoverPublicTeams instead of getTeams');
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
  window.__runtimeZipFallbackCalls += 1;
  return null;
}
`;

test('browse teams location search paginates filtered results and clear restores browse page', async ({ page, baseURL }) => {
    await page.route('**/js/auth.js?v=*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: AUTH_STUB }));
    await page.route('**/js/db.js?v=*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: DB_STUB }));
    await page.route('**/js/telemetry.js?v=*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
    await page.route('**/js/utils.js?v=*', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: UTILS_STUB }));

    await page.goto(`${baseURL}/teams.html`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Alpha Soccer')).toBeVisible();
    await expect(page.getByText('Kansas City Current')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__teamSearchCalls)).toEqual([{ cursor: null, pageSize: 24 }]);

    await page.getByRole('button', { name: 'Load more teams' }).click();
    await expect(page.getByText('Kansas City Current')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__teamSearchCalls.at(-1))).toEqual({ cursor: 'page-2', pageSize: 24 });

    await page.locator('#location-search-input').fill('Kansas');
    await page.locator('#search-button').click();

    await expect(page.getByText('Kansas City Current')).toBeVisible();
    await expect(page.getByText('Alpha Soccer')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__teamSearchCalls.at(-1))).toEqual({ searchText: 'Kansas', cursor: null, pageSize: 24 });
    await expect(page.getByRole('button', { name: 'Load more teams' })).toBeVisible();

    await page.getByRole('button', { name: 'Load more teams' }).click();

    await expect(page.getByText('Kansas City Current')).toBeVisible();
    await expect(page.getByText('KC Wave')).toBeVisible();
    await expect(page.getByText('Alpha Soccer')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__teamSearchCalls.at(-1))).toEqual({ searchText: 'Kansas', cursor: 'search-page-2', pageSize: 24 });
    await expect.poll(() => page.evaluate(() => window.__runtimeZipFallbackCalls)).toBe(0);
    expect(new URL(page.url()).pathname).toMatch(/\/teams\.html$/);

    await page.locator('#clear-search-button').click();

    await expect(page.getByText('Alpha Soccer')).toBeVisible();
    await expect(page.getByText('Kansas City Current')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__teamSearchCalls.at(-1))).toEqual({ cursor: null, pageSize: 24 });
});
