import { expect, test } from '@playwright/test';

test('dashboard shows first-team onboarding when the signed-in user has no teams', async ({ page, baseURL }) => {
    await page.route('https://www.googletagmanager.com/**', (route) => route.abort());
    await page.route('https://cdn.tailwindcss.com/**', (route) => route.abort());
    await page.route(/\/js\/telemetry\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));
    await page.route(/\/js\/auth\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            export function checkAuth(callback) {
                callback({ uid: 'new-user', email: 'new@example.com', isAdmin: false });
                return () => {};
            }
        `
    }));
    await page.route(/\/js\/utils\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            export function renderHeader() {}
            export function renderFooter() {}
            export function escapeHtml(value) { return String(value || ''); }
        `
    }));
    await page.route(/\/js\/db\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            export async function getTeams() { return []; }
            export async function getUserTeamsWithAccess() { return []; }
            export async function getParentTeams() { return []; }
            export async function getUserProfile() { return { isAdmin: false }; }
            export async function getUnreadChatCounts() { return {}; }
            export async function deleteTeam() {}
        `
    }));

    await page.goto(`${baseURL}/dashboard.html`, { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'No Teams Yet' })).toBeVisible();
    const createFirstTeam = page.getByRole('link', { name: 'Create Your First Team' });
    await expect(createFirstTeam).toBeVisible();
    await expect(createFirstTeam).toHaveAttribute('href', 'edit-team.html');
    await expect(page.getByText('Loading your teams...')).toHaveCount(0);
    await expect(page.locator('#full-access-teams-grid')).toHaveCount(0);
});
