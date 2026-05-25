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

    it('keeps native Google auth on the stable app-session path for iOS and Android', () => {
        const authService = readProjectFile('apps/app/src/lib/authService.ts');
        const iosProject = readProjectFile('ios/App/App.xcodeproj/project.pbxproj');
        const iosEntitlements = readProjectFile('ios/App/App/App.entitlements');

        expectContains(authService, [
            'getNativeGoogleSignInOptions',
            "Capacitor.getPlatform?.() === 'android'",
            'options.useCredentialManager = false',
            "FirebaseAuthentication.signInWithGoogle(getNativeGoogleSignInOptions())",
            "'accounts:signInWithIdp'",
            'Native Google: exchanging token with Firebase Auth REST.'
        ]);
        expect(authService).not.toContain('signInWithCredential(auth');
        expect(authService).not.toContain('Native Google: signing into Firebase Web Auth.');
        expectContains(iosProject, [
            'CODE_SIGN_ENTITLEMENTS = App/App.entitlements;'
        ]);
        expectContains(iosEntitlements, [
            'keychain-access-groups',
            '$(AppIdentifierPrefix)$(CFBundleIdentifier)'
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
            'Generate invite link',
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

    it('covers team-chat.html messaging, conversations, media, reactions, targeting, and AI assistant features', () => {
        const legacyTeamChat = readProjectFile('team-chat.html');
        const messagesPage = readProjectFile('apps/app/src/pages/Messages.tsx');
        const chatService = readProjectFile('apps/app/src/lib/chatService.ts');
        const chatLogic = readProjectFile('apps/app/src/lib/chatLogic.ts');

        expectContains(legacyTeamChat, [
            'getChatConversations',
            'subscribeToChatMessages',
            'postChatMessage',
            'editChatMessage',
            'deleteChatMessage',
            'toggleChatReaction',
            'uploadChatImage',
            'deleteUploadedChatAttachments',
            'updateChatLastRead',
            'id="recipient-picker"',
            'id="media-gallery-btn"',
            '@ALL PLAYS',
            'SpeechRecognition'
        ]);
        expectContains(messagesPage, [
            'loadChatInbox',
            'loadChatTeamContext',
            'subscribeToTeamChatMessages',
            'sendTeamChatMessage',
            'editTeamChatMessage',
            'deleteTeamChatMessage',
            'toggleTeamChatReaction',
            'MediaGallerySheet',
            'AudienceSheet',
            'ConversationSheet',
            'Voice input',
            '@ALL PLAYS'
        ]);
        expectContains(chatService, [
            'getChatConversations',
            'subscribeToChatMessages',
            'postChatMessage',
            'upsertChatConversation',
            'uploadTeamChatAttachment',
            'deleteUploadedChatAttachments',
            'sendAllPlaysChatAnswer',
            'getGenerativeModel',
            'nativeUploadChatMedia',
            'nativePostChatMessage'
        ]);
        expectContains(chatLogic, [
            'formatChatMessageHtml',
            'normalizeChatReactions',
            'buildChatAudienceMetadata',
            'collectThreadMedia',
            'MAX_CHAT_MEDIA_SIZE',
            'shouldUpdateChatLastRead'
        ]);
    });

    it('covers parent-dashboard.html schedule capabilities and filters in the React app schedule', () => {
        const legacyParentDashboard = readProjectFile('parent-dashboard.html');
        const schedulePage = readProjectFile('apps/app/src/pages/Schedule.tsx');
        const scheduleEventDetail = readProjectFile('apps/app/src/pages/ScheduleEventDetail.tsx');
        const scheduleHub = readProjectFile('apps/app/src/lib/scheduleHub.ts');
        const scheduleService = readProjectFile('apps/app/src/lib/scheduleService.ts');
        const scheduleLogic = readProjectFile('apps/app/src/lib/scheduleLogic.ts');

        expectContains(legacyParentDashboard, [
            'schedule-view-list',
            'schedule-view-calendar',
            'player-filter',
            'schedule-filter-upcoming-all',
            'schedule-filter-upcoming-games',
            'schedule-filter-upcoming-practices',
            'schedule-filter-past-all',
            'download-ics',
            'renderEventRideshare',
            'renderAssignments',
            'submitGameRsvpFromButton'
        ]);
        expectContains(schedulePage, [
            'loadParentSchedule',
            'All Upcoming',
            'Upcoming Games',
            'Upcoming Practices',
            'Past Events',
            'All Players',
            '.ics',
            'RSVP needed',
            'Game details',
            'Event details',
            'getEventDetailPath'
        ]);
        expectContains(scheduleEventDetail, [
            'submitParentScheduleRsvp',
            'Availability',
            'Rideshare',
            'Assignments',
            'Game hub',
            'Practice hub',
            'MatchSummarySection',
            'PlayerPerformanceSection',
            'PlayByPlaySection',
            'OpponentStatsSection',
            'Insights',
            'PracticePacketSection'
        ]);
        expectContains(scheduleHub, [
            'Watch replay',
            'Match report',
            'Share practice',
            'getPublicReplayHref',
            'getPublicGameReportHref'
        ]);
        expectContains(scheduleService, [
            'getGames',
            'getPracticeSessions',
            'getRsvps',
            'getRsvpSummaries',
            'listRideOffersForEvent',
            'getAssignmentClaims',
            'fetchAndParseCalendar',
            'filterVisiblePracticeSessions',
            'resolveMyRsvpByChildForGame',
            'submitRsvpForPlayer'
        ]);
        expectContains(scheduleLogic, [
            "'upcoming-all'",
            "'upcoming-games'",
            "'upcoming-practices'",
            "'past-all'",
            'filterParentScheduleEvents',
            'getCalendarScheduleEntries',
            'buildScheduleIcs'
        ]);
    });
});
