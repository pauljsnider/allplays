import { expect, test } from '@playwright/test';

test.skip(
    process.env.SMOKE_SUITE === 'production',
    'Module-mocked app specs need the Vite dev server; production runs cover the deployed bundle via app-production-bootstrap.spec.js'
);

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const telemetryEndpoint = 'https://telemetry.example.test/collectTelemetry';

function appUrl(baseURL, hashPath) {
    const appBaseURL = process.env.SMOKE_APP_BASE_URL || baseURL;
    const url = new URL('/', appBaseURL);
    url.hash = hashPath;
    return url.toString();
}

async function installTelemetryCollectorCapture(page) {
    const batches = [];
    await page.addInitScript((endpoint) => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.ALLPLAYS_PERFORMANCE_ENABLED = false;
        window.ALLPLAYS_TELEMETRY_ENABLED = true;
        window.ALLPLAYS_TELEMETRY_ENDPOINT = endpoint;
        window.__ALLPLAYS_CONFIG__ = {
            telemetryEnabled: true,
            telemetryEndpoint: endpoint,
            performanceMonitoringEnabled: false
        };
    }, telemetryEndpoint);

    await page.route(telemetryEndpoint, async (route) => {
        if (route.request().method() === 'OPTIONS') {
            await route.fulfill({
                status: 204,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                    'Access-Control-Allow-Methods': 'POST,OPTIONS'
                }
            });
            return;
        }

        const body = route.request().postData();
        if (body) {
            batches.push(JSON.parse(body));
        }
        await route.fulfill({
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Authorization, Content-Type',
                'Access-Control-Allow-Methods': 'POST,OPTIONS'
            }
        });
    });

    return batches;
}

function getTelemetryEventsFromBatches(batches) {
    return batches.flatMap((batch) => Array.isArray(batch?.events) ? batch.events : []);
}

function getParentCoreWorkflowEvents(batches) {
    return getTelemetryEventsFromBatches(batches).filter((event) => (
        event?.name === 'app_workflow_timing' &&
        event?.properties?.workflowName === 'parent core workflow drill in'
    ));
}

function getViewLoadTelemetryEvents(batches) {
    return getTelemetryEventsFromBatches(batches).filter((event) => (
        event?.name === 'app_ux_timing' &&
        event?.properties?.category === 'view_load'
    ));
}

async function flushTelemetry(page) {
    await page.evaluate(async () => {
        await window.AllPlaysTelemetry?.flush?.();
    });
}

async function waitForHomeRoute(page, readyLocator) {
    await expect(async () => {
        await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
        await expect(page.getByText('Loading Home')).toBeHidden({ timeout: 3000 });
        await expect(readyLocator).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 30000 });
}

async function waitForTeamsRoute(page, readyLocator) {
    const teamsLoadingState = page.getByText(/^Loading teams$/);
    await expect(async () => {
        await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 5000 });
        await expect(teamsLoadingState).toHaveCount(0, { timeout: 5000 });
        await expect(readyLocator).toBeVisible({ timeout: 5000 });
    }).toPass({ timeout: 45000 });
}

async function mockHomePlayerModules(page) {
    await page.addInitScript(() => {
        window.__playerLoads = [];
        window.__socialPosts = [];
        window.__socialUploads = [];
        window.__parentToolPanelLoads = [];
        window.__parentToolRenders = [];
        window.__ALLPLAYS_PARENT_TOOLS_RENDER_TRACKER__ = (toolId) => {
            window.__parentToolRenders.push(toolId);
        };
    });

    await page.route(/\/src\/lib\/useAuth\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function useAuth() {
                    const user = {
                        uid: 'user-1',
                        email: 'parent@example.com',
                        displayName: 'Pat Parent',
                        photoUrl: '',
                        emailVerified: true,
                        roles: ['parent'],
                        parentOf: [
                            { teamId: 'team-1', playerId: 'player-1', playerName: 'Pat Star', teamName: 'Bears' }
                        ]
                    };
                    return {
                        user,
                        profile: {
                            parentOf: user.parentOf,
                            fullName: 'Pat Parent',
                            displayName: 'Pat Parent',
                            phone: '555-0100',
                            photoUrl: '',
                            signInMethod: 'password',
                            hasPassword: true
                        },
                        loading: false,
                        error: null,
                        roles: user.roles,
                        isParent: true,
                        isCoach: false,
                        isAdmin: false,
                        isPlatformAdmin: false,
                        refresh: async () => {},
                        signOut: async () => {}
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
                export const firebaseAuth = { app: { options: { projectId: 'test-project' } }, currentUser: null };
                export function describeAuthError(error) { return error?.message || 'Authentication failed.'; }
                export async function getNativeAuthIdToken() { return null; }
                export async function hydrateFirebaseUser(user) { return user; }
                export function observeFirebaseUser(callback) {
                    queueMicrotask(() => callback(null));
                    return () => {};
                }
                export function getCurrentFirebaseUser() { return null; }
                export async function signInWithEmail() { return { user: { uid: 'user-1', email: 'parent@example.com' } }; }
                export async function signUpWithEmail() { return { user: { uid: 'user-1', email: 'parent@example.com' } }; }
                export async function signInWithGoogleAccount() { return { user: { uid: 'user-1', email: 'parent@example.com' } }; }
                export async function completeGoogleRedirect() { return null; }
                export async function sendResetEmail() {}
                export async function resendVerificationEmail() {}
                export async function reloadCurrentUser() { return true; }
                export async function verifyResetCode() { return 'parent@example.com'; }
                export async function confirmReset() {}
                export async function applyEmailActionCode() {}
                export function isEmailLink() { return false; }
                export async function completeEmailLink() { return { user: { uid: 'user-1', email: 'parent@example.com' } }; }
                export async function setCurrentUserPassword() {}
                export async function redeemInviteForUser() { return { message: 'Invite accepted.', redirectUrl: '/home' }; }
                export function rememberPendingInvite(code, type = 'parent') {
                    try { window.localStorage.setItem('pendingInvite', JSON.stringify({ code, type })); } catch {}
                }
                export function readPendingInvite() { return { code: '', type: 'parent' }; }
                export function clearPendingInvite() {}
                export function getRouteForUser(user) { return user ? '/home' : '/auth'; }
                export function mapLegacyRedirectToAppRoute(redirectUrl = '') { return redirectUrl || '/home'; }
                export async function signOut() {}
            `
        });
    });

    await page.route(/\/src\/lib\/profileService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                const categories = ['liveChat', 'mentions', 'liveScore', 'gameDay', 'schedule', 'rsvp', 'fees', 'practice', 'access', 'rideshare', 'media', 'awards', 'officiating'];

                export function normalizeNotificationPreferences(preferences = null) {
                    return Object.fromEntries(categories.map((category) => [category, Boolean(preferences?.[category])]));
                }

                export async function loadProfileDocument() {
                    return {
                        fullName: 'Pat Parent',
                        displayName: 'Pat Parent',
                        phone: '555-0100',
                        photoUrl: '',
                        signInMethod: 'password',
                        hasPassword: true,
                        updatedAt: new Date('2100-06-01T12:00:00Z')
                    };
                }

                export async function saveProfileDocument() {
                    return {
                        fullName: 'Pat Parent',
                        phone: '555-0100',
                        photoUrl: '',
                        signInMethod: 'password',
                        hasPassword: true
                    };
                }

                export async function loadNotificationTeams() {
                    return [{ id: 'team-1', name: 'Bears' }];
                }

                export async function loadParentTeams() {
                    return [{ id: 'team-1', name: 'Bears' }];
                }

                export async function loadNotificationPreferences() {
                    return normalizeNotificationPreferences({
                        liveChat: true,
                        liveScore: true,
                        gameDay: true,
                        schedule: true,
                        rsvp: true
                    });
                }

                export async function saveNotificationPreferences(_userId, _teamId, preferences) {
                    return normalizeNotificationPreferences(preferences);
                }

                export async function createProfileAccessCode() {
                    return {
                        id: 'code-new',
                        code: 'NEW12345',
                        email: '',
                        phone: '',
                        type: 'parent',
                        used: false,
                        createdAt: new Date('2100-06-02T12:00:00Z')
                    };
                }

                export async function loadProfileAccessCodesPage() {
                    return {
                        codes: [{
                            id: 'code-1',
                            code: 'ABC12345',
                            email: 'family@example.com',
                            phone: '',
                            type: 'parent',
                            used: false,
                            createdAt: new Date('2100-06-01T12:00:00Z')
                        }],
                        nextCursor: null
                    };
                }

                export async function requestAccountMerge() {
                    return { status: 'pending' };
                }

                export async function saveNotificationDeviceToken() {
                    return { saved: true };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/pushService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export const androidNotificationChannels = [];
                export async function addPushNotificationOpenListener() { return { remove: async () => {} }; }
                export async function ensureAndroidNotificationChannels() {}
                export async function enablePushNotificationsForUser() {
                    return { token: 'push-token', platform: 'web' };
                }
                export function getPushNotificationPrimerState(context) {
                    return { context, hasResponded: false, accepted: false, declined: false, canAskAgain: true, decidedAt: null };
                }
                export function recordPushNotificationPrimerDecision() {}
                export async function runPushNotificationPrimer() { return true; }
                export async function getPushNotificationPermissionStatus() {
                    return {
                        state: 'unsupported',
                        isNative: false,
                        platform: 'web',
                        canRequest: false,
                        canOpenSettings: false
                    };
                }
                export async function openPushNotificationSettings() {}
            `
        });
    });

    await page.route(/\/src\/lib\/homeService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                function event(overrides = {}) {
                    return {
                        eventKey: overrides.eventKey || 'team-1::game-next::player-1',
                        id: overrides.id || 'game-next',
                        teamId: 'team-1',
                        teamName: 'Bears',
                        type: overrides.type || 'game',
                        date: overrides.date || new Date('2100-06-01T18:00:00Z'),
                        location: overrides.location || 'Main Gym',
                        opponent: overrides.opponent || 'Falcons',
                        title: overrides.title || null,
                        childId: 'player-1',
                        childName: 'Pat Star',
                        isDbGame: true,
                        isCancelled: false,
                        myRsvp: overrides.myRsvp || 'not_responded',
                        assignments: [],
                        practiceHomePacketSummary: overrides.practiceHomePacketSummary || null
                    };
                }

                export async function loadParentHomeSummary(...args) {
                    return loadParentHome(...args);
                }

                export async function loadParentHomeSummaryBootstrap(...args) {
                    const home = await loadParentHome(...args);
                    return { home, schedule: [] };
                }

                export async function loadParentTeamsSummaryBootstrap(...args) {
                    const home = await loadParentHome(...args);
                    return {
                        home,
                        scheduleScope: {
                            profile: {},
                            children: home.teams.flatMap((team) => team.players || [])
                        }
                    };
                }

                export async function loadParentTeamsSummary(...args) {
                    return loadParentHome(...args);
                }

                export async function loadParentScheduleSummary() {
                    return [];
                }

                export async function loadParentHomeWithSecondaryData(...args) {
                    return loadParentHome(...args);
                }

                export async function loadParentHome() {
                    const nextEvent = event();
                    const practice = event({
                        eventKey: 'team-1::practice-1::player-1',
                        id: 'practice-1',
                        type: 'practice',
                        title: 'Practice',
                        date: new Date('2100-06-02T19:00:00Z'),
                        myRsvp: 'going',
                        practiceHomePacketSummary: '2 drills · 20 min'
                    });
                    return {
                        players: [{
                            teamId: 'team-1',
                            teamName: 'Bears',
                            playerId: 'player-1',
                            playerName: 'Pat Star',
                            nextEvent,
                            rsvpNeeded: 1,
                            packetsReady: 1,
                            openAssignments: 0,
                            unreadCount: 2
                        }],
                        teams: [{
                            teamId: 'team-1',
                            teamName: 'Bears',
                            role: 'Parent',
                            sport: 'Basketball',
                            photoUrl: 'https://img.example.test/bears.png',
                            players: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' }],
                            nextEvent,
                            eventCount: 2,
                            unreadCount: 2,
                            openActions: 2
                        }],
                        upcomingEvents: [nextEvent, practice],
                        actionItems: [{
                            id: 'rsvp:game-next',
                            kind: 'rsvp',
                            tone: 'amber',
                            title: 'Pat Star needs availability',
                            detail: 'Bears vs. Falcons',
                            to: '/schedule/team-1/game-next?childId=player-1&section=availability',
                            priority: 10,
                            date: nextEvent.date
                        }],
                        fees: [{
                            id: 'fee-1',
                            title: 'Tournament fee',
                            teamId: 'team-1',
                            teamName: 'Bears',
                            playerId: 'player-1',
                            playerName: 'Pat Star',
                            status: 'open',
                            balanceDueCents: 2000,
                            amountCents: 2000,
                            dueDate: new Date('2100-06-10T12:00:00Z')
                        }],
                        metrics: {
                            players: 1,
                            teams: 1,
                            rsvpNeeded: 1,
                            unreadMessages: 2,
                            packetsReady: 1
                        }
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
                const children = [{
                    teamId: 'team-1',
                    teamName: 'Bears',
                    playerId: 'player-1',
                    playerName: 'Pat Star'
                }];

                function event(overrides = {}) {
                    return {
                        eventKey: overrides.eventKey || 'team-1::game-next::player-1::2100-06-01T18:00:00.000Z::game',
                        id: overrides.id || 'game-next',
                        teamId: 'team-1',
                        teamName: 'Bears',
                        type: overrides.type || 'game',
                        date: overrides.date || new Date('2100-06-01T18:00:00Z'),
                        endDate: overrides.endDate || new Date('2100-06-01T20:00:00Z'),
                        location: overrides.location || 'Main Gym',
                        opponent: overrides.opponent || 'Falcons',
                        title: overrides.title || null,
                        childId: 'player-1',
                        childName: 'Pat Star',
                        isDbGame: true,
                        isCancelled: false,
                        status: overrides.status || 'scheduled',
                        liveStatus: null,
                        homeScore: null,
                        awayScore: null,
                        myRsvp: overrides.myRsvp || 'not_responded',
                        myRsvpNote: '',
                        assignments: overrides.assignments || [],
                        rsvpSummary: { going: 0, maybe: 0, notGoing: 0, notResponded: 1, total: 1 },
                        rideshareSummary: { offerCount: 0, seatsLeft: 0, requests: 0, pending: 0, confirmed: 0, isFull: false },
                        availabilityLocked: false,
                        availabilityNotesVisible: false,
                        availabilityNotes: [],
                        isTeamAdmin: false,
                        isTeamStaff: true,
                        isTeamRsvpReminderManager: false,
                        canUpdateScore: false,
                        calendarUrls: [],
                        practiceHomePacketSummary: overrides.practiceHomePacketSummary || null,
                        gamePlan: null,
                        ...overrides
                    };
                }

                function scheduleEvents() {
                    return [
                        event(),
                        event({
                            eventKey: 'team-1::practice-1::player-1::2100-06-02T19:00:00.000Z::practice',
                            id: 'practice-1',
                            type: 'practice',
                            title: 'Practice',
                            date: new Date('2100-06-02T19:00:00Z'),
                            endDate: new Date('2100-06-02T20:00:00Z'),
                            myRsvp: 'going',
                            practiceHomePacketSummary: '2 drills · 20 min'
                        })
                    ];
                }

                export async function loadParentSchedule() {
                    return { children, events: scheduleEvents(), isPartial: false };
                }

                export async function loadParentScheduleEventDetail(_user, options = {}) {
                    return {
                        children,
                        events: [event({
                            id: options.eventId || 'game-next',
                            eventKey: 'team-1::' + (options.eventId || 'game-next') + '::player-1::2100-06-01T18:00:00.000Z::game'
                        })],
                        isPartial: false
                    };
                }

                export function resolveCachedParentScheduleEvents() {
                    return scheduleEvents();
                }

                export async function loadOfficialAssignmentsAccess() {
                    return { hasAccess: true, teamIds: ['team-1'], teamCount: 1 };
                }

                export async function loadOfficialAssignments() {
                    return {
                        hasAccess: true,
                        teamIds: ['team-1'],
                        teamCount: 1,
                        assignments: [{
                            kind: 'assigned',
                            teamId: 'team-1',
                            teamName: 'Bears',
                            gameId: 'game-next',
                            slotId: 'slot-1',
                            position: 'Referee',
                            status: 'pending',
                            opponent: 'Falcons',
                            location: 'Main Gym',
                            date: new Date('2100-06-01T18:00:00Z'),
                            canClaim: false,
                            scheduleReviewRequired: false
                        }]
                    };
                }

                export async function loadParentScheduleAssignments() { return []; }
                export async function loadParentScheduleRideOffers() { return []; }
                export async function loadScheduleStatTrackerConfigsForApp() { return []; }
                export async function loadScheduledPracticeSeriesForEdit() { return null; }
                export async function loadParentPracticePacket() { return null; }
                export async function loadStaffPracticePacket() { return null; }
                export async function loadStaffPracticeAttendance() { return { players: [], statuses: {}, notes: '' }; }
                export async function loadAutoFilledLineupDraftPreviewForApp() { return { formationId: '', assignments: [] }; }
                export async function markParentPracticePacketComplete() { return { completedAt: new Date() }; }
                export async function publishGamePlanForApp() { return { success: true }; }
                export async function loadHomeScoringPlayers() { return []; }
                export async function publishLiveScoreUpdateEvent() {}
                export async function recordPlayerGameStat() { return { homeScore: 0, awayScore: 0, stats: {} }; }
                export async function recordPlayerScoringStat() { return { homeScore: 0, awayScore: 0, stats: {} }; }
                export async function undoRecordedPlayerGameStat() { return { homeScore: 0, awayScore: 0, stats: {} }; }
                export async function saveScheduledGameLineupDraftForApp() { return { success: true }; }
                export async function saveStaffPracticeAttendance() { return { players: [], statuses: {}, notes: '' }; }
                export async function saveStaffPracticePacket() { return null; }
                export async function completeGameWrapupForApp() { return { success: true }; }
                export async function loadGameDayLiveEventsForApp() { return []; }
                export async function saveGameDaySubstitutionForApp() { return { success: true }; }
                export async function updateGameScore() { return { homeScore: 0, awayScore: 0, status: 'scheduled' }; }
                export async function adjustGameScore() { return { homeScore: 0, awayScore: 0, shared: false }; }
                export async function updateLiveGameClockState() { return null; }
                export function buildLiveGameClockPeriods() { return []; }
                export function resolveLiveGameClockSnapshot() { return null; }
                export function createStaffRsvpAvailabilityLoader() { return async () => ({ rows: [], summary: {} }); }
                export function createStaffRsvpReminderPreviewLoader() { return async () => ({ recipients: [], message: '' }); }
                export async function submitStaffScheduleRsvpOverride() { return { response: 'going' }; }
                export async function sendStaffRsvpReminder() { return { sentCount: 0, skippedCount: 0, recipients: [] }; }
                export async function addTeamCalendarUrl() { return []; }
                export async function removeTeamCalendarUrl() { return []; }
                export async function createScheduledGameForApp() { return 'game-new'; }
                export async function createScheduledPracticeForApp() { return 'practice-new'; }
                export async function createScheduledTournamentBlockForApp() { return { batchId: 'batch-new', gameIds: [] }; }
                export async function createScheduleImportGame() { return 'import-game'; }
                export async function createScheduleImportPractice() { return 'import-practice'; }
                export async function finalizeScheduleImportBatch() { return { success: true }; }
                export async function cancelPracticeOccurrenceForApp() { return { cancelled: true }; }
                export async function cancelScheduledGameForApp() { return { cancelled: true }; }
                export async function updateScheduledGameForApp() { return { updated: true }; }
                export async function updateScheduledPracticeForApp() { return { updated: true }; }
                export async function revertScheduledPracticeOccurrenceForApp() { return { reverted: true }; }
                export async function respondToOfficialAssignmentItem() {}
                export async function claimOfficialAssignmentItem() {}
                export async function submitParentScheduleRsvp() { return { response: 'going' }; }
                export async function claimParentScheduleAssignmentSlot() { return { role: 'Volunteer' }; }
                export async function releaseParentScheduleAssignmentClaim() {}
                export async function createParentScheduleRideOffer() { return { id: 'ride-1' }; }
                export async function requestParentScheduleRideSpot() { return { id: 'ride-request-1' }; }
                export async function updateParentScheduleRideRequestStatus() {}
                export async function setParentScheduleRideOfferStatus() {}
                export async function cancelParentScheduleRideRequest() {}
                export function summarizeParentScheduleRideOffers() { return { offerCount: 0, seatsLeft: 0, requests: 0, pending: 0, confirmed: 0, isFull: false }; }
                export function resolveParentGameRoute() { return { teamId: 'team-1', gameId: 'game-next', route: '/schedule/team-1/game-next' }; }
            `
        });
    });

    await page.route(/\/src\/lib\/chatService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                const team = {
                    id: 'team-1',
                    name: 'Bears',
                    sport: 'Basketball',
                    photoUrl: 'https://img.example.test/bears.png',
                    active: true,
                    role: 'Parent',
                    canModerate: false,
                    unreadCount: 2,
                    preferredConversationId: 'team',
                    isMuted: false,
                    lastMessage: {
                        id: 'msg-1',
                        text: 'Practice packet posted.',
                        senderId: 'coach-1',
                        senderName: 'Coach Jamie',
                        senderEmail: 'coach@example.com',
                        senderPhotoUrl: null,
                        createdAt: new Date('2100-06-01T12:00:00Z'),
                        editedAt: null,
                        deleted: false,
                        reactions: {},
                        attachments: [],
                        conversationId: null
                    }
                };

                export async function loadChatInbox(_user, options = {}) {
                    options.onPreview?.({ teamId: 'team-1', lastMessage: team.lastMessage, preferredConversationId: 'team', isMuted: false });
                    return { teams: [team] };
                }

                export function getChatInboxPreview(message) {
                    return message?.text || '';
                }

                export async function loadChatTeamContext() {
                    return { team, profile: { fullName: 'Pat Parent' }, canModerate: false };
                }

                export async function loadChatConversations() {
                    return [{ id: 'team', label: 'Full team', targetType: 'full_team', unreadCount: 0, isMuted: false }];
                }

                export function subscribeToTeamChatMessages(_teamId, _conversationId, onSnapshot) {
                    const message = {
                        ...team.lastMessage,
                        _doc: null,
                        targetType: 'full_team',
                        recipientIds: [],
                        targetRole: null,
                        clientMessageId: null
                    };
                    queueMicrotask(() => onSnapshot([message], null));
                    return { unsubscribe() {} };
                }

                export async function loadOlderTeamChatMessages() { return []; }
                export async function deleteTeamChatMessage() {}
                export async function editTeamChatMessage() {}
                export async function ensureStaffChatConversation() { return { id: 'staff', label: 'Staff', targetType: 'staff' }; }
                export async function loadChatRecipientOptions() { return []; }
                export async function loadSentTeamEmails() { return []; }
                export async function loadTeamEmailDrafts() { return []; }
                export async function loadTeamEmailTemplates() { return []; }
                export async function markTeamChatRead() {}
                export async function muteTeamChat() {}
                export async function unmuteTeamChat() {}
                export async function saveTeamEmailDraft() { return { id: 'draft-1' }; }
                export async function saveTeamEmailTemplate() { return { id: 'template-1' }; }
                export async function sendAllPlaysChatAnswer() { return { text: 'Answer' }; }
                export async function sendTeamChatMessage() { return { id: 'msg-new' }; }
                export async function sendTeamEmailMessage() { return { id: 'email-new' }; }
                export async function toggleTeamChatReaction() {}
                export async function uploadTeamChatAttachment() { return { type: 'image', url: 'https://img.example.test/chat.png', name: 'chat.png' }; }
            `
        });
    });

    await page.route(/\/src\/lib\/parentFeesService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                const fee = {
                    id: 'fee-1',
                    teamId: 'team-1',
                    teamName: 'Bears',
                    playerId: 'player-1',
                    playerName: 'Pat Star',
                    batchId: 'batch-1',
                    recipientId: 'recipient-1',
                    title: 'Tournament fee',
                    status: 'open',
                    statusLabel: 'Open',
                    amountCents: 2000,
                    amountLabel: '$20.00',
                    dueLabel: 'Jun 10',
                    balanceDueCents: 2000,
                    checkoutUrl: '',
                    checkoutStatus: '',
                    canPay: false,
                    checkoutInitiatable: false,
                    paymentAction: '',
                    lineItems: [],
                    installments: [],
                    ledgerEntries: []
                };

                export async function loadParentFeesForApp() {
                    return [fee];
                }

                export async function initiateParentTeamFeeCheckout() {
                    return { success: true, checkoutUrl: 'https://checkout.example.test/session' };
                }

                export function isParentTeamFeePayActionAllowed() { return false; }
                export function canInitiateParentTeamFeeCheckout() { return false; }
            `
        });
    });

    await page.route(/\/src\/lib\/parentToolsAccessService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function loadParentAccessModel() {
                    return {
                        teams: [],
                        requests: [{
                            id: 'request-1',
                            teamId: 'team-1',
                            teamName: 'Bears',
                            playerId: 'player-1',
                            playerName: 'Pat Star',
                            relation: 'Parent',
                            status: 'pending',
                            decisionNote: null,
                            createdAt: new Date('2100-06-01T12:00:00Z')
                        }]
                    };
                }

                export async function loadParentAccessTeams() {
                    return [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];
                }

                export async function loadParentAccessPlayers() {
                    return [{ id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null }];
                }

                export async function submitParentAccessRequest() {
                    return { id: 'request-new', status: 'pending' };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/socialService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function loadSocialHome() {
                    return {
                        feedItems: [{
                            id: 'post-1',
                            type: 'player_moment',
                            visibility: 'friends',
                            authorId: 'friend-1',
                            authorName: 'Jamie Friend',
                            authorPhotoUrl: null,
                            teamId: 'team-1',
                            teamName: 'Bears',
                            playerIds: ['player-1'],
                            playerNames: ['Pat Star'],
                            sourceType: 'player',
                            sourceId: 'player-1',
                            title: 'Pat Star highlight',
                            detail: 'Player moment · Pat Star · Bears',
                            caption: 'Great ball movement in the second half.',
                            media: [],
                            route: '/players/team-1/player-1',
                            href: null,
                            createdAt: new Date('2100-06-01T18:00:00Z'),
                            reactionCounts: { like: 2 },
                            commentCount: 1
                        }],
                        friends: [{
                            id: 'friendship-1',
                            userId: 'friend-1',
                            name: 'Jamie Friend',
                            email: 'jamie@example.com',
                            photoUrl: null,
                            sharedTeamIds: ['team-1'],
                            sharedTeamNames: ['Bears'],
                            status: 'accepted',
                            requesterId: 'user-1',
                            recipientId: 'friend-1'
                        }],
                        suggestions: [{
                            id: 'friendship-2',
                            userId: 'friend-2',
                            name: 'Morgan Parent',
                            email: 'morgan@example.com',
                            photoUrl: null,
                            sharedTeamIds: ['team-1'],
                            sharedTeamNames: ['Bears'],
                            status: 'none',
                            requesterId: null,
                            recipientId: 'friend-2'
                        }],
                        incomingRequests: [{
                            id: 'friendship-3',
                            userId: 'friend-3',
                            name: 'Casey Parent',
                            email: 'casey@example.com',
                            photoUrl: null,
                            sharedTeamIds: ['team-1'],
                            sharedTeamNames: ['Bears'],
                            status: 'pending',
                            requesterId: 'friend-3',
                            recipientId: 'user-1'
                        }],
                        outgoingRequests: [],
                        metrics: {
                            feedItems: 1,
                            friends: 1,
                            incomingRequests: 1,
                            suggestions: 1
                        }
                    };
                }
                export async function createSocialPost(user, input) {
                    window.__socialPosts.push({ user, input });
                    return 'post-new';
                }
                export async function reactToSocialPost() {}
                export async function commentOnSocialPost() {}
                export async function hideSocialPost() {}
                export async function reportSocialPost() {}
                export async function searchSocialUsers() { return []; }
                export async function sendFriendRequest() { return 'friendship-new'; }
                export async function respondToFriendRequest() {}
                export async function removeFriend() {}
                export async function blockFriend() {}
                export async function uploadSocialPostMedia(teamId, file) {
                    window.__socialUploads.push({ teamId, name: file?.name || null, type: file?.type || null });
                    return { type: 'image', url: 'https://img.example.test/social.png', name: file?.name || 'social.png', thumbnailUrl: null };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/playerService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                function event(overrides = {}) {
                    return {
                        eventKey: overrides.eventKey || 'team-1::game-next::player-1',
                        id: overrides.id || 'game-next',
                        teamId: 'team-1',
                        teamName: 'Bears',
                        type: overrides.type || 'game',
                        date: overrides.date || new Date('2100-06-01T18:00:00Z'),
                        location: overrides.location || 'Main Gym',
                        opponent: overrides.opponent || 'Falcons',
                        title: overrides.title || null,
                        childId: 'player-1',
                        childName: 'Pat Star',
                        isDbGame: true,
                        isCancelled: false,
                        myRsvp: overrides.myRsvp || 'not_responded',
                        assignments: [],
                        practiceHomePacketSummary: overrides.practiceHomePacketSummary || null
                    };
                }

                export async function loadParentPlayerDetail(user, teamId, playerId) {
                    window.__playerLoads.push({ teamId, playerId });
                    const nextEvent = event();
                    const statEvent = event({
                        eventKey: 'team-1::game-final::player-1',
                        id: 'game-final',
                        date: new Date('2000-06-01T18:00:00Z'),
                        status: 'completed',
                        myRsvp: 'going'
                    });
                    return {
                        child: { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' },
                        player: { id: 'player-1', name: 'Pat Star', teamId: 'team-1', teamName: 'Bears', number: '9', photoUrl: '' },
                        team: { id: 'team-1', name: 'Bears', sport: 'basketball' },
                        access: {
                            isLinkedParent: true,
                            isTeamStaff: false,
                            canEditCustomRosterFields: false
                        },
                        events: [statEvent, nextEvent],
                        nextEvent,
                        actionCounts: {
                            rsvpNeeded: 1,
                            packetsReady: 0,
                            openAssignments: 0
                        },
                        statRows: [{ event: statEvent, stats: { pts: 12, reb: 4 } }],
                        clips: [{ title: 'Fast break', url: 'https://video.example.test/clip', gameLabel: 'vs. Falcons' }],
                        certificates: [{ id: 'cert-1', title: 'Hustle Award' }],
                        trackingSummary: [{ playerId: 'player-1', items: [{ id: 'item-1', title: 'Bring ball', isComplete: true }] }],
                        privateProfile: {
                            emergencyContact: { name: 'Jamie Parent', phone: '555-0100' },
                            medicalInfo: 'Peanut allergy'
                        },
                        incentives: {
                            rules: [{ id: 'rule-1', statKey: 'pts', type: 'per_unit', amountCents: 100, active: true }],
                            currentRules: [{ id: 'rule-1', statKey: 'pts', type: 'per_unit', amountCents: 100, active: true }],
                            statOptions: [{ key: 'pts', label: 'PTS' }],
                            maxPerGameCents: null,
                            seasonGameEarnings: [{
                                event: statEvent,
                                stats: { pts: 12, reb: 4 },
                                totalCents: 1200,
                                uncappedTotalCents: 1200,
                                wasCapped: false,
                                breakdown: [{ rule: { statKey: 'pts', type: 'per_unit', amountCents: 100 }, statValue: 12, earned: 1200 }],
                                paid: false,
                                paidAmountCents: 0
                            }],
                            totalEarnedCents: 1200,
                            totalPaidCents: 0,
                            unpaidCents: 1200
                        },
                        athleteProfile: {
                            profile: { id: 'profile-1', athlete: { name: 'Pat Star', headline: '2028 Guard' }, bio: { position: 'Guard' }, privacy: 'public', seasons: [{ teamId: 'team-1', playerId: 'player-1' }] },
                            shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1',
                            builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-1&playerId=player-1&profileId=profile-1'
                        }
                    };
                }

                export async function loadParentPlayerAthleteProfile() {
                    return {
                        profile: { id: 'profile-1', athlete: { name: 'Pat Star', headline: '2028 Guard' }, bio: { position: 'Guard' }, privacy: 'public', seasons: [{ teamId: 'team-1', playerId: 'player-1' }] },
                        shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1',
                        builderUrl: 'https://allplays.ai/athlete-profile-builder.html?teamId=team-1&playerId=player-1&profileId=profile-1',
                        seasonOptions: [{ seasonKey: 'team-1::player-1', teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' }]
                    };
                }

                export async function loadParentPlayerVideoClips() {
                    return [{ title: 'Fast break', url: 'https://video.example.test/clip', gameLabel: 'vs. Falcons' }];
                }

                export async function updateParentPlayerEditableProfile() {}
                export async function savePlayerCustomRosterFieldValues() {}
                export async function saveStaffPlayerRosterDetails() { return { updatedFields: [] }; }
                export async function sendParentCoParentInvite() { return { code: 'ABC12345' }; }
                export function normalizeAthleteProfileHighlightClipUrl(url) {
                    const value = String(url || '').trim();
                    return value;
                }
                export async function saveParentAthleteProfileDraft() { return { shareUrl: 'https://allplays.ai/athlete-profile.html?profileId=profile-1' }; }
                export async function saveParentPlayerIncentiveRule() { return 'rule-2'; }
                export async function toggleParentPlayerIncentiveRule() {}
                export async function retireParentPlayerIncentiveRule() {}
                export async function saveParentPlayerIncentiveCap() {}
                export async function markParentPlayerIncentivePaid() {}
            `
        });
    });

    await page.route(/\/src\/lib\/teamDetailService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function inviteTeamAdminForApp() {
                    return { status: 'sent', email: 'coach@example.com' };
                }

                export async function createRosterParentInviteForApp() {
                    return { code: 'ABCD1234', inviteUrl: 'https://allplays.ai/app#/accept-invite?code=ABCD1234&type=parent', status: 'pending', existingUser: false, autoLinked: false, teamName: 'Bears', playerName: 'Pat Star' };
                }

                export async function createStatTrackerConfigForApp() {
                    return 'config-new';
                }

                export async function addRosterPlayerForApp() {
                    return { playerId: 'player-new' };
                }

                export async function archiveTeamTrackingItemForApp() {}

                export async function deactivateRosterPlayerForApp() {}

                export async function loadTeamTrackingAdmin() {
                    return [];
                }

                export async function grantScorekeeperAccessForApp() {
                    return { success: true };
                }

                export async function revokeScorekeeperAccessForApp() {
                    return { success: true };
                }

                export async function revokeTeamAdminAccessForApp() {
                    return { success: true };
                }

                export async function grantVideographerAccessForApp() {
                    return { success: true };
                }

                export async function revokeVideographerAccessForApp() {
                    return { success: true };
                }

                export async function saveTeamTrackingItemForApp() {
                    return 'tracking-item-1';
                }

                export async function saveTeamScheduleNotificationsForApp(teamId, settings = {}) {
                    return {
                        enabled: settings.enabled !== false,
                        reminderHours: settings.reminderHours || 24,
                        delivery: 'team_chat',
                        hasExplicitReminderHours: true,
                        summary: 'Team default reminder window: 24 hours before event start.'
                    };
                }

                export async function setPlayerTrackingStatusForApp() {}

                export async function updateStatTrackerConfigForApp() {}

                export async function loadTeamStaffPermissions() {
                    return null;
                }

                export async function loadTeamRosterParentInvites() {
                    return [];
                }

                export async function loadTeamDetailInsights() {
                    return {
                        leaderboards: [{ id: 'pts', label: 'Points', leaders: [{ playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9', photoUrl: 'https://img.example.test/player.png', rank: 1, formattedValue: '88' }] }],
                        trackingSummaries: [{ playerId: 'player-1', playerName: 'Pat Star', photoUrl: 'https://img.example.test/player.png', items: [{ id: 'item-1', title: 'Bring ball', description: '', isComplete: false }] }]
                    };
                }

                export async function loadTeamDetailSponsors() {
                    return { sponsors: [{ id: 'sponsor-1', name: 'Pizza Place', description: 'After the game', imageUrl: 'https://img.example.test/pizza.png', websiteUrl: 'https://pizza.example.test' }] };
                }

                export function buildPublicTeamGamesIcsUrl(teamId) {
                    return teamId ? 'https://calendar.example.test/publicTeamGamesIcs?teamId=' + encodeURIComponent(teamId) : '';
                }

                export function canExposePublicFanFeed(team = {}, events = []) {
                    return (events || []).some((event) => event?.type === 'game'
                        && event?.visibility !== 'private'
                        && event?.isPrivate !== true
                        && event?.status !== 'deleted'
                        && event?.liveStatus !== 'deleted'
                        && ((team?.isPublic !== false && team?.active !== false)
                            || event?.isPublic === true
                            || event?.shareable === true
                            || event?.publicCalendar === true));
                }

                export async function loadRosterFieldDefinitionsForApp() {
                    return [];
                }

                export async function loadParentTeamDetailBootstrap(teamId) {
                    return loadParentTeamDetail(teamId);
                }

                export async function loadParentTeamDetail(teamId = 'team-1') {
                    const nextDate = new Date('2100-06-01T18:00:00Z');
                    return {
                        team: {
                            id: 'team-1',
                            name: 'Bears',
                            sport: 'Basketball',
                            photoUrl: 'https://img.example.test/bears.png',
                            description: 'Parent-facing team page',
                            zip: '66210',
                            leagueUrl: 'https://league.example.test/standings',
                            streamUrl: 'https://youtube.example.test/watch',
                            websiteUrl: 'https://allplays.ai/team.html#teamId=team-1',
                            mediaUrl: 'https://allplays.ai/team-media.html#teamId=team-1',
                            registrationProvider: [{ label: 'Provider', value: 'Sports Connect' }]
                        },
                        players: [
                            { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: 'https://img.example.test/player.png', position: 'Guard', isLinked: true }
                        ],
                        linkedPlayers: [
                            { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: 'https://img.example.test/player.png', position: 'Guard', isLinked: true }
                        ],
                        upcomingEvents: [
                            { id: 'game-next', type: 'game', title: 'vs. Falcons', date: nextDate, location: 'Main Gym', opponent: 'Falcons', status: '', homeScore: null, awayScore: null, isCancelled: false }
                        ],
                        recentResults: [],
                        nextEvent: { id: 'game-next', type: 'game', title: 'vs. Falcons', date: nextDate, location: 'Main Gym', opponent: 'Falcons', status: '', homeScore: null, awayScore: null, isCancelled: false },
                        record: { label: '2100', wins: 4, losses: 2, ties: 0, gamesPlayed: 6, winPercentage: 66.7 },
                        standings: { enabled: true, label: 'Points table', rows: [{ team: 'Bears', rank: 1, record: '4-2', pf: 180, pa: 150 }], currentRow: { team: 'Bears', rank: 1, record: '4-2', pf: 180, pa: 150 } },
                        leaderboards: [{ id: 'pts', label: 'Points', leaders: [{ playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9', photoUrl: 'https://img.example.test/player.png', rank: 1, formattedValue: '88' }] }],
                        trackingSummaries: [{ playerId: 'player-1', playerName: 'Pat Star', photoUrl: 'https://img.example.test/player.png', items: [{ id: 'item-1', title: 'Bring ball', description: '', isComplete: false }] }],
                        sponsors: [{ id: 'sponsor-1', name: 'Pizza Place', description: 'After the game', imageUrl: 'https://img.example.test/pizza.png', websiteUrl: 'https://pizza.example.test' }],
                        counts: { games: 8, practices: 3, completedGames: 6 }
                    };
                }

                export async function reactivateRosterPlayerForApp() {}
            `
        });
    });
}

test('home dashboard drills into player detail with section submenus', async ({ page, baseURL }) => {
    await mockHomePlayerModules(page);
    await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Today for your players' })).toBeVisible();
    await expect(page.getByText('Do first')).toBeVisible();
    await expect(page.getByText('Team chats')).toBeVisible();
    await expect(page.getByText('2 unread messages')).toBeVisible();
    await expect(page.getByText('Team feed')).toBeVisible();
    await expect(page.getByText('Pat Star highlight').first()).toBeVisible();
    await expect(page.getByText('Next up')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pat Star needs availability' })).toBeVisible();
    await expect.poll(async () => {
        const box = await page.locator('.home-hero').boundingBox();
        return Math.round(box?.height || 0);
    }).toBeLessThan(170);

    await page.getByRole('button', { name: 'Teams' }).click();
    await expect(page.locator('a[href="#/teams?selectedTeamId=team-1&from=home"]')).toBeVisible();

    await page.getByRole('button', { name: 'Feed' }).click();
    await expect(page.getByText('Quick shares')).toBeVisible();
    await expect(page.getByText('Jamie Friend')).toBeVisible();
    await expect(page.getByText('Great ball movement in the second half.')).toBeVisible();
    await expect(page.locator('a[href="#/players/team-1/player-1"]').first()).toBeVisible();
    await expect(page.locator('a[href="#/home?section=friends"]')).toBeVisible();
    await page.getByRole('button', { name: 'Player moment' }).click();
    await expect(page.getByRole('heading', { name: 'What happened?' })).toBeVisible();
    await expect(page.getByText('Pick one')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change share type' })).toBeVisible();
    await expect(page.getByText('Write one short note')).toBeVisible();
    await expect(page.getByText('Proud of the effort today.')).toBeVisible();
    await expect(page.getByText('Post type')).toHaveCount(0);
    await expect(page.getByText('Title')).toHaveCount(0);
    await page.getByRole('button', { name: 'Proud of the effort today.' }).click();
    await page.getByRole('dialog', { name: 'Create social post' }).getByRole('button', { name: 'Post', exact: true }).click();
    await expect(page.getByText('Posted to your ALL PLAYS feed.')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__socialPosts[0]?.input)).toEqual(expect.objectContaining({
        type: 'player_moment',
        title: 'Pat Star moment',
        caption: 'Proud of the effort today.',
        teamId: 'team-1',
        playerIds: ['player-1']
    }));

    await page.locator('.home-section-nav').getByRole('button', { name: 'Friends' }).click();
    await expect(page.getByText('Needs response')).toBeVisible();
    await expect(page.getByText('Casey Parent')).toBeVisible();
    await expect(page.getByText('Morgan Parent')).toBeVisible();
    await expect(page.getByText('Jamie Friend')).toBeVisible();

    await page.getByRole('button', { name: 'Players' }).click();
    await expect(page.getByRole('heading', { name: 'Player Drill-In' })).toBeVisible();
    await page.locator('a[href="#/players/team-1/player-1"]').click();

    await expect(page.getByRole('heading', { name: 'Pat Star' })).toBeVisible();
    await expect.poll(async () => {
        const box = await page.locator('.player-summary-card').boundingBox();
        return Math.round(box?.height || 0);
    }).toBeLessThan(130);
    await expect(page.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => window.__playerLoads[0])).toEqual({ teamId: 'team-1', playerId: 'player-1' });

    await page.getByRole('button', { name: 'Reports' }).click();
    await expect(page.getByText('Player reports')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Game Stats' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Season Averages' })).toBeVisible();
    await expect(page.getByText('Bring ball')).toBeVisible();
    await page.getByRole('button', { name: 'Video Clips' }).click();
    await expect(page.getByText('Fast break')).toBeVisible();

    await page.getByRole('button', { name: 'Profile' }).click();
    await expect(page.getByRole('button', { name: 'Edit Profile' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Athlete Profile' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Family' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Incentives' })).toBeVisible();
    await expect(page.getByText('Certificates')).toBeVisible();

    await page.getByRole('button', { name: 'Athlete Profile' }).click();
    await expect(page.getByText('Athlete Profile Builder')).toBeVisible();
    await page.getByRole('button', { name: 'Publish Athlete Profile' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Athlete Profile', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Parents can update the player photo')).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole('button', { name: 'Incentives' }).click();
    await expect(page.getByText('Incentive wallet')).toBeVisible();
    await expect(page.getByText('Payouts need attention')).toBeVisible();
    await expect(page.getByText('Active rules').first()).toBeVisible();
    await expect.poll(async () => {
        const box = await page.getByText('Incentive wallet').locator('xpath=ancestor::section[1]').boundingBox();
        return Math.round(box?.width || 0);
    }).toBeGreaterThan(320);
    await page.getByRole('button', { name: 'Payouts', exact: true }).click();
    await expect(page.getByText('Game payouts')).toBeVisible();
    await expect(page.getByText('12 PTS x $1.00 = +$12.00')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark Paid' })).toBeVisible();
    await page.getByRole('button', { name: 'Rules', exact: true }).click();
    await expect(page.getByText('Rules and limits')).toBeVisible();
    await expect(page.getByText('PTS: +$1.00 per pts')).toBeVisible();
});

test('parent core player drill-in sends workflow timer to telemetry storage payload', async ({ page, baseURL }) => {
    const telemetryBatches = await installTelemetryCollectorCapture(page);
    await mockHomePlayerModules(page);
    await page.goto(appUrl(baseURL, '/home?section=players'), { waitUntil: 'domcontentloaded' });

    await waitForHomeRoute(page, page.getByRole('heading', { name: 'Player Drill-In' }));
    await page.locator('a[href="#/players/team-1/player-1"]').click();

    await expect(page.getByRole('heading', { name: 'Pat Star' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => performance.getEntriesByType('measure').map((entry) => entry.name)), { timeout: 15000 })
        .toContain('allplays:ap_workflow_parent_core_workflow_drill_in');

    await page.evaluate(async () => {
        await window.AllPlaysTelemetry?.flush?.();
    });

    await expect.poll(() => getTelemetryEventsFromBatches(telemetryBatches), { timeout: 15000 }).toEqual(expect.arrayContaining([
        expect.objectContaining({
            name: 'app_workflow_timing',
            sessionId: expect.any(String),
            visitorId: expect.any(String),
            pagePath: '/',
            appRoute: '/players/team-1/player-1',
            properties: expect.objectContaining({
                workflowName: 'parent core workflow drill in',
                outcome: 'success',
                source: 'parent_core',
                sourcePage: 'home',
                targetPage: 'player',
                targetRoute: '/players/team-1/player-1',
                trigger: 'player_card',
                actionKind: 'player',
                teamId: 'team-1',
                playerId: 'player-1',
                completedPage: 'player',
                completedRoute: '/players/team-1/player-1',
                expectedTargetRoute: '/players/team-1/player-1',
                playerName: 'Pat Star',
                durationMs: expect.any(Number)
            })
        })
    ]));
});

test('parent core workflows emit baseline timers from Home drill-ins', async ({ page, baseURL }) => {
    test.setTimeout(120000);
    const telemetryBatches = await installTelemetryCollectorCapture(page);
    await mockHomePlayerModules(page);
    const baselines = [];
    const workflows = [
        {
            label: 'home_to_schedule',
            startHash: '/home',
            expectedTargetPage: 'schedule',
            expectedTargetRoute: '/schedule',
            readyHome: (testPage) => testPage.getByRole('heading', { name: 'Today for your players' }),
            action: async (testPage) => {
                await testPage.locator('.home-upcoming-section a[href="#/schedule"]').click();
            },
            readyTarget: async (testPage) => {
                await expect(testPage.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible();
                await expect(testPage.getByRole('heading', { name: 'vs. Falcons' })).toBeVisible();
            }
        },
        {
            label: 'home_to_schedule_event',
            startHash: '/home',
            expectedTargetPage: 'schedule_event',
            expectedTargetRoute: '/schedule/team-1/game-next?childId=player-1&section=availability',
            readyHome: (testPage) => testPage.getByRole('heading', { name: 'Today for your players' }),
            action: async (testPage) => {
                await testPage.getByRole('link', { name: /Open action/ }).click();
            },
            readyTarget: async (testPage) => {
                await expect(testPage.getByRole('heading', { name: /Falcons/ })).toBeVisible();
            }
        },
        {
            label: 'home_to_teams',
            startHash: '/home?section=teams',
            expectedTargetPage: 'teams',
            expectedTargetRoute: '/teams?selectedTeamId=team-1&from=home',
            readyHome: (testPage) => testPage.getByRole('heading', { name: 'Teams' }),
            action: async (testPage) => {
                await testPage.locator('a[href="#/teams?selectedTeamId=team-1&from=home"]').click();
            },
            readyTarget: async (testPage) => {
                await waitForTeamsRoute(testPage, testPage.getByRole('heading', { name: '1 team ready' }));
            }
        },
        {
            label: 'home_to_player_detail',
            startHash: '/home?section=players',
            expectedTargetPage: 'player',
            expectedTargetRoute: '/players/team-1/player-1',
            readyHome: (testPage) => testPage.getByRole('heading', { name: 'Player Drill-In' }),
            action: async (testPage) => {
                await testPage.locator('a[href="#/players/team-1/player-1"]').click();
            },
            readyTarget: async (testPage) => {
                await expect(testPage.getByRole('heading', { name: 'Pat Star' })).toBeVisible();
            }
        },
        {
            label: 'home_to_messages',
            startHash: '/home',
            expectedTargetPage: 'messages',
            expectedTargetRoute: '/messages/team-1',
            readyHome: (testPage) => testPage.getByRole('heading', { name: 'Today for your players' }),
            action: async (testPage) => {
                await testPage.locator('a[href="#/messages/team-1"]').first().click();
            },
            readyTarget: async (testPage) => {
                await expect(testPage.getByText('Practice packet posted.').first()).toBeVisible();
            }
        },
        {
            label: 'home_to_fees',
            startHash: '/home',
            expectedTargetPage: 'fees',
            expectedTargetRoute: '/parent-tools/fees',
            readyHome: (testPage) => testPage.getByRole('heading', { name: 'Today for your players' }),
            action: async (testPage) => {
                await testPage.locator('a[href="#/parent-tools/fees"]').click();
            },
            readyTarget: async (testPage) => {
                await expect(testPage.getByRole('heading', { name: 'Team fees' })).toBeVisible();
            }
        },
        {
            label: 'home_to_officials',
            startHash: '/home',
            expectedTargetPage: 'officials',
            expectedTargetRoute: '/officials',
            readyHome: (testPage) => testPage.getByRole('heading', { name: 'Today for your players' }),
            action: async (testPage) => {
                await testPage.locator('a[href="#/officials"]').click();
            },
            readyTarget: async (testPage) => {
                await expect(testPage.getByRole('heading', { name: 'Assignments' })).toBeVisible();
            }
        }
    ];

    for (const workflow of workflows) {
        const beforeEventCount = getParentCoreWorkflowEvents(telemetryBatches).length;
        await page.goto(appUrl(baseURL, workflow.startHash), { waitUntil: 'domcontentloaded' });
        await waitForHomeRoute(page, workflow.readyHome(page));
        await workflow.action(page);
        await workflow.readyTarget(page);
        await flushTelemetry(page);

        await expect.poll(() => {
            const event = getParentCoreWorkflowEvents(telemetryBatches)
                .slice(beforeEventCount)
                .find((candidate) => (
                    candidate.properties?.targetPage === workflow.expectedTargetPage &&
                    candidate.properties?.targetRoute === workflow.expectedTargetRoute
                ));
            return event ? {
                targetPage: event.properties?.targetPage,
                targetRoute: event.properties?.targetRoute,
                completedPage: event.properties?.completedPage,
                outcome: event.properties?.outcome,
                hasDuration: Number.isFinite(event.properties?.durationMs)
            } : null;
        }, { timeout: 15000 }).toEqual({
            targetPage: workflow.expectedTargetPage,
            targetRoute: workflow.expectedTargetRoute,
            completedPage: workflow.expectedTargetPage,
            outcome: 'success',
            hasDuration: true
        });

        const event = getParentCoreWorkflowEvents(telemetryBatches)
            .slice(beforeEventCount)
            .find((candidate) => (
                candidate.properties?.targetPage === workflow.expectedTargetPage &&
                candidate.properties?.targetRoute === workflow.expectedTargetRoute
            ));
        expect(event, `Telemetry event for ${workflow.label}`).toBeTruthy();
        const durationMs = Number(event.properties.durationMs);
        expect(durationMs).toBeGreaterThanOrEqual(0);
        expect(durationMs).toBeLessThan(30000);
        baselines.push({
            workflow: workflow.label,
            durationMs,
            appRoute: event.appRoute,
            targetRoute: event.properties.targetRoute,
            completedRoute: event.properties.completedRoute,
            trigger: event.properties.trigger,
            actionKind: event.properties.actionKind
        });
    }

    console.log('PARENT_WORKFLOW_BASELINES ' + JSON.stringify(baselines));
    expect(baselines.map((baseline) => baseline.workflow)).toEqual(workflows.map((workflow) => workflow.label));
});

test('requested app workflows emit DB-ready view load baseline timers', async ({ page, baseURL }) => {
    test.setTimeout(180000);
    const telemetryBatches = await installTelemetryCollectorCapture(page);
    await mockHomePlayerModules(page);
    const baselines = [];
    const workflows = [
        {
            workflow: 'home_today',
            label: 'home today load',
            viewName: 'home today',
            route: '/home',
            startHash: '/home',
            ready: async (testPage) => {
                await waitForHomeRoute(testPage, testPage.getByRole('heading', { name: 'Today for your players' }));
            }
        },
        {
            workflow: 'home_feed',
            label: 'home feed load',
            viewName: 'home feed',
            route: '/home?section=feed',
            startHash: '/home?section=feed',
            ready: async (testPage) => {
                await waitForHomeRoute(testPage, testPage.getByText('Quick shares'));
                await expect(testPage.getByText('Pat Star highlight').first()).toBeVisible();
            }
        },
        {
            workflow: 'home_players',
            label: 'home players load',
            viewName: 'home players',
            route: '/home?section=players',
            startHash: '/home?section=players',
            ready: async (testPage) => {
                await waitForHomeRoute(testPage, testPage.getByRole('heading', { name: 'Player Drill-In' }));
            }
        },
        {
            workflow: 'home_teams',
            label: 'home teams load',
            viewName: 'home teams',
            route: '/home?section=teams',
            startHash: '/home?section=teams',
            ready: async (testPage) => {
                await waitForHomeRoute(testPage, testPage.getByRole('heading', { name: 'Teams' }));
            }
        },
        {
            workflow: 'home_friends',
            label: 'home friends load',
            viewName: 'home friends',
            route: '/home?section=friends',
            startHash: '/home?section=friends',
            ready: async (testPage) => {
                await waitForHomeRoute(testPage, testPage.getByText('Needs response'));
                await expect(testPage.getByText('Jamie Friend')).toBeVisible();
            }
        },
        {
            workflow: 'schedule',
            label: 'schedule load',
            viewName: 'schedule',
            route: '/schedule',
            startHash: '/schedule',
            ready: async (testPage) => {
                await expect(async () => {
                    await expect(testPage.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
                    await expect(testPage.getByRole('heading', { name: 'Schedule', exact: true })).toBeVisible({ timeout: 3000 });
                    await expect(testPage.getByRole('heading', { name: 'vs. Falcons' })).toBeVisible({ timeout: 3000 });
                }).toPass({ timeout: 45000 });
            }
        },
        {
            workflow: 'messages_choose_team',
            label: 'messages choose team load',
            viewName: 'messages choose team',
            route: '/messages/team-1',
            startHash: '/messages/team-1',
            ready: async (testPage) => {
                await expect(async () => {
                    await expect(testPage.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
                    await expect(testPage.getByText('Practice packet posted.').first()).toBeVisible({ timeout: 3000 });
                }).toPass({ timeout: 45000 });
            }
        },
        {
            workflow: 'my_teams_team_schedule',
            label: 'my teams team schedule load',
            viewName: 'my teams team schedule',
            route: '/teams/team-1?tab=schedule',
            startHash: '/teams/team-1?tab=schedule',
            ready: async (testPage) => {
                await expect(async () => {
                    await expect(testPage.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
                    await expect(testPage.getByText('Loading team')).toHaveCount(0, { timeout: 3000 });
                    await expect(testPage.getByRole('heading', { name: 'Bears' })).toBeVisible({ timeout: 3000 });
                    await expect(testPage.getByText('Team schedule')).toBeVisible({ timeout: 3000 });
                }).toPass({ timeout: 45000 });
            }
        },
        {
            workflow: 'my_teams_team_roster',
            label: 'my teams team roster load',
            viewName: 'my teams team roster',
            route: '/teams/team-1?tab=roster',
            startHash: '/teams/team-1?tab=roster',
            ready: async (testPage) => {
                await expect(async () => {
                    await expect(testPage.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
                    await expect(testPage.getByText('Loading team')).toHaveCount(0, { timeout: 3000 });
                    await expect(testPage.getByRole('heading', { name: 'Bears' })).toBeVisible({ timeout: 3000 });
                    await expect(testPage.getByText('Roster').first()).toBeVisible({ timeout: 3000 });
                    await expect(testPage.getByText('Pat Star').first()).toBeVisible({ timeout: 3000 });
                }).toPass({ timeout: 45000 });
            }
        },
        {
            workflow: 'my_teams_team_insights',
            label: 'my teams team insights load',
            viewName: 'my teams team insights',
            route: '/teams/team-1?tab=insights',
            startHash: '/teams/team-1?tab=insights',
            ready: async (testPage) => {
                await expect(async () => {
                    await expect(testPage.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
                    await expect(testPage.getByText('Loading team')).toHaveCount(0, { timeout: 3000 });
                    await expect(testPage.getByRole('heading', { name: 'Bears' })).toBeVisible({ timeout: 3000 });
                    await expect(testPage.getByText('Player checklist')).toBeVisible({ timeout: 3000 });
                    await expect(testPage.getByText('Leaderboards')).toBeVisible({ timeout: 3000 });
                }).toPass({ timeout: 45000 });
            }
        },
        {
            workflow: 'my_teams_team_more',
            label: 'my teams team more load',
            viewName: 'my teams team more',
            route: '/teams/team-1?tab=more',
            startHash: '/teams/team-1?tab=more',
            ready: async (testPage) => {
                await expect(async () => {
                    await expect(testPage.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
                    await expect(testPage.getByText('Loading team')).toHaveCount(0, { timeout: 3000 });
                    await expect(testPage.getByRole('heading', { name: 'Bears' })).toBeVisible({ timeout: 3000 });
                    await expect(testPage.getByText('Team links')).toBeVisible({ timeout: 3000 });
                }).toPass({ timeout: 45000 });
            }
        },
        {
            workflow: 'profile_account',
            label: 'profile account load',
            viewName: 'profile account',
            route: '/profile',
            startHash: '/profile',
            ready: async (testPage) => {
                await expect(async () => {
                    await expect(testPage.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
                    await expect(testPage.getByRole('heading', { name: 'Your Account' })).toBeVisible({ timeout: 3000 });
                }).toPass({ timeout: 45000 });
            }
        },
        {
            workflow: 'profile_alerts',
            label: 'profile alerts load',
            viewName: 'profile alerts',
            route: '/profile?section=alerts',
            startHash: '/profile?section=alerts',
            ready: async (testPage) => {
                await expect(async () => {
                    await expect(testPage.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
                    await expect(testPage.getByText('Notification preferences')).toBeVisible({ timeout: 3000 });
                    await expect(testPage.getByText('Customize alerts')).toBeVisible({ timeout: 3000 });
                }).toPass({ timeout: 45000 });
            }
        },
        {
            workflow: 'profile_invites',
            label: 'profile invites load',
            viewName: 'profile invites',
            route: '/profile?section=invites',
            startHash: '/profile?section=invites',
            ready: async (testPage) => {
                await expect(async () => {
                    await expect(testPage.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
                    await expect(testPage.getByText('Invite codes')).toBeVisible({ timeout: 3000 });
                    await expect(testPage.getByText('ABC12345')).toBeVisible({ timeout: 3000 });
                }).toPass({ timeout: 45000 });
            }
        },
        {
            workflow: 'profile_security',
            label: 'profile security load',
            viewName: 'profile security',
            route: '/profile?section=security',
            startHash: '/profile?section=security',
            ready: async (testPage) => {
                await expect(async () => {
                    await expect(testPage.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
                    await expect(testPage.getByText('Account settings')).toBeVisible({ timeout: 3000 });
                    await expect(testPage.getByText('Email verified')).toBeVisible({ timeout: 3000 });
                }).toPass({ timeout: 45000 });
            }
        }
    ];

    for (const workflow of workflows) {
        const beforeEventCount = getViewLoadTelemetryEvents(telemetryBatches).length;
        await page.goto(appUrl(baseURL, workflow.startHash), { waitUntil: 'domcontentloaded' });
        await workflow.ready(page);

        await expect.poll(async () => {
            await flushTelemetry(page);
            const event = getViewLoadTelemetryEvents(telemetryBatches)
                .slice(beforeEventCount)
                .find((candidate) => candidate.properties?.label === workflow.label);
            return event ? {
                label: event.properties?.label,
                category: event.properties?.category,
                viewName: event.properties?.viewName,
                route: event.properties?.route,
                outcome: event.properties?.outcome,
                hasDuration: Number.isFinite(event.properties?.durationMs)
            } : null;
        }, { timeout: 15000 }).toEqual({
            label: workflow.label,
            category: 'view_load',
            viewName: workflow.viewName,
            route: workflow.route,
            outcome: 'success',
            hasDuration: true
        });

        const event = getViewLoadTelemetryEvents(telemetryBatches)
            .slice(beforeEventCount)
            .find((candidate) => candidate.properties?.label === workflow.label);
        expect(event, `Telemetry event for ${workflow.workflow}`).toBeTruthy();
        const durationMs = Number(event.properties.durationMs);
        expect(durationMs).toBeGreaterThanOrEqual(0);
        expect(durationMs).toBeLessThan(30000);
        baselines.push({
            workflow: workflow.workflow,
            label: workflow.label,
            durationMs,
            route: event.properties.route,
            appRoute: event.appRoute,
            viewName: event.properties.viewName,
            outcome: event.properties.outcome
        });
    }

    console.log('REQUESTED_VIEW_LOAD_BASELINES ' + JSON.stringify(baselines));
    expect(baselines.map((baseline) => baseline.workflow)).toEqual(workflows.map((workflow) => workflow.workflow));
});

test('social quick share defers changing the selected post type', async ({ page, baseURL }) => {
    await mockHomePlayerModules(page);
    await page.goto(appUrl(baseURL, '/home?section=feed&social=create&type=game_recap'), { waitUntil: 'domcontentloaded' });

    const dialog = page.getByRole('dialog', { name: 'Create social post' });
    await expect(dialog.getByRole('heading', { name: 'What happened?' })).toBeVisible();
    await expect(dialog.getByText('Game recap').first()).toBeVisible();
    await expect(dialog.getByPlaceholder('How did the game go?')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Change share type' })).toBeVisible();
    await expect(dialog.getByText('Pick one')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Moment' })).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Change share type' }).click();
    await expect(dialog.getByText('Pick one')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Moment' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Media', exact: true }).click();
    await expect(dialog.getByPlaceholder('Add a caption for the photo or video.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Photos from today.' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(dialog.getByText('Add a photo or video for this share.')).toBeVisible();
});

test('social photo quick share requires media and posts uploaded media payload', async ({ page, baseURL }) => {
    await mockHomePlayerModules(page);
    await page.goto(appUrl(baseURL, '/home?section=feed&social=create&type=team_media'), { waitUntil: 'domcontentloaded' });

    const dialog = page.getByRole('dialog', { name: 'Create social post' });
    await expect(dialog.getByRole('heading', { name: 'What happened?' })).toBeVisible();
    await expect(dialog.getByText('Photo or video').first()).toBeVisible();
    await expect(dialog.getByText('Choose photo or video')).toBeVisible();
    await expect(dialog.getByText('Post type')).toHaveCount(0);
    await expect(dialog.getByText('Title')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(dialog.getByText('Add a photo or video for this share.')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__socialPosts.length)).toBe(0);

    await dialog.locator('input[type="file"]').setInputFiles({
        name: 'team-photo.png',
        mimeType: 'image/png',
        buffer: Buffer.from('image-bytes')
    });
    await expect(dialog.getByText('team-photo.png').first()).toBeVisible();
    await dialog.getByRole('button', { name: 'Post', exact: true }).click();

    await expect(page.getByText('Posted to your ALL PLAYS feed.')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__socialUploads[0])).toEqual({
        teamId: 'team-1',
        name: 'team-photo.png',
        type: 'image/png'
    });
    await expect.poll(() => page.evaluate(() => window.__socialPosts[0]?.input)).toEqual(expect.objectContaining({
        type: 'team_media',
        visibility: 'friends_and_team',
        title: 'Bears team photo',
        teamId: 'team-1',
        playerIds: [],
        media: [{ type: 'image', url: 'https://img.example.test/social.png', name: 'team-photo.png', thumbnailUrl: null }]
    }));
});

test('my teams opens from Home data with selected team, player, and chat routes', async ({ page, baseURL }) => {
    await mockHomePlayerModules(page);
    await page.goto(appUrl(baseURL, '/teams?selectedTeamId=team-1&from=home'), { waitUntil: 'domcontentloaded' });

    await waitForTeamsRoute(page, page.getByRole('heading', { name: '1 team ready' }));
    await expect(page.getByText('Choose a team')).toBeVisible();
    await expect(page.getByRole('link', { name: /Chat/ })).toHaveAttribute('href', '#/messages/team-1');
    await expect(page.getByText('Team navigation')).toBeVisible();
    await expect.poll(async () => {
        const launcherTop = await page.getByText('Choose a team').boundingBox();
        const navTop = await page.getByText('Team navigation').boundingBox();
        return Math.round((launcherTop?.y || 0) - (navTop?.y || 0));
    }).toBeLessThan(0);
    await expect(page.locator('a[href="#/schedule?teamId=team-1"]').first()).toBeVisible();
    await expect(page.locator('a[href="#/schedule?teamId=team-1&view=packets"]')).toBeVisible();
    await expect(page.locator('a[href="#/teams/team-1"]').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Website team page/ })).toHaveAttribute('href', 'https://allplays.ai/team.html#teamId=team-1');
    await expect(page.getByRole('link', { name: /Media/ })).toHaveAttribute('href', '#/teams/team-1/media');
    await expect(page.locator('a[href="#/players/team-1/player-1"]').first()).toBeVisible();
    await expect(page.locator('a[href="#/players/team-1/player-1"]').filter({ hasText: 'Pat Star' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open Bears' }).first()).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await page.locator('a[href="#/teams/team-1"]').first().click();
    await expect(async () => {
        await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 1000 });
        await expect(page.getByText('Loading team')).toHaveCount(0, { timeout: 1000 });
        await expect(page.getByRole('heading', { name: 'Bears' })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30000 });
    await expect(page.locator('img[src="https://img.example.test/bears.png"]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Roster' })).toBeVisible();
    await page.getByRole('button', { name: 'Roster' }).click();
    await expect(page.locator('img[src="https://img.example.test/player.png"]').first()).toBeVisible();
    await expect(page.getByText('Yours')).toBeVisible();
});

test.describe('desktop Home workspace', () => {
    test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false });

    test('keeps the browser Home layout compact while preserving sections', async ({ page, baseURL }) => {
        await mockHomePlayerModules(page);
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

        await waitForHomeRoute(page, page.getByRole('heading', { name: 'Today for your players' }));
        await expect(page.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByRole('button', { name: 'Feed' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Players' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Teams' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Friends' })).toBeVisible();
        await expect.poll(async () => {
            const box = await page.locator('.home-hero').boundingBox();
            return Math.round(box?.height || 0);
        }).toBeLessThan(170);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
});
