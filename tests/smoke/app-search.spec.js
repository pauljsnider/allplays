import { expect, test } from '@playwright/test';

function appUrl(baseURL, hashPath) {
    const appBaseURL = process.env.SMOKE_APP_BASE_URL || baseURL;
    const url = new URL('/', appBaseURL);
    url.hash = hashPath;
    return url.toString();
}

async function openSearch(page) {
    const searchButton = page.getByRole('button', { name: 'Search' });
    await expect(searchButton).toBeVisible();
    await searchButton.click();
    await expect(page.getByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeVisible();
}

async function openDesktopSearch(page) {
    const searchButton = page.getByRole('button', { name: 'Search' });
    await expect(searchButton).toBeVisible();
    await searchButton.click();
    await expect(page.getByRole('dialog', { name: 'Search teams, players, actions, and help' })).toBeVisible();
}

async function mockSearchModules(page) {
    await page.addInitScript(() => {
        window.__openedPublicUrls = [];
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
                        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
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
                export async function loadAppSearchTeams() {
                    return [
                        { id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210', isPublic: true },
                        { id: 'team-2', name: 'Rockets', sport: 'Soccer', zip: '64114', fromAppAccess: true }
                    ];
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

                export function computeAppSearchResults({ queryText, auth, teams, players, helpRoleFilter = 'all' }) {
                    const q = String(queryText || '').trim().toLowerCase();
                    const actions = [
                        { id: 'browse-teams', kind: 'action', title: 'Browse Teams', subtitle: 'Explore public teams on ALL PLAYS', href: 'https://allplays.ai/teams.html' },
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
}

test.describe('app global search', () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

    test('mobile search finds actions, teams, and players without overflowing', async ({ page, baseURL }) => {
        await mockSearchModules(page);
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

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
        await expect(page.getByText('Bears')).toBeVisible();
        await expect(page.getByText('Type at least 2 characters to search players')).toBeVisible();

        await page.getByLabel('Search teams, players, actions, help').fill('pat');
        await expect(page.getByText('#9 Pat Star')).toBeVisible();
        await expect.poll(() => page.evaluate(() => window.__playerSearchQueries)).toEqual(['pat']);
        await page.getByRole('button', { name: /#9 Pat Star/ }).click();
        await expect(page).toHaveURL(/#\/players\/team-1\/player-1$/);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    });

    test('mobile search handles short queries, no results, errors, and dismiss actions', async ({ page, baseURL }) => {
        await mockSearchModules(page);
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

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
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

        await openDesktopSearch(page);
        await page.getByLabel('Search teams, players, actions, help').fill('rock');
        await expect(page.getByRole('button', { name: /Rockets/ })).toBeVisible();
        await page.getByRole('button', { name: /Rockets/ }).click();
        await expect(page).toHaveURL(/#\/teams\/team-2$/);

        await openDesktopSearch(page);
        await page.getByRole('button', { name: /Browse Teams/ }).click();
        await expect.poll(() => page.evaluate(() => window.__openedPublicUrls)).toEqual(['https://allplays.ai/teams.html']);
    });

    test('desktop search filters help results by selected role', async ({ page, baseURL }) => {
        await mockSearchModules(page);
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

        await openDesktopSearch(page);
        await page.getByLabel('Search teams, players, actions, help').fill('live tracker');
        await expect(page.getByRole('button', { name: /Track Live Games with the Live Tracker/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Watch Live Games and Replays/ })).toBeVisible();

        await page.getByRole('button', { name: 'Coach', exact: true }).click();
        await expect(page.getByRole('button', { name: /Track Live Games with the Live Tracker/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Watch Live Games and Replays/ })).toBeHidden();

        await page.getByRole('button', { name: 'Member', exact: true }).click();
        await expect(page.getByRole('button', { name: /Watch Live Games and Replays/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /Track Live Games with the Live Tracker/ })).toBeHidden();
    });

    test('desktop search supports typed keyboard navigation from the dialog', async ({ page, baseURL }) => {
        await mockSearchModules(page);
        await page.goto(appUrl(baseURL, '/home'), { waitUntil: 'domcontentloaded' });

        await openDesktopSearch(page);
        await page.getByLabel('Search teams, players, actions, help').fill('my');
        await expect(page.getByRole('button', { name: /My Teams/ })).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#\/teams$/);

        await openDesktopSearch(page);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/#\/teams$/);
    });
});
