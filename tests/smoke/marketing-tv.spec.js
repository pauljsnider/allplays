import { expect, test } from '@playwright/test';
import { assertPageBootsWithoutFatalErrors } from './helpers/boot-path.js';

for (const width of [320, 390, 1280]) {
    test(`TV discovery and honest availability at ${width}px`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height: 900 });
        await assertPageBootsWithoutFatalErrors(page, { baseURL, path: '/' });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        const tv = page.locator('#tv');
        await expect(tv.getByText('Game replays on Roku')).toBeVisible();
        await expect(tv.locator('figcaption')).toContainText('Illustrative game imagery.');
        await expect(tv.getByRole('link', { name: 'Explore teams on the web' })).toHaveAttribute('href', 'teams.html');
        await tv.getByRole('link', { name: 'Ways to use ALL PLAYS' }).click();
        await expect(page).toHaveURL(/app.html#platforms$/);
        await expect(page.getByRole('link', { name: /App Store|Google Play/ })).toHaveCount(0);
        await expect(page.locator('#get').getByRole('link', { name: 'Get started on the web' })).toHaveAttribute('href', '/app/#/auth?mode=signup');
        await expect(page.locator('#roku-availability')).toContainText('Watch YouTube game replays on your TV with Roku.');
        await expect(page.locator('#roku-availability')).toContainText('private sideloading; not listed in the Roku Channel Store.');
        await expect(page.locator('#roku-availability a')).toHaveCount(0);
        await expect(page.locator('#platforms').getByRole('link', { name: 'Get started on the web' })).toHaveAttribute('href', '/app/#/auth?mode=signup');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
}
