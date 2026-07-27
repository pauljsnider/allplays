import { expect, test } from '@playwright/test';

const appBaseUrl = process.env.SMOKE_APP_BASE_URL || process.env.SMOKE_APP_BOOT_URL || '';
test.skip(!appBaseUrl, 'SMOKE_APP_BASE_URL or SMOKE_APP_BOOT_URL is required');

function rootUrl(baseURL, path) {
    return new URL(path, `${baseURL}/`).toString();
}

const redirectCases = [
    {
        name: 'login',
        source: '/login.html',
        expected: /^#\/auth$/
    },
    {
        name: 'signup',
        source: '/login.html#signup',
        expected: /^#\/auth\?mode=signup$/
    },
    {
        name: 'invite',
        source: '/accept-invite.html?code=ABCD1234&type=parent',
        expected: /^#\/accept-invite\?code=ABCD1234&type=parent$/
    },
    {
        name: 'password reset action',
        source: '/reset-password.html?mode=resetPassword&oobCode=smoke-placeholder&apiKey=public-placeholder',
        expected: /^#\/reset-password\?.*mode=resetPassword.*oobCode=smoke-placeholder/
    },
    {
        name: 'verification action',
        source: '/verify-pending.html?mode=verifyEmail&oobCode=smoke-placeholder',
        expected: /^#\/reset-password\?.*mode=verifyEmail.*oobCode=smoke-placeholder/
    }
];

for (const definition of redirectCases) {
    test(`legacy ${definition.name} redirects to the app without a loop`, async ({ page, baseURL }) => {
        const visited = [];
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
        });
        await page.goto(rootUrl(baseURL, definition.source), { waitUntil: 'domcontentloaded' });
        await expect.poll(() => new URL(page.url()).pathname, { timeout: 15_000 }).toBe('/app/');
        await expect.poll(() => new URL(page.url()).hash, { timeout: 15_000 }).toMatch(definition.expected);
        expect(visited.filter((pathname) => pathname.endsWith('.html')).length).toBeLessThanOrEqual(1);
    });
}
