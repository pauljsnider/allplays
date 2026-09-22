"use strict";

const {
  hashDiamondValue,
  normalizeDiamondId,
} = require("./diamond-scorebook-core.cjs");
const {
  normalizeDiamondOrientationSnapshot,
} = require("./diamond-scorebook-projections.cjs");

const DIAMOND_ORIENTATION_SNAPSHOT_SCHEMA_VERSION = 1;

class DiamondOrientationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DiamondOrientationError";
    this.code = code;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalName(value) {
  const text =
    typeof value === "string"
      ? value
          .replace(/[\u0000-\u001f\u007f]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : "";
  if (text.length > 160) {
    throw new DiamondOrientationError(
      "orientation-name-invalid",
      "Orientation names must be at most 160 characters.",
    );
  }
  return text;
}

function optionalId(value, field) {
  if (value === null || value === undefined || value === "") return null;
  try {
    return normalizeDiamondId(value, field);
  } catch {
    throw new DiamondOrientationError(
      "orientation-id-invalid",
      `${field} is not a safe Diamond identifier.`,
    );
  }
}

function optionalSide(value, field) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new DiamondOrientationError(
      "orientation-side-invalid",
      `${field} must be home or away.`,
    );
  }
  const side = value.trim().toLowerCase();
  if (side !== "home" && side !== "away") {
    throw new DiamondOrientationError(
      "orientation-side-invalid",
      `${field} must be home or away.`,
    );
  }
  return side;
}

function uniqueEvidence(values, code, message) {
  const unique = [...new Set(values.filter((value) => value !== null))];
  if (unique.length > 1) throw new DiamondOrientationError(code, message);
  return unique[0] ?? null;
}

function explicitName(game, fields, label) {
  const values = fields
    .filter(
      (field) =>
        game[field] !== null && game[field] !== undefined && game[field] !== "",
    )
    .map((field) => canonicalName(game[field]));
  if (values.some((value) => !value)) {
    throw new DiamondOrientationError(
      "orientation-name-invalid",
      `${label} must be a nonempty name.`,
    );
  }
  return uniqueEvidence(
    values,
    "orientation-name-conflict",
    `${label} fields disagree.`,
  );
}

function createDiamondOrientationSnapshot({ teamId, team, game }) {
  let managedTeamId;
  try {
    managedTeamId = normalizeDiamondId(teamId, "teamId");
  } catch {
    throw new DiamondOrientationError(
      "orientation-team-invalid",
      "The managed team ID is invalid.",
    );
  }
  if (!isPlainObject(team) || !isPlainObject(game)) {
    throw new DiamondOrientationError(
      "orientation-source-invalid",
      "Complete team and game records are required to pin home and away.",
    );
  }
  const storedGameTeamId = optionalId(game.teamId, "game.teamId");
  if (storedGameTeamId && storedGameTeamId !== managedTeamId) {
    throw new DiamondOrientationError(
      "orientation-team-mismatch",
      "The scheduled game belongs to a different team.",
    );
  }

  const homeTeamId = optionalId(game.homeTeamId, "game.homeTeamId");
  const awayTeamId = optionalId(game.awayTeamId, "game.awayTeamId");
  const linkedOpponentTeamId = optionalId(
    game.opponentTeamId,
    "game.opponentTeamId",
  );
  if (homeTeamId && awayTeamId && homeTeamId === awayTeamId) {
    throw new DiamondOrientationError(
      "orientation-team-conflict",
      "Home and away cannot reference the same team.",
    );
  }

  const sideEvidence = [
    optionalSide(game.teamSide, "game.teamSide"),
    optionalSide(game.homeAway, "game.homeAway"),
  ];
  if (game.isHome !== null && game.isHome !== undefined) {
    if (typeof game.isHome !== "boolean") {
      throw new DiamondOrientationError(
        "orientation-side-invalid",
        "game.isHome must be a boolean when present.",
      );
    }
    sideEvidence.push(game.isHome ? "home" : "away");
  }
  if (homeTeamId === managedTeamId) sideEvidence.push("home");
  if (awayTeamId === managedTeamId) sideEvidence.push("away");
  const managedSide = uniqueEvidence(
    sideEvidence,
    "orientation-side-conflict",
    "The scheduled game's home and away evidence disagrees.",
  );
  if (!managedSide) {
    throw new DiamondOrientationError(
      "orientation-side-required",
      "Choose whether the managed team is home or away before Diamond activation.",
    );
  }
  const opponentSide = managedSide === "home" ? "away" : "home";
  const managedSourceId = managedSide === "home" ? homeTeamId : awayTeamId;
  const opponentSourceId = managedSide === "home" ? awayTeamId : homeTeamId;
  if (managedSourceId && managedSourceId !== managedTeamId) {
    throw new DiamondOrientationError(
      "orientation-team-conflict",
      "The managed-side team ID conflicts with the team being activated.",
    );
  }
  if (opponentSourceId === managedTeamId) {
    throw new DiamondOrientationError(
      "orientation-team-conflict",
      "The managed team cannot occupy both sides of a game.",
    );
  }
  const opponentTeamId = uniqueEvidence(
    [opponentSourceId, linkedOpponentTeamId],
    "orientation-opponent-conflict",
    "The scheduled game's opponent team IDs disagree.",
  );
  if (opponentTeamId === managedTeamId) {
    throw new DiamondOrientationError(
      "orientation-opponent-conflict",
      "The opponent must differ from the managed team.",
    );
  }

  const teamName = explicitName(
    team,
    ["name", "teamName"],
    "Managed team name",
  );
  if (!teamName) {
    throw new DiamondOrientationError(
      "orientation-team-name-required",
      "The managed team needs a name before Diamond activation.",
    );
  }
  const explicitHomeName = explicitName(
    game,
    ["homeName", "homeTeamName"],
    "Home team name",
  );
  const explicitAwayName = explicitName(
    game,
    ["awayName", "awayTeamName"],
    "Away team name",
  );
  const opponentName = uniqueEvidence(
    [
      explicitName(
        game,
        ["opponentName", "opponent", "opponentTeamName"],
        "Opponent name",
      ),
      managedSide === "home" ? explicitAwayName : explicitHomeName,
    ],
    "orientation-opponent-name-conflict",
    "The scheduled game's opponent names disagree.",
  );
  if (!opponentName) {
    throw new DiamondOrientationError(
      "orientation-opponent-name-required",
      "The game needs an opponent name before Diamond activation.",
    );
  }
  const expectedHomeName = managedSide === "home" ? teamName : opponentName;
  const expectedAwayName = managedSide === "away" ? teamName : opponentName;
  if (
    (explicitHomeName && explicitHomeName !== expectedHomeName) ||
    (explicitAwayName && explicitAwayName !== expectedAwayName)
  ) {
    throw new DiamondOrientationError(
      "orientation-name-conflict",
      "The scheduled home and away names do not match the pinned teams.",
    );
  }

  let snapshot;
  try {
    snapshot = normalizeDiamondOrientationSnapshot(
      {
        schemaVersion: DIAMOND_ORIENTATION_SNAPSHOT_SCHEMA_VERSION,
        managedSide,
        opponentSide,
        managedTeamId,
        opponentTeamId,
        homeTeamId: managedSide === "home" ? managedTeamId : opponentTeamId,
        awayTeamId: managedSide === "away" ? managedTeamId : opponentTeamId,
        teamName,
        opponentName,
        homeName: expectedHomeName,
        awayName: expectedAwayName,
      },
      managedTeamId,
    );
  } catch (error) {
    if (error instanceof DiamondOrientationError) throw error;
    throw new DiamondOrientationError(
      error?.code || "orientation-snapshot-invalid",
      error?.message || "The Diamond orientation snapshot is invalid.",
    );
  }
  return Object.freeze({
    snapshot,
    snapshotHash: hashDiamondValue(snapshot),
  });
}

function validateDiamondOrientationPin({ teamId, orientationSnapshot }) {
  let snapshot;
  try {
    snapshot = normalizeDiamondOrientationSnapshot(orientationSnapshot, teamId);
  } catch (error) {
    throw new DiamondOrientationError(
      error?.code || "orientation-snapshot-invalid",
      error?.message || "The Diamond orientation snapshot is invalid.",
    );
  }
  return Object.freeze({
    snapshot,
    snapshotHash: hashDiamondValue(snapshot),
  });
}

module.exports = {
  DIAMOND_ORIENTATION_SNAPSHOT_SCHEMA_VERSION,
  DiamondOrientationError,
  createDiamondOrientationSnapshot,
  validateDiamondOrientationPin,
};
