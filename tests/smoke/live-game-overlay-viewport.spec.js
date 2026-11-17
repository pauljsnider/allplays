import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const html = readFileSync(new URL('../../live-game-overlay.html', import.meta.url), 'utf8');

for (const dynamicViewportSupported of [true, false]) {
    test(`overlay canvas retains height with dynamic viewport support ${dynamicViewportSupported}`, async ({ page }) => {
        // CSS-only fixture: never execute the live game's scripts or contact providers.
        await page.route('**/*', route => route.abort());
        let fixture = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
        if (!dynamicViewportSupported) {
            // Model an older CSS parser discarding unsupported dvh declarations.
            fixture = fixture.replace(/[^{};]+:\s*[^;{}]*dvh\b[^;{}]*;/g, '');
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await page.setContent(fixture);
        for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(viewport);
            const stage = await page.locator('#broadcast-stage').boundingBox();
            expect(Math.abs(stage.height - viewport.height)).toBeLessThan(1);
            expect(stage?.width).toBe(viewport.width);
            const video = await page.locator('.video-layer').boundingBox();
            expect(Math.abs(video.height - viewport.height)).toBeLessThan(1);
        }
    });
}

test('denied browser storage does not stop overlay boot or controls', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://overlay.test') return route.abort();
        try {
            const body = readFileSync(new URL(`../..${url.pathname}`, import.meta.url));
            return route.fulfill({ body, contentType: url.pathname.endsWith('.js') ? 'application/javascript' : url.pathname.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
        } catch {
            return route.abort();
        }
    });
    await page.addInitScript(() => {
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            get() { throw new DOMException('Storage blocked', 'SecurityError'); }
        });
    });
    await page.goto('http://overlay.test/live-game-overlay.html?demo=1');
    expect(errors).toEqual([]);
    await expect(page.locator('#live-status')).toHaveText('LIVE');
    await expect(page.locator('#home-team-name')).toHaveText('Vipers');
    await page.locator('[data-panel="plays"]').click();
    await expect(page.locator('#plays-panel')).toBeVisible();
    expect(errors).toEqual([]);
});
