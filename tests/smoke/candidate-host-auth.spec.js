import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const candidateHostUrl = process.env.CANDIDATE_HOST_URL || '';
const authEmail = process.env.SMOKE_STAFF_EMAIL || process.env.SMOKE_AUTH_EMAIL || '';
const authPassword = process.env.SMOKE_STAFF_PASSWORD || process.env.SMOKE_AUTH_PASSWORD || '';

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
    const errorMessage = page.locator('[role="alert"]').first();
    const submitButton = page.getByRole('button', { name: 'Sign in' }).last();
    const loginHeading = page.getByRole('heading', { name: 'Sign in' });
    const hasErrorMessage = (await errorMessage.count()) > 0;
    const hasSubmitButton = (await submitButton.count()) > 0;
    const hasLoginHeading = (await loginHeading.count()) > 0;
    const errorText = hasErrorMessage
        ? await errorMessage.textContent({ timeout: 1_000 }).catch(() => '')
        : '';
    const submitDisabled = hasSubmitButton
        ? await submitButton.isDisabled({ timeout: 1_000 }).catch(() => null)
        : null;
    const loginFormVisible = hasLoginHeading
        ? await loginHeading.isVisible({ timeout: 1_000 }).catch(() => false)
        : false;
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
    test.setTimeout(90_000);
    try {
        expect(authEmail, 'SMOKE_STAFF_EMAIL or SMOKE_AUTH_EMAIL is required for candidate-host auth smoke').toBeTruthy();
        expect(authPassword, 'SMOKE_STAFF_PASSWORD or SMOKE_AUTH_PASSWORD is required for candidate-host auth smoke').toBeTruthy();

        await test.step(`authenticate at ${candidateHostUrl}`, async () => {
            await page.goto(candidateUrl('/app/#/auth'), { waitUntil: 'domcontentloaded' });
            await expect(page.getByRole('heading', { name: 'Sign in' }), `Authentication form did not load at candidate URL ${candidateHostUrl}`)
                .toBeVisible({ timeout: 30_000 });
            await page.getByLabel('Email').fill(authEmail);
            await page.getByLabel('Password', { exact: true }).fill(authPassword);
            const submitButton = page.getByRole('button', { name: 'Sign in' }).last();
            const errorMessage = page.locator('[role="alert"]').first();
            await submitButton.click();

            const ignoreRejectedOutcome = (promise) => promise.catch(() => new Promise(() => {}));
            const outcome = await Promise.race([
                ignoreRejectedOutcome(
                    page.waitForURL((url) => url.pathname === '/app/' && !url.hash.startsWith('#/auth'), { timeout: 20_000 })
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
            ).toBe('/app/');
            expect(landingUrl.hash).not.toMatch(/^#\/auth(?:\?|$)/);
            await expect(
                page.locator('h1').first(),
                `Candidate post-login assertion failed at ${candidateHostUrl}: authenticated heading was not visible`
            ).toContainText(/Your day|Your teams|Team/, { timeout: 25_000 });
        });
    } catch (error) {
        const passwordInput = page.getByLabel('Password', { exact: true });
        const emailInput = page.getByLabel('Email');
        if (await passwordInput.count()) {
            await passwordInput.fill('', { timeout: 1_000 }).catch(() => {});
        }
        if (await emailInput.count()) {
            await emailInput.fill('', { timeout: 1_000 }).catch(() => {});
        }
        await writeRedactedDiagnostic(page, testInfo, error);
        throw new Error(
            `Candidate authentication failed at ${new URL(candidateHostUrl).origin}: ${redactDiagnosticText(error?.message)}`
        );
    }
});
