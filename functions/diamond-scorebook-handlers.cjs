"use strict";

const nodeCrypto = require("node:crypto");

const DEFAULT_EVENT_PAGE_SIZE = 100;
const MAX_EVENT_PAGE_SIZE = 200;
const FULL_HISTORY_PAGE_SIZE = 200;
const MAX_CANONICAL_EVENTS = 20_000;
const MAX_ROSTER_CANDIDATES_PER_SIDE = 100;
const DIAMOND_ENGINE = "diamond-v2";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEGACY_TRACKING_COLLECTIONS = Object.freeze([
  "events",
  "aggregatedStats",
  "teamStats",
  "privatePlayerStats",
  "liveEvents",
]);
const CORRECTION_COMMANDS = new Set([
  "record_fielding",
  "record_scoring_judgment",
  "void_event",
  "supersede_event",
  "reopen_for_correction",
]);
const PRIVATE_EVENT_TYPES = new Set(["private_note"]);
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
  return {
    team: `teams/${teamId}`,
    user: (uid) => `users/${uid}`,
    game,
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
    configurationRequest: (requestId) =>
      `teams/${teamId}/diamondConfigurationRequests/${requestId}`,
    cleanupLock: `teams/${teamId}/diamondCleanupLocks/${gameId}`,
  };
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
  team,
  game,
  availablePlayers = null,
  rulesCapabilities = null,
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
  const teamName =
    compactText(team?.name || team?.teamName, 160) || "Your team";
  const opponentName =
    compactText(
      game?.opponentName ||
        game?.opponent ||
        game?.awayTeamName ||
        game?.opponentTeamName,
      160,
    ) || "Opponent";
  const explicitSide = compactText(
    game?.teamSide || game?.homeAway,
    16,
  ).toLowerCase();
  const managedSide =
    game?.awayTeamId === state?.teamId ||
    game?.isHome === false ||
    explicitSide === "away"
      ? "away"
      : "home";
  const canonicalHomeName =
    compactText(game?.homeName || game?.homeTeamName, 160) ||
    (managedSide === "home" ? teamName : opponentName);
  const canonicalAwayName =
    compactText(game?.awayName || game?.awayTeamName, 160) ||
    (managedSide === "away" ? teamName : opponentName);
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
  readOnlyReason = null,
  core,
}) {
  const presentation = getPresentation(
    state,
    team,
    game,
    root?.availablePlayers,
    root?.rulesCapabilities,
  );
  const holderUid = compactText(state?.currentScorerUid, 128) || null;
  const snapshot = {
    schemaVersion: 2,
    trackingEngine: DIAMOND_ENGINE,
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
      status: !holderUid
        ? "available"
        : holderUid === callerUid
          ? "owned"
          : "held-by-other",
      canScore: canScore === true && holderUid === callerUid,
      holderUid,
      holderName: null,
      expiresAt: null,
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
  const presentation = getPresentation(state, team, game, null, null);
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

function gameProjectionPatch(state, projectionStatus = "pending") {
  return {
    trackingEngine: DIAMOND_ENGINE,
    diamondProjectionRevision: state.revision,
    diamondProjectionStatus: projectionStatus,
    diamondLifecycle: state.lifecycle,
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

function buildLegacyViewerGame({ team, game, projection }) {
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
  const domainEngine = dependencies.domainEngine || require("./diamond-engine");
  const resolveDelegatedAccess =
    dependencies.resolveDelegatedAccess ||
    require("./delegated-team-context-core.cjs").resolveDelegatedAccess;
  const isPublicGame =
    dependencies.isPublicGame ||
    require("./public-team-api-core.cjs").canProjectPublicGame;
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
    typeof isPublicGame !== "function"
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

  function resolveRosterSides(teamId, game) {
    const explicitSide = compactText(
      game?.teamSide || game?.homeAway,
      16,
    ).toLowerCase();
    let teamSide =
      game?.isHome === false || explicitSide === "away" ? "away" : "home";
    let opponentTeamId = null;
    const homeTeamId =
      typeof game?.homeTeamId === "string" ? game.homeTeamId : null;
    const awayTeamId =
      typeof game?.awayTeamId === "string" ? game.awayTeamId : null;
    if (homeTeamId === teamId && awayTeamId && awayTeamId !== teamId) {
      teamSide = "home";
      opponentTeamId = normalizeId(awayTeamId, "awayTeamId");
    } else if (awayTeamId === teamId && homeTeamId && homeTeamId !== teamId) {
      teamSide = "away";
      opponentTeamId = normalizeId(homeTeamId, "homeTeamId");
    } else if (
      typeof game?.opponentTeamId === "string" &&
      game.opponentTeamId !== teamId
    ) {
      opponentTeamId = normalizeId(game.opponentTeamId, "opponentTeamId");
    }
    return {
      teamSide,
      opponentSide: teamSide === "home" ? "away" : "home",
      opponentTeamId,
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

  async function loadRosterCandidates(reader, teamId, game) {
    const sides = resolveRosterSides(teamId, game);
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
      ]),
      makeError,
      "Team configuration request",
    );
    const requestId = normalizeUuid(data.requestId, "requestId");
    const teamId = normalizeId(data.teamId, "teamId");
    const sport = core.normalizeDiamondSport(data.sport);
    if (!sport)
      throw makeError(
        "invalid-argument",
        "Diamond supports Baseball and Fastpitch teams only.",
      );
    if (data.enabled === false) {
      throw makeError(
        "invalid-argument",
        "Diamond configuration cannot be disabled through this activation endpoint.",
      );
    }
    const captureMode = data.captureMode === "full" ? "full" : "quick";
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
          operation: "activate",
        }),
        "Diamond setup is disabled.",
      );
      if (!isActiveTeam(loaded.team))
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
        enabled: true,
        sport,
        rulesProfileId: profile.id,
        rulesProfileVersion: profile.version,
        captureMode,
        configuredAt: timestampIso(nowMs),
        configuredBy: caller.uid,
      };
      const result = {
        available: true,
        configured: true,
        teamId,
        sport,
        rulesProfileId: profile.id,
        rulesProfileVersion: profile.version,
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
    const appBuild =
      data.appBuild == null
        ? 0
        : normalizeOptionalRevision(data.appBuild, makeError, "appBuild");
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
        operation: "activate",
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
    const appBuild =
      data.appBuild == null
        ? 0
        : normalizeOptionalRevision(data.appBuild, makeError, "appBuild");
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
        if (existingReceipt) {
          const retryCommand = {
            schemaVersion: 2,
            commandId: requestId,
            teamId,
            gameId,
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
          appBuild,
          game: {},
        }),
        "Diamond activation is disabled.",
      );
      const availablePlayers = await loadRosterCandidates(
        transaction,
        teamId,
        loaded.game,
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
      const optIn = core.parseDiamondTeamOptIn(loaded.team.diamondScorebook);
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
        initialState: ledger.initialState,
        checkpoint,
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

  async function validateHandoffTarget(transaction, command, loaded, caller) {
    if (command.type !== "scorer_handoff") return;
    const targetUid = normalizeId(command.payload.toUid, "payload.toUid");
    let targetAuth;
    try {
      targetAuth = await auth.getUser(targetUid);
    } catch {
      throw makeError(
        "failed-precondition",
        "The requested scorekeeper account is unavailable.",
      );
    }
    if (
      !targetAuth ||
      targetAuth.uid !== targetUid ||
      targetAuth.disabled === true
    ) {
      throw makeError(
        "failed-precondition",
        "The requested scorekeeper account is unavailable.",
      );
    }
    const resourcePaths = paths(command.teamId, command.gameId);
    const [userSnapshot, rsvpSnapshot] = await Promise.all([
      transaction.get(firestore.doc(resourcePaths.user(targetUid))),
      transaction.get(firestore.doc(resourcePaths.rsvp(targetUid))),
    ]);
    const targetCaller = {
      uid: targetUid,
      authUser: targetAuth,
      email: getAuthoritativeEmail(targetAuth),
    };
    const targetAccess = resolveAccess({
      caller: targetCaller,
      user: snapshotData(userSnapshot) || {},
      teamId: command.teamId,
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
    if (targetUid === caller.uid) {
      throw makeError(
        "invalid-argument",
        "Choose a different scorekeeper for handoff.",
      );
    }
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
    const fullReplayCommand =
      command.type === "void_event" ||
      command.type === "supersede_event" ||
      command.type === "finalize";
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
      requireScorekeeper(loaded.access);
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
          });
        }
        return acceptedExecutionResponse(duplicateExecution, {
          root,
          team: loaded.team,
          game: loaded.game,
          callerUid: caller.uid,
          canScore: loaded.access.scorekeeping,
        });
      }
      if (!isActiveTeam(loaded.team)) {
        throw makeError(
          "failed-precondition",
          "Inactive teams cannot submit Diamond commands.",
        );
      }
      const operationName =
        CORRECTION_COMMANDS.has(command.type) ||
        (command.type === "finalize" &&
          checkpoint.state?.lifecycle === "correction")
          ? "correct"
          : "score";
      requireAllowed(
        core.decideDiamondOperation({
          operation: operationName,
          policy,
          teamId: command.teamId,
          game: loaded.game,
        }),
        "Diamond scoring is disabled.",
      );
      await validateHandoffTarget(transaction, command, loaded, caller);

      let execution;
      const eventId = getNewEventId();
      const nowMs = getWriteNowMs();
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
          { actorUid: caller.uid, eventId, serverTimestampMs: nowMs },
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
    const availablePlayers = await loadRosterCandidates(
      firestore,
      teamId,
      loaded.game,
    );
    return { loaded, root: { ...root, availablePlayers }, checkpoint };
  }

  async function loadPublicState(teamId, gameId) {
    const resourcePaths = paths(teamId, gameId);
    let snapshots;
    try {
      snapshots = await Promise.all([
        firestore.doc(resourcePaths.team).get(),
        firestore.doc(resourcePaths.game).get(),
        firestore.doc(resourcePaths.publicState).get(),
      ]);
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
    if (!canProjectPublic(team, game))
      throw makeError("not-found", "Public Diamond game not found.");
    if (projection.instanceId !== game.diamondScorebookInstanceId) {
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
    const visibility =
      data.visibility === "public"
        ? "public"
        : data.visibility === "private" || data.visibility == null
          ? "private"
          : null;
    if (!visibility)
      throw makeError(
        "invalid-argument",
        "visibility must be public or private.",
      );
    if (visibility === "public") {
      const loaded = await loadPublicState(teamId, gameId);
      return loaded.projection;
    }
    const caller = await loadEnabledAuthUser(context);
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
      core,
    });
  }

  async function readEventPage({
    teamId,
    gameId,
    visibility,
    limit,
    cursor,
    caller = null,
    loadedPublicState = null,
    newestFirst = false,
  }) {
    const resourcePaths = paths(teamId, gameId);
    let sourceRevision;
    let collectionPath;
    if (visibility === "public") {
      const loaded =
        loadedPublicState || (await loadPublicState(teamId, gameId));
      sourceRevision = Number(loaded.projection.revision || 0);
      collectionPath = resourcePaths.publicEvents;
    } else {
      const state = await loadAuthorizedState(teamId, gameId, caller);
      sourceRevision = state.checkpoint.sequence;
      collectionPath = resourcePaths.events;
    }
    let querySnapshot;
    try {
      const query =
        visibility === "public" && newestFirst
          ? publicViewerEventsQuery(
              collectionPath,
              cursor,
              sourceRevision,
              limit + 1,
            )
          : canonicalEventsQuery(
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
    if (visibility === "private") {
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
    }
    const nextCursor =
      hasMore && items.length ? String(items[items.length - 1].sequence) : null;
    return core.buildDiamondEventPage({
      events: items,
      limit,
      hasMore,
      nextCursor,
      readStatus: "complete",
      sourceRevision,
      visibility,
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
    const visibility =
      data.visibility === "public"
        ? "public"
        : data.visibility === "private" || data.visibility == null
          ? "private"
          : null;
    if (!visibility)
      throw makeError(
        "invalid-argument",
        "visibility must be public or private.",
      );
    const limit = normalizePageLimit(data.limit, makeError);
    const cursor = normalizeSequenceCursor(data.cursor, makeError);
    const caller =
      visibility === "private" ? await loadEnabledAuthUser(context) : null;
    return readEventPage({ teamId, gameId, visibility, limit, cursor, caller });
  }

  async function getPublicDiamondGame(data = {}) {
    requireExactFields(
      data,
      new Set(["teamId", "gameId", "limit", "cursor"]),
      makeError,
      "Public Diamond game request",
    );
    const teamId = normalizeId(data.teamId, "teamId");
    const gameId = normalizeId(data.gameId, "gameId");
    const limit = normalizePageLimit(data.limit, makeError);
    const cursor = normalizeSequenceCursor(data.cursor, makeError);
    const loaded = await loadPublicState(teamId, gameId);
    const page = await readEventPage({
      teamId,
      gameId,
      visibility: "public",
      limit,
      cursor,
      loadedPublicState: loaded,
      newestFirst: true,
    });
    const events = page.items.map((event) => ({
      id: event.eventId || `revision-${String(event.revision)}`,
      revision: event.revision,
      inning: event.inning,
      half: event.half,
      description: event.description,
      createdAt: event.createdAt,
      isCorrection: event.corrected === true,
      isScoringPlay: ["record_plate_appearance", "advance_runner"].includes(
        event.type,
      ),
      score: event.score || null,
    }));
    return {
      game: buildLegacyViewerGame({
        team: loaded.team,
        game: loaded.game,
        projection: loaded.projection,
      }),
      events,
      nextCursor: page.nextCursor,
      complete: page.collectionComplete,
      truncated: page.truncated,
      sourceRevision: page.sourceRevision,
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
    const nowMs = normalizeNow(clock, makeError);
    const auditId = secureUuid(random, makeError, "projection audit");
    const resourcePaths = paths(teamId, gameId);
    const root = snapshotData(
      await firestore
        .doc(resourcePaths.scorebook)
        .get()
        .catch(() => null),
    );
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
    let statsProjection = null;
    if (typeof domainEngine.projectDiamondStats === "function") {
      try {
        statsProjection = domainEngine.projectDiamondStats({
          teamId,
          gameId,
          rulesProfileId: root.rulesProfileId,
          rulesProfileVersion: root.rulesProfileVersion,
          captureMode: root.captureMode,
          initialState: root.initialState,
          state: replay.state,
          events,
        });
      } catch {
        throw makeError(
          "failed-precondition",
          "The verified history could not be projected into Diamond statistics.",
        );
      }
    }
    const projectionStatus = statsProjection ? "complete" : "pending";
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
        updatedAt: timestampIso(nowMs),
      };
      const publicProjection = buildPublicProjection({
        state: replay.state,
        root: nextRoot,
        team: loaded.team,
        game: loaded.game,
        nowMs,
        core,
        projectionStatus,
      });
      transaction.update(rootRef, {
        checkpoint: repairedCheckpoint,
        projectionStatus,
        updatedAt: timestampIso(nowMs),
      });
      transaction.set(firestore.doc(resourcePaths.publicState), {
        ...publicProjection,
        instanceId: root.instanceId,
        publicEventCount: events.filter(
          (event) => !PRIVATE_EVENT_TYPES.has(event.type),
        ).length,
      });
      transaction.set(
        firestore.doc(resourcePaths.projection("stats")),
        statsProjection
          ? {
              ...statsProjection,
              instanceId: root.instanceId,
              status: "complete",
              updatedAt: timestampIso(nowMs),
            }
          : {
              schemaVersion: 1,
              instanceId: root.instanceId,
              status: "pending",
              sourceRevision: replay.state.revision,
              updatedAt: timestampIso(nowMs),
              reason: "full-stat-projector-unavailable",
            },
      );
      transaction.update(
        loaded.gameRef,
        gameProjectionPatch(replay.state, projectionStatus),
      );
      transaction.create(firestore.doc(resourcePaths.audit(auditId)), {
        schemaVersion: 1,
        instanceId: root.instanceId,
        type: "projection-regenerated",
        sourceRevision: replay.state.revision,
        actorUid: caller.uid,
        createdAt: timestampIso(nowMs),
        notificationsSuppressed: true,
      });
      return {
        regenerated: true,
        revision: replay.state.revision,
        state: buildPrivateSnapshot({
          state: replay.state,
          root: nextRoot,
          team: loaded.team,
          game: loaded.game,
          callerUid: caller.uid,
          canScore: loaded.access.scorekeeping,
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
    const resourcePaths = paths(teamId, gameId);
    let currentSnapshot;
    try {
      currentSnapshot = await firestore.doc(resourcePaths.game).get();
    } catch {
      return {
        cleaned: false,
        retained: true,
        reason: "parent-read-incomplete",
        retryable: true,
      };
    }
    const currentGame = snapshotData(currentSnapshot);
    const [rootSnapshot, publicSnapshot, lockSnapshot] = await Promise.all([
      firestore.doc(resourcePaths.scorebook).get(),
      firestore.doc(resourcePaths.publicState).get(),
      firestore.doc(resourcePaths.cleanupLock).get(),
    ]);
    const root = snapshotData(rootSnapshot);
    const publicState = snapshotData(publicSnapshot);
    const existingLock = snapshotData(lockSnapshot);
    const decision = core.decideDiamondDeletionCleanup({
      deletedGame,
      currentGame,
      currentReadStatus: "complete",
      descendantsPresent: Boolean(root || publicState),
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
      return {
        cleaned: false,
        retained: true,
        reason: decision.code,
        retryable: decision.retryable === true,
      };
    }
    const generation = decision.generation;
    if (
      (root && root.instanceId !== generation) ||
      (publicState && publicState.instanceId !== generation)
    ) {
      return {
        cleaned: false,
        retained: true,
        reason: "descendant-generation-mismatch",
        retryable: true,
      };
    }
    const nowMs = normalizeNow(clock, makeError);
    const reserved = await firestore.runTransaction(async (transaction) => {
      const [
        gameNowSnapshot,
        rootNowSnapshot,
        publicNowSnapshot,
        lockNowSnapshot,
      ] = await Promise.all([
        transaction.get(firestore.doc(resourcePaths.game)),
        transaction.get(firestore.doc(resourcePaths.scorebook)),
        transaction.get(firestore.doc(resourcePaths.publicState)),
        transaction.get(firestore.doc(resourcePaths.cleanupLock)),
      ]);
      if (snapshotData(gameNowSnapshot)) return false;
      const rootNow = snapshotData(rootNowSnapshot);
      const publicNow = snapshotData(publicNowSnapshot);
      const lockNow = snapshotData(lockNowSnapshot);
      if (
        (rootNow && rootNow.instanceId !== generation) ||
        (publicNow && publicNow.instanceId !== generation) ||
        (lockNow && lockNow.generation !== generation)
      ) {
        return false;
      }
      transaction.set(firestore.doc(resourcePaths.cleanupLock), {
        schemaVersion: 1,
        generation,
        status: "deleting",
        complete: false,
        updatedAt: timestampIso(nowMs),
      });
      return true;
    });
    if (!reserved)
      return {
        cleaned: false,
        retained: true,
        reason: "cleanup-race",
        retryable: true,
      };
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
    await firestore.runTransaction(async (transaction) => {
      const [rootAfter, publicAfter, lockAfter] = await Promise.all([
        transaction.get(firestore.doc(resourcePaths.scorebook)),
        transaction.get(firestore.doc(resourcePaths.publicState)),
        transaction.get(firestore.doc(resourcePaths.cleanupLock)),
      ]);
      const lock = snapshotData(lockAfter);
      if (
        snapshotData(rootAfter) ||
        snapshotData(publicAfter) ||
        lock?.generation !== generation
      ) {
        throw makeError(
          "unavailable",
          "Diamond cleanup completion could not be verified.",
        );
      }
      transaction.set(firestore.doc(resourcePaths.cleanupLock), {
        schemaVersion: 1,
        generation,
        status: "complete",
        complete: true,
        updatedAt: timestampIso(nowMs),
        completedAt: timestampIso(nowMs),
      });
    });
    return {
      cleaned: true,
      retained: false,
      reason: "cleanup-complete",
      generation,
    };
  }

  return {
    configureDiamondTeam,
    getDiamondAccess,
    activateDiamondGame,
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
  createDiamondScorebookHandlers,
  paths,
};
