"use strict";

const nodeCrypto = require("node:crypto");
const privateNoteCore = require("./diamond-private-note-core.cjs");

const DIAMOND_ENGINE = "diamond-v2";
const EVENT_PAGE_SIZE = 200;
const MAX_CANONICAL_EVENTS = 20_000;
const MAX_REPLAY_PAGES = 200;
const MAX_PLAYER_DOCUMENTS = 100;
const MAX_EFFECT_DOCUMENTS = 20_000;
const DEFAULT_BATCH_WRITE_LIMIT = 400;
const MAX_FINAL_TRANSACTION_WRITES = 450;
const DEFAULT_LEASE_MILLIS = 5 * 60 * 1000;
const DIAMOND_PRIVATE_NOTE_STORAGE_VERSION = 1;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class DiamondProjectorError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "DiamondProjectorError";
    this.code = code;
    this.retryable = options.retryable === true;
    this.details = options.details;
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

function compactText(value, maximum = 256) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}

function exactBoundedString(value, maximum = 512) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : "";
}

function timestampIso(milliseconds) {
  return new Date(milliseconds).toISOString();
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
    throw new DiamondProjectorError(
      "clock-unavailable",
      "Server time is unavailable for the Diamond projection lease.",
      { retryable: true },
    );
  }
  return value;
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
    throw new DiamondProjectorError(
      "randomness-unavailable",
      "Secure randomness is unavailable for the Diamond projection lease.",
      { retryable: true },
    );
  }
  return value.toLowerCase();
}

function projectorPaths(teamId, gameId) {
  const game = `teams/${teamId}/games/${gameId}`;
  const scorebook = `${game}/diamondScorebooks/v2`;
  const replay = `${game}/diamondPublic/replay`;
  return {
    team: `teams/${teamId}`,
    game,
    scorebook,
    events: `${scorebook}/events`,
    notes: `${scorebook}/notes`,
    run: (projectionKey) => `${scorebook}/projectionRuns/${projectionKey}`,
    effects: `${scorebook}/effects`,
    effect: (effectId) => `${scorebook}/effects/${effectId}`,
    privateCurrent: `${scorebook}/projections/current`,
    statsProjection: `${scorebook}/projections/stats`,
    publicCurrent: `${game}/diamondPublic/state`,
    replayManifest: replay,
    replayPages: `${replay}/pages`,
    replayPage: (pageId) => `${replay}/pages/${pageId}`,
    statGeneration: (instanceId) =>
      `${game}/diamondStatGenerations/${instanceId}`,
    publicPlayerStats: (instanceId) =>
      `${game}/diamondStatGenerations/${instanceId}/publicPlayerStats`,
    publicPlayerStat: (instanceId, playerId) =>
      `${game}/diamondStatGenerations/${instanceId}/publicPlayerStats/${playerId}`,
    privatePlayerStats: (instanceId) =>
      `${game}/diamondStatGenerations/${instanceId}/privatePlayerStats`,
    privatePlayerStat: (instanceId, playerId) =>
      `${game}/diamondStatGenerations/${instanceId}/privatePlayerStats/${playerId}`,
    teamStats: (instanceId) =>
      `${game}/diamondStatGenerations/${instanceId}/teamStats`,
    teamStat: (instanceId, statId = "team") =>
      `${game}/diamondStatGenerations/${instanceId}/teamStats/${statId}`,
    players: `teams/${teamId}/players`,
  };
}

function privateNotePrivacyRevision(root) {
  if (
    root?.privateNoteStorageVersion !== DIAMOND_PRIVATE_NOTE_STORAGE_VERSION ||
    !Number.isSafeInteger(root?.privateNotePrivacyRevision) ||
    root.privateNotePrivacyRevision < 0
  ) {
    throw new DiamondProjectorError(
      "private-note-storage-invalid",
      "The Diamond private-note storage state requires migration.",
      { retryable: false },
    );
  }
  return root.privateNotePrivacyRevision;
}

function markerForRoot(root) {
  const marker = root?.diamondProjectionMarker;
  if (!isPlainObject(marker) || marker.status !== "current") return null;
  if (
    typeof marker.instanceId !== "string" ||
    !Number.isSafeInteger(marker.sourceRevision) ||
    marker.sourceRevision < 0 ||
    typeof marker.checkpointHash !== "string" ||
    typeof marker.projectionHash !== "string" ||
    typeof marker.projectionKey !== "string" ||
    !Number.isSafeInteger(marker.privateNotePrivacyRevision) ||
    marker.privateNotePrivacyRevision < 0 ||
    typeof marker.statConfigSnapshotHash !== "string" ||
    typeof marker.orientationSnapshotHash !== "string"
  ) {
    return null;
  }
  return marker;
}

function markerMatches(
  marker,
  instanceId,
  sourceRevision,
  checkpointHash,
  statConfigSnapshotHash,
  orientationSnapshotHash,
  privacyRevision,
) {
  return Boolean(
    marker &&
    marker.instanceId === instanceId &&
    marker.sourceRevision === sourceRevision &&
    marker.checkpointHash === checkpointHash &&
    marker.statConfigSnapshotHash === statConfigSnapshotHash &&
    marker.orientationSnapshotHash === orientationSnapshotHash &&
    marker.privateNotePrivacyRevision === privacyRevision,
  );
}

function checkpointForRoot(root, teamId, gameId) {
  const checkpoint = root?.checkpoint;
  if (
    !isPlainObject(checkpoint) ||
    !isPlainObject(checkpoint.state) ||
    !Number.isSafeInteger(checkpoint.sequence) ||
    checkpoint.sequence < 0 ||
    checkpoint.state.revision !== checkpoint.sequence ||
    typeof checkpoint.previousHash !== "string" ||
    checkpoint.state.checkpointHash !== checkpoint.previousHash ||
    checkpoint.teamId !== teamId ||
    checkpoint.gameId !== gameId ||
    checkpoint.rulesProfileId !== root.rulesProfileId ||
    checkpoint.rulesProfileVersion !== root.rulesProfileVersion ||
    checkpoint.captureMode !== root.captureMode
  ) {
    throw new DiamondProjectorError(
      "invalid-checkpoint",
      "The Diamond checkpoint is malformed or does not match its scorebook.",
      { retryable: false },
    );
  }
  if (checkpoint.sequence > MAX_CANONICAL_EVENTS) {
    throw new DiamondProjectorError(
      "ledger-too-large",
      `Diamond projection is bounded to ${String(MAX_CANONICAL_EVENTS)} canonical events.`,
      { retryable: false },
    );
  }
  return checkpoint;
}

function generationFromDocument(value) {
  if (!isPlainObject(value)) return "";
  return compactText(
    value.diamondScorebookInstanceId ||
      value.projectionGeneration ||
      value.instanceId ||
      value.diamondProjectionMarker?.instanceId,
    128,
  );
}

function isOwnedDocument(value, { teamId, gameId, instanceId }) {
  if (!isPlainObject(value) || value.trackingEngine !== DIAMOND_ENGINE)
    return false;
  if (generationFromDocument(value) !== instanceId) return false;
  const storedTeamId = compactText(value.teamId, 128);
  const storedGameId = compactText(value.diamondGameId || value.gameId, 128);
  return (
    (!storedTeamId || storedTeamId === teamId) &&
    (!storedGameId || storedGameId === gameId)
  );
}

function isRootOwned(root, game, { teamId, gameId, instanceId }) {
  return Boolean(
    isPlainObject(root) &&
    root.trackingEngine === DIAMOND_ENGINE &&
    root.teamId === teamId &&
    root.gameId === gameId &&
    root.instanceId === instanceId &&
    isPlainObject(game) &&
    game.trackingEngine === DIAMOND_ENGINE &&
    game.diamondScorebookInstanceId === instanceId,
  );
}

function normalizeProjectionKey(core, identity) {
  const digest = core.hashDiamondValue(identity);
  if (typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(digest)) {
    throw new DiamondProjectorError(
      "hash-unavailable",
      "The projection identity could not be hashed.",
    );
  }
  return `projection-${digest.slice("sha256:".length)}`;
}

function queryWithUpperRevision(
  firestore,
  collectionPath,
  afterSequence,
  throughSequence,
) {
  return firestore
    .collection(collectionPath)
    .where("sequence", ">", afterSequence)
    .where("sequence", "<=", throughSequence)
    .orderBy("sequence", "asc")
    .limit(EVENT_PAGE_SIZE);
}

function documentMap(documents) {
  return new Map(
    documents.map((snapshot) => [snapshot.id, snapshotData(snapshot)]),
  );
}

function normalizePlayerIdentity(value) {
  if (!isPlainObject(value)) return null;
  const playerId = exactBoundedString(value.playerId || value.id, 128);
  if (!playerId || playerId.includes("/")) return null;
  return {
    playerId,
    playerName: compactText(
      value.playerName || value.displayName || value.name,
      100,
    ),
    playerNumber: compactText(
      value.playerNumber || value.jerseyNumber || value.number,
      24,
    ),
  };
}

function buildPlayerDirectoryBySide(
  root,
  rosterDocuments,
  orientationSnapshot,
) {
  const directories = {
    home: Object.create(null),
    away: Object.create(null),
  };
  const add = (side, candidate) => {
    const player = normalizePlayerIdentity(candidate);
    if (!player) return;
    directories[side][player.playerId] = {
      playerName: player.playerName,
      playerNumber: player.playerNumber,
    };
  };
  for (const side of ["home", "away"]) {
    const candidates = root?.availablePlayers?.[side];
    if (Array.isArray(candidates))
      candidates
        .slice(0, MAX_PLAYER_DOCUMENTS)
        .forEach((candidate) => add(side, candidate));
  }
  const managedSide = orientationSnapshot.managedSide;
  rosterDocuments.forEach((snapshot) =>
    add(managedSide, { id: snapshot.id, ...snapshotData(snapshot) }),
  );
  return {
    home: Object.fromEntries(Object.entries(directories.home)),
    away: Object.fromEntries(Object.entries(directories.away)),
  };
}

function hasExactDiamondSharedGameClaim(shared, teamId, gameId) {
  return Boolean(
    isPlainObject(shared) &&
    shared.trackingEngine === DIAMOND_ENGINE &&
    own(shared, "diamondSourceTeamId") &&
    shared.diamondSourceTeamId === teamId &&
    own(shared, "diamondSourceGameId") &&
    shared.diamondSourceGameId === gameId,
  );
}

function hasDiamondSharedGameClaimMarkers(shared) {
  return Boolean(
    isPlainObject(shared) &&
    (shared.trackingEngine === DIAMOND_ENGINE ||
      own(shared, "diamondSourceTeamId") ||
      own(shared, "diamondSourceGameId")),
  );
}

function hasConflictingDiamondSharedGameClaim(shared, teamId, gameId) {
  return (
    hasDiamondSharedGameClaimMarkers(shared) &&
    !hasExactDiamondSharedGameClaim(shared, teamId, gameId)
  );
}

function hasTeamScopedSharedGameBinding(shared, teamId, gameId) {
  if (!isPlainObject(shared)) return false;
  if (hasExactDiamondSharedGameClaim(shared, teamId, gameId)) return true;
  if (hasDiamondSharedGameClaimMarkers(shared)) return false;
  const mappedGameId =
    isPlainObject(shared.teamGameIds) && own(shared.teamGameIds, teamId)
      ? shared.teamGameIds[teamId]
      : null;
  return Boolean(
    mappedGameId === gameId ||
    (shared.homeTeamId === teamId && shared.homeGameId === gameId) ||
    (shared.awayTeamId === teamId && shared.awayGameId === gameId) ||
    (shared.sourceTeamId === teamId && shared.sourceGameId === gameId),
  );
}

function normalizeSharedResolution(result, firestore, teamId, gameId) {
  if (result === null || result === undefined) return null;
  const data =
    snapshotData(result.snapshot) ||
    snapshotData(result) ||
    (isPlainObject(result.data) ? result.data : null);
  const rawPath = exactBoundedString(
    result.path || result.ref?.path || result.snapshot?.ref?.path,
    512,
  );
  const segments = rawPath.split("/");
  if (
    !data ||
    segments.length !== 4 ||
    !["organizations", "tournaments"].includes(segments[0]) ||
    segments[2] !== "sharedGames" ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new DiamondProjectorError(
      "invalid-shared-game",
      "The shared-game projection target is not a canonical shared-game document.",
      { retryable: false },
    );
  }
  const teamIds = new Set(
    [
      data.homeTeamId,
      data.awayTeamId,
      ...(Array.isArray(data.teamIds) ? data.teamIds : []),
    ].filter((value) => typeof value === "string" && value),
  );
  if (!teamIds.has(teamId)) {
    throw new DiamondProjectorError(
      "invalid-shared-game",
      "The shared game does not authoritatively include this Diamond team.",
      { retryable: false },
    );
  }
  if (hasConflictingDiamondSharedGameClaim(data, teamId, gameId)) {
    throw new DiamondProjectorError(
      "shared-game-owner-conflict",
      "Another scorebook owns the shared-game Diamond projection.",
      { retryable: false },
    );
  }
  if (!hasTeamScopedSharedGameBinding(data, teamId, gameId)) {
    throw new DiamondProjectorError(
      "invalid-shared-game",
      "The shared game is not authoritatively bound to this exact source game.",
      { retryable: false },
    );
  }
  return { path: rawPath, ref: firestore.doc(rawPath), data };
}

function resolveIdsFromTrigger(change, context) {
  const snapshot = change?.after || change;
  const params = context?.params || {};
  let teamId = exactBoundedString(params.teamId, 128);
  let gameId = exactBoundedString(params.gameId, 128);
  const path = exactBoundedString(snapshot?.ref?.path, 512);
  if ((!teamId || !gameId) && path) {
    const segments = path.split("/");
    if (
      segments.length === 6 &&
      segments[0] === "teams" &&
      segments[2] === "games" &&
      segments[4] === "diamondScorebooks" &&
      segments[5] === "v2"
    ) {
      teamId ||= segments[1];
      gameId ||= segments[3];
    }
  }
  return { snapshot, teamId, gameId };
}

function effectTimestamp(ledger, sourceRevision) {
  const event =
    Number.isSafeInteger(sourceRevision) && sourceRevision > 0
      ? ledger.events[sourceRevision - 1]
      : ledger.events.at(-1);
  const milliseconds = event?.serverTimestampMs;
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? timestampIso(milliseconds)
    : null;
}

function createDiamondScorebookProjectorHandlers(dependencies = {}) {
  const firestore = dependencies.firestore;
  const clock = dependencies.clock || (() => Date.now());
  const random = dependencies.random || { randomUUID: nodeCrypto.randomUUID };
  const logger = dependencies.logger || { info() {}, warn() {}, error() {} };
  const core = dependencies.core || require("./diamond-scorebook-core.cjs");
  const statConfig =
    dependencies.statConfig || require("./diamond-stat-config.cjs");
  const domainEngine = dependencies.domainEngine || require("./diamond-engine");
  const projectionAdapter =
    dependencies.projectionAdapter ||
    require("./diamond-scorebook-projections.cjs");
  const batchWriteLimit =
    dependencies.batchWriteLimit || DEFAULT_BATCH_WRITE_LIMIT;
  const leaseMillis = dependencies.leaseMillis || DEFAULT_LEASE_MILLIS;
  const hooks = dependencies.hooks || {};
  const loadClipTimings = dependencies.loadClipTimings || (async () => ({}));
  const resolveSharedGame =
    dependencies.resolveSharedGame || (async () => null);

  if (
    !firestore?.doc ||
    !firestore?.collection ||
    typeof firestore.runTransaction !== "function" ||
    typeof firestore.batch !== "function"
  ) {
    throw new TypeError(
      "A Firestore dependency with documents, queries, transactions, and batches is required.",
    );
  }
  if (
    typeof domainEngine.verifyDiamondLedger !== "function" ||
    typeof projectionAdapter.buildDiamondProjectionBundle !== "function" ||
    typeof projectionAdapter.normalizeDiamondOrientationSnapshot !==
      "function" ||
    typeof core.hashDiamondValue !== "function" ||
    typeof statConfig.validateDiamondStatConfigSnapshot !== "function"
  ) {
    throw new TypeError(
      "Diamond core, domain, and projection adapter dependencies are required.",
    );
  }
  if (
    !Number.isSafeInteger(batchWriteLimit) ||
    batchWriteLimit < 1 ||
    batchWriteLimit > 400
  ) {
    throw new TypeError("batchWriteLimit must be between 1 and 400.");
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

  function normalizeId(value, label) {
    try {
      return core.normalizeDiamondId(value, label);
    } catch (error) {
      throw new DiamondProjectorError("invalid-id", error.message, {
        retryable: false,
      });
    }
  }

  function validatePinnedStatConfig(root, game, teamId) {
    try {
      let configId = root?.statConfigSnapshot?.configId;
      if (game) {
        try {
          configId = core.normalizeDiamondId(
            game.statTrackerConfigId,
            "game.statTrackerConfigId",
          );
        } catch {
          throw new DiamondProjectorError(
            "stat-config-id-invalid",
            "The Diamond game does not select a valid stat config.",
            { retryable: false },
          );
        }
      }
      const snapshot = statConfig.validateDiamondStatConfigSnapshot(
        root?.statConfigSnapshot,
        {
          teamId,
          configId,
          hashValue: core.hashDiamondValue,
        },
      );
      if (
        game &&
        game.diamondStatConfigSnapshotHash !== snapshot.snapshotHash
      ) {
        throw new DiamondProjectorError(
          "stat-config-snapshot-mismatch",
          "The game claim does not match its pinned Diamond stat config.",
          { retryable: false },
        );
      }
      return snapshot;
    } catch (error) {
      if (error instanceof DiamondProjectorError) throw error;
      throw new DiamondProjectorError(
        error?.code || "stat-config-snapshot-invalid",
        "The Diamond stat config snapshot is missing, malformed, or mismatched.",
        {
          retryable: false,
          details: { causeCode: error?.code || "validation-failed" },
        },
      );
    }
  }

  function validatePinnedOrientation(root, teamId) {
    try {
      const snapshot = projectionAdapter.normalizeDiamondOrientationSnapshot(
        root?.orientationSnapshot,
        teamId,
      );
      const snapshotHash = core.hashDiamondValue(snapshot);
      if (
        typeof snapshotHash !== "string" ||
        !/^sha256:[a-f0-9]{64}$/.test(snapshotHash)
      ) {
        throw new DiamondProjectorError(
          "orientation-snapshot-hash-invalid",
          "The immutable Diamond orientation snapshot could not be hashed.",
          { retryable: false },
        );
      }
      return { snapshot, snapshotHash };
    } catch (error) {
      if (error instanceof DiamondProjectorError) throw error;
      throw new DiamondProjectorError(
        error?.code || "orientation-snapshot-invalid",
        "The immutable Diamond orientation snapshot is missing, malformed, or mismatched.",
        {
          retryable: false,
          details: { causeCode: error?.code || "validation-failed" },
        },
      );
    }
  }

  function stillHasPinnedStatConfig(root, acquired, game = null) {
    try {
      const snapshot = validatePinnedStatConfig(
        root,
        game,
        acquired.root.teamId,
      );
      return (
        snapshot.configId === acquired.statConfigSnapshot.configId &&
        snapshot.snapshotHash === acquired.statConfigSnapshot.snapshotHash
      );
    } catch {
      return false;
    }
  }

  function stillHasPinnedOrientation(root, acquired) {
    try {
      const orientation = validatePinnedOrientation(root, acquired.root.teamId);
      return orientation.snapshotHash === acquired.orientationSnapshotHash;
    } catch {
      return false;
    }
  }

  function stillHasPrivateNotePrivacyState(root, acquired) {
    try {
      return (
        privateNotePrivacyRevision(root) === acquired.privateNotePrivacyRevision
      );
    } catch {
      return false;
    }
  }

  async function transactionGetAll(transaction, references) {
    if (!references.length) return [];
    if (typeof transaction.getAll === "function")
      return transaction.getAll(...references);
    return Promise.all(
      references.map((reference) => transaction.get(reference)),
    );
  }

  async function readBoundedCollection(
    collectionPath,
    maximum,
    buildQuery = null,
  ) {
    let snapshot;
    try {
      const base = firestore.collection(collectionPath);
      const query = buildQuery ? buildQuery(base) : base.limit(maximum + 1);
      snapshot = await query.get();
    } catch (error) {
      throw new DiamondProjectorError(
        "projection-input-unavailable",
        `A bounded Diamond projection input could not be read: ${collectionPath}.`,
        {
          retryable: true,
          details: { causeCode: error?.code || "read-failed" },
        },
      );
    }
    const documents = snapshotDocuments(snapshot);
    if (documents.length > maximum) {
      throw new DiamondProjectorError(
        "projection-input-too-large",
        `A Diamond projection input exceeds its ${String(maximum)} document bound: ${collectionPath}.`,
        { retryable: false },
      );
    }
    return documents;
  }

  async function loadCanonicalLedger({
    root,
    teamId,
    gameId,
    instanceId,
    checkpoint,
  }) {
    const resourcePaths = projectorPaths(teamId, gameId);
    const events = [];
    let afterSequence = 0;
    while (afterSequence < checkpoint.sequence) {
      let snapshot;
      try {
        snapshot = await queryWithUpperRevision(
          firestore,
          resourcePaths.events,
          afterSequence,
          checkpoint.sequence,
        ).get();
      } catch (error) {
        throw new DiamondProjectorError(
          "ledger-read-failed",
          "The complete Diamond ledger could not be read.",
          {
            retryable: true,
            details: { causeCode: error?.code || "read-failed" },
          },
        );
      }
      const documents = snapshotDocuments(snapshot);
      if (!documents.length) {
        throw new DiamondProjectorError(
          "ledger-incomplete",
          "The canonical Diamond ledger is incomplete.",
          { retryable: true },
        );
      }
      for (const document of documents) {
        const event = snapshotData(document);
        const expected = events.length + 1;
        if (
          !event ||
          event.sequence !== expected ||
          event.revision !== expected ||
          event.instanceId !== instanceId
        ) {
          throw new DiamondProjectorError(
            "ledger-gap",
            "The canonical Diamond ledger contains a gap or another generation.",
            { retryable: false },
          );
        }
        events.push(event);
        afterSequence = event.sequence;
      }
      if (events.length > MAX_CANONICAL_EVENTS) {
        throw new DiamondProjectorError(
          "ledger-too-large",
          "The canonical Diamond ledger exceeds its bound.",
        );
      }
    }
    if (events.length !== checkpoint.sequence) {
      throw new DiamondProjectorError(
        "ledger-incomplete",
        "The canonical Diamond ledger is incomplete.",
        {
          retryable: true,
        },
      );
    }
    const ledger = {
      teamId,
      gameId,
      rulesProfileId: root.rulesProfileId,
      rulesProfileVersion: root.rulesProfileVersion,
      captureMode: root.captureMode,
      initialState: root.initialState,
      state: checkpoint.state,
      events,
    };
    try {
      domainEngine.verifyDiamondLedger(ledger);
    } catch (error) {
      if (error?.code === "history-required") {
        throw new DiamondProjectorError(
          "projection-input-invalid",
          "The canonical Diamond ledger is missing required player identity history.",
          {
            retryable: false,
            details: { causeCode: error.code },
          },
        );
      }
      throw new DiamondProjectorError(
        "ledger-integrity-failed",
        "The canonical Diamond ledger failed sequence, hash, or checkpoint verification.",
        {
          retryable: false,
          details: { causeCode: error?.code || "verification-failed" },
        },
      );
    }
    return ledger;
  }

  async function acquireProjectionLease({
    teamId,
    gameId,
    expectedInstanceId,
    expectedSourceRevision,
    expectedCheckpointHash,
  }) {
    const resourcePaths = projectorPaths(teamId, gameId);
    let cachedNow = null;
    let cachedLeaseId = null;
    const getNow = () =>
      cachedNow === null ? (cachedNow = normalizeNow(clock)) : cachedNow;
    const getLeaseId = () =>
      cachedLeaseId === null
        ? (cachedLeaseId = secureUuid(random))
        : cachedLeaseId;
    return firestore.runTransaction(async (transaction) => {
      const [rootSnapshot, gameSnapshot] = await transactionGetAll(
        transaction,
        [
          firestore.doc(resourcePaths.scorebook),
          firestore.doc(resourcePaths.game),
        ],
      );
      const root = snapshotData(rootSnapshot);
      const game = snapshotData(gameSnapshot);
      if (!root || !game)
        return { acquired: false, reason: "missing-scorebook" };
      const instanceId = normalizeId(root.instanceId, "instanceId");
      if (!isRootOwned(root, game, { teamId, gameId, instanceId })) {
        return { acquired: false, reason: "not-diamond-owned" };
      }
      const privacyRevision = privateNotePrivacyRevision(root);
      const checkpoint = checkpointForRoot(root, teamId, gameId);
      if (
        (expectedInstanceId && expectedInstanceId !== instanceId) ||
        (Number.isSafeInteger(expectedSourceRevision) &&
          expectedSourceRevision !== checkpoint.sequence) ||
        (typeof expectedCheckpointHash === "string" &&
          expectedCheckpointHash !== checkpoint.previousHash)
      ) {
        return {
          acquired: false,
          reason: "stale-trigger",
          authoritativeRevision: checkpoint.sequence,
        };
      }
      let statConfigSnapshot;
      try {
        statConfigSnapshot = validatePinnedStatConfig(root, game, teamId);
      } catch (error) {
        transaction.update(firestore.doc(resourcePaths.scorebook), {
          projectionStatus: "failed",
          projectionLease: null,
          projectionFailure: {
            code: compactText(
              error?.code || "stat-config-snapshot-invalid",
              80,
            ),
            retryable: false,
            sourceRevision: checkpoint.sequence,
          },
        });
        return {
          acquired: false,
          reason: "stat-config-invalid",
          errorCode: error?.code || "stat-config-snapshot-invalid",
          errorMessage: error?.message,
        };
      }
      let orientation;
      try {
        orientation = validatePinnedOrientation(root, teamId);
      } catch (error) {
        transaction.update(firestore.doc(resourcePaths.scorebook), {
          projectionStatus: "failed",
          projectionLease: null,
          projectionFailure: {
            code: compactText(
              error?.code || "orientation-snapshot-invalid",
              80,
            ),
            retryable: false,
            sourceRevision: checkpoint.sequence,
          },
        });
        return {
          acquired: false,
          reason: "orientation-invalid",
          errorCode: error?.code || "orientation-snapshot-invalid",
          errorMessage: error?.message,
        };
      }
      const existingMarker = markerForRoot(root);
      if (
        root.projectionStatus !== "pending" &&
        markerMatches(
          existingMarker,
          instanceId,
          checkpoint.sequence,
          checkpoint.previousHash,
          statConfigSnapshot.snapshotHash,
          orientation.snapshotHash,
          privacyRevision,
        )
      ) {
        return {
          acquired: false,
          reason: "already-current",
          sourceRevision: checkpoint.sequence,
          projectionHash: existingMarker.projectionHash,
        };
      }
      if (root.projectionStatus !== "pending") {
        return {
          acquired: false,
          reason: "projection-not-pending",
          sourceRevision: checkpoint.sequence,
        };
      }
      const nowMs = getNow();
      const existingLease = root.projectionLease;
      if (
        isPlainObject(existingLease) &&
        typeof existingLease.leaseId === "string" &&
        Number.isSafeInteger(existingLease.expiresAtMs) &&
        existingLease.expiresAtMs > nowMs
      ) {
        return {
          acquired: false,
          reason: "lease-active",
          sourceRevision: checkpoint.sequence,
          retryable: true,
        };
      }
      const projectionKey = normalizeProjectionKey(core, {
        trackingEngine: DIAMOND_ENGINE,
        teamId,
        gameId,
        instanceId,
        sourceRevision: checkpoint.sequence,
        checkpointHash: checkpoint.previousHash,
        statConfigSnapshotHash: statConfigSnapshot.snapshotHash,
        orientationSnapshotHash: orientation.snapshotHash,
        privateNotePrivacyRevision: privacyRevision,
      });
      const lease = {
        schemaVersion: 1,
        trackingEngine: DIAMOND_ENGINE,
        leaseId: getLeaseId(),
        instanceId,
        sourceRevision: checkpoint.sequence,
        checkpointHash: checkpoint.previousHash,
        statConfigSnapshotHash: statConfigSnapshot.snapshotHash,
        orientationSnapshotHash: orientation.snapshotHash,
        privateNotePrivacyRevision: privacyRevision,
        projectionKey,
        acquiredAtMs: nowMs,
        expiresAtMs: nowMs + leaseMillis,
      };
      transaction.update(firestore.doc(resourcePaths.scorebook), {
        projectionStatus: "pending",
        projectionLease: lease,
        projectionFailure: null,
      });
      return {
        acquired: true,
        teamId,
        gameId,
        root,
        game,
        checkpoint,
        statConfigSnapshot,
        orientationSnapshot: orientation.snapshot,
        orientationSnapshotHash: orientation.snapshotHash,
        privateNotePrivacyRevision: privacyRevision,
        instanceId,
        projectionKey,
        lease,
        previousMarker:
          existingMarker &&
          existingMarker.instanceId === instanceId &&
          existingMarker.statConfigSnapshotHash ===
            statConfigSnapshot.snapshotHash &&
          existingMarker.orientationSnapshotHash === orientation.snapshotHash &&
          existingMarker.sourceRevision <= checkpoint.sequence
            ? existingMarker
            : null,
      };
    });
  }

  async function releaseProjectionLease(acquired, error) {
    const { root, lease, instanceId } = acquired;
    const teamId = root.teamId;
    const gameId = root.gameId;
    const resourcePaths = projectorPaths(teamId, gameId);
    try {
      await firestore.runTransaction(async (transaction) => {
        const rootRef = firestore.doc(resourcePaths.scorebook);
        const current = snapshotData(await transaction.get(rootRef));
        if (
          !current ||
          current.instanceId !== instanceId ||
          current.projectionLease?.leaseId !== lease.leaseId ||
          !stillHasPrivateNotePrivacyState(current, acquired)
        ) {
          return;
        }
        transaction.update(rootRef, {
          projectionStatus: error?.retryable === false ? "failed" : "pending",
          projectionLease: null,
          projectionFailure: {
            code: compactText(error?.code || "projection-failed", 80),
            retryable: error?.retryable !== false,
            sourceRevision: lease.sourceRevision,
            projectionKey: lease.projectionKey,
          },
        });
      });
    } catch (releaseError) {
      logger.error?.("diamond_projection_lease_release_failed", {
        sourceRevision: lease.sourceRevision,
        code: releaseError?.code || "release-failed",
      });
    }
  }

  async function loadProjectionInputs(acquired, ledger) {
    const { root, game, instanceId, previousMarker } = acquired;
    const { teamId, gameId } = root;
    const resourcePaths = projectorPaths(teamId, gameId);
    const previousEffectRevision = previousMarker?.sourceRevision || 0;
    const [
      teamSnapshot,
      replayPageDocuments,
      publicPlayerDocuments,
      privatePlayerDocuments,
      teamStatDocuments,
      effectDocuments,
      rosterDocuments,
      privateNoteDocuments,
      clipTimings,
      sharedResult,
    ] = await Promise.all([
      firestore.doc(resourcePaths.team).get(),
      readBoundedCollection(resourcePaths.replayPages, MAX_REPLAY_PAGES),
      readBoundedCollection(
        resourcePaths.publicPlayerStats(instanceId),
        MAX_PLAYER_DOCUMENTS,
      ),
      readBoundedCollection(
        resourcePaths.privatePlayerStats(instanceId),
        MAX_PLAYER_DOCUMENTS,
      ),
      readBoundedCollection(resourcePaths.teamStats(instanceId), 10),
      readBoundedCollection(
        resourcePaths.effects,
        MAX_EFFECT_DOCUMENTS,
        (query) =>
          query
            .where("sourceRevision", ">", previousEffectRevision)
            .limit(MAX_EFFECT_DOCUMENTS + 1),
      ),
      readBoundedCollection(resourcePaths.players, MAX_PLAYER_DOCUMENTS),
      readBoundedCollection(resourcePaths.notes, MAX_CANONICAL_EVENTS),
      loadClipTimings({ firestore, teamId, gameId, root, game, ledger }),
      resolveSharedGame({ firestore, teamId, gameId, root, game }),
    ]);
    const team = snapshotData(teamSnapshot);
    if (!team) {
      throw new DiamondProjectorError(
        "team-missing",
        "The Diamond team's projection source is unavailable.",
        {
          retryable: true,
        },
      );
    }
    if (!isPlainObject(clipTimings)) {
      throw new DiamondProjectorError(
        "invalid-clip-timings",
        "Clip timing projection input is malformed.",
      );
    }
    const sharedGame = normalizeSharedResolution(
      sharedResult,
      firestore,
      teamId,
      gameId,
    );
    const identity = { teamId, gameId, instanceId };
    const ownedIds = (documents) =>
      documents
        .filter((snapshot) => isOwnedDocument(snapshotData(snapshot), identity))
        .map((snapshot) => snapshot.id);
    return {
      team,
      orientationSnapshot: acquired.orientationSnapshot,
      playerDirectoryBySide: buildPlayerDirectoryBySide(
        root,
        rosterDocuments,
        acquired.orientationSnapshot,
      ),
      sharedGame,
      clipTimings,
      privateNoteDocuments: privateNoteDocuments.map((snapshot) => ({
        id: snapshot.id,
        path: snapshot.ref?.path || null,
        data: snapshotData(snapshot),
      })),
      publicPlayerStatIds: [...acquired.statConfigSnapshot.publicPlayerStatIds],
      publicTeamStatIds: [...acquired.statConfigSnapshot.publicTeamStatIds],
      existingReplayPageIds: ownedIds(replayPageDocuments),
      existingPublicPlayerIds: ownedIds(publicPlayerDocuments),
      existingPrivatePlayerIds: ownedIds(privatePlayerDocuments),
      documents: {
        replayPages: documentMap(replayPageDocuments),
        publicPlayerStats: documentMap(publicPlayerDocuments),
        privatePlayerStats: documentMap(privatePlayerDocuments),
        teamStats: documentMap(teamStatDocuments),
        effects: documentMap(effectDocuments),
      },
      previousEffectRevision,
    };
  }

  function assertBundleContract(bundle, acquired) {
    if (
      !isPlainObject(bundle) ||
      bundle.complete !== true ||
      bundle.trackingEngine !== DIAMOND_ENGINE ||
      bundle.instanceId !== acquired.instanceId ||
      bundle.effects?.instanceId !== acquired.instanceId ||
      bundle.sourceRevision !== acquired.checkpoint.sequence ||
      bundle.checkpointHash !== acquired.checkpoint.previousHash ||
      bundle.writes?.privateCurrent?.relativePath !==
        "diamondScorebooks/v2/projections/current" ||
      bundle.writes?.publicCurrent?.relativePath !== "diamondPublic/state" ||
      bundle.writes?.publicReplayManifest?.relativePath !==
        "diamondPublic/replay" ||
      !Array.isArray(bundle.writes?.publicReplayPages) ||
      !Array.isArray(bundle.writes?.publicPlayerStats) ||
      !Array.isArray(bundle.writes?.privatePlayerStats) ||
      !isPlainObject(bundle.writes?.gameUpdate?.diamondPublicTeamStats)
    ) {
      throw new DiamondProjectorError(
        "invalid-projection-bundle",
        "The Diamond projection adapter returned a mismatched or incomplete bundle.",
        { retryable: false },
      );
    }
    for (const page of bundle.writes.publicReplayPages) {
      if (
        page.relativePath !== `diamondPublic/replay/pages/${page.pageId}` ||
        !isPlainObject(page.data)
      ) {
        throw new DiamondProjectorError(
          "invalid-projection-bundle",
          "A replay page target is malformed.",
        );
      }
    }
  }

  function projectionDigestPayload(
    bundle,
    projectionKey,
    statConfigSnapshotHash,
  ) {
    const privateCurrent = bundle.writes.privateCurrent;
    const privacyNeutralPrivateCurrent = {
      relativePath: privateCurrent.relativePath,
      data: {
        schemaVersion: privateCurrent.data.schemaVersion,
        trackingEngine: privateCurrent.data.trackingEngine,
        teamId: privateCurrent.data.teamId,
        gameId: privateCurrent.data.gameId,
        sourceRevision: privateCurrent.data.sourceRevision,
        checkpointHash: privateCurrent.data.checkpointHash,
        canonicalEventCount: privateCurrent.data.canonicalEventCount,
        publicPlayCount: privateCurrent.data.publicPlayCount,
        correctionCount: privateCurrent.data.correctionCount,
        privateNoteCount: privateCurrent.data.privateNoteCount,
        privateNotesComplete: privateCurrent.data.privateNotesComplete,
        privateNotesTruncated: privateCurrent.data.privateNotesTruncated,
        privateNotesWindowStartRevision:
          privateCurrent.data.privateNotesWindowStartRevision,
        privateNotes: (privateCurrent.data.privateNotes || []).map((note) => ({
          eventId: note.eventId,
          sourceEventId: note.sourceEventId,
          revision: note.revision,
          attachedEventId: note.attachedEventId || null,
          visibility: note.visibility,
          corrected: note.corrected,
          serverTimestampMs: note.serverTimestampMs,
        })),
        authoritative: privateCurrent.data.authoritative,
        complete: privateCurrent.data.complete,
      },
    };
    return {
      schemaVersion: 1,
      projectionKey,
      trackingEngine: bundle.trackingEngine,
      sourceRevision: bundle.sourceRevision,
      checkpointHash: bundle.checkpointHash,
      statConfigSnapshotHash,
      writes: {
        privateCurrent: privacyNeutralPrivateCurrent,
        publicCurrent: bundle.writes.publicCurrent,
        publicReplayManifest: bundle.writes.publicReplayManifest,
        publicReplayPages: bundle.writes.publicReplayPages,
        publicPlayerStats: bundle.writes.publicPlayerStats,
        privatePlayerStats: bundle.writes.privatePlayerStats,
        teamStats: bundle.writes.teamStats,
        gameUpdate: bundle.writes.gameUpdate,
        sharedGameUpdate: bundle.writes.sharedGameUpdate,
        aiArtifactPatches: bundle.writes.aiArtifactPatches,
        diamondAiState: bundle.writes.diamondAiState,
      },
      publicPlays: bundle.publicPlays,
      statsProjection: bundle.statsProjection,
      aiStaleness: bundle.aiStaleness,
      sharedGameOutcome: bundle.sharedGameOutcome,
    };
  }

  function effectPlanEvidence(bundle) {
    const effects = bundle.effects || {};
    const suppressed = Array.isArray(effects.suppressed)
      ? effects.suppressed
      : [];
    const suppressedByReason = Object.create(null);
    for (const entry of suppressed) {
      const key = `${compactText(entry.kind, 40) || "unknown"}:${compactText(entry.reason, 80) || "unknown"}`;
      suppressedByReason[key] = (suppressedByReason[key] || 0) + 1;
    }
    const evidence = {
      evaluatedThroughRevision: effects.evaluatedThroughRevision,
      notificationCount: effects.notifications?.length || 0,
      clipLinkCount: effects.clipLinks?.length || 0,
      clipInvalidationCount: effects.clipInvalidations?.length || 0,
      suppressedCount: suppressed.length,
      suppressedByReason: Object.fromEntries(
        Object.entries(suppressedByReason).sort(),
      ),
      planHash: core.hashDiamondValue(effects),
      suppressedHash: core.hashDiamondValue(suppressed),
    };
    return evidence;
  }

  function outboxRecords(bundle, acquired, ledger) {
    const records = [];
    const add = (kind, effectId, dedupKey, sourceRevision, payload) => {
      const stableEffectId = normalizeId(effectId, "effectId");
      const id = normalizeId(
        `${stableEffectId}--${acquired.projectionKey.slice("projection-".length)}`,
        "projection effect document ID",
      );
      const activationRunPath = projectorPaths(
        acquired.root.teamId,
        acquired.root.gameId,
      ).run(acquired.projectionKey);
      const data = {
        schemaVersion: 1,
        trackingEngine: DIAMOND_ENGINE,
        teamId: acquired.root.teamId,
        diamondGameId: acquired.root.gameId,
        instanceId: acquired.instanceId,
        diamondScorebookInstanceId: acquired.instanceId,
        projectionGeneration: acquired.instanceId,
        projectionKey: acquired.projectionKey,
        effectId: stableEffectId,
        sourceRevision,
        checkpointHash: acquired.checkpoint.previousHash,
        kind,
        dedupKey,
        status: "pending",
        requiresProjectionMarker: true,
        activationRunPath,
        payload,
        createdAt: effectTimestamp(ledger, sourceRevision),
      };
      data.payloadHash = core.hashDiamondValue(data);
      records.push({ id, data });
    };
    for (const effect of bundle.effects?.notifications || []) {
      add(
        "notification",
        effect.effectId,
        effect.dedupKey,
        effect.sourceRevision,
        effect,
      );
    }
    for (const effect of bundle.effects?.clipLinks || []) {
      add(
        "clip-link",
        effect.effectId,
        effect.dedupKey,
        effect.sourceRevision,
        effect,
      );
    }
    for (const effect of bundle.effects?.clipInvalidations || []) {
      add(
        "clip-invalidation",
        effect.effectId,
        effect.dedupKey,
        effect.sourceRevision,
        effect,
      );
    }
    if (bundle.aiStaleness?.required === true) {
      const revision = bundle.aiStaleness.latestCorrectionRevision;
      add(
        "ai-stale",
        `ai-stale-r${String(revision).padStart(10, "0")}`,
        `${DIAMOND_ENGINE}:${acquired.root.teamId}:${acquired.root.gameId}:instance:${acquired.instanceId}:ai-stale:r${String(revision).padStart(10, "0")}`,
        revision,
        {
          staleAtRevision: revision,
          affectedSourcePlayIds: bundle.aiStaleness.affectedSourcePlayIds,
          artifactFields: Object.keys(
            bundle.writes.aiArtifactPatches || {},
          ).sort(),
        },
      );
    }
    if (bundle.sharedGameOutcome && acquired.sharedGamePath) {
      const revision = bundle.sourceRevision;
      add(
        "shared-game",
        `shared-game-r${String(revision).padStart(10, "0")}`,
        `${DIAMOND_ENGINE}:${acquired.root.teamId}:${acquired.root.gameId}:instance:${acquired.instanceId}:shared-game:r${String(revision).padStart(10, "0")}`,
        revision,
        {
          sharedGamePath: acquired.sharedGamePath,
          outcome: bundle.sharedGameOutcome.outcome,
        },
      );
    }
    return records.sort((left, right) => left.id.localeCompare(right.id));
  }

  async function initializeRun(
    acquired,
    bundle,
    projectionHash,
    effectCount,
    effectEvidence,
  ) {
    const resourcePaths = projectorPaths(
      acquired.root.teamId,
      acquired.root.gameId,
    );
    const runRef = firestore.doc(resourcePaths.run(acquired.projectionKey));
    const createdAt = effectTimestamp(
      { events: acquired.events || [] },
      acquired.checkpoint.sequence,
    );
    await firestore.runTransaction(async (transaction) => {
      const [rootSnapshot, runSnapshot] = await transactionGetAll(transaction, [
        firestore.doc(resourcePaths.scorebook),
        runRef,
      ]);
      const root = snapshotData(rootSnapshot);
      const existing = snapshotData(runSnapshot);
      if (
        !root ||
        root.instanceId !== acquired.instanceId ||
        root.projectionLease?.leaseId !== acquired.lease.leaseId ||
        !stillHasPrivateNotePrivacyState(root, acquired) ||
        !stillHasPinnedStatConfig(root, acquired) ||
        !stillHasPinnedOrientation(root, acquired)
      ) {
        throw new DiamondProjectorError(
          "projection-lease-lost",
          "The projection lease was replaced.",
          {
            retryable: true,
          },
        );
      }
      if (
        existing &&
        (!isOwnedDocument(existing, {
          teamId: acquired.root.teamId,
          gameId: acquired.root.gameId,
          instanceId: acquired.instanceId,
        }) ||
          existing.projectionHash !== projectionHash ||
          existing.sourceRevision !== acquired.checkpoint.sequence)
      ) {
        throw new DiamondProjectorError(
          "projection-run-conflict",
          "The deterministic projection run ID already has different content.",
          { retryable: false },
        );
      }
      const runData = {
        schemaVersion: 1,
        trackingEngine: DIAMOND_ENGINE,
        teamId: acquired.root.teamId,
        diamondGameId: acquired.root.gameId,
        instanceId: acquired.instanceId,
        diamondScorebookInstanceId: acquired.instanceId,
        projectionGeneration: acquired.instanceId,
        projectionKey: acquired.projectionKey,
        projectionHash,
        sourceRevision: acquired.checkpoint.sequence,
        checkpointHash: acquired.checkpoint.previousHash,
        statConfigSnapshotHash: acquired.statConfigSnapshot.snapshotHash,
        orientationSnapshotHash: acquired.orientationSnapshotHash,
        privateNotePrivacyRevision: acquired.privateNotePrivacyRevision,
        status: "preparing",
        complete: false,
        effectCount,
        effectEvidence,
        replayPageCount: bundle.writes.publicReplayPages.length,
        publicPlayerStatCount: bundle.writes.publicPlayerStats.length,
        privatePlayerCount: bundle.writes.privatePlayerStats.length,
        createdAt,
      };
      if (existing?.complete === true) {
        transaction.update(runRef, {
          status: "preparing",
          complete: false,
          latestRecoveryEffectEvidence: effectEvidence,
        });
      } else {
        transaction.set(runRef, runData, { merge: true });
      }
    });
  }

  async function stageOutbox(acquired, records, existingEffects) {
    const resourcePaths = projectorPaths(
      acquired.root.teamId,
      acquired.root.gameId,
    );
    const pending = [];
    for (const record of records) {
      const existing = existingEffects.get(record.id);
      if (existing) {
        if (
          !isOwnedDocument(existing, {
            teamId: acquired.root.teamId,
            gameId: acquired.root.gameId,
            instanceId: acquired.instanceId,
          }) ||
          existing.payloadHash !== record.data.payloadHash ||
          existing.projectionKey !== acquired.projectionKey
        ) {
          throw new DiamondProjectorError(
            "effect-idempotency-conflict",
            "A Diamond effect ID already contains different projection content.",
            { retryable: false },
          );
        }
      } else {
        pending.push(record);
      }
    }
    for (let index = 0; index < pending.length; index += batchWriteLimit) {
      const chunk = pending.slice(index, index + batchWriteLimit);
      const batch = firestore.batch();
      for (const record of chunk) {
        batch.create(
          firestore.doc(resourcePaths.effect(record.id)),
          record.data,
        );
      }
      try {
        await batch.commit();
      } catch (error) {
        let reconciled = true;
        for (const record of chunk) {
          let current;
          try {
            current = snapshotData(
              await firestore.doc(resourcePaths.effect(record.id)).get(),
            );
          } catch {
            reconciled = false;
            break;
          }
          if (!current) {
            reconciled = false;
            break;
          }
          if (
            !isOwnedDocument(current, {
              teamId: acquired.root.teamId,
              gameId: acquired.root.gameId,
              instanceId: acquired.instanceId,
            }) ||
            current.payloadHash !== record.data.payloadHash ||
            current.projectionKey !== acquired.projectionKey
          ) {
            throw new DiamondProjectorError(
              "effect-idempotency-conflict",
              "A Diamond effect ID already contains different projection content.",
              { retryable: false },
            );
          }
        }
        if (reconciled) continue;
        throw new DiamondProjectorError(
          "effect-stage-failed",
          "Diamond outbox staging did not finish and will be retried.",
          {
            retryable: true,
            details: { causeCode: error?.code || "batch-failed" },
          },
        );
      }
    }
  }

  async function markRunPrepared(acquired, projectionHash) {
    const resourcePaths = projectorPaths(
      acquired.root.teamId,
      acquired.root.gameId,
    );
    await firestore.runTransaction(async (transaction) => {
      const [rootSnapshot, runSnapshot] = await transactionGetAll(transaction, [
        firestore.doc(resourcePaths.scorebook),
        firestore.doc(resourcePaths.run(acquired.projectionKey)),
      ]);
      const root = snapshotData(rootSnapshot);
      const run = snapshotData(runSnapshot);
      if (
        !root ||
        root.projectionLease?.leaseId !== acquired.lease.leaseId ||
        !stillHasPrivateNotePrivacyState(root, acquired) ||
        !stillHasPinnedStatConfig(root, acquired) ||
        !stillHasPinnedOrientation(root, acquired) ||
        !run ||
        run.projectionHash !== projectionHash
      ) {
        throw new DiamondProjectorError(
          "projection-lease-lost",
          "The projection lease was replaced.",
          {
            retryable: true,
          },
        );
      }
      transaction.update(
        firestore.doc(resourcePaths.run(acquired.projectionKey)),
        {
          status: "prepared",
          complete: false,
        },
      );
    });
  }

  function ownedEnvelope(data, acquired, projectionHash) {
    return {
      ...data,
      trackingEngine: DIAMOND_ENGINE,
      teamId: acquired.root.teamId,
      diamondGameId: acquired.root.gameId,
      instanceId: acquired.instanceId,
      diamondScorebookInstanceId: acquired.instanceId,
      projectionGeneration: acquired.instanceId,
      sourceRevision: acquired.checkpoint.sequence,
      checkpointHash: acquired.checkpoint.previousHash,
      statConfigSnapshotHash: acquired.statConfigSnapshot.snapshotHash,
      privateNotePrivacyRevision: acquired.privateNotePrivacyRevision,
      projectionHash,
    };
  }

  function buildLivePlan(acquired, bundle, projectionHash) {
    const resourcePaths = projectorPaths(
      acquired.root.teamId,
      acquired.root.gameId,
    );
    const writes = [];
    const deletes = [];
    const addWrite = (kind, path, data) =>
      writes.push({
        kind,
        ref: firestore.doc(path),
        data: ownedEnvelope(data, acquired, projectionHash),
      });
    addWrite(
      "private-current",
      resourcePaths.privateCurrent,
      bundle.writes.privateCurrent.data,
    );
    addWrite("public-current", resourcePaths.publicCurrent, {
      ...bundle.writes.publicCurrent.data,
      publicEventCount: bundle.publicPlays.length,
      projectionState: "current",
      projectionStatus: "complete",
    });
    addWrite(
      "replay-manifest",
      resourcePaths.replayManifest,
      bundle.writes.publicReplayManifest.data,
    );
    for (const page of bundle.writes.publicReplayPages) {
      addWrite("replay-page", resourcePaths.replayPage(page.pageId), page.data);
    }
    for (const write of bundle.writes.publicPlayerStats) {
      addWrite(
        "public-player-stat",
        resourcePaths.publicPlayerStat(
          acquired.instanceId,
          normalizeId(write.playerId, "playerId"),
        ),
        write.data,
      );
    }
    for (const write of bundle.writes.privatePlayerStats) {
      addWrite(
        "private-player-stat",
        resourcePaths.privatePlayerStat(
          acquired.instanceId,
          normalizeId(write.playerId, "playerId"),
        ),
        write.data,
      );
    }
    addWrite(
      "team-stat",
      resourcePaths.teamStat(
        acquired.instanceId,
        bundle.writes.teamStats.statId || "team",
      ),
      bundle.writes.teamStats.data,
    );
    addWrite("stats-projection", resourcePaths.statsProjection, {
      ...bundle.statsProjection,
      status: "complete",
      complete: true,
    });
    for (const pageId of bundle.writes.deletePublicReplayPageIds || []) {
      deletes.push({
        kind: "replay-page",
        ref: firestore.doc(
          resourcePaths.replayPage(normalizeId(pageId, "pageId")),
        ),
      });
    }
    for (const playerId of bundle.writes.deletePublicPlayerStatIds || []) {
      deletes.push({
        kind: "public-player-stat",
        ref: firestore.doc(
          resourcePaths.publicPlayerStat(
            acquired.instanceId,
            normalizeId(playerId, "playerId"),
          ),
        ),
      });
    }
    for (const playerId of bundle.writes.deletePrivatePlayerStatIds || []) {
      deletes.push({
        kind: "private-player-stat",
        ref: firestore.doc(
          resourcePaths.privatePlayerStat(
            acquired.instanceId,
            normalizeId(playerId, "playerId"),
          ),
        ),
      });
    }
    const uniqueWritePaths = new Set(writes.map((write) => write.ref.path));
    const uniqueDeletePaths = new Set(deletes.map((entry) => entry.ref.path));
    if (
      uniqueWritePaths.size !== writes.length ||
      [...uniqueDeletePaths].some((path) => uniqueWritePaths.has(path))
    ) {
      throw new DiamondProjectorError(
        "invalid-projection-plan",
        "The projection plan has overlapping targets.",
      );
    }
    return { writes, deletes };
  }

  function mergeAiPatches(game, bundle) {
    const update = {};
    for (const [field, patch] of Object.entries(
      bundle.writes.aiArtifactPatches || {},
    )) {
      if (!isPlainObject(patch)) continue;
      update[field] = isPlainObject(game[field])
        ? { ...game[field], ...patch }
        : own(game, field)
          ? { legacyValue: game[field], ...patch }
          : { ...patch };
    }
    if (bundle.writes.diamondAiState)
      update.diamondAiState = bundle.writes.diamondAiState;
    return update;
  }

  function isHandlerBootstrapProjection(value, kind, acquired) {
    return Boolean(
      kind === "stats-projection" &&
      isPlainObject(value) &&
      value.trackingEngine !== DIAMOND_ENGINE &&
      generationFromDocument(value) === acquired.instanceId &&
      ["pending", "complete"].includes(value.status) &&
      value.sourceRevision === acquired.checkpoint.sequence,
    );
  }

  function validateSharedGameCurrent(shared, teamId, gameId) {
    if (!shared) return false;
    const teamIds = new Set(
      [
        shared.homeTeamId,
        shared.awayTeamId,
        ...(Array.isArray(shared.teamIds) ? shared.teamIds : []),
      ].filter(Boolean),
    );
    if (!teamIds.has(teamId)) return false;
    return hasTeamScopedSharedGameBinding(shared, teamId, gameId);
  }

  async function finalizeProjection(
    acquired,
    bundle,
    projectionHash,
    livePlan,
    sharedGame,
    effectEvidence,
  ) {
    const { root, game, checkpoint, instanceId, lease, projectionKey } =
      acquired;
    const { teamId, gameId } = root;
    const resourcePaths = projectorPaths(teamId, gameId);
    const sharedRef = sharedGame?.ref || null;
    const references = [
      firestore.doc(resourcePaths.scorebook),
      firestore.doc(resourcePaths.game),
      firestore.doc(resourcePaths.run(projectionKey)),
      ...livePlan.writes.map((write) => write.ref),
      ...livePlan.deletes.map((entry) => entry.ref),
      ...(sharedRef ? [sharedRef] : []),
    ];
    const uniqueReferences = [
      ...new Map(
        references.map((reference) => [reference.path, reference]),
      ).values(),
    ];
    const maximumWrites =
      livePlan.writes.length +
      livePlan.deletes.length +
      3 +
      (sharedRef ? 1 : 0);
    if (maximumWrites > MAX_FINAL_TRANSACTION_WRITES) {
      throw new DiamondProjectorError(
        "projection-plan-too-large",
        "The Diamond projection cannot be published atomically within its write bound.",
        { retryable: false },
      );
    }
    const completedAtMs = normalizeNow(clock);
    return firestore.runTransaction(async (transaction) => {
      const snapshots = await transactionGetAll(transaction, uniqueReferences);
      const currentByPath = new Map(
        snapshots.map((snapshot, index) => [
          uniqueReferences[index].path,
          snapshotData(snapshot),
        ]),
      );
      const currentRoot = currentByPath.get(resourcePaths.scorebook);
      const currentGame = currentByPath.get(resourcePaths.game);
      const currentRun = currentByPath.get(resourcePaths.run(projectionKey));
      const currentCheckpoint = checkpointForRoot(currentRoot, teamId, gameId);
      if (
        !isRootOwned(currentRoot, currentGame, {
          teamId,
          gameId,
          instanceId,
        }) ||
        currentCheckpoint.sequence !== checkpoint.sequence ||
        currentCheckpoint.previousHash !== checkpoint.previousHash ||
        currentRoot.projectionLease?.leaseId !== lease.leaseId ||
        !stillHasPrivateNotePrivacyState(currentRoot, acquired) ||
        !stillHasPinnedStatConfig(currentRoot, acquired, currentGame) ||
        !stillHasPinnedOrientation(currentRoot, acquired) ||
        currentRun?.status !== "prepared" ||
        currentRun?.projectionHash !== projectionHash
      ) {
        throw new DiamondProjectorError(
          "projection-cas-failed",
          "The Diamond ledger or projection lease changed before publication.",
          { retryable: true },
        );
      }
      const identity = { teamId, gameId, instanceId };
      for (const write of livePlan.writes) {
        const existing = currentByPath.get(write.ref.path);
        if (
          existing &&
          !isOwnedDocument(existing, identity) &&
          !isHandlerBootstrapProjection(existing, write.kind, acquired)
        ) {
          throw new DiamondProjectorError(
            "projection-target-conflict",
            `Diamond refused to replace a non-Diamond document at ${write.ref.path}.`,
            { retryable: false },
          );
        }
      }
      if (sharedRef) {
        const currentShared = currentByPath.get(sharedRef.path);
        if (!validateSharedGameCurrent(currentShared, teamId, gameId)) {
          throw new DiamondProjectorError(
            "shared-game-cas-failed",
            "The authoritative shared-game linkage changed before publication.",
            { retryable: true },
          );
        }
      }
      for (const write of livePlan.writes)
        transaction.set(write.ref, write.data);
      for (const entry of livePlan.deletes) {
        const existing = currentByPath.get(entry.ref.path);
        if (existing && isOwnedDocument(existing, identity))
          transaction.delete(entry.ref);
      }
      const gameUpdate = {
        ...bundle.writes.gameUpdate,
        ...mergeAiPatches(currentGame, bundle),
        trackingEngine: DIAMOND_ENGINE,
        diamondScorebookInstanceId: instanceId,
        diamondProjectionRevision: checkpoint.sequence,
        diamondProjectionCheckpointHash: checkpoint.previousHash,
        diamondProjectionHash: projectionHash,
        diamondProjectionStatus: "current",
        diamondProjectionComplete: true,
        diamondStatConfigSnapshotHash: acquired.statConfigSnapshot.snapshotHash,
        diamondPublicTeamStats: ownedEnvelope(
          bundle.writes.gameUpdate.diamondPublicTeamStats,
          acquired,
          projectionHash,
        ),
      };
      transaction.update(firestore.doc(resourcePaths.game), gameUpdate);
      if (sharedRef && bundle.writes.sharedGameUpdate) {
        transaction.update(sharedRef, {
          ...bundle.writes.sharedGameUpdate,
          diamondSourceTeamId: teamId,
          diamondSourceGameId: gameId,
          diamondScorebookInstanceId: instanceId,
          diamondProjectionHash: projectionHash,
        });
      }
      const marker = {
        schemaVersion: 1,
        trackingEngine: DIAMOND_ENGINE,
        status: "current",
        instanceId,
        sourceRevision: checkpoint.sequence,
        checkpointHash: checkpoint.previousHash,
        statConfigSnapshotHash: acquired.statConfigSnapshot.snapshotHash,
        orientationSnapshotHash: acquired.orientationSnapshotHash,
        privateNotePrivacyRevision: acquired.privateNotePrivacyRevision,
        projectionHash,
        projectionKey,
        effectRevision: checkpoint.sequence,
        notificationRevision: checkpoint.sequence,
        clipRevision: checkpoint.sequence,
        effectPlanHash:
          acquired.previousMarker?.sourceRevision === checkpoint.sequence &&
          acquired.previousMarker?.effectPlanHash
            ? acquired.previousMarker.effectPlanHash
            : effectEvidence.planHash,
        suppressedEffectCount:
          acquired.previousMarker?.sourceRevision === checkpoint.sequence &&
          Number.isSafeInteger(acquired.previousMarker?.suppressedEffectCount)
            ? acquired.previousMarker.suppressedEffectCount
            : effectEvidence.suppressedCount,
        completedAt: timestampIso(completedAtMs),
      };
      transaction.update(firestore.doc(resourcePaths.scorebook), {
        projectionStatus: "complete",
        projectionSourceRevision: checkpoint.sequence,
        projectionCheckpointHash: checkpoint.previousHash,
        projectionHash,
        diamondProjectionMarker: marker,
        projectionLease: null,
        projectionFailure: null,
        projectionRequest: null,
        recentPublicEvents: bundle.writes.publicCurrent.data.recentPlays || [],
        lastProjectedEffectRevision: checkpoint.sequence,
        lastNotifiedRevision: checkpoint.sequence,
        lastProjectedClipRevision: checkpoint.sequence,
      });
      transaction.set(
        firestore.doc(resourcePaths.run(projectionKey)),
        {
          status: "complete",
          complete: true,
          completedAt: timestampIso(completedAtMs),
          marker,
        },
        { merge: true },
      );
      return {
        projected: true,
        teamId,
        gameId,
        instanceId,
        sourceRevision: checkpoint.sequence,
        checkpointHash: checkpoint.previousHash,
        projectionHash,
        projectionKey,
        replayPageCount: bundle.writes.publicReplayPages.length,
        effectCount:
          (bundle.effects?.notifications?.length || 0) +
          (bundle.effects?.clipLinks?.length || 0) +
          (bundle.effects?.clipInvalidations?.length || 0) +
          (bundle.aiStaleness?.required ? 1 : 0) +
          (sharedGame ? 1 : 0),
      };
    });
  }

  async function projectDiamondGame(request = {}) {
    const teamId = normalizeId(request.teamId, "teamId");
    const gameId = normalizeId(request.gameId, "gameId");
    const expectedInstanceId = request.expectedInstanceId
      ? normalizeId(request.expectedInstanceId, "expectedInstanceId")
      : null;
    const expectedSourceRevision = Number.isSafeInteger(
      request.expectedSourceRevision,
    )
      ? request.expectedSourceRevision
      : null;
    const expectedCheckpointHash =
      typeof request.expectedCheckpointHash === "string"
        ? request.expectedCheckpointHash
        : null;
    const acquired = await acquireProjectionLease({
      teamId,
      gameId,
      expectedInstanceId,
      expectedSourceRevision,
      expectedCheckpointHash,
    });
    if (
      !acquired.acquired &&
      (acquired.reason === "stat-config-invalid" ||
        acquired.reason === "orientation-invalid")
    ) {
      throw new DiamondProjectorError(
        acquired.errorCode ||
          (acquired.reason === "orientation-invalid"
            ? "orientation-snapshot-invalid"
            : "stat-config-snapshot-invalid"),
        acquired.errorMessage ||
          (acquired.reason === "orientation-invalid"
            ? "The immutable Diamond orientation snapshot cannot be projected."
            : "The Diamond stat config snapshot cannot be projected."),
        { retryable: false },
      );
    }
    if (!acquired.acquired) return { projected: false, ...acquired };
    try {
      const ledger = await loadCanonicalLedger(acquired);
      acquired.events = ledger.events;
      const inputs = await loadProjectionInputs(acquired, ledger);
      acquired.sharedGamePath = inputs.sharedGame?.path || null;
      const previousMarker = acquired.previousMarker;
      const previousRevision = previousMarker?.sourceRevision || 0;
      const projectionSource =
        previousMarker &&
        previousMarker.sourceRevision < acquired.checkpoint.sequence
          ? "live-command"
          : "projection-rebuild";
      const bundle = projectionAdapter.buildDiamondProjectionBundle({
        ledger,
        instanceId: acquired.instanceId,
        orientationSnapshot: inputs.orientationSnapshot,
        sharedGame: inputs.sharedGame?.data || null,
        playerDirectoryBySide: inputs.playerDirectoryBySide,
        pageSize: 100,
        existingReplayPageIds: inputs.existingReplayPageIds,
        existingPublicPlayerIds: inputs.existingPublicPlayerIds,
        existingPrivatePlayerIds: inputs.existingPrivatePlayerIds,
        publicPlayerStatIds: inputs.publicPlayerStatIds,
        publicTeamStatIds: inputs.publicTeamStatIds,
        aiArtifacts: acquired.game,
        projectionSource,
        previousEffectRevision: previousRevision,
        previousNotificationRevision:
          previousMarker?.notificationRevision || previousRevision,
        previousClipRevision: previousMarker?.clipRevision || previousRevision,
        // The plan must remain byte-stable across an ambiguous staging retry.
        // Deterministic document IDs provide idempotency; existing held records
        // therefore do not alter adapter output or the projection hash.
        existingEffectKeys: [],
        clipTimingsByEventId: inputs.clipTimings,
        privateNoteDocuments: inputs.privateNoteDocuments,
      });
      assertBundleContract(bundle, acquired);
      const projectionHash = core.hashDiamondValue(
        projectionDigestPayload(
          bundle,
          acquired.projectionKey,
          acquired.statConfigSnapshot.snapshotHash,
        ),
      );
      const effects = outboxRecords(bundle, acquired, ledger);
      const effectEvidence = effectPlanEvidence(bundle);
      await initializeRun(
        acquired,
        bundle,
        projectionHash,
        effects.length,
        effectEvidence,
      );
      await stageOutbox(acquired, effects, inputs.documents.effects);
      await markRunPrepared(acquired, projectionHash);
      if (typeof hooks.beforeFinalize === "function") {
        await hooks.beforeFinalize({
          acquired,
          bundle,
          projectionHash,
          firestore,
        });
      }
      const livePlan = buildLivePlan(acquired, bundle, projectionHash);
      return await finalizeProjection(
        acquired,
        bundle,
        projectionHash,
        livePlan,
        inputs.sharedGame,
        effectEvidence,
      );
    } catch (error) {
      const projectedError =
        error instanceof DiamondProjectorError
          ? error
          : error?.name === "DiamondProjectionError" ||
              error?.name === "DiamondDomainError"
            ? new DiamondProjectorError(
                "projection-input-invalid",
                "The verified Diamond inputs cannot produce an authoritative projection.",
                {
                  retryable: false,
                  details: {
                    causeCode:
                      error?.code || "deterministic-projection-failure",
                  },
                },
              )
            : new DiamondProjectorError(
                "projection-failed",
                "Diamond projection failed before publication and will be retried.",
                {
                  retryable: true,
                  details: { causeCode: error?.code || "unknown" },
                },
              );
      await releaseProjectionLease(acquired, projectedError);
      logger.error?.("diamond_projection_failed", {
        sourceRevision: acquired.checkpoint.sequence,
        code: projectedError.code,
        retryable: projectedError.retryable,
      });
      throw projectedError;
    }
  }

  async function onDiamondScorebookWrite(change, context = {}) {
    const {
      snapshot,
      teamId: rawTeamId,
      gameId: rawGameId,
    } = resolveIdsFromTrigger(change, context);
    if (!snapshot || snapshot.exists !== true)
      return { projected: false, reason: "scorebook-deleted" };
    const root = snapshotData(snapshot);
    if (!root || root.trackingEngine !== DIAMOND_ENGINE) {
      return { projected: false, reason: "not-diamond-v2" };
    }
    const teamId = normalizeId(rawTeamId || root.teamId, "teamId");
    const gameId = normalizeId(rawGameId || root.gameId, "gameId");
    const checkpoint = checkpointForRoot(root, teamId, gameId);
    const instanceId = normalizeId(root.instanceId, "instanceId");
    let statConfigSnapshot = null;
    try {
      statConfigSnapshot = validatePinnedStatConfig(root, null, teamId);
    } catch (error) {
      if (root.projectionStatus !== "pending") {
        return {
          projected: false,
          reason: "stat-config-invalid",
          errorCode: error?.code || "stat-config-snapshot-invalid",
          sourceRevision: checkpoint.sequence,
        };
      }
    }
    let orientation = null;
    try {
      orientation = validatePinnedOrientation(root, teamId);
    } catch (error) {
      if (root.projectionStatus !== "pending") {
        return {
          projected: false,
          reason: "orientation-invalid",
          errorCode: error?.code || "orientation-snapshot-invalid",
          sourceRevision: checkpoint.sequence,
        };
      }
    }
    const marker = markerForRoot(root);
    if (
      statConfigSnapshot &&
      orientation &&
      root.projectionStatus !== "pending" &&
      markerMatches(
        marker,
        instanceId,
        checkpoint.sequence,
        checkpoint.previousHash,
        statConfigSnapshot.snapshotHash,
        orientation.snapshotHash,
        privateNotePrivacyRevision(root),
      )
    ) {
      return {
        projected: false,
        reason: "already-current",
        sourceRevision: checkpoint.sequence,
      };
    }
    if (root.projectionStatus !== "pending") {
      return {
        projected: false,
        reason: "projection-not-pending",
        sourceRevision: checkpoint.sequence,
      };
    }
    const result = await projectDiamondGame({
      teamId,
      gameId,
      expectedInstanceId: instanceId,
      expectedSourceRevision: checkpoint.sequence,
      expectedCheckpointHash: checkpoint.previousHash,
    });
    if (result.reason === "lease-active") {
      throw new DiamondProjectorError(
        "projection-lease-active",
        "Another Diamond projector owns the active lease; retry after its lease boundary.",
        { retryable: true },
      );
    }
    return result;
  }

  return { onDiamondScorebookWrite, projectDiamondGame };
}

module.exports = {
  DEFAULT_BATCH_WRITE_LIMIT,
  DEFAULT_LEASE_MILLIS,
  DIAMOND_ENGINE,
  DiamondProjectorError,
  EVENT_PAGE_SIZE,
  MAX_CANONICAL_EVENTS,
  MAX_EFFECT_DOCUMENTS,
  MAX_FINAL_TRANSACTION_WRITES,
  MAX_PLAYER_DOCUMENTS,
  MAX_REPLAY_PAGES,
  createDiamondScorebookProjectorHandlers,
  projectorPaths,
};
