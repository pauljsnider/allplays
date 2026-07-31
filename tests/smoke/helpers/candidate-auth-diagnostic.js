import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function redactDiagnosticText(value, authEmail, authPassword) {
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

export async function writeRedactedDiagnostic(page, testInfo, failure, {
    candidateHostUrl,
    authEmail,
    authPassword
}) {
    const errorMessage = page.locator('[role="alert"]').first();
    const submitButton = page.getByRole('button', { name: 'Sign in' }).last();
    const loginHeading = page.getByRole('heading', { name: 'Sign in' });
    const hasErrorMessage = (await errorMessage.count().catch(() => 0)) > 0;
    const hasSubmitButton = (await submitButton.count().catch(() => 0)) > 0;
    const hasLoginHeading = (await loginHeading.count().catch(() => 0)) > 0;
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
        visibleError: redactDiagnosticText(errorText, authEmail, authPassword),
        failure: redactDiagnosticText(failure?.message, authEmail, authPassword)
    }, null, 2)}\n`);
}
