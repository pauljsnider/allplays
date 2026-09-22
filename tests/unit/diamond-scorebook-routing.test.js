import { describe, expect, it } from "vitest";
import {
  buildDiamondTrackerUrl,
  buildDiamondViewerUrl,
  diamondRolloutBucket,
  hasMeaningfulLegacyTracking,
  normalizeDiamondPolicy,
  normalizeDiamondSport,
  resolveDiamondGameRoute,
} from "../../js/diamond-scorebook-routing.js";

const eligible = {
  team: { id: "team-1", sport: "Baseball", active: true },
  game: { id: "game-1", isDbGame: true },
  policy: { mode: "pilot", revision: 1, teamIds: ["team-1"] },
  teamSettings: { enabled: true },
  canManage: true,
  canScore: true,
};

describe("diamond scorebook routing", () => {
  it("normalizes Baseball and Fastpitch without accepting other sports", () => {
    expect(normalizeDiamondSport("Baseball")).toBe("baseball");
    expect(normalizeDiamondSport("Fastpitch Softball")).toBe("softball");
    expect(normalizeDiamondSport("Basketball")).toBe("");
  });

  it("fails closed for missing and malformed policies", () => {
    expect(normalizeDiamondPolicy(null)).toMatchObject({
      mode: "disabled",
      reason: "missing-policy",
    });
    expect(
      normalizeDiamondPolicy({ mode: "enabled", revision: 0 }),
    ).toMatchObject({ mode: "disabled", reason: "invalid-policy" });
    expect(
      normalizeDiamondPolicy({ mode: "enabled", revision: 1, teamIds: [] }),
    ).toMatchObject({ mode: "disabled", reason: "invalid-policy" });
    expect(
      normalizeDiamondPolicy({ mode: "disabled", revision: 1, teamIds: [] }),
    ).toMatchObject({ mode: "disabled", reason: "policy-disabled" });
    expect(
      normalizeDiamondPolicy({
        mode: "pilot",
        revision: 1,
        teamIds: ["team-1", "team-1"],
      }),
    ).toMatchObject({ mode: "disabled", reason: "invalid-policy" });
    for (const malformed of [
      { mode: " enabled ", revision: 1, teamIds: [], rolloutPercent: 100 },
      {
        mode: "enabled",
        revision: 1,
        teamIds: [],
        rolloutPercent: 100,
        updatedBy: "bad/id",
      },
      {
        mode: "enabled",
        revision: 1,
        teamIds: [],
        rolloutPercent: 100,
        updatedAt: "yesterday",
      },
      {
        mode: "enabled",
        revision: 1,
        teamIds: [],
        rolloutPercent: 100,
        rolloutNote: "x".repeat(501),
      },
    ]) {
      expect(normalizeDiamondPolicy(malformed)).toMatchObject({
        mode: "disabled",
        reason: "invalid-policy",
      });
    }
    expect(
      normalizeDiamondPolicy({
        mode: "enabled",
        revision: 2,
        teamIds: [],
        rolloutPercent: 10,
        minimumAppBuild: 42,
        updatedBy: "admin.1:primary",
        updatedAt: { toMillis: () => 1_800_000_000_000 },
        rolloutNote: "Ten percent stage.",
      }),
    ).toMatchObject({
      mode: "enabled",
      revision: 2,
      rolloutPercent: 10,
      minimumAppBuild: 42,
      reason: null,
    });
  });

  it("offers activation only to an eligible opted-in pilot game", () => {
    expect(resolveDiamondGameRoute(eligible)).toMatchObject({
      engine: "legacy",
      scorer: "legacy",
      viewer: "classic",
      canActivate: true,
      reason: null,
    });
  });

  it("matches the deterministic server rollout buckets and exact percentage stages", () => {
    expect(diamondRolloutBucket("team-1", "game-60")).toBe(1);
    expect(diamondRolloutBucket("team-1", "game-70")).toBe(10);
    expect(diamondRolloutBucket("team-1", "game-13")).toBe(11);
    expect(diamondRolloutBucket("team-1", "game-30")).toBe(50);
    expect(diamondRolloutBucket("team-1", "game-84")).toBe(51);
    expect(diamondRolloutBucket("team-1", "game-1")).toBe(98);
    expect(diamondRolloutBucket("team-1", "bad/game")).toBeNull();

    expect(
      resolveDiamondGameRoute({
        ...eligible,
        policy: {
          mode: "enabled",
          revision: 2,
          teamIds: [],
          rolloutPercent: 1,
        },
      }),
    ).toMatchObject({ canActivate: false, reason: "team-not-in-cohort" });
    expect(
      resolveDiamondGameRoute({
        ...eligible,
        game: { ...eligible.game, id: "game-60" },
        policy: {
          mode: "enabled",
          revision: 3,
          teamIds: [],
          rolloutPercent: 1,
        },
      }),
    ).toMatchObject({ canActivate: true, reason: null });
    expect(
      resolveDiamondGameRoute({
        ...eligible,
        policy: {
          mode: "enabled",
          revision: 4,
          teamIds: ["team-1"],
          rolloutPercent: 1,
        },
      }),
    ).toMatchObject({ canActivate: true, reason: null });
  });

  it("keeps meaningful legacy games on the legacy engine", () => {
    const game = { ...eligible.game, hasLegacyEvents: true };
    expect(hasMeaningfulLegacyTracking(game)).toBe(true);
    expect(resolveDiamondGameRoute({ ...eligible, game })).toMatchObject({
      canActivate: false,
      reason: "legacy-data-present",
    });
  });

  it("continues routing an owned diamond game while rollout is disabled", () => {
    expect(
      resolveDiamondGameRoute({
        ...eligible,
        game: { ...eligible.game, trackingEngine: "diamond-v2" },
        policy: null,
      }),
    ).toMatchObject({
      engine: "diamond-v2",
      scorer: "diamond",
      viewer: "diamond",
    });
  });

  it("blocks scoring for unknown nonempty engines", () => {
    expect(
      resolveDiamondGameRoute({
        ...eligible,
        game: { ...eligible.game, trackingEngine: "future-engine" },
      }),
    ).toMatchObject({
      scorer: "blocked",
      viewer: "classic",
      reason: "unknown-engine",
    });
  });

  it("rejects inactive, shared, and non-diamond activation", () => {
    expect(
      resolveDiamondGameRoute({
        ...eligible,
        team: { ...eligible.team, active: false },
      }).reason,
    ).toBe("inactive-team");
    expect(
      resolveDiamondGameRoute({
        ...eligible,
        game: { ...eligible.game, isSharedGame: true },
      }).reason,
    ).toBe("shared-game-not-eligible");
    expect(
      resolveDiamondGameRoute({
        ...eligible,
        team: { ...eligible.team, sport: "Soccer" },
      }).reason,
    ).toBe("unsupported-sport");
  });

  it("builds stable encoded scorer and viewer links", () => {
    expect(buildDiamondTrackerUrl("team one", "game/one")).toBe(
      "/app/#/schedule/team%20one/game%2Fone/diamond-v2",
    );
    expect(
      buildDiamondViewerUrl({
        teamId: "team one",
        gameId: "game/one",
        replay: true,
        clipStart: 10,
        clipEnd: 20,
      }),
    ).toBe(
      "/live-game-diamond-v2.html?teamId=team+one&gameId=game%2Fone&replay=true&clipStart=10&clipEnd=20",
    );
    expect(
      buildDiamondViewerUrl({
        teamId: "team one",
        gameId: "game/one",
        overlay: true,
      }),
    ).toBe(
      "/live-game-diamond-v2.html?teamId=team+one&gameId=game%2Fone&overlay=true",
    );
    expect(
      buildDiamondViewerUrl({
        teamId: "team one",
        gameId: "game/one",
        clipStart: -1,
        clipEnd: 20,
      }),
    ).toBe("/live-game-diamond-v2.html?teamId=team+one&gameId=game%2Fone");
  });
});
