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

async function stubRealOverlayModules(page) {
    await page.route(/\/js\/db\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            const team = { id: 'team-1', name: 'Current Academy' };
            const game = {
                id: 'game-1', opponent: 'Sporting Blue', homeScore: 3, awayScore: 2,
                period: 'H2', liveClockMs: 720000, liveStatus: 'live', viewerCount: 4, liveViewerCount: 19,
                videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
                isPublicProjection: true,
                liveLineup: { onCourt: ['p9'], bench: ['p4'] },
                liveStats: { p9: { goals: 5 } },
                opponentStats: { away8: { name: 'Jordan Vale', goals: 1 } }
            };
            export async function getGameDayTeamContext() { return team; }
            export async function getGame() { return game; }
            export async function getPlayers() { return [
                { id: 'p9', name: 'Avery Lane', number: '9', position: 'F' },
                { id: 'p4', name: 'Sam Gray', number: '4', position: 'D' }
            ]; }
            export function subscribeGame(_teamId, _gameId, callback, onError, options) {
                window.__OVERLAY_LIVE_SUBSCRIPTIONS__ = (window.__OVERLAY_LIVE_SUBSCRIPTIONS__ || 0) + 1;
                window.__OVERLAY_GAME_CALLBACK__ = callback;
                window.__OVERLAY_GAME_ERROR__ = onError;
                window.__OVERLAY_GAME_OPTIONS__ = options;
                return () => {};
            }
            export function subscribeLiveEvents(_teamId, _gameId, callback, onError) {
                window.__OVERLAY_LIVE_SUBSCRIPTIONS__ = (window.__OVERLAY_LIVE_SUBSCRIPTIONS__ || 0) + 1;
                window.__OVERLAY_EVENT_CALLBACK__ = callback;
                window.__OVERLAY_EVENT_ERROR__ = onError;
                callback([]);
                return () => {};
            }
            export function subscribeLiveChat(_teamId, _gameId, _options, callback, onError) {
                window.__OVERLAY_LIVE_SUBSCRIPTIONS__ = (window.__OVERLAY_LIVE_SUBSCRIPTIONS__ || 0) + 1;
                window.__OVERLAY_CHAT_CALLBACK__ = callback;
                window.__OVERLAY_CHAT_ERROR__ = onError;
                callback([]);
                return () => {};
            }
            export function subscribeReactions(_teamId, _gameId, callback, onError) {
                window.__OVERLAY_LIVE_SUBSCRIPTIONS__ = (window.__OVERLAY_LIVE_SUBSCRIPTIONS__ || 0) + 1;
                window.__OVERLAY_REACTION_CALLBACK__ = callback;
                window.__OVERLAY_REACTION_ERROR__ = onError;
                return () => {};
            }
            export async function getLiveEvents() { return [
                { id: 'replay-start', type: 'clock_sync', homeScore: 0, awayScore: 0, period: 'H1', gameClockMs: 0, createdAt: 100 },
                { id: 'replay-goal', type: 'goal', description: 'Lane scores the replay winner', playerId: 'p9', playerName: 'Avery Lane', statKey: 'goals', value: 1, homeScore: 3, awayScore: 2, period: 'H2', gameClockMs: 690000, createdAt: 200 }
            ]; }
            export async function getLiveChatHistory() { return [
                { id: 'replay-chat', senderName: 'Taylor', text: 'Saved replay message', createdAt: 300 }
            ]; }
        `
    }));
    await page.route(/\/js\/live-game-video\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `export function resolveReplayVideoOptions() {
            if (window.__OVERLAY_THROW_VIDEO__) throw new Error('provider refresh failed');
            return {
                mode: 'embed', hasVideo: true,
                sourceUrl: 'https://www.youtube.com/embed/PK1HyC37doc?autoplay=1&mute=1',
                publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc'
            };
        }`
    }));
}

test('real mode follows canonical game, lineup, clock, reset, reaction, and passive video-failure behavior', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await stubRealOverlayModules(page);
    const embedRequests = await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay-poc.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-team-name')).toHaveText('Current Academy');
    expect(pageErrors).toEqual([]);
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#viewer-count')).toHaveText('19 watching');
    await expect(page.locator('#on-field-list')).toContainText('Avery Lane');
    expect(await page.evaluate(() => window.__OVERLAY_GAME_OPTIONS__)).toEqual({ publicProjection: true });
    await expect.poll(() => embedRequests.count).toBe(1);

    await page.evaluate(() => window.__OVERLAY_GAME_CALLBACK__({
        id: 'game-1', opponent: 'Sporting Blue', homeScore: 3, awayScore: 2,
        period: 'H2', liveClockMs: 710000, liveStatus: 'live', liveViewerCount: 20,
        videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        liveLineup: { onCourt: ['p9'], bench: ['p4'] }
    }));
    await expect(page.locator('#viewer-count')).toHaveText('20 watching');
    await expect.poll(() => embedRequests.count).toBe(1);

    await page.evaluate(() => {
        window.__OVERLAY_THROW_VIDEO__ = true;
        window.__OVERLAY_GAME_CALLBACK__({
            id: 'game-1', opponent: 'Sporting Blue', homeScore: 3, awayScore: 2,
            period: 'H2', liveClockMs: 705000, liveStatus: 'live', liveViewerCount: 21,
            videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
            liveLineup: { onCourt: ['p9'], bench: ['p4'] }
        });
    });
    await expect(page.locator('#viewer-count')).toHaveText('21 watching');
    await expect(page.locator('#overlay-video')).toHaveAttribute('src', 'https://www.youtube.com/embed/PK1HyC37doc?autoplay=1&mute=1');
    await expect(page.locator('#connection-message')).toContainText('Video refresh is delayed');
    await page.evaluate(() => { window.__OVERLAY_THROW_VIDEO__ = false; });

    const liveSnapshot = [
        { id: 'lineup-1', type: 'lineup', onCourt: ['p4'], bench: ['p9'], createdAt: 1000 },
        { id: 'clock-1', type: 'clock_sync', homeScore: 3, awayScore: 2, period: 'H2', gameClockMs: 700000, createdAt: 1100 },
        {
            id: 'live-goal', type: 'goal', description: 'Lane scores in transition',
            playerId: 'p9', playerName: 'Avery Lane', playerNumber: '9', statKey: 'goals', value: 1,
            homeScore: 4, awayScore: 2, period: 'H2', gameClockMs: 690000, createdAt: 1200
        }
    ];
    await page.evaluate((events) => window.__OVERLAY_EVENT_CALLBACK__(events), liveSnapshot);
    await expect(page.locator('#home-score')).toHaveText('4');
    await expect(page.locator('#game-clock')).toHaveText('11:30');
    await expect(page.locator('#on-field-list')).toContainText('Sam Gray');
    await expect(page.locator('#bench-list')).toContainText('Avery Lane');
    await expect(page.locator('#event-list .event-card')).toHaveCount(1);
    await expect(page.locator('#event-list')).toContainText('Lane scores in transition');
    await page.locator('#leaders-tab').click();
    await expect(page.locator('#leader-list')).toContainText('1 GOALS');
    await page.evaluate((events) => window.__OVERLAY_EVENT_CALLBACK__(events), liveSnapshot);
    await expect(page.locator('#event-list .event-card')).toHaveCount(1);

    const reactionText = await page.evaluate(() => {
        window.__OVERLAY_REACTION_CALLBACK__({ id: 'reaction-1', type: 'heart' });
        return document.querySelector('#reactions-overlay .floating-reaction')?.textContent;
    });
    expect(reactionText).toBe('❤️');

    await page.evaluate(() => window.__OVERLAY_CHAT_CALLBACK__([{
        id: 'chat-1', senderName: 'Taylor', text: 'What a finish!', createdAt: Date.now()
    }]));
    await page.locator('#chat-tab').click();
    await expect(page.locator('#chat-list')).toContainText('What a finish!');

    await page.evaluate(() => window.__OVERLAY_EVENT_CALLBACK__([{
        id: 'reset-1', type: 'reset', description: 'Game reset', homeScore: 0, awayScore: 0,
        period: 'H1', gameClockMs: 0, onCourt: ['p9'], bench: ['p4'], createdAt: 2000
    }]));
    await expect(page.locator('#home-score')).toHaveText('0');
    await expect(page.locator('#away-score')).toHaveText('0');
    await expect(page.locator('#event-list .event-card')).toHaveCount(0);

    await page.evaluate(() => window.__OVERLAY_EVENT_CALLBACK__([{
        id: 'stale-goal', type: 'goal', description: 'Old goal must stay hidden', homeScore: 9, awayScore: 0,
        period: 'H1', gameClockMs: 1000, createdAt: 1500
    }]));
    await expect(page.locator('#home-score')).toHaveText('0');
    await expect(page.locator('#event-list')).not.toContainText('Old goal must stay hidden');
    expect(pageErrors).toEqual([]);
});

test('replay mode loads saved events and chat without starting live subscriptions', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay-poc.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#live-status')).toHaveText('REPLAY');
    expect(pageErrors).toEqual([]);
    await expect(page.locator('#event-list')).toContainText('Lane scores the replay winner');
    await expect(page.locator('#home-score')).toHaveText('3');
    await page.locator('#chat-tab').click();
    await expect(page.locator('#chat-list')).toContainText('Saved replay message');
    expect(await page.evaluate(() => window.__OVERLAY_LIVE_SUBSCRIPTIONS__ || 0)).toBe(0);
    expect(pageErrors).toEqual([]);
});
