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
                <script>
                    let currentTime = 0;
                    addEventListener('message', (event) => {
                        parent.postMessage({ source: 'overlay-youtube-fixture', payload: event.data }, '*');
                        try {
                            const command = JSON.parse(event.data);
                            if (command.func === 'seekTo') currentTime = Number(command.args?.[0]) || 0;
                            if (command.func === 'playVideo' || command.func === 'pauseVideo') {
                                parent.postMessage(JSON.stringify({
                                    event: 'infoDelivery',
                                    info: { currentTime, playerState: command.func === 'playVideo' ? 1 : 2 }
                                }), '*');
                            }
                        } catch {}
                    });
                </script>
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

    await expect(page.locator('#overlay-video')).toHaveAttribute('src', /https:\/\/www\.youtube\.com\/embed\/PK1HyC37doc\?.*autoplay=1.*enablejsapi=1/);
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

            if (replay) await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();

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
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
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
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
    await page.locator('#replay-progress').evaluate((input) => {
        input.value = '100';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#home-score')).toHaveText('2');
    await expect(page.locator('#away-score')).toHaveText('1');
    await expect(page.locator('#event-list')).toContainText('Persell finds the winner');
    await page.locator('[data-panel="chat"]').click();
    await expect(page.locator('#chat-list')).toContainText('Great recovery shape');

    await page.getByRole('button', { name: '50×' }).click();
    await page.getByRole('button', { name: 'Restart replay' }).click();
    await expect(page.locator('#home-score')).toHaveText('2', { timeout: 1500 });
    await expect(page.locator('#replay-current')).toHaveText('0:15', { timeout: 1500 });
    expect(pageErrors).toEqual([]);
});

test('local replay fires the recorded game timeline in order without manual seeking', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await stubYouTubeEmbed(page);
    await page.goto(`${baseURL}/live-game-overlay.html?demo=1&replay=true&videoId=PK1HyC37doc`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#replay-controls')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
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
    await page.route('https://images.example/**', (route) => route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#61e4db"/></svg>'
    }));
    await page.route('https://allplays.ai/test-assets/**', (route) => route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#61e4db"/></svg>'
    }));
    await page.route(/\/(?:js\/db|tests\/manual\/live-game-overlay-production-readonly-adapter)\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            const team = {
                id: 'team-1',
                name: 'Current Academy',
                photoUrl: 'https://allplays.ai/test-assets/current-academy.svg',
                currentSeasonId: '2026',
                recordedReplayTeamPassRequired: window.__OVERLAY_TEAM_PASS_GATE__ === true
            };
            const game = {
                id: 'game-1', opponent: 'Sporting Blue', homeScore: 3, awayScore: 2,
                homeTeamName: 'Current Academy',
                opponentTeamPhoto: 'https://allplays.ai/test-assets/sporting-blue.svg',
                period: 'H2', liveClockMs: 720000,
                liveStatus: window.__OVERLAY_COMPLETED_GAME__ ? 'completed' : 'live',
                status: window.__OVERLAY_COMPLETED_GAME__ ? 'completed' : 'live',
                viewerCount: 4, liveViewerCount: 19,
                videoUrl: window.__OVERLAY_PUBLIC_VIDEO_URL__ || 'https://www.youtube.com/watch?v=PK1HyC37doc',
                isPublicProjection: true,
                liveResetAt: window.__OVERLAY_RESET_REPLAY__ ? 200000 : undefined,
                liveLineup: { onCourt: ['p9'], bench: ['p4'] },
                liveStats: { p9: { goals: 5 } },
                opponentStats: {
                    away8: { name: 'Jordan Vale', goals: 1 },
                    away9: { name: 'Casey Park', shots: 0 }
                }
            };
            export async function getGameDayTeamContext() {
                window.__OVERLAY_GET_TEAM_CONTEXT_CALLS__ = (window.__OVERLAY_GET_TEAM_CONTEXT_CALLS__ || 0) + 1;
                if (window.__OVERLAY_DEFER_OPTIONAL_CONTEXT__) return new Promise(() => {});
                if (window.__OVERLAY_FAIL_TEAM_CONTEXT__ ||
                    (window.__OVERLAY_FAIL_TEAM_CONTEXT_ONCE__ && window.__OVERLAY_GET_TEAM_CONTEXT_CALLS__ === 1)) {
                    throw new Error('team context unavailable');
                }
                if (window.__OVERLAY_DELAY_TEAM_CONTEXT__) {
                    await new Promise((resolve) => { window.__OVERLAY_RELEASE_TEAM_CONTEXT__ = resolve; });
                }
                return team;
            }
            export async function getGame() { return game; }
            export async function getPlayers() {
                if (window.__OVERLAY_DEFER_OPTIONAL_CONTEXT__) return new Promise(() => {});
                window.__OVERLAY_GET_PLAYERS_CALLS__ = (window.__OVERLAY_GET_PLAYERS_CALLS__ || 0) + 1;
                if (window.__OVERLAY_FAIL_PLAYERS__ ||
                    (window.__OVERLAY_FAIL_PLAYERS_ONCE__ && window.__OVERLAY_GET_PLAYERS_CALLS__ === 1)) {
                    throw new Error('roster unavailable');
                }
                if (window.__OVERLAY_EMPTY_PLAYERS__) return [];
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
            export async function sendReaction(teamId, gameId, reaction) {
                window.__OVERLAY_SENT_REACTIONS__ = [...(window.__OVERLAY_SENT_REACTIONS__ || []), { teamId, gameId, reaction }];
                if (window.__OVERLAY_FAIL_REACTION_SEND__) throw new Error('reaction write unavailable');
                window.__OVERLAY_REACTION_CALLBACK__?.({ id: 'posted-reaction', ...reaction, createdAt: Date.now() });
            }
            export function subscribeReactions(_teamId, _gameId, callback, onError) {
                window.__OVERLAY_LIVE_SUBSCRIPTIONS__ = (window.__OVERLAY_LIVE_SUBSCRIPTIONS__ || 0) + 1;
                window.__OVERLAY_REACTION_CALLBACK__ = callback;
                window.__OVERLAY_REACTION_ERROR__ = onError;
                return () => {};
            }
            export async function getLiveEvents() {
                window.__OVERLAY_GET_REPLAY_EVENTS_CALLS__ = (window.__OVERLAY_GET_REPLAY_EVENTS_CALLS__ || 0) + 1;
                if (window.__OVERLAY_FAIL_REPLAY_EVENTS__ ||
                    (window.__OVERLAY_FAIL_REPLAY_EVENTS_ONCE__ && window.__OVERLAY_GET_REPLAY_EVENTS_CALLS__ === 1)) {
                    throw new Error('saved events unavailable');
                }
                if (window.__OVERLAY_EMPTY_REPLAY_EVENTS__) return [];
                if (window.__OVERLAY_RESET_REPLAY__) return [
                    { id: 'stale-before-reset', type: 'goal', description: 'Stale pre-reset goal', homeScore: 8, awayScore: 0, period: 'H1', gameClockMs: 2700000, createdAt: 100000, clientCreatedAt: 250000 },
                    { id: 'fresh-after-reset', type: 'goal', description: 'Fresh post-reset goal', homeScore: 1, awayScore: 0, period: 'H1', gameClockMs: 30000, createdAt: 230000, clientCreatedAt: 180000 }
                ];
                if (window.__OVERLAY_RESUMED_REPLAY__) return [
                    { id: 'replay-resumed', type: 'clock_sync', homeScore: 1, awayScore: 0, period: 'H1', gameClockMs: 1200000, createdAt: 1300000 }
                ];
                return [
                { id: 'replay-start', type: 'clock_sync', homeScore: 0, awayScore: 0, period: 'H1', gameClockMs: 0, createdAt: 100000 },
                { id: 'replay-lineup', type: 'lineup', onCourt: ['p4'], bench: ['p9'], period: 'H1', gameClockMs: 300000, createdAt: 400000 },
                { id: 'replay-opener', type: 'goal', description: 'Lane opens the replay scoring', playerId: 'p9', playerName: 'Avery Lane', statKey: 'goals', value: 1, homeScore: 1, awayScore: 0, period: 'H1', gameClockMs: 345000, createdAt: 445000 },
                { id: 'replay-shot', type: 'stat', description: 'Gray tests the keeper', playerId: 'p4', playerName: 'Sam Gray', statKey: 'shots', value: 1, homeScore: 1, awayScore: 0, period: 'H1', gameClockMs: 350000, createdAt: 450000 },
                { id: 'replay-clock-after-opener', type: 'clock_sync', homeScore: 1, awayScore: 0, period: 'H1', gameClockMs: 360000, createdAt: 460000 },
                { id: 'replay-goal', type: 'goal', description: 'Lane scores the replay winner', playerId: 'p9', playerName: 'Avery Lane', statKey: 'goals', value: 1, homeScore: 3, awayScore: 2, period: 'H2', gameClockMs: 690000, createdAt: 790000 }
            ]; }
            export async function getLiveChatHistory() {
                window.__OVERLAY_GET_REPLAY_CHAT_CALLS__ = (window.__OVERLAY_GET_REPLAY_CHAT_CALLS__ || 0) + 1;
                if (window.__OVERLAY_FAIL_REPLAY_CHAT__ ||
                    (window.__OVERLAY_FAIL_REPLAY_CHAT_ONCE__ && window.__OVERLAY_GET_REPLAY_CHAT_CALLS__ === 1)) {
                    throw new Error('saved chat unavailable');
                }
                if (window.__OVERLAY_RESET_REPLAY__) return [
                    { id: 'stale-reset-chat', senderName: 'Taylor', text: 'Stale chat before reset', createdAt: 150000 },
                    { id: 'fresh-reset-chat', senderName: 'Taylor', text: 'Fresh chat after reset', createdAt: 220000 }
                ];
                if (window.__OVERLAY_RESUMED_REPLAY__) return [
                    { id: 'replay-resumed-chat', senderName: 'Taylor', text: 'Twenty-one minute update', createdAt: 1360000 }
                ];
                return [
                { id: 'replay-chat', senderName: 'Taylor', senderPhotoUrl: 'https://images.example/avatar.png', text: '*Saved replay message* from @ALL PLAYS', createdAt: 445000 }
            ]; }
            export async function getLiveReactions() {
                window.__OVERLAY_GET_REPLAY_REACTIONS_CALLS__ = (window.__OVERLAY_GET_REPLAY_REACTIONS_CALLS__ || 0) + 1;
                if (window.__OVERLAY_FAIL_REPLAY_REACTIONS__ ||
                    (window.__OVERLAY_FAIL_REPLAY_REACTIONS_ONCE__ && window.__OVERLAY_GET_REPLAY_REACTIONS_CALLS__ === 1)) {
                    throw new Error('saved reactions unavailable');
                }
                if (window.__OVERLAY_RESET_REPLAY__) return [
                    { id: 'stale-reset-reaction', type: 'heart', createdAt: 190000 },
                    { id: 'fresh-reset-reaction', type: 'clap', createdAt: 225000 }
                ];
                if (window.__OVERLAY_RESUMED_REPLAY__) return [];
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
            if (window.__OVERLAY_NO_RESOLVED_VIDEO__) {
                return { mode: 'none', hasVideo: false, sourceUrl: null, publicUrl: null, replayState: null };
            }
            if (window.__OVERLAY_RECORDED_VIDEO__) {
                return {
                    mode: 'recorded', hasVideo: true,
                    sourceUrl: '/overlay-recording-fixture.mp4',
                    publicUrl: '/overlay-recording-fixture.mp4',
                    publicLabel: 'Open replay video ↗'
                };
            }
            return {
                mode: 'embed', hasVideo: true,
                sourceUrl: 'https://www.youtube.com/embed/PK1HyC37doc?autoplay=1&mute=1',
                publicUrl: window.__OVERLAY_PROVIDER_PUBLIC_URL__ || 'https://www.youtube.com/watch?v=PK1HyC37doc',
                publicLabel: 'Watch on YouTube ↗'
            };
        }`
    }));
    await page.route(/\/js\/team-entitlements\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            export const TEAM_PASS_FEATURES = { RECORDED_REPLAY: 'recorded-replay' };
            export function isRecordedReplayTeamPassGateEnabled({ team = {}, game = {} } = {}) {
                return game.recordedReplayTeamPassRequired === true || team.recordedReplayTeamPassRequired === true;
            }
            export function resolveTeamEntitlementSeasonId() { return '2026'; }
            export function canAccessPremiumFanFeature(_feature, status = {}) {
                return status?.access?.state === 'unlocked' || status?.active === true;
            }
            export async function getTeamEntitlementStatus() {
                window.__OVERLAY_ENTITLEMENT_READS__ = (window.__OVERLAY_ENTITLEMENT_READS__ || 0) + 1;
                const state = window.__OVERLAY_TEAM_PASS_STATE__ || 'locked';
                return {
                    active: state === 'unlocked',
                    reason: state,
                    access: { state, reason: state }
                };
            }
        `
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
        body: `
            export function resolveSafeProfilePhotoUrl(value) { return String(value || '').startsWith('https://') ? value : ''; }
            export function resolveSafeProfilePhotoWriteUrl() { return ''; }
            export function createSafeImageElement({ documentRef = document, url, resolveUrl, alt = '', className = '', onLoadError } = {}) {
                const safeUrl = resolveUrl(url);
                if (!safeUrl) return null;
                const image = documentRef.createElement('img');
                image.src = safeUrl;
                image.alt = alt;
                image.className = className;
                if (onLoadError) image.addEventListener('error', () => onLoadError(image), { once: true });
                return image;
            }
        `
    }));
    await page.route(/\/js\/vendor\/firebase-ai\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
            export class GoogleAIBackend {}
            export function getAI() { return {}; }
            export function getGenerativeModel() {
                return { generateContent: async (prompt) => {
                    window.__OVERLAY_AI_PROMPT__ = prompt;
                    if (window.__OVERLAY_FAIL_AI__) throw new Error('assistant unavailable');
                    return { response: { text: () => 'ALL PLAYS says the press is working.' } };
                } };
            }
        `
    }));
    await page.route(/\/js\/vendor\/firebase-app\.js(?:\?.*)?$/, (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `export function getApp() { return {}; }`
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

test('event corrections rebuild from a stable baseline after a stale public projection poll', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#away-score')).toHaveText('2');

    await page.evaluate(() => window.__OVERLAY_EVENT_CALLBACK__([{
        id: 'temporary-goal', type: 'goal', description: 'Temporary score',
        homeScore: 4, awayScore: 2, period: 'H2', gameClockMs: 730_000, createdAt: 1_000
    }]));
    await expect(page.locator('#home-score')).toHaveText('4');

    await page.evaluate(() => window.__OVERLAY_GAME_CALLBACK__({
        id: 'game-1', homeScore: 1, awayScore: 0, period: 'H1', liveClockMs: 300_000,
        liveStatus: 'live', liveViewerCount: 22,
        liveLineup: { onCourt: ['p9'], bench: ['p4'] }
    }));
    await expect(page.locator('#home-score')).toHaveText('4');
    await expect(page.locator('#away-score')).toHaveText('2');
    await expect(page.locator('#viewer-count')).toHaveText('22 watching');

    // Removing/correcting the scoring event must return to the original game
    // baseline, not the older score from the intervening projection poll.
    await page.evaluate(() => window.__OVERLAY_EVENT_CALLBACK__([{
        id: 'lineup-after-correction', type: 'lineup', onCourt: ['p4'], bench: ['p9'], createdAt: 2_000
    }]));
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#away-score')).toHaveText('2');
    await expect(page.locator('#period')).toHaveText('H2');
    await expect(page.locator('#game-clock')).toHaveText('12:00');
    await expect(page.locator('#on-field-list')).toContainText('Sam Gray');
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
    await expect(page.locator('#overlay-video')).toHaveAttribute('src', /https:\/\/www\.youtube\.com\/embed\/PK1HyC37doc\?.*autoplay=1.*enablejsapi=1/);
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

    const opponentStatSnapshot = [
        ...liveSnapshot,
        {
            id: 'away-shot', type: 'stat', description: 'Vale tests the keeper',
            playerId: 'away9', opponentPlayerName: 'Casey Park', statKey: 'shots', value: 1,
            isOpponent: true, homeScore: 4, awayScore: 2, period: 'H2', gameClockMs: 690000,
            createdAt: 1210
        }
    ];
    await page.evaluate((events) => window.__OVERLAY_EVENT_CALLBACK__(events), opponentStatSnapshot);
    await page.locator('#opponent-tab').click();
    await expect(page.locator('#opponent-list')).toContainText('1 SHOTS');

    await page.evaluate((events) => window.__OVERLAY_EVENT_CALLBACK__([
        ...events,
        {
            id: 'away-shot-undo', type: 'stat', description: 'Vale shot reversed',
            playerId: 'away9', opponentPlayerName: 'Casey Park', statKey: 'shots', value: -1,
            isOpponent: true, homeScore: 4, awayScore: 2, period: 'H2', gameClockMs: 690000,
            createdAt: 1220
        }
    ]), opponentStatSnapshot);
    await expect(page.locator('#opponent-list')).not.toContainText('1 SHOTS');
    await page.locator('#leaders-tab').click();

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
    await expect(page.locator('#game-clock')).toHaveText('11:30');
    await page.waitForTimeout(1100);
    await expect(page.locator('#game-clock')).toHaveText('11:31');

    // Firebase remains authoritative. Each clock_sync re-anchors the passive
    // browser display so drift is corrected without writing anything back.
    const syncedRunningSnapshot = [
        ...runningSnapshot,
        { id: 'clock-sync-2', type: 'clock_sync', homeScore: 4, awayScore: 2, period: 'H2', gameClockMs: 691000, createdAt: 1350 }
    ];
    await page.evaluate((events) => window.__OVERLAY_EVENT_CALLBACK__(events), syncedRunningSnapshot);
    await expect(page.locator('#game-clock')).toHaveText('11:31');

    // A stale public projection must not overwrite the event-authoritative
    // clock after a newer Firebase clock sync.
    await page.evaluate(() => window.__OVERLAY_GAME_CALLBACK__({
        id: 'game-1', homeScore: 2, awayScore: 1, period: 'H1', liveClockMs: 500000,
        liveStatus: 'live', liveViewerCount: 23
    }));
    await expect(page.locator('#game-clock')).toHaveText('11:31');

    const pausedSnapshot = [
        ...syncedRunningSnapshot,
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

    // A healthy game, chat, reaction, or video callback must not erase the
    // independent event-feed failure until that feed itself recovers.
    await page.evaluate(() => {
        window.__OVERLAY_GAME_CALLBACK__({
            id: 'game-1', opponent: 'Sporting Blue', homeScore: 4, awayScore: 2,
            period: 'H2', liveClockMs: 692000, liveStatus: 'live', liveViewerCount: 24,
            videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc'
        });
        window.__OVERLAY_CHAT_CALLBACK__([]);
        window.__OVERLAY_REACTION_CALLBACK__({ id: 'healthy-reaction', type: 'clap' });
    });
    await expect(page.locator('#connection-message')).toContainText('Play-by-play is temporarily unavailable');

    const reactionText = await page.evaluate(() => {
        window.__OVERLAY_REACTION_CALLBACK__({ id: 'reaction-1', type: 'heart' });
        return [...document.querySelectorAll('#reactions-overlay .floating-reaction')].at(-1)?.textContent;
    });
    expect(reactionText).toBe('❤️');

    await page.evaluate(() => window.__OVERLAY_CHAT_CALLBACK__([
        {
            id: 'chat-2', senderName: 'ALL PLAYS', text: '@ALL PLAYS sees the press working.', ai: true,
            createdAt: 200
        },
        {
            id: 'chat-spoof', senderName: 'ALL PLAYS', text: 'Viewer-controlled display name',
            createdAt: 150
        },
        {
            id: 'chat-1', senderName: 'Taylor', senderPhotoUrl: 'https://images.example/avatar.png',
            text: '*What a finish!* https://allplays.ai <img src=x onerror=alert(1)>', createdAt: 100
        }
    ]));
    await page.locator('[data-panel="chat"]').click();
    await expect(page.locator('#chat-list')).toContainText('What a finish!');
    await expect(page.locator('#chat-list .chat-row')).toHaveCount(3);
    await expect(page.locator('#chat-list .chat-row').first().locator('strong').first()).toHaveText('Taylor');
    await expect(page.locator('#chat-list .chat-row').last().locator('strong').first()).toHaveText('ALL PLAYS');
    await expect(page.locator('#chat-list .chat-row').filter({ hasText: 'Viewer-controlled display name' })).toHaveAttribute('data-ai', 'false');
    await expect(page.locator('#chat-list .chat-row').last()).toHaveAttribute('data-ai', 'false');
    await expect(page.locator('#chat-list .chat-row').first().locator('img.chat-avatar')).toBeVisible();
    await expect(page.locator('#chat-list .chat-row').first().locator('.chat-message strong')).toHaveText('What a finish!');
    await expect(page.locator('#chat-list .chat-link')).toHaveAttribute('href', 'https://allplays.ai');
    await expect(page.locator('#chat-list .chat-mention')).toHaveText('@ALL PLAYS');
    await expect(page.locator('#chat-list .chat-message img')).toHaveCount(0);
    await expect(page.locator('#chat-input')).toBeEnabled();
    await expect(page.locator('#chat-status')).toContainText('Chatting as Alex Viewer');
    await expect(page.locator('#chat-reactions')).toBeVisible();
    await page.locator('#chat-input').fill('@al');
    await expect(page.locator('#mention-menu')).toBeVisible();
    await page.locator('#mention-allplays').click();
    await expect(page.locator('#chat-input')).toHaveValue('@ALL PLAYS ');
    await page.locator('#chat-input').pressSequentially('How is the press?');
    await page.locator('#chat-form').getByRole('button', { name: 'Send', exact: true }).click();
    await expect(page.locator('#chat-status')).toContainText('Message sent.');
    await expect(page.locator('#chat-list')).toContainText('ALL PLAYS says the press is working.');
    await expect(page.locator('#ai-thinking')).toBeHidden();
    expect(await page.evaluate(() => window.__OVERLAY_AI_PROMPT__)).toContain('Question: @ALL PLAYS How is the press?');
    expect(await page.evaluate(() => window.__OVERLAY_POSTED_CHAT__)).toEqual([{
        teamId: 'team-1',
        gameId: 'game-1',
        message: {
            text: '@ALL PLAYS How is the press?',
            senderId: 'viewer-1',
            senderName: 'Alex Viewer',
            senderPhotoUrl: null,
            isAnonymous: false
        }
    }, {
        teamId: 'team-1',
        gameId: 'game-1',
        message: {
            text: 'ALL PLAYS: ALL PLAYS says the press is working.',
            senderId: 'viewer-1',
            senderName: 'Alex Viewer',
            senderPhotoUrl: null,
            isAnonymous: false
        }
    }]);

    await page.getByRole('button', { name: 'Send clap reaction' }).click();
    await expect.poll(() => page.evaluate(() => window.__OVERLAY_SENT_REACTIONS__ || [])).toEqual([{
        teamId: 'team-1',
        gameId: 'game-1',
        reaction: { type: 'clap', senderId: 'viewer-1' }
    }]);
    await expect(page.locator('#chat-list')).toContainText('👏');

    await page.evaluate(() => window.__OVERLAY_EVENT_CALLBACK__([{
        id: 'reset-1', type: 'reset', description: 'Game reset', homeScore: 0, awayScore: 0,
        period: 'H1', gameClockMs: 0, onCourt: ['p9'], bench: ['p4'], createdAt: 2000
    }]));
    await expect(page.locator('#home-score')).toHaveText('0');
    await expect(page.locator('#away-score')).toHaveText('0');
    await expect(page.locator('#event-list .event-card')).toHaveCount(0);

    await page.evaluate(() => window.__OVERLAY_EVENT_CALLBACK__([{
        id: 'stale-goal', type: 'goal', description: 'Old goal must stay hidden', homeScore: 9, awayScore: 0,
        period: 'H1', gameClockMs: 1000,
        clientCreatedAt: new Date(2500).toISOString(), createdAt: 1500
    }, {
        id: 'fresh-skewed-goal', type: 'goal', description: 'Fresh goal survives tracker clock skew',
        homeScore: 1, awayScore: 0, period: 'H1', gameClockMs: 2000,
        clientCreatedAt: new Date(1000).toISOString(), createdAt: 2100
    }, {
        id: 'reset-1', type: 'reset', description: 'Game reset', homeScore: 0, awayScore: 0,
        period: 'H1', gameClockMs: 0, onCourt: ['p9'], bench: ['p4'],
        clientCreatedAt: new Date(2500).toISOString(), createdAt: 2200
    }]));
    await expect(page.locator('#home-score')).toHaveText('1');
    await expect(page.locator('#event-list')).not.toContainText('Old goal must stay hidden');
    await expect(page.locator('#event-list')).toContainText('Fresh goal survives tracker clock skew');

    await page.evaluate(() => window.__OVERLAY_EVENT_CALLBACK__([{
        id: 'reset-1', type: 'reset', description: 'First game reset', homeScore: 0, awayScore: 0,
        period: 'H1', gameClockMs: 0, clientCreatedAt: new Date(2500).toISOString(), createdAt: 2200
    }, {
        id: 'between-resets', type: 'goal', description: 'Goal before the second reset',
        homeScore: 7, awayScore: 0, period: 'H1', gameClockMs: 3000,
        clientCreatedAt: new Date(3500).toISOString(), createdAt: 2700
    }, {
        id: 'reset-2', type: 'reset', description: 'Second game reset', homeScore: 0, awayScore: 0,
        period: 'H1', gameClockMs: 0, clientCreatedAt: new Date(3600).toISOString(), createdAt: 3000
    }, {
        id: 'second-reset-goal', type: 'goal', description: 'Goal after the second reset',
        homeScore: 1, awayScore: 0, period: 'H1', gameClockMs: 1000,
        clientCreatedAt: new Date(1500).toISOString(), createdAt: 3100
    }]));
    await expect(page.locator('#home-score')).toHaveText('1');
    await expect(page.locator('#event-list')).not.toContainText('Goal before the second reset');
    await expect(page.locator('#event-list')).toContainText('Goal after the second reset');

    // Firebase can publish the reset event, a new play, and then the game's
    // liveResetAt update. The later game callback acknowledges the same reset;
    // it must not erase the play that already arrived after the marker.
    const markerFirstSnapshot = [{
        id: 'reset-3', type: 'reset', description: 'Third game reset', homeScore: 0, awayScore: 0,
        period: 'H1', gameClockMs: 0, createdAt: 4000
    }, {
        id: 'post-marker-goal', type: 'goal', description: 'Goal after marker before game update',
        homeScore: 1, awayScore: 0, period: 'H1', gameClockMs: 1000, createdAt: 4100
    }];
    await page.evaluate((events) => window.__OVERLAY_EVENT_CALLBACK__(events), markerFirstSnapshot);
    await expect(page.locator('#event-list')).toContainText('Goal after marker before game update');

    await page.evaluate(() => window.__OVERLAY_GAME_CALLBACK__({
        id: 'game-1', opponent: 'Sporting Blue', homeScore: 0, awayScore: 0,
        period: 'H1', liveClockMs: 0, liveStatus: 'live', liveViewerCount: 25,
        liveResetAt: 4200, videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc'
    }));
    await expect(page.locator('#home-score')).toHaveText('1');
    await expect(page.locator('#event-list')).toContainText('Goal after marker before game update');
    expect(pageErrors).toEqual([]);
});

test('live event feed keeps the current 60-play history with explicit team context', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-team-name')).toHaveText('Current Academy');

    const events = Array.from({ length: 70 }, (_, index) => ({
        id: `event-${index}`,
        type: 'note',
        description: `Event ${index}`,
        isOpponent: index % 2 === 1,
        homeScore: 3,
        awayScore: 2,
        period: 'H2',
        gameClockMs: index * 1000,
        createdAt: index + 1
    }));
    await page.evaluate((snapshot) => window.__OVERLAY_EVENT_CALLBACK__(snapshot), events);

    const cards = page.locator('#event-list .event-card');
    await expect(cards).toHaveCount(60);
    await expect(cards.first()).toContainText('Event 69');
    await expect(cards.first().locator('.event-side-tag')).toHaveText('Away');
    await expect(cards.last()).toContainText('Event 10');

    await page.evaluate((snapshot) => window.__OVERLAY_EVENT_CALLBACK__([
        ...snapshot,
        {
            id: 'system-remove', type: 'log_remove', description: 'Removed play',
            homeScore: 3, awayScore: 2, period: 'H2', gameClockMs: 71_000, createdAt: 71
        }
    ]), events);
    await expect(cards).toHaveCount(60);
    await expect(cards.first()).toContainText('Removed play');
    await expect(cards.first()).toHaveAttribute('data-tone', 'system');
    await expect(cards.first().locator('.event-side-tag')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
});

test('subscription warnings remain isolated until the matching feed recovers', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-team-name')).toHaveText('Current Academy');
    await expect.poll(() => page.evaluate(() => typeof window.__OVERLAY_EVENT_ERROR__)).toBe('function');
    await page.evaluate(() => {
        window.__OVERLAY_EVENT_ERROR__(new Error('events unavailable'));
        window.__OVERLAY_CHAT_ERROR__(new Error('chat unavailable'));
    });
    await expect(page.locator('#connection-message')).toContainText('Live chat is temporarily unavailable');

    await page.evaluate(() => window.__OVERLAY_EVENT_CALLBACK__([]));
    await expect(page.locator('#connection-message')).toContainText('Live chat is temporarily unavailable');

    await page.evaluate(() => window.__OVERLAY_CHAT_CALLBACK__([]));
    await expect(page.locator('#connection-message')).toBeHidden();

    await page.evaluate(() => window.__OVERLAY_REACTION_ERROR__(new Error('reactions unavailable')));
    await expect(page.locator('#connection-message')).toContainText('Live reactions are temporarily unavailable');
    await page.evaluate(() => window.__OVERLAY_GAME_CALLBACK__({
        id: 'game-1', opponent: 'Sporting Blue', homeScore: 3, awayScore: 2,
        period: 'H2', liveClockMs: 720000, liveStatus: 'live', liveViewerCount: 20,
        videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc'
    }));
    await expect(page.locator('#connection-message')).toContainText('Live reactions are temporarily unavailable');
    await page.evaluate(() => window.__OVERLAY_REACTION_CALLBACK__({ id: 'recovered', type: 'heart' }));
    await expect(page.locator('#connection-message')).toBeHidden();
    expect(pageErrors).toEqual([]);
});

test('viewer toolbar shares the canonical watch URL and controls YouTube audio and fullscreen', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_SHARED__ = [];
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: async (payload) => window.__OVERLAY_SHARED__.push(payload)
        });
        window.__OVERLAY_YOUTUBE_COMMANDS__ = [];
        window.addEventListener('message', (event) => {
            if (event.data?.source !== 'overlay-youtube-fixture') return;
            try {
                window.__OVERLAY_YOUTUBE_COMMANDS__.push(JSON.parse(event.data.payload));
            } catch { /* fixture telemetry only */ }
        });
        let fullscreenElement = null;
        Object.defineProperty(document, 'fullscreenElement', {
            configurable: true,
            get: () => fullscreenElement
        });
        Element.prototype.requestFullscreen = async function requestFullscreen() {
            fullscreenElement = this;
            document.dispatchEvent(new Event('fullscreenchange'));
        };
        document.exitFullscreen = async () => {
            fullscreenElement = null;
            document.dispatchEvent(new Event('fullscreenchange'));
        };
        window.__OVERLAY_SPOKEN__ = [];
        Object.defineProperty(window, 'speechSynthesis', {
            configurable: true,
            value: {
                speak: (utterance) => window.__OVERLAY_SPOKEN__.push(utterance.text),
                cancel: () => {}
            }
        });
        Object.defineProperty(window, 'SpeechSynthesisUtterance', {
            configurable: true,
            value: class SpeechSynthesisUtterance {
                constructor(text) { this.text = text; }
            }
        });
    });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-team-name')).toHaveText('Current Academy');
    expect(pageErrors).toEqual([]);

    await expect(page.locator('#open-stream')).toContainText('Watch on YouTube');
    await expect(page.locator('#open-stream')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=PK1HyC37doc');
    await expect(page.locator('#open-stream')).toHaveAttribute('target', '_blank');
    await expect(page.locator('#open-stream')).toHaveAttribute('rel', /noopener/);
    await expect(page.locator('#home-team-photo')).toBeVisible();
    await expect(page.locator('#home-team-photo')).toHaveAttribute('src', 'https://allplays.ai/test-assets/current-academy.svg');
    await expect(page.locator('#away-team-photo')).toBeVisible();
    await expect(page.locator('#away-team-photo')).toHaveAttribute('src', 'https://allplays.ai/test-assets/sporting-blue.svg');
    await expect(page.locator('#overlay-video')).toHaveAttribute('src', /enablejsapi=1/);
    await page.locator('#share-game').click();
    await expect.poll(() => page.evaluate(() => window.__OVERLAY_SHARED__)).toEqual([{
        title: 'Watch game',
        text: 'Watch Current Academy vs Sporting Blue',
        url: 'https://share.allplays.ai/watch?teamId=team-1&gameId=game-1'
    }]);

    await page.locator('#scoreboard-toggle').click();
    await expect(page.locator('body')).toHaveAttribute('data-score-hidden', 'true');
    await expect(page.locator('#score-bug')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#scoreboard-toggle')).toHaveAttribute('aria-label', 'Show scoreboard');
    await expect(page.locator('#scoreboard-toggle')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#game-actions-toggle').click();
    await expect(page.locator('#scoreboard-menu-toggle')).toContainText('Show scoreboard');
    await page.locator('#scoreboard-menu-toggle').click();
    await expect(page.locator('#game-actions-menu')).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-score-hidden', 'false');
    await expect(page.locator('#score-bug')).toHaveAttribute('aria-hidden', 'false');

    await page.locator('#mute-toggle').click();
    await expect(page.locator('#mute-toggle')).toHaveAttribute('aria-label', 'Mute video');
    await expect.poll(() => page.evaluate(() => window.__OVERLAY_YOUTUBE_COMMANDS__.map((item) => item.func))).toContain('unMute');
    await page.locator('#mute-toggle').click();
    await expect(page.locator('#mute-toggle')).toHaveAttribute('aria-label', 'Unmute video');
    await expect.poll(() => page.evaluate(() => window.__OVERLAY_YOUTUBE_COMMANDS__.map((item) => item.func))).toContain('mute');

    await page.locator('#fullscreen-toggle').click();
    await expect(page.locator('#fullscreen-toggle')).toHaveAttribute('aria-label', 'Exit fullscreen');
    await expect(page.locator('#fullscreen-toggle')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#fullscreen-toggle').click();
    await expect(page.locator('#fullscreen-toggle')).toHaveAttribute('aria-label', 'Enter fullscreen');

    await page.locator('#game-actions-toggle').click();
    await expect(page.locator('#game-actions-menu')).toBeVisible();
    await expect(page.locator('#match-report-link')).toHaveAttribute('href', 'game.html#teamId=team-1&gameId=game-1');
    await expect(page.locator('#match-report-link')).toBeHidden();
    await expect(page.locator('#game-details-link')).toHaveAttribute('href', 'game.html#teamId=team-1&gameId=game-1');
    await expect(page.locator('#provider-menu-link')).toContainText('Watch on YouTube');
    await page.locator('#game-actions-toggle').click();
    await expect(page.locator('#game-actions-menu')).toBeHidden();

    await page.locator('#opponent-tab').click();
    await expect(page.locator('#opponent-list')).toContainText('Jordan Vale');
    await page.locator('#announcer-toggle').click();
    await page.evaluate(() => window.__OVERLAY_EVENT_CALLBACK__([{
        id: 'announced-goal', type: 'goal', description: 'Lane scores from distance',
        homeScore: 4, awayScore: 2, period: 'H2', gameClockMs: 700000, createdAt: 5000
    }]));
    await expect.poll(() => page.evaluate(() => window.__OVERLAY_SPOKEN__)).toContain('H2. Lane scores from distance');
    expect(pageErrors).toEqual([]);
});

test('unsafe stored provider links stay hidden while the video and live feed remain available', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_PROVIDER_PUBLIC_URL__ = 'javascript:alert(document.domain)';
    });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#overlay-video')).toBeVisible();
    await expect(page.locator('#home-team-name')).toHaveText('Current Academy');
    await expect(page.locator('#open-stream')).toBeHidden();
    await expect(page.locator('#open-stream')).not.toHaveAttribute('href', /.+/);
    await page.locator('#game-actions-toggle').click();
    await expect(page.locator('#provider-menu-link')).toBeHidden();
    await expect(page.locator('#provider-menu-link')).not.toHaveAttribute('href', /.+/);
    expect(pageErrors).toEqual([]);
});

test('a completed live game exposes replay actions and shares the replay URL without a reload', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_SHARED__ = [];
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: async (payload) => window.__OVERLAY_SHARED__.push(payload)
        });
    });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#watch-replay')).toBeHidden();
    await expect.poll(() => page.evaluate(() => typeof window.__OVERLAY_GAME_CALLBACK__)).toBe('function');
    await page.evaluate(() => window.__OVERLAY_GAME_CALLBACK__({
        id: 'game-1', opponent: 'Sporting Blue', homeScore: 3, awayScore: 2,
        period: 'H2', liveClockMs: 720000, liveStatus: 'completed', status: 'final',
        videoUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc'
    }));

    await expect(page.locator('#live-status')).toHaveText('FINAL');
    await expect(page.locator('#game-clock')).toHaveText('12:00');
    await page.waitForTimeout(1100);
    await expect(page.locator('#game-clock')).toHaveText('12:00');
    await expect(page.locator('#watch-replay')).toBeVisible();
    await expect(page.locator('#watch-replay')).toHaveAttribute(
        'href',
        'live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true'
    );
    await page.locator('#game-actions-toggle').click();
    await expect(page.locator('#watch-replay-menu')).toBeVisible();
    await expect(page.locator('#match-report-link')).toBeVisible();
    await page.locator('#game-actions-toggle').click();

    await page.locator('#share-game').click();
    await expect.poll(() => page.evaluate(() => window.__OVERLAY_SHARED__)).toEqual([{
        title: 'Watch replay',
        text: 'Watch Current Academy vs Sporting Blue',
        url: 'https://share.allplays.ai/watch?teamId=team-1&gameId=game-1&replay=true'
    }]);
    expect(pageErrors).toEqual([]);
});

for (const accessState of ['locked', 'unavailable', 'unlocked']) {
    test(`recorded replay access fails closed when Team Pass is ${accessState}`, async ({ page, baseURL }) => {
        const pageErrors = collectPageErrors(page);
        await page.addInitScript((state) => {
            window.__OVERLAY_RECORDED_VIDEO__ = true;
            window.__OVERLAY_TEAM_PASS_GATE__ = true;
            window.__OVERLAY_TEAM_PASS_STATE__ = state;
        }, accessState);
        await stubRealOverlayModules(page);

        await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => page.evaluate(() => window.__OVERLAY_ENTITLEMENT_READS__ || 0)).toBe(1);
        if (accessState === 'unlocked') {
            await expect(page.locator('#replay-access-gate')).toBeHidden();
            await expect(page.locator('#overlay-recorded-video')).toBeVisible();
            await expect(page.locator('#overlay-recorded-video')).toHaveAttribute('src', '/overlay-recording-fixture.mp4');
            await page.locator('#game-actions-toggle').click();
            await expect(page.locator('#match-report-link')).toBeVisible();
        } else {
            await expect(page.locator('#replay-access-gate')).toBeVisible();
            await expect(page.locator('#replay-access-gate')).toContainText(
                accessState === 'locked' ? 'Team Pass required' : 'Replay access could not be verified'
            );
            await expect(page.locator('#overlay-recorded-video')).not.toHaveAttribute('src', /.+/);
            await expect(page.locator('#open-stream')).toBeHidden();
        }
        expect(pageErrors).toEqual([]);
    });
}

test('completed game gates its recorded video without requiring replay query mode', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_RECORDED_VIDEO__ = true;
        window.__OVERLAY_TEAM_PASS_GATE__ = true;
        window.__OVERLAY_TEAM_PASS_STATE__ = 'locked';
        window.__OVERLAY_COMPLETED_GAME__ = true;
    });
    await stubRealOverlayModules(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => window.__OVERLAY_ENTITLEMENT_READS__ || 0)).toBe(1);
    await expect(page.locator('#replay-access-gate')).toBeVisible();
    await expect(page.locator('#replay-access-gate')).toContainText('Team Pass required');
    await expect(page.locator('#overlay-recorded-video')).not.toHaveAttribute('src', /.+/);
    await expect(page.locator('#open-stream')).toBeHidden();
    expect(pageErrors).toEqual([]);
});

test('signed-out viewers can read chat but cannot post from the overlay', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_AUTH_USER__ = null;
        sessionStorage.setItem('liveChatAnonName', 'Fan Riley');
    });
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
    await expect(page.locator('#chat-anon-notice')).toBeHidden();
    await expect(page.locator('#anon-edit')).toBeHidden();
    expect(await page.evaluate(() => sessionStorage.getItem('liveChatAnonName'))).toBe('Fan Riley');
    await expect(page.locator('#chat-reactions')).toBeHidden();
    expect(await page.evaluate(() => window.__OVERLAY_POSTED_CHAT__ || [])).toEqual([]);
    expect(pageErrors).toEqual([]);
});

test('signed-out public replay uses the sanitized projected game video when private replay metadata is unavailable', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_AUTH_USER__ = null;
        window.__OVERLAY_NO_RESOLVED_VIDEO__ = true;
    });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#overlay-video')).toHaveAttribute('src', /youtube\.com\/embed\/PK1HyC37doc/);
    await expect(page.locator('#open-stream')).toHaveAttribute('href', 'https://www.youtube.com/watch?v=PK1HyC37doc');
    await expect(page.locator('#replay-access-gate')).toBeHidden();
    expect(await page.evaluate(() => window.__OVERLAY_ENTITLEMENT_READS__ || 0)).toBe(0);
    expect(pageErrors).toEqual([]);
});

test('signed-out public replay can use a server-approved recording without private team context', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_AUTH_USER__ = null;
        window.__OVERLAY_NO_RESOLVED_VIDEO__ = true;
        window.__OVERLAY_PUBLIC_VIDEO_URL__ = 'https://cdn.example.test/public-replay.mp4';
        window.__OVERLAY_FAIL_TEAM_CONTEXT__ = true;
    });
    await page.route('https://cdn.example.test/public-replay.mp4', (route) => route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        body: ''
    }));
    await stubRealOverlayModules(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#overlay-recorded-video')).toHaveAttribute('src', 'https://cdn.example.test/public-replay.mp4');
    await expect(page.locator('#replay-access-gate')).toBeHidden();
    expect(await page.evaluate(() => window.__OVERLAY_ENTITLEMENT_READS__ || 0)).toBe(0);
    expect(pageErrors).toEqual([]);
});

test('signed-in viewers can choose the display name used for their authenticated chat posts', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-panel="chat"]').click();
    await expect(page.locator('#chat-anon-notice')).toContainText('Chatting as Alex Viewer');
    await page.locator('#anon-change-btn').click();
    await page.locator('#anon-input').fill('ALL PLAYS');
    await page.locator('#anon-save').click();
    await expect(page.locator('#chat-status')).toContainText('ALL PLAYS is a reserved name.');
    await expect(page.locator('#anon-edit')).toBeVisible();
    await page.locator('#anon-input').fill('  Riley   Blue  ');
    await page.locator('#anon-save').click();
    await expect(page.locator('#chat-anon-notice')).toContainText('Chatting as Riley Blue');
    expect(await page.evaluate(() => sessionStorage.getItem('liveChatDisplayName:viewer-1'))).toBe('Riley Blue');

    await page.locator('#chat-input').fill('Authenticated name override');
    await page.locator('#chat-form').getByRole('button', { name: 'Send', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__OVERLAY_POSTED_CHAT__ || [])).toEqual([{
        teamId: 'team-1',
        gameId: 'game-1',
        message: {
            text: 'Authenticated name override',
            senderId: 'viewer-1',
            senderName: 'Riley Blue',
            senderPhotoUrl: null,
            isAnonymous: false
        }
    }]);
    expect(pageErrors).toEqual([]);
});

test('signed-in mobile chat keeps mentions and every reaction reachable without overflow', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-team-name')).toHaveText('Current Academy');
    await page.evaluate(() => window.__OVERLAY_CHAT_CALLBACK__([{
        id: 'mobile-unread', senderName: 'Taylor', text: 'New mobile message', createdAt: Date.now() + 1000
    }]));
    await expect(page.locator('#chat-badge')).toHaveText('1');
    await expect(page.locator('#chat-badge')).toBeVisible();
    await page.locator('[data-panel="chat"]').click();
    await expect(page.locator('#chat-badge')).toBeHidden();
    await expect(page.locator('#insights-panel')).toBeVisible();
    await expect(page.locator('#chat-input')).toBeEnabled();
    await expect(page.locator('#chat-reactions .chat-reaction-button')).toHaveCount(5);

    const layout = await getResponsiveLayout(page);
    expectLayoutInsideViewport(layout);
    const chatBounds = await page.evaluate(() => {
        const panel = document.querySelector('#insights-panel').getBoundingClientRect();
        const composer = document.querySelector('#chat-form').getBoundingClientRect();
        return {
            composerLeft: composer.left,
            composerRight: composer.right,
            composerBottom: composer.bottom,
            panelLeft: panel.left,
            panelRight: panel.right,
            panelBottom: panel.bottom
        };
    });
    expect(chatBounds.composerLeft).toBeGreaterThanOrEqual(chatBounds.panelLeft);
    expect(chatBounds.composerRight).toBeLessThanOrEqual(chatBounds.panelRight);
    expect(chatBounds.composerBottom).toBeLessThanOrEqual(chatBounds.panelBottom);
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
    await page.locator('#chat-form').getByRole('button', { name: 'Send', exact: true }).click();

    await expect(page.locator('#chat-input')).toHaveValue('Keep this draft');
    await expect(page.locator('#chat-status')).toContainText('Message failed to send');
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#overlay-video')).toBeVisible();
    expect(pageErrors).toEqual([]);
});

test('ALL PLAYS failure posts the canonical fallback without disrupting the game', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => { window.__OVERLAY_FAIL_AI__ = true; });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-team-name')).toHaveText('Current Academy');
    await page.locator('[data-panel="chat"]').click();
    await page.locator('#chat-input').fill('@ALL PLAYS status?');
    await page.locator('#chat-form').getByRole('button', { name: 'Send', exact: true }).click();

    await expect(page.locator('#chat-list')).toContainText('ALL PLAYS is unavailable right now.');
    await expect(page.locator('#ai-thinking')).toBeHidden();
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#overlay-video')).toBeVisible();
    expect((await page.evaluate(() => window.__OVERLAY_POSTED_CHAT__)).at(-1).message).toEqual({
        text: 'ALL PLAYS is unavailable right now.',
        senderId: 'viewer-1',
        senderName: 'Alex Viewer',
        senderPhotoUrl: null,
        isAnonymous: false
    });
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
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
    await expect(page.locator('#home-score')).toHaveText('0');
    await expect(page.locator('#event-list')).not.toContainText('Lane opens the replay scoring');

    await page.locator('#replay-progress').evaluate((input) => {
        input.value = '50';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#replay-current')).toHaveText('5:45');
    await expect(page.locator('#game-clock')).toHaveText('5:45');
    await expect(page.locator('#home-score')).toHaveText('1');
    await expect(page.locator('#event-list')).toContainText('Lane opens the replay scoring');
    await expect(page.locator('#on-field-list')).toContainText('Sam Gray');
    await page.getByRole('button', { name: '50×' }).click();
    await page.getByRole('button', { name: 'Play replay' }).click();
    await expect(page.locator('#replay-play')).toHaveAttribute('data-replay-action', 'pause');
    await expect(page.locator('#replay-play .replay-pause-glyph')).toBeVisible();
    await expect(page.locator('#replay-current')).not.toHaveText('5:45');
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: 'Pause replay' }).click();
    await page.locator('[data-panel="insights"]').click();
    await page.locator('#leaders-tab').click();
    await expect(page.locator('#leader-list')).toContainText('1 GOALS');
    await expect(page.locator('#leader-list')).toContainText('1 SHOTS');
    await expect(page.locator('#event-list')).toContainText('Lane opens the replay scoring');
    await expect(page.locator('#event-list')).toContainText('Gray tests the keeper');
    await expect(page.locator('#replay-play')).toHaveAttribute('data-replay-action', 'play');
    await expect(page.locator('#replay-play .replay-play-glyph')).toBeVisible();
    await page.locator('[data-panel="chat"]').click();
    await expect(page.locator('#chat-list')).toContainText('Saved replay message');
    await expect(page.locator('#chat-list .chat-message strong')).toHaveText('Saved replay message');
    await expect(page.locator('#chat-list .chat-mention')).toHaveText('@ALL PLAYS');
    await expect(page.locator('#chat-list img.chat-avatar')).toBeVisible();
    await expect(page.locator('#chat-form')).toBeHidden();
    await expect(page.locator('#chat-reactions')).toBeHidden();

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
    await expect(page.locator('#game-clock')).toHaveText('11:30');

    await page.getByRole('button', { name: 'Restart replay' }).click();
    await expect(page.locator('#home-score')).toHaveText('0');
    await expect(page.locator('#game-clock')).toHaveText('0:00');
    await expect(page.locator('#chat-list')).not.toContainText('Saved replay message');
    await page.getByRole('button', { name: 'Pause replay' }).click();
    await page.getByRole('button', { name: '1×' }).click();
    await page.getByRole('button', { name: 'Play replay' }).click();
    await page.getByRole('button', { name: 'Pause replay' }).click();
    expect(await page.evaluate(() => window.__OVERLAY_LIVE_SUBSCRIPTIONS__ || 0)).toBe(0);
    await expect(page.locator('#overlay-video')).toHaveAttribute('src', /enablejsapi=1/);
    await expect.poll(async () => page.evaluate(() => (
        window.__OVERLAY_YOUTUBE_COMMANDS__ || []
    ).map((command) => command.func))).toEqual(expect.arrayContaining(['seekTo', 'playVideo', 'pauseVideo', 'setPlaybackRate']));
    expect(pageErrors).toEqual([]);
});

test('manual YouTube seeking rebuilds replay stats and the overlay offers canonical 50× catch-up', async ({ page, baseURL }) => {
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
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
    await expect(page.locator('#home-score')).toHaveText('0');

    const youtubeFrame = page.frames().find((frame) => frame.url().startsWith('https://www.youtube.com/embed/'));
    expect(youtubeFrame).toBeTruthy();
    await youtubeFrame.evaluate(() => {
        parent.postMessage(JSON.stringify({
            event: 'infoDelivery',
            info: { currentTime: 690, duration: 690, playerState: 2 }
        }), '*');
    });

    await expect(page.locator('#replay-current')).toHaveText('11:30');
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#away-score')).toHaveText('2');
    await expect(page.locator('#period')).toHaveText('H2');
    await expect(page.locator('#event-list')).toContainText('Lane scores the replay winner');
    await page.locator('[data-panel="insights"]').click();
    await page.getByRole('tab', { name: 'Leaders' }).click();
    await expect(page.locator('#leader-list')).toContainText('Avery Lane');
    await expect(page.locator('#leader-list')).toContainText('2 GOALS');

    const fiftyTimes = page.getByRole('button', { name: '50×' });
    await expect(fiftyTimes).toBeVisible();
    await fiftyTimes.click();
    await expect(fiftyTimes).toHaveAttribute('aria-pressed', 'true');

    await page.evaluate(() => { window.__OVERLAY_YOUTUBE_COMMANDS__ = []; });
    await page.getByRole('button', { name: 'Play replay' }).click();
    await expect(page.locator('#replay-current')).not.toHaveText('0:00');
    await expect(page.locator('#replay-scan-status')).toContainText('50× game scan');
    await expect(page.locator('#replay-scan-status')).toContainText('Video catches up when paused');
    const scanPresentation = await page.locator('#replay-scan-status').evaluate((element) => {
        const rectangle = element.getBoundingClientRect();
        const stage = document.querySelector('#broadcast-stage').getBoundingClientRect();
        const backgroundColor = getComputedStyle(element).backgroundColor;
        const alphaMatch = backgroundColor.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
        return {
            coversStage: Math.abs(rectangle.left - stage.left) < 1
                && Math.abs(rectangle.right - stage.right) < 1
                && Math.abs(rectangle.top - stage.top) < 1
                && Math.abs(rectangle.bottom - stage.bottom) < 1,
            hasOpaqueBackground: !alphaMatch || Number(alphaMatch[1]) === 1
        };
    });
    expect(scanPresentation).toEqual({ coversStage: true, hasOpaqueBackground: true });
    await page.waitForTimeout(700);
    const scanningCommands = await page.evaluate(() => window.__OVERLAY_YOUTUBE_COMMANDS__ || []);
    expect(scanningCommands.filter((command) => command.func === 'seekTo')).toHaveLength(1);
    expect(scanningCommands.some((command) => command.func === 'pauseVideo')).toBe(true);
    expect(scanningCommands.some((command) => command.func === 'playVideo')).toBe(false);

    await page.getByRole('button', { name: 'Pause replay' }).click();
    await expect(page.locator('#replay-scan-status')).toBeHidden();
    await expect.poll(async () => page.evaluate(() => (
        window.__OVERLAY_YOUTUBE_COMMANDS__ || []
    ).filter((command) => command.func === 'seekTo').length)).toBe(2);
    expect(pageErrors).toEqual([]);
});

test('mobile replay controls stay on screen without covering the scoreboard', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#replay-controls')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restart replay' })).toBeVisible();
    await expect(page.getByRole('button', { name: '4×' })).toBeVisible();
    const twentyTimes = page.getByRole('button', { name: '20×' });
    await expect(twentyTimes).toBeVisible();
    await twentyTimes.click();
    await page.getByRole('button', { name: 'Play replay' }).click();
    await expect(page.locator('#replay-scan-status')).toBeVisible();
    await expect(page.locator('#replay-scan-status')).toContainText('20× game scan');
    const scanBounds = await page.locator('#replay-scan-status').evaluate((element) => {
        const rectangle = element.getBoundingClientRect();
        const stage = document.querySelector('#broadcast-stage').getBoundingClientRect();
        return {
            left: rectangle.left,
            right: rectangle.right,
            top: rectangle.top,
            bottom: rectangle.bottom,
            stageLeft: stage.left,
            stageRight: stage.right,
            stageTop: stage.top,
            stageBottom: stage.bottom
        };
    });
    expect(scanBounds.left).toBeCloseTo(scanBounds.stageLeft, 0);
    expect(scanBounds.right).toBeCloseTo(scanBounds.stageRight, 0);
    expect(scanBounds.top).toBeCloseTo(scanBounds.stageTop, 0);
    expect(scanBounds.bottom).toBeCloseTo(scanBounds.stageBottom, 0);
    await page.getByRole('button', { name: 'Pause replay' }).click();

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

    await page.locator('#scoreboard-toggle').click();
    await expect(page.locator('#score-bug')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#score-bug')).toHaveCSS('visibility', 'hidden');
    const hiddenScoreLayout = await page.evaluate(() => ({
        scoreVisibility: getComputedStyle(document.querySelector('#score-bug')).visibility,
        controlsTop: document.querySelector('#replay-controls').getBoundingClientRect().top,
        controlsRight: document.querySelector('#replay-controls').getBoundingClientRect().right,
        viewportWidth: window.innerWidth
    }));
    expect(hiddenScoreLayout.scoreVisibility).toBe('hidden');
    expect(hiddenScoreLayout.controlsTop).toBeLessThanOrEqual(80);
    expect(hiddenScoreLayout.controlsRight).toBeLessThanOrEqual(hiddenScoreLayout.viewportWidth);
    expect(pageErrors).toEqual([]);
});

test('recorded replay scan keeps the event timeline moving while the video is intentionally paused', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => { window.__OVERLAY_RECORDED_VIDEO__ = true; });
    await stubRealOverlayModules(page);
    await page.route('**/overlay-recording-fixture.mp4', (route) => route.abort());

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
    const playbackButton = page.locator('#replay-play');
    await expect(playbackButton).toBeVisible();
    await page.getByRole('button', { name: '50×' }).click();
    if (await playbackButton.getAttribute('data-replay-action') === 'play') {
        await playbackButton.click();
    }
    await expect(playbackButton).toHaveAttribute('data-replay-action', 'pause');
    await page.locator('#overlay-recorded-video').dispatchEvent('pause');

    await expect(page.locator('#replay-scan-status')).toBeVisible();
    await expect(page.locator('#replay-current')).not.toHaveText('0:00');
    await expect(page.getByRole('button', { name: 'Pause replay' })).toBeVisible();
    expect(pageErrors).toEqual([]);
});

test('a delayed recorded replay joins the current timeline instead of restarting out of sync', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_RECORDED_VIDEO__ = true;
        window.__OVERLAY_DELAY_TEAM_CONTEXT__ = true;
        Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
            configurable: true,
            get() { return 690; }
        });
        Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
            configurable: true,
            get() { return this.__overlayCurrentTime || 0; },
            set(value) { this.__overlayCurrentTime = Number(value) || 0; }
        });
        HTMLMediaElement.prototype.play = function play() {
            this.__overlayPlayCalls = (this.__overlayPlayCalls || 0) + 1;
            return Promise.resolve();
        };
        HTMLMediaElement.prototype.pause = function pause() {
            this.__overlayPauseCalls = (this.__overlayPauseCalls || 0) + 1;
        };
        HTMLMediaElement.prototype.load = function load() {};
    });
    await stubRealOverlayModules(page);
    await page.route('**/overlay-recording-fixture.mp4', (route) => route.abort());

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#replay-controls')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
    await page.locator('#replay-progress').evaluate((input) => {
        input.value = '50';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#replay-current')).toHaveText('5:45');
    await expect(page.locator('#home-score')).toHaveText('1');
    await expect(page.locator('#overlay-recorded-video')).toBeHidden();

    await page.evaluate(() => window.__OVERLAY_RELEASE_TEAM_CONTEXT__());
    await expect(page.locator('#overlay-recorded-video')).toBeVisible();
    await page.locator('#overlay-recorded-video').dispatchEvent('loadedmetadata');
    await expect.poll(() => page.locator('#overlay-recorded-video').evaluate((video) => video.currentTime)).toBe(345);
    await expect(page.locator('#home-score')).toHaveText('1');
    expect(pageErrors).toEqual([]);
});

test('optional team context retries a transient first read before applying stream settings', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => { window.__OVERLAY_FAIL_TEAM_CONTEXT_ONCE__ = true; });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => window.__OVERLAY_GET_TEAM_CONTEXT_CALLS__)).toBe(2);
    await expect(page.locator('#home-team-photo')).toHaveAttribute('src', /current-academy\.svg/);
    await expect(page.locator('#overlay-video')).toBeVisible();
    await expect(page.locator('#connection-message')).toBeHidden();
    expect(pageErrors).toEqual([]);
});

test('repeated team context failure stays passive to the live game feed', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => { window.__OVERLAY_FAIL_TEAM_CONTEXT__ = true; });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => page.evaluate(() => window.__OVERLAY_GET_TEAM_CONTEXT_CALLS__)).toBe(2);
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#away-score')).toHaveText('2');
    await expect(page.locator('#overlay-video')).toBeVisible();
    await expect(page.locator('#connection-message')).toContainText('after two attempts');
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
    await expect(page.locator('#connection-message')).toContainText('after two attempts');
    await expect(page.locator('#event-list')).toContainText('temporarily unavailable');
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeDisabled();
    expect(await page.evaluate(() => ({
        events: window.__OVERLAY_GET_REPLAY_EVENTS_CALLS__,
        chat: window.__OVERLAY_GET_REPLAY_CHAT_CALLS__,
        reactions: window.__OVERLAY_GET_REPLAY_REACTIONS_CALLS__
    }))).toEqual({ events: 2, chat: 2, reactions: 2 });
    expect(await page.evaluate(() => window.__OVERLAY_LIVE_SUBSCRIPTIONS__ || 0)).toBe(0);
    expect(pageErrors).toEqual([]);
});

test('replay history retries a transient first-load failure before exposing the timeline', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_FAIL_REPLAY_EVENTS_ONCE__ = true;
        window.__OVERLAY_FAIL_REPLAY_CHAT_ONCE__ = true;
        window.__OVERLAY_FAIL_REPLAY_REACTIONS_ONCE__ = true;
    });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeEnabled();
    await expect(page.locator('#replay-duration')).toHaveText('11:30');
    await expect(page.locator('#connection-message')).toBeHidden();
    expect(await page.evaluate(() => ({
        events: window.__OVERLAY_GET_REPLAY_EVENTS_CALLS__,
        chat: window.__OVERLAY_GET_REPLAY_CHAT_CALLS__,
        reactions: window.__OVERLAY_GET_REPLAY_REACTIONS_CALLS__
    }))).toEqual({ events: 2, chat: 2, reactions: 2 });
    expect(pageErrors).toEqual([]);
});

test('replay chat remains aligned when the first tracked event starts mid-game', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => { window.__OVERLAY_RESUMED_REPLAY__ = true; });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#replay-duration')).toHaveText('21:00');
    await page.locator('[data-panel="chat"]').click();
    await page.locator('#replay-progress').evaluate((input) => {
        input.value = '50';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#chat-list')).not.toContainText('Twenty-one minute update');

    await page.locator('#replay-progress').evaluate((input) => {
        input.value = '100';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(page.locator('#chat-list')).toContainText('Twenty-one minute update');

    // YouTube may acknowledge rapid seek commands out of order. A delayed
    // echo from the earlier 50% seek must not rewind the latest 100% state.
    const youtubeFrame = page.frames().find((frame) => frame.url().startsWith('https://www.youtube.com/embed/'));
    expect(youtubeFrame).toBeTruthy();
    await youtubeFrame.evaluate(() => {
        parent.postMessage(JSON.stringify({
            event: 'infoDelivery',
            info: { currentTime: 630, playerState: 2 }
        }), '*');
    });
    await page.waitForTimeout(50);
    await expect(page.locator('#chat-list')).toContainText('Twenty-one minute update');

    // A stale pause acknowledgement from an earlier seek must not pause active
    // playback after a newer seek has already been accepted by the player.
    await page.locator('#replay-progress').evaluate((input) => {
        input.value = '80';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.value = '90';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.getByRole('button', { name: 'Play replay' }).click();
    await expect(page.getByRole('button', { name: 'Pause replay' })).toBeVisible();
    await youtubeFrame.evaluate(() => {
        parent.postMessage(JSON.stringify({
            event: 'infoDelivery',
            info: { currentTime: 1008, playerState: 2 }
        }), '*');
    });
    await page.waitForTimeout(50);
    await expect(page.getByRole('button', { name: 'Pause replay' })).toBeVisible();
    await expect(page.locator('#replay-current')).not.toHaveText('16:48');
    await page.getByRole('button', { name: 'Pause replay' }).click();
    expect(pageErrors).toEqual([]);
});

test('replay excludes stale events and conversation from before the latest tracker reset', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_RESET_REPLAY__ = true;
    });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#replay-duration')).toHaveText('0:30');
    await page.locator('#replay-progress').evaluate((input) => {
        input.value = '100';
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await expect(page.locator('#home-score')).toHaveText('1');
    await expect(page.locator('#event-list')).toContainText('Fresh post-reset goal');
    await expect(page.locator('#event-list')).not.toContainText('Stale pre-reset goal');
    await page.locator('[data-panel="chat"]').click();
    await expect(page.locator('#chat-list')).toContainText('Fresh chat after reset');
    await expect(page.locator('#chat-list')).not.toContainText('Stale chat before reset');
    expect(pageErrors).toEqual([]);
});

test('a complete empty replay history remains distinct from a failed history load', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => { window.__OVERLAY_EMPTY_REPLAY_EVENTS__ = true; });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#home-score')).toHaveText('3');
    await expect(page.locator('#away-score')).toHaveText('2');
    await expect(page.locator('#event-list')).toContainText('Replay ready');
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeEnabled();
    await expect(page.locator('#connection-message')).toBeHidden();
    expect(await page.evaluate(() => window.__OVERLAY_GET_REPLAY_EVENTS_CALLS__)).toBe(1);
    expect(pageErrors).toEqual([]);
});

test('optional roster loading recovers once without hiding lineup positions', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => { window.__OVERLAY_FAIL_PLAYERS_ONCE__ = true; });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#on-field-list')).toContainText('Avery Lane');
    await expect(page.locator('#bench-list')).toContainText('Sam Gray');
    await expect(page.locator('#connection-message')).toBeHidden();
    expect(await page.evaluate(() => window.__OVERLAY_GET_PLAYERS_CALLS__)).toBe(2);
    expect(pageErrors).toEqual([]);
});

test('repeated roster failure preserves live lineup positions and surfaces a retryable warning', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => { window.__OVERLAY_FAIL_PLAYERS__ = true; });
    await stubRealOverlayModules(page);
    await stubYouTubeEmbed(page);

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#on-field-list')).toContainText('Player 1');
    await expect(page.locator('#bench-list')).toContainText('Player 1');
    await expect(page.locator('#connection-message')).toContainText('after two attempts');
    await expect(page.locator('#connection-message')).toContainText('refresh to retry');
    expect(await page.evaluate(() => window.__OVERLAY_GET_PLAYERS_CALLS__)).toBe(2);
    expect(pageErrors).toEqual([]);
});

test('recorded replay does not advance when browser playback is rejected', async ({ page, baseURL }) => {
    const pageErrors = collectPageErrors(page);
    await page.addInitScript(() => {
        window.__OVERLAY_RECORDED_VIDEO__ = true;
        Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
            configurable: true,
            get() { return 690; }
        });
        HTMLMediaElement.prototype.play = function play() {
            this.__overlayPlayCalls = (this.__overlayPlayCalls || 0) + 1;
            return Promise.reject(new Error('autoplay blocked'));
        };
        HTMLMediaElement.prototype.pause = function pause() {};
        HTMLMediaElement.prototype.load = function load() {};
    });
    await stubRealOverlayModules(page);
    await page.route('**/overlay-recording-fixture.mp4', (route) => route.abort());

    await page.goto(`${baseURL}/live-game-overlay.html?teamId=team-1&gameId=game-1&replay=true`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#overlay-recorded-video')).toBeVisible();
    await page.getByRole('button', { name: 'Play replay' }).click();
    await expect(page.getByRole('button', { name: 'Play replay' })).toBeVisible();
    await expect(page.locator('#replay-current')).toHaveText('0:00');
    await expect(page.locator('#connection-message')).toContainText('playback was blocked');
    expect(await page.locator('#overlay-recorded-video').evaluate((video) => video.__overlayPlayCalls)).toBe(1);
    expect(pageErrors).toEqual([]);
});
