const { test, expect } = require('@playwright/test');

async function callDb(page, fnName, args) {
  return page.evaluate(
    async ({ fnNameArg, argsArg }) => {
      const mod = await import('/js/db.js');
      return mod[fnNameArg](...argsArg);
    },
    { fnNameArg: fnName, argsArg: args }
  );
}

async function callTeamBanner(page, fnName, args) {
  return page.evaluate(
    async ({ fnNameArg, argsArg }) => {
      const mod = await import('/js/team-admin-banner.js');
      return mod[fnNameArg](...argsArg);
    },
    { fnNameArg: fnName, argsArg: args }
  );
}

// @critical
test.describe('Security/isolation negative suite @critical', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('canAccessTeamChat denies when user is missing', async ({ page }) => {
    const allowed = await callDb(page, 'canAccessTeamChat', [null, { id: 'team-1', ownerId: 'owner-1' }]);
    expect(allowed).toBe(false);
  });

  test('canAccessTeamChat denies unrelated users from other teams', async ({ page }) => {
    const allowed = await callDb(page, 'canAccessTeamChat', [
      { uid: 'viewer-1', email: 'viewer@example.com', parentOf: [{ teamId: 'team-2', playerId: 'p-1' }] },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [] }
    ]);
    expect(allowed).toBe(false);
  });

  test('canAccessTeamChat allows parent only for linked team', async ({ page }) => {
    const allowed = await callDb(page, 'canAccessTeamChat', [
      { uid: 'parent-1', email: 'parent@example.com', parentOf: [{ teamId: 'team-1', playerId: 'p-1' }] },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [] }
    ]);
    expect(allowed).toBe(true);
  });

  test('canAccessTeamChat handles null parentOf entries safely and denies access', async ({ page }) => {
    const allowed = await callDb(page, 'canAccessTeamChat', [
      { uid: 'parent-1', email: 'parent@example.com', parentOf: [null, undefined] },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [] }
    ]);
    expect(allowed).toBe(false);
  });

  test('canAccessTeamChat handles non-string admin emails safely and still matches valid admin', async ({ page }) => {
    const allowed = await callDb(page, 'canAccessTeamChat', [
      { uid: 'user-1', email: 'coach@example.com' },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [null, 42, 'coach@example.com'] }
    ]);
    expect(allowed).toBe(true);
  });

  test('canModerateChat denies parent users even when they can access chat', async ({ page }) => {
    const allowed = await callDb(page, 'canModerateChat', [
      { uid: 'parent-1', email: 'parent@example.com', parentOf: [{ teamId: 'team-1', playerId: 'p-1' }] },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [] }
    ]);
    expect(allowed).toBe(false);
  });

  test('canModerateChat grants owner moderation rights', async ({ page }) => {
    const allowed = await callDb(page, 'canModerateChat', [
      { uid: 'owner-1', email: 'owner@example.com' },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [] }
    ]);
    expect(allowed).toBe(true);
  });

  test('canModerateChat grants admin moderation with case-insensitive email match', async ({ page }) => {
    const allowed = await callDb(page, 'canModerateChat', [
      { uid: 'admin-1', email: 'Coach@Example.com' },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: ['coach@example.com'] }
    ]);
    expect(allowed).toBe(true);
  });

  test('canModerateChat denies lookalike email that is not an exact admin match', async ({ page }) => {
    const allowed = await callDb(page, 'canModerateChat', [
      { uid: 'admin-1', email: 'coach+spoof@example.com' },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: ['coach@example.com'] }
    ]);
    expect(allowed).toBe(false);
  });

  test('canModerateChat handles malformed adminEmails entries without escalating access', async ({ page }) => {
    const allowed = await callDb(page, 'canModerateChat', [
      { uid: 'user-1', email: 'not-admin@example.com' },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [null, { bad: true }, 123] }
    ]);
    expect(allowed).toBe(false);
  });

  test('getTeamAccessInfo denies parent relationship when linked to another team', async ({ page }) => {
    const access = await callTeamBanner(page, 'getTeamAccessInfo', [
      { uid: 'parent-1', email: 'parent@example.com', parentOf: [{ teamId: 'team-2', playerId: 'p-1' }] },
      { id: 'team-1', ownerId: 'owner-1', adminEmails: [] }
    ]);
    expect(access).toEqual({ hasAccess: false, accessLevel: null, exitUrl: 'index.html' });
  });

  test('renderTeamAdminBanner with unknown access level keeps parent-safe links only', async ({ page }) => {
    await page.setContent('<div id="banner"></div>');

    const result = await page.evaluate(async () => {
      const { renderTeamAdminBanner } = await import('/js/team-admin-banner.js');
      const container = document.getElementById('banner');
      renderTeamAdminBanner(container, {
        teamId: 'team-1',
        team: { name: 'Wildcats', sport: 'Basketball' },
        accessLevel: 'unknown'
      });

      const links = Array.from(container.querySelectorAll('.grid a')).map(a => a.getAttribute('href'));
      return {
        linkCount: links.length,
        hasEditLink: links.some(href => String(href || '').includes('edit-team.html')),
        hasRosterLink: links.some(href => String(href || '').includes('edit-roster.html')),
        hasScheduleLink: links.some(href => String(href || '').includes('edit-schedule.html'))
      };
    });

    expect(result.linkCount).toBe(2);
    expect(result.hasEditLink).toBe(false);
    expect(result.hasRosterLink).toBe(false);
    expect(result.hasScheduleLink).toBe(false);
  });
});
