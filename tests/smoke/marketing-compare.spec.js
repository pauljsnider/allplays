import { expect, test } from '@playwright/test';
import { assertPageBootsWithoutFatalErrors } from './helpers/boot-path.js';
for (const width of [320, 390, 1280]) {
    test(`comparison stays readable at ${width}px`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height: 900 });
        await assertPageBootsWithoutFatalErrors(page, { baseURL, path: '/compare.html' });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.getByRole('columnheader', { name: 'Hudl' })).toHaveCount(1);
        const table = page.getByRole('region', { name: /Feature comparison/ });
        await table.focus();
        await expect(table).toBeFocused();
        await expect(page.locator('#roku-comparison')).toContainText('Private sideloading');
        await expect(page.locator('#roku-access')).toContainText('not listed in the Roku Channel Store');
        await expect(page.locator('#roku-access a')).toHaveAttribute('href', 'app.html#platforms');
    });
}
