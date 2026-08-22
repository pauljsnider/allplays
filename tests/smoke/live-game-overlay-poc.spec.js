import { expect, test } from '@playwright/test';

function collectPageErrors(page) {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message || String(error)));
    return errors;
}

async function stubYouTubeEmbed(page) {
    const requests = { count: 0 };
    await page.route('https://www.youtube.com/embed/**', (route) => {
        requests.count += 1;
        return route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><title>Overlay video fixture</title><body style="background:#05090d"></body>'
        });
    });
    return requests;
}

test('interactive overlay demo keeps the video primary while live moments update the broadcast UI', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubYouTubeEmbed(page);
    await page.goto(`${baseURL}/live-game-overlay-poc.html?demo=1&videoId=PK1HyC37doc`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#live-status')).toHaveText('LIVE');
    expect(pageErrors).toEqual([]);

    await expect(page.locator('#overlay-video')).toHaveAttribute('src', 'https://www.youtube.com/embed/PK1HyC37doc?autoplay=1&mute=1&playsinline=1');
    await expect(page.locator('#home-team-name')).toHaveText('Vipers');
    await expect(page.locator('#away-team-name')).toContainText('Union KC');
    await expect(page.locator('#home-score')).toHaveText('2');
    await expect(page.locator('#event-list .event-card')).toHaveCount(4);

    await page.locator('#demo-lab-toggle').click();
    await page.locator('[data-action="home-goal"]').click();
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#event-list .event-card').first()).toContainText('Kurtz bends it inside the far post');
    await expect(page.locator('#hero-event')).toHaveAttribute('data-tone', 'home-score');

    await page.locator('#demo-lab-close').click();
    await page.locator('#focus-toggle').click();
    await expect(page.locator('body')).toHaveAttribute('data-focus', 'true');
    await expect(page.locator('#score-bug')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
});

test('mobile overlay turns edge context into one-at-a-time bottom sheets without horizontal overflow', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await stubYouTubeEmbed(page);
    await page.goto(`${baseURL}/live-game-overlay-poc.html?demo=1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#score-bug')).toBeVisible();
    expect(pageErrors).toEqual([]);

    await expect(page.locator('#plays-panel')).toBeHidden();
    await expect(page.locator('#insights-panel')).toBeHidden();
    await page.locator('[data-panel="plays"]').click();
    await expect(page.locator('#plays-panel')).toBeVisible();
    await expect(page.locator('#insights-panel')).toBeHidden();

    await page.locator('[data-panel="chat"]').click();
    await expect(page.locator('#plays-panel')).toBeHidden();
    await expect(page.locator('#insights-panel')).toBeVisible();
    await expect(page.locator('#chat-view')).toBeVisible();
    await expect(page.locator('#lineup-view')).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
});

test('real mode uses the same overlay renderer for game, event, and chat subscriptions', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.route(/\/js\/db\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            const team = { id: 'team-1', name: 'Current Academy' };
            const game = {
                id: 'game-1', opponent: 'Sporting Blue', homeScore: 3, awayScore: 2,
                period: 'H2', liveClockMs: 720000, liveStatus: 'live', viewerCount: 19,
                videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
                liveLineup: { onCourt: ['p9'], bench: ['p4'] }
            };
            export async function getGameDayTeamContext() { return team; }
            export async function getGame() { return game; }
            export async function getPlayers() { return [
                { id: 'p9', name: 'Avery Lane', number: '9', position: 'F' },
                { id: 'p4', name: 'Sam Gray', number: '4', position: 'D' }
            ]; }
            export function subscribeGame(_teamId, _gameId, callback) {
                window.__OVERLAY_GAME_CALLBACK__ = callback;
                return () => {};
            }
            export function subscribeLiveEvents(_teamId, _gameId, callback) {
                window.__OVERLAY_EVENT_CALLBACK__ = callback;
                callback([]);
                return () => {};
            }
            export function subscribeLiveChat(_teamId, _gameId, _options, callback) {
                window.__OVERLAY_CHAT_CALLBACK__ = callback;
                callback([]);
                return () => {};
            }
        `
    }));
    await page.route(/\/js\/live-game-video\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `export function resolveReplayVideoOptions() {
            return {
                mode: 'embed', hasVideo: true,
                sourceUrl: 'https://www.youtube.com/embed/PK1HyC37doc?autoplay=1&mute=1',
                publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc'
            };
        }`
    }));
    const embedRequests = await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay-poc.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-team-name')).toHaveText('Current Academy');
    expect(pageErrors).toEqual([]);
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#on-field-list')).toContainText('Avery Lane');
    await expect.poll(() => embedRequests.count).toBe(1);

    await page.evaluate(() => window.__OVERLAY_GAME_CALLBACK__({
        id: 'game-1', opponent: 'Sporting Blue', homeScore: 3, awayScore: 2,
        period: 'H2', liveClockMs: 710000, liveStatus: 'live', viewerCount: 20,
        videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        liveLineup: { onCourt: ['p9'], bench: ['p4'] }
    }));
    await expect(page.locator('#viewer-count')).toHaveText('20 watching');
    await expect.poll(() => embedRequests.count).toBe(1);

    await page.evaluate(() => window.__OVERLAY_EVENT_CALLBACK__([{
        id: 'live-goal',
        type: 'goal',
        description: 'Lane scores in transition',
        playerId: 'p9',
        playerName: 'Avery Lane',
        playerNumber: '9',
        statKey: 'goals',
        value: 1,
        homeScore: 4,
        awayScore: 2,
        period: 'H2',
        gameClockMs: 690000,
        createdAt: Date.now()
    }]));
    await expect(page.locator('#home-score')).toHaveText('4');
    await expect(page.locator('#event-list').first()).toContainText('Lane scores in transition');

    await page.evaluate(() => window.__OVERLAY_CHAT_CALLBACK__([{
        id: 'chat-1', senderName: 'Taylor', text: 'What a finish!', createdAt: Date.now()
    }]));
    await page.locator('#chat-tab').click();
    await expect(page.locator('#chat-list')).toContainText('What a finish!');
    expect(pageErrors).toEqual([]);
});
