import { expect, test } from '@playwright/test';

test.skip(
  process.env.SMOKE_SUITE === 'production',
  'Module-mocked Discover specs require the Vite dev server.'
);

function appUrl(baseURL, hashPath) {
  const url = new URL('/', process.env.SMOKE_APP_BASE_URL || baseURL || 'http://localhost:3000/');
  url.hash = hashPath;
  return url.toString();
}

async function mockDiscoverModules(page, { signedIn = false } = {}) {
  await page.addInitScript(() => { window.__opportunityCreates = []; window.__opportunityInquiries = []; });
  await page.route(/\/src\/lib\/useAuth\.ts(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      export function useAuth() {
        const user = ${signedIn ? `{ uid: 'user-1', email: 'coach@example.com', displayName: 'Coach Casey', emailVerified: true, roles: ['coach'] }` : 'null'};
        return { user, profile: null, loading: false, error: null, roles: user ? user.roles : [], isParent: false, isCoach: Boolean(user), isAdmin: false, isPlatformAdmin: false, refresh: async () => user, signOut: async () => {} };
      }
    `
  }));
  await page.route(/\/src\/lib\/opportunityService\.ts(\?.*)?$/, (route) => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      const listing = { id: 'listing-1', kind: 'coach_or_staff', title: 'Assistant coach wanted', description: 'Help with practices and weekend games.', sport: 'Basketball', role: 'Assistant coach', ageGroup: '12U', competitiveLevel: 'Travel', division: '', city: 'Austin', state: 'TX', zip: '78701', availability: 'Weeknights', startDate: '2026-08-01', compensationType: 'paid', compensationSummary: 'Stipend', teamId: 'team-1', teamName: 'Bears', teamPhotoUrl: null, status: 'active', createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', expiresAt: '2026-07-31T00:00:00.000Z' };
      export async function listPublicOpportunities() { return { items: [listing], nextCursor: null }; }
      export async function getPublicOpportunity() { return listing; }
      export async function listManagedPublicOpportunityTeams() { return [{ id: 'team-1', name: 'Bears', sport: 'Basketball', city: 'Austin', state: 'TX', zip: '78701' }]; }
      export async function createPublicOpportunity(input) { window.__opportunityCreates.push(input); return { ...listing, ...input }; }
      export async function updatePublicOpportunity(id, input) { return { ...listing, ...input, id }; }
      export async function closePublicOpportunity() { return { ...listing, status: 'closed' }; }
      export async function renewPublicOpportunity() { return listing; }
      export async function listMyPublicOpportunities() { return [listing]; }
      export async function reportPublicOpportunity() { return { success: true }; }
      export async function createOpportunityInquiry(id, message) { window.__opportunityInquiries.push({ id, message }); return { id: 'inquiry-1' }; }
      export async function listOpportunityInquiries() { return []; }
      export async function getOpportunityInquiry() { return null; }
      export async function replyToOpportunityInquiry() { return { success: true }; }
      export async function listPublicOpportunityReports() { return []; }
      export async function moderatePublicOpportunity() { return { success: true }; }
    `
  }));
}

test.describe('public sports Discover', () => {
  test('lets anonymous visitors browse and routes contact through sign-in', async ({ page, baseURL }) => {
    await mockDiscoverModules(page);
    await page.goto(appUrl(baseURL, '/discover'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Find a team or your next sports opportunity' })).toBeVisible();
    await expect(page.getByText('Assistant coach wanted')).toBeVisible();
    await page.getByRole('link', { name: 'View opportunity' }).click();
    await expect(page.getByRole('button', { name: 'Sign in to contact' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in to contact' }).click();
    await expect(page).toHaveURL(/#\/auth\?next=/);
  });

  test('lets verified team staff publish from the native form', async ({ page, baseURL }) => {
    await mockDiscoverModules(page, { signedIn: true });
    await page.goto(appUrl(baseURL, '/discover/new'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Post an opportunity' })).toBeVisible();
    await page.getByLabel('Public team').selectOption('team-1');
    await page.getByLabel('Title').fill('Players needed for fall');
    await page.getByLabel('Description').fill('Looking for two experienced guards for fall league play.');
    await page.getByLabel('Age group').fill('12U');
    await page.getByRole('button', { name: 'Publish for 30 days' }).click();
    await expect.poll(() => page.evaluate(() => window.__opportunityCreates.length)).toBe(1);
    await expect(page).toHaveURL(/#\/discover\/opportunities\/listing-1$/);
  });

  test('lets signed-in users send a starter message from opportunity detail', async ({ page, baseURL }) => {
    await mockDiscoverModules(page, { signedIn: true });
    await page.goto(appUrl(baseURL, '/discover/opportunities/listing-1'), { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Send private inquiry' }).click();

    const starter = 'Is this opportunity still available?';
    await page.getByRole('button', { name: starter }).click();
    await expect(page.getByRole('textbox', { name: 'Inquiry message' })).toHaveValue(starter);
    await expect(page.getByRole('button', { name: 'Send inquiry' })).toBeEnabled();
    await page.getByRole('button', { name: 'Send inquiry' }).click();

    await expect.poll(() => page.evaluate(() => window.__opportunityInquiries)).toEqual([
      { id: 'listing-1', message: starter }
    ]);
    await expect(page).toHaveURL(/#\/discover\/inquiries\/inquiry-1$/);
  });
});
