import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPendingVerificationRedirectUrl, refreshVerifiedUserToken } from '../../js/verify-pending-flow.js';

function createStorage(values) {
    return {
        getItem(key) {
            return values[key] || null;
        }
    };
}

describe('verify pending legacy page redirect wiring', () => {
    it('uses role-aware redirect logic instead of hardcoded dashboard links', () => {
        const source = readFileSync(resolve(process.cwd(), 'verify-pending.html'), 'utf8');

        expect(source).toContain("import { checkAuth, getRedirectUrl, logout, resendVerificationEmail } from './js/auth.js?v=4433164';");
        expect(source).toContain("import { getPendingVerificationRedirectUrl, refreshVerifiedUserToken } from './js/verify-pending-flow.js?v=2';");
        expect(source).toContain('const redirectUrl = getPendingVerificationRedirectUrl(user, getRedirectUrl);');
        expect(source).toContain('await refreshVerifiedUserToken(user);');
        expect(source).toContain('continueBtn.href = redirectUrl;');
        expect(source).toContain("window.location.href = redirectUrl;");
        expect(source).not.toContain('href="dashboard.html"');
    });

    it.each([
        ['parent', 'PARENT01'],
        ['household', 'HOME1234'],
        ['coparent', 'COPAR123']
    ])('resumes a preserved %s invite after verification', (inviteType, inviteCode) => {
        const redirectUrl = getPendingVerificationRedirectUrl(
            { uid: 'user-123' },
            () => 'dashboard.html',
            createStorage({ inviteCode, inviteType })
        );

        expect(redirectUrl).toBe(`accept-invite.html?code=${inviteCode}&type=${inviteType}`);
    });

    it('falls back to the role-aware route when pending invite storage is unavailable', () => {
        const redirectUrl = getPendingVerificationRedirectUrl(
            { uid: 'user-123' },
            () => 'parent-dashboard.html',
            { getItem: () => { throw new Error('storage blocked'); } }
        );

        expect(redirectUrl).toBe('parent-dashboard.html');
    });

    it('force-refreshes the Firebase ID token after verification', async () => {
        const getIdToken = vi.fn().mockResolvedValue('fresh-token');

        await expect(refreshVerifiedUserToken({ emailVerified: true, getIdToken })).resolves.toBe(true);

        expect(getIdToken).toHaveBeenCalledWith(true);
    });

    it('keeps verified redirects disabled until the token refresh succeeds', () => {
        const source = readFileSync(resolve(process.cwd(), 'verify-pending.html'), 'utf8');
        const refreshIndex = source.indexOf('await refreshVerifiedUserToken(user);');
        const redirectIndex = source.indexOf('window.location.href = redirectUrl;', refreshIndex);
        const enableIndex = source.indexOf("continueBtn.removeAttribute('aria-disabled');");

        expect(refreshIndex).toBeGreaterThan(-1);
        expect(redirectIndex).toBeGreaterThan(refreshIndex);
        expect(enableIndex).toBeGreaterThan(redirectIndex);
        expect(source).toContain("showMessage('Unable to refresh your verification status. Please try again.', true);");
    });

    it('keeps Continue disabled until the redirect target is ready', () => {
        const source = readFileSync(resolve(process.cwd(), 'verify-pending.html'), 'utf8');

        expect(source).toContain('id="continue-btn" href="#" aria-disabled="true" tabindex="-1"');
        expect(source).toContain('opacity-50 cursor-not-allowed pointer-events-none');
        expect(source).toContain("continueBtn.removeAttribute('aria-disabled');");
        expect(source).toContain("continueBtn.removeAttribute('tabindex');");
        expect(source).toContain("continueBtn.classList.remove('opacity-50', 'cursor-not-allowed', 'pointer-events-none');");
        expect(source).toContain("continueBtn.classList.add('hover:bg-indigo-700');");
    });
});
