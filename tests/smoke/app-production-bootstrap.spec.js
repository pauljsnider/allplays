import { expect, test } from '@playwright/test';

const appBootUrl = process.env.SMOKE_APP_BOOT_URL || '';
test.skip(!appBootUrl, 'SMOKE_APP_BOOT_URL is required for production app boot smoke tests');

function appUrl(hashPath = '/auth') {
    const url = new URL(appBootUrl);
    if (!url.pathname.endsWith('/')) {
        url.pathname = `${url.pathname}/`;
    }
    url.hash = hashPath;
    return url.toString();
}

test('production React app boots from deployed /app bundle', async ({ page }) => {
    const fatalErrors = [];
    const failedAssets = [];

    page.on('pageerror', (error) => {
        fatalErrors.push(error.message);
    });

    page.on('requestfailed', (request) => {
        if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
            failedAssets.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.trim());
        }
    });

    await page.goto(appUrl('/auth'), { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveTitle(/ALL PLAYS APP/i);
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    expect(fatalErrors).toEqual([]);
    expect(failedAssets).toEqual([]);
});
