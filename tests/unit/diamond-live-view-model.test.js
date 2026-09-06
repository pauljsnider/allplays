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

  it("sanitizes game warnings and event descriptions", () => {
    const game = normalizeDiamondPublicGame({
      teamName: "  Home   Team ",
      opponent: "Visitors",
      trackingEngine: "diamond-v2",
      warnings: [" Partial   capture "],
      state: { completeness: "partial" },
    });
    expect(game).toMatchObject({
      teamName: "Home Team",
      warnings: ["Partial capture"],
    });
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
    expect(html).toContain('aria-label="Live game score"');
    expect(html).toContain("js/diamond-live-game.js?v=5");

    const script = readFileSync(
      new URL("../../js/diamond-live-game.js", import.meta.url),
      "utf8",
    );
    expect(script).toContain(
      'import { isViewerChatEnabled } from "./live-game-chat.js?v=4";',
    );
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
});
