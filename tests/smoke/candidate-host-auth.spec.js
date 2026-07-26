import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const candidateHostUrl = process.env.CANDIDATE_HOST_URL || '';
const authEmail = process.env.SMOKE_AUTH_EMAIL || '';
const authPassword = process.env.SMOKE_AUTH_PASSWORD || '';

test.skip(!candidateHostUrl, 'CANDIDATE_HOST_URL is required for candidate-host auth smoke');

function candidateUrl(path) {
    return new URL(path, candidateHostUrl).toString();
}

function redactDiagnosticText(value) {
    let redacted = String(value || '');
    if (authPassword) {
        redacted = redacted.replaceAll(authPassword, '[REDACTED]');
    }
    if (authEmail) {
        redacted = redacted.replaceAll(authEmail, '[REDACTED_EMAIL]');
    }
    return redacted
        .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
        .slice(0, 500);
}

async function writeRedactedDiagnostic(page, testInfo, failure) {
    const errorText = await page.locator('#error-message').textContent().catch(() => '');
    const submitDisabled = await page.locator('#submit-btn').isDisabled().catch(() => null);
    const loginFormVisible = await page.locator('#login-form').isVisible().catch(() => false);
    const diagnosticPath = testInfo.outputPath('candidate-auth-diagnostic.json');
    await mkdir(path.dirname(diagnosticPath), { recursive: true });
    await writeFile(diagnosticPath, `${JSON.stringify({
        observedAt: new Date().toISOString(),
        origin: new URL(candidateHostUrl).origin,
        path: new URL(page.url()).pathname,
        loginFormVisible,
        submitDisabled,
        visibleError: redactDiagnosticText(errorText),
        failure: redactDiagnosticText(failure?.message)
    }, null, 2)}\n`);
}

test('candidate host accepts authentication and loads a protected landing page', async ({ page }, testInfo) => {
    test.setTimeout(45_000);
    try {
        expect(authEmail, 'SMOKE_AUTH_EMAIL is required for candidate-host auth smoke').toBeTruthy();
        expect(authPassword, 'SMOKE_AUTH_PASSWORD is required for candidate-host auth smoke').toBeTruthy();

        await test.step(`authenticate at ${candidateHostUrl}`, async () => {
            await page.goto(candidateUrl('/login.html'), { waitUntil: 'domcontentloaded' });
            await expect(page.locator('#login-form'), `Authentication form did not load at candidate URL ${candidateHostUrl}`)
                .toBeVisible({ timeout: 10_000 });
            await page.locator('#email').fill(authEmail);
            await page.locator('#password').fill(authPassword);
            const submitButton = page.locator('#submit-btn');
            const errorMessage = page.locator('#error-message');
            await submitButton.click();
            await expect(submitButton).toBeDisabled({ timeout: 5_000 });

            const ignoreRejectedOutcome = (promise) => promise.catch(() => new Promise(() => {}));
            const outcome = await Promise.race([
                ignoreRejectedOutcome(
                    page.waitForURL((url) => !url.pathname.endsWith('/login.html'), { timeout: 20_000 })
                        .then(() => 'navigation')
                ),
                ignoreRejectedOutcome(
                    expect(errorMessage).toBeVisible({ timeout: 20_000 })
                        .then(() => 'visible-error')
                ),
                ignoreRejectedOutcome(
                    expect(submitButton).toBeEnabled({ timeout: 20_000 })
                        .then(() => 'form-recovered')
                ),
                page.waitForTimeout(20_000).then(() => 'timeout')
            ]);

            if (outcome !== 'navigation') {
                const authError = redactDiagnosticText(await errorMessage.textContent().catch(() => ''));
                throw new Error(
                    `Candidate authentication ended with ${outcome}: ${authError || 'no visible error'}`
                );
            }
        });

        await test.step(`verify authenticated landing page at ${candidateHostUrl}`, async () => {
            const landingUrl = new URL(page.url());
            expect(
                landingUrl.origin,
                `Candidate post-login assertion failed at ${candidateHostUrl}: unexpected origin ${landingUrl.origin}`
            ).toBe(new URL(candidateHostUrl).origin);
            expect(
                landingUrl.pathname,
                `Candidate post-login assertion failed at ${candidateHostUrl}: unexpected route ${landingUrl.pathname}`
            ).toMatch(/^\/(?:dashboard|parent-dashboard)\.html$/);
            await expect(
                page.locator('h1').first(),
                `Candidate post-login assertion failed at ${candidateHostUrl}: authenticated heading was not visible`
            ).toContainText(/My Teams|Parent Dashboard/, { timeout: 10_000 });
        });
    } catch (error) {
        await page.locator('#password').fill('').catch(() => {});
        await page.locator('#email').fill('').catch(() => {});
        await writeRedactedDiagnostic(page, testInfo, error);
        throw new Error(
            `Candidate authentication failed at ${new URL(candidateHostUrl).origin}: ${redactDiagnosticText(error?.message)}`
        );
    }
});
