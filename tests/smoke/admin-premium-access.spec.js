import { expect, test } from '@playwright/test';

test('legacy admin toggles global premium access on and off with the shared controller', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.route('**/googletagmanager.com/**', (route) => route.abort());
    await page.route('**/js/telemetry.js?v=*', (route) => route.fulfill({
        contentType: 'application/javascript',
        body: 'export {};'
    }));
    await page.route('**/js/admin.js?v=*', (route) => route.fulfill({
        contentType: 'application/javascript',
        body: `
            import { createAdminPremiumAccessControl } from './admin-premium-access-control.js?v=6';

            let config = { state: 'ready', openToAll: true, reason: 'global-open' };
            window.__premiumWrites = [];
            window.__premiumConfirmations = [];
            const control = createAdminPremiumAccessControl({
                readConfig: async () => ({ ...config }),
                writeConfig: async ({ openToAll }) => {
                    window.__premiumWrites.push(openToAll);
                    config = {
                        state: 'ready',
                        openToAll,
                        reason: openToAll ? 'global-open' : 'entitlement-required'
                    };
                    return { state: 'confirmed', config: { ...config } };
                },
                confirmChange: (message) => {
                    window.__premiumConfirmations.push(message);
                    return true;
                }
            });
            await control.load();
            window.__premiumReady = true;
        `
    }));

    await page.goto('/admin.html');
    await page.waitForFunction(() => window.__premiumReady === true);
    expect(pageErrors).toEqual([]);

    const status = page.locator('#premium-access-status');
    const toggle = page.locator('#premium-access-toggle');
    const feedback = page.locator('#premium-access-feedback');

    await expect(status).toHaveText('On');
    await expect(toggle).toHaveText('Turn premium off');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveClass(/bg-red-600/);

    await toggle.click();
    await expect(status).toHaveText('Off');
    await expect(toggle).toHaveText('Turn premium on');
    await expect(toggle).toHaveClass(/bg-primary-600/);
    await expect(feedback).toContainText('entitlements are now required');

    await toggle.click();
    await expect(status).toHaveText('On');
    await expect(toggle).toHaveText('Turn premium off');
    await expect(feedback).toContainText('unlocked for everyone');
    await expect.poll(() => page.evaluate(() => window.__premiumWrites)).toEqual([false, true]);
    await expect.poll(() => page.evaluate(() => window.__premiumConfirmations.length)).toBe(2);
});
