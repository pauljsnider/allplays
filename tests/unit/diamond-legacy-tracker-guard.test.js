import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readRepo = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("legacy tracker Diamond ownership guard", () => {
  for (const page of ["track.html", "track-live.html"]) {
    it(`${page} redirects Diamond games before any tracker initialization`, () => {
      const source = readRepo(page);
      const engineGuard = source.indexOf(
        "if (game.trackingEngine === DIAMOND_ENGINE)",
      );
      const assignment = source.indexOf("currentGame = game;", engineGuard);

      expect(source).toContain("from './js/diamond-scorebook-routing.js?v=2'");
      expect(engineGuard).toBeGreaterThan(-1);
      expect(source.slice(engineGuard, assignment)).toContain(
        "window.location.replace(buildDiamondTrackerUrl(teamId, gameId))",
      );
      expect(source.slice(engineGuard, assignment)).toContain(
        "if (game.trackingEngine)",
      );
      expect(assignment).toBeGreaterThan(engineGuard);
    });
  }

  it("dispatches schedule and game-day launchers through the shared scorer URL", () => {
    const schedule = readRepo("edit-schedule.html");
    const gameDay = readRepo("game-day.html");

    expect(schedule).toContain("if (game.trackingEngine === DIAMOND_ENGINE)");
    expect(schedule).toContain(
      "window.location.href = buildDiamondTrackerUrl(currentTeamId, gameId)",
    );
    expect(schedule).toContain(
      "await getDiamondGameAccess(currentTeamId, gameId)",
    );
    expect(schedule).toContain(
      "activateDiamondGameForLegacy(currentTeamId, gameId, mode)",
    );
    expect(schedule).toContain("The legacy tracker is still available.");
    expect(schedule).toContain("diamond-tracker-quick");
    expect(schedule).toContain("diamond-tracker-full");
    expect(gameDay).toContain(
      "if (state.game?.trackingEngine === DIAMOND_ENGINE)",
    );
    expect(gameDay).toContain(
      "return buildDiamondTrackerUrl(state.teamId, state.gameId)",
    );
    expect(gameDay).toContain(
      "buildDiamondViewerUrl({ teamId: state.teamId, gameId: state.gameId })",
    );
    expect(gameDay).toContain("if (game.trackingEngine === DIAMOND_ENGINE)");
    expect(gameDay).toContain("renderLimitedScorekeepingAccess(accessInfo)");
  });

  it("redirects old viewers while allowing only the generation-safe classic game center", () => {
    const viewer = readRepo("js/live-game.js");
    const overlay = readRepo("js/live-game-overlay.js");

    expect(viewer).toContain(
      "game?.trackingEngine === DIAMOND_ENGINE && params.classic !== '1'",
    );
    expect(viewer).toContain("window.location.replace(buildDiamondViewerUrl({");
    expect(viewer).toContain("clipStart: state.clipStartMs");
    expect(overlay).toContain("if (game.trackingEngine === DIAMOND_ENGINE)");
    expect(overlay).not.toContain(
      "game.trackingEngine === DIAMOND_ENGINE && params.classic !== '1'",
    );
    expect(overlay).toContain(
      "window.location.replace(buildDiamondViewerUrl({",
    );
    expect(overlay).toContain("overlay: true");
  });

  it("keeps the explicit classic viewer generation-safe without changing legacy writes", () => {
    const viewer = readRepo("js/live-game.js");

    expect(viewer).toContain("function getDiamondInteractionInstanceId()");
    expect(viewer).toContain("return postLiveChatMessage(state.teamId, state.gameId, legacyPayload)");
    expect(viewer).toContain("return sendReaction(state.teamId, state.gameId, {");
    expect(viewer).toContain("return postDiamondLiveChat(state.teamId, state.gameId, instanceId, text)");
    expect(viewer).toContain("return postDiamondLiveReaction(state.teamId, state.gameId, instanceId, type)");
    expect(viewer).toContain("subscribeDiamondLiveChat(");
    expect(viewer).toContain("subscribeDiamondReactions(");
    expect(viewer).toContain("getDiamondLiveChatHistory(state.teamId, state.gameId, instanceId)");
    expect(viewer).toContain("getDiamondLiveReactions(state.teamId, state.gameId, instanceId)");
    expect(viewer).toContain("if (!state.user || state.game?.trackingEngine === DIAMOND_ENGINE) return;");
    expect(viewer).toContain(
      "if (state.game?.trackingEngine === DIAMOND_ENGINE) return;",
    );
  });
});
