import { expect, test } from '@playwright/test';
import { buildUrl, createBootIssueCollector } from './helpers/boot-path.js';

const FOUNDER_PORTRAIT_ALT = 'Paul Snider — founder, dad, and coach';
const VIEWPORTS = [
    { width: 390, height: 844 },
    { width: 1440, height: 900 }
];

async function installExternalResourceStubs(page) {
    await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));
    await page.route('https://paulsnider.net/images/profile.jpg', (route) => route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"></svg>'
    }));
}

test('About founder portrait starts below mobile and desktop viewports', async ({ page, baseURL }) => {
    const issues = createBootIssueCollector(page, { baseURL });
    await installExternalResourceStubs(page);

    for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        const response = await page.goto(buildUrl(baseURL, '/about.html'), { waitUntil: 'domcontentloaded' });

        expect(response?.ok()).toBe(true);
        await page.locator('#header-container header').waitFor({ state: 'attached' });
        await page.waitForFunction((expectedPaddingTop) => {
            const heroContainer = document.querySelector('section .container');
            return heroContainer && getComputedStyle(heroContainer).paddingTop === expectedPaddingTop;
        }, viewport.width >= 768 ? '96px' : '64px');
        expect(issues).toEqual([]);

        const portrait = page.getByAltText(FOUNDER_PORTRAIT_ALT);
        await expect(portrait).toHaveAttribute('loading', 'lazy');
        await expect(portrait).toHaveAttribute('decoding', 'async');

        const layout = await portrait.evaluate((image) => ({
            top: image.getBoundingClientRect().top,
            viewportHeight: window.innerHeight,
            scrollY: window.scrollY
        }));
        expect(layout.scrollY).toBe(0);
        expect(layout.top).toBeGreaterThanOrEqual(layout.viewportHeight);
    }
});
