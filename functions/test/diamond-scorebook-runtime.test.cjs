"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  loadDiamondClipTimings,
  normalizeSharedGamePath,
  resolveDiamondSharedGame,
  resolveStreamOffsetMillis,
  resolveStreamStartMillis,
} = require("../diamond-scorebook-runtime.cjs");

describe("Diamond production projection adapters", () => {
  it("derives bounded replay-relative clip windows from one exact stream clock", async () => {
    const timings = await loadDiamondClipTimings({
      game: {
        liveStreamStartedAtMs: 1_000_000,
        liveStreamOffsetMs: 2_000,
      },
      ledger: {
        events: [
          { eventId: "early", serverTimestampMs: 1_001_000 },
          { eventId: "scoring-play", serverTimestampMs: 1_020_000 },
          { eventId: "outside-bound", serverTimestampMs: 90_000_000 },
        ],
      },
    });
    assert.deepEqual(timings.early, { startMs: 0, endMs: 15_000 });
    assert.deepEqual(timings["scoring-play"], {
      startMs: 14_000,
      endMs: 34_000,
    });
    assert.equal(timings["outside-bound"], undefined);
  });

  it("suppresses clip timing when timestamp or offset aliases conflict", async () => {
    assert.equal(
      resolveStreamStartMillis({
        liveStreamStartedAtMs: 1_000,
        streamStartedAt: 2_000,
      }),
      null,
    );
    assert.equal(
      resolveStreamOffsetMillis({
        liveStreamOffsetMs: 10,
        videoTimestampOffsetMs: 20,
      }),
      null,
    );
    await assert.doesNotReject(async () => {
      assert.deepEqual(
        await loadDiamondClipTimings({
          game: { liveStreamStartedAtMs: 1_000, streamStartedAt: 2_000 },
          ledger: { events: [] },
        }),
        {},
      );
    });
  });

  it("loads only an explicitly named canonical organization or tournament shared game", async () => {
    const path = "organizations/org-1/sharedGames/shared-1";
    const reference = {
      path,
      async get() {
        return {
          exists: true,
          data: () => ({
            homeTeamId: "team-1",
            awayTeamId: "team-2",
            teamGameIds: { "team-1": "game-1" },
          }),
        };
      },
    };
    const firestore = {
      doc(requestedPath) {
        assert.equal(requestedPath, path);
        return reference;
      },
    };
    assert.equal(normalizeSharedGamePath(path), path);
    assert.deepEqual(
      await resolveDiamondSharedGame({
        firestore,
        game: { diamondSharedGamePath: path, sharedGamePath: path },
      }),
      {
        path,
        ref: reference,
        data: {
          homeTeamId: "team-1",
          awayTeamId: "team-2",
          teamGameIds: { "team-1": "game-1" },
        },
      },
    );
  });

  it("returns no link without an explicit path and rejects ambiguity, missing docs, and read failures", async () => {
    const firestore = {
      doc(path) {
        return {
          path,
          async get() {
            if (path.includes("unavailable"))
              throw Object.assign(new Error("offline"), {
                code: "unavailable",
              });
            return { exists: false, data: () => null };
          },
        };
      },
    };
    assert.equal(await resolveDiamondSharedGame({ firestore, game: {} }), null);
    await assert.rejects(
      resolveDiamondSharedGame({
        firestore,
        game: {
          sharedGamePath: "organizations/org-1/sharedGames/shared-1",
          _sharedGamePath: "tournaments/t-1/sharedGames/shared-2",
        },
      }),
      (error) => error.code === "invalid-shared-game" && !error.retryable,
    );
    await assert.rejects(
      resolveDiamondSharedGame({
        firestore,
        game: {
          sharedGamePath: "organizations/org-1/sharedGames/missing",
        },
      }),
      (error) => error.code === "shared-game-missing" && !error.retryable,
    );
    await assert.rejects(
      resolveDiamondSharedGame({
        firestore,
        game: {
          sharedGamePath: "organizations/org-1/sharedGames/unavailable",
        },
      }),
      (error) => error.code === "shared-game-unavailable" && error.retryable,
    );
  });
});
