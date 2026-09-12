"use strict";

const diamondEngine = require("./diamond-engine");
const {
  DIAMOND_SCHEMA_VERSION,
  getDiamondPlayerIdentityIdsBySide,
  getEffectiveDiamondEvents,
  projectDiamondStats,
  replayEffectiveDiamondEventStates,
  validateDiamondPlayerIdentityOwnership,
  verifyDiamondLedger,
} = diamondEngine;
const {
  DIAMOND_ENGINE,
  decideDiamondNotification,
  normalizeDiamondId,
  sanitizeDiamondPrivateProjection,
  sanitizeDiamondPublicEvent,
  sanitizeDiamondPublicProjection,
} = require("./diamond-scorebook-core.cjs");
const privateNoteCore = require("./diamond-private-note-core.cjs");

const DIAMOND_PROJECTION_SCHEMA_VERSION = 1;
const DIAMOND_PUBLIC_REPLAY_PAGE_SIZE = 100;
const DIAMOND_PUBLIC_REPLAY_PAGE_LIMIT = 200;
const DIAMOND_PUBLIC_RECENT_PLAY_LIMIT = 20;
const DIAMOND_PRIVATE_RECENT_NOTE_LIMIT = 100;
const DIAMOND_CLIP_MAX_DURATION_MS = 60_000;
const CORRECTION_TYPES = new Set(["void_event", "supersede_event"]);
const PRIVATE_EVENT_TYPES = new Set(["private_note"]);
const CLIP_ELIGIBLE_TYPES = new Set([
  "record_plate_appearance",
  "advance_runner",
]);
const AI_ARTIFACT_FIELDS = Object.freeze([
  "aiRecap",
  "gameRecap",
  "recap",
  "aiInsights",
  "gameInsights",
  "insights",
]);
const DIAMOND_ORIENTATION_SNAPSHOT_SCHEMA_VERSION = 1;
const ORIENTATION_SNAPSHOT_FIELDS = Object.freeze([
  "schemaVersion",
  "managedSide",
  "opponentSide",
  "managedTeamId",
  "opponentTeamId",
  "homeTeamId",
  "awayTeamId",
  "teamName",
  "opponentName",
  "homeName",
  "awayName",
]);
const DIAMOND_SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const DIAMOND_UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIAMOND_COVERAGE_STATUSES = new Set([
  "complete",
  "partial",
  "not_collected",
]);
const DIAMOND_PUBLIC_TEAM_STAT_FIELDS = new Set([
  "trackingEngine",
  "projectionSchemaVersion",
  "sourceRevision",
  "checkpointHash",
  "coverage",
  "publicStatIds",
  "side",
  "complete",
  "stats",
  "observedStats",
  "statCoverage",
  "teamId",
  "diamondGameId",
  "instanceId",
  "diamondScorebookInstanceId",
  "projectionGeneration",
  "statConfigSnapshotHash",
  "projectionHash",
]);
const DIAMOND_PROJECTED_TEAM_STAT_IDS = new Set([
  "r",
  "h",
  "e",
  "lob",
  "risp_opportunities",
  "risp_hits",
  "two_out_runs",
  "two_strike_pa",
  "two_strike_hits",
  "first_pitch_strike_opportunities",
  "first_pitch_strikes",
]);

const PLAYER_RAW_FIELDS = Object.freeze({
  batting: Object.freeze([
    ["G", "g"],
    ["GS", "gs"],
    ["PA", "pa"],
    ["AB", "ab"],
    ["R", "r"],
    ["H", "h"],
    ["1B", "1b"],
    ["2B", "2b"],
    ["3B", "3b"],
    ["HR", "hr"],
    ["TB", "tb"],
    ["RBI", "rbi"],
    ["BB", "bb"],
    ["IBB", "ibb"],
    ["HBP", "hbp"],
    ["SO", "so"],
    ["SF", "sf"],
    ["SH", "sh"],
    ["ROE", "roe"],
    ["FC", "fc"],
    ["GIDP", "gidp"],
  ]),
  baserunning: Object.freeze([
    ["SB", "sb"],
    ["CS", "cs"],
    ["pickoffs", "pickoffs"],
    ["advances", "br_advances"],
    ["outs", "br_outs"],
  ]),
  pitching: Object.freeze([
    ["APP", "p_app"],
    ["GS", "p_gs"],
    ["W", "w"],
    ["L", "l"],
    ["SV", "sv"],
    ["BF", "bf"],
    ["outs", "ip_outs"],
    ["H", "p_h"],
    ["R", "p_r"],
    ["ER", "er"],
    ["BB", "p_bb"],
    ["IBB", "p_ibb"],
    ["HBP", "p_hbp"],
    ["SO", "p_so"],
    ["HR", "p_hr"],
    ["WP", "wp"],
    ["balkIllegalPitch", "balk_illegal_pitch"],
    ["inheritedRunners", "inherited_runners"],
    ["inheritedScored", "inherited_scored"],
    ["pitches", "pitches"],
    ["strikes", "strikes"],
    ["firstPitchStrikes", "first_pitch_strikes"],
  ]),
  fielding: Object.freeze([
    ["defensiveOuts", "defensive_outs"],
    ["PO", "po"],
    ["A", "a"],
    ["E", "e"],
    ["DP", "dp"],
    ["TP", "tp"],
    ["PB", "pb"],
  ]),
});

const PLAYER_DERIVED_FIELDS = Object.freeze({
  batting: Object.freeze([
    ["AVG", "avg"],
    ["OBP", "obp"],
    ["SLG", "slg"],
    ["OPS", "ops"],
    ["bbRate", "bb_rate"],
    ["strikeoutRate", "strikeout_rate"],
  ]),
  baserunning: Object.freeze([["stolenBaseRate", "stolen_base_rate"]]),
  pitching: Object.freeze([
    ["inningsPitched", "innings_pitched"],
    ["ERA", "era"],
    ["WHIP", "whip"],
    ["strikeoutWalkRatio", "strikeout_walk_ratio"],
    ["strikeRate", "strike_rate"],
    ["firstPitchStrikeRate", "first_pitch_strike_rate"],
  ]),
  fielding: Object.freeze([
    ["fieldingPercentage", "fpct"],
    ["chances", "chances"],
  ]),
});
const PITCH_RAW_DOMAIN_KEYS = new Set([
  "pitches",
  "strikes",
  "firstPitchStrikes",
]);
const PITCH_DERIVED_DOMAIN_KEYS = new Set([
  "strikeRate",
  "firstPitchStrikeRate",
]);

const PLATE_APPEARANCE_LABELS = Object.freeze({
  single: "singled",
  double: "doubled",
  triple: "tripled",
  home_run: "hit a home run",
  walk: "walked",
  intentional_walk: "was intentionally walked",
  hit_by_pitch: "was hit by a pitch",
  strikeout: "struck out",
  reached_on_error: "reached on an error",
  fielders_choice: "reached on a fielder's choice",
  sacrifice_bunt: "laid down a sacrifice bunt",
  sacrifice_fly: "hit a sacrifice fly",
  interference: "reached on interference",
  dropped_third_strike: "reached on a dropped third strike",
  ground_out: "grounded out",
  fly_out: "flied out",
  line_out: "lined out",
  double_play: "hit into a double play",
  triple_play: "hit into a triple play",
});

const PITCH_LABELS = Object.freeze({
  ball: "Ball",
  called_strike: "Called strike",
  swinging_strike: "Swinging strike",
  foul: "Foul ball",
  foul_bunt: "Foul bunt",
  in_play: "Ball in play",
  hit_by_pitch: "Hit by pitch",
  catcher_interference: "Catcher's interference",
  illegal_pitch: "Illegal pitch",
  balk: "Balk",
  pickoff_attempt: "Pickoff attempt",
});

class DiamondProjectionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "DiamondProjectionError";
    this.code = code;
  }
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function compactText(value, maximum = 120) {
  const text =
    typeof value === "string"
      ? value
          .replace(/[\u0000-\u001f\u007f]+/g, " ")
          .replace(/\s+/g, " ")
          .trim()
      : "";
  if (text.length <= maximum) return text;
  return `${text.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function requireNonnegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DiamondProjectionError(
      "invalid-argument",
      `${field} must be a nonnegative safe integer.`,
    );
  }
  return value;
}

function requireHash(value, field = "checkpointHash") {
  if (
    value !== "" &&
    (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value))
  ) {
    throw new DiamondProjectionError(
      "invalid-argument",
      `${field} must be an empty or canonical SHA-256 hash.`,
    );
  }
  return value;
}

function assertDiamondLedger(ledger) {
  if (
    !isPlainObject(ledger) ||
    !isPlainObject(ledger.state) ||
    !Array.isArray(ledger.events)
  ) {
    throw new DiamondProjectionError(
      "invalid-ledger",
      "A complete Diamond ledger is required for projection.",
    );
  }
  if (ledger.state.schemaVersion !== DIAMOND_SCHEMA_VERSION) {
    throw new DiamondProjectionError(
      "unsupported-schema",
      "The Diamond ledger schema is not supported.",
    );
  }
  if (ledger.state.revision !== ledger.events.length) {
    throw new DiamondProjectionError(
      "revision-gap",
      "The Diamond ledger is not gap-free.",
    );
  }
  requireHash(ledger.state.checkpointHash);
  verifyDiamondLedger(ledger);
  validateDiamondPlayerIdentityOwnership(ledger);
  return ledger;
}

function oppositeSide(side) {
  return side === "home" ? "away" : "home";
}

function officialFinalWinningSide(state) {
  if (state.lifecycle !== "final") return null;
  if (state.finalizationReason?.kind === "forfeit") {
    return state.gameEndDecision?.reason === "forfeit"
      ? state.gameEndDecision.awardedSide
      : null;
  }
  if (state.score.home === state.score.away) return null;
  return state.score.home > state.score.away ? "home" : "away";
}

function normalizeOrientationId(value, field, { optional = false } = {}) {
  if (optional && value === null) return null;
  try {
    return normalizeDiamondId(value, field);
  } catch {
    throw new DiamondProjectionError(
      "invalid-orientation-snapshot",
      `${field} must be a valid Diamond identifier${optional ? " or null" : ""}.`,
    );
  }
}

function normalizeOrientationName(value, field) {
  const normalized = compactText(value, 160);
  if (!normalized || normalized !== value) {
    throw new DiamondProjectionError(
      "invalid-orientation-snapshot",
      `${field} must be a canonical nonempty string of at most 160 characters.`,
    );
  }
  return normalized;
}

function normalizeDiamondOrientationSnapshot(orientationSnapshot, teamId) {
  if (!isPlainObject(orientationSnapshot)) {
    throw new DiamondProjectionError(
      "orientation-snapshot-required",
      "Projection requires the immutable orientation snapshot pinned at activation.",
    );
  }
  const keys = Object.keys(orientationSnapshot).sort();
  const expectedKeys = [...ORIENTATION_SNAPSHOT_FIELDS].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new DiamondProjectionError(
      "invalid-orientation-snapshot",
      "The immutable orientation snapshot has an unsupported field set.",
    );
  }
  if (
    orientationSnapshot.schemaVersion !==
    DIAMOND_ORIENTATION_SNAPSHOT_SCHEMA_VERSION
  ) {
    throw new DiamondProjectionError(
      "invalid-orientation-snapshot",
      "The immutable orientation snapshot schema is unsupported.",
    );
  }
  const managedSide = orientationSnapshot.managedSide;
  if (managedSide !== "home" && managedSide !== "away") {
    throw new DiamondProjectionError(
      "invalid-orientation-snapshot",
      "orientationSnapshot.managedSide must be home or away.",
    );
  }
  const opponentSide = orientationSnapshot.opponentSide;
  if (opponentSide !== oppositeSide(managedSide)) {
    throw new DiamondProjectionError(
      "invalid-orientation-snapshot",
      "orientationSnapshot.opponentSide must be opposite managedSide.",
    );
  }
  const managedTeamId = normalizeOrientationId(
    orientationSnapshot.managedTeamId,
    "orientationSnapshot.managedTeamId",
  );
  if (teamId !== undefined && managedTeamId !== teamId) {
    throw new DiamondProjectionError(
      "orientation-snapshot-mismatch",
      "The immutable orientation snapshot does not belong to the projected team.",
    );
  }
  const opponentTeamId = normalizeOrientationId(
    orientationSnapshot.opponentTeamId,
    "orientationSnapshot.opponentTeamId",
    { optional: true },
  );
  if (opponentTeamId === managedTeamId) {
    throw new DiamondProjectionError(
      "invalid-orientation-snapshot",
      "The opponent team must differ from the managed team.",
    );
  }
  const homeTeamId = normalizeOrientationId(
    orientationSnapshot.homeTeamId,
    "orientationSnapshot.homeTeamId",
    { optional: true },
  );
  const awayTeamId = normalizeOrientationId(
    orientationSnapshot.awayTeamId,
    "orientationSnapshot.awayTeamId",
    { optional: true },
  );
  const expectedHomeTeamId =
    managedSide === "home" ? managedTeamId : opponentTeamId;
  const expectedAwayTeamId =
    managedSide === "away" ? managedTeamId : opponentTeamId;
  if (homeTeamId !== expectedHomeTeamId || awayTeamId !== expectedAwayTeamId) {
    throw new DiamondProjectionError(
      "orientation-snapshot-mismatch",
      "The immutable home and away team IDs do not match the pinned sides.",
    );
  }
  const teamName = normalizeOrientationName(
    orientationSnapshot.teamName,
    "orientationSnapshot.teamName",
  );
  const opponentName = normalizeOrientationName(
    orientationSnapshot.opponentName,
    "orientationSnapshot.opponentName",
  );
  const homeName = normalizeOrientationName(
    orientationSnapshot.homeName,
    "orientationSnapshot.homeName",
  );
  const awayName = normalizeOrientationName(
    orientationSnapshot.awayName,
    "orientationSnapshot.awayName",
  );
  const expectedHomeName = managedSide === "home" ? teamName : opponentName;
  const expectedAwayName = managedSide === "away" ? teamName : opponentName;
  if (homeName !== expectedHomeName || awayName !== expectedAwayName) {
    throw new DiamondProjectionError(
      "orientation-snapshot-mismatch",
      "The immutable home and away names do not match the pinned sides.",
    );
  }
  return deepFreeze({
    schemaVersion: DIAMOND_ORIENTATION_SNAPSHOT_SCHEMA_VERSION,
    managedSide,
    opponentSide,
    managedTeamId,
    opponentTeamId,
    homeTeamId,
    awayTeamId,
    teamName,
    opponentName,
    homeName,
    awayName,
  });
}

function normalizePlayerDirectory(
  playerDirectory,
  ledger,
  playerDirectoryBySide,
) {
  if (playerDirectory !== undefined && !isPlainObject(playerDirectory)) {
    throw new DiamondProjectionError(
      "invalid-player-directory",
      "playerDirectory must be an object keyed by player ID.",
    );
  }
  if (
    playerDirectoryBySide !== undefined &&
    !isPlainObject(playerDirectoryBySide)
  ) {
    throw new DiamondProjectionError(
      "invalid-player-directory",
      "playerDirectoryBySide must contain home and away player directories.",
    );
  }
  const directory = Object.create(null);
  for (const side of ["home", "away"]) {
    for (const slot of ledger.state.lineups[side].battingOrder) {
      const starterIdentity = {
        playerName: compactText(slot.displayName, 100),
        playerNumber: compactText(slot.jerseyNumber, 24),
      };
      directory[slot.starterPlayerId] ||= starterIdentity;
      directory[slot.activePlayerId] ||=
        slot.activePlayerId === slot.starterPlayerId
          ? starterIdentity
          : { playerName: "", playerNumber: "" };
      for (const playerId of slot.substitutions || [])
        directory[playerId] ||= { playerName: "", playerNumber: "" };
    }
    for (const playerId of Object.values(ledger.state.lineups[side].defense)) {
      if (playerId)
        directory[playerId] ||= { playerName: "", playerNumber: "" };
    }
  }
  for (const [rawPlayerId, rawPlayer] of Object.entries(
    playerDirectory || {},
  )) {
    const playerId = normalizeDiamondId(
      rawPlayerId,
      "playerDirectory playerId",
    );
    if (!isPlainObject(rawPlayer)) continue;
    directory[playerId] = {
      playerName: compactText(rawPlayer.playerName || rawPlayer.name, 100),
      playerNumber: compactText(
        rawPlayer.playerNumber || rawPlayer.number || rawPlayer.num,
        24,
      ),
    };
  }
  const claimedPlayerIds = getDiamondPlayerIdentityIdsBySide(ledger);
  for (const side of ["home", "away"]) {
    const rawSideDirectory = playerDirectoryBySide?.[side];
    if (rawSideDirectory === undefined) continue;
    if (!isPlainObject(rawSideDirectory)) {
      throw new DiamondProjectionError(
        "invalid-player-directory",
        `playerDirectoryBySide.${side} must be an object keyed by player ID.`,
      );
    }
    const sideDirectory = Object.create(null);
    for (const [rawPlayerId, rawPlayer] of Object.entries(rawSideDirectory)) {
      const playerId = normalizeDiamondId(
        rawPlayerId,
        `playerDirectoryBySide.${side} playerId`,
      );
      if (!isPlainObject(rawPlayer)) continue;
      sideDirectory[playerId] = {
        playerName: compactText(rawPlayer.playerName || rawPlayer.name, 100),
        playerNumber: compactText(
          rawPlayer.playerNumber || rawPlayer.number || rawPlayer.num,
          24,
        ),
      };
    }
    for (const playerId of claimedPlayerIds[side]) {
      if (own(sideDirectory, playerId)) {
        directory[playerId] = sideDirectory[playerId];
      }
    }
  }
  return Object.fromEntries(Object.entries(directory));
}

function playerIdentity(playerId, directory) {
  const identity = directory[playerId] || {};
  return {
    playerId,
    ...(identity.playerName ? { displayName: identity.playerName } : {}),
    ...(identity.playerNumber ? { number: identity.playerNumber } : {}),
  };
}

function viewerPlayerIdentity(playerId, directory) {
  if (!playerId) return null;
  const identity = playerIdentity(playerId, directory);
  return {
    playerId: identity.playerId,
    name: identity.displayName || identity.playerId,
    ...(identity.number ? { number: identity.number } : {}),
  };
}

function publicCurrentMatchup(state, directory) {
  const battingSide = state.inning.half === "bottom" ? "home" : "away";
  const fieldingSide = battingSide === "home" ? "away" : "home";
  const battingOrder = state.lineups[battingSide].battingOrder;
  const nextSlot = Number.isSafeInteger(state.nextBatterSlot[battingSide])
    ? state.nextBatterSlot[battingSide]
    : 0;
  const batter = battingOrder.length
    ? battingOrder[nextSlot % battingOrder.length]
    : null;
  const pitcherId = state.lineups[fieldingSide].defense.P || null;
  return {
    currentBatter: batter
      ? viewerPlayerIdentity(batter.activePlayerId, directory)
      : null,
    currentPitcher: viewerPlayerIdentity(pitcherId, directory),
  };
}

function playerLabel(playerId, directory) {
  return (
    directory[playerId]?.playerName || `Player ${compactText(playerId, 32)}`
  );
}

function inningLabel(inning) {
  return `${inning.half === "top" ? "Top" : "Bottom"} ${String(inning.number)}`;
}

function lifecycleStatus(lifecycle) {
  if (lifecycle === "active" || lifecycle === "suspended") return "live";
  if (lifecycle === "final" || lifecycle === "correction") return "completed";
  if (lifecycle === "cancelled") return "cancelled";
  return "scheduled";
}

function publicBases(state, directory) {
  return Object.fromEntries(
    ["first", "second", "third"].map((base) => {
      const placement = state.bases[base];
      return [
        base,
        placement ? playerIdentity(placement.runnerId, directory) : null,
      ];
    }),
  );
}

function publicLineup(state, directory) {
  return Object.fromEntries(
    ["home", "away"].map((side) => [
      side,
      state.lineups[side].battingOrder.map((slot) => ({
        slot: slot.slot,
        ...playerIdentity(slot.activePlayerId, directory),
        battingRole: slot.battingRole,
      })),
    ]),
  );
}

function countRuns(before, after) {
  return (
    after.score.home -
    before.score.home +
    (after.score.away - before.score.away)
  );
}

function describePublicPlay(event, before, after, directory) {
  const payload = event.payload || {};
  switch (event.type) {
    case "activate":
      return "Scorebook ready";
    case "set_lineup":
      return `${payload.side === "away" ? "Away" : "Home"} lineup set`;
    case "set_defensive_alignment":
      return `${payload.side === "away" ? "Away" : "Home"} defense set`;
    case "set_dp_flex":
      return `${payload.side === "away" ? "Away" : "Home"} DP/FLEX set`;
    case "start":
      return "Game started";
    case "record_pitch":
      return `${PITCH_LABELS[payload.result] || "Pitch"} to ${playerLabel(payload.batterId, directory)}`;
    case "record_plate_appearance": {
      const result =
        PLATE_APPEARANCE_LABELS[payload.result] ||
        "completed the plate appearance";
      const runs = countRuns(before, after);
      return `${playerLabel(payload.batterId, directory)} ${result}${runs ? ` · ${String(runs)} ${runs === 1 ? "run" : "runs"} scored` : ""}`;
    }
    case "advance_runner": {
      const destination =
        payload.to === "home"
          ? "scored"
          : payload.to === "out"
            ? "was retired"
            : `advanced to ${payload.to}`;
      return `${playerLabel(payload.runnerId, directory)} ${destination}`;
    }
    case "record_fielding":
      return "Fielding details recorded";
    case "record_scoring_judgment":
      return "Official scoring updated";
    case "advance_half_inning":
      return `${inningLabel(after.inning)} begins`;
    case "place_tiebreaker_runner":
      return `Tiebreaker runner placed on ${payload.base}`;
    case "substitute":
      return `${playerLabel(payload.incomingPlayerId, directory)} entered the game`;
    case "re_enter":
      return `${playerLabel(payload.starterPlayerId, directory)} re-entered the game`;
    case "add_courtesy_runner":
      return `${playerLabel(payload.runnerId, directory)} entered as a courtesy runner`;
    case "scorer_handoff":
      return "Official scorer changed";
    case "suspend":
      return "Game suspended";
    case "resume":
      return "Game resumed";
    case "cancel":
      return "Game cancelled";
    case "finalize":
      return "Game final";
    case "reopen_for_correction":
      return "Scorebook reopened for correction";
    case "rules_decision":
      return "Rules decision recorded";
    default:
      return "Game update";
  }
}

function buildPublicPlay(event, before, after, directory, canonicalEvent) {
  const payload = event.payload || {};
  const batterId = typeof payload.batterId === "string" ? payload.batterId : "";
  const pitcherId =
    typeof payload.pitcherId === "string" ? payload.pitcherId : "";
  const runnerIds = Array.isArray(payload.runnerAdvances)
    ? payload.runnerAdvances.map((advance) => advance?.runnerId).filter(Boolean)
    : typeof payload.runnerId === "string"
      ? [payload.runnerId]
      : [];
  const fielding = payload.fielding;
  const fielderIds =
    fielding && typeof fielding === "object"
      ? [
          fielding.putoutBy,
          ...(fielding.putouts || []).map((entry) => entry?.putoutBy),
          ...(fielding.assists || []),
          ...(fielding.errors || []).map((entry) => entry?.playerId),
          fielding.passedBallBy,
        ].filter(Boolean)
      : [];
  return sanitizeDiamondPublicEvent({
    schemaVersion: DIAMOND_SCHEMA_VERSION,
    eventId: event.eventId,
    playId: event.eventId,
    sourceEventId: event.sourceEventId,
    sequence: event.revision,
    revision: event.revision,
    type: event.type,
    description: describePublicPlay(event, before, after, directory),
    label:
      event.type === "record_plate_appearance"
        ? PLATE_APPEARANCE_LABELS[payload.result] || "Plate appearance"
        : undefined,
    inning: { number: before.inning.number, half: before.inning.half },
    inningLabel: inningLabel(before.inning),
    score: { ...after.score },
    outs: after.inning.outs,
    count: { balls: after.inning.balls, strikes: after.inning.strikes },
    bases: publicBases(after, directory),
    ...(batterId ? { batter: playerIdentity(batterId, directory) } : {}),
    ...(pitcherId ? { pitcher: playerIdentity(pitcherId, directory) } : {}),
    ...(runnerIds.length
      ? {
          runners: [...new Set(runnerIds)].map((playerId) =>
            playerIdentity(playerId, directory),
          ),
        }
      : {}),
    ...(fielderIds.length
      ? {
          fielders: [...new Set(fielderIds)].map((playerId) =>
            playerIdentity(playerId, directory),
          ),
        }
      : {}),
    coverage: after.coverage,
    corrected: event.eventId !== event.sourceEventId,
    serverTimestampMs: canonicalEvent?.serverTimestampMs,
  });
}

function buildDiamondPublicPlays({
  ledger,
  playerDirectory = {},
  playerDirectoryBySide,
}) {
  assertDiamondLedger(ledger);
  const directory = normalizePlayerDirectory(
    playerDirectory,
    ledger,
    playerDirectoryBySide,
  );
  const canonicalById = new Map(
    ledger.events.map((event) => [event.eventId, event]),
  );
  const plays = [];
  for (const { event, before, after } of replayEffectiveDiamondEventStates(
    ledger.initialState,
    ledger.events,
  )) {
    const canonical = canonicalById.get(event.eventId);
    if (!PRIVATE_EVENT_TYPES.has(event.type)) {
      const publicEvent = privateNoteCore.isCanonicalPrivateNoteMaterialEvent(
        canonical,
        diamondEngine,
      )
        ? { ...event, sourceEventId: event.eventId }
        : event;
      plays.push(
        buildPublicPlay(
          publicEvent,
          before,
          after,
          directory,
          canonical,
        ),
      );
    }
  }
  return deepFreeze(plays);
}

function sourcesForFamily(sourceMap, family) {
  const prefix = `${family}.`;
  return [
    ...new Set(
      Object.entries(sourceMap || {})
        .filter(([key]) => key.startsWith(prefix))
        .flatMap(([, eventIds]) => (Array.isArray(eventIds) ? eventIds : [])),
    ),
  ].sort();
}

function mapDiamondPlayerStatLine(
  line,
  { pitcherDecisionCoverage = null } = {},
) {
  const stats = {};
  const observedStats = {};
  const derivedStats = {};
  const observedDerivedStats = {};
  const statCoverage = {};
  const statSources = {};
  const unavailableDerivedStats = [];

  for (const family of Object.keys(PLAYER_RAW_FIELDS)) {
    const coverage = line.coverage[family];
    for (const [domainKey, storedKey] of PLAYER_RAW_FIELDS[family]) {
      const value = line.raw[family][domainKey];
      const statStatus =
        family === "pitching" && ["W", "L", "SV"].includes(domainKey)
          ? pitcherDecisionCoverage || "not_collected"
          : family === "pitching" && PITCH_RAW_DOMAIN_KEYS.has(domainKey)
            ? line.coverage.pitches
            : coverage;
      statCoverage[storedKey] = statStatus;
      if (statStatus === "complete") stats[storedKey] = value;
      else if (statStatus === "partial" && Number(value) !== 0)
        observedStats[storedKey] = value;
      const sourceKey = `${family}.${domainKey}`;
      if (
        Array.isArray(line.sources[sourceKey]) &&
        line.sources[sourceKey].length
      ) {
        statSources[storedKey] = [...line.sources[sourceKey]];
      }
    }
    for (const [domainKey, storedKey] of PLAYER_DERIVED_FIELDS[family]) {
      const value = line.derived[domainKey];
      const statStatus =
        family === "pitching" && PITCH_DERIVED_DOMAIN_KEYS.has(domainKey)
          ? line.coverage.pitches
          : coverage;
      statCoverage[storedKey] = statStatus;
      if (statStatus === "complete") {
        if (value === null || value === undefined)
          unavailableDerivedStats.push(storedKey);
        else derivedStats[storedKey] = value;
      } else if (
        statStatus === "partial" &&
        value !== null &&
        value !== undefined &&
        (domainKey === "inningsPitched"
          ? line.raw.pitching.outs > 0
          : Number(value) !== 0)
      ) {
        observedDerivedStats[storedKey] = value;
      }
      const sources = sourcesForFamily(line.sources, family);
      if (sources.length) statSources[storedKey] = sources;
    }
  }

  if (line.coverage.fielding === "complete") {
    stats.fp = line.raw.fielding.PO + line.raw.fielding.A;
  } else if (
    line.coverage.fielding === "partial" &&
    line.raw.fielding.PO + line.raw.fielding.A > 0
  ) {
    observedStats.fp = line.raw.fielding.PO + line.raw.fielding.A;
  }
  statCoverage.fp = line.coverage.fielding;
  statSources.fp = [
    ...new Set([
      ...(line.sources["fielding.PO"] || []),
      ...(line.sources["fielding.A"] || []),
    ]),
  ].sort();
  if (!statSources.fp.length) delete statSources.fp;

  const sourcePlayIds = [...new Set(Object.values(statSources).flat())].sort();
  return {
    stats,
    observedStats,
    derivedStats,
    observedDerivedStats,
    statCoverage,
    statSources,
    sourcePlayIds,
    unavailableDerivedStats: unavailableDerivedStats.sort(),
    missingStatFamilies: Object.entries(line.coverage)
      .filter(
        ([family, coverage]) => family !== "sensors" && coverage !== "complete",
      )
      .map(([family]) => family)
      .sort(),
  };
}

function normalizePublicStatIds(values, label) {
  if (!Array.isArray(values) || values.length > 256) {
    throw new DiamondProjectionError(
      "invalid-stat-visibility",
      `${label} stat IDs must be a bounded array.`,
    );
  }
  return new Set(
    values.map((value) => {
      const key = compactText(value, 64).toLowerCase();
      if (!/^[a-z0-9][a-z0-9_]{0,63}$/.test(key)) {
        throw new DiamondProjectionError(
          "invalid-stat-visibility",
          `A ${label.toLowerCase()} stat ID is malformed.`,
        );
      }
      return key;
    }),
  );
}

function publicMappedStats(mapped, publicStatIds) {
  const withExplicitlyPublicKeys = (source) =>
    Object.fromEntries(
      Object.entries(source || {}).filter(([key]) => publicStatIds.has(key)),
    );
  const statSources = withExplicitlyPublicKeys(mapped.statSources);
  return {
    ...mapped,
    stats: withExplicitlyPublicKeys(mapped.stats),
    observedStats: withExplicitlyPublicKeys(mapped.observedStats),
    derivedStats: withExplicitlyPublicKeys(mapped.derivedStats),
    observedDerivedStats: withExplicitlyPublicKeys(mapped.observedDerivedStats),
    statCoverage: withExplicitlyPublicKeys(mapped.statCoverage),
    statSources,
    sourcePlayIds: [...new Set(Object.values(statSources).flat())].sort(),
    unavailableDerivedStats: mapped.unavailableDerivedStats.filter((key) =>
      publicStatIds.has(key),
    ),
  };
}

function buildPlayerDocument(
  line,
  directory,
  projection,
  { pitcherDecisionCoverage = null, publicPlayerStatIds = [] } = {},
) {
  const mapped = mapDiamondPlayerStatLine(line, { pitcherDecisionCoverage });
  const explicitlyPublicStatIds = normalizePublicStatIds(
    publicPlayerStatIds,
    "Public player",
  );
  const publicMapped = publicMappedStats(mapped, explicitlyPublicStatIds);
  const identity = directory[line.playerId] || {};
  const participated =
    line.raw.batting.G > 0 ||
    line.raw.pitching.APP > 0 ||
    line.raw.fielding.defensiveOuts > 0;
  const common = {
    playerName: identity.playerName || "",
    playerNumber: identity.playerNumber || "",
    participated,
    participationStatus: participated ? "appeared" : "did-not-appear",
    participationSource: "diamond-v2",
    ...(participated ? {} : { didNotPlay: true }),
    trackingEngine: DIAMOND_ENGINE,
    projectionSchemaVersion: DIAMOND_PROJECTION_SCHEMA_VERSION,
    sourceRevision: projection.sourceRevision,
    checkpointHash: projection.checkpointHash,
    coverage: line.coverage,
    complete: true,
  };
  const publicStatIds = Object.keys(publicMapped.statCoverage).sort();
  return {
    publicData: {
      ...common,
      schemaVersion: DIAMOND_PROJECTION_SCHEMA_VERSION,
      playerId: line.playerId,
      publicStatIds,
      ...publicMapped,
    },
    privateData: {
      ...common,
      ...mapped,
      playerId: line.playerId,
      side: line.side,
      authoritative: true,
    },
  };
}

function getDiamondPublicProjectionHead(game, { teamId, gameId } = {}) {
  if (!isPlainObject(game) || game.trackingEngine !== DIAMOND_ENGINE)
    return null;
  const normalizedStatus = compactText(
    game.diamondProjectionStatus,
    32,
  ).toLowerCase();
  const instanceId = compactText(game.diamondScorebookInstanceId, 128);
  const sourceRevision = game.diamondProjectionRevision;
  const checkpointHash = compactText(game.diamondProjectionCheckpointHash, 80);
  const statConfigSnapshotHash = compactText(
    game.diamondStatConfigSnapshotHash,
    80,
  );
  const projectionHash = compactText(game.diamondProjectionHash, 80);
  let normalizedTeamId;
  let normalizedGameId;
  try {
    normalizedTeamId = normalizeDiamondId(teamId, "teamId");
    normalizedGameId = normalizeDiamondId(gameId, "gameId");
  } catch {
    return null;
  }
  if (
    !["current", "complete"].includes(normalizedStatus) ||
    game.diamondProjectionComplete !== true ||
    !DIAMOND_UUID_V4_PATTERN.test(instanceId) ||
    !Number.isSafeInteger(sourceRevision) ||
    sourceRevision < 0 ||
    !DIAMOND_SHA256_PATTERN.test(checkpointHash) ||
    !DIAMOND_SHA256_PATTERN.test(statConfigSnapshotHash) ||
    !DIAMOND_SHA256_PATTERN.test(projectionHash) ||
    (own(game, "teamId") && game.teamId !== normalizedTeamId) ||
    (own(game, "id") && game.id !== normalizedGameId) ||
    (own(game, "gameId") && game.gameId !== normalizedGameId)
  ) {
    return null;
  }
  return deepFreeze({
    teamId: normalizedTeamId,
    gameId: normalizedGameId,
    instanceId,
    sourceRevision,
    checkpointHash,
    statConfigSnapshotHash,
    projectionHash,
  });
}

function isStrictPublicTeamStatMap(value, allowedIds) {
  return (
    isPlainObject(value) &&
    Object.keys(value).length <= 256 &&
    Object.entries(value).every(
      ([key, entry]) =>
        allowedIds.has(key) && Number.isSafeInteger(entry) && entry >= 0,
    )
  );
}

function sanitizeDiamondPublicTeamStatDocument({
  game,
  teamId,
  gameId,
  allowedStatIds = null,
} = {}) {
  const head = getDiamondPublicProjectionHead(game, { teamId, gameId });
  const document = game?.diamondPublicTeamStats;
  if (!head || !isPlainObject(document)) return null;
  const documentKeys = Object.keys(document);
  if (
    documentKeys.length !== DIAMOND_PUBLIC_TEAM_STAT_FIELDS.size ||
    documentKeys.some((key) => !DIAMOND_PUBLIC_TEAM_STAT_FIELDS.has(key))
  ) {
    return null;
  }
  const publicStatIds = Array.isArray(document.publicStatIds)
    ? [...document.publicStatIds]
    : null;
  if (
    !publicStatIds ||
    publicStatIds.length > 256 ||
    publicStatIds.some(
      (statId) =>
        typeof statId !== "string" ||
        !DIAMOND_PROJECTED_TEAM_STAT_IDS.has(statId),
    ) ||
    publicStatIds.some(
      (statId, index) =>
        (index > 0 && publicStatIds[index - 1] >= statId) ||
        publicStatIds.indexOf(statId) !== index,
    )
  ) {
    return null;
  }
  const publicIdSet = new Set(publicStatIds);
  if (
    document.trackingEngine !== DIAMOND_ENGINE ||
    document.projectionSchemaVersion !== DIAMOND_PROJECTION_SCHEMA_VERSION ||
    document.complete !== true ||
    (document.side !== "home" && document.side !== "away") ||
    document.teamId !== head.teamId ||
    document.diamondGameId !== head.gameId ||
    document.instanceId !== head.instanceId ||
    document.diamondScorebookInstanceId !== head.instanceId ||
    document.projectionGeneration !== head.instanceId ||
    document.sourceRevision !== head.sourceRevision ||
    document.checkpointHash !== head.checkpointHash ||
    document.statConfigSnapshotHash !== head.statConfigSnapshotHash ||
    document.projectionHash !== head.projectionHash ||
    !isPlainObject(document.statCoverage) ||
    Object.keys(document.statCoverage).length !== publicStatIds.length ||
    Object.entries(document.statCoverage).some(
      ([statId, status]) =>
        !publicIdSet.has(statId) || !DIAMOND_COVERAGE_STATUSES.has(status),
    ) ||
    !isPlainObject(document.coverage) ||
    Object.keys(document.coverage).length > 32 ||
    Object.entries(document.coverage).some(
      ([family, status]) =>
        !/^[a-z0-9][a-z0-9_]{0,63}$/.test(family) ||
        !DIAMOND_COVERAGE_STATUSES.has(status),
    )
  ) {
    return null;
  }
  const completeIds = new Set(
    publicStatIds.filter(
      (statId) => document.statCoverage[statId] === "complete",
    ),
  );
  const partialIds = new Set(
    publicStatIds.filter(
      (statId) => document.statCoverage[statId] === "partial",
    ),
  );
  if (
    !isStrictPublicTeamStatMap(document.stats, completeIds) ||
    !isStrictPublicTeamStatMap(document.observedStats, partialIds) ||
    Object.keys(document.stats).some((statId) =>
      own(document.observedStats, statId),
    )
  ) {
    return null;
  }
  let allowedIds = publicIdSet;
  if (allowedStatIds !== null) {
    try {
      allowedIds = normalizePublicStatIds(allowedStatIds, "Public team");
    } catch {
      return null;
    }
  }
  const visibleIds = publicStatIds.filter((statId) => allowedIds.has(statId));
  const visibleIdSet = new Set(visibleIds);
  const selectVisible = (source) =>
    Object.fromEntries(
      Object.entries(source).filter(([statId]) => visibleIdSet.has(statId)),
    );
  return deepFreeze({
    ...document,
    coverage: { ...document.coverage },
    publicStatIds: visibleIds,
    stats: selectVisible(document.stats),
    observedStats: selectVisible(document.observedStats),
    statCoverage: selectVisible(document.statCoverage),
  });
}

function serializeDiamondPublicStatsResponse({ game, teamId, gameId } = {}) {
  const partial = () =>
    deepFreeze({
      schemaVersion: 1,
      trackingEngine: DIAMOND_ENGINE,
      status: "partial",
      complete: false,
    });
  const head = getDiamondPublicProjectionHead(game, { teamId, gameId });
  if (!head) return partial();
  const publicTeamStats = sanitizeDiamondPublicTeamStatDocument({
    game,
    teamId,
    gameId,
  });
  if (!publicTeamStats) return partial();
  return deepFreeze({
    schemaVersion: 1,
    trackingEngine: DIAMOND_ENGINE,
    status: "complete",
    complete: true,
    instanceId: head.instanceId,
    sourceRevision: head.sourceRevision,
    checkpointHash: head.checkpointHash,
    statConfigSnapshotHash: head.statConfigSnapshotHash,
    projectionHash: head.projectionHash,
    publicTeamStats,
  });
}

function mapTeamStats(raw, coverage, score) {
  const stats = { r: score };
  const observedStats = {};
  const statCoverage = { r: "complete" };
  const mappings = [
    ["H", "h", "batting"],
    ["E", "e", "fielding"],
    ["LOB", "lob", "baserunning"],
    ["rispOpportunities", "risp_opportunities", "situational"],
    ["rispHits", "risp_hits", "situational"],
    ["twoOutRuns", "two_out_runs", "situational"],
    ["twoStrikePlateAppearances", "two_strike_pa", "situational"],
    ["twoStrikeHits", "two_strike_hits", "situational"],
    [
      "firstPitchStrikeOpportunities",
      "first_pitch_strike_opportunities",
      "pitches",
    ],
    ["firstPitchStrikes", "first_pitch_strikes", "pitches"],
  ];
  for (const [rawKey, storedKey, family] of mappings) {
    const familyCoverage = coverage[family];
    statCoverage[storedKey] = familyCoverage;
    if (familyCoverage === "complete") stats[storedKey] = raw[rawKey];
    else if (familyCoverage === "partial" && Number(raw[rawKey]) !== 0)
      observedStats[storedKey] = raw[rawKey];
  }
  return { stats, observedStats, statCoverage };
}

function buildDiamondStatDocumentsFromProjection({
  ledger,
  projection,
  orientationSnapshot,
  playerDirectory = {},
  playerDirectoryBySide,
  existingPublicPlayerIds = [],
  existingPrivatePlayerIds = [],
  publicPlayerStatIds = [],
  publicTeamStatIds = [],
}) {
  assertDiamondLedger(ledger);
  const orientation = normalizeDiamondOrientationSnapshot(
    orientationSnapshot,
    ledger.teamId,
  );
  const side = orientation.managedSide;
  const statsProjection = projection;
  if (
    statsProjection.sourceRevision !== ledger.state.revision ||
    statsProjection.checkpointHash !== ledger.state.checkpointHash
  ) {
    throw new DiamondProjectionError(
      "projection-mismatch",
      "The stat projection does not match the ledger checkpoint.",
    );
  }
  const directory = normalizePlayerDirectory(
    playerDirectory,
    ledger,
    playerDirectoryBySide,
  );
  const explicitlyPublicTeamStatIds = normalizePublicStatIds(
    publicTeamStatIds,
    "Public team",
  );
  const winningSide = officialFinalWinningSide(ledger.state);
  const decisionLines = Object.values(statsProjection.players);
  const recordedWins = decisionLines.filter(
    (line) => line.raw.pitching.W === 1,
  );
  const recordedLosses = decisionLines.filter(
    (line) => line.raw.pitching.L === 1,
  );
  const recordedSaves = decisionLines.filter(
    (line) => line.raw.pitching.SV === 1,
  );
  const hasInvalidDecisionCount = decisionLines.some(
    (line) =>
      line.raw.pitching.W > 1 ||
      line.raw.pitching.L > 1 ||
      line.raw.pitching.SV > 1,
  );
  const pitcherDecisionCoverage =
    ledger.state.lifecycle === "final" &&
    winningSide !== null &&
    recordedWins.length === 1 &&
    recordedWins[0].side === winningSide &&
    recordedLosses.length === 1 &&
    recordedLosses[0].side === oppositeSide(winningSide) &&
    recordedSaves.length <= 1 &&
    recordedSaves.every((line) => line.side === winningSide) &&
    !hasInvalidDecisionCount
      ? "complete"
      : "not_collected";
  const publicPlayerStatsWrites = [];
  const privatePlayerStatsWrites = [];
  const opponentStats = Object.create(null);
  for (const line of Object.values(statsProjection.players).sort(
    (left, right) => left.playerId.localeCompare(right.playerId),
  )) {
    const document = buildPlayerDocument(line, directory, statsProjection, {
      pitcherDecisionCoverage,
      publicPlayerStatIds,
    });
    if (line.side === side) {
      publicPlayerStatsWrites.push({
        playerId: line.playerId,
        data: document.publicData,
        mode: "replace",
      });
      privatePlayerStatsWrites.push({
        playerId: line.playerId,
        data: document.privateData,
        mode: "replace",
      });
    } else {
      opponentStats[line.playerId] = {
        name: document.publicData.playerName,
        number: document.publicData.playerNumber,
        playerId: line.playerId,
        ...document.publicData.stats,
        ...document.publicData.observedStats,
        diamondCoverage: document.publicData.coverage,
        diamondSourceRevision: statsProjection.sourceRevision,
      };
    }
  }
  const expectedPlayerIds = new Set(
    publicPlayerStatsWrites.map((write) => write.playerId),
  );
  const normalizeExistingIds = (values, field) => {
    if (!Array.isArray(values))
      throw new DiamondProjectionError(
        "invalid-argument",
        `${field} must be an array.`,
      );
    return [
      ...new Set(values.map((value) => normalizeDiamondId(value, field))),
    ].sort();
  };
  const publicPlayerStatsDeletes = normalizeExistingIds(
    existingPublicPlayerIds,
    "existingPublicPlayerIds",
  ).filter((playerId) => !expectedPlayerIds.has(playerId));
  const privatePlayerStatsDeletes = normalizeExistingIds(
    existingPrivatePlayerIds,
    "existingPrivatePlayerIds",
  ).filter((playerId) => !expectedPlayerIds.has(playerId));
  const teamMapped = mapTeamStats(
    statsProjection.teams[side],
    statsProjection.coverage,
    ledger.state.score[side],
  );
  const publicTeamStatIdsForDocument = [...explicitlyPublicTeamStatIds]
    .filter((statId) => Object.hasOwn(teamMapped.statCoverage, statId))
    .sort();
  const publicTeamStatIdSet = new Set(publicTeamStatIdsForDocument);
  const publicTeamMapped = {
    stats: Object.fromEntries(
      Object.entries(teamMapped.stats).filter(([statId]) =>
        publicTeamStatIdSet.has(statId),
      ),
    ),
    observedStats: Object.fromEntries(
      Object.entries(teamMapped.observedStats).filter(([statId]) =>
        publicTeamStatIdSet.has(statId),
      ),
    ),
    statCoverage: Object.fromEntries(
      Object.entries(teamMapped.statCoverage).filter(([statId]) =>
        publicTeamStatIdSet.has(statId),
      ),
    ),
  };
  const publicTeamStats = {
    ...publicTeamMapped,
    trackingEngine: DIAMOND_ENGINE,
    projectionSchemaVersion: DIAMOND_PROJECTION_SCHEMA_VERSION,
    sourceRevision: statsProjection.sourceRevision,
    checkpointHash: statsProjection.checkpointHash,
    coverage: statsProjection.coverage,
    publicStatIds: publicTeamStatIdsForDocument,
    side,
    complete: true,
  };
  const teamStatsWrite = {
    statId: "team",
    mode: "replace",
    data: {
      ...teamMapped,
      trackingEngine: DIAMOND_ENGINE,
      projectionSchemaVersion: DIAMOND_PROJECTION_SCHEMA_VERSION,
      sourceRevision: statsProjection.sourceRevision,
      checkpointHash: statsProjection.checkpointHash,
      coverage: statsProjection.coverage,
      inningLines: { ...statsProjection.inningLines },
      side,
      complete: true,
    },
  };
  return deepFreeze({
    teamSide: side,
    opponentSide: oppositeSide(side),
    publicPlayerStatsWrites,
    publicPlayerStatsDeletes,
    privatePlayerStatsWrites,
    privatePlayerStatsDeletes,
    publicTeamStats,
    teamStatsWrite,
    opponentStats: Object.fromEntries(Object.entries(opponentStats)),
  });
}

function buildDiamondStatDocuments({
  ledger,
  orientationSnapshot,
  playerDirectory = {},
  playerDirectoryBySide,
  existingPublicPlayerIds = [],
  existingPrivatePlayerIds = [],
  publicPlayerStatIds = [],
  publicTeamStatIds = [],
}) {
  assertDiamondLedger(ledger);
  return buildDiamondStatDocumentsFromProjection({
    ledger,
    projection: projectDiamondStats(ledger),
    orientationSnapshot,
    playerDirectory,
    playerDirectoryBySide,
    existingPublicPlayerIds,
    existingPrivatePlayerIds,
    publicPlayerStatIds,
    publicTeamStatIds,
  });
}

function buildDiamondReplayPages({
  plays,
  sourceRevision,
  checkpointHash,
  pageSize = DIAMOND_PUBLIC_REPLAY_PAGE_SIZE,
  existingPageIds = [],
}) {
  if (!Array.isArray(plays))
    throw new DiamondProjectionError(
      "invalid-argument",
      "plays must be an array.",
    );
  requireNonnegativeInteger(sourceRevision, "sourceRevision");
  requireHash(checkpointHash);
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > DIAMOND_PUBLIC_REPLAY_PAGE_LIMIT
  ) {
    throw new DiamondProjectionError(
      "invalid-argument",
      `pageSize must be between 1 and ${String(DIAMOND_PUBLIC_REPLAY_PAGE_LIMIT)}.`,
    );
  }
  const pages = [];
  for (let index = 0; index < plays.length; index += pageSize) {
    const items = plays
      .slice(index, index + pageSize)
      .map(sanitizeDiamondPublicEvent);
    const pageNumber = pages.length + 1;
    const pageId = `page-${String(pageNumber).padStart(6, "0")}`;
    const nextPageId =
      index + pageSize < plays.length
        ? `page-${String(pageNumber + 1).padStart(6, "0")}`
        : null;
    pages.push({
      pageId,
      relativePath: `diamondPublic/replay/pages/${pageId}`,
      data: {
        schemaVersion: DIAMOND_PROJECTION_SCHEMA_VERSION,
        trackingEngine: DIAMOND_ENGINE,
        sourceRevision,
        checkpointHash,
        pageNumber,
        pageSize,
        itemCount: items.length,
        startRevision: items[0]?.revision ?? null,
        endRevision: items.at(-1)?.revision ?? null,
        ordering: "effective-source-revision",
        revisionGapsAllowed: true,
        items,
        nextPageId,
        nextCursor: nextPageId
          ? `${String(items.at(-1)?.revision || 0)}:${String(items.at(-1)?.eventId || "")}`
          : null,
        complete: true,
        collectionComplete: nextPageId === null,
        truncated: nextPageId !== null,
      },
    });
  }
  const currentIds = new Set(pages.map((page) => page.pageId));
  if (!Array.isArray(existingPageIds))
    throw new DiamondProjectionError(
      "invalid-argument",
      "existingPageIds must be an array.",
    );
  const deletePageIds = [
    ...new Set(
      existingPageIds.map((id) =>
        normalizeDiamondId(id, "existing replay page ID"),
      ),
    ),
  ]
    .filter((id) => !currentIds.has(id))
    .sort();
  return deepFreeze({
    manifest: {
      schemaVersion: DIAMOND_PROJECTION_SCHEMA_VERSION,
      trackingEngine: DIAMOND_ENGINE,
      sourceRevision,
      checkpointHash,
      pageSize,
      pageCount: pages.length,
      itemCount: plays.length,
      ordering: "effective-source-revision",
      revisionGapsAllowed: true,
      firstPageId: pages[0]?.pageId ?? null,
      lastPageId: pages.at(-1)?.pageId ?? null,
      complete: true,
      collectionComplete: true,
      absenceConfirmed: plays.length === 0,
    },
    pages,
    deletePageIds,
  });
}

function resolvePrivateNoteContent(ledger, instanceId, documents) {
  const noteEvents = ledger.events.filter(
    (event) =>
      privateNoteCore.privateNotePayload(event) ||
      privateNoteCore.isCanonicalPrivateNoteMaterialEvent(event, diamondEngine),
  );
  if (
    noteEvents.some(
      (event) =>
        !privateNoteCore.isCanonicalPrivateNoteMaterialEvent(
          event,
          diamondEngine,
        ),
    )
  ) {
    throw new DiamondProjectionError(
      "private-note-migration-required",
      "Legacy private-note ledger material requires migration.",
    );
  }
  if (!noteEvents.length) {
    if (documents.length) {
      throw new DiamondProjectionError(
        "private-note-input-invalid",
        "Private-note storage contains an unreferenced record.",
      );
    }
    return new Map();
  }
  const eventsById = new Map(noteEvents.map((event) => [event.eventId, event]));
  const resolved = new Map();
  for (const document of documents) {
    const value = document?.data;
    const eventId = value?.eventId;
    const event = eventsById.get(eventId);
    const expectedPath = `teams/${ledger.teamId}/games/${ledger.gameId}/diamondScorebooks/v2/notes/${eventId}`;
    if (
      !event ||
      document?.id !== eventId ||
      document?.path !== expectedPath ||
      resolved.has(eventId)
    ) {
      throw new DiamondProjectionError(
        "private-note-input-invalid",
        "Private-note storage is duplicated or does not match the canonical ledger.",
      );
    }
    try {
      if (value?.status === "deleted") {
        privateNoteCore.parseDiamondPrivateNoteRedaction(
          value,
          event,
          instanceId,
          diamondEngine,
        );
        resolved.set(eventId, null);
      } else {
        resolved.set(
          eventId,
          privateNoteCore.parseDiamondPrivateNoteRecord(
            value,
            event,
            instanceId,
            diamondEngine,
          ),
        );
      }
    } catch {
      throw new DiamondProjectionError(
        "private-note-input-invalid",
        "Private-note storage failed integrity validation.",
      );
    }
  }
  if (resolved.size !== noteEvents.length) {
    throw new DiamondProjectionError(
      "private-note-input-incomplete",
      "Private-note storage is incomplete.",
    );
  }
  return resolved;
}

function buildPrivateCurrentProjection(
  ledger,
  publicPlayCount,
  privateNoteContent,
) {
  const canonicalById = new Map(
    ledger.events.map((event) => [event.eventId, event]),
  );
  const effectivePrivateNotes = getEffectiveDiamondEvents(ledger.events)
    .filter((event) => event.type === "private_note")
    .map((event) => {
      const note = privateNoteContent.get(event.eventId);
      if (!note) return null;
      const canonical = canonicalById.get(event.eventId);
      return {
        eventId: event.eventId,
        sourceEventId: event.sourceEventId,
        revision: event.revision,
        text: note.text,
        ...(event.payload.attachedEventId
          ? { attachedEventId: event.payload.attachedEventId }
          : {}),
        visibility: "staff-private",
        corrected: event.eventId !== event.sourceEventId,
        actorUid: note.authorUid,
        serverTimestampMs: canonical?.serverTimestampMs ?? null,
      };
    })
    .filter(Boolean);
  const privateNotes = effectivePrivateNotes.slice(
    -DIAMOND_PRIVATE_RECENT_NOTE_LIMIT,
  );
  const lastEvent = ledger.events.at(-1);
  return sanitizeDiamondPrivateProjection({
    schemaVersion: DIAMOND_PROJECTION_SCHEMA_VERSION,
    trackingEngine: DIAMOND_ENGINE,
    teamId: ledger.teamId,
    gameId: ledger.gameId,
    sourceRevision: ledger.state.revision,
    checkpointHash: ledger.state.checkpointHash,
    state: ledger.state,
    canonicalEventCount: ledger.events.length,
    publicPlayCount,
    correctionCount: ledger.events.filter((event) =>
      CORRECTION_TYPES.has(event.type),
    ).length,
    privateNoteCount: effectivePrivateNotes.length,
    privateNotesComplete:
      effectivePrivateNotes.length <= DIAMOND_PRIVATE_RECENT_NOTE_LIMIT,
    privateNotesTruncated:
      effectivePrivateNotes.length > DIAMOND_PRIVATE_RECENT_NOTE_LIMIT,
    privateNotesWindowStartRevision: privateNotes[0]?.revision ?? null,
    privateNotes,
    audit: lastEvent
      ? {
          lastEventId: lastEvent.eventId,
          lastEventType: lastEvent.type,
          lastActorUid: lastEvent.actorUid,
          lastServerTimestampMs: lastEvent.serverTimestampMs,
        }
      : null,
    authoritative: true,
    complete: true,
  });
}

function buildPublicCurrentProjection({
  ledger,
  plays,
  directory,
  orientationSnapshot,
  replayManifest,
  recentPlayLimit,
}) {
  const state = ledger.state;
  const status = lifecycleStatus(state.lifecycle);
  const currentMatchup = publicCurrentMatchup(state, directory);
  const incompleteFamilies = Object.entries(state.coverage)
    .filter(
      ([family, coverage]) => family !== "sensors" && coverage !== "complete",
    )
    .map(([family]) => family)
    .sort();
  const omittedFamilies = Object.entries(state.coverage)
    .filter(([, coverage]) => coverage !== "complete")
    .map(([family]) => family)
    .sort();
  const orientation = normalizeDiamondOrientationSnapshot(
    orientationSnapshot,
    ledger.teamId,
  );
  const { teamName, opponentName, homeName, awayName } = orientation;
  const recentPlays = plays.slice(-recentPlayLimit);
  return sanitizeDiamondPublicProjection({
    schemaVersion: DIAMOND_SCHEMA_VERSION,
    trackingEngine: DIAMOND_ENGINE,
    teamId: ledger.teamId,
    gameId: ledger.gameId,
    revision: state.revision,
    sourceRevision: state.revision,
    checkpointHash: state.checkpointHash,
    authoritative: true,
    complete: true,
    truncated: plays.length > recentPlayLimit,
    status,
    lifecycle: state.lifecycle,
    captureMode: state.captureMode,
    rulesProfileId: state.rulesProfileId,
    rulesProfileVersion: state.rulesProfileVersion,
    catalogVersion: state.statCatalogVersion,
    reducerVersion: state.reducerVersion,
    ...(teamName ? { teamName } : {}),
    ...(opponentName ? { opponentName } : {}),
    ...(homeName ? { homeName } : {}),
    ...(awayName ? { awayName } : {}),
    home: { score: state.score.home, name: homeName || "Home" },
    away: { score: state.score.away, name: awayName || "Away" },
    score: { ...state.score },
    inning: { ...state.inning },
    inningNumber: state.inning.number,
    half: state.inning.half,
    count: { balls: state.inning.balls, strikes: state.inning.strikes },
    balls: state.inning.balls,
    strikes: state.inning.strikes,
    outs: state.inning.outs,
    bases: publicBases(state, directory),
    lineup: publicLineup(state, directory),
    currentBatter: currentMatchup.currentBatter,
    currentPitcher: currentMatchup.currentPitcher,
    lastPlay: recentPlays.at(-1) || null,
    recentPlays,
    events: replayManifest,
    coverage: state.coverage,
    completeness: {
      status: incompleteFamilies.length ? "partial" : "complete",
      authoritativeRevision: state.revision,
      families: state.coverage,
      omissions: omittedFamilies,
    },
    projectionStatus: "current",
    readOnlyReason:
      state.lifecycle === "cancelled"
        ? "game-cancelled"
        : state.lifecycle === "final" || state.lifecycle === "correction"
          ? "game-final"
          : null,
    updatedAt: ledger.events.at(-1)?.serverTimestampMs ?? null,
  });
}

function normalizeClipTiming(value) {
  if (!isPlainObject(value)) return null;
  const startMs = Number(value.startMs ?? value.streamRelativeTimestampMs);
  const endMs = Number(
    value.endMs ?? (Number.isFinite(startMs) ? startMs + 15_000 : Number.NaN),
  );
  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < 0 ||
    endMs <= startMs
  )
    return null;
  if (endMs - startMs > DIAMOND_CLIP_MAX_DURATION_MS) return null;
  return { startMs: Math.floor(startMs), endMs: Math.floor(endMs) };
}

function normalizeEffectInstanceId(instanceId) {
  try {
    return normalizeDiamondId(instanceId, "instanceId");
  } catch {
    throw new DiamondProjectionError(
      "invalid-effect-instance",
      "Projection effects require the immutable Diamond scorebook instance ID.",
    );
  }
}

function effectKey(kind, ledger, instanceId, revision) {
  return `${DIAMOND_ENGINE}:${ledger.teamId}:${ledger.gameId}:instance:${instanceId}:${kind}:r${String(revision).padStart(10, "0")}`;
}

function notificationTitle(type) {
  if (type === "start") return "Game started";
  if (type === "suspend") return "Game suspended";
  if (type === "resume") return "Game resumed";
  if (type === "finalize") return "Final score";
  if (type === "cancel") return "Game cancelled";
  if (type === "advance_half_inning") return "New half inning";
  return "Game update";
}

function buildDiamondEffectsPlanFromPublicPlays({
  ledger,
  instanceId,
  publicPlays,
  projectionSource = "projection-rebuild",
  previousEffectRevision = 0,
  previousNotificationRevision = 0,
  previousClipRevision = 0,
  existingEffectKeys = [],
  clipTimingsByEventId = {},
}) {
  assertDiamondLedger(ledger);
  const effectInstanceId = normalizeEffectInstanceId(instanceId);
  if (!["live-command", "projection-rebuild"].includes(projectionSource)) {
    throw new DiamondProjectionError(
      "invalid-projection-source",
      "projectionSource must be live-command or projection-rebuild.",
    );
  }
  requireNonnegativeInteger(previousEffectRevision, "previousEffectRevision");
  requireNonnegativeInteger(
    previousNotificationRevision,
    "previousNotificationRevision",
  );
  requireNonnegativeInteger(previousClipRevision, "previousClipRevision");
  if (
    previousEffectRevision > ledger.state.revision ||
    previousNotificationRevision > ledger.state.revision ||
    previousClipRevision > ledger.state.revision
  ) {
    throw new DiamondProjectionError(
      "effect-checkpoint-ahead",
      "An effect checkpoint cannot be ahead of the authoritative ledger revision.",
    );
  }
  if (
    !Array.isArray(existingEffectKeys) ||
    existingEffectKeys.some(
      (value) =>
        typeof value !== "string" || value.trim() === "" || value.length > 400,
    ) ||
    !Array.isArray(publicPlays) ||
    !isPlainObject(clipTimingsByEventId)
  ) {
    throw new DiamondProjectionError(
      "invalid-argument",
      "Effect dedupe keys and clip timings are malformed.",
    );
  }
  const existing = new Set(
    existingEffectKeys.map((value) => compactText(value, 400)).filter(Boolean),
  );
  const effectiveEventIds = new Set(
    getEffectiveDiamondEvents(ledger.events).map((event) => event.eventId),
  );
  const canonicalById = new Map(
    ledger.events.map((event) => [event.eventId, event]),
  );
  const playsById = new Map(
    (publicPlays || []).map((play) => [play.eventId, play]),
  );
  const notifications = [];
  const clipLinks = [];
  const clipInvalidations = [];
  const suppressed = [];

  for (const event of ledger.events.filter(
    (candidate) => candidate.revision > previousEffectRevision,
  )) {
    if (
      !CORRECTION_TYPES.has(event.type) &&
      !effectiveEventIds.has(event.eventId)
    ) {
      suppressed.push({
        kind: "notification",
        sourceRevision: event.revision,
        sourceEventId: event.eventId,
        reason: "corrected-play",
      });
      suppressed.push({
        kind: "clip",
        sourceRevision: event.revision,
        sourceEventId: event.eventId,
        reason: "corrected-play",
      });
      continue;
    }
    const notificationKey = effectKey(
      "notification",
      ledger,
      effectInstanceId,
      event.revision,
    );
    const privateMaterial = privateNoteCore.isCanonicalPrivateNoteMaterialEvent(
      event,
      diamondEngine,
    );
    const publicEvent =
      !PRIVATE_EVENT_TYPES.has(event.type) &&
      (!privateMaterial ||
        (event.type === "supersede_event" &&
          event.payload?.replacement?.type !== "private_note"));
    const decision = decideDiamondNotification({
      commandOutcome: "accepted",
      eventType: event.type,
      source:
        projectionSource === "live-command"
          ? "live-command"
          : "projection-rebuild",
      isPublic: publicEvent,
      revision: event.revision,
      lastNotifiedRevision: previousNotificationRevision,
      explicitlySuppressed: existing.has(notificationKey),
    });
    if (decision.send) {
      const play = playsById.get(event.eventId);
      const score = event.after?.score || ledger.state.score;
      notifications.push({
        effectId: `notification-r${String(event.revision).padStart(10, "0")}`,
        dedupKey: notificationKey,
        sourceRevision: event.revision,
        sourceEventId: event.eventId,
        title: notificationTitle(event.type),
        body: compactText(
          `${play?.description || "Game update"} · Score ${String(score.home)}–${String(score.away)}`,
          120,
        ),
        category: "liveScore",
        trackingEngine: DIAMOND_ENGINE,
      });
    } else {
      suppressed.push({
        kind: "notification",
        sourceRevision: event.revision,
        sourceEventId: event.eventId,
        reason: decision.reason,
      });
    }

    if (CORRECTION_TYPES.has(event.type)) {
      const invalidationKey = effectKey(
        "clip-invalidation",
        ledger,
        effectInstanceId,
        event.revision,
      );
      if (projectionSource !== "live-command") {
        suppressed.push({
          kind: "clip",
          sourceRevision: event.revision,
          sourceEventId: event.eventId,
          reason: "derived-or-replayed-update",
        });
        continue;
      }
      const targetEvent = canonicalById.get(event.payload.targetEventId);
      if (!targetEvent || !CLIP_ELIGIBLE_TYPES.has(targetEvent.type)) {
        suppressed.push({
          kind: "clip",
          sourceRevision: event.revision,
          sourceEventId: event.eventId,
          reason: "corrected-event-not-clip-eligible",
        });
        continue;
      }
      if (existing.has(invalidationKey)) {
        suppressed.push({
          kind: "clip",
          sourceRevision: event.revision,
          sourceEventId: event.eventId,
          reason: "effect-already-exists",
        });
        continue;
      }
      clipInvalidations.push({
        effectId: `clip-invalidation-r${String(event.revision).padStart(10, "0")}`,
        dedupKey: invalidationKey,
        sourceRevision: event.revision,
        correctionEventId: event.eventId,
        targetEventId: event.payload.targetEventId,
        status: "stale",
        reason: "scorebook-correction",
      });
      suppressed.push({
        kind: "clip",
        sourceRevision: event.revision,
        sourceEventId: event.eventId,
        reason: "correction-update",
      });
      continue;
    }
    if (projectionSource !== "live-command") {
      suppressed.push({
        kind: "clip",
        sourceRevision: event.revision,
        sourceEventId: event.eventId,
        reason: "derived-or-replayed-update",
      });
      continue;
    }
    if (
      PRIVATE_EVENT_TYPES.has(event.type) ||
      !CLIP_ELIGIBLE_TYPES.has(event.type)
    ) {
      suppressed.push({
        kind: "clip",
        sourceRevision: event.revision,
        sourceEventId: event.eventId,
        reason: "non-clip-event",
      });
      continue;
    }
    if (event.revision <= previousClipRevision) {
      suppressed.push({
        kind: "clip",
        sourceRevision: event.revision,
        sourceEventId: event.eventId,
        reason: "revision-already-linked",
      });
      continue;
    }
    const clipKey = effectKey("clip", ledger, effectInstanceId, event.revision);
    if (existing.has(clipKey)) {
      suppressed.push({
        kind: "clip",
        sourceRevision: event.revision,
        sourceEventId: event.eventId,
        reason: "effect-already-exists",
      });
      continue;
    }
    const timing = normalizeClipTiming(clipTimingsByEventId[event.eventId]);
    if (!timing) {
      suppressed.push({
        kind: "clip",
        sourceRevision: event.revision,
        sourceEventId: event.eventId,
        reason: "clip-timing-unavailable",
      });
      continue;
    }
    const play = playsById.get(event.eventId);
    clipLinks.push({
      effectId: `clip-r${String(event.revision).padStart(10, "0")}`,
      dedupKey: clipKey,
      sourceRevision: event.revision,
      sourceEventId: event.eventId,
      startMs: timing.startMs,
      endMs: timing.endMs,
      playDescription: compactText(play?.description || "Diamond play", 160),
      inningLabel: compactText(play?.inningLabel, 32),
      scoreContext: play?.score
        ? `${String(play.score.home)}–${String(play.score.away)}`
        : "",
      status: "candidate",
      trackingEngine: DIAMOND_ENGINE,
    });
  }
  return deepFreeze({
    instanceId: effectInstanceId,
    projectionSource,
    evaluatedThroughRevision: ledger.state.revision,
    notifications,
    clipLinks,
    clipInvalidations,
    suppressed,
  });
}

function buildDiamondEffectsPlan({
  ledger,
  instanceId,
  playerDirectory = {},
  playerDirectoryBySide,
  projectionSource = "projection-rebuild",
  previousEffectRevision = 0,
  previousNotificationRevision = 0,
  previousClipRevision = 0,
  existingEffectKeys = [],
  clipTimingsByEventId = {},
}) {
  assertDiamondLedger(ledger);
  return buildDiamondEffectsPlanFromPublicPlays({
    ledger,
    instanceId,
    publicPlays: buildDiamondPublicPlays({
      ledger,
      playerDirectory,
      playerDirectoryBySide,
    }),
    projectionSource,
    previousEffectRevision,
    previousNotificationRevision,
    previousClipRevision,
    existingEffectKeys,
    clipTimingsByEventId,
  });
}

function publicCorrectionImpact(event, canonicalById) {
  if (!CORRECTION_TYPES.has(event.type)) return null;
  const targetEvent = canonicalById.get(event.payload.targetEventId);
  if (!targetEvent) {
    throw new DiamondProjectionError(
      "invalid-ledger",
      "A correction target is missing from the canonical ledger.",
    );
  }
  const targetIsPrivate = PRIVATE_EVENT_TYPES.has(targetEvent.type);
  const replacementIsPrivate =
    event.type === "supersede_event" &&
    PRIVATE_EVENT_TYPES.has(event.payload.replacement?.type);
  if (
    targetIsPrivate &&
    (event.type === "void_event" || replacementIsPrivate)
  ) {
    return null;
  }
  return {
    event,
    // A private source event ID must never enter the public AI audit trail.
    // When a private note becomes public, the correction is the new public
    // effective event. When a public play is removed, its already-public source
    // identity remains the safe invalidation key.
    affectedSourcePlayId: targetIsPrivate ? event.eventId : targetEvent.eventId,
  };
}

function markDiamondAiArtifactsStale({ ledger, artifacts = {} }) {
  assertDiamondLedger(ledger);
  if (!isPlainObject(artifacts))
    throw new DiamondProjectionError(
      "invalid-argument",
      "AI artifacts must be an object.",
    );
  const canonicalById = new Map(
    ledger.events.map((event) => [event.eventId, event]),
  );
  const publicImpacts = ledger.events
    .map((event) => publicCorrectionImpact(event, canonicalById))
    .filter(Boolean);
  if (!publicImpacts.length) {
    return deepFreeze({
      required: false,
      latestCorrectionRevision: null,
      affectedSourcePlayIds: [],
      artifactPatches: {},
    });
  }
  const latest = publicImpacts.at(-1).event;
  const affectedSourcePlayIds = [
    ...new Set(publicImpacts.map((impact) => impact.affectedSourcePlayId)),
  ].sort();
  const artifactPatches = {};
  for (const field of AI_ARTIFACT_FIELDS) {
    if (
      !own(artifacts, field) ||
      artifacts[field] === null ||
      artifacts[field] === undefined
    )
      continue;
    const artifact = artifacts[field];
    const artifactRevision =
      isPlainObject(artifact) && Number.isSafeInteger(artifact.sourceRevision)
        ? artifact.sourceRevision
        : -1;
    if (artifactRevision >= latest.revision) continue;
    artifactPatches[field] = {
      status: "stale",
      stale: true,
      staleAtRevision: latest.revision,
      staleReason: "scorebook-correction",
      authoritativeSourceRevision: ledger.state.revision,
      affectedSourcePlayIds,
    };
  }
  const required = Object.keys(artifactPatches).length > 0;
  return deepFreeze({
    required,
    latestCorrectionRevision: latest.revision,
    affectedSourcePlayIds,
    artifactPatches,
    diamondAiState: required
      ? {
          status: "stale",
          staleAtRevision: latest.revision,
          staleReason: "scorebook-correction",
          affectedSourcePlayIds,
        }
      : null,
  });
}

function buildDiamondSharedGameOutcome({ ledger, sharedGame = {} }) {
  assertDiamondLedger(ledger);
  if (!isPlainObject(sharedGame))
    throw new DiamondProjectionError(
      "invalid-argument",
      "sharedGame must be an object.",
    );
  const homeTeamId = sharedGame.homeTeamId
    ? normalizeDiamondId(sharedGame.homeTeamId, "sharedGame.homeTeamId")
    : null;
  const awayTeamId = sharedGame.awayTeamId
    ? normalizeDiamondId(sharedGame.awayTeamId, "sharedGame.awayTeamId")
    : null;
  if (homeTeamId && awayTeamId && homeTeamId === awayTeamId) {
    throw new DiamondProjectionError(
      "invalid-shared-game",
      "Shared-game sides must identify different teams.",
    );
  }
  if (
    homeTeamId &&
    awayTeamId &&
    ledger.teamId !== homeTeamId &&
    ledger.teamId !== awayTeamId
  ) {
    throw new DiamondProjectionError(
      "invalid-shared-game",
      "The Diamond ledger team is not a side in the shared game.",
    );
  }
  const { home, away } = ledger.state.score;
  const final =
    ledger.state.lifecycle === "final" ||
    ledger.state.lifecycle === "correction";
  const awardedSide =
    final && ledger.state.gameEndDecision?.reason === "forfeit"
      ? ledger.state.gameEndDecision.awardedSide
      : null;
  const tie = final && !awardedSide && home === away;
  const winnerSide = !final
    ? null
    : awardedSide || (tie ? null : home > away ? "home" : "away");
  const winnerTeamId =
    winnerSide === "home"
      ? homeTeamId
      : winnerSide === "away"
        ? awayTeamId
        : null;
  const teamOutcomes = Object.create(null);
  if (final && homeTeamId)
    teamOutcomes[homeTeamId] = tie
      ? "tie"
      : winnerSide === "home"
        ? "win"
        : "loss";
  if (final && awayTeamId)
    teamOutcomes[awayTeamId] = tie
      ? "tie"
      : winnerSide === "away"
        ? "win"
        : "loss";
  const status = lifecycleStatus(ledger.state.lifecycle);
  return deepFreeze({
    update: {
      homeScore: home,
      awayScore: away,
      status,
      liveStatus: status,
      trackingEngine: DIAMOND_ENGINE,
      diamondProjectionRevision: ledger.state.revision,
      diamondProjectionCheckpointHash: ledger.state.checkpointHash,
      diamondProjectionStatus: "current",
    },
    outcome: {
      final,
      tie,
      winnerSide,
      winnerTeamId,
      teamOutcomes: Object.fromEntries(Object.entries(teamOutcomes)),
      sourceRevision: ledger.state.revision,
      checkpointHash: ledger.state.checkpointHash,
    },
  });
}

function buildDiamondProjectionBundle({
  ledger,
  instanceId,
  orientationSnapshot,
  sharedGame = null,
  playerDirectory = {},
  playerDirectoryBySide,
  pageSize = DIAMOND_PUBLIC_REPLAY_PAGE_SIZE,
  recentPlayLimit = DIAMOND_PUBLIC_RECENT_PLAY_LIMIT,
  existingReplayPageIds = [],
  existingPublicPlayerIds = [],
  existingPrivatePlayerIds = [],
  publicPlayerStatIds = [],
  publicTeamStatIds = [],
  aiArtifacts = {},
  projectionSource = "projection-rebuild",
  previousEffectRevision = 0,
  previousNotificationRevision = 0,
  previousClipRevision = 0,
  existingEffectKeys = [],
  clipTimingsByEventId = {},
  privateNoteDocuments = [],
}) {
  assertDiamondLedger(ledger);
  const projectionInstanceId = normalizeEffectInstanceId(instanceId);
  const orientation = normalizeDiamondOrientationSnapshot(
    orientationSnapshot,
    ledger.teamId,
  );
  if (
    !Number.isSafeInteger(recentPlayLimit) ||
    recentPlayLimit < 1 ||
    recentPlayLimit > 100
  ) {
    throw new DiamondProjectionError(
      "invalid-argument",
      "recentPlayLimit must be between 1 and 100.",
    );
  }
  const directory = normalizePlayerDirectory(
    playerDirectory,
    ledger,
    playerDirectoryBySide,
  );
  const statsProjection = projectDiamondStats(ledger);
  const publicPlays = buildDiamondPublicPlays({
    ledger,
    playerDirectory,
    playerDirectoryBySide,
  });
  const replay = buildDiamondReplayPages({
    plays: publicPlays,
    sourceRevision: ledger.state.revision,
    checkpointHash: ledger.state.checkpointHash,
    pageSize,
    existingPageIds: existingReplayPageIds,
  });
  const publicCurrent = buildPublicCurrentProjection({
    ledger,
    plays: publicPlays,
    directory,
    orientationSnapshot: orientation,
    replayManifest: replay.manifest,
    recentPlayLimit,
  });
  if (!Array.isArray(privateNoteDocuments)) {
    throw new DiamondProjectionError(
      "invalid-argument",
      "privateNoteDocuments must be an array.",
    );
  }
  const privateNoteContent = resolvePrivateNoteContent(
    ledger,
    projectionInstanceId,
    privateNoteDocuments,
  );
  const privateCurrent = buildPrivateCurrentProjection(
    ledger,
    publicPlays.length,
    privateNoteContent,
  );
  const statDocuments = buildDiamondStatDocumentsFromProjection({
    ledger,
    projection: statsProjection,
    orientationSnapshot: orientation,
    playerDirectory,
    playerDirectoryBySide,
    existingPublicPlayerIds,
    existingPrivatePlayerIds,
    publicPlayerStatIds,
    publicTeamStatIds,
  });
  const aiStaleness = markDiamondAiArtifactsStale({
    ledger,
    artifacts: aiArtifacts,
  });
  const effects = buildDiamondEffectsPlanFromPublicPlays({
    ledger,
    instanceId: projectionInstanceId,
    publicPlays,
    projectionSource,
    previousEffectRevision,
    previousNotificationRevision,
    previousClipRevision,
    existingEffectKeys,
    clipTimingsByEventId,
  });
  const status = lifecycleStatus(ledger.state.lifecycle);
  const gameUpdate = {
    trackingEngine: DIAMOND_ENGINE,
    homeScore: ledger.state.score.home,
    awayScore: ledger.state.score.away,
    status,
    liveStatus: status,
    liveHasData: ledger.state.revision > 0,
    diamondProjectionRevision: ledger.state.revision,
    diamondProjectionCheckpointHash: ledger.state.checkpointHash,
    diamondProjectionStatus: "current",
    diamondProjectionComplete: true,
    diamondPublicTeamStats: statDocuments.publicTeamStats,
    opponentStats: statDocuments.opponentStats,
  };
  const sharedGameOutcome = sharedGame
    ? buildDiamondSharedGameOutcome({ ledger, sharedGame })
    : null;
  return deepFreeze({
    schemaVersion: DIAMOND_PROJECTION_SCHEMA_VERSION,
    trackingEngine: DIAMOND_ENGINE,
    instanceId: projectionInstanceId,
    sourceRevision: ledger.state.revision,
    checkpointHash: ledger.state.checkpointHash,
    writes: {
      privateCurrent: {
        relativePath: "diamondScorebooks/v2/projections/current",
        mode: "replace",
        data: privateCurrent,
      },
      publicCurrent: {
        relativePath: "diamondPublic/state",
        mode: "replace",
        data: publicCurrent,
      },
      publicReplayManifest: {
        relativePath: "diamondPublic/replay",
        mode: "replace",
        data: replay.manifest,
      },
      publicReplayPages: replay.pages,
      deletePublicReplayPageIds: replay.deletePageIds,
      publicPlayerStats: statDocuments.publicPlayerStatsWrites,
      deletePublicPlayerStatIds: statDocuments.publicPlayerStatsDeletes,
      privatePlayerStats: statDocuments.privatePlayerStatsWrites,
      deletePrivatePlayerStatIds: statDocuments.privatePlayerStatsDeletes,
      teamStats: statDocuments.teamStatsWrite,
      gameUpdate,
      sharedGameUpdate: sharedGameOutcome?.update || null,
      aiArtifactPatches: aiStaleness.artifactPatches,
      diamondAiState: aiStaleness.diamondAiState || null,
    },
    publicPlays,
    statsProjection,
    effects,
    aiStaleness,
    sharedGameOutcome,
    complete: true,
  });
}

module.exports = {
  AI_ARTIFACT_FIELDS,
  DIAMOND_CLIP_MAX_DURATION_MS,
  DIAMOND_ORIENTATION_SNAPSHOT_SCHEMA_VERSION,
  DIAMOND_PROJECTION_SCHEMA_VERSION,
  DIAMOND_PRIVATE_RECENT_NOTE_LIMIT,
  DIAMOND_PUBLIC_RECENT_PLAY_LIMIT,
  DIAMOND_PUBLIC_REPLAY_PAGE_LIMIT,
  DIAMOND_PUBLIC_REPLAY_PAGE_SIZE,
  DiamondProjectionError,
  buildDiamondEffectsPlan,
  buildDiamondProjectionBundle,
  buildDiamondPublicPlays,
  buildDiamondReplayPages,
  buildDiamondSharedGameOutcome,
  buildDiamondStatDocuments,
  getDiamondPublicProjectionHead,
  normalizeDiamondOrientationSnapshot,
  sanitizeDiamondPublicTeamStatDocument,
  serializeDiamondPublicStatsResponse,
  markDiamondAiArtifactsStale,
  mapDiamondPlayerStatLine,
};
