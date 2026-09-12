"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  createDiamondOrientationSnapshot,
  validateDiamondOrientationPin,
} = require("../diamond-orientation.cjs");

const team = { id: "team-1", name: "Comets" };

describe("Diamond orientation snapshot", () => {
  it("pins a canonical home orientation and materializes the managed ID", () => {
    const result = createDiamondOrientationSnapshot({
      teamId: "team-1",
      team,
      game: {
        teamId: "team-1",
        isHome: true,
        opponentTeamId: "team-2",
        opponentName: "  Rockets  ",
      },
    });
    assert.deepEqual(result.snapshot, {
      schemaVersion: 1,
      managedSide: "home",
      opponentSide: "away",
      managedTeamId: "team-1",
      opponentTeamId: "team-2",
      homeTeamId: "team-1",
      awayTeamId: "team-2",
      teamName: "Comets",
      opponentName: "Rockets",
      homeName: "Comets",
      awayName: "Rockets",
    });
    assert.match(result.snapshotHash, /^sha256:[a-f0-9]{64}$/);
    assert.equal(
      validateDiamondOrientationPin({
        teamId: "team-1",
        orientationSnapshot: result.snapshot,
      }).snapshotHash,
      result.snapshotHash,
    );
  });

  it("pins an away team from consistent side, ID, and name evidence", () => {
    const result = createDiamondOrientationSnapshot({
      teamId: "team-1",
      team,
      game: {
        teamId: "team-1",
        isHome: false,
        teamSide: "away",
        homeTeamId: "team-2",
        awayTeamId: "team-1",
        opponentTeamId: "team-2",
        homeTeamName: "Rockets",
        awayTeamName: "Comets",
        opponentName: "Rockets",
      },
    });
    assert.equal(result.snapshot.managedSide, "away");
    assert.equal(result.snapshot.homeTeamId, "team-2");
    assert.equal(result.snapshot.awayTeamId, "team-1");
    assert.equal(result.snapshot.homeName, "Rockets");
    assert.equal(result.snapshot.awayName, "Comets");
  });

  it("fails closed when home and away evidence conflicts or is absent", () => {
    assert.throws(
      () =>
        createDiamondOrientationSnapshot({
          teamId: "team-1",
          team,
          game: {
            isHome: false,
            homeTeamId: "team-1",
            opponentName: "Rockets",
          },
        }),
      (error) => error.code === "orientation-side-conflict",
    );
    assert.throws(
      () =>
        createDiamondOrientationSnapshot({
          teamId: "team-1",
          team,
          game: { opponentName: "Rockets" },
        }),
      (error) => error.code === "orientation-side-required",
    );
  });

  it("fails closed on conflicting opponent identity or displayed names", () => {
    assert.throws(
      () =>
        createDiamondOrientationSnapshot({
          teamId: "team-1",
          team,
          game: {
            isHome: true,
            awayTeamId: "team-2",
            opponentTeamId: "team-3",
            opponentName: "Rockets",
          },
        }),
      (error) => error.code === "orientation-opponent-conflict",
    );
    assert.throws(
      () =>
        createDiamondOrientationSnapshot({
          teamId: "team-1",
          team,
          game: {
            isHome: true,
            opponentName: "Rockets",
            awayTeamName: "Tigers",
          },
        }),
      (error) => error.code === "orientation-opponent-name-conflict",
    );
  });

  it("fails closed on absent, malformed, or conflicting identity names and IDs", () => {
    assert.throws(
      () =>
        createDiamondOrientationSnapshot({
          teamId: "team-1",
          team: { id: "team-1" },
          game: { isHome: true, opponentName: "Rockets" },
        }),
      (error) => error.code === "orientation-team-name-required",
    );
    assert.throws(
      () =>
        createDiamondOrientationSnapshot({
          teamId: "team-1",
          team,
          game: { isHome: true },
        }),
      (error) => error.code === "orientation-opponent-name-required",
    );
    assert.throws(
      () =>
        createDiamondOrientationSnapshot({
          teamId: "team-1",
          team: { ...team, teamName: "Different Comets" },
          game: { isHome: true, opponentName: "Rockets" },
        }),
      (error) => error.code === "orientation-name-conflict",
    );
    assert.throws(
      () =>
        createDiamondOrientationSnapshot({
          teamId: "team-1",
          team,
          game: {
            isHome: true,
            homeTeamId: " another-team ",
            opponentName: "Rockets",
          },
        }),
      (error) => error.code === "orientation-id-invalid",
    );
    assert.throws(
      () =>
        createDiamondOrientationSnapshot({
          teamId: "team-1",
          team,
          game: {
            isHome: true,
            homeTeamId: "another-team",
            opponentName: "Rockets",
          },
        }),
      (error) => error.code === "orientation-team-conflict",
    );
    assert.throws(
      () =>
        createDiamondOrientationSnapshot({
          teamId: "team-1",
          team,
          game: { isHome: true, opponentName: "R".repeat(161) },
        }),
      (error) => error.code === "orientation-name-invalid",
    );
  });

  it("rejects a malformed or cross-team committed pin", () => {
    assert.throws(
      () =>
        validateDiamondOrientationPin({
          teamId: "another-team",
          orientationSnapshot: createDiamondOrientationSnapshot({
            teamId: "team-1",
            team,
            game: { isHome: true, opponentName: "Rockets" },
          }).snapshot,
        }),
      (error) => error.code === "orientation-snapshot-mismatch",
    );
  });
});
