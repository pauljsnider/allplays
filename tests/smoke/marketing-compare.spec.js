import { expect, test } from '@playwright/test';
import { assertPageBootsWithoutFatalErrors } from './helpers/boot-path.js';
for (const width of [320, 390, 1280]) {
    test(`comparison stays readable at ${width}px`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height: 900 });
        await assertPageBootsWithoutFatalErrors(page, { baseURL, path: '/compare.html' });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.getByRole('heading', { name: 'ALL PLAYS vs. Hudl', exact: true })).toBeVisible();
        await expect(page.getByRole('link', { name: 'Explore teams and games' })).toHaveAttribute('href', 'teams.html');
        await page.getByRole('link', { name: 'Compare the platforms' }).click();
        await expect(page).toHaveURL(/#compare-vendors$/);
        await expect(page.locator('#roku-access')).toContainText('not listed in the Roku Channel Store');
        await expect(page.locator('#roku-access a')).toHaveAttribute('href', 'app.html#platforms');
        await page.locator('summary').click();
        await expect(page.getByRole('link', { name: 'Hudl Fan supports Roku' })).toBeVisible();
        for (const link of await page.getByRole('link', { name: 'Request team access', exact: true }).all()) {
            await expect(link).toHaveAttribute('href', 'mailto:paul@paulsnider.net?subject=ALL%20PLAYS%20Access%20Request');
        }
        const missing = await page.locator('a[href^="#"]').evaluateAll(links => links.map(a => a.getAttribute('href')).filter(href => !document.querySelector(href)));
        expect(missing).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
}
