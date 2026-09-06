import { expect, test } from "@playwright/test";

const FIREBASE_STUB = `
export const functions = {};
export function httpsCallable(_functions, name) {
    if (name === 'postDiamondLiveChat') {
        return async (request) => {
            window.__DIAMOND_POSTED_CHAT__ = request;
            window.__DIAMOND_POSTED_CHATS__ = [...(window.__DIAMOND_POSTED_CHATS__ || []), request];
            if (window.__DIAMOND_FAIL_CHAT_ONCE__ === true && window.__DIAMOND_CHAT_FAILED__ !== true) {
                window.__DIAMOND_CHAT_FAILED__ = true;
                throw Object.assign(new Error('Ambiguous chat response'), { code: 'functions/unavailable' });
            }
            return { data: {
                outcome: 'accepted',
                requestId: request.requestId,
                instanceId: request.expectedInstanceId,
                messageId: 'diamond-chat-confirmed'
            } };
        };
    }
    if (name === 'postDiamondLiveReaction') {
        return async (request) => {
            window.__DIAMOND_SENT_REACTION__ = request;
            window.__DIAMOND_SENT_REACTIONS__ = [...(window.__DIAMOND_SENT_REACTIONS__ || []), request];
            return { data: {
                outcome: 'accepted',
                requestId: request.requestId,
                instanceId: request.expectedInstanceId,
                reactionId: 'diamond-reaction-confirmed'
            } };
        };
    }
    if (name !== 'getPublicDiamondGame') throw new Error('Unexpected callable: ' + name);
    return async (request) => {
        window.__DIAMOND_PUBLIC_READS__ = (window.__DIAMOND_PUBLIC_READS__ || 0) + 1;
        if (window.__DIAMOND_DELAY_PUBLIC_READ__ === true) {
            await new Promise((resolve) => { window.__DIAMOND_RELEASE_PUBLIC_READ__ = resolve; });
        }
        const terminal = window.__DIAMOND_TERMINAL__ === true;
        const instanceId = window.__DIAMOND_INSTANCE_ID__ === undefined
            ? '00000000-0000-4000-8000-000000000001'
            : window.__DIAMOND_INSTANCE_ID__;
        const game = {
            teamName: 'Home Hawks',
            opponent: 'Away Aces',
            startsAt: window.__DIAMOND_STARTS_AT__ || new Date().toISOString(),
            trackingEngine: window.__DIAMOND_ENGINE__ || 'diamond-v2',
            media: window.__DIAMOND_MEDIA__ === true ? {
                mode: 'replay',
                publicUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                durationMs: 90000
            } : null,
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
                status: window.__DIAMOND_STATUS__ || (terminal ? 'correction' : 'active'),
                completeness: 'partial'
            }
        };
        if (request.cursor) {
            return { data: {
                instanceId,
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
            instanceId,
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
export function subscribeLiveChat(teamId, gameId, options, onData) {
    window.__DIAMOND_CHAT_SUBSCRIPTIONS__ = (window.__DIAMOND_CHAT_SUBSCRIPTIONS__ || 0) + 1;
    window.__DIAMOND_CHAT_CONTEXT__ = { teamId, gameId, options };
    window.__DIAMOND_CHAT_CALLBACK__ = onData;
    onData([
        { id: 'chat-1', senderName: 'Morgan', text: 'Great play!' },
        {
            id: 'chat-2',
            senderName: '<img src=x onerror="window.__DIAMOND_XSS__=true">',
            text: '<img src=x onerror="window.__DIAMOND_XSS__=true">'
        }
    ]);
    return () => { window.__DIAMOND_CHAT_UNSUBSCRIBED__ = true; };
}
export function subscribeReactions(teamId, gameId, options, onData) {
    window.__DIAMOND_REACTION_SUBSCRIPTIONS__ = (window.__DIAMOND_REACTION_SUBSCRIPTIONS__ || 0) + 1;
    window.__DIAMOND_REACTION_CONTEXT__ = { teamId, gameId, options };
    window.__DIAMOND_REACTION_CALLBACK__ = onData;
    return () => { window.__DIAMOND_REACTIONS_UNSUBSCRIBED__ = true; };
}
`;

const AUTH_STUB = `
export function checkAuth(callback) {
    window.__DIAMOND_AUTH_SUBSCRIPTIONS__ = (window.__DIAMOND_AUTH_SUBSCRIPTIONS__ || 0) + 1;
    callback({ uid: 'viewer-1', displayName: 'Alex Viewer' });
    return () => { window.__DIAMOND_AUTH_UNSUBSCRIBED__ = true; };
}
`;

async function stubDiamondViewerModules(page) {
  await page.route(/\/js\/firebase\.js(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: FIREBASE_STUB,
    }),
  );
  await page.route(/\/js\/diamond-live-engagement-subscriptions\.js(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: DB_STUB,
    }),
  );
  await page.route(/\/js\/auth\.js(?:\?.*)?$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: AUTH_STUB,
    }),
  );
}

test("Diamond viewer renders revision-pinned replay and shares classic chat and reactions", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await stubDiamondViewerModules(page);

  await page.goto(
    `${baseURL}/live-game-diamond-v2.html?teamId=team-1&gameId=game-1`,
    {
      waitUntil: "domcontentloaded",
    },
  );

  expect(pageErrors).toEqual([]);
  await expect(page.locator("[data-diamond-home-name]")).toHaveText(
    "Home Hawks",
  );
  await expect(page.locator("[data-diamond-away-name]")).toHaveText(
    "Away Aces",
  );
  await expect(page.locator("[data-diamond-home-score]")).toHaveText("3");
  await expect(page.locator("[data-diamond-away-score]")).toHaveText("2");
  await expect(page.locator("[data-diamond-inning]")).toHaveText("Bottom 6");
  await expect(page.locator("[data-diamond-content]")).toHaveAttribute(
    "data-completeness",
    "partial",
  );
  await expect(page.locator("[data-diamond-plays] li")).toHaveCount(2);
  await expect(page.locator("[data-diamond-plays]")).toContainText(
    "Scoring correction applied",
  );
  await expect(page.locator("[data-diamond-chat]")).toContainText(
    "Great play!",
  );
  expect(
    await page.evaluate(() => ({
      chat: window.__DIAMOND_CHAT_CONTEXT__,
      reaction: window.__DIAMOND_REACTION_CONTEXT__,
    })),
  ).toEqual({
    chat: {
      teamId: "team-1",
      gameId: "game-1",
      options: {
        limit: 100,
        instanceId: "00000000-0000-4000-8000-000000000001",
      },
    },
    reaction: {
      teamId: "team-1",
      gameId: "game-1",
      options: {
        instanceId: "00000000-0000-4000-8000-000000000001",
      },
    },
  });
  await expect(page.locator("[data-diamond-chat]")).toContainText(
    '<img src=x onerror="window.__DIAMOND_XSS__=true">',
  );
  await expect(page.locator("[data-diamond-chat] img")).toHaveCount(0);
  expect(await page.evaluate(() => window.__DIAMOND_XSS__)).toBeUndefined();

  await page.locator("[data-diamond-load-more]").click();
  await expect(page.locator("[data-diamond-plays] li")).toHaveCount(3);
  await expect(page.locator("[data-diamond-plays]")).toContainText(
    "Ground out to shortstop",
  );
  await expect(page.locator("[data-diamond-load-more]")).toBeHidden();

  await page.locator("[data-diamond-chat-input]").fill("What a double");
  await page.locator("[data-diamond-chat-submit]").click();
  await expect
    .poll(() => page.evaluate(() => window.__DIAMOND_POSTED_CHAT__))
    .toMatchObject({
      schemaVersion: 1,
      teamId: "team-1",
      gameId: "game-1",
      expectedInstanceId: "00000000-0000-4000-8000-000000000001",
      viewerMode: "live",
      text: "What a double",
    });
  const chatWrite = await page.evaluate(() => window.__DIAMOND_POSTED_CHAT__);
  expect(chatWrite.requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(Object.keys(chatWrite).sort()).toEqual([
    "expectedInstanceId",
    "gameId",
    "requestId",
    "schemaVersion",
    "teamId",
    "text",
    "viewerMode",
  ]);
  await page.locator('[data-diamond-reaction="clap"]').click();
  await expect
    .poll(() => page.evaluate(() => window.__DIAMOND_SENT_REACTION__))
    .toMatchObject({
      schemaVersion: 1,
      teamId: "team-1",
      gameId: "game-1",
      expectedInstanceId: "00000000-0000-4000-8000-000000000001",
      viewerMode: "live",
      type: "clap",
    });
  await page.locator('[data-diamond-reaction="fire"]').click();
  await page.waitForTimeout(50);
  expect(
    await page.evaluate(() => window.__DIAMOND_SENT_REACTIONS__?.length),
  ).toBe(1);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event("beforeunload")));
  expect(
    await page.evaluate(() => ({
      auth: window.__DIAMOND_AUTH_UNSUBSCRIBED__,
      chat: window.__DIAMOND_CHAT_UNSUBSCRIBED__,
      reactions: window.__DIAMOND_REACTIONS_UNSUBSCRIBED__,
    })),
  ).toEqual({ auth: true, chat: true, reactions: true });
  expect(pageErrors).toEqual([]);
});

test("engagement writes stay fail-closed until the authoritative Diamond game loads", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    window.__DIAMOND_DELAY_PUBLIC_READ__ = true;
  });
  await stubDiamondViewerModules(page);

  await page.goto(
    `${baseURL}/live-game-diamond-v2.html?teamId=team-1&gameId=game-1`,
    { waitUntil: "domcontentloaded" },
  );

  await expect(page.locator("[data-diamond-chat-input]")).toBeDisabled();
  expect(
    await page.evaluate(() => ({
      auth: window.__DIAMOND_AUTH_SUBSCRIPTIONS__ || 0,
      chat: window.__DIAMOND_CHAT_SUBSCRIPTIONS__ || 0,
      reactions: window.__DIAMOND_REACTION_SUBSCRIPTIONS__ || 0,
    })),
  ).toEqual({ auth: 0, chat: 0, reactions: 0 });
  await page.evaluate(() => {
    const input = document.querySelector("[data-diamond-chat-input]");
    input.value = "Too early";
    document
      .querySelector("[data-diamond-chat-form]")
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(
    await page.evaluate(() => window.__DIAMOND_POSTED_CHAT__),
  ).toBeUndefined();

  await page.evaluate(() => window.__DIAMOND_RELEASE_PUBLIC_READ__());
  await expect(page.locator("[data-diamond-home-name]")).toHaveText(
    "Home Hawks",
  );
  await expect(page.locator("[data-diamond-chat-input]")).toBeEnabled();
  await expect(page.locator("[data-diamond-chat]")).toContainText(
    "Great play!",
  );
});

test("an uncertain chat retry reuses the same secure content-bound request", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    window.__DIAMOND_FAIL_CHAT_ONCE__ = true;
  });
  await stubDiamondViewerModules(page);
  await page.goto(
    `${baseURL}/live-game-diamond-v2.html?teamId=team-1&gameId=game-1`,
    { waitUntil: "domcontentloaded" },
  );

  const input = page.locator("[data-diamond-chat-input]");
  await input.fill("Retry this message");
  await page.locator("[data-diamond-chat-submit]").click();
  await expect(page.locator("[data-diamond-engagement-status]")).toContainText(
    "retry without changing it",
  );
  await page.waitForTimeout(1550);
  await page.locator("[data-diamond-chat-submit]").click();
  await expect(input).toHaveValue("");

  const requests = await page.evaluate(() => window.__DIAMOND_POSTED_CHATS__);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
});

test("missing Diamond generation identity fails all engagement listeners and writes closed", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    window.__DIAMOND_INSTANCE_ID__ = "";
  });
  await stubDiamondViewerModules(page);
  await page.goto(
    `${baseURL}/live-game-diamond-v2.html?teamId=team-1&gameId=game-1`,
    { waitUntil: "domcontentloaded" },
  );

  await expect(page.locator("[data-diamond-error]")).toContainText(
    "temporarily unavailable",
  );
  expect(
    await page.evaluate(() => ({
      auth: window.__DIAMOND_AUTH_SUBSCRIPTIONS__ || 0,
      chat: window.__DIAMOND_CHAT_SUBSCRIPTIONS__ || 0,
      reactions: window.__DIAMOND_REACTION_SUBSCRIPTIONS__ || 0,
      posted: window.__DIAMOND_POSTED_CHATS__ || [],
    })),
  ).toEqual({ auth: 0, chat: 0, reactions: 0, posted: [] });
});

test("a non-Diamond game never starts shared collection or auth listeners", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    window.__DIAMOND_ENGINE__ = "legacy";
  });
  await stubDiamondViewerModules(page);

  await page.goto(
    `${baseURL}/live-game-diamond-v2.html?teamId=team-1&gameId=game-1`,
    { waitUntil: "domcontentloaded" },
  );

  await expect(page.locator("[data-diamond-error]")).toHaveText(
    "This Diamond game is not available.",
  );
  expect(
    await page.evaluate(() => ({
      auth: window.__DIAMOND_AUTH_SUBSCRIPTIONS__ || 0,
      chat: window.__DIAMOND_CHAT_SUBSCRIPTIONS__ || 0,
      reactions: window.__DIAMOND_REACTION_SUBSCRIPTIONS__ || 0,
    })),
  ).toEqual({ auth: 0, chat: 0, reactions: 0 });
});

test("configured games reuse classic game-day timing while retaining shared history", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    window.__DIAMOND_STATUS__ = "configured";
    window.__DIAMOND_STARTS_AT__ = "2099-06-03T18:00:00.000Z";
  });
  await stubDiamondViewerModules(page);

  await page.goto(
    `${baseURL}/live-game-diamond-v2.html?teamId=team-1&gameId=game-1`,
    { waitUntil: "domcontentloaded" },
  );

  await expect(page.locator("[data-diamond-chat]")).toContainText(
    "Great play!",
  );
  await expect(page.locator("[data-diamond-chat-input]")).toBeDisabled();
  await expect(page.locator('[data-diamond-reaction="heart"]')).toBeDisabled();
  await expect(page.locator("[data-diamond-engagement-status]")).toHaveText(
    "Live chat opens on game day.",
  );
  expect(
    await page.evaluate(() => window.__DIAMOND_AUTH_SUBSCRIPTIONS__ || 0),
  ).toBe(0);
});

test("malformed projected lifecycle data fails engagement writes closed", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    window.__DIAMOND_STATUS__ = " ACTIVE ";
  });
  await stubDiamondViewerModules(page);

  await page.goto(
    `${baseURL}/live-game-diamond-v2.html?teamId=team-1&gameId=game-1`,
    { waitUntil: "domcontentloaded" },
  );

  await expect(page.locator("[data-diamond-chat]")).toContainText(
    "Great play!",
  );
  await expect(page.locator("[data-diamond-chat-input]")).toBeDisabled();
  await expect(page.locator('[data-diamond-reaction="fire"]')).toBeDisabled();
  await expect(page.locator("[data-diamond-engagement-status]")).toHaveText(
    "Live chat is unavailable until the game status refreshes.",
  );
  expect(
    await page.evaluate(() => window.__DIAMOND_AUTH_SUBSCRIPTIONS__ || 0),
  ).toBe(0);
});

test("cancelled games show shared history without exposing engagement writes", async ({
  page,
  baseURL,
}) => {
  await page.addInitScript(() => {
    window.__DIAMOND_STATUS__ = "cancelled";
  });
  await stubDiamondViewerModules(page);

  await page.goto(
    `${baseURL}/live-game-diamond-v2.html?teamId=team-1&gameId=game-1`,
    { waitUntil: "domcontentloaded" },
  );

  await expect(page.locator("[data-diamond-inning]")).toHaveText("Cancelled");
  await expect(page.locator("[data-diamond-status]")).toHaveText(
    "Game cancelled",
  );
  await expect(page.locator("[data-diamond-chat]")).toContainText(
    "Great play!",
  );
  await expect(page.locator("[data-diamond-chat-input]")).toBeDisabled();
  await expect(page.locator('[data-diamond-reaction="wow"]')).toBeDisabled();
  await expect(page.locator("[data-diamond-engagement-status]")).toHaveText(
    "This game was cancelled. Earlier messages remain visible.",
  );
  expect(
    await page.evaluate(() => window.__DIAMOND_POSTED_CHAT__),
  ).toBeUndefined();
});

test("correction-mode replay stays readable while every engagement write is disabled", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__DIAMOND_TERMINAL__ = true;
  });
  await stubDiamondViewerModules(page);

  await page.goto(
    `${baseURL}/live-game-diamond-v2.html?teamId=team-1&gameId=game-1`,
    {
      waitUntil: "domcontentloaded",
    },
  );

  await expect(page.locator("[data-diamond-inning]")).toHaveText("Final");
  await expect(page.locator("[data-diamond-chat-input]")).toBeDisabled();
  await expect(page.locator("[data-diamond-chat-submit]")).toBeDisabled();
  await expect(page.locator('[data-diamond-reaction="fire"]')).toBeDisabled();
  await expect(page.locator("[data-diamond-engagement-status]")).toContainText(
    "read-only replay",
  );
  expect(pageErrors).toEqual([]);
});

test("stable replay clip and overlay parameters stay in the Diamond viewer and never enable writes", async ({
  page,
  baseURL,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__DIAMOND_MEDIA__ = true;
  });
  await page.route(/^https:\/\/www\.youtube\.com\/embed\//, (route) =>
    route.abort(),
  );
  await stubDiamondViewerModules(page);

  await page.goto(
    `${baseURL}/live-game-diamond-v2.html?teamId=team-1&gameId=game-1&overlay=true&clipStart=1200&clipEnd=5600`,
    {
      waitUntil: "domcontentloaded",
    },
  );

  expect(pageErrors).toEqual([]);
  await expect(page.locator("[data-diamond-mode-label]")).toHaveText(
    "Replay overlay",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-view-mode",
    "overlay",
  );
  await expect(page.locator("[data-diamond-status]")).toHaveText(
    "Revision-pinned replay",
  );
  await expect(page.locator("[data-diamond-media]")).toBeVisible();
  await expect(page.locator("[data-diamond-media-title]")).toHaveText(
    "Game clip",
  );
  await expect(page.locator("[data-diamond-media-frame]")).toHaveAttribute(
    "src",
    /start=1.*end=6/,
  );
  await expect(page.locator("[data-diamond-chat-input]")).toBeDisabled();
  await expect(page.locator('[data-diamond-reaction="clap"]')).toBeDisabled();
  await expect(page.locator("[data-diamond-classic-link]")).toHaveAttribute(
    "href",
    "/live-game.html?teamId=team-1&gameId=game-1&clipStart=1200&clipEnd=5600&classic=1",
  );
  expect(
    await page.evaluate(() => ({
      auth: window.__DIAMOND_AUTH_SUBSCRIPTIONS__ || 0,
      chat: window.__DIAMOND_CHAT_SUBSCRIPTIONS__ || 0,
      reactions: window.__DIAMOND_REACTION_SUBSCRIPTIONS__ || 0,
    })),
  ).toEqual({ auth: 0, chat: 0, reactions: 0 });
  expect(pageErrors).toEqual([]);
});
