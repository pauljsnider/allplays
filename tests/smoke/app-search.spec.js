import { expect, test } from '@playwright/test';
import { buildUrl } from './helpers/boot-path.js';

const appBaseUrl = process.env.SMOKE_APP_BASE_URL || '';
test.skip(!appBaseUrl, 'SMOKE_APP_BASE_URL is required for React app smoke tests');

function appUrl(baseURL, hashPath) {
    const url = new URL(buildUrl(appBaseUrl || baseURL, '/'));
    url.hash = hashPath;
    return url.toString();
}

async function gotoAppRoute(page, baseURL, hashPath) {
    await page.goto(appUrl(baseURL, hashPath), { waitUntil: 'domcontentloaded' });
}

async function waitForAppShell(page) {
    await expect(async () => {
        await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 3000 });
    }).toPass({ timeout: 45000 });
}

async function waitForSearchTrigger(page) {
    const trigger = page.getByTestId('app-shell-search-trigger').first();

    await expect(async () => {
        await waitForAppShell(page);
        await expect(trigger).toBeVisible({ timeout: 3000 });
        await expect(trigger).toBeEnabled({ timeout: 3000 });
    }).toPass({ timeout: 45000 });

    return trigger;
}

async function clickSearchTrigger(page) {
    const trigger = await waitForSearchTrigger(page);
    await trigger.click();
}

async function openSearch(page) {
    const searchDialog = page.getByRole('dialog', { name: 'Search teams, players, actions, and help' });

    await expect(async () => {
        if (await searchDialog.isVisible().catch(() => false)) {
            return;
        }

        await clickSearchTrigger(page);

        try {
            await expect(searchDialog).toBeVisible({ timeout: 3000 });
        } catch {
            await page.keyboard.press('Control+K');
            await expect(searchDialog).toBeVisible({ timeout: 3000 });
        }
    }).toPass({ timeout: 45000 });
}

async function openDesktopSearch(page) {
    const searchDialog = page.getByRole('dialog', { name: 'Search teams, players, actions, and help' });

    await expect(async () => {
        if (await searchDialog.isVisible().catch(() => false)) {
            return;
        }

        await waitForAppShell(page);
        await page.keyboard.press('Control+K');

        try {
            await expect(searchDialog).toBeVisible({ timeout: 3000 });
        } catch {
            const trigger = page.getByTestId('app-shell-search-trigger').first();
            if (!await trigger.isVisible().catch(() => false)) {
                await page.reload({ waitUntil: 'domcontentloaded' });
                throw new Error('Search trigger was not ready; reloaded app shell');
            }
            await expect(trigger).toBeVisible({ timeout: 3000 });
            await trigger.click();
            await expect(searchDialog).toBeVisible({ timeout: 3000 });
        }
    }).toPass({ timeout: 45000 });
}

async function mockSearchModules(page) {
    await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.__openedPublicUrls = [];
        window.__teamSearchQueries = [];
        window.__loadAppSearchTeamsCalls = 0;
        window.__playerSearchQueries = [];
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
                        parentOf: [{ teamId: 'team-2', teamName: 'Rockets', sport: 'Soccer', zip: '64114', playerId: 'player-1' }]
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

    await page.route(/\/src\/lib\/searchService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function getKnownAppSearchTeams(user) {
                    return (user?.parentOf || []).map((team) => ({
                        id: team.teamId,
                        name: team.teamName || team.name || 'Team',
                        sport: team.sport,
                        zip: team.zip,
                        fromAppAccess: true
                    }));
                }

                export async function loadAppSearchTeams(user) {
                    window.__loadAppSearchTeamsCalls += 1;
                    return getKnownAppSearchTeams(user);
                }

                export function getImmediateAppTeamSearchResults(queryText, appAccessTeams = []) {
                    const q = String(queryText || '').trim().toLowerCase();
                    if (q.length < 2) return appAccessTeams.slice(0, 20);
                    return appAccessTeams.filter((team) => {
                        const haystack = [team.name, team.sport, team.zip].filter(Boolean).join(' ').toLowerCase();
                        return haystack.includes(q);
                    }).slice(0, 20);
                }

                export async function searchAppTeams(queryText, appAccessTeams = []) {
                    window.__teamSearchQueries.push(String(queryText || ''));
                    const q = String(queryText || '').trim().toLowerCase();
                    const publicTeams = q.includes('bea') ? [
                        { id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210', isPublic: true }
                    ] : [];
                    return [...appAccessTeams, ...publicTeams].filter((team) => {
                        const haystack = [team.name, team.sport, team.zip].filter(Boolean).join(' ').toLowerCase();
                        return haystack.includes(q);
                    }).slice(0, 20);
                }

                export async function searchAppPlayers(queryText) {
                    window.__playerSearchQueries.push(queryText);
                    const q = String(queryText || '').trim().toLowerCase();
                    if (q.length < 2) return [];
                    if (q.includes('error')) {
                        const error = new Error('permission denied');
                        error.code = 'permission-denied';
                        throw error;
                    }
                    if (q.includes('zzz')) return [];
                    return [
                        {
                            id: 'player:team-1:player-1',
                            kind: 'player',
                            title: '#9 Pat Star',
                            subtitle: 'Bears',
                            route: '/players/team-1/player-1',
                            teamId: 'team-1',
                            playerId: 'player-1'
                        }
                    ];
                }

                export function getCachedAppPlayerSearchResults() {
                    return null;
                }

                export function hasSatisfiedAppPlayerSearchResultBudget() {
                    return false;
                }

                export function computeAppSearchResults({ queryText, auth, teams, players, helpRoleFilter = 'all' }) {
                    const q = String(queryText || '').trim().toLowerCase();
                    const actions = [
                        { id: 'browse-teams', kind: 'action', title: 'Browse Teams', subtitle: 'Explore public teams on ALL PLAYS', route: '/teams/browse' },
                        { id: 'dashboard', kind: 'action', title: 'Dashboard', subtitle: 'Go to your ALL PLAYS home', route: '/home' },
                        { id: 'my-teams', kind: 'action', title: 'My Teams', subtitle: 'Open your team hubs', route: '/teams' },
                        { id: 'schedule', kind: 'action', title: 'Schedule', subtitle: 'Games, practices, availability, rides, and packets', route: '/schedule' },
                        { id: 'messages', kind: 'action', title: 'Messages', subtitle: 'Team chat and staff threads', route: '/messages' },
                        { id: 'profile', kind: 'action', title: 'Profile', subtitle: 'Account settings and notifications', route: '/profile' }
                    ];
                    const teamItems = teams.map((team) => ({
                        id: 'team:' + team.id,
                        kind: 'team',
                        title: team.name,
                        subtitle: [team.sport, team.zip].filter(Boolean).join(' • '),
                        route: '/teams/' + encodeURIComponent(team.id)
                    }));
                    const matches = (item) => !q || (item.title + ' ' + item.subtitle).toLowerCase().includes(q);
                    const helpItems = q.includes('live') || q.includes('tracker') ? [
                        {
                            id: 'help:live-tracker-coach-guide',
                            kind: 'help',
                            title: 'Track Live Games with the Live Tracker',
                            subtitle: 'Coaches and admins can run live tracker game flows.',
                            route: '/help/live-tracker-coach-guide',
                            href: 'https://allplays.ai/help-live-tracker.html',
                            roles: ['coach', 'admin'],
                            snippet: 'Coaches and admins can run live tracker game flows.'
                        },
                        {
                            id: 'help:watch-live-games',
                            kind: 'help',
                            title: 'Watch Live Games and Replays',
                            subtitle: 'Parents and members can watch live game feeds.',
                            route: '/help/watch-live-games',
                            href: 'https://allplays.ai/help-watch-chat.html',
                            roles: ['parent', 'member'],
                            snippet: 'Parents and members can watch live game feeds.'
                        }
                    ] : [];
                    const roleMatches = (item) => helpRoleFilter === 'all' || item.roles.includes('all') || item.roles.includes(helpRoleFilter);
                    const matchedActions = actions.filter(matches);
                    const matchedTeams = teamItems.filter(matches);
                    const matchedHelp = helpItems.filter(roleMatches);
                    const matchedPlayers = players.filter(matches);
                    return {
                        actions: matchedActions,
                        teams: matchedTeams,
                        help: matchedHelp,
                        players: matchedPlayers,
                        flat: [...matchedActions, ...matchedTeams, ...matchedHelp, ...matchedPlayers]
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
                    return { leaderboards: [], trackingSummaries: [] };
                }

                export async function loadTeamDetailSponsors() {
                    return { sponsors: [] };
                }

                export function buildPublicTeamGamesIcsUrl(teamId) {
                    return teamId ? 'https://calendar.example.test/publicTeamGamesIcs?teamId=' + encodeURIComponent(teamId) : '';
                }

                export function canExposePublicFanFeed(team = {}, events = []) {
                    return (events || []).some((event) => event?.type === 'game');
                }

                export async function loadRosterFieldDefinitionsForApp() {
                    return [];
                }

                export async function loadParentTeamDetailBootstrap(teamId) {
                    return loadParentTeamDetail(teamId);
                }

                export async function loadParentTeamDetail(teamId) {
                    const isRockets = teamId === 'team-2';
                    return {
                        team: {
                            id: teamId,
                            name: isRockets ? 'Rockets' : 'Bears',
                            sport: isRockets ? 'Soccer' : 'Basketball',
                            photoUrl: null,
                            description: 'Parent-facing team page',
                            zip: isRockets ? '64114' : '66210',
                            leagueUrl: null,
                            bracketUrl: null,
                            streamUrl: null,
                            websiteUrl: 'https://allplays.ai/team.html#teamId=' + encodeURIComponent(teamId),
                            mediaUrl: 'https://allplays.ai/team-media.html#teamId=' + encodeURIComponent(teamId),
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

                export async function reactivateRosterPlayerForApp() {}
            `
        });
    });
}

test.describe('app global search', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('mobile search finds actions, teams, and players without overflowing', async ({ page, baseURL }) => {
        await mockSearchModules(page);
        await gotoAppRoute(page, baseURL, '/home');

        await openSearch(page);
        await expect.poll(async () => {
            const box = await page.getByTestId('app-search-panel').boundingBox();
            return Math.round(box?.y || 0);
        }).toBeGreaterThanOrEqual(16);
        await expect.poll(async () => {
            const box = await page.getByTestId('app-search-panel').boundingBox();
            return Math.round((box?.y || 0) + (box?.height || 0));
        }).toBeLessThanOrEqual(844);
        await expect(page.getByText('Browse Teams')).toBeVisible();
        await expect(page.getByText('Rockets')).toBeVisible();
        await expect(page.getByText('Bears')).toBeHidden();
        await expect(page.getByText('Type at least 2 characters to search players')).toBeVisible();

        await page.getByLabel('Search teams, players, actions, help').fill('bea');
        await expect(page.getByRole('button', { name: /Bears Basketball/ })).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__teamSearchQueries)).toEqual(['bea']);

        await page.getByLabel('Search teams, players, actions, help').fill('pat');
        await expect(page.getByText('#9 Pat Star')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__playerSearchQueries)).toEqual(['bea', 'pat']);
        await page.getByRole('button', { name: /#9 Pat Star/ }).click();
        await expect(page).toHaveURL(/#\/players\/team-1\/player-1$/);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });

    test('mobile search handles short queries, no results, errors, and dismiss actions', async ({ page, baseURL }) => {
        await mockSearchModules(page);
        await gotoAppRoute(page, baseURL, '/home');

        await openSearch(page);
        await page.getByLabel('Search teams, players, actions, help').fill('p');
        await expect(page.getByText('Type at least 2 characters to search players')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__playerSearchQueries)).toEqual([]);

        await page.getByLabel('Search teams, players, actions, help').fill('zzzz');
        await expect(page.getByText('No matching teams')).toBeVisible();
        await expect(page.getByText('No matching players')).toBeVisible();
        await expect(page.getByText('No results')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__playerSearchQueries)).toEqual(['zzzz']);

        await page.getByLabel('Search teams, players, actions, help').fill('error');
        await expect(page.getByText('Player search unavailable for this account.')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__playerSearchQueries)).toEqual(['zzzz', 'error']);

        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeHidden();

        await openSearch(page);
        await page.getByRole('button', { name: 'Close search' }).click();
        await expect(page.getByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeHidden();
    });
});

test.describe('desktop app global search', () => {
    test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false });

    test('desktop search supports native navigation and website actions', async ({ page, baseURL }) => {
        await mockSearchModules(page);
        await gotoAppRoute(page, baseURL, '/home');

        await openDesktopSearch(page);
        await page.getByLabel('Search teams, players, actions, help').fill('rock');
        await expect(page.getByRole('button', { name: /Rockets/ })).toBeVisible();
        await page.getByRole('button', { name: /Rockets/ }).click();
        await expect(async () => {
            await expect(page).toHaveURL(/#\/teams\/team-2$/, { timeout: 1000 });
            await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 1000 });
            await expect(page.getByText('Loading team')).toHaveCount(0, { timeout: 1000 });
            await expect(page.getByRole('heading', { name: 'Rockets' })).toBeVisible({ timeout: 1000 });
        }).toPass({ timeout: 30000 });

        await openDesktopSearch(page);
        await page.getByRole('button', { name: /Browse Teams/ }).click();
        await expect(page).toHaveURL(/#\/teams\/browse$/, { timeout: 1000 });
        await expect.poll(() => page.evaluate(() => window.__openedPublicUrls)).toEqual([]);
    });

    test('desktop search shows signed-in role help results without role filter controls', async ({ page, baseURL }) => {
        await mockSearchModules(page);
        await gotoAppRoute(page, baseURL, '/home');

        await openDesktopSearch(page);
        await page.getByLabel('Search teams, players, actions, help').fill('live tracker');
        await expect(page.getByRole('button', { name: /Watch Live Games and Replays/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Track Live Games with the Live Tracker/ })).toHaveCount(0);
        await expect(page.getByRole('button', { name: /More help results/ })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Coach', exact: true })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Member', exact: true })).toHaveCount(0);
    });

    test('desktop search supports typed keyboard navigation from the dialog', async ({ page, baseURL }) => {
        await mockSearchModules(page);
        await gotoAppRoute(page, baseURL, '/home');

        await openDesktopSearch(page);
        await page.getByLabel('Search teams, players, actions, help').fill('my');
        await expect(page.getByRole('button', { name: /My Teams/ })).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#\/teams$/);

        await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Home' }).click();
        await expect(page).toHaveURL(/#\/home$/);

        await openDesktopSearch(page);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#\/teams$/);
    });
});
