import { describe, expect, it, vi } from "vitest";

import { loadCompleteDiamondReportEvents } from "../../js/diamond-report-events.js";

const instanceId = "00000000-0000-4000-8000-000000000001";

function diamondGame(revision = 3) {
  return {
    trackingEngine: "diamond-v2",
    diamondScorebookInstanceId: instanceId,
    diamondProjectionRevision: revision,
  };
}

function publicEvent(revision, overrides = {}) {
  return {
    id: `event-${revision}`,
    revision,
    inning: 1,
    half: "top",
    description: `Play ${revision}`,
    createdAt: `2026-09-05T20:00:0${revision}.000Z`,
    isCorrection: false,
    isScoringPlay: true,
    score: { home: 0, away: revision },
    ...overrides,
  };
}

function privateEvent(revision, overrides = {}) {
  const createdAt = `2026-09-05T20:00:0${revision}.000Z`;
  return {
    eventId: `event-${revision}`,
    sequence: revision,
    revision,
    type: "record_pitch",
    payload: { result: "strike" },
    serverTimestampMs: Date.parse(createdAt),
    createdAt,
    voidsEventId: null,
    supersedesEventId: null,
    ...overrides,
  };
}

function withPrivateByteEvidence(value) {
  const response = {
    ...value,
    responseByteCount: 0,
    responseByteLimit: 1_000_000,
  };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const byteCount = new TextEncoder().encode(
      JSON.stringify(response),
    ).byteLength;
    if (byteCount === response.responseByteCount) return response;
    response.responseByteCount = byteCount;
  }
  throw new Error("Unable to stabilize private replay byte evidence.");
}

describe("legacy Diamond report event loader", () => {
  it("loads every bounded public page, validates one projection identity, and filters player evidence by source play ID", async () => {
    const invoke = vi.fn(async (name, payload) => {
      expect(name).toBe("getPublicDiamondGame");
      if (payload.cursor === null) {
        return {
          instanceId,
          game: { trackingEngine: "diamond-v2" },
          events: [publicEvent(3)],
          nextCursor: "older-page",
          complete: false,
          truncated: true,
          sourceRevision: 3,
          projectionToken: "current:3:projection-hash",
          diamondStats: { status: "complete" },
        };
      }
      return {
        instanceId,
        game: { trackingEngine: "diamond-v2" },
        events: [publicEvent(2), publicEvent(1)],
        nextCursor: null,
        complete: true,
        truncated: false,
        sourceRevision: 3,
        projectionToken: "current:3:projection-hash",
        diamondStats: { status: "complete" },
      };
    });

    const result = await loadCompleteDiamondReportEvents({
      teamId: "team-1",
      gameId: "game-1",
      game: diamondGame(),
      sourcePlayIds: ["event-3", "event-1"],
      invoke,
    });

    expect(result).toMatchObject({
      requestedVisibility: "public",
      visibility: "public",
      source: "public-sanitized",
    });
    expect(result.events).toEqual([
      {
        id: "event-1",
        text: "Play 1",
        period: "Top 1",
        clock: "",
        gameTime: "",
        timestamp: {
          seconds: Date.parse("2026-09-05T20:00:01.000Z") / 1000,
          nanoseconds: 0,
        },
        revision: 1,
      },
      {
        id: "event-3",
        text: "Play 3",
        period: "Top 1",
        clock: "",
        gameTime: "",
        timestamp: {
          seconds: Date.parse("2026-09-05T20:00:03.000Z") / 1000,
          nanoseconds: 0,
        },
        revision: 3,
      },
    ]);
    expect(invoke.mock.calls).toEqual([
      [
        "getPublicDiamondGame",
        { teamId: "team-1", gameId: "game-1", cursor: null, limit: 200 },
      ],
      [
        "getPublicDiamondGame",
        {
          teamId: "team-1",
          gameId: "game-1",
          cursor: "older-page",
          limit: 200,
        },
      ],
    ]);
  });

  it("uses authorized bounded summaries only after public not-found and strips notes, IDs, and correction payloads", async () => {
    const managerEvents = [
      privateEvent(1, { type: "activate", payload: {} }),
      privateEvent(2, {
        type: "record_plate_appearance",
        payload: {
          batterId: "private-player-id",
          result: "single",
          privateSignal: "do not render",
        },
      }),
      privateEvent(3, {
        type: "private_note",
        payload: {
          text: "manager-only medical note",
          attachedEventId: "event-2",
        },
      }),
      privateEvent(4, {
        type: "supersede_event",
        payload: {
          targetEventId: "event-2",
          reason: "correction",
          replacement: {
            type: "record_plate_appearance",
            payload: {
              batterId: "private-player-id",
              result: "triple",
              privateSignal: "still private",
            },
          },
        },
        supersedesEventId: "event-2",
      }),
    ];
    const invoke = vi.fn(async (name, payload) => {
      if (name === "getPublicDiamondGame") {
        throw Object.assign(new Error("Private game."), {
          code: "functions/not-found",
        });
      }
      if (name === "getDiamondState") {
        return {
          authoritative: true,
          trackingEngine: "diamond-v2",
          instanceId,
          revision: 4,
        };
      }
      if (name === "listDiamondEvents") {
        return payload.cursor
          ? withPrivateByteEvidence({
              sourceRevision: 4,
              items: managerEvents.slice(2),
              nextCursor: null,
              complete: true,
              accessComplete: true,
              collectionComplete: true,
            })
          : withPrivateByteEvidence({
              sourceRevision: 4,
              items: managerEvents.slice(0, 2),
              nextCursor: "2",
              complete: true,
              accessComplete: true,
              collectionComplete: false,
            });
      }
      throw new Error(`Unexpected callable: ${name}`);
    });

    const result = await loadCompleteDiamondReportEvents({
      teamId: "team-1",
      gameId: "game-1",
      game: diamondGame(4),
      requestedVisibility: "manager-internal",
      sourcePlayIds: ["event-2"],
      invoke,
    });

    expect(result).toMatchObject({
      requestedVisibility: "manager-internal",
      visibility: "manager-internal",
      source: "manager-private-sanitized",
    });
    expect(result.events).toEqual([
      {
        id: "event-4",
        text: "Plate appearance: triple",
        period: "Revision 2",
        clock: "",
        gameTime: "",
        timestamp: {
          seconds: Date.parse("2026-09-05T20:00:04.000Z") / 1000,
          nanoseconds: 0,
        },
        revision: 2,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /private-player-id|medical note|privateSignal/i,
    );
    expect(invoke.mock.calls.map(([name]) => name)).toEqual([
      "getPublicDiamondGame",
      "getDiamondState",
      "listDiamondEvents",
      "listDiamondEvents",
      "getDiamondState",
    ]);
    expect(invoke.mock.calls[2][1]).toEqual({
      teamId: "team-1",
      gameId: "game-1",
      visibility: "private",
      limit: 200,
    });
    expect(invoke.mock.calls[3][1]).toEqual({
      teamId: "team-1",
      gameId: "game-1",
      visibility: "private",
      limit: 200,
      cursor: "2",
    });
  });

  it("rejects a complete public replay that omits a requested source play", async () => {
    const invoke = vi.fn().mockResolvedValue({
      instanceId,
      game: { trackingEngine: "diamond-v2" },
      events: [publicEvent(1)],
      nextCursor: null,
      complete: true,
      truncated: false,
      sourceRevision: 3,
      projectionToken: "current:3:projection-hash",
      diamondStats: { status: "complete" },
    });

    await expect(
      loadCompleteDiamondReportEvents({
        teamId: "team-1",
        gameId: "game-1",
        game: diamondGame(),
        sourcePlayIds: ["event-1", "event-missing"],
        invoke,
      }),
    ).rejects.toThrow("omitted requested play evidence");
  });

  it("rejects a complete manager replay that omits a requested effective source play", async () => {
    const events = [
      privateEvent(1, { type: "activate", payload: {} }),
      privateEvent(2, {
        type: "record_plate_appearance",
        payload: { result: "single" },
      }),
      privateEvent(3, { type: "finalize", payload: {} }),
    ];
    const invoke = vi.fn(async (name) => {
      if (name === "getPublicDiamondGame") {
        throw Object.assign(new Error("Private game."), {
          code: "functions/not-found",
        });
      }
      if (name === "getDiamondState") {
        return {
          authoritative: true,
          trackingEngine: "diamond-v2",
          instanceId,
          revision: 3,
        };
      }
      if (name === "listDiamondEvents") {
        return withPrivateByteEvidence({
          sourceRevision: 3,
          items: events,
          nextCursor: null,
          complete: true,
          accessComplete: true,
          collectionComplete: true,
        });
      }
      throw new Error(`Unexpected callable: ${name}`);
    });

    await expect(
      loadCompleteDiamondReportEvents({
        teamId: "team-1",
        gameId: "game-1",
        game: diamondGame(),
        requestedVisibility: "manager-internal",
        sourcePlayIds: ["event-2", "event-missing"],
        invoke,
      }),
    ).rejects.toThrow("omitted requested play evidence");
  });

  it("does not widen a public or transiently failed replay into a private read", async () => {
    for (const [requestedVisibility, code] of [
      ["public", "functions/not-found"],
      ["manager-internal", "functions/unavailable"],
    ]) {
      const invoke = vi.fn(async () => {
        throw Object.assign(new Error("Replay unavailable."), { code });
      });
      await expect(
        loadCompleteDiamondReportEvents({
          teamId: "team-1",
          gameId: "game-1",
          game: diamondGame(),
          requestedVisibility,
          invoke,
        }),
      ).rejects.toThrow("Replay unavailable.");
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(invoke).toHaveBeenCalledWith(
        "getPublicDiamondGame",
        expect.any(Object),
      );
    }
  });

  it("rejects partial, changed, duplicate, and unsanitized public evidence", async () => {
    const invalidPages = [
      {
        instanceId,
        game: { trackingEngine: "diamond-v2" },
        events: [],
        nextCursor: "next",
        complete: false,
        truncated: true,
        sourceRevision: 3,
        projectionToken: "token",
      },
      {
        instanceId,
        game: { trackingEngine: "diamond-v2" },
        events: [publicEvent(1), publicEvent(1)],
        nextCursor: null,
        complete: true,
        truncated: false,
        sourceRevision: 3,
        projectionToken: "token",
      },
      {
        instanceId,
        game: { trackingEngine: "diamond-v2" },
        events: [{ ...publicEvent(1), privateNote: "must not cross" }],
        nextCursor: null,
        complete: true,
        truncated: false,
        sourceRevision: 3,
        projectionToken: "token",
      },
      {
        instanceId,
        game: { trackingEngine: "diamond-v2" },
        events: [publicEvent(1)],
        nextCursor: null,
        complete: true,
        truncated: false,
        sourceRevision: 2,
        projectionToken: "token",
      },
    ];
    for (const page of invalidPages) {
      await expect(
        loadCompleteDiamondReportEvents({
          teamId: "team-1",
          gameId: "game-1",
          game: diamondGame(),
          invoke: vi.fn().mockResolvedValue(page),
        }),
      ).rejects.toThrow(/incomplete|duplicate|unsupported|changed/i);
    }
  });
});
