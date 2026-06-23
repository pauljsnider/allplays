import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('verify pending legacy page redirect wiring', () => {
    it('uses role-aware redirect logic instead of hardcoded dashboard links', () => {
        const source = readFileSync(resolve(process.cwd(), 'verify-pending.html'), 'utf8');

        expect(source).toContain("import { checkAuth, getRedirectUrl, logout, resendVerificationEmail } from './js/auth.js?v=30';");
        expect(source).toContain('const redirectUrl = getRedirectUrl(user);');
        expect(source).toContain('continueBtn.href = redirectUrl;');
        expect(source).toContain("window.location.href = redirectUrl;");
        expect(source).not.toContain('href="dashboard.html"');
    });
});
