const { test, expect } = require('@playwright/test');

test.describe('AllPlays smoke checks', () => {
  test('home page loads primary public sections', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/ALL PLAYS/i);
    await expect(page.getByRole('heading', { name: /Live & Upcoming Games/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Recent Replays/i })).toBeVisible();
    await expect(page.locator('#nav-cta-desktop')).toBeVisible();
  });
});
