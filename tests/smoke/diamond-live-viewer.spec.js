import { expect, test } from '@playwright/test';

const FIREBASE_STUB = `
export const functions = {};
export function httpsCallable(_functions, name) {
    if (name !== 'getPublicDiamondGame') throw new Error('Unexpected callable: ' + name);
    return async (request) => {
        window.__DIAMOND_PUBLIC_READS__ = (window.__DIAMOND_PUBLIC_READS__ || 0) + 1;
        const terminal = window.__DIAMOND_TERMINAL__ === true;
        const game = {
            teamName: 'Home Hawks',
            opponent: 'Away Aces',
            trackingEngine: 'diamond-v2',
            warnings: ['Pitch detail is partially captured'],
            state: {
                revision: 8,
                homeScore: 3,
                awayScore: 2,
                inning: 6,
                half: 'bottom',
                balls: 2,
                strikes: 1,
                outs: 1,
                bases: { first: true, second: false, third: true },
                batterName: 'Jordan Lee',
                pitcherName: 'Riley Chen',
                status: terminal ? 'correction' : 'in_progress',
                completeness: 'partial'
            }
        };
        if (request.cursor) {
            return { data: {
                game,
                events: [{
                    id: 'play-3', revision: 3, inning: 2, half: 'top',
                    description: 'Ground out to shortstop',
                    score: { home: 1, away: 1 }
                }],
                nextCursor: null,
                complete: true,
                sourceRevision: 8
            } };
        }
        return { data: {
            game,
            events: [
                {
                    id: 'play-8', revision: 8, inning: 6, half: 'bottom',
                    description: 'Jordan Lee doubled; one run scored',
                    isScoringPlay: true,
                    score: { home: 3, away: 2 }
                },
                {
                    id: 'play-7', revision: 7, inning: 6, half: 'bottom',
                    description: 'Scoring correction applied',
                    isCorrection: true,
                    score: { home: 2, away: 2 }
                }
            ],
            nextCursor: 'before-7',
            complete: false,
            sourceRevision: 8
        } };
    };
}
`;

const DB_STUB = `
export function subscribeLiveChat(_teamId, _gameId, _options, onData) {
    window.__DIAMOND_CHAT_CALLBACK__ = onData;
    onData([{ id: 'chat-1', senderName: 'Morgan', text: 'Great play!' }]);
    return () => { window.__DIAMOND_CHAT_UNSUBSCRIBED__ = true; };
}
export function subscribeReactions(_teamId, _gameId, onData) {
    window.__DIAMOND_REACTION_CALLBACK__ = onData;
    return () => { window.__DIAMOND_REACTIONS_UNSUBSCRIBED__ = true; };
}
export async function postLiveChatMessage(teamId, gameId, message) {
    window.__DIAMOND_POSTED_CHAT__ = { teamId, gameId, message };
}
export async function sendReaction(teamId, gameId, reaction) {
    window.__DIAMOND_SENT_REACTION__ = { teamId, gameId, reaction };
}
`;

const AUTH_STUB = `
export function checkAuth(callback) {
    callback({ uid: 'viewer-1', displayName: 'Alex Viewer' });
    return () => { window.__DIAMOND_AUTH_UNSUBSCRIBED__ = true; };
}
`;

async function stubDiamondViewerModules(page) {
    await page.route(/\/js\/firebase\.js(?:\?.*)?$/, (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: FIREBASE_STUB })
    );
    await page.route(/\/js\/db\.js(?:\?.*)?$/, (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: DB_STUB })
    );
    await page.route(/\/js\/auth\.js(?:\?.*)?$/, (route) =>
        route.fulfill({ status: 200, contentType: 'application/javascript', body: AUTH_STUB })
    );
}

test('Diamond viewer renders revision-pinned replay and shares classic chat and reactions', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await stubDiamondViewerModules(page);

    await page.goto(`${baseURL}/live-game-diamond-v2.html?teamId=team-1&gameId=game-1`, {
        waitUntil: 'domcontentloaded'
    });

    expect(pageErrors).toEqual([]);
    await expect(page.locator('[data-diamond-home-name]')).toHaveText('Home Hawks');
    await expect(page.locator('[data-diamond-away-name]')).toHaveText('Away Aces');
    await expect(page.locator('[data-diamond-home-score]')).toHaveText('3');
    await expect(page.locator('[data-diamond-away-score]')).toHaveText('2');
    await expect(page.locator('[data-diamond-inning]')).toHaveText('Bottom 6');
    await expect(page.locator('[data-diamond-content]')).toHaveAttribute('data-completeness', 'partial');
    await expect(page.locator('[data-diamond-plays] li')).toHaveCount(2);
    await expect(page.locator('[data-diamond-plays]')).toContainText('Scoring correction applied');
    await expect(page.locator('[data-diamond-chat]')).toContainText('Great play!');

    await page.locator('[data-diamond-load-more]').click();
    await expect(page.locator('[data-diamond-plays] li')).toHaveCount(3);
    await expect(page.locator('[data-diamond-plays]')).toContainText('Ground out to shortstop');
    await expect(page.locator('[data-diamond-load-more]')).toBeHidden();

    await page.locator('[data-diamond-chat-input]').fill('What a double');
    await page.locator('[data-diamond-chat-submit]').click();
    await expect.poll(() => page.evaluate(() => window.__DIAMOND_POSTED_CHAT__)).toMatchObject({
        teamId: 'team-1',
        gameId: 'game-1',
        message: { text: 'What a double', senderId: 'viewer-1', senderName: 'Alex Viewer' }
    });
    await page.locator('[data-diamond-reaction="clap"]').click();
    await expect.poll(() => page.evaluate(() => window.__DIAMOND_SENT_REACTION__)).toMatchObject({
        teamId: 'team-1',
        gameId: 'game-1',
        reaction: { type: 'clap', senderId: 'viewer-1' }
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    expect(pageErrors).toEqual([]);
});

test('correction-mode replay stays readable while every engagement write is disabled', async ({ page, baseURL }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => { window.__DIAMOND_TERMINAL__ = true; });
    await stubDiamondViewerModules(page);

    await page.goto(`${baseURL}/live-game-diamond-v2.html?teamId=team-1&gameId=game-1`, {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('[data-diamond-inning]')).toHaveText('Final');
    await expect(page.locator('[data-diamond-chat-input]')).toBeDisabled();
    await expect(page.locator('[data-diamond-chat-submit]')).toBeDisabled();
    await expect(page.locator('[data-diamond-reaction="fire"]')).toBeDisabled();
    await expect(page.locator('[data-diamond-engagement-status]')).toContainText('read-only replay');
    expect(pageErrors).toEqual([]);
});
