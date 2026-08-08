import { expect, test } from '@playwright/test';

test.skip(
    process.env.SMOKE_SUITE === 'production',
    'Config-injected app specs need the Vite dev server / staged bundle; production runs cover the deployed bundle elsewhere'
);

const appBaseUrl = process.env.SMOKE_APP_BASE_URL || process.env.SMOKE_APP_BOOT_URL || '';
const staticBaseUrl = process.env.SMOKE_BASE_URL || appBaseUrl;
test.skip(!appBaseUrl, 'SMOKE_APP_BASE_URL or SMOKE_APP_BOOT_URL is required');

// A non-production Firebase config so the app boots far enough to render the auth
// form. These specs never submit, so the config only needs a valid shape.
const NON_PRODUCTION_FIREBASE_CONFIG = {
    firebase: {
        apiKey: 'smoke-non-production-key',
        authDomain: 'demo-allplays.firebaseapp.com',
        projectId: 'demo-allplays',
        messagingSenderId: '000000000000',
        appId: '1:000000000000:web:demoallplayssmoke',
        storageBucket: 'demo-allplays.appspot.com'
    }
};

test.beforeEach(async ({ page }) => {
    await page.addInitScript((cfg) => {
        window.__ALLPLAYS_CONFIG__ = cfg;
    }, NON_PRODUCTION_FIREBASE_CONFIG);
});

function rootUrl(path) {
    return new URL(path, staticBaseUrl).toString();
}

function appUrl(route) {
    const url = new URL(appBaseUrl);
    url.hash = route;
    return url.toString();
}

// The legacy /login.html signup entry redirects into the canonical app auth page,
// so this covers the real signup journey a legacy web visitor experiences.
test('legacy signup entry lands on the app terms gate', async ({ page }) => {
    await page.goto(rootUrl('/login.html#signup'), { waitUntil: 'domcontentloaded' });
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/app/');
    await expect.poll(() => new URL(page.url()).hash, { timeout: 15_000 }).toMatch(/^#\/auth\?mode=signup$/);
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /I agree/ })).toBeVisible();
});

test('signup account creation is blocked until the terms checkbox is agreed', async ({ page }) => {
    await page.goto(appUrl('/auth?mode=signup'), { waitUntil: 'domcontentloaded' });

    const createButton = page.getByRole('button', { name: 'Create account' });
    const googleButton = page.getByRole('button', { name: 'Continue with Google' });
    const agree = page.getByRole('checkbox', { name: /I agree/ });

    await expect(createButton).toBeVisible();
    await expect(createButton).toBeDisabled();
    await expect(googleButton).toBeDisabled();

    await agree.check();

    await expect(createButton).toBeEnabled();
    await expect(googleButton).toBeEnabled();
});

test('signup terms checkbox links to the public Terms and Privacy pages', async ({ page }) => {
    await page.goto(appUrl('/auth?mode=signup'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', 'https://allplays.ai/terms.html');
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', 'https://allplays.ai/privacy.html');
});
