"use strict";

const nodeCrypto = require("node:crypto");

const DIAMOND_ENGINE = "diamond-v2";
const EFFECT_PROCESSOR_SCHEMA_VERSION = 1;
const DEFAULT_EFFECT_LEASE_MILLIS = 2 * 60 * 1000;
const DEFAULT_EFFECT_RETRY_DELAY_MILLIS = 30 * 1000;
const MAX_HIGHLIGHT_CLIPS = 24;
const MAX_CLIP_DURATION_MS = 60_000;
const LIVE_VIEWER_ORIGIN = "https://share.allplays.ai";
const NOTIFICATION_AUDIENCE_PLAN_SCHEMA_VERSION = 1;
const SHARED_GAME_PATH_FIELDS = [
  "diamondSharedGamePath",
  "sharedGamePath",
  "_sharedGamePath",
];
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PROJECTION_KEY_PATTERN = /^projection-[a-f0-9]{64}$/;
const EFFECT_KINDS = new Set([
  "notification",
  "clip-link",
  "clip-invalidation",
  "ai-stale",
  "shared-game",
]);
const TERMINAL_STATUSES = new Set([
  "completed",
  "superseded",
  "discarded",
  "invalid",
]);
const INITIAL_EFFECT_FIELDS = new Set([
  "schemaVersion",
  "trackingEngine",
  "teamId",
  "diamondGameId",
  "instanceId",
  "diamondScorebookInstanceId",
  "projectionGeneration",
  "projectionKey",
  "effectId",
  "sourceRevision",
  "checkpointHash",
  "kind",
  "dedupKey",
  "status",
  "requiresProjectionMarker",
  "activationRunPath",
  "payload",
  "createdAt",
  "payloadHash",
]);
const PROCESSOR_EFFECT_FIELDS = new Set([
  "processorSchemaVersion",
  "processorLease",
  "attemptCount",
  "lastAttempt",
  "lastError",
  "nextAttemptAtMs",
  "terminal",
  "terminalResult",
  "terminalResultHash",
  "completedAt",
  "updatedAt",
  "notificationAudiencePlan",
  "notificationAudiencePlanHash",
]);

class DiamondEffectError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "DiamondEffectError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.details = options.details;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function own(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function snapshotData(snapshot) {
  return snapshot?.exists === true && typeof snapshot.data === "function"
    ? snapshot.data() || {}
    : null;
}

function exactString(value, maximum) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : "";
}

function exactOptionalString(value, maximum) {
  if (value === null || value === undefined || value === "") return "";
  return exactString(value, maximum);
}

function normalizeNow(clock) {
  let value;
  try {
    value = typeof clock === "function" ? clock() : clock?.now?.();
  } catch {
    value = null;
  }
  if (value instanceof Date) value = value.getTime();
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new DiamondEffectError(
      "clock-unavailable",
      "Server time is unavailable for the Diamond effect lease.",
      { retryable: true },
    );
  }
  return value;
}

function timestampIso(milliseconds) {
  return new Date(milliseconds).toISOString();
}

function secureUuid(random) {
  let value;
  try {
    value =
      typeof random === "function"
        ? random()
        : typeof random?.randomUUID === "function"
          ? random.randomUUID()
          : null;
  } catch {
    value = null;
  }
  if (typeof value !== "string" || !UUID_V4_PATTERN.test(value)) {
    throw new DiamondEffectError(
      "randomness-unavailable",
      "Secure randomness is unavailable for the Diamond effect lease.",
      { retryable: true },
    );
  }
  return value.toLowerCase();
}

function effectPaths(teamId, gameId, effectDocumentId, projectionKey = null) {
  const game = `teams/${teamId}/games/${gameId}`;
  const scorebook = `${game}/diamondScorebooks/v2`;
  return {
    game,
    scorebook,
    effect: `${scorebook}/effects/${effectDocumentId}`,
    run: projectionKey ? `${scorebook}/projectionRuns/${projectionKey}` : null,
  };
}

function canonicalEffectForHash(effect) {
  return {
    schemaVersion: effect.schemaVersion,
    trackingEngine: effect.trackingEngine,
    teamId: effect.teamId,
    diamondGameId: effect.diamondGameId,
    instanceId: effect.instanceId,
    diamondScorebookInstanceId: effect.diamondScorebookInstanceId,
    projectionGeneration: effect.projectionGeneration,
    projectionKey: effect.projectionKey,
    effectId: effect.effectId,
    sourceRevision: effect.sourceRevision,
    checkpointHash: effect.checkpointHash,
    kind: effect.kind,
    dedupKey: effect.dedupKey,
    status: "pending",
    requiresProjectionMarker: effect.requiresProjectionMarker,
    activationRunPath: effect.activationRunPath,
    payload: effect.payload,
    createdAt: effect.createdAt,
  };
}

function assertAllowedFields(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new DiamondEffectError(
      "invalid-effect",
      `${label} contains unsupported fields.`,
      { details: { fields: unknown.sort() } },
    );
  }
}

function assertPayloadFields(payload, fields, kind) {
  if (!isPlainObject(payload)) {
    throw new DiamondEffectError(
      "invalid-effect-payload",
      `The ${kind} effect payload must be an object.`,
    );
  }
  assertAllowedFields(payload, new Set(fields), `${kind} payload`);
}

function requireId(core, value, label) {
  try {
    return core.normalizeDiamondId(value, label);
  } catch (error) {
    throw new DiamondEffectError("invalid-id", error.message, {
      retryable: false,
    });
  }
}

function requireText(value, maximum, field) {
  const normalized = exactString(value, maximum);
  if (!normalized) {
    throw new DiamondEffectError(
      "invalid-effect-payload",
      `${field} must be a bounded nonempty string.`,
    );
  }
  return normalized;
}

function requireOptionalText(value, maximum, field) {
  const normalized = exactOptionalString(value, maximum);
  if (value !== null && value !== undefined && value !== "" && !normalized) {
    throw new DiamondEffectError(
      "invalid-effect-payload",
      `${field} must be a bounded string.`,
    );
  }
  return normalized;
}

function requireRevision(value, field = "sourceRevision") {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DiamondEffectError(
      "invalid-effect-payload",
      `${field} must be a positive safe integer.`,
    );
  }
  return value;
}

function expectedEffectIdentity(
  kind,
  sourceRevision,
  teamId,
  gameId,
  instanceId,
) {
  const revision = String(sourceRevision).padStart(10, "0");
  const kindSegment = kind === "clip-link" ? "clip" : kind;
  const effectId =
    kind === "clip-link" ? `clip-r${revision}` : `${kindSegment}-r${revision}`;
  return {
    effectId,
    dedupKey: `${DIAMOND_ENGINE}:${teamId}:${gameId}:instance:${instanceId}:${kindSegment}:r${revision}`,
  };
}

function validateNotificationPayload(payload, effect, core) {
  assertPayloadFields(
    payload,
    [
      "effectId",
      "dedupKey",
      "sourceRevision",
      "sourceEventId",
      "title",
      "body",
      "category",
      "trackingEngine",
    ],
    "notification",
  );
  if (
    payload.effectId !== effect.effectId ||
    payload.dedupKey !== effect.dedupKey ||
    payload.sourceRevision !== effect.sourceRevision ||
    payload.trackingEngine !== DIAMOND_ENGINE ||
    payload.category !== "liveScore"
  ) {
    throw new DiamondEffectError(
      "invalid-effect-payload",
      "The notification payload does not match its immutable effect envelope.",
    );
  }
  return {
    effectId: effect.effectId,
    dedupKey: effect.dedupKey,
    sourceRevision: effect.sourceRevision,
    sourceEventId: requireId(core, payload.sourceEventId, "sourceEventId"),
    title: requireText(payload.title, 80, "title"),
    body: requireText(payload.body, 120, "body"),
    category: "liveScore",
    trackingEngine: DIAMOND_ENGINE,
  };
}

function validateClipLinkPayload(payload, effect, core) {
  assertPayloadFields(
    payload,
    [
      "effectId",
      "dedupKey",
      "sourceRevision",
      "sourceEventId",
      "startMs",
      "endMs",
      "playDescription",
      "inningLabel",
      "scoreContext",
      "status",
      "trackingEngine",
    ],
    "clip-link",
  );
  if (
    payload.effectId !== effect.effectId ||
    payload.dedupKey !== effect.dedupKey ||
    payload.sourceRevision !== effect.sourceRevision ||
    payload.trackingEngine !== DIAMOND_ENGINE ||
    payload.status !== "candidate" ||
    !Number.isSafeInteger(payload.startMs) ||
    !Number.isSafeInteger(payload.endMs) ||
    payload.startMs < 0 ||
    payload.endMs <= payload.startMs ||
    payload.endMs - payload.startMs > MAX_CLIP_DURATION_MS
  ) {
    throw new DiamondEffectError(
      "invalid-effect-payload",
      "The clip-link payload does not match its effect or contains an invalid range.",
    );
  }
  return {
    effectId: effect.effectId,
    dedupKey: effect.dedupKey,
    sourceRevision: effect.sourceRevision,
    sourceEventId: requireId(core, payload.sourceEventId, "sourceEventId"),
    startMs: payload.startMs,
    endMs: payload.endMs,
    playDescription: requireText(
      payload.playDescription,
      160,
      "playDescription",
    ),
    inningLabel: requireOptionalText(payload.inningLabel, 32, "inningLabel"),
    scoreContext: requireOptionalText(payload.scoreContext, 40, "scoreContext"),
    status: "candidate",
    trackingEngine: DIAMOND_ENGINE,
  };
}

function validateClipInvalidationPayload(payload, effect, core) {
  assertPayloadFields(
    payload,
    [
      "effectId",
      "dedupKey",
      "sourceRevision",
      "correctionEventId",
      "targetEventId",
      "status",
      "reason",
    ],
    "clip-invalidation",
  );
  if (
    payload.effectId !== effect.effectId ||
    payload.dedupKey !== effect.dedupKey ||
    payload.sourceRevision !== effect.sourceRevision ||
    payload.status !== "stale" ||
    payload.reason !== "scorebook-correction"
  ) {
    throw new DiamondEffectError(
      "invalid-effect-payload",
      "The clip invalidation does not match its immutable effect envelope.",
    );
  }
  return {
    effectId: effect.effectId,
    dedupKey: effect.dedupKey,
    sourceRevision: effect.sourceRevision,
    correctionEventId: requireId(
      core,
      payload.correctionEventId,
      "correctionEventId",
    ),
    targetEventId: requireId(core, payload.targetEventId, "targetEventId"),
    status: "stale",
    reason: "scorebook-correction",
  };
}

function validateAiStalePayload(payload, effect, core) {
  assertPayloadFields(
    payload,
    ["staleAtRevision", "affectedSourcePlayIds", "artifactFields"],
    "ai-stale",
  );
  if (
    payload.staleAtRevision !== effect.sourceRevision ||
    !Array.isArray(payload.affectedSourcePlayIds) ||
    payload.affectedSourcePlayIds.length > 20_000 ||
    !Array.isArray(payload.artifactFields) ||
    payload.artifactFields.length > 20
  ) {
    throw new DiamondEffectError(
      "invalid-effect-payload",
      "The AI staleness audit payload is malformed.",
    );
  }
  const affectedSourcePlayIds = payload.affectedSourcePlayIds.map((value) =>
    requireId(core, value, "affectedSourcePlayId"),
  );
  const artifactFields = payload.artifactFields.map((value) =>
    requireText(value, 80, "artifactField"),
  );
  if (
    new Set(affectedSourcePlayIds).size !== affectedSourcePlayIds.length ||
    new Set(artifactFields).size !== artifactFields.length
  ) {
    throw new DiamondEffectError(
      "invalid-effect-payload",
      "The AI staleness audit contains duplicate identifiers.",
    );
  }
  return {
    staleAtRevision: effect.sourceRevision,
    affectedSourcePlayIds,
    artifactFields,
  };
}

function validateSharedGamePayload(payload, effect, core) {
  assertPayloadFields(payload, ["sharedGamePath", "outcome"], "shared-game");
  const sharedGamePath = exactString(payload.sharedGamePath, 512);
  const segments = sharedGamePath.split("/");
  if (
    segments.length !== 4 ||
    !["organizations", "tournaments"].includes(segments[0]) ||
    segments[2] !== "sharedGames" ||
    segments.some(
      (segment) => !segment || segment === "." || segment === "..",
    ) ||
    !isPlainObject(payload.outcome)
  ) {
    throw new DiamondEffectError(
      "invalid-effect-payload",
      "The shared-game audit target is not canonical.",
    );
  }
  assertAllowedFields(
    payload.outcome,
    new Set([
      "final",
      "tie",
      "winnerSide",
      "winnerTeamId",
      "teamOutcomes",
      "sourceRevision",
      "checkpointHash",
    ]),
    "shared-game outcome",
  );
  if (
    typeof payload.outcome.final !== "boolean" ||
    typeof payload.outcome.tie !== "boolean" ||
    ![null, "home", "away"].includes(payload.outcome.winnerSide) ||
    payload.outcome.sourceRevision !== effect.sourceRevision ||
    payload.outcome.checkpointHash !== effect.checkpointHash ||
    !isPlainObject(payload.outcome.teamOutcomes)
  ) {
    throw new DiamondEffectError(
      "invalid-effect-payload",
      "The shared-game outcome audit is malformed.",
    );
  }
  const winnerTeamId = payload.outcome.winnerTeamId
    ? requireId(core, payload.outcome.winnerTeamId, "winnerTeamId")
    : null;
  const teamOutcomes = Object.create(null);
  for (const [teamId, outcome] of Object.entries(
    payload.outcome.teamOutcomes,
  )) {
    const normalizedTeamId = requireId(core, teamId, "outcome teamId");
    if (!["win", "loss", "tie"].includes(outcome)) {
      throw new DiamondEffectError(
        "invalid-effect-payload",
        "A shared-game team outcome is unsupported.",
      );
    }
    teamOutcomes[normalizedTeamId] = outcome;
  }
  return {
    sharedGamePath,
    outcome: {
      final: payload.outcome.final,
      tie: payload.outcome.tie,
      winnerSide: payload.outcome.winnerSide,
      winnerTeamId,
      teamOutcomes: Object.fromEntries(Object.entries(teamOutcomes)),
      sourceRevision: effect.sourceRevision,
      checkpointHash: effect.checkpointHash,
    },
  };
}

function validateEffectPayload(effect, core) {
  if (effect.kind === "notification")
    return validateNotificationPayload(effect.payload, effect, core);
  if (effect.kind === "clip-link")
    return validateClipLinkPayload(effect.payload, effect, core);
  if (effect.kind === "clip-invalidation")
    return validateClipInvalidationPayload(effect.payload, effect, core);
  if (effect.kind === "ai-stale")
    return validateAiStalePayload(effect.payload, effect, core);
  if (effect.kind === "shared-game")
    return validateSharedGamePayload(effect.payload, effect, core);
  throw new DiamondEffectError(
    "invalid-effect-payload",
    "The Diamond effect kind is unsupported.",
  );
}

function validateEffectDocument(
  raw,
  { teamId, gameId, effectDocumentId, core },
) {
  if (!isPlainObject(raw)) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The Diamond effect document is malformed.",
    );
  }
  assertAllowedFields(
    raw,
    new Set([...INITIAL_EFFECT_FIELDS, ...PROCESSOR_EFFECT_FIELDS]),
    "Diamond effect",
  );
  if (
    raw.schemaVersion !== 1 ||
    raw.trackingEngine !== DIAMOND_ENGINE ||
    raw.teamId !== teamId ||
    raw.diamondGameId !== gameId ||
    raw.requiresProjectionMarker !== true ||
    !EFFECT_KINDS.has(raw.kind) ||
    !["pending", "processing", ...TERMINAL_STATUSES].includes(raw.status)
  ) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The Diamond effect envelope does not match its resource path.",
    );
  }
  if (
    raw.nextAttemptAtMs !== undefined &&
    raw.nextAttemptAtMs !== null &&
    (!Number.isSafeInteger(raw.nextAttemptAtMs) || raw.nextAttemptAtMs < 0)
  ) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The Diamond effect retry time is malformed.",
    );
  }
  const instanceId = requireId(core, raw.instanceId, "instanceId");
  if (
    raw.diamondScorebookInstanceId !== instanceId ||
    raw.projectionGeneration !== instanceId
  ) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The Diamond effect generation markers disagree.",
    );
  }
  const projectionKey = exactString(raw.projectionKey, 96);
  if (!PROJECTION_KEY_PATTERN.test(projectionKey)) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The Diamond effect projection key is malformed.",
    );
  }
  const effectId = requireId(core, raw.effectId, "effectId");
  const normalizedEffectDocumentId = requireId(
    core,
    effectDocumentId,
    "effectDocumentId",
  );
  const sourceRevision = requireRevision(raw.sourceRevision);
  const checkpointHash = exactString(raw.checkpointHash, 80);
  const payloadHash = exactString(raw.payloadHash, 80);
  const dedupKey = exactString(raw.dedupKey, 400);
  if (
    !SHA256_PATTERN.test(checkpointHash) ||
    !SHA256_PATTERN.test(payloadHash) ||
    !dedupKey
  ) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The Diamond effect hashes or deduplication key are malformed.",
    );
  }
  const expectedIdentity = expectedEffectIdentity(
    raw.kind,
    sourceRevision,
    teamId,
    gameId,
    instanceId,
  );
  const expectedEffectDocumentId = `${expectedIdentity.effectId}--${projectionKey.slice("projection-".length)}`;
  if (
    effectId !== expectedIdentity.effectId ||
    dedupKey !== expectedIdentity.dedupKey ||
    normalizedEffectDocumentId !== expectedEffectDocumentId
  ) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The Diamond effect IDs are not canonical for their kind and revision.",
    );
  }
  const expectedRunPath = effectPaths(
    teamId,
    gameId,
    effectDocumentId,
    projectionKey,
  ).run;
  if (raw.activationRunPath !== expectedRunPath) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The Diamond effect activation run path is not canonical.",
    );
  }
  if (
    raw.createdAt !== null &&
    (typeof raw.createdAt !== "string" ||
      !Number.isFinite(Date.parse(raw.createdAt)))
  ) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The Diamond effect creation time is malformed.",
    );
  }
  let expectedPayloadHash;
  try {
    expectedPayloadHash = core.hashDiamondValue(canonicalEffectForHash(raw));
  } catch (error) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The Diamond effect payload cannot be canonically hashed.",
      { details: { causeCode: error?.code || "hash-failed" } },
    );
  }
  if (expectedPayloadHash !== payloadHash) {
    throw new DiamondEffectError(
      "effect-integrity-failed",
      "The Diamond effect payload hash does not match its immutable envelope.",
    );
  }
  const effect = {
    ...raw,
    instanceId,
    projectionKey,
    effectId,
    sourceRevision,
    checkpointHash,
    payloadHash,
    dedupKey,
  };
  effect.payload = validateEffectPayload(effect, core);
  const hasNotificationAudiencePlan = own(raw, "notificationAudiencePlan");
  const hasNotificationAudiencePlanHash = own(
    raw,
    "notificationAudiencePlanHash",
  );
  if (
    hasNotificationAudiencePlan !== hasNotificationAudiencePlanHash ||
    (effect.kind !== "notification" && hasNotificationAudiencePlan)
  ) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The Diamond effect has an incomplete or unsupported notification audience plan.",
    );
  }
  if (hasNotificationAudiencePlan) {
    effect.notificationAudiencePlan = validateStoredNotificationAudiencePlan(
      raw.notificationAudiencePlan,
      raw.notificationAudiencePlanHash,
      effect,
      { teamId, gameId },
      core,
    );
    effect.notificationAudiencePlanHash = raw.notificationAudiencePlanHash;
  }
  if (TERMINAL_STATUSES.has(effect.status)) {
    const expectedOutcome =
      effect.status === "completed"
        ? "processed"
        : effect.status === "invalid"
          ? "invalid"
          : effect.status;
    if (
      effect.terminal !== true ||
      !isPlainObject(effect.terminalResult) ||
      !SHA256_PATTERN.test(effect.terminalResultHash || "") ||
      core.hashDiamondValue(effect.terminalResult) !==
        effect.terminalResultHash ||
      effect.terminalResult.outcome !== expectedOutcome ||
      effect.terminalResult.effectId !== effect.effectId ||
      effect.terminalResult.kind !== effect.kind ||
      effect.terminalResult.dedupKey !== effect.dedupKey ||
      effect.terminalResult.sourceRevision !== effect.sourceRevision ||
      effect.terminalResult.projectionKey !== effect.projectionKey ||
      effect.terminalResult.payloadHash !== effect.payloadHash
    ) {
      throw new DiamondEffectError(
        "terminal-evidence-invalid",
        "The Diamond effect terminal evidence is incomplete or corrupt.",
      );
    }
  } else if (effect.terminal === true) {
    throw new DiamondEffectError(
      "terminal-evidence-invalid",
      "A nonterminal Diamond effect cannot claim terminal completion.",
    );
  }
  return effect;
}

function markerForRoot(root) {
  const marker = root?.diamondProjectionMarker;
  if (
    !isPlainObject(marker) ||
    marker.status !== "current" ||
    marker.trackingEngine !== DIAMOND_ENGINE ||
    !PROJECTION_KEY_PATTERN.test(marker.projectionKey || "") ||
    !SHA256_PATTERN.test(marker.projectionHash || "") ||
    !SHA256_PATTERN.test(marker.checkpointHash || "") ||
    !Number.isSafeInteger(marker.sourceRevision) ||
    marker.sourceRevision < 1
  ) {
    return null;
  }
  return marker;
}

function validateProjectionFence({ root, game, run, effect, teamId, gameId }) {
  if (isPlainObject(root?.authDeleteReconciliation)) {
    return { state: "discarded", reason: "auth-delete-reconciliation" };
  }
  if (
    !isPlainObject(root) ||
    !isPlainObject(game) ||
    root.trackingEngine !== DIAMOND_ENGINE ||
    game.trackingEngine !== DIAMOND_ENGINE ||
    root.teamId !== teamId ||
    root.gameId !== gameId ||
    root.instanceId !== effect.instanceId ||
    game.diamondScorebookInstanceId !== effect.instanceId
  ) {
    return { state: "discarded", reason: "generation-or-owner-mismatch" };
  }
  if (!isPlainObject(run)) {
    return { state: "retry", reason: "projection-run-unavailable" };
  }
  if (
    run.trackingEngine !== DIAMOND_ENGINE ||
    run.teamId !== teamId ||
    run.diamondGameId !== gameId ||
    run.instanceId !== effect.instanceId ||
    run.diamondScorebookInstanceId !== effect.instanceId ||
    run.projectionGeneration !== effect.instanceId ||
    run.projectionKey !== effect.projectionKey ||
    run.checkpointHash !== effect.checkpointHash ||
    !Number.isSafeInteger(run.sourceRevision) ||
    run.sourceRevision < effect.sourceRevision ||
    !SHA256_PATTERN.test(run.projectionHash || "")
  ) {
    return { state: "discarded", reason: "projection-run-mismatch" };
  }
  const authoritativeCheckpoint = root.checkpoint;
  if (
    !isPlainObject(authoritativeCheckpoint) ||
    !Number.isSafeInteger(authoritativeCheckpoint.sequence) ||
    authoritativeCheckpoint.sequence < 1 ||
    !SHA256_PATTERN.test(authoritativeCheckpoint.previousHash || "")
  ) {
    return { state: "retry", reason: "authoritative-checkpoint-unavailable" };
  }
  if (authoritativeCheckpoint.sequence > run.sourceRevision) {
    return { state: "superseded", reason: "authoritative-head-advanced" };
  }
  if (authoritativeCheckpoint.sequence < run.sourceRevision) {
    return { state: "retry", reason: "authoritative-checkpoint-behind-run" };
  }
  if (authoritativeCheckpoint.previousHash !== run.checkpointHash) {
    return { state: "superseded", reason: "authoritative-checkpoint-replaced" };
  }
  if (run.status !== "complete" || run.complete !== true) {
    return { state: "retry", reason: "projection-run-not-complete" };
  }
  if (
    !isPlainObject(run.marker) ||
    run.marker.status !== "current" ||
    run.marker.trackingEngine !== DIAMOND_ENGINE ||
    run.marker.instanceId !== effect.instanceId ||
    run.marker.sourceRevision !== run.sourceRevision ||
    run.marker.checkpointHash !== run.checkpointHash ||
    run.marker.projectionKey !== run.projectionKey ||
    run.marker.projectionHash !== run.projectionHash
  ) {
    return { state: "discarded", reason: "projection-run-marker-mismatch" };
  }
  const marker = markerForRoot(root);
  if (!marker) {
    return { state: "retry", reason: "projection-marker-unavailable" };
  }
  if (marker.instanceId !== effect.instanceId) {
    return { state: "discarded", reason: "projection-generation-changed" };
  }
  if (marker.sourceRevision > run.sourceRevision) {
    return { state: "superseded", reason: "projection-marker-advanced" };
  }
  if (
    marker.sourceRevision === run.sourceRevision &&
    (marker.projectionKey !== run.projectionKey ||
      marker.projectionHash !== run.projectionHash ||
      marker.checkpointHash !== run.checkpointHash)
  ) {
    return { state: "superseded", reason: "projection-replaced" };
  }
  if (
    marker.sourceRevision < run.sourceRevision ||
    marker.projectionKey !== run.projectionKey ||
    marker.projectionHash !== run.projectionHash ||
    marker.checkpointHash !== run.checkpointHash
  ) {
    return { state: "retry", reason: "projection-marker-not-current" };
  }
  if (
    game.diamondProjectionRevision !== marker.sourceRevision ||
    game.diamondProjectionHash !== marker.projectionHash ||
    game.diamondProjectionCheckpointHash !== marker.checkpointHash ||
    game.diamondProjectionStatus !== "current" ||
    game.diamondProjectionComplete !== true
  ) {
    return { state: "retry", reason: "game-projection-not-current" };
  }
  return { state: "current", marker, run };
}

function buildTerminalResult(
  core,
  effect,
  outcome,
  reason,
  nowMs,
  details = {},
) {
  const result = {
    schemaVersion: EFFECT_PROCESSOR_SCHEMA_VERSION,
    outcome,
    reason,
    effectId: effect?.effectId || null,
    kind: effect?.kind || null,
    dedupKey: effect?.dedupKey || null,
    sourceRevision: Number.isSafeInteger(effect?.sourceRevision)
      ? effect.sourceRevision
      : null,
    projectionKey: effect?.projectionKey || null,
    payloadHash: effect?.payloadHash || null,
    completedAt: timestampIso(nowMs),
    ...details,
  };
  return {
    result,
    resultHash: core.hashDiamondValue(result),
  };
}

function terminalPatch(core, effect, outcome, reason, nowMs, details = {}) {
  const { result, resultHash } = buildTerminalResult(
    core,
    effect,
    outcome,
    reason,
    nowMs,
    details,
  );
  const status =
    outcome === "processed"
      ? "completed"
      : outcome === "superseded"
        ? "superseded"
        : outcome === "invalid"
          ? "invalid"
          : "discarded";
  return {
    status,
    processorSchemaVersion: EFFECT_PROCESSOR_SCHEMA_VERSION,
    processorLease: null,
    nextAttemptAtMs: null,
    terminal: true,
    terminalResult: result,
    terminalResultHash: resultHash,
    completedAt: result.completedAt,
    updatedAt: result.completedAt,
  };
}

function invalidEffectForResult(raw) {
  return {
    effectId: exactOptionalString(raw?.effectId, 128) || null,
    kind: exactOptionalString(raw?.kind, 40) || null,
    dedupKey: null,
    sourceRevision: Number.isSafeInteger(raw?.sourceRevision)
      ? raw.sourceRevision
      : null,
    projectionKey: exactOptionalString(raw?.projectionKey, 96) || null,
    payloadHash: exactOptionalString(raw?.payloadHash, 80) || null,
  };
}

function buildViewerLink(teamId, gameId) {
  const url = new URL("/watch", LIVE_VIEWER_ORIGIN);
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("gameId", gameId);
  return url.toString();
}

function notificationAudienceUnavailable(reason) {
  return new DiamondEffectError(
    "notification-audience-unavailable",
    "The authoritative Diamond notification audiences are incomplete or changed.",
    { retryable: true, details: { reason } },
  );
}

function normalizeCanonicalSharedGamePath(value) {
  const path = exactString(value, 512);
  if (!path) return "";
  const segments = path.split("/");
  return segments.length === 4 &&
    ["organizations", "tournaments"].includes(segments[0]) &&
    segments[2] === "sharedGames" &&
    segments.every(
      (segment) =>
        segment && segment !== "." && segment !== ".." && segment.length <= 128,
    )
    ? path
    : "";
}

function sharedGamePathFromGame(game) {
  if (!isPlainObject(game)) {
    throw notificationAudienceUnavailable("source-game-missing");
  }
  const candidates = SHARED_GAME_PATH_FIELDS.filter(
    (field) =>
      own(game, field) &&
      game[field] !== null &&
      game[field] !== undefined &&
      game[field] !== "",
  ).map((field) => normalizeCanonicalSharedGamePath(game[field]));
  if (!candidates.length) return null;
  const paths = [...new Set(candidates)];
  if (paths.length !== 1 || !paths[0]) {
    throw notificationAudienceUnavailable("shared-game-path-invalid");
  }
  return paths[0];
}

function safeSharedGameId(core, value) {
  try {
    return core.normalizeDiamondId(value, "sharedGameBindingId");
  } catch {
    return "";
  }
}

function sortNotificationAudiences(audiences) {
  return [...audiences].sort((left, right) => {
    if (left.teamId < right.teamId) return -1;
    if (left.teamId > right.teamId) return 1;
    if (left.gameId < right.gameId) return -1;
    if (left.gameId > right.gameId) return 1;
    return 0;
  });
}

function buildNotificationAudience(
  core,
  effect,
  teamId,
  gameId,
  viewerTeamId = teamId,
  viewerGameId = gameId,
) {
  const idempotencyKey = expectedEffectIdentity(
    "notification",
    effect.sourceRevision,
    teamId,
    gameId,
    effect.instanceId,
  ).dedupKey;
  return {
    teamId,
    gameId,
    ...(viewerTeamId !== teamId || viewerGameId !== gameId
      ? { viewerTeamId, viewerGameId }
      : {}),
    idempotencyKey,
    viewerLink: buildViewerLink(viewerTeamId, viewerGameId),
  };
}

function buildDirectNotificationAudiencePlan(core, effect, location) {
  return {
    schemaVersion: NOTIFICATION_AUDIENCE_PLAN_SCHEMA_VERSION,
    mode: "direct",
    sourceTeamId: location.teamId,
    sourceGameId: location.gameId,
    instanceId: effect.instanceId,
    audiences: [
      buildNotificationAudience(
        core,
        effect,
        location.teamId,
        location.gameId,
      ),
    ],
  };
}

function requireSharedAudienceId(core, value, reason) {
  const normalized = safeSharedGameId(core, value);
  if (!normalized) throw notificationAudienceUnavailable(reason);
  return normalized;
}

function buildSharedNotificationAudiencePlan({
  core,
  effect,
  location,
  fence,
  sharedGamePath,
  shared,
}) {
  if (!isPlainObject(shared)) {
    throw notificationAudienceUnavailable("shared-game-missing");
  }
  const homeTeamId = requireSharedAudienceId(
    core,
    shared.homeTeamId,
    "home-team-invalid",
  );
  const awayTeamId = requireSharedAudienceId(
    core,
    shared.awayTeamId,
    "away-team-invalid",
  );
  if (
    homeTeamId === awayTeamId ||
    ![homeTeamId, awayTeamId].includes(location.teamId)
  ) {
    throw notificationAudienceUnavailable("shared-team-sides-mismatch");
  }
  if (
    shared.trackingEngine !== DIAMOND_ENGINE ||
    shared.diamondSourceTeamId !== location.teamId ||
    shared.diamondSourceGameId !== location.gameId ||
    shared.diamondScorebookInstanceId !== effect.instanceId ||
    shared.diamondProjectionRevision !== fence.marker.sourceRevision ||
    shared.diamondProjectionCheckpointHash !== fence.marker.checkpointHash ||
    shared.diamondProjectionHash !== fence.marker.projectionHash ||
    shared.diamondProjectionStatus !== "current"
  ) {
    throw notificationAudienceUnavailable("shared-diamond-claim-mismatch");
  }

  const authoritativeTeams = new Set([homeTeamId, awayTeamId]);
  if (own(shared, "teamIds")) {
    if (!Array.isArray(shared.teamIds) || shared.teamIds.length !== 2) {
      throw notificationAudienceUnavailable("shared-team-list-invalid");
    }
    const normalizedTeamIds = shared.teamIds.map((value) =>
      safeSharedGameId(core, value),
    );
    if (
      normalizedTeamIds.some((value) => !value) ||
      new Set(normalizedTeamIds).size !== 2 ||
      normalizedTeamIds.some((value) => !authoritativeTeams.has(value))
    ) {
      throw notificationAudienceUnavailable("shared-team-list-mismatch");
    }
  }

  // Canonical organization/tournament games are team-facing through a
  // synthetic shared-path ID; they do not promise a target-team local game
  // document. Keep recipient/idempotency scope on each authoritative team,
  // while every notification opens the one source Diamond ledger that the
  // exact server-owned shared claim proves is publicly resolvable.
  const audiences = sortNotificationAudiences(
    [homeTeamId, awayTeamId].map((teamId) =>
      buildNotificationAudience(
        core,
        effect,
        teamId,
        location.gameId,
        location.teamId,
        location.gameId,
      ),
    ),
  );

  return {
    schemaVersion: NOTIFICATION_AUDIENCE_PLAN_SCHEMA_VERSION,
    mode: "shared",
    sourceTeamId: location.teamId,
    sourceGameId: location.gameId,
    instanceId: effect.instanceId,
    sharedGamePath,
    audiences,
  };
}

function validateStoredNotificationAudiencePlan(
  rawPlan,
  rawHash,
  effect,
  location,
  core,
) {
  if (!isPlainObject(rawPlan) || !SHA256_PATTERN.test(rawHash || "")) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The stored Diamond notification audience plan is malformed.",
    );
  }
  const mode = rawPlan.mode;
  assertAllowedFields(
    rawPlan,
    new Set([
      "schemaVersion",
      "mode",
      "sourceTeamId",
      "sourceGameId",
      "instanceId",
      ...(mode === "shared" ? ["sharedGamePath"] : []),
      "audiences",
    ]),
    "notification audience plan",
  );
  if (
    rawPlan.schemaVersion !== NOTIFICATION_AUDIENCE_PLAN_SCHEMA_VERSION ||
    !["direct", "shared"].includes(mode) ||
    rawPlan.sourceTeamId !== location.teamId ||
    rawPlan.sourceGameId !== location.gameId ||
    rawPlan.instanceId !== effect.instanceId ||
    !Array.isArray(rawPlan.audiences) ||
    rawPlan.audiences.length !== (mode === "shared" ? 2 : 1)
  ) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The stored Diamond notification audience plan does not match its effect.",
    );
  }
  const sharedGamePath =
    mode === "shared"
      ? normalizeCanonicalSharedGamePath(rawPlan.sharedGamePath)
      : null;
  if (mode === "shared" && !sharedGamePath) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The stored Diamond notification audience path is malformed.",
    );
  }
  const audiences = rawPlan.audiences.map((rawAudience) => {
    if (!isPlainObject(rawAudience)) {
      throw new DiamondEffectError(
        "invalid-effect",
        "A stored Diamond notification audience is malformed.",
      );
    }
    assertAllowedFields(
      rawAudience,
      new Set([
        "teamId",
        "gameId",
        "viewerTeamId",
        "viewerGameId",
        "idempotencyKey",
        "viewerLink",
      ]),
      "notification audience",
    );
    const teamId = requireId(core, rawAudience.teamId, "audienceTeamId");
    const gameId = requireId(core, rawAudience.gameId, "audienceGameId");
    const expected = buildNotificationAudience(
      core,
      effect,
      teamId,
      gameId,
      mode === "shared" ? location.teamId : teamId,
      mode === "shared" ? location.gameId : gameId,
    );
    if (
      gameId !== location.gameId ||
      rawAudience.viewerTeamId !== expected.viewerTeamId ||
      rawAudience.viewerGameId !== expected.viewerGameId ||
      rawAudience.idempotencyKey !== expected.idempotencyKey ||
      rawAudience.viewerLink !== expected.viewerLink
    ) {
      throw new DiamondEffectError(
        "invalid-effect",
        "A stored Diamond notification audience identity is not canonical.",
      );
    }
    return expected;
  });
  const sorted = sortNotificationAudiences(audiences);
  if (
    new Set(sorted.map(({ teamId }) => teamId)).size !== sorted.length ||
    sorted.some(
      (audience, index) =>
        audience.teamId !== audiences[index].teamId ||
        audience.gameId !== audiences[index].gameId,
    ) ||
    !sorted.some(
      ({ teamId, gameId }) =>
        teamId === location.teamId && gameId === location.gameId,
    ) ||
    (mode === "direct" &&
      (sorted[0].teamId !== location.teamId ||
        sorted[0].gameId !== location.gameId))
  ) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The stored Diamond notification audiences are duplicated or misbound.",
    );
  }
  const normalized = {
    schemaVersion: NOTIFICATION_AUDIENCE_PLAN_SCHEMA_VERSION,
    mode,
    sourceTeamId: location.teamId,
    sourceGameId: location.gameId,
    instanceId: effect.instanceId,
    ...(sharedGamePath ? { sharedGamePath } : {}),
    audiences: sorted,
  };
  if (
    core.hashDiamondValue(normalized) !== rawHash ||
    core.hashDiamondValue(rawPlan) !== rawHash
  ) {
    throw new DiamondEffectError(
      "invalid-effect",
      "The stored Diamond notification audience plan failed integrity validation.",
    );
  }
  return normalized;
}

function normalizeNotificationProviderResult(value, dedupKey, instanceId) {
  if (
    !isPlainObject(value) ||
    ![
      "sent",
      "partial",
      "deduplicated",
      "no-recipients",
      "delivery-uncertain",
    ].includes(value.outcome) ||
    value.idempotencyKey !== dedupKey ||
    value.instanceId !== instanceId
  ) {
    throw new DiamondEffectError(
      "notification-result-ambiguous",
      "The notification provider did not return durable idempotency evidence.",
      { retryable: true },
    );
  }
  const providerReceiptId = exactOptionalString(value.providerReceiptId, 256);
  if (
    value.providerReceiptId !== null &&
    value.providerReceiptId !== undefined &&
    value.providerReceiptId !== "" &&
    !providerReceiptId
  ) {
    throw new DiamondEffectError(
      "notification-result-ambiguous",
      "The notification provider receipt is malformed.",
      { retryable: true },
    );
  }
  return {
    providerOutcome: value.outcome,
    ...(providerReceiptId ? { providerReceiptId } : {}),
  };
}

function aggregateNotificationProviderResults(results) {
  if (results.length === 1) return results[0].providerResult;
  const outcomes = results.map(
    ({ providerResult }) => providerResult.providerOutcome,
  );
  const providerOutcome = outcomes.includes("delivery-uncertain")
    ? "delivery-uncertain"
    : outcomes.includes("partial")
      ? "partial"
      : outcomes.every((outcome) => outcome === "no-recipients")
        ? "no-recipients"
        : outcomes.every((outcome) => outcome === "deduplicated")
          ? "deduplicated"
          : outcomes.includes("no-recipients")
            ? "partial"
            : "sent";
  return {
    providerOutcome,
    notificationAudiences: results.map(({ audience, providerResult }) => ({
      teamId: audience.teamId,
      gameId: audience.gameId,
      idempotencyKey: audience.idempotencyKey,
      providerOutcome: providerResult.providerOutcome,
      ...(providerResult.providerReceiptId
        ? { providerReceiptId: providerResult.providerReceiptId }
        : {}),
    })),
  };
}

function isOwnedDiamondClip(clip, effect, sourceEventId = null) {
  return Boolean(
    isPlainObject(clip) &&
    clip.trackingEngine === DIAMOND_ENGINE &&
    clip.diamondGenerated === true &&
    clip.diamondScorebookInstanceId === effect.instanceId &&
    (!sourceEventId || clip.diamondSourceEventId === sourceEventId),
  );
}

function buildDiamondClip(core, effect, teamId, gameId) {
  const digest = core.hashDiamondValue({
    instanceId: effect.instanceId,
    dedupKey: effect.dedupKey,
    sourceEventId: effect.payload.sourceEventId,
  });
  return {
    id: `diamond_${digest.slice("sha256:".length, "sha256:".length + 24)}`,
    type: "score-linked",
    source: DIAMOND_ENGINE,
    mediaType: "video",
    trackingEngine: DIAMOND_ENGINE,
    diamondGenerated: true,
    diamondScorebookInstanceId: effect.instanceId,
    projectionGeneration: effect.instanceId,
    diamondEffectId: effect.effectId,
    diamondEffectDedupKey: effect.dedupKey,
    diamondSourceEventId: effect.payload.sourceEventId,
    sourceEventId: effect.payload.sourceEventId,
    playEventId: effect.payload.sourceEventId,
    sourceRevision: effect.sourceRevision,
    teamId,
    gameId,
    startMs: effect.payload.startMs,
    endMs: effect.payload.endMs,
    title: effect.payload.playDescription,
    description: effect.payload.playDescription,
    period: effect.payload.inningLabel,
    scoreContext: effect.payload.scoreContext,
    status: "candidate",
    createdAt: effect.createdAt,
  };
}

function createDiamondScorebookEffectHandlers(dependencies = {}) {
  const firestore = dependencies.firestore;
  const clock = dependencies.clock || (() => Date.now());
  const random = dependencies.random || { randomUUID: nodeCrypto.randomUUID };
  const logger = dependencies.logger || { info() {}, warn() {}, error() {} };
  const core = dependencies.core || require("./diamond-scorebook-core.cjs");
  const sendNotification = dependencies.sendNotification || null;
  const hooks = dependencies.hooks || {};
  const leaseMillis = dependencies.leaseMillis || DEFAULT_EFFECT_LEASE_MILLIS;
  const retryDelayMillis =
    dependencies.retryDelayMillis || DEFAULT_EFFECT_RETRY_DELAY_MILLIS;

  if (!firestore?.doc || typeof firestore.runTransaction !== "function") {
    throw new TypeError(
      "A Firestore dependency with documents and transactions is required.",
    );
  }
  if (
    typeof core.hashDiamondValue !== "function" ||
    typeof core.normalizeDiamondId !== "function"
  ) {
    throw new TypeError("The Diamond scorebook core dependency is required.");
  }
  if (
    !Number.isSafeInteger(leaseMillis) ||
    leaseMillis < 1_000 ||
    leaseMillis > 30 * 60 * 1000
  ) {
    throw new TypeError(
      "leaseMillis must be between one second and thirty minutes.",
    );
  }
  if (
    !Number.isSafeInteger(retryDelayMillis) ||
    retryDelayMillis < 1_000 ||
    retryDelayMillis > 30 * 60 * 1000
  ) {
    throw new TypeError(
      "retryDelayMillis must be between one second and thirty minutes.",
    );
  }

  async function transactionGetAll(transaction, references) {
    if (typeof transaction.getAll === "function")
      return transaction.getAll(...references);
    return Promise.all(
      references.map((reference) => transaction.get(reference)),
    );
  }

  function normalizeLocation(request = {}) {
    const teamId = requireId(core, request.teamId, "teamId");
    const gameId = requireId(core, request.gameId, "gameId");
    const effectDocumentId = requireId(
      core,
      request.effectDocumentId || request.effectId,
      "effectDocumentId",
    );
    return {
      teamId,
      gameId,
      effectDocumentId,
      paths: effectPaths(teamId, gameId, effectDocumentId),
    };
  }

  async function prepareEffect(location) {
    let cachedNowMs = null;
    let cachedLeaseId = null;
    const getNowMs = () =>
      cachedNowMs === null ? (cachedNowMs = normalizeNow(clock)) : cachedNowMs;
    const getLeaseId = () =>
      cachedLeaseId === null
        ? (cachedLeaseId = secureUuid(random))
        : cachedLeaseId;
    const effectRef = firestore.doc(location.paths.effect);
    return firestore.runTransaction(async (transaction) => {
      const effectSnapshot = await transaction.get(effectRef);
      const raw = snapshotData(effectSnapshot);
      if (!raw) return { acquired: false, reason: "effect-missing" };
      if (
        raw.status === "invalid" &&
        raw.terminal === true &&
        raw.processorSchemaVersion === EFFECT_PROCESSOR_SCHEMA_VERSION
      ) {
        return {
          acquired: false,
          reason: "already-terminal",
          status: "invalid",
          terminalResult: raw.terminalResult || null,
        };
      }
      let effect;
      try {
        effect = validateEffectDocument(raw, { ...location, core });
      } catch (error) {
        const invalid = invalidEffectForResult(raw);
        const nowMs = getNowMs();
        transaction.update(
          effectRef,
          terminalPatch(
            core,
            invalid,
            "invalid",
            exactOptionalString(error?.code, 80) || "invalid-effect",
            nowMs,
          ),
        );
        return {
          acquired: false,
          reason: "invalid-effect",
          status: "invalid",
          errorCode: error?.code || "invalid-effect",
        };
      }
      if (TERMINAL_STATUSES.has(effect.status) && effect.terminal === true) {
        return {
          acquired: false,
          reason: "already-terminal",
          status: effect.status,
          terminalResult: effect.terminalResult || null,
        };
      }
      const paths = effectPaths(
        location.teamId,
        location.gameId,
        location.effectDocumentId,
        effect.projectionKey,
      );
      const [rootSnapshot, gameSnapshot, runSnapshot] = await transactionGetAll(
        transaction,
        [
          firestore.doc(paths.scorebook),
          firestore.doc(paths.game),
          firestore.doc(paths.run),
        ],
      );
      const root = snapshotData(rootSnapshot);
      const game = snapshotData(gameSnapshot);
      const run = snapshotData(runSnapshot);
      const fence = validateProjectionFence({
        root,
        game,
        run,
        effect,
        teamId: location.teamId,
        gameId: location.gameId,
      });
      if (fence.state === "superseded" || fence.state === "discarded") {
        const nowMs = getNowMs();
        transaction.update(
          effectRef,
          terminalPatch(core, effect, fence.state, fence.reason, nowMs),
        );
        return {
          acquired: false,
          reason: fence.reason,
          status: fence.state,
        };
      }
      if (fence.state === "retry") {
        return {
          acquired: false,
          reason: fence.reason,
          retryable: true,
        };
      }
      let notificationAudiencePlan = null;
      let notificationAudiencePlanHash = null;
      if (effect.kind === "notification") {
        const sharedGamePath = sharedGamePathFromGame(game);
        if (sharedGamePath) {
          let sharedSnapshot;
          try {
            sharedSnapshot = await transaction.get(
              firestore.doc(sharedGamePath),
            );
          } catch {
            throw notificationAudienceUnavailable("shared-game-read-failed");
          }
          notificationAudiencePlan = buildSharedNotificationAudiencePlan({
            core,
            effect,
            location,
            fence,
            sharedGamePath,
            shared: snapshotData(sharedSnapshot),
          });
        } else {
          notificationAudiencePlan = buildDirectNotificationAudiencePlan(
            core,
            effect,
            location,
          );
        }
        notificationAudiencePlanHash = core.hashDiamondValue(
          notificationAudiencePlan,
        );
        if (
          effect.notificationAudiencePlanHash &&
          effect.notificationAudiencePlanHash !== notificationAudiencePlanHash
        ) {
          throw notificationAudienceUnavailable("pinned-plan-changed");
        }
      }
      const nowMs = getNowMs();
      if (
        Number.isSafeInteger(effect.nextAttemptAtMs) &&
        effect.nextAttemptAtMs > nowMs
      ) {
        return {
          acquired: false,
          reason: "effect-retry-delayed",
          retryable: true,
        };
      }
      const currentLease = effect.processorLease;
      if (
        effect.status === "processing" &&
        isPlainObject(currentLease) &&
        typeof currentLease.leaseId === "string" &&
        Number.isSafeInteger(currentLease.expiresAtMs) &&
        currentLease.expiresAtMs > nowMs
      ) {
        return {
          acquired: false,
          reason: "effect-lease-active",
          retryable: true,
        };
      }
      const attemptCount = Number.isSafeInteger(effect.attemptCount)
        ? effect.attemptCount + 1
        : 1;
      const lease = {
        schemaVersion: EFFECT_PROCESSOR_SCHEMA_VERSION,
        leaseId: getLeaseId(),
        instanceId: effect.instanceId,
        projectionKey: effect.projectionKey,
        payloadHash: effect.payloadHash,
        dedupKey: effect.dedupKey,
        attempt: attemptCount,
        acquiredAtMs: nowMs,
        expiresAtMs: nowMs + leaseMillis,
      };
      transaction.update(effectRef, {
        status: "processing",
        processorSchemaVersion: EFFECT_PROCESSOR_SCHEMA_VERSION,
        processorLease: lease,
        attemptCount,
        lastAttempt: {
          attempt: attemptCount,
          leaseId: lease.leaseId,
          startedAt: timestampIso(nowMs),
          dedupKey: effect.dedupKey,
        },
        lastError: null,
        nextAttemptAtMs: null,
        terminal: false,
        updatedAt: timestampIso(nowMs),
        ...(notificationAudiencePlan
          ? {
              notificationAudiencePlan,
              notificationAudiencePlanHash,
            }
          : {}),
      });
      return {
        acquired: true,
        effect: notificationAudiencePlan
          ? {
              ...effect,
              notificationAudiencePlan,
              notificationAudiencePlanHash,
            }
          : effect,
        lease,
        location,
        fence,
      };
    });
  }

  async function releaseEffectLease(prepared, error) {
    const effectRef = firestore.doc(prepared.location.paths.effect);
    try {
      const nowMs = normalizeNow(clock);
      await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(effectRef);
        const current = snapshotData(snapshot);
        if (
          !current ||
          TERMINAL_STATUSES.has(current.status) ||
          current.processorLease?.leaseId !== prepared.lease.leaseId
        ) {
          return;
        }
        transaction.update(effectRef, {
          status: "pending",
          processorLease: null,
          terminal: false,
          lastError: {
            code: exactOptionalString(error?.code, 80) || "effect-failed",
            retryable: error?.retryable !== false,
            failedAt: timestampIso(nowMs),
            attempt: prepared.lease.attempt,
          },
          nextAttemptAtMs: nowMs + retryDelayMillis,
          updatedAt: timestampIso(nowMs),
        });
      });
    } catch (releaseError) {
      logger.error?.("diamond_effect_lease_release_failed", {
        code: releaseError?.code || "release-failed",
      });
    }
  }

  async function reconcileTerminal(prepared) {
    try {
      const snapshot = await firestore
        .doc(prepared.location.paths.effect)
        .get();
      const current = snapshotData(snapshot);
      const validated = validateEffectDocument(current, {
        ...prepared.location,
        core,
      });
      if (
        validated.terminal === true &&
        TERMINAL_STATUSES.has(validated.status) &&
        validated.payloadHash === prepared.effect.payloadHash &&
        validated.dedupKey === prepared.effect.dedupKey
      ) {
        return {
          processed: validated.status === "completed",
          status: validated.status,
          reason: "terminal-reconciled",
          terminalResult: validated.terminalResult || null,
        };
      }
    } catch {
      // A failed reconciliation read leaves the stable provider deduplication
      // key authoritative on the next retry.
    }
    return null;
  }

  async function finishNotification(prepared, providerResult) {
    const nowMs = normalizeNow(clock);
    const effectRef = firestore.doc(prepared.location.paths.effect);
    try {
      return await firestore.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(effectRef);
        const current = snapshotData(snapshot);
        const validated = validateEffectDocument(current, {
          ...prepared.location,
          core,
        });
        if (
          validated.terminal === true &&
          TERMINAL_STATUSES.has(validated.status)
        ) {
          return {
            processed: validated.status === "completed",
            status: validated.status,
            reason: "already-terminal",
            terminalResult: validated.terminalResult || null,
          };
        }
        if (
          validated.processorLease?.leaseId !== prepared.lease.leaseId ||
          validated.payloadHash !== prepared.effect.payloadHash ||
          validated.dedupKey !== prepared.effect.dedupKey
        ) {
          throw new DiamondEffectError(
            "effect-lease-lost",
            "The Diamond notification effect lease changed after dispatch.",
            { retryable: true },
          );
        }
        const completionReason =
          providerResult.providerOutcome === "delivery-uncertain"
            ? "notification-push-uncertain-inbox-authoritative"
            : "notification-provider-confirmed";
        const patch = terminalPatch(
          core,
          prepared.effect,
          "processed",
          completionReason,
          nowMs,
          providerResult,
        );
        transaction.update(effectRef, patch);
        return {
          processed: true,
          status: "completed",
          reason: completionReason,
          terminalResult: patch.terminalResult,
        };
      });
    } catch (error) {
      const reconciled = await reconcileTerminal(prepared);
      if (reconciled) return reconciled;
      throw error;
    }
  }

  async function verifyNotificationAudiencePlan(prepared) {
    const pinnedPlan = prepared.effect.notificationAudiencePlan;
    if (!pinnedPlan) {
      throw notificationAudienceUnavailable("audience-plan-missing");
    }
    let currentPlan;
    try {
      currentPlan = await firestore.runTransaction(async (transaction) => {
        const paths = effectPaths(
          prepared.location.teamId,
          prepared.location.gameId,
          prepared.location.effectDocumentId,
          prepared.effect.projectionKey,
        );
        const [rootSnapshot, gameSnapshot, runSnapshot] =
          await transactionGetAll(transaction, [
            firestore.doc(paths.scorebook),
            firestore.doc(paths.game),
            firestore.doc(paths.run),
          ]);
        const root = snapshotData(rootSnapshot);
        const game = snapshotData(gameSnapshot);
        const currentFence = validateProjectionFence({
          root,
          game,
          run: snapshotData(runSnapshot),
          effect: prepared.effect,
          teamId: prepared.location.teamId,
          gameId: prepared.location.gameId,
        });
        if (currentFence.state !== "current") {
          throw notificationAudienceUnavailable(
            `projection-fence-${currentFence.reason}`,
          );
        }
        const sharedGamePath = sharedGamePathFromGame(game);
        if (pinnedPlan.mode === "direct") {
          if (sharedGamePath) {
            throw notificationAudienceUnavailable(
              "direct-game-became-shared",
            );
          }
          return buildDirectNotificationAudiencePlan(
            core,
            prepared.effect,
            prepared.location,
          );
        }
        if (sharedGamePath !== pinnedPlan.sharedGamePath) {
          throw notificationAudienceUnavailable("shared-game-path-changed");
        }
        const sharedSnapshot = await transaction.get(
          firestore.doc(sharedGamePath),
        );
        return buildSharedNotificationAudiencePlan({
          core,
          effect: prepared.effect,
          location: prepared.location,
          fence: currentFence,
          sharedGamePath,
          shared: snapshotData(sharedSnapshot),
        });
      });
    } catch (error) {
      if (error instanceof DiamondEffectError) throw error;
      throw notificationAudienceUnavailable("shared-game-read-failed");
    }
    if (
      core.hashDiamondValue(currentPlan) !==
      prepared.effect.notificationAudiencePlanHash
    ) {
      throw notificationAudienceUnavailable("pinned-plan-changed");
    }
  }

  async function processNotification(prepared) {
    if (typeof sendNotification !== "function") {
      throw new DiamondEffectError(
        "notification-sender-unavailable",
        "The Diamond notification sender is unavailable.",
        { retryable: true },
      );
    }
    const { effect } = prepared;
    const audiences = effect.notificationAudiencePlan?.audiences;
    if (!Array.isArray(audiences) || !audiences.length) {
      throw notificationAudienceUnavailable("audience-plan-missing");
    }
    const results = [];
    for (const audience of audiences) {
      const request = {
        teamId: audience.teamId,
        gameId: audience.gameId,
        instanceId: effect.instanceId,
        sourceRevision: effect.sourceRevision,
        sourceEventId: effect.payload.sourceEventId,
        title: effect.payload.title,
        body: effect.payload.body,
        category: "liveScore",
        liveViewerLink: audience.viewerLink,
        link: audience.viewerLink,
        dedupKey: audience.idempotencyKey,
        idempotencyKey: audience.idempotencyKey,
        ...(audience.viewerTeamId
          ? {
              viewerTeamId: audience.viewerTeamId,
              viewerGameId: audience.viewerGameId,
            }
          : {}),
        ...(audience.viewerTeamId
          ? { sharedGamePath: effect.notificationAudiencePlan.sharedGamePath }
          : {}),
      };
      if (typeof hooks.beforeNotification === "function") {
        await hooks.beforeNotification({ request, prepared, firestore });
      }
      await verifyNotificationAudiencePlan(prepared);
      let rawResult;
      try {
        rawResult = await sendNotification(request);
      } catch (error) {
        throw new DiamondEffectError(
          "notification-send-failed",
          "Diamond notification delivery stopped before a terminal sender result and will retry behind its durable dispatch boundary.",
          {
            retryable: true,
            details: { causeCode: error?.code || "provider-failed" },
          },
        );
      }
      results.push({
        audience,
        providerResult: normalizeNotificationProviderResult(
          rawResult,
          audience.idempotencyKey,
          effect.instanceId,
        ),
      });
    }
    const providerResult = aggregateNotificationProviderResults(results);
    if (typeof hooks.beforeNotificationFinalize === "function") {
      await hooks.beforeNotificationFinalize({
        providerResult,
        prepared,
        firestore,
      });
    }
    return finishNotification(prepared, providerResult);
  }

  function applyClipLink(effect, game, teamId, gameId) {
    if (
      game.highlightClips !== undefined &&
      !Array.isArray(game.highlightClips)
    ) {
      return {
        mutation: null,
        reason: "highlight-clips-malformed",
        details: { clipOutcome: "discarded" },
        terminalOutcome: "discarded",
      };
    }
    const clips = Array.isArray(game.highlightClips)
      ? [...game.highlightClips]
      : [];
    const existing = clips.find((clip) =>
      isOwnedDiamondClip(clip, effect, effect.payload.sourceEventId),
    );
    if (existing) {
      return {
        mutation: null,
        reason: "clip-already-linked",
        details: { clipOutcome: "already-linked", clipId: existing.id || null },
        terminalOutcome: "processed",
      };
    }
    if (clips.length >= MAX_HIGHLIGHT_CLIPS) {
      return {
        mutation: null,
        reason: "clip-capacity-reached",
        details: {
          clipOutcome: "capacity-reached",
          preservedClipCount: clips.length,
        },
        terminalOutcome: "processed",
      };
    }
    const clip = buildDiamondClip(core, effect, teamId, gameId);
    if (clips.some((candidate) => candidate?.id === clip.id)) {
      return {
        mutation: null,
        reason: "clip-id-conflict",
        details: { clipOutcome: "discarded", clipId: clip.id },
        terminalOutcome: "discarded",
      };
    }
    return {
      mutation: [...clips, clip],
      reason: "clip-linked",
      details: { clipOutcome: "linked", clipId: clip.id },
      terminalOutcome: "processed",
    };
  }

  function applyClipInvalidation(effect, game) {
    if (
      game.highlightClips !== undefined &&
      !Array.isArray(game.highlightClips)
    ) {
      return {
        mutation: null,
        reason: "highlight-clips-malformed",
        details: { clipOutcome: "discarded" },
        terminalOutcome: "discarded",
      };
    }
    const clips = Array.isArray(game.highlightClips)
      ? [...game.highlightClips]
      : [];
    const next = clips.filter(
      (clip) => !isOwnedDiamondClip(clip, effect, effect.payload.targetEventId),
    );
    const removedCount = clips.length - next.length;
    return {
      mutation: removedCount ? next : null,
      reason: removedCount ? "clip-invalidated" : "clip-not-found",
      details: {
        clipOutcome: removedCount ? "invalidated" : "not-found",
        removedCount,
        targetEventId: effect.payload.targetEventId,
      },
      terminalOutcome: "processed",
    };
  }

  async function processTransactionalEffect(prepared) {
    const nowMs = normalizeNow(clock);
    const { location } = prepared;
    const effectRef = firestore.doc(location.paths.effect);
    try {
      return await firestore.runTransaction(async (transaction) => {
        const effectSnapshot = await transaction.get(effectRef);
        const raw = snapshotData(effectSnapshot);
        const effect = validateEffectDocument(raw, { ...location, core });
        if (effect.terminal === true && TERMINAL_STATUSES.has(effect.status)) {
          return {
            processed: effect.status === "completed",
            status: effect.status,
            reason: "already-terminal",
            terminalResult: effect.terminalResult || null,
          };
        }
        if (effect.processorLease?.leaseId !== prepared.lease.leaseId) {
          throw new DiamondEffectError(
            "effect-lease-lost",
            "The Diamond effect lease changed before its transaction.",
            { retryable: true },
          );
        }
        const paths = effectPaths(
          location.teamId,
          location.gameId,
          location.effectDocumentId,
          effect.projectionKey,
        );
        const [rootSnapshot, gameSnapshot, runSnapshot] =
          await transactionGetAll(transaction, [
            firestore.doc(paths.scorebook),
            firestore.doc(paths.game),
            firestore.doc(paths.run),
          ]);
        const root = snapshotData(rootSnapshot);
        const game = snapshotData(gameSnapshot);
        const fence = validateProjectionFence({
          root,
          game,
          run: snapshotData(runSnapshot),
          effect,
          teamId: location.teamId,
          gameId: location.gameId,
        });
        if (fence.state === "retry") {
          throw new DiamondEffectError(
            "projection-fence-not-ready",
            "The Diamond effect projection fence is not current.",
            { retryable: true, details: { reason: fence.reason } },
          );
        }
        if (fence.state === "superseded" || fence.state === "discarded") {
          const patch = terminalPatch(
            core,
            effect,
            fence.state,
            fence.reason,
            nowMs,
          );
          transaction.update(effectRef, patch);
          return {
            processed: false,
            status: fence.state,
            reason: fence.reason,
            terminalResult: patch.terminalResult,
          };
        }
        let application;
        if (effect.kind === "clip-link") {
          application = applyClipLink(
            effect,
            game,
            location.teamId,
            location.gameId,
          );
        } else if (effect.kind === "clip-invalidation") {
          application = applyClipInvalidation(effect, game);
        } else {
          application = {
            mutation: null,
            reason:
              effect.kind === "ai-stale"
                ? "ai-staleness-already-projected"
                : "shared-game-already-projected",
            details: { auditOnly: true },
            terminalOutcome: "processed",
          };
        }
        if (application.mutation) {
          transaction.update(firestore.doc(paths.game), {
            highlightClips: application.mutation,
            diamondHighlightClipsRevision: effect.sourceRevision,
            diamondHighlightClipsEffectKey: effect.dedupKey,
          });
        }
        const patch = terminalPatch(
          core,
          effect,
          application.terminalOutcome,
          application.reason,
          nowMs,
          application.details,
        );
        transaction.update(effectRef, patch);
        return {
          processed: application.terminalOutcome === "processed",
          status: patch.status,
          reason: application.reason,
          terminalResult: patch.terminalResult,
        };
      });
    } catch (error) {
      const reconciled = await reconcileTerminal(prepared);
      if (reconciled) return reconciled;
      throw error;
    }
  }

  async function processDiamondEffect(request = {}) {
    const location = normalizeLocation(request);
    const prepared = await prepareEffect(location);
    if (!prepared.acquired) return { processed: false, ...prepared };
    try {
      const result =
        prepared.effect.kind === "notification"
          ? await processNotification(prepared)
          : await processTransactionalEffect(prepared);
      logger.info?.("diamond_effect_processed", {
        kind: prepared.effect.kind,
        sourceRevision: prepared.effect.sourceRevision,
        status: result.status,
      });
      return result;
    } catch (error) {
      const processedError =
        error instanceof DiamondEffectError
          ? error
          : new DiamondEffectError(
              "effect-processing-failed",
              "Diamond effect processing failed and will retry.",
              {
                retryable: true,
                details: { causeCode: error?.code || "unknown" },
              },
            );
      await releaseEffectLease(prepared, processedError);
      logger.error?.("diamond_effect_failed", {
        kind: prepared.effect.kind,
        sourceRevision: prepared.effect.sourceRevision,
        code: processedError.code,
        retryable: processedError.retryable,
      });
      throw processedError;
    }
  }

  function resolveTriggerLocation(change, context = {}) {
    const snapshot = change?.after || change;
    if (!snapshot || snapshot.exists !== true) {
      return { snapshot, deleted: true };
    }
    const path = exactString(snapshot.ref?.path, 768);
    const segments = path.split("/");
    if (
      segments.length !== 8 ||
      segments[0] !== "teams" ||
      segments[2] !== "games" ||
      segments[4] !== "diamondScorebooks" ||
      segments[5] !== "v2" ||
      segments[6] !== "effects"
    ) {
      throw new DiamondEffectError(
        "invalid-effect-path",
        "The Diamond effect trigger path is malformed.",
      );
    }
    const params = context.params || {};
    const teamId = params.teamId || segments[1];
    const gameId = params.gameId || segments[3];
    const effectDocumentId = params.effectId || segments[7];
    if (
      teamId !== segments[1] ||
      gameId !== segments[3] ||
      effectDocumentId !== segments[7]
    ) {
      throw new DiamondEffectError(
        "invalid-effect-path",
        "The Diamond effect trigger parameters do not match its document path.",
      );
    }
    return { snapshot, teamId, gameId, effectDocumentId, deleted: false };
  }

  async function onDiamondEffectWrite(change, context = {}) {
    const location = resolveTriggerLocation(change, context);
    if (location.deleted) {
      return { processed: false, reason: "effect-deleted" };
    }
    const result = await processDiamondEffect(location);
    if (result.retryable) {
      throw new DiamondEffectError(
        result.reason || "effect-not-ready",
        "The Diamond effect is not ready and must be retried.",
        { retryable: true },
      );
    }
    return result;
  }

  return { onDiamondEffectWrite, processDiamondEffect };
}

module.exports = {
  DEFAULT_EFFECT_LEASE_MILLIS,
  DEFAULT_EFFECT_RETRY_DELAY_MILLIS,
  DIAMOND_ENGINE,
  EFFECT_PROCESSOR_SCHEMA_VERSION,
  LIVE_VIEWER_ORIGIN,
  MAX_CLIP_DURATION_MS,
  MAX_HIGHLIGHT_CLIPS,
  DiamondEffectError,
  createDiamondScorebookEffectHandlers,
  effectPaths,
};
