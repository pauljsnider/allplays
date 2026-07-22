import { expect, test } from '@playwright/test';

const candidateHostUrl = process.env.CANDIDATE_HOST_URL || '';
const authEmail = process.env.SMOKE_AUTH_EMAIL || '';
const authPassword = process.env.SMOKE_AUTH_PASSWORD || '';
const hasCredentials = Boolean(authEmail && authPassword);

test.skip(!candidateHostUrl, 'CANDIDATE_HOST_URL is required for candidate-host auth smoke');
test.skip(!hasCredentials, 'SMOKE_AUTH_EMAIL and SMOKE_AUTH_PASSWORD are required for candidate-host auth smoke');

function candidateUrl(path) {
    return new URL(path, candidateHostUrl).toString();
}

test('candidate host accepts authentication and loads a protected landing page', async ({ page }) => {
    test.setTimeout(45_000);

    await test.step(`authenticate at ${candidateHostUrl}`, async () => {
        await page.goto(candidateUrl('/login.html'), { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#login-form'), `Authentication form did not load at candidate URL ${candidateHostUrl}`)
            .toBeVisible({ timeout: 10_000 });
        await page.locator('#email').fill(authEmail);
        await page.locator('#password').fill(authPassword);
        await page.locator('#submit-btn').click();

        try {
            await page.waitForURL((url) => !url.pathname.endsWith('/login.html'), { timeout: 20_000 });
        } catch (error) {
            const authError = await page.locator('#error-message').textContent().catch(() => '');
            throw new Error(
                `Candidate authentication failed at ${candidateHostUrl}: ${authError?.trim() || error.message}`
            );
        }
    });

    await test.step(`verify authenticated landing page at ${candidateHostUrl}`, async () => {
        const landingUrl = new URL(page.url());
        expect(
            ['/dashboard.html', '/parent-dashboard.html'],
            `Candidate post-login assertion failed at ${candidateHostUrl}: unexpected route ${landingUrl.pathname}`
        ).toContain(landingUrl.pathname);
        await expect(
            page.locator('h1').first(),
            `Candidate post-login assertion failed at ${candidateHostUrl}: authenticated heading was not visible`
        ).toContainText(/My Teams|Parent Dashboard/, { timeout: 10_000 });
    });
});
