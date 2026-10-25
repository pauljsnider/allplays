import { expect, test } from '@playwright/test';
import { assertPageBootsWithoutFatalErrors } from './helpers/boot-path.js';

for (const width of [390, 1280]) {
    test(`TV discovery and honest availability at ${width}px`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height: 900 });
        await assertPageBootsWithoutFatalErrors(page, { baseURL, path: '/' });
        const tv = page.locator('#tv');
        await expect(tv.getByText('Roku experience · In development')).toBeVisible();
        await expect(tv.locator('figcaption')).toContainText('Concept preview');
        await expect(tv.getByRole('link', { name: 'Explore teams on the web' })).toHaveAttribute('href', 'teams.html');
        await tv.getByRole('link', { name: 'Ways to use ALL PLAYS' }).click();
        await expect(page).toHaveURL(/app.html#platforms$/);
        await expect(page.locator('#roku-availability')).toContainText('Not yet available to install');
        await expect(page.locator('#roku-availability a')).toHaveCount(0);
        await expect(page.locator('#platforms').getByRole('link', { name: 'Get started on the web' })).toHaveAttribute('href', '/app/#/auth?mode=signup');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
}
