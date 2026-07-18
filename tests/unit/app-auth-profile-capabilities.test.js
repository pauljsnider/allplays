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
            'path="/profile"',
            'path="/teams/:teamId/fees"',
            'path="/teams/:teamId/fees/:batchId"'
        ]);
    });

    it('does not replace signed-in screens with the loading splash during background auth refreshes', () => {
        const appRoutes = readProjectFile('apps/app/src/App.tsx');

        expect(appRoutes).toContain('auth.loading && !auth.user');
        expect(appRoutes).not.toContain('if (auth.loading) {');
    });

    it('keeps My Teams as a first-class route without a reload redirect', () => {
        const appRoutes = readProjectFile('apps/app/src/App.tsx');
        const reloadRouting = readProjectFile('apps/app/src/lib/reloadRouting.ts');

        expect(appRoutes).toContain('<Route path="/teams" element={<Protected auth={auth}><Teams auth={auth} /></Protected>} />');
        expect(appRoutes).not.toContain("import { shouldReloadTeamsToHome } from './lib/reloadRouting';");
        expect(appRoutes).not.toContain('shouldDefaultReloadToHome');
        expect(appRoutes).not.toContain('isBrowserReload()');
        expectContains(reloadRouting, [
            'return false;'
        ]);
    });

    it('hydrates team media upload grants into app auth users', () => {
        const authService = readProjectFile('apps/app/src/lib/authService.ts');
        const types = readProjectFile('apps/app/src/lib/types.ts');

        expectContains(types, [
            'teamMediaUploadTeamIds?: string[];',
            'mediaUploadTeamIds?: string[];'
        ]);
        expectContains(authService, [
            'teamMediaUploadTeamIds: Array.isArray(profile.teamMediaUploadTeamIds)',
            "profile.teamMediaUploadTeamIds.filter((teamId): teamId is string => typeof teamId === 'string')",
            'mediaUploadTeamIds: Array.isArray(profile.mediaUploadTeamIds)',
            "profile.mediaUploadTeamIds.filter((teamId): teamId is string => typeof teamId === 'string')"
        ]);
    });

    it('hydrates normalized parent scope keys into app auth users', () => {
        const authService = readProjectFile('apps/app/src/lib/authService.ts');
        const types = readProjectFile('apps/app/src/lib/types.ts');

        expectContains(types, [
            'parentTeamIds?: string[];',
            'parentPlayerKeys?: string[];'
        ]);
        expectContains(authService, [
            'Array.isArray(profile.parentTeamIds)',
            'Array.isArray(profile.parentPlayerKeys)',
            'parentTeamIds: Array.isArray(profile.parentTeamIds)',
            'parentPlayerKeys: Array.isArray(profile.parentPlayerKeys)'
        ]);
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
            'Enter join code'
        ]);
        expect(authPage).not.toContain('Account action');
        expect(authPage).not.toContain('<Link to="/reset-password"');
        expectContains(authService, [
            'signInWithNativeRestSession',
            'signInWithNativeGoogleCredential',
            'skipNativeAuth: true',
            'completeGoogleRedirect',
            'queuePasswordResetEmail'
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
            "I've verified, continue",
            'Resend verification email',
            'Continue without verifying',
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
            'id="notification-preference-groups"',
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
            'Enable push on this device',
            'Register this device for push notifications without changing team alert preferences.',
            'Turn on game-day alerts',
            'Customize alerts',
            'notificationPreferenceGroups.map',
            'notificationPreferences[category.id]',
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
            'loadNotificationTeams',
            'saveNotificationPreferences',
            'saveNotificationDeviceToken',
            'createProfileAccessCode',
            'loadProfileAccessCodes'
        ]);
    });

    it('keeps native profile photo capture wired to the Camera plugin dependency and Android permission', () => {
        const rootPackage = readProjectFile('package.json');
        const rootPackageLock = readProjectFile('package-lock.json');
        const appPackage = readProjectFile('apps/app/package.json');
        const appPackageLock = readProjectFile('apps/app/package-lock.json');
        const profilePage = readProjectFile('apps/app/src/pages/Profile.tsx');
        const profilePhotoService = readProjectFile('apps/app/src/lib/profilePhotoService.ts');
        const nativeRuntime = readProjectFile('apps/app/src/lib/nativeRuntime.ts');
        const androidManifest = readProjectFile('android/app/src/main/AndroidManifest.xml');
        const androidSettings = readProjectFile('android/capacitor.settings.gradle');
        const androidCapacitorBuild = readProjectFile('android/app/capacitor.build.gradle');
        const iosCapAppPackage = readProjectFile('ios/App/CapApp-SPM/Package.swift');

        expectContains(rootPackage, ['"@capacitor/camera":']);
        expectContains(rootPackageLock, ['"node_modules/@capacitor/camera"']);
        expectContains(appPackage, ['"@capacitor/camera":']);
        expectContains(appPackageLock, ['"node_modules/@capacitor/camera"']);
        // Native-runtime detection is centralized in nativeRuntime.ts (not reimplemented
        // per-file) so profilePhotoService just imports and calls it.
        expectContains(profilePhotoService, [
            "from '@capacitor/camera'",
            "isNativeRuntime } from './nativeRuntime'",
            'Camera.getPhoto',
            'CameraResultType.Uri',
            'CameraSource.Camera',
            'CameraSource.Photos'
        ]);
        expectContains(nativeRuntime, [
            'Capacitor.isNativePlatform()',
            "window.location.protocol === 'capacitor:'"
        ]);
        expectContains(profilePage, [
            "handleNativePhotoChoice('camera')",
            "handleNativePhotoChoice('photos')",
            'Take photo',
            'Choose existing photo'
        ]);
        expectContains(androidManifest, ['android.permission.CAMERA']);
        expectContains(androidSettings, [
            "include ':capacitor-camera'",
            "project(':capacitor-camera').projectDir = new File('../node_modules/@capacitor/camera/android')"
        ]);
        expectContains(androidCapacitorBuild, ["implementation project(':capacitor-camera')"]);
        expectContains(iosCapAppPackage, [
            '.package(name: "CapacitorCamera", path: "../../../node_modules/@capacitor/camera")',
            '.product(name: "CapacitorCamera", package: "CapacitorCamera")'
        ]);
    });

    it('registers push for the current Profile device without saving alert preferences', () => {
        const profilePage = readProjectFile('apps/app/src/pages/Profile.tsx');
        const handlerStart = profilePage.indexOf('const enablePushOnDevice = async () => {');
        const handlerEnd = profilePage.indexOf('  const turnOnGameDayAlerts = async () => {');
        const enablePushOnDevice = profilePage.slice(handlerStart, handlerEnd);

        expect(handlerStart).toBeGreaterThanOrEqual(0);
        expectContains(enablePushOnDevice, [
            "setBusy('push-device')",
            'const pushService = await loadPushService();',
            'await pushService.enablePushNotificationsForUser(user.uid);',
            'Push is enabled on this device.',
            'Failed to enable push on this device.'
        ]);
        expect(enablePushOnDevice).not.toContain('saveNotificationPreferences');
        expect(enablePushOnDevice).not.toContain('setNotificationPreferences');
        expect(profilePage).toContain("disabled={busy === 'push-device' || !user}");
    });

    it('uses hydrated team preferences before turning on game-day alerts', () => {
        const profilePage = readProjectFile('apps/app/src/pages/Profile.tsx');
        const turnOnStart = profilePage.indexOf('const turnOnGameDayAlerts = async () => {');
        const turnOnEnd = profilePage.indexOf('  const sendPasswordReset = async () => {');
        const turnOnGameDayAlerts = profilePage.slice(turnOnStart, turnOnEnd);

        expect(profilePage).toContain("const selectedTeamPreferencesHydrated = Boolean(selectedTeamId) && Object.prototype.hasOwnProperty.call(notificationPreferencesByTeamId, selectedTeamId);");
        expect(profilePage).toContain("disabled={busy === 'game-day-alerts' || !selectedTeamId || !selectedTeamPreferencesHydrated}");
        expect(turnOnGameDayAlerts).toContain('const teamId = selectedTeamId;');
        expect(turnOnGameDayAlerts).toContain('const currentPreferences = notificationPreferencesByTeamId[teamId]');
        expect(turnOnGameDayAlerts).toContain('loadedNotificationTeamId === teamId');
        expect(turnOnGameDayAlerts).toContain('? notificationPreferences');
        expect(turnOnGameDayAlerts).toContain(': await loadNotificationPreferencesOnce(user.uid, teamId));');
        expect(turnOnGameDayAlerts).toContain('...currentPreferences,');
        expect(turnOnGameDayAlerts).toContain('const pushService = await loadPushService();');
        expect(turnOnGameDayAlerts.indexOf('await pushService.enablePushNotificationsForUser(user.uid);')).toBeLessThan(
            turnOnGameDayAlerts.indexOf('saveNotificationPreferences(user.uid, teamId, nextPreferences)')
        );
        expect(turnOnGameDayAlerts).toContain('setNotificationPreferencesByTeamId((current) => ({ ...current, [teamId]: saved }));');
        expect(turnOnGameDayAlerts).toContain('saveNotificationPreferences(user.uid, teamId, nextPreferences)');
    });

    it('registers Profile game-day push on web and native devices before saving preferences', () => {
        const pushService = readProjectFile('apps/app/src/lib/pushService.ts');

        expectContains(pushService, [
            'if (!Capacitor.isNativePlatform()) {',
            "await import('@legacy/push-notifications.js')",
            'webPushVapidKey ? { vapidKey: webPushVapidKey } : {}',
            'await registerPushNotifications(webPushVapidKey ? { vapidKey: webPushVapidKey } : {})',
            'await saveNotificationDeviceToken(userId, {',
            "platform: 'web'",
            'FirebaseMessaging.requestPermissions()',
            'getNativeMessagingToken()',
            'platform = Capacitor.getPlatform()'
        ]);
        expect(pushService).not.toContain("await import('../../../../js/push-notifications.js')");
        expect(pushService).not.toContain("import { registerPushNotifications } from '../../../../js/push-notifications.js';");
        expect(pushService).not.toContain('Push registration for the web app still runs through the current website profile page.');
    });

    it('declares native push permissions and iOS registration hooks for the Profile CTA', () => {
        const androidManifest = readProjectFile('android/app/src/main/AndroidManifest.xml');
        const iosEntitlements = readProjectFile('ios/App/App/App.entitlements');
        const iosAppDelegate = readProjectFile('ios/App/App/AppDelegate.swift');

        expectContains(androidManifest, [
            'android.permission.POST_NOTIFICATIONS'
        ]);
        expectContains(iosEntitlements, [
            'aps-environment',
            '<string>development</string>'
        ]);
        expectContains(iosAppDelegate, [
            'didRegisterForRemoteNotificationsWithDeviceToken',
            'capacitorDidRegisterForRemoteNotifications',
            'didFailToRegisterForRemoteNotificationsWithError',
            'capacitorDidFailToRegisterForRemoteNotifications',
            'didReceiveRemoteNotification'
        ]);
    });

    it('covers team-chat.html messaging, conversations, media, reactions, targeting, and AI assistant features', () => {
        const legacyTeamChat = readProjectFile('team-chat.html');
        const messagesPage = [
            readProjectFile('apps/app/src/pages/Messages.tsx'),
            readProjectFile('apps/app/src/pages/messages/components/ChatWindow.tsx')
        ].join('\n');
        const chatService = readProjectFile('apps/app/src/lib/chatService.ts');
        const chatAiService = readProjectFile('apps/app/src/lib/chatAiService.ts');
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
            'useChatTeam',
            'useChatMessages',
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
            'repairLegacyDirectConversation',
            'uploadTeamChatAttachment',
            'deleteUploadedChatAttachments',
            'nativeUploadChatMedia',
            'nativePostChatMessage'
        ]);
        expectContains(chatAiService, [
            'sendAllPlaysChatAnswer',
            'getGenerativeModel'
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

    it('routes the basketball sideline tracker capability to the native game hub lineup and sub flow', () => {
        const capabilities = readProjectFile('apps/app/src/data/capabilities.ts');
        const capabilityPage = readProjectFile('apps/app/src/pages/CapabilityPage.tsx');
        const scheduleEventDetail = readProjectFile('apps/app/src/pages/ScheduleEventDetail.tsx');

        expectContains(capabilities, [
            "capability('track-basketball', 'Basketball sideline tracker', 'track-basketball.html', 'Tracking', 'Starting five setup, published-lineup substitutions, on-court rotation, personal fouls, team foul bonus indicators, playing-time visibility, and shared live log handoff in the app game hub.', ['Starting five', 'Published lineup handoff', 'Substitutions', 'Personal fouls', 'Team foul bonus', 'On-court rotation', 'Playing-time visibility', 'Shared live log'], '/schedule', 'native-shell', staffRoles)",
            "'track-basketball'"
        ]);
        expectContains(capabilityPage, [
            "capability.status === 'native-shell'",
            'Open app route'
        ]);
        expectContains(scheduleEventDetail, [
            'Lineup builder',
            'Substitution plan',
            'Projected playing time',
            'Writes rotationPlan, rotationActual, and coachingNotes'
        ]);
    });

    it('keeps the live broadcast tracker capability scoped to shipped app features', () => {
        const capabilities = readProjectFile('apps/app/src/data/capabilities.ts');
        const trackLiveLine = capabilities
            .split('\n')
            .find((line) => line.includes("capability('track-live'"));

        expect(trackLiveLine).toContain("'native-shell'");
        expect(trackLiveLine).toContain('Score updates');
        expect(trackLiveLine).toContain('Live play-by-play publish');
        expect(trackLiveLine).not.toMatch(/'Chat'|'Game log'|'Notes'|'Replay data'/);
    });

    it('covers parent-dashboard.html schedule capabilities and filters in the React app schedule', () => {
        const legacyParentDashboard = readProjectFile('parent-dashboard.html');
        const schedulePage = readProjectFile('apps/app/src/pages/Schedule.tsx');
        const scheduleEventDetail = readProjectFile('apps/app/src/pages/ScheduleEventDetail.tsx');
        const gameReportContent = readProjectFile('apps/app/src/components/schedule/GameReportSectionContent.tsx');
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
            'Schedule filter',
            'All Players',
            '.ics',
            'RSVP needed',
            'Game details',
            'Event details',
            'getScheduleEventDetailPath'
        ]);
        expectContains(scheduleEventDetail, [
            'useScheduleEventRsvp',
            'Availability',
            'Rideshare',
            'Assignments',
            'Game hub',
            'Practice hub',
            'PracticePacketSection'
        ]);
        expectContains(gameReportContent, [
            'MatchSummarySection',
            'PlayerPerformanceSection',
            'PlayByPlaySection',
            'OpponentStatsSection',
            'Insights'
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
            'summarizeRsvps',
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
