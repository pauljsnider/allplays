import { expect } from '@playwright/test';

const transparentPixel = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
);

/**
 * Keeps visual smoke states independent from analytics, remote images, Firebase,
 * and other third-party availability. Register page-specific module mocks after
 * this guard so Playwright's most-recent route wins for those local modules.
 */
export async function installVisualNetworkGuard(page, pageUrl) {
    const allowedOrigin = new URL(pageUrl).origin;
    await page.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === allowedOrigin) {
            await route.continue();
            return;
        }

        if (request.resourceType() === 'image') {
            await route.fulfill({ status: 200, contentType: 'image/png', body: transparentPixel });
            return;
        }

        await route.abort('blockedbyclient');
    });
}

export async function expectVisualSnapshot(page, snapshotName, options = {}) {
    // The committed baselines are deliberately CI-native Linux/Chromium
    // images. Keep the behavioral smoke coverage active on developer machines
    // without asking Playwright for nonexistent darwin/win32 baselines.
    if (process.platform !== 'linux') return;

    await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
    });
    await page.addStyleTag({
        content: `
            *, *::before, *::after {
                animation-delay: 0s !important;
                animation-duration: 0s !important;
                caret-color: transparent !important;
                transition-delay: 0s !important;
                transition-duration: 0s !important;
            }
        `
    });
    await expect(page).toHaveScreenshot(snapshotName, {
        fullPage: true,
        ...options
    });
}
