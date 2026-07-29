import { test, expect } from '@playwright/test';
import { createBootIssueCollector } from './helpers/boot-path.js';

const appBaseUrl = process.env.SMOKE_APP_BASE_URL || process.env.SMOKE_APP_BOOT_URL || '';
const usesSyntheticPreviewFirebase = process.env.SMOKE_EXPECTED_FIREBASE_RUNTIME_TARGET === 'preview-smoke';
test.skip(!appBaseUrl, 'SMOKE_APP_BASE_URL or SMOKE_APP_BOOT_URL is required');
test.skip(
    usesSyntheticPreviewFirebase,
    'Real Firebase bootstrap probes require a valid Firebase runtime identity'
);

function appUrl(route) {
    const url = new URL(appBaseUrl);
    url.hash = route;
    return url.toString();
}

test('canonical auth page survives real Firebase auth bootstrap', async ({ page }) => {
    const issues = createBootIssueCollector(page, { baseURL: appBaseUrl });

    await page.goto(appUrl('/auth'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page).toHaveTitle(/ALL PLAYS/i);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    expect(issues).toEqual([]);
});

test('canonical reset-password route renders invalid-code state after real Firebase bootstrap', async ({ page }) => {
    await page.route('https://identitytoolkit.googleapis.com/**', async (route) => {
        const request = route.request();
        if (!request.url().includes('accounts:resetPassword')) {
            await route.continue();
            return;
        }

        const postData = request.postData() || '';
        if (postData.includes('"oobCode":"bad-code"')) {
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
            return;
        }

        await route.abort('failed');
    });

    const issues = createBootIssueCollector(page, {
        baseURL: appBaseUrl,
        ignoredConsoleErrors: [
            /Error verifying reset code:/i,
            /INVALID_OOB_CODE/i,
            /invalid-action-code/i
        ]
    });

    await page.goto(appUrl('/reset-password?mode=resetPassword&oobCode=bad-code'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Account action' })).toBeVisible();
    await expect(page.getByText(/invalid|expired/i).first()).toBeVisible();
    await expect(page).toHaveTitle(/ALL PLAYS/i);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    expect(issues).toEqual([]);
});
