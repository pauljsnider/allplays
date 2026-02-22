const { test, expect } = require('@playwright/test');

async function getTeamAccessInfo(page, user, team) {
  return page.evaluate(
    async ({ userArg, teamArg }) => {
      const { getTeamAccessInfo: fn } = await import('/js/team-admin-banner.js');
      return fn(userArg, teamArg);
    },
    { userArg: user, teamArg: team }
  );
}

// @critical
test.describe('Role/access-control suite @critical', () => {
  test('denies access when user or team is missing', async ({ page }) => {
    await page.goto('/');

    const access = await getTeamAccessInfo(page, null, null);

    expect(access).toEqual({ hasAccess: false, accessLevel: null, exitUrl: 'index.html' });
  });

  test('grants full access to team owner', async ({ page }) => {
    await page.goto('/');

    const access = await getTeamAccessInfo(
      page,
      { uid: 'owner-1', email: 'owner@example.com' },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [] }
    );

    expect(access).toEqual({ hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' });
  });

  test('grants full access to team admin email with case-insensitive match', async ({ page }) => {
    await page.goto('/');

    const access = await getTeamAccessInfo(
      page,
      { uid: 'user-1', email: 'Coach@Example.com' },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: ['coach@example.com'] }
    );

    expect(access).toEqual({ hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' });
  });

  test('grants full access to platform admin', async ({ page }) => {
    await page.goto('/');

    const access = await getTeamAccessInfo(
      page,
      { uid: 'user-1', email: 'user@example.com', isAdmin: true },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [] }
    );

    expect(access).toEqual({ hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' });
  });

  test('grants full access to coach assigned to the team', async ({ page }) => {
    await page.goto('/');

    const access = await getTeamAccessInfo(
      page,
      { uid: 'user-1', email: 'coach@example.com', coachOf: ['team-1'] },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [] }
    );

    expect(access).toEqual({ hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' });
  });

  test('grants parent access when parentOf includes the team', async ({ page }) => {
    await page.goto('/');

    const access = await getTeamAccessInfo(
      page,
      {
        uid: 'user-1',
        email: 'parent@example.com',
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
      },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [] }
    );

    expect(access).toEqual({ hasAccess: true, accessLevel: 'parent', exitUrl: 'parent-dashboard.html' });
  });

  test('denies access for user with no owner/admin/coach/parent relation', async ({ page }) => {
    await page.goto('/');

    const access = await getTeamAccessInfo(
      page,
      { uid: 'user-1', email: 'viewer@example.com', coachOf: [], parentOf: [] },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [] }
    );

    expect(access).toEqual({ hasAccess: false, accessLevel: null, exitUrl: 'index.html' });
  });

  test('prefers full access over parent access when both apply', async ({ page }) => {
    await page.goto('/');

    const access = await getTeamAccessInfo(
      page,
      {
        uid: 'user-1',
        email: 'coach@example.com',
        coachOf: ['team-1'],
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
      },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [] }
    );

    expect(access).toEqual({ hasAccess: true, accessLevel: 'full', exitUrl: 'dashboard.html' });
  });

  test('renderTeamAdminBanner safely no-ops when container is missing', async ({ page }) => {
    await page.goto('/');

    const rendered = await page.evaluate(async () => {
      const { renderTeamAdminBanner } = await import('/js/team-admin-banner.js');
      renderTeamAdminBanner(null, { teamId: 'team-1' });
      return true;
    });

    expect(rendered).toBe(true);
  });

  test('renderTeamAdminBanner clears container when teamId is missing', async ({ page }) => {
    await page.goto('/');
    await page.setContent('<div id="banner">placeholder</div>');

    const bannerHtml = await page.evaluate(async () => {
      const { renderTeamAdminBanner } = await import('/js/team-admin-banner.js');
      const container = document.getElementById('banner');
      renderTeamAdminBanner(container, { teamId: '', accessLevel: 'full' });
      return container.innerHTML;
    });

    expect(bannerHtml).toBe('');
  });

  test('full-access banner renders all role-gated management links', async ({ page }) => {
    await page.goto('/');
    await page.setContent('<div id="banner"></div>');

    const bannerState = await page.evaluate(async () => {
      const { renderTeamAdminBanner } = await import('/js/team-admin-banner.js');
      const container = document.getElementById('banner');
      renderTeamAdminBanner(container, {
        teamId: 'team-9',
        team: { name: 'Wildcats', sport: 'Basketball' },
        accessLevel: 'full',
        active: 'schedule'
      });

      const navLinks = Array.from(container.querySelectorAll('.grid a'));
      const navLabels = Array.from(container.querySelectorAll('.grid a span.text-xs.font-medium'));
      return {
        navCount: navLinks.length,
        labels: navLabels.map(label => label.textContent.trim().replace(/\s+/g, ' ')),
        gridClass: container.querySelector('.grid').className,
        exitHref: container.querySelector('a[href="dashboard.html"]')?.getAttribute('href') || null
      };
    });

    expect(bannerState.navCount).toBe(8);
    expect(bannerState.labels).toEqual(['View', 'Edit', 'Roster', 'Schedule', 'Game Plan', 'Stats', 'Chat', 'Drills']);
    expect(bannerState.gridClass).toContain('lg:grid-cols-8');
    expect(bannerState.exitHref).toBe('dashboard.html');
  });

  test('parent-access banner limits actions and caps unread badge text', async ({ page }) => {
    await page.goto('/');
    await page.setContent('<div id="banner"></div>');

    const bannerState = await page.evaluate(async () => {
      const { renderTeamAdminBanner } = await import('/js/team-admin-banner.js');
      const container = document.getElementById('banner');
      renderTeamAdminBanner(container, {
        teamId: 'team-9',
        team: { name: 'Wildcats', sport: 'Basketball' },
        accessLevel: 'parent',
        unreadCount: 180,
        exitUrl: 'parent-dashboard.html'
      });

      const navLinks = Array.from(container.querySelectorAll('.grid a'));
      const navLabels = Array.from(container.querySelectorAll('.grid a span.text-xs.font-medium'));
      return {
        navCount: navLinks.length,
        labels: navLabels.map(label => label.textContent.trim().replace(/\s+/g, ' ')),
        hasEditLink: container.querySelector('a[href*="edit-team.html"]') !== null,
        gridClass: container.querySelector('.grid').className,
        unreadBadge: container.querySelector('.bg-red-500')?.textContent.trim() || null,
        exitHref: container.querySelector('a[href="parent-dashboard.html"]')?.getAttribute('href') || null
      };
    });

    expect(bannerState.navCount).toBe(2);
    expect(bannerState.labels).toEqual(['View', 'Chat']);
    expect(bannerState.hasEditLink).toBe(false);
    expect(bannerState.gridClass).toContain('grid-cols-2');
    expect(bannerState.unreadBadge).toBe('99+');
    expect(bannerState.exitHref).toBe('parent-dashboard.html');
  });
});
