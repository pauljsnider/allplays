import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function readRepoFile(relativePath) {
    return readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');
}

describe('legacy account action pages', () => {
    it('keeps reset-password.html wired for all Firebase account action modes', () => {
        const html = readRepoFile('reset-password.html');

        expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
        expect(html).toContain("import { auth } from './js/firebase.js?v=21';");
        expect(html).toContain('verifyPasswordResetCode');
        expect(html).toContain('confirmPasswordReset');
        expect(html).toContain('applyActionCode');
        expect(html).toContain("case 'verifyEmail':");
        expect(html).toContain("case 'resetPassword':");
        expect(html).toContain("case 'recoverEmail':");
        expect(html).toContain('id="reset-form"');
        expect(html).toContain('id="new-password"');
        expect(html).toContain('id="confirm-password"');
        expect(html).toContain("showInvalidCode('No action code provided.')");
        expect(html).toContain("showInvalidCode('Unknown action type.')");
    });

    it('keeps verify-pending.html safe to continue later and resend verification email', () => {
        const html = readRepoFile('verify-pending.html');

        expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
        expect(html).toContain("checkAuth((user) => {");
        expect(html).toContain('skipEmailVerificationCheck: true');
        expect(html).toContain('id="continue-btn"');
        expect(html).toContain('aria-disabled="true"');
        expect(html).toContain('id="auto-redirect-msg"');
        expect(html).toContain('id="countdown"');
        expect(html).toContain('id="resend-btn"');
        expect(html).toContain('await resendVerificationEmail();');
        expect(html).toContain('id="logout-btn"');
        expect(html).toContain('await logout();');
    });
});
