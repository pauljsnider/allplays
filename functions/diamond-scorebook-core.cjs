"use strict";

const crypto = require("node:crypto");

const DIAMOND_SCHEMA_VERSION = 2;
const DIAMOND_POLICY_REVISION_MINIMUM = 1;
const DIAMOND_ENGINE = "diamond-v2";
const DIAMOND_POLICY_MODES = Object.freeze([
  "disabled",
  "internal",
  "pilot",
  "enabled",
]);
const DIAMOND_SPORTS = Object.freeze(["baseball", "fastpitch"]);
const DIAMOND_COMMAND_TYPES = Object.freeze([
  "activate",
  "set_lineup",
  "set_defensive_alignment",
  "set_dp_flex",
  "start",
  "record_pitch",
  "record_plate_appearance",
  "advance_runner",
  "record_fielding",
  "record_scoring_judgment",
  "advance_half_inning",
  "place_tiebreaker_runner",
  "substitute",
  "re_enter",
  "add_courtesy_runner",
  "scorer_handoff",
  "private_note",
  "suspend",
  "resume",
  "rules_decision",
  "void_event",
  "supersede_event",
  "reopen_for_correction",
  "finalize",
]);

const COMMAND_TYPE_SET = new Set(DIAMOND_COMMAND_TYPES);
const POLICY_MODE_SET = new Set(DIAMOND_POLICY_MODES);
const POLICY_FIELDS = new Set([
  "mode",
  "revision",
  "teamIds",
  "minimumAppBuild",
  "updatedAt",
  "updatedBy",
  "rolloutNote",
]);
const COMMAND_FIELDS = new Set([
  "schemaVersion",
  "commandId",
  "teamId",
  "gameId",
  "expectedRevision",
  "rulesProfileId",
  "rulesProfileVersion",
  "type",
  "payload",
]);
const COMMAND_PAYLOAD_FIELDS = Object.freeze({
  activate: new Set(["initialScorerUid", "captureMode"]),
  set_lineup: new Set(["side", "entries"]),
  set_defensive_alignment: new Set(["side", "assignments"]),
  set_dp_flex: new Set([
    "side",
    "dpPlayerId",
    "flexPlayerId",
    "dpBattingSlot",
    "flexDefensivePosition",
  ]),
  start: new Set(),
  record_pitch: new Set(["pitcherId", "batterId", "result"]),
  record_plate_appearance: new Set([
    "batterId",
    "pitcherId",
    "result",
    "batterAdvance",
    "runnerAdvances",
    "outsOnPlay",
    "runsBattedIn",
    "fielding",
    "omissions",
  ]),
  advance_runner: new Set([
    "runnerId",
    "from",
    "to",
    "cause",
    "outKind",
    "fielding",
    "omissions",
    "countsRun",
    "earned",
    "rbi",
    "responsiblePitcherId",
  ]),
  record_fielding: new Set(["playEventId", "fielding"]),
  record_scoring_judgment: new Set([
    "playEventId",
    "runnerId",
    "earned",
    "rbi",
    "responsiblePitcherId",
    "pitcherOfRecord",
  ]),
  advance_half_inning: new Set(),
  place_tiebreaker_runner: new Set([
    "side",
    "runnerId",
    "base",
    "chargedToPitcherId",
  ]),
  substitute: new Set([
    "side",
    "battingSlot",
    "outgoingPlayerId",
    "incomingPlayerId",
    "defensivePosition",
  ]),
  re_enter: new Set([
    "side",
    "battingSlot",
    "starterPlayerId",
    "replacedPlayerId",
    "defensivePosition",
  ]),
  add_courtesy_runner: new Set([
    "side",
    "forPlayerId",
    "runnerId",
    "base",
    "forRole",
  ]),
  scorer_handoff: new Set(["toUid"]),
  private_note: new Set(["text", "attachedEventId", "visibility"]),
  suspend: new Set(["reason"]),
  resume: new Set(),
  rules_decision: new Set(["code", "description", "affectedFamilies"]),
  void_event: new Set(["targetEventId", "reason"]),
  supersede_event: new Set(["targetEventId", "reason", "replacement"]),
  reopen_for_correction: new Set(["reason"]),
  finalize: new Set(["confirmed"]),
});
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const MAX_POLICY_TEAM_IDS = 500;
const MAX_PAYLOAD_DEPTH = 10;
const MAX_PAYLOAD_ARRAY_ITEMS = 100;
const MAX_PAYLOAD_OBJECT_KEYS = 100;
const MAX_PAYLOAD_NODES = 2_000;
const MAX_PAYLOAD_STRING_LENGTH = 4_000;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const MAX_EVENT_PAGE_SIZE = 200;
const MAX_VOICE_UNRESOLVED_FIELDS = 20;
const MAX_VOICE_FIELD_LENGTH = 160;
const FORBIDDEN_OBJECT_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);
const LEGACY_ENGINES = new Set(["legacy", "legacy-v1", "classic", "standard"]);
const LEGACY_ACTIVE_STATUSES = new Set([
  "active",
  "complete",
  "completed",
  "correction",
  "final",
  "finished",
  "in-progress",
  "in_progress",
  "live",
  "suspended",
]);
const GAME_INELIGIBLE_STATUSES = new Set([
  "cancelled",
  "canceled",
  "deleted",
  "postponed",
]);
const CORRECTION_COMMANDS = new Set([
  "record_fielding",
  "record_scoring_judgment",
  "void_event",
  "supersede_event",
  "reopen_for_correction",
]);
const VOICE_PROPOSAL_COMMANDS = new Set([
  "record_pitch",
  "record_plate_appearance",
  "advance_runner",
  "record_fielding",
  "record_scoring_judgment",
  "advance_half_inning",
  "place_tiebreaker_runner",
  "substitute",
  "re_enter",
  "add_courtesy_runner",
]);
const PUBLIC_NOTIFICATION_COMMANDS = new Set([
  "start",
  "record_plate_appearance",
  "advance_runner",
  "advance_half_inning",
  "suspend",
  "resume",
  "finalize",
]);
const PUBLIC_PROJECTION_FIELDS = new Set([
  "schemaVersion",
  "trackingEngine",
  "teamId",
  "gameId",
  "revision",
  "sourceRevision",
  "checkpointHash",
  "authoritative",
  "complete",
  "truncated",
  "status",
  "lifecycle",
  "captureMode",
  "rulesProfileId",
  "rulesProfileVersion",
  "catalogVersion",
  "reducerVersion",
  "teamName",
  "opponentName",
  "homeName",
  "awayName",
  "home",
  "away",
  "score",
  "inning",
  "inningNumber",
  "half",
  "count",
  "balls",
  "strikes",
  "outs",
  "bases",
  "baseRunners",
  "currentBatter",
  "currentPitcher",
  "battingTeam",
  "fieldingTeam",
  "lineup",
  "battingLineup",
  "lastPlay",
  "recentPlays",
  "plays",
  "events",
  "coverage",
  "completeness",
  "projectionStatus",
  "readOnlyReason",
  "updatedAt",
  "generatedAt",
]);
const PUBLIC_EVENT_FIELDS = new Set([
  "schemaVersion",
  "eventId",
  "playId",
  "sourceEventId",
  "sequence",
  "revision",
  "sourceRevision",
  "type",
  "description",
  "label",
  "inning",
  "inningLabel",
  "half",
  "score",
  "outs",
  "count",
  "bases",
  "batter",
  "pitcher",
  "player",
  "runners",
  "fielders",
  "coverage",
  "corrected",
  "voided",
  "supersedesEventId",
  "voidsEventId",
  "createdAt",
  "serverTimestampMs",
]);
const NORMALIZED_POLICY = Symbol("normalizedDiamondPolicy");

const LIFECYCLE_COMMANDS = Object.freeze({
  configured: new Set(["activate"]),
  ready: new Set([
    "set_lineup",
    "set_defensive_alignment",
    "set_dp_flex",
    "start",
    "scorer_handoff",
    "private_note",
    "rules_decision",
  ]),
  active: new Set([
    "set_defensive_alignment",
    "set_dp_flex",
    "record_pitch",
    "record_plate_appearance",
    "advance_runner",
    "record_fielding",
    "record_scoring_judgment",
    "advance_half_inning",
    "place_tiebreaker_runner",
    "substitute",
    "re_enter",
    "add_courtesy_runner",
    "scorer_handoff",
    "private_note",
    "suspend",
    "rules_decision",
    "void_event",
    "supersede_event",
    "finalize",
  ]),
  suspended: new Set([
    "scorer_handoff",
    "private_note",
    "resume",
    "rules_decision",
  ]),
  final: new Set(["private_note", "reopen_for_correction"]),
  correction: new Set([
    "record_fielding",
    "record_scoring_judgment",
    "scorer_handoff",
    "private_note",
    "rules_decision",
    "void_event",
    "supersede_event",
    "finalize",
  ]),
});

class DiamondScorebookCoreError extends Error {
  constructor(code, message, { retryable = false, details = null } = {}) {
    super(message);
    this.name = "DiamondScorebookCoreError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function allow(code, extra = {}) {
  return { allowed: true, code, ...extra };
}

function deny(code, message, { retryable = false, ...extra } = {}) {
  return { allowed: false, code, message, retryable, ...extra };
}

function normalizeDiamondId(value, fieldName = "id") {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    value.length > 128 ||
    value.includes("/") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      `${fieldName} must be a nonempty, slash-free string of at most 128 characters.`,
    );
  }
  return value;
}

function normalizeOptionalDiamondId(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  return normalizeDiamondId(value, fieldName);
}

function normalizeNonnegativeInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      `${fieldName} must be a nonnegative safe integer.`,
    );
  }
  return value;
}

function normalizePositiveInteger(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      `${fieldName} must be a positive safe integer.`,
    );
  }
  return value;
}

function normalizeDiamondSport(value) {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
  if (normalized === "baseball") return "baseball";
  if (
    normalized === "softball" ||
    normalized === "fastpitch" ||
    normalized === "fastpitch softball"
  ) {
    return "fastpitch";
  }
  return null;
}

function canonicalizeDiamondValue(value, seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DiamondScorebookCoreError(
        "invalid-number",
        "Canonical Diamond values must contain finite numbers.",
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new DiamondScorebookCoreError(
        "invalid-date",
        "Canonical Diamond values must contain valid dates.",
      );
    }
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new DiamondScorebookCoreError(
        "cyclic-value",
        "Canonical Diamond values cannot be cyclic.",
      );
    }
    seen.add(value);
    const result = value.map((entry) => canonicalizeDiamondValue(entry, seen));
    seen.delete(value);
    return result;
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      throw new DiamondScorebookCoreError(
        "cyclic-value",
        "Canonical Diamond values cannot be cyclic.",
      );
    }
    seen.add(value);
    const result = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        if (value[key] !== undefined)
          result[key] = canonicalizeDiamondValue(value[key], seen);
      });
    seen.delete(value);
    return result;
  }
  throw new DiamondScorebookCoreError(
    "unsupported-value",
    "Canonical Diamond values must be JSON-compatible.",
  );
}

function canonicalDiamondJson(value) {
  return JSON.stringify(canonicalizeDiamondValue(value));
}

function hashDiamondValue(value, { createHash = crypto.createHash } = {}) {
  if (typeof createHash !== "function") {
    throw new DiamondScorebookCoreError(
      "internal",
      "A SHA-256 implementation is required.",
    );
  }
  const digest = createHash("sha256")
    .update(canonicalDiamondJson(value), "utf8")
    .digest("hex");
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new DiamondScorebookCoreError(
      "internal",
      "The SHA-256 implementation returned an invalid digest.",
    );
  }
  return `sha256:${digest}`;
}

function cloneAndValidateJson(value, context, depth = 0) {
  if (context.nodes >= MAX_PAYLOAD_NODES) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Diamond payload contains too many values.",
    );
  }
  context.nodes += 1;
  if (depth > MAX_PAYLOAD_DEPTH) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Diamond payload is nested too deeply.",
    );
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_PAYLOAD_STRING_LENGTH) {
      throw new DiamondScorebookCoreError(
        "invalid-argument",
        "Diamond payload contains an overlong string.",
      );
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DiamondScorebookCoreError(
        "invalid-argument",
        "Diamond payload numbers must be finite.",
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_PAYLOAD_ARRAY_ITEMS) {
      throw new DiamondScorebookCoreError(
        "invalid-argument",
        "Diamond payload contains an oversized array.",
      );
    }
    if (context.seen.has(value)) {
      throw new DiamondScorebookCoreError(
        "invalid-argument",
        "Diamond payload cannot be cyclic.",
      );
    }
    context.seen.add(value);
    const result = value.map((entry) =>
      cloneAndValidateJson(entry, context, depth + 1),
    );
    context.seen.delete(value);
    return result;
  }
  if (!isPlainObject(value)) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Diamond payload must contain plain JSON values only.",
    );
  }
  const keys = Object.keys(value);
  if (keys.length > MAX_PAYLOAD_OBJECT_KEYS) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Diamond payload contains an oversized object.",
    );
  }
  if (context.seen.has(value)) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Diamond payload cannot be cyclic.",
    );
  }
  context.seen.add(value);
  const result = {};
  keys.forEach((key) => {
    if (!key || key.length > 128 || FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new DiamondScorebookCoreError(
        "invalid-argument",
        "Diamond payload contains an invalid object key.",
      );
    }
    result[key] = cloneAndValidateJson(value[key], context, depth + 1);
  });
  context.seen.delete(value);
  return result;
}

function normalizeDiamondPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "payload must be a plain object.",
    );
  }
  const normalized = cloneAndValidateJson(payload, {
    nodes: 0,
    seen: new Set(),
  });
  if (
    Buffer.byteLength(canonicalDiamondJson(normalized), "utf8") >
    MAX_PAYLOAD_BYTES
  ) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Diamond payload exceeds 64 KiB.",
    );
  }
  return normalized;
}

function assertCommandPayloadBoundary(type, payload) {
  const allowedFields = COMMAND_PAYLOAD_FIELDS[type];
  if (
    !allowedFields ||
    Object.keys(payload).some((key) => !allowedFields.has(key))
  ) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      `${type} contains unsupported payload fields.`,
    );
  }
  if (containsForbiddenCanonicalCommandState(payload)) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Canonical Diamond commands cannot contain dictation, raw audio, client authority, credentials, or private contact data.",
    );
  }
  if (type === "activate") {
    normalizeDiamondId(payload.initialScorerUid, "payload.initialScorerUid");
    if (payload.captureMode !== "quick" && payload.captureMode !== "full") {
      throw new DiamondScorebookCoreError(
        "invalid-argument",
        "payload.captureMode must be quick or full.",
      );
    }
  }
  if (type === "scorer_handoff")
    normalizeDiamondId(payload.toUid, "payload.toUid");
  if (type === "private_note") {
    if (
      typeof payload.text !== "string" ||
      !payload.text.trim() ||
      payload.text.length > 2_000
    ) {
      throw new DiamondScorebookCoreError(
        "invalid-argument",
        "A private note must contain at most 2,000 characters.",
      );
    }
    if (own(payload, "attachedEventId") && payload.attachedEventId !== null) {
      normalizeDiamondId(payload.attachedEventId, "payload.attachedEventId");
    }
    if (own(payload, "visibility") && payload.visibility !== "staff-private") {
      throw new DiamondScorebookCoreError(
        "invalid-argument",
        "Private note visibility must remain staff-private.",
      );
    }
    if (containsRawAudioField(payload)) {
      throw new DiamondScorebookCoreError(
        "invalid-argument",
        "Raw audio cannot be stored in a Diamond command.",
      );
    }
  }
  if (type === "finalize" && payload.confirmed !== true) {
    throw new DiamondScorebookCoreError(
      "confirmation-required",
      "Finalization requires explicit confirmation.",
    );
  }
  if (type === "void_event" || type === "supersede_event") {
    normalizeDiamondId(payload.targetEventId, "payload.targetEventId");
    if (
      typeof payload.reason !== "string" ||
      !payload.reason.trim() ||
      payload.reason.length > 500
    ) {
      throw new DiamondScorebookCoreError(
        "invalid-argument",
        "A correction reason is required.",
      );
    }
  }
  if (type === "start" || type === "resume" || type === "advance_half_inning") {
    if (Object.keys(payload).length !== 0) {
      throw new DiamondScorebookCoreError(
        "invalid-argument",
        `${type} does not accept payload fields.`,
      );
    }
  }
}

function normalizeDiamondCommand(value) {
  if (!isPlainObject(value)) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Diamond command must be a plain object.",
    );
  }
  const unknownFields = Object.keys(value).filter(
    (key) => !COMMAND_FIELDS.has(key),
  );
  if (unknownFields.length) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Diamond command contains unsupported envelope fields.",
    );
  }
  if (value.schemaVersion !== DIAMOND_SCHEMA_VERSION) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Only Diamond command schema version 2 is supported.",
    );
  }
  if (
    typeof value.commandId !== "string" ||
    !UUID_V4_PATTERN.test(value.commandId)
  ) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "commandId must be a cryptographically random UUID v4.",
    );
  }
  if (!COMMAND_TYPE_SET.has(value.type)) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Diamond command type is unsupported.",
    );
  }
  const payload = normalizeDiamondPayload(value.payload);
  assertCommandPayloadBoundary(value.type, payload);
  return {
    schemaVersion: DIAMOND_SCHEMA_VERSION,
    commandId: value.commandId.toLowerCase(),
    teamId: normalizeDiamondId(value.teamId, "teamId"),
    gameId: normalizeDiamondId(value.gameId, "gameId"),
    expectedRevision: normalizeNonnegativeInteger(
      value.expectedRevision,
      "expectedRevision",
    ),
    rulesProfileId: normalizeDiamondId(value.rulesProfileId, "rulesProfileId"),
    rulesProfileVersion: normalizePositiveInteger(
      value.rulesProfileVersion,
      "rulesProfileVersion",
    ),
    type: value.type,
    payload,
  };
}

function hashDiamondCommand(value, dependencies) {
  return hashDiamondValue(normalizeDiamondCommand(value), dependencies);
}

function disabledPolicy(reason) {
  return Object.freeze({
    [NORMALIZED_POLICY]: true,
    valid: false,
    mode: "disabled",
    revision: null,
    teamIds: Object.freeze([]),
    minimumAppBuild: 0,
    reason,
    activationEnabled: false,
    scoringEnabled: false,
  });
}

function parseDiamondPolicy(value, { readStatus = "complete" } = {}) {
  if (readStatus !== "complete") return disabledPolicy("policy-unreadable");
  if (value === null || value === undefined)
    return disabledPolicy("policy-missing");
  if (!isPlainObject(value)) return disabledPolicy("policy-malformed");
  if (Object.keys(value).some((key) => !POLICY_FIELDS.has(key)))
    return disabledPolicy("policy-malformed");
  if (
    !POLICY_MODE_SET.has(value.mode) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < DIAMOND_POLICY_REVISION_MINIMUM ||
    !Array.isArray(value.teamIds) ||
    value.teamIds.length > MAX_POLICY_TEAM_IDS
  ) {
    return disabledPolicy("policy-malformed");
  }
  let teamIds;
  try {
    teamIds = value.teamIds.map((teamId) =>
      normalizeDiamondId(teamId, "policy teamId"),
    );
    if (new Set(teamIds).size !== teamIds.length)
      return disabledPolicy("policy-malformed");
    if (own(value, "updatedBy")) {
      normalizeDiamondId(value.updatedBy, "policy updatedBy");
    }
  } catch {
    return disabledPolicy("policy-malformed");
  }
  if (
    own(value, "minimumAppBuild") &&
    (!Number.isSafeInteger(value.minimumAppBuild) || value.minimumAppBuild < 0)
  ) {
    return disabledPolicy("policy-malformed");
  }
  if (
    own(value, "rolloutNote") &&
    (typeof value.rolloutNote !== "string" || value.rolloutNote.length > 500)
  ) {
    return disabledPolicy("policy-malformed");
  }
  if (own(value, "updatedAt") && timestampMillis(value.updatedAt) === null) {
    return disabledPolicy("policy-malformed");
  }
  return Object.freeze({
    [NORMALIZED_POLICY]: true,
    valid: true,
    mode: value.mode,
    revision: value.revision,
    teamIds: Object.freeze([...teamIds]),
    minimumAppBuild: value.minimumAppBuild || 0,
    reason: value.mode === "disabled" ? "policy-disabled" : null,
    activationEnabled: value.mode !== "disabled",
    scoringEnabled: value.mode !== "disabled",
  });
}

function getParsedPolicy(policy) {
  if (isPlainObject(policy) && policy[NORMALIZED_POLICY] === true)
    return policy;
  return parseDiamondPolicy(policy);
}

function getDiamondPolicyDecision({
  policy,
  teamId,
  appBuild = 0,
  operation = "activate",
}) {
  const parsed = getParsedPolicy(policy);
  if (!parsed.valid)
    return deny(parsed.reason, "Diamond scorekeeping policy is unavailable.");
  if (operation !== "activate" && operation !== "score") {
    return deny(
      "invalid-operation",
      "Policy gates only activation and normal scoring.",
    );
  }
  if (parsed.mode === "disabled")
    return deny("policy-disabled", "Diamond scorekeeping is disabled.");
  let normalizedTeamId;
  try {
    normalizedTeamId = normalizeDiamondId(teamId, "teamId");
  } catch (error) {
    return deny("invalid-team-id", error.message);
  }
  if (!Number.isSafeInteger(appBuild) || appBuild < 0) {
    return deny("invalid-app-build", "The application build is invalid.");
  }
  if (appBuild < parsed.minimumAppBuild) {
    return deny(
      "minimum-app-build",
      "Update AllPlays before using Diamond scorekeeping.",
    );
  }
  if (
    (parsed.mode === "internal" || parsed.mode === "pilot") &&
    !parsed.teamIds.includes(normalizedTeamId)
  ) {
    return deny(
      "team-not-in-rollout",
      "This team is not in the active Diamond rollout cohort.",
    );
  }
  return allow("policy-allows", {
    mode: parsed.mode,
    policyRevision: parsed.revision,
  });
}

function parseDiamondTeamOptIn(value) {
  if (!isPlainObject(value) || value.enabled !== true) {
    return { valid: false, reason: "team-not-opted-in" };
  }
  const sport = normalizeDiamondSport(value.sport);
  if (!sport) return { valid: false, reason: "team-opt-in-malformed" };
  if (
    own(value, "captureMode") &&
    value.captureMode !== "quick" &&
    value.captureMode !== "full"
  ) {
    return { valid: false, reason: "team-opt-in-malformed" };
  }
  try {
    return {
      valid: true,
      enabled: true,
      sport,
      rulesProfileId: normalizeDiamondId(
        value.rulesProfileId,
        "team opt-in rulesProfileId",
      ),
      rulesProfileVersion: normalizePositiveInteger(
        value.rulesProfileVersion,
        "team opt-in rulesProfileVersion",
      ),
      captureMode: value.captureMode === "full" ? "full" : "quick",
    };
  } catch {
    return { valid: false, reason: "team-opt-in-malformed" };
  }
}

function normalizeStatus(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function getTrackingEngine(value) {
  const raw = value?.trackingEngine;
  if (raw === null || raw === undefined || raw === "")
    return { kind: "none", value: null };
  if (typeof raw !== "string" || raw !== raw.trim())
    return { kind: "unknown", value: raw };
  if (raw === DIAMOND_ENGINE) return { kind: "diamond", value: DIAMOND_ENGINE };
  if (LEGACY_ENGINES.has(raw)) return { kind: "legacy", value: raw };
  return { kind: "unknown", value: raw };
}

function hasNonemptyCollectionValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return value !== null && value !== undefined && value !== "";
}

function findMeaningfulLegacyTrackingData(game) {
  if (!isPlainObject(game)) return ["malformed-game"];
  const evidence = [];
  const engine = getTrackingEngine(game);
  if (engine.kind === "legacy") evidence.push("legacy-engine");
  if (engine.kind === "unknown") evidence.push("unknown-engine");

  const status = normalizeStatus(game.status);
  const liveStatus = normalizeStatus(game.liveStatus);
  if (LEGACY_ACTIVE_STATUSES.has(status)) evidence.push("tracked-status");
  if (LEGACY_ACTIVE_STATUSES.has(liveStatus))
    evidence.push("tracked-live-status");

  [
    "events",
    "liveEvents",
    "plays",
    "playByPlay",
    "gameLog",
    "scoringPlays",
    "pitches",
  ].forEach((field) => {
    if (own(game, field) && hasNonemptyCollectionValue(game[field]))
      evidence.push(field);
  });
  [
    "aggregatedStats",
    "playerStats",
    "opponentStats",
    "teamStats",
    "boxScore",
    "statTotals",
    "liveBaseballState",
  ].forEach((field) => {
    if (own(game, field) && hasNonemptyCollectionValue(game[field]))
      evidence.push(field);
  });

  const scoreValues = [
    game.homeScore,
    game.awayScore,
    game.teamScore,
    game.opponentScore,
    game.score?.home,
    game.score?.away,
  ];
  if (
    scoreValues.some(
      (score) => Number.isFinite(Number(score)) && Number(score) !== 0,
    )
  ) {
    evidence.push("nonzero-score");
  }
  if (
    ["homeScore", "awayScore", "teamScore", "opponentScore"].some(
      (field) =>
        own(game, field) &&
        game[field] !== null &&
        game[field] !== "" &&
        !Number.isFinite(Number(game[field])),
    )
  ) {
    evidence.push("malformed-score");
  }
  if (
    [game.currentInning, game.currentPeriod, game.period].some(
      (stateValue) =>
        stateValue !== null && stateValue !== undefined && stateValue !== "",
    ) ||
    [game.outs, game.balls, game.strikes].some(
      (stateValue) =>
        Number.isFinite(Number(stateValue)) && Number(stateValue) > 0,
    )
  ) {
    evidence.push("live-count-state");
  }
  if (
    [
      game.started,
      game.hasStarted,
      game.live,
      game.completed,
      game.isFinal,
    ].some((flag) => flag === true)
  ) {
    evidence.push("tracked-lifecycle-flag");
  }
  if (
    [
      game.startedAt,
      game.trackingStartedAt,
      game.completedAt,
      game.scoreStreamSessionId,
    ].some((marker) => marker !== null && marker !== undefined && marker !== "")
  ) {
    evidence.push("tracked-lifecycle-marker");
  }
  return [...new Set(evidence)];
}

function hasMeaningfulLegacyTrackingData(game) {
  return findMeaningfulLegacyTrackingData(game).length > 0;
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
  ]).has(normalizeStatus(team.status));
}

function evaluateDiamondActivationEligibility({
  policy,
  team,
  game,
  teamOptIn,
  teamId,
  gameId,
  appBuild = 0,
}) {
  let normalizedTeamId;
  let normalizedGameId;
  try {
    normalizedTeamId = normalizeDiamondId(teamId, "teamId");
    normalizedGameId = normalizeDiamondId(gameId, "gameId");
  } catch (error) {
    return deny("invalid-resource-id", error.message, { eligible: false });
  }
  if (!isActiveTeam(team)) {
    return deny(
      "inactive-team",
      "Diamond cannot activate for an inactive team.",
      { eligible: false },
    );
  }
  if (!isPlainObject(game)) {
    return deny(
      "missing-game",
      "The game could not be loaded authoritatively.",
      { eligible: false },
    );
  }
  if (own(team, "id") && team.id !== normalizedTeamId) {
    return deny(
      "team-mismatch",
      "The team record does not match the requested team.",
      { eligible: false },
    );
  }
  if (own(game, "id") && game.id !== normalizedGameId) {
    return deny(
      "game-mismatch",
      "The game record does not match the requested game.",
      { eligible: false },
    );
  }
  if (own(game, "teamId") && game.teamId !== normalizedTeamId) {
    return deny("cross-team-game", "The game belongs to a different team.", {
      eligible: false,
    });
  }
  const eventType = normalizeStatus(game.type || game.eventType);
  if (eventType && !["game", "match"].includes(eventType)) {
    return deny("not-a-game", "Only scheduled games can use Diamond scoring.", {
      eligible: false,
    });
  }
  const teamSport = normalizeDiamondSport(
    team.sport || team.sportType || team.activity,
  );
  if (!teamSport) {
    return deny(
      "unsupported-sport",
      "Diamond supports Baseball and Fastpitch teams only.",
      { eligible: false },
    );
  }
  const gameSportValue = game.sport || game.sportType || game.activity;
  const gameSport = gameSportValue
    ? normalizeDiamondSport(gameSportValue)
    : teamSport;
  if (!gameSport || gameSport !== teamSport) {
    return deny(
      "cross-sport-game",
      "The game sport does not match the team sport.",
      { eligible: false },
    );
  }
  const optIn = parseDiamondTeamOptIn(teamOptIn || team.diamondScorebook);
  if (!optIn.valid)
    return deny(optIn.reason, "The team is not configured for Diamond.", {
      eligible: false,
    });
  if (optIn.sport !== teamSport) {
    return deny(
      "rules-sport-mismatch",
      "The configured rules profile does not match the team sport.",
      {
        eligible: false,
      },
    );
  }
  const policyDecision = getDiamondPolicyDecision({
    policy,
    teamId: normalizedTeamId,
    appBuild,
    operation: "activate",
  });
  if (!policyDecision.allowed) return { ...policyDecision, eligible: false };

  const engine = getTrackingEngine(game);
  if (engine.kind === "unknown") {
    return deny(
      "unknown-tracking-engine",
      "The game has an unrecognized tracking engine.",
      { eligible: false },
    );
  }
  if (engine.kind === "legacy") {
    return deny(
      "legacy-game",
      "A legacy-owned game cannot be converted to Diamond.",
      { eligible: false },
    );
  }
  if (engine.kind === "diamond") {
    return allow("already-activated", {
      eligible: true,
      alreadyActivated: true,
      sport: teamSport,
      rulesProfileId: optIn.rulesProfileId,
      rulesProfileVersion: optIn.rulesProfileVersion,
      captureMode: optIn.captureMode,
    });
  }
  const ineligibleStatus = normalizeStatus(game.status);
  if (GAME_INELIGIBLE_STATUSES.has(ineligibleStatus)) {
    return deny(
      "ineligible-game-status",
      "This game status cannot be activated.",
      { eligible: false },
    );
  }
  const legacyEvidence = findMeaningfulLegacyTrackingData(game);
  if (legacyEvidence.length) {
    return deny(
      "legacy-data-present",
      "The game already contains legacy tracking data.",
      {
        eligible: false,
        legacyEvidence,
      },
    );
  }
  return allow("eligible", {
    eligible: true,
    alreadyActivated: false,
    sport: teamSport,
    rulesProfileId: optIn.rulesProfileId,
    rulesProfileVersion: optIn.rulesProfileVersion,
    captureMode: optIn.captureMode,
    policyRevision: policyDecision.policyRevision,
  });
}

function decideDiamondEngineClaim({
  game,
  eligibility,
  activationVerified = false,
}) {
  if (!isPlainObject(game))
    return deny("missing-game", "The game is unavailable.");
  const engine = getTrackingEngine(game);
  if (engine.kind === "diamond") {
    return allow("already-claimed", {
      action: "none",
      trackingEngine: DIAMOND_ENGINE,
    });
  }
  if (engine.kind === "legacy") {
    return deny(
      "legacy-game",
      "A legacy-owned game cannot be claimed by Diamond.",
    );
  }
  if (engine.kind === "unknown") {
    return deny(
      "unknown-tracking-engine",
      "The game has an unrecognized tracking engine.",
    );
  }
  if (
    !eligibility ||
    eligibility.eligible !== true ||
    eligibility.allowed !== true
  ) {
    return deny(
      "game-ineligible",
      "The game is not eligible for Diamond activation.",
    );
  }
  if (activationVerified !== true) {
    return deny(
      "activation-not-verified",
      "A server-verified activation is required before claiming the engine.",
    );
  }
  if (hasMeaningfulLegacyTrackingData(game)) {
    return deny(
      "legacy-data-present",
      "Legacy data appeared before the engine claim.",
    );
  }
  return allow("claim", {
    action: "claim",
    trackingEngine: DIAMOND_ENGINE,
    update: {
      trackingEngine: DIAMOND_ENGINE,
      trackingEngineRevision: 1,
      diamondProjectionRevision: 0,
      diamondProjectionStatus: "pending",
    },
  });
}

function decideDiamondCommandIdempotency({
  existingCommand = null,
  incomingHash,
  readStatus = "complete",
}) {
  if (typeof incomingHash !== "string" || !HASH_PATTERN.test(incomingHash)) {
    return deny(
      "invalid-command-hash",
      "The canonical command hash is invalid.",
    );
  }
  if (readStatus !== "complete") {
    return deny(
      "idempotency-read-incomplete",
      "The command history could not be read completely.",
      { retryable: true, action: "retry" },
    );
  }
  if (existingCommand === null || existingCommand === undefined) {
    return allow("new-command", { action: "append" });
  }
  if (
    !isPlainObject(existingCommand) ||
    typeof existingCommand.commandHash !== "string" ||
    !HASH_PATTERN.test(existingCommand.commandHash) ||
    !isPlainObject(existingCommand.result) ||
    !["accepted", "duplicate"].includes(existingCommand.result.outcome) ||
    !Number.isSafeInteger(existingCommand.result.revision) ||
    existingCommand.result.revision < 1
  ) {
    return deny(
      "command-record-invalid",
      "The existing command receipt is malformed.",
    );
  }
  if (existingCommand.commandHash !== incomingHash) {
    return deny(
      "idempotency-conflict",
      "commandId was already used with different command details.",
      {
        action: "reject",
      },
    );
  }
  return allow("duplicate-command", {
    action: "return-existing",
    outcome: "duplicate",
    result: cloneAndValidateJson(existingCommand.result, {
      nodes: 0,
      seen: new Set(),
    }),
  });
}

function decideDiamondExpectedRevision({ expectedRevision, currentRevision }) {
  try {
    normalizeNonnegativeInteger(expectedRevision, "expectedRevision");
    normalizeNonnegativeInteger(currentRevision, "currentRevision");
  } catch (error) {
    return deny("invalid-revision", error.message);
  }
  if (expectedRevision === currentRevision) {
    return allow("revision-current", {
      authoritativeRevision: currentRevision,
    });
  }
  if (expectedRevision < currentRevision) {
    return deny("stale-revision", "The scorebook changed on another device.", {
      retryable: true,
      authoritativeRevision: currentRevision,
    });
  }
  return deny(
    "future-revision",
    "The requested revision is ahead of the authoritative scorebook.",
    {
      authoritativeRevision: currentRevision,
    },
  );
}

function decideDiamondLifecycle({ lifecycle, commandType }) {
  if (!COMMAND_TYPE_SET.has(commandType)) {
    return deny("unsupported-command", "Diamond command type is unsupported.");
  }
  const commands = LIFECYCLE_COMMANDS[lifecycle];
  if (!commands)
    return deny("invalid-lifecycle", "The Diamond game lifecycle is invalid.");
  if (!commands.has(commandType)) {
    return deny(
      "lifecycle-conflict",
      `${commandType} is not allowed while the game is ${lifecycle}.`,
    );
  }
  return allow("lifecycle-allows", { lifecycle, commandType });
}

function timestampMillis(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (value && typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return Number.isSafeInteger(millis) && millis >= 0 ? millis : null;
  }
  if (value && Number.isSafeInteger(value.millis) && value.millis >= 0)
    return value.millis;
  return null;
}

function normalizeDiamondScorerLease(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) {
    throw new DiamondScorebookCoreError(
      "invalid-lease",
      "The scorer lease is malformed.",
    );
  }
  return {
    holderUid: normalizeDiamondId(value.holderUid, "lease holderUid"),
    leaseId: normalizeDiamondId(value.leaseId, "leaseId"),
    expiresAtMillis: (() => {
      const millis = timestampMillis(value.expiresAtMillis ?? value.expiresAt);
      if (millis === null) {
        throw new DiamondScorebookCoreError(
          "invalid-lease",
          "The scorer lease expiry is malformed.",
        );
      }
      return millis;
    })(),
    epoch: normalizePositiveInteger(value.epoch, "lease epoch"),
  };
}

function decideDiamondScorerLease({
  operation,
  lease,
  actorUid,
  presentedLeaseId = null,
  targetUid = null,
  replacementLeaseId = null,
  actorCanManage = false,
  eligibleTargetUids = null,
  nowMillis,
}) {
  let actor;
  let current;
  try {
    actor = normalizeDiamondId(actorUid, "actorUid");
    normalizeNonnegativeInteger(nowMillis, "nowMillis");
    current = normalizeDiamondScorerLease(lease);
  } catch (error) {
    return deny(error.code || "invalid-lease", error.message);
  }
  const active = current !== null && current.expiresAtMillis > nowMillis;
  const presentedMatches =
    active &&
    actor === current.holderUid &&
    presentedLeaseId === current.leaseId;

  if (operation === "score") {
    if (!current)
      return deny(
        "lease-required",
        "Acquire the scorer lease before scoring.",
        { retryable: true },
      );
    if (!active)
      return deny("lease-expired", "The scorer lease expired.", {
        retryable: true,
      });
    if (actor !== current.holderUid) {
      return deny(
        "lease-held-by-other",
        "Another scorer owns the active lease.",
        { retryable: true },
      );
    }
    if (!presentedMatches)
      return deny("lease-token-mismatch", "The scorer lease changed.", {
        retryable: true,
      });
    return allow("lease-current", { action: "score", lease: current });
  }

  if (operation === "acquire" || operation === "recover") {
    if (active)
      return deny(
        "lease-active",
        "An active scorer lease cannot be replaced.",
        { retryable: true },
      );
    if (operation === "recover" && actorCanManage !== true) {
      return deny(
        "manager-required",
        "Only a manager may recover an expired scorer lease.",
      );
    }
    try {
      const nextLeaseId = normalizeDiamondId(
        replacementLeaseId,
        "replacementLeaseId",
      );
      const holderUid =
        normalizeOptionalDiamondId(targetUid, "targetUid") || actor;
      if (
        eligibleTargetUids !== null &&
        (!Array.isArray(eligibleTargetUids) ||
          !eligibleTargetUids.includes(holderUid))
      ) {
        return deny(
          "ineligible-scorer",
          "The requested scorer is not eligible for this game.",
        );
      }
      return allow(
        operation === "recover" ? "lease-recovered" : "lease-acquired",
        {
          action: operation,
          nextLease: {
            holderUid,
            leaseId: nextLeaseId,
            epoch: (current?.epoch || 0) + 1,
          },
        },
      );
    } catch (error) {
      return deny("invalid-replacement-lease", error.message);
    }
  }

  if (operation === "handoff") {
    if (!presentedMatches) {
      return deny(
        "lease-token-mismatch",
        "Only the active scorer may hand off this lease.",
        { retryable: true },
      );
    }
    try {
      const nextHolderUid = normalizeDiamondId(targetUid, "targetUid");
      const nextLeaseId = normalizeDiamondId(
        replacementLeaseId,
        "replacementLeaseId",
      );
      if (nextHolderUid === actor)
        return deny("same-scorer", "Choose a different scorer for handoff.");
      if (
        eligibleTargetUids !== null &&
        (!Array.isArray(eligibleTargetUids) ||
          !eligibleTargetUids.includes(nextHolderUid))
      ) {
        return deny(
          "ineligible-scorer",
          "The requested scorer is not eligible for this game.",
        );
      }
      return allow("lease-handed-off", {
        action: "handoff",
        nextLease: {
          holderUid: nextHolderUid,
          leaseId: nextLeaseId,
          epoch: current.epoch + 1,
        },
      });
    } catch (error) {
      return deny("invalid-handoff", error.message);
    }
  }

  if (operation === "release") {
    if (!current) return allow("lease-already-released", { action: "none" });
    if (active && !presentedMatches) {
      return deny(
        "lease-token-mismatch",
        "Only the active scorer may release this lease.",
        { retryable: true },
      );
    }
    if (!active && actorCanManage !== true && actor !== current.holderUid) {
      return deny(
        "manager-required",
        "Only a manager or the former scorer may release an expired lease.",
      );
    }
    return allow("lease-released", {
      action: "release",
      previousLease: current,
    });
  }

  return deny(
    "invalid-lease-operation",
    "The scorer lease operation is unsupported.",
  );
}

function normalizedFieldName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isPublicPrivateField(key) {
  const field = normalizedFieldName(key);
  return (
    field.endsWith("uid") ||
    field.includes("email") ||
    field.includes("phone") ||
    field.includes("birthdate") ||
    field.includes("dateofbirth") ||
    field.includes("address") ||
    field.includes("transcript") ||
    field.includes("audio") ||
    field.includes("recording") ||
    field.includes("prompt") ||
    field.includes("audit") ||
    field.includes("commandhash") ||
    field.includes("commandid") ||
    field.includes("leaseid") ||
    field === "note" ||
    field === "notes" ||
    field.startsWith("private") ||
    field.includes("authorization") ||
    field.includes("token") ||
    field.includes("secret") ||
    field.includes("password") ||
    field.includes("credential")
  );
}

function isPrivateProjectionSecret(key) {
  const field = normalizedFieldName(key);
  return (
    field.includes("rawaudio") ||
    field.includes("audioblob") ||
    field.includes("audiodata") ||
    field === "audiourl" ||
    field.includes("recordingurl") ||
    field.includes("authorization") ||
    field.includes("accesstoken") ||
    field.includes("refreshtoken") ||
    field.endsWith("token") ||
    field.includes("bearer") ||
    field.includes("password") ||
    field.includes("privatekey") ||
    field.includes("credential") ||
    field === "secret"
  );
}

function sanitizeValue(value, shouldDrop, depth = 0) {
  if (depth > 20) return null;
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number")
    return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (Array.isArray(value))
    return value
      .slice(0, 500)
      .map((entry) => sanitizeValue(entry, shouldDrop, depth + 1));
  if (!isPlainObject(value)) return null;
  return Object.keys(value).reduce((result, key) => {
    if (!FORBIDDEN_OBJECT_KEYS.has(key) && !shouldDrop(key)) {
      result[key] = sanitizeValue(value[key], shouldDrop, depth + 1);
    }
    return result;
  }, {});
}

function sanitizeAllowlistedObject(value, allowedFields, shouldDrop) {
  if (!isPlainObject(value)) return {};
  return Object.keys(value).reduce((result, key) => {
    if (allowedFields.has(key) && !shouldDrop(key)) {
      result[key] = sanitizeValue(value[key], shouldDrop, 1);
    }
    return result;
  }, {});
}

function sanitizeDiamondPublicProjection(value) {
  return sanitizeAllowlistedObject(
    value,
    PUBLIC_PROJECTION_FIELDS,
    isPublicPrivateField,
  );
}

function sanitizeDiamondPrivateProjection(value) {
  return sanitizeValue(value, isPrivateProjectionSecret);
}

function sanitizeDiamondPublicEvent(value) {
  return sanitizeAllowlistedObject(
    value,
    PUBLIC_EVENT_FIELDS,
    isPublicPrivateField,
  );
}

function normalizeCursor(value) {
  if (value === null || value === undefined || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "The event cursor is invalid.",
    );
  }
  return value;
}

function buildDiamondEventPage({
  events,
  limit = 100,
  hasMore = false,
  nextCursor = null,
  readStatus = "complete",
  sourceRevision,
  visibility = "public",
  lastCompleteItems = [],
}) {
  if (!Array.isArray(events) || !Array.isArray(lastCompleteItems)) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Event page inputs must be arrays.",
    );
  }
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_EVENT_PAGE_SIZE
  ) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Event page limit must be between 1 and 200.",
    );
  }
  normalizeNonnegativeInteger(sourceRevision, "sourceRevision");
  if (!["complete", "partial", "error"].includes(readStatus)) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "Event read status is invalid.",
    );
  }
  const sanitizer =
    visibility === "private"
      ? sanitizeDiamondPrivateProjection
      : sanitizeDiamondPublicEvent;
  const bounded = events.slice(0, limit).map(sanitizer);
  const pageHasMore = hasMore === true || events.length > limit;
  const readComplete = readStatus === "complete";
  const partialEmpty = !readComplete && bounded.length === 0;
  const fallback = partialEmpty
    ? lastCompleteItems.slice(0, limit).map(sanitizer)
    : [];
  const cursor = pageHasMore ? normalizeCursor(nextCursor) : null;
  if (pageHasMore && !cursor) {
    throw new DiamondScorebookCoreError(
      "invalid-argument",
      "A truncated event page requires a next cursor.",
    );
  }
  return {
    items: partialEmpty && fallback.length ? fallback : bounded,
    nextCursor: cursor,
    complete: readComplete,
    truncated: pageHasMore || !readComplete,
    accessComplete: readComplete,
    collectionComplete: readComplete && !pageHasMore,
    absenceConfirmed: readComplete && !pageHasMore && bounded.length === 0,
    cacheableAsComplete: readComplete && !pageHasMore,
    servedFromLastComplete: partialEmpty && fallback.length > 0,
    stale: partialEmpty && fallback.length > 0,
    retryable: !readComplete,
    sourceRevision,
    ...(readComplete
      ? {}
      : {
          error: {
            code: partialEmpty
              ? "incomplete-empty-event-read"
              : "incomplete-event-read",
            message: "The event stream could not be read completely.",
            retryable: true,
          },
        }),
  };
}

function containsForbiddenVoiceState(value, key = "") {
  if (
    /(audio|recording|transcript|prompt|command.?id|actor.?uid|confirmed|accepted)/i.test(
      key,
    )
  ) {
    return true;
  }
  if (Array.isArray(value))
    return value.some((entry) => containsForbiddenVoiceState(entry));
  if (isPlainObject(value)) {
    return Object.entries(value).some(([entryKey, entryValue]) =>
      containsForbiddenVoiceState(entryValue, entryKey),
    );
  }
  return false;
}

function containsForbiddenCanonicalCommandState(value, key = "") {
  const field = normalizedFieldName(key);
  if (
    field.includes("transcript") ||
    field.includes("audio") ||
    field.includes("recording") ||
    field.includes("prompt") ||
    field.includes("email") ||
    field.includes("phone") ||
    field.includes("birthdate") ||
    field.includes("dateofbirth") ||
    field.includes("address") ||
    field.includes("authorization") ||
    field.endsWith("token") ||
    field.includes("password") ||
    field.includes("credential") ||
    field === "actoruid" ||
    field === "commandid" ||
    field === "commandhash" ||
    field === "servertimestamp" ||
    field === "servertimestampms"
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsForbiddenCanonicalCommandState(entry));
  }
  if (isPlainObject(value)) {
    return Object.entries(value).some(([entryKey, entryValue]) =>
      containsForbiddenCanonicalCommandState(entryValue, entryKey),
    );
  }
  return false;
}

function containsRawAudioField(value, key = "") {
  if (/(raw.?audio|audio.?blob|audio.?data|audio.?url|recording)/i.test(key))
    return true;
  if (Array.isArray(value))
    return value.some((entry) => containsRawAudioField(entry));
  if (isPlainObject(value)) {
    return Object.entries(value).some(([entryKey, entryValue]) =>
      containsRawAudioField(entryValue, entryKey),
    );
  }
  return false;
}

function validateDiamondVoiceProposal(value) {
  if (
    !isPlainObject(value) ||
    value.schemaVersion !== 1 ||
    value.requiresConfirmation !== true ||
    value.mutatesState !== false ||
    !VOICE_PROPOSAL_COMMANDS.has(value.type)
  ) {
    throw new DiamondScorebookCoreError(
      "invalid-voice-proposal",
      "The voice proposal does not preserve the confirmation boundary.",
    );
  }
  if (
    !Number.isFinite(value.confidence) ||
    value.confidence < 0 ||
    value.confidence > 1
  ) {
    throw new DiamondScorebookCoreError(
      "invalid-voice-proposal",
      "Voice confidence must be between zero and one.",
    );
  }
  if (
    !Array.isArray(value.unresolvedFields) ||
    value.unresolvedFields.length > MAX_VOICE_UNRESOLVED_FIELDS ||
    value.unresolvedFields.some(
      (field) =>
        typeof field !== "string" ||
        !field.trim() ||
        field !== field.trim() ||
        field.length > MAX_VOICE_FIELD_LENGTH,
    )
  ) {
    throw new DiamondScorebookCoreError(
      "invalid-voice-proposal",
      "Voice unresolved fields are malformed.",
    );
  }
  const payload = normalizeDiamondPayload(value.payload);
  if (containsForbiddenVoiceState(payload)) {
    throw new DiamondScorebookCoreError(
      "invalid-voice-proposal",
      "Voice proposals cannot contain transcripts, audio, or committed mutation state.",
    );
  }
  return {
    schemaVersion: 1,
    type: value.type,
    payload,
    confidence: value.confidence,
    unresolvedFields: [...new Set(value.unresolvedFields)],
    requiresConfirmation: true,
    mutatesState: false,
    confirmable: value.unresolvedFields.length === 0,
  };
}

function decideDiamondNotification({
  commandOutcome,
  eventType,
  source = "live-command",
  isPublic = true,
  revision,
  lastNotifiedRevision = 0,
  explicitlySuppressed = false,
}) {
  if (commandOutcome !== "accepted") {
    return {
      send: false,
      reason:
        commandOutcome === "duplicate"
          ? "duplicate-command"
          : "command-not-accepted",
    };
  }
  if (explicitlySuppressed)
    return { send: false, reason: "explicitly-suppressed" };
  if (source !== "live-command")
    return { send: false, reason: "derived-or-replayed-update" };
  if (isPublic !== true) return { send: false, reason: "private-event" };
  if (!Number.isSafeInteger(revision) || revision < 1)
    return { send: false, reason: "invalid-revision" };
  if (!Number.isSafeInteger(lastNotifiedRevision) || lastNotifiedRevision < 0) {
    return { send: false, reason: "invalid-notification-checkpoint" };
  }
  if (revision <= lastNotifiedRevision)
    return { send: false, reason: "revision-already-notified" };
  if (CORRECTION_COMMANDS.has(eventType))
    return { send: false, reason: "correction-update" };
  if (!PUBLIC_NOTIFICATION_COMMANDS.has(eventType))
    return { send: false, reason: "non-notifying-event" };
  return { send: true, reason: "new-public-live-event", revision };
}

function decideDiamondOperation({
  operation,
  policy,
  teamId,
  appBuild = 0,
  game,
  rollbackStage = "none",
}) {
  const resilientOperations = new Set([
    "read",
    "replay",
    "correct",
    "project",
    "cleanup",
  ]);
  const engine = getTrackingEngine(game || {});
  if (operation === "activate") {
    if (rollbackStage !== "none") {
      return deny(
        "activation-stopped",
        "New Diamond activation is stopped for rollback.",
      );
    }
    return getDiamondPolicyDecision({
      policy,
      teamId,
      appBuild,
      operation: "activate",
    });
  }
  if (engine.kind !== "diamond") {
    return deny(
      engine.kind === "unknown"
        ? "unknown-tracking-engine"
        : "diamond-not-owner",
      "This game is not owned by Diamond v2.",
    );
  }
  if (resilientOperations.has(operation)) {
    return allow("existing-game-operation-preserved", {
      operation,
      rollbackStage,
    });
  }
  if (operation !== "score")
    return deny("invalid-operation", "The Diamond operation is unsupported.");
  if (rollbackStage === "commands-disabled") {
    return deny(
      "scoring-stopped",
      "New Diamond scoring commands are stopped for rollback.",
    );
  }
  if (rollbackStage !== "none" && rollbackStage !== "activation-disabled") {
    return deny(
      "rollback-state-unknown",
      "The Diamond rollback state is unrecognized.",
    );
  }
  return getDiamondPolicyDecision({
    policy,
    teamId,
    appBuild,
    operation: "score",
  });
}

function cleanupGeneration(game) {
  if (!isPlainObject(game)) return null;
  const opaque =
    game.diamondScorebookInstanceId ||
    game.diamondInstanceId ||
    game.activationId;
  if (typeof opaque === "string") {
    try {
      return normalizeDiamondId(opaque, "diamond cleanup generation");
    } catch {
      return null;
    }
  }
  if (
    Number.isSafeInteger(game.trackingEngineRevision) &&
    game.trackingEngineRevision > 0
  ) {
    return `revision:${String(game.trackingEngineRevision)}`;
  }
  return null;
}

function decideDiamondDeletionCleanup({
  deletedGame,
  currentGame = null,
  currentReadStatus = "complete",
  descendantsPresent = true,
  cleanupReceipt = null,
}) {
  const deletedEngine = getTrackingEngine(deletedGame || {});
  if (deletedEngine.kind === "none" || deletedEngine.kind === "legacy") {
    return allow("not-a-diamond-game", { action: "ignore", complete: true });
  }
  if (deletedEngine.kind !== "diamond") {
    return deny(
      "unknown-tracking-engine",
      "Unknown engine ownership cannot authorize cleanup.",
      {
        action: "retain",
        retryable: true,
      },
    );
  }
  const generation = cleanupGeneration(deletedGame);
  if (!generation) {
    return deny(
      "missing-cleanup-generation",
      "Diamond cleanup lacks a stable game generation.",
      {
        action: "retain",
        retryable: true,
      },
    );
  }
  if (currentReadStatus !== "complete") {
    return deny(
      "parent-read-incomplete",
      "The current game could not be checked authoritatively.",
      {
        action: "retain",
        retryable: true,
      },
    );
  }
  if (currentGame !== null && currentGame !== undefined) {
    return deny(
      "game-recreated",
      "The game exists again; retain all descendants.",
      { action: "retain" },
    );
  }
  if (
    descendantsPresent !== true &&
    isPlainObject(cleanupReceipt) &&
    cleanupReceipt.complete === true &&
    cleanupReceipt.generation === generation
  ) {
    return allow("cleanup-already-complete", {
      action: "none",
      complete: true,
      generation,
    });
  }
  if (descendantsPresent !== true) {
    return allow("nothing-to-delete", {
      action: "record-complete",
      complete: true,
      generation,
    });
  }
  return allow("cleanup-required", {
    action: "delete-descendants",
    complete: false,
    generation,
    requireParentAbsentRecheck: true,
    requireDescendantGenerationMatch: true,
  });
}

module.exports = {
  DIAMOND_SCHEMA_VERSION,
  DIAMOND_ENGINE,
  DIAMOND_POLICY_MODES,
  DIAMOND_SPORTS,
  DIAMOND_COMMAND_TYPES,
  DiamondScorebookCoreError,
  normalizeDiamondId,
  normalizeDiamondSport,
  normalizeDiamondPayload,
  normalizeDiamondCommand,
  canonicalDiamondJson,
  hashDiamondValue,
  hashDiamondCommand,
  parseDiamondPolicy,
  getDiamondPolicyDecision,
  parseDiamondTeamOptIn,
  findMeaningfulLegacyTrackingData,
  hasMeaningfulLegacyTrackingData,
  evaluateDiamondActivationEligibility,
  decideDiamondEngineClaim,
  decideDiamondCommandIdempotency,
  decideDiamondExpectedRevision,
  decideDiamondLifecycle,
  normalizeDiamondScorerLease,
  decideDiamondScorerLease,
  sanitizeDiamondPublicProjection,
  sanitizeDiamondPrivateProjection,
  sanitizeDiamondPublicEvent,
  buildDiamondEventPage,
  validateDiamondVoiceProposal,
  decideDiamondNotification,
  decideDiamondOperation,
  decideDiamondDeletionCleanup,
};
