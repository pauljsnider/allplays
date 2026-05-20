import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function readProjectFile(relativePath) {
    return readFileSync(resolve(rootDir, relativePath), 'utf8');
}

function expectContains(source, expectedTokens) {
    expectedTokens.forEach((token) => {
        expect(source).toContain(token);
    });
}

describe('React app auth/profile capability parity', () => {
    it('keeps first-class app routes for the legacy auth/profile pages', () => {
        const appRoutes = readProjectFile('apps/app/src/App.tsx');

        expectContains(appRoutes, [
            'path="/auth"',
            'path="/accept-invite"',
            'path="/reset-password"',
            'path="/verify-pending"',
            'path="/profile"'
        ]);
    });

    it('does not replace signed-in screens with the loading splash during background auth refreshes', () => {
        const appRoutes = readProjectFile('apps/app/src/App.tsx');

        expect(appRoutes).toContain('auth.loading && !auth.user');
        expect(appRoutes).not.toContain('if (auth.loading) {');
    });

    it('covers login.html sign-in, sign-up, Google, activation code, and password reset features', () => {
        const legacyLogin = readProjectFile('login.html');
        const authPage = readProjectFile('apps/app/src/pages/AuthPage.tsx');
        const authService = readProjectFile('apps/app/src/lib/authService.ts');

        expectContains(legacyLogin, [
            'id="login-form"',
            'id="google-btn"',
            'id="forgot-password-btn"',
            'id="activation-code"'
        ]);
        expectContains(authPage, [
            'signInWithEmail',
            'signUpWithEmail',
            'signInWithGoogleAccount',
            'sendResetEmail',
            'confirmPassword',
            'activationCode',
            'Forgot password?',
            'Continue with Google',
            'Enter invite code',
            'Account action'
        ]);
        expectContains(authService, [
            'signInWithNativeRestSession',
            'signInWithNativeGoogleCredential',
            'skipNativeAuth: true',
            'completeGoogleRedirect',
            'sendPasswordResetEmail'
        ]);
    });

    it('covers accept-invite.html invite redemption, email link completion, account linking, and redirects', () => {
        const legacyInvite = readProjectFile('accept-invite.html');
        const acceptInvite = readProjectFile('apps/app/src/pages/AcceptInvite.tsx');
        const authService = readProjectFile('apps/app/src/lib/authService.ts');

        expectContains(legacyInvite, [
            'email-required-state',
            'invite-link-state',
            'manual-code-state',
            'processInvite'
        ]);
        expectContains(acceptInvite, [
            'completeEmailLink',
            'isEmailLink',
            'manualCode',
            'rememberPendingInvite',
            'redeemInviteForUser',
            'mapLegacyRedirectToAppRoute',
            'Sign in to accept',
            'Create account with code',
            'buildInviteAuthUrl(normalizedCode, inviteType)'
        ]);
        expectContains(authService, [
            'createInviteProcessor',
            'redeemParentInvite',
            'redeemHouseholdInvite',
            'redeemAdminInviteAtomically',
            'clearPendingInvite'
        ]);
    });

    it('covers reset-password.html and verify-pending.html account action features', () => {
        const legacyReset = readProjectFile('reset-password.html');
        const legacyVerify = readProjectFile('verify-pending.html');
        const resetPassword = readProjectFile('apps/app/src/pages/ResetPassword.tsx');
        const verifyPending = readProjectFile('apps/app/src/pages/VerifyPending.tsx');

        expectContains(legacyReset, [
            "case 'verifyEmail'",
            "case 'resetPassword'",
            "case 'recoverEmail'",
            'confirmPasswordReset'
        ]);
        expectContains(resetPassword, [
            "mode === 'verifyEmail'",
            "mode === 'recoverEmail'",
            "mode === 'resetPassword'",
            'verifyResetCode',
            'confirmReset',
            'applyEmailActionCode',
            'Continue to login'
        ]);
        expectContains(legacyVerify, [
            'user-email',
            'continue-btn',
            'resend-btn',
            'logout-btn'
        ]);
        expectContains(verifyPending, [
            'Continue to dashboard',
            'Resend verification email',
            'Refresh status',
            'Sign out',
            'emailVerified'
        ]);
    });

    it('covers profile.html account profile, notifications, invite codes, verification, and account settings', () => {
        const legacyProfile = readProjectFile('profile.html');
        const profilePage = readProjectFile('apps/app/src/pages/Profile.tsx');
        const profileService = readProjectFile('apps/app/src/lib/profileService.ts');

        expectContains(legacyProfile, [
            'id="photo-upload"',
            'id="notification-team-select"',
            'id="notification-live-chat"',
            'id="enable-push-btn"',
            'id="generate-code-btn"',
            'id="set-password-section"',
            'id="resend-verify-btn"'
        ]);
        expectContains(profilePage, [
            "'account'",
            "'alerts'",
            "'invites'",
            "'security'",
            'Choose photo',
            'Remove',
            'Notification preferences',
            'Enable push',
            'Live Chat',
            'Live Score',
            'Schedule Changes',
            'Email not verified',
            'Set a password',
            'Send password reset',
            'Generate code',
            'Show fewer codes',
            'Sign out'
        ]);
        expectContains(profileService, [
            'loadProfileDocument',
            'saveProfileDocument',
            'uploadProfilePhoto',
            'loadNotificationTeams',
            'saveNotificationPreferences',
            'saveNotificationDeviceToken',
            'createProfileAccessCode',
            'loadProfileAccessCodes',
            'nativeUploadProfilePhoto'
        ]);
    });
});
