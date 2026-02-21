const { test, expect } = require('@playwright/test');

// @smoke
test.describe('URL param parsing @smoke', () => {
  test('game page accepts HTML-escaped hash delimiters', async ({ page }) => {
    await page.goto('/game.html#teamId=demoTeam&amp;gameId=demoGame');
    await page.waitForTimeout(1200);

    // If parsing fails, game.html redirects to index.html.
    await expect(page).toHaveURL(/\/game\.html#/);
  });
});
