import { expect, test } from '@playwright/test';

test('dashboard shows first-team onboarding when the signed-in user has no teams', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await page.route('https://www.googletagmanager.com/**', (route) => route.abort());
    await page.route('https://cdn.tailwindcss.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.tailwind = {};'
    }));
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
            export async function getUnreadChatCounts() { return {}; }
            export async function deleteTeam() {}
        `
    }));
    await page.route(/\/js\/dashboard-team-load\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            export async function loadDashboardTeams() {
                return { fullAccessTeams: [], parentTeams: [] };
            }
        `
    }));

    await page.goto(`${baseURL}/dashboard.html`, { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(0);
    expect(pageErrors).toEqual([]);
    await expect(page.getByRole('heading', { name: 'No Teams Yet' })).toBeVisible();
    const createFirstTeam = page.getByRole('link', { name: 'Create Your First Team' });
    await expect(createFirstTeam).toBeVisible();
    await expect(createFirstTeam).toHaveAttribute('href', 'edit-team.html');
    await expect(page.getByText('Loading your teams...')).toHaveCount(0);
    await expect(page.locator('#full-access-teams-grid')).toHaveCount(0);
});

test('dashboard surfaces a manual retry after bounded unread-count recovery is exhausted', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await page.route('https://www.googletagmanager.com/**', (route) => route.abort());
    await page.route('https://cdn.tailwindcss.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.tailwind = {};'
    }));
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
                callback({ uid: 'coach-1', email: 'coach@example.com', isAdmin: false });
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
            export async function getUnreadChatCounts() { return {}; }
            export async function deleteTeam() {}
        `
    }));
    await page.route(/\/js\/dashboard-team-load\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            export async function loadDashboardTeams() {
                return {
                    fullAccessTeams: [{ id: 'team-1', name: 'Vipers' }],
                    parentTeams: []
                };
            }
        `
    }));
    await page.route(/\/js\/bounded-retry\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            export function startBoundedRetry({ initialValue, onExhausted }) {
                onExhausted(initialValue, new Error('persistent failure'));
                return () => {};
            }
        `
    }));

    await page.goto(`${baseURL}/dashboard.html`, { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(0);
    expect(pageErrors).toEqual([]);
    await expect(page.locator('[data-team-card="team-1"]')).toBeVisible();
    await expect(page.locator('#unread-chat-status')).toBeVisible();
    await expect(page.locator('[data-unread-chat-unknown]')).toHaveAttribute('title', 'Unread messages are unavailable');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('#unread-chat-status')).toBeVisible();
    expect(pageErrors).toEqual([]);
});

test('dashboard replaces the loading spinner with a retry when bounded team discovery fails', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error));
    await page.route('https://www.googletagmanager.com/**', (route) => route.abort());
    await page.route('https://cdn.tailwindcss.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: 'window.tailwind = {};'
    }));
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
                callback({ uid: 'admin-1', email: 'admin@example.com', isAdmin: true });
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
            export async function getUnreadChatCounts() { return {}; }
            export async function deleteTeam() {}
        `
    }));
    await page.route(/\/js\/dashboard-team-load\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            export async function loadDashboardTeams(options) {
                window.__dashboardTeamLoadOptions = options;
                throw new Error('bounded team discovery failed');
            }
        `
    }));

    await page.goto(`${baseURL}/dashboard.html`, { waitUntil: 'domcontentloaded' });

    await page.waitForTimeout(0);
    expect(pageErrors).toEqual([]);
    await expect(page.getByText("We couldn't load your teams right now.")).toBeVisible();
    await expect(page.locator('#my-teams-list #retry-my-teams')).toBeVisible();
    await expect(page.getByText('Loading your teams...')).toHaveCount(0);
    expect(await page.evaluate(() => window.__dashboardTeamLoadOptions)).toEqual({
        includeAllTeams: true,
        timeoutMs: 10000
    });
});
