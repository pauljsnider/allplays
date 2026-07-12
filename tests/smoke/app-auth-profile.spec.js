import { expect, test } from '@playwright/test';

test.skip(
    process.env.SMOKE_SUITE === 'production',
    'Module-mocked app specs need the Vite dev server; production runs cover the deployed bundle via app-production-bootstrap.spec.js'
);

const appBaseUrl = process.env.SMOKE_APP_BASE_URL || '';
test.skip(!appBaseUrl, 'SMOKE_APP_BASE_URL is required for React app smoke tests');

const mockAvatarUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

function appUrl(baseURL, hashPath) {
    const url = new URL('/', appBaseUrl || baseURL);
    url.hash = hashPath;
    return url.toString();
}

async function waitForAuthRoute(page, readyLocator) {
    await expect(async () => {
        await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
        await expect(readyLocator).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30000 });
}

async function mockAppModules(page, { user = null, emailLink = false } = {}) {
    await page.addInitScript(({ mockUser, mockEmailLink }) => {
        window.__mockAuthState = {
            user: mockUser,
            profile: mockUser ? { fullName: mockUser.displayName || 'Pat Parent' } : null
        };
        window.__mockEmailLink = mockEmailLink;
        window.__appAuthCalls = {
            signInWithEmail: [],
            signUpWithEmail: [],
            signInWithGoogleAccount: [],
            sendResetEmail: [],
            redeemInviteForUser: [],
            confirmReset: [],
            verifyResetCode: [],
            applyEmailActionCode: [],
            resendVerificationEmail: 0,
            reloadCurrentUser: 0,
            setCurrentUserPassword: [],
            refresh: 0,
            signOut: 0
        };
        window.__appProfileCalls = {
            uploads: [],
            saves: [],
            profileLoads: 0,
            notificationSaves: [],
            notificationLoads: [],
            push: 0,
            pushModuleLoads: 0,
            accessCodes: [],
            openPushSettings: 0
        };
        window.__appShareCalls = [];
        window.__mockShellLayout = {
            isDesktop: false,
            isNative: false,
            isDesktopWeb: false
        };
        window.__mockPushPermissionStates = [{
            state: 'prompt',
            isNative: false,
            platform: 'web',
            canPrompt: true,
            canOpenSettings: false
        }];
        window.__mockNotificationPreferenceResponses ??= [];
    }, { mockUser: user, mockEmailLink: emailLink });

    await page.route(/\/src\/lib\/useAuth\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function useAuth() {
                    const state = window.__mockAuthState || { user: null, profile: null };
                    const user = state.user || null;
                    const roles = user?.roles || [];
                    return {
                        user,
                        profile: state.profile,
                        loading: false,
                        error: null,
                        roles,
                        isParent: roles.includes('parent'),
                        isCoach: roles.includes('coach'),
                        isAdmin: roles.includes('admin') || user?.isAdmin === true,
                        isPlatformAdmin: roles.includes('platformAdmin'),
                        refresh: async () => { window.__appAuthCalls.refresh += 1; },
                        signOut: async () => {
                            window.__appAuthCalls.signOut += 1;
                            window.__mockAuthState = { user: null, profile: null };
                        }
                    };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/authService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export const passwordResetConfirmationMessage = "If an account exists for that email, we've sent a reset link.";

                function mockUser() {
                    return window.__mockAuthState?.user || {
                        uid: 'user-1',
                        email: 'parent@example.com',
                        displayName: 'Pat Parent',
                        emailVerified: false,
                        roles: ['parent']
                    };
                }

                export async function completeGoogleRedirect() {
                    return null;
                }

                export function describeAuthError(error) {
                    return error?.message || 'Authentication failed.';
                }

                export function normalizeAuthEmail(email) {
                    return String(email || '').trim().toLowerCase();
                }

                export function isValidAuthEmail(email) {
                    const normalizedEmail = normalizeAuthEmail(email);
                    const parts = normalizedEmail.split('@');
                    return parts.length === 2 &&
                        Boolean(parts[0] && parts[1]?.includes('.') && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(normalizedEmail));
                }

                export function getRouteForUser(user) {
                    if (!user) return '/auth';
                    return user.roles?.includes('coach') || user.roles?.includes('admin') ? '/teams' : '/home';
                }

                export async function hydrateFirebaseUser(user) {
                    return { user: user || mockUser(), profile: {} };
                }

                export function rememberPendingInvite(code, type = 'parent') {
                    window.localStorage.setItem('allplays-app-pending-invite-code', String(code || '').toUpperCase());
                    window.localStorage.setItem('allplays-app-pending-invite-type', type);
                }

                export function readPendingInvite() {
                    return {
                        code: window.localStorage.getItem('allplays-app-pending-invite-code') || '',
                        type: window.localStorage.getItem('allplays-app-pending-invite-type') || 'parent'
                    };
                }

                export function clearPendingInvite() {
                    window.localStorage.removeItem('allplays-app-pending-invite-code');
                    window.localStorage.removeItem('allplays-app-pending-invite-type');
                }

                export async function signInWithEmail(email, password) {
                    window.__appAuthCalls.signInWithEmail.push({ email, password });
                    return { user: mockUser() };
                }

                export async function signUpWithEmail(email, password, activationCode) {
                    window.__appAuthCalls.signUpWithEmail.push({ email, password, activationCode });
                    return { user: mockUser() };
                }

                export async function signInWithGoogleAccount(activationCode) {
                    window.__appAuthCalls.signInWithGoogleAccount.push({ activationCode });
                    return { user: mockUser() };
                }

                export async function sendResetEmail(email) {
                    window.__appAuthCalls.sendResetEmail.push(email);
                }

                export function isEmailLink() {
                    return window.__mockEmailLink === true;
                }

                export async function completeEmailLink(email, url) {
                    return { user: { ...mockUser(), email }, url };
                }

                export async function redeemInviteForUser(userId, code, authEmail) {
                    window.__appAuthCalls.redeemInviteForUser.push({ userId, code, authEmail });
                    return { message: 'Invite accepted.', redirectUrl: 'parent-dashboard.html' };
                }

                export function mapLegacyRedirectToAppRoute() {
                    return '/home';
                }

                export async function applyEmailActionCode(oobCode) {
                    window.__appAuthCalls.applyEmailActionCode.push(oobCode);
                }

                export async function verifyResetCode(oobCode) {
                    window.__appAuthCalls.verifyResetCode.push(oobCode);
                    if (oobCode !== 'valid-code') {
                        throw new Error('This link is invalid or expired.');
                    }
                    return 'parent@example.com';
                }

                export async function confirmReset(oobCode, newPassword) {
                    window.__appAuthCalls.confirmReset.push({ oobCode, newPassword });
                }

                export async function resendVerificationEmail() {
                    window.__appAuthCalls.resendVerificationEmail += 1;
                }

                export async function reloadCurrentUser() {
                    window.__appAuthCalls.reloadCurrentUser += 1;
                }

                export async function setCurrentUserPassword(newPassword) {
                    window.__appAuthCalls.setCurrentUserPassword.push(newPassword);
                }

                export const firebaseAuth = { app: { options: { projectId: 'demo-allplays' } } };

                export async function getNativeAuthIdToken() {
                    return 'mock-token';
                }
            `
        });
    });

    await page.route(/\/src\/lib\/profileService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function normalizeNotificationPreferences(preferences) {
                    return {
                        liveChat: preferences?.liveChat !== false,
                        liveScore: preferences?.liveScore === true,
                        schedule: preferences?.schedule !== false
                    };
                }

                export async function loadProfileDocument() {
                    window.__appProfileCalls.profileLoads += 1;
                    return {
                        fullName: 'Pat Parent',
                        phone: '555-0100',
                        photoUrl: '',
                        signInMethod: 'emailLink',
                        hasPassword: false,
                        updatedAt: { seconds: 1717200000 }
                    };
                }

                export async function acquireProfilePhoto() {
                    return new File(['native-photo'], 'native-camera.jpg', { type: 'image/jpeg' });
                }

                export async function normalizeProfilePhoto(file) {
                    return file;
                }

                export async function saveProfileDocument(userId, profile) {
                    window.__appProfileCalls.saves.push({ userId, profile });
                }

                export async function uploadProfilePhoto(file) {
                    window.__appProfileCalls.uploads.push({ name: file.name, type: file.type });
                    return '${mockAvatarUrl}';
                }

                export async function loadNotificationTeams() {
                    return [
                        { id: 'team-1', name: 'Blue Team' },
                        { id: 'team-2', name: 'Gold Team' }
                    ];
                }

                export async function loadNotificationPreferences(userId, teamId) {
                    window.__appProfileCalls.notificationLoads.push({ userId, teamId });
                    const queue = window.__mockNotificationPreferenceResponses || [];
                    if (queue.length > 1) {
                        const next = queue.shift();
                        if (next?.error) {
                            throw new Error(next.error);
                        }
                        return next?.value || { liveChat: true, liveScore: false, schedule: true };
                    }
                    if (queue.length === 1) {
                        const next = queue[0];
                        if (next?.error) {
                            throw new Error(next.error);
                        }
                        return next?.value || { liveChat: true, liveScore: false, schedule: true };
                    }
                    return { liveChat: true, liveScore: false, schedule: true };
                }

                export async function saveNotificationPreferences(userId, teamId, preferences) {
                    window.__appProfileCalls.notificationSaves.push({ userId, teamId, preferences });
                    return preferences;
                }

                export async function createProfileAccessCode(userId, email, phone) {
                    window.__appProfileCalls.accessCodes.push({ userId, email, phone });
                    return 'NEWMVP42';
                }

                const mockAccessCodes = [
                    { id: 'code-1', code: 'ABCD1234', email: 'coach@example.com', phone: '', used: false, createdAt: { seconds: 1717200000 } },
                    { id: 'code-2', code: 'EFGH5678', email: '', phone: '555-0101', used: false, createdAt: { seconds: 1717113600 } },
                    { id: 'code-3', code: 'IJKL9012', email: 'parent@example.com', phone: '', used: true, createdAt: { seconds: 1717027200 }, usedAt: { seconds: 1717113600 } },
                    { id: 'code-4', code: 'MNOP3456', email: '', phone: '', used: false, createdAt: { seconds: 1716940800 } }
                ];

                export async function loadProfileAccessCodes() {
                    return mockAccessCodes;
                }

                export async function loadProfileAccessCodesPage(_userId, { cursor = null, pageSize = 10 } = {}) {
                    const startIndex = Number.isInteger(cursor) ? cursor : 0;
                    const codes = mockAccessCodes.slice(startIndex, startIndex + pageSize);
                    const nextCursor = startIndex + pageSize < mockAccessCodes.length ? startIndex + pageSize : null;
                    return { codes, nextCursor };
                }

                export async function loadParentTeams() {
                    return [
                        { id: 'team-1', name: 'Blue Team' }
                    ];
                }

                export async function requestAccountMerge() {
                    return;
                }
            `
        });
    });

    await page.route(/\/src\/lib\/profilePhotoService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function acquireProfilePhoto() {
                    return new File(['native-photo'], 'native-camera.jpg', { type: 'image/jpeg' });
                }

                export async function normalizeProfilePhoto(file) {
                    return file;
                }

                export async function uploadProfilePhoto(file) {
                    window.__appProfileCalls.uploads.push({ name: file.name, type: file.type });
                    return '${mockAvatarUrl}';
                }
            `
        });
    });

    await page.route(/\/src\/lib\/pushService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                window.__appProfileCalls.pushModuleLoads += 1;

                export async function addPushNotificationOpenListener() {
                    return async () => {};
                }

                export async function ensureAndroidNotificationChannels() {
                    return;
                }

                export async function enablePushNotificationsForUser() {
                    window.__appProfileCalls.push += 1;
                }

                export async function getPushNotificationPermissionStatus() {
                    const queue = window.__mockPushPermissionStates || [];
                    if (queue.length > 1) {
                        return queue.shift();
                    }
                    return queue[0] || {
                        state: 'prompt',
                        isNative: false,
                        platform: 'web',
                        canPrompt: true,
                        canOpenSettings: false
                    };
                }

                export async function openPushNotificationSettings() {
                    window.__appProfileCalls.openPushSettings += 1;
                }

                export async function runPushNotificationPrimer() {
                    return { completed: false, status: 'skipped' };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/useShellLayout\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function useShellLayout() {
                    return window.__mockShellLayout || {
                        isDesktop: false,
                        isNative: false,
                        isDesktopWeb: false
                    };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/scheduleService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function addTeamCalendarUrl(teamId, url) {
                    return { calendarUrls: [url], added: true };
                }

                export async function createScheduleImportGame() {
                    return 'imported-game';
                }

                export async function createScheduleImportPractice() {
                    return 'imported-practice';
                }

                export async function loadParentSchedule() {
                    return { children: [], events: [] };
                }

                export async function hydrateParentScheduleDetails(schedule) {
                    return schedule;
                }

                export async function loadParentPracticePacket() {
                    return null;
                }

                export async function loadParentScheduleAssignments() {
                    return [];
                }

                export async function loadParentScheduleRideOffers() {
                    return [];
                }

                export async function submitParentScheduleRsvp() {
                    return { going: 1, maybe: 0, notGoing: 0, notResponded: 0 };
                }

                export async function updateGameScore(teamId, gameId, score, user) {
                    return {
                        homeScore: Number(score?.homeScore ?? 0),
                        awayScore: Number(score?.awayScore ?? 0),
                        scoreUpdatedBy: user?.uid || null
                    };
                }

                export async function adjustGameScore(teamId, gameId, scoreDelta, user) {
                    return {
                        homeScore: Number(scoreDelta?.homeScore ?? 0),
                        awayScore: Number(scoreDelta?.awayScore ?? 0),
                        scoreUpdatedBy: user?.uid || null,
                        shared: false
                    };
                }

                export async function cancelScheduledGameForApp() {
                    return { status: 'cancelled', isCancelled: true };
                }

                export async function publishGamePlanForApp(event) {
                    return {
                        gamePlan: {
                            ...(event?.gamePlan || {}),
                            isPublished: true,
                            publishedVersion: 1,
                            publishedLineups: event?.gamePlan?.lineups || {},
                            publishedReadBy: []
                        },
                        notificationError: ''
                    };
                }

                export async function createParentScheduleRideOffer() {}
                export async function requestParentScheduleRideSpot() {}
                export async function cancelParentScheduleRideRequest() {}
                export async function setParentScheduleRideOfferStatus() {}
                export async function updateParentScheduleRideRequestStatus() {}
                export async function claimParentScheduleAssignmentSlot() {}
                export async function releaseParentScheduleAssignmentClaim() {}
                export async function markParentPracticePacketComplete() {}

                export async function loadStaffRsvpReminderPreview() {
                    return { missingPlayerCount: 0, eligibleEmailCount: 0, players: [] };
                }

                export async function sendStaffRsvpReminder() {
                    return { missingPlayerCount: 0, eligibleEmailCount: 0, emailSentCount: 0, players: [] };
                }

                export function summarizeParentScheduleRideOffers() {
                    return { offerCount: 0, seatsLeft: 0, requests: 0, pending: 0, confirmed: 0, isFull: false };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/gameReportService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function loadGameReportSections() {
                    return {
                        team: {},
                        game: {},
                        summary: '',
                        statKeys: [],
                        statLabels: {},
                        hasPlayingTime: false,
                        playerRows: [],
                        opponentStatKeys: [],
                        opponentStatLabels: {},
                        opponentRows: [],
                        teamStatKeys: [],
                        teamStatLabels: {},
                        teamStats: {},
                        statSheetPhotoUrl: '',
                        highlightClips: [],
                        plays: [],
                        teamInsights: [],
                        playerInsightRows: [],
                        emptyInsightsMessage: 'No insights yet.'
                    };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/publicActions\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function openPublicUrl() {}
                export async function copyPublicText() {
                    return 'copied';
                }
                export async function sharePublicUrl(input) {
                    window.__appShareCalls.push(input);
                    return 'shared';
                }
            `
        });
    });
}

test('app auth screen exposes sign in, sign up, Google, activation code, invite, and reset flows', async ({ page, baseURL }) => {
    await mockAppModules(page);
    await page.goto(appUrl(baseURL, '/auth?code=AB12CD34&type=parent'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.getByText('Invite code applied: AB12CD34')).toBeVisible();
    await expect(page.getByText('Use an activation or invite code, then verify your email.')).toBeVisible();
    await expect(page.getByLabel('Activation or invite code')).toHaveValue('AB12CD34');
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Enter invite code' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Account action' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Sign in' }).first().click();
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await page.locator('form').filter({ hasText: 'Password reset email' }).locator('input[type="email"]').fill('parent@example.com');
    await page.getByRole('button', { name: 'Send reset email' }).click();
    await expect(page.getByText('Password reset email sent. Check your inbox and spam folder.')).toBeVisible();
    expect(await page.evaluate(() => window.__appAuthCalls.sendResetEmail)).toEqual(['parent@example.com']);

    await page.getByRole('button', { name: 'Sign up' }).first().click();
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    expect(await page.evaluate(() => window.__appAuthCalls.signInWithGoogleAccount)).toEqual([{ activationCode: 'AB12CD34' }]);
});

test('signed-out manual invite code redirects through auth with the code preserved', async ({ page, baseURL }) => {
    await mockAppModules(page);
    await page.goto(appUrl(baseURL, '/accept-invite'), { waitUntil: 'domcontentloaded' });

    await page.getByLabel('Invite code').fill('zxcv1234');
    await page.getByRole('button', { name: 'Continue with code' }).click();

    await expect(page).toHaveURL(/#\/auth\?code=ZXCV1234&type=parent&mode=login/);
    expect(await page.evaluate(() => window.localStorage.getItem('allplays-app-pending-invite-code'))).toBe('ZXCV1234');
});

test('signed-in invite and account action routes process existing site flows', async ({ page, baseURL }) => {
    const user = {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        emailVerified: false,
        roles: ['parent']
    };
    await mockAppModules(page, { user });

    await page.goto(appUrl(baseURL, '/accept-invite?code=AB12CD34&type=parent'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Invite accepted.')).toBeVisible();
    expect(await page.evaluate(() => window.__appAuthCalls.redeemInviteForUser)).toEqual([
        { userId: 'user-1', code: 'AB12CD34', authEmail: 'parent@example.com' }
    ]);

    await page.goto(appUrl(baseURL, '/reset-password?mode=resetPassword&oobCode=valid-code'), { waitUntil: 'domcontentloaded' });
    await waitForAuthRoute(page, page.locator('input[placeholder="New password"]'));
    await expect(page.getByRole('heading', { name: 'Reset password' })).toBeVisible();
    await page.locator('input[placeholder="New password"]').fill('better-password');
    await page.locator('input[placeholder="Confirm password"]').fill('better-password');
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText('Password reset successful. Sign in with your new password.')).toBeVisible();

    await page.goto(appUrl(baseURL, '/verify-pending'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('parent@example.com')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Need another option?' }).click();
    await expect(page.getByRole('link', { name: 'Continue without verifying' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Resend verification email' }).click();
    const continueAfterVerifyButton = page.getByRole('button', { name: "I've verified, continue" });
    await expect(continueAfterVerifyButton).toBeVisible({ timeout: 15000 });
    await continueAfterVerifyButton.click();
    expect(await page.evaluate(() => ({
        resend: window.__appAuthCalls.resendVerificationEmail,
        refresh: window.__appAuthCalls.reloadCurrentUser
    }))).toEqual({ resend: 1, refresh: 1 });
});

test('profile exposes account, notification, invite, verification, password, upload, and logout capabilities', async ({ page, baseURL }) => {
    const user = {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        emailVerified: false,
        roles: ['parent']
    };
    await mockAppModules(page, { user });
    await page.goto(appUrl(baseURL, '/profile'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Your Account' })).toBeVisible();
    await expect.poll(async () => page.evaluate(() => window.__appProfileCalls.pushModuleLoads)).toBe(0);
    await page.locator('input[type="file"]').setInputFiles({
        name: 'avatar.png',
        mimeType: 'image/png',
        buffer: Buffer.from([137, 80, 78, 71])
    });
    await page.getByLabel('Full name').fill('Pat Parent Updated');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Profile saved.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pat Parent Updated' })).toBeVisible();
    await expect(page.locator('.profile-summary-card img')).toHaveAttribute('src', mockAvatarUrl);
    await expect.poll(async () => page.evaluate(() => window.__appProfileCalls.profileLoads)).toBeGreaterThan(0);

    const alertsTab = page.getByRole('button', { name: 'Alerts', exact: true });
    await alertsTab.click();
    await expect(alertsTab).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => page.evaluate(() => window.__appProfileCalls.pushModuleLoads)).toBe(1);
    await expect(page.getByText('Per-team alerts for live chat, score updates, and schedule changes.')).toBeVisible();
    await expect(page.getByLabel('Team')).toHaveValue('team-1');
    const gameDayAlertsButton = page.getByRole('button', { name: 'Turn on game-day alerts' });
    await expect(gameDayAlertsButton).toBeEnabled();
    await gameDayAlertsButton.click();
    await expect(page.getByText('Game-day alerts are on for this team.')).toBeVisible();
    await expect(page.getByText('Customize alerts')).toBeVisible();
    await expect(page.getByLabel('Live Chat')).toBeVisible();
    await expect(page.getByLabel('Live Chat')).toBeChecked();
    await expect(page.getByLabel('Live Score')).toBeChecked();
    await expect(page.getByLabel('Schedule Changes')).toBeChecked();
    await page.getByLabel('Live Chat').uncheck();
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(page.getByText('Notification preferences saved.')).toBeVisible();

    await page.getByRole('button', { name: 'Invites', exact: true }).click();
    await expect(page.getByText('Invite codes')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show more codes' })).toBeVisible();
    await expect(page.getByText('Advanced: add recipient label')).toBeVisible();
    await page.getByRole('button', { name: 'Generate invite link' }).click();
    await expect(page.getByText('Generated invite link')).toBeVisible();
    const shareInviteLink = page.getByRole('button', { name: 'Share invite link' });
    await expect(shareInviteLink).toBeVisible();
    await expect(shareInviteLink).toHaveClass(/primary-button/);
    await expect(page.getByRole('button', { name: 'Copy invite link' })).toBeVisible();
    await shareInviteLink.click();
    await expect(page.getByText('Share sheet opened.')).toBeVisible();
    await expect(page.getByText('Fallback code')).toBeVisible();
    await expect(page.getByText('NEWMVP42', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy code' })).toBeVisible();

    const sharedInviteUrl = await page.evaluate(() => window.__appShareCalls[0]?.url || '');
    expect(sharedInviteUrl).toContain('/app#/accept-invite?code=NEWMVP42');
    expect(sharedInviteUrl).not.toContain('/login.html?code=');

    const recipientPage = await page.context().newPage();
    await mockAppModules(recipientPage);
    await recipientPage.goto(sharedInviteUrl, { waitUntil: 'domcontentloaded' });
    await expect(recipientPage.getByRole('heading', { name: 'Accept invite' })).toBeVisible();
    await expect(recipientPage.getByText('Invite found')).toBeVisible();
    await expect(recipientPage.getByText('Redeem an invite code, link your account, then continue to the right dashboard.')).toBeVisible();
    await expect(recipientPage.getByText('NEWMVP42')).toBeVisible();
    await expect(recipientPage.getByRole('link', { name: 'Sign in to accept' })).toBeVisible();
    await expect(recipientPage.getByRole('link', { name: 'Create account with code' })).toBeVisible();
    await recipientPage.close();

    await page.goto(appUrl(baseURL, '/profile'), { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: 'Security', exact: true }).click();
    await expect(page.getByText('Email not verified')).toBeVisible();
    await expect(page.getByText('Set a password')).toBeVisible();
    await page.locator('input[placeholder="New password"]').fill('new-password');
    await page.locator('input[placeholder="Confirm password"]').fill('new-password');
    await page.getByRole('button', { name: 'Set password' }).click();
    await expect(page.getByText('Password set successfully.')).toBeVisible();
    await page.getByRole('button', { name: 'Send password reset' }).click();
    await expect(page.getByText('Password reset email sent.')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).last().click();

    const profileCalls = await page.evaluate(() => ({
        uploads: window.__appProfileCalls.uploads,
        saves: window.__appProfileCalls.saves,
        profileLoads: window.__appProfileCalls.profileLoads,
        push: window.__appProfileCalls.push,
        notificationLoads: window.__appProfileCalls.notificationLoads,
        notificationSaves: window.__appProfileCalls.notificationSaves,
        accessCodes: window.__appProfileCalls.accessCodes,
        shares: window.__appShareCalls,
        password: window.__appAuthCalls.setCurrentUserPassword,
        reset: window.__appAuthCalls.sendResetEmail,
        signOut: window.__appAuthCalls.signOut
    }));

    expect(profileCalls.profileLoads).toBeGreaterThan(0);
    expect(profileCalls).toMatchObject({
        uploads: [{ name: 'avatar.png', type: 'image/png' }],
        push: 1,
        notificationLoads: [
            { userId: 'user-1', teamId: 'team-1' }
        ],
        notificationSaves: [
            { userId: 'user-1', teamId: 'team-1', preferences: { liveChat: true, liveScore: true, schedule: true } },
            { userId: 'user-1', teamId: 'team-1', preferences: { liveChat: false, liveScore: true, schedule: true } }
        ],
        accessCodes: [{ userId: 'user-1', email: '', phone: '' }],
        shares: [expect.objectContaining({
            title: 'ALL PLAYS invite link',
            text: 'Use this ALL PLAYS invite link to join ALL PLAYS.',
            url: expect.stringContaining('/app#/accept-invite?code=NEWMVP42'),
            clipboardText: expect.stringContaining('/app#/accept-invite?code=NEWMVP42')
        })],
        password: ['new-password'],
        reset: ['parent@example.com'],
        signOut: 1
    });
});

test('profile keeps destructive alert actions disabled until a failed team load retries successfully', async ({ page, baseURL }) => {
    const user = {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        emailVerified: false,
        roles: ['parent']
    };
    await mockAppModules(page, { user });
    await page.addInitScript(() => {
        window.__mockNotificationPreferenceResponses = [
            { value: { liveChat: true, liveScore: false, schedule: true } },
            { error: 'temporary outage' },
            { value: { liveChat: false, liveScore: true, schedule: false } }
        ];
    });
    await page.goto(appUrl(baseURL, '/profile'), { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await expect(page.getByLabel('Team')).toHaveValue('team-1');
    await page.getByLabel('Team').selectOption('team-2');

    await expect(page.getByText('Alerts unavailable', { exact: true })).toBeVisible();
    await expect(page.getByText('temporary outage')).toBeVisible();
    await expect(page.getByLabel('Live Chat')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Turn on game-day alerts' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Save preferences' })).toBeDisabled();
    await expect.poll(async () => page.evaluate(() => window.__appProfileCalls.notificationSaves.length)).toBe(0);

    await page.getByRole('button', { name: 'Retry alerts' }).click();

    await expect.poll(async () => page.evaluate(() => window.__appProfileCalls.notificationLoads.length)).toBe(3);
    await expect(page.getByText('temporary outage')).toHaveCount(0);
    await expect(page.getByLabel('Live Chat')).toBeVisible();
    await expect(page.getByLabel('Live Chat')).not.toBeChecked();
    await expect(page.getByLabel('Live Score')).toBeChecked();
    await expect(page.getByLabel('Schedule Changes')).not.toBeChecked();
    await expect(page.getByRole('button', { name: 'Turn on game-day alerts' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Save preferences' })).toBeEnabled();
});

test('profile alerts recover from blocked native notification permissions', async ({ page, baseURL }) => {
    const user = {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        emailVerified: false,
        roles: ['parent']
    };
    await mockAppModules(page, { user });
    await page.addInitScript(() => {
        window.__mockShellLayout = {
            isDesktop: false,
            isNative: true,
            isDesktopWeb: false
        };
        window.__mockPushPermissionStates = [
            {
                state: 'blocked',
                isNative: true,
                platform: 'ios',
                canPrompt: false,
                canOpenSettings: true
            },
            {
                state: 'enabled',
                isNative: true,
                platform: 'ios',
                canPrompt: false,
                canOpenSettings: false
            }
        ];
    });
    await page.goto(appUrl(baseURL, '/profile'), { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await expect(page.getByText('Notifications are off in device settings')).toBeVisible();
    await page.getByRole('button', { name: 'Open device settings' }).first().click();
    await expect.poll(async () => page.evaluate(() => window.__appProfileCalls.openPushSettings)).toBe(1);

    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('Push is allowed on this device')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Refresh push registration' })).toBeVisible();
});
