import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

function appUrl(baseURL, hashPath) {
    const appBaseURL = process.env.SMOKE_APP_BASE_URL || baseURL;
    const url = new URL('/', appBaseURL);
    url.hash = hashPath;
    return url.toString();
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
                        roles: ['parent'],
                        parentOf: [
                            { teamId: 'team-1', playerId: 'player-1', playerName: 'Pat Star', teamName: 'Bears' }
                        ]
                    };
                    return {
                        user,
                        profile: { parentOf: user.parentOf },
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
                        fees: [],
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

                export async function updateParentPlayerEditableProfile() {}
                export async function savePlayerCustomRosterFieldValues() {}
                export async function saveStaffPlayerRosterDetails() { return { updatedFields: [] }; }
                export async function sendParentCoParentInvite() { return { code: 'ABC12345' }; }
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

                export async function loadParentTeamDetail() {
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
    await expect(page.getByRole('button', { name: /Bears/ }).first()).toHaveAttribute('aria-pressed', 'true');
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
