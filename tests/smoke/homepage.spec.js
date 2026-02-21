const { test, expect } = require('@playwright/test');

// @smoke
test.describe('AllPlays smoke checks @smoke', () => {
  test('home page loads and key static sections are visible', async ({ page }) => {
    await page.goto('/');

    // Title is correct
    await expect(page).toHaveTitle(/ALL PLAYS/i);

    // Hero CTA is in static DOM — does not depend on Firebase auth resolving
    await expect(page.locator('#hero-cta')).toBeVisible();

    // Static section headings present in HTML (not Firebase-dependent)
    await expect(page.getByRole('heading', { name: /Live & Upcoming Games/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Recent Replays/i })).toBeVisible();
  });

  test('login page is reachable', async ({ page }) => {
    await page.goto('/login.html');
    await expect(page).not.toHaveURL(/error/i);
    await expect(page.locator('body')).toBeVisible();
  });
});
