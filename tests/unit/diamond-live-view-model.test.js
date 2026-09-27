import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatDiamondInning,
  mergeDiamondEventPages,
  normalizeDiamondPublicEvent,
  normalizeDiamondPublicGame,
  normalizeDiamondPublicMedia,
  normalizeDiamondPublicState,
  normalizeDiamondViewerMode,
  reconcileDiamondEventWindow,
  reconcileDiamondPagination,
  resolveDiamondLiveMediaEmbed,
} from "../../js/diamond-live-view-model.js";

describe("diamond live view model", () => {
  it("bounds public state and never promotes missing completeness to complete", () => {
    expect(
      normalizeDiamondPublicState({
        inning: 2,
        half: "bottom",
        balls: 8,
        bases: { first: true },
      }),
    ).toEqual(
      expect.objectContaining({
        inning: 2,
        half: "bottom",
        balls: 0,
        completeness: "partial",
        bases: { first: true, second: false, third: false },
      }),
    );
  });

  it("marks final states and formats innings", () => {
    expect(normalizeDiamondPublicState({ status: "final" }).isFinal).toBe(true);
    expect(normalizeDiamondPublicState({ status: "correction" }).isFinal).toBe(
      true,
    );
    expect(formatDiamondInning({ inning: 7, half: "bottom" })).toBe("Bottom 7");
  });

  it("preserves canonical terminal counts until the next ledger transition", () => {
    expect(
      normalizeDiamondPublicState({ balls: 4, strikes: 3, outs: 3 }),
    ).toEqual(expect.objectContaining({ balls: 4, strikes: 3, outs: 3 }));
    expect(
      normalizeDiamondPublicState({ balls: 5, strikes: 4, outs: 4 }),
    ).toEqual(expect.objectContaining({ balls: 0, strikes: 0, outs: 0 }));
  });

  it("sanitizes game warnings and event descriptions", () => {
    const game = normalizeDiamondPublicGame({
      teamName: "  Home   Team ",
      opponent: "Visitors",
      trackingEngine: "diamond-v2",
      interactionWindowOpen: true,
      warnings: [" Partial   capture "],
      state: { completeness: "partial" },
    });
    expect(game).toMatchObject({
      teamName: "Home Team",
      interactionWindowOpen: true,
      warnings: ["Partial capture"],
    });
    expect(
      normalizeDiamondPublicGame({ interactionWindowOpen: "true" })
        .interactionWindowOpen,
    ).toBe(false);
    expect(
      normalizeDiamondPublicEvent({
        revision: 2,
        description: " Runner   scored ",
      }),
    ).toMatchObject({ revision: 2, description: "Runner scored" });
  });

  it("normalizes replay, overlay, and bounded clip links without accepting malformed ranges", () => {
    expect(
      normalizeDiamondViewerMode({
        overlay: "1",
        clipStart: "1200",
        clipEnd: "5600",
      }),
    ).toEqual({
      replay: true,
      overlay: true,
      clipStartMs: 1200,
      clipEndMs: 5600,
    });
    expect(
      normalizeDiamondViewerMode({
        replay: "yes",
        overlay: "yes",
        clipStart: "5600",
        clipEnd: "1200",
      }),
    ).toEqual({
      replay: false,
      overlay: false,
      clipStartMs: null,
      clipEndMs: null,
    });
  });

  it("keeps only credential-free HTTPS public media", () => {
    expect(
      normalizeDiamondPublicMedia({
        mode: "replay",
        publicUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        durationMs: 42_000,
      }),
    ).toEqual({
      mode: "replay",
      publicUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      durationMs: 42_000,
    });
    expect(
      normalizeDiamondPublicMedia({
        mode: "live",
        publicUrl: "http://video.example.test/live",
      }),
    ).toBeNull();
    expect(
      normalizeDiamondPublicMedia({
        mode: "replay",
        publicUrl: "https://viewer:secret@video.example.test/replay",
      }),
    ).toBeNull();
  });

  it("preserves sanitized YouTube embeds and Twitch links from live media fallbacks", () => {
    expect(
      normalizeDiamondPublicMedia({
        mode: "live",
        publicUrl: "https://www.youtube.com/embed/abcdefghijk",
      }),
    ).toEqual({
      mode: "live",
      publicUrl: "https://www.youtube.com/embed/abcdefghijk",
      durationMs: 0,
    });
    expect(
      normalizeDiamondPublicMedia({
        mode: "live",
        publicUrl: "https://www.twitch.tv/allplays_live",
      }),
    ).toEqual({
      mode: "live",
      publicUrl: "https://www.twitch.tv/allplays_live",
      durationMs: 0,
    });
  });

  it("resolves only canonical YouTube live-channel embeds for inline playback", () => {
    expect(
      resolveDiamondLiveMediaEmbed({
        mode: "live",
        publicUrl:
          "https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ&autoplay=0&mute=0",
      }),
    ).toEqual({
      provider: "youtube-live",
      embedUrl:
        "https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ&autoplay=1&mute=1&playsinline=1&rel=0",
      publicUrl: "https://www.youtube.com/channel/UCa9ghvbup6VQmnDOdqwYpqQ",
    });
    expect(
      resolveDiamondLiveMediaEmbed({
        mode: "live",
        publicUrl:
          "https://www.youtube.com/embed/live_stream?channel=bad-channel",
      }),
    ).toBeNull();
    expect(
      resolveDiamondLiveMediaEmbed({
        mode: "live",
        publicUrl:
          "https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ&origin=https%3A%2F%2Fevil.example",
      }),
    ).toBeNull();
  });

  it("builds Twitch embeds with only a validated runtime parent hostname", () => {
    const resolved = resolveDiamondLiveMediaEmbed(
      {
        mode: "live",
        publicUrl: "https://www.twitch.tv/allplays_live",
      },
      { parentHostname: "127.0.0.1" },
    );
    expect(resolved).toMatchObject({
      provider: "twitch",
      publicUrl: "https://www.twitch.tv/allplays_live",
    });
    const embedUrl = new URL(resolved.embedUrl);
    expect(embedUrl.origin).toBe("https://player.twitch.tv");
    expect(Object.fromEntries(embedUrl.searchParams)).toEqual({
      channel: "allplays_live",
      parent: "127.0.0.1",
      autoplay: "true",
      muted: "true",
    });
    expect(
      resolveDiamondLiveMediaEmbed(
        {
          mode: "live",
          publicUrl: "https://www.twitch.tv/allplays_live",
        },
        { parentHostname: "allplays.ai/path" },
      ),
    ).toBeNull();
    expect(
      resolveDiamondLiveMediaEmbed(
        {
          mode: "live",
          publicUrl: "https://www.twitch.tv/videos/1234",
        },
        { parentHostname: "allplays.ai" },
      ),
    ).toBeNull();
  });

  it("does not inline replay media, exact video URLs, or generic HTTPS media", () => {
    expect(
      resolveDiamondLiveMediaEmbed(
        {
          mode: "replay",
          publicUrl:
            "https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ",
        },
        { parentHostname: "allplays.ai" },
      ),
    ).toBeNull();
    expect(
      resolveDiamondLiveMediaEmbed(
        {
          mode: "live",
          publicUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        },
        { parentHostname: "allplays.ai" },
      ),
    ).toBeNull();
    expect(
      resolveDiamondLiveMediaEmbed(
        {
          mode: "live",
          publicUrl: "https://video.example.test/live/game-1",
        },
        { parentHostname: "allplays.ai" },
      ),
    ).toBeNull();
  });

  it("deduplicates paginated events and orders newest first", () => {
    expect(
      mergeDiamondEventPages(
        [{ id: "a", revision: 1, description: "Old" }],
        [
          { id: "b", revision: 2, description: "New" },
          { id: "a", revision: 1, description: "Corrected projection" },
        ],
      ),
    ).toEqual([
      expect.objectContaining({ id: "b", revision: 2 }),
      expect.objectContaining({ id: "a", description: "Corrected projection" }),
    ]);
  });

  it("replaces a stale public event window when a correction advances the projection", () => {
    expect(
      reconcileDiamondEventWindow({
        currentEvents: [
          { id: "voided-home-run", revision: 7, description: "Home run" },
          { id: "older-play", revision: 6, description: "Older play" },
        ],
        incomingEvents: [
          { id: "older-play", revision: 6, description: "Older play" },
        ],
        previousSourceRevision: 7,
        sourceRevision: 8,
      }),
    ).toEqual({
      events: [expect.objectContaining({ id: "older-play" })],
      projectionAdvanced: true,
      projectionRebuilt: false,
      sourceRevision: 8,
      projectionToken: "",
    });
  });

  it("replaces bootstrap plays when a correction-safe projection arrives at the same revision", () => {
    const result = reconcileDiamondEventWindow({
      currentEvents: [
        { id: "voided-home-run", revision: 7, description: "Home run" },
      ],
      incomingEvents: [
        { id: "corrected-single", revision: 7, description: "Single" },
      ],
      previousSourceRevision: 8,
      sourceRevision: 8,
      previousProjectionToken: "bootstrap:8:sha256:old",
      projectionToken: "current:8:sha256:new",
    });
    expect(result.events.map((event) => event.id)).toEqual([
      "corrected-single",
    ]);
    expect(result.projectionAdvanced).toBe(false);
    expect(result.projectionRebuilt).toBe(true);
    expect(result.projectionToken).toBe("current:8:sha256:new");
  });

  it("keeps previously loaded replay pages while appending at one pinned revision", () => {
    const result = reconcileDiamondEventWindow({
      currentEvents: [{ id: "new", revision: 10, description: "New" }],
      incomingEvents: [{ id: "old", revision: 2, description: "Old" }],
      previousSourceRevision: 10,
      sourceRevision: 10,
      append: true,
    });
    expect(result.events.map((event) => event.id)).toEqual(["new", "old"]);
    expect(result.projectionAdvanced).toBe(false);
    expect(result.projectionRebuilt).toBe(false);
  });

  it("does not reset a loaded replay cursor during same-revision live polling", () => {
    expect(
      reconcileDiamondPagination({
        previousSourceRevision: 10,
        sourceRevision: 10,
        currentCursor: "before-4",
        currentComplete: false,
        nextCursor: "before-9",
        complete: false,
        hasLoadedGame: true,
      }),
    ).toEqual({ nextCursor: "before-4", complete: false });
    expect(
      reconcileDiamondPagination({
        previousSourceRevision: 10,
        sourceRevision: 10,
        currentCursor: null,
        currentComplete: true,
        nextCursor: "before-9",
        complete: false,
        hasLoadedGame: true,
      }),
    ).toEqual({ nextCursor: null, complete: true });
  });

  it("resets replay pagination when an authoritative correction advances", () => {
    expect(
      reconcileDiamondPagination({
        previousSourceRevision: 10,
        sourceRevision: 11,
        currentCursor: null,
        currentComplete: true,
        nextCursor: "before-11",
        complete: false,
        hasLoadedGame: true,
      }),
    ).toEqual({ nextCursor: "before-11", complete: false });
  });

  it("resets replay pagination when a same-revision authoritative build replaces bootstrap", () => {
    expect(
      reconcileDiamondPagination({
        previousSourceRevision: 10,
        sourceRevision: 10,
        previousProjectionToken: "bootstrap:10:sha256:old",
        projectionToken: "current:10:sha256:new",
        currentCursor: "bootstrap-cursor",
        currentComplete: true,
        nextCursor: "projected-cursor",
        complete: false,
        hasLoadedGame: true,
      }),
    ).toEqual({ nextCursor: "projected-cursor", complete: false });
  });

  it("ships an accessible standalone page wired to the v2 module", () => {
    const html = readFileSync(
      new URL("../../live-game-diamond-v2.html", import.meta.url),
      "utf8",
    );
    expect(html).toContain("data-diamond-content");
    expect(html).toContain("data-diamond-classic-link");
    expect(html).toContain("data-diamond-chat-form");
    expect(html).toContain("data-diamond-reactions");
    expect(html).toContain("data-diamond-media-frame");
    expect(html).toContain("data-diamond-mode-label");
    expect(html).toContain("data-diamond-error-sign-in");
    expect(html).toContain('aria-label="Live game score"');
    expect(html).toContain("js/diamond-live-game.js?v=12");

    const script = readFileSync(
      new URL("../../js/diamond-live-game.js", import.meta.url),
      "utf8",
    );
    expect(script).toContain("diamond-live-view-model.js?v=5");
    expect(script).toContain("onAuthStateChanged");
    expect(script).not.toContain('from "./auth.js');
    expect(script).toContain("AUTH_RESTORE_TIMEOUT_MS = 2000");
    expect(script).toContain("VIEWER_REVALIDATION_INTERVAL_MS = 60_000");
    expect(script).toContain("Promise.race([");
    expect(script).toContain(
      "allowAuthRecovery: !append && !cursor && !state.game",
    );
    expect(script).toContain("initialAuthUid ||");
    expect(script).toContain(
      "requestAuthUid !== viewerAuthUid(auth?.currentUser)",
    );
    expect(script).toContain("state.viewerEpoch += 1");
    expect(script).toContain('window.addEventListener("pageshow"');
    expect(script).toContain(
      "const returnPath = `${window.location.pathname}${window.location.search}`;",
    );
    expect(script).toContain(
      "`/app/#/auth?next=${encodeURIComponent(returnPath)}`",
    );
    expect(script).toContain('elements.errorSignIn.href = `${authHref}&switch=1`');
    expect(script).toContain("state.game.interactionWindowOpen === true");
    expect(script).not.toContain("isViewerChatEnabled");
    expect(script).toContain('"postDiamondLiveChat"');
    expect(script).toContain('"postDiamondLiveReaction"');
    expect(script).toContain("expectedInstanceId: state.instanceId");
    expect(script).toContain('viewerMode: "live"');
    expect(script).toContain("cryptoApi.randomUUID()");
    expect(script).toContain("cryptoApi.getRandomValues(bytes)");
    expect(script).toContain("state.pendingChatRequest");
    expect(script).not.toContain("postLiveChatMessage(");
    expect(script).not.toContain("sendReaction(");
    expect(script).not.toContain("senderId: state.user.uid");
  });

  it("uses the same live-viewer palette and typography as the rest of the website", () => {
    const html = readFileSync(
      new URL("../../live-game-diamond-v2.html", import.meta.url),
      "utf8",
    );
    const css = readFileSync(
      new URL("../../css/diamond-scorebook.css", import.meta.url),
      "utf8",
    );

    expect(html).toContain("family=Inter+Tight");
    expect(html).toContain("family=Space+Grotesk");
    expect(html).toContain('css/diamond-scorebook.css?v=3');
    expect(css).toContain("--diamond-ink: #0b132b;");
    expect(css).toContain("--diamond-teal: #5bc0be;");
    expect(css).toContain("--diamond-sand: #f7f5ed;");
    expect(css).toContain('font-family: "Inter Tight"');
    expect(css).toContain('font-family: "Space Grotesk"');
  });
});
