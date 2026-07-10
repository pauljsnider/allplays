import { expect, test } from '@playwright/test';
import { assertPageBootsWithoutFatalErrors } from './helpers/boot-path.js';

async function installHomepageModuleMocks(page) {
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/js/auth.js')) {
            await route.fulfill({
                contentType: 'application/javascript',
                body: `
                    export function checkAuth(callback) { callback(null); }
                    export function getRedirectUrl() { return 'dashboard.html'; }
                `
            });
            return;
        }

        if (url.pathname.endsWith('/js/utils.js')) {
            await route.fulfill({
                contentType: 'application/javascript',
                body: `
                    function toDate(value) { return value?.toDate ? value.toDate() : new Date(value); }
                    export function renderHeader(container) { if (container) container.textContent = 'guest'; }
                    export function formatDate(value) { return toDate(value).toLocaleDateString('en-US', { timeZone: 'UTC' }); }
                    export function formatTime(value) { return toDate(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }); }
                `
            });
            return;
        }

        if (url.pathname.endsWith('/js/db.js')) {
            await route.fulfill({
                contentType: 'application/javascript',
                body: `
                    function timestamp(isoValue) {
                        return { toDate() { return new Date(isoValue); } };
                    }
                    export async function getLiveGamesNow() {
                        return [{
                            id: 'smoke-live-1',
                            teamId: 'smoke-team-live',
                            opponent: 'Falcons',
                            date: timestamp('2026-04-10T23:00:00.000Z'),
                            homeScore: 21,
                            awayScore: 17,
                            liveViewerCount: 3,
                            liveStatus: 'live',
                            team: { id: 'smoke-team-live', name: 'Smoke Tigers', photoUrl: '' }
                        }];
                    }
                    export async function getUpcomingLiveGames() {
                        return [{
                            id: 'smoke-upcoming-1',
                            teamId: 'smoke-team-upcoming',
                            opponent: 'Owls',
                            date: timestamp('2026-04-11T20:30:00.000Z'),
                            status: 'scheduled',
                            liveStatus: 'scheduled',
                            team: { id: 'smoke-team-upcoming', name: 'Smoke Panthers', photoUrl: '' }
                        }];
                    }
                    export async function getRecentLiveTrackedGames() {
                        return [{
                            id: 'smoke-replay-1',
                            teamId: 'smoke-team-replay',
                            opponent: 'Bears',
                            date: timestamp('2026-04-09T01:15:00.000Z'),
                            homeScore: 44,
                            awayScore: 41,
                            liveStatus: 'completed',
                            team: { id: 'smoke-team-replay', name: 'Smoke Wolves', photoUrl: '' }
                        }];
                    }
                `
            });
            return;
        }

        await route.continue();
    });
}

async function assertResolvedDiscoverySection(page, selector, { emptyText, linkPattern, ctaPattern }) {
    const section = page.locator(selector);
    await expect(section).not.toContainText(/Loading (games|replays)\.\.\./, { timeout: 15000 });
    await expect(section).not.toContainText(/Unable to load/i);

    const cards = section.locator('a[href^="live-game.html?teamId="]');
    if (await cards.count()) {
        const firstCard = cards.first();
        await expect(firstCard).toHaveAttribute('href', linkPattern);
        await expect(firstCard).toContainText(ctaPattern);
        return;
    }

    await expect(section).toHaveText(emptyText);
}

test('homepage resolves live/upcoming and replay discovery cards', async ({ page, baseURL }) => {
    await installHomepageModuleMocks(page);

    await assertPageBootsWithoutFatalErrors(page, {
        baseURL,
        path: '/',
        titlePatterns: [/ALL PLAYS/i],
        readySelectors: ['#live-games-list', '#past-games-list']
    });

    await assertResolvedDiscoverySection(page, '#live-games-list', {
        emptyText: 'No upcoming live games scheduled',
        linkPattern: /^live-game\.html\?teamId=[^&]+&gameId=[^&]+$/,
        ctaPattern: /Watch Now|View Details/
    });
    await expect(page.locator('#live-games-list')).toContainText('Smoke Tigers');
    await expect(page.locator('#live-games-list')).toContainText('Smoke Panthers');
    await expect(page.locator('#live-games-list a[href="live-game.html?teamId=smoke-team-live&gameId=smoke-live-1"]')).toHaveCount(1);
    await expect(page.locator('#live-games-list a[href="live-game.html?teamId=smoke-team-upcoming&gameId=smoke-upcoming-1"]')).toHaveCount(1);

    await assertResolvedDiscoverySection(page, '#past-games-list', {
        emptyText: 'No recent replays available',
        linkPattern: /^live-game\.html\?teamId=[^&]+&gameId=[^&]+&replay=true$/,
        ctaPattern: /Watch Replay/
    });
    await expect(page.locator('#past-games-list')).toContainText('Smoke Wolves');
    await expect(page.locator('#past-games-list a[href="live-game.html?teamId=smoke-team-replay&gameId=smoke-replay-1&replay=true"]')).toHaveCount(1);
});
