import { expect, test } from '@playwright/test';

function appUrl(baseURL, hashPath) {
    const defaultBaseURL = 'http://localhost:3000/'; // A safe default for local testing
    const appBaseURL = process.env.SMOKE_APP_BASE_URL || baseURL || defaultBaseURL;
    const url = new URL('/', appBaseURL);
    url.hash = hashPath;
    return url.toString();
}

async function waitForTeamsRoute(page, readyLocator) {
    const searchInput = page.getByPlaceholder('Search teams or players');
    await expect(async () => {
        await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
        await expect(page.getByText('Loading teams')).toHaveCount(0, { timeout: 3000 });
        await expect(searchInput).toBeVisible({ timeout: 3000 });
        if (readyLocator) {
            await expect(readyLocator).toBeVisible({ timeout: 3000 });
        }
    }).toPass({ timeout: 45000 });
}

async function waitForTeamDetailRoute(page, teamName) {
    await expect(async () => {
        await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
        await expect(page.getByText('Loading team')).toHaveCount(0, { timeout: 3000 });
        await expect(page.getByRole('heading', { name: teamName })).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 45000 });
}

async function mockTeamsModules(page, { scenario = '' } = {}) {
    await page.addInitScript(({ scenarioName }) => {
        window.__openedPublicUrls = [];
        window.__homeLoads = 0;
        window.__teamsScenario = scenarioName;
    }, { scenarioName: scenario });

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
                        roles: ['parent', 'coach'],
                        parentOf: [
                            { teamId: 'team-1', playerId: 'player-1', playerName: 'Pat Star', teamName: 'Bears' },
                            { teamId: 'team-1', playerId: 'player-2', playerName: 'Sam Wing', teamName: 'Bears' },
                            { teamId: 'team-single', playerId: 'player-9', playerName: 'Riley Guard', teamName: 'Rockets' }
                        ]
                    };
                    return {
                        user,
                        profile: { parentOf: user.parentOf },
                        loading: false,
                        error: null,
                        roles: user.roles,
                        isParent: true,
                        isCoach: true,
                        isAdmin: false,
                        isPlatformAdmin: false,
                        refresh: async () => {},
                        signOut: async () => {}
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
                export async function openPublicUrl(url) {
                    window.__openedPublicUrls.push(String(url));
                }
                export async function copyPublicText() {
                    return 'copied';
                }
                export async function sharePublicUrl() {
                    return 'shared';
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
                        teamId: overrides.teamId || 'team-1',
                        teamName: overrides.teamName || 'Bears',
                        type: overrides.type || 'game',
                        date: overrides.date || new Date('2100-06-01T18:00:00Z'),
                        location: overrides.location || 'Main Gym',
                        opponent: overrides.opponent || 'Falcons',
                        title: overrides.title || null,
                        childId: overrides.childId || 'player-1',
                        childName: overrides.childName || 'Pat Star',
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

                export async function loadParentTeamsSummary(...args) {
                    return loadParentHome(...args);
                }

                export async function loadParentHomeWithSecondaryData(...args) {
                    return loadParentHome(...args);
                }

                export async function loadParentHome() {
                    window.__homeLoads += 1;
                    if (window.__teamsScenario === 'error') {
                        throw new Error('Team service down');
                    }
                    if (window.__teamsScenario === 'empty') {
                        return {
                            players: [],
                            teams: [],
                            upcomingEvents: [],
                            actionItems: [],
                            fees: [],
                            metrics: { players: 0, teams: 0, rsvpNeeded: 0, unreadMessages: 0, packetsReady: 0 }
                        };
                    }
                    const bearsNext = event();
                    const rocketsNext = event({
                        eventKey: 'team-single::game-next::player-9',
                        id: 'rocket-game',
                        teamId: 'team-single',
                        teamName: 'Rockets',
                        childId: 'player-9',
                        childName: 'Riley Guard',
                        opponent: 'Comets',
                        date: new Date('2100-06-02T19:00:00Z')
                    });
                    return {
                        players: [],
                        teams: [
                            {
                                teamId: 'team-1',
                                teamName: 'Bears',
                                role: 'Parent',
                                sport: 'Basketball',
                                photoUrl: 'https://img.example.test/bears.png',
                                players: [
                                    { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star' },
                                    { teamId: 'team-1', teamName: 'Bears', playerId: 'player-2', playerName: 'Sam Wing' }
                                ],
                                nextEvent: bearsNext,
                                eventCount: 5,
                                unreadCount: 12,
                                openActions: 2
                            },
                            {
                                teamId: 'team-staff',
                                teamName: 'Staff Wolves',
                                role: 'Coach',
                                sport: 'Soccer',
                                photoUrl: 'https://img.example.test/wolves.png',
                                players: [],
                                nextEvent: null,
                                eventCount: 0,
                                unreadCount: 3,
                                openActions: 0
                            },
                            {
                                teamId: 'team-single',
                                teamName: 'Rockets',
                                role: 'Parent',
                                sport: 'Basketball',
                                photoUrl: '',
                                players: [{ teamId: 'team-single', teamName: 'Rockets', playerId: 'player-9', playerName: 'Riley Guard' }],
                                nextEvent: rocketsNext,
                                eventCount: 1,
                                unreadCount: 0,
                                openActions: 0
                            }
                        ],
                        upcomingEvents: [bearsNext, rocketsNext],
                        actionItems: [],
                        fees: [],
                        metrics: { players: 3, teams: 3, rsvpNeeded: 2, unreadMessages: 15, packetsReady: 0 }
                    };
                }
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

                export async function deactivateRosterPlayerForApp() {}

                export async function grantScorekeeperAccessForApp() {
                    return { success: true };
                }

                export async function revokeScorekeeperAccessForApp() {
                    return { success: true };
                }

                export async function grantVideographerAccessForApp() {
                    return { success: true };
                }

                export async function revokeVideographerAccessForApp() {
                    return { success: true };
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

                export async function loadTeamStaffPermissions() {
                    return null;
                }

                export async function loadTeamRosterParentInvites() {
                    return [];
                }

                export async function loadTeamDetailInsights(teamId) {
                    if (teamId === 'team-empty') {
                        return { leaderboards: [], trackingSummaries: [] };
                    }
                    return {
                        leaderboards: [{ id: 'pts', label: 'Points', leaders: [{ playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9', photoUrl: 'https://img.example.test/player.png', rank: 1, formattedValue: '88' }] }],
                        trackingSummaries: [{ playerId: 'player-1', playerName: 'Pat Star', photoUrl: 'https://img.example.test/player.png', items: [
                            { id: 'item-1', title: 'Bring ball', description: 'For warmups', isComplete: true },
                            { id: 'item-2', title: 'Upload waiver', description: '', isComplete: false }
                        ] }]
                    };
                }

                export async function loadTeamDetailSponsors(teamId) {
                    if (teamId === 'team-empty') {
                        return { sponsors: [] };
                    }
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

                export async function loadParentTeamDetail(teamId) {
                    if (teamId === 'team-empty') {
                        return {
                            team: {
                                id: 'team-empty',
                                name: 'Empty Team',
                                sport: 'Soccer',
                                photoUrl: null,
                                description: '',
                                zip: '',
                                leagueUrl: null,
                                bracketUrl: null,
                                streamUrl: null,
                                websiteUrl: 'https://allplays.ai/team.html#teamId=team-empty',
                                mediaUrl: 'https://allplays.ai/team-media.html#teamId=team-empty',
                                registrationProvider: []
                            },
                            players: [],
                            linkedPlayers: [],
                            upcomingEvents: [],
                            recentResults: [],
                            nextEvent: null,
                            record: { label: '2100', wins: 0, losses: 0, ties: 0, gamesPlayed: 0, winPercentage: null },
                            standings: { enabled: false, label: 'No standings configured', rows: [], currentRow: null },
                            leaderboards: [],
                            trackingSummaries: [],
                            sponsors: [],
                            counts: { games: 0, practices: 0, completedGames: 0 }
                        };
                    }
                    const nextDate = new Date('2100-06-01T18:00:00Z');
                    const resultDate = new Date('2026-05-01T18:00:00Z');
                    return {
                        team: {
                            id: 'team-1',
                            name: 'Bears',
                            sport: 'Basketball',
                            photoUrl: 'https://img.example.test/bears.png',
                            description: 'Parent-facing team page',
                            zip: '66210',
                            leagueUrl: 'https://league.example.test/standings',
                            bracketUrl: 'https://bracket.example.test/official',
                            streamUrl: 'https://youtube.example.test/watch',
                            websiteUrl: 'https://allplays.ai/team.html#teamId=team-1',
                            mediaUrl: 'https://allplays.ai/team-media.html#teamId=team-1',
                            registrationProvider: [{ label: 'Provider', value: 'Sports Connect' }]
                        },
                        players: [
                            { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: 'https://img.example.test/player.png', position: 'Guard', isLinked: true },
                            { id: 'player-2', name: 'Sam Wing', number: '12', photoUrl: null, position: 'Forward', isLinked: false }
                        ],
                        linkedPlayers: [
                            { id: 'player-1', name: 'Pat Star', number: '9', photoUrl: 'https://img.example.test/player.png', position: 'Guard', isLinked: true }
                        ],
                        upcomingEvents: [
                            { id: 'game-next', type: 'game', title: 'vs. Falcons', date: nextDate, location: 'Main Gym', opponent: 'Falcons', status: '', homeScore: null, awayScore: null, isCancelled: false }
                        ],
                        recentResults: [
                            { id: 'game-final', type: 'game', title: 'vs. Wolves', date: resultDate, location: 'Main Gym', opponent: 'Wolves', status: 'completed', homeScore: 42, awayScore: 35, isCancelled: false }
                        ],
                        nextEvent: { id: 'game-next', type: 'game', title: 'vs. Falcons', date: nextDate, location: 'Main Gym', opponent: 'Falcons', status: '', homeScore: null, awayScore: null, isCancelled: false },
                        record: { label: '2100', wins: 4, losses: 2, ties: 0, gamesPlayed: 6, winPercentage: 66.7 },
                        standings: { enabled: true, label: 'Points table', rows: [{ team: 'Bears', rank: 1, record: '4-2', pf: 180, pa: 150 }], currentRow: { team: 'Bears', rank: 1, record: '4-2', pf: 180, pa: 150 } },
                        leaderboards: [{ id: 'pts', label: 'Points', leaders: [{ playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9', photoUrl: 'https://img.example.test/player.png', rank: 1, formattedValue: '88' }] }],
                        trackingSummaries: [{ playerId: 'player-1', playerName: 'Pat Star', photoUrl: 'https://img.example.test/player.png', items: [
                            { id: 'item-1', title: 'Bring ball', description: 'For warmups', isComplete: true },
                            { id: 'item-2', title: 'Upload waiver', description: '', isComplete: false }
                        ] }],
                        sponsors: [{ id: 'sponsor-1', name: 'Pizza Place', description: 'After the game', imageUrl: 'https://img.example.test/pizza.png', websiteUrl: 'https://pizza.example.test' }],
                        counts: { games: 8, practices: 3, completedGames: 6 }
                    };
                }

                export async function reactivateRosterPlayerForApp() {}
            `
        });
    });
}

test.describe('mobile My Teams', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('selects parent and staff teams, keeps tools compact, and opens website resources through the adapter', async ({ page, baseURL }) => {
        await mockTeamsModules(page);
        await page.goto(appUrl(baseURL, '/teams?selectedTeamId=team-staff&from=home'), { waitUntil: 'domcontentloaded' });

        const teamsReadyHeading = page.getByRole('heading', { name: '3 teams ready' });
        await waitForTeamsRoute(page, teamsReadyHeading);
        await expect(teamsReadyHeading).toBeVisible();
        await expect(page.getByText('Choose a team')).toBeVisible();
        await expect(page.getByPlaceholder('Search teams or players')).toBeVisible();
        await page.getByPlaceholder('Search teams or players').fill('Riley');
        await expect(page.getByRole('button', { name: /Rockets/ }).first()).toBeVisible();
        await expect(page.getByRole('button', { name: /Staff Wolves/ })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /Bears/ })).toHaveCount(0);
        await page.getByPlaceholder('Search teams or players').fill('zzz');
        await expect(page.getByText('No teams match that search.')).toBeVisible();
        await page.getByPlaceholder('Search teams or players').fill('Staff Wolves');
        await expect(page.getByRole('button', { name: /Staff Wolves/ }).first()).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('a[aria-label="Staff Wolves messages"]')).toBeVisible();
        await expect(page.locator('a[aria-label="Staff Wolves schedule"]')).toHaveCount(0);
        await expect(page.getByText('No player is linked to this account for the team, but team chat is available.')).toBeVisible();
        await expect(page.getByText('Coach/admin tools')).toBeVisible();
        await expect(page.getByText('Team drills')).toHaveCount(0);

        await page.getByRole('button', { name: '6 more' }).click();
        await expect(page.getByText('Team drills')).toBeVisible();
        await expect(page.getByRole('link', { name: /Game day/ })).toHaveAttribute('href', 'https://allplays.ai/game-day.html?teamId=team-staff');

        await page.getByRole('link', { name: /Website team page/ }).click();
        await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://allplays.ai/team.html#teamId=team-staff');
        await expect(page).toHaveURL(/#\/teams/);

        await page.getByPlaceholder('Search teams or players').fill('Bears');
        await page.getByRole('button', { name: /Bears/ }).first().click();
        await expect(page.getByRole('button', { name: /Bears/ }).first()).toHaveAttribute('aria-pressed', 'true');
        await expect(page.getByText('Pat Star, Sam Wing')).toBeVisible();
        await expect(page.getByText('Coach/admin tools')).toHaveCount(0);
        await expect(page.getByRole('link', { name: /Team drills/ })).toHaveCount(0);
        await expect(page.locator('a[aria-label="Bears messages"]')).toBeVisible();
        await expect(page.locator('a[aria-label="Bears messages"]')).toContainText('9+');
        await expect(page.locator('a[href="#/schedule?teamId=team-1&view=packets"]')).toBeVisible();
        await expect(page.getByRole('link', { name: /Players/ })).toHaveAttribute('href', 'https://allplays.ai/team.html#teamId=team-1');
        await expect(page.locator('a[href="#/players/team-1/player-1"]')).toBeVisible();
        await expect(page.locator('a[href="#/players/team-1/player-2"]')).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });

    test('renders empty and error states with recovery links instead of spinners', async ({ page, baseURL }) => {
        await mockTeamsModules(page, { scenario: 'empty' });
        await page.goto(appUrl(baseURL, '/teams?scenario=empty'), { waitUntil: 'domcontentloaded' });

        await expect(page.getByRole('heading', { name: 'No teams linked yet' })).toBeVisible();
        await expect(page.getByText('No teams available')).toBeVisible();
        await expect(page.getByRole('link', { name: 'Accept invite' })).toHaveAttribute('href', '#/accept-invite');
        await page.locator('a[href="https://allplays.ai/teams.html"]').click();
        await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://allplays.ai/teams.html');
        await expect(page.getByText('Loading teams')).toHaveCount(0);
    });

    test('shows load failures without trapping the user in loading state', async ({ page, baseURL }) => {
        await mockTeamsModules(page, { scenario: 'error' });
        await page.goto(appUrl(baseURL, '/teams?scenario=error'), { waitUntil: 'domcontentloaded' });

        await expect(page.getByText('Team service down')).toBeVisible();
        await expect(page.getByText('No teams available')).toBeVisible();
        await expect(page.getByText('Loading teams')).toHaveCount(0);
    });

    test('team detail tabs expose parent-facing team page features', async ({ page, baseURL }) => {
        await mockTeamsModules(page);
        await page.goto(appUrl(baseURL, '/teams/team-1'), { waitUntil: 'domcontentloaded' });

        await waitForTeamDetailRoute(page, 'Bears');
        await expect(page.getByText('4-2').first()).toBeVisible();
        await expect(page.getByText('Parent actions')).toBeVisible();
        await expect(page.locator('a[href="#/schedule?teamId=team-1&filter=availability"]')).toBeVisible();
        await page.getByRole('button', { name: 'Open website team page' }).click();
        await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://allplays.ai/team.html#teamId=team-1');

        await page.getByRole('button', { name: /Schedule/ }).click();
        await expect(page.getByText('vs. Falcons')).toBeVisible();
        await expect(page.getByText('vs. Wolves')).toBeVisible();
        await expect(page.getByText('42-35')).toBeVisible();
        await expect(page.locator('a[href="#/schedule/team-1/game-next"]')).toBeVisible();

        await page.getByRole('button', { name: /Roster/ }).click();
        await expect(page.getByText('#9 Pat Star')).toBeVisible();
        await expect(page.getByText('Yours')).toBeVisible();
        await expect(page.locator('a[href="#/players/team-1/player-1"]')).toBeVisible();

        await page.getByRole('button', { name: /Insights/ }).click();
        await expect(page.getByText('Bring ball')).toBeVisible();
        await expect(page.getByText('Upload waiver')).toBeVisible();
        await expect(page.getByText('Done')).toBeVisible();
        await expect(page.getByText('Open')).toBeVisible();
        await expect(page.getByText('Points')).toBeVisible();
        await expect(page.getByText('88')).toBeVisible();

        await page.getByRole('button', { name: /More/ }).click();
        await expect(page.getByText('Website team page')).toBeVisible();
        await expect(page.getByText('Media albums')).toBeVisible();
        await expect(page.getByText('Watch stream')).toBeVisible();
        await expect(page.getByText('Tournament bracket')).toBeVisible();
        await expect(page.getByText('Open official bracket.')).toBeVisible();
        await expect(page.getByText('League page')).toBeVisible();
        await expect(page.getByText('Sports Connect')).toBeVisible();
        await expect(page.getByText('Pizza Place')).toBeVisible();
        await page.getByRole('link', { name: /Watch stream/ }).click();
        await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://youtube.example.test/watch');
        await page.getByRole('link', { name: /Tournament bracket/ }).click();
        await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://bracket.example.test/official');
        await page.getByRole('link', { name: /Pizza Place/ }).click();
        await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://pizza.example.test');
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });

    test('team detail empty tabs are useful and navigable', async ({ page, baseURL }) => {
        await mockTeamsModules(page);
        await page.goto(appUrl(baseURL, '/teams/team-empty'), { waitUntil: 'domcontentloaded' });

        await waitForTeamDetailRoute(page, /Empty Team/i);
        await expect(page.getByText('No completed games yet')).toBeVisible();
        await expect(page.getByText('Schedule is clear for now')).toBeVisible();

        await page.getByRole('button', { name: /Schedule/ }).click();
        await expect(page.getByText('No team events found.')).toBeVisible();
        await page.getByRole('button', { name: /Roster/ }).click();
        await expect(page.getByText('No players have been added yet.')).toBeVisible();
        await page.getByRole('button', { name: /Insights/ }).click();
        await expect(page.getByText('No parent-visible tracking items for your players yet.')).toBeVisible();
        await expect(page.getByText('Leaderboards appear after public stat configs and completed tracked games exist.')).toBeVisible();
        await page.getByRole('button', { name: /More/ }).click();
        await expect(page.getByText('Team links')).toBeVisible();
        await expect(page.getByText('Tournament bracket')).toHaveCount(0);
        await expect(page.getByText('Loading team')).toHaveCount(0);
    });
});

test.describe('desktop My Teams', () => {
    test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false });

    test('keeps the browser My Teams workspace dense while preserving launcher and hub navigation', async ({ page, baseURL }) => {
        await mockTeamsModules(page);
        await page.goto(appUrl(baseURL, '/teams?selectedTeamId=team-1'), { waitUntil: 'domcontentloaded' });

        const readyHeading = page.getByRole('heading', { name: /\d+ teams? ready|\d+ Teams?/i });
        await waitForTeamsRoute(page, readyHeading);
        await expect(page.getByText('Select a team, or jump straight to chat and schedule.')).toBeVisible();
        await expect(page.getByPlaceholder('Search teams or players')).toBeVisible();
        await expect(page.getByText('Team navigation')).toBeVisible();
        await expect(page.locator('.teams-header')).toBeVisible();
        await expect.poll(async () => {
            const box = await page.locator('.teams-header').boundingBox();
            return Math.round(box?.height || 0);
        }).toBeLessThan(155);
        await expect.poll(async () => {
            const rail = await page.locator('.teams-team-rail').boundingBox();
            const panel = await page.locator('.teams-selected-panel').boundingBox();
            return Math.round((panel?.x || 0) - (rail?.x || 0));
        }).toBeGreaterThan(360);
        await page.getByPlaceholder('Search teams or players').fill('Rockets');
        await expect(page.getByRole('button', { name: /Rockets/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Bears/ })).toHaveCount(0);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });
});
