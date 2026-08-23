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
            body: `<!doctype html><title>Overlay video fixture</title><body style="background:#05090d">
                <script>addEventListener('message', (event) => parent.postMessage({ source: 'overlay-youtube-fixture', payload: event.data }, '*'));</script>
            </body>`
        });
    });
    return requests;
}

function rectanglesOverlap(left, right) {
    return Boolean(left && right &&
        left.left < right.right && left.right > right.left &&
        left.top < right.bottom && left.bottom > right.top);
}

async function getResponsiveLayout(page) {
    return page.evaluate(() => {
        const getRectangle = (selector) => {
            const element = document.querySelector(selector);
            if (!element || element.hidden) return null;
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return null;
            const rectangle = element.getBoundingClientRect();
            return {
                left: rectangle.left,
                right: rectangle.right,
                top: rectangle.top,
                bottom: rectangle.bottom,
                width: rectangle.width,
                height: rectangle.height
            };
        };
        const visible = (element) => {
            const style = getComputedStyle(element);
            const rectangle = element.getBoundingClientRect();
            return !element.hidden && style.display !== 'none' && style.visibility !== 'hidden' &&
                rectangle.width > 0 && rectangle.height > 0;
        };
        const touchTargets = [...document.querySelectorAll('button, a[href], input[type="range"]')]
            .filter(visible)
            .map((element) => {
                const rectangle = element.getBoundingClientRect();
                return {
                    label: element.getAttribute('aria-label') || element.textContent.trim(),
                    width: rectangle.width,
                    height: rectangle.height
                };
            });

        return {
            viewport: { width: window.innerWidth, height: window.innerHeight },
            documentWidth: document.documentElement.scrollWidth,
            panelLayout: document.body.dataset.panelLayout,
            panelOpen: document.body.dataset.panelOpen,
            topbar: getRectangle('.broadcast-topbar'),
            score: getRectangle('#score-bug'),
            replay: getRectangle('#replay-controls'),
            plays: getRectangle('#plays-panel'),
            insights: getRectangle('#insights-panel'),
            dock: getRectangle('.panel-dock'),
            video: getRectangle('.video-layer'),
            touchTargets,
            teamBounds: [...document.querySelectorAll('.score-team')].map((team) => {
                const teamRectangle = team.getBoundingClientRect();
                const nameRectangle = team.querySelector('.team-name').getBoundingClientRect();
                return { team: { left: teamRectangle.left, right: teamRectangle.right }, name: { left: nameRectangle.left, right: nameRectangle.right } };
            })
        };
    });
}

function expectLayoutInsideViewport(layout) {
    expect(layout.documentWidth, 'page must not overflow horizontally').toBeLessThanOrEqual(layout.viewport.width);
    for (const [name, rectangle] of Object.entries({
        topbar: layout.topbar,
        score: layout.score,
        replay: layout.replay,
        plays: layout.plays,
        insights: layout.insights,
        dock: layout.dock,
        video: layout.video
    })) {
        if (!rectangle) continue;
        expect(rectangle.left, `${name} left edge`).toBeGreaterThanOrEqual(-0.5);
        expect(rectangle.right, `${name} right edge`).toBeLessThanOrEqual(layout.viewport.width + 0.5);
        expect(rectangle.top, `${name} top edge`).toBeGreaterThanOrEqual(-0.5);
        expect(rectangle.bottom, `${name} bottom edge`).toBeLessThanOrEqual(layout.viewport.height + 0.5);
    }
    layout.touchTargets.forEach((target) => {
        expect(target.width, `${target.label} touch-target width`).toBeGreaterThanOrEqual(44);
        expect(target.height, `${target.label} touch-target height`).toBeGreaterThanOrEqual(44);
    });
    layout.teamBounds.forEach(({ team, name }) => {
        expect(name.left, 'team name left edge').toBeGreaterThanOrEqual(team.left - 0.5);
        expect(name.right, 'team name right edge').toBeLessThanOrEqual(team.right + 0.5);
    });
}

test('interactive overlay demo keeps the video primary while live moments update the broadcast UI', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubYouTubeEmbed(page);
    await page.goto(`${baseURL}/live-game-overlay.html?demo=1&videoId=PK1HyC37doc`, { waitUntil: 'domcontentloaded' });
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
    await page.goto(`${baseURL}/live-game-overlay.html?demo=1`, { waitUntil: 'domcontentloaded' });
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

const responsiveViewports = [
    { name: 'iPhone SE', width: 320, height: 568 },
    { name: 'iPhone 14', width: 390, height: 844 },
    { name: 'Pixel 7', width: 412, height: 915 },
    { name: 'phone landscape', width: 844, height: 390 },
    { name: 'iPad Mini', width: 768, height: 1024 },
    { name: 'iPad Pro portrait', width: 1024, height: 1366 },
    { name: 'iPad landscape', width: 1180, height: 820 },
    { name: 'laptop', width: 1280, height: 720 },
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'Full HD', width: 1920, height: 1080 },
    { name: 'ultrawide', width: 2560, height: 1080 }
];

for (const viewport of responsiveViewports) {
    test(`live and replay overlays remain usable at ${viewport.name} ${viewport.width}x${viewport.height}`, async ({ page, baseURL }) => {
        const pageErrors = collectPageErrors(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await stubYouTubeEmbed(page);

        for (const replay of [false, true]) {
            const suffix = replay ? '&replay=true' : '';
            await page.goto(`${baseURL}/live-game-overlay.html?demo=1&videoId=PK1HyC37doc${suffix}`, { waitUntil: 'domcontentloaded' });
            await expect(page.locator('#live-status')).toHaveText(replay ? 'REPLAY' : 'LIVE');
            expect(pageErrors).toEqual([]);

            if (replay) {
                await page.getByRole('button', { name: 'Pause replay' }).click();
            }

            const initialLayout = await getResponsiveLayout(page);
            expectLayoutInsideViewport(initialLayout);
            expect(rectanglesOverlap(initialLayout.score, initialLayout.replay), 'score must not overlap replay controls').toBe(false);

            if (initialLayout.panelLayout === 'compact') {
                await expect(page.locator('#plays-panel')).toBeHidden();
                await expect(page.locator('#insights-panel')).toBeHidden();
                await page.locator('[data-panel="chat"]').click();
                await expect(page.locator('#insights-panel')).toBeVisible();
                await expect(page.locator('body')).toHaveAttribute('data-panel-open', 'true');

                const openLayout = await getResponsiveLayout(page);
                expectLayoutInsideViewport(openLayout);
                expect(rectanglesOverlap(openLayout.insights, openLayout.score), 'open panel must not overlap score').toBe(false);
                expect(rectanglesOverlap(openLayout.insights, openLayout.replay), 'open panel must not overlap replay controls').toBe(false);
                expect(rectanglesOverlap(openLayout.insights, openLayout.dock), 'open panel must not overlap panel dock').toBe(false);

                await page.keyboard.press('Escape');
                await expect(page.locator('#insights-panel')).toBeHidden();
                await expect(page.locator('body')).toHaveAttribute('data-panel-open', 'false');
                await expect(page.locator('#score-bug')).toBeVisible();
                if (replay) await expect(page.locator('#replay-controls')).toBeVisible();
            } else {
                await expect(page.locator('#plays-panel')).toBeVisible();
                await expect(page.locator('#insights-panel')).toBeVisible();
                expect(rectanglesOverlap(initialLayout.plays, initialLayout.score), 'left panel must not overlap score').toBe(false);
                expect(rectanglesOverlap(initialLayout.insights, initialLayout.score), 'right panel must not overlap score').toBe(false);
                expect(rectanglesOverlap(initialLayout.plays, initialLayout.replay), 'left panel must not overlap replay controls').toBe(false);
                expect(rectanglesOverlap(initialLayout.insights, initialLayout.replay), 'right panel must not overlap replay controls').toBe(false);
            }
            expect(pageErrors).toEqual([]);
        }
    });
}

test('replay panel layout adapts across tablet rotation and desktop resizing', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubYouTubeEmbed(page);
    await page.goto(`${baseURL}/live-game-overlay.html?demo=1&replay=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#live-status')).toHaveText('REPLAY');
    expect(pageErrors).toEqual([]);
    await page.getByRole('button', { name: 'Pause replay' }).click();
    await expect(page.locator('body')).toHaveAttribute('data-panel-layout', 'wide');
    await expect(page.locator('#plays-panel')).toBeVisible();
    await expect(page.locator('#insights-panel')).toBeVisible();

    await page.setViewportSize({ width: 1180, height: 820 });
    await expect(page.locator('body')).toHaveAttribute('data-panel-layout', 'compact');
    await expect(page.locator('#plays-panel')).toBeHidden();
    await expect(page.locator('#insights-panel')).toBeHidden();
    await page.locator('[data-panel="plays"]').click();
    await expect(page.locator('#plays-panel')).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator('body')).toHaveAttribute('data-panel-layout', 'wide');
    await expect(page.locator('body')).toHaveAttribute('data-panel-open', 'false');
    await expect(page.locator('#plays-panel')).toBeVisible();
    await expect(page.locator('#insights-panel')).toBeVisible();
    expectLayoutInsideViewport(await getResponsiveLayout(page));
    expect(pageErrors).toEqual([]);
});

test('former overlay preview URL preserves query parameters on the production-ready route', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await stubYouTubeEmbed(page);
    await page.goto(`${baseURL}/live-game-overlay-poc.html?demo=1&replay=true&videoId=PK1HyC37doc`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/live-game-overlay\.html\?demo=1&replay=true&videoId=PK1HyC37doc$/);
    await expect(page.locator('#live-status')).toHaveText('REPLAY');
    expect(pageErrors).toEqual([]);
});

test('malformed game identifiers fail before any data subscription module loads', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    let databaseRequests = 0;
    await page.route(/\/js\/db\.js(?:\?.*)?$/, (route) => {
        databaseRequests += 1;
        return route.abort();
    });

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=bad%2Fteam&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#video-fallback-copy')).toContainText('valid teamId and gameId');
    await expect(page.locator('#live-status')).toHaveText('UPCOMING');
    expect(databaseRequests).toBe(0);
    expect(pageErrors).toEqual([]);
});

test('local replay demo exposes the complete playback flow without Firebase', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await stubYouTubeEmbed(page);
    await page.goto(`${baseURL}/live-game-overlay.html?demo=1&replay=true&videoId=PK1HyC37doc`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#live-status')).toHaveText('REPLAY');
    await expect(page.locator('#replay-controls')).toBeVisible();
    await expect(page.locator('#replay-duration')).toHaveText('0:15');
    await page.getByRole('button', { name: 'Pause replay' }).click();
    await page.locator('#replay-progress').evaluate((input) => {
        input.value = '100';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#home-score')).toHaveText('2');
    await expect(page.locator('#away-score')).toHaveText('1');
    await expect(page.locator('#event-list')).toContainText('Persell finds the winner');
    await page.locator('[data-panel="chat"]').click();
    await expect(page.locator('#chat-list')).toContainText('Great recovery shape');
    expect(pageErrors).toEqual([]);
});

test('local replay fires the recorded game timeline in order without manual seeking', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await stubYouTubeEmbed(page);
    await page.goto(`${baseURL}/live-game-overlay.html?demo=1&replay=true&videoId=PK1HyC37doc`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#replay-controls')).toBeVisible();
    await page.getByRole('button', { name: 'Pause replay' }).click();
    await page.getByRole('button', { name: '4×' }).click();
    await page.getByRole('button', { name: 'Restart replay' }).click();

    await expect(page.locator('#home-score')).toHaveText('1', { timeout: 2000 });
    await expect(page.locator('#away-score')).toHaveText('0');
    await expect(page.locator('#event-list')).toContainText('Kurtz opens the scoring');
    await expect(page.locator('#reactions-overlay .floating-reaction')).toContainText('👏', { timeout: 1500 });
    await expect(page.locator('#chat-list')).toContainText('What a finish!', { timeout: 1500 });

    await expect(page.locator('#away-score')).toHaveText('1', { timeout: 2500 });
    await expect(page.locator('#event-list')).toContainText('Union KC equalizes');
    await expect(page.locator('#period')).toHaveText('H2');
    await expect(page.locator('#chat-list')).toContainText('Great recovery shape in the second half.', { timeout: 2500 });

    await expect(page.locator('#home-score')).toHaveText('2', { timeout: 2500 });
    await expect(page.locator('#event-list')).toContainText('Persell finds the winner');
    await expect(page.locator('#reactions-overlay .floating-reaction')).toContainText('❤️', { timeout: 1500 });
    await expect(page.locator('#replay-current')).toHaveText('0:15', { timeout: 2500 });
    await expect(page.locator('#game-clock')).toHaveText('0:15');
    expect(pageErrors).toEqual([]);
});

async function stubRealOverlayModules(page) {
    await page.route(/\/(?:js\/db|tests\/manual\/live-game-overlay-production-readonly-adapter)\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            const team = { id: 'team-1', name: 'Current Academy' };
            const game = {
                id: 'game-1', opponent: 'Sporting Blue', homeScore: 3, awayScore: 2,
                homeTeamName: 'Current Academy',
                period: 'H2', liveClockMs: 720000, liveStatus: 'live', viewerCount: 4, liveViewerCount: 19,
                videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
                isPublicProjection: true,
                liveLineup: { onCourt: ['p9'], bench: ['p4'] },
                liveStats: { p9: { goals: 5 } },
                opponentStats: { away8: { name: 'Jordan Vale', goals: 1 } }
            };
            export async function getGameDayTeamContext() {
                if (window.__OVERLAY_DEFER_OPTIONAL_CONTEXT__) return new Promise(() => {});
                return team;
            }
            export async function getGame() { return game; }
            export async function getPlayers() {
                if (window.__OVERLAY_DEFER_OPTIONAL_CONTEXT__) return new Promise(() => {});
                return [
                { id: 'p9', name: 'Avery Lane', number: '9', position: 'F' },
                { id: 'p4', name: 'Sam Gray', number: '4', position: 'D' }
                ];
            }
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
            export async function postLiveChatMessage(teamId, gameId, message) {
                window.__OVERLAY_POSTED_CHAT__ = [...(window.__OVERLAY_POSTED_CHAT__ || []), { teamId, gameId, message }];
                if (window.__OVERLAY_FAIL_CHAT_SEND__) throw new Error('chat write unavailable');
                window.__OVERLAY_CHAT_CALLBACK__?.([{
                    id: 'posted-chat',
                    ...message,
                    createdAt: Date.now()
                }]);
            }
            export function subscribeReactions(_teamId, _gameId, callback, onError) {
                window.__OVERLAY_LIVE_SUBSCRIPTIONS__ = (window.__OVERLAY_LIVE_SUBSCRIPTIONS__ || 0) + 1;
                window.__OVERLAY_REACTION_CALLBACK__ = callback;
                window.__OVERLAY_REACTION_ERROR__ = onError;
                return () => {};
            }
            export async function getLiveEvents() {
                if (window.__OVERLAY_FAIL_REPLAY_EVENTS__) throw new Error('saved events unavailable');
                return [
                { id: 'replay-start', type: 'clock_sync', homeScore: 0, awayScore: 0, period: 'H1', gameClockMs: 0, createdAt: 100000 },
                { id: 'replay-lineup', type: 'lineup', onCourt: ['p4'], bench: ['p9'], period: 'H1', gameClockMs: 300000, createdAt: 400000 },
                { id: 'replay-opener', type: 'goal', description: 'Lane opens the replay scoring', playerId: 'p9', playerName: 'Avery Lane', statKey: 'goals', value: 1, homeScore: 1, awayScore: 0, period: 'H1', gameClockMs: 345000, createdAt: 445000 },
                { id: 'replay-goal', type: 'goal', description: 'Lane scores the replay winner', playerId: 'p9', playerName: 'Avery Lane', statKey: 'goals', value: 1, homeScore: 3, awayScore: 2, period: 'H2', gameClockMs: 690000, createdAt: 790000 }
            ]; }
            export async function getLiveChatHistory() {
                if (window.__OVERLAY_FAIL_REPLAY_CHAT__) throw new Error('saved chat unavailable');
                return [
                { id: 'replay-chat', senderName: 'Taylor', text: 'Saved replay message', createdAt: 445000 }
            ]; }
            export async function getLiveReactions() {
                if (window.__OVERLAY_FAIL_REPLAY_REACTIONS__) throw new Error('saved reactions unavailable');
                return [
                { id: 'replay-reaction', type: 'heart', createdAt: 450000 }
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
    await page.route(/\/js\/auth\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `export function checkAuth(callback) {
            const user = Object.prototype.hasOwnProperty.call(window, '__OVERLAY_AUTH_USER__')
                ? window.__OVERLAY_AUTH_USER__
                : { uid: 'viewer-1', displayName: 'Alex Viewer', photoURL: 'https://images.example/avatar.png' };
            callback(user);
            return () => {};
        }`
    }));
    await page.route(/\/js\/live-game-chat\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `export function isViewerChatEnabled(game, { isReplay = false } = {}) {
            return !isReplay && game?.liveStatus === 'live';
        }`
    }));
    await page.route(/\/js\/safe-image-url\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `export function resolveSafeProfilePhotoWriteUrl() { return ''; }`
    }));
}

test('live subscriptions start before signed-in team and roster enrichment finishes', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => { window.__OVERLAY_DEFER_OPTIONAL_CONTEXT__ = true; });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-team-name')).toHaveText('Current Academy');
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect.poll(() => page.evaluate(() => window.__OVERLAY_LIVE_SUBSCRIPTIONS__ || 0)).toBe(4);

    await page.evaluate(() => window.__OVERLAY_EVENT_CALLBACK__([{
        id: 'early-live-goal', type: 'goal', description: 'Realtime before roster hydration',
        playerId: 'p9', playerName: 'Avery Lane', statKey: 'goals', value: 1,
        homeScore: 4, awayScore: 2, period: 'H2', gameClockMs: 725000, createdAt: 1500
    }]));
    await expect(page.locator('#home-score')).toHaveText('4');
    await expect(page.locator('#event-list')).toContainText('Realtime before roster hydration');

    await page.evaluate(() => window.__OVERLAY_CHAT_CALLBACK__([{
        id: 'early-chat', senderName: 'Taylor', text: 'Chat before roster hydration', createdAt: Date.now()
    }]));
    await page.locator('[data-panel="chat"]').click();
    await expect(page.locator('#chat-list')).toContainText('Chat before roster hydration');
    expect(pageErrors).toEqual([]);
});

test('real mode follows canonical game, lineup, clock, reset, reaction, and passive video-failure behavior', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await stubRealOverlayModules(page);
    const embedRequests = await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
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

    const stateOnlySnapshot = [
        { id: 'lineup-1', type: 'lineup', onCourt: ['p4'], bench: ['p9'], createdAt: 1000 },
        { id: 'clock-1', type: 'clock_sync', homeScore: 3, awayScore: 2, period: 'H2', gameClockMs: 700000, createdAt: 1100 }
    ];
    await page.evaluate((events) => window.__OVERLAY_EVENT_CALLBACK__(events), stateOnlySnapshot);
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#game-clock')).toHaveText('11:40');
    await expect(page.locator('#on-field-list')).toContainText('Sam Gray');
    await expect(page.locator('#event-list .event-card')).toHaveCount(0);

    // The public projection refreshes on a slower cadence. A stale projection
    // must not overwrite state-only lineup/clock events from the live listener.
    await page.evaluate(() => window.__OVERLAY_GAME_CALLBACK__({
        id: 'game-1', opponent: 'Sporting Blue', homeScore: 1, awayScore: 0,
        period: 'H1', liveClockMs: 500000, liveStatus: 'live', liveViewerCount: 22,
        videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
        liveLineup: { onCourt: ['p9'], bench: ['p4'] }
    }));
    await expect(page.locator('#viewer-count')).toHaveText('22 watching');
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#period')).toHaveText('H2');
    await expect(page.locator('#game-clock')).toHaveText('11:40');
    await expect(page.locator('#on-field-list')).toContainText('Sam Gray');

    const liveSnapshot = [
        ...stateOnlySnapshot,
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

    // A queued offline event can arrive after newer events. Reprocessing the
    // complete ordered snapshot must keep the newest score and clock authoritative.
    await page.evaluate((events) => window.__OVERLAY_EVENT_CALLBACK__([
        { id: 'late-offline', type: 'score_update', description: 'Earlier queued score', homeScore: 2, awayScore: 1, period: 'H2', gameClockMs: 600000, clientCreatedAt: new Date(900).toISOString(), createdAt: 1250 },
        ...events
    ]), liveSnapshot);
    await expect(page.locator('#home-score')).toHaveText('4');
    await expect(page.locator('#away-score')).toHaveText('2');
    await expect(page.locator('#game-clock')).toHaveText('11:30');
    await expect(page.locator('#event-list .event-card').first()).toContainText('Lane scores in transition');

    const runningSnapshot = [
        { id: 'late-offline', type: 'score_update', description: 'Earlier queued score', homeScore: 2, awayScore: 1, period: 'H2', gameClockMs: 600000, clientCreatedAt: new Date(900).toISOString(), createdAt: 1250 },
        ...liveSnapshot,
        { id: 'clock-start', type: 'clock_start', description: 'Clock started', homeScore: 4, awayScore: 2, period: 'H2', gameClockMs: 690000, createdAt: 1300 }
    ];
    await page.evaluate((events) => window.__OVERLAY_EVENT_CALLBACK__(events), runningSnapshot);
    await expect(page.locator('#game-clock')).toHaveText('11:31', { timeout: 1800 });

    // An unchanged event snapshot (for example after a projection refresh) must
    // not rewind a running clock to its last immutable event value.
    await page.evaluate(() => window.__OVERLAY_GAME_CALLBACK__({
        id: 'game-1', homeScore: 2, awayScore: 1, period: 'H1', liveClockMs: 500000,
        liveStatus: 'live', liveViewerCount: 23
    }));
    await expect(page.locator('#game-clock')).not.toHaveText('11:30');

    const pausedSnapshot = [
        ...runningSnapshot,
        { id: 'clock-pause', type: 'clock_pause', description: 'Clock paused', homeScore: 4, awayScore: 2, period: 'H2', gameClockMs: 692000, createdAt: 1400 }
    ];
    await page.evaluate((events) => window.__OVERLAY_EVENT_CALLBACK__(events), pausedSnapshot);
    await expect(page.locator('#game-clock')).toHaveText('11:32');
    await page.waitForTimeout(650);
    await expect(page.locator('#game-clock')).toHaveText('11:32');

    await page.evaluate(() => window.__OVERLAY_EVENT_ERROR__(new Error('events unavailable')));
    await expect(page.locator('#home-score')).toHaveText('4');
    await expect(page.locator('#away-score')).toHaveText('2');
    await expect(page.locator('#connection-message')).toContainText('Play-by-play is temporarily unavailable');

    const reactionText = await page.evaluate(() => {
        window.__OVERLAY_REACTION_CALLBACK__({ id: 'reaction-1', type: 'heart' });
        return document.querySelector('#reactions-overlay .floating-reaction')?.textContent;
    });
    expect(reactionText).toBe('❤️');

    await page.evaluate(() => window.__OVERLAY_CHAT_CALLBACK__([{
        id: 'chat-1', senderName: 'Taylor', text: 'What a finish!', createdAt: Date.now()
    }]));
    await page.locator('[data-panel="chat"]').click();
    await expect(page.locator('#chat-list')).toContainText('What a finish!');
    await expect(page.locator('#chat-input')).toBeEnabled();
    await expect(page.locator('#chat-status')).toContainText('Chatting as Alex Viewer');
    await page.locator('#chat-input').fill('Overlay hello');
    await page.locator('#chat-form').getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('#chat-status')).toContainText('Message sent.');
    await expect(page.locator('#chat-list')).toContainText('Overlay hello');
    expect(await page.evaluate(() => window.__OVERLAY_POSTED_CHAT__)).toEqual([{
        teamId: 'team-1',
        gameId: 'game-1',
        message: {
            text: 'Overlay hello',
            senderId: 'viewer-1',
            senderName: 'Alex Viewer',
            senderPhotoUrl: null,
            isAnonymous: false
        }
    }]);

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

test('signed-out viewers can read chat but cannot post from the overlay', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => { window.__OVERLAY_AUTH_USER__ = null; });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-team-name')).toHaveText('Current Academy');
    await page.evaluate(() => window.__OVERLAY_CHAT_CALLBACK__([{
        id: 'chat-1', senderName: 'Taylor', text: 'Readable for everyone', createdAt: Date.now()
    }]));
    await page.locator('[data-panel="chat"]').click();

    await expect(page.locator('#chat-list')).toContainText('Readable for everyone');
    await expect(page.locator('#chat-input')).toBeDisabled();
    await expect(page.locator('#chat-status')).toContainText('Sign in to join');
    await expect(page.locator('#chat-sign-in')).toBeVisible();
    await expect(page.locator('#chat-sign-in')).toHaveAttribute('href', /login\.html\?next=/);
    expect(await page.evaluate(() => window.__OVERLAY_POSTED_CHAT__ || [])).toEqual([]);
    expect(pageErrors).toEqual([]);
});

test('chat write failure restores the draft without disrupting the live overlay', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => { window.__OVERLAY_FAIL_CHAT_SEND__ = true; });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-panel="chat"]').click();
    await page.locator('#chat-input').fill('Keep this draft');
    await page.locator('#chat-form').getByRole('button', { name: 'Send' }).click();

    await expect(page.locator('#chat-input')).toHaveValue('Keep this draft');
    await expect(page.locator('#chat-status')).toContainText('Message failed to send');
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#overlay-video')).toBeVisible();
    expect(pageErrors).toEqual([]);
});

test('replay mode synchronizes saved plays, score, lineup, chat, reactions, and video controls', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_YOUTUBE_COMMANDS__ = [];
        window.addEventListener('message', (event) => {
            if (event.data?.source !== 'overlay-youtube-fixture') return;
            try {
                window.__OVERLAY_YOUTUBE_COMMANDS__.push(JSON.parse(event.data.payload));
            } catch {
                // Ignore non-command player messages.
            }
        });
    });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#live-status')).toHaveText('REPLAY');
    expect(pageErrors).toEqual([]);
    await expect(page.locator('#replay-controls')).toBeVisible();
    await expect(page.locator('#replay-duration')).toHaveText('11:30');
    await page.getByRole('button', { name: 'Pause replay' }).click();
    await expect(page.locator('#home-score')).toHaveText('0');
    await expect(page.locator('#event-list')).not.toContainText('Lane opens the replay scoring');

    await page.locator('#replay-progress').evaluate((input) => {
        input.value = '50';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#replay-current')).toHaveText('5:45');
    await expect(page.locator('#home-score')).toHaveText('1');
    await expect(page.locator('#event-list')).toContainText('Lane opens the replay scoring');
    await expect(page.locator('#on-field-list')).toContainText('Sam Gray');
    await page.locator('[data-panel="chat"]').click();
    await expect(page.locator('#chat-list')).toContainText('Saved replay message');
    await expect(page.locator('#chat-form')).toBeHidden();

    await page.getByRole('button', { name: '4×' }).click();
    await page.getByRole('button', { name: 'Play replay' }).click();
    await expect(page.locator('#reactions-overlay .floating-reaction')).toContainText('❤️', { timeout: 3000 });
    await page.getByRole('button', { name: 'Pause replay' }).click();

    await page.locator('#replay-progress').evaluate((input) => {
        input.value = '100';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#event-list')).toContainText('Lane scores the replay winner');
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#replay-current')).toHaveText('11:30');

    await page.getByRole('button', { name: 'Restart replay' }).click();
    await expect(page.locator('#home-score')).toHaveText('0');
    await expect(page.locator('#chat-list')).not.toContainText('Saved replay message');
    expect(await page.evaluate(() => window.__OVERLAY_LIVE_SUBSCRIPTIONS__ || 0)).toBe(0);
    await expect(page.locator('#overlay-video')).toHaveAttribute('src', /enablejsapi=1/);
    await expect.poll(async () => page.evaluate(() => (
        window.__OVERLAY_YOUTUBE_COMMANDS__ || []
    ).map((command) => command.func))).toEqual(expect.arrayContaining(['seekTo', 'playVideo', 'pauseVideo', 'setPlaybackRate']));
    expect(pageErrors).toEqual([]);
});

test('mobile replay controls stay on screen without covering the scoreboard', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#replay-controls')).toBeVisible();
    await page.getByRole('button', { name: 'Pause replay' }).click();
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restart replay' })).toBeVisible();
    await expect(page.getByRole('button', { name: '4×' })).toBeVisible();

    const layout = await page.evaluate(() => {
        const score = document.querySelector('#score-bug').getBoundingClientRect();
        const controls = document.querySelector('#replay-controls').getBoundingClientRect();
        return {
            noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            scoreBottom: score.bottom,
            controlsTop: controls.top,
            controlsRight: controls.right,
            viewportWidth: window.innerWidth
        };
    });
    expect(layout.noHorizontalOverflow).toBe(true);
    expect(layout.scoreBottom).toBeLessThanOrEqual(layout.controlsTop);
    expect(layout.controlsRight).toBeLessThanOrEqual(layout.viewportWidth);
    expect(pageErrors).toEqual([]);
});

test('replay history failure leaves the saved video and final game state usable', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_FAIL_REPLAY_EVENTS__ = true;
        window.__OVERLAY_FAIL_REPLAY_CHAT__ = true;
        window.__OVERLAY_FAIL_REPLAY_REACTIONS__ = true;
    });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#live-status')).toHaveText('REPLAY');
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#away-score')).toHaveText('2');
    await expect(page.locator('#overlay-video')).toBeVisible();
    await expect(page.locator('#connection-message')).toContainText('refresh to retry');
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeDisabled();
    expect(await page.evaluate(() => window.__OVERLAY_LIVE_SUBSCRIPTIONS__ || 0)).toBe(0);
    expect(pageErrors).toEqual([]);
});
