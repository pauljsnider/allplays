import { test, expect } from '@playwright/test';

import { buildUrl } from './helpers/boot-path.js';

const FIXED_NOW = '2026-07-07T12:00:00.000Z';

const games = [
    {
        id: 'old-final',
        opponent: 'Old Final',
        date: '2026-06-29T12:00:00.000Z',
        liveStatus: 'completed',
        homeScore: 10,
        awayScore: 8
    },
    {
        id: 'practice',
        opponent: 'Practice',
        type: 'practice',
        date: '2026-07-07T13:00:00.000Z'
    },
    {
        id: 'cancelled',
        opponent: 'Cancelled',
        status: 'canceled',
        date: '2026-07-07T14:00:00.000Z'
    },
    {
        id: 'upcoming-late',
        opponent: 'Late Upcoming',
        date: '2026-07-08T18:00:00.000Z',
        location: 'North Field'
    },
    {
        id: 'final-game',
        opponent: 'Home Rival',
        date: '2026-07-06T18:00:00.000Z',
        liveStatus: 'completed',
        isHome: false,
        homeScore: 71,
        awayScore: 68
    },
    {
        id: 'live-game',
        opponent: 'Live Opponent',
        date: '2026-07-07T11:00:00.000Z',
        liveStatus: 'live',
        isHome: true,
        homeScore: 21,
        awayScore: 19
    },
    {
        id: 'upcoming-soon',
        opponent: 'Soon Upcoming',
        date: '2026-07-07T13:00:00.000Z'
    }
];

async function installWidgetMocks(page) {
    const dbModule = `
        const team = { id: 'team-1', name: 'Bears & Wolves' };
        const games = ${JSON.stringify(games)};

        function clone(value) {
            return JSON.parse(JSON.stringify(value));
        }

        export async function getTeam(teamId) {
            return teamId === 'team-1' ? clone(team) : null;
        }

        export async function getGames(teamId) {
            return teamId === 'team-1' ? clone(games) : [];
        }
    `;

    await page.addInitScript((isoNow) => {
        const fixedNow = new Date(isoNow).valueOf();
        const RealDate = Date;

        class FixedDate extends RealDate {
            constructor(...args) {
                super(...(args.length ? args : [fixedNow]));
            }

            static now() {
                return fixedNow;
            }
        }

        FixedDate.UTC = RealDate.UTC;
        FixedDate.parse = RealDate.parse;
        window.Date = FixedDate;
    }, FIXED_NOW);

    await page.route('https://cdn.tailwindcss.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            window.tailwind = window.tailwind || {};
            const style = document.createElement('style');
            style.textContent = '.hidden { display: none !important; }';
            document.head.appendChild(style);
        `
    }));

    await page.route(/\/js\/telemetry\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
    }));

    await page.route(/\/js\/db\.js(?:\?v=\d+)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: dbModule
    }));
}

test.describe('public scoreboard widget embed', () => {
    test('renders browser-loaded scores, filters schedule, and exposes encoded links', async ({ page, baseURL }) => {
        await installWidgetMocks(page);

        await page.goto(buildUrl(baseURL, '/widget-scoreboard.html?teamId=team-1'), {
            waitUntil: 'domcontentloaded'
        });

        await expect(page.locator('#widget-team-name')).toHaveText('Bears & Wolves');
        await expect(page.locator('#widget-team-link')).toBeVisible();
        await expect(page.locator('#widget-team-link')).toHaveAttribute('href', 'team.html?teamId=team-1');

        await expect(page.locator('#widget-games article')).toHaveCount(4);
        await expect(page.locator('#widget-games h2')).toHaveText([
            'vs. Live Opponent',
            'vs. Soon Upcoming',
            'vs. Late Upcoming',
            'vs. Home Rival'
        ]);

        await expect(page.locator('#widget-games')).not.toContainText('Practice');
        await expect(page.locator('#widget-games')).not.toContainText('Cancelled');
        await expect(page.locator('#widget-games')).not.toContainText('Old Final');

        const detailLinks = page.locator('#widget-games article a');
        await expect(detailLinks.nth(0)).toBeVisible();
        await expect(detailLinks.nth(0)).toHaveAttribute('href', 'live-game.html?teamId=team-1&gameId=live-game');
        await expect(detailLinks.nth(3)).toBeVisible();
        await expect(detailLinks.nth(3)).toHaveAttribute('href', 'game.html?teamId=team-1&gameId=final-game');

        await expect(page.locator('#widget-games article').nth(3)).toContainText('68 - 71');
        await expect(page.locator('#widget-games article').nth(3)).toContainText('team - opponent');
        await expect(page.locator('#widget-games article').nth(3)).not.toContainText('71 - 68');
    });

    test('shows the missing-teamId empty state without loading data modules', async ({ page, baseURL }) => {
        await installWidgetMocks(page);

        await page.goto(buildUrl(baseURL, '/widget-scoreboard.html'), {
            waitUntil: 'domcontentloaded'
        });

        await expect(page.locator('#widget-team-name')).toHaveText('Missing team');
        await expect(page.locator('#widget-games')).toContainText('Add a teamId to the widget URL.');
        await expect(page.locator('#widget-games article')).toHaveCount(0);
        await expect(page.locator('#widget-team-link')).toBeHidden();
    });
});
