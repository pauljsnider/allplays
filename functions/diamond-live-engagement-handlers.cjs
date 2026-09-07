"use strict";

const nodeCrypto = require("node:crypto");

const DIAMOND_ENGINE = "diamond-v2";
const ENGAGEMENT_SCHEMA_VERSION = 1;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DIAMOND_CHAT_MESSAGE_ID_PATTERN = /^diamond-chat-[a-f0-9]{64}$/;
const TERMINAL_GAME_STATUSES = new Set([
  "completed",
  "finished",
  "final",
  "correction",
  "cancelled",
  "canceled",
  "deleted",
]);
const TERMINAL_DIAMOND_LIFECYCLES = new Set([
  "final",
  "correction",
  "cancelled",
]);
const LIVE_DIAMOND_LIFECYCLES = new Set(["active", "suspended"]);
const SCHEDULED_DIAMOND_LIFECYCLES = new Set(["configured", "ready"]);
const REACTION_TYPES = new Set(["fire", "clap", "wow", "heart", "hundred"]);
const RATE_POLICIES = Object.freeze({
  chat: Object.freeze({
    cooldownMillis: 1_500,
    windowMillis: 60_000,
    maximum: 10,
  }),
  reaction: Object.freeze({
    cooldownMillis: 1_000,
    windowMillis: 60_000,
    maximum: 30,
  }),
});

class DiamondLiveEngagementError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "DiamondLiveEngagementError";
    this.code = code;
    this.details = details;
  }
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

function requireExactFields(value, allowedFields, makeError, label) {
  if (!isPlainObject(value)) {
    throw makeError("invalid-argument", `${label} must be an object.`);
  }
  const unknown = Object.keys(value).filter((key) => !allowedFields.has(key));
  if (unknown.length) {
    throw makeError(
      "invalid-argument",
      `${label} contains unsupported fields.`,
      { fields: unknown.sort() },
    );
  }
}

function normalizeId(value, label, makeError) {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !value ||
    value.length > 128 ||
    value.includes("/") ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw makeError("invalid-argument", `${label} is invalid.`);
  }
  return value;
}

function normalizeUuid(value, label, makeError) {
  const normalized = normalizeId(value, label, makeError);
  if (!UUID_V4_PATTERN.test(normalized)) {
    throw makeError(
      "invalid-argument",
      `${label} must be a cryptographically random UUID v4.`,
    );
  }
  return normalized.toLowerCase();
}

function normalizeChatText(value, makeError) {
  if (typeof value !== "string") {
    throw makeError("invalid-argument", "text must be a string.");
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (
    !normalized ||
    normalized.length > 2_000 ||
    normalized !== value ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw makeError(
      "invalid-argument",
      "text must be canonical, nonempty, and at most 2,000 characters.",
    );
  }
  return normalized;
}

function compactText(value, maximum) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, maximum);
}

function normalizeNow(clock, makeError) {
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
      "Server time is unavailable. No live interaction was written.",
    );
  }
  return value;
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === "function") {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime())
      ? date.getTime()
      : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? millis : null;
}

function normalizeTimeZone(value) {
  const candidate = compactText(value, 100);
  if (!candidate) return "";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(
      new Date(0),
    );
    return candidate;
  } catch {
    return "";
  }
}

function calendarDateKey(milliseconds, timeZone) {
  if (!Number.isFinite(milliseconds) || !timeZone) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(milliseconds));
    const values = Object.fromEntries(
      parts
        .filter((part) => ["year", "month", "day"].includes(part.type))
        .map((part) => [part.type, part.value]),
    );
    return values.year && values.month && values.day
      ? `${values.year}-${values.month}-${values.day}`
      : "";
  } catch {
    return "";
  }
}

function isGameDay(game, team, nowMillis) {
  const startsAt = [game?.startsAt, game?.startTime, game?.date, game?.gameDate]
    .map(toMillis)
    .find((value) => Number.isFinite(value));
  const timeZone = normalizeTimeZone(
    game?.timeZone || game?.timezone || team?.timeZone || team?.timezone,
  );
  if (!Number.isFinite(startsAt) || !timeZone) return false;
  const startKey = calendarDateKey(startsAt, timeZone);
  return Boolean(startKey && startKey === calendarDateKey(nowMillis, timeZone));
}

function hasTerminalGameStatus(game) {
  const values = [game?.status, game?.liveStatus]
    .map((value) => compactText(value, 32).toLowerCase())
    .filter(Boolean);
  return (
    game?.deleted === true ||
    game?.isDeleted === true ||
    game?.isCancelled === true ||
    values.some((value) => TERMINAL_GAME_STATUSES.has(value))
  );
}

function isActiveTeam(team) {
  if (!isPlainObject(team)) return false;
  const status = compactText(team.status, 32).toLowerCase();
  return (
    team.active !== false &&
    team.archived !== true &&
    team.deleted !== true &&
    team.isDeleted !== true &&
    !["archived", "deleted", "inactive", "disabled", "suspended"].includes(
      status,
    )
  );
}

function getDiamondLifecycle(root) {
  const lifecycle = compactText(
    root?.checkpoint?.state?.lifecycle,
    32,
  ).toLowerCase();
  return lifecycle;
}

function isDiamondInteractionWindowOpen({
  team,
  game,
  root,
  lifecycle: lifecycleValue,
  nowMillis,
} = {}) {
  const gameType = compactText(game?.type || "game", 32).toLowerCase();
  const lifecycle =
    lifecycleValue === undefined
      ? getDiamondLifecycle(root)
      : compactText(lifecycleValue, 32).toLowerCase();
  if (
    gameType !== "game" ||
    hasTerminalGameStatus(game) ||
    TERMINAL_DIAMOND_LIFECYCLES.has(lifecycle)
  ) {
    return false;
  }
  if (LIVE_DIAMOND_LIFECYCLES.has(lifecycle)) return true;
  return (
    SCHEDULED_DIAMOND_LIFECYCLES.has(lifecycle) &&
    isGameDay(game, team, nowMillis)
  );
}

function assertOpenInteractionWindow(
  { team, game, root, nowMillis },
  makeError,
) {
  const gameType = compactText(game?.type || "game", 32).toLowerCase();
  const lifecycle = getDiamondLifecycle(root);
  if (
    isDiamondInteractionWindowOpen({
      team,
      game,
      lifecycle,
      nowMillis,
    })
  ) {
    return;
  }
  if (
    gameType !== "game" ||
    hasTerminalGameStatus(game) ||
    TERMINAL_DIAMOND_LIFECYCLES.has(lifecycle)
  ) {
    throw makeError(
      "failed-precondition",
      "Live interactions are closed for this game.",
      { reason: "interaction-window-closed" },
    );
  }
  throw makeError(
    "failed-precondition",
    "Live interactions are available only while the game is live or on game day.",
    { reason: "interaction-window-closed" },
  );
}

function normalizeHttpsUrl(value) {
  if (typeof value !== "string" || !value || value !== value.trim())
    return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.href.length > 2_048
    ) {
      return null;
    }
    const host = url.hostname.toLowerCase();
    const isGoogleProfile = host.endsWith(".googleusercontent.com");
    const isAllPlays = host === "allplays.ai" || host === "www.allplays.ai";
    const bucketPattern =
      "(?:game-flow-c6311|game-flow-img)\\.firebasestorage\\.app";
    const isFirebaseApi =
      (host === "firebasestorage.googleapis.com" &&
        new RegExp(`^/v0/b/${bucketPattern}/o/`).test(url.pathname)) ||
      (host === "storage.googleapis.com" &&
        new RegExp(
          `^/(?:download/storage/v1/b/)?${bucketPattern}(?:/o)?/`,
        ).test(url.pathname));
    const isFirebaseBucket =
      host === "game-flow-c6311.firebasestorage.app" ||
      host === "game-flow-img.firebasestorage.app";
    return isGoogleProfile || isAllPlays || isFirebaseApi || isFirebaseBucket
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function senderIdentity(authUser, user) {
  const name =
    [
      authUser?.displayName,
      user?.fullName,
      user?.displayName,
      user?.name,
      [user?.firstName, user?.lastName].filter(Boolean).join(" "),
    ]
      .map((value) => compactText(value, 80))
      .find(Boolean) || "Fan";
  const photoUrl = [authUser?.photoURL, user?.photoUrl, user?.photoURL]
    .map(normalizeHttpsUrl)
    .find(Boolean);
  return { name, photoUrl: photoUrl || null };
}

function hashHex(value, cryptoAdapter = nodeCrypto) {
  try {
    const digest = cryptoAdapter
      .createHash("sha256")
      .update(value, "utf8")
      .digest("hex");
    return /^[a-f0-9]{64}$/.test(digest) ? digest : "";
  } catch {
    return "";
  }
}

function requestHash(request, cryptoAdapter, makeError) {
  const value = JSON.stringify({
    schemaVersion: request.schemaVersion,
    kind: request.kind,
    requestId: request.requestId,
    teamId: request.teamId,
    gameId: request.gameId,
    expectedInstanceId: request.expectedInstanceId,
    viewerMode: request.viewerMode,
    payload: request.payload,
  });
  const digest = hashHex(value, cryptoAdapter);
  if (!digest) {
    throw makeError(
      "unavailable",
      "The live interaction could not be hashed. No write was attempted.",
    );
  }
  return `sha256:${digest}`;
}

function engagementPaths(
  teamId,
  gameId,
  instanceId,
  uid,
  requestId,
  kind,
  cryptoAdapter,
) {
  const scorebook = `teams/${teamId}/games/${gameId}/diamondScorebooks/v2`;
  const receiptKey = hashHex(
    `${kind}\n${teamId}\n${gameId}\n${uid}\n${requestId}`,
    cryptoAdapter,
  );
  const actorKey = hashHex(
    `${kind}\n${teamId}\n${gameId}\n${uid}`,
    cryptoAdapter,
  );
  if (!receiptKey || !actorKey) return null;
  const outputCollection = kind === "chat" ? "chat" : "reactions";
  const outputPrefix = kind === "chat" ? "diamond-chat" : "diamond-reaction";
  const outputId = `${outputPrefix}-${receiptKey}`;
  return {
    team: `teams/${teamId}`,
    user: `users/${uid}`,
    game: `teams/${teamId}/games/${gameId}`,
    rsvp: `teams/${teamId}/games/${gameId}/rsvps/${uid}`,
    scorebook,
    receipt: `${scorebook}/audit/engagement-receipt-${receiptKey}`,
    rate: `${scorebook}/audit/engagement-rate-${actorKey}`,
    output: `teams/${teamId}/games/${gameId}/diamondLiveGenerations/${instanceId}/${outputCollection}/${outputId}`,
    outputId,
    actorHash: `sha256:${actorKey}`,
  };
}

function moderationPaths(
  teamId,
  gameId,
  instanceId,
  uid,
  requestId,
  messageId,
  cryptoAdapter,
) {
  const scorebook = `teams/${teamId}/games/${gameId}/diamondScorebooks/v2`;
  const receiptKey = hashHex(
    `moderate-chat\n${teamId}\n${gameId}\n${uid}\n${requestId}`,
    cryptoAdapter,
  );
  if (!receiptKey) return null;
  return {
    team: `teams/${teamId}`,
    user: `users/${uid}`,
    game: `teams/${teamId}/games/${gameId}`,
    rsvp: `teams/${teamId}/games/${gameId}/rsvps/${uid}`,
    scorebook,
    receipt: `${scorebook}/audit/engagement-moderation-receipt-${receiptKey}`,
    output: `teams/${teamId}/games/${gameId}/diamondLiveGenerations/${instanceId}/chat/${messageId}`,
  };
}

function authoritativeEmail(authUser) {
  return authUser?.emailVerified === true && typeof authUser.email === "string"
    ? authUser.email.trim().toLowerCase()
    : "";
}

function hasOfficialAccess(game, caller) {
  if (Array.isArray(game?.officiatingAuthorizedUserIds)) {
    if (game.officiatingAuthorizedUserIds.includes(caller.uid)) return true;
  }
  if (!caller.email || !Array.isArray(game?.officiatingAuthorizedEmails)) {
    return false;
  }
  return game.officiatingAuthorizedEmails
    .filter((value) => typeof value === "string")
    .map((value) => value.trim().toLowerCase())
    .includes(caller.email);
}

function hasAuthorizedGameAccess({
  caller,
  teamId,
  team,
  user,
  game,
  rsvp,
  resolveDelegatedAccess,
  isPublicGame,
}) {
  if (isPublicGame(team, game) === true) return true;
  if (hasOfficialAccess(game, caller)) return true;
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
    return false;
  }
  return [
    access?.full,
    access?.parent,
    access?.scorekeeping,
    access?.videography,
    access?.streaming,
    access?.media,
  ].some((value) => value === true);
}

function validateRateState(value, identity, nowMillis, makeError) {
  if (!value) return null;
  if (
    !isPlainObject(value) ||
    value.schemaVersion !== ENGAGEMENT_SCHEMA_VERSION ||
    value.trackingEngine !== DIAMOND_ENGINE ||
    value.instanceId !== identity.instanceId ||
    value.kind !== identity.kind ||
    value.actorHash !== identity.actorHash ||
    !Number.isSafeInteger(value.windowStartedAtMillis) ||
    value.windowStartedAtMillis < 0 ||
    !Number.isSafeInteger(value.lastAcceptedAtMillis) ||
    value.lastAcceptedAtMillis < value.windowStartedAtMillis ||
    value.lastAcceptedAtMillis > nowMillis ||
    !Number.isSafeInteger(value.acceptedCount) ||
    value.acceptedCount < 1 ||
    value.acceptedCount > RATE_POLICIES[identity.kind].maximum
  ) {
    throw makeError(
      "unavailable",
      "The durable live-interaction rate limit is malformed. No write occurred.",
      { reason: "rate-limit-state-invalid" },
    );
  }
  return value;
}

function nextRateState(
  current,
  identity,
  nowMillis,
  serverTimestamp,
  makeError,
) {
  const policy = RATE_POLICIES[identity.kind];
  const activeWindow =
    current && nowMillis - current.windowStartedAtMillis < policy.windowMillis;
  const count = activeWindow ? current.acceptedCount : 0;
  if (
    current &&
    nowMillis - current.lastAcceptedAtMillis < policy.cooldownMillis
  ) {
    throw makeError(
      "resource-exhausted",
      "Please wait before posting another live interaction.",
      { reason: "interaction-cooldown" },
    );
  }
  if (count >= policy.maximum) {
    throw makeError(
      "resource-exhausted",
      "The live-interaction rate limit was reached. Try again shortly.",
      { reason: "interaction-rate-limit" },
    );
  }
  return {
    schemaVersion: ENGAGEMENT_SCHEMA_VERSION,
    trackingEngine: DIAMOND_ENGINE,
    instanceId: identity.instanceId,
    kind: identity.kind,
    actorHash: identity.actorHash,
    windowStartedAtMillis: activeWindow
      ? current.windowStartedAtMillis
      : nowMillis,
    lastAcceptedAtMillis: nowMillis,
    acceptedCount: count + 1,
    updatedAt: serverTimestamp,
  };
}

function receiptMatches(receipt, identity) {
  return Boolean(
    isPlainObject(receipt) &&
    receipt.schemaVersion === ENGAGEMENT_SCHEMA_VERSION &&
    receipt.trackingEngine === DIAMOND_ENGINE &&
    receipt.teamId === identity.teamId &&
    receipt.gameId === identity.gameId &&
    receipt.instanceId === identity.instanceId &&
    receipt.kind === identity.kind &&
    receipt.requestId === identity.requestId &&
    receipt.requestHash === identity.requestHash &&
    receipt.actorHash === identity.actorHash &&
    receipt.outputId === identity.outputId,
  );
}

function outputMatches(output, identity) {
  if (!isPlainObject(output) || !output.createdAt) return false;
  const keys = Object.keys(output).sort();
  const ownershipMatches =
    output.schemaVersion === ENGAGEMENT_SCHEMA_VERSION &&
    output.trackingEngine === DIAMOND_ENGINE &&
    output.teamId === identity.teamId &&
    output.gameId === identity.gameId &&
    output.instanceId === identity.instanceId;
  if (!ownershipMatches) return false;
  if (identity.kind === "chat") {
    if (
      keys.join("\n") !==
      [
        "createdAt",
        "gameId",
        "isAnonymous",
        "instanceId",
        "schemaVersion",
        "senderId",
        "senderName",
        "senderPhotoUrl",
        "teamId",
        "text",
        "trackingEngine",
      ]
        .sort()
        .join("\n")
    ) {
      return false;
    }
    return (
      output.text === identity.payload.text &&
      output.senderId === identity.callerUid &&
      typeof output.senderName === "string" &&
      output.senderName.length > 0 &&
      output.senderName.length <= 80 &&
      (output.senderPhotoUrl === null ||
        normalizeHttpsUrl(output.senderPhotoUrl) === output.senderPhotoUrl) &&
      output.isAnonymous === false
    );
  }
  return (
    keys.join("\n") ===
      [
        "createdAt",
        "gameId",
        "instanceId",
        "schemaVersion",
        "senderId",
        "teamId",
        "trackingEngine",
        "type",
      ]
        .sort()
        .join("\n") &&
    output.type === identity.payload.type &&
    output.senderId === identity.callerUid
  );
}

function responseFromReceipt(receipt, kind, idempotent) {
  return {
    outcome: "accepted",
    idempotent,
    requestId: receipt.requestId,
    instanceId: receipt.instanceId,
    ...(kind === "chat"
      ? { messageId: receipt.outputId }
      : { reactionId: receipt.outputId }),
  };
}

function errorCode(error) {
  return String(error?.code || "").replace(/^functions\//, "");
}

function isAmbiguousWriteError(error) {
  return new Set([
    "aborted",
    "cancelled",
    "deadline-exceeded",
    "internal",
    "unknown",
    "unavailable",
  ]).has(errorCode(error));
}

function createDiamondLiveEngagementHandlers(dependencies = {}) {
  const firestore = dependencies.firestore;
  const auth = dependencies.auth;
  const FieldValue = dependencies.FieldValue;
  const HttpsError = dependencies.HttpsError || DiamondLiveEngagementError;
  const assertSensitiveWrite = dependencies.assertSensitiveWrite;
  const resolveDelegatedAccess =
    dependencies.resolveDelegatedAccess ||
    require("./delegated-team-context-core.cjs").resolveDelegatedAccess;
  const isPublicGame =
    dependencies.isPublicGame ||
    require("./public-team-api-core.cjs").canProjectPublicGame;
  const clock = dependencies.clock || (() => Date.now());
  const cryptoAdapter = dependencies.crypto || nodeCrypto;
  const logger = dependencies.logger || { info() {}, warn() {}, error() {} };

  if (!firestore?.doc || typeof firestore.runTransaction !== "function") {
    throw new TypeError(
      "A Firestore dependency with doc and runTransaction is required.",
    );
  }
  if (!auth || typeof auth.getUser !== "function") {
    throw new TypeError("An Auth dependency with getUser is required.");
  }
  if (!FieldValue || typeof FieldValue.serverTimestamp !== "function") {
    throw new TypeError("FieldValue.serverTimestamp is required.");
  }
  if (
    typeof HttpsError !== "function" ||
    typeof assertSensitiveWrite !== "function" ||
    typeof resolveDelegatedAccess !== "function" ||
    typeof isPublicGame !== "function" ||
    !cryptoAdapter ||
    typeof cryptoAdapter.createHash !== "function"
  ) {
    throw new TypeError(
      "Diamond live-engagement authorization dependencies are required.",
    );
  }

  const makeError = (code, message, details) =>
    new HttpsError(code, message, details);

  async function loadEnabledCaller(context) {
    if (!context?.auth?.uid) {
      throw makeError("unauthenticated", "Sign in to join this live game.");
    }
    const uid = normalizeId(context.auth.uid, "Authenticated user", makeError);
    let authUser;
    try {
      authUser = await auth.getUser(uid);
    } catch (error) {
      const code = errorCode(error);
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
    const token = {
      ...(isPlainObject(authUser.customClaims) ? authUser.customClaims : {}),
      ...(authUser.email ? { email: authUser.email } : {}),
      email_verified: authUser.emailVerified === true,
      ...(authUser.displayName ? { name: authUser.displayName } : {}),
      ...(authUser.photoURL ? { picture: authUser.photoURL } : {}),
    };
    await assertSensitiveWrite(
      { auth: { uid, token } },
      "diamond-live-engagement",
    );
    return { uid, email: authoritativeEmail(authUser), authUser };
  }

  function normalizeRequest(data, kind) {
    const allowed = new Set([
      "schemaVersion",
      "requestId",
      "teamId",
      "gameId",
      "expectedInstanceId",
      "viewerMode",
      kind === "chat" ? "text" : "type",
    ]);
    requireExactFields(data, allowed, makeError, "Live interaction request");
    if (data.schemaVersion !== ENGAGEMENT_SCHEMA_VERSION) {
      throw makeError(
        "invalid-argument",
        `schemaVersion must be ${ENGAGEMENT_SCHEMA_VERSION}.`,
      );
    }
    if (data.viewerMode !== "live") {
      throw makeError(
        "failed-precondition",
        "Replay and overlay views are read-only.",
        { reason: "viewer-read-only" },
      );
    }
    const request = {
      schemaVersion: ENGAGEMENT_SCHEMA_VERSION,
      kind,
      requestId: normalizeUuid(data.requestId, "requestId", makeError),
      teamId: normalizeId(data.teamId, "teamId", makeError),
      gameId: normalizeId(data.gameId, "gameId", makeError),
      expectedInstanceId: normalizeUuid(
        data.expectedInstanceId,
        "expectedInstanceId",
        makeError,
      ),
      viewerMode: "live",
      payload: {},
    };
    if (kind === "chat") {
      request.payload.text = normalizeChatText(data.text, makeError);
    } else {
      if (typeof data.type !== "string" || !REACTION_TYPES.has(data.type)) {
        throw makeError("invalid-argument", "Reaction type is not supported.");
      }
      request.payload.type = data.type;
    }
    return request;
  }

  function normalizeModerationRequest(data) {
    requireExactFields(
      data,
      new Set([
        "schemaVersion",
        "requestId",
        "teamId",
        "gameId",
        "expectedInstanceId",
        "messageId",
      ]),
      makeError,
      "Live chat moderation request",
    );
    if (data.schemaVersion !== ENGAGEMENT_SCHEMA_VERSION) {
      throw makeError(
        "invalid-argument",
        `schemaVersion must be ${ENGAGEMENT_SCHEMA_VERSION}.`,
      );
    }
    const messageId = normalizeId(data.messageId, "messageId", makeError);
    if (!DIAMOND_CHAT_MESSAGE_ID_PATTERN.test(messageId)) {
      throw makeError("invalid-argument", "messageId is invalid.");
    }
    return {
      schemaVersion: ENGAGEMENT_SCHEMA_VERSION,
      kind: "moderate-chat",
      requestId: normalizeUuid(data.requestId, "requestId", makeError),
      teamId: normalizeId(data.teamId, "teamId", makeError),
      gameId: normalizeId(data.gameId, "gameId", makeError),
      expectedInstanceId: normalizeUuid(
        data.expectedInstanceId,
        "expectedInstanceId",
        makeError,
      ),
      viewerMode: "moderation",
      payload: { messageId },
    };
  }

  function validateDiamondIdentity(game, root, request) {
    const checkpoint = root?.checkpoint;
    const state = checkpoint?.state;
    if (
      !isPlainObject(game) ||
      game.trackingEngine !== DIAMOND_ENGINE ||
      !isPlainObject(root) ||
      root.trackingEngine !== DIAMOND_ENGINE ||
      root.teamId !== request.teamId ||
      root.gameId !== request.gameId ||
      root.instanceId !== request.expectedInstanceId ||
      game.diamondScorebookInstanceId !== request.expectedInstanceId ||
      !isPlainObject(checkpoint) ||
      checkpoint.teamId !== request.teamId ||
      checkpoint.gameId !== request.gameId ||
      !Number.isSafeInteger(checkpoint.sequence) ||
      checkpoint.sequence < 1 ||
      !isPlainObject(state) ||
      state.teamId !== request.teamId ||
      state.gameId !== request.gameId ||
      state.revision !== checkpoint.sequence
    ) {
      throw makeError(
        "failed-precondition",
        "The requested Diamond game generation is not current.",
        { reason: "diamond-instance-mismatch" },
      );
    }
  }

  async function reconcileAmbiguousWrite({
    error,
    receiptRef,
    outputRef,
    identity,
    kind,
  }) {
    if (!isAmbiguousWriteError(error)) throw error;
    let snapshots;
    try {
      snapshots = await Promise.all([receiptRef.get(), outputRef.get()]);
    } catch {
      throw makeError(
        "unavailable",
        "The live interaction result is uncertain. Retry with the same request.",
        { reason: "interaction-write-uncertain", retryable: true },
      );
    }
    const receipt = snapshotData(snapshots[0]);
    const output = snapshotData(snapshots[1]);
    if (
      receipt &&
      receiptMatches(receipt, identity) &&
      outputMatches(output, identity)
    ) {
      return responseFromReceipt(receipt, kind, true);
    }
    throw makeError(
      "unavailable",
      "The live interaction was not confirmed. Retry with the same request.",
      { reason: "interaction-write-unconfirmed", retryable: true },
    );
  }

  async function writeInteraction(data, context, kind) {
    const request = normalizeRequest(data, kind);
    const caller = await loadEnabledCaller(context);
    const paths = engagementPaths(
      request.teamId,
      request.gameId,
      request.expectedInstanceId,
      caller.uid,
      request.requestId,
      kind,
      cryptoAdapter,
    );
    if (!paths) {
      throw makeError(
        "unavailable",
        "The live interaction could not be identified. No write occurred.",
      );
    }
    const hash = requestHash(request, cryptoAdapter, makeError);
    const identity = {
      teamId: request.teamId,
      gameId: request.gameId,
      instanceId: request.expectedInstanceId,
      kind,
      requestId: request.requestId,
      requestHash: hash,
      actorHash: paths.actorHash,
      outputId: paths.outputId,
      callerUid: caller.uid,
      payload: request.payload,
    };
    const receiptRef = firestore.doc(paths.receipt);
    const outputRef = firestore.doc(paths.output);
    const nowMillis = normalizeNow(clock, makeError);
    let response;
    try {
      response = await firestore.runTransaction(async (transaction) => {
        const references = [
          firestore.doc(paths.team),
          firestore.doc(paths.user),
          firestore.doc(paths.game),
          firestore.doc(paths.rsvp),
          firestore.doc(paths.scorebook),
          receiptRef,
          firestore.doc(paths.rate),
          outputRef,
        ];
        const snapshots = await Promise.all(
          references.map((reference) => transaction.get(reference)),
        );
        const team = snapshotData(snapshots[0]);
        const user = snapshotData(snapshots[1]) || {};
        const game = snapshotData(snapshots[2]);
        const rsvp = snapshotData(snapshots[3]);
        const root = snapshotData(snapshots[4]);
        const receipt = snapshotData(snapshots[5]);
        const rate = snapshotData(snapshots[6]);
        const output = snapshotData(snapshots[7]);

        if (!team || !game || !root) {
          throw makeError("not-found", "Diamond game not found.");
        }
        if (!isActiveTeam(team)) {
          throw makeError("permission-denied", "This team is not available.");
        }
        validateDiamondIdentity(game, root, request);
        if (
          !hasAuthorizedGameAccess({
            caller,
            teamId: request.teamId,
            team,
            user,
            game,
            rsvp,
            resolveDelegatedAccess,
            isPublicGame,
          })
        ) {
          throw makeError(
            "permission-denied",
            "You cannot interact with this game.",
          );
        }

        if (receipt) {
          if (
            !receiptMatches(receipt, identity) ||
            !outputMatches(output, identity)
          ) {
            throw makeError(
              "already-exists",
              "requestId was already used for different content.",
              { reason: "idempotency-conflict" },
            );
          }
          return responseFromReceipt(receipt, kind, true);
        }
        if (output) {
          throw makeError(
            "failed-precondition",
            "The live interaction receipt is inconsistent. No write occurred.",
            { reason: "interaction-receipt-missing" },
          );
        }
        assertOpenInteractionWindow({ team, game, root, nowMillis }, makeError);
        const serverTimestamp = FieldValue.serverTimestamp();
        const currentRate = validateRateState(
          rate,
          identity,
          nowMillis,
          makeError,
        );
        const nextRate = nextRateState(
          currentRate,
          identity,
          nowMillis,
          serverTimestamp,
          makeError,
        );
        const sender = senderIdentity(caller.authUser, user);
        const ownership = {
          schemaVersion: ENGAGEMENT_SCHEMA_VERSION,
          trackingEngine: DIAMOND_ENGINE,
          teamId: request.teamId,
          gameId: request.gameId,
          instanceId: request.expectedInstanceId,
        };
        const outputPayload =
          kind === "chat"
            ? {
                ...ownership,
                text: request.payload.text,
                senderId: caller.uid,
                senderName: sender.name,
                senderPhotoUrl: sender.photoUrl,
                isAnonymous: false,
                createdAt: serverTimestamp,
              }
            : {
                ...ownership,
                type: request.payload.type,
                senderId: caller.uid,
                createdAt: serverTimestamp,
              };
        const receiptPayload = {
          schemaVersion: ENGAGEMENT_SCHEMA_VERSION,
          trackingEngine: DIAMOND_ENGINE,
          teamId: request.teamId,
          gameId: request.gameId,
          instanceId: request.expectedInstanceId,
          kind,
          requestId: request.requestId,
          requestHash: hash,
          actorHash: paths.actorHash,
          outputId: paths.outputId,
          acceptedAtMillis: nowMillis,
          acceptedAt: serverTimestamp,
        };
        transaction.create(outputRef, outputPayload);
        transaction.set(firestore.doc(paths.rate), nextRate);
        transaction.create(receiptRef, receiptPayload);
        return responseFromReceipt(receiptPayload, kind, false);
      });
    } catch (error) {
      response = await reconcileAmbiguousWrite({
        error,
        receiptRef,
        outputRef,
        identity,
        kind,
      });
    }
    logger.info?.("diamond_live_engagement_accepted", {
      kind,
      idempotent: response.idempotent === true,
    });
    return response;
  }

  async function moderateChat(data, context) {
    const request = normalizeModerationRequest(data);
    const caller = await loadEnabledCaller(context);
    const paths = moderationPaths(
      request.teamId,
      request.gameId,
      request.expectedInstanceId,
      caller.uid,
      request.requestId,
      request.payload.messageId,
      cryptoAdapter,
    );
    if (!paths) {
      throw makeError(
        "unavailable",
        "The moderation request could not be identified. No write occurred.",
      );
    }
    const hash = requestHash(request, cryptoAdapter, makeError);
    const receiptRef = firestore.doc(paths.receipt);
    const outputRef = firestore.doc(paths.output);
    const receiptMatchesRequest = (receipt) =>
      Boolean(
        isPlainObject(receipt) &&
          receipt.schemaVersion === ENGAGEMENT_SCHEMA_VERSION &&
          receipt.trackingEngine === DIAMOND_ENGINE &&
          receipt.teamId === request.teamId &&
          receipt.gameId === request.gameId &&
          receipt.instanceId === request.expectedInstanceId &&
          receipt.kind === request.kind &&
          receipt.requestId === request.requestId &&
          receipt.requestHash === hash &&
          receipt.messageId === request.payload.messageId &&
          receipt.moderatorUid === caller.uid,
      );
    const responseFromModerationReceipt = (receipt, idempotent) => ({
      outcome: "accepted",
      idempotent,
      requestId: receipt.requestId,
      instanceId: receipt.instanceId,
      messageId: receipt.messageId,
      removed: true,
    });
    let response;
    try {
      response = await firestore.runTransaction(async (transaction) => {
        const references = [
          firestore.doc(paths.team),
          firestore.doc(paths.user),
          firestore.doc(paths.game),
          firestore.doc(paths.rsvp),
          firestore.doc(paths.scorebook),
          receiptRef,
          outputRef,
        ];
        const snapshots = await Promise.all(
          references.map((reference) => transaction.get(reference)),
        );
        const team = snapshotData(snapshots[0]);
        const user = snapshotData(snapshots[1]) || {};
        const game = snapshotData(snapshots[2]);
        const rsvp = snapshotData(snapshots[3]);
        const root = snapshotData(snapshots[4]);
        const receipt = snapshotData(snapshots[5]);
        const output = snapshotData(snapshots[6]);
        if (!team || !game || !root) {
          throw makeError("not-found", "Diamond game not found.");
        }
        validateDiamondIdentity(game, root, request);
        let access;
        try {
          access = resolveDelegatedAccess({
            uid: caller.uid,
            email: caller.email,
            user,
            teamId: request.teamId,
            team,
            game,
            rsvp,
          });
        } catch {
          access = null;
        }
        if (access?.full !== true) {
          throw makeError(
            "permission-denied",
            "Only a team manager can remove live chat messages.",
          );
        }
        if (receipt) {
          if (!receiptMatchesRequest(receipt) || output) {
            throw makeError(
              "already-exists",
              "requestId was already used for a different moderation request.",
              { reason: "idempotency-conflict" },
            );
          }
          return responseFromModerationReceipt(receipt, true);
        }
        if (!output) {
          throw makeError("not-found", "The live chat message was not found.");
        }
        const targetIdentity = {
          teamId: request.teamId,
          gameId: request.gameId,
          instanceId: request.expectedInstanceId,
          kind: "chat",
          callerUid: output.senderId,
          payload: { text: output.text },
        };
        if (!outputMatches(output, targetIdentity)) {
          throw makeError(
            "failed-precondition",
            "The live chat message does not belong to this game generation.",
          );
        }
        const receiptPayload = {
          schemaVersion: ENGAGEMENT_SCHEMA_VERSION,
          trackingEngine: DIAMOND_ENGINE,
          teamId: request.teamId,
          gameId: request.gameId,
          instanceId: request.expectedInstanceId,
          kind: request.kind,
          requestId: request.requestId,
          requestHash: hash,
          messageId: request.payload.messageId,
          moderatorUid: caller.uid,
          acceptedAt: FieldValue.serverTimestamp(),
        };
        transaction.delete(outputRef);
        transaction.create(receiptRef, receiptPayload);
        return responseFromModerationReceipt(receiptPayload, false);
      });
    } catch (error) {
      if (!isAmbiguousWriteError(error)) throw error;
      let snapshots;
      try {
        snapshots = await Promise.all([receiptRef.get(), outputRef.get()]);
      } catch {
        snapshots = null;
      }
      const receipt = snapshots ? snapshotData(snapshots[0]) : null;
      const output = snapshots ? snapshotData(snapshots[1]) : null;
      if (receiptMatchesRequest(receipt) && !output) {
        response = responseFromModerationReceipt(receipt, true);
      } else {
        throw makeError(
          "unavailable",
          "The moderation result is uncertain. Retry with the same request.",
          { reason: "moderation-write-uncertain", retryable: true },
        );
      }
    }
    logger.info?.("diamond_live_engagement_moderated", {
      idempotent: response.idempotent === true,
    });
    return response;
  }

  return {
    postDiamondLiveChat: (data, context) =>
      writeInteraction(data, context, "chat"),
    postDiamondLiveReaction: (data, context) =>
      writeInteraction(data, context, "reaction"),
    moderateDiamondLiveChat: moderateChat,
  };
}

module.exports = {
  DIAMOND_ENGINE,
  ENGAGEMENT_SCHEMA_VERSION,
  RATE_POLICIES,
  DiamondLiveEngagementError,
  calendarDateKey,
  createDiamondLiveEngagementHandlers,
  engagementPaths,
  isDiamondInteractionWindowOpen,
  isGameDay,
  moderationPaths,
};
