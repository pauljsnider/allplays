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
    const stylesheetResponses = [];

    page.on('pageerror', (error) => {
        fatalErrors.push(error.message);
    });

    page.on('requestfailed', (request) => {
        if (['document', 'script', 'stylesheet'].includes(request.resourceType())) {
            failedAssets.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`.trim());
        }
    });

    page.on('response', (response) => {
        const request = response.request();
        if (request.resourceType() === 'stylesheet') {
            stylesheetResponses.push({
                status: response.status(),
                url: response.url()
            });
        }
    });

    await page.goto(appUrl('/auth'), { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveTitle(/ALL PLAYS APP/i);
    await expect(page.locator('#root')).not.toBeEmpty();
    const signInHeading = page.getByRole('heading', { name: 'Sign in' });
    await expect(signInHeading).toBeVisible();
    const authCard = page.locator('.app-card').filter({ has: signInHeading });
    await expect(authCard).toBeVisible();
    const googleButton = page.getByRole('button', { name: 'Continue with Google' });
    await expect(googleButton).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    const badStylesheetResponses = stylesheetResponses
        .filter(({ status }) => status >= 400)
        .map(({ status, url }) => `${status} ${url}`);
    const googleButtonStyles = await googleButton.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
            backgroundColor: style.backgroundColor,
            borderColor: style.borderColor,
            borderStyle: style.borderStyle,
            borderWidth: style.borderWidth,
            minHeight: style.minHeight
        };
    });
    const tailwindIconStyles = await page.locator('.bg-primary-50').first().evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
            backgroundColor: style.backgroundColor,
            height: style.height,
            width: style.width
        };
    });
    const authCardStyles = await authCard.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
            backgroundColor: style.backgroundColor,
            borderRadius: style.borderRadius,
            borderStyle: style.borderStyle,
            borderWidth: style.borderWidth,
            boxShadow: style.boxShadow
        };
    });
    const signInHeadingStyles = await signInHeading.evaluate((element) => {
        const style = window.getComputedStyle(element);
        return {
            color: style.color,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight
        };
    });

    expect(fatalErrors).toEqual([]);
    expect(failedAssets).toEqual([]);
    expect(stylesheetResponses.length).toBeGreaterThan(0);
    expect(badStylesheetResponses).toEqual([]);
    expect(googleButtonStyles).toMatchObject({
        backgroundColor: 'rgb(238, 242, 255)',
        borderColor: 'rgb(199, 210, 254)',
        borderStyle: 'solid',
        borderWidth: '1px',
        minHeight: '40px'
    });
    expect(tailwindIconStyles).toMatchObject({
        backgroundColor: 'rgb(238, 242, 255)',
        height: '44px',
        width: '44px'
    });
    expect(authCardStyles).toMatchObject({
        backgroundColor: 'rgb(255, 255, 255)',
        borderRadius: '16px',
        borderStyle: 'solid',
        borderWidth: '1px',
        boxShadow: 'rgba(16, 24, 40, 0.07) 0px 10px 24px 0px'
    });
    expect(signInHeadingStyles).toMatchObject({
        color: 'oklch(0.13 0.028 261.692)',
        fontSize: '24px',
        fontWeight: '900'
    });
});
