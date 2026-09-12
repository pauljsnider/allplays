"use strict";

const nodeCrypto = require("node:crypto");
const {
  isDiamondInteractionWindowOpen,
} = require("./diamond-live-engagement-handlers.cjs");
const {
  createDiamondScorerCandidateAdmission,
} = require("./diamond-scorer-candidate-admission.cjs");
const {
  createDiamondRosterReadAdmission,
} = require("./diamond-roster-read-admission.cjs");
const regeneration = require("./diamond-projection-regeneration-core.cjs");
const privateNoteCore = require("./diamond-private-note-core.cjs");

const DEFAULT_EVENT_PAGE_SIZE = 100;
const MAX_EVENT_PAGE_SIZE = 200;
const FULL_HISTORY_PAGE_SIZE = 200;
const MAX_CANONICAL_EVENTS = 20_000;
const MAX_ROSTER_CANDIDATES_PER_SIDE = 100;
const MAX_DIAMOND_SCORER_CANDIDATES = 100;
const DIAMOND_SCORER_RSVP_SCAN_LIMIT = MAX_DIAMOND_SCORER_CANDIDATES + 1;
const DIAMOND_PRIVATE_NOTE_STORAGE_VERSION = 1;
const SCORER_LEASE_DURATION_MS = 15 * 60 * 1000;
const MAX_PUBLIC_VIDEO_DURATION_MS = 24 * 60 * 60 * 1000;
const PUBLIC_REPLAY_PAGE_SIZE = 100;
const MAX_PUBLIC_REPLAY_PAGES = Math.ceil(
  MAX_CANONICAL_EVENTS / PUBLIC_REPLAY_PAGE_SIZE,
);
const MAX_CLEANUP_PLAYER_STAT_DOCUMENTS = 100;
const MAX_CLEANUP_TEAM_STAT_DOCUMENTS = 10;
const MAX_MANAGER_STAT_GAMES = 40;
const MAX_MANAGER_STAT_PLAYERS = 25;
const MAX_MANAGER_STAT_RESPONSE_BYTES = 7_000_000;
const MANAGER_STAT_CONTROL_COLLECTION = "diamondManagerStatReadControls";
const COMMAND_HISTORY_RATE_WINDOW_MS = 60 * 1000;
const COMMAND_HISTORY_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
const COMMAND_HISTORY_CONTROL_QUARANTINE_MS =
  COMMAND_HISTORY_SUSTAINED_WINDOW_MS;
const MAX_COMMAND_HISTORY_CONTROL_BYTES = 16 * 1024;
// Full-history verification retains its original 16/64 request and 80k/120k
// weighted bounds. Every accepted ordinary canonical command charges its
// eventual projector head to a hash-only UID/team/game control, a caller-wide
// hash-only control shared across every team and game, and a UID-independent
// hash-only game control that survives scorer handoff. Private material instead
// charges privacy-neutral per-game and per-team controls plus the same shared
// game control, so retained quota state cannot re-identify its author or reset
// on handoff. Fresh activation charges one unit to both shared controls; a new
// manager regeneration reservation charges both its synchronous history and
// queued projection head to both shared controls.
// FULL_REPLAY commands likewise charge the captured history and eventual head.
// The larger 256/512 projection counts preserve ordinary pitch entry and the
// bounded offline queue at shallow heads; weighted budgets dominate first
// (roughly 489 sequential projections from empty fit in 120k units across all
// games). Aligned fixed-window boundaries may double each stated bound. Atomic
// multi-control commits prevent partial admission, while existing per-game
// command transactions and projector leases serialize downstream game work.
const MAX_COMMAND_HISTORY_REQUESTS_PER_WINDOW = 16;
const MAX_COMMAND_HISTORY_READ_UNITS_PER_WINDOW = 80_000;
const MAX_COMMAND_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW = 64;
const MAX_COMMAND_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW = 120_000;
const MAX_COMMAND_PROJECTION_REQUESTS_PER_WINDOW = 256;
const MAX_COMMAND_PROJECTION_READ_UNITS_PER_WINDOW = 80_000;
const MAX_COMMAND_PROJECTION_SUSTAINED_REQUESTS_PER_WINDOW = 512;
const MAX_COMMAND_PROJECTION_SUSTAINED_READ_UNITS_PER_WINDOW = 120_000;
const MANAGER_STAT_RATE_WINDOW_MS = 60 * 1000;
// The fixed security envelope is intentionally independent of manager-owned
// team history. A production-shaped 120-game/100-player Team Insights load and
// one bounded recovery consume 984 calls, 3,888 reservation-verification
// units, and 49,920 requested private references. The rounded limits admit
// that substantial compatibility case; larger histories or participant unions
// can fail closed until a later window and must remain non-authoritative in
// clients. These units are logical quota charges, not physical Firestore reads.
const MAX_MANAGER_STAT_ADMISSIONS_PER_WINDOW = 1_024;
const MAX_MANAGER_STAT_VERIFICATION_UNITS_PER_WINDOW = 4_096;
const MAX_MANAGER_STAT_GLOBAL_READ_UNITS_PER_WINDOW = 65_536;
const MAX_MANAGER_STAT_REQUESTS_PER_WINDOW = 1_024;
const MAX_MANAGER_STAT_READ_UNITS_PER_WINDOW = 65_536;
const MANAGER_STAT_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
const MAX_MANAGER_STAT_SUSTAINED_ADMISSIONS_PER_WINDOW = 2_048;
const MAX_MANAGER_STAT_SUSTAINED_VERIFICATION_UNITS_PER_WINDOW = 8_192;
const MAX_MANAGER_STAT_SUSTAINED_GLOBAL_READ_UNITS_PER_WINDOW = 131_072;
const MAX_MANAGER_STAT_SUSTAINED_REQUESTS_PER_WINDOW = 2_048;
const MAX_MANAGER_STAT_SUSTAINED_READ_UNITS_PER_WINDOW = 131_072;
const MAX_CONCURRENT_MANAGER_STAT_REQUESTS = 3;
const MANAGER_STAT_REQUEST_LEASE_MS = 3 * 60 * 1000;
// Attempt IDs are server-only and can be reconciled only by the current
// 120-second invocation. Five minutes covers the full lease plus ambiguity
// margin without accumulating a day of per-attempt receipts.
const MANAGER_STAT_RECEIPT_RETENTION_MS = 5 * 60 * 1000;
const MANAGER_STAT_ADMISSION_DEDUPE_MS = MANAGER_STAT_REQUEST_LEASE_MS;
const MAX_MANAGER_STAT_RECENT_ADMISSIONS = 256;
const MAX_MANAGER_STAT_RECENT_TERMINALS = 16;
const MANAGER_STAT_CONTROL_QUARANTINE_MS = MANAGER_STAT_SUSTAINED_WINDOW_MS;
const PRIVATE_HISTORY_RATE_WINDOW_MS = 60 * 1000;
const PRIVATE_HISTORY_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
const PRIVATE_HISTORY_CONTROL_QUARANTINE_MS =
  PRIVATE_HISTORY_SUSTAINED_WINDOW_MS;
// A maximum private-history page reads two admission controls, the initial
// access/checkpoint envelope, a 201-document event query, at most one private
// note/redaction record per event, and the final
// access/checkpoint/control envelope. Charge 32 fixed logical units plus the
// requested event limit so quota also covers one ambiguous reservation and
// completion reconciliation plus fail-closed release bookkeeping. The legacy
// manager report permits up to sixteen byte-packed pages for each nominal
// 200-event page, or 1,600 pages for the bounded 20,000-event history.
// Sustained per-game budgets preserve that full envelope plus two independent
// React/native retry attempts; the lower one-minute burst remains substantive.
// Caller-wide budgets preserve two such game loads while exact-input and
// active-lease bounds prevent parallel amplification and arbitrary game-ID
// rotation.
const PRIVATE_HISTORY_FIXED_READ_UNITS = 32;
const PRIVATE_HISTORY_READ_UNITS_PER_EVENT = 2;
const MAX_PRIVATE_HISTORY_REPORT_PAGES =
  (MAX_CANONICAL_EVENTS / FULL_HISTORY_PAGE_SIZE) * 16;
const PRIVATE_HISTORY_REPORT_RETRY_ALLOWANCE = 2;
const MAX_PRIVATE_HISTORY_REQUESTS_PER_WINDOW = 256;
const MAX_PRIVATE_HISTORY_READ_UNITS_PER_WINDOW =
  MAX_PRIVATE_HISTORY_REQUESTS_PER_WINDOW *
  (PRIVATE_HISTORY_FIXED_READ_UNITS +
    PRIVATE_HISTORY_READ_UNITS_PER_EVENT * MAX_EVENT_PAGE_SIZE);
const MAX_PRIVATE_HISTORY_GLOBAL_REQUESTS_PER_WINDOW = 512;
const MAX_PRIVATE_HISTORY_GLOBAL_READ_UNITS_PER_WINDOW =
  MAX_PRIVATE_HISTORY_GLOBAL_REQUESTS_PER_WINDOW *
  (PRIVATE_HISTORY_FIXED_READ_UNITS +
    PRIVATE_HISTORY_READ_UNITS_PER_EVENT * MAX_EVENT_PAGE_SIZE);
const MAX_PRIVATE_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW =
  MAX_PRIVATE_HISTORY_REPORT_PAGES + PRIVATE_HISTORY_REPORT_RETRY_ALLOWANCE;
const MAX_PRIVATE_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW =
  MAX_PRIVATE_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW *
  (PRIVATE_HISTORY_FIXED_READ_UNITS +
    PRIVATE_HISTORY_READ_UNITS_PER_EVENT * MAX_EVENT_PAGE_SIZE);
const MAX_PRIVATE_HISTORY_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW =
  MAX_PRIVATE_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW * 2;
const MAX_PRIVATE_HISTORY_GLOBAL_SUSTAINED_READ_UNITS_PER_WINDOW =
  MAX_PRIVATE_HISTORY_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW *
  (PRIVATE_HISTORY_FIXED_READ_UNITS +
    PRIVATE_HISTORY_READ_UNITS_PER_EVENT * MAX_EVENT_PAGE_SIZE);
const MAX_CONCURRENT_PRIVATE_HISTORY_REQUESTS = 2;
const MAX_CONCURRENT_PRIVATE_HISTORY_GLOBAL_REQUESTS = 4;
const PRIVATE_HISTORY_REQUEST_LEASE_MS = 3 * 60 * 1000;
const PRIVATE_HISTORY_RECEIPT_RETENTION_MS = 5 * 60 * 1000;
const PRIVATE_HISTORY_ADMISSION_DEDUPE_MS = PRIVATE_HISTORY_REQUEST_LEASE_MS;
// Reservation receipts exist only while their correlated caller-global lease
// is active, so this array can never grow beyond the concurrency bound.
const MAX_PRIVATE_HISTORY_RECENT_ADMISSIONS =
  MAX_CONCURRENT_PRIVATE_HISTORY_GLOBAL_REQUESTS;
const MAX_PRIVATE_HISTORY_RECENT_TERMINALS = 16;
const MAX_PRIVATE_EVENT_PAGE_BYTES = 1_000_000;
const MANAGER_STAT_COMPACT_FIELD_MASK = Object.freeze([
  "trackingEngine",
  "teamId",
  "diamondGameId",
  "playerId",
  "playerName",
  "playerNumber",
  "side",
  "participated",
  "participationStatus",
  "participationSource",
  "didNotPlay",
  "authoritative",
  "complete",
  "projectionSchemaVersion",
  "instanceId",
  "diamondScorebookInstanceId",
  "projectionGeneration",
  "sourceRevision",
  "checkpointHash",
  "statConfigSnapshotHash",
  "projectionHash",
  "stats",
  "observedStats",
  "derivedStats",
  "observedDerivedStats",
  "statCoverage",
  "coverage",
  "unavailableDerivedStats",
  "missingStatFamilies",
  "inningLines",
]);
const DIAMOND_ENGINE = "diamond-v2";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const BOOTSTRAP_CURSOR_PATTERN =
  /^bootstrap:v1:(0|[1-9][0-9]{0,7}):([0-9a-f]{64}):(0|[1-9][0-9]{0,7})$/;
const REPLAY_CURSOR_PATTERN =
  /^replay:v1:(0|[1-9][0-9]{0,7}):([0-9a-f]{64}):([1-9][0-9]{0,5}):(0|[1-9][0-9]{0,2})$/;
const LEGACY_TRACKING_COLLECTIONS = Object.freeze([
  "events",
  "aggregatedStats",
  "teamStats",
  "privatePlayerStats",
  "liveEvents",
]);
const FULL_REPLAY_COMMANDS = new Set([
  "record_fielding",
  "record_scoring_judgment",
  "void_event",
  "supersede_event",
  "reopen_for_correction",
  "finalize",
]);
const RESILIENT_CORRECTION_COMMANDS = new Set([
  "void_event",
  "supersede_event",
  "reopen_for_correction",
]);
const REQUIRED_DIAMOND_PLAYER_STAT_IDS = new Set([
  "ab",
  "h",
  "r",
  "rbi",
  "bb",
  "fp",
]);
const PRIVATE_EVENT_TYPES = new Set(["private_note"]);
const SCOREBOOK_CHILD_COLLECTIONS = Object.freeze([
  "events",
  "commands",
  "notes",
  "audit",
  "projections",
  "projectionRuns",
  "effects",
  "aiPublicationReceipts",
  "aiPublicationAudit",
]);
const DIAMOND_INTERACTION_COLLECTIONS = Object.freeze(["chat", "reactions"]);
const DIAMOND_SHARED_PROJECTION_FIELDS = Object.freeze([
  "homeScore",
  "awayScore",
  "status",
  "liveStatus",
  "trackingEngine",
  "diamondProjectionRevision",
  "diamondProjectionCheckpointHash",
  "diamondProjectionStatus",
  "diamondSourceTeamId",
  "diamondSourceGameId",
  "diamondScorebookInstanceId",
  "diamondProjectionHash",
]);
const RECENT_PLAY_TYPES = new Set([
  "record_pitch",
  "record_plate_appearance",
  "advance_runner",
  "advance_half_inning",
  "place_tiebreaker_runner",
  "substitute",
  "re_enter",
  "add_courtesy_runner",
  "suspend",
  "resume",
  "cancel",
  "void_event",
  "supersede_event",
  "finalize",
]);
const CONFIRMED_RSVP_RESPONSES = new Set([
  "going",
  "yes",
  "confirmed",
  "attending",
]);

class DiamondHandlerError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "DiamondHandlerError";
    this.code = code;
    this.details = details;
  }
}

function own(value, key) {
  return Object.prototype.hasOwnProperty.call(value || {}, key);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotData(snapshot) {
  return snapshot?.exists === true && typeof snapshot.data === "function"
    ? snapshot.data() || {}
    : null;
}

function snapshotExists(snapshot) {
  return snapshot?.exists === true;
}

function snapshotDocuments(snapshot) {
  return Array.isArray(snapshot?.docs) ? snapshot.docs : [];
}

function queryIsEmpty(snapshot) {
  if (typeof snapshot?.empty === "boolean") return snapshot.empty;
  return snapshotDocuments(snapshot).length === 0;
}

function compactText(value, maximum = 256) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, maximum);
}

function normalizePublicHttpsUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function requireExactFields(value, allowed, makeError, label) {
  if (!isPlainObject(value))
    throw makeError("invalid-argument", `${label} must be an object.`);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length) {
    throw makeError(
      "invalid-argument",
      `${label} contains unsupported fields.`,
    );
  }
}

function normalizeOptionalRevision(
  value,
  makeError,
  label = "expectedRevision",
) {
  if (value === null || value === undefined || value === "") return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw makeError(
      "invalid-argument",
      `${label} must be a nonnegative integer.`,
    );
  }
  return value;
}

function normalizeAppBuild(value, makeError) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw makeError(
      "invalid-argument",
      "appBuild must be a positive Diamond compatibility generation.",
    );
  }
  return value;
}

function normalizePageLimit(value, makeError) {
  if (value === null || value === undefined || value === "")
    return DEFAULT_EVENT_PAGE_SIZE;
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_EVENT_PAGE_SIZE
  ) {
    throw makeError(
      "invalid-argument",
      `limit must be between 1 and ${String(MAX_EVENT_PAGE_SIZE)}.`,
    );
  }
  return value;
}

function normalizeSequenceCursor(value, makeError) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value)) {
    throw makeError("invalid-argument", "The event cursor is invalid.");
  }
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw makeError("invalid-argument", "The event cursor is invalid.");
  }
  return sequence;
}

function normalizePublicReplayCursor(value, makeError) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 256) {
    throw makeError("invalid-argument", "The public replay cursor is invalid.");
  }
  const bootstrap = BOOTSTRAP_CURSOR_PATTERN.exec(value);
  if (bootstrap) {
    return {
      kind: "bootstrap",
      sourceRevision: Number(bootstrap[1]),
      checkpointHash: `sha256:${bootstrap[2]}`,
      beforeSequence: Number(bootstrap[3]),
    };
  }
  const replay = REPLAY_CURSOR_PATTERN.exec(value);
  if (replay) {
    return {
      kind: "replay",
      sourceRevision: Number(replay[1]),
      projectionHash: `sha256:${replay[2]}`,
      pageNumber: Number(replay[3]),
      offset: Number(replay[4]),
    };
  }
  throw makeError("invalid-argument", "The public replay cursor is invalid.");
}

function bootstrapReplayCursor(sourceRevision, checkpointHash, beforeSequence) {
  return `bootstrap:v1:${String(sourceRevision)}:${checkpointHash.slice(7)}:${String(beforeSequence)}`;
}

function projectedReplayCursor(
  sourceRevision,
  projectionHash,
  pageNumber,
  offset,
) {
  return `replay:v1:${String(sourceRevision)}:${projectionHash.slice(7)}:${String(pageNumber)}:${String(offset)}`;
}

function normalizeNow(clock, makeError) {
  let value;
  try {
    value = typeof clock === "function" ? clock() : clock?.now?.();
  } catch {
    throw makeError(
      "unavailable",
      "Server time is unavailable. No Diamond write was attempted.",
    );
  }
  if (value instanceof Date) value = value.getTime();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw makeError(
      "unavailable",
      "Server time is unavailable. No Diamond write was attempted.",
    );
  }
  return value;
}

function secureUuid(random, makeError, label = "server operation ID") {
  let value;
  try {
    value =
      typeof random === "function"
        ? random()
        : typeof random?.randomUUID === "function"
          ? random.randomUUID()
          : typeof random?.uuid === "function"
            ? random.uuid()
            : null;
  } catch {
    value = null;
  }
  if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
    throw makeError(
      "unavailable",
      `Secure randomness is unavailable for this ${label}.`,
    );
  }
  return value.toLowerCase();
}

function timestampIso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function mapDomainErrorCode(code) {
  if (code === "stale-revision") return "aborted";
  if (code === "idempotency-conflict" || code === "duplicate-event-id")
    return "already-exists";
  if (code === "history-required") return "failed-precondition";
  if (
    code === "invalid-command-id" ||
    code === "invalid-id" ||
    code?.startsWith("invalid-")
  ) {
    return "invalid-argument";
  }
  if (code === "scorer-lease-lost") return "failed-precondition";
  return "failed-precondition";
}

function profileForSport(
  domainEngine,
  sport,
  requestedId = null,
  requestedVersion = null,
) {
  const profiles =
    typeof domainEngine.listDiamondRulesProfiles === "function"
      ? domainEngine.listDiamondRulesProfiles()
      : [];
  if (!Array.isArray(profiles)) return null;
  if (requestedId) {
    return (
      profiles.find(
        (profile) =>
          profile?.id === requestedId &&
          profile?.version === (requestedVersion || 1) &&
          profile?.sport === sport,
      ) || null
    );
  }
  const defaultId = sport === "baseball" ? "baseball-youth" : "fastpitch-youth";
  return (
    profiles.find(
      (profile) => profile?.id === defaultId && profile?.version === 1,
    ) ||
    profiles.find((profile) => profile?.sport === sport) ||
    null
  );
}

function isActiveTeam(team) {
  if (!isPlainObject(team)) return false;
  if (
    team.active === false ||
    team.deleted === true ||
    team.isDeleted === true ||
    team.deactivated === true
  ) {
    return false;
  }
  return !new Set([
    "archived",
    "deactivated",
    "deleted",
    "inactive",
    "suspended",
  ]).has(compactText(team.status, 32).toLowerCase());
}

function getAuthoritativeEmail(authUser) {
  if (authUser?.emailVerified !== true || typeof authUser.email !== "string")
    return "";
  return authUser.email.trim().toLowerCase();
}

function getEngineKind(game, core) {
  if (game?.trackingEngine === DIAMOND_ENGINE) return "diamond";
  if (
    game?.trackingEngine === null ||
    game?.trackingEngine === undefined ||
    game?.trackingEngine === ""
  ) {
    return core.hasMeaningfulLegacyTrackingData(game || {}) ? "legacy" : "none";
  }
  if (
    ["legacy", "legacy-v1", "classic", "standard"].includes(game.trackingEngine)
  )
    return "legacy";
  return "unknown";
}

function paths(teamId, gameId) {
  const game = `teams/${teamId}/games/${gameId}`;
  const scorebook = `${game}/diamondScorebooks/v2`;
  const publicState = `${game}/diamondPublic/state`;
  const publicReplay = `${game}/diamondPublic/replay`;
  return {
    team: `teams/${teamId}`,
    user: (uid) => `users/${uid}`,
    game,
    statTrackerConfig: (configId) =>
      `teams/${teamId}/statTrackerConfigs/${configId}`,
    rsvps: `${game}/rsvps`,
    rsvp: (uid) => `${game}/rsvps/${uid}`,
    scorebook,
    event: (eventId) => `${scorebook}/events/${eventId}`,
    events: `${scorebook}/events`,
    command: (commandId) => `${scorebook}/commands/${commandId}`,
    note: (noteId) => `${scorebook}/notes/${noteId}`,
    audit: (auditId) => `${scorebook}/audit/${auditId}`,
    projection: (projectionId) => `${scorebook}/projections/${projectionId}`,
    publicState,
    publicEvent: (eventId) => `${publicState}/events/${eventId}`,
    publicEvents: `${publicState}/events`,
    publicReplay,
    publicReplayPages: `${publicReplay}/pages`,
    publicReplayPage: (pageId) => `${publicReplay}/pages/${pageId}`,
    aggregatedStats: `${game}/aggregatedStats`,
    privatePlayerStats: `${game}/privatePlayerStats`,
    teamStats: `${game}/teamStats`,
    diamondLiveGeneration: (instanceId) =>
      `${game}/diamondLiveGenerations/${instanceId}`,
    diamondStatGeneration: (instanceId) =>
      `${game}/diamondStatGenerations/${instanceId}`,
    scorebookChildCollection: (collectionId) => `${scorebook}/${collectionId}`,
    publicStateEvents: `${publicState}/events`,
    configurationRequest: (requestId) =>
      `teams/${teamId}/diamondConfigurationRequests/${requestId}`,
    cleanupLock: `teams/${teamId}/diamondCleanupLocks/${gameId}`,
    accountDeletionRequest: (uid) => `accountDeletionRequests/${uid}`,
  };
}

function normalizeCleanupSharedGamePath(value) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !value ||
    value.length > 512
  ) {
    return "";
  }
  const segments = value.split("/");
  return segments.length === 4 &&
    ["organizations", "tournaments"].includes(segments[0]) &&
    segments[2] === "sharedGames" &&
    segments.every(
      (segment) =>
        segment && segment !== "." && segment !== ".." && segment.length <= 128,
    )
    ? value
    : "";
}

function getCleanupSharedGamePath(game) {
  const candidates = [
    game?.diamondSharedGamePath,
    game?.sharedGamePath,
    game?._sharedGamePath,
  ].filter((value) => value !== null && value !== undefined && value !== "");
  if (!candidates.length) return { path: null, valid: true };
  const normalized = [
    ...new Set(candidates.map(normalizeCleanupSharedGamePath)),
  ];
  return normalized.length === 1 && normalized[0]
    ? { path: normalized[0], valid: true }
    : { path: null, valid: false };
}

function isCleanupOwnedDocument(value, { teamId, gameId, generation }) {
  const gameIds = [value?.gameId, value?.diamondGameId].filter(
    (candidate) => candidate !== null && candidate !== undefined,
  );
  const generations = [
    value?.instanceId,
    value?.diamondScorebookInstanceId,
    value?.projectionGeneration,
  ].filter((candidate) => candidate !== null && candidate !== undefined);
  return Boolean(
    isPlainObject(value) &&
    value.trackingEngine === DIAMOND_ENGINE &&
    value.teamId === teamId &&
    gameIds.length > 0 &&
    gameIds.every((candidate) => candidate === gameId) &&
    value.instanceId === generation &&
    generations.every((candidate) => candidate === generation),
  );
}

function isCleanupOwnedScorebookChild(value, { teamId, gameId, generation }) {
  if (!isPlainObject(value) || value.instanceId !== generation) return false;
  if (own(value, "trackingEngine") && value.trackingEngine !== DIAMOND_ENGINE)
    return false;
  if (own(value, "teamId") && value.teamId !== teamId) return false;
  if (own(value, "gameId") && value.gameId !== gameId) return false;
  if (own(value, "diamondGameId") && value.diamondGameId !== gameId)
    return false;
  return [value.diamondScorebookInstanceId, value.projectionGeneration]
    .filter((candidate) => candidate !== null && candidate !== undefined)
    .every((candidate) => candidate === generation);
}

function isCleanupOwnedInteraction(value, { teamId, gameId, generation }) {
  return Boolean(
    isPlainObject(value) &&
    value.trackingEngine === DIAMOND_ENGINE &&
    value.teamId === teamId &&
    value.gameId === gameId &&
    value.instanceId === generation,
  );
}

function isCleanupOwnedSharedProjection(value, { teamId, gameId, generation }) {
  const optionalGenerations = [
    value?.instanceId,
    value?.projectionGeneration,
  ].filter((candidate) => candidate !== null && candidate !== undefined);
  return Boolean(
    isPlainObject(value) &&
    value.trackingEngine === DIAMOND_ENGINE &&
    value.diamondSourceTeamId === teamId &&
    value.diamondSourceGameId === gameId &&
    value.diamondScorebookInstanceId === generation &&
    optionalGenerations.every((candidate) => candidate === generation),
  );
}

function clearOwnedDiamondSharedProjection(value) {
  const cleared = { ...value };
  DIAMOND_SHARED_PROJECTION_FIELDS.forEach((field) => {
    delete cleared[field];
  });
  return cleared;
}

function buildCheckpointFromRoot(root) {
  const checkpoint = root?.checkpoint;
  if (!isPlainObject(checkpoint)) return null;
  return checkpoint;
}

function hasDiamondPlayerIdentityHistory(state) {
  return Boolean(
    Array.isArray(state?.lineups?.home?.courtesyRunnerIds) &&
    Array.isArray(state?.lineups?.away?.courtesyRunnerIds),
  );
}

function completenessForState(state) {
  const families = isPlainObject(state?.coverage) ? { ...state.coverage } : {};
  const values = Object.values(families);
  return {
    status:
      values.length && values.every((value) => value === "complete")
        ? "complete"
        : "partial",
    authoritativeRevision: Number.isSafeInteger(state?.revision)
      ? state.revision
      : 0,
    families,
    omissions: Object.entries(families)
      .filter(([, value]) => value !== "complete")
      .map(([family]) => family),
  };
}

function stableScorerCandidateUids(team, state) {
  const values = [];
  const add = (value) => {
    if (
      typeof value !== "string" ||
      value !== value.trim() ||
      !value ||
      value.length > 128 ||
      value.includes("/") ||
      values.includes(value)
    )
      return;
    values.push(value);
  };
  // ownerId is the sole owner principal whenever it is present. Legacy email
  // aliases and roster/player IDs are deliberately not scorer principals.
  if (typeof team?.ownerId === "string" && team.ownerId !== "")
    add(team.ownerId);
  const permission = team?.teamPermissions?.scorekeeping;
  if (permission?.mode === "selected" && Array.isArray(permission.memberIds)) {
    permission.memberIds.forEach(add);
  }
  add(state?.currentScorerUid);
  return values;
}

function stableScorerCandidates(team, state) {
  return stableScorerCandidateUids(team, state)
    .slice(0, MAX_DIAMOND_SCORER_CANDIDATES)
    .map((uid) => ({ playerId: uid, name: uid }));
}

function hasCanonicalConfirmedRsvp(rsvp) {
  const response = compactText(rsvp?.response || rsvp?.status, 32).toLowerCase();
  return CONFIRMED_RSVP_RESPONSES.has(response);
}

function scorerCandidateName(value, uid) {
  const name = compactText(value, 160)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return name || uid;
}

function isConfirmedScoringGameEligible(game) {
  if (!isPlainObject(game)) return false;
  const status = compactText(game.status || "scheduled", 32).toLowerCase();
  const liveStatus = compactText(game.liveStatus, 32).toLowerCase();
  const terminalStatuses = new Set([
    "cancelled",
    "canceled",
    "completed",
    "finished",
    "final",
    "deleted",
  ]);
  return !terminalStatuses.has(status) && !terminalStatuses.has(liveStatus);
}

function getLineupPlayer(lineup, playerId) {
  const entry = lineup?.battingOrder?.find(
    (candidate) => candidate?.activePlayerId === playerId,
  );
  if (!entry || !playerId)
    return playerId ? { playerId, name: playerId } : null;
  return {
    playerId,
    name: compactText(entry.displayName, 160) || playerId,
    ...(compactText(entry.jerseyNumber, 32)
      ? { number: compactText(entry.jerseyNumber, 32) }
      : {}),
  };
}

function publicLineupEntries(lineup) {
  return (Array.isArray(lineup?.battingOrder) ? lineup.battingOrder : []).map(
    (entry) => ({
      slot: entry.slot,
      playerId: entry.activePlayerId,
      name: compactText(entry.displayName, 160) || entry.activePlayerId,
      displayName: compactText(entry.displayName, 160) || entry.activePlayerId,
      ...(compactText(entry.jerseyNumber, 32)
        ? {
            number: compactText(entry.jerseyNumber, 32),
            jerseyNumber: compactText(entry.jerseyNumber, 32),
          }
        : {}),
      battingRole: entry.battingRole,
    }),
  );
}

function getPresentation(
  state,
  availablePlayers = null,
  rulesCapabilities = null,
  orientationSnapshot = null,
) {
  const battingSide = state?.inning?.half === "bottom" ? "home" : "away";
  const fieldingSide = battingSide === "home" ? "away" : "home";
  const battingOrder = state?.lineups?.[battingSide]?.battingOrder || [];
  const nextSlot = Number.isSafeInteger(state?.nextBatterSlot?.[battingSide])
    ? state.nextBatterSlot[battingSide]
    : 0;
  const batterEntry = battingOrder.length
    ? battingOrder[nextSlot % battingOrder.length]
    : null;
  const pitcherId = state?.lineups?.[fieldingSide]?.defense?.P || null;
  const teamName = compactText(orientationSnapshot?.teamName, 160);
  const opponentName = compactText(orientationSnapshot?.opponentName, 160);
  const managedSide = orientationSnapshot?.managedSide;
  const canonicalHomeName = compactText(orientationSnapshot?.homeName, 160);
  const canonicalAwayName = compactText(orientationSnapshot?.awayName, 160);
  if (
    !teamName ||
    !opponentName ||
    !canonicalHomeName ||
    !canonicalAwayName ||
    !["home", "away"].includes(managedSide)
  ) {
    throw new Error("The immutable Diamond orientation is unavailable.");
  }
  const lineups = {
    home: publicLineupEntries(state?.lineups?.home),
    away: publicLineupEntries(state?.lineups?.away),
  };
  const safeAvailablePlayers = isPlainObject(availablePlayers)
    ? {
        home: Array.isArray(availablePlayers.home)
          ? availablePlayers.home.slice(0, MAX_ROSTER_CANDIDATES_PER_SIDE)
          : [],
        away: Array.isArray(availablePlayers.away)
          ? availablePlayers.away.slice(0, MAX_ROSTER_CANDIDATES_PER_SIDE)
          : [],
      }
    : { home: [], away: [] };
  return {
    teamName,
    opponentName,
    homeName: canonicalHomeName,
    awayName: canonicalAwayName,
    currentBatter: batterEntry
      ? getLineupPlayer(state.lineups[battingSide], batterEntry.activePlayerId)
      : null,
    currentPitcher: pitcherId
      ? getLineupPlayer(state.lineups[fieldingSide], pitcherId)
      : null,
    battingLineup: lineups[battingSide],
    lineups,
    managedSide,
    availablePlayers: safeAvailablePlayers,
    ...(isPlainObject(rulesCapabilities) ? { rulesCapabilities } : {}),
  };
}

function buildPrivateSnapshot({
  state,
  root,
  team,
  game,
  callerUid,
  canScore,
  canManage = false,
  nowMs,
  readOnlyReason = null,
  core,
}) {
  const presentation = getPresentation(
    state,
    root?.availablePlayers,
    root?.rulesCapabilities,
    root?.orientationSnapshot,
  );
  let lease = null;
  let leaseMalformed = false;
  try {
    lease = core.normalizeDiamondScorerLease(root?.scorerLease);
  } catch {
    leaseMalformed = true;
  }
  const currentTimeValid = Number.isSafeInteger(nowMs) && nowMs >= 0;
  const leaseMatchesState =
    lease === null || lease.holderUid === state?.currentScorerUid;
  if (!leaseMatchesState) leaseMalformed = true;
  const leaseActive =
    !leaseMalformed &&
    currentTimeValid &&
    lease !== null &&
    lease.expiresAtMillis > nowMs;
  const holderUid = leaseMalformed
    ? null
    : lease?.holderUid || compactText(state?.currentScorerUid, 128) || null;
  const callerOwnsActiveLease = leaseActive && holderUid === callerUid;
  const leaseAvailable =
    !leaseMalformed && currentTimeValid && (!lease || !leaseActive);
  const snapshot = {
    schemaVersion: 2,
    trackingEngine: DIAMOND_ENGINE,
    instanceId: root.instanceId,
    teamId: state.teamId,
    gameId: state.gameId,
    revision: state.revision,
    checkpointHash: state.checkpointHash,
    authoritative: true,
    state,
    presentation,
    teamName: presentation.teamName,
    opponentName: presentation.opponentName,
    homeName: presentation.homeName,
    awayName: presentation.awayName,
    recentPlays: Array.isArray(root?.recentPublicEvents)
      ? root.recentPublicEvents.slice(-20)
      : [],
    completeness: completenessForState(state),
    canSubmitPrivateMaterial: canScore === true,
    lease: {
      status:
        leaseMalformed || !currentTimeValid
          ? "unavailable"
          : !lease
            ? "available"
            : leaseActive
              ? holderUid === callerUid
                ? "owned"
                : "held-by-other"
              : "expired",
      canScore: canScore === true && callerOwnsActiveLease,
      canAcquire: canScore === true && leaseAvailable,
      canRecover: canManage === true && leaseAvailable,
      holderUid,
      holderName: null,
      leaseId: callerOwnsActiveLease ? lease.leaseId : null,
      epoch: lease?.epoch || null,
      expiresAt: lease ? timestampIso(lease.expiresAtMillis) : null,
      eligibleScorers: stableScorerCandidates(team, state),
    },
    readOnlyReason,
  };
  return core.sanitizeDiamondPrivateProjection(snapshot);
}

function buildPublicProjection({
  state,
  root,
  team,
  game,
  nowMs,
  core,
  projectionStatus = "pending",
}) {
  // Public projections intentionally receive no roster candidate set. Only the
  // active lineup fields explicitly copied below cross the public boundary.
  const presentation = getPresentation(
    state,
    null,
    null,
    root?.orientationSnapshot,
  );
  const projection = {
    schemaVersion: 2,
    trackingEngine: DIAMOND_ENGINE,
    teamId: state.teamId,
    gameId: state.gameId,
    revision: state.revision,
    sourceRevision: state.revision,
    checkpointHash: state.checkpointHash,
    authoritative: true,
    complete: true,
    status: state.lifecycle,
    lifecycle: state.lifecycle,
    captureMode: state.captureMode,
    rulesProfileId: state.rulesProfileId,
    rulesProfileVersion: state.rulesProfileVersion,
    catalogVersion: state.statCatalogVersion,
    reducerVersion: state.reducerVersion,
    teamName: presentation.teamName,
    opponentName: presentation.opponentName,
    homeName: presentation.homeName,
    awayName: presentation.awayName,
    score: { ...state.score },
    inning: { ...state.inning },
    inningNumber: state.inning.number,
    half: state.inning.half,
    count: { balls: state.inning.balls, strikes: state.inning.strikes },
    balls: state.inning.balls,
    strikes: state.inning.strikes,
    outs: state.inning.outs,
    bases: {
      first: state.bases.first
        ? getLineupPlayer(state.lineups.home, state.bases.first.runnerId) ||
          getLineupPlayer(state.lineups.away, state.bases.first.runnerId)
        : null,
      second: state.bases.second
        ? getLineupPlayer(state.lineups.home, state.bases.second.runnerId) ||
          getLineupPlayer(state.lineups.away, state.bases.second.runnerId)
        : null,
      third: state.bases.third
        ? getLineupPlayer(state.lineups.home, state.bases.third.runnerId) ||
          getLineupPlayer(state.lineups.away, state.bases.third.runnerId)
        : null,
    },
    currentBatter: presentation.currentBatter,
    currentPitcher: presentation.currentPitcher,
    battingLineup: presentation.battingLineup,
    recentPlays: Array.isArray(root?.recentPublicEvents)
      ? root.recentPublicEvents.slice(-20)
      : [],
    coverage: { ...state.coverage },
    completeness: completenessForState(state),
    projectionStatus,
    readOnlyReason:
      state.lifecycle === "cancelled"
        ? "game-cancelled"
        : state.lifecycle === "final" || state.lifecycle === "correction"
          ? "game-final"
          : null,
    updatedAt: timestampIso(nowMs),
    generatedAt: timestampIso(nowMs),
  };
  return core.sanitizeDiamondPublicProjection(projection);
}

function eventDescription(event) {
  const result = compactText(event?.payload?.result, 80).replace(/_/g, " ");
  const labels = {
    activate: "Diamond scorebook activated",
    set_lineup: "Lineup recorded",
    set_defensive_alignment: "Defensive alignment updated",
    set_dp_flex: "DP/FLEX alignment updated",
    start: "Game started",
    record_pitch: result ? `Pitch: ${result}` : "Pitch recorded",
    record_plate_appearance: result
      ? `Plate appearance: ${result}`
      : "Plate appearance recorded",
    advance_runner: "Runner advance recorded",
    record_fielding: "Fielding decision updated",
    record_scoring_judgment: "Scoring decision updated",
    advance_half_inning: "Half inning advanced",
    place_tiebreaker_runner: "Tiebreaker runner placed",
    substitute: "Substitution recorded",
    re_enter: "Re-entry recorded",
    add_courtesy_runner: "Courtesy runner recorded",
    scorer_handoff: "Official scorer handed off",
    suspend: "Game suspended",
    resume: "Game resumed",
    cancel: "Game cancelled",
    rules_decision: "Rules decision recorded",
    void_event: "Scoring correction recorded",
    supersede_event: "Scoring correction replaced a prior play",
    reopen_for_correction: "Scorebook reopened for correction",
    finalize: "Game finalized",
  };
  return labels[event?.type] || "Scoring update";
}

function buildPublicEvent(event, core, explicitlySuppressed = false) {
  if (!event || explicitlySuppressed || PRIVATE_EVENT_TYPES.has(event.type))
    return null;
  const after = event.after || {};
  const projected = core.sanitizeDiamondPublicEvent({
    schemaVersion: event.schemaVersion,
    eventId: event.eventId,
    playId: event.eventId,
    sequence: event.sequence,
    revision: event.revision,
    sourceRevision: event.revision,
    type: event.type,
    description: eventDescription(event),
    label: eventDescription(event),
    inning: after.inning?.number,
    inningLabel: `${after.inning?.half === "bottom" ? "Bottom" : "Top"} ${String(after.inning?.number || 1)}`,
    half: after.inning?.half,
    score: after.score,
    outs: after.inning?.outs,
    count: { balls: after.inning?.balls, strikes: after.inning?.strikes },
    bases: {
      first: Boolean(after.bases?.first),
      second: Boolean(after.bases?.second),
      third: Boolean(after.bases?.third),
    },
    corrected: event.type === "void_event" || event.type === "supersede_event",
    ...(event.supersedesEventId
      ? { supersedesEventId: event.supersedesEventId }
      : {}),
    ...(event.voidsEventId ? { voidsEventId: event.voidsEventId } : {}),
    createdAt: timestampIso(event.serverTimestampMs),
    serverTimestampMs: event.serverTimestampMs,
  });
  return projected;
}

function buildRecentPlay(event, core, explicitlySuppressed = false) {
  if (
    !RECENT_PLAY_TYPES.has(event?.type) ||
    PRIVATE_EVENT_TYPES.has(event?.type)
  )
    return null;
  const publicEvent = buildPublicEvent(event, core, explicitlySuppressed);
  return publicEvent
    ? {
        eventId: publicEvent.eventId,
        revision: publicEvent.revision,
        label: publicEvent.description,
        inningLabel: publicEvent.inningLabel,
        createdAt: publicEvent.createdAt,
        voided: publicEvent.type === "void_event",
        ...(publicEvent.voidsEventId
          ? { voidsEventId: publicEvent.voidsEventId }
          : {}),
        ...(publicEvent.supersedesEventId
          ? { supersedesEventId: publicEvent.supersedesEventId }
          : {}),
      }
    : null;
}

function updateRecentPlays(existing, event, core, explicitlySuppressed = false) {
  const play = buildRecentPlay(event, core, explicitlySuppressed);
  if (!play) return Array.isArray(existing) ? existing.slice(-20) : [];
  const correctedEventId = play.voidsEventId || play.supersedesEventId || null;
  const retained = (Array.isArray(existing) ? existing : []).filter(
    (candidate) => !correctedEventId || candidate?.eventId !== correctedEventId,
  );
  return [...retained, play].slice(-20);
}

function legacyStatusForDiamondLifecycle(lifecycle) {
  if (lifecycle === "active" || lifecycle === "suspended") return "live";
  if (lifecycle === "final" || lifecycle === "correction") return "completed";
  if (lifecycle === "cancelled") return "cancelled";
  return "scheduled";
}

function gameProjectionPatch(state, projectionStatus = "pending") {
  const status = legacyStatusForDiamondLifecycle(state.lifecycle);
  return {
    trackingEngine: DIAMOND_ENGINE,
    diamondProjectionRevision: state.revision,
    diamondProjectionStatus: projectionStatus,
    diamondLifecycle: state.lifecycle,
    status,
    liveStatus: status,
    liveHasData: state.revision > 0,
    homeScore: state.score.home,
    awayScore: state.score.away,
    score: { ...state.score },
    currentInning: state.inning.number,
    inningHalf: state.inning.half,
    balls: state.inning.balls,
    strikes: state.inning.strikes,
    outs: state.inning.outs,
  };
}

function getPublicDiamondTeamLiveMediaUrl(team, publicGameApi) {
  const twitchChannel =
    typeof team?.twitchChannel === "string" ? team.twitchChannel.trim() : "";
  if (/^[A-Za-z0-9_]{1,25}$/.test(twitchChannel)) {
    return `https://www.twitch.tv/${twitchChannel}`;
  }

  for (const candidate of [team?.streamEmbedUrl, team?.youtubeEmbedUrl]) {
    const publicUrl = normalizePublicHttpsUrl(
      publicGameApi.publicHttpUrl(candidate),
    );
    if (publicUrl) return publicUrl;
  }

  const youtubeVideoId =
    typeof team?.youtubeVideoId === "string" ? team.youtubeVideoId.trim() : "";
  return /^[A-Za-z0-9_-]{11}$/.test(youtubeVideoId)
    ? `https://www.youtube.com/watch?v=${youtubeVideoId}`
    : null;
}

function buildPublicDiamondMedia({ team, game, projection, publicGameApi }) {
  const lifecycle = compactText(
    projection?.lifecycle || projection?.status,
    32,
  ).toLowerCase();
  const isLive = ["active", "suspended"].includes(lifecycle);
  const isReplay = ["final", "correction"].includes(lifecycle);
  let publicUrl = null;
  let mode = null;
  if (isLive) {
    publicUrl =
      normalizePublicHttpsUrl(publicGameApi.publicHttpUrl(game?.videoUrl)) ||
      getPublicDiamondTeamLiveMediaUrl(team, publicGameApi);
    mode = publicUrl ? "live" : null;
  } else if (
    isReplay &&
    !publicGameApi.isRecordedReplayPaywallEnabled(game, team)
  ) {
    publicUrl = normalizePublicHttpsUrl(
      publicGameApi.getHistoricalReplayPublicUrl(game),
    );
    mode = publicUrl ? "replay" : null;
  }
  if (!publicUrl || !mode) return null;
  const duration = Number(
    game?.replayVideoDurationMs || game?.recordedVideo?.durationMs || 0,
  );
  return {
    mode,
    publicUrl,
    durationMs:
      Number.isSafeInteger(duration) &&
      duration >= 0 &&
      duration <= MAX_PUBLIC_VIDEO_DURATION_MS
        ? duration
        : 0,
  };
}

function buildLegacyViewerGame({
  team,
  game,
  projection,
  publicGameApi,
  interactionWindowOpen = false,
}) {
  const startsAtValue =
    game?.startsAt || game?.startTime || game?.date || game?.gameDate || "";
  const startsAt =
    typeof startsAtValue?.toDate === "function"
      ? startsAtValue.toDate().toISOString()
      : startsAtValue instanceof Date
        ? startsAtValue.toISOString()
        : compactText(startsAtValue, 80);
  const location = game?.location || game?.venue || game?.address;
  return {
    // The legacy viewer labels these two slots home then away, despite its old
    // property names. Keep them aligned with canonical score.home/score.away.
    teamName:
      projection.homeName ||
      compactText(team?.name || team?.teamName, 160) ||
      "Home",
    opponent:
      projection.awayName ||
      compactText(game?.opponentName || game?.opponent, 160) ||
      "Opponent",
    startsAt,
    interactionWindowOpen: interactionWindowOpen === true,
    location: compactText(
      publicGameApi.sanitizePublicLocation(location),
      160,
    ),
    trackingEngine: DIAMOND_ENGINE,
    media: buildPublicDiamondMedia({
      team,
      game,
      projection,
      publicGameApi,
    }),
    state: {
      revision: projection.revision,
      homeScore: Number(projection.score?.home || 0),
      awayScore: Number(projection.score?.away || 0),
      inning: Number(projection.inning?.number || projection.inningNumber || 1),
      half: projection.inning?.half || projection.half || "top",
      balls: Number(projection.inning?.balls ?? projection.balls ?? 0),
      strikes: Number(projection.inning?.strikes ?? projection.strikes ?? 0),
      outs: Number(projection.inning?.outs ?? projection.outs ?? 0),
      bases: {
        first: Boolean(projection.bases?.first),
        second: Boolean(projection.bases?.second),
        third: Boolean(projection.bases?.third),
      },
      batterName: compactText(projection.currentBatter?.name, 80),
      pitcherName: compactText(projection.currentPitcher?.name, 80),
      status: projection.lifecycle || projection.status || "scheduled",
      completeness: projection.completeness?.status || "partial",
    },
    warnings:
      projection.projectionStatus === "complete"
        ? []
        : ["Some derived statistics are still being refreshed."],
  };
}

function createDiamondScorebookHandlers(dependencies = {}) {
  const firestore = dependencies.firestore;
  const auth = dependencies.auth;
  const HttpsError = dependencies.HttpsError || DiamondHandlerError;
  const clock = dependencies.clock || (() => Date.now());
  const random = dependencies.random ||
    dependencies.randomUUID || { randomUUID: nodeCrypto.randomUUID };
  const logger = dependencies.logger || { info() {}, warn() {}, error() {} };
  const core = dependencies.core || require("./diamond-scorebook-core.cjs");
  const statConfig =
    dependencies.statConfig || require("./diamond-stat-config.cjs");
  const orientation =
    dependencies.orientation || require("./diamond-orientation.cjs");
  const projections =
    dependencies.projections || require("./diamond-scorebook-projections.cjs");
  const domainEngine = dependencies.domainEngine || require("./diamond-engine");
  const resolveDelegatedAccess =
    dependencies.resolveDelegatedAccess ||
    require("./delegated-team-context-core.cjs").resolveDelegatedAccess;
  const isPublicGame =
    dependencies.isPublicGame ||
    require("./public-team-api-core.cjs").canProjectPublicGame;
  const publicGameApi =
    dependencies.publicGameApi || require("./public-team-api-core.cjs");
  const recursiveDelete =
    dependencies.recursiveDelete ||
    (typeof firestore?.recursiveDelete === "function"
      ? firestore.recursiveDelete.bind(firestore)
      : null);

  if (
    !firestore?.doc ||
    !firestore?.collection ||
    typeof firestore.runTransaction !== "function"
  ) {
    throw new TypeError(
      "A Firestore dependency with doc, collection, and runTransaction is required.",
    );
  }
  if (
    !auth ||
    typeof auth.getUser !== "function" ||
    typeof auth.getUsers !== "function"
  ) {
    throw new TypeError(
      "An Auth dependency with getUser and getUsers is required.",
    );
  }
  if (
    typeof HttpsError !== "function" ||
    typeof resolveDelegatedAccess !== "function" ||
    typeof isPublicGame !== "function" ||
    typeof publicGameApi.publicHttpUrl !== "function" ||
    typeof publicGameApi.sanitizePublicLocation !== "function" ||
    typeof publicGameApi.isRecordedReplayPaywallEnabled !== "function" ||
    typeof publicGameApi.getHistoricalReplayPublicUrl !== "function"
  ) {
    throw new TypeError(
      "Diamond handler authorization dependencies are required.",
    );
  }
  if (
    typeof domainEngine.createDiamondLedger !== "function" ||
    typeof domainEngine.executeDiamondCommand !== "function" ||
    typeof domainEngine.executeDiamondCommandFromCheckpoint !== "function"
  ) {
    throw new TypeError("The compiled Diamond domain engine is required.");
  }
  if (
    typeof statConfig.createDiamondStatConfigSnapshot !== "function" ||
    typeof statConfig.validateDiamondStatConfigSnapshot !== "function"
  ) {
    throw new TypeError("The Diamond stat config snapshot module is required.");
  }
  if (
    typeof orientation.createDiamondOrientationSnapshot !== "function" ||
    typeof orientation.validateDiamondOrientationPin !== "function"
  ) {
    throw new TypeError("The Diamond orientation snapshot module is required.");
  }
  if (typeof projections.serializeDiamondPublicStatsResponse !== "function") {
    throw new TypeError("The Diamond public stat serializer is required.");
  }

  const makeError = (code, message, details) =>
    new HttpsError(code, message, details);
  const scorerCandidateAdmission = createDiamondScorerCandidateAdmission({
    firestore,
    collectionName: MANAGER_STAT_CONTROL_COLLECTION,
    clock,
    hashValue: core.hashDiamondValue,
    makeError,
    logger,
  });
  const rosterReadAdmission = createDiamondRosterReadAdmission({
    firestore,
    collectionName: MANAGER_STAT_CONTROL_COLLECTION,
    clock,
    hashValue: core.hashDiamondValue,
    makeError,
    logger,
  });

  function readReference(reader, reference) {
    if (reader && typeof reader.get === "function")
      return reader.get(reference);
    if (reference && typeof reference.get === "function")
      return reference.get();
    throw makeError(
      "unavailable",
      "A required Firestore read adapter is unavailable.",
    );
  }

  function normalizeId(value, label) {
    try {
      return core.normalizeDiamondId(value, label);
    } catch (error) {
      throw makeError("invalid-argument", error.message);
    }
  }

  function privateNotePrivacyRevision(root) {
    const value = root?.privateNotePrivacyRevision;
    if (value === undefined) return 0;
    if (!Number.isSafeInteger(value) || value < 0) {
      throw makeError(
        "unavailable",
        "The Diamond private-note privacy state is malformed.",
        { reason: "private-note-privacy-state-malformed", retryable: true },
      );
    }
    return value;
  }

  function requirePrivateNoteStorageVersion(root) {
    if (root?.privateNoteStorageVersion !== DIAMOND_PRIVATE_NOTE_STORAGE_VERSION) {
      throw makeError(
        "failed-precondition",
        "This pre-release Diamond scorebook requires private-note migration.",
        { reason: "private-note-storage-migration-required" },
      );
    }
  }

  function requireNoAccountDeletion(snapshot) {
    if (snapshotExists(snapshot)) {
      throw makeError(
        "failed-precondition",
        "Private notes cannot be stored while account deletion is pending.",
        { reason: "account-deletion-pending" },
      );
    }
  }

  function requirePrivateNoteReceipt({
    command,
    receipt,
    noteSnapshot,
    instanceId,
    callerUid,
  }) {
    if (
      !privateNoteCore.isCanonicalPrivateNoteMaterialEvent(
        receipt?.event,
        domainEngine,
      )
    ) {
      throw makeError(
        "failed-precondition",
        "A legacy private-note command cannot be replayed until it is migrated.",
        { reason: "legacy-private-note-material" },
      );
    }
    if (!snapshotExists(noteSnapshot)) {
      throw makeError(
        "unavailable",
        "The private-note receipt is unavailable. Reload before retrying.",
        { reason: "private-note-record-unavailable", retryable: true },
      );
    }
    const noteValue = snapshotData(noteSnapshot);
    if (noteValue?.status === "deleted") {
      try {
        privateNoteCore.parseDiamondPrivateNoteRedaction(
          noteValue,
          receipt.event,
          instanceId,
          domainEngine,
        );
      } catch {
        throw makeError(
          "unavailable",
          "The private-note redaction failed integrity validation.",
          { reason: "private-note-redaction-malformed", retryable: true },
        );
      }
      throw makeError(
        "failed-precondition",
        "The private-note content was deleted and cannot be replayed.",
        { reason: "private-note-deleted" },
      );
    }
    let note;
    try {
      note = privateNoteCore.parseDiamondPrivateNoteRecord(
        noteValue,
        receipt.event,
        instanceId,
        domainEngine,
      );
    } catch {
      throw makeError(
        "unavailable",
        "The private-note receipt failed integrity validation.",
        { reason: "private-note-record-malformed", retryable: true },
      );
    }
    if (note.authorUid !== callerUid) {
      throw makeError(
        "already-exists",
        "commandId was already used by another private-note author.",
      );
    }
    if (note.requestHash !== domainEngine.getDiamondPrivateNoteRequestHash(command)) {
      throw makeError(
        "already-exists",
        "commandId was already used with different private-note content.",
      );
    }
    return note;
  }

  function normalizeUuid(value, label) {
    const id = normalizeId(value, label);
    if (!UUID_V4_PATTERN.test(id)) {
      throw makeError(
        "invalid-argument",
        `${label} must be a cryptographically random UUID v4.`,
      );
    }
    return id.toLowerCase();
  }

  function normalizeStoredStatConfigId(game) {
    try {
      return core.normalizeDiamondId(
        game?.statTrackerConfigId,
        "game.statTrackerConfigId",
      );
    } catch (error) {
      throw makeError(
        "failed-precondition",
        "This game must select a valid stat tracker config before Diamond activation.",
        { reason: "stat-config-id-invalid", causeCode: error?.code || null },
      );
    }
  }

  function validateCommittedStatConfigSnapshot(root, game, teamId) {
    const configId = normalizeStoredStatConfigId(game);
    let snapshot;
    try {
      snapshot = statConfig.validateDiamondStatConfigSnapshot(
        root?.statConfigSnapshot,
        {
          teamId,
          configId,
          hashValue: core.hashDiamondValue,
        },
      );
    } catch (error) {
      throw makeError(
        "failed-precondition",
        "The activated Diamond stat config snapshot is missing or invalid.",
        { reason: error?.code || "stat-config-snapshot-invalid" },
      );
    }
    if (game?.diamondStatConfigSnapshotHash !== snapshot.snapshotHash) {
      throw makeError(
        "failed-precondition",
        "The activated Diamond stat config snapshot does not match the game claim.",
        { reason: "stat-config-snapshot-mismatch" },
      );
    }
    return snapshot;
  }

  function validateCommittedOrientationSnapshot(root, teamId) {
    try {
      return orientation.validateDiamondOrientationPin({
        teamId,
        orientationSnapshot: root?.orientationSnapshot,
      }).snapshot;
    } catch (error) {
      throw makeError(
        "failed-precondition",
        "The activated Diamond home and away orientation is missing or invalid.",
        { reason: error?.code || "orientation-snapshot-invalid" },
      );
    }
  }

  function pinGameOrientation(teamId, team, game) {
    try {
      return orientation.createDiamondOrientationSnapshot({
        teamId,
        team,
        game,
      }).snapshot;
    } catch (error) {
      throw makeError(
        "failed-precondition",
        error?.message ||
          "Choose an unambiguous home and away orientation before Diamond activation.",
        { reason: error?.code || "orientation-snapshot-invalid" },
      );
    }
  }

  function requireCompatibleStatConfig(config, snapshot, expectedSport) {
    const normalizedExpectedSport = core.normalizeDiamondSport(expectedSport);
    const declaredSportValues = [config?.baseType, config?.sport].filter(
      (value) => value !== undefined && value !== null && value !== "",
    );
    const declaredSports = declaredSportValues.map((value) =>
      core.normalizeDiamondSport(value),
    );
    const playerStatIds = new Set(
      snapshot.statDefinitions
        .filter((definition) => definition.scope === "player")
        .map((definition) => definition.id),
    );
    const compatible =
      normalizedExpectedSport !== null &&
      declaredSports.length > 0 &&
      declaredSports.every((sport) => sport === normalizedExpectedSport) &&
      [...REQUIRED_DIAMOND_PLAYER_STAT_IDS].every((id) =>
        playerStatIds.has(id),
      ) &&
      snapshot.publicPlayerStatIds.length > 0;
    if (!compatible) {
      throw makeError(
        "failed-precondition",
        "The selected stat tracker config is incompatible with this Diamond rules profile. No activation occurred.",
        { reason: "diamond-stat-config-incompatible" },
      );
    }
    return snapshot;
  }

  async function pinGameStatConfig(
    transaction,
    teamId,
    gameId,
    game,
    expectedSport,
  ) {
    const configId = normalizeStoredStatConfigId(game);
    let configSnapshot;
    try {
      configSnapshot = await transaction.get(
        firestore.doc(paths(teamId, gameId).statTrackerConfig(configId)),
      );
    } catch (error) {
      throw makeError(
        "unavailable",
        "The selected stat tracker config could not be read completely. No activation occurred.",
        { reason: error?.code || "stat-config-read-failed" },
      );
    }
    const config = snapshotData(configSnapshot);
    if (!config) {
      throw makeError(
        "failed-precondition",
        "The selected stat tracker config does not exist. No activation occurred.",
        { reason: "stat-config-missing" },
      );
    }
    try {
      const snapshot = statConfig.createDiamondStatConfigSnapshot(
        { teamId, configId, config },
        { hashValue: core.hashDiamondValue },
      );
      return requireCompatibleStatConfig(config, snapshot, expectedSport);
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError) {
        throw error;
      }
      throw makeError(
        "failed-precondition",
        "The selected stat tracker config is not safe for Diamond activation.",
        { reason: error?.code || "stat-config-malformed" },
      );
    }
  }

  function requireCallerUid(context) {
    const uid = typeof context?.auth?.uid === "string" ? context.auth.uid : "";
    if (!uid || uid !== uid.trim() || uid.length > 128 || uid.includes("/")) {
      throw makeError(
        "unauthenticated",
        "Sign in to use the Diamond scorebook.",
      );
    }
    return uid;
  }

  async function loadEnabledAuthUser(context) {
    const uid = requireCallerUid(context);
    let authUser;
    try {
      authUser = await auth.getUser(uid);
    } catch (error) {
      const code = String(error?.code || "");
      if (code === "auth/user-not-found" || code === "user-not-found") {
        throw makeError("permission-denied", "This account is not available.");
      }
      throw makeError(
        "unavailable",
        "Account access could not be verified. Try again.",
      );
    }
    if (!authUser || authUser.uid !== uid || authUser.disabled === true) {
      throw makeError("permission-denied", "This account is not available.");
    }
    return { uid, authUser, email: getAuthoritativeEmail(authUser) };
  }

  function resolveAccess({
    caller,
    user,
    teamId,
    team,
    game = null,
    rsvp = null,
  }) {
    let access;
    try {
      access = resolveDelegatedAccess({
        uid: caller.uid,
        email: caller.email,
        user: user || {},
        teamId,
        team,
        game,
        rsvp,
      });
    } catch {
      access = null;
    }
    if (!isPlainObject(access))
      return { full: false, scorekeeping: false, parent: false };
    return {
      ...access,
      full: access.full === true,
      scorekeeping: access.scorekeeping === true,
      parent: access.parent === true,
    };
  }

  async function loadAccessDocuments(reader, teamId, gameId, caller) {
    const resourcePaths = paths(teamId, gameId || "__no_game__");
    const teamRef = firestore.doc(resourcePaths.team);
    const userRef = firestore.doc(resourcePaths.user(caller.uid));
    const reads = [
      readReference(reader, teamRef),
      readReference(reader, userRef),
    ];
    let gameRef = null;
    let rsvpRef = null;
    if (gameId) {
      gameRef = firestore.doc(resourcePaths.game);
      rsvpRef = firestore.doc(resourcePaths.rsvp(caller.uid));
      reads.push(
        readReference(reader, gameRef),
        readReference(reader, rsvpRef),
      );
    }
    const snapshots = await Promise.all(reads);
    const team = snapshotData(snapshots[0]);
    const user = snapshotData(snapshots[1]) || {};
    const game = gameId ? snapshotData(snapshots[2]) : null;
    const rsvp = gameId ? snapshotData(snapshots[3]) : null;
    if (!team) throw makeError("not-found", "Team not found.");
    if (gameId && !game) throw makeError("not-found", "Game not found.");
    const access = resolveAccess({ caller, user, teamId, team, game, rsvp });
    return {
      teamRef,
      userRef,
      gameRef,
      rsvpRef,
      team,
      user,
      game,
      rsvp,
      access,
    };
  }

  async function readPolicy(reader) {
    let snapshot;
    try {
      snapshot = await readReference(
        reader,
        firestore.doc("securityPolicies/diamondScorebook"),
      );
    } catch {
      return core.parseDiamondPolicy(null, { readStatus: "error" });
    }
    return core.parseDiamondPolicy(snapshotData(snapshot), {
      readStatus: "complete",
    });
  }

  function requireAllowed(decision, fallbackMessage) {
    if (decision?.allowed === true) return decision;
    const retryable = decision?.retryable === true;
    const code = retryable ? "unavailable" : "failed-precondition";
    throw makeError(code, decision?.message || fallbackMessage, {
      reason: decision?.code || "diamond-operation-denied",
      retryable,
    });
  }

  function requireDiamondPlayerIdentityHistory(root, checkpoint) {
    if (
      hasDiamondPlayerIdentityHistory(root?.initialState) &&
      hasDiamondPlayerIdentityHistory(checkpoint?.state)
    ) {
      return;
    }
    throw makeError(
      "failed-precondition",
      "This Diamond scorebook is read-only because player identity history is unavailable.",
      { reason: "history-required", retryable: false },
    );
  }

  function requireManager(
    access,
    message = "Only a current team manager can perform this action.",
  ) {
    if (access?.full !== true) throw makeError("permission-denied", message);
  }

  function requireScorekeeper(access) {
    if (access?.scorekeeping !== true) {
      throw makeError(
        "permission-denied",
        "Current scorekeeping access is required for this game.",
      );
    }
  }

  function canProjectPublic(team, game) {
    try {
      return isPublicGame(team, game) === true;
    } catch {
      return false;
    }
  }

  function hasOfficialViewerAccess(game, caller) {
    if (
      Array.isArray(game?.officiatingAuthorizedUserIds) &&
      game.officiatingAuthorizedUserIds.includes(caller.uid)
    ) {
      return true;
    }
    if (
      !caller.email ||
      !Array.isArray(game?.officiatingAuthorizedEmails)
    ) {
      return false;
    }
    return game.officiatingAuthorizedEmails
      .filter((value) => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .includes(caller.email);
  }

  function hasAuthorizedViewerAccess(access, game, caller) {
    return hasOfficialViewerAccess(game, caller) || [
      access?.full,
      access?.parent,
      access?.scorekeeping,
      access?.videography,
      access?.streaming,
    ].some((value) => value === true);
  }

  function rosterCandidate(document) {
    const data = snapshotData(document);
    const playerId =
      typeof document?.id === "string"
        ? compactText(document.id, 128)
        : compactText(data?.id || data?.playerId, 128);
    if (!data || !playerId || playerId.includes("/")) return null;
    const status = compactText(data.status, 32).toLowerCase();
    if (
      data.active === false ||
      data.archived === true ||
      data.deleted === true ||
      ["archived", "deleted", "inactive", "removed"].includes(status)
    )
      return null;
    const displayName =
      compactText(
        data.displayName || data.name || data.playerName || data.fullName,
        160,
      ) || playerId;
    const jerseyNumber = compactText(data.jerseyNumber || data.number, 32);
    return {
      playerId,
      displayName,
      name: displayName,
      ...(jerseyNumber ? { jerseyNumber, number: jerseyNumber } : {}),
    };
  }

  function resolveRosterSides(teamId, orientationSnapshot) {
    const pinned = orientation.validateDiamondOrientationPin({
      teamId,
      orientationSnapshot,
    }).snapshot;
    return {
      teamSide: pinned.managedSide,
      opponentSide: pinned.opponentSide,
      opponentTeamId: pinned.opponentTeamId,
    };
  }

  function isStrictPublicRosterTeam(team, expectedTeamId = null) {
    const status = compactText(team?.status, 32).toLowerCase();
    return (
      isPlainObject(team) &&
      (!expectedTeamId || !own(team, "id") || team.id === expectedTeamId) &&
      team.isPublic === true &&
      team.active !== false &&
      team.archived !== true &&
      team.deleted !== true &&
      !["archived", "deleted", "inactive", "disabled"].includes(status)
    );
  }

  async function loadRosterCandidates(
    reader,
    teamId,
    orientationSnapshot,
    { includeSource = false } = {},
  ) {
    const sides = resolveRosterSides(teamId, orientationSnapshot);
    let homeRosterSnapshot;
    let opponentTeamSnapshot = null;
    try {
      [homeRosterSnapshot, opponentTeamSnapshot] = await Promise.all([
        readReference(
          reader,
          firestore
            .collection(`teams/${teamId}/players`)
            .limit(MAX_ROSTER_CANDIDATES_PER_SIDE + 1),
        ),
        sides.opponentTeamId
          ? readReference(
              reader,
              firestore.doc(`teams/${sides.opponentTeamId}`),
            )
          : Promise.resolve(null),
      ]);
    } catch {
      throw makeError(
        "unavailable",
        "The scorer roster could not be loaded completely. Try again.",
      );
    }
    let opponentRosterSnapshot = null;
    if (
      sides.opponentTeamId &&
      isStrictPublicRosterTeam(
        snapshotData(opponentTeamSnapshot),
        sides.opponentTeamId,
      )
    ) {
      try {
        opponentRosterSnapshot = await readReference(
          reader,
          firestore
            .collection(`teams/${sides.opponentTeamId}/players`)
            .limit(MAX_ROSTER_CANDIDATES_PER_SIDE + 1),
        );
      } catch {
        throw makeError(
          "unavailable",
          "The linked public opponent roster could not be loaded completely. Try again.",
        );
      }
    }
    if (
      snapshotDocuments(homeRosterSnapshot).length >
        MAX_ROSTER_CANDIDATES_PER_SIDE ||
      (opponentRosterSnapshot &&
        snapshotDocuments(opponentRosterSnapshot).length >
          MAX_ROSTER_CANDIDATES_PER_SIDE)
    ) {
      throw makeError(
        "resource-exhausted",
        "This roster is too large for a bounded Diamond lineup load.",
      );
    }
    const homeRoster = snapshotDocuments(homeRosterSnapshot)
      .map(rosterCandidate)
      .filter(Boolean)
      .sort(
        (left, right) =>
          left.displayName.localeCompare(right.displayName) ||
          left.playerId.localeCompare(right.playerId),
      );
    const opponentRoster = opponentRosterSnapshot
      ? snapshotDocuments(opponentRosterSnapshot)
          .map(rosterCandidate)
          .filter(Boolean)
          .sort(
            (left, right) =>
              left.displayName.localeCompare(right.displayName) ||
              left.playerId.localeCompare(right.playerId),
          )
      : [];
    const candidates = {
      [sides.teamSide]: homeRoster,
      [sides.opponentSide]: opponentRoster,
    };
    return includeSource
      ? {
          candidates,
          teamSide: sides.teamSide,
          opponentSide: sides.opponentSide,
          opponentTeamId: sides.opponentTeamId,
          opponentRosterReadable: Boolean(opponentRosterSnapshot),
        }
      : candidates;
  }

  function rejectedExecutionResponse(execution, metadata) {
    const rejection = execution?.result?.rejection || {};
    return {
      outcome: "rejected",
      revision: Number.isSafeInteger(execution?.result?.revision)
        ? execution.result.revision
        : 0,
      eventId: null,
      state: buildPrivateSnapshot({
        ...metadata,
        state: execution.result.state,
        root: metadata.root,
        core,
      }),
      rejection: {
        code: rejection.code || "invalid-command",
        message: rejection.message || "The Diamond command was rejected.",
        retryable: rejection.retryable === true,
      },
    };
  }

  function acceptedExecutionResponse(execution, metadata) {
    return {
      outcome: execution.result.outcome,
      revision: execution.result.revision,
      eventId: execution.result.eventId || null,
      state: buildPrivateSnapshot({
        ...metadata,
        state: execution.result.state,
        root: metadata.root,
        core,
      }),
      completeness: completenessForState(execution.result.state),
    };
  }

  async function configureDiamondTeam(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set([
        "requestId",
        "teamId",
        "sport",
        "rulesProfileId",
        "rulesProfileVersion",
        "captureMode",
        "enabled",
        "appBuild",
      ]),
      makeError,
      "Team configuration request",
    );
    const requestId = normalizeUuid(data.requestId, "requestId");
    const teamId = normalizeId(data.teamId, "teamId");
    const appBuild = normalizeAppBuild(data.appBuild, makeError);
    const sport = core.normalizeDiamondSport(data.sport);
    if (!sport)
      throw makeError(
        "invalid-argument",
        "Diamond supports Baseball and Fastpitch teams only.",
      );
    if (typeof data.enabled !== "boolean") {
      throw makeError(
        "invalid-argument",
        "enabled must explicitly be true or false.",
      );
    }
    const enabled = data.enabled;
    const captureMode =
      data.captureMode === "full"
        ? "full"
        : data.captureMode === "quick"
          ? "quick"
          : null;
    if (!captureMode) {
      throw makeError("invalid-argument", "captureMode must be quick or full.");
    }
    const requestedProfileId =
      data.rulesProfileId == null || data.rulesProfileId === ""
        ? null
        : normalizeId(data.rulesProfileId, "rulesProfileId");
    const requestedVersion =
      data.rulesProfileVersion == null
        ? 1
        : normalizeOptionalRevision(
            data.rulesProfileVersion,
            makeError,
            "rulesProfileVersion",
          );
    if (requestedVersion !== null && requestedVersion < 1) {
      throw makeError(
        "invalid-argument",
        "rulesProfileVersion must be positive.",
      );
    }
    const profile = profileForSport(
      domainEngine,
      sport,
      requestedProfileId,
      requestedVersion,
    );
    if (!profile)
      throw makeError(
        "invalid-argument",
        "The selected rules profile is unavailable for this sport.",
      );
    const caller = await loadEnabledAuthUser(context);
    let configurationNowMs = null;
    const getConfigurationNowMs = () => {
      if (configurationNowMs === null)
        configurationNowMs = normalizeNow(clock, makeError);
      return configurationNowMs;
    };
    const request = {
      requestId,
      teamId,
      sport,
      rulesProfileId: profile.id,
      rulesProfileVersion: profile.version,
      captureMode,
      enabled,
      appBuild,
    };
    const requestHash = core.hashDiamondValue(request);

    return firestore.runTransaction(async (transaction) => {
      const resourcePaths = paths(teamId, "__configuration__");
      const policy = await readPolicy(transaction);
      const loaded = await loadAccessDocuments(
        transaction,
        teamId,
        null,
        caller,
      );
      requireManager(
        loaded.access,
        "Only a current team manager can configure Diamond scorekeeping.",
      );
      const requestRef = firestore.doc(
        resourcePaths.configurationRequest(requestId),
      );
      const existing = snapshotData(await transaction.get(requestRef));
      if (existing) {
        if (
          existing.requestHash !== requestHash ||
          existing.requestedBy !== caller.uid ||
          !isPlainObject(existing.result)
        ) {
          throw makeError(
            "already-exists",
            "requestId was already used for different team configuration details.",
          );
        }
        return existing.result;
      }
      requireAllowed(
        core.getDiamondPolicyDecision({
          policy,
          teamId,
          appBuild,
          operation: "configure",
        }),
        "Diamond team configuration is disabled.",
      );
      if (enabled && !isActiveTeam(loaded.team))
        throw makeError(
          "failed-precondition",
          "Inactive teams cannot enable Diamond scoring.",
        );
      const teamSport = core.normalizeDiamondSport(
        loaded.team.sport || loaded.team.sportType || loaded.team.activity,
      );
      if (teamSport !== sport) {
        throw makeError(
          "failed-precondition",
          "The selected sport does not match this team.",
        );
      }
      const nowMs = getConfigurationNowMs();
      const settings = {
        enabled,
        sport,
        rulesProfileId: profile.id,
        rulesProfileVersion: profile.version,
        captureMode,
        configuredAt: timestampIso(nowMs),
        configuredBy: caller.uid,
        configuredByAppBuild: appBuild,
      };
      const result = {
        available: true,
        configured: true,
        enabled,
        teamId,
        sport,
        rulesProfileId: profile.id,
        rulesProfileVersion: profile.version,
        captureMode,
        settings,
      };
      transaction.update(loaded.teamRef, {
        diamondScorebook: settings,
        updatedAt: timestampIso(nowMs),
      });
      transaction.create(requestRef, {
        schemaVersion: 1,
        requestHash,
        requestedBy: caller.uid,
        createdAt: timestampIso(nowMs),
        result,
      });
      return result;
    });
  }

  async function getDiamondAccess(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set(["teamId", "gameId", "appBuild"]),
      makeError,
      "Diamond access request",
    );
    const teamId = normalizeId(data.teamId, "teamId");
    const gameId =
      data.gameId == null || data.gameId === ""
        ? null
        : normalizeId(data.gameId, "gameId");
    const appBuild = normalizeAppBuild(data.appBuild, makeError);
    const caller = await loadEnabledAuthUser(context);
    let loaded;
    let policy;
    try {
      [loaded, policy] = await Promise.all([
        loadAccessDocuments(firestore, teamId, gameId, caller),
        readPolicy(firestore),
      ]);
    } catch (error) {
      const isHandlerError =
        error instanceof HttpsError || error instanceof DiamondHandlerError;
      if (isHandlerError && error.code === "not-found") {
        throw makeError(
          "not-found",
          gameId ? "Game not found." : "Team not found.",
        );
      }
      if (isHandlerError)
        throw error;
      throw makeError(
        "unavailable",
        "Diamond access could not be verified. Try again.",
      );
    }
    if (!hasAuthorizedViewerAccess(loaded.access, loaded.game, caller)) {
      throw makeError(
        "not-found",
        gameId ? "Game not found." : "Team not found.",
      );
    }
    const optIn = core.parseDiamondTeamOptIn(loaded.team.diamondScorebook);
    const sport =
      core.normalizeDiamondSport(
        loaded.team.sport || loaded.team.sportType || loaded.team.activity,
      ) || null;
    const engineKind = gameId ? getEngineKind(loaded.game, core) : "none";
    let eligibility;
    if (gameId) {
      eligibility = core.evaluateDiamondActivationEligibility({
        policy,
        team: loaded.team,
        game: loaded.game,
        teamOptIn: loaded.team.diamondScorebook,
        teamId,
        gameId,
        appBuild,
      });
    } else {
      const policyDecision = core.getDiamondPolicyDecision({
        policy,
        teamId,
        appBuild,
        operation: "score",
      });
      eligibility =
        policyDecision.allowed &&
        isActiveTeam(loaded.team) &&
        optIn.valid &&
        sport === optIn.sport
          ? { allowed: true, eligible: true, reason: "eligible" }
          : {
              allowed: false,
              eligible: false,
              reason: !isActiveTeam(loaded.team)
                ? "inactive-team"
                : !optIn.valid
                  ? optIn.reason
                  : policyDecision.code || "unsupported-sport",
            };
    }
    let canScore =
      loaded.access.scorekeeping === true && isActiveTeam(loaded.team);
    if (gameId) {
      const operation = core.decideDiamondOperation({
        operation: "score",
        policy,
        teamId,
        appBuild,
        game: loaded.game,
      });
      canScore = canScore && operation.allowed === true;
    } else {
      canScore =
        canScore &&
        core.getDiamondPolicyDecision({
          policy,
          teamId,
          appBuild,
          operation: "score",
        }).allowed === true;
    }
    const trackingEngine =
      engineKind === "diamond"
        ? DIAMOND_ENGINE
        : engineKind === "legacy"
          ? "legacy"
          : null;
    const reason =
      engineKind === "unknown"
        ? "unknown-tracking-engine"
        : eligibility.allowed === true
          ? null
          : eligibility.code || policy.reason || "not-eligible";
    return {
      available: eligibility.allowed === true,
      eligible: eligibility.allowed === true && eligibility.eligible !== false,
      canActivate:
        loaded.access.full === true &&
        eligibility.allowed === true &&
        engineKind === "none",
      canManage: loaded.access.full === true,
      canScore,
      policyMode: policy.valid ? policy.mode : "disabled",
      sport,
      teamOptIn: optIn.valid === true,
      trackingEngine,
      reason,
    };
  }

  function normalizeManagerStatsGameHead(value, index) {
    const label = `gameHeads[${String(index)}]`;
    requireExactFields(
      value,
      new Set([
        "gameId",
        "instanceId",
        "sourceRevision",
        "checkpointHash",
        "statConfigSnapshotHash",
        "projectionHash",
      ]),
      makeError,
      label,
    );
    const gameId = normalizeId(value.gameId, `${label}.gameId`);
    const instanceId = normalizeUuid(value.instanceId, `${label}.instanceId`);
    const sourceRevision = normalizeOptionalRevision(
      value.sourceRevision,
      makeError,
      `${label}.sourceRevision`,
    );
    if (
      sourceRevision === null ||
      sourceRevision < 1 ||
      sourceRevision > MAX_CANONICAL_EVENTS
    ) {
      throw makeError(
        "invalid-argument",
        `${label}.sourceRevision must identify a projected Diamond revision.`,
      );
    }
    const checkpointHash = compactText(value.checkpointHash, 80);
    const statConfigSnapshotHash = compactText(
      value.statConfigSnapshotHash,
      80,
    );
    const projectionHash = compactText(value.projectionHash, 80);
    if (!SHA256_PATTERN.test(checkpointHash)) {
      throw makeError(
        "invalid-argument",
        `${label}.checkpointHash must be a Diamond SHA-256 hash.`,
      );
    }
    if (!SHA256_PATTERN.test(statConfigSnapshotHash)) {
      throw makeError(
        "invalid-argument",
        `${label}.statConfigSnapshotHash must be a Diamond SHA-256 hash.`,
      );
    }
    if (!SHA256_PATTERN.test(projectionHash)) {
      throw makeError(
        "invalid-argument",
        `${label}.projectionHash must be a Diamond SHA-256 hash.`,
      );
    }
    return Object.freeze({
      gameId,
      instanceId,
      sourceRevision,
      checkpointHash,
      statConfigSnapshotHash,
      projectionHash,
    });
  }

  function normalizeManagerStatsRequest(data) {
    requireExactFields(
      data,
      new Set(["teamId", "gameHeads", "playerIds"]),
      makeError,
      "Manager stat request",
    );
    const teamId = normalizeId(data.teamId, "teamId");
    if (
      !Array.isArray(data.gameHeads) ||
      data.gameHeads.length < 1 ||
      data.gameHeads.length > MAX_MANAGER_STAT_GAMES
    ) {
      throw makeError(
        "invalid-argument",
        `gameHeads must contain between 1 and ${String(MAX_MANAGER_STAT_GAMES)} exact game heads.`,
      );
    }
    if (
      !Array.isArray(data.playerIds) ||
      data.playerIds.length < 1 ||
      data.playerIds.length > MAX_MANAGER_STAT_PLAYERS
    ) {
      throw makeError(
        "invalid-argument",
        `playerIds must contain between 1 and ${String(MAX_MANAGER_STAT_PLAYERS)} players.`,
      );
    }
    const gameHeads = data.gameHeads.map(normalizeManagerStatsGameHead);
    const playerIds = data.playerIds.map((value, index) =>
      normalizeId(value, `playerIds[${String(index)}]`),
    );
    if (
      new Set(gameHeads.map(({ gameId }) => gameId)).size !== gameHeads.length
    ) {
      throw makeError(
        "invalid-argument",
        "gameHeads must not contain duplicate games.",
      );
    }
    if (new Set(playerIds).size !== playerIds.length) {
      throw makeError(
        "invalid-argument",
        "playerIds must not contain duplicates.",
      );
    }
    return Object.freeze({
      teamId,
      gameHeads: Object.freeze(
        [...gameHeads].sort((left, right) =>
          left.gameId.localeCompare(right.gameId),
        ),
      ),
      playerIds: Object.freeze([...playerIds].sort()),
    });
  }

  function managerStatsControlHashes(request, callerUid, attemptHash) {
    const scopeHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-manager-stat-read-scope",
      callerUid,
      teamId: request.teamId,
    });
    const inputHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-manager-stat-read-input",
      teamId: request.teamId,
      gameHeads: request.gameHeads,
      playerIds: request.playerIds,
    });
    const requestHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-manager-stat-read-request",
      scopeHash,
      inputHash,
      attemptHash,
    });
    return Object.freeze({ scopeHash, inputHash, requestHash, attemptHash });
  }

  function managerStatsAdmissionRef(callerUid) {
    const scopeHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-manager-stat-read-admission",
      callerUid,
    });
    return Object.freeze({
      scopeHash,
      reference: firestore.doc(
        `${MANAGER_STAT_CONTROL_COLLECTION}/admission-${scopeHash.slice(7)}`,
      ),
    });
  }

  function managerStatsControlRefs(hashes) {
    return Object.freeze({
      scope: firestore.doc(
        `${MANAGER_STAT_CONTROL_COLLECTION}/scope-${hashes.scopeHash.slice(7)}`,
      ),
    });
  }

  function controlSnapshotUpdatedAtMs(snapshot) {
    const value = snapshot?.updateTime?.toMillis?.();
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function managerStatsControlTimestampMs(value) {
    const milliseconds =
      value instanceof Date ? value.getTime() : value?.toMillis?.();
    return Number.isSafeInteger(milliseconds) && milliseconds >= 0
      ? milliseconds
      : null;
  }

  function invalidManagerStatsControl(snapshot, nowMs, retentionMs) {
    const updatedAtMs = controlSnapshotUpdatedAtMs(snapshot);
    if (
      updatedAtMs !== null &&
      updatedAtMs + retentionMs <= nowMs
    ) {
      return null;
    }
    throw makeError(
      "unavailable",
      "Manager statistic read safety state is unavailable. Try again later.",
      { reason: "manager-stat-read-control-invalid" },
    );
  }

  function parseManagerStatsScope(snapshot, hashes, nowMs) {
    if (!snapshot?.exists) return null;
    const value = snapshotData(snapshot);
    const activeAttempts = Array.isArray(value?.activeAttempts)
      ? value.activeAttempts
      : null;
    const recentTerminals = Array.isArray(value?.recentTerminals)
      ? value.recentTerminals
      : null;
    const validActiveAttempts =
      activeAttempts &&
      activeAttempts.length <= MAX_CONCURRENT_MANAGER_STAT_REQUESTS &&
      activeAttempts.every(
        (entry) =>
          isPlainObject(entry) &&
          Object.keys(entry).length === 3 &&
          SHA256_PATTERN.test(entry.requestHash) &&
          Number.isSafeInteger(entry.startedAtMs) &&
          entry.startedAtMs >= 0 &&
          entry.startedAtMs <= value.updatedAtMs &&
          Number.isSafeInteger(entry.leaseExpiresAtMs) &&
          entry.leaseExpiresAtMs ===
            entry.startedAtMs + MANAGER_STAT_REQUEST_LEASE_MS,
      );
    const validRecentTerminals =
      recentTerminals &&
      recentTerminals.length <= MAX_MANAGER_STAT_RECENT_TERMINALS &&
      recentTerminals.every(
        (entry) =>
          isPlainObject(entry) &&
          Object.keys(entry).length === 4 &&
          SHA256_PATTERN.test(entry.requestHash) &&
          ["complete", "failed"].includes(entry.status) &&
          Number.isSafeInteger(entry.finishedAtMs) &&
          entry.finishedAtMs >= 0 &&
          entry.finishedAtMs <= value.updatedAtMs &&
          (entry.status === "complete"
            ? SHA256_PATTERN.test(entry.responseHash) &&
              !Object.hasOwn(entry, "failureCode")
            : !Object.hasOwn(entry, "responseHash") &&
              typeof entry.failureCode === "string" &&
              entry.failureCode.length >= 1 &&
              entry.failureCode.length <= 64),
      );
    const activeHashes = activeAttempts?.map(({ requestHash }) => requestHash);
    const terminalHashes = recentTerminals?.map(
      ({ requestHash }) => requestHash,
    );
    const expectedExpiresAtMs = Math.max(
      value?.windowResetAtMs || 0,
      value?.sustainedWindowResetAtMs || 0,
      ...(activeAttempts || []).map(({ leaseExpiresAtMs }) => leaseExpiresAtMs),
      ...(recentTerminals || []).map(
        ({ finishedAtMs }) =>
          finishedAtMs + MANAGER_STAT_RECEIPT_RETENTION_MS,
      ),
    );
    if (
      !isPlainObject(value) ||
      Object.keys(value).length !== 15 ||
      value.schemaVersion !== 1 ||
      value.type !== "diamond-manager-stat-read-scope" ||
      value.scopeHash !== hashes.scopeHash ||
      !Number.isSafeInteger(value.windowStartedAtMs) ||
      value.windowStartedAtMs < 0 ||
      !Number.isSafeInteger(value.windowResetAtMs) ||
      value.windowResetAtMs !==
        value.windowStartedAtMs + MANAGER_STAT_RATE_WINDOW_MS ||
      !Number.isSafeInteger(value.requestCount) ||
      value.requestCount < 0 ||
      value.requestCount > MAX_MANAGER_STAT_REQUESTS_PER_WINDOW ||
      !Number.isSafeInteger(value.readUnits) ||
      value.readUnits < 0 ||
      value.readUnits > MAX_MANAGER_STAT_READ_UNITS_PER_WINDOW ||
      !Number.isSafeInteger(value.sustainedWindowStartedAtMs) ||
      value.sustainedWindowStartedAtMs < 0 ||
      !Number.isSafeInteger(value.sustainedWindowResetAtMs) ||
      value.sustainedWindowResetAtMs !==
        value.sustainedWindowStartedAtMs + MANAGER_STAT_SUSTAINED_WINDOW_MS ||
      !Number.isSafeInteger(value.sustainedRequestCount) ||
      value.sustainedRequestCount < 0 ||
      value.sustainedRequestCount >
        MAX_MANAGER_STAT_SUSTAINED_REQUESTS_PER_WINDOW ||
      !Number.isSafeInteger(value.sustainedReadUnits) ||
      value.sustainedReadUnits < 0 ||
      value.sustainedReadUnits >
        MAX_MANAGER_STAT_SUSTAINED_READ_UNITS_PER_WINDOW ||
      !validActiveAttempts ||
      !validRecentTerminals ||
      new Set(activeHashes).size !== activeHashes.length ||
      new Set(terminalHashes).size !== terminalHashes.length ||
      activeHashes.some((requestHash) =>
        terminalHashes.includes(requestHash),
      ) ||
      !Number.isSafeInteger(value.updatedAtMs) ||
      value.updatedAtMs < value.windowStartedAtMs ||
      value.updatedAtMs < value.sustainedWindowStartedAtMs ||
      managerStatsControlTimestampMs(value.expiresAt) !== expectedExpiresAtMs
    ) {
      return invalidManagerStatsControl(
        snapshot,
        nowMs,
        MANAGER_STAT_CONTROL_QUARANTINE_MS,
      );
    }
    return value;
  }

  function parseManagerStatsAdmission(snapshot, scopeHash, nowMs) {
    if (!snapshot?.exists) return null;
    const value = snapshotData(snapshot);
    const recentAttempts = Array.isArray(value?.recentAttempts)
      ? value.recentAttempts
      : null;
    if (
      !isPlainObject(value) ||
      Object.keys(value).length !== 16 ||
      value.schemaVersion !== 1 ||
      value.type !== "diamond-manager-stat-read-admission" ||
      value.scopeHash !== scopeHash ||
      !Number.isSafeInteger(value.windowStartedAtMs) ||
      value.windowStartedAtMs < 0 ||
      !Number.isSafeInteger(value.windowResetAtMs) ||
      value.windowResetAtMs !==
        value.windowStartedAtMs + MANAGER_STAT_RATE_WINDOW_MS ||
      !Number.isSafeInteger(value.requestCount) ||
      value.requestCount < 0 ||
      value.requestCount > MAX_MANAGER_STAT_ADMISSIONS_PER_WINDOW ||
      !Number.isSafeInteger(value.verificationUnits) ||
      value.verificationUnits < 0 ||
      value.verificationUnits >
        MAX_MANAGER_STAT_VERIFICATION_UNITS_PER_WINDOW ||
      !Number.isSafeInteger(value.readUnits) ||
      value.readUnits < 0 ||
      value.readUnits > MAX_MANAGER_STAT_GLOBAL_READ_UNITS_PER_WINDOW ||
      !Number.isSafeInteger(value.sustainedWindowStartedAtMs) ||
      value.sustainedWindowStartedAtMs < 0 ||
      !Number.isSafeInteger(value.sustainedWindowResetAtMs) ||
      value.sustainedWindowResetAtMs !==
        value.sustainedWindowStartedAtMs + MANAGER_STAT_SUSTAINED_WINDOW_MS ||
      !Number.isSafeInteger(value.sustainedRequestCount) ||
      value.sustainedRequestCount < 0 ||
      value.sustainedRequestCount >
        MAX_MANAGER_STAT_SUSTAINED_ADMISSIONS_PER_WINDOW ||
      !Number.isSafeInteger(value.sustainedVerificationUnits) ||
      value.sustainedVerificationUnits < 0 ||
      value.sustainedVerificationUnits >
        MAX_MANAGER_STAT_SUSTAINED_VERIFICATION_UNITS_PER_WINDOW ||
      !Number.isSafeInteger(value.sustainedReadUnits) ||
      value.sustainedReadUnits < 0 ||
      value.sustainedReadUnits >
        MAX_MANAGER_STAT_SUSTAINED_GLOBAL_READ_UNITS_PER_WINDOW ||
      !recentAttempts ||
      recentAttempts.length > MAX_MANAGER_STAT_RECENT_ADMISSIONS ||
      new Set(recentAttempts.map((entry) => entry?.attemptHash)).size !==
        recentAttempts.length ||
      !recentAttempts.every(
        (entry) =>
          isPlainObject(entry) &&
          Object.keys(entry).length === 2 &&
          SHA256_PATTERN.test(entry.attemptHash) &&
          Number.isSafeInteger(entry.admittedAtMs) &&
          entry.admittedAtMs >= 0 &&
          entry.admittedAtMs <= value.updatedAtMs,
      ) ||
      !Number.isSafeInteger(value.updatedAtMs) ||
      value.updatedAtMs < value.windowStartedAtMs ||
      value.updatedAtMs < value.sustainedWindowStartedAtMs ||
      managerStatsControlTimestampMs(value.expiresAt) !==
        Math.max(
          value.windowResetAtMs,
          value.sustainedWindowResetAtMs,
          value.updatedAtMs + MANAGER_STAT_ADMISSION_DEDUPE_MS,
        )
    ) {
      return invalidManagerStatsControl(
        snapshot,
        nowMs,
        MANAGER_STAT_CONTROL_QUARANTINE_MS,
      );
    }
    return value;
  }

  async function reserveManagerStatsAdmission(
    transaction,
    request,
    caller,
    attemptHash,
    nowMs,
  ) {
    const admissionRef = managerStatsAdmissionRef(caller.uid);
    let snapshot;
    try {
      snapshot = await transaction.get(admissionRef.reference);
    } catch {
      throw makeError(
        "unavailable",
        "Manager statistic read admission could not be verified.",
      );
    }
    const admission = parseManagerStatsAdmission(
      snapshot,
      admissionRef.scopeHash,
      nowMs,
    );
    const windowActive = Boolean(admission && admission.windowResetAtMs > nowMs);
    const sustainedWindowActive = Boolean(
      admission && admission.sustainedWindowResetAtMs > nowMs,
    );
    const recentAttempts = (admission?.recentAttempts || []).filter(
      (entry) => entry.admittedAtMs + MANAGER_STAT_ADMISSION_DEDUPE_MS > nowMs,
    );
    if (recentAttempts.some((entry) => entry.attemptHash === attemptHash)) return;

    const verificationUnits = 2 + request.gameHeads.length;
    const requestedReadUnits =
      request.gameHeads.length * (request.playerIds.length + 1);
    const requestCount = windowActive ? admission.requestCount : 0;
    const consumedVerificationUnits = windowActive
      ? admission.verificationUnits
      : 0;
    const consumedReadUnits = windowActive ? admission.readUnits : 0;
    const windowStartedAtMs = windowActive
      ? admission.windowStartedAtMs
      : nowMs;
    const windowResetAtMs = windowActive
      ? admission.windowResetAtMs
      : nowMs + MANAGER_STAT_RATE_WINDOW_MS;
    const sustainedWindowStartedAtMs = sustainedWindowActive
      ? admission.sustainedWindowStartedAtMs
      : nowMs;
    const sustainedWindowResetAtMs = sustainedWindowActive
      ? admission.sustainedWindowResetAtMs
      : nowMs + MANAGER_STAT_SUSTAINED_WINDOW_MS;
    const sustainedRequestCount = sustainedWindowActive
      ? admission.sustainedRequestCount
      : 0;
    const sustainedVerificationUnits = sustainedWindowActive
      ? admission.sustainedVerificationUnits
      : 0;
    const sustainedReadUnits = sustainedWindowActive
      ? admission.sustainedReadUnits
      : 0;
    const burstLimited =
      requestCount + 1 > MAX_MANAGER_STAT_ADMISSIONS_PER_WINDOW ||
      consumedVerificationUnits + verificationUnits >
        MAX_MANAGER_STAT_VERIFICATION_UNITS_PER_WINDOW ||
      consumedReadUnits + requestedReadUnits >
        MAX_MANAGER_STAT_GLOBAL_READ_UNITS_PER_WINDOW;
    const sustainedLimited =
      sustainedRequestCount + 1 >
        MAX_MANAGER_STAT_SUSTAINED_ADMISSIONS_PER_WINDOW ||
      sustainedVerificationUnits + verificationUnits >
        MAX_MANAGER_STAT_SUSTAINED_VERIFICATION_UNITS_PER_WINDOW ||
      sustainedReadUnits + requestedReadUnits >
        MAX_MANAGER_STAT_SUSTAINED_GLOBAL_READ_UNITS_PER_WINDOW;
    if (burstLimited || sustainedLimited) {
      throw makeError(
        "resource-exhausted",
        "Manager statistic read admission is temporarily limited.",
        managerStatsRetryDetails(
          "manager-stat-admission-limited",
          Math.max(
            burstLimited ? windowResetAtMs : 0,
            sustainedLimited ? sustainedWindowResetAtMs : 0,
          ),
          nowMs,
        ),
      );
    }
    transaction.set(admissionRef.reference, {
      schemaVersion: 1,
      type: "diamond-manager-stat-read-admission",
      scopeHash: admissionRef.scopeHash,
      windowStartedAtMs,
      windowResetAtMs,
      requestCount: requestCount + 1,
      verificationUnits: consumedVerificationUnits + verificationUnits,
      readUnits: consumedReadUnits + requestedReadUnits,
      sustainedWindowStartedAtMs,
      sustainedWindowResetAtMs,
      sustainedRequestCount: sustainedRequestCount + 1,
      sustainedVerificationUnits:
        sustainedVerificationUnits + verificationUnits,
      sustainedReadUnits: sustainedReadUnits + requestedReadUnits,
      recentAttempts: [
        ...recentAttempts,
        { attemptHash, admittedAtMs: nowMs },
      ].slice(-MAX_MANAGER_STAT_RECENT_ADMISSIONS),
      updatedAtMs: nowMs,
      expiresAt: new Date(
        Math.max(
          windowResetAtMs,
          sustainedWindowResetAtMs,
          nowMs + MANAGER_STAT_ADMISSION_DEDUPE_MS,
        ),
      ),
    });
  }

  async function readManagerStatsScopeSnapshot(transaction, reference) {
    try {
      return await transaction.get(reference);
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError)
        throw error;
      throw makeError(
        "unavailable",
        "Manager statistic read safety state could not be verified.",
      );
    }
  }

  function managerStatsRetryDetails(reason, retryAtMs, nowMs) {
    return {
      reason,
      retryable: true,
      retryAfterMs: Math.max(1, retryAtMs - nowMs),
    };
  }

  function managerStatsScopeValue(
    hashes,
    activeAttempts,
    recentTerminals,
    nowMs,
    requestCount,
    readUnits,
    windowStartedAtMs,
    windowResetAtMs,
    sustainedRequestCount,
    sustainedReadUnits,
    sustainedWindowStartedAtMs,
    sustainedWindowResetAtMs,
  ) {
    const retainedTerminals = recentTerminals
      .filter(
        (entry) =>
          entry.finishedAtMs + MANAGER_STAT_RECEIPT_RETENTION_MS > nowMs,
      )
      .slice(-MAX_MANAGER_STAT_RECENT_TERMINALS);
    const leaseExpiresAtMs = activeAttempts.reduce(
      (maximum, entry) => Math.max(maximum, entry.leaseExpiresAtMs),
      0,
    );
    const terminalExpiresAtMs = retainedTerminals.reduce(
      (maximum, entry) =>
        Math.max(
          maximum,
          entry.finishedAtMs + MANAGER_STAT_RECEIPT_RETENTION_MS,
        ),
      0,
    );
    return {
      schemaVersion: 1,
      type: "diamond-manager-stat-read-scope",
      scopeHash: hashes.scopeHash,
      windowStartedAtMs,
      windowResetAtMs,
      requestCount,
      readUnits,
      sustainedWindowStartedAtMs,
      sustainedWindowResetAtMs,
      sustainedRequestCount,
      sustainedReadUnits,
      activeAttempts,
      recentTerminals: retainedTerminals,
      updatedAtMs: nowMs,
      expiresAt: new Date(
        Math.max(
          windowResetAtMs,
          sustainedWindowResetAtMs,
          leaseExpiresAtMs,
          terminalExpiresAtMs,
        ),
      ),
    };
  }

  function assertOwnedManagerStatsAttempt(scope, reservation, nowMs) {
    const active = scope?.activeAttempts?.find(
      (entry) => entry.requestHash === reservation.hashes.requestHash,
    );
    if (
      !scope ||
      !active ||
      active.leaseExpiresAtMs <= nowMs
    ) {
      throw makeError(
        "aborted",
        "The manager statistic read reservation changed before completion.",
        { reason: "manager-stat-read-reservation-lost" },
      );
    }
  }

  function removeOwnedManagerStatsAttempt(scope, reservation) {
    return scope.activeAttempts.filter(
      (entry) => entry.requestHash !== reservation.hashes.requestHash,
    );
  }

  function assertManagerStatsGameHead(game, head) {
    const projectionStatus = compactText(
      game?.diamondProjectionStatus,
      32,
    ).toLowerCase();
    if (
      game?.trackingEngine !== DIAMOND_ENGINE ||
      game?.diamondProjectionComplete !== true ||
      !["current", "complete"].includes(projectionStatus) ||
      game?.diamondScorebookInstanceId !== head.instanceId ||
      game?.diamondProjectionRevision !== head.sourceRevision ||
      game?.diamondProjectionCheckpointHash !== head.checkpointHash ||
      game?.diamondStatConfigSnapshotHash !== head.statConfigSnapshotHash ||
      game?.diamondProjectionHash !== head.projectionHash
    ) {
      throw makeError(
        "aborted",
        "A Diamond stat projection changed or is incomplete. Reload before viewing internal statistics.",
        { reason: "manager-stat-game-head-mismatch" },
      );
    }
  }

  async function verifyManagerStatsTeamAccess(transaction, request, caller) {
    const teamRef = firestore.doc(paths(request.teamId, "__no_game__").team);
    const userRef = firestore.doc(
      paths(request.teamId, "__no_game__").user(caller.uid),
    );
    let snapshots;
    try {
      if (typeof transaction.getAll !== "function") {
        throw new Error("Firestore transactional bulk reads are unavailable.");
      }
      snapshots = await transaction.getAll(teamRef, userRef);
    } catch {
      throw makeError(
        "unavailable",
        "Internal stat access could not be verified completely. Try again.",
      );
    }
    const team = snapshotData(snapshots[0]);
    const user = snapshotData(snapshots[1]) || {};
    if (!team) throw makeError("not-found", "Team not found.");
    const access = resolveAccess({
      caller,
      user,
      teamId: request.teamId,
      team,
    });
    requireManager(
      access,
      "Current team manager access is required for internal Diamond statistics.",
    );
  }

  async function verifyManagerStatsGameHeads(transaction, request) {
    const gameRefs = request.gameHeads.map(({ gameId }) =>
      firestore.doc(paths(request.teamId, gameId).game),
    );
    let snapshots;
    try {
      if (typeof transaction.getAll !== "function") {
        throw new Error("Firestore transactional bulk reads are unavailable.");
      }
      snapshots = await transaction.getAll(...gameRefs);
    } catch {
      throw makeError(
        "unavailable",
        "Internal stat game heads could not be verified completely. Try again.",
      );
    }
    for (let index = 0; index < request.gameHeads.length; index += 1) {
      const head = request.gameHeads[index];
      const game = snapshotData(snapshots[index]);
      if (!game) throw makeError("not-found", "Game not found.");
      requireAllowed(
        core.decideDiamondOperation({
          operation: "read",
          policy: null,
          teamId: request.teamId,
          game,
        }),
        "This game is not owned by Diamond v2.",
      );
      assertManagerStatsGameHead(game, head);
    }
  }

  async function reserveManagerStatsRead(
    transaction,
    request,
    caller,
    attemptHash,
    nowMs,
  ) {
    await verifyManagerStatsTeamAccess(transaction, request, caller);
    const hashes = managerStatsControlHashes(request, caller.uid, attemptHash);
    const refs = managerStatsControlRefs(hashes);
    const snapshot = await readManagerStatsScopeSnapshot(
      transaction,
      refs.scope,
    );
    const scope = parseManagerStatsScope(snapshot, hashes, nowMs);
    const allActiveAttempts = scope?.activeAttempts || [];
    const activeAttempts = (scope?.activeAttempts || []).filter(
      (entry) => entry.leaseExpiresAtMs > nowMs,
    );
    const recentTerminals = (scope?.recentTerminals || []).filter(
      (entry) =>
        entry.finishedAtMs + MANAGER_STAT_RECEIPT_RETENTION_MS > nowMs,
    );
    const matchingActiveAttempt = allActiveAttempts.find(
      (entry) => entry.requestHash === hashes.requestHash,
    );
    if (matchingActiveAttempt?.leaseExpiresAtMs > nowMs) {
      return Object.freeze({ hashes, refs, attemptHash });
    }
    if (
      recentTerminals.some(
        (entry) => entry.requestHash === hashes.requestHash,
      )
    ) {
      throw makeError(
        "already-exists",
        "This manager statistic read attempt is already terminal.",
        { reason: "manager-stat-attempt-terminal", retryable: false },
      );
    }
    const rearmingExpiredAttempt = Boolean(matchingActiveAttempt);

    // Do not coalesce another invocation solely by inputHash. Existing clients
    // need the actual response, while these controls intentionally never store
    // multi-megabyte private stat payloads. Per-UID/team quotas and the three
    // active-attempt slots bound that fan-out instead.

    if (activeAttempts.length >= MAX_CONCURRENT_MANAGER_STAT_REQUESTS) {
      const retryAtMs = Math.min(
        ...activeAttempts.map(({ leaseExpiresAtMs }) => leaseExpiresAtMs),
      );
      throw makeError(
        "resource-exhausted",
        "Too many manager statistic reads are already in progress.",
        managerStatsRetryDetails(
          "manager-stat-concurrency-limited",
          retryAtMs,
          nowMs,
        ),
      );
    }

    const windowActive = Boolean(scope && scope.windowResetAtMs > nowMs);
    const sustainedWindowActive = Boolean(
      scope && scope.sustainedWindowResetAtMs > nowMs,
    );
    const windowStartedAtMs = windowActive ? scope.windowStartedAtMs : nowMs;
    const windowResetAtMs = windowActive
      ? scope.windowResetAtMs
      : nowMs + MANAGER_STAT_RATE_WINDOW_MS;
    const requestCount = windowActive ? scope.requestCount : 0;
    const readUnits = windowActive ? scope.readUnits : 0;
    const sustainedWindowStartedAtMs = sustainedWindowActive
      ? scope.sustainedWindowStartedAtMs
      : nowMs;
    const sustainedWindowResetAtMs = sustainedWindowActive
      ? scope.sustainedWindowResetAtMs
      : nowMs + MANAGER_STAT_SUSTAINED_WINDOW_MS;
    const sustainedRequestCount = sustainedWindowActive
      ? scope.sustainedRequestCount
      : 0;
    const sustainedReadUnits = sustainedWindowActive
      ? scope.sustainedReadUnits
      : 0;
    const requestedReadUnits =
      request.gameHeads.length * (request.playerIds.length + 1);
    const burstLimited =
      requestCount + 1 > MAX_MANAGER_STAT_REQUESTS_PER_WINDOW ||
      readUnits + requestedReadUnits > MAX_MANAGER_STAT_READ_UNITS_PER_WINDOW;
    const sustainedLimited =
      sustainedRequestCount + 1 >
        MAX_MANAGER_STAT_SUSTAINED_REQUESTS_PER_WINDOW ||
      sustainedReadUnits + requestedReadUnits >
        MAX_MANAGER_STAT_SUSTAINED_READ_UNITS_PER_WINDOW;
    if (!rearmingExpiredAttempt && (burstLimited || sustainedLimited)) {
      throw makeError(
        "resource-exhausted",
        "Manager statistic reads are temporarily limited for this team.",
        managerStatsRetryDetails(
          "manager-stat-rate-limited",
          Math.max(
            burstLimited ? windowResetAtMs : 0,
            sustainedLimited ? sustainedWindowResetAtMs : 0,
          ),
          nowMs,
        ),
      );
    }

    // Full manager authority is team-scoped and was established above. Read
    // the mutable game heads only after active/rate controls pass so a limited
    // caller cannot amplify head reads, and no RSVP documents are needed.
    await verifyManagerStatsGameHeads(transaction, request);

    const leaseExpiresAtMs = nowMs + MANAGER_STAT_REQUEST_LEASE_MS;
    const activeAttempt = {
      requestHash: hashes.requestHash,
      startedAtMs: nowMs,
      leaseExpiresAtMs,
    };
    const nextActiveAttempts = [...activeAttempts, activeAttempt].sort(
      (left, right) => left.requestHash.localeCompare(right.requestHash),
    );
    transaction.set(
      refs.scope,
      managerStatsScopeValue(
        hashes,
        nextActiveAttempts,
        recentTerminals,
        nowMs,
        requestCount + (rearmingExpiredAttempt ? 0 : 1),
        readUnits + (rearmingExpiredAttempt ? 0 : requestedReadUnits),
        windowStartedAtMs,
        windowResetAtMs,
        sustainedRequestCount + (rearmingExpiredAttempt ? 0 : 1),
        sustainedReadUnits + (rearmingExpiredAttempt ? 0 : requestedReadUnits),
        sustainedWindowStartedAtMs,
        sustainedWindowResetAtMs,
      ),
    );
    return Object.freeze({ hashes, refs, attemptHash });
  }

  async function failManagerStatsRead(reservation, failureCode) {
    let lastError = null;
    for (let closeAttempt = 0; closeAttempt < 2; closeAttempt += 1) {
      try {
        await firestore.runTransaction(async (transaction) => {
          const nowMs = normalizeNow(clock, makeError);
          const snapshot = await readManagerStatsScopeSnapshot(
            transaction,
            reservation.refs.scope,
          );
          const scope = parseManagerStatsScope(
            snapshot,
            reservation.hashes,
            nowMs,
          );
          if (!scope) return false;
          const nextActiveAttempts = removeOwnedManagerStatsAttempt(
            scope,
            reservation,
          );
          if (nextActiveAttempts.length === scope.activeAttempts.length)
            return false;
          transaction.set(
            reservation.refs.scope,
            managerStatsScopeValue(
              reservation.hashes,
              nextActiveAttempts,
              [
                ...scope.recentTerminals,
                {
                  requestHash: reservation.hashes.requestHash,
                  status: "failed",
                  finishedAtMs: nowMs,
                  failureCode:
                    compactText(failureCode, 64) || "unknown-failure",
                },
              ],
              nowMs,
              scope.requestCount,
              scope.readUnits,
              scope.windowStartedAtMs,
              scope.windowResetAtMs,
              scope.sustainedRequestCount,
              scope.sustainedReadUnits,
              scope.sustainedWindowStartedAtMs,
              scope.sustainedWindowResetAtMs,
            ),
          );
          return true;
        });
        return;
      } catch (error) {
        lastError = error;
        if (
          error instanceof HttpsError ||
          error instanceof DiamondHandlerError
        ) {
          break;
        }
      }
    }
    logger.error?.("diamond_manager_stat_read_failure_state", {
      code: lastError?.code || "write-failed",
    });
  }

  async function completeManagerStatsRead(
    transaction,
    request,
    caller,
    reservation,
    responseHash,
    nowMs,
  ) {
    await verifyManagerStatsTeamAccess(transaction, request, caller);
    await verifyManagerStatsGameHeads(transaction, request);
    const snapshot = await readManagerStatsScopeSnapshot(
      transaction,
      reservation.refs.scope,
    );
    const scope = parseManagerStatsScope(
      snapshot,
      reservation.hashes,
      nowMs,
    );
    assertOwnedManagerStatsAttempt(scope, reservation, nowMs);
    transaction.set(
      reservation.refs.scope,
      managerStatsScopeValue(
        reservation.hashes,
        removeOwnedManagerStatsAttempt(scope, reservation),
        [
          ...scope.recentTerminals,
          {
            requestHash: reservation.hashes.requestHash,
            status: "complete",
            finishedAtMs: nowMs,
            responseHash,
          },
        ],
        nowMs,
        scope.requestCount,
        scope.readUnits,
        scope.windowStartedAtMs,
        scope.windowResetAtMs,
        scope.sustainedRequestCount,
        scope.sustainedReadUnits,
        scope.sustainedWindowStartedAtMs,
        scope.sustainedWindowResetAtMs,
      ),
    );
  }

  async function reconcileManagerStatsCompletion(
    transaction,
    request,
    caller,
    reservation,
    responseHash,
    nowMs,
  ) {
    await verifyManagerStatsTeamAccess(transaction, request, caller);
    await verifyManagerStatsGameHeads(transaction, request);
    const snapshot = await readManagerStatsScopeSnapshot(
      transaction,
      reservation.refs.scope,
    );
    const scope = parseManagerStatsScope(
      snapshot,
      reservation.hashes,
      nowMs,
    );
    const terminal = scope?.recentTerminals?.find(
      (entry) => entry.requestHash === reservation.hashes.requestHash,
    );
    if (terminal?.status === "complete" && terminal.responseHash === responseHash) {
      return true;
    }
    if (scope) {
      const nextActiveAttempts = removeOwnedManagerStatsAttempt(
        scope,
        reservation,
      );
      if (nextActiveAttempts.length !== scope.activeAttempts.length) {
        transaction.set(
          reservation.refs.scope,
          managerStatsScopeValue(
            reservation.hashes,
            nextActiveAttempts,
            [
              ...scope.recentTerminals,
              {
                requestHash: reservation.hashes.requestHash,
                status: "failed",
                finishedAtMs: nowMs,
                failureCode: "completion-unconfirmed",
              },
            ],
            nowMs,
            scope.requestCount,
            scope.readUnits,
            scope.windowStartedAtMs,
            scope.windowResetAtMs,
            scope.sustainedRequestCount,
            scope.sustainedReadUnits,
            scope.sustainedWindowStartedAtMs,
            scope.sustainedWindowResetAtMs,
          ),
        );
      }
    }
    return false;
  }

  function assertManagerPlayerStatDocument(data, head, playerId) {
    if (
      !isPlainObject(data) ||
      data.trackingEngine !== DIAMOND_ENGINE ||
      data.teamId !== head.teamId ||
      data.diamondGameId !== head.gameId ||
      data.playerId !== playerId ||
      data.authoritative !== true ||
      data.complete !== true ||
      !["home", "away"].includes(data.side) ||
      data.projectionSchemaVersion !== 1 ||
      data.instanceId !== head.instanceId ||
      data.diamondScorebookInstanceId !== head.instanceId ||
      data.projectionGeneration !== head.instanceId ||
      data.sourceRevision !== head.sourceRevision ||
      data.checkpointHash !== head.checkpointHash ||
      data.statConfigSnapshotHash !== head.statConfigSnapshotHash ||
      data.projectionHash !== head.projectionHash ||
      !isPlainObject(data.stats) ||
      !isPlainObject(data.observedStats) ||
      !isPlainObject(data.derivedStats) ||
      !isPlainObject(data.observedDerivedStats) ||
      !isPlainObject(data.statCoverage) ||
      !isPlainObject(data.coverage)
    ) {
      throw makeError(
        "aborted",
        "An internal Diamond stat document is incomplete or does not match the authoritative game head.",
        { reason: "manager-stat-document-mismatch" },
      );
    }
  }

  function assertManagerTeamStatDocument(data, head) {
    if (
      !isPlainObject(data) ||
      data.trackingEngine !== DIAMOND_ENGINE ||
      data.teamId !== head.teamId ||
      data.diamondGameId !== head.gameId ||
      data.authoritative === false ||
      data.complete !== true ||
      !["home", "away"].includes(data.side) ||
      data.projectionSchemaVersion !== 1 ||
      data.instanceId !== head.instanceId ||
      data.diamondScorebookInstanceId !== head.instanceId ||
      data.projectionGeneration !== head.instanceId ||
      data.sourceRevision !== head.sourceRevision ||
      data.checkpointHash !== head.checkpointHash ||
      data.statConfigSnapshotHash !== head.statConfigSnapshotHash ||
      data.projectionHash !== head.projectionHash ||
      !isPlainObject(data.stats) ||
      !isPlainObject(data.observedStats) ||
      !isPlainObject(data.statCoverage) ||
      !isPlainObject(data.coverage) ||
      !isPlainObject(data.inningLines)
    ) {
      throw makeError(
        "aborted",
        "An internal Diamond team-stat document is incomplete or does not match the authoritative game head.",
        { reason: "manager-team-stat-document-mismatch" },
      );
    }
  }

  function serializeManagerPlayerStatDocument(data, includeSources) {
    const safe = {
      trackingEngine: data.trackingEngine,
      teamId: data.teamId,
      diamondGameId: data.diamondGameId,
      playerId: data.playerId,
      playerName: compactText(data.playerName, 160),
      playerNumber: compactText(data.playerNumber, 32),
      side: data.side,
      participated: data.participated === true,
      participationStatus: compactText(data.participationStatus, 32),
      participationSource: compactText(data.participationSource, 32),
      ...(data.didNotPlay === true ? { didNotPlay: true } : {}),
      authoritative: true,
      complete: true,
      projectionSchemaVersion: data.projectionSchemaVersion,
      instanceId: data.instanceId,
      diamondScorebookInstanceId: data.diamondScorebookInstanceId,
      projectionGeneration: data.projectionGeneration,
      sourceRevision: data.sourceRevision,
      checkpointHash: data.checkpointHash,
      statConfigSnapshotHash: data.statConfigSnapshotHash,
      projectionHash: data.projectionHash,
      stats: data.stats,
      observedStats: data.observedStats,
      derivedStats: data.derivedStats,
      observedDerivedStats: data.observedDerivedStats,
      statCoverage: data.statCoverage,
      coverage: data.coverage,
      unavailableDerivedStats: Array.isArray(data.unavailableDerivedStats)
        ? data.unavailableDerivedStats
        : [],
      missingStatFamilies: Array.isArray(data.missingStatFamilies)
        ? data.missingStatFamilies
        : [],
    };
    if (includeSources) {
      safe.statSources = isPlainObject(data.statSources)
        ? data.statSources
        : {};
      safe.sourcePlayIds = Array.isArray(data.sourcePlayIds)
        ? data.sourcePlayIds
        : [];
    }
    return safe;
  }

  function serializeManagerTeamStatDocument(data) {
    return {
      trackingEngine: data.trackingEngine,
      teamId: data.teamId,
      diamondGameId: data.diamondGameId,
      side: data.side,
      complete: true,
      projectionSchemaVersion: data.projectionSchemaVersion,
      instanceId: data.instanceId,
      diamondScorebookInstanceId: data.diamondScorebookInstanceId,
      projectionGeneration: data.projectionGeneration,
      sourceRevision: data.sourceRevision,
      checkpointHash: data.checkpointHash,
      statConfigSnapshotHash: data.statConfigSnapshotHash,
      projectionHash: data.projectionHash,
      stats: data.stats,
      observedStats: data.observedStats,
      statCoverage: data.statCoverage,
      coverage: data.coverage,
      inningLines: data.inningLines,
    };
  }

  function finalizeManagerStatsResponse(payload) {
    const response = {
      ...payload,
      responseByteLimit: MAX_MANAGER_STAT_RESPONSE_BYTES,
      responseByteCount: 0,
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response.responseByteCount = Buffer.byteLength(
        JSON.stringify(response),
        "utf8",
      );
    }
    if (response.responseByteCount > MAX_MANAGER_STAT_RESPONSE_BYTES) {
      throw makeError(
        "resource-exhausted",
        "The bounded internal stat response is too large. Narrow the requested players or games.",
        { reason: "manager-stat-response-too-large" },
      );
    }
    return response;
  }

  function finalizePrivateEventPage(page) {
    const response = {
      sourceRevision: page.sourceRevision,
      items: page.items,
      nextCursor: page.nextCursor,
      complete: page.complete,
      accessComplete: page.accessComplete,
      collectionComplete: page.collectionComplete,
      responseByteCount: 0,
      responseByteLimit: MAX_PRIVATE_EVENT_PAGE_BYTES,
    };
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const byteCount = Buffer.byteLength(JSON.stringify(response), "utf8");
      if (byteCount === response.responseByteCount) {
        if (byteCount > MAX_PRIVATE_EVENT_PAGE_BYTES) {
          throw makeError(
            "resource-exhausted",
            "The bounded private event page is too large. Request fewer events.",
            { reason: "private-event-page-too-large" },
          );
        }
        return response;
      }
      response.responseByteCount = byteCount;
    }
    throw makeError(
      "internal",
      "The private event page byte evidence could not be finalized.",
    );
  }

  function buildByteBoundedPrivateEventPage({
    events,
    limit,
    hasMore,
    sourceRevision,
  }) {
    const buildCandidate = (count) => {
      const candidateHasMore = hasMore === true || count < events.length;
      const nextCursor =
        candidateHasMore && count > 0
          ? String(events[count - 1].sequence)
          : null;
      return finalizePrivateEventPage(
        core.buildDiamondEventPage({
          events: events.slice(0, count),
          limit,
          hasMore: candidateHasMore,
          nextCursor,
          readStatus: "complete",
          sourceRevision,
          visibility: "private-summary",
        }),
      );
    };

    if (!events.length) return buildCandidate(0);

    // Valid commands can be substantially larger than ordinary scoring plays.
    // Keep the requested item limit as an upper bound, then pack the largest
    // contiguous prefix whose complete response evidence fits the callable cap.
    let lower = 1;
    let upper = events.length;
    let best = null;
    while (lower <= upper) {
      const count = Math.floor((lower + upper) / 2);
      try {
        best = buildCandidate(count);
        lower = count + 1;
      } catch (error) {
        if (
          error?.code !== "resource-exhausted" ||
          error?.details?.reason !== "private-event-page-too-large"
        ) {
          throw error;
        }
        upper = count - 1;
      }
    }
    if (best) return best;

    // Only a single event that cannot fit by itself is permanently oversized.
    return buildCandidate(1);
  }

  async function getDiamondManagerStats(data = {}, context = {}) {
    const normalized = normalizeManagerStatsRequest(data);
    let caller = await loadEnabledAuthUser(context);
    const attemptHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-manager-stat-read-attempt",
      attemptId: secureUuid(random, makeError, "manager statistic read"),
    });
    try {
      await firestore.runTransaction((transaction) =>
        reserveManagerStatsAdmission(
          transaction,
          normalized,
          caller,
          attemptHash,
          normalizeNow(clock, makeError),
        ),
      );
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError)
        throw error;
      caller = await loadEnabledAuthUser(context);
      try {
        await firestore.runTransaction((transaction) =>
          reserveManagerStatsAdmission(
            transaction,
            normalized,
            caller,
            attemptHash,
            normalizeNow(clock, makeError),
          ),
        );
      } catch (reconcileError) {
        if (
          reconcileError instanceof HttpsError ||
          reconcileError instanceof DiamondHandlerError
        ) {
          throw reconcileError;
        }
        throw makeError(
          "unavailable",
          "Manager statistic read admission could not be confirmed.",
        );
      }
    }
    let reservation;
    try {
      reservation = await firestore.runTransaction((transaction) =>
        reserveManagerStatsRead(
          transaction,
          normalized,
          caller,
          attemptHash,
          normalizeNow(clock, makeError),
        ),
      );
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError)
        throw error;
      caller = await loadEnabledAuthUser(context);
      try {
        reservation = await firestore.runTransaction((transaction) =>
          reserveManagerStatsRead(
            transaction,
            normalized,
            caller,
            attemptHash,
            normalizeNow(clock, makeError),
          ),
        );
      } catch (reconcileError) {
        if (
          reconcileError instanceof HttpsError ||
          reconcileError instanceof DiamondHandlerError
        ) {
          throw reconcileError;
        }
        throw makeError(
          "unavailable",
          "The manager statistic read reservation could not be confirmed. Try again.",
        );
      }
    }

    const playerRequests = normalized.gameHeads.flatMap((head) =>
      normalized.playerIds.map((playerId) => ({
        head: { ...head, teamId: normalized.teamId },
        playerId,
        reference: firestore.doc(
          `${paths(normalized.teamId, head.gameId).diamondStatGeneration(head.instanceId)}/privatePlayerStats/${playerId}`,
        ),
      })),
    );
    const teamRequests = normalized.gameHeads.map((head) => ({
      head: { ...head, teamId: normalized.teamId },
      reference: firestore.doc(
        `${paths(normalized.teamId, head.gameId).diamondStatGeneration(head.instanceId)}/teamStats/team`,
      ),
    }));
    const requests = [...playerRequests, ...teamRequests];
    let response;
    let failureCode = "bulk-read-failed";
    try {
      if (typeof firestore.getAll !== "function") {
        throw new Error("Firestore bulk reads are unavailable.");
      }
      const references = requests.map(({ reference }) => reference);
      const statSnapshots =
        normalized.gameHeads.length === 1
          ? await firestore.getAll(...references)
          : await firestore.getAll(...references, {
              fieldMask: MANAGER_STAT_COMPACT_FIELD_MASK,
            });
      failureCode = "bulk-read-incomplete";
      if (
        !Array.isArray(statSnapshots) ||
        statSnapshots.length !== requests.length
      ) {
        throw makeError(
          "unavailable",
          "Internal Diamond statistics returned an incomplete bounded read. Try again.",
        );
      }

      failureCode = "private-document-invalid";
      const documents = [];
      for (let index = 0; index < playerRequests.length; index += 1) {
        const request = playerRequests[index];
        const document = snapshotData(statSnapshots[index]);
        if (!document) continue;
        assertManagerPlayerStatDocument(
          document,
          request.head,
          request.playerId,
        );
        documents.push({
          gameId: request.head.gameId,
          playerId: request.playerId,
          // Season reads omit play-source arrays so 40x25 remains safely below
          // the callable response cap. A one-game drill-down retains citations.
          data: serializeManagerPlayerStatDocument(
            document,
            normalized.gameHeads.length === 1,
          ),
        });
      }
      const teamDocuments = [];
      for (let index = 0; index < teamRequests.length; index += 1) {
        const request = teamRequests[index];
        const document = snapshotData(
          statSnapshots[playerRequests.length + index],
        );
        if (!document) continue;
        assertManagerTeamStatDocument(document, request.head);
        teamDocuments.push({
          gameId: request.head.gameId,
          data: serializeManagerTeamStatDocument(document),
        });
      }

      failureCode = "response-finalization-failed";
      const expectedDocumentCount = playerRequests.length;
      const expectedTeamDocumentCount = teamRequests.length;
      response = finalizeManagerStatsResponse({
        schemaVersion: 1,
        trackingEngine: DIAMOND_ENGINE,
        visibility: "manager-internal",
        status: "complete",
        complete: true,
        truncated: false,
        requestedGameCount: normalized.gameHeads.length,
        requestedPlayerCount: normalized.playerIds.length,
        expectedDocumentCount,
        documentCount: documents.length,
        missingDocumentCount: expectedDocumentCount - documents.length,
        absenceConfirmed: documents.length === 0,
        documents,
        expectedTeamDocumentCount,
        teamDocumentCount: teamDocuments.length,
        missingTeamDocumentCount:
          expectedTeamDocumentCount - teamDocuments.length,
        teamDocuments,
      });
    } catch (error) {
      await failManagerStatsRead(reservation, failureCode);
      if (error instanceof HttpsError || error instanceof DiamondHandlerError)
        throw error;
      throw makeError(
        "unavailable",
        "Internal Diamond statistics could not be loaded completely. Try again.",
      );
    }

    // Auth, the durable attempt owner, and every mutable role/head input are
    // re-read together after the private bulk read. A revocation, new
    // projection, or lost lease therefore returns no private payload.
    caller = await loadEnabledAuthUser(context).catch(async (error) => {
      await failManagerStatsRead(
        reservation,
        "final-auth-recheck-failed",
      );
      throw error;
    });
    const responseHash = core.hashDiamondValue(response);
    try {
      await firestore.runTransaction((transaction) =>
        completeManagerStatsRead(
          transaction,
          normalized,
          caller,
          reservation,
          responseHash,
          normalizeNow(clock, makeError),
        ),
      );
      return response;
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError) {
        await failManagerStatsRead(
          reservation,
          "final-access-recheck-failed",
        );
        throw error;
      }
      try {
        caller = await loadEnabledAuthUser(context);
        const reconciled = await firestore.runTransaction((transaction) =>
          reconcileManagerStatsCompletion(
            transaction,
            normalized,
            caller,
            reservation,
            responseHash,
            normalizeNow(clock, makeError),
          ),
        );
        if (reconciled) return response;
      } catch (reconcileError) {
        if (
          reconcileError instanceof HttpsError ||
          reconcileError instanceof DiamondHandlerError
        ) {
          throw reconcileError;
        }
      }
      throw makeError(
        "unavailable",
        "The manager statistic response commit could not be confirmed. Try again.",
      );
    }
  }

  async function activateDiamondGame(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set(["requestId", "teamId", "gameId", "captureMode", "appBuild"]),
      makeError,
      "Game activation request",
    );
    const requestId = normalizeUuid(data.requestId, "requestId");
    const teamId = normalizeId(data.teamId, "teamId");
    const gameId = normalizeId(data.gameId, "gameId");
    const captureMode =
      data.captureMode === "full"
        ? "full"
        : data.captureMode === "quick"
          ? "quick"
          : null;
    if (!captureMode)
      throw makeError("invalid-argument", "captureMode must be quick or full.");
    const appBuild = normalizeAppBuild(data.appBuild, makeError);
    const caller = await loadEnabledAuthUser(context);
    const resourcePaths = paths(teamId, gameId);
    const activationAdmissionIdentities =
      commandHistorySharedAdmissionIdentities(teamId, gameId, caller.uid);
    let activationNowMs = null;
    const getActivationNowMs = () => {
      if (activationNowMs === null)
        activationNowMs = normalizeNow(clock, makeError);
      return activationNowMs;
    };
    let activationIds = null;
    const getActivationIds = () => {
      if (!activationIds) {
        activationIds = {
          eventId: secureUuid(random, makeError, "activation event"),
          instanceId: secureUuid(random, makeError, "scorebook generation"),
        };
      }
      return activationIds;
    };

    return firestore.runTransaction(async (transaction) => {
      const policy = await readPolicy(transaction);
      const loaded = await loadAccessDocuments(
        transaction,
        teamId,
        gameId,
        caller,
      );
      requireManager(
        loaded.access,
        "Only a current team manager can activate a Diamond game.",
      );
      const cleanupLock = snapshotData(
        await transaction.get(firestore.doc(resourcePaths.cleanupLock)),
      );
      if (cleanupLock?.status === "deleting") {
        throw makeError(
          "unavailable",
          "Previous Diamond game data is still being cleaned up. Try again shortly.",
        );
      }
      const existingRoot = snapshotData(
        await transaction.get(firestore.doc(resourcePaths.scorebook)),
      );
      const existingReceipt = snapshotData(
        await transaction.get(firestore.doc(resourcePaths.command(requestId))),
      );
      if (loaded.game.trackingEngine === DIAMOND_ENGINE) {
        if (
          !existingRoot ||
          existingRoot.instanceId !== loaded.game.diamondScorebookInstanceId
        ) {
          throw makeError(
            "failed-precondition",
            "The Diamond game claim is incomplete and requires recovery.",
          );
        }
        const checkpoint = buildCheckpointFromRoot(existingRoot);
        if (!checkpoint)
          throw makeError(
            "failed-precondition",
            "The Diamond checkpoint is unavailable.",
          );
        validateCommittedStatConfigSnapshot(existingRoot, loaded.game, teamId);
        validateCommittedOrientationSnapshot(existingRoot, teamId);
        if (existingReceipt) {
          const retryCommand = {
            schemaVersion: 2,
            commandId: requestId,
            teamId,
            gameId,
            appBuild,
            expectedInstanceId: existingRoot.instanceId,
            expectedRevision: 0,
            rulesProfileId: existingRoot.rulesProfileId,
            rulesProfileVersion: existingRoot.rulesProfileVersion,
            type: "activate",
            payload: { initialScorerUid: caller.uid, captureMode },
          };
          if (
            existingReceipt.commandHash !==
              domainEngine.getDiamondCommandHash(retryCommand) ||
            existingReceipt.result?.outcome !== "accepted"
          ) {
            throw makeError(
              "already-exists",
              "requestId was already used with different activation details.",
            );
          }
          return {
            activated: true,
            teamId,
            gameId,
            trackingEngine: DIAMOND_ENGINE,
            state: buildPrivateSnapshot({
              state: existingReceipt.result.state,
              root: existingRoot,
              team: loaded.team,
              game: loaded.game,
              callerUid: caller.uid,
              canScore: loaded.access.scorekeeping,
              canManage: loaded.access.full,
              nowMs: getActivationNowMs(),
              core,
            }),
          };
        }
        return {
          activated: true,
          teamId,
          gameId,
          trackingEngine: DIAMOND_ENGINE,
          state: buildPrivateSnapshot({
            state: checkpoint.state,
            root: existingRoot,
            team: loaded.team,
            game: loaded.game,
            callerUid: caller.uid,
            canScore: loaded.access.scorekeeping,
            canManage: loaded.access.full,
            nowMs: getActivationNowMs(),
            core,
          }),
        };
      }
      if (existingRoot) {
        throw makeError(
          "failed-precondition",
          "Unclaimed Diamond data already exists for this game.",
        );
      }
      if (existingReceipt) {
        throw makeError(
          "failed-precondition",
          "An activation receipt exists without its canonical scorebook.",
        );
      }
      requireAllowed(
        core.decideDiamondOperation({
          operation: "activate",
          policy,
          teamId,
          gameId,
          appBuild,
          game: {},
        }),
        "Diamond activation is disabled.",
      );
      const nowMs = getActivationNowMs();
      const activationAdmission = await planCommandHistoryWork(
        transaction,
        activationAdmissionIdentities,
        { requestedProjectionReadUnits: 1, nowMs },
      );
      const configuredOptIn = core.parseDiamondTeamOptIn(
        loaded.team.diamondScorebook,
      );
      const statConfigSnapshot = await pinGameStatConfig(
        transaction,
        teamId,
        gameId,
        loaded.game,
        configuredOptIn.sport,
      );
      const orientationSnapshot = pinGameOrientation(
        teamId,
        loaded.team,
        loaded.game,
      );
      const availablePlayers = await loadRosterCandidates(
        transaction,
        teamId,
        orientationSnapshot,
      );
      const gameWithLegacyEvidence = { ...loaded.game };
      const legacyCollectionsFound = [];
      for (const collectionName of LEGACY_TRACKING_COLLECTIONS) {
        let legacySnapshot;
        try {
          legacySnapshot = await transaction.get(
            firestore
              .collection(`${resourcePaths.game}/${collectionName}`)
              .limit(1),
          );
        } catch {
          throw makeError(
            "unavailable",
            "Legacy score data could not be checked completely. No activation occurred.",
          );
        }
        if (!queryIsEmpty(legacySnapshot)) {
          legacyCollectionsFound.push(collectionName);
          gameWithLegacyEvidence[collectionName] = [true];
        }
      }
      if (legacyCollectionsFound.length) {
        throw makeError(
          "failed-precondition",
          "The game already contains legacy tracking data.",
          {
            reason: "legacy-data-present",
            legacyCollections: legacyCollectionsFound,
          },
        );
      }
      const eligibility = core.evaluateDiamondActivationEligibility({
        policy,
        team: loaded.team,
        game: gameWithLegacyEvidence,
        teamOptIn: loaded.team.diamondScorebook,
        teamId,
        gameId,
        appBuild,
      });
      requireAllowed(
        eligibility,
        "This game is not eligible for Diamond activation.",
      );
      const claim = core.decideDiamondEngineClaim({
        game: gameWithLegacyEvidence,
        eligibility,
        activationVerified: true,
      });
      requireAllowed(claim, "This game cannot be claimed by Diamond.");
      const optIn = configuredOptIn;
      const pinnedProfile = profileForSport(
        domainEngine,
        optIn.sport,
        optIn.rulesProfileId,
        optIn.rulesProfileVersion,
      );
      if (!pinnedProfile) {
        throw makeError(
          "failed-precondition",
          "The configured Diamond rules profile is unavailable.",
        );
      }
      const { eventId, instanceId } = getActivationIds();
      const ledger = domainEngine.createDiamondLedger({
        teamId,
        gameId,
        rulesProfileId: optIn.rulesProfileId,
        rulesProfileVersion: optIn.rulesProfileVersion,
        captureMode,
      });
      const command = {
        schemaVersion: 2,
        commandId: requestId,
        teamId,
        gameId,
        appBuild,
        expectedInstanceId: instanceId,
        expectedRevision: 0,
        rulesProfileId: optIn.rulesProfileId,
        rulesProfileVersion: optIn.rulesProfileVersion,
        type: "activate",
        payload: { initialScorerUid: caller.uid, captureMode },
      };
      const execution = domainEngine.executeDiamondCommand(ledger, command, {
        actorUid: caller.uid,
        eventId,
        serverTimestampMs: nowMs,
        managerAuthorized: loaded.access.full,
      });
      if (execution.result.outcome !== "accepted" || !execution.event) {
        throw makeError(
          mapDomainErrorCode(execution.result.rejection?.code),
          execution.result.rejection?.message ||
            "Diamond activation was rejected.",
        );
      }
      const checkpoint = domainEngine.createDiamondCheckpoint(execution.ledger);
      const recentPublicEvents = updateRecentPlays([], execution.event, core);
      const root = {
        schemaVersion: 2,
        trackingEngine: DIAMOND_ENGINE,
        instanceId,
        teamId,
        gameId,
        rulesProfileId: optIn.rulesProfileId,
        rulesProfileVersion: optIn.rulesProfileVersion,
        captureMode,
        policyRevisionAtActivation: policy.revision,
        rolloutModeAtActivation: policy.mode,
        rolloutPercentAtActivation: eligibility.rolloutPercent,
        rolloutBucketAtActivation: eligibility.rolloutBucket,
        rolloutAllowlistedAtActivation: eligibility.explicitlyAllowlisted,
        statConfigSnapshot,
        orientationSnapshot,
        initialState: ledger.initialState,
        checkpoint,
        scorerLease: {
          holderUid: caller.uid,
          leaseId: requestId,
          expiresAtMillis: nowMs + SCORER_LEASE_DURATION_MS,
          epoch: 1,
          acquiredAt: timestampIso(nowMs),
          renewedAt: timestampIso(nowMs),
        },
        availablePlayers,
        rulesCapabilities: {
          dpFlex: pinnedProfile.dpFlex?.enabled === true,
          courtesyRunner: {
            pitcher: pinnedProfile.courtesyRunner?.pitcher === true,
            catcher: pinnedProfile.courtesyRunner?.catcher === true,
          },
        },
        recentPublicEvents,
        privateNoteStorageVersion: DIAMOND_PRIVATE_NOTE_STORAGE_VERSION,
        privateNotePrivacyRevision: 0,
        projectionStatus: "pending",
        createdAt: timestampIso(nowMs),
        createdBy: caller.uid,
        updatedAt: timestampIso(nowMs),
      };
      const projectedGame = {
        ...loaded.game,
        trackingEngine: DIAMOND_ENGINE,
        diamondScorebookInstanceId: instanceId,
      };
      const publicProjection = buildPublicProjection({
        state: checkpoint.state,
        root,
        team: loaded.team,
        game: projectedGame,
        nowMs,
        core,
      });
      const publicEvent = buildPublicEvent(execution.event, core);
      writeCommandHistoryWork(transaction, activationAdmission);
      transaction.create(firestore.doc(resourcePaths.scorebook), root);
      transaction.create(firestore.doc(resourcePaths.event(eventId)), {
        ...execution.event,
        instanceId,
      });
      transaction.create(firestore.doc(resourcePaths.command(requestId)), {
        commandId: requestId,
        commandHash: domainEngine.getDiamondCommandHash(command),
        event: execution.event,
        result: execution.result,
        instanceId,
        acceptedAt: timestampIso(nowMs),
      });
      transaction.set(firestore.doc(resourcePaths.publicState), {
        ...publicProjection,
        instanceId,
        publicEventCount: publicEvent ? 1 : 0,
      });
      if (publicEvent) {
        transaction.create(firestore.doc(resourcePaths.publicEvent(eventId)), {
          ...publicEvent,
          instanceId,
        });
      }
      transaction.set(firestore.doc(resourcePaths.projection("stats")), {
        schemaVersion: 1,
        instanceId,
        status: "pending",
        sourceRevision: checkpoint.sequence,
        updatedAt: timestampIso(nowMs),
        reason: "incremental-stat-projector-unavailable",
      });
      transaction.update(loaded.gameRef, {
        ...claim.update,
        ...gameProjectionPatch(checkpoint.state),
        diamondScorebookInstanceId: instanceId,
        diamondStatConfigSnapshotHash: statConfigSnapshot.snapshotHash,
        trackingEngineActivatedAt: timestampIso(nowMs),
        trackingEngineActivatedBy: caller.uid,
      });
      return {
        activated: true,
        teamId,
        gameId,
        trackingEngine: DIAMOND_ENGINE,
        state: buildPrivateSnapshot({
          state: checkpoint.state,
          root,
          team: loaded.team,
          game: projectedGame,
          callerUid: caller.uid,
          canScore: true,
          canManage: loaded.access.full,
          nowMs,
          core,
        }),
      };
    });
  }

  async function acquireDiamondScorerLease(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set([
        "requestId",
        "teamId",
        "gameId",
        "appBuild",
        "expectedInstanceId",
        "expectedRevision",
        "operation",
        "targetUid",
      ]),
      makeError,
      "Scorer lease request",
    );
    const requestId = normalizeUuid(data.requestId, "requestId");
    const teamId = normalizeId(data.teamId, "teamId");
    const gameId = normalizeId(data.gameId, "gameId");
    const appBuild = normalizeAppBuild(data.appBuild, makeError);
    const expectedInstanceId = normalizeUuid(
      data.expectedInstanceId,
      "expectedInstanceId",
    );
    const expectedRevision = normalizeOptionalRevision(
      data.expectedRevision,
      makeError,
    );
    if (expectedRevision === null) {
      throw makeError(
        "invalid-argument",
        "expectedRevision is required for scorer lease acquisition.",
      );
    }
    const operation =
      data.operation === "acquire" || data.operation === "recover"
        ? data.operation
        : null;
    if (!operation) {
      throw makeError(
        "invalid-argument",
        "operation must be acquire or recover.",
      );
    }
    const requestedTargetUid =
      data.targetUid === null ||
      data.targetUid === undefined ||
      data.targetUid === ""
        ? null
        : normalizeId(data.targetUid, "targetUid");
    const caller = await loadEnabledAuthUser(context);
    if (
      operation === "acquire" &&
      requestedTargetUid !== null &&
      requestedTargetUid !== caller.uid
    ) {
      throw makeError(
        "invalid-argument",
        "A scorer may only acquire an available lease for their own account.",
      );
    }
    const targetUid = requestedTargetUid || caller.uid;
    const request = {
      schemaVersion: 1,
      requestId,
      teamId,
      gameId,
      appBuild,
      expectedInstanceId,
      expectedRevision,
      operation,
      targetUid,
    };
    const requestHash = core.hashDiamondValue(request);
    const resourcePaths = paths(teamId, gameId);
    const nowMs = normalizeNow(clock, makeError);
    const admissionIdentities = commandHistoryAdmissionIdentities(
      request,
      caller.uid,
    );

    return firestore.runTransaction(async (transaction) => {
      const policy = await readPolicy(transaction);
      const loaded = await loadAccessDocuments(
        transaction,
        teamId,
        gameId,
        caller,
      );
      if (operation === "recover") {
        requireManager(
          loaded.access,
          "Only a current team manager can recover a scorer lease.",
        );
      } else {
        requireScorekeeper(loaded.access);
      }
      const rootRef = firestore.doc(resourcePaths.scorebook);
      const receiptRef = firestore.doc(resourcePaths.command(requestId));
      const auditRef = firestore.doc(resourcePaths.audit(requestId));
      const [rootSnapshot, receiptSnapshot, auditSnapshot] = await Promise.all([
        transaction.get(rootRef),
        transaction.get(receiptRef),
        transaction.get(auditRef),
      ]);
      const root = snapshotData(rootSnapshot);
      const existingReceipt = snapshotData(receiptSnapshot);
      const existingAudit = snapshotData(auditSnapshot);
      if (!root) throw makeError("not-found", "Diamond scorebook not found.");
      requirePrivateNoteStorageVersion(root);
      if (
        loaded.game.trackingEngine !== DIAMOND_ENGINE ||
        root.instanceId !== loaded.game.diamondScorebookInstanceId
      ) {
        throw makeError(
          "failed-precondition",
          "The Diamond scorebook generation does not match the game.",
        );
      }
      validateCommittedOrientationSnapshot(root, teamId);
      const checkpoint = buildCheckpointFromRoot(root);
      if (!checkpoint) {
        throw makeError(
          "failed-precondition",
          "The Diamond checkpoint is unavailable.",
        );
      }
      if (existingAudit || existingReceipt) {
        if (
          !existingAudit ||
          !existingReceipt ||
          existingAudit.type !== "scorer-lease-changed" ||
          existingAudit.requestHash !== requestHash ||
          existingAudit.actorUid !== caller.uid ||
          existingReceipt.result?.outcome !== "accepted" ||
          existingReceipt.commandId !== requestId ||
          existingReceipt.instanceId !== root.instanceId
        ) {
          throw makeError(
            "already-exists",
            "requestId was already used for a different Diamond operation.",
          );
        }
        return {
          outcome: "duplicate",
          operation,
          revision: checkpoint.sequence,
          state: buildPrivateSnapshot({
            state: checkpoint.state,
            root,
            team: loaded.team,
            game: loaded.game,
            callerUid: caller.uid,
            canScore: loaded.access.scorekeeping,
            canManage: loaded.access.full,
            nowMs,
            core,
          }),
        };
      }
      requireDiamondPlayerIdentityHistory(root, checkpoint);
      if (root.instanceId !== expectedInstanceId) {
        throw makeError(
          "aborted",
          "The Diamond game instance changed. Reload before acquiring the scorer lease.",
          {
            reason: "stale-instance",
            authoritativeRevision: checkpoint.sequence,
          },
        );
      }
      if (checkpoint.sequence !== expectedRevision) {
        throw makeError(
          "aborted",
          "The scorebook changed before the scorer lease could be acquired.",
          { authoritativeRevision: checkpoint.sequence },
        );
      }
      requireCanonicalEventCapacity(checkpoint);
      if (!isActiveTeam(loaded.team)) {
        throw makeError(
          "failed-precondition",
          "Inactive teams cannot acquire Diamond scorer leases.",
        );
      }
      const operationName = ["final", "correction"].includes(
        checkpoint.state?.lifecycle,
      )
        ? "correct"
        : "score";
      requireAllowed(
        core.decideDiamondOperation({
          operation: operationName,
          policy,
          teamId,
          appBuild,
          game: loaded.game,
        }),
        "Diamond scorer lease acquisition is disabled.",
      );
      await validateScorerTarget(transaction, {
        teamId,
        gameId,
        targetUid,
        loaded,
      });
      const leaseDecision = core.decideDiamondScorerLease({
        operation,
        lease: root.scorerLease,
        actorUid: caller.uid,
        targetUid,
        replacementLeaseId: requestId,
        actorCanManage: loaded.access.full,
        eligibleTargetUids: [targetUid],
        nowMillis: nowMs,
      });
      requireAllowed(leaseDecision, "The scorer lease could not be acquired.");
      const command = core.normalizeDiamondCommand({
        schemaVersion: 2,
        commandId: requestId,
        teamId,
        gameId,
        appBuild,
        expectedInstanceId,
        expectedRevision,
        rulesProfileId: root.rulesProfileId,
        rulesProfileVersion: root.rulesProfileVersion,
        type: "scorer_handoff",
        payload: { toUid: targetUid },
      });
      const eventId = secureUuid(random, makeError, "scorer lease event");
      const execution = domainEngine.executeDiamondCommandFromCheckpoint(
        checkpoint,
        command,
        {
          actorUid: caller.uid,
          eventId,
          serverTimestampMs: nowMs,
          managerAuthorized: loaded.access.full,
          scorerLeaseRecoveryAuthorized: true,
        },
        null,
      );
      if (execution.result.outcome !== "accepted" || !execution.event) {
        throw makeError(
          mapDomainErrorCode(execution.result.rejection?.code),
          execution.result.rejection?.message ||
            "The scorer lease change was rejected.",
        );
      }
      const admissionWrites = await planCommandHistoryWork(
        transaction,
        admissionIdentities,
        {
          requestedProjectionReadUnits: execution.result.revision,
          nowMs,
        },
      );
      const nextLease = {
        ...leaseDecision.nextLease,
        expiresAtMillis: nowMs + SCORER_LEASE_DURATION_MS,
        acquiredAt: timestampIso(nowMs),
        renewedAt: timestampIso(nowMs),
      };
      const resolvedCheckpoint = execution.checkpoint;
      const recentPublicEvents = updateRecentPlays(
        root.recentPublicEvents,
        execution.event,
        core,
      );
      const nextRoot = {
        ...root,
        checkpoint: resolvedCheckpoint,
        privateNotePrivacyRevision: privateNotePrivacyRevision(root),
        scorerLease: nextLease,
        recentPublicEvents,
        projectionStatus: "pending",
        updatedAt: timestampIso(nowMs),
        lastCommandType: command.type,
      };
      const publicProjection = buildPublicProjection({
        state: execution.result.state,
        root: nextRoot,
        team: loaded.team,
        game: loaded.game,
        nowMs,
        core,
      });
      const publicEvent = buildPublicEvent(execution.event, core);
      const publicStateRef = firestore.doc(resourcePaths.publicState);
      const publicStateSnapshot = await transaction.get(publicStateRef);
      const existingPublicState = snapshotData(publicStateSnapshot) || {};
      writeCommandHistoryWork(transaction, admissionWrites);
      transaction.create(
        firestore.doc(resourcePaths.event(execution.event.eventId)),
        { ...execution.event, instanceId: root.instanceId },
      );
      transaction.create(receiptRef, {
        ...execution.receipt,
        instanceId: root.instanceId,
        acceptedAt: timestampIso(nowMs),
      });
      transaction.create(auditRef, {
        schemaVersion: 1,
        instanceId: root.instanceId,
        type: "scorer-lease-changed",
        operation,
        requestHash,
        actorUid: caller.uid,
        previousHolderUid: root.scorerLease?.holderUid || null,
        previousEpoch: root.scorerLease?.epoch || null,
        nextHolderUid: nextLease.holderUid,
        nextEpoch: nextLease.epoch,
        sourceRevision: execution.result.revision,
        createdAt: timestampIso(nowMs),
      });
      transaction.update(rootRef, {
        checkpoint: resolvedCheckpoint,
        privateNotePrivacyRevision: privateNotePrivacyRevision(root),
        scorerLease: nextLease,
        recentPublicEvents,
        projectionStatus: "pending",
        updatedAt: timestampIso(nowMs),
        lastCommandType: command.type,
      });
      transaction.set(publicStateRef, {
        ...publicProjection,
        instanceId: root.instanceId,
        publicEventCount:
          Number(existingPublicState.publicEventCount || 0) +
          (publicEvent ? 1 : 0),
      });
      if (publicEvent) {
        transaction.create(
          firestore.doc(resourcePaths.publicEvent(execution.event.eventId)),
          { ...publicEvent, instanceId: root.instanceId },
        );
      }
      transaction.set(
        firestore.doc(resourcePaths.projection("stats")),
        {
          schemaVersion: 1,
          instanceId: root.instanceId,
          status: "pending",
          sourceRevision: execution.result.revision,
          updatedAt: timestampIso(nowMs),
          reason: "incremental-stat-projector-unavailable",
        },
        { merge: true },
      );
      transaction.update(
        loaded.gameRef,
        gameProjectionPatch(execution.result.state),
      );
      return {
        outcome: "accepted",
        operation,
        revision: execution.result.revision,
        eventId: execution.event.eventId,
        state: buildPrivateSnapshot({
          state: execution.result.state,
          root: nextRoot,
          team: loaded.team,
          game: loaded.game,
          callerUid: caller.uid,
          canScore: loaded.access.scorekeeping,
          canManage: loaded.access.full,
          nowMs,
          core,
        }),
      };
    });
  }

  function canonicalEventsQuery(
    collectionPath,
    afterSequence,
    limit,
    throughSequence = null,
  ) {
    let query = firestore
      .collection(collectionPath)
      .where("sequence", ">", afterSequence);
    if (Number.isSafeInteger(throughSequence)) {
      query = query.where("sequence", "<=", throughSequence);
    }
    return query.orderBy("sequence", "asc").limit(limit);
  }

  function publicViewerEventsQuery(
    collectionPath,
    beforeSequence,
    throughSequence,
    limit,
  ) {
    let query = firestore
      .collection(collectionPath)
      .where("sequence", "<=", throughSequence);
    if (beforeSequence > 0)
      query = query.where("sequence", "<", beforeSequence);
    return query.orderBy("sequence", "desc").limit(limit);
  }

  async function loadAllCanonicalEvents(
    teamId,
    gameId,
    throughSequence = null,
  ) {
    const resourcePaths = paths(teamId, gameId);
    const boundedSequence = Number.isSafeInteger(throughSequence)
      ? throughSequence
      : null;
    if (
      boundedSequence !== null &&
      (boundedSequence < 0 || boundedSequence > MAX_CANONICAL_EVENTS)
    ) {
      throw makeError(
        "resource-exhausted",
        "This game exceeds the bounded Diamond replay limit.",
      );
    }
    const events = [];
    if (boundedSequence === 0) return events;
    let afterSequence = 0;
    const maximumEvents = boundedSequence ?? MAX_CANONICAL_EVENTS;
    while (events.length <= maximumEvents) {
      let snapshot;
      try {
        const pageLimit =
          boundedSequence === null
            ? FULL_HISTORY_PAGE_SIZE
            : Math.min(
                FULL_HISTORY_PAGE_SIZE,
                boundedSequence - afterSequence,
              );
        snapshot = await canonicalEventsQuery(
          resourcePaths.events,
          afterSequence,
          pageLimit,
          boundedSequence,
        ).get();
      } catch {
        throw makeError(
          "unavailable",
          "The complete Diamond event history could not be read. Try again.",
        );
      }
      const documents = snapshotDocuments(snapshot);
      if (documents.length > FULL_HISTORY_PAGE_SIZE) {
        throw makeError(
          "unavailable",
          "The Diamond event history returned an invalid page.",
        );
      }
      if (!documents.length) return events;
      for (const document of documents) {
        const event = snapshotData(document);
        if (
          !event ||
          !Number.isSafeInteger(event.sequence) ||
          event.sequence <= afterSequence
        ) {
          throw makeError(
            "unavailable",
            "The Diamond event history contains a gap or invalid sequence.",
          );
        }
        events.push(event);
        afterSequence = event.sequence;
      }
      if (boundedSequence !== null && afterSequence === boundedSequence) {
        return events;
      }
      if (documents.length < FULL_HISTORY_PAGE_SIZE) return events;
    }
    throw makeError(
      "resource-exhausted",
      "This game exceeds the bounded Diamond replay limit.",
    );
  }

  function validateCompleteHistory(root, events) {
    const checkpoint = buildCheckpointFromRoot(root);
    if (
      !checkpoint ||
      !root?.initialState ||
      !Number.isSafeInteger(checkpoint.sequence)
    ) {
      throw makeError(
        "failed-precondition",
        "The Diamond checkpoint is malformed.",
      );
    }
    if (events.length !== checkpoint.sequence) {
      throw makeError(
        "unavailable",
        "The Diamond event history is incomplete. Try again.",
      );
    }
    events.forEach((event, index) => {
      if (event.sequence !== index + 1 || event.revision !== index + 1) {
        throw makeError(
          "unavailable",
          "The Diamond event history contains a sequence gap.",
        );
      }
    });
    try {
      const replay = domainEngine.replayDiamondEvents(
        root.initialState,
        events,
      );
      if (replay.checkpointHash !== checkpoint.previousHash) {
        throw new Error("checkpoint hash mismatch");
      }
      return { checkpoint, replay };
    } catch {
      throw makeError(
        "failed-precondition",
        "The Diamond event history failed integrity verification.",
      );
    }
  }

  async function validateScorerTarget(
    transaction,
    { teamId, gameId, targetUid, loaded, disallowUid = null },
  ) {
    const normalizedTargetUid = normalizeId(targetUid, "targetUid");
    if (normalizedTargetUid === domainEngine.DIAMOND_PRIVATE_NOTE_ACTOR_UID) {
      throw makeError(
        "invalid-argument",
        "This scorer identity is reserved by the Diamond ledger.",
      );
    }
    let targetAuth;
    try {
      targetAuth = await auth.getUser(normalizedTargetUid);
    } catch {
      throw makeError(
        "failed-precondition",
        "The requested scorekeeper account is unavailable.",
      );
    }
    if (
      !targetAuth ||
      targetAuth.uid !== normalizedTargetUid ||
      targetAuth.disabled === true
    ) {
      throw makeError(
        "failed-precondition",
        "The requested scorekeeper account is unavailable.",
      );
    }
    const resourcePaths = paths(teamId, gameId);
    const [userSnapshot, rsvpSnapshot] = await Promise.all([
      transaction.get(firestore.doc(resourcePaths.user(normalizedTargetUid))),
      transaction.get(firestore.doc(resourcePaths.rsvp(normalizedTargetUid))),
    ]);
    const targetCaller = {
      uid: normalizedTargetUid,
      authUser: targetAuth,
      email: getAuthoritativeEmail(targetAuth),
    };
    const targetAccess = resolveAccess({
      caller: targetCaller,
      user: snapshotData(userSnapshot) || {},
      teamId,
      team: loaded.team,
      game: loaded.game,
      rsvp: snapshotData(rsvpSnapshot),
    });
    if (!targetAccess.scorekeeping) {
      throw makeError(
        "failed-precondition",
        "The requested scorekeeper does not have current scoring access.",
      );
    }
    if (normalizedTargetUid === disallowUid) {
      throw makeError(
        "invalid-argument",
        "Choose a different scorekeeper for handoff.",
      );
    }
    return normalizedTargetUid;
  }

  async function validateHandoffTarget(transaction, command, loaded, caller) {
    if (command.type !== "scorer_handoff") return null;
    return validateScorerTarget(transaction, {
      teamId: command.teamId,
      gameId: command.gameId,
      targetUid: command.payload.toUid,
      loaded,
      disallowUid: caller.uid,
    });
  }

  function commandHistoryOperationName(command, checkpoint) {
    return RESILIENT_CORRECTION_COMMANDS.has(command.type) ||
      (checkpoint.state?.lifecycle === "correction" &&
        ["record_fielding", "record_scoring_judgment", "finalize"].includes(
          command.type,
        ))
      ? "correct"
      : "score";
  }

  function commandHistorySourceHash(root, checkpoint) {
    return core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-command-history-source",
      scorebookSchemaVersion: root.schemaVersion,
      trackingEngine: root.trackingEngine,
      instanceId: root.instanceId,
      teamId: root.teamId,
      gameId: root.gameId,
      rulesProfileId: root.rulesProfileId,
      rulesProfileVersion: root.rulesProfileVersion,
      captureMode: root.captureMode,
      initialState: root.initialState,
      checkpoint,
      statConfigSnapshot: root.statConfigSnapshot,
      orientationSnapshot: root.orientationSnapshot,
    });
  }

  function commandHistoryAdmissionIdentity(command, callerUid) {
    const scopeHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-command-history-admission-scope",
      callerUid,
      teamId: command.teamId,
      gameId: command.gameId,
    });
    return Object.freeze({
      type: "diamond-command-history-admission",
      scopeHash,
      reference: firestore.doc(
        `${MANAGER_STAT_CONTROL_COLLECTION}/command-admission-${scopeHash.slice(7)}`,
      ),
    });
  }

  function commandHistoryGlobalAdmissionIdentity(callerUid) {
    const scopeHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-command-history-global-admission-scope",
      callerUid,
    });
    return Object.freeze({
      type: "diamond-command-history-global-admission",
      scopeHash,
      reference: firestore.doc(
        `${MANAGER_STAT_CONTROL_COLLECTION}/command-global-admission-${scopeHash.slice(7)}`,
      ),
    });
  }

  function commandHistoryGameAdmissionIdentity(teamId, gameId) {
    const scopeHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-command-history-game-admission-scope",
      teamId,
      gameId,
    });
    return Object.freeze({
      type: "diamond-command-history-game-admission",
      scopeHash,
      reference: firestore.doc(
        `${MANAGER_STAT_CONTROL_COLLECTION}/command-game-admission-${scopeHash.slice(7)}`,
      ),
    });
  }

  function commandHistorySharedAdmissionIdentities(teamId, gameId, callerUid) {
    return Object.freeze([
      commandHistoryGlobalAdmissionIdentity(callerUid),
      commandHistoryGameAdmissionIdentity(teamId, gameId),
    ]);
  }

  function commandHistoryAdmissionIdentities(command, callerUid) {
    return Object.freeze([
      commandHistoryAdmissionIdentity(command, callerUid),
      ...commandHistorySharedAdmissionIdentities(
        command.teamId,
        command.gameId,
        callerUid,
      ),
    ]);
  }

  function privateMaterialCommandHistoryAdmissionIdentities(command) {
    const resourceScopeHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-private-material-command-history-admission-scope",
      teamId: command.teamId,
      gameId: command.gameId,
    });
    const teamScopeHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-private-material-command-history-team-admission-scope",
      teamId: command.teamId,
    });
    return Object.freeze([
      commandHistoryGameAdmissionIdentity(command.teamId, command.gameId),
      Object.freeze({
        type: "diamond-private-material-command-history-admission",
        scopeHash: resourceScopeHash,
        reference: firestore.doc(
          `${MANAGER_STAT_CONTROL_COLLECTION}/private-command-admission-${resourceScopeHash.slice(7)}`,
        ),
      }),
      Object.freeze({
        type: "diamond-private-material-command-history-team-admission",
        scopeHash: teamScopeHash,
        reference: firestore.doc(
          `${MANAGER_STAT_CONTROL_COLLECTION}/private-command-team-admission-${teamScopeHash.slice(7)}`,
        ),
      }),
    ]);
  }

  function invalidCommandHistoryAdmission(snapshot, nowMs) {
    const updatedAtMs = controlSnapshotUpdatedAtMs(snapshot);
    if (
      updatedAtMs !== null &&
      updatedAtMs + COMMAND_HISTORY_CONTROL_QUARANTINE_MS <= nowMs
    ) {
      return null;
    }
    throw makeError(
      "unavailable",
      "Command history safety state is unavailable. Try again later.",
      { reason: "command-history-control-invalid", retryable: true },
    );
  }

  function commandHistoryControlByteLength(value) {
    try {
      return Buffer.byteLength(JSON.stringify(value), "utf8");
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }

  function parseCommandHistoryAdmission(snapshot, identity, nowMs) {
    if (!snapshot?.exists) return null;
    const value = snapshotData(snapshot);
    const legacyKeys = [
      "schemaVersion",
      "type",
      "scopeHash",
      "windowStartedAtMs",
      "windowResetAtMs",
      "requestCount",
      "readUnits",
      "sustainedWindowStartedAtMs",
      "sustainedWindowResetAtMs",
      "sustainedRequestCount",
      "sustainedReadUnits",
      "updatedAtMs",
      "expiresAt",
    ];
    const currentKeys = [
      ...legacyKeys,
      "projectionRequestCount",
      "projectionReadUnits",
      "sustainedProjectionRequestCount",
      "sustainedProjectionReadUnits",
    ];
    const legacy =
      isPlainObject(value) &&
      value.schemaVersion === 1 &&
      Object.keys(value).length === legacyKeys.length &&
      legacyKeys.every((key) => own(value, key));
    const current =
      isPlainObject(value) &&
      value.schemaVersion === 2 &&
      Object.keys(value).length === currentKeys.length &&
      currentKeys.every((key) => own(value, key));
    const expectedExpiresAtMs = Math.max(
      value?.windowResetAtMs || 0,
      value?.sustainedWindowResetAtMs || 0,
    );
    if (
      (!legacy && !current) ||
      value.type !== identity.type ||
      value.scopeHash !== identity.scopeHash ||
      !Number.isSafeInteger(value.windowStartedAtMs) ||
      value.windowStartedAtMs < 0 ||
      value.windowStartedAtMs % COMMAND_HISTORY_RATE_WINDOW_MS !== 0 ||
      !Number.isSafeInteger(value.windowResetAtMs) ||
      value.windowResetAtMs !==
        value.windowStartedAtMs + COMMAND_HISTORY_RATE_WINDOW_MS ||
      !Number.isSafeInteger(value.requestCount) ||
      value.requestCount < (legacy ? 1 : 0) ||
      value.requestCount > MAX_COMMAND_HISTORY_REQUESTS_PER_WINDOW ||
      !Number.isSafeInteger(value.readUnits) ||
      value.readUnits < (value.requestCount > 0 ? value.requestCount : 0) ||
      (value.requestCount === 0 && value.readUnits !== 0) ||
      value.readUnits > value.requestCount * MAX_CANONICAL_EVENTS ||
      value.readUnits > MAX_COMMAND_HISTORY_READ_UNITS_PER_WINDOW ||
      (current &&
        (!Number.isSafeInteger(value.projectionRequestCount) ||
          value.projectionRequestCount < 0 ||
          value.projectionRequestCount >
            MAX_COMMAND_PROJECTION_REQUESTS_PER_WINDOW ||
          !Number.isSafeInteger(value.projectionReadUnits) ||
          value.projectionReadUnits <
            (value.projectionRequestCount > 0
              ? value.projectionRequestCount
              : 0) ||
          (value.projectionRequestCount === 0 &&
            value.projectionReadUnits !== 0) ||
          value.projectionReadUnits >
            value.projectionRequestCount * MAX_CANONICAL_EVENTS ||
          value.projectionReadUnits >
            MAX_COMMAND_PROJECTION_READ_UNITS_PER_WINDOW)) ||
      (current && value.requestCount + value.projectionRequestCount < 1) ||
      !Number.isSafeInteger(value.sustainedWindowStartedAtMs) ||
      value.sustainedWindowStartedAtMs < 0 ||
      value.sustainedWindowStartedAtMs % COMMAND_HISTORY_SUSTAINED_WINDOW_MS !==
        0 ||
      !Number.isSafeInteger(value.sustainedWindowResetAtMs) ||
      value.sustainedWindowResetAtMs !==
        value.sustainedWindowStartedAtMs +
          COMMAND_HISTORY_SUSTAINED_WINDOW_MS ||
      !Number.isSafeInteger(value.sustainedRequestCount) ||
      value.sustainedRequestCount < value.requestCount ||
      value.sustainedRequestCount >
        MAX_COMMAND_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW ||
      !Number.isSafeInteger(value.sustainedReadUnits) ||
      value.sustainedReadUnits < value.readUnits ||
      value.sustainedReadUnits <
        (value.sustainedRequestCount > 0 ? value.sustainedRequestCount : 0) ||
      (value.sustainedRequestCount === 0 && value.sustainedReadUnits !== 0) ||
      value.sustainedReadUnits >
        value.sustainedRequestCount * MAX_CANONICAL_EVENTS ||
      value.sustainedReadUnits >
        MAX_COMMAND_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW ||
      (current &&
        (!Number.isSafeInteger(value.sustainedProjectionRequestCount) ||
          value.sustainedProjectionRequestCount <
            value.projectionRequestCount ||
          value.sustainedProjectionRequestCount >
            MAX_COMMAND_PROJECTION_SUSTAINED_REQUESTS_PER_WINDOW ||
          !Number.isSafeInteger(value.sustainedProjectionReadUnits) ||
          value.sustainedProjectionReadUnits < value.projectionReadUnits ||
          value.sustainedProjectionReadUnits <
            (value.sustainedProjectionRequestCount > 0
              ? value.sustainedProjectionRequestCount
              : 0) ||
          (value.sustainedProjectionRequestCount === 0 &&
            value.sustainedProjectionReadUnits !== 0) ||
          value.sustainedProjectionReadUnits >
            value.sustainedProjectionRequestCount * MAX_CANONICAL_EVENTS ||
          value.sustainedProjectionReadUnits >
            MAX_COMMAND_PROJECTION_SUSTAINED_READ_UNITS_PER_WINDOW)) ||
      (current &&
        value.sustainedRequestCount + value.sustainedProjectionRequestCount <
          1) ||
      value.windowStartedAtMs < value.sustainedWindowStartedAtMs ||
      value.windowResetAtMs > value.sustainedWindowResetAtMs ||
      !Number.isSafeInteger(value.updatedAtMs) ||
      value.updatedAtMs < value.windowStartedAtMs ||
      value.updatedAtMs < value.sustainedWindowStartedAtMs ||
      value.updatedAtMs >= value.windowResetAtMs ||
      value.updatedAtMs >= value.sustainedWindowResetAtMs ||
      value.updatedAtMs > nowMs ||
      managerStatsControlTimestampMs(value.expiresAt) !== expectedExpiresAtMs ||
      (current &&
        commandHistoryControlByteLength(value) >
          MAX_COMMAND_HISTORY_CONTROL_BYTES)
    ) {
      return invalidCommandHistoryAdmission(snapshot, nowMs);
    }
    return {
      ...value,
      projectionRequestCount: current ? value.projectionRequestCount : 0,
      projectionReadUnits: current ? value.projectionReadUnits : 0,
      sustainedProjectionRequestCount: current
        ? value.sustainedProjectionRequestCount
        : 0,
      sustainedProjectionReadUnits: current
        ? value.sustainedProjectionReadUnits
        : 0,
    };
  }

  function commandHistoryRetryDetails(retryAtMs, nowMs) {
    return {
      reason: "command-history-rate-limited",
      retryable: true,
      retryAfterMs: Math.max(1, retryAtMs - nowMs),
    };
  }

  function requireCanonicalEventCapacity(checkpoint) {
    if (checkpoint.sequence < MAX_CANONICAL_EVENTS) return;
    throw makeError(
      "resource-exhausted",
      "The Diamond event history exceeds the bounded replay limit.",
      {
        reason: "command-history-replay-bound-exceeded",
        retryable: false,
        maximumEvents: MAX_CANONICAL_EVENTS,
      },
    );
  }

  function alignedCommandHistoryWindowStart(nowMs, durationMs) {
    return Math.floor(nowMs / durationMs) * durationMs;
  }

  function planCommandHistoryAdmission({
    snapshot,
    identity,
    requestedHistoryReadUnits = 0,
    requestedProjectionReadUnits = 0,
    nowMs,
  }) {
    if (
      !Number.isSafeInteger(requestedHistoryReadUnits) ||
      requestedHistoryReadUnits < 0 ||
      requestedHistoryReadUnits > MAX_CANONICAL_EVENTS ||
      !Number.isSafeInteger(requestedProjectionReadUnits) ||
      requestedProjectionReadUnits < 0 ||
      requestedProjectionReadUnits > MAX_CANONICAL_EVENTS ||
      requestedHistoryReadUnits + requestedProjectionReadUnits < 1
    ) {
      throw makeError(
        "unavailable",
        "Diamond command work could not be bounded safely.",
        { reason: "command-history-work-invalid", retryable: true },
      );
    }
    const admission = parseCommandHistoryAdmission(snapshot, identity, nowMs);
    const windowActive = Boolean(
      admission && admission.windowResetAtMs > nowMs,
    );
    const sustainedWindowActive = Boolean(
      admission && admission.sustainedWindowResetAtMs > nowMs,
    );
    const windowStartedAtMs = windowActive
      ? admission.windowStartedAtMs
      : alignedCommandHistoryWindowStart(nowMs, COMMAND_HISTORY_RATE_WINDOW_MS);
    const windowResetAtMs = windowActive
      ? admission.windowResetAtMs
      : windowStartedAtMs + COMMAND_HISTORY_RATE_WINDOW_MS;
    const requestCount =
      (windowActive ? admission.requestCount : 0) +
      (requestedHistoryReadUnits > 0 ? 1 : 0);
    const readUnits =
      (windowActive ? admission.readUnits : 0) + requestedHistoryReadUnits;
    const projectionRequestCount =
      (windowActive ? admission.projectionRequestCount : 0) +
      (requestedProjectionReadUnits > 0 ? 1 : 0);
    const projectionReadUnits =
      (windowActive ? admission.projectionReadUnits : 0) +
      requestedProjectionReadUnits;
    const sustainedWindowStartedAtMs = sustainedWindowActive
      ? admission.sustainedWindowStartedAtMs
      : alignedCommandHistoryWindowStart(
          nowMs,
          COMMAND_HISTORY_SUSTAINED_WINDOW_MS,
        );
    const sustainedWindowResetAtMs = sustainedWindowActive
      ? admission.sustainedWindowResetAtMs
      : sustainedWindowStartedAtMs + COMMAND_HISTORY_SUSTAINED_WINDOW_MS;
    const sustainedRequestCount =
      (sustainedWindowActive ? admission.sustainedRequestCount : 0) +
      (requestedHistoryReadUnits > 0 ? 1 : 0);
    const sustainedReadUnits =
      (sustainedWindowActive ? admission.sustainedReadUnits : 0) +
      requestedHistoryReadUnits;
    const sustainedProjectionRequestCount =
      (sustainedWindowActive ? admission.sustainedProjectionRequestCount : 0) +
      (requestedProjectionReadUnits > 0 ? 1 : 0);
    const sustainedProjectionReadUnits =
      (sustainedWindowActive ? admission.sustainedProjectionReadUnits : 0) +
      requestedProjectionReadUnits;
    const historyBurstLimited =
      requestCount > MAX_COMMAND_HISTORY_REQUESTS_PER_WINDOW ||
      readUnits > MAX_COMMAND_HISTORY_READ_UNITS_PER_WINDOW;
    const historySustainedLimited =
      sustainedRequestCount >
        MAX_COMMAND_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW ||
      sustainedReadUnits > MAX_COMMAND_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW;
    const projectionBurstLimited =
      projectionRequestCount > MAX_COMMAND_PROJECTION_REQUESTS_PER_WINDOW ||
      projectionReadUnits > MAX_COMMAND_PROJECTION_READ_UNITS_PER_WINDOW;
    const projectionSustainedLimited =
      sustainedProjectionRequestCount >
        MAX_COMMAND_PROJECTION_SUSTAINED_REQUESTS_PER_WINDOW ||
      sustainedProjectionReadUnits >
        MAX_COMMAND_PROJECTION_SUSTAINED_READ_UNITS_PER_WINDOW;
    if (
      historyBurstLimited ||
      historySustainedLimited ||
      projectionBurstLimited ||
      projectionSustainedLimited
    ) {
      throw makeError(
        "resource-exhausted",
        "Diamond command replay work is temporarily limited.",
        commandHistoryRetryDetails(
          Math.max(
            historyBurstLimited || projectionBurstLimited ? windowResetAtMs : 0,
            historySustainedLimited || projectionSustainedLimited
              ? sustainedWindowResetAtMs
              : 0,
          ),
          nowMs,
        ),
      );
    }
    const value = {
      schemaVersion: 2,
      type: identity.type,
      scopeHash: identity.scopeHash,
      windowStartedAtMs,
      windowResetAtMs,
      requestCount,
      readUnits,
      projectionRequestCount,
      projectionReadUnits,
      sustainedWindowStartedAtMs,
      sustainedWindowResetAtMs,
      sustainedRequestCount,
      sustainedReadUnits,
      sustainedProjectionRequestCount,
      sustainedProjectionReadUnits,
      updatedAtMs: nowMs,
      expiresAt: new Date(Math.max(windowResetAtMs, sustainedWindowResetAtMs)),
    };
    if (
      commandHistoryControlByteLength(value) > MAX_COMMAND_HISTORY_CONTROL_BYTES
    ) {
      throw makeError(
        "unavailable",
        "Diamond command safety state exceeded its bounded size.",
        { reason: "command-history-control-overflow", retryable: true },
      );
    }
    return value;
  }

  async function planCommandHistoryWork(
    transaction,
    identities,
    { requestedHistoryReadUnits = 0, requestedProjectionReadUnits = 0, nowMs },
  ) {
    const snapshots = await Promise.all(
      identities.map((identity) => transaction.get(identity.reference)),
    );
    return identities.map((identity, index) => ({
      identity,
      value: planCommandHistoryAdmission({
        snapshot: snapshots[index],
        identity,
        requestedHistoryReadUnits,
        requestedProjectionReadUnits,
        nowMs,
      }),
    }));
  }

  function writeCommandHistoryWork(transaction, admissions) {
    admissions.forEach(({ identity, value }) =>
      transaction.set(identity.reference, value),
    );
  }

  function earlyRejectedCommandResponse(
    command,
    checkpoint,
    loaded,
    root,
    caller,
    nowMs,
    privateMaterialTargetVerified = false,
  ) {
    const execution = domainEngine.executeDiamondCommandFromCheckpoint(
      checkpoint,
      command,
      {
        actorUid: caller.uid,
        eventId: command.commandId,
        serverTimestampMs: nowMs,
        managerAuthorized: loaded.access.full,
      },
      null,
      privateMaterialTargetVerified,
    );
    if (
      execution.result.outcome !== "rejected" ||
      execution.result.rejection?.code !== "stale-revision"
    ) {
      throw makeError(
        "failed-precondition",
        "The Diamond checkpoint could not safely reject this stale command.",
      );
    }
    return rejectedExecutionResponse(execution, {
      root,
      team: loaded.team,
      game: loaded.game,
      callerUid: caller.uid,
      canScore: loaded.access.scorekeeping,
      canManage: loaded.access.full,
      nowMs,
    });
  }

  function requireCurrentCommandHistoryAuthority({
    command,
    checkpoint,
    caller,
    policy,
    team,
    game,
    root,
    nowMs,
    privateMaterialCommand = false,
  }) {
    if (!isActiveTeam(team)) {
      throw makeError(
        "failed-precondition",
        "Inactive teams cannot submit Diamond commands.",
      );
    }
    requireAllowed(
      core.decideDiamondOperation({
        operation: commandHistoryOperationName(command, checkpoint),
        policy,
        teamId: command.teamId,
        appBuild: command.appBuild,
        game,
      }),
      "Diamond scoring is disabled.",
    );
    if (!privateMaterialCommand) {
      requireAllowed(
        core.decideDiamondScorerLease({
          operation: "score",
          lease: root.scorerLease,
          actorUid: caller.uid,
          presentedLeaseId: command.leaseId || null,
          nowMillis: nowMs,
        }),
        "Acquire the current scorer lease before submitting this command.",
      );
    }
  }

  function privateMaterialClassification({
    command,
    targetEvent,
    root,
    checkpoint,
  }) {
    const correction =
      command.type === "void_event" || command.type === "supersede_event";
    const targetPrivateMaterial = Boolean(
      correction &&
        targetEvent &&
        targetEvent.instanceId === root.instanceId &&
        targetEvent.eventId === command.payload.targetEventId &&
        Number.isSafeInteger(targetEvent.sequence) &&
        targetEvent.sequence >= 1 &&
        targetEvent.sequence <= checkpoint.sequence &&
        targetEvent.revision === targetEvent.sequence &&
        privateNoteCore.isCanonicalPrivateNoteMaterialEvent(
          targetEvent,
          domainEngine,
        ),
    );
    return Object.freeze({
      privateMaterialCommand:
        domainEngine.getDiamondPrivateNoteText(command) !== null ||
        targetPrivateMaterial,
      targetPrivateMaterial,
    });
  }

  function requireCurrentCommandHistorySource(
    root,
    checkpoint,
    admission,
    callerUid,
  ) {
    if (
      admission.callerUid !== callerUid ||
      commandHistorySourceHash(root, checkpoint) !== admission.sourceHash
    ) {
      throw makeError(
        "aborted",
        "The scorebook changed while the command history was being verified.",
        { reason: "command-history-source-changed", retryable: true },
      );
    }
  }

  function requireCurrentCommandHistoryReceipt({
    root,
    checkpoint,
    receipt,
    admission,
    command,
    callerUid,
  }) {
    let exactHead = false;
    try {
      const privateNote = privateNoteCore.isCanonicalPrivateNoteMaterialEvent(
        receipt?.event,
        domainEngine,
      );
      const stateHash = (state) =>
        core.hashDiamondValue(
          privateNote && state?.currentScorerUid
            ? {
                ...state,
                currentScorerUid: domainEngine.DIAMOND_PRIVATE_NOTE_ACTOR_UID,
              }
            : state,
        );
      exactHead =
        admission.callerUid === callerUid &&
        commandHistorySourceHash(root, admission.checkpoint) ===
          admission.sourceHash &&
        receipt.instanceId === root.instanceId &&
        receipt.commandId === command.commandId &&
        receipt.event?.sequence === admission.checkpoint.sequence + 1 &&
        receipt.event?.revision === receipt.event?.sequence &&
        receipt.event?.previousHash === admission.checkpoint.previousHash &&
        core.hashDiamondValue(receipt.event?.before) ===
          stateHash(admission.checkpoint.state) &&
        checkpoint.sequence === receipt.result?.revision &&
        checkpoint.previousHash === receipt.event?.hash &&
        stateHash(checkpoint.state) ===
          core.hashDiamondValue(receipt.result?.state);
    } catch {
      exactHead = false;
    }
    if (!exactHead) {
      throw makeError(
        "unavailable",
        "The committed Diamond command head could not be verified. Retry the same command.",
        {
          reason: "command-history-receipt-head-mismatch",
          retryable: true,
        },
      );
    }
  }

  function requireCommandHistoryReceiptOutcome(execution) {
    if (
      execution.result.outcome === "duplicate" ||
      (execution.result.outcome === "rejected" &&
        execution.result.rejection?.code === "idempotency-conflict")
    ) {
      return;
    }
    throw makeError(
      "unavailable",
      "The committed Diamond command receipt could not be verified. Retry the same command.",
      { reason: "command-history-receipt-invalid", retryable: true },
    );
  }

  async function submitDiamondCommand(data = {}, context = {}) {
    let command;
    try {
      command = core.normalizeDiamondCommand(data);
    } catch (error) {
      throw makeError("invalid-argument", error.message);
    }
    if (command.type === "activate") {
      throw makeError(
        "failed-precondition",
        "Use activateDiamondGame for the initial Diamond activation.",
      );
    }
    let caller = await loadEnabledAuthUser(context);
    const resourcePaths = paths(command.teamId, command.gameId);
    let writeNowMs = null;
    let newEventId = null;
    const getWriteNowMs = () => {
      if (writeNowMs === null) writeNowMs = normalizeNow(clock, makeError);
      return writeNowMs;
    };
    const getNewEventId = () => {
      if (newEventId === null)
        newEventId = secureUuid(random, makeError, "canonical event");
      return newEventId;
    };
    const fullReplayCommand = FULL_REPLAY_COMMANDS.has(command.type);
    const mayStorePrivateNoteMaterial =
      domainEngine.getDiamondPrivateNoteText(command) !== null ||
      command.type === "void_event" ||
      command.type === "supersede_event";
    const ordinaryAdmissionIdentities = commandHistoryAdmissionIdentities(
      command,
      caller.uid,
    );
    const privateMaterialAdmissionIdentities =
      privateMaterialCommandHistoryAdmissionIdentities(command);
    let commandHistoryAdmission = null;
    let needsFullHistory = false;
    let preparedHistory = null;
    let privateMaterialCommand =
      domainEngine.getDiamondPrivateNoteText(command) !== null;
    let targetPrivateMaterial = false;
    let admissionIdentities = privateMaterialCommand
      ? privateMaterialAdmissionIdentities
      : ordinaryAdmissionIdentities;
    if (fullReplayCommand) {
      let admissionCallbackCount = 0;
      let admission;
      try {
        admission = await firestore.runTransaction(
          async (transaction) => {
            caller = await loadEnabledAuthUser(context);
            admissionCallbackCount += 1;
            if (admissionCallbackCount > 1) {
              throw makeError(
                "unavailable",
                "Command history admission could not be confirmed. Retry the command.",
                {
                  reason: "command-history-admission-retried",
                  retryable: true,
                },
              );
            }
            const nowMs = normalizeNow(clock, makeError);
            const rootRef = firestore.doc(resourcePaths.scorebook);
            const receiptRef = firestore.doc(
              resourcePaths.command(command.commandId),
            );
            const targetEventRef =
              command.type === "void_event" ||
              command.type === "supersede_event"
                ? firestore.doc(
                    resourcePaths.event(command.payload.targetEventId),
                  )
                : null;
            const [
              loaded,
              rootSnapshot,
              receiptSnapshot,
              deletionRequestSnapshot,
              targetEventSnapshot,
            ] = await Promise.all([
              loadAccessDocuments(
                transaction,
                command.teamId,
                command.gameId,
                caller,
              ),
              transaction.get(rootRef),
              transaction.get(receiptRef),
              mayStorePrivateNoteMaterial
                ? transaction.get(
                    firestore.doc(
                      resourcePaths.accountDeletionRequest(caller.uid),
                    ),
                  )
                : Promise.resolve(null),
              targetEventRef
                ? transaction.get(targetEventRef)
                : Promise.resolve(null),
            ]);
            requireScorekeeper(loaded.access);
            if (mayStorePrivateNoteMaterial) {
              requireNoAccountDeletion(deletionRequestSnapshot);
            }
            const root = snapshotData(rootSnapshot);
            if (!root)
              throw makeError("not-found", "Diamond scorebook not found.");
            requirePrivateNoteStorageVersion(root);
            if (root.instanceId !== loaded.game.diamondScorebookInstanceId) {
              throw makeError(
                "failed-precondition",
                "The Diamond scorebook generation does not match the game.",
              );
            }
            validateCommittedOrientationSnapshot(root, command.teamId);
            if (root.instanceId !== command.expectedInstanceId) {
              throw makeError(
                "aborted",
                "The Diamond game instance changed. Reload before submitting this command.",
                { reason: "stale-instance" },
              );
            }
            const checkpoint = buildCheckpointFromRoot(root);
            if (!checkpoint) {
              throw makeError(
                "failed-precondition",
                "The Diamond checkpoint is unavailable.",
              );
            }
            if (snapshotData(receiptSnapshot)) {
              return Object.freeze({ kind: "receipt" });
            }
            const privacy = privateMaterialClassification({
              command,
              targetEvent: snapshotData(targetEventSnapshot),
              root,
              checkpoint,
            });
            const policy = await readPolicy(transaction);
            requireCurrentCommandHistoryAuthority({
              command,
              checkpoint,
              caller,
              policy,
              team: loaded.team,
              game: loaded.game,
              root,
              nowMs,
              privateMaterialCommand: privacy.privateMaterialCommand,
            });
            if (checkpoint.sequence !== command.expectedRevision) {
              return Object.freeze({
                kind: "rejected",
                response: earlyRejectedCommandResponse(
                  command,
                  checkpoint,
                  loaded,
                  root,
                  caller,
                  nowMs,
                  privacy.targetPrivateMaterial,
                ),
              });
            }
            requireCanonicalEventCapacity(checkpoint);
            const requestedReadUnits = Math.max(1, checkpoint.sequence);
            const selectedAdmissionIdentities = privacy.privateMaterialCommand
              ? privateMaterialAdmissionIdentities
              : ordinaryAdmissionIdentities;
            const admissionWrites = await planCommandHistoryWork(
              transaction,
              selectedAdmissionIdentities,
              {
                requestedHistoryReadUnits: requestedReadUnits,
                nowMs,
              },
            );
            writeCommandHistoryWork(transaction, admissionWrites);
            return Object.freeze({
              kind: "admitted",
              callerUid: caller.uid,
              root,
              checkpoint,
              sourceHash: commandHistorySourceHash(root, checkpoint),
              requestedReadUnits,
              privateMaterialCommand: privacy.privateMaterialCommand,
              targetPrivateMaterial: privacy.targetPrivateMaterial,
            });
          },
          { maxAttempts: 1 },
        );
      } catch (error) {
        if (
          error instanceof HttpsError ||
          error instanceof DiamondHandlerError
        ) {
          throw error;
        }
        throw makeError(
          "unavailable",
          "Command history admission could not be confirmed. Retry the command.",
          { reason: "command-history-admission-unconfirmed", retryable: true },
        );
      }
      if (admission.kind === "rejected") return admission.response;
      if (admission.kind === "admitted") {
        commandHistoryAdmission = admission;
        needsFullHistory = true;
        privateMaterialCommand = admission.privateMaterialCommand;
        targetPrivateMaterial = admission.targetPrivateMaterial;
        admissionIdentities = privateMaterialCommand
          ? privateMaterialAdmissionIdentities
          : ordinaryAdmissionIdentities;
      }
    }
    if (needsFullHistory) {
      const events = await loadAllCanonicalEvents(
        command.teamId,
        command.gameId,
        commandHistoryAdmission.checkpoint.sequence,
      );
      const validated = validateCompleteHistory(
        commandHistoryAdmission.root,
        events,
      );
      if (
        core.hashDiamondValue(validated.replay.state) !==
        core.hashDiamondValue(commandHistoryAdmission.checkpoint.state)
      ) {
        throw makeError(
          "failed-precondition",
          "The Diamond checkpoint state does not match its canonical history.",
          { reason: "command-history-checkpoint-state-mismatch" },
        );
      }
      preparedHistory = {
        root: commandHistoryAdmission.root,
        events,
        checkpoint: validated.checkpoint,
      };
      const verifiedPrivacy = privateMaterialClassification({
        command,
        targetEvent:
          command.type === "void_event" ||
          command.type === "supersede_event"
            ? events.find(
                (event) => event.eventId === command.payload.targetEventId,
              )
            : null,
        root: commandHistoryAdmission.root,
        checkpoint: validated.checkpoint,
      });
      if (
        verifiedPrivacy.privateMaterialCommand !== privateMaterialCommand ||
        verifiedPrivacy.targetPrivateMaterial !== targetPrivateMaterial
      ) {
        throw makeError(
          "failed-precondition",
          "The Diamond correction privacy classification changed while loading history.",
          { reason: "command-history-private-target-mismatch" },
        );
      }
    }

    return firestore.runTransaction(async (transaction) => {
      if (fullReplayCommand) caller = await loadEnabledAuthUser(context);
      const policy = await readPolicy(transaction);
      const loaded = await loadAccessDocuments(
        transaction,
        command.teamId,
        command.gameId,
        caller,
      );
      if (command.type === "cancel") {
        requireManager(
          loaded.access,
          "Only a current team manager can cancel this Diamond game.",
        );
      } else {
        requireScorekeeper(loaded.access);
      }
      const rootRef = firestore.doc(resourcePaths.scorebook);
      const receiptRef = firestore.doc(
        resourcePaths.command(command.commandId),
      );
      const [rootSnapshot, receiptSnapshot, deletionRequestSnapshot] =
        await Promise.all([
        transaction.get(rootRef),
        transaction.get(receiptRef),
          mayStorePrivateNoteMaterial
            ? transaction.get(
                firestore.doc(
                  resourcePaths.accountDeletionRequest(caller.uid),
                ),
              )
            : Promise.resolve(null),
        ]);
      const root = snapshotData(rootSnapshot);
      const existingReceipt = snapshotData(receiptSnapshot);
      if (mayStorePrivateNoteMaterial)
        requireNoAccountDeletion(deletionRequestSnapshot);
      if (!root) throw makeError("not-found", "Diamond scorebook not found.");
      requirePrivateNoteStorageVersion(root);
      if (root.instanceId !== loaded.game.diamondScorebookInstanceId) {
        throw makeError(
          "failed-precondition",
          "The Diamond scorebook generation does not match the game.",
        );
      }
      validateCommittedOrientationSnapshot(root, command.teamId);
      if (root.instanceId !== command.expectedInstanceId) {
        throw makeError(
          "aborted",
          "The Diamond game instance changed. Reload before submitting this command.",
          {
            reason: "stale-instance",
            authoritativeRevision: Number.isSafeInteger(
              root.checkpoint?.sequence,
            )
              ? root.checkpoint.sequence
              : null,
          },
        );
      }
      const checkpoint = buildCheckpointFromRoot(root);
      if (!checkpoint)
        throw makeError(
          "failed-precondition",
          "The Diamond checkpoint is unavailable.",
        );
      if (existingReceipt) {
        if (
          privateNoteCore.isCanonicalPrivateNoteMaterialEvent(
            existingReceipt.event,
            domainEngine,
          )
        ) {
          const eventId = existingReceipt.event?.eventId;
          if (typeof eventId !== "string") {
            throw makeError(
              "unavailable",
              "The private-note receipt is malformed.",
              { reason: "private-note-receipt-malformed", retryable: true },
            );
          }
          const noteSnapshot = await transaction.get(
            firestore.doc(resourcePaths.note(eventId)),
          );
          requirePrivateNoteReceipt({
            command,
            receipt: existingReceipt,
            noteSnapshot,
            instanceId: root.instanceId,
            callerUid: caller.uid,
          });
        }
        const responseNowMs = commandHistoryAdmission
          ? normalizeNow(clock, makeError)
          : getWriteNowMs();
        if (commandHistoryAdmission) {
          requireCurrentCommandHistoryAuthority({
            command,
            checkpoint: commandHistoryAdmission.checkpoint,
            caller,
            policy,
            team: loaded.team,
            game: loaded.game,
            root,
            nowMs: responseNowMs,
            privateMaterialCommand,
          });
          requireCurrentCommandHistoryReceipt({
            root,
            checkpoint,
            receipt: existingReceipt,
            admission: commandHistoryAdmission,
            command,
            callerUid: caller.uid,
          });
        }
        const duplicateExecution =
          domainEngine.executeDiamondCommandFromCheckpoint(
            checkpoint,
            command,
            {
              actorUid: caller.uid,
              eventId: existingReceipt.event?.eventId || command.commandId,
              serverTimestampMs: existingReceipt.event?.serverTimestampMs || 0,
              managerAuthorized: loaded.access.full,
            },
            existingReceipt,
          );
        if (commandHistoryAdmission) {
          requireCommandHistoryReceiptOutcome(duplicateExecution);
        }
        if (duplicateExecution.result.outcome === "rejected") {
          return rejectedExecutionResponse(duplicateExecution, {
            root,
            team: loaded.team,
            game: loaded.game,
            callerUid: caller.uid,
            canScore: loaded.access.scorekeeping,
            canManage: loaded.access.full,
            nowMs: responseNowMs,
          });
        }
        return acceptedExecutionResponse(duplicateExecution, {
          root,
          team: loaded.team,
          game: loaded.game,
          callerUid: caller.uid,
          canScore: loaded.access.scorekeeping,
          canManage: loaded.access.full,
          nowMs: responseNowMs,
        });
      }
      if (checkpoint.sequence === command.expectedRevision) {
        requireCanonicalEventCapacity(checkpoint);
      }
      if (!isActiveTeam(loaded.team)) {
        throw makeError(
          "failed-precondition",
          "Inactive teams cannot submit Diamond commands.",
        );
      }
      const operationName = commandHistoryAdmission
        ? commandHistoryOperationName(
            command,
            commandHistoryAdmission.checkpoint,
          )
        : command.type === "cancel" ||
            RESILIENT_CORRECTION_COMMANDS.has(command.type) ||
            (checkpoint.state?.lifecycle === "correction" &&
              [
                "record_fielding",
                "record_scoring_judgment",
                "finalize",
              ].includes(command.type))
          ? "correct"
          : "score";
      requireAllowed(
        core.decideDiamondOperation({
          operation: operationName,
          policy,
          teamId: command.teamId,
          appBuild: command.appBuild,
          game: loaded.game,
        }),
        "Diamond scoring is disabled.",
      );
      const nowMs = commandHistoryAdmission
        ? normalizeNow(clock, makeError)
        : getWriteNowMs();
      let nextScorerLease = null;
      if (privateMaterialCommand) {
        nextScorerLease = root.scorerLease;
      } else if (command.type !== "cancel") {
        const leaseOperation =
          command.type === "scorer_handoff" ? "handoff" : "score";
        const leaseDecision = core.decideDiamondScorerLease({
          operation: leaseOperation,
          lease: root.scorerLease,
          actorUid: caller.uid,
          presentedLeaseId: command.leaseId || null,
          targetUid:
            command.type === "scorer_handoff" ? command.payload.toUid : null,
          replacementLeaseId:
            command.type === "scorer_handoff" ? command.commandId : null,
          nowMillis: nowMs,
        });
        requireAllowed(
          leaseDecision,
          "Acquire the current scorer lease before submitting this command.",
        );
        await validateHandoffTarget(transaction, command, loaded, caller);
        const decidedLease =
          leaseOperation === "handoff"
            ? leaseDecision.nextLease
            : leaseDecision.lease;
        nextScorerLease = {
          ...decidedLease,
          expiresAtMillis: nowMs + SCORER_LEASE_DURATION_MS,
          ...(leaseOperation === "handoff"
            ? { acquiredAt: timestampIso(nowMs) }
            : {}),
          renewedAt: timestampIso(nowMs),
        };
      }

      if (commandHistoryAdmission) {
        requireCurrentCommandHistorySource(
          root,
          checkpoint,
          commandHistoryAdmission,
          caller.uid,
        );
      }

      let execution;
      const eventId = getNewEventId();
      if (needsFullHistory) {
        if (!preparedHistory) {
          throw makeError(
            "unavailable",
            "The verified Diamond event history is unavailable. Retry the command.",
            { reason: "command-history-missing", retryable: true },
          );
        }
        const ledger = {
          teamId: command.teamId,
          gameId: command.gameId,
          rulesProfileId: preparedHistory.root.rulesProfileId,
          rulesProfileVersion: preparedHistory.root.rulesProfileVersion,
          captureMode: preparedHistory.root.captureMode,
          initialState: preparedHistory.root.initialState,
          state: preparedHistory.checkpoint.state,
          events: preparedHistory.events,
        };
        execution = domainEngine.executeDiamondCommand(ledger, command, {
          actorUid: caller.uid,
          eventId,
          serverTimestampMs: nowMs,
          managerAuthorized: loaded.access.full,
        });
        if (execution.result.outcome === "accepted") {
          execution = {
            ...execution,
            checkpoint: domainEngine.createDiamondCheckpoint(execution.ledger),
            receipt: domainEngine.createDiamondCommandReceipt(
              command,
              execution.event,
              execution.result,
            ),
          };
        }
      } else {
        execution = domainEngine.executeDiamondCommandFromCheckpoint(
          checkpoint,
          command,
          {
            actorUid: caller.uid,
            eventId,
            serverTimestampMs: nowMs,
            managerAuthorized: loaded.access.full,
          },
          null,
        );
      }

      if (execution.result.outcome === "rejected") {
        return rejectedExecutionResponse(execution, {
          root,
          team: loaded.team,
          game: loaded.game,
          callerUid: caller.uid,
          canScore: loaded.access.scorekeeping,
          canManage: loaded.access.full,
          nowMs,
        });
      }
      const nextCheckpoint =
        execution.checkpoint || execution.checkpoint === null
          ? execution.checkpoint
          : null;
      const resolvedCheckpoint = nextCheckpoint || {
        ...checkpoint,
        sequence: execution.result.revision,
        previousHash: execution.event.hash,
        state: execution.result.state,
      };
      const receipt =
        execution.receipt ||
        domainEngine.createDiamondCommandReceipt(
          command,
          execution.event,
          execution.result,
        );
      const admissionWrites = await planCommandHistoryWork(
        transaction,
        admissionIdentities,
        {
          requestedProjectionReadUnits: resolvedCheckpoint.sequence,
          nowMs,
        },
      );
      const suppressPublicEvent =
        privateNoteCore.isCanonicalPrivateNoteMaterialEvent(
          execution.event,
          domainEngine,
        );
      const publicSourceEvent =
        suppressPublicEvent &&
        execution.event.type === "supersede_event" &&
        execution.event.payload?.replacement?.type !== "private_note"
          ? (() => {
              return {
                ...execution.event,
                type: execution.event.payload.replacement.type,
                payload: execution.event.payload.replacement.payload,
                supersedesEventId: undefined,
              };
            })()
          : suppressPublicEvent &&
              execution.event.type === "supersede_event" &&
              execution.event.payload?.replacement?.type === "private_note" &&
              !targetPrivateMaterial
            ? {
                ...execution.event,
                type: "void_event",
                payload: {
                  targetEventId: execution.event.payload.targetEventId,
                  reason:
                    domainEngine.DIAMOND_PRIVATE_NOTE_REASON_TOMBSTONE,
                },
                voidsEventId: execution.event.payload.targetEventId,
                supersedesEventId: undefined,
              }
          : suppressPublicEvent
            ? null
            : execution.event;
      const recentPublicEvents = updateRecentPlays(
        root.recentPublicEvents,
        publicSourceEvent,
        core,
      );
      const nextRoot = {
        ...root,
        checkpoint: resolvedCheckpoint,
        recentPublicEvents,
        projectionStatus: "pending",
        scorerLease: nextScorerLease,
        updatedAt: timestampIso(nowMs),
        lastCommandType: command.type,
      };
      const publicProjection = buildPublicProjection({
        state: execution.result.state,
        root: nextRoot,
        team: loaded.team,
        game: loaded.game,
        nowMs,
        core,
      });
      const publicEvent = buildPublicEvent(
        publicSourceEvent,
        core,
      );
      const publicStateRef = firestore.doc(resourcePaths.publicState);
      const publicStateSnapshot = await transaction.get(publicStateRef);
      const existingPublicState = snapshotData(publicStateSnapshot) || {};
      writeCommandHistoryWork(transaction, admissionWrites);
      transaction.create(
        firestore.doc(resourcePaths.event(execution.event.eventId)),
        {
          ...execution.event,
          instanceId: root.instanceId,
        },
      );
      transaction.create(receiptRef, {
        ...receipt,
        instanceId: root.instanceId,
        acceptedAt: timestampIso(nowMs),
      });
      if (
        privateNoteCore.isCanonicalPrivateNoteMaterialEvent(
          execution.event,
          domainEngine,
        )
      ) {
        transaction.create(
          firestore.doc(resourcePaths.note(execution.event.eventId)),
          privateNoteCore.buildDiamondPrivateNoteRecord({
            command,
            event: execution.event,
            instanceId: root.instanceId,
            authorUid: caller.uid,
            createdAt: timestampIso(nowMs),
            domainEngine,
          }),
        );
      }
      transaction.update(rootRef, {
        checkpoint: resolvedCheckpoint,
        recentPublicEvents,
        projectionStatus: "pending",
        scorerLease: nextScorerLease,
        updatedAt: timestampIso(nowMs),
        lastCommandType: command.type,
      });
      transaction.set(publicStateRef, {
        ...publicProjection,
        instanceId: root.instanceId,
        publicEventCount:
          Number(existingPublicState.publicEventCount || 0) +
          (publicEvent ? 1 : 0),
      });
      if (publicEvent) {
        transaction.create(
          firestore.doc(resourcePaths.publicEvent(execution.event.eventId)),
          {
            ...publicEvent,
            instanceId: root.instanceId,
          },
        );
      }
      transaction.set(
        firestore.doc(resourcePaths.projection("stats")),
        {
          schemaVersion: 1,
          instanceId: root.instanceId,
          status: "pending",
          sourceRevision: execution.result.revision,
          updatedAt: timestampIso(nowMs),
          reason: "incremental-stat-projector-unavailable",
        },
        { merge: true },
      );
      transaction.update(
        loaded.gameRef,
        gameProjectionPatch(execution.result.state),
      );
      const notification = core.decideDiamondNotification({
        commandOutcome: execution.result.outcome,
        eventType: command.type,
        source: "live-command",
        isPublic: Boolean(publicEvent),
        revision: execution.result.revision,
        lastNotifiedRevision: Number(root.lastNotifiedRevision || 0),
        explicitlySuppressed: command.type === "private_note",
      });
      return {
        ...acceptedExecutionResponse(execution, {
          root: nextRoot,
          team: loaded.team,
          game: loaded.game,
          callerUid: caller.uid,
          canScore: loaded.access.scorekeeping,
          canManage: loaded.access.full,
          nowMs,
        }),
        notification,
      };
    });
  }

  async function loadAuthorizedHistoryState(
    teamId,
    gameId,
    caller,
    reader = firestore,
  ) {
    let loaded;
    let rootSnapshot;
    try {
      [loaded, rootSnapshot] = await Promise.all([
        loadAccessDocuments(reader, teamId, gameId, caller),
        readReference(reader, firestore.doc(paths(teamId, gameId).scorebook)),
      ]);
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError)
        throw error;
      throw makeError(
        "unavailable",
        "The Diamond scorebook could not be loaded completely.",
      );
    }
    if (!loaded.access.full && !loaded.access.scorekeeping) {
      throw makeError(
        "permission-denied",
        "Current scorekeeping access is required to view the private scorebook.",
      );
    }
    requireAllowed(
      core.decideDiamondOperation({
        operation: "read",
        teamId,
        game: loaded.game,
        policy: null,
      }),
      "This game is not owned by Diamond v2.",
    );
    const root = snapshotData(rootSnapshot);
    const checkpoint = buildCheckpointFromRoot(root);
    if (!root || !checkpoint)
      throw makeError("not-found", "Diamond scorebook not found.");
    if (root.instanceId !== loaded.game.diamondScorebookInstanceId) {
      throw makeError(
        "failed-precondition",
        "The Diamond scorebook generation does not match the game.",
      );
    }
    validateCommittedOrientationSnapshot(root, teamId);
    return { loaded, root, checkpoint };
  }

  function rosterReadSourceIdentity({ root, checkpoint }, teamId) {
    let checkpointHash;
    let orientationHash;
    let pinnedOrientation;
    try {
      checkpointHash = core.hashDiamondValue(checkpoint);
      orientationHash = core.hashDiamondValue(root.orientationSnapshot);
      pinnedOrientation = validateCommittedOrientationSnapshot(root, teamId);
    } catch {
      throw makeError(
        "failed-precondition",
        "The Diamond scorebook source is malformed. Reload the scorebook.",
      );
    }
    if (
      !UUID_V4_PATTERN.test(root.instanceId || "") ||
      root.instanceId !== root.instanceId.toLowerCase() ||
      !Number.isSafeInteger(checkpoint.sequence) ||
      checkpoint.sequence < 0 ||
      checkpoint.sequence > MAX_CANONICAL_EVENTS ||
      !SHA256_PATTERN.test(checkpointHash) ||
      !SHA256_PATTERN.test(orientationHash)
    ) {
      throw makeError(
        "failed-precondition",
        "The Diamond scorebook source is malformed. Reload the scorebook.",
      );
    }
    return {
      instanceId: root.instanceId,
      sourceRevision: checkpoint.sequence,
      checkpointHash,
      orientationHash,
      managedSide: pinnedOrientation.managedSide,
      opponentSide: pinnedOrientation.opponentSide,
      opponentTeamId: pinnedOrientation.opponentTeamId,
    };
  }

  function requireMatchingRosterReadSource(teamId, initial, current) {
    const latest = rosterReadSourceIdentity(current, teamId);
    if (
      latest.instanceId !== initial.instanceId ||
      latest.sourceRevision !== initial.sourceRevision ||
      latest.checkpointHash !== initial.checkpointHash ||
      latest.orientationHash !== initial.orientationHash
    ) {
      throw makeError(
        "aborted",
        "The Diamond scorebook changed while it was loading. Try again.",
        { reason: "diamond-roster-read-source-changed", retryable: true },
      );
    }
    return current;
  }

  async function requireMatchingOpponentRosterAccess(transaction, source, roster) {
    if (
      roster.teamSide !== source.managedSide ||
      roster.opponentSide !== source.opponentSide ||
      roster.opponentTeamId !== source.opponentTeamId
    ) {
      throw makeError(
        "aborted",
        "The opponent roster source changed while it was loading. Try again.",
        { reason: "diamond-roster-read-source-changed", retryable: true },
      );
    }
    if (!source.opponentTeamId) return;
    let snapshot;
    try {
      snapshot = await readReference(
        transaction,
        firestore.doc(`teams/${source.opponentTeamId}`),
      );
    } catch {
      throw makeError(
        "unavailable",
        "The opponent roster source could not be reverified. Try again.",
      );
    }
    if (
      isStrictPublicRosterTeam(
        snapshotData(snapshot),
        source.opponentTeamId,
      ) !== roster.opponentRosterReadable
    ) {
      throw makeError(
        "aborted",
        "The opponent roster source changed while it was loading. Try again.",
        { reason: "diamond-roster-read-source-changed", retryable: true },
      );
    }
  }

  function requireVoiceReadSource(
    state,
    { expectedRevision, rulesProfileId, rulesProfileVersion },
  ) {
    requireScorekeeper(state.loaded.access);
    if (
      state.checkpoint.sequence !== expectedRevision ||
      state.root.rulesProfileId !== rulesProfileId ||
      state.root.rulesProfileVersion !== rulesProfileVersion
    ) {
      throw makeError(
        "aborted",
        "Refresh the scorebook before interpreting this dictation.",
        { authoritativeRevision: state.checkpoint.sequence },
      );
    }
    return state;
  }

  function scorerCandidatePermissionMode(team) {
    return team?.teamPermissions?.scorekeeping?.mode === "all_confirmed"
      ? "all_confirmed"
      : "stable";
  }

  function strictCandidateUid(value) {
    try {
      return core.normalizeDiamondId(value, "candidate uid");
    } catch {
      return null;
    }
  }

  async function loadScorerCandidateSource(
    transaction,
    { team, game, state, callerUid, resourcePaths },
  ) {
    const permissionMode = scorerCandidatePermissionMode(team);
    const candidateUids = new Set(
      stableScorerCandidateUids(team, state)
        .map(strictCandidateUid)
        .filter(Boolean),
    );

    if (permissionMode === "all_confirmed") {
      let rsvpSnapshot;
      try {
        rsvpSnapshot = await transaction.get(
          firestore
            .collection(resourcePaths.rsvps)
            .limit(DIAMOND_SCORER_RSVP_SCAN_LIMIT),
        );
      } catch {
        throw makeError(
          "unavailable",
          "Confirmed scorer eligibility could not be read completely. Try again.",
          { reason: "scorer-candidate-rsvp-read-incomplete" },
        );
      }
      const rsvpDocuments = snapshotDocuments(rsvpSnapshot);
      if (rsvpDocuments.length > MAX_DIAMOND_SCORER_CANDIDATES) {
        throw makeError(
          "failed-precondition",
          "This game has too many RSVP records for a bounded scorer lookup.",
          { reason: "scorer-candidate-rsvp-overflow" },
        );
      }
      if (isConfirmedScoringGameEligible(game)) {
        for (const document of rsvpDocuments) {
          const uid = strictCandidateUid(document?.id);
          if (uid && hasCanonicalConfirmedRsvp(snapshotData(document))) {
            candidateUids.add(uid);
          }
        }
      }
    }

    candidateUids.delete(callerUid);
    const values = [...candidateUids].sort((left, right) =>
      left.localeCompare(right),
    );
    if (values.length > MAX_DIAMOND_SCORER_CANDIDATES) {
      throw makeError(
        "failed-precondition",
        "This game has too many eligible scorers for a bounded handoff lookup.",
        { reason: "scorer-candidate-overflow" },
      );
    }
    return { permissionMode, candidateUids: values };
  }

  async function loadEnabledScorerCandidateProfiles(candidateUids) {
    if (!candidateUids.length) return [];
    if (candidateUids.length > MAX_DIAMOND_SCORER_CANDIDATES) {
      throw makeError(
        "failed-precondition",
        "This game has too many eligible scorers for a bounded handoff lookup.",
        { reason: "scorer-candidate-overflow" },
      );
    }
    let result;
    try {
      result = await auth.getUsers(candidateUids.map((uid) => ({ uid })));
    } catch {
      throw makeError(
        "unavailable",
        "Scorer accounts could not be verified completely. Try again.",
        { reason: "scorer-candidate-auth-read-incomplete" },
      );
    }
    if (!Array.isArray(result?.users) || !Array.isArray(result?.notFound)) {
      throw makeError(
        "unavailable",
        "Scorer accounts returned an incomplete result. Try again.",
        { reason: "scorer-candidate-auth-result-incomplete" },
      );
    }
    const requested = new Set(candidateUids);
    const accountedFor = new Set();
    const enabledProfiles = new Map();
    const accountFor = (uid) => {
      if (
        typeof uid !== "string" ||
        !requested.has(uid) ||
        accountedFor.has(uid)
      ) {
        throw makeError(
          "unavailable",
          "Scorer accounts returned an invalid result. Try again.",
          { reason: "scorer-candidate-auth-result-invalid" },
        );
      }
      accountedFor.add(uid);
    };
    for (const authUser of result.users) {
      accountFor(authUser?.uid);
      if (authUser?.disabled === true) continue;
      const uid = authUser.uid;
      enabledProfiles.set(uid, {
        playerId: uid,
        name: scorerCandidateName(authUser.displayName, uid),
      });
    }
    for (const identifier of result.notFound) accountFor(identifier?.uid);
    if (accountedFor.size !== requested.size) {
      throw makeError(
        "unavailable",
        "Scorer accounts returned an incomplete result. Try again.",
        { reason: "scorer-candidate-auth-result-incomplete" },
      );
    }
    return candidateUids
      .map((uid) => enabledProfiles.get(uid))
      .filter(Boolean);
  }

  async function loadScorerCandidateAuthorizationState(
    transaction,
    {
      teamId,
      gameId,
      caller,
      expectedInstanceId,
      expectedRevision,
      leaseId,
      nowMs,
    },
  ) {
    const resourcePaths = paths(teamId, gameId);
    const [loaded, rootSnapshot] = await Promise.all([
      loadAccessDocuments(transaction, teamId, gameId, caller),
      transaction.get(firestore.doc(resourcePaths.scorebook)),
    ]);
    requireScorekeeper(loaded.access);
    requireAllowed(
      core.decideDiamondOperation({
        operation: "read",
        teamId,
        game: loaded.game,
        policy: null,
      }),
      "This game is not owned by Diamond v2.",
    );
    const root = snapshotData(rootSnapshot);
    const checkpoint = buildCheckpointFromRoot(root);
    if (!root || !checkpoint) {
      throw makeError("not-found", "Diamond scorebook not found.");
    }
    if (
      loaded.game.trackingEngine !== DIAMOND_ENGINE ||
      root.instanceId !== loaded.game.diamondScorebookInstanceId
    ) {
      throw makeError(
        "failed-precondition",
        "The Diamond scorebook generation does not match the game.",
      );
    }
    validateCommittedOrientationSnapshot(root, teamId);
    if (root.instanceId !== expectedInstanceId) {
      throw makeError(
        "aborted",
        "The Diamond game instance changed. Reload scorer handoff.",
        {
          reason: "stale-instance",
          authoritativeRevision: checkpoint.sequence,
        },
      );
    }
    if (checkpoint.sequence !== expectedRevision) {
      throw makeError(
        "aborted",
        "The scorebook changed. Reload scorer handoff.",
        {
          reason: "stale-revision",
          authoritativeRevision: checkpoint.sequence,
        },
      );
    }
    if (checkpoint.state?.currentScorerUid !== caller.uid) {
      throw makeError(
        "unavailable",
        "The active scorer changed. Reload scorer handoff.",
        { reason: "scorer-candidate-holder-changed", retryable: true },
      );
    }
    requireAllowed(
      core.decideDiamondScorerLease({
        operation: "score",
        lease: root.scorerLease,
        actorUid: caller.uid,
        presentedLeaseId: leaseId,
        nowMillis: nowMs,
      }),
      "Only the current scorer may list handoff candidates.",
    );
    return { loaded, root, checkpoint, resourcePaths };
  }

  async function loadScorerCandidateLookupState(transaction, input) {
    const authorized = await loadScorerCandidateAuthorizationState(
      transaction,
      input,
    );
    const source = await loadScorerCandidateSource(transaction, {
      team: authorized.loaded.team,
      game: authorized.loaded.game,
      state: authorized.checkpoint.state,
      callerUid: input.caller.uid,
      resourcePaths: authorized.resourcePaths,
    });
    return { ...authorized, ...source };
  }

  async function listDiamondScorerCandidates(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set([
        "requestId",
        "teamId",
        "gameId",
        "expectedInstanceId",
        "expectedRevision",
        "leaseId",
      ]),
      makeError,
      "Diamond scorer candidate request",
    );
    const requestId = normalizeUuid(data.requestId, "requestId");
    const teamId = normalizeId(data.teamId, "teamId");
    const gameId = normalizeId(data.gameId, "gameId");
    const expectedInstanceId = normalizeUuid(
      data.expectedInstanceId,
      "expectedInstanceId",
    );
    const expectedRevision = normalizeOptionalRevision(
      data.expectedRevision,
      makeError,
    );
    if (expectedRevision === null) {
      throw makeError(
        "invalid-argument",
        "expectedRevision is required for scorer candidate lookup.",
      );
    }
    const leaseId = normalizeId(data.leaseId, "leaseId");
    const request = Object.freeze({
      requestId,
      teamId,
      gameId,
      expectedInstanceId,
      expectedRevision,
      leaseId,
    });
    const callerUid = requireCallerUid(context);
    const executionId = secureUuid(random, makeError, "scorer candidate read");
    const reservation = await scorerCandidateAdmission.reserve({
      request,
      callerUid,
      executionId,
    });
    const response = (candidates) => ({
      schemaVersion: 1,
      complete: true,
      teamId,
      gameId,
      instanceId: expectedInstanceId,
      revision: expectedRevision,
      leaseId,
      candidates,
    });
    try {
      if (reservation.kind === "replay") {
        const candidates = await scorerCandidateAdmission.replay({
          reservation,
          authorize: async (transaction) => {
            const caller = await loadEnabledAuthUser(context);
            await loadScorerCandidateAuthorizationState(transaction, {
              ...request,
              caller,
              nowMs: normalizeNow(clock, makeError),
            });
          },
        });
        return response(candidates);
      }
      const caller = await loadEnabledAuthUser(context);
      let initial;
      try {
        initial = await firestore.runTransaction(
          (transaction) =>
            loadScorerCandidateLookupState(transaction, {
              ...request,
              caller,
              nowMs: normalizeNow(clock, makeError),
            }),
          { maxAttempts: 1 },
        );
      } catch (error) {
        if (
          error instanceof HttpsError ||
          error instanceof DiamondHandlerError
        ) {
          throw error;
        }
        throw makeError(
          "unavailable",
          "Scorer candidates could not be loaded completely. Try again.",
        );
      }
      const candidates = await loadEnabledScorerCandidateProfiles(
        initial.candidateUids,
      );
      await scorerCandidateAdmission.complete({
        reservation,
        candidates,
        authorize: async (transaction) => {
          const freshCaller = await loadEnabledAuthUser(context);
          const finalState = await loadScorerCandidateLookupState(
            transaction,
            {
              ...request,
              caller: freshCaller,
              nowMs: normalizeNow(clock, makeError),
            },
          );
          if (
            finalState.permissionMode !== initial.permissionMode ||
            finalState.candidateUids.length !== initial.candidateUids.length ||
            finalState.candidateUids.some(
              (uid, index) => uid !== initial.candidateUids[index],
            )
          ) {
            throw makeError(
              "aborted",
              "Scorer eligibility changed. Reload scorer handoff.",
              { reason: "scorer-candidate-source-changed", retryable: true },
            );
          }
        },
      });
      return response(candidates);
    } catch (error) {
      await scorerCandidateAdmission.fail({
        reservation,
        failureCode: error?.details?.reason || error?.code,
      });
      throw error;
    }
  }

  function privateHistoryControlIdentity({
    teamId,
    gameId,
    limit,
    cursor,
    callerUid,
    attemptHash,
  }) {
    const callerScopeHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-private-history-caller-scope",
      callerUid,
    });
    const scopeHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-private-history-read-scope",
      callerUid,
      teamId,
      gameId,
    });
    const inputHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-private-history-read-input",
      scopeHash,
      limit,
      cursor,
    });
    const requestHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-private-history-read-request",
      scopeHash,
      inputHash,
      attemptHash,
    });
    return Object.freeze({
      callerScopeHash,
      scopeHash,
      inputHash,
      requestHash,
      attemptHash,
      callerAdmissionRef: firestore.doc(
        `${MANAGER_STAT_CONTROL_COLLECTION}/history-admission-${callerScopeHash.slice(7)}`,
      ),
      scopeRef: firestore.doc(
        `${MANAGER_STAT_CONTROL_COLLECTION}/history-scope-${scopeHash.slice(7)}`,
      ),
    });
  }

  function invalidPrivateHistoryControl(snapshot, nowMs) {
    const updatedAtMs = controlSnapshotUpdatedAtMs(snapshot);
    if (
      updatedAtMs !== null &&
      updatedAtMs + PRIVATE_HISTORY_CONTROL_QUARANTINE_MS <= nowMs
    ) {
      return null;
    }
    throw makeError(
      "unavailable",
      "Private scorebook history safety state is unavailable. Try again later.",
      { reason: "private-history-control-invalid", retryable: true },
    );
  }

  function parsePrivateHistoryAdmission(snapshot, identity, nowMs) {
    if (!snapshot?.exists) return null;
    const value = snapshotData(snapshot);
    const recentAttempts = Array.isArray(value?.recentAttempts)
      ? value.recentAttempts
      : null;
    const activeAttempts = Array.isArray(value?.activeAttempts)
      ? value.activeAttempts
      : null;
    const expectedExpiresAtMs = Math.max(
      value?.windowResetAtMs || 0,
      value?.sustainedWindowResetAtMs || 0,
      (value?.updatedAtMs || 0) + PRIVATE_HISTORY_ADMISSION_DEDUPE_MS,
      ...(activeAttempts || []).map(({ leaseExpiresAtMs }) => leaseExpiresAtMs),
    );
    if (
      !isPlainObject(value) ||
      Object.keys(value).length !== 15 ||
      value.schemaVersion !== 1 ||
      value.type !== "diamond-private-history-read-admission" ||
      value.scopeHash !== identity.callerScopeHash ||
      !Number.isSafeInteger(value.windowStartedAtMs) ||
      value.windowStartedAtMs < 0 ||
      value.windowStartedAtMs % PRIVATE_HISTORY_RATE_WINDOW_MS !== 0 ||
      !Number.isSafeInteger(value.windowResetAtMs) ||
      value.windowResetAtMs !==
        value.windowStartedAtMs + PRIVATE_HISTORY_RATE_WINDOW_MS ||
      !Number.isSafeInteger(value.requestCount) ||
      value.requestCount < 0 ||
      value.requestCount > MAX_PRIVATE_HISTORY_GLOBAL_REQUESTS_PER_WINDOW ||
      !Number.isSafeInteger(value.readUnits) ||
      value.readUnits < 0 ||
      value.readUnits > MAX_PRIVATE_HISTORY_GLOBAL_READ_UNITS_PER_WINDOW ||
      !Number.isSafeInteger(value.sustainedWindowStartedAtMs) ||
      value.sustainedWindowStartedAtMs < 0 ||
      value.sustainedWindowStartedAtMs % PRIVATE_HISTORY_SUSTAINED_WINDOW_MS !==
        0 ||
      !Number.isSafeInteger(value.sustainedWindowResetAtMs) ||
      value.sustainedWindowResetAtMs !==
        value.sustainedWindowStartedAtMs +
          PRIVATE_HISTORY_SUSTAINED_WINDOW_MS ||
      !Number.isSafeInteger(value.sustainedRequestCount) ||
      value.sustainedRequestCount < value.requestCount ||
      value.sustainedRequestCount >
        MAX_PRIVATE_HISTORY_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW ||
      !Number.isSafeInteger(value.sustainedReadUnits) ||
      value.sustainedReadUnits < value.readUnits ||
      value.sustainedReadUnits >
        MAX_PRIVATE_HISTORY_GLOBAL_SUSTAINED_READ_UNITS_PER_WINDOW ||
      !recentAttempts ||
      recentAttempts.length > MAX_PRIVATE_HISTORY_RECENT_ADMISSIONS ||
      new Set(recentAttempts.map((entry) => entry?.attemptHash)).size !==
        recentAttempts.length ||
      !recentAttempts.every(
        (entry) =>
          isPlainObject(entry) &&
          Object.keys(entry).length === 2 &&
          SHA256_PATTERN.test(entry.attemptHash) &&
          Number.isSafeInteger(entry.admittedAtMs) &&
          entry.admittedAtMs >= 0 &&
          entry.admittedAtMs <= value.updatedAtMs,
      ) ||
      !activeAttempts ||
      activeAttempts.length > MAX_CONCURRENT_PRIVATE_HISTORY_GLOBAL_REQUESTS ||
      new Set(activeAttempts.map((entry) => entry?.requestHash)).size !==
        activeAttempts.length ||
      new Set(activeAttempts.map((entry) => entry?.attemptHash)).size !==
        activeAttempts.length ||
      !activeAttempts.every(
        (entry) =>
          isPlainObject(entry) &&
          Object.keys(entry).length === 4 &&
          SHA256_PATTERN.test(entry.requestHash) &&
          SHA256_PATTERN.test(entry.attemptHash) &&
          Number.isSafeInteger(entry.startedAtMs) &&
          entry.startedAtMs >= 0 &&
          entry.startedAtMs <= value.updatedAtMs &&
          Number.isSafeInteger(entry.leaseExpiresAtMs) &&
          entry.leaseExpiresAtMs ===
            entry.startedAtMs + PRIVATE_HISTORY_REQUEST_LEASE_MS &&
          recentAttempts.some(
            ({ attemptHash, admittedAtMs }) =>
              attemptHash === entry.attemptHash &&
              admittedAtMs === entry.startedAtMs,
          ),
      ) ||
      recentAttempts.length !== activeAttempts.length ||
      !Number.isSafeInteger(value.updatedAtMs) ||
      value.updatedAtMs < value.windowStartedAtMs ||
      value.updatedAtMs < value.sustainedWindowStartedAtMs ||
      value.updatedAtMs >= value.windowResetAtMs ||
      value.updatedAtMs >= value.sustainedWindowResetAtMs ||
      value.updatedAtMs > nowMs ||
      managerStatsControlTimestampMs(value.expiresAt) !== expectedExpiresAtMs
    ) {
      return invalidPrivateHistoryControl(snapshot, nowMs);
    }
    return value;
  }

  function parsePrivateHistoryScope(snapshot, identity, nowMs) {
    if (!snapshot?.exists) return null;
    const value = snapshotData(snapshot);
    const activeAttempts = Array.isArray(value?.activeAttempts)
      ? value.activeAttempts
      : null;
    const recentTerminals = Array.isArray(value?.recentTerminals)
      ? value.recentTerminals
      : null;
    const activeHashes = activeAttempts?.map(({ requestHash }) => requestHash);
    const activeInputHashes = activeAttempts?.map(({ inputHash }) => inputHash);
    const terminalHashes = recentTerminals?.map(
      ({ requestHash }) => requestHash,
    );
    const expectedExpiresAtMs = Math.max(
      value?.windowResetAtMs || 0,
      value?.sustainedWindowResetAtMs || 0,
      ...(activeAttempts || []).map(({ leaseExpiresAtMs }) => leaseExpiresAtMs),
      ...(recentTerminals || []).map(
        ({ finishedAtMs }) =>
          finishedAtMs + PRIVATE_HISTORY_RECEIPT_RETENTION_MS,
      ),
    );
    if (
      !isPlainObject(value) ||
      Object.keys(value).length !== 15 ||
      value.schemaVersion !== 1 ||
      value.type !== "diamond-private-history-read-scope" ||
      value.scopeHash !== identity.scopeHash ||
      !Number.isSafeInteger(value.windowStartedAtMs) ||
      value.windowStartedAtMs < 0 ||
      value.windowStartedAtMs % PRIVATE_HISTORY_RATE_WINDOW_MS !== 0 ||
      !Number.isSafeInteger(value.windowResetAtMs) ||
      value.windowResetAtMs !==
        value.windowStartedAtMs + PRIVATE_HISTORY_RATE_WINDOW_MS ||
      !Number.isSafeInteger(value.requestCount) ||
      value.requestCount < 0 ||
      value.requestCount > MAX_PRIVATE_HISTORY_REQUESTS_PER_WINDOW ||
      !Number.isSafeInteger(value.readUnits) ||
      value.readUnits < 0 ||
      value.readUnits > MAX_PRIVATE_HISTORY_READ_UNITS_PER_WINDOW ||
      !Number.isSafeInteger(value.sustainedWindowStartedAtMs) ||
      value.sustainedWindowStartedAtMs < 0 ||
      value.sustainedWindowStartedAtMs % PRIVATE_HISTORY_SUSTAINED_WINDOW_MS !==
        0 ||
      !Number.isSafeInteger(value.sustainedWindowResetAtMs) ||
      value.sustainedWindowResetAtMs !==
        value.sustainedWindowStartedAtMs +
          PRIVATE_HISTORY_SUSTAINED_WINDOW_MS ||
      !Number.isSafeInteger(value.sustainedRequestCount) ||
      value.sustainedRequestCount < value.requestCount ||
      value.sustainedRequestCount >
        MAX_PRIVATE_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW ||
      !Number.isSafeInteger(value.sustainedReadUnits) ||
      value.sustainedReadUnits < value.readUnits ||
      value.sustainedReadUnits >
        MAX_PRIVATE_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW ||
      !activeAttempts ||
      activeAttempts.length > MAX_CONCURRENT_PRIVATE_HISTORY_REQUESTS ||
      !activeAttempts.every(
        (entry) =>
          isPlainObject(entry) &&
          Object.keys(entry).length === 4 &&
          SHA256_PATTERN.test(entry.requestHash) &&
          SHA256_PATTERN.test(entry.inputHash) &&
          Number.isSafeInteger(entry.startedAtMs) &&
          entry.startedAtMs >= 0 &&
          entry.startedAtMs <= value.updatedAtMs &&
          Number.isSafeInteger(entry.leaseExpiresAtMs) &&
          entry.leaseExpiresAtMs ===
            entry.startedAtMs + PRIVATE_HISTORY_REQUEST_LEASE_MS,
      ) ||
      !recentTerminals ||
      recentTerminals.length > MAX_PRIVATE_HISTORY_RECENT_TERMINALS ||
      !recentTerminals.every(
        (entry) =>
          isPlainObject(entry) &&
          Object.keys(entry).length === 4 &&
          SHA256_PATTERN.test(entry.requestHash) &&
          ["complete", "failed"].includes(entry.status) &&
          Number.isSafeInteger(entry.finishedAtMs) &&
          entry.finishedAtMs >= 0 &&
          entry.finishedAtMs <= value.updatedAtMs &&
          (entry.status === "complete"
            ? SHA256_PATTERN.test(entry.responseHash) &&
              !Object.hasOwn(entry, "failureCode")
            : !Object.hasOwn(entry, "responseHash") &&
              typeof entry.failureCode === "string" &&
              entry.failureCode.length >= 1 &&
              entry.failureCode.length <= 64),
      ) ||
      new Set(activeHashes).size !== activeHashes.length ||
      new Set(activeInputHashes).size !== activeInputHashes.length ||
      new Set(terminalHashes).size !== terminalHashes.length ||
      activeHashes.some((requestHash) =>
        terminalHashes.includes(requestHash),
      ) ||
      !Number.isSafeInteger(value.updatedAtMs) ||
      value.updatedAtMs < value.windowStartedAtMs ||
      value.updatedAtMs < value.sustainedWindowStartedAtMs ||
      value.updatedAtMs > nowMs ||
      managerStatsControlTimestampMs(value.expiresAt) !== expectedExpiresAtMs
    ) {
      return invalidPrivateHistoryControl(snapshot, nowMs);
    }
    return value;
  }

  function privateHistoryWindowState(control, nowMs, durationMs, prefix = "") {
    const startedKey = prefix
      ? `${prefix}WindowStartedAtMs`
      : "windowStartedAtMs";
    const resetKey = prefix ? `${prefix}WindowResetAtMs` : "windowResetAtMs";
    const requestKey = prefix ? `${prefix}RequestCount` : "requestCount";
    const readKey = prefix ? `${prefix}ReadUnits` : "readUnits";
    const active = Boolean(control && control[resetKey] > nowMs);
    const windowStartedAtMs = active
      ? control[startedKey]
      : alignedCommandHistoryWindowStart(nowMs, durationMs);
    return {
      windowStartedAtMs,
      windowResetAtMs: active
        ? control[resetKey]
        : windowStartedAtMs + durationMs,
      requestCount: active ? control[requestKey] : 0,
      readUnits: active ? control[readKey] : 0,
    };
  }

  function privateHistoryAdmissionValue({
    identity,
    admission,
    recentAttempts,
    activeAttempts,
    nowMs,
    requestedReadUnits = 0,
    charge = false,
  }) {
    const burst = privateHistoryWindowState(
      admission,
      nowMs,
      PRIVATE_HISTORY_RATE_WINDOW_MS,
    );
    const sustained = privateHistoryWindowState(
      admission,
      nowMs,
      PRIVATE_HISTORY_SUSTAINED_WINDOW_MS,
      "sustained",
    );
    return {
      schemaVersion: 1,
      type: "diamond-private-history-read-admission",
      scopeHash: identity.callerScopeHash,
      windowStartedAtMs: burst.windowStartedAtMs,
      windowResetAtMs: burst.windowResetAtMs,
      requestCount: burst.requestCount + (charge ? 1 : 0),
      readUnits: burst.readUnits + (charge ? requestedReadUnits : 0),
      sustainedWindowStartedAtMs: sustained.windowStartedAtMs,
      sustainedWindowResetAtMs: sustained.windowResetAtMs,
      sustainedRequestCount: sustained.requestCount + (charge ? 1 : 0),
      sustainedReadUnits:
        sustained.readUnits + (charge ? requestedReadUnits : 0),
      recentAttempts: (charge
        ? [
            ...recentAttempts,
            { attemptHash: identity.attemptHash, admittedAtMs: nowMs },
          ]
        : recentAttempts
      ).slice(-MAX_PRIVATE_HISTORY_RECENT_ADMISSIONS),
      activeAttempts,
      updatedAtMs: nowMs,
      expiresAt: new Date(
        Math.max(
          burst.windowResetAtMs,
          sustained.windowResetAtMs,
          nowMs + PRIVATE_HISTORY_ADMISSION_DEDUPE_MS,
          ...activeAttempts.map(({ leaseExpiresAtMs }) => leaseExpiresAtMs),
        ),
      ),
    };
  }

  function privateHistoryScopeValue({
    identity,
    scope,
    activeAttempts,
    recentTerminals,
    nowMs,
    requestedReadUnits = 0,
    charge = false,
  }) {
    const burst = privateHistoryWindowState(
      scope,
      nowMs,
      PRIVATE_HISTORY_RATE_WINDOW_MS,
    );
    const sustained = privateHistoryWindowState(
      scope,
      nowMs,
      PRIVATE_HISTORY_SUSTAINED_WINDOW_MS,
      "sustained",
    );
    const retainedTerminals = recentTerminals
      .filter(
        ({ finishedAtMs }) =>
          finishedAtMs + PRIVATE_HISTORY_RECEIPT_RETENTION_MS > nowMs,
      )
      .slice(-MAX_PRIVATE_HISTORY_RECENT_TERMINALS);
    return {
      schemaVersion: 1,
      type: "diamond-private-history-read-scope",
      scopeHash: identity.scopeHash,
      windowStartedAtMs: burst.windowStartedAtMs,
      windowResetAtMs: burst.windowResetAtMs,
      requestCount: burst.requestCount + (charge ? 1 : 0),
      readUnits: burst.readUnits + (charge ? requestedReadUnits : 0),
      sustainedWindowStartedAtMs: sustained.windowStartedAtMs,
      sustainedWindowResetAtMs: sustained.windowResetAtMs,
      sustainedRequestCount: sustained.requestCount + (charge ? 1 : 0),
      sustainedReadUnits:
        sustained.readUnits + (charge ? requestedReadUnits : 0),
      activeAttempts,
      recentTerminals: retainedTerminals,
      updatedAtMs: nowMs,
      expiresAt: new Date(
        Math.max(
          burst.windowResetAtMs,
          sustained.windowResetAtMs,
          ...activeAttempts.map(({ leaseExpiresAtMs }) => leaseExpiresAtMs),
          ...retainedTerminals.map(
            ({ finishedAtMs }) =>
              finishedAtMs + PRIVATE_HISTORY_RECEIPT_RETENTION_MS,
          ),
        ),
      ),
    };
  }

  function privateHistoryRetryDetails(reason, retryAtMs, nowMs) {
    return {
      reason,
      retryable: true,
      retryAfterMs: Math.max(1, retryAtMs - nowMs),
    };
  }

  function assertPrivateHistoryQuota(
    control,
    nowMs,
    requestedReadUnits,
    limits,
  ) {
    const burst = privateHistoryWindowState(
      control,
      nowMs,
      PRIVATE_HISTORY_RATE_WINDOW_MS,
    );
    const sustained = privateHistoryWindowState(
      control,
      nowMs,
      PRIVATE_HISTORY_SUSTAINED_WINDOW_MS,
      "sustained",
    );
    const burstLimited =
      burst.requestCount + 1 > limits.requests ||
      burst.readUnits + requestedReadUnits > limits.readUnits;
    const sustainedLimited =
      sustained.requestCount + 1 > limits.sustainedRequests ||
      sustained.readUnits + requestedReadUnits > limits.sustainedReadUnits;
    if (burstLimited || sustainedLimited) {
      throw makeError(
        "resource-exhausted",
        "Private scorebook history reads are temporarily limited.",
        privateHistoryRetryDetails(
          "private-history-rate-limited",
          Math.max(
            burstLimited ? burst.windowResetAtMs : 0,
            sustainedLimited ? sustained.windowResetAtMs : 0,
          ),
          nowMs,
        ),
      );
    }
  }

  async function reservePrivateHistoryRead(
    transaction,
    request,
    caller,
    attemptHash,
    nowMs,
  ) {
    const identity = privateHistoryControlIdentity({
      ...request,
      callerUid: caller.uid,
      attemptHash,
    });
    let admissionSnapshot;
    let scopeSnapshot;
    try {
      [admissionSnapshot, scopeSnapshot] = await Promise.all([
        transaction.get(identity.callerAdmissionRef),
        transaction.get(identity.scopeRef),
      ]);
    } catch {
      throw makeError(
        "unavailable",
        "Private scorebook history admission could not be verified.",
        { reason: "private-history-admission-read-failed", retryable: true },
      );
    }
    const admission = parsePrivateHistoryAdmission(
      admissionSnapshot,
      identity,
      nowMs,
    );
    const scope = parsePrivateHistoryScope(scopeSnapshot, identity, nowMs);
    const storedRecentAttempts = admission?.recentAttempts || [];
    const existingAdmission = storedRecentAttempts.find(
      ({ attemptHash: value }) => value === attemptHash,
    );
    const existingActive = scope?.activeAttempts?.find(
      ({ requestHash }) => requestHash === identity.requestHash,
    );
    const existingGlobalActive = admission?.activeAttempts?.find(
      ({ requestHash, attemptHash: value }) =>
        requestHash === identity.requestHash && value === attemptHash,
    );
    if (existingAdmission) {
      if (
        !existingActive ||
        existingActive.inputHash !== identity.inputHash ||
        !existingGlobalActive
      ) {
        throw makeError(
          "unavailable",
          "Private scorebook history admission could not be reconciled.",
          {
            reason: "private-history-admission-unconfirmed",
            retryable: true,
          },
        );
      }
      if (existingActive.leaseExpiresAtMs > nowMs) {
        return Object.freeze({ identity, request });
      }
      const activeAttempts = scope.activeAttempts.filter(
        ({ requestHash, leaseExpiresAtMs }) =>
          requestHash !== identity.requestHash && leaseExpiresAtMs > nowMs,
      );
      const globalActiveAttempts = admission.activeAttempts.filter(
        ({ requestHash, leaseExpiresAtMs }) =>
          requestHash !== identity.requestHash && leaseExpiresAtMs > nowMs,
      );
      const retainedAttemptHashes = new Set(
        globalActiveAttempts.map(({ attemptHash: value }) => value),
      );
      const rearmedScope = {
        requestHash: identity.requestHash,
        inputHash: identity.inputHash,
        startedAtMs: nowMs,
        leaseExpiresAtMs: nowMs + PRIVATE_HISTORY_REQUEST_LEASE_MS,
      };
      const rearmedGlobal = {
        requestHash: identity.requestHash,
        attemptHash: identity.attemptHash,
        startedAtMs: nowMs,
        leaseExpiresAtMs: nowMs + PRIVATE_HISTORY_REQUEST_LEASE_MS,
      };
      transaction.set(
        identity.callerAdmissionRef,
        privateHistoryAdmissionValue({
          identity,
          admission,
          recentAttempts: [
            ...storedRecentAttempts.filter(({ attemptHash: value }) =>
              retainedAttemptHashes.has(value),
            ),
            { attemptHash: identity.attemptHash, admittedAtMs: nowMs },
          ],
          activeAttempts: [...globalActiveAttempts, rearmedGlobal].sort(
            (left, right) => left.requestHash.localeCompare(right.requestHash),
          ),
          nowMs,
        }),
      );
      transaction.set(
        identity.scopeRef,
        privateHistoryScopeValue({
          identity,
          scope,
          activeAttempts: [...activeAttempts, rearmedScope].sort(
            (left, right) => left.requestHash.localeCompare(right.requestHash),
          ),
          recentTerminals: scope.recentTerminals,
          nowMs,
        }),
      );
      return Object.freeze({ identity, request });
    }

    const activeAttempts = (scope?.activeAttempts || []).filter(
      ({ leaseExpiresAtMs }) => leaseExpiresAtMs > nowMs,
    );
    const globalActiveAttempts = (admission?.activeAttempts || []).filter(
      ({ leaseExpiresAtMs }) => leaseExpiresAtMs > nowMs,
    );
    const retainedAttemptHashes = new Set(
      globalActiveAttempts.map(({ attemptHash: value }) => value),
    );
    const recentAttempts = storedRecentAttempts.filter(
      ({ attemptHash: value }) => retainedAttemptHashes.has(value),
    );
    const matchingInput = activeAttempts.find(
      ({ inputHash }) => inputHash === identity.inputHash,
    );
    if (matchingInput) {
      throw makeError(
        "resource-exhausted",
        "This private scorebook history page is already loading.",
        privateHistoryRetryDetails(
          "private-history-duplicate-active",
          matchingInput.leaseExpiresAtMs,
          nowMs,
        ),
      );
    }
    if (activeAttempts.length >= MAX_CONCURRENT_PRIVATE_HISTORY_REQUESTS) {
      throw makeError(
        "resource-exhausted",
        "Too many private scorebook history reads are already active.",
        privateHistoryRetryDetails(
          "private-history-concurrency-limited",
          Math.min(
            ...activeAttempts.map(({ leaseExpiresAtMs }) => leaseExpiresAtMs),
          ),
          nowMs,
        ),
      );
    }
    if (
      globalActiveAttempts.length >=
      MAX_CONCURRENT_PRIVATE_HISTORY_GLOBAL_REQUESTS
    ) {
      throw makeError(
        "resource-exhausted",
        "Too many private scorebook history reads are already active for this account.",
        privateHistoryRetryDetails(
          "private-history-global-concurrency-limited",
          Math.min(
            ...globalActiveAttempts.map(
              ({ leaseExpiresAtMs }) => leaseExpiresAtMs,
            ),
          ),
          nowMs,
        ),
      );
    }
    const requestedReadUnits =
      PRIVATE_HISTORY_FIXED_READ_UNITS +
      PRIVATE_HISTORY_READ_UNITS_PER_EVENT * request.limit;
    assertPrivateHistoryQuota(admission, nowMs, requestedReadUnits, {
      requests: MAX_PRIVATE_HISTORY_GLOBAL_REQUESTS_PER_WINDOW,
      readUnits: MAX_PRIVATE_HISTORY_GLOBAL_READ_UNITS_PER_WINDOW,
      sustainedRequests:
        MAX_PRIVATE_HISTORY_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW,
      sustainedReadUnits:
        MAX_PRIVATE_HISTORY_GLOBAL_SUSTAINED_READ_UNITS_PER_WINDOW,
    });
    assertPrivateHistoryQuota(scope, nowMs, requestedReadUnits, {
      requests: MAX_PRIVATE_HISTORY_REQUESTS_PER_WINDOW,
      readUnits: MAX_PRIVATE_HISTORY_READ_UNITS_PER_WINDOW,
      sustainedRequests: MAX_PRIVATE_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW,
      sustainedReadUnits: MAX_PRIVATE_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW,
    });
    const activeAttempt = {
      requestHash: identity.requestHash,
      inputHash: identity.inputHash,
      startedAtMs: nowMs,
      leaseExpiresAtMs: nowMs + PRIVATE_HISTORY_REQUEST_LEASE_MS,
    };
    const globalActiveAttempt = {
      requestHash: identity.requestHash,
      attemptHash: identity.attemptHash,
      startedAtMs: nowMs,
      leaseExpiresAtMs: nowMs + PRIVATE_HISTORY_REQUEST_LEASE_MS,
    };
    transaction.set(
      identity.callerAdmissionRef,
      privateHistoryAdmissionValue({
        identity,
        admission,
        recentAttempts,
        activeAttempts: [...globalActiveAttempts, globalActiveAttempt].sort(
          (left, right) => left.requestHash.localeCompare(right.requestHash),
        ),
        nowMs,
        requestedReadUnits,
        charge: true,
      }),
    );
    transaction.set(
      identity.scopeRef,
      privateHistoryScopeValue({
        identity,
        scope,
        activeAttempts: [...activeAttempts, activeAttempt].sort((left, right) =>
          left.requestHash.localeCompare(right.requestHash),
        ),
        recentTerminals: scope?.recentTerminals || [],
        nowMs,
        requestedReadUnits,
        charge: true,
      }),
    );
    return Object.freeze({ identity, request });
  }

  async function reservePrivateHistoryReadWithReconciliation({
    request,
    callerUid,
    attemptHash,
  }) {
    const caller = Object.freeze({ uid: callerUid });
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const reservation = await firestore.runTransaction(
          (transaction) =>
            reservePrivateHistoryRead(
              transaction,
              request,
              caller,
              attemptHash,
              normalizeNow(clock, makeError),
            ),
          { maxAttempts: 1 },
        );
        return reservation;
      } catch (error) {
        if (error instanceof HttpsError || error instanceof DiamondHandlerError)
          throw error;
        lastError = error;
      }
    }
    logger.error?.("diamond_private_history_admission_unconfirmed", {
      code: lastError?.code || "transaction-failed",
    });
    throw makeError(
      "unavailable",
      "Private scorebook history admission could not be confirmed. Try again.",
      { reason: "private-history-admission-unconfirmed", retryable: true },
    );
  }

  function privateHistoryTerminalValue(reservation, scope, terminal, nowMs) {
    return privateHistoryScopeValue({
      identity: reservation.identity,
      scope,
      activeAttempts: scope.activeAttempts.filter(
        ({ requestHash, leaseExpiresAtMs }) =>
          requestHash !== reservation.identity.requestHash &&
          leaseExpiresAtMs > nowMs,
      ),
      recentTerminals: [...scope.recentTerminals, terminal],
      nowMs,
    });
  }

  function privateHistoryReleasedAdmissionValue(reservation, admission, nowMs) {
    const activeAttempts = admission.activeAttempts.filter(
      ({ requestHash, leaseExpiresAtMs }) =>
        requestHash !== reservation.identity.requestHash &&
        leaseExpiresAtMs > nowMs,
    );
    const retainedAttemptHashes = new Set(
      activeAttempts.map(({ attemptHash }) => attemptHash),
    );
    return privateHistoryAdmissionValue({
      identity: reservation.identity,
      admission,
      recentAttempts: admission.recentAttempts.filter(({ attemptHash }) =>
        retainedAttemptHashes.has(attemptHash),
      ),
      activeAttempts,
      nowMs,
    });
  }

  async function completePrivateHistoryReadTransaction(
    transaction,
    {
      teamId,
      gameId,
      caller,
      expectedInstanceId,
      sourceRevision,
      expectedPrivacyRevision,
      reservation,
      responseHash,
      nowMs,
    },
  ) {
    const [loaded, rootSnapshot, admissionSnapshot, scopeSnapshot] =
      await Promise.all([
        loadAccessDocuments(transaction, teamId, gameId, caller),
        transaction.get(firestore.doc(paths(teamId, gameId).scorebook)),
        transaction.get(reservation.identity.callerAdmissionRef),
        transaction.get(reservation.identity.scopeRef),
      ]);
    if (!loaded.access.full && !loaded.access.scorekeeping) {
      throw makeError(
        "permission-denied",
        "Current scorekeeping access is required to view the private scorebook.",
      );
    }
    requireAllowed(
      core.decideDiamondOperation({
        operation: "read",
        teamId,
        game: loaded.game,
        policy: null,
      }),
      "This game is not owned by Diamond v2.",
    );
    const root = snapshotData(rootSnapshot);
    const checkpoint = buildCheckpointFromRoot(root);
    if (
      !root ||
      !checkpoint ||
      root.privateNoteStorageVersion !== DIAMOND_PRIVATE_NOTE_STORAGE_VERSION ||
      root.instanceId !== expectedInstanceId ||
      root.instanceId !== loaded.game.diamondScorebookInstanceId ||
      checkpoint.sequence !== sourceRevision ||
      privateNotePrivacyRevision(root) !== expectedPrivacyRevision
    ) {
      throw makeError(
        "unavailable",
        "The private scorebook changed while history was loading. Try again.",
      );
    }
    const scope = parsePrivateHistoryScope(
      scopeSnapshot,
      reservation.identity,
      nowMs,
    );
    const admission = parsePrivateHistoryAdmission(
      admissionSnapshot,
      reservation.identity,
      nowMs,
    );
    const terminal = scope?.recentTerminals?.find(
      ({ requestHash }) => requestHash === reservation.identity.requestHash,
    );
    const globalActive = admission?.activeAttempts?.find(
      ({ requestHash, attemptHash }) =>
        requestHash === reservation.identity.requestHash &&
        attemptHash === reservation.identity.attemptHash,
    );
    if (terminal) {
      if (
        terminal.status === "complete" &&
        terminal.responseHash === responseHash &&
        !globalActive
      )
        return;
      throw makeError(
        "unavailable",
        "Private scorebook history completion could not be reconciled.",
        { reason: "private-history-completion-unconfirmed", retryable: true },
      );
    }
    const active = scope?.activeAttempts?.find(
      ({ requestHash }) => requestHash === reservation.identity.requestHash,
    );
    if (
      !active ||
      !globalActive ||
      active.leaseExpiresAtMs <= nowMs ||
      globalActive.leaseExpiresAtMs <= nowMs
    ) {
      throw makeError(
        "aborted",
        "The private scorebook history reservation expired. Try again.",
        { reason: "private-history-reservation-lost", retryable: true },
      );
    }
    transaction.set(
      reservation.identity.callerAdmissionRef,
      privateHistoryReleasedAdmissionValue(reservation, admission, nowMs),
    );
    transaction.set(
      reservation.identity.scopeRef,
      privateHistoryTerminalValue(
        reservation,
        scope,
        {
          requestHash: reservation.identity.requestHash,
          status: "complete",
          finishedAtMs: nowMs,
          responseHash,
        },
        nowMs,
      ),
    );
  }

  async function completePrivateHistoryRead({
    teamId,
    gameId,
    context,
    expectedInstanceId,
    sourceRevision,
    expectedPrivacyRevision,
    reservation,
    responseEvidence,
  }) {
    const responseHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-private-history-read-response",
      response: responseEvidence,
    });
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const caller = await loadEnabledAuthUser(context);
      try {
        await firestore.runTransaction(
          (transaction) =>
            completePrivateHistoryReadTransaction(transaction, {
              teamId,
              gameId,
              caller,
              expectedInstanceId,
              sourceRevision,
              expectedPrivacyRevision,
              reservation,
              responseHash,
              nowMs: normalizeNow(clock, makeError),
            }),
          { maxAttempts: 1 },
        );
        return;
      } catch (error) {
        if (error instanceof HttpsError || error instanceof DiamondHandlerError)
          throw error;
        lastError = error;
      }
    }
    logger.error?.("diamond_private_history_completion_unconfirmed", {
      code: lastError?.code || "transaction-failed",
    });
    throw makeError(
      "unavailable",
      "Private scorebook access could not be reverified. Try again.",
      { reason: "private-history-completion-unconfirmed", retryable: true },
    );
  }

  async function failPrivateHistoryRead(reservation, failureCode) {
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await firestore.runTransaction(
          async (transaction) => {
            const nowMs = normalizeNow(clock, makeError);
            const [admissionSnapshot, scopeSnapshot] = await Promise.all([
              transaction.get(reservation.identity.callerAdmissionRef),
              transaction.get(reservation.identity.scopeRef),
            ]);
            const admission = parsePrivateHistoryAdmission(
              admissionSnapshot,
              reservation.identity,
              nowMs,
            );
            const scope = parsePrivateHistoryScope(
              scopeSnapshot,
              reservation.identity,
              nowMs,
            );
            const active = scope?.activeAttempts?.find(
              ({ requestHash }) =>
                requestHash === reservation.identity.requestHash,
            );
            const globalActive = admission?.activeAttempts?.find(
              ({ requestHash, attemptHash }) =>
                requestHash === reservation.identity.requestHash &&
                attemptHash === reservation.identity.attemptHash,
            );
            if (!active && !globalActive) return;
            if (!active || !globalActive) {
              throw makeError(
                "unavailable",
                "Private scorebook history failure state could not be reconciled.",
                {
                  reason: "private-history-completion-unconfirmed",
                  retryable: true,
                },
              );
            }
            transaction.set(
              reservation.identity.callerAdmissionRef,
              privateHistoryReleasedAdmissionValue(
                reservation,
                admission,
                nowMs,
              ),
            );
            transaction.set(
              reservation.identity.scopeRef,
              privateHistoryTerminalValue(
                reservation,
                scope,
                {
                  requestHash: reservation.identity.requestHash,
                  status: "failed",
                  finishedAtMs: nowMs,
                  failureCode:
                    compactText(failureCode, 64) || "private-history-failed",
                },
                nowMs,
              ),
            );
          },
          { maxAttempts: 1 },
        );
        return;
      } catch (error) {
        lastError = error;
        if (error instanceof HttpsError || error instanceof DiamondHandlerError)
          break;
      }
    }
    logger.error?.("diamond_private_history_failure_state", {
      code: lastError?.code || "write-failed",
    });
  }

  function buildSanitizedViewerState({ team, game, projection, scope }) {
    const instanceId = game.diamondScorebookInstanceId;
    if (
      typeof instanceId !== "string" ||
      instanceId !== instanceId.toLowerCase() ||
      !UUID_V4_PATTERN.test(instanceId) ||
      projection.instanceId !== instanceId
    ) {
      throw makeError(
        "unavailable",
        "The public Diamond projection is stale. Try again.",
      );
    }
    return {
      team,
      game,
      projection: core.sanitizeDiamondPublicProjection(projection),
      rawProjection: projection,
      viewerScope: scope,
    };
  }

  async function loadAuthorizedViewerState(teamId, gameId, context) {
    const caller = await loadEnabledAuthUser(context);
    const resourcePaths = paths(teamId, gameId);
    try {
      return await firestore.runTransaction(async (transaction) => {
        const [loaded, projectionSnapshot] = await Promise.all([
          loadAccessDocuments(transaction, teamId, gameId, caller),
          transaction.get(firestore.doc(resourcePaths.publicState)),
        ]);
        const projection = snapshotData(projectionSnapshot);
        if (
          !projection ||
          loaded.game?.trackingEngine !== DIAMOND_ENGINE ||
          canProjectPublic(loaded.team, loaded.game) ||
          !hasAuthorizedViewerAccess(loaded.access, loaded.game, caller)
        ) {
          throw makeError("not-found", "Public Diamond game not found.");
        }
        requireAllowed(
          core.decideDiamondOperation({
            operation: "read",
            teamId,
            game: loaded.game,
            policy: null,
          }),
          "This game is not owned by Diamond v2.",
        );
        return buildSanitizedViewerState({
          team: loaded.team,
          game: loaded.game,
          projection,
          scope: "authorized",
        });
      });
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError) {
        throw error;
      }
      throw makeError(
        "unavailable",
        "Private Diamond viewer access could not be verified completely. Try again.",
      );
    }
  }

  async function loadPublicState(teamId, gameId, context = null) {
    const resourcePaths = paths(teamId, gameId);
    let snapshots;
    try {
      snapshots = await firestore.runTransaction((transaction) =>
        Promise.all([
          transaction.get(firestore.doc(resourcePaths.team)),
          transaction.get(firestore.doc(resourcePaths.game)),
          transaction.get(firestore.doc(resourcePaths.publicState)),
        ]),
      );
    } catch {
      throw makeError(
        "unavailable",
        "The public Diamond projection could not be loaded completely.",
      );
    }
    const team = snapshotData(snapshots[0]);
    const game = snapshotData(snapshots[1]);
    const projection = snapshotData(snapshots[2]);
    if (
      !team ||
      !game ||
      !projection ||
      game.trackingEngine !== DIAMOND_ENGINE
    ) {
      throw makeError("not-found", "Public Diamond game not found.");
    }
    if (!canProjectPublic(team, game)) {
      const uid = context?.auth?.uid;
      if (typeof uid !== "string" || !uid) {
        throw makeError("not-found", "Public Diamond game not found.");
      }
      return loadAuthorizedViewerState(teamId, gameId, context);
    }
    return buildSanitizedViewerState({
      team,
      game,
      projection,
      scope: "public",
    });
  }

  function viewerPageMatches({ team, game, projection, loaded, page }) {
    const expectedProjection = loaded.rawProjection;
    const sourceRevision = Number(
      projection?.sourceRevision ?? projection?.revision,
    );
    const expectedSourceRevision = Number(
      expectedProjection.sourceRevision ?? expectedProjection.revision,
    );
    return (
      team &&
      game &&
      projection &&
      game.trackingEngine === DIAMOND_ENGINE &&
      game.diamondScorebookInstanceId ===
        loaded.game.diamondScorebookInstanceId &&
      projection.instanceId === loaded.game.diamondScorebookInstanceId &&
      sourceRevision === expectedSourceRevision &&
      sourceRevision === page.sourceRevision &&
      projection.checkpointHash === expectedProjection.checkpointHash &&
      projection.projectionHash === expectedProjection.projectionHash &&
      projection.projectionStatus === expectedProjection.projectionStatus &&
      game.diamondProjectionRevision ===
        loaded.game.diamondProjectionRevision &&
      game.diamondProjectionCheckpointHash ===
        loaded.game.diamondProjectionCheckpointHash &&
      game.diamondProjectionHash === loaded.game.diamondProjectionHash &&
      game.diamondProjectionStatus === loaded.game.diamondProjectionStatus &&
      game.diamondProjectionComplete === loaded.game.diamondProjectionComplete
    );
  }

  async function reauthorizeAuthorizedViewerGamePage({
    teamId,
    gameId,
    context,
    loaded,
    page,
  }) {
    const caller = await loadEnabledAuthUser(context);
    const resourcePaths = paths(teamId, gameId);
    try {
      return await firestore.runTransaction(async (transaction) => {
        const [fresh, projectionSnapshot] = await Promise.all([
          loadAccessDocuments(transaction, teamId, gameId, caller),
          transaction.get(firestore.doc(resourcePaths.publicState)),
        ]);
        const projection = snapshotData(projectionSnapshot);
        if (!hasAuthorizedViewerAccess(fresh.access, fresh.game, caller)) {
          throw makeError("not-found", "Public Diamond game not found.");
        }
        if (
          canProjectPublic(fresh.team, fresh.game) ||
          !viewerPageMatches({
            team: fresh.team,
            game: fresh.game,
            projection,
            loaded,
            page,
          })
        ) {
          throw makeError(
            "unavailable",
            "The private Diamond game changed while it was loading. Try again.",
          );
        }
        return {
          team: fresh.team,
          game: fresh.game,
          projection: core.sanitizeDiamondPublicProjection(projection),
        };
      });
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError) {
        throw error;
      }
      throw makeError(
        "unavailable",
        "Private Diamond viewer access could not be reverified. Try again.",
      );
    }
  }

  async function reauthorizePublicGamePage({
    teamId,
    gameId,
    loaded,
    page,
    context = null,
  }) {
    if (loaded.viewerScope === "authorized") {
      return reauthorizeAuthorizedViewerGamePage({
        teamId,
        gameId,
        context,
        loaded,
        page,
      });
    }
    if (loaded.viewerScope !== "public") {
      throw makeError("not-found", "Public Diamond game not found.");
    }
    const resourcePaths = paths(teamId, gameId);
    let snapshots;
    try {
      snapshots = await firestore.runTransaction((transaction) =>
        Promise.all([
          transaction.get(firestore.doc(resourcePaths.team)),
          transaction.get(firestore.doc(resourcePaths.game)),
          transaction.get(firestore.doc(resourcePaths.publicState)),
        ]),
      );
    } catch {
      throw makeError(
        "unavailable",
        "The public Diamond game could not be reverified. Try again.",
      );
    }
    const team = snapshotData(snapshots[0]);
    const game = snapshotData(snapshots[1]);
    const projection = snapshotData(snapshots[2]);
    if (!canProjectPublic(team, game)) {
      throw makeError("not-found", "Public Diamond game not found.");
    }
    if (!viewerPageMatches({ team, game, projection, loaded, page })) {
      throw makeError(
        "unavailable",
        "The public Diamond game changed while it was loading. Try again.",
      );
    }
    return {
      team,
      game,
      projection: core.sanitizeDiamondPublicProjection(projection),
    };
  }

  async function getDiamondState(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set(["teamId", "gameId", "visibility"]),
      makeError,
      "Diamond state request",
    );
    const teamId = normalizeId(data.teamId, "teamId");
    const gameId = normalizeId(data.gameId, "gameId");
    const caller = await loadEnabledAuthUser(context);
    if (data.visibility !== "private" && data.visibility != null) {
      throw makeError(
        "invalid-argument",
        "Raw Diamond state is private. Use getPublicDiamondGame for public viewing.",
      );
    }
    const attemptId = secureUuid(random, makeError, "Diamond state read");
    const initial = await loadAuthorizedHistoryState(
      teamId,
      gameId,
      caller,
    );
    const source = rosterReadSourceIdentity(initial, teamId);
    const reservation = await rosterReadAdmission.reserve({
      callerUid: caller.uid,
      teamId,
      gameId,
      operation: "state",
      sourceRevision: source.sourceRevision,
      input: { instanceId: source.instanceId, visibility: "private" },
      attemptId,
    });
    try {
      const roster = await loadRosterCandidates(
        firestore,
        teamId,
        initial.root.orientationSnapshot,
        { includeSource: true },
      );
      const final = await rosterReadAdmission.complete({
        reservation,
        authorize: async (transaction) => {
          const freshCaller = await loadEnabledAuthUser(context);
          const current = await loadAuthorizedHistoryState(
            teamId,
            gameId,
            freshCaller,
            transaction,
          );
          requireMatchingRosterReadSource(teamId, source, current);
          await requireMatchingOpponentRosterAccess(transaction, source, roster);
          return { caller: freshCaller, state: current };
        },
      });
      return buildPrivateSnapshot({
        state: final.state.checkpoint.state,
        root: { ...final.state.root, availablePlayers: roster.candidates },
        team: final.state.loaded.team,
        game: final.state.loaded.game,
        callerUid: final.caller.uid,
        canScore: final.state.loaded.access.scorekeeping,
        canManage: final.state.loaded.access.full,
        nowMs: normalizeNow(clock, makeError),
        core,
      });
    } catch (error) {
      await rosterReadAdmission.fail({ reservation });
      throw error;
    }
  }

  function publicProjectionIdentity(loaded) {
    const sourceRevision = Number(
      loaded.rawProjection.sourceRevision ?? loaded.rawProjection.revision,
    );
    const checkpointHash = loaded.rawProjection.checkpointHash;
    if (
      !Number.isSafeInteger(sourceRevision) ||
      sourceRevision < 1 ||
      sourceRevision > MAX_CANONICAL_EVENTS ||
      typeof checkpointHash !== "string" ||
      !SHA256_PATTERN.test(checkpointHash)
    ) {
      throw makeError(
        "unavailable",
        "The public Diamond projection identity is malformed. Try again.",
      );
    }
    return {
      instanceId: loaded.game.diamondScorebookInstanceId,
      sourceRevision,
      checkpointHash,
    };
  }

  function assertCursorMatchesProjection(cursor, identity, projectionHash) {
    if (!cursor) return;
    const matches =
      cursor.sourceRevision === identity.sourceRevision &&
      (cursor.kind === "bootstrap"
        ? cursor.checkpointHash === identity.checkpointHash
        : cursor.projectionHash === projectionHash);
    if (!matches) {
      throw makeError(
        "failed-precondition",
        "The public replay changed while paging. Refresh the replay.",
      );
    }
  }

  async function readBootstrapPublicEventPage({
    resourcePaths,
    loaded,
    limit,
    cursor,
  }) {
    const identity = publicProjectionIdentity(loaded);
    if (cursor?.kind === "replay") {
      throw makeError(
        "failed-precondition",
        "The public replay changed while paging. Refresh the replay.",
      );
    }
    assertCursorMatchesProjection(cursor, identity, null);
    const beforeSequence = cursor?.beforeSequence || 0;
    let querySnapshot;
    try {
      querySnapshot = await publicViewerEventsQuery(
        resourcePaths.publicEvents,
        beforeSequence,
        identity.sourceRevision,
        limit + 1,
      ).get();
    } catch {
      throw makeError(
        "unavailable",
        "The live Diamond event page could not be read completely. Try again.",
      );
    }
    const allDocuments = snapshotDocuments(querySnapshot);
    const allItems = allDocuments.map(snapshotData).filter(Boolean);
    for (const item of allItems) {
      if (
        item.instanceId !== identity.instanceId ||
        !Number.isSafeInteger(item.sequence) ||
        item.sequence < 1 ||
        item.sequence > identity.sourceRevision
      ) {
        throw makeError(
          "unavailable",
          "The live Diamond event page is stale or malformed. Try again.",
        );
      }
    }
    const items = allItems.slice(0, limit);
    const hasMore = allItems.length > limit;
    const nextCursor =
      hasMore && items.length
        ? bootstrapReplayCursor(
            identity.sourceRevision,
            identity.checkpointHash,
            items[items.length - 1].sequence,
          )
        : null;
    return {
      ...core.buildDiamondEventPage({
        events: items,
        limit,
        hasMore,
        nextCursor,
        readStatus: "complete",
        sourceRevision: identity.sourceRevision,
        visibility: "public",
      }),
      projectionToken: `bootstrap:${String(identity.sourceRevision)}:${identity.checkpointHash}`,
    };
  }

  function projectedEnvelopeMatches(
    value,
    teamId,
    gameId,
    identity,
    projectionHash,
  ) {
    return (
      isPlainObject(value) &&
      value.trackingEngine === DIAMOND_ENGINE &&
      value.teamId === teamId &&
      value.diamondGameId === gameId &&
      value.instanceId === identity.instanceId &&
      value.diamondScorebookInstanceId === identity.instanceId &&
      value.projectionGeneration === identity.instanceId &&
      value.sourceRevision === identity.sourceRevision &&
      value.checkpointHash === identity.checkpointHash &&
      value.projectionHash === projectionHash
    );
  }

  async function readProjectedPublicEventPage({
    teamId,
    gameId,
    resourcePaths,
    loaded,
    limit,
    cursor,
  }) {
    const identity = publicProjectionIdentity(loaded);
    const projectionHash = loaded.rawProjection.projectionHash;
    if (
      loaded.rawProjection.projectionStatus !== "complete" ||
      typeof projectionHash !== "string" ||
      !SHA256_PATTERN.test(projectionHash) ||
      loaded.game.diamondProjectionStatus !== "current" ||
      loaded.game.diamondProjectionRevision !== identity.sourceRevision ||
      loaded.game.diamondProjectionCheckpointHash !== identity.checkpointHash ||
      loaded.game.diamondProjectionHash !== projectionHash
    ) {
      throw makeError(
        "unavailable",
        "The authoritative Diamond replay is not internally consistent. Try again.",
      );
    }
    if (cursor?.kind === "bootstrap") {
      throw makeError(
        "failed-precondition",
        "The public replay changed while paging. Refresh the replay.",
      );
    }
    assertCursorMatchesProjection(cursor, identity, projectionHash);

    let manifest;
    try {
      manifest = snapshotData(
        await firestore.doc(resourcePaths.publicReplay).get(),
      );
    } catch {
      throw makeError(
        "unavailable",
        "The Diamond replay manifest could not be loaded completely. Try again.",
      );
    }
    const pageCount = manifest?.pageCount;
    const itemCount = manifest?.itemCount;
    const expectedPageCount = Number.isSafeInteger(itemCount)
      ? Math.ceil(itemCount / PUBLIC_REPLAY_PAGE_SIZE)
      : -1;
    if (
      !projectedEnvelopeMatches(
        manifest,
        teamId,
        gameId,
        identity,
        projectionHash,
      ) ||
      manifest.complete !== true ||
      manifest.collectionComplete !== true ||
      manifest.ordering !== "effective-source-revision" ||
      manifest.revisionGapsAllowed !== true ||
      manifest.pageSize !== PUBLIC_REPLAY_PAGE_SIZE ||
      !Number.isSafeInteger(pageCount) ||
      pageCount < 0 ||
      pageCount > Math.ceil(MAX_CANONICAL_EVENTS / PUBLIC_REPLAY_PAGE_SIZE) ||
      !Number.isSafeInteger(itemCount) ||
      itemCount < 0 ||
      itemCount > MAX_CANONICAL_EVENTS ||
      pageCount !== expectedPageCount ||
      manifest.firstPageId !== (pageCount ? "page-000001" : null) ||
      manifest.lastPageId !==
        (pageCount ? `page-${String(pageCount).padStart(6, "0")}` : null)
    ) {
      throw makeError(
        "unavailable",
        "The Diamond replay manifest is stale or malformed. Try again.",
      );
    }
    if (!pageCount) {
      if (cursor) {
        throw makeError(
          "failed-precondition",
          "The public replay changed while paging. Refresh the replay.",
        );
      }
      return {
        ...core.buildDiamondEventPage({
          events: [],
          limit,
          hasMore: false,
          nextCursor: null,
          readStatus: "complete",
          sourceRevision: identity.sourceRevision,
          visibility: "public",
        }),
        projectionToken: `current:${String(identity.sourceRevision)}:${projectionHash}`,
      };
    }

    let pageNumber = cursor?.pageNumber || pageCount;
    let offset = cursor?.offset || 0;
    if (
      pageNumber < 1 ||
      pageNumber > pageCount ||
      offset < 0 ||
      offset >= PUBLIC_REPLAY_PAGE_SIZE
    ) {
      throw makeError(
        "invalid-argument",
        "The public replay cursor is invalid.",
      );
    }
    const items = [];
    let nextPosition = null;
    while (items.length < limit && pageNumber >= 1) {
      const pageId = `page-${String(pageNumber).padStart(6, "0")}`;
      let page;
      try {
        page = snapshotData(
          await firestore.doc(resourcePaths.publicReplayPage(pageId)).get(),
        );
      } catch {
        throw makeError(
          "unavailable",
          "A Diamond replay page could not be loaded completely. Try again.",
        );
      }
      const expectedItemCount =
        pageNumber < pageCount
          ? PUBLIC_REPLAY_PAGE_SIZE
          : itemCount - PUBLIC_REPLAY_PAGE_SIZE * (pageCount - 1);
      if (
        !projectedEnvelopeMatches(
          page,
          teamId,
          gameId,
          identity,
          projectionHash,
        ) ||
        page.complete !== true ||
        page.ordering !== "effective-source-revision" ||
        page.revisionGapsAllowed !== true ||
        page.pageNumber !== pageNumber ||
        page.pageSize !== PUBLIC_REPLAY_PAGE_SIZE ||
        page.itemCount !== expectedItemCount ||
        !Array.isArray(page.items) ||
        page.items.length !== expectedItemCount ||
        (pageNumber < pageCount
          ? page.nextPageId !==
            `page-${String(pageNumber + 1).padStart(6, "0")}`
          : page.nextPageId !== null)
      ) {
        throw makeError(
          "unavailable",
          "A Diamond replay page is stale or malformed. Try again.",
        );
      }
      let previousRevision = 0;
      for (const event of page.items) {
        if (
          !isPlainObject(event) ||
          typeof event.eventId !== "string" ||
          !Number.isSafeInteger(event.revision) ||
          event.revision < 1 ||
          event.revision > identity.sourceRevision ||
          event.revision <= previousRevision
        ) {
          throw makeError(
            "unavailable",
            "A Diamond replay page contains malformed play evidence. Try again.",
          );
        }
        previousRevision = event.revision;
      }
      const descending = [...page.items].reverse();
      if (offset >= descending.length) {
        throw makeError(
          "invalid-argument",
          "The public replay cursor is invalid.",
        );
      }
      const available = descending.slice(offset);
      const remaining = limit - items.length;
      const taken = available.slice(0, remaining);
      items.push(...taken);
      if (taken.length < available.length) {
        nextPosition = {
          pageNumber,
          offset: offset + taken.length,
        };
        break;
      }
      if (pageNumber > 1) {
        nextPosition = { pageNumber: pageNumber - 1, offset: 0 };
      } else {
        nextPosition = null;
      }
      pageNumber -= 1;
      offset = 0;
    }
    const nextCursor = nextPosition
      ? projectedReplayCursor(
          identity.sourceRevision,
          projectionHash,
          nextPosition.pageNumber,
          nextPosition.offset,
        )
      : null;
    return {
      ...core.buildDiamondEventPage({
        events: items,
        limit,
        hasMore: Boolean(nextCursor),
        nextCursor,
        readStatus: "complete",
        sourceRevision: identity.sourceRevision,
        visibility: "public",
      }),
      projectionToken: `current:${String(identity.sourceRevision)}:${projectionHash}`,
    };
  }

  async function readPublicEventPage({
    teamId,
    gameId,
    limit,
    cursor,
    loadedPublicState = null,
  }) {
    const loaded = loadedPublicState || (await loadPublicState(teamId, gameId));
    const resourcePaths = paths(teamId, gameId);
    if (loaded.rawProjection.projectionStatus === "pending") {
      return readBootstrapPublicEventPage({
        resourcePaths,
        loaded,
        limit,
        cursor,
      });
    }
    return readProjectedPublicEventPage({
      teamId,
      gameId,
      resourcePaths,
      loaded,
      limit,
      cursor,
    });
  }

  async function readEventPage({
    teamId,
    gameId,
    visibility,
    limit,
    cursor,
    caller = null,
    context = null,
    privateReservation = null,
    loadedPublicState = null,
  }) {
    if (visibility === "public") {
      return readPublicEventPage({
        teamId,
        gameId,
        limit,
        cursor,
        loadedPublicState,
      });
    }
    const resourcePaths = paths(teamId, gameId);
    const state = await loadAuthorizedHistoryState(teamId, gameId, caller);
    requirePrivateNoteStorageVersion(state.root);
    const sourceRevision = state.checkpoint.sequence;
    const collectionPath = resourcePaths.events;
    let querySnapshot;
    try {
      const query = canonicalEventsQuery(
        collectionPath,
        cursor,
        limit + 1,
        sourceRevision,
      );
      querySnapshot = await query.get();
    } catch {
      throw makeError(
        "unavailable",
        "The Diamond event page could not be read completely. Try again.",
      );
    }
    const allDocuments = snapshotDocuments(querySnapshot);
    const pageDocuments = allDocuments.slice(0, limit);
    const canonicalItems = pageDocuments.map(snapshotData).filter(Boolean);
    const hasMore = allDocuments.length > limit;
    let expectedSequence = cursor + 1;
    for (const item of canonicalItems) {
      if (item.sequence !== expectedSequence) {
        throw makeError(
          "unavailable",
          "The Diamond event page is incomplete. Try again.",
        );
      }
      expectedSequence += 1;
    }
    if (
      !hasMore &&
      cursor < sourceRevision &&
      expectedSequence - 1 < sourceRevision
    ) {
      throw makeError(
        "unavailable",
        "The Diamond event page is incomplete. Try again.",
      );
    }
    if (!privateReservation) {
      throw makeError(
        "unavailable",
        "Private scorebook history admission is required. Try again.",
        { reason: "private-history-admission-missing", retryable: true },
      );
    }
    const noteEvents = canonicalItems.filter(
      (event) =>
        privateNoteCore.privateNotePayload(event) ||
        privateNoteCore.isCanonicalPrivateNoteMaterialEvent(event, domainEngine),
    );
    if (
      noteEvents.some(
        (event) =>
          !privateNoteCore.isCanonicalPrivateNoteMaterialEvent(
            event,
            domainEngine,
          ),
      )
    ) {
      throw makeError(
        "failed-precondition",
        "Legacy private-note history requires migration before it can be read.",
        { reason: "legacy-private-note-material" },
      );
    }
    let items = canonicalItems;
    if (noteEvents.length) {
      if (typeof firestore.getAll !== "function") {
        throw makeError(
          "unavailable",
          "Private-note records could not be loaded completely. Try again.",
        );
      }
      let noteSnapshots;
      try {
        noteSnapshots = await firestore.getAll(
          ...noteEvents.map((event) =>
            firestore.doc(resourcePaths.note(event.eventId)),
          ),
        );
      } catch {
        throw makeError(
          "unavailable",
          "Private-note records could not be loaded completely. Try again.",
        );
      }
      if (noteSnapshots.length !== noteEvents.length) {
        throw makeError(
          "unavailable",
          "Private-note records were incomplete. Try again.",
        );
      }
      const resolved = new Map();
      noteEvents.forEach((event, index) => {
        const noteSnapshot = noteSnapshots[index];
        if (!snapshotExists(noteSnapshot)) {
          throw makeError(
            "unavailable",
            "Private-note storage is incomplete. Try again.",
          );
        }
        try {
          const noteValue = snapshotData(noteSnapshot);
          if (noteValue?.status === "deleted") {
            privateNoteCore.parseDiamondPrivateNoteRedaction(
              noteValue,
              event,
              state.root.instanceId,
              domainEngine,
            );
            resolved.set(event.eventId, event);
          } else {
            resolved.set(
              event.eventId,
              privateNoteCore.hydrateDiamondPrivateNoteEvent(
                event,
                noteValue,
                state.root.instanceId,
                domainEngine,
              ),
            );
          }
        } catch (error) {
          if (error instanceof HttpsError || error instanceof DiamondHandlerError) {
            throw error;
          }
          throw makeError(
            "unavailable",
            "Private-note storage failed integrity validation. Try again.",
          );
        }
      });
      items = canonicalItems.map((event) => resolved.get(event.eventId) || event);
    }
    const response = buildByteBoundedPrivateEventPage({
      events: items,
      limit,
      hasMore,
      sourceRevision,
    });
    await completePrivateHistoryRead({
      teamId,
      gameId,
      context,
      expectedInstanceId: state.root.instanceId,
      sourceRevision,
      expectedPrivacyRevision: privateNotePrivacyRevision(state.root),
      reservation: privateReservation,
      responseEvidence: {
        sourceRevision,
        complete: response.complete,
        nextCursor: response.nextCursor,
        events: canonicalItems.map(({ eventId, sequence, revision, hash }) => ({
          eventId,
          sequence,
          revision,
          hash,
        })),
      },
    });
    return response;
  }

  async function listDiamondEvents(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set(["teamId", "gameId", "visibility", "limit", "cursor"]),
      makeError,
      "Diamond event request",
    );
    const teamId = normalizeId(data.teamId, "teamId");
    const gameId = normalizeId(data.gameId, "gameId");
    const callerUid = requireCallerUid(context);
    if (data.visibility !== "private" && data.visibility != null) {
      throw makeError(
        "invalid-argument",
        "Raw Diamond events are private. Use getPublicDiamondGame for public replay.",
      );
    }
    const visibility = "private";
    const limit = normalizePageLimit(data.limit, makeError);
    const cursor = normalizeSequenceCursor(data.cursor, makeError);
    const attemptHash = core.hashDiamondValue({
      schemaVersion: 1,
      type: "diamond-private-history-read-attempt",
      attemptId: secureUuid(random, makeError, "private history read"),
    });
    const admitted = await reservePrivateHistoryReadWithReconciliation({
      request: { teamId, gameId, limit, cursor },
      callerUid,
      attemptHash,
    });
    try {
      const caller = await loadEnabledAuthUser(context);
      return await readEventPage({
        teamId,
        gameId,
        visibility,
        limit,
        cursor,
        caller,
        context,
        privateReservation: admitted,
      });
    } catch (error) {
      await failPrivateHistoryRead(
        admitted,
        error?.details?.reason || error?.code || "private-history-failed",
      );
      throw error;
    }
  }

  async function getPublicDiamondGame(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set(["teamId", "gameId", "limit", "cursor"]),
      makeError,
      "Public Diamond game request",
    );
    const teamId = normalizeId(data.teamId, "teamId");
    const gameId = normalizeId(data.gameId, "gameId");
    const limit = normalizePageLimit(data.limit, makeError);
    const cursor = normalizePublicReplayCursor(data.cursor, makeError);
    const loaded = await loadPublicState(teamId, gameId, context);
    const page = await readEventPage({
      teamId,
      gameId,
      visibility: "public",
      limit,
      cursor,
      loadedPublicState: loaded,
    });
    const events = page.items.map((event) => {
      const inning = isPlainObject(event.inning)
        ? event.inning.number
        : event.inning;
      const half = isPlainObject(event.inning) ? event.inning.half : event.half;
      const createdAt =
        compactText(event.createdAt, 80) ||
        (Number.isSafeInteger(event.serverTimestampMs)
          ? timestampIso(event.serverTimestampMs)
          : "");
      return {
        id: event.eventId || `revision-${String(event.revision)}`,
        revision: event.revision,
        inning,
        half,
        type: event.type,
        description: event.description,
        createdAt,
        voidsEventId:
          typeof event.voidsEventId === "string" ? event.voidsEventId : null,
        supersedesEventId:
          typeof event.supersedesEventId === "string"
            ? event.supersedesEventId
            : null,
        isCorrection:
          event.corrected === true ||
          ["void_event", "supersede_event"].includes(event.type),
        isScoringPlay: ["record_plate_appearance", "advance_runner"].includes(
          event.type,
        ),
        score: event.score || null,
      };
    });
    const fresh = await reauthorizePublicGamePage({
      teamId,
      gameId,
      loaded,
      page,
      context,
    });
    let interactionWindowOpen = false;
    try {
      const gameLifecycle = fresh.game.diamondLifecycle;
      const projectionLifecycle = fresh.projection.lifecycle;
      if (
        typeof gameLifecycle === "string" &&
        gameLifecycle === gameLifecycle.trim() &&
        gameLifecycle === gameLifecycle.toLowerCase() &&
        gameLifecycle === projectionLifecycle
      ) {
        interactionWindowOpen = isDiamondInteractionWindowOpen({
          team: fresh.team,
          game: fresh.game,
          lifecycle: gameLifecycle,
          nowMillis: normalizeNow(clock, makeError),
        });
      }
    } catch {
      // The public score stays readable when server time is unavailable, but
      // interactive controls remain closed until a later authoritative read.
      interactionWindowOpen = false;
    }
    return {
      instanceId: fresh.game.diamondScorebookInstanceId,
      game: buildLegacyViewerGame({
        team: fresh.team,
        game: fresh.game,
        projection: fresh.projection,
        publicGameApi,
        interactionWindowOpen,
      }),
      events,
      nextCursor: page.nextCursor,
      complete: page.collectionComplete,
      truncated: page.truncated,
      sourceRevision: page.sourceRevision,
      projectionToken: page.projectionToken,
      diamondStats: projections.serializeDiamondPublicStatsResponse({
        game: fresh.game,
        teamId,
        gameId,
      }),
    };
  }

  async function parseDiamondVoice(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set([
        "teamId",
        "gameId",
        "expectedRevision",
        "rulesProfileId",
        "rulesProfileVersion",
        "transcript",
      ]),
      makeError,
      "Diamond voice request",
    );
    const teamId = normalizeId(data.teamId, "teamId");
    const gameId = normalizeId(data.gameId, "gameId");
    const expectedRevision = normalizeOptionalRevision(
      data.expectedRevision,
      makeError,
    );
    if (expectedRevision === null)
      throw makeError("invalid-argument", "expectedRevision is required.");
    const rulesProfileId = normalizeId(data.rulesProfileId, "rulesProfileId");
    const rulesProfileVersion = normalizeOptionalRevision(
      data.rulesProfileVersion,
      makeError,
      "rulesProfileVersion",
    );
    if (!rulesProfileVersion)
      throw makeError(
        "invalid-argument",
        "rulesProfileVersion must be positive.",
      );
    if (typeof data.transcript !== "string")
      throw makeError(
        "invalid-argument",
        "A dictation transcript is required.",
      );
    const transcript = data.transcript.replace(/\s+/g, " ").trim();
    if (!transcript || transcript.length > 2000) {
      throw makeError(
        "invalid-argument",
        "Dictation must be between 1 and 2,000 characters.",
      );
    }
    const attemptId = secureUuid(random, makeError, "Diamond voice read");
    const caller = await loadEnabledAuthUser(context);
    const initial = requireVoiceReadSource(
      await loadAuthorizedHistoryState(teamId, gameId, caller),
      { expectedRevision, rulesProfileId, rulesProfileVersion },
    );
    const source = rosterReadSourceIdentity(initial, teamId);
    const reservation = await rosterReadAdmission.reserve({
      callerUid: caller.uid,
      teamId,
      gameId,
      operation: "voice",
      sourceRevision: source.sourceRevision,
      input: {
        instanceId: source.instanceId,
        rulesProfileId,
        rulesProfileVersion,
        transcript,
      },
      attemptId,
    });
    try {
      const proposal = core.validateDiamondVoiceProposal(
        /^(next|advance)( the)? half( inning)?[.!]?$/i.test(transcript) ||
        /^switch sides[.!]?$/i.test(transcript)
          ? {
              schemaVersion: 1,
              type: "advance_half_inning",
              payload: {},
              confidence: 0.9,
              unresolvedFields: [],
              requiresConfirmation: true,
              mutatesState: false,
            }
          : {
              schemaVersion: 1,
              type: "record_plate_appearance",
              payload: {},
              confidence: 0,
              unresolvedFields: [
                "batterId",
                "pitcherId",
                "result",
                "batterAdvance",
                "runnerAdvances",
                "outsOnPlay",
              ],
              requiresConfirmation: true,
              mutatesState: false,
            },
      );
      await rosterReadAdmission.complete({
        reservation,
        authorize: async (transaction) => {
          const freshCaller = await loadEnabledAuthUser(context);
          const current = requireVoiceReadSource(
            await loadAuthorizedHistoryState(
              teamId,
              gameId,
              freshCaller,
              transaction,
            ),
            { expectedRevision, rulesProfileId, rulesProfileVersion },
          );
          requireMatchingRosterReadSource(teamId, source, current);
        },
      });
      return proposal;
    } catch (error) {
      await rosterReadAdmission.fail({ reservation });
      if (
        error instanceof HttpsError ||
        error instanceof DiamondHandlerError
      ) {
        throw error;
      }
      logger.error?.("diamond_voice_proposal_rejected", {
        code: error?.code || "invalid-proposal",
      });
      throw makeError(
        "internal",
        "The voice proposal could not be validated. No play was recorded.",
      );
    }
  }

  function projectionRegenerationHead(root, game, teamId, gameId, checkpoint) {
    const current = checkpoint || buildCheckpointFromRoot(root);
    if (
      !root ||
      root.schemaVersion !== 2 ||
      root.trackingEngine !== DIAMOND_ENGINE ||
      root.teamId !== teamId ||
      root.gameId !== gameId ||
      !UUID_V4_PATTERN.test(root.instanceId || "") ||
      root.instanceId !== root.instanceId.toLowerCase() ||
      game?.trackingEngine !== DIAMOND_ENGINE ||
      game.diamondScorebookInstanceId !== root.instanceId ||
      !isPlainObject(root.initialState) ||
      !isPlainObject(current) ||
      !isPlainObject(current.state) ||
      current.teamId !== teamId ||
      current.gameId !== gameId ||
      current.rulesProfileId !== root.rulesProfileId ||
      current.rulesProfileVersion !== root.rulesProfileVersion ||
      current.captureMode !== root.captureMode ||
      !Number.isSafeInteger(current.sequence) ||
      current.sequence < 0 ||
      current.state.revision !== current.sequence ||
      !SHA256_PATTERN.test(current.previousHash || "") ||
      current.state.checkpointHash !== current.previousHash
    ) {
      throw makeError("failed-precondition", "The Diamond checkpoint is malformed.");
    }
    const stat = validateCommittedStatConfigSnapshot(root, game, teamId);
    const orientationSnapshot = validateCommittedOrientationSnapshot(root, teamId);
    return {
      instanceId: root.instanceId,
      sourceRevision: current.sequence,
      checkpointHash: current.previousHash,
      statConfigSnapshotHash: stat.snapshotHash,
      orientationSnapshotHash: core.hashDiamondValue(orientationSnapshot),
      checkpointDigest: core.hashDiamondValue({
        schemaVersion: root.schemaVersion,
        trackingEngine: root.trackingEngine,
        instanceId: root.instanceId,
        teamId,
        gameId,
        rulesProfileId: root.rulesProfileId,
        rulesProfileVersion: root.rulesProfileVersion,
        captureMode: root.captureMode,
        initialState: root.initialState,
        checkpoint: current,
        statConfigSnapshot: root.statConfigSnapshot,
        orientationSnapshot: root.orientationSnapshot,
      }),
    };
  }

  function projectionRegenerationRefs(resourcePaths, request) {
    const key = (kind, value) =>
      `${resourcePaths.scorebook}/audit/projection-regeneration-${kind}-${core.hashDiamondValue(value).slice(7)}`;
    return {
      receipt: firestore.doc(key("receipt", [request.actorUid, request.requestId])),
      rate: firestore.doc(key("rate", request.actorUid)),
      claim: firestore.doc(`${resourcePaths.scorebook}/audit/projection-regeneration-claim`),
      audit: (attemptId) =>
        firestore.doc(key("requested", [request.requestHash, attemptId])),
    };
  }

  function projectionRegenerationCoordinationHash(root) {
    return core.hashDiamondValue({
      projectionFailure: root?.projectionFailure ?? null,
      projectionLease: root?.projectionLease ?? null,
      projectionRequest: root?.projectionRequest ?? null,
      projectionStatus: root?.projectionStatus ?? null,
      projectionMarker: root?.diamondProjectionMarker ?? null,
    });
  }

  function parseRegenerationControl(snapshot, type, teamId, gameId, nowMs) {
    if (snapshot?.exists !== true) return null;
    const value = regeneration.parseProjectionRegenerationControl(
      snapshotData(snapshot),
      { type, teamId, gameId, nowMs },
    );
    if (value) return value;
    const updatedAtMs = snapshot?.updateTime?.toMillis?.();
    if (
      Number.isSafeInteger(updatedAtMs) &&
      updatedAtMs + regeneration.PROJECTION_REGENERATION_RESERVATION_MS <= nowMs
    ) {
      return null;
    }
    throw makeError(
      "unavailable",
      "Projection regeneration safety state is unavailable. Try again later.",
      { reason: "projection-regeneration-control-invalid" },
    );
  }

  function parseRegenerationControls(
    snapshots,
    teamId,
    gameId,
    nowMs,
    receipt = null,
  ) {
    return {
      receipt:
        receipt ||
        parseRegenerationControl(
          snapshots[0],
          "projection-regeneration-receipt",
          teamId,
          gameId,
          nowMs,
        ),
      rate: parseRegenerationControl(
        snapshots[1],
        "projection-regeneration-rate",
        teamId,
        gameId,
        nowMs,
      ),
      claim: parseRegenerationControl(
        snapshots[2],
        "projection-regeneration-claim",
        teamId,
        gameId,
        nowMs,
      ),
    };
  }

  async function loadRegenerationAccess(reader, teamId, gameId, caller) {
    const loaded = await loadAccessDocuments(reader, teamId, gameId, caller);
    requireManager(
      loaded.access,
      "Only a current team manager can regenerate Diamond projections.",
    );
    requireAllowed(
      core.decideDiamondOperation({
        operation: "project",
        policy: null,
        teamId,
        game: loaded.game,
      }),
      "This game is not owned by Diamond v2.",
    );
    return loaded;
  }

  function failRegenerationAttempt(transaction, refs, controls, code, nowMs) {
    const failed = regeneration.failProjectionRegenerationAttempt(
      controls,
      code,
      nowMs,
    );
    transaction.set(refs.receipt, failed.receipt);
    transaction.set(refs.claim, failed.claim);
  }

  function writeRegenerationControls(transaction, refs, controls) {
    for (const key of ["receipt", "rate", "claim"]) {
      if (controls[key]) transaction.set(refs[key], controls[key]);
    }
  }

  function projectionClaimProven(root, head, claim) {
    if (
      claim?.status !== "accepted" ||
      !regeneration.sameProjectionRegenerationHead(head, claim.resultHead)
    ) return false;
    const request = root.projectionRequest;
    if (
      root.projectionStatus === "pending" &&
      request?.type === "projection-regeneration" &&
      request.attemptId === claim.attemptId &&
      request.requestedBy === claim.ownerUid &&
      UUID_V4_PATTERN.test(request.requestId || "") &&
      SHA256_PATTERN.test(request.requestHash || "") &&
      regeneration.sameProjectionRegenerationHead(
        request.sourceHead,
        claim.sourceHead,
      ) &&
      regeneration.sameProjectionRegenerationHead(
        request.resultHead,
        claim.resultHead,
      ) &&
      regeneration.sameProjectionRegenerationHead(request.resultHead, head)
    ) return true;
    const marker = root.diamondProjectionMarker;
    return Boolean(
      root.projectionStatus === "complete" &&
        marker?.status === "current" &&
        marker.instanceId === head.instanceId &&
        marker.sourceRevision === head.sourceRevision &&
        marker.checkpointHash === head.checkpointHash &&
        marker.statConfigSnapshotHash === head.statConfigSnapshotHash &&
        marker.orientationSnapshotHash === head.orientationSnapshotHash,
    );
  }

  function projectionWorkUntil(root, head, nowMs) {
    const lease = root.projectionLease;
    if (
      lease?.instanceId === head.instanceId &&
      lease.sourceRevision === head.sourceRevision &&
      lease.checkpointHash === head.checkpointHash &&
      lease.statConfigSnapshotHash === head.statConfigSnapshotHash &&
      lease.orientationSnapshotHash === head.orientationSnapshotHash &&
      Number.isSafeInteger(lease.expiresAtMs) &&
      lease.expiresAtMs > nowMs
    ) return lease.expiresAtMs;
    const request = root.projectionRequest;
    const requestedAtMs = Date.parse(request?.requestedAt || "");
    if (
      root.projectionStatus === "pending" &&
      request?.sourceRevision === head.sourceRevision &&
      Number.isSafeInteger(requestedAtMs) &&
      requestedAtMs <= nowMs &&
      requestedAtMs + regeneration.PROJECTION_REGENERATION_RESERVATION_MS > nowMs
    ) return requestedAtMs + regeneration.PROJECTION_REGENERATION_RESERVATION_MS;
    return null;
  }

  function regenerationResponse(receipt, deduplicated = true) {
    return {
      regenerated: false,
      regenerationQueued: true,
      deduplicated,
      projectionStatus: receipt.resultProjectionStatus,
      revision: receipt.resultRevision,
      notificationsSuppressed: true,
    };
  }

  function throwRegenerationPlan(plan, nowMs) {
    if (plan.reason === "idempotency-conflict") {
      throw makeError("already-exists", "requestId was already used with different regeneration inputs.");
    }
    if (plan.reason === "stale-head") {
      throw makeError("aborted", "The scorebook changed before regeneration began.");
    }
    throw makeError(
      "resource-exhausted",
      "Projection regeneration is already reserved. Retry with the same requestId.",
      {
        reason:
          plan.reason === "rate-limited"
            ? "projection-regeneration-rate-limited"
            : "projection-regeneration-in-progress",
        retryAfterMs: Math.max(0, (plan.retryAtMs || nowMs) - nowMs),
      },
    );
  }

  async function regenerateDiamondProjection(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set(["requestId", "teamId", "gameId", "expectedRevision"]),
      makeError,
      "Projection regeneration request",
    );
    const requestId = normalizeUuid(data.requestId, "requestId");
    const teamId = normalizeId(data.teamId, "teamId");
    const gameId = normalizeId(data.gameId, "gameId");
    const expectedRevision = normalizeOptionalRevision(data.expectedRevision, makeError);
    const nowMs = normalizeNow(clock, makeError);
    let attemptId = null;
    const getAttemptId = () => {
      if (!attemptId) {
        attemptId = secureUuid(
          random,
          makeError,
          "projection regeneration attempt",
        );
      }
      return attemptId;
    };
    const resourcePaths = paths(teamId, gameId);
    let caller = await loadEnabledAuthUser(context);
    const request = {
      actorUid: caller.uid,
      requestId,
      requestHash: core.hashDiamondValue({
        schemaVersion: 1,
        type: "projection-regeneration",
        actorUid: caller.uid,
        requestId,
        teamId,
        gameId,
        expectedRevision,
      }),
    };
    const refs = projectionRegenerationRefs(resourcePaths, request);
    const sharedAdmissionIdentities = commandHistorySharedAdmissionIdentities(
      teamId,
      gameId,
      caller.uid,
    );

    const readControlSnapshots = (reader) =>
      Promise.all([
        reader.get(refs.receipt),
        reader.get(refs.rate),
        reader.get(refs.claim),
      ]);
    const parseReceipt = (snapshot, atMs) =>
      parseRegenerationControl(
        snapshot,
        "projection-regeneration-receipt",
        teamId,
        gameId,
        atMs,
      );
    const parseControls = (snapshots, atMs, receipt = null) =>
      parseRegenerationControls(snapshots, teamId, gameId, atMs, receipt);
    const readState = async (reader, activeCaller, atMs) => {
      const [loaded, rootSnapshot, controlSnapshots] = await Promise.all([
        loadRegenerationAccess(reader, teamId, gameId, activeCaller),
        reader.get(firestore.doc(resourcePaths.scorebook)),
        readControlSnapshots(reader),
      ]);
      const root = snapshotData(rootSnapshot);
      return {
        loaded,
        root,
        controlSnapshots,
        receipt: parseReceipt(controlSnapshots[0], atMs),
      };
    };
    const controlsMatch = (controls, head, coordinationHash, atMs) =>
      regeneration.reservationControlsMatch({
        ...controls,
        request,
        head,
        coordinationHash,
        attemptId,
        nowMs: atMs,
      });

    const readReservation = async (transaction, activeCaller, reconcile = false) => {
      const { root, loaded, controlSnapshots, receipt } = await readState(
        transaction,
        activeCaller,
        nowMs,
      );
      const early = regeneration.planProjectionRegeneration({
        nowMs,
        request,
        receipt,
      });
      if (early.action === "accepted") return { kind: "accepted", receipt };
      if (early.reason === "idempotency-conflict") throwRegenerationPlan(early, nowMs);
      if (!root) throw makeError("not-found", "Diamond scorebook not found.");
      const head = projectionRegenerationHead(root, loaded.game, teamId, gameId);
      const coordinationHash = projectionRegenerationCoordinationHash(root);
      const controls = parseControls(controlSnapshots, nowMs, receipt);
      const { rate, claim } = controls;
      if (reconcile) {
        if (!attemptId) {
          throw makeError(
            "unavailable",
            "The regeneration reservation could not be confirmed. Retry with the same requestId.",
          );
        }
        if (controlsMatch(controls, head, coordinationHash, nowMs)) {
          return { kind: "reserved", root, head, coordinationHash, controls };
        }
        throw makeError(
          "unavailable",
          "The regeneration reservation could not be confirmed. Retry with the same requestId.",
        );
      }
      const plan = regeneration.planProjectionRegeneration({
        nowMs,
        request,
        head,
        expectedRevision,
        receipt,
        rate,
        claim,
        claimProven: projectionClaimProven(root, head, claim),
        rootWorkUntilMs: projectionWorkUntil(root, head, nowMs),
      });
      if (plan.action === "accepted") return { kind: "accepted", receipt };
      if (plan.action === "reject") throwRegenerationPlan(plan, nowMs);
      if (plan.action.startsWith("follow-")) {
        const followerAttemptId =
          receipt?.status === "blocked" ? receipt.attemptId : getAttemptId();
        const follower = regeneration.buildProjectionRegenerationFollower({
          teamId,
          gameId,
          request,
          head,
          coordinationHash,
          receiptAttemptId: followerAttemptId,
          blockedByAttemptId: plan.claim?.attemptId || followerAttemptId,
          nowMs,
          acceptedClaim: plan.action === "follow-accepted" ? plan.claim : null,
          reason: plan.reason,
          retryAtMs: plan.retryAtMs,
        });
        writeRegenerationControls(transaction, refs, follower);
        return plan.action === "follow-accepted"
          ? { kind: "accepted", receipt: follower.receipt }
          : { kind: "blocked", plan };
      }
      const newControls = regeneration.buildProjectionRegenerationControls({
        teamId,
        gameId,
        request,
        head,
        coordinationHash,
        attemptId: getAttemptId(),
        nowMs,
      });
      const requestedReadUnits = Math.max(1, head.sourceRevision);
      const sharedAdmission = await planCommandHistoryWork(
        transaction,
        sharedAdmissionIdentities,
        {
          requestedHistoryReadUnits: requestedReadUnits,
          requestedProjectionReadUnits: requestedReadUnits,
          nowMs,
        },
      );
      writeRegenerationControls(transaction, refs, newControls);
      writeCommandHistoryWork(transaction, sharedAdmission);
      return {
        kind: "reserved",
        root,
        head,
        coordinationHash,
        controls: newControls,
      };
    };

    let reserved;
    try {
      reserved = await firestore.runTransaction((transaction) =>
        readReservation(transaction, caller),
      );
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError) throw error;
      caller = await loadEnabledAuthUser(context);
      try {
        reserved = await firestore.runTransaction((transaction) =>
          readReservation(transaction, caller, true),
        );
      } catch (reconcileError) {
        if (reconcileError instanceof HttpsError || reconcileError instanceof DiamondHandlerError)
          throw reconcileError;
        throw makeError(
          "unavailable",
          "The regeneration reservation could not be confirmed. Retry with the same requestId.",
        );
      }
    }
    if (reserved.kind === "accepted") return regenerationResponse(reserved.receipt);
    if (reserved.kind === "blocked") throwRegenerationPlan(reserved.plan, nowMs);

    let history;
    try {
      const events = await loadAllCanonicalEvents(teamId, gameId);
      history = validateCompleteHistory(reserved.root, events);
    } catch (error) {
      const failureNowMs = normalizeNow(clock, makeError);
      try {
        await firestore.runTransaction(async (transaction) => {
          const controls = parseControls(
            await readControlSnapshots(transaction),
            failureNowMs,
          );
          if (!controlsMatch(controls, reserved.head, reserved.coordinationHash, failureNowMs)) return;
          const code = error?.code === "failed-precondition" ? "history-invalid" : "history-unavailable";
          failRegenerationAttempt(
            transaction,
            refs,
            controls,
            code,
            failureNowMs,
          );
        });
      } catch (failureError) {
        logger.error?.("diamond_projection_regeneration_failure_state", {
          code: failureError?.code || "write-failed",
        });
      }
      throw error;
    }

    const { checkpoint, replay } = history;
    const repairedCheckpoint = {
      teamId,
      gameId,
      rulesProfileId: reserved.root.rulesProfileId,
      rulesProfileVersion: reserved.root.rulesProfileVersion,
      captureMode: reserved.root.captureMode,
      sequence: checkpoint.sequence,
      previousHash: checkpoint.previousHash,
      state: replay.state,
    };
    caller = await loadEnabledAuthUser(context);
    const commitNowMs = normalizeNow(clock, makeError);
    try {
      const result = await firestore.runTransaction(async (transaction) => {
        const state = await readState(
          transaction,
          caller,
          commitNowMs,
        );
        const { loaded, root } = state;
        if (!root) throw makeError("not-found", "Diamond scorebook not found.");
        const sourceHead = projectionRegenerationHead(
          root,
          loaded.game,
          teamId,
          gameId,
        );
        const coordinationHash = projectionRegenerationCoordinationHash(root);
        const controls = parseControls(
          state.controlSnapshots,
          commitNowMs,
          state.receipt,
        );
        const rootRef = firestore.doc(resourcePaths.scorebook);
        if (
          !regeneration.sameProjectionRegenerationHead(sourceHead, reserved.head) ||
          !controlsMatch(
            controls,
            reserved.head,
            reserved.coordinationHash,
            commitNowMs,
          )
        ) {
          throw makeError("aborted", "The scorebook changed while regeneration was running. Try again.");
        }
        if (coordinationHash !== reserved.coordinationHash) {
          throw makeError("aborted", "Projection work changed while regeneration was running. Try again.");
        }
        const resultHead = projectionRegenerationHead(
          root,
          loaded.game,
          teamId,
          gameId,
          repairedCheckpoint,
        );
        const accepted = regeneration.acceptProjectionRegenerationAttempt(
          controls,
          resultHead,
          commitNowMs,
        );
        const projectionRequest = {
          schemaVersion: 1,
          type: "projection-regeneration",
          requestId,
          requestHash: request.requestHash,
          attemptId,
          requestedBy: caller.uid,
          sourceRevision: resultHead.sourceRevision,
          sourceHead: reserved.head,
          resultHead,
          requestedAt: timestampIso(commitNowMs),
        };
        const nextRoot = {
          ...root,
          checkpoint: repairedCheckpoint,
          projectionStatus: "pending",
          projectionLease: null,
          projectionFailure: null,
          projectionRequest,
        };
        transaction.update(rootRef, {
          checkpoint: repairedCheckpoint,
          projectionStatus: "pending",
          projectionLease: null,
          projectionFailure: null,
          projectionRequest,
          updatedAt: timestampIso(commitNowMs),
        });
        transaction.update(loaded.gameRef, gameProjectionPatch(replay.state, "pending"));
        transaction.create(refs.audit(attemptId), {
          schemaVersion: 1,
          trackingEngine: DIAMOND_ENGINE,
          teamId,
          gameId,
          instanceId: root.instanceId,
          type: "projection-regeneration-requested",
          sourceRevision: replay.state.revision,
          actorUid: caller.uid,
          createdAt: timestampIso(commitNowMs),
          notificationsSuppressed: true,
        });
        transaction.set(refs.receipt, accepted.receipt);
        transaction.set(refs.claim, accepted.claim);
        return {
          ...regenerationResponse(accepted.receipt, false),
          state: buildPrivateSnapshot({
            state: replay.state,
            root: nextRoot,
            team: loaded.team,
            game: loaded.game,
            callerUid: caller.uid,
            canScore: loaded.access.scorekeeping,
            canManage: loaded.access.full,
            nowMs: commitNowMs,
            core,
          }),
        };
      });
      return result;
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError) throw error;
      caller = await loadEnabledAuthUser(context);
      try {
        const reconciled = await firestore.runTransaction(async (transaction) => {
          const reconcileNowMs = normalizeNow(clock, makeError);
          const [, snapshots] = await Promise.all([
            loadRegenerationAccess(transaction, teamId, gameId, caller),
            readControlSnapshots(transaction),
          ]);
          const receipt = parseReceipt(snapshots[0], reconcileNowMs);
          const plan = regeneration.planProjectionRegeneration({
            nowMs: reconcileNowMs,
            request,
            head: reserved.head,
            receipt,
          });
          if (plan.action === "accepted") return receipt;
          const controls = parseControls(snapshots, reconcileNowMs, receipt);
          if (
            controlsMatch(
              controls,
              reserved.head,
              reserved.coordinationHash,
              reconcileNowMs,
            )
          ) {
            failRegenerationAttempt(
              transaction,
              refs,
              controls,
              "commit-rejected",
              reconcileNowMs,
            );
          }
          return null;
        });
        if (reconciled) return regenerationResponse(reconciled);
      } catch (reconcileError) {
        if (reconcileError instanceof HttpsError || reconcileError instanceof DiamondHandlerError)
          throw reconcileError;
      }
      throw makeError(
        "unavailable",
        "The regeneration commit could not be confirmed. Retry with the same requestId.",
      );
    }
  }

  async function cleanupDeletedDiamondGame(snapshot) {
    const deletedGame = snapshotData(snapshot);
    const match = /^teams\/([^/]+)\/games\/([^/]+)$/.exec(
      snapshot?.ref?.path || "",
    );
    if (!match || !deletedGame) {
      throw makeError(
        "invalid-argument",
        "Deleted Diamond game snapshot is invalid.",
      );
    }
    const teamId = normalizeId(match[1], "teamId");
    const gameId = normalizeId(match[2], "gameId");
    const deletedGameDecision = core.decideDiamondDeletionCleanup({
      deletedGame,
    });
    if (deletedGameDecision.action === "ignore") {
      return {
        cleaned: deletedGameDecision.complete === true,
        retained: false,
        reason: deletedGameDecision.code,
      };
    }
    const resourcePaths = paths(teamId, gameId);
    const sharedGameResolution = getCleanupSharedGamePath(deletedGame);
    if (!sharedGameResolution.valid) {
      return {
        cleaned: false,
        retained: true,
        reason: "shared-game-binding-unverifiable",
      };
    }
    const sharedGamePath = sharedGameResolution.path;
    const siblingSpecs = [
      {
        key: "aggregatedStats",
        path: resourcePaths.aggregatedStats,
        maximum: MAX_CLEANUP_PLAYER_STAT_DOCUMENTS,
      },
      {
        key: "privatePlayerStats",
        path: resourcePaths.privatePlayerStats,
        maximum: MAX_CLEANUP_PLAYER_STAT_DOCUMENTS,
      },
      {
        key: "teamStats",
        path: resourcePaths.teamStats,
        maximum: MAX_CLEANUP_TEAM_STAT_DOCUMENTS,
      },
    ];
    const deletedGeneration =
      typeof deletedGame.diamondScorebookInstanceId === "string"
        ? deletedGame.diamondScorebookInstanceId.trim()
        : "";
    const interactionSpecs = (
      deletedGame.trackingEngine === DIAMOND_ENGINE &&
      UUID_V4_PATTERN.test(deletedGeneration)
        ? DIAMOND_INTERACTION_COLLECTIONS
        : []
    ).map((collectionId) => ({
      key: collectionId,
      path: `${resourcePaths.diamondLiveGeneration(deletedGeneration)}/${collectionId}`,
    }));
    const ownedInteractionQuery = (spec, generation, maximum = 1) =>
      firestore
        .collection(spec.path)
        .where("trackingEngine", "==", DIAMOND_ENGINE)
        .where("teamId", "==", teamId)
        .where("gameId", "==", gameId)
        .where("instanceId", "==", generation)
        .limit(maximum);

    const throwCleanupUnavailable = (message) => {
      throw makeError("unavailable", message, {
        retryable: true,
        operation: "diamond-cleanup",
      });
    };
    const isCleanupUnavailable = (error) =>
      error?.code === "unavailable" &&
      error?.details?.retryable === true &&
      error?.details?.operation === "diamond-cleanup";
    const readInventory = async (
      reader = null,
      interactionGeneration = deletedGeneration,
    ) => {
      const read = (reference) =>
        reader ? reader.get(reference) : reference.get();
      const siblingQueries = siblingSpecs.map((spec) =>
        firestore.collection(spec.path).limit(spec.maximum + 1),
      );
      const scorebookChildQueries = SCOREBOOK_CHILD_COLLECTIONS.map(
        (collectionId) =>
          firestore
            .collection(resourcePaths.scorebookChildCollection(collectionId))
            .limit(1),
      );
      const interactionAnyQueries = interactionSpecs.map((spec) =>
        firestore.collection(spec.path).limit(1),
      );
      const interactionOwnedQueries = interactionSpecs.map((spec) =>
        ownedInteractionQuery(spec, interactionGeneration),
      );
      const references = [
        firestore.doc(resourcePaths.scorebook),
        firestore.doc(resourcePaths.publicState),
        firestore.doc(resourcePaths.publicReplay),
        firestore
          .collection(resourcePaths.publicReplayPages)
          .limit(MAX_PUBLIC_REPLAY_PAGES + 1),
        firestore.doc(resourcePaths.cleanupLock),
        ...siblingQueries,
        ...scorebookChildQueries,
        firestore.collection(resourcePaths.publicStateEvents).limit(1),
        ...interactionAnyQueries,
        ...interactionOwnedQueries,
        ...(sharedGamePath ? [firestore.doc(sharedGamePath)] : []),
      ];
      const values = await Promise.all(references.map(read));
      let cursor = 0;
      const inventory = {
        rootSnapshot: values[cursor++],
        publicSnapshot: values[cursor++],
        replaySnapshot: values[cursor++],
        replayPagesSnapshot: values[cursor++],
        lockSnapshot: values[cursor++],
        siblingSnapshots: Object.create(null),
        scorebookChildSnapshots: Object.create(null),
        interactionAnySnapshots: Object.create(null),
        interactionOwnedSnapshots: Object.create(null),
      };
      siblingSpecs.forEach((spec) => {
        inventory.siblingSnapshots[spec.key] = values[cursor++];
      });
      SCOREBOOK_CHILD_COLLECTIONS.forEach((collectionId) => {
        inventory.scorebookChildSnapshots[collectionId] = values[cursor++];
      });
      inventory.publicEventsSnapshot = values[cursor++];
      interactionSpecs.forEach((spec) => {
        inventory.interactionAnySnapshots[spec.key] = values[cursor++];
      });
      interactionSpecs.forEach((spec) => {
        inventory.interactionOwnedSnapshots[spec.key] = values[cursor++];
      });
      inventory.sharedSnapshot = sharedGamePath ? values[cursor++] : null;
      return inventory;
    };
    const assertInventoryComplete = (inventory) => {
      if (
        snapshotDocuments(inventory.replayPagesSnapshot).length >
        MAX_PUBLIC_REPLAY_PAGES
      ) {
        throwCleanupUnavailable(
          "Diamond replay cleanup inventory exceeded its safe bound and will be retried.",
        );
      }
      siblingSpecs.forEach((spec) => {
        if (
          snapshotDocuments(inventory.siblingSnapshots[spec.key]).length >
          spec.maximum
        ) {
          throwCleanupUnavailable(
            "Diamond stat cleanup inventory exceeded its safe bound and will be retried.",
          );
        }
      });
    };
    const inventoryHasAnyDescendant = (inventory) =>
      Boolean(
        snapshotData(inventory.rootSnapshot) ||
        snapshotData(inventory.publicSnapshot) ||
        snapshotData(inventory.replaySnapshot) ||
        snapshotDocuments(inventory.replayPagesSnapshot).length ||
        siblingSpecs.some(
          (spec) =>
            snapshotDocuments(inventory.siblingSnapshots[spec.key]).length,
        ) ||
        SCOREBOOK_CHILD_COLLECTIONS.some(
          (collectionId) =>
            snapshotDocuments(inventory.scorebookChildSnapshots[collectionId])
              .length,
        ) ||
        snapshotDocuments(inventory.publicEventsSnapshot).length ||
        interactionSpecs.some(
          (spec) =>
            snapshotDocuments(inventory.interactionAnySnapshots[spec.key])
              .length,
        ) ||
        snapshotData(inventory.sharedSnapshot),
      );
    const lockAllowsGeneration = (lock, generation) =>
      !lock ||
      lock.generation === generation ||
      (lock.status === "complete" && lock.complete === true);
    const identityFor = (generation) => ({ teamId, gameId, generation });
    const validateProtectedTrees = (inventory, generation) => {
      const identity = identityFor(generation);
      const root = snapshotData(inventory.rootSnapshot);
      const publicState = snapshotData(inventory.publicSnapshot);
      if (root && !isCleanupOwnedDocument(root, identity)) return false;
      if (publicState && !isCleanupOwnedDocument(publicState, identity))
        return false;
      for (const collectionId of SCOREBOOK_CHILD_COLLECTIONS) {
        if (
          snapshotDocuments(
            inventory.scorebookChildSnapshots[collectionId],
          ).some(
            (entry) =>
              !isCleanupOwnedScorebookChild(snapshotData(entry), identity),
          )
        ) {
          return false;
        }
      }
      for (const spec of interactionSpecs) {
        if (
          snapshotDocuments(inventory.interactionOwnedSnapshots[spec.key]).some(
            (entry) =>
              !isCleanupOwnedInteraction(snapshotData(entry), identity),
          )
        ) {
          return false;
        }
      }
      return !snapshotDocuments(inventory.publicEventsSnapshot).some(
        (entry) => !isCleanupOwnedScorebookChild(snapshotData(entry), identity),
      );
    };
    const ownedTargets = (inventory, generation) => {
      const identity = identityFor(generation);
      const entries = [];
      const addIfOwned = (snapshotEntry) => {
        if (
          snapshotEntry?.ref?.path &&
          isCleanupOwnedDocument(snapshotData(snapshotEntry), identity)
        ) {
          entries.push(snapshotEntry);
        }
      };
      addIfOwned(inventory.rootSnapshot);
      addIfOwned(inventory.publicSnapshot);
      addIfOwned(inventory.replaySnapshot);
      snapshotDocuments(inventory.replayPagesSnapshot).forEach(addIfOwned);
      siblingSpecs.forEach((spec) => {
        snapshotDocuments(inventory.siblingSnapshots[spec.key]).forEach(
          addIfOwned,
        );
      });
      if (
        inventory.sharedSnapshot?.ref?.path &&
        isCleanupOwnedSharedProjection(
          snapshotData(inventory.sharedSnapshot),
          identity,
        )
      ) {
        entries.push(inventory.sharedSnapshot);
      }
      return entries;
    };
    const sameOwnedTargets = (left, right) => {
      const leftPaths = left.map((entry) => entry.ref.path).sort();
      const rightPaths = right.map((entry) => entry.ref.path).sort();
      return (
        leftPaths.length === rightPaths.length &&
        leftPaths.every((path, index) => path === rightPaths[index])
      );
    };
    let currentSnapshot;
    try {
      currentSnapshot = await firestore.doc(resourcePaths.game).get();
    } catch (error) {
      logger.error?.("diamond_cleanup_retry", {
        reason: "parent-read-incomplete",
        code: error?.code || "read-failed",
      });
      throwCleanupUnavailable(
        "The current game could not be checked completely; Diamond cleanup will retry.",
      );
    }
    const currentGame = snapshotData(currentSnapshot);
    const currentEngine = currentGame?.trackingEngine;
    const safeGenerationCleanupParent =
      !currentGame ||
      currentEngine === null ||
      currentEngine === undefined ||
      currentEngine === "" ||
      ["legacy", "legacy-v1", "classic", "standard"].includes(currentEngine);
    const recreatedLegacyParent = Boolean(
      currentGame && safeGenerationCleanupParent,
    );
    const cleanupParentRemainsSafe = (value) => {
      if (!recreatedLegacyParent) return !value;
      const engine = value?.trackingEngine;
      return Boolean(
        value &&
        (engine === null ||
          engine === undefined ||
          engine === "" ||
          ["legacy", "legacy-v1", "classic", "standard"].includes(engine)),
      );
    };
    if (interactionSpecs.length && safeGenerationCleanupParent) {
      if (typeof recursiveDelete !== "function") {
        throw makeError(
          "failed-precondition",
          "Recursive Diamond generation cleanup is not configured.",
        );
      }
      try {
        await recursiveDelete(
          firestore.doc(resourcePaths.diamondLiveGeneration(deletedGeneration)),
        );
        await recursiveDelete(
          firestore.doc(resourcePaths.diamondStatGeneration(deletedGeneration)),
        );
      } catch (error) {
        logger.error?.("diamond_cleanup_retry", {
          reason: "generation-tree-delete-failed",
          code: error?.code || "recursive-delete-failed",
        });
        throwCleanupUnavailable(
          "Diamond generation data cleanup did not finish and will be retried.",
        );
      }
    }
    let initialInventory;
    try {
      initialInventory = await readInventory();
      assertInventoryComplete(initialInventory);
    } catch (error) {
      if (isCleanupUnavailable(error)) throw error;
      logger.error?.("diamond_cleanup_retry", {
        reason: "descendant-read-incomplete",
        code: error?.code || "read-failed",
      });
      throwCleanupUnavailable(
        "Diamond descendants could not be inventoried completely; cleanup will retry.",
      );
    }
    const existingLock = snapshotData(initialInventory.lockSnapshot);
    const decision = core.decideDiamondDeletionCleanup({
      deletedGame,
      currentGame: recreatedLegacyParent ? null : currentGame,
      currentReadStatus: "complete",
      descendantsPresent: inventoryHasAnyDescendant(initialInventory),
      cleanupReceipt: existingLock,
    });
    if (decision.action === "ignore" || decision.action === "none") {
      return {
        cleaned: decision.complete === true,
        retained: false,
        reason: decision.code,
      };
    }
    if (decision.action === "retain" || decision.allowed !== true) {
      if (decision.retryable === true) {
        throwCleanupUnavailable(
          "Diamond cleanup ownership could not be established and will be retried.",
        );
      }
      return {
        cleaned: false,
        retained: true,
        reason: decision.code,
      };
    }
    const generation = decision.generation;
    if (!lockAllowsGeneration(existingLock, generation)) {
      throwCleanupUnavailable(
        "Another Diamond cleanup generation is still active; cleanup will retry.",
      );
    }
    if (!validateProtectedTrees(initialInventory, generation)) {
      return {
        cleaned: false,
        retained: true,
        reason: "descendant-generation-mismatch",
      };
    }
    const cleanupIdentity = identityFor(generation);
    const replayManifest = snapshotData(initialInventory.replaySnapshot);
    if (
      (replayManifest &&
        !isCleanupOwnedDocument(replayManifest, cleanupIdentity)) ||
      snapshotDocuments(initialInventory.replayPagesSnapshot).some(
        (entry) =>
          !isCleanupOwnedDocument(snapshotData(entry), cleanupIdentity),
      )
    ) {
      return {
        cleaned: false,
        retained: true,
        reason: "descendant-generation-mismatch",
      };
    }
    const initialOwnedTargets = ownedTargets(initialInventory, generation);
    const nowMs = normalizeNow(clock, makeError);
    try {
      await firestore.runTransaction(async (transaction) => {
        const gameNowSnapshot = await transaction.get(
          firestore.doc(resourcePaths.game),
        );
        if (!cleanupParentRemainsSafe(snapshotData(gameNowSnapshot))) {
          throwCleanupUnavailable(
            "The game generation changed while cleanup was reserving ownership.",
          );
        }
        const currentInventory = await readInventory(transaction, generation);
        assertInventoryComplete(currentInventory);
        if (!validateProtectedTrees(currentInventory, generation)) {
          throwCleanupUnavailable(
            "Diamond descendant ownership changed while cleanup was reserving ownership.",
          );
        }
        const lockNow = snapshotData(currentInventory.lockSnapshot);
        if (!lockAllowsGeneration(lockNow, generation)) {
          throwCleanupUnavailable(
            "Another Diamond cleanup generation is still active.",
          );
        }
        const currentOwnedTargets = ownedTargets(currentInventory, generation);
        if (!sameOwnedTargets(initialOwnedTargets, currentOwnedTargets)) {
          throwCleanupUnavailable(
            "Diamond descendants changed while cleanup was reserving ownership.",
          );
        }
        transaction.set(firestore.doc(resourcePaths.cleanupLock), {
          schemaVersion: 1,
          generation,
          status: "deleting",
          complete: false,
          updatedAt: timestampIso(nowMs),
        });
        currentOwnedTargets.forEach((entry) => {
          if (
            entry.ref.path !== resourcePaths.scorebook &&
            entry.ref.path !== resourcePaths.publicState &&
            entry.ref.path !== sharedGamePath
          ) {
            transaction.delete(entry.ref);
          }
        });
      });
    } catch (error) {
      if (isCleanupUnavailable(error)) throw error;
      logger.error?.("diamond_cleanup_retry", {
        reason: "cleanup-reservation-failed",
        code: error?.code || "transaction-failed",
      });
      throwCleanupUnavailable(
        "Diamond cleanup ownership could not be reserved and will be retried.",
      );
    }
    if (typeof recursiveDelete !== "function") {
      throw makeError(
        "failed-precondition",
        "Recursive Diamond cleanup is not configured.",
      );
    }
    try {
      await recursiveDelete(firestore.doc(resourcePaths.scorebook));
      await recursiveDelete(firestore.doc(resourcePaths.publicState));
    } catch (error) {
      logger.error?.("diamond_cleanup_failed", {
        reason: "recursive-delete-failed",
      });
      throw makeError(
        "unavailable",
        "Diamond game cleanup did not finish and will be retried.",
      );
    }
    let foreignDocumentsRetained = false;
    try {
      await firestore.runTransaction(async (transaction) => {
        const gameAfter = await transaction.get(
          firestore.doc(resourcePaths.game),
        );
        if (!cleanupParentRemainsSafe(snapshotData(gameAfter))) {
          throwCleanupUnavailable(
            "The game generation changed before cleanup completion could be verified.",
          );
        }
        const finalInventory = await readInventory(transaction, generation);
        assertInventoryComplete(finalInventory);
        const lock = snapshotData(finalInventory.lockSnapshot);
        if (
          lock?.generation !== generation ||
          lock?.status !== "deleting" ||
          lock?.complete !== false
        ) {
          throwCleanupUnavailable(
            "Diamond cleanup lost its generation lock before verification.",
          );
        }
        if (
          snapshotData(finalInventory.rootSnapshot) ||
          snapshotData(finalInventory.publicSnapshot) ||
          SCOREBOOK_CHILD_COLLECTIONS.some(
            (collectionId) =>
              !queryIsEmpty(
                finalInventory.scorebookChildSnapshots[collectionId],
              ),
          ) ||
          !queryIsEmpty(finalInventory.publicEventsSnapshot) ||
          interactionSpecs.some(
            (spec) =>
              !queryIsEmpty(finalInventory.interactionOwnedSnapshots[spec.key]),
          ) ||
          ownedTargets(finalInventory, generation).some(
            (entry) => entry.ref.path !== sharedGamePath,
          )
        ) {
          throwCleanupUnavailable(
            "Diamond cleanup completion could not be verified.",
          );
        }
        const finalShared = snapshotData(finalInventory.sharedSnapshot);
        if (
          finalInventory.sharedSnapshot?.ref &&
          isCleanupOwnedSharedProjection(finalShared, identityFor(generation))
        ) {
          transaction.set(
            finalInventory.sharedSnapshot.ref,
            clearOwnedDiamondSharedProjection(finalShared),
          );
        }
        foreignDocumentsRetained = Boolean(
          snapshotData(finalInventory.replaySnapshot) ||
          snapshotDocuments(finalInventory.replayPagesSnapshot).length ||
          siblingSpecs.some(
            (spec) =>
              snapshotDocuments(finalInventory.siblingSnapshots[spec.key])
                .length,
          ) ||
          interactionSpecs.some(
            (spec) =>
              snapshotDocuments(
                finalInventory.interactionAnySnapshots[spec.key],
              ).length,
          ) ||
          (finalShared &&
            !isCleanupOwnedSharedProjection(
              finalShared,
              identityFor(generation),
            )),
        );
        transaction.set(firestore.doc(resourcePaths.cleanupLock), {
          schemaVersion: 1,
          generation,
          status: "complete",
          complete: true,
          updatedAt: timestampIso(nowMs),
          completedAt: timestampIso(nowMs),
        });
      });
    } catch (error) {
      if (isCleanupUnavailable(error)) throw error;
      logger.error?.("diamond_cleanup_retry", {
        reason: "cleanup-verification-failed",
        code: error?.code || "transaction-failed",
      });
      throwCleanupUnavailable(
        "Diamond cleanup completion could not be verified and will be retried.",
      );
    }
    return {
      cleaned: true,
      retained: foreignDocumentsRetained,
      reason: foreignDocumentsRetained
        ? "cleanup-complete-with-foreign-descendants"
        : "cleanup-complete",
      generation,
    };
  }

  return {
    configureDiamondTeam,
    getDiamondAccess,
    getDiamondManagerStats,
    activateDiamondGame,
    acquireDiamondScorerLease,
    listDiamondScorerCandidates,
    submitDiamondCommand,
    getDiamondState,
    listDiamondEvents,
    getPublicDiamondGame,
    parseDiamondVoice,
    regenerateDiamondProjection,
    cleanupDeletedDiamondGame,
  };
}

module.exports = {
  COMMAND_HISTORY_CONTROL_QUARANTINE_MS,
  COMMAND_HISTORY_RATE_WINDOW_MS,
  COMMAND_HISTORY_SUSTAINED_WINDOW_MS,
  DEFAULT_EVENT_PAGE_SIZE,
  DIAMOND_ENGINE,
  DiamondHandlerError,
  FULL_HISTORY_PAGE_SIZE,
  LEGACY_TRACKING_COLLECTIONS,
  MANAGER_STAT_ADMISSION_DEDUPE_MS,
  MANAGER_STAT_CONTROL_COLLECTION,
  MANAGER_STAT_RATE_WINDOW_MS,
  MANAGER_STAT_RECEIPT_RETENTION_MS,
  MANAGER_STAT_REQUEST_LEASE_MS,
  MANAGER_STAT_SUSTAINED_WINDOW_MS,
  MAX_CANONICAL_EVENTS,
  MAX_COMMAND_HISTORY_READ_UNITS_PER_WINDOW,
  MAX_COMMAND_HISTORY_REQUESTS_PER_WINDOW,
  MAX_COMMAND_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW,
  MAX_COMMAND_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_COMMAND_PROJECTION_READ_UNITS_PER_WINDOW,
  MAX_COMMAND_PROJECTION_REQUESTS_PER_WINDOW,
  MAX_COMMAND_PROJECTION_SUSTAINED_READ_UNITS_PER_WINDOW,
  MAX_COMMAND_PROJECTION_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_CONCURRENT_MANAGER_STAT_REQUESTS,
  MAX_DIAMOND_SCORER_CANDIDATES,
  MAX_EVENT_PAGE_SIZE,
  MAX_MANAGER_STAT_ADMISSIONS_PER_WINDOW,
  MAX_MANAGER_STAT_GAMES,
  MAX_MANAGER_STAT_GLOBAL_READ_UNITS_PER_WINDOW,
  MAX_MANAGER_STAT_PLAYERS,
  MAX_MANAGER_STAT_READ_UNITS_PER_WINDOW,
  MAX_MANAGER_STAT_REQUESTS_PER_WINDOW,
  MAX_MANAGER_STAT_RESPONSE_BYTES,
  MAX_MANAGER_STAT_SUSTAINED_ADMISSIONS_PER_WINDOW,
  MAX_MANAGER_STAT_SUSTAINED_GLOBAL_READ_UNITS_PER_WINDOW,
  MAX_MANAGER_STAT_SUSTAINED_READ_UNITS_PER_WINDOW,
  MAX_MANAGER_STAT_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_MANAGER_STAT_SUSTAINED_VERIFICATION_UNITS_PER_WINDOW,
  MAX_MANAGER_STAT_VERIFICATION_UNITS_PER_WINDOW,
  MAX_CONCURRENT_PRIVATE_HISTORY_GLOBAL_REQUESTS,
  MAX_CONCURRENT_PRIVATE_HISTORY_REQUESTS,
  MAX_PRIVATE_HISTORY_GLOBAL_REQUESTS_PER_WINDOW,
  MAX_PRIVATE_HISTORY_GLOBAL_SUSTAINED_READ_UNITS_PER_WINDOW,
  MAX_PRIVATE_HISTORY_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_PRIVATE_HISTORY_READ_UNITS_PER_WINDOW,
  MAX_PRIVATE_HISTORY_RECENT_ADMISSIONS,
  MAX_PRIVATE_HISTORY_REPORT_PAGES,
  MAX_PRIVATE_HISTORY_REQUESTS_PER_WINDOW,
  MAX_PRIVATE_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_PRIVATE_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW,
  MAX_PRIVATE_EVENT_PAGE_BYTES,
  PRIVATE_HISTORY_ADMISSION_DEDUPE_MS,
  PRIVATE_HISTORY_CONTROL_QUARANTINE_MS,
  PRIVATE_HISTORY_FIXED_READ_UNITS,
  PRIVATE_HISTORY_READ_UNITS_PER_EVENT,
  PRIVATE_HISTORY_RATE_WINDOW_MS,
  PRIVATE_HISTORY_RECEIPT_RETENTION_MS,
  PRIVATE_HISTORY_REPORT_RETRY_ALLOWANCE,
  PRIVATE_HISTORY_REQUEST_LEASE_MS,
  PRIVATE_HISTORY_SUSTAINED_WINDOW_MS,
  SCORER_LEASE_DURATION_MS,
  createDiamondScorebookHandlers,
  paths,
};
