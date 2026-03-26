import { test, expect } from '@playwright/test';
import { buildUrl, createBootIssueCollector } from './helpers/boot-path.js';

test('login page survives real Firebase auth bootstrap', async ({ page, baseURL }) => {
    const issues = createBootIssueCollector(page, { baseURL });

    await page.goto(buildUrl(baseURL, '/login.html'), { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#login-form')).toBeVisible();
    await expect(page.locator('#google-btn')).toBeVisible();
    await expect(page).toHaveTitle(/Login - ALL PLAYS/i);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    expect(issues).toEqual([]);
});

test('reset-password page renders invalid-code state after real Firebase bootstrap', async ({ page, baseURL }) => {
    await page.route('https://identitytoolkit.googleapis.com/**', async (route) => {
        const request = route.request();
        const isResetPasswordRequest = request.url().includes('accounts:resetPassword');
        if (!isResetPasswordRequest) {
            await route.continue();
            return;
        }

        const postData = request.postData() || '';
        const isBadCodeRequest = postData.includes('"oobCode":"bad-code"');

        if (!isBadCodeRequest) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 400,
            contentType: 'application/json',
            body: JSON.stringify({
                error: {
                    code: 400,
                    message: 'INVALID_OOB_CODE'
                }
            })
        });
    });

    const issues = createBootIssueCollector(page, {
        baseURL,
        ignoredConsoleErrors: [
            /Error verifying reset code:/i,
            /INVALID_OOB_CODE/i
        ]
    });

    await page.goto(
        buildUrl(baseURL, '/reset-password.html?mode=resetPassword&oobCode=bad-code'),
        { waitUntil: 'domcontentloaded' }
    );

    await expect(page.locator('#invalid-code-state')).toBeVisible();
    await expect(page.locator('#invalid-code-message')).toContainText(/invalid|expired/i);
    await expect(page.locator('#loading-state')).toBeHidden();
    await expect(page).toHaveTitle(/Account Action - ALL PLAYS/i);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    expect(issues).toEqual([]);
});
