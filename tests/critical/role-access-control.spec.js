const { test, expect } = require('@playwright/test');

const authModuleSource = String.raw`
const getState = () => globalThis.__roleAccessState || {};

export async function requireAuth() {
  const state = getState();
  if (state.requireAuthError) {
    throw new Error(state.requireAuthError);
  }

  return state.user || {
    uid: 'user-1',
    email: 'coach@example.com'
  };
}
`;

const dbModuleSource = String.raw`
const getState = () => globalThis.__roleAccessState || {};

const calls = () => {
  if (!globalThis.__roleAccessCalls) {
    globalThis.__roleAccessCalls = {
      getUserTeamsWithAccess: [],
      getParentTeams: [],
      getUnreadChatCounts: [],
      getUserProfile: [],
      deleteTeam: []
    };
  }
  return globalThis.__roleAccessCalls;
};

export async function getUserTeamsWithAccess(uid, email) {
  calls().getUserTeamsWithAccess.push({ uid, email });
  return getState().coachTeams || [];
}

export async function getParentTeams(uid) {
  calls().getParentTeams.push({ uid });
  return getState().parentTeams || [];
}

export async function getUnreadChatCounts(uid, teamIds) {
  calls().getUnreadChatCounts.push({ uid, teamIds });
  return getState().unreadByTeam || {};
}

export async function getUserProfile(uid) {
  calls().getUserProfile.push({ uid });
  return getState().profile || {};
}

export async function deleteTeam(teamId) {
  calls().deleteTeam.push({ teamId });
}
`;

const utilsModuleSource = String.raw`
const getCalls = () => {
  if (!globalThis.__roleAccessRenderCalls) {
    globalThis.__roleAccessRenderCalls = {
      renderHeader: [],
      renderFooter: []
    };
  }
  return globalThis.__roleAccessRenderCalls;
};

export function renderHeader(container, user) {
  getCalls().renderHeader.push({
    userEmail: user?.email || '',
    isAdmin: !!user?.isAdmin
  });
  if (container) {
    container.setAttribute('data-rendered', 'header');
  }
}

export function renderFooter(container) {
  getCalls().renderFooter.push({ ok: true });
  if (container) {
    container.setAttribute('data-rendered', 'footer');
  }
}

export function escapeHtml(value) {
  const s = String(value ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
`;

const bannerUtilsModuleSource = String.raw`
export function escapeHtml(value) {
  const s = String(value ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
`;

async function mockDashboardModules(page, state = {}) {
  await page.addInitScript((initState) => {
    window.__roleAccessState = initState;
    window.__roleAccessCalls = {
      getUserTeamsWithAccess: [],
      getParentTeams: [],
      getUnreadChatCounts: [],
      getUserProfile: [],
      deleteTeam: []
    };
    window.__roleAccessRenderCalls = {
      renderHeader: [],
      renderFooter: []
    };
  }, state);

  await page.route(/\/js\/auth\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: authModuleSource
    });
  });

  await page.route(/\/js\/db\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: dbModuleSource
    });
  });

  await page.route(/\/js\/utils\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: utilsModuleSource
    });
  });

  await page.route('https://www.googletagmanager.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' });
  });
}

async function gotoDashboard(page, state = {}) {
  await mockDashboardModules(page, state);
  await page.goto('/dashboard.html');
}

async function gotoTeamAdminBannerHarness(page) {
  await page.route(/\/js\/utils\.js(?:\?.*)?$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: bannerUtilsModuleSource
    });
  });
  await page.goto('/tests/fixtures/team-admin-banner-harness.html');
}

test.describe('Role/access-control suite @critical', () => {
  test('full-access card shows management actions for coach/admin users', async ({ page }) => {
    await gotoDashboard(page, {
      user: { uid: 'coach-1', email: 'coach@example.com' },
      coachTeams: [
        { id: 'team-a', name: 'All Stars', sport: 'Basketball', ownerId: 'owner-1' }
      ],
      parentTeams: []
    });

    const card = page.locator('[data-team-card="team-a"]');
    await expect(card.locator('a[href="edit-team.html#teamId=team-a"]')).toBeVisible();
    await expect(card.locator('a[href="edit-roster.html#teamId=team-a"]')).toBeVisible();
    await expect(card.locator('a[href="edit-schedule.html#teamId=team-a"]')).toBeVisible();
    await expect(card.locator('a[href="drills.html#teamId=team-a"]')).toBeVisible();
  });

  test('parent-only team hides management actions and shows parent label', async ({ page }) => {
    await gotoDashboard(page, {
      user: { uid: 'parent-1', email: 'parent@example.com' },
      coachTeams: [],
      parentTeams: [
        { id: 'team-parent', name: 'Family Team', sport: 'Soccer', ownerId: 'coach-2' }
      ]
    });

    const card = page.locator('[data-team-card="team-parent"]');
    await expect(card.locator('a[href="edit-team.html#teamId=team-parent"]')).toHaveCount(0);
    await expect(card.locator('a[href="edit-roster.html#teamId=team-parent"]')).toHaveCount(0);
    await expect(card.getByText('Parent view only')).toBeVisible();
  });

  test('owner sees delete button for their own team', async ({ page }) => {
    await gotoDashboard(page, {
      user: { uid: 'owner-9', email: 'owner@example.com' },
      coachTeams: [
        { id: 'team-owner', name: 'Owners', sport: 'Baseball', ownerId: 'owner-9' }
      ],
      parentTeams: []
    });

    await expect(page.locator('[data-team-card="team-owner"] .delete-team-btn')).toBeVisible();
  });

  test('non-owner full-access user sees owner-managed placeholder instead of delete', async ({ page }) => {
    await gotoDashboard(page, {
      user: { uid: 'coach-2', email: 'coach2@example.com' },
      coachTeams: [
        { id: 'team-non-owner', name: 'Managed', sport: 'Football', ownerId: 'owner-2' }
      ],
      parentTeams: []
    });

    const card = page.locator('[data-team-card="team-non-owner"]');
    await expect(card.locator('.delete-team-btn')).toHaveCount(0);
    await expect(card.getByText('Owner-managed')).toBeVisible();
  });

  test('duplicate team from coach and parent sources is rendered once with full access', async ({ page }) => {
    await gotoDashboard(page, {
      user: { uid: 'coach-parent-1', email: 'both@example.com' },
      coachTeams: [
        { id: 'team-shared', name: 'Shared Team', sport: 'Soccer', ownerId: 'owner-3' }
      ],
      parentTeams: [
        { id: 'team-shared', name: 'Shared Team', sport: 'Soccer', ownerId: 'owner-3' }
      ]
    });

    await expect(page.locator('[data-team-card="team-shared"]')).toHaveCount(1);
    await expect(page.locator('[data-team-card="team-shared"] a[href="edit-team.html#teamId=team-shared"]')).toBeVisible();
  });

  test('chat unread badge shows 99+ cap for high unread teams', async ({ page }) => {
    await gotoDashboard(page, {
      user: { uid: 'coach-unread', email: 'coach@example.com' },
      coachTeams: [
        { id: 'team-chat', name: 'Chatty', sport: 'Basketball', ownerId: 'owner-3' }
      ],
      parentTeams: [],
      unreadByTeam: {
        'team-chat': 138
      }
    });

    await expect(page.locator('[data-team-card="team-chat"] span', { hasText: '99+' })).toBeVisible();
  });

  test('no-teams state appears when user has no coach or parent teams', async ({ page }) => {
    await gotoDashboard(page, {
      user: { uid: 'empty-1', email: 'empty@example.com' },
      coachTeams: [],
      parentTeams: []
    });

    await expect(page.getByRole('heading', { name: 'No Teams Yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create Your First Team' })).toBeVisible();
  });

  test('delete action removes team card after confirmation', async ({ page }) => {
    await gotoDashboard(page, {
      user: { uid: 'owner-confirm', email: 'owner@example.com' },
      coachTeams: [
        { id: 'team-delete', name: 'Delete Me', sport: 'Basketball', ownerId: 'owner-confirm' }
      ],
      parentTeams: []
    });

    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.locator('[data-team-card="team-delete"] .delete-team-btn').click();

    await expect(page.locator('[data-team-card="team-delete"]')).toHaveCount(0);
    const deleteCalls = await page.evaluate(() => window.__roleAccessCalls.deleteTeam);
    expect(deleteCalls).toEqual([{ teamId: 'team-delete' }]);
  });

  test('getTeamAccessInfo grants full access for owner, admin email, and platform admin', async ({ page }) => {
    await gotoTeamAdminBannerHarness(page);

    const results = await page.evaluate(async () => {
      const mod = await import('/js/team-admin-banner.js?v=3');
      const team = { id: 'team-1', ownerId: 'owner-1', adminEmails: ['ADMIN@EXAMPLE.COM'] };
      return {
        owner: mod.getTeamAccessInfo({ uid: 'owner-1', email: 'user@example.com' }, team),
        adminEmail: mod.getTeamAccessInfo({ uid: 'u2', email: 'admin@example.com' }, team),
        platformAdmin: mod.getTeamAccessInfo({ uid: 'u3', email: 'none@example.com', isAdmin: true }, team)
      };
    });

    expect(results.owner).toEqual({ hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' });
    expect(results.adminEmail).toEqual({ hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' });
    expect(results.platformAdmin).toEqual({ hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' });
  });

  test('getTeamAccessInfo returns parent access with parent dashboard exit', async ({ page }) => {
    await gotoTeamAdminBannerHarness(page);

    const parentAccess = await page.evaluate(async () => {
      const mod = await import('/js/team-admin-banner.js?v=3');
      const user = {
        uid: 'parent-2',
        email: 'parent@example.com',
        parentOf: [{ teamId: 'team-parent', playerId: 'player-1' }]
      };
      const team = { id: 'team-parent', ownerId: 'coach-1', adminEmails: [] };
      return mod.getTeamAccessInfo(user, team);
    });

    expect(parentAccess).toEqual({ hasAccess: true, accessLevel: 'parent', exitUrl: 'parent-dashboard.html' });
  });

  test('getTeamAccessInfo denies access when user has no role on team', async ({ page }) => {
    await gotoTeamAdminBannerHarness(page);

    const denied = await page.evaluate(async () => {
      const mod = await import('/js/team-admin-banner.js?v=3');
      return mod.getTeamAccessInfo(
        { uid: 'random-1', email: 'random@example.com', coachOf: [], parentOf: [] },
        { id: 'team-none', ownerId: 'owner-9', adminEmails: [] }
      );
    });

    expect(denied).toEqual({ hasAccess: false, accessLevel: null, exitUrl: 'index.html' });
  });

  test('renderTeamAdminBanner limits nav cards for parent access', async ({ page }) => {
    await gotoTeamAdminBannerHarness(page);

    await page.evaluate(async () => {
      document.body.innerHTML = '<div id="banner"></div>';
      const mod = await import('/js/team-admin-banner.js?v=3');
      mod.renderTeamAdminBanner(document.getElementById('banner'), {
        team: { name: 'Parent Team', sport: 'Soccer' },
        teamId: 'team-parent',
        accessLevel: 'parent',
        exitUrl: 'parent-dashboard.html',
        active: 'view'
      });
    });

    const banner = page.locator('#banner');
    await expect(banner.locator('a[href="team.html#teamId=team-parent"]')).toBeVisible();
    await expect(banner.locator('a[href="team-chat.html#teamId=team-parent"]')).toBeVisible();
    await expect(banner.locator('a[href="edit-roster.html#teamId=team-parent"]')).toHaveCount(0);
    await expect(banner.locator('a[href="parent-dashboard.html"]')).toBeVisible();
  });
});
