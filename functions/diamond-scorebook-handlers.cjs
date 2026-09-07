"use strict";

const nodeCrypto = require("node:crypto");

const DEFAULT_EVENT_PAGE_SIZE = 100;
const MAX_EVENT_PAGE_SIZE = 200;
const FULL_HISTORY_PAGE_SIZE = 200;
const MAX_CANONICAL_EVENTS = 20_000;
const MAX_ROSTER_CANDIDATES_PER_SIDE = 100;
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

function stableScorerCandidates(team, state) {
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
  return values.slice(0, 100).map((uid) => ({ playerId: uid, name: uid }));
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

function buildPublicEvent(event, core) {
  if (!event || PRIVATE_EVENT_TYPES.has(event.type)) return null;
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

function buildRecentPlay(event, core) {
  if (
    !RECENT_PLAY_TYPES.has(event?.type) ||
    PRIVATE_EVENT_TYPES.has(event?.type)
  )
    return null;
  const publicEvent = buildPublicEvent(event, core);
  return publicEvent
    ? {
        eventId: publicEvent.eventId,
        revision: publicEvent.revision,
        label: publicEvent.description,
        inningLabel: publicEvent.inningLabel,
        createdAt: publicEvent.createdAt,
        voided: publicEvent.type === "void_event",
      }
    : null;
}

function updateRecentPlays(existing, event, core) {
  const play = buildRecentPlay(event, core);
  if (!play) return Array.isArray(existing) ? existing.slice(-20) : [];
  return [...(Array.isArray(existing) ? existing : []), play].slice(-20);
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

function buildLegacyViewerGame({ team, game, projection, publicGameApi }) {
  const startsAtValue =
    game?.startsAt || game?.startTime || game?.date || game?.gameDate || "";
  const startsAt =
    typeof startsAtValue?.toDate === "function"
      ? startsAtValue.toDate().toISOString()
      : startsAtValue instanceof Date
        ? startsAtValue.toISOString()
        : compactText(startsAtValue, 80);
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
    location: compactText(game?.location || game?.venue || game?.address, 160),
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
  if (!auth || typeof auth.getUser !== "function") {
    throw new TypeError("An Auth dependency with getUser is required.");
  }
  if (
    typeof HttpsError !== "function" ||
    typeof resolveDelegatedAccess !== "function" ||
    typeof isPublicGame !== "function" ||
    typeof publicGameApi.publicHttpUrl !== "function" ||
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

  async function loadEnabledAuthUser(context) {
    const uid = typeof context?.auth?.uid === "string" ? context.auth.uid : "";
    if (!uid || uid !== uid.trim() || uid.length > 128 || uid.includes("/")) {
      throw makeError(
        "unauthenticated",
        "Sign in to use the Diamond scorebook.",
      );
    }
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
      access?.media,
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

  function isStrictPublicRosterTeam(team) {
    const status = compactText(team?.status, 32).toLowerCase();
    return (
      isPlainObject(team) &&
      team.isPublic === true &&
      team.active !== false &&
      team.archived !== true &&
      team.deleted !== true &&
      !["archived", "deleted", "inactive", "disabled"].includes(status)
    );
  }

  async function loadRosterCandidates(reader, teamId, orientationSnapshot) {
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
      isStrictPublicRosterTeam(snapshotData(opponentTeamSnapshot))
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
    return {
      [sides.teamSide]: homeRoster,
      [sides.opponentSide]: opponentRoster,
    };
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
      if (error instanceof HttpsError || error instanceof DiamondHandlerError)
        throw error;
      throw makeError(
        "unavailable",
        "Diamond access could not be verified. Try again.",
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

  async function verifyManagerStatsAccessAndHeads(
    transaction,
    request,
    caller,
  ) {
    const teamRef = firestore.doc(paths(request.teamId, "__no_game__").team);
    const userRef = firestore.doc(
      paths(request.teamId, "__no_game__").user(caller.uid),
    );
    const gameRefs = request.gameHeads.map(({ gameId }) =>
      firestore.doc(paths(request.teamId, gameId).game),
    );
    const rsvpRefs = request.gameHeads.map(({ gameId }) =>
      firestore.doc(paths(request.teamId, gameId).rsvp(caller.uid)),
    );
    let snapshots;
    try {
      if (typeof transaction.getAll !== "function") {
        throw new Error("Firestore transactional bulk reads are unavailable.");
      }
      snapshots = await transaction.getAll(
        teamRef,
        userRef,
        ...gameRefs,
        ...rsvpRefs,
      );
    } catch {
      throw makeError(
        "unavailable",
        "Internal stat access could not be verified completely. Try again.",
      );
    }
    const team = snapshotData(snapshots[0]);
    const user = snapshotData(snapshots[1]) || {};
    if (!team) throw makeError("not-found", "Team not found.");
    const gamesOffset = 2;
    const rsvpsOffset = gamesOffset + request.gameHeads.length;
    for (let index = 0; index < request.gameHeads.length; index += 1) {
      const head = request.gameHeads[index];
      const game = snapshotData(snapshots[gamesOffset + index]);
      const rsvp = snapshotData(snapshots[rsvpsOffset + index]);
      if (!game) throw makeError("not-found", "Game not found.");
      const access = resolveAccess({
        caller,
        user,
        teamId: request.teamId,
        team,
        game,
        rsvp,
      });
      requireManager(
        access,
        "Current team manager access is required for internal Diamond statistics.",
      );
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
    const caller = await loadEnabledAuthUser(context);
    await firestore.runTransaction((transaction) =>
      verifyManagerStatsAccessAndHeads(transaction, normalized, caller),
    );

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
    let statSnapshots;
    try {
      if (typeof firestore.getAll !== "function") {
        throw new Error("Firestore bulk reads are unavailable.");
      }
      const references = requests.map(({ reference }) => reference);
      statSnapshots =
        normalized.gameHeads.length === 1
          ? await firestore.getAll(...references)
          : await firestore.getAll(...references, {
              fieldMask: MANAGER_STAT_COMPACT_FIELD_MASK,
            });
    } catch {
      throw makeError(
        "unavailable",
        "Internal Diamond statistics could not be loaded completely. Try again.",
      );
    }
    if (
      !Array.isArray(statSnapshots) ||
      statSnapshots.length !== requests.length
    ) {
      throw makeError(
        "unavailable",
        "Internal Diamond statistics returned an incomplete bounded read. Try again.",
      );
    }

    const documents = [];
    for (let index = 0; index < playerRequests.length; index += 1) {
      const request = playerRequests[index];
      const document = snapshotData(statSnapshots[index]);
      if (!document) continue;
      assertManagerPlayerStatDocument(document, request.head, request.playerId);
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

    // Auth and every mutable role/head input are re-read after the private
    // bulk read. A revocation or newly projected generation therefore returns
    // no private payload to the caller.
    const recheckedCaller = await loadEnabledAuthUser(context);
    await firestore.runTransaction((transaction) =>
      verifyManagerStatsAccessAndHeads(
        transaction,
        normalized,
        recheckedCaller,
      ),
    );

    const expectedDocumentCount = playerRequests.length;
    const expectedTeamDocumentCount = teamRequests.length;
    return finalizeManagerStatsResponse({
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
      const nowMs = getActivationNowMs();
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

  async function loadAllCanonicalEvents(teamId, gameId) {
    const resourcePaths = paths(teamId, gameId);
    const events = [];
    let afterSequence = 0;
    while (events.length <= MAX_CANONICAL_EVENTS) {
      let snapshot;
      try {
        snapshot = await canonicalEventsQuery(
          resourcePaths.events,
          afterSequence,
          FULL_HISTORY_PAGE_SIZE,
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

  async function preauthorizePrivateReplay(teamId, gameId, caller) {
    let loaded;
    try {
      loaded = await loadAccessDocuments(firestore, teamId, gameId, caller);
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError) {
        throw error;
      }
      throw makeError(
        "unavailable",
        "Scorekeeping access could not be verified before replay. Try again.",
      );
    }
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
    return loaded;
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
    const caller = await loadEnabledAuthUser(context);
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
    if (fullReplayCommand) {
      await preauthorizePrivateReplay(command.teamId, command.gameId, caller);
    }
    let needsFullHistory = fullReplayCommand;
    let preparedHistory = null;
    if (fullReplayCommand) {
      let boundedReceiptSnapshot;
      try {
        boundedReceiptSnapshot = await firestore
          .doc(resourcePaths.command(command.commandId))
          .get();
      } catch {
        throw makeError(
          "unavailable",
          "The correction receipt could not be checked. Try again.",
        );
      }
      needsFullHistory = !snapshotData(boundedReceiptSnapshot);
    }
    if (needsFullHistory) {
      let rootSnapshot;
      try {
        rootSnapshot = await firestore.doc(resourcePaths.scorebook).get();
      } catch {
        throw makeError(
          "unavailable",
          "The Diamond checkpoint could not be read. Try again.",
        );
      }
      const root = snapshotData(rootSnapshot);
      if (!root) throw makeError("not-found", "Diamond scorebook not found.");
      const events = await loadAllCanonicalEvents(
        command.teamId,
        command.gameId,
      );
      const validated = validateCompleteHistory(root, events);
      preparedHistory = { root, events, checkpoint: validated.checkpoint };
    }

    return firestore.runTransaction(async (transaction) => {
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
      const [rootSnapshot, receiptSnapshot] = await Promise.all([
        transaction.get(rootRef),
        transaction.get(receiptRef),
      ]);
      const root = snapshotData(rootSnapshot);
      const existingReceipt = snapshotData(receiptSnapshot);
      if (!root) throw makeError("not-found", "Diamond scorebook not found.");
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
        if (duplicateExecution.result.outcome === "rejected") {
          return rejectedExecutionResponse(duplicateExecution, {
            root,
            team: loaded.team,
            game: loaded.game,
            callerUid: caller.uid,
            canScore: loaded.access.scorekeeping,
            canManage: loaded.access.full,
            nowMs: getWriteNowMs(),
          });
        }
        return acceptedExecutionResponse(duplicateExecution, {
          root,
          team: loaded.team,
          game: loaded.game,
          callerUid: caller.uid,
          canScore: loaded.access.scorekeeping,
          canManage: loaded.access.full,
          nowMs: getWriteNowMs(),
        });
      }
      if (!isActiveTeam(loaded.team)) {
        throw makeError(
          "failed-precondition",
          "Inactive teams cannot submit Diamond commands.",
        );
      }
      const operationName =
        command.type === "cancel" ||
        RESILIENT_CORRECTION_COMMANDS.has(command.type) ||
        (checkpoint.state?.lifecycle === "correction" &&
          ["record_fielding", "record_scoring_judgment", "finalize"].includes(
            command.type,
          ))
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
      const nowMs = getWriteNowMs();
      let nextScorerLease = null;
      if (command.type !== "cancel") {
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

      let execution;
      const eventId = getNewEventId();
      if (needsFullHistory) {
        if (
          !preparedHistory ||
          preparedHistory.checkpoint.sequence !== checkpoint.sequence ||
          preparedHistory.checkpoint.previousHash !== checkpoint.previousHash
        ) {
          return {
            outcome: "rejected",
            revision: checkpoint.sequence,
            eventId: null,
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
            rejection: {
              code: "stale-revision",
              message:
                "The scorebook changed while the correction was being verified.",
              retryable: true,
              authoritativeRevision: checkpoint.sequence,
            },
          };
        }
        const ledger = {
          teamId: command.teamId,
          gameId: command.gameId,
          rulesProfileId: root.rulesProfileId,
          rulesProfileVersion: root.rulesProfileVersion,
          captureMode: root.captureMode,
          initialState: root.initialState,
          state: checkpoint.state,
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
            receipt: {
              commandId: command.commandId,
              commandHash: domainEngine.getDiamondCommandHash(command),
              event: execution.event,
              result: execution.result,
            },
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
      const receipt = execution.receipt || {
        commandId: command.commandId,
        commandHash: domainEngine.getDiamondCommandHash(command),
        event: execution.event,
        result: execution.result,
      };
      const recentPublicEvents = updateRecentPlays(
        root.recentPublicEvents,
        execution.event,
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
      const publicEvent = buildPublicEvent(execution.event, core);
      const publicStateRef = firestore.doc(resourcePaths.publicState);
      const publicStateSnapshot = await transaction.get(publicStateRef);
      const existingPublicState = snapshotData(publicStateSnapshot) || {};
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
      if (command.type === "private_note") {
        transaction.create(
          firestore.doc(resourcePaths.note(execution.event.eventId)),
          {
            schemaVersion: 1,
            instanceId: root.instanceId,
            eventId: execution.event.eventId,
            revision: execution.event.revision,
            text: command.payload.text,
            attachedEventId: command.payload.attachedEventId || null,
            visibility: "staff-private",
            createdBy: caller.uid,
            createdAt: timestampIso(nowMs),
          },
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

  async function loadAuthorizedState(teamId, gameId, caller) {
    let loaded;
    let rootSnapshot;
    try {
      [loaded, rootSnapshot] = await Promise.all([
        loadAccessDocuments(firestore, teamId, gameId, caller),
        firestore.doc(paths(teamId, gameId).scorebook).get(),
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
    const availablePlayers = await loadRosterCandidates(
      firestore,
      teamId,
      root.orientationSnapshot,
    );
    return { loaded, root: { ...root, availablePlayers }, checkpoint };
  }

  async function reauthorizePrivateEventPage({
    teamId,
    gameId,
    context,
    expectedInstanceId,
    sourceRevision,
  }) {
    const caller = await loadEnabledAuthUser(context);
    try {
      await firestore.runTransaction(async (transaction) => {
        const [loaded, rootSnapshot] = await Promise.all([
          loadAccessDocuments(transaction, teamId, gameId, caller),
          transaction.get(firestore.doc(paths(teamId, gameId).scorebook)),
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
          root.instanceId !== expectedInstanceId ||
          root.instanceId !== loaded.game.diamondScorebookInstanceId ||
          checkpoint.sequence !== sourceRevision
        ) {
          throw makeError(
            "unavailable",
            "The private scorebook changed while history was loading. Try again.",
          );
        }
      });
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError) {
        throw error;
      }
      throw makeError(
        "unavailable",
        "Private scorebook access could not be reverified. Try again.",
      );
    }
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
    const { loaded, root, checkpoint } = await loadAuthorizedState(
      teamId,
      gameId,
      caller,
    );
    return buildPrivateSnapshot({
      state: checkpoint.state,
      root,
      team: loaded.team,
      game: loaded.game,
      callerUid: caller.uid,
      canScore: loaded.access.scorekeeping,
      canManage: loaded.access.full,
      nowMs: normalizeNow(clock, makeError),
      core,
    });
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
    const state = await loadAuthorizedState(teamId, gameId, caller);
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
    const items = pageDocuments.map(snapshotData).filter(Boolean);
    const hasMore = allDocuments.length > limit;
    let expectedSequence = cursor + 1;
    for (const item of items) {
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
    await reauthorizePrivateEventPage({
      teamId,
      gameId,
      context,
      expectedInstanceId: state.root.instanceId,
      sourceRevision,
    });
    return buildByteBoundedPrivateEventPage({
      events: items,
      limit,
      hasMore,
      sourceRevision,
    });
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
    const caller = await loadEnabledAuthUser(context);
    if (data.visibility !== "private" && data.visibility != null) {
      throw makeError(
        "invalid-argument",
        "Raw Diamond events are private. Use getPublicDiamondGame for public replay.",
      );
    }
    const visibility = "private";
    const limit = normalizePageLimit(data.limit, makeError);
    const cursor = normalizeSequenceCursor(data.cursor, makeError);
    return readEventPage({
      teamId,
      gameId,
      visibility,
      limit,
      cursor,
      caller,
      context,
    });
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
        description: event.description,
        createdAt,
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
    return {
      instanceId: fresh.game.diamondScorebookInstanceId,
      game: buildLegacyViewerGame({
        team: fresh.team,
        game: fresh.game,
        projection: fresh.projection,
        publicGameApi,
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
    const caller = await loadEnabledAuthUser(context);
    const { loaded, root, checkpoint } = await loadAuthorizedState(
      teamId,
      gameId,
      caller,
    );
    requireScorekeeper(loaded.access);
    if (
      checkpoint.sequence !== expectedRevision ||
      root.rulesProfileId !== rulesProfileId ||
      root.rulesProfileVersion !== rulesProfileVersion
    ) {
      throw makeError(
        "aborted",
        "Refresh the scorebook before interpreting this dictation.",
        {
          authoritativeRevision: checkpoint.sequence,
        },
      );
    }
    let proposal;
    if (
      /^(next|advance)( the)? half( inning)?[.!]?$/i.test(transcript) ||
      /^switch sides[.!]?$/i.test(transcript)
    ) {
      proposal = {
        schemaVersion: 1,
        type: "advance_half_inning",
        payload: {},
        confidence: 0.9,
        unresolvedFields: [],
        requiresConfirmation: true,
        mutatesState: false,
      };
    } else {
      proposal = {
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
      };
    }
    try {
      return core.validateDiamondVoiceProposal(proposal);
    } catch (error) {
      logger.error?.("diamond_voice_proposal_rejected", {
        code: error?.code || "invalid-proposal",
      });
      throw makeError(
        "internal",
        "The voice proposal could not be validated. No play was recorded.",
      );
    }
  }

  async function regenerateDiamondProjection(data = {}, context = {}) {
    requireExactFields(
      data,
      new Set(["teamId", "gameId", "expectedRevision"]),
      makeError,
      "Projection regeneration request",
    );
    const teamId = normalizeId(data.teamId, "teamId");
    const gameId = normalizeId(data.gameId, "gameId");
    const expectedRevision = normalizeOptionalRevision(
      data.expectedRevision,
      makeError,
    );
    const caller = await loadEnabledAuthUser(context);
    let preauthorized;
    try {
      preauthorized = await loadAccessDocuments(
        firestore,
        teamId,
        gameId,
        caller,
      );
    } catch (error) {
      if (error instanceof HttpsError || error instanceof DiamondHandlerError) {
        throw error;
      }
      throw makeError(
        "unavailable",
        "Projection access could not be verified before replay. Try again.",
      );
    }
    requireManager(
      preauthorized.access,
      "Only a current team manager can regenerate Diamond projections.",
    );
    requireAllowed(
      core.decideDiamondOperation({
        operation: "project",
        policy: null,
        teamId,
        game: preauthorized.game,
      }),
      "This game is not owned by Diamond v2.",
    );
    const nowMs = normalizeNow(clock, makeError);
    const auditId = secureUuid(random, makeError, "projection audit");
    const resourcePaths = paths(teamId, gameId);
    let rootSnapshot;
    try {
      rootSnapshot = await firestore.doc(resourcePaths.scorebook).get();
    } catch {
      throw makeError(
        "unavailable",
        "The Diamond checkpoint could not be read for regeneration. Try again.",
      );
    }
    const root = snapshotData(rootSnapshot);
    if (!root) throw makeError("not-found", "Diamond scorebook not found.");
    const events = await loadAllCanonicalEvents(teamId, gameId);
    const { checkpoint, replay } = validateCompleteHistory(root, events);
    if (expectedRevision !== null && expectedRevision !== checkpoint.sequence) {
      throw makeError(
        "aborted",
        "The scorebook changed before regeneration began.",
        {
          authoritativeRevision: checkpoint.sequence,
        },
      );
    }
    const repairedCheckpoint = {
      teamId,
      gameId,
      rulesProfileId: root.rulesProfileId,
      rulesProfileVersion: root.rulesProfileVersion,
      captureMode: root.captureMode,
      sequence: checkpoint.sequence,
      previousHash: checkpoint.previousHash,
      state: replay.state,
    };
    const projectionStatus = "pending";
    return firestore.runTransaction(async (transaction) => {
      const loaded = await loadAccessDocuments(
        transaction,
        teamId,
        gameId,
        caller,
      );
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
      const rootRef = firestore.doc(resourcePaths.scorebook);
      const rootCurrent = snapshotData(await transaction.get(rootRef));
      const currentCheckpoint = buildCheckpointFromRoot(rootCurrent);
      if (
        !rootCurrent ||
        !currentCheckpoint ||
        rootCurrent.instanceId !== root.instanceId ||
        currentCheckpoint.sequence !== checkpoint.sequence ||
        currentCheckpoint.previousHash !== checkpoint.previousHash
      ) {
        throw makeError(
          "aborted",
          "The scorebook changed while regeneration was running. Try again.",
        );
      }
      const nextRoot = {
        ...rootCurrent,
        checkpoint: repairedCheckpoint,
        projectionStatus,
        projectionRequest: {
          requestId: auditId,
          sourceRevision: replay.state.revision,
          requestedBy: caller.uid,
          requestedAt: timestampIso(nowMs),
        },
        updatedAt: timestampIso(nowMs),
      };
      transaction.update(rootRef, {
        checkpoint: repairedCheckpoint,
        projectionStatus,
        projectionRequest: nextRoot.projectionRequest,
        updatedAt: timestampIso(nowMs),
      });
      transaction.update(
        loaded.gameRef,
        gameProjectionPatch(replay.state, projectionStatus),
      );
      transaction.create(firestore.doc(resourcePaths.audit(auditId)), {
        schemaVersion: 1,
        instanceId: root.instanceId,
        type: "projection-regeneration-requested",
        sourceRevision: replay.state.revision,
        actorUid: caller.uid,
        createdAt: timestampIso(nowMs),
        notificationsSuppressed: true,
      });
      return {
        regenerated: false,
        regenerationQueued: true,
        projectionStatus,
        revision: replay.state.revision,
        state: buildPrivateSnapshot({
          state: replay.state,
          root: nextRoot,
          team: loaded.team,
          game: loaded.game,
          callerUid: caller.uid,
          canScore: loaded.access.scorekeeping,
          canManage: loaded.access.full,
          nowMs,
          core,
        }),
        notificationsSuppressed: true,
      };
    });
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
  DEFAULT_EVENT_PAGE_SIZE,
  DIAMOND_ENGINE,
  DiamondHandlerError,
  FULL_HISTORY_PAGE_SIZE,
  LEGACY_TRACKING_COLLECTIONS,
  MAX_CANONICAL_EVENTS,
  MAX_EVENT_PAGE_SIZE,
  MAX_MANAGER_STAT_GAMES,
  MAX_MANAGER_STAT_PLAYERS,
  MAX_MANAGER_STAT_RESPONSE_BYTES,
  MAX_PRIVATE_EVENT_PAGE_BYTES,
  SCORER_LEASE_DURATION_MS,
  createDiamondScorebookHandlers,
  paths,
};
