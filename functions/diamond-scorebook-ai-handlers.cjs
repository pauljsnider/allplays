"use strict";

const nodeCrypto = require("node:crypto");

const DIAMOND_ENGINE = "diamond-v2";
const AI_SCHEMA_VERSION = 1;
const MAX_REPLAY_PAGES = 200;
const MAX_REPLAY_ITEMS = 20_000;
const MAX_RECAP_PLAYS = 2_000;
const MAX_PACKET_BYTES = 80_000;
const MAX_DRAFT_BYTES = 64_000;
const MAX_AGGREGATED_STAT_DOCUMENTS = 100;
const MAX_STAT_SOURCES = 500;
const MAX_METRICS_PER_SOURCE = 200;
const RECAP_SOURCE_CONTROL_COLLECTION = "diamondManagerStatReadControls";
const RECAP_SOURCE_RATE_WINDOW_MS = 60 * 1000;
const RECAP_SOURCE_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
// One UI generation followed by one publication can each receive one
// transport retry, so four attempts per game remain compatible. The global
// envelope admits two such game workflows without allowing team/game rotation
// to multiply bulk reads. Each attempt is charged for both bounded query
// sentinels: 201 replay-page reads plus 101 public-player-stat reads.
const MAX_RECAP_SOURCE_BULK_READ_UNITS =
  MAX_REPLAY_PAGES + MAX_AGGREGATED_STAT_DOCUMENTS + 2;
const MAX_RECAP_SOURCE_GLOBAL_REQUESTS_PER_WINDOW = 8;
const MAX_RECAP_SOURCE_GLOBAL_READ_UNITS_PER_WINDOW =
  MAX_RECAP_SOURCE_GLOBAL_REQUESTS_PER_WINDOW *
  MAX_RECAP_SOURCE_BULK_READ_UNITS;
const MAX_RECAP_SOURCE_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW = 24;
const MAX_RECAP_SOURCE_GLOBAL_SUSTAINED_READ_UNITS_PER_WINDOW =
  MAX_RECAP_SOURCE_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW *
  MAX_RECAP_SOURCE_BULK_READ_UNITS;
const MAX_RECAP_SOURCE_REQUESTS_PER_WINDOW = 4;
const MAX_RECAP_SOURCE_READ_UNITS_PER_WINDOW =
  MAX_RECAP_SOURCE_REQUESTS_PER_WINDOW * MAX_RECAP_SOURCE_BULK_READ_UNITS;
const MAX_RECAP_SOURCE_SUSTAINED_REQUESTS_PER_WINDOW = 12;
const MAX_RECAP_SOURCE_SUSTAINED_READ_UNITS_PER_WINDOW =
  MAX_RECAP_SOURCE_SUSTAINED_REQUESTS_PER_WINDOW *
  MAX_RECAP_SOURCE_BULK_READ_UNITS;
const MAX_CONCURRENT_RECAP_SOURCE_REQUESTS = 2;
const RECAP_SOURCE_REQUEST_LEASE_MS = 3 * 60 * 1000;
const RECAP_SOURCE_RECEIPT_RETENTION_MS = 5 * 60 * 1000;
const RECAP_SOURCE_ADMISSION_DEDUPE_MS = RECAP_SOURCE_REQUEST_LEASE_MS;
const MAX_RECAP_SOURCE_RECENT_ADMISSIONS = 32;
const MAX_RECAP_SOURCE_RECENT_TERMINALS = 16;
const RECAP_SOURCE_CONTROL_QUARANTINE_MS = RECAP_SOURCE_SUSTAINED_WINDOW_MS;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const METRIC_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.%-]{0,79}$/;
const STORED_METRIC_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.%-]{0,79}$/;
const COVERAGE_FAMILIES = Object.freeze([
  "batting",
  "baserunning",
  "pitching",
  "fielding",
  "situational",
  "pitches",
  "sensors",
]);
const COVERAGE_VALUES = new Set(["complete", "partial", "not_collected"]);
const DRAFT_FIELDS = new Set([
  "schemaVersion",
  "sourceRevision",
  "coverage",
  "recap",
  "insights",
  "dataQualityNotes",
  "draft",
  "published",
  "requiresPublicationConfirmation",
  "mutatesState",
]);
const BLOCK_FIELDS = new Set(["text", "citations", "statRefs"]);
const CITATION_FIELDS = new Set(["eventId", "revision"]);
const STAT_REFERENCE_FIELDS = new Set(["statId", "metric"]);
const SENSITIVE_KEYS = new Set([
  "actor",
  "actorid",
  "actoruid",
  "audio",
  "audiodata",
  "audiourl",
  "rawaudio",
  "recording",
  "recordingurl",
  "transcript",
  "rawtranscript",
  "privatenote",
  "privatenotes",
  "note",
  "notes",
  "userid",
  "useruid",
  "email",
  "phone",
  "guardianemail",
  "medicalinfo",
  "medicalnote",
  "address",
  "credential",
  "password",
  "secret",
  "token",
]);
const SENSITIVE_CONTENT_PATTERN =
  /\b(?:actor(?:[ _-]?(?:id|uid))?|raw[ _-]?(?:audio|transcript)|audio(?:[ _-]?(?:data|url|recording))?|private[ _-]?notes?|transcript)\b/i;
const MUTATION_CLAIM_PATTERN =
  /\b(?:i|we|the app|the system|the command|the play)\s+(?:have\s+)?(?:recorded|saved|submitted|executed|applied|confirmed|published|updated|changed)\b|\b(?:the )?(?:play|command|scorebook|game data)\s+(?:was|is|has been)\s+(?:recorded|saved|submitted|executed|applied|confirmed|published|updated|changed)\b|\b(?:has|have|was)\s+been\s+(?:recorded|saved|submitted|executed|applied|confirmed|published|updated|changed)\b|^\s*(?:successfully\s+)?(?:recorded|saved|submitted|executed|applied|confirmed|published|updated|changed)(?:\s+successfully)?[.!]?\s*$/i;
const NUMERIC_TOKEN_PATTERN =
  /(?<![\p{L}\p{N}_])[-+]?\d+(?:\.\d+)?%?(?![\p{L}\p{N}_])/gu;

class DiamondAiHandlerError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "DiamondAiHandlerError";
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

function snapshotDocuments(snapshot) {
  return Array.isArray(snapshot?.docs) ? snapshot.docs : [];
}

function aiPaths(teamId, gameId) {
  const game = `teams/${teamId}/games/${gameId}`;
  const scorebook = `${game}/diamondScorebooks/v2`;
  const replay = `${game}/diamondPublic/replay`;
  return {
    team: `teams/${teamId}`,
    user: (uid) => `users/${uid}`,
    game,
    rsvp: (uid) => `${game}/rsvps/${uid}`,
    scorebook,
    publicState: `${game}/diamondPublic/state`,
    replayManifest: replay,
    replayPages: `${replay}/pages`,
    projectionRun: (projectionKey) =>
      `${scorebook}/projectionRuns/${projectionKey}`,
    publicPlayerStats: (instanceId) =>
      `${game}/diamondStatGenerations/${instanceId}/publicPlayerStats`,
    publicationReceipt: (requestId) =>
      `${scorebook}/aiPublicationReceipts/${requestId}`,
    publicationAudit: (requestId) =>
      `${scorebook}/aiPublicationAudit/${requestId}`,
  };
}

function sanitizePlainText(value) {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint < 32 || codePoint === 127 ? " " : character;
  })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNumberToken(value) {
  const percent = value.endsWith("%");
  const parsed = Number.parseFloat(percent ? value.slice(0, -1) : value);
  return Number.isFinite(parsed)
    ? `${String(parsed)}${percent ? "%" : ""}`
    : value;
}

function walkJson(value, visitor, state = null, key = "") {
  const context = state || { depth: 0, nodes: 0, seen: new Set() };
  context.nodes += 1;
  if (context.depth > 20 || context.nodes > 20_000) {
    throw new Error("JSON boundary exceeded");
  }
  visitor(key, value);
  if (Array.isArray(value)) {
    if (context.seen.has(value)) throw new Error("Cyclic JSON value");
    context.seen.add(value);
    context.depth += 1;
    for (const entry of value) {
      walkJson(entry, visitor, context, "");
    }
    context.depth -= 1;
    context.seen.delete(value);
    return;
  }
  if (!isPlainObject(value)) return;
  if (context.seen.has(value)) throw new Error("Cyclic JSON value");
  context.seen.add(value);
  context.depth += 1;
  for (const [entryKey, entry] of Object.entries(value)) {
    walkJson(entry, visitor, context, entryKey);
  }
  context.depth -= 1;
  context.seen.delete(value);
}

function normalizedSensitiveKey(key) {
  return String(key).replace(/[_-]/g, "").toLowerCase();
}

function findSensitiveData(value) {
  let found = null;
  try {
    walkJson(value, (key, entry) => {
      if (found) return;
      const normalized = normalizedSensitiveKey(key);
      if (normalized && SENSITIVE_KEYS.has(normalized)) {
        found = { kind: "key", value: key };
        return;
      }
      if (typeof entry === "string" && SENSITIVE_CONTENT_PATTERN.test(entry)) {
        found = { kind: "content", value: "sensitive-content" };
      }
    });
  } catch {
    return { kind: "invalid-json", value: "invalid-json" };
  }
  return found;
}

function containsMutationClaim(value) {
  let found = false;
  try {
    walkJson(value, (_key, entry) => {
      if (
        !found &&
        typeof entry === "string" &&
        MUTATION_CLAIM_PATTERN.test(entry)
      ) {
        found = true;
      }
    });
  } catch {
    return true;
  }
  return found;
}

function jsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function createDiamondScorebookAiHandlers(dependencies = {}) {
  const firestore = dependencies.firestore;
  const auth = dependencies.auth;
  const HttpsError = dependencies.HttpsError || DiamondAiHandlerError;
  const core = dependencies.core || require("./diamond-scorebook-core.cjs");
  const statConfig =
    dependencies.statConfig || require("./diamond-stat-config.cjs");
  const resolveDelegatedAccess =
    dependencies.resolveDelegatedAccess ||
    require("./delegated-team-context-core.cjs").resolveDelegatedAccess;
  const clock = dependencies.clock || (() => Date.now());
  const random = dependencies.random || nodeCrypto;
  const logger = dependencies.logger || {};

  if (
    !firestore?.doc ||
    !firestore?.collection ||
    typeof firestore.runTransaction !== "function"
  ) {
    throw new TypeError(
      "A Firestore dependency with documents, queries, and transactions is required.",
    );
  }
  if (!auth || typeof auth.getUser !== "function") {
    throw new TypeError("An Auth dependency with getUser is required.");
  }
  if (
    typeof HttpsError !== "function" ||
    typeof resolveDelegatedAccess !== "function" ||
    typeof core.normalizeDiamondId !== "function" ||
    typeof core.hashDiamondValue !== "function" ||
    typeof core.canonicalDiamondJson !== "function" ||
    typeof core.sanitizeDiamondPublicEvent !== "function" ||
    !Array.isArray(core.DIAMOND_COMMAND_TYPES) ||
    typeof statConfig.validateDiamondStatConfigSnapshot !== "function"
  ) {
    throw new TypeError(
      "Diamond AI handler authorization, core, and stat-config dependencies are required.",
    );
  }

  const makeError = (code, message, details = {}) =>
    new HttpsError(code, message, {
      ...details,
      diamondAiHandler: true,
    });

  function isHandlerError(error) {
    return error?.details?.diamondAiHandler === true;
  }

  function requireExactFields(value, allowed, label) {
    if (!isPlainObject(value)) {
      throw makeError("invalid-argument", `${label} must be an object.`);
    }
    if (Object.keys(value).some((key) => !allowed.has(key))) {
      throw makeError(
        "invalid-argument",
        `${label} contains unsupported fields.`,
      );
    }
    for (const key of allowed) {
      if (!own(value, key)) {
        throw makeError(
          "invalid-argument",
          `${label} omitted required field \"${key}\".`,
        );
      }
    }
  }

  function normalizeId(value, label) {
    try {
      return core.normalizeDiamondId(value, label);
    } catch (error) {
      throw makeError(
        "invalid-argument",
        error?.message || `${label} is invalid.`,
      );
    }
  }

  function normalizeStoredId(value, label, code = "failed-precondition") {
    try {
      return core.normalizeDiamondId(value, label);
    } catch (error) {
      throw makeError(code, error?.message || `${label} is invalid.`);
    }
  }

  function requireUuid(value, label) {
    const id = normalizeId(value, label);
    if (!UUID_V4_PATTERN.test(id)) {
      throw makeError(
        "invalid-argument",
        `${label} must be a cryptographically random UUID v4.`,
      );
    }
    return id.toLowerCase();
  }

  function requireRevision(value, label = "sourceRevision") {
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_REPLAY_ITEMS) {
      throw makeError(
        "invalid-argument",
        `${label} must be a bounded nonnegative integer.`,
      );
    }
    return value;
  }

  function requireHash(
    value,
    label = "checkpointHash",
    code = "invalid-argument",
  ) {
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
      throw makeError(code, `${label} must be a canonical SHA-256 hash.`);
    }
    return value;
  }

  function requireCanonicalText(value, label, maximum) {
    if (typeof value !== "string") {
      throw makeError("invalid-argument", `${label} must be text.`);
    }
    const normalized = sanitizePlainText(value);
    if (!normalized || normalized !== value || normalized.length > maximum) {
      throw makeError(
        "invalid-argument",
        `${label} must be canonical text of at most ${String(maximum)} characters.`,
      );
    }
    return normalized;
  }

  function requireIsoTimestamp(value, label = "publishedAt") {
    if (
      typeof value !== "string" ||
      value.length > 40 ||
      Number.isNaN(Date.parse(value)) ||
      new Date(value).toISOString() !== value
    ) {
      throw makeError(
        "failed-precondition",
        `${label} is not a canonical server timestamp.`,
      );
    }
    return value;
  }

  function normalizeNow() {
    let value;
    try {
      value = typeof clock === "function" ? clock() : clock?.now?.();
    } catch {
      value = null;
    }
    if (value instanceof Date) value = value.getTime();
    if (!Number.isSafeInteger(value) || value < 0) {
      throw makeError(
        "unavailable",
        "Server time is unavailable. No AI draft was published.",
        { retryable: true },
      );
    }
    return value;
  }

  function secureServerUuid(label) {
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
        { retryable: true },
      );
    }
    return value.toLowerCase();
  }

  function canonicalHash(value, label) {
    let result;
    try {
      result = core.hashDiamondValue(value);
    } catch {
      result = null;
    }
    if (typeof result !== "string" || !SHA256_PATTERN.test(result)) {
      throw makeError(
        "unavailable",
        `${label} could not be hashed canonically.`,
        { retryable: true },
      );
    }
    return result;
  }

  function canonicalEqual(left, right) {
    try {
      return (
        core.canonicalDiamondJson(left) === core.canonicalDiamondJson(right)
      );
    } catch {
      return false;
    }
  }

  function recapSourceRetryDetails(reason, retryAtMs, nowMs) {
    return {
      reason,
      retryable: true,
      retryAfterMs: Math.max(1, retryAtMs - nowMs),
    };
  }

  function recapSourceControlHashes(request, callerUid, attemptHash) {
    const scopeHash = canonicalHash(
      {
        schemaVersion: 1,
        type: "diamond-recap-source-read-scope",
        callerUid,
        teamId: request.teamId,
        gameId: request.gameId,
      },
      "The Diamond recap-source read scope",
    );
    const requestHash = canonicalHash(
      {
        schemaVersion: 1,
        type: "diamond-recap-source-read-request",
        scopeHash,
        sourceRevision: request.sourceRevision,
        attemptHash,
      },
      "The Diamond recap-source read request",
    );
    return Object.freeze({ scopeHash, requestHash, attemptHash });
  }

  function recapSourceAdmissionRef(callerUid) {
    const scopeHash = canonicalHash(
      {
        schemaVersion: 1,
        type: "diamond-recap-source-read-admission",
        callerUid,
      },
      "The Diamond recap-source global admission scope",
    );
    return Object.freeze({
      scopeHash,
      reference: firestore.doc(
        `${RECAP_SOURCE_CONTROL_COLLECTION}/recap-admission-${scopeHash.slice(7)}`,
      ),
    });
  }

  function recapSourceScopeRef(hashes) {
    return firestore.doc(
      `${RECAP_SOURCE_CONTROL_COLLECTION}/recap-scope-${hashes.scopeHash.slice(7)}`,
    );
  }

  function recapSourceControlTimestampMs(value) {
    const milliseconds =
      value instanceof Date ? value.getTime() : value?.toMillis?.();
    return Number.isSafeInteger(milliseconds) && milliseconds >= 0
      ? milliseconds
      : null;
  }

  function recapSourceControlUpdatedAtMs(snapshot) {
    const value = snapshot?.updateTime?.toMillis?.();
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function invalidRecapSourceControl(snapshot, nowMs) {
    const updatedAtMs = recapSourceControlUpdatedAtMs(snapshot);
    if (
      updatedAtMs !== null &&
      updatedAtMs + RECAP_SOURCE_CONTROL_QUARANTINE_MS <= nowMs
    ) {
      return null;
    }
    throw makeError(
      "unavailable",
      "Diamond recap-source read safety state is unavailable. Try again later.",
      { reason: "diamond-recap-source-control-invalid", retryable: true },
    );
  }

  function parseRecapSourceAdmission(snapshot, scopeHash, nowMs) {
    if (!snapshot?.exists) return null;
    const value = snapshotData(snapshot);
    const recentAttempts = Array.isArray(value?.recentAttempts)
      ? value.recentAttempts
      : null;
    if (
      !isPlainObject(value) ||
      Object.keys(value).length !== 14 ||
      value.schemaVersion !== 1 ||
      value.type !== "diamond-recap-source-read-admission" ||
      value.scopeHash !== scopeHash ||
      !Number.isSafeInteger(value.windowStartedAtMs) ||
      value.windowStartedAtMs < 0 ||
      !Number.isSafeInteger(value.windowResetAtMs) ||
      value.windowResetAtMs !==
        value.windowStartedAtMs + RECAP_SOURCE_RATE_WINDOW_MS ||
      !Number.isSafeInteger(value.requestCount) ||
      value.requestCount < 0 ||
      value.requestCount > MAX_RECAP_SOURCE_GLOBAL_REQUESTS_PER_WINDOW ||
      !Number.isSafeInteger(value.readUnits) ||
      value.readUnits < 0 ||
      value.readUnits > MAX_RECAP_SOURCE_GLOBAL_READ_UNITS_PER_WINDOW ||
      value.readUnits !==
        value.requestCount * MAX_RECAP_SOURCE_BULK_READ_UNITS ||
      !Number.isSafeInteger(value.sustainedWindowStartedAtMs) ||
      value.sustainedWindowStartedAtMs < 0 ||
      !Number.isSafeInteger(value.sustainedWindowResetAtMs) ||
      value.sustainedWindowResetAtMs !==
        value.sustainedWindowStartedAtMs + RECAP_SOURCE_SUSTAINED_WINDOW_MS ||
      !Number.isSafeInteger(value.sustainedRequestCount) ||
      value.sustainedRequestCount < 0 ||
      value.sustainedRequestCount >
        MAX_RECAP_SOURCE_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW ||
      !Number.isSafeInteger(value.sustainedReadUnits) ||
      value.sustainedReadUnits < 0 ||
      value.sustainedReadUnits >
        MAX_RECAP_SOURCE_GLOBAL_SUSTAINED_READ_UNITS_PER_WINDOW ||
      value.sustainedReadUnits !==
        value.sustainedRequestCount * MAX_RECAP_SOURCE_BULK_READ_UNITS ||
      !recentAttempts ||
      recentAttempts.length > MAX_RECAP_SOURCE_RECENT_ADMISSIONS ||
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
      recapSourceControlTimestampMs(value.expiresAt) !==
        Math.max(
          value.windowResetAtMs,
          value.sustainedWindowResetAtMs,
          value.updatedAtMs + RECAP_SOURCE_ADMISSION_DEDUPE_MS,
        )
    ) {
      return invalidRecapSourceControl(snapshot, nowMs);
    }
    return value;
  }

  function parseRecapSourceScope(snapshot, hashes, nowMs) {
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
      activeAttempts.length <= MAX_CONCURRENT_RECAP_SOURCE_REQUESTS &&
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
            entry.startedAtMs + RECAP_SOURCE_REQUEST_LEASE_MS,
      );
    const validRecentTerminals =
      recentTerminals &&
      recentTerminals.length <= MAX_RECAP_SOURCE_RECENT_TERMINALS &&
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
              !own(entry, "failureCode")
            : !own(entry, "responseHash") &&
              typeof entry.failureCode === "string" &&
              entry.failureCode.length >= 1 &&
              entry.failureCode.length <= 64),
      );
    const activeHashes = (activeAttempts || []).map(
      ({ requestHash }) => requestHash,
    );
    const terminalHashes = (recentTerminals || []).map(
      ({ requestHash }) => requestHash,
    );
    const expectedExpiresAtMs = Math.max(
      value?.windowResetAtMs || 0,
      value?.sustainedWindowResetAtMs || 0,
      ...(activeAttempts || []).map(({ leaseExpiresAtMs }) => leaseExpiresAtMs),
      ...(recentTerminals || []).map(
        ({ finishedAtMs }) => finishedAtMs + RECAP_SOURCE_RECEIPT_RETENTION_MS,
      ),
    );
    if (
      !isPlainObject(value) ||
      Object.keys(value).length !== 15 ||
      value.schemaVersion !== 1 ||
      value.type !== "diamond-recap-source-read-scope" ||
      value.scopeHash !== hashes.scopeHash ||
      !Number.isSafeInteger(value.windowStartedAtMs) ||
      value.windowStartedAtMs < 0 ||
      !Number.isSafeInteger(value.windowResetAtMs) ||
      value.windowResetAtMs !==
        value.windowStartedAtMs + RECAP_SOURCE_RATE_WINDOW_MS ||
      !Number.isSafeInteger(value.requestCount) ||
      value.requestCount < 0 ||
      value.requestCount > MAX_RECAP_SOURCE_REQUESTS_PER_WINDOW ||
      !Number.isSafeInteger(value.readUnits) ||
      value.readUnits < 0 ||
      value.readUnits > MAX_RECAP_SOURCE_READ_UNITS_PER_WINDOW ||
      value.readUnits !==
        value.requestCount * MAX_RECAP_SOURCE_BULK_READ_UNITS ||
      !Number.isSafeInteger(value.sustainedWindowStartedAtMs) ||
      value.sustainedWindowStartedAtMs < 0 ||
      !Number.isSafeInteger(value.sustainedWindowResetAtMs) ||
      value.sustainedWindowResetAtMs !==
        value.sustainedWindowStartedAtMs + RECAP_SOURCE_SUSTAINED_WINDOW_MS ||
      !Number.isSafeInteger(value.sustainedRequestCount) ||
      value.sustainedRequestCount < 0 ||
      value.sustainedRequestCount >
        MAX_RECAP_SOURCE_SUSTAINED_REQUESTS_PER_WINDOW ||
      !Number.isSafeInteger(value.sustainedReadUnits) ||
      value.sustainedReadUnits < 0 ||
      value.sustainedReadUnits >
        MAX_RECAP_SOURCE_SUSTAINED_READ_UNITS_PER_WINDOW ||
      value.sustainedReadUnits !==
        value.sustainedRequestCount * MAX_RECAP_SOURCE_BULK_READ_UNITS ||
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
      recapSourceControlTimestampMs(value.expiresAt) !== expectedExpiresAtMs
    ) {
      return invalidRecapSourceControl(snapshot, nowMs);
    }
    return value;
  }

  async function readRecapSourceControl(transaction, reference) {
    try {
      return await transaction.get(reference);
    } catch (error) {
      if (isHandlerError(error)) throw error;
      throw makeError(
        "unavailable",
        "Diamond recap-source read safety state could not be verified.",
        { retryable: true },
      );
    }
  }

  async function reserveRecapSourceAdmission(
    transaction,
    caller,
    attemptHash,
    nowMs,
  ) {
    const admissionRef = recapSourceAdmissionRef(caller.uid);
    const snapshot = await readRecapSourceControl(
      transaction,
      admissionRef.reference,
    );
    const admission = parseRecapSourceAdmission(
      snapshot,
      admissionRef.scopeHash,
      nowMs,
    );
    const windowActive = Boolean(
      admission && admission.windowResetAtMs > nowMs,
    );
    const sustainedWindowActive = Boolean(
      admission && admission.sustainedWindowResetAtMs > nowMs,
    );
    const recentAttempts = (admission?.recentAttempts || []).filter(
      (entry) => entry.admittedAtMs + RECAP_SOURCE_ADMISSION_DEDUPE_MS > nowMs,
    );
    if (recentAttempts.some((entry) => entry.attemptHash === attemptHash))
      return;

    const requestCount = windowActive ? admission.requestCount : 0;
    const readUnits = windowActive ? admission.readUnits : 0;
    const sustainedRequestCount = sustainedWindowActive
      ? admission.sustainedRequestCount
      : 0;
    const sustainedReadUnits = sustainedWindowActive
      ? admission.sustainedReadUnits
      : 0;
    const windowStartedAtMs = windowActive
      ? admission.windowStartedAtMs
      : nowMs;
    const windowResetAtMs = windowActive
      ? admission.windowResetAtMs
      : nowMs + RECAP_SOURCE_RATE_WINDOW_MS;
    const sustainedWindowStartedAtMs = sustainedWindowActive
      ? admission.sustainedWindowStartedAtMs
      : nowMs;
    const sustainedWindowResetAtMs = sustainedWindowActive
      ? admission.sustainedWindowResetAtMs
      : nowMs + RECAP_SOURCE_SUSTAINED_WINDOW_MS;
    const burstLimited =
      requestCount + 1 > MAX_RECAP_SOURCE_GLOBAL_REQUESTS_PER_WINDOW ||
      readUnits + MAX_RECAP_SOURCE_BULK_READ_UNITS >
        MAX_RECAP_SOURCE_GLOBAL_READ_UNITS_PER_WINDOW;
    const sustainedLimited =
      sustainedRequestCount + 1 >
        MAX_RECAP_SOURCE_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW ||
      sustainedReadUnits + MAX_RECAP_SOURCE_BULK_READ_UNITS >
        MAX_RECAP_SOURCE_GLOBAL_SUSTAINED_READ_UNITS_PER_WINDOW;
    if (burstLimited || sustainedLimited) {
      throw makeError(
        "resource-exhausted",
        "Diamond recap-source admission is temporarily limited.",
        recapSourceRetryDetails(
          "diamond-recap-source-admission-limited",
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
      type: "diamond-recap-source-read-admission",
      scopeHash: admissionRef.scopeHash,
      windowStartedAtMs,
      windowResetAtMs,
      requestCount: requestCount + 1,
      readUnits: readUnits + MAX_RECAP_SOURCE_BULK_READ_UNITS,
      sustainedWindowStartedAtMs,
      sustainedWindowResetAtMs,
      sustainedRequestCount: sustainedRequestCount + 1,
      sustainedReadUnits: sustainedReadUnits + MAX_RECAP_SOURCE_BULK_READ_UNITS,
      recentAttempts: [
        ...recentAttempts,
        { attemptHash, admittedAtMs: nowMs },
      ].slice(-MAX_RECAP_SOURCE_RECENT_ADMISSIONS),
      updatedAtMs: nowMs,
      expiresAt: new Date(
        Math.max(
          windowResetAtMs,
          sustainedWindowResetAtMs,
          nowMs + RECAP_SOURCE_ADMISSION_DEDUPE_MS,
        ),
      ),
    });
  }

  function recapSourceScopeValue(
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
          entry.finishedAtMs + RECAP_SOURCE_RECEIPT_RETENTION_MS > nowMs,
      )
      .slice(-MAX_RECAP_SOURCE_RECENT_TERMINALS);
    const leaseExpiresAtMs = activeAttempts.reduce(
      (maximum, entry) => Math.max(maximum, entry.leaseExpiresAtMs),
      0,
    );
    const terminalExpiresAtMs = retainedTerminals.reduce(
      (maximum, entry) =>
        Math.max(
          maximum,
          entry.finishedAtMs + RECAP_SOURCE_RECEIPT_RETENTION_MS,
        ),
      0,
    );
    return {
      schemaVersion: 1,
      type: "diamond-recap-source-read-scope",
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

  function assertOwnedRecapSourceAttempt(scope, reservation, nowMs) {
    const active = scope?.activeAttempts?.find(
      (entry) => entry.requestHash === reservation.hashes.requestHash,
    );
    if (!scope || !active || active.leaseExpiresAtMs <= nowMs) {
      throw makeError(
        "aborted",
        "The Diamond recap-source read reservation changed before completion.",
        { reason: "diamond-recap-source-reservation-lost" },
      );
    }
  }

  function removeOwnedRecapSourceAttempt(scope, reservation) {
    return scope.activeAttempts.filter(
      (entry) => entry.requestHash !== reservation.hashes.requestHash,
    );
  }

  function readReference(reader, reference) {
    if (reader && typeof reader.get === "function")
      return reader.get(reference);
    if (reference && typeof reference.get === "function")
      return reference.get();
    throw makeError(
      "unavailable",
      "A required Firestore read adapter is unavailable.",
      { retryable: true },
    );
  }

  function authoritativeEmail(authUser) {
    if (
      authUser?.emailVerified !== true ||
      typeof authUser.email !== "string"
    ) {
      return "";
    }
    return authUser.email.trim().toLowerCase();
  }

  async function loadEnabledAuthUser(context) {
    const uid = typeof context?.auth?.uid === "string" ? context.auth.uid : "";
    if (!uid || uid !== uid.trim() || uid.length > 128 || uid.includes("/")) {
      throw makeError("unauthenticated", "Sign in to use Diamond postgame AI.");
    }
    let authUser;
    try {
      authUser = await auth.getUser(uid);
    } catch (error) {
      if (
        error?.code === "auth/user-not-found" ||
        error?.code === "user-not-found"
      ) {
        throw makeError("permission-denied", "This account is not available.");
      }
      throw makeError(
        "unavailable",
        "Account access could not be verified. Try again.",
        { retryable: true },
      );
    }
    if (!authUser || authUser.uid !== uid || authUser.disabled === true) {
      throw makeError("permission-denied", "This account is not available.");
    }
    return { uid, email: authoritativeEmail(authUser) };
  }

  function resolveAccess(caller, teamId, team, user, game, rsvp) {
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
    return {
      full: access?.full === true,
      scorekeeping: access?.scorekeeping === true,
    };
  }

  function staleError(currentRevision, message) {
    throw makeError(
      "aborted",
      message ||
        "The game changed after this postgame AI source was prepared. Generate a new draft.",
      {
        reason: "stale-revision",
        authoritativeRevision: Number.isSafeInteger(currentRevision)
          ? currentRevision
          : null,
      },
    );
  }

  function validateCoverage(value, label, errorCode = "failed-precondition") {
    if (
      !isPlainObject(value) ||
      Object.keys(value).length !== COVERAGE_FAMILIES.length ||
      Object.keys(value).some((key) => !COVERAGE_FAMILIES.includes(key))
    ) {
      throw makeError(errorCode, `${label} is incomplete or malformed.`);
    }
    return Object.fromEntries(
      COVERAGE_FAMILIES.map((family) => {
        if (!COVERAGE_VALUES.has(value[family])) {
          throw makeError(errorCode, `${label} is incomplete or malformed.`);
        }
        return [family, value[family]];
      }),
    );
  }

  function validateProjectionIdentity({
    teamId,
    gameId,
    sourceRevision,
    team,
    game,
    root,
    publicState,
    replayManifest,
    projectionRun,
  }) {
    if (game.trackingEngine !== DIAMOND_ENGINE) {
      throw makeError(
        "failed-precondition",
        "This game is not owned by Diamond v2.",
        { reason: "diamond-not-owner" },
      );
    }
    if (root.schemaVersion !== 2 || root.trackingEngine !== DIAMOND_ENGINE) {
      throw makeError(
        "failed-precondition",
        "The Diamond scorebook ownership marker is invalid.",
      );
    }
    if (
      (game.teamId !== undefined && game.teamId !== teamId) ||
      root.teamId !== teamId ||
      root.gameId !== gameId
    ) {
      throw makeError(
        "failed-precondition",
        "The Diamond game and scorebook identity do not match.",
      );
    }
    const instanceId = normalizeStoredId(
      root.instanceId,
      "scorebook.instanceId",
    );
    if (game.diamondScorebookInstanceId !== instanceId) {
      throw makeError(
        "failed-precondition",
        "The Diamond scorebook generation does not match the game.",
      );
    }
    const checkpoint = root.checkpoint;
    if (
      !isPlainObject(checkpoint) ||
      !isPlainObject(checkpoint.state) ||
      !Number.isSafeInteger(checkpoint.sequence) ||
      checkpoint.sequence < 0 ||
      checkpoint.sequence > MAX_REPLAY_ITEMS ||
      checkpoint.state.revision !== checkpoint.sequence ||
      checkpoint.state.checkpointHash !== checkpoint.previousHash ||
      checkpoint.teamId !== teamId ||
      checkpoint.gameId !== gameId
    ) {
      throw makeError(
        "failed-precondition",
        "The Diamond checkpoint is malformed.",
      );
    }
    const checkpointHash = requireHash(
      checkpoint.previousHash,
      "scorebook checkpoint hash",
      "failed-precondition",
    );
    if (checkpoint.sequence !== sourceRevision) {
      staleError(checkpoint.sequence);
    }
    if (checkpoint.state.lifecycle !== "final") {
      throw makeError(
        "failed-precondition",
        "Postgame AI requires a finalized Diamond scorebook.",
        { reason: "game-not-final" },
      );
    }
    if (
      !isPlainObject(checkpoint.state.score) ||
      !Number.isSafeInteger(checkpoint.state.score.home) ||
      !Number.isSafeInteger(checkpoint.state.score.away) ||
      checkpoint.state.score.home < 0 ||
      checkpoint.state.score.away < 0
    ) {
      throw makeError(
        "failed-precondition",
        "The final Diamond score is malformed.",
      );
    }

    let configId;
    let pinnedStatConfig;
    try {
      configId = core.normalizeDiamondId(
        game.statTrackerConfigId,
        "game.statTrackerConfigId",
      );
      pinnedStatConfig = statConfig.validateDiamondStatConfigSnapshot(
        root.statConfigSnapshot,
        { teamId, configId, hashValue: core.hashDiamondValue },
      );
    } catch (error) {
      throw makeError(
        "failed-precondition",
        "The immutable Diamond stat configuration is missing or invalid.",
        { reason: error?.code || "stat-config-snapshot-invalid" },
      );
    }
    const statConfigSnapshotHash = requireHash(
      pinnedStatConfig.snapshotHash,
      "stat config snapshot hash",
      "failed-precondition",
    );
    if (game.diamondStatConfigSnapshotHash !== statConfigSnapshotHash) {
      throw makeError(
        "failed-precondition",
        "The Diamond stat configuration does not match the game claim.",
      );
    }

    const checkpointCoverage = validateCoverage(
      checkpoint.state.coverage,
      "The Diamond checkpoint coverage map",
    );
    const marker = root.diamondProjectionMarker;
    if (
      root.projectionStatus !== "complete" ||
      !isPlainObject(marker) ||
      marker.schemaVersion !== 1 ||
      marker.trackingEngine !== DIAMOND_ENGINE ||
      marker.status !== "current" ||
      marker.instanceId !== instanceId ||
      marker.sourceRevision !== sourceRevision ||
      marker.checkpointHash !== checkpointHash ||
      marker.statConfigSnapshotHash !== statConfigSnapshotHash
    ) {
      throw makeError(
        "failed-precondition",
        "The authoritative Diamond projection is not current.",
        { reason: "projection-not-current" },
      );
    }
    const projectionHash = requireHash(
      marker.projectionHash,
      "projection hash",
      "failed-precondition",
    );
    const projectionKey = normalizeStoredId(
      marker.projectionKey,
      "projection marker key",
    );
    if (
      root.projectionSourceRevision !== sourceRevision ||
      root.projectionCheckpointHash !== checkpointHash ||
      root.projectionHash !== projectionHash
    ) {
      throw makeError(
        "failed-precondition",
        "The Diamond projection marker does not match the scorebook.",
      );
    }
    if (
      game.diamondProjectionStatus !== "current" ||
      game.diamondProjectionComplete !== true ||
      game.diamondProjectionRevision !== sourceRevision ||
      game.diamondProjectionCheckpointHash !== checkpointHash ||
      game.diamondProjectionHash !== projectionHash ||
      game.diamondStatConfigSnapshotHash !== statConfigSnapshotHash ||
      game.status !== "completed"
    ) {
      throw makeError(
        "failed-precondition",
        "The final game read model is not current with the Diamond projection.",
      );
    }
    if (
      game.homeScore !== checkpoint.state.score.home ||
      game.awayScore !== checkpoint.state.score.away
    ) {
      throw makeError(
        "failed-precondition",
        "The final game score does not match the Diamond checkpoint.",
      );
    }

    if (
      publicState.schemaVersion !== 2 ||
      publicState.trackingEngine !== DIAMOND_ENGINE ||
      publicState.teamId !== teamId ||
      publicState.gameId !== gameId ||
      publicState.diamondGameId !== gameId ||
      publicState.instanceId !== instanceId ||
      publicState.sourceRevision !== sourceRevision ||
      publicState.checkpointHash !== checkpointHash ||
      publicState.projectionHash !== projectionHash ||
      publicState.projectionStatus !== "complete" ||
      publicState.authoritative !== true ||
      publicState.complete !== true ||
      publicState.lifecycle !== "final" ||
      publicState.status !== "completed" ||
      !isPlainObject(publicState.score) ||
      publicState.score.home !== checkpoint.state.score.home ||
      publicState.score.away !== checkpoint.state.score.away
    ) {
      throw makeError(
        "unavailable",
        "The public Diamond state is incomplete or not current. Try again.",
        { retryable: true },
      );
    }
    const coverage = validateCoverage(
      publicState.coverage,
      "The public Diamond coverage map",
    );
    if (!canonicalEqual(coverage, checkpointCoverage)) {
      throw makeError(
        "unavailable",
        "The public Diamond coverage does not match the final scorebook. Try again.",
        { retryable: true },
      );
    }

    if (
      replayManifest.schemaVersion !== 1 ||
      replayManifest.trackingEngine !== DIAMOND_ENGINE ||
      replayManifest.teamId !== teamId ||
      replayManifest.diamondGameId !== gameId ||
      replayManifest.instanceId !== instanceId ||
      replayManifest.sourceRevision !== sourceRevision ||
      replayManifest.checkpointHash !== checkpointHash ||
      replayManifest.projectionHash !== projectionHash ||
      replayManifest.complete !== true ||
      replayManifest.collectionComplete !== true ||
      replayManifest.revisionGapsAllowed !== true ||
      !Number.isSafeInteger(replayManifest.pageSize) ||
      replayManifest.pageSize < 1 ||
      replayManifest.pageSize > 200 ||
      !Number.isSafeInteger(replayManifest.pageCount) ||
      replayManifest.pageCount < 0 ||
      replayManifest.pageCount > MAX_REPLAY_PAGES ||
      !Number.isSafeInteger(replayManifest.itemCount) ||
      replayManifest.itemCount < 0 ||
      replayManifest.itemCount > MAX_REPLAY_ITEMS ||
      replayManifest.itemCount > sourceRevision ||
      replayManifest.ordering !== "effective-source-revision"
    ) {
      throw makeError(
        "unavailable",
        "The public Diamond replay manifest is incomplete or not current. Try again.",
        { retryable: true },
      );
    }
    if (
      replayManifest.absenceConfirmed !== (replayManifest.itemCount === 0) ||
      (replayManifest.pageCount === 0) !== (replayManifest.itemCount === 0) ||
      replayManifest.itemCount >
        replayManifest.pageCount * replayManifest.pageSize ||
      (replayManifest.pageCount > 0 &&
        replayManifest.itemCount <=
          (replayManifest.pageCount - 1) * replayManifest.pageSize) ||
      (replayManifest.pageCount === 0 &&
        (replayManifest.firstPageId !== null ||
          replayManifest.lastPageId !== null)) ||
      (replayManifest.pageCount > 0 &&
        (replayManifest.firstPageId !== "page-000001" ||
          replayManifest.lastPageId !==
            `page-${String(replayManifest.pageCount).padStart(6, "0")}`))
    ) {
      throw makeError(
        "unavailable",
        "The public Diamond replay manifest is internally inconsistent. Try again.",
        { retryable: true },
      );
    }

    if (
      projectionRun.schemaVersion !== 1 ||
      projectionRun.trackingEngine !== DIAMOND_ENGINE ||
      projectionRun.teamId !== teamId ||
      projectionRun.diamondGameId !== gameId ||
      projectionRun.instanceId !== instanceId ||
      projectionRun.projectionKey !== projectionKey ||
      projectionRun.projectionHash !== projectionHash ||
      projectionRun.sourceRevision !== sourceRevision ||
      projectionRun.checkpointHash !== checkpointHash ||
      projectionRun.statConfigSnapshotHash !== statConfigSnapshotHash ||
      projectionRun.status !== "complete" ||
      projectionRun.complete !== true ||
      !isPlainObject(projectionRun.marker) ||
      !canonicalEqual(projectionRun.marker, marker) ||
      projectionRun.replayPageCount !== replayManifest.pageCount ||
      !Number.isSafeInteger(projectionRun.publicPlayerStatCount) ||
      projectionRun.publicPlayerStatCount < 0 ||
      projectionRun.publicPlayerStatCount > MAX_AGGREGATED_STAT_DOCUMENTS
    ) {
      throw makeError(
        "unavailable",
        "The Diamond projection completion record is incomplete or not current. Try again.",
        { retryable: true },
      );
    }
    if (findSensitiveData(publicState) || findSensitiveData(replayManifest)) {
      throw makeError(
        "failed-precondition",
        "A public Diamond projection contains private data and cannot be used for AI.",
        { reason: "unsafe-public-projection" },
      );
    }

    return {
      team,
      game,
      root,
      publicState,
      replayManifest,
      projectionRun,
      instanceId,
      sourceRevision,
      checkpointHash,
      projectionHash,
      projectionKey,
      statConfigSnapshot: pinnedStatConfig,
      statConfigSnapshotHash,
      coverage,
      score: { ...checkpoint.state.score },
      currentScorerUid: checkpoint.state.currentScorerUid,
      token: {
        instanceId,
        sourceRevision,
        checkpointHash,
        projectionHash,
        projectionKey,
        statConfigSnapshotHash,
        replayPageCount: replayManifest.pageCount,
        replayItemCount: replayManifest.itemCount,
        publicPlayerStatCount: projectionRun.publicPlayerStatCount,
      },
    };
  }

  async function loadIdentity(reader, request, caller, permission) {
    const resourcePaths = aiPaths(request.teamId, request.gameId);
    let snapshots;
    try {
      snapshots = await Promise.all([
        readReference(reader, firestore.doc(resourcePaths.team)),
        readReference(reader, firestore.doc(resourcePaths.user(caller.uid))),
        readReference(reader, firestore.doc(resourcePaths.game)),
        readReference(reader, firestore.doc(resourcePaths.rsvp(caller.uid))),
        readReference(reader, firestore.doc(resourcePaths.scorebook)),
        readReference(reader, firestore.doc(resourcePaths.publicState)),
        readReference(reader, firestore.doc(resourcePaths.replayManifest)),
      ]);
    } catch (error) {
      if (isHandlerError(error)) throw error;
      throw makeError(
        "unavailable",
        "The Diamond postgame source could not be read completely. Try again.",
        { retryable: true },
      );
    }
    const [team, user, game, rsvp, root, publicState, replayManifest] =
      snapshots.map(snapshotData);
    if (!team) throw makeError("not-found", "Team not found.");
    if (!game) throw makeError("not-found", "Game not found.");
    if (!root) throw makeError("not-found", "Diamond scorebook not found.");
    const access = resolveAccess(
      caller,
      request.teamId,
      team,
      user || {},
      game,
      rsvp,
    );
    const currentScorer =
      access.scorekeeping === true &&
      isPlainObject(root.checkpoint?.state) &&
      root.checkpoint.state.currentScorerUid === caller.uid;
    if (
      (permission === "manager" && access.full !== true) ||
      (permission === "source" && access.full !== true && !currentScorer)
    ) {
      throw makeError(
        "permission-denied",
        permission === "manager"
          ? "Only a current team manager can publish a Diamond AI draft."
          : "Only a current team manager or the current scorer can prepare a Diamond recap source.",
      );
    }
    if (!publicState || !replayManifest) {
      throw makeError(
        "unavailable",
        "The current public Diamond projection is incomplete. Try again.",
        { retryable: true },
      );
    }

    const marker = root.diamondProjectionMarker;
    const projectionKey = isPlainObject(marker)
      ? normalizeStoredId(marker.projectionKey, "projection marker key")
      : null;
    let runSnapshot;
    try {
      runSnapshot = projectionKey
        ? await readReference(
            reader,
            firestore.doc(resourcePaths.projectionRun(projectionKey)),
          )
        : null;
    } catch (error) {
      if (isHandlerError(error)) throw error;
      throw makeError(
        "unavailable",
        "The Diamond projection completion record could not be read. Try again.",
        { retryable: true },
      );
    }
    const projectionRun = snapshotData(runSnapshot);
    if (!projectionRun) {
      throw makeError(
        "unavailable",
        "The Diamond projection completion record is unavailable. Try again.",
        { retryable: true },
      );
    }
    return validateProjectionIdentity({
      ...request,
      team,
      game,
      root,
      publicState,
      replayManifest,
      projectionRun,
    });
  }

  async function readIdentity(request, caller, permission) {
    try {
      return await firestore.runTransaction((transaction) =>
        loadIdentity(transaction, request, caller, permission),
      );
    } catch (error) {
      if (isHandlerError(error)) throw error;
      throw makeError(
        "unavailable",
        "The Diamond postgame identity could not be verified. Try again.",
        { retryable: true },
      );
    }
  }

  async function reserveRecapSourceRead(
    transaction,
    request,
    caller,
    permission,
    attemptHash,
    nowMs,
  ) {
    const hashes = recapSourceControlHashes(request, caller.uid, attemptHash);
    const reference = recapSourceScopeRef(hashes);
    const snapshot = await readRecapSourceControl(transaction, reference);
    const scope = parseRecapSourceScope(snapshot, hashes, nowMs);
    const allActiveAttempts = scope?.activeAttempts || [];
    const activeAttempts = allActiveAttempts.filter(
      (entry) => entry.leaseExpiresAtMs > nowMs,
    );
    const recentTerminals = (scope?.recentTerminals || []).filter(
      (entry) => entry.finishedAtMs + RECAP_SOURCE_RECEIPT_RETENTION_MS > nowMs,
    );
    const matchingActiveAttempt = allActiveAttempts.find(
      (entry) => entry.requestHash === hashes.requestHash,
    );
    const reservation = Object.freeze({
      hashes,
      reference,
      permission,
    });
    if (matchingActiveAttempt?.leaseExpiresAtMs > nowMs) {
      const identity = await loadIdentity(
        transaction,
        request,
        caller,
        permission,
      );
      return {
        reservation: Object.freeze({ ...reservation, token: identity.token }),
        identity,
      };
    }
    if (
      recentTerminals.some((entry) => entry.requestHash === hashes.requestHash)
    ) {
      throw makeError(
        "already-exists",
        "This Diamond recap-source read attempt is already terminal.",
        { reason: "diamond-recap-source-attempt-terminal" },
      );
    }
    const rearmingExpiredAttempt = Boolean(matchingActiveAttempt);
    if (activeAttempts.length >= MAX_CONCURRENT_RECAP_SOURCE_REQUESTS) {
      throw makeError(
        "resource-exhausted",
        "Too many Diamond recap-source reads are already in progress.",
        recapSourceRetryDetails(
          "diamond-recap-source-concurrency-limited",
          Math.min(
            ...activeAttempts.map(({ leaseExpiresAtMs }) => leaseExpiresAtMs),
          ),
          nowMs,
        ),
      );
    }

    const windowActive = Boolean(scope && scope.windowResetAtMs > nowMs);
    const sustainedWindowActive = Boolean(
      scope && scope.sustainedWindowResetAtMs > nowMs,
    );
    const requestCount = windowActive ? scope.requestCount : 0;
    const readUnits = windowActive ? scope.readUnits : 0;
    const sustainedRequestCount = sustainedWindowActive
      ? scope.sustainedRequestCount
      : 0;
    const sustainedReadUnits = sustainedWindowActive
      ? scope.sustainedReadUnits
      : 0;
    const windowStartedAtMs = windowActive ? scope.windowStartedAtMs : nowMs;
    const windowResetAtMs = windowActive
      ? scope.windowResetAtMs
      : nowMs + RECAP_SOURCE_RATE_WINDOW_MS;
    const sustainedWindowStartedAtMs = sustainedWindowActive
      ? scope.sustainedWindowStartedAtMs
      : nowMs;
    const sustainedWindowResetAtMs = sustainedWindowActive
      ? scope.sustainedWindowResetAtMs
      : nowMs + RECAP_SOURCE_SUSTAINED_WINDOW_MS;
    const burstLimited =
      requestCount + 1 > MAX_RECAP_SOURCE_REQUESTS_PER_WINDOW ||
      readUnits + MAX_RECAP_SOURCE_BULK_READ_UNITS >
        MAX_RECAP_SOURCE_READ_UNITS_PER_WINDOW;
    const sustainedLimited =
      sustainedRequestCount + 1 >
        MAX_RECAP_SOURCE_SUSTAINED_REQUESTS_PER_WINDOW ||
      sustainedReadUnits + MAX_RECAP_SOURCE_BULK_READ_UNITS >
        MAX_RECAP_SOURCE_SUSTAINED_READ_UNITS_PER_WINDOW;
    if (!rearmingExpiredAttempt && (burstLimited || sustainedLimited)) {
      throw makeError(
        "resource-exhausted",
        "Diamond recap-source reads are temporarily limited for this game.",
        recapSourceRetryDetails(
          "diamond-recap-source-rate-limited",
          Math.max(
            burstLimited ? windowResetAtMs : 0,
            sustainedLimited ? sustainedWindowResetAtMs : 0,
          ),
          nowMs,
        ),
      );
    }

    // The global UID admission above bounds invalid resource rotation. Keep
    // the per-game throttle decision ahead of these identity reads, then prove
    // current manager/scorer authority in this same reservation transaction.
    const identity = await loadIdentity(
      transaction,
      request,
      caller,
      permission,
    );
    const leaseExpiresAtMs = nowMs + RECAP_SOURCE_REQUEST_LEASE_MS;
    const nextActiveAttempts = [
      ...activeAttempts,
      {
        requestHash: hashes.requestHash,
        startedAtMs: nowMs,
        leaseExpiresAtMs,
      },
    ].sort((left, right) => left.requestHash.localeCompare(right.requestHash));
    transaction.set(
      reference,
      recapSourceScopeValue(
        hashes,
        nextActiveAttempts,
        recentTerminals,
        nowMs,
        requestCount + (rearmingExpiredAttempt ? 0 : 1),
        readUnits +
          (rearmingExpiredAttempt ? 0 : MAX_RECAP_SOURCE_BULK_READ_UNITS),
        windowStartedAtMs,
        windowResetAtMs,
        sustainedRequestCount + (rearmingExpiredAttempt ? 0 : 1),
        sustainedReadUnits +
          (rearmingExpiredAttempt ? 0 : MAX_RECAP_SOURCE_BULK_READ_UNITS),
        sustainedWindowStartedAtMs,
        sustainedWindowResetAtMs,
      ),
    );
    return {
      reservation: Object.freeze({ ...reservation, token: identity.token }),
      identity,
    };
  }

  async function failRecapSourceRead(reservation, failureCode) {
    let lastError = null;
    for (let closeAttempt = 0; closeAttempt < 2; closeAttempt += 1) {
      try {
        await firestore.runTransaction(async (transaction) => {
          const nowMs = normalizeNow();
          const snapshot = await readRecapSourceControl(
            transaction,
            reservation.reference,
          );
          const scope = parseRecapSourceScope(
            snapshot,
            reservation.hashes,
            nowMs,
          );
          if (!scope) return false;
          const nextActiveAttempts = removeOwnedRecapSourceAttempt(
            scope,
            reservation,
          );
          if (nextActiveAttempts.length === scope.activeAttempts.length)
            return false;
          transaction.set(
            reservation.reference,
            recapSourceScopeValue(
              reservation.hashes,
              nextActiveAttempts,
              [
                ...scope.recentTerminals,
                {
                  requestHash: reservation.hashes.requestHash,
                  status: "failed",
                  finishedAtMs: nowMs,
                  failureCode:
                    typeof failureCode === "string" && failureCode
                      ? failureCode.slice(0, 64)
                      : "unknown-failure",
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
        if (isHandlerError(error)) break;
      }
    }
    logger.error?.("diamond_recap_source_read_failure_state", {
      code:
        typeof lastError?.code === "string"
          ? lastError.code.slice(0, 64)
          : "write-failed",
    });
  }

  async function completeRecapSourceRead(
    transaction,
    request,
    caller,
    reservation,
    responseHash,
    nowMs,
  ) {
    const snapshot = await readRecapSourceControl(
      transaction,
      reservation.reference,
    );
    const scope = parseRecapSourceScope(snapshot, reservation.hashes, nowMs);
    assertOwnedRecapSourceAttempt(scope, reservation, nowMs);
    const current = await loadIdentity(
      transaction,
      request,
      caller,
      reservation.permission,
    );
    if (!canonicalEqual(reservation.token, current.token)) {
      staleError(current.sourceRevision);
    }
    transaction.set(
      reservation.reference,
      recapSourceScopeValue(
        reservation.hashes,
        removeOwnedRecapSourceAttempt(scope, reservation),
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
    return current;
  }

  async function reconcileRecapSourceCompletion(
    transaction,
    request,
    caller,
    reservation,
    responseHash,
    nowMs,
  ) {
    const snapshot = await readRecapSourceControl(
      transaction,
      reservation.reference,
    );
    const scope = parseRecapSourceScope(snapshot, reservation.hashes, nowMs);
    if (!scope) return null;
    const terminal = scope.recentTerminals.find(
      (entry) => entry.requestHash === reservation.hashes.requestHash,
    );
    if (
      terminal?.status === "complete" &&
      terminal.responseHash === responseHash
    ) {
      const current = await loadIdentity(
        transaction,
        request,
        caller,
        reservation.permission,
      );
      if (!canonicalEqual(reservation.token, current.token)) {
        staleError(current.sourceRevision);
      }
      return current;
    }
    const nextActiveAttempts = removeOwnedRecapSourceAttempt(
      scope,
      reservation,
    );
    if (nextActiveAttempts.length !== scope.activeAttempts.length) {
      const current = await loadIdentity(
        transaction,
        request,
        caller,
        reservation.permission,
      );
      if (!canonicalEqual(reservation.token, current.token)) {
        staleError(current.sourceRevision);
      }
      transaction.set(
        reservation.reference,
        recapSourceScopeValue(
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
    return null;
  }

  function validatePublicPlay(item, identity, seenIds, seenRevisions) {
    if (!isPlainObject(item)) {
      throw makeError(
        "unavailable",
        "A public Diamond replay item is malformed. Try again.",
        { retryable: true },
      );
    }
    let sanitized;
    try {
      sanitized = core.sanitizeDiamondPublicEvent(item);
    } catch {
      sanitized = null;
    }
    if (
      !sanitized ||
      !canonicalEqual(item, sanitized) ||
      findSensitiveData(item)
    ) {
      throw makeError(
        "failed-precondition",
        "A public Diamond replay item contains unsupported or private data.",
        { reason: "unsafe-public-replay" },
      );
    }
    const eventId = normalizeStoredId(item.eventId, "public play eventId");
    if (
      seenIds.has(eventId) ||
      !Number.isSafeInteger(item.revision) ||
      item.revision < 1 ||
      item.revision > identity.sourceRevision ||
      seenRevisions.has(item.revision) ||
      typeof item.type !== "string" ||
      !item.type ||
      item.type.length > 64 ||
      !core.DIAMOND_COMMAND_TYPES.includes(item.type) ||
      item.type === "private_note" ||
      item.voided === true
    ) {
      throw makeError(
        "unavailable",
        "The public Diamond replay is not a complete effective-play sequence. Try again.",
        { retryable: true },
      );
    }
    const summary = requireCanonicalText(
      item.description,
      "Public play summary",
      500,
    );
    const inningLabel =
      item.inningLabel === undefined || item.inningLabel === null
        ? ""
        : requireCanonicalText(
            item.inningLabel,
            "Public play inning label",
            80,
          );
    seenIds.add(eventId);
    seenRevisions.add(item.revision);
    return {
      eventId,
      revision: item.revision,
      summary,
      ...(inningLabel ? { inningLabel } : {}),
      voided: false,
      type: item.type,
    };
  }

  async function loadReplayPlays(identity, resourcePaths) {
    let snapshot;
    try {
      snapshot = await firestore
        .collection(resourcePaths.replayPages)
        .orderBy("pageNumber", "asc")
        .limit(MAX_REPLAY_PAGES + 1)
        .get();
    } catch {
      throw makeError(
        "unavailable",
        "The complete public Diamond replay could not be read. Try again.",
        { retryable: true },
      );
    }
    const documents = snapshotDocuments(snapshot);
    if (documents.length > MAX_REPLAY_PAGES) {
      throw makeError(
        "resource-exhausted",
        "The Diamond replay exceeds the bounded postgame AI limit.",
      );
    }
    if (documents.length !== identity.replayManifest.pageCount) {
      throw makeError(
        "unavailable",
        "The public Diamond replay page read was incomplete. Try again.",
        { retryable: true },
      );
    }
    const seenIds = new Set();
    const seenRevisions = new Set();
    const allPlays = [];
    let previousRevision = 0;
    for (let index = 0; index < documents.length; index += 1) {
      const document = documents[index];
      const page = snapshotData(document);
      const pageNumber = index + 1;
      const pageId = `page-${String(pageNumber).padStart(6, "0")}`;
      const nextPageId =
        pageNumber < documents.length
          ? `page-${String(pageNumber + 1).padStart(6, "0")}`
          : null;
      if (
        !page ||
        document.id !== pageId ||
        page.schemaVersion !== 1 ||
        page.trackingEngine !== DIAMOND_ENGINE ||
        page.teamId !== identity.root.teamId ||
        page.diamondGameId !== identity.root.gameId ||
        page.instanceId !== identity.instanceId ||
        page.sourceRevision !== identity.sourceRevision ||
        page.checkpointHash !== identity.checkpointHash ||
        page.projectionHash !== identity.projectionHash ||
        page.pageNumber !== pageNumber ||
        page.pageSize !== identity.replayManifest.pageSize ||
        page.ordering !== "effective-source-revision" ||
        page.revisionGapsAllowed !== true ||
        page.complete !== true ||
        page.collectionComplete !== (nextPageId === null) ||
        page.truncated !== (nextPageId !== null) ||
        page.nextPageId !== nextPageId ||
        !Array.isArray(page.items) ||
        page.items.length !== page.itemCount ||
        page.items.length < 1 ||
        (nextPageId !== null &&
          page.items.length !== identity.replayManifest.pageSize) ||
        page.items.length > identity.replayManifest.pageSize ||
        findSensitiveData(page)
      ) {
        throw makeError(
          "unavailable",
          "A public Diamond replay page is incomplete or not current. Try again.",
          { retryable: true },
        );
      }
      const pagePlays = page.items.map((item) =>
        validatePublicPlay(item, identity, seenIds, seenRevisions),
      );
      if (
        page.startRevision !== (pagePlays[0]?.revision ?? null) ||
        page.endRevision !== (pagePlays.at(-1)?.revision ?? null)
      ) {
        throw makeError(
          "unavailable",
          "A public Diamond replay page has inconsistent revision bounds. Try again.",
          { retryable: true },
        );
      }
      for (const play of pagePlays) {
        if (play.revision <= previousRevision) {
          throw makeError(
            "unavailable",
            "The public Diamond replay ordering is incomplete. Try again.",
            { retryable: true },
          );
        }
        previousRevision = play.revision;
        allPlays.push(play);
      }
    }
    if (allPlays.length !== identity.replayManifest.itemCount) {
      throw makeError(
        "unavailable",
        "The public Diamond replay item read was incomplete. Try again.",
        { retryable: true },
      );
    }
    const recapPlays = allPlays.filter((play) => play.type !== "record_pitch");
    if (recapPlays.length > MAX_RECAP_PLAYS) {
      throw makeError(
        "resource-exhausted",
        "The Diamond game has more than 2,000 effective non-pitch plays and cannot produce a bounded recap packet.",
      );
    }
    return recapPlays.map(({ type: _type, ...play }) => play);
  }

  function normalizeStoredMetricKey(value) {
    if (
      typeof value !== "string" ||
      value !== value.trim() ||
      !STORED_METRIC_KEY_PATTERN.test(value) ||
      SENSITIVE_KEYS.has(normalizedSensitiveKey(value))
    ) {
      throw makeError(
        "failed-precondition",
        "A public aggregate contains an unsafe metric key.",
        { reason: "unsafe-public-stat" },
      );
    }
    const packetKey = METRIC_KEY_PATTERN.test(value)
      ? value
      : `metric.${value}`;
    if (!METRIC_KEY_PATTERN.test(packetKey)) {
      throw makeError(
        "failed-precondition",
        "A public aggregate contains an unsupported metric key.",
      );
    }
    return packetKey;
  }

  function normalizeMetricValue(value) {
    if (value === null) return null;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw makeError(
          "failed-precondition",
          "A public aggregate contains a non-finite metric.",
        );
      }
      return Object.is(value, -0) ? 0 : value;
    }
    if (typeof value === "string" && value.length <= 256) return value;
    throw makeError(
      "failed-precondition",
      "A public aggregate contains an unsupported metric value.",
    );
  }

  function playerStatId(playerId) {
    const digest = canonicalHash(
      { kind: "diamond-public-player-stat", playerId },
      "The public player stat identity",
    );
    return `player-${digest.slice("sha256:".length, "sha256:".length + 40)}`;
  }

  function buildPlayerStatSource(document, identity) {
    const value = snapshotData(document);
    const playerId = normalizeStoredId(document.id, "aggregate playerId");
    if (
      !value ||
      value.schemaVersion !== 1 ||
      value.trackingEngine !== DIAMOND_ENGINE ||
      value.projectionSchemaVersion !== 1 ||
      value.playerId !== playerId ||
      value.teamId !== identity.root.teamId ||
      value.diamondGameId !== identity.root.gameId ||
      value.instanceId !== identity.instanceId ||
      value.diamondScorebookInstanceId !== identity.instanceId ||
      value.projectionGeneration !== identity.instanceId ||
      value.sourceRevision !== identity.sourceRevision ||
      value.checkpointHash !== identity.checkpointHash ||
      value.statConfigSnapshotHash !== identity.statConfigSnapshotHash ||
      value.projectionHash !== identity.projectionHash ||
      value.complete !== true ||
      findSensitiveData(value)
    ) {
      throw makeError(
        "failed-precondition",
        "A public player aggregate is unsafe, incomplete, or not current.",
        { reason: "unsafe-public-stat" },
      );
    }
    const publicIds = new Set(
      identity.statConfigSnapshot.publicPlayerStatIds,
    );
    const rawValues = new Map();
    for (const field of [
      "stats",
      "observedStats",
      "derivedStats",
      "observedDerivedStats",
    ]) {
      if (!isPlainObject(value[field])) {
        throw makeError(
          "failed-precondition",
          "A public player aggregate metric map is malformed.",
        );
      }
      for (const [rawKey, metricValue] of Object.entries(value[field])) {
        if (!publicIds.has(rawKey.toLowerCase()) || rawValues.has(rawKey)) {
          throw makeError(
            "failed-precondition",
            "A public player aggregate contains a non-public or duplicate metric.",
            { reason: "non-public-stat-in-public-projection" },
          );
        }
        rawValues.set(rawKey, normalizeMetricValue(metricValue));
      }
    }
    if (!isPlainObject(value.statCoverage)) {
      throw makeError(
        "failed-precondition",
        "A public player aggregate coverage map is malformed.",
      );
    }
    for (const [rawKey, status] of Object.entries(value.statCoverage)) {
      if (!publicIds.has(rawKey.toLowerCase())) {
        throw makeError(
          "failed-precondition",
          "A metric without explicit public visibility appeared in a public player aggregate.",
          { reason: "non-public-stat-in-public-projection" },
        );
      }
      if (!COVERAGE_VALUES.has(status)) {
        throw makeError(
          "failed-precondition",
          "A public player aggregate coverage value is invalid.",
        );
      }
      if (!rawValues.has(rawKey)) rawValues.set(rawKey, null);
    }
    if (rawValues.size > MAX_METRICS_PER_SOURCE) {
      throw makeError(
        "resource-exhausted",
        "A public player aggregate exceeds the bounded AI metric limit.",
      );
    }
    const values = {};
    const coverage = {};
    for (const [rawKey, metricValue] of [...rawValues].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const packetKey = normalizeStoredMetricKey(rawKey);
      if (own(values, packetKey)) {
        throw makeError(
          "failed-precondition",
          "Public aggregate metric normalization produced a collision.",
        );
      }
      const status = value.statCoverage[rawKey];
      if (!COVERAGE_VALUES.has(status)) {
        throw makeError(
          "failed-precondition",
          "A public player aggregate omitted metric coverage.",
        );
      }
      values[packetKey] = metricValue;
      coverage[packetKey] = status;
    }
    const publicName =
      typeof value.playerName === "string" && value.playerName
        ? requireCanonicalText(value.playerName, "Public player name", 100)
        : `Player ${playerId}`;
    return {
      statId: playerStatId(playerId),
      subjectType: "player",
      subjectId: playerId,
      label: publicName,
      values,
      coverage,
    };
  }

  async function loadPublicStats(identity, resourcePaths) {
    let snapshot;
    try {
      snapshot = await firestore
        .collection(resourcePaths.publicPlayerStats(identity.instanceId))
        .limit(MAX_AGGREGATED_STAT_DOCUMENTS + 1)
        .get();
    } catch {
      throw makeError(
        "unavailable",
        "The complete public Diamond statistics could not be read. Try again.",
        { retryable: true },
      );
    }
    const documents = snapshotDocuments(snapshot);
    if (documents.length > MAX_AGGREGATED_STAT_DOCUMENTS) {
      throw makeError(
        "resource-exhausted",
        "The Diamond public stat projection exceeds the bounded recap limit.",
      );
    }
    if (documents.length !== identity.projectionRun.publicPlayerStatCount) {
      throw makeError(
        "unavailable",
        "The public Diamond statistic read was incomplete. Try again.",
        { retryable: true },
      );
    }
    const homeName =
      typeof identity.publicState.home?.name === "string" &&
      identity.publicState.home.name
        ? requireCanonicalText(
            identity.publicState.home.name,
            "Public home team name",
            120,
          )
        : "Home";
    const awayName =
      typeof identity.publicState.away?.name === "string" &&
      identity.publicState.away.name
        ? requireCanonicalText(
            identity.publicState.away.name,
            "Public away team name",
            120,
          )
        : "Away";
    const stats = [
      {
        statId: "game-score",
        subjectType: "game",
        subjectId: identity.root.gameId,
        label: "Final score",
        values: {
          homeName,
          awayName,
          homeScore: identity.score.home,
          awayScore: identity.score.away,
        },
        coverage: {
          homeName: "complete",
          awayName: "complete",
          homeScore: "complete",
          awayScore: "complete",
        },
      },
      ...documents
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((document) => buildPlayerStatSource(document, identity)),
    ];
    if (stats.length > MAX_STAT_SOURCES) {
      throw makeError(
        "resource-exhausted",
        "The Diamond stat source packet exceeds its bounded source limit.",
      );
    }
    const ids = stats.map((entry) => entry.statId);
    if (new Set(ids).size !== ids.length) {
      throw makeError(
        "failed-precondition",
        "The Diamond stat source packet contains duplicate identities.",
      );
    }
    return stats;
  }

  async function confirmRecapSourceAdmission(caller, context, attemptHash) {
    try {
      await firestore.runTransaction((transaction) =>
        reserveRecapSourceAdmission(
          transaction,
          caller,
          attemptHash,
          normalizeNow(),
        ),
      );
      return caller;
    } catch (error) {
      if (isHandlerError(error)) throw error;
    }

    const currentCaller = await loadEnabledAuthUser(context);
    try {
      await firestore.runTransaction((transaction) =>
        reserveRecapSourceAdmission(
          transaction,
          currentCaller,
          attemptHash,
          normalizeNow(),
        ),
      );
      return currentCaller;
    } catch (error) {
      if (isHandlerError(error)) throw error;
      throw makeError(
        "unavailable",
        "Diamond recap-source admission could not be confirmed. Try again.",
        { retryable: true },
      );
    }
  }

  async function confirmRecapSourceReservation(
    request,
    caller,
    context,
    permission,
    attemptHash,
  ) {
    try {
      const result = await firestore.runTransaction((transaction) =>
        reserveRecapSourceRead(
          transaction,
          request,
          caller,
          permission,
          attemptHash,
          normalizeNow(),
        ),
      );
      return { ...result, caller };
    } catch (error) {
      if (isHandlerError(error)) throw error;
    }

    const currentCaller = await loadEnabledAuthUser(context);
    try {
      const result = await firestore.runTransaction((transaction) =>
        reserveRecapSourceRead(
          transaction,
          request,
          currentCaller,
          permission,
          attemptHash,
          normalizeNow(),
        ),
      );
      return { ...result, caller: currentCaller };
    } catch (error) {
      if (isHandlerError(error)) throw error;
      throw makeError(
        "unavailable",
        "The Diamond recap-source read reservation could not be confirmed. Try again.",
        { retryable: true },
      );
    }
  }

  async function buildSourcePacket(request, context, permission) {
    let caller = await loadEnabledAuthUser(context);
    const attemptHash = canonicalHash(
      {
        schemaVersion: 1,
        type: "diamond-recap-source-read-attempt",
        attemptId: secureServerUuid("Diamond recap-source read"),
      },
      "The Diamond recap-source read attempt",
    );
    caller = await confirmRecapSourceAdmission(caller, context, attemptHash);
    const reserved = await confirmRecapSourceReservation(
      request,
      caller,
      context,
      permission,
      attemptHash,
    );
    caller = reserved.caller;
    const { reservation, identity: before } = reserved;
    const resourcePaths = aiPaths(request.teamId, request.gameId);
    let packet;
    let failureCode = "source-bulk-read-failed";
    try {
      const [playsResult, statsResult] = await Promise.allSettled([
        loadReplayPlays(before, resourcePaths),
        loadPublicStats(before, resourcePaths),
      ]);
      const rejected = [playsResult, statsResult].find(
        (result) => result.status === "rejected",
      );
      if (rejected) throw rejected.reason;
      const plays = playsResult.value;
      const stats = statsResult.value;
      failureCode = "source-packet-invalid";
      packet = {
        sourceRevision: request.sourceRevision,
        coverage: before.coverage,
        plays,
        stats,
      };
      if (findSensitiveData(packet)) {
        throw makeError(
          "failed-precondition",
          "The sanitized Diamond recap source contains private data.",
          { reason: "unsafe-recap-packet" },
        );
      }
      if (jsonByteLength(packet) > MAX_PACKET_BYTES) {
        throw makeError(
          "resource-exhausted",
          "The complete sanitized Diamond recap source exceeds 80 KiB.",
        );
      }
    } catch (error) {
      await failRecapSourceRead(reservation, failureCode);
      if (isHandlerError(error)) throw error;
      throw makeError(
        "unavailable",
        "The complete Diamond recap source could not be loaded. Try again.",
        { retryable: true },
      );
    }

    caller = await loadEnabledAuthUser(context).catch(async (error) => {
      await failRecapSourceRead(reservation, "final-auth-recheck-failed");
      throw error;
    });
    const responseHash = canonicalHash(
      {
        schemaVersion: 1,
        type: "diamond-recap-source-read-result",
        token: reservation.token,
        packet,
      },
      "The Diamond recap-source result",
    );
    try {
      const identity = await firestore.runTransaction((transaction) =>
        completeRecapSourceRead(
          transaction,
          request,
          caller,
          reservation,
          responseHash,
          normalizeNow(),
        ),
      );
      return { identity, packet, caller };
    } catch (error) {
      if (isHandlerError(error)) {
        await failRecapSourceRead(reservation, "final-access-recheck-failed");
        throw error;
      }
    }

    try {
      caller = await loadEnabledAuthUser(context);
      const identity = await firestore.runTransaction((transaction) =>
        reconcileRecapSourceCompletion(
          transaction,
          request,
          caller,
          reservation,
          responseHash,
          normalizeNow(),
        ),
      );
      if (identity) return { identity, packet, caller };
    } catch (error) {
      await failRecapSourceRead(reservation, "completion-reconcile-failed");
      if (isHandlerError(error)) throw error;
    }
    throw makeError(
      "unavailable",
      "The Diamond recap-source response commit could not be confirmed. Try again.",
      { retryable: true },
    );
  }

  function normalizeMetricReference(value, label) {
    if (
      typeof value !== "string" ||
      value !== value.trim() ||
      !METRIC_KEY_PATTERN.test(value)
    ) {
      throw makeError("invalid-argument", `${label} is invalid.`);
    }
    return value;
  }

  function validateNumericClaims(text, citations, statRefs, packet) {
    const claims = text.match(NUMERIC_TOKEN_PATTERN) || [];
    if (!claims.length) return;
    const plays = new Map(packet.plays.map((play) => [play.eventId, play]));
    const stats = new Map(packet.stats.map((stat) => [stat.statId, stat]));
    const evidence = [
      ...citations.flatMap((citation) => {
        const play = plays.get(citation.eventId);
        return play ? [play.summary, play.inningLabel || ""] : [];
      }),
      ...statRefs.flatMap((reference) => {
        const stat = stats.get(reference.statId);
        const metric = stat?.values[reference.metric];
        return metric === null || metric === undefined ? [] : [String(metric)];
      }),
    ].join(" ");
    const evidenceNumbers = new Set(
      (evidence.match(NUMERIC_TOKEN_PATTERN) || []).map(normalizeNumberToken),
    );
    if (
      claims.some((claim) => !evidenceNumbers.has(normalizeNumberToken(claim)))
    ) {
      throw makeError(
        "invalid-argument",
        "The Diamond AI draft contains a numeric claim absent from its cited sources.",
      );
    }
  }

  function normalizeDraftBlock(value, packet, label, maximumText, requireStat) {
    requireExactFields(value, BLOCK_FIELDS, label);
    const text = requireCanonicalText(value.text, `${label} text`, maximumText);
    if (
      !Array.isArray(value.citations) ||
      value.citations.length < 1 ||
      value.citations.length > 30
    ) {
      throw makeError(
        "invalid-argument",
        `${label} must cite between one and 30 effective plays.`,
      );
    }
    const playLookup = new Map(
      packet.plays.map((play) => [play.eventId, play]),
    );
    const citationKeys = new Set();
    const citations = value.citations.map((citation) => {
      requireExactFields(citation, CITATION_FIELDS, `${label} play citation`);
      const eventId = normalizeId(citation.eventId, "citation.eventId");
      if (
        !Number.isSafeInteger(citation.revision) ||
        citation.revision < 1 ||
        citation.revision > packet.sourceRevision
      ) {
        throw makeError(
          "invalid-argument",
          "A Diamond AI play citation revision is invalid.",
        );
      }
      const play = playLookup.get(eventId);
      const key = `${eventId}:${String(citation.revision)}`;
      if (
        !play ||
        play.voided === true ||
        play.revision !== citation.revision ||
        citationKeys.has(key)
      ) {
        throw makeError(
          "invalid-argument",
          "The Diamond AI draft cites a play outside the exact effective replay.",
        );
      }
      citationKeys.add(key);
      return { eventId, revision: citation.revision };
    });
    if (!Array.isArray(value.statRefs) || value.statRefs.length > 50) {
      throw makeError(
        "invalid-argument",
        `${label} contains an invalid stat reference list.`,
      );
    }
    const statLookup = new Map(packet.stats.map((stat) => [stat.statId, stat]));
    const referenceKeys = new Set();
    const statRefs = value.statRefs.map((reference) => {
      requireExactFields(
        reference,
        STAT_REFERENCE_FIELDS,
        `${label} stat reference`,
      );
      const statId = normalizeId(reference.statId, "stat reference ID");
      const metric = normalizeMetricReference(
        reference.metric,
        "Stat reference metric",
      );
      const stat = statLookup.get(statId);
      const key = `${statId}:${metric}`;
      if (
        !stat ||
        !own(stat.values, metric) ||
        stat.values[metric] === null ||
        stat.coverage[metric] === "not_collected" ||
        referenceKeys.has(key)
      ) {
        throw makeError(
          "invalid-argument",
          "The Diamond AI draft references an unavailable or non-public metric.",
        );
      }
      referenceKeys.add(key);
      return { statId, metric };
    });
    if (requireStat && statRefs.length === 0) {
      throw makeError(
        "invalid-argument",
        `${label} must cite at least one public statistic.`,
      );
    }
    validateNumericClaims(text, citations, statRefs, packet);
    return { text, citations, statRefs };
  }

  function normalizeDraft(value, sourceRevision, packet) {
    if (jsonByteLength(value) > MAX_DRAFT_BYTES) {
      throw makeError(
        "invalid-argument",
        "The Diamond AI publication draft exceeds 64 KiB.",
      );
    }
    requireExactFields(value, DRAFT_FIELDS, "Diamond AI publication draft");
    if (findSensitiveData(value)) {
      throw makeError(
        "invalid-argument",
        "The Diamond AI draft contains transcript, audio, private-note, actor, or contact data.",
      );
    }
    if (containsMutationClaim(value)) {
      throw makeError(
        "invalid-argument",
        "The Diamond AI draft claims it changed official game data.",
      );
    }
    if (
      value.schemaVersion !== AI_SCHEMA_VERSION ||
      value.sourceRevision !== sourceRevision ||
      value.draft !== true ||
      value.published !== false ||
      value.requiresPublicationConfirmation !== true ||
      value.mutatesState !== false
    ) {
      throw makeError(
        "invalid-argument",
        "The Diamond AI draft does not preserve its revision pin and publication-confirmation flags.",
      );
    }
    const coverage = validateCoverage(
      value.coverage,
      "The Diamond AI draft coverage map",
      "invalid-argument",
    );
    if (!canonicalEqual(coverage, packet.coverage)) {
      throw makeError(
        "invalid-argument",
        "The Diamond AI draft coverage does not exactly match its source packet.",
      );
    }
    const recap = normalizeDraftBlock(
      value.recap,
      packet,
      "Diamond AI recap",
      2_400,
      false,
    );
    if (!Array.isArray(value.insights) || value.insights.length > 10) {
      throw makeError(
        "invalid-argument",
        "The Diamond AI draft contains an invalid insights list.",
      );
    }
    const insights = value.insights.map((insight, index) =>
      normalizeDraftBlock(
        insight,
        packet,
        `Diamond AI insight ${String(index + 1)}`,
        800,
        true,
      ),
    );
    if (
      !Array.isArray(value.dataQualityNotes) ||
      value.dataQualityNotes.length > 20
    ) {
      throw makeError(
        "invalid-argument",
        "The Diamond AI draft contains an invalid data-quality note list.",
      );
    }
    const dataQualityNotes = value.dataQualityNotes.map((note) =>
      requireCanonicalText(note, "Diamond AI data-quality note", 320),
    );
    if (
      dataQualityNotes.some(
        (note) => (note.match(NUMERIC_TOKEN_PATTERN) || []).length > 0,
      )
    ) {
      throw makeError(
        "invalid-argument",
        "Diamond AI data-quality notes cannot contain uncited numeric claims.",
      );
    }
    if (new Set(dataQualityNotes).size !== dataQualityNotes.length) {
      throw makeError(
        "invalid-argument",
        "The Diamond AI draft repeats a data-quality note.",
      );
    }
    const normalized = {
      schemaVersion: AI_SCHEMA_VERSION,
      sourceRevision,
      coverage,
      recap,
      insights,
      dataQualityNotes,
      draft: true,
      published: false,
      requiresPublicationConfirmation: true,
      mutatesState: false,
    };
    if (jsonByteLength(normalized) > MAX_DRAFT_BYTES) {
      throw makeError(
        "invalid-argument",
        "The normalized Diamond AI draft exceeds 64 KiB.",
      );
    }
    return normalized;
  }

  function responseFromReceipt(receipt, request, identity, caller) {
    if (
      !isPlainObject(receipt) ||
      receipt.schemaVersion !== AI_SCHEMA_VERSION ||
      receipt.trackingEngine !== DIAMOND_ENGINE ||
      receipt.teamId !== request.teamId ||
      receipt.gameId !== request.gameId ||
      receipt.instanceId !== identity.instanceId ||
      receipt.publicationId !== request.requestId ||
      receipt.requestId !== request.requestId ||
      receipt.requestHash !== request.requestHash ||
      receipt.actorUid !== caller.uid ||
      receipt.sourceRevision !== request.sourceRevision ||
      receipt.checkpointHash !== request.checkpointHash ||
      receipt.statConfigSnapshotHash !== identity.statConfigSnapshotHash ||
      receipt.projectionHash !== identity.projectionHash ||
      receipt.status !== "published" ||
      receipt.published !== true
    ) {
      throw makeError(
        "already-exists",
        "This Diamond AI publication request ID was already used for different content or by another manager.",
        { reason: "ai-publication-conflict" },
      );
    }
    return {
      published: true,
      current: true,
      sourceRevision: request.sourceRevision,
      checkpointHash: request.checkpointHash,
      publicationId: request.requestId,
      publishedAt: requireIsoTimestamp(receipt.publishedAt),
    };
  }

  async function getDiamondRecapSource(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set(["teamId", "gameId", "sourceRevision"]),
      "Diamond recap source request",
    );
    const request = {
      teamId: normalizeId(data.teamId, "teamId"),
      gameId: normalizeId(data.gameId, "gameId"),
      sourceRevision: requireRevision(data.sourceRevision),
    };
    const { identity, packet } = await buildSourcePacket(
      request,
      context,
      "source",
    );
    return {
      current: true,
      sourceRevision: request.sourceRevision,
      checkpointHash: identity.checkpointHash,
      packet,
    };
  }

  async function reconcilePublication(request, caller, transactionError) {
    const resourcePaths = aiPaths(request.teamId, request.gameId);
    const identity = await readIdentity(request, caller, "manager");
    let receiptSnapshot;
    try {
      receiptSnapshot = await firestore
        .doc(resourcePaths.publicationReceipt(request.requestId))
        .get();
    } catch {
      throw makeError(
        "unavailable",
        "The Diamond AI publication result is ambiguous and could not be reconciled. Retrying the same request ID is safe.",
        { retryable: true },
      );
    }
    const receipt = snapshotData(receiptSnapshot);
    if (receipt) return responseFromReceipt(receipt, request, identity, caller);
    throw makeError(
      "unavailable",
      "The Diamond AI publication was not confirmed. Retrying the same request ID is safe.",
      {
        retryable: true,
        causeCode:
          typeof transactionError?.code === "string"
            ? transactionError.code.slice(0, 80)
            : null,
      },
    );
  }

  async function publishDiamondAiDraft(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set([
        "requestId",
        "teamId",
        "gameId",
        "sourceRevision",
        "checkpointHash",
        "draft",
      ]),
      "Diamond AI publication request",
    );
    const request = {
      requestId: requireUuid(data.requestId, "requestId"),
      teamId: normalizeId(data.teamId, "teamId"),
      gameId: normalizeId(data.gameId, "gameId"),
      sourceRevision: requireRevision(data.sourceRevision),
      checkpointHash: requireHash(data.checkpointHash),
    };
    const source = await buildSourcePacket(request, context, "manager");
    const caller = source.caller;
    if (request.checkpointHash !== source.identity.checkpointHash) {
      staleError(source.identity.sourceRevision);
    }
    const draft = normalizeDraft(
      data.draft,
      request.sourceRevision,
      source.packet,
    );
    request.requestHash = canonicalHash(
      {
        schemaVersion: AI_SCHEMA_VERSION,
        requestId: request.requestId,
        teamId: request.teamId,
        gameId: request.gameId,
        sourceRevision: request.sourceRevision,
        checkpointHash: request.checkpointHash,
        draft,
      },
      "The Diamond AI publication request",
    );
    const publishedAt = new Date(normalizeNow()).toISOString();
    const resourcePaths = aiPaths(request.teamId, request.gameId);
    const artifact = {
      schemaVersion: AI_SCHEMA_VERSION,
      trackingEngine: DIAMOND_ENGINE,
      status: "current",
      stale: false,
      instanceId: source.identity.instanceId,
      sourceRevision: request.sourceRevision,
      checkpointHash: request.checkpointHash,
      statConfigSnapshotHash: source.identity.statConfigSnapshotHash,
      projectionHash: source.identity.projectionHash,
      publicationId: request.requestId,
      published: true,
      publishedAt,
      coverage: draft.coverage,
      recap: draft.recap,
      insights: draft.insights,
      dataQualityNotes: draft.dataQualityNotes,
    };
    if (
      findSensitiveData(artifact) ||
      jsonByteLength(artifact) > MAX_DRAFT_BYTES
    ) {
      throw makeError(
        "invalid-argument",
        "The public Diamond AI artifact is unsafe or oversized.",
      );
    }
    const receipt = {
      schemaVersion: AI_SCHEMA_VERSION,
      trackingEngine: DIAMOND_ENGINE,
      teamId: request.teamId,
      gameId: request.gameId,
      instanceId: source.identity.instanceId,
      publicationId: request.requestId,
      requestId: request.requestId,
      requestHash: request.requestHash,
      actorUid: caller.uid,
      sourceRevision: request.sourceRevision,
      checkpointHash: request.checkpointHash,
      statConfigSnapshotHash: source.identity.statConfigSnapshotHash,
      projectionHash: source.identity.projectionHash,
      status: "published",
      published: true,
      publishedAt,
    };
    const audit = {
      schemaVersion: AI_SCHEMA_VERSION,
      trackingEngine: DIAMOND_ENGINE,
      action: "publish-diamond-ai-draft",
      teamId: request.teamId,
      gameId: request.gameId,
      instanceId: source.identity.instanceId,
      publicationId: request.requestId,
      requestHash: request.requestHash,
      actorUid: caller.uid,
      sourceRevision: request.sourceRevision,
      checkpointHash: request.checkpointHash,
      statConfigSnapshotHash: source.identity.statConfigSnapshotHash,
      projectionHash: source.identity.projectionHash,
      occurredAt: publishedAt,
    };

    try {
      return await firestore.runTransaction(async (transaction) => {
        const current = await loadIdentity(
          transaction,
          request,
          caller,
          "manager",
        );
        if (!canonicalEqual(current.token, source.identity.token)) {
          staleError(current.sourceRevision);
        }
        const receiptRef = firestore.doc(
          resourcePaths.publicationReceipt(request.requestId),
        );
        let receiptSnapshot;
        try {
          receiptSnapshot = await transaction.get(receiptRef);
        } catch {
          throw makeError(
            "unavailable",
            "The prior Diamond AI publication receipt could not be checked. Try again.",
            { retryable: true },
          );
        }
        const existing = snapshotData(receiptSnapshot);
        if (existing)
          return responseFromReceipt(existing, request, current, caller);
        transaction.update(firestore.doc(resourcePaths.game), {
          aiRecap: artifact,
        });
        transaction.create(receiptRef, receipt);
        transaction.create(
          firestore.doc(resourcePaths.publicationAudit(request.requestId)),
          audit,
        );
        return {
          published: true,
          current: true,
          sourceRevision: request.sourceRevision,
          checkpointHash: request.checkpointHash,
          publicationId: request.requestId,
          publishedAt,
        };
      });
    } catch (error) {
      if (isHandlerError(error)) throw error;
      return reconcilePublication(request, caller, error);
    }
  }

  return { getDiamondRecapSource, publishDiamondAiDraft };
}

module.exports = {
  AI_SCHEMA_VERSION,
  COVERAGE_FAMILIES,
  DIAMOND_ENGINE,
  DiamondAiHandlerError,
  MAX_AGGREGATED_STAT_DOCUMENTS,
  MAX_CONCURRENT_RECAP_SOURCE_REQUESTS,
  MAX_DRAFT_BYTES,
  MAX_PACKET_BYTES,
  MAX_RECAP_PLAYS,
  MAX_RECAP_SOURCE_BULK_READ_UNITS,
  MAX_RECAP_SOURCE_GLOBAL_REQUESTS_PER_WINDOW,
  MAX_RECAP_SOURCE_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_RECAP_SOURCE_REQUESTS_PER_WINDOW,
  MAX_RECAP_SOURCE_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_REPLAY_ITEMS,
  MAX_REPLAY_PAGES,
  RECAP_SOURCE_ADMISSION_DEDUPE_MS,
  RECAP_SOURCE_CONTROL_COLLECTION,
  RECAP_SOURCE_RATE_WINDOW_MS,
  RECAP_SOURCE_RECEIPT_RETENTION_MS,
  RECAP_SOURCE_REQUEST_LEASE_MS,
  RECAP_SOURCE_SUSTAINED_WINDOW_MS,
  aiPaths,
  createDiamondScorebookAiHandlers,
};
