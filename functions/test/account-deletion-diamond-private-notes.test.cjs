"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const domainEngine = require("../diamond-engine");
const privateNoteCore = require("../diamond-private-note-core.cjs");
const {
  ACCOUNT_DIAMOND_PRIVATE_NOTE_PAGE_SIZE,
  ACCOUNT_DIAMOND_PRIVATE_NOTE_TRANSACTION_SIZE,
  cleanupAccountDiamondPrivateNotes,
  createAccountDiamondPrivateNoteAuthDeleteHandler,
} = require("../account-deletion-core.cjs");

const UID = "deleted.user:1";
const DOCUMENT_ID = Object.freeze({ kind: "document-id" });
const REDACTED_AT = "2026-09-09T12:00:00.000Z";
const AUTH_DELETE_BARRIER_PATH =
  `accountDiamondPrivateNoteAuthDeleteBarriers/${privateNoteCore.buildDiamondPrivateNoteAuthDeleteBarrierId(UID)}`;
const DELETE_FIELD = Symbol("delete-field");
const ACTIVATION_GAME_ROLLBACK_FIELDS = Object.freeze([
  "trackingEngine", "trackingEngineRevision", "diamondProjectionRevision",
  "diamondProjectionCheckpointHash", "diamondProjectionHash",
  "diamondProjectionStatus", "diamondProjectionComplete",
  "diamondScorebookInstanceId", "diamondStatConfigSnapshotHash",
  "diamondLifecycle", "diamondPublicTeamStats", "diamondAiState",
  "diamondHighlightClipsRevision", "diamondHighlightClipsEffectKey",
  "trackingEngineActivatedAt", "trackingEngineActivatedBy", "homeScore",
  "awayScore", "score", "status", "liveStatus", "liveHasData",
  "currentInning", "inningHalf", "balls", "strikes", "outs",
  "opponentStats", "highlightClips", "aiRecap", "gameRecap", "recap",
  "aiInsights", "gameInsights", "insights",
]);
const SHARED_PROJECTION_FIELDS = Object.freeze([
  "homeScore", "awayScore", "status", "liveStatus", "trackingEngine",
  "diamondProjectionRevision", "diamondProjectionCheckpointHash",
  "diamondProjectionStatus", "diamondSourceTeamId", "diamondSourceGameId",
  "diamondScorebookInstanceId", "diamondProjectionHash",
]);

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, clone(entry)]),
  );
}

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function fakeTimestamp(milliseconds, nanosecondOffset = 0) {
  const seconds = Math.floor(milliseconds / 1000);
  const nanoseconds = (milliseconds - seconds * 1000) * 1_000_000
    + nanosecondOffset;
  return {
    seconds,
    nanoseconds,
    toMillis: () => seconds * 1000 + Math.floor(nanoseconds / 1_000_000),
    isEqual: (other) =>
      other?.seconds === seconds && other?.nanoseconds === nanoseconds,
  };
}

function buildPrivateNoteDocuments({
  teamId = "team-1",
  gameId = "game-1",
  instanceId = uuid(900),
  noteText = "private account deletion fixture",
  eventId = "event-private-1",
  commandIndex = 2,
  privacyRevision = 4,
} = {}) {
  let ledger = domainEngine.createDiamondLedger({
    teamId,
    gameId,
    rulesProfileId: "baseball-youth",
    rulesProfileVersion: 1,
    captureMode: "full",
  });
  const activate = {
    schemaVersion: domainEngine.DIAMOND_SCHEMA_VERSION,
    commandId: uuid(commandIndex - 1),
    teamId,
    gameId,
    expectedRevision: ledger.state.revision,
    rulesProfileId: ledger.rulesProfileId,
    rulesProfileVersion: ledger.rulesProfileVersion,
    type: "activate",
    payload: { initialScorerUid: UID, captureMode: "full" },
  };
  const activated = domainEngine.executeDiamondCommand(ledger, activate, {
    actorUid: UID,
    eventId: `event-activate-${String(commandIndex)}`,
    serverTimestampMs: 1_700_000_000_000 + commandIndex,
    managerAuthorized: true,
  });
  assert.equal(activated.result.outcome, "accepted");
  ledger = activated.ledger;

  const command = {
    schemaVersion: domainEngine.DIAMOND_SCHEMA_VERSION,
    commandId: uuid(commandIndex),
    teamId,
    gameId,
    expectedRevision: ledger.state.revision,
    rulesProfileId: ledger.rulesProfileId,
    rulesProfileVersion: ledger.rulesProfileVersion,
    type: "private_note",
    payload: { text: noteText },
  };
  const execution = domainEngine.executeDiamondCommand(ledger, command, {
    actorUid: UID,
    eventId,
    serverTimestampMs: 1_700_000_100_000 + commandIndex,
    managerAuthorized: true,
  });
  assert.equal(execution.result.outcome, "accepted");
  const receipt = domainEngine.createDiamondCommandReceipt(
    command,
    execution.event,
    execution.result,
  );
  const scorebookPath = `teams/${teamId}/games/${gameId}/diamondScorebooks/v2`;
  const rootPath = scorebookPath;
  const eventPath = `${scorebookPath}/events/${eventId}`;
  const notePath = `${scorebookPath}/notes/${eventId}`;
  const receiptPath = `${scorebookPath}/commands/${command.commandId}`;
  const projectionPath = `${scorebookPath}/projections/current`;
  const marker = {
    schemaVersion: 1,
    status: "current",
    instanceId,
    privateNotePrivacyRevision: privacyRevision,
    opaque: "retain-me",
  };
  return {
    paths: { rootPath, eventPath, notePath, receiptPath, projectionPath },
    event: execution.event,
    note: privateNoteCore.buildDiamondPrivateNoteRecord({
      command,
      event: execution.event,
      instanceId,
      authorUid: UID,
      createdAt: "2026-09-09T10:00:00.000Z",
      domainEngine,
    }),
    receipt: {
      ...receipt,
      instanceId,
      acceptedAt: "2026-09-09T10:00:00.000Z",
    },
    root: {
      schemaVersion: 2,
      trackingEngine: "diamond-v2",
      privateNoteStorageVersion: 1,
      privateNotePrivacyRevision: privacyRevision,
      teamId,
      gameId,
      instanceId,
      projectionStatus: "complete",
      projectionLease: { leaseId: "old-lease" },
      projectionFailure: { code: "old-failure" },
      projectionRequest: { requestId: "retain-request" },
      diamondProjectionMarker: marker,
    },
    projection: {
      schemaVersion: 1,
      trackingEngine: "diamond-v2",
      teamId,
      gameId,
      diamondGameId: gameId,
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      privateNotePrivacyRevision: privacyRevision,
      privateNotes: [{ eventId, actorUid: UID, text: noteText }],
    },
    marker,
  };
}

function seedBundle(bundle) {
  return {
    [bundle.paths.rootPath]: bundle.root,
    [bundle.paths.eventPath]: { ...bundle.event, instanceId: bundle.root.instanceId },
    [bundle.paths.notePath]: bundle.note,
    [bundle.paths.receiptPath]: bundle.receipt,
    [bundle.paths.projectionPath]: bundle.projection,
  };
}

function exactBeforeImage(fields, value, extras = {}) {
  return {
    schemaVersion: 1,
    ...extras,
    fields: Object.fromEntries(
      fields.map((field) => [
        field,
        Object.prototype.hasOwnProperty.call(value, field)
          ? { present: true, value: clone(value[field]) }
          : { present: false },
      ]),
    ),
  };
}

function configurationSettings({
  configuredBy,
  requestId,
  chainId = requestId,
  ordinal = 1,
  ...values
}) {
  return {
    ...values,
    configuredBy,
    configurationChainId: chainId,
    configurationRequestId: requestId,
    configurationOrdinal: ordinal,
  };
}

function configurationReceipt({
  teamId,
  requestId,
  requestedBy,
  settings,
  beforeImage = { present: false },
  chainId = settings.configurationChainId,
  ordinal = settings.configurationOrdinal,
  previousRequestId = null,
  nextRequestId = null,
  requestHash = `sha256:${"b".repeat(64)}`,
  createdAt = REDACTED_AT,
}) {
  const result = { teamId, settings };
  const immutableCore = {
    schemaVersion: 2,
    type: "diamond-team-configuration-request",
    teamId,
    requestHash,
    requestedBy,
    createdAt,
    result,
    chainId,
    ordinal,
  };
  return {
    schemaVersion: 2,
    type: "diamond-team-configuration-request",
    teamId,
    requestHash,
    requestedBy,
    createdAt,
    result,
    immutableHash: domainEngine.hashDiamondValue(immutableCore),
    lineage: {
      schemaVersion: 1,
      chainId,
      ordinal,
      previousRequestId,
      nextRequestId,
      beforeImage,
      beforeImageHash: domainEngine.hashDiamondValue(beforeImage),
    },
  };
}

function buildModerationProof({
  teamId = "team-moderation",
  gameId = "game-moderation",
  instanceId = uuid(720),
  moderatorUid = UID,
  senderId = "active.sender:2",
  requestId = uuid(721),
  messageId = `diamond-chat-${"a".repeat(64)}`,
  lifecycle = "active",
  commitMs = Date.parse(REDACTED_AT),
  receiptCreateNanosecondOffset = 0,
  receiptUpdateNanosecondOffset = receiptCreateNanosecondOffset,
  imageCreateNanosecondOffset = receiptCreateNanosecondOffset,
  imageUpdateNanosecondOffset = imageCreateNanosecondOffset,
} = {}) {
  const scorebookPath = `teams/${teamId}/games/${gameId}/diamondScorebooks/v2`;
  const gamePath = `teams/${teamId}/games/${gameId}`;
  const receiptKey = crypto.createHash("sha256")
    .update(`moderate-chat\n${teamId}\n${gameId}\n${moderatorUid}\n${requestId}`)
    .digest("hex");
  const targetKey = crypto.createHash("sha256")
    .update(`${instanceId}\n${messageId}`)
    .digest("hex");
  const receiptId = `engagement-moderation-receipt-${receiptKey}`;
  const requestHash = `sha256:${crypto.createHash("sha256").update(JSON.stringify({
    schemaVersion: 1,
    kind: "moderate-chat",
    requestId,
    teamId,
    gameId,
    expectedInstanceId: instanceId,
    viewerMode: "moderation",
    payload: { messageId },
  })).digest("hex")}`;
  const beforeImage = {
    schemaVersion: 1,
    trackingEngine: "diamond-v2",
    teamId,
    gameId,
    instanceId,
    text: "Restore the exact moderated message",
    senderId,
    senderName: "Active Sender",
    senderPhotoUrl: null,
    isAnonymous: false,
    createdAt: "2026-09-09T11:59:00.000Z",
  };
  const paths = {
    gamePath,
    scorebookPath,
    receiptPath: `${scorebookPath}/audit/${receiptId}`,
    beforeImagePath: `${scorebookPath}/moderationBeforeImages/${receiptKey}`,
    targetPath: `${scorebookPath}/audit/engagement-moderation-target-${targetKey}`,
    outputPath: `teams/${teamId}/games/${gameId}/diamondLiveGenerations/${instanceId}/chat/${messageId}`,
  };
  return {
    teamId,
    gameId,
    instanceId,
    moderatorUid,
    senderId,
    requestId,
    messageId,
    receiptId,
    requestHash,
    beforeImage,
    paths,
    documents: {
      [gamePath]: {
        trackingEngine: "diamond-v2",
        diamondScorebookInstanceId: instanceId,
      },
      [scorebookPath]: {
        schemaVersion: 2,
        trackingEngine: "diamond-v2",
        teamId,
        gameId,
        instanceId,
        checkpoint: {
          teamId,
          gameId,
          sequence: 1,
          state: { teamId, gameId, revision: 1, lifecycle },
        },
      },
      [paths.receiptPath]: {
        schemaVersion: 1,
        trackingEngine: "diamond-v2",
        teamId,
        gameId,
        instanceId,
        kind: "moderate-chat",
        requestId,
        requestHash,
        messageId,
        moderatorUid,
        moderationProofVersion: 1,
        beforeImageId: receiptKey,
        acceptedAt: REDACTED_AT,
      },
      [paths.beforeImagePath]: {
        schemaVersion: 1,
        trackingEngine: "diamond-v2",
        teamId,
        gameId,
        instanceId,
        receiptId,
        moderatorUid,
        senderId,
        beforeImage,
        createdAt: REDACTED_AT,
      },
      [paths.targetPath]: {
        schemaVersion: 1,
        trackingEngine: "diamond-v2",
        teamId,
        gameId,
        instanceId,
        messageId,
        receiptId,
        requestHash,
      },
    },
    commitMetadata: {
      [paths.receiptPath]: {
        createMs: commitMs,
        updateMs: commitMs,
        createNanosecondOffset: receiptCreateNanosecondOffset,
        updateNanosecondOffset: receiptUpdateNanosecondOffset,
      },
      [paths.beforeImagePath]: {
        createMs: commitMs,
        updateMs: commitMs,
        createNanosecondOffset: imageCreateNanosecondOffset,
        updateNanosecondOffset: imageUpdateNanosecondOffset,
      },
    },
  };
}

function buildRetiringActivationGeneration({
  teamId = "team-retire",
  gameId = "game-retire",
  instanceId = uuid(950),
  sharedExisted = true,
  sourceCommitMs = Date.parse(REDACTED_AT),
  sourceCreateNanosecondOffset = 0,
  sourceUpdateNanosecondOffset = sourceCreateNanosecondOffset,
  seedShared = true,
} = {}) {
  const scorebookPath = `teams/${teamId}/games/${gameId}/diamondScorebooks/v2`;
  const gamePath = `teams/${teamId}/games/${gameId}`;
  const eventId = "event-activate-retiring";
  const commandId = uuid(951);
  let ledger = domainEngine.createDiamondLedger({
    teamId,
    gameId,
    rulesProfileId: "baseball-youth",
    rulesProfileVersion: 1,
    captureMode: "full",
  });
  const command = {
    schemaVersion: domainEngine.DIAMOND_SCHEMA_VERSION,
    commandId,
    teamId,
    gameId,
    expectedRevision: 0,
    rulesProfileId: ledger.rulesProfileId,
    rulesProfileVersion: ledger.rulesProfileVersion,
    type: "activate",
    payload: { initialScorerUid: UID, captureMode: "full" },
  };
  const execution = domainEngine.executeDiamondCommand(ledger, command, {
    actorUid: UID,
    eventId,
    serverTimestampMs: sourceCommitMs,
    managerAuthorized: true,
  });
  assert.equal(execution.result.outcome, "accepted");
  ledger = execution.ledger;
  const checkpoint = domainEngine.createDiamondCheckpoint(ledger);

  const gameBefore = {
    status: "scheduled",
    liveStatus: "scheduled",
    homeScore: 7,
    awayScore: 6,
    aiRecap: "pre-Diamond recap",
  };
  const sharedPath = "organizations/org-retire/sharedGames/shared-retire";
  const sharedBefore = sharedExisted
    ? {
        status: "scheduled",
        liveStatus: "scheduled",
        homeScore: 7,
        awayScore: 6,
      }
    : {};
  const provenance = {
    schemaVersion: 1,
    type: "diamond-activation-rollback-provenance",
    trackingEngine: "diamond-v2",
    teamId,
    gameId,
    instanceId,
    game: exactBeforeImage(ACTIVATION_GAME_ROLLBACK_FIELDS, gameBefore),
    sharedGame: exactBeforeImage(SHARED_PROJECTION_FIELDS, sharedBefore, {
      path: sharedPath,
      existed: sharedExisted,
    }),
    createdAt: "2026-09-09T11:59:59.000Z",
  };
  const activationRollbackHash = domainEngine.hashDiamondValue(provenance);
  const owned = (overrides = {}) => ({
    schemaVersion: 1,
    trackingEngine: "diamond-v2",
    teamId,
    gameId,
    instanceId,
    diamondScorebookInstanceId: instanceId,
    projectionGeneration: instanceId,
    ...overrides,
  });
  const eventPath = `${scorebookPath}/events/${eventId}`;
  const provenancePath = `${scorebookPath}/audit/activation-provenance`;
  const notificationPath = `${scorebookPath}/notificationReceipts/receipt-retained`;
  const siblingPath = `${gamePath}/aggregatedStats/player-old`;
  const statRootPath = `${gamePath}/diamondStatGenerations/${instanceId}`;
  const liveRootPath = `${gamePath}/diamondLiveGenerations/${instanceId}`;
  const liveChatPath = `${liveRootPath}/chat/diamond-chat-${"d".repeat(64)}`;
  const documents = {
    [gamePath]: {
      id: gameId,
      opaqueGameField: "keep-game",
      trackingEngine: "diamond-v2",
      diamondScorebookInstanceId: instanceId,
      diamondProjectionRevision: 1,
      diamondProjectionStatus: "current",
      diamondPublicTeamStats: { hits: 2 },
      diamondAiState: { status: "published" },
      status: "live",
      liveStatus: "live",
      liveHasData: true,
      homeScore: 0,
      awayScore: 0,
      aiRecap: "unsafe Diamond recap",
      insights: ["unsafe Diamond insight"],
    },
    [scorebookPath]: {
      schemaVersion: 2,
      trackingEngine: "diamond-v2",
      teamId,
      gameId,
      instanceId,
      initialState: ledger.initialState,
      checkpoint,
      activationRollbackHash,
      projectionStatus: "complete",
      projectionLease: null,
      projectionFailure: null,
      projectionRequest: null,
      diamondProjectionMarker: { status: "current" },
      scorerLease: { holderUid: UID },
      recentPublicEvents: [{ eventId }],
    },
    [eventPath]: { ...execution.event, instanceId },
    [provenancePath]: provenance,
    [`${scorebookPath}/projections/current`]: owned(),
    [`${gamePath}/diamondPublic/state`]: owned(),
    [`${gamePath}/diamondPublic/replay`]: owned(),
    [statRootPath]: owned(),
    [`${statRootPath}/publicPlayerStats/player-old`]: owned({ playerId: "player-old" }),
    [liveRootPath]: owned(),
    [liveChatPath]: {
      schemaVersion: 1,
      trackingEngine: "diamond-v2",
      teamId,
      gameId,
      instanceId,
      text: "retiring message",
      senderId: UID,
      senderName: "Deleted User",
      senderPhotoUrl: null,
      isAnonymous: false,
      createdAt: REDACTED_AT,
    },
    [siblingPath]: owned({ playerId: "player-old" }),
    [notificationPath]: {
      schemaVersion: 3,
      trackingEngine: "diamond-v2",
      receiptId: "receipt-retained",
      teamId,
      gameId,
      instanceId,
      sourceRevision: 1,
      sourceEventId: eventId,
      idempotencyKey: "retained-provider-evidence",
      requestHash: `sha256:${"a".repeat(64)}`,
      status: "completed",
      attemptCount: 1,
      dispatchLease: null,
      providerDispatch: null,
      providerOutcome: "sent",
      providerReceiptId: "provider-retained",
      createdAt: "2026-09-09T12:00:00.000Z",
      updatedAt: "2026-09-09T12:00:00.000Z",
      completedAt: "2026-09-09T12:00:00.000Z",
    },
    [sharedPath]: {
      opaqueSharedField: "keep-shared",
      trackingEngine: "diamond-v2",
      diamondSourceTeamId: teamId,
      diamondSourceGameId: gameId,
      diamondScorebookInstanceId: instanceId,
      diamondProjectionRevision: 1,
      diamondProjectionStatus: "current",
      homeScore: 0,
      awayScore: 0,
      status: "live",
      liveStatus: "live",
    },
  };
  const commitMetadata = {
    [eventPath]: {
      createMs: sourceCommitMs,
      updateMs: sourceCommitMs,
      createNanosecondOffset: sourceCreateNanosecondOffset,
      updateNanosecondOffset: sourceUpdateNanosecondOffset,
    },
    [provenancePath]: {
      createMs: sourceCommitMs - 1,
      updateMs: sourceCommitMs - 1,
    },
  };
  if (!seedShared) delete documents[sharedPath];
  return {
    teamId,
    gameId,
    instanceId,
    scorebookPath,
    gamePath,
    eventPath,
    provenancePath,
    notificationPath,
    siblingPath,
    statRootPath,
    liveRootPath,
    liveChatPath,
    sharedPath,
    gameBefore,
    sharedBefore,
    documents,
    commitMetadata,
  };
}

function buildIndirectRetiringGeneration(kind) {
  assert.ok(["private-note", "handoff-target"].includes(kind));
  const fixture = buildRetiringActivationGeneration();
  let ledger = domainEngine.createDiamondLedger({
    teamId: fixture.teamId,
    gameId: fixture.gameId,
    rulesProfileId: "baseball-youth",
    rulesProfileVersion: 1,
    captureMode: "full",
  });
  const activationCommand = {
    schemaVersion: domainEngine.DIAMOND_SCHEMA_VERSION,
    commandId: uuid(960),
    teamId: fixture.teamId,
    gameId: fixture.gameId,
    expectedRevision: 0,
    rulesProfileId: ledger.rulesProfileId,
    rulesProfileVersion: ledger.rulesProfileVersion,
    type: "activate",
    payload: { initialScorerUid: "active-manager", captureMode: "full" },
  };
  const activation = domainEngine.executeDiamondCommand(ledger, activationCommand, {
    actorUid: "active-manager",
    eventId: "event-activate-retiring",
    serverTimestampMs: Date.parse(REDACTED_AT) - 10,
    managerAuthorized: true,
  });
  assert.equal(activation.result.outcome, "accepted");
  ledger = activation.ledger;
  const sourceCommand = {
    schemaVersion: domainEngine.DIAMOND_SCHEMA_VERSION,
    commandId: uuid(kind === "private-note" ? 961 : 962),
    teamId: fixture.teamId,
    gameId: fixture.gameId,
    expectedRevision: 1,
    rulesProfileId: ledger.rulesProfileId,
    rulesProfileVersion: ledger.rulesProfileVersion,
    type: kind === "private-note" ? "private_note" : "scorer_handoff",
    payload: kind === "private-note"
      ? { text: "post-delete private material" }
      : { toUid: UID },
  };
  const source = domainEngine.executeDiamondCommand(ledger, sourceCommand, {
    actorUid: kind === "private-note" ? UID : "active-manager",
    eventId: kind === "private-note" ? "event-private-retiring" : "event-handoff-retiring",
    serverTimestampMs: Date.parse(REDACTED_AT),
    managerAuthorized: true,
  });
  assert.equal(source.result.outcome, "accepted");
  ledger = source.ledger;
  const activationPath = `${fixture.scorebookPath}/events/${activation.event.eventId}`;
  const sourceEventPath = `${fixture.scorebookPath}/events/${source.event.eventId}`;
  fixture.documents[activationPath] = { ...activation.event, instanceId: fixture.instanceId };
  fixture.documents[sourceEventPath] = { ...source.event, instanceId: fixture.instanceId };
  fixture.documents[fixture.scorebookPath] = {
    ...fixture.documents[fixture.scorebookPath],
    initialState: ledger.initialState,
    checkpoint: domainEngine.createDiamondCheckpoint(ledger),
  };
  fixture.commitMetadata[activationPath] = {
    createMs: Date.parse(REDACTED_AT) - 10,
    updateMs: Date.parse(REDACTED_AT) - 10,
  };
  fixture.commitMetadata[sourceEventPath] = {
    createMs: Date.parse(REDACTED_AT),
    updateMs: Date.parse(REDACTED_AT),
  };
  let notePath = null;
  if (kind === "private-note") {
    notePath = `${fixture.scorebookPath}/notes/${source.event.eventId}`;
    fixture.documents[notePath] = privateNoteCore.buildDiamondPrivateNoteRecord({
      command: sourceCommand,
      event: source.event,
      instanceId: fixture.instanceId,
      authorUid: UID,
      createdAt: REDACTED_AT,
      domainEngine,
    });
    fixture.commitMetadata[notePath] = {
      createMs: Date.parse(REDACTED_AT),
      updateMs: Date.parse(REDACTED_AT),
    };
  }
  return { ...fixture, sourceEventPath, notePath };
}

function makeFirestore(seed = {}, options = {}) {
  const state = new Map(
    Object.entries(seed).map(([documentPath, value]) => [
      documentPath,
      clone(value),
    ]),
  );
  const defaultCommitMs = options.defaultCommitMs
    || Date.parse("2026-09-08T12:00:00.000Z");
  const metadata = new Map();
  for (const documentPath of state.keys()) {
    const configured = options.commitMetadata?.[documentPath] || {};
    metadata.set(documentPath, {
      createTime: fakeTimestamp(
        configured.createMs ?? defaultCommitMs,
        configured.createNanosecondOffset || 0,
      ),
      updateTime: fakeTimestamp(
        configured.updateMs ?? configured.createMs ?? defaultCommitMs,
        configured.updateNanosecondOffset
          ?? configured.createNanosecondOffset
          ?? 0,
      ),
    });
  }
  const queryLog = [];
  const transactionLog = [];
  let preCommitFailures = options.preCommitFailures || 0;
  let postCommitFailures = options.postCommitFailures || 0;
  const preCommitFailureCalls = new Set(options.preCommitFailureCalls || []);
  const postCommitFailureCalls = new Set(options.postCommitFailureCalls || []);
  let transactionCalls = 0;

  function snapshot(ref) {
    const value = state.get(ref.path);
    const commit = metadata.get(ref.path) || {};
    return {
      id: ref.id,
      ref,
      exists: value !== undefined,
      data: () => clone(value),
      createTime: commit.createTime,
      updateTime: commit.updateTime,
    };
  }

  function doc(documentPath) {
    const ref = {
      id: documentPath.split("/").at(-1),
      path: documentPath,
      kind: "document",
      get: async () => snapshot(ref),
    };
    return ref;
  }

  class Query {
    constructor(scope, source, filters = [], limitValue = Infinity, cursor = null, order = DOCUMENT_ID) {
      this.scope = scope;
      this.source = source;
      this.filters = filters;
      this.limitValue = limitValue;
      this.cursor = cursor;
      this.order = order;
      this.path = scope === "collection" ? source : undefined;
      this.kind = scope === "collection" ? "collection" : "query";
    }

    where(field, operator, value) {
      assert.ok(["==", ">", ">=", "<="].includes(operator));
      return new Query(
        this.scope,
        this.source,
        [...this.filters, { field, operator, value }],
        this.limitValue,
        this.cursor,
        this.order,
      );
    }

    orderBy(field) {
      return new Query(
        this.scope,
        this.source,
        this.filters,
        this.limitValue,
        this.cursor,
        field,
      );
    }

    limit(limitValue) {
      return new Query(
        this.scope,
        this.source,
        this.filters,
        limitValue,
        this.cursor,
        this.order,
      );
    }

    startAfter(cursor) {
      const cursorValue = this.order === DOCUMENT_ID
        ? cursor?.ref?.path || cursor?.path || cursor
        : cursor?.data?.()?.[this.order] ?? cursor;
      return new Query(
        this.scope,
        this.source,
        this.filters,
        this.limitValue,
        cursorValue,
        this.order,
      );
    }

    async get() {
      await options.queryHook?.({
        scope: this.scope,
        source: this.source,
        filters: clone(this.filters),
        cursor: this.cursor,
      });
      const fieldValue = (value, field) => String(field)
        .split(".")
        .reduce((current, part) => current?.[part], value);
      const matchesFilter = (value, filter) => {
        const current = fieldValue(value, filter.field);
        if (filter.operator === "==") return current === filter.value;
        if (filter.operator === ">") return current > filter.value;
        if (filter.operator === ">=") return current >= filter.value;
        return current <= filter.value;
      };
      const isInSource = (documentPath) => {
        if (this.scope === "group") {
          return documentPath.split("/").at(-2) === this.source;
        }
        const prefix = `${this.source}/`;
        return documentPath.startsWith(prefix)
          && !documentPath.slice(prefix.length).includes("/");
      };
      const orderValue = ([documentPath, value]) => this.order === DOCUMENT_ID
        ? documentPath
        : fieldValue(value, this.order);
      const entries = [...state.entries()]
        .filter(([documentPath]) => isInSource(documentPath))
        .filter(([, value]) => this.filters.every((filter) => matchesFilter(value, filter)))
        .filter((entry) => this.cursor === null || orderValue(entry) > this.cursor)
        .sort((left, right) => {
          const comparison = orderValue(left) < orderValue(right)
            ? -1
            : orderValue(left) > orderValue(right)
              ? 1
              : 0;
          return comparison || left[0].localeCompare(right[0]);
        });
      const paths = entries
        .map(([documentPath]) => documentPath)
        .slice(0, this.limitValue);
      await options.afterQueryHook?.({
        scope: this.scope,
        source: this.source,
        filters: clone(this.filters),
        cursor: this.cursor,
        paths: [...paths],
      });
      const documents = paths.map((documentPath) => snapshot(doc(documentPath)));
      await options.afterQuerySnapshotHook?.({
        scope: this.scope,
        source: this.source,
        filters: clone(this.filters),
        cursor: this.cursor,
        paths: [...paths],
      });
      queryLog.push({
        collectionId: this.source,
        field: this.filters.at(-1)?.field || "",
        cursorPath: this.cursor || "",
        paths,
      });
      return { docs: documents, empty: paths.length === 0 };
    }
  }

  async function runTransaction(operation) {
    transactionCalls += 1;
    const operations = [];
    const writes = [];
    let writeStarted = false;
    const transaction = {
      async get(ref) {
        assert.equal(writeStarted, false, "every transaction read must precede every write");
        operations.push({ kind: "get", path: ref.path || `query:${ref.source}` });
        return ref instanceof Query ? ref.get() : snapshot(ref);
      },
      create(ref, value) {
        writeStarted = true;
        operations.push({ kind: "create", path: ref.path });
        writes.push({ kind: "create", ref, value: clone(value) });
      },
      set(ref, value, setOptions) {
        writeStarted = true;
        operations.push({ kind: "set", path: ref.path });
        writes.push({ kind: "set", ref, value: clone(value), options: setOptions });
      },
      update(ref, value) {
        writeStarted = true;
        operations.push({ kind: "update", path: ref.path });
        writes.push({ kind: "update", ref, value: clone(value) });
      },
      delete(ref) {
        writeStarted = true;
        operations.push({ kind: "delete", path: ref.path });
        writes.push({ kind: "delete", ref });
      },
    };
    const result = await operation(transaction);
    transactionLog.push(operations);
    if (preCommitFailures > 0 || preCommitFailureCalls.delete(transactionCalls)) {
      if (preCommitFailures > 0) preCommitFailures -= 1;
      const error = new Error("simulated pre-commit response failure");
      error.code = "unavailable";
      throw error;
    }
    for (const write of writes) {
      if (write.kind === "delete") {
        state.delete(write.ref.path);
        metadata.delete(write.ref.path);
      } else if (write.kind === "create") {
        if (state.has(write.ref.path)) throw new Error(`Already exists: ${write.ref.path}`);
        state.set(write.ref.path, clone(write.value));
        metadata.set(write.ref.path, {
          createTime: fakeTimestamp(defaultCommitMs),
          updateTime: fakeTimestamp(defaultCommitMs),
        });
      } else if (write.kind === "set" && !write.options?.merge) {
        state.set(write.ref.path, clone(write.value));
      } else {
        const next = { ...(state.get(write.ref.path) || {}) };
        for (const [field, value] of Object.entries(clone(write.value))) {
          if (value === DELETE_FIELD) delete next[field];
          else next[field] = value;
        }
        state.set(write.ref.path, next);
      }
      if (!metadata.has(write.ref.path)) {
        metadata.set(write.ref.path, {
          createTime: fakeTimestamp(defaultCommitMs),
          updateTime: fakeTimestamp(defaultCommitMs),
        });
      }
    }
    if (postCommitFailures > 0 || postCommitFailureCalls.delete(transactionCalls)) {
      if (postCommitFailures > 0) postCommitFailures -= 1;
      const error = new Error("simulated committed response loss");
      error.code = "unavailable";
      throw error;
    }
    return result;
  }

  async function recursiveDelete(reference) {
    const prefix = reference.kind === "collection"
      ? `${reference.path}/`
      : `${reference.path}/`;
    for (const documentPath of [...state.keys()]) {
      if (
        documentPath === reference.path
        || documentPath.startsWith(prefix)
      ) {
        state.delete(documentPath);
        metadata.delete(documentPath);
      }
    }
  }

  return {
    firestore: {
      collectionGroup: (collectionId) => new Query("group", collectionId),
      collection: (collectionPath) => new Query("collection", collectionPath),
      doc,
      runTransaction,
    },
    has: (path) => state.has(path),
    read: (path) => clone(state.get(path)),
    write: (path, value, commit = {}) => {
      state.set(path, clone(value));
      metadata.set(path, {
        createTime: fakeTimestamp(commit.createMs ?? defaultCommitMs, commit.createNanosecondOffset || 0),
        updateTime: fakeTimestamp(
          commit.updateMs ?? commit.createMs ?? defaultCommitMs,
          commit.updateNanosecondOffset ?? commit.createNanosecondOffset ?? 0,
        ),
      });
    },
    remove: (path) => {
      state.delete(path);
      metadata.delete(path);
    },
    removeMetadata: (path) => metadata.delete(path),
    entries: () => clone(Object.fromEntries(state)),
    queryLog,
    transactionLog,
    recursiveDelete,
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

function runCleanup(fake, overrides = {}) {
  return cleanupAccountDiamondPrivateNotes({
    firestore: fake.firestore,
    uid: UID,
    documentIdField: DOCUMENT_ID,
    redactedAt: REDACTED_AT,
    pageSize: 1,
    transactionSize: 1,
    ...overrides,
  });
}

function runDirectAuthDelete(fake, overrides = {}) {
  const handler = createAccountDiamondPrivateNoteAuthDeleteHandler({
    firestore: fake.firestore,
    getDocumentIdField: () => DOCUMENT_ID,
    deleteFieldValue: () => DELETE_FIELD,
    ...(overrides.handlerOptions || {}),
  });
  return handler(
    overrides.user || { uid: UID },
    { timestamp: REDACTED_AT, ...overrides.context },
  );
}

async function runDirectAuthDeleteUntilComplete(fake, overrides = {}, maximumAttempts = 100) {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      await runDirectAuthDelete(fake, overrides);
      return attempt + 1;
    } catch (error) {
      if (error?.code !== "unavailable") throw error;
    }
  }
  throw new Error("Direct Auth-deletion reconciliation did not finish within its test bound.");
}

test("exposes bounded Diamond private-note account-deletion limits", () => {
  assert.equal(ACCOUNT_DIAMOND_PRIVATE_NOTE_PAGE_SIZE, 250);
  assert.equal(ACCOUNT_DIAMOND_PRIVATE_NOTE_TRANSACTION_SIZE, 50);
});

test("redacts indexed active notes, fences their projections, and advances past unrelated notes", async () => {
  const bundle = buildPrivateNoteDocuments();
  const unrelatedPath = "accounts/example/notes/generic-note";
  const fake = makeFirestore({
    [`accountDeletionRequests/${UID}`]: { uid: UID, status: "processing" },
    [unrelatedPath]: { authorUid: UID, text: "generic note is outside Diamond" },
    ...seedBundle(bundle),
  });

  const result = await runCleanup(fake);

  assert.equal(result.notesRedacted, 1);
  assert.equal(result.scorebooksFenced, 1);
  assert.deepEqual(fake.read(unrelatedPath), {
    authorUid: UID,
    text: "generic note is outside Diamond",
  });
  const redaction = fake.read(bundle.paths.notePath);
  assert.deepEqual(Object.keys(redaction).sort(), [
    "commandId",
    "eventId",
    "instanceId",
    "reason",
    "redactedAt",
    "revision",
    "schemaVersion",
    "status",
    "trackingEngine",
  ]);
  assert.equal(JSON.stringify(redaction).includes(UID), false);
  assert.equal(JSON.stringify(redaction).includes("private account deletion fixture"), false);
  assert.doesNotThrow(() =>
    privateNoteCore.parseDiamondPrivateNoteRedaction(
      redaction,
      bundle.event,
      bundle.root.instanceId,
      domainEngine,
    ),
  );
  assert.equal(fake.has(bundle.paths.projectionPath), false);
  const root = fake.read(bundle.paths.rootPath);
  assert.equal(root.privateNotePrivacyRevision, 5);
  assert.equal(root.projectionStatus, "pending");
  assert.equal(root.projectionLease, null);
  assert.equal(root.projectionFailure, null);
  assert.deepEqual(root.diamondProjectionMarker, bundle.marker);
  assert.deepEqual(root.projectionRequest, { requestId: "retain-request" });
  assert.ok(
    fake.queryLog.some(
      (entry) =>
        entry.collectionId === "notes" &&
        entry.field === "authorUid" &&
        entry.cursorPath === unrelatedPath,
    ),
  );

  const retry = await runCleanup(fake);
  assert.equal(retry.notesRedacted, 0);
  assert.equal(fake.read(bundle.paths.rootPath).privateNotePrivacyRevision, 5);
});

test("preflights every exact Diamond legacy source before changing active notes", async (t) => {
  const legacyCases = [
    { kind: "note" },
    {
      kind: "supersede-to-private",
      event: {
        type: "supersede_event",
        payload: {
          targetEventId: "event-public",
          reason: "legacy private replacement",
          replacement: { type: "private_note", payload: { text: "legacy replacement" } },
        },
      },
    },
    {
      kind: "void-private-target",
      event: {
        type: "void_event",
        payload: {
          targetEventId: "private-note-by-another-user",
          reason: "legacy private correction reason",
        },
      },
    },
    {
      kind: "supersede-private-target-to-public",
      event: {
        type: "supersede_event",
        payload: {
          targetEventId: "private-note-by-another-user",
          reason: "legacy private correction reason",
          replacement: {
            type: "rules_decision",
            payload: { code: "local_rule", description: "Public ruling." },
          },
        },
      },
    },
  ];
  for (const legacyCase of legacyCases) {
    await t.test(legacyCase.kind, async () => {
      const active = buildPrivateNoteDocuments();
      const seed = {
        [`accountDeletionRequests/${UID}`]: { uid: UID, status: "processing" },
        ...seedBundle(active),
      };
      if (legacyCase.kind === "note") {
        seed["teams/team-legacy/games/game-legacy/diamondScorebooks/v2/notes/event-legacy"] = {
          createdBy: UID,
          text: "legacy private note",
        };
      } else {
        seed["teams/team-legacy/games/game-legacy/diamondScorebooks/v2/events/event-legacy"] = {
          eventId: "event-legacy",
          actorUid: UID,
          ...legacyCase.event,
        };
      }
      const fake = makeFirestore(seed);

      await assert.rejects(
        runCleanup(fake),
        (error) => error?.code === "diamond-private-note-migration-required",
      );
      assert.deepEqual(fake.read(active.paths.notePath), active.note);
      assert.deepEqual(fake.read(active.paths.rootPath), active.root);
      assert.deepEqual(fake.read(active.paths.projectionPath), active.projection);
      assert.equal(fake.transactionCalls, 0);
    });
  }
});

test("fails closed on the deletion-request barrier and exact receipt identity", async (t) => {
  for (const variant of ["request", "receipt"]) {
    await t.test(variant, async () => {
      const bundle = buildPrivateNoteDocuments();
      const seed = {
        [`accountDeletionRequests/${UID}`]:
          variant === "request"
            ? { uid: UID, status: "failed" }
            : { uid: UID, status: "processing" },
        ...seedBundle(bundle),
      };
      if (variant === "receipt") {
        seed[bundle.paths.receiptPath] = {
          ...seed[bundle.paths.receiptPath],
          instanceId: uuid(901),
        };
      }
      const fake = makeFirestore(seed);

      await assert.rejects(
        runCleanup(fake),
        (error) => error?.code === "diamond-private-note-integrity-failed",
      );
      assert.deepEqual(fake.read(bundle.paths.notePath), bundle.note);
      assert.deepEqual(fake.read(bundle.paths.rootPath), bundle.root);
      assert.ok(fake.read(bundle.paths.projectionPath));
    });
  }
});

test("reconciles committed response loss and retries a definitive pre-commit failure without double fencing", async (t) => {
  for (const failureKind of ["post", "pre"]) {
    await t.test(failureKind, async () => {
      const bundle = buildPrivateNoteDocuments();
      const fake = makeFirestore(
        {
          [`accountDeletionRequests/${UID}`]: { uid: UID, status: "processing" },
          ...seedBundle(bundle),
        },
        failureKind === "post"
          ? { postCommitFailures: 1 }
          : { preCommitFailures: 1 },
      );

      const result = await runCleanup(fake);

      assert.equal(result.notesRedacted, 1);
      assert.equal(fake.read(bundle.paths.rootPath).privateNotePrivacyRevision, 5);
      assert.equal(fake.has(bundle.paths.projectionPath), false);
      assert.equal(fake.read(bundle.paths.notePath).status, "deleted");
      assert.equal(fake.transactionCalls, failureKind === "post" ? 1 : 2);
    });
  }
});

test("direct Auth deletion durably redacts private material behind a retained hash-only barrier", async () => {
  const bundle = buildPrivateNoteDocuments();
  const fake = makeFirestore(seedBundle(bundle));

  await runDirectAuthDelete(fake);

  assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), true);
  assert.equal(fake.has(bundle.paths.projectionPath), false);
  assert.equal(fake.read(bundle.paths.notePath).status, "deleted");
  assert.equal(fake.read(bundle.paths.notePath).redactedAt, REDACTED_AT);
  assert.equal(fake.read(bundle.paths.rootPath).privateNotePrivacyRevision, 5);
  const operations = fake.transactionLog.flat();
  const barrierCreated = operations.findIndex(
    ({ kind, path }) => kind === "set" && path === AUTH_DELETE_BARRIER_PATH,
  );
  const noteRedacted = operations.findIndex(
    ({ kind, path }) => kind === "set" && path === bundle.paths.notePath,
  );
  assert.ok(barrierCreated >= 0);
  assert.ok(noteRedacted > barrierCreated);
  assert.equal(
    operations.some(
      ({ kind, path }) =>
        kind === "delete" && path === AUTH_DELETE_BARRIER_PATH,
    ),
    false,
  );
  assert.equal(AUTH_DELETE_BARRIER_PATH.includes(UID), false);
  const retainedState = JSON.stringify(fake.entries());
  assert.equal(retainedState.includes(UID), false);
  assert.equal(retainedState.includes("private account deletion fixture"), false);

  await runDirectAuthDelete(fake);
  assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), true);
  assert.equal(fake.read(bundle.paths.rootPath).privateNotePrivacyRevision, 5);
  assert.equal(JSON.stringify(fake.entries()).includes(UID), false);
});

test("direct Auth deletion preserves unrelated account-deletion request states", async (t) => {
  for (const status of [null, "queued", "processing", "failed"]) {
    await t.test(status || "missing", async () => {
      const bundle = buildPrivateNoteDocuments();
      const requestPath = `accountDeletionRequests/${UID}`;
      const request = status
        ? { uid: UID, status, source: "existing-worker", opaque: "retain-me" }
        : undefined;
      const fake = makeFirestore({
        ...(request ? { [requestPath]: request } : {}),
        ...seedBundle(bundle),
      });

      await runDirectAuthDelete(fake);

      assert.equal(fake.read(bundle.paths.notePath).status, "deleted");
      assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), true);
      if (request) {
        assert.deepEqual(fake.read(requestPath), request);
      } else {
        assert.equal(fake.has(requestPath), false);
      }
    });
  }
});

test("direct Auth deletion and the normal request worker are idempotent in either order", async (t) => {
  for (const first of ["auth-delete", "request-worker"]) {
    await t.test(first, async () => {
      const bundle = buildPrivateNoteDocuments();
      const requestPath = `accountDeletionRequests/${UID}`;
      const request = { uid: UID, status: "processing", opaque: "retain-me" };
      const fake = makeFirestore({
        [requestPath]: request,
        ...seedBundle(bundle),
      });

      if (first === "auth-delete") {
        await runDirectAuthDelete(fake);
        await runCleanup(fake);
      } else {
        await runCleanup(fake);
        await runDirectAuthDelete(fake);
      }

      assert.equal(fake.read(bundle.paths.notePath).status, "deleted");
      assert.equal(fake.read(bundle.paths.rootPath).privateNotePrivacyRevision, 5);
      assert.equal(fake.has(bundle.paths.projectionPath), false);
      assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), true);
      assert.deepEqual(fake.read(requestPath), request);
    });
  }
});

test("direct Auth deletion reconciles barrier write ambiguity without exposing identity", async (t) => {
  const cases = [
    {
      name: "definitive barrier pre-commit failure",
      options: { preCommitFailureCalls: [1] },
      expectedBarrierTransactions: 2,
    },
    {
      name: "committed barrier-create response loss",
      options: { postCommitFailureCalls: [1] },
      expectedBarrierTransactions: 1,
    },
  ];
  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const bundle = buildPrivateNoteDocuments();
      const fake = makeFirestore(seedBundle(bundle), testCase.options);

      await runDirectAuthDelete(fake);

      assert.equal(
        fake.transactionLog.filter((operations) =>
          operations.some(
            ({ kind, path }) => kind === "set" && path === AUTH_DELETE_BARRIER_PATH,
          ),
        ).length,
        testCase.expectedBarrierTransactions,
      );
      assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), true);
      assert.equal(fake.read(bundle.paths.notePath).status, "deleted");
      assert.equal(fake.read(bundle.paths.rootPath).privateNotePrivacyRevision, 5);
      assert.equal(JSON.stringify(fake.entries()).includes(UID), false);
      assert.equal(
        JSON.stringify(fake.entries()).includes("private account deletion fixture"),
        false,
      );
    });
  }
});

test("direct Auth deletion retains its barrier across a failed cleanup and resumes with its original timestamp", async () => {
  const bundle = buildPrivateNoteDocuments();
  const invalidReceipt = { ...bundle.receipt, instanceId: uuid(901) };
  const fake = makeFirestore({
    ...seedBundle(bundle),
    [bundle.paths.receiptPath]: invalidReceipt,
  });

  await assert.rejects(
    runDirectAuthDelete(fake),
    (error) => error?.code === "diamond-private-note-integrity-failed",
  );
  assert.deepEqual(fake.read(AUTH_DELETE_BARRIER_PATH), {
    schemaVersion: 1,
    type: "diamond-private-note-auth-delete-barrier",
    status: "auth-deleted",
    startedAt: REDACTED_AT,
  });
  assert.deepEqual(fake.read(bundle.paths.notePath), bundle.note);
  assert.ok(fake.read(bundle.paths.projectionPath));

  fake.write(bundle.paths.receiptPath, bundle.receipt);
  await runDirectAuthDelete(fake, {
    context: { timestamp: "2026-09-10T12:00:00.000Z" },
  });

  assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), true);
  assert.equal(fake.read(bundle.paths.notePath).status, "deleted");
  assert.equal(fake.read(bundle.paths.notePath).redactedAt, REDACTED_AT);
});

test("direct Auth deletion retires a same-boundary Diamond generation and restores exact activation before-images", async () => {
  const fixture = buildRetiringActivationGeneration();
  const fake = makeFirestore(fixture.documents, {
    commitMetadata: fixture.commitMetadata,
  });

  await runDirectAuthDelete(fake);

  assert.equal(fake.has(fixture.scorebookPath), false);
  assert.equal(fake.has(fixture.eventPath), false);
  assert.equal(fake.has(fixture.provenancePath), false);
  assert.equal(fake.has(`${fixture.scorebookPath}/projections/current`), false);
  assert.equal(fake.has(`${fixture.gamePath}/diamondPublic/state`), false);
  assert.equal(fake.has(`${fixture.gamePath}/diamondPublic/replay`), false);
  assert.equal(fake.has(fixture.statRootPath), false);
  assert.equal(fake.has(`${fixture.statRootPath}/publicPlayerStats/player-old`), false);
  assert.equal(fake.has(fixture.liveRootPath), false);
  assert.equal(fake.has(fixture.liveChatPath), false);
  assert.equal(fake.has(fixture.siblingPath), false);
  assert.equal(fake.has(fixture.notificationPath), true);
  assert.deepEqual(fake.read(fixture.gamePath), {
    id: fixture.gameId,
    opaqueGameField: "keep-game",
    ...fixture.gameBefore,
  });
  assert.deepEqual(fake.read(fixture.sharedPath), {
    opaqueSharedField: "keep-shared",
    ...fixture.sharedBefore,
  });
  const terminalTasks = Object.entries(fake.entries()).filter(([path]) =>
    path.startsWith(`${AUTH_DELETE_BARRIER_PATH}/diamondReconciliations/`),
  );
  assert.equal(terminalTasks.length, 1);
  assert.deepEqual(Object.keys(terminalTasks[0][1]).sort(), [
    "completedAt",
    "outcome",
    "receiptHash",
    "schemaVersion",
    "status",
    "taskId",
    "type",
  ]);
  assert.equal(terminalTasks[0][1].status, "complete");
  assert.equal(terminalTasks[0][1].outcome, "generation-retired");
  assert.equal(JSON.stringify(fake.entries()).includes(UID), false);
});

test("direct Auth deletion discovers private sidecars and scorer-handoff targets without event actor identity", async (t) => {
  for (const kind of ["private-note", "handoff-target"]) {
    await t.test(kind, async () => {
      const fixture = buildIndirectRetiringGeneration(kind);
      const fake = makeFirestore(fixture.documents, {
        commitMetadata: fixture.commitMetadata,
      });

      await runDirectAuthDelete(fake);

      assert.equal(fake.has(fixture.scorebookPath), false);
      assert.equal(fake.has(fixture.sourceEventPath), false);
      if (fixture.notePath) assert.equal(fake.has(fixture.notePath), false);
      const sourceQuery = kind === "private-note"
        ? { collectionId: "notes", field: "authorUid" }
        : { collectionId: "events", field: "payload.toUid" };
      assert.ok(
        fake.queryLog.some(
          (entry) =>
            entry.collectionId === sourceQuery.collectionId &&
            entry.field === sourceQuery.field &&
            entry.paths.includes(kind === "private-note" ? fixture.notePath : fixture.sourceEventPath),
        ),
      );
    });
  }
});

test("Diamond generation retirement resumes bounded inventory and deletion without early restoration", async () => {
  const fixture = buildRetiringActivationGeneration();
  const fake = makeFirestore(fixture.documents, {
    commitMetadata: fixture.commitMetadata,
  });
  const bounded = {
    handlerOptions: {
      reconciliationInventoryPageBudget: 1,
      reconciliationInventoryPageSize: 1,
    },
  };

  await assert.rejects(
    runDirectAuthDelete(fake, bounded),
    (error) => error?.code === "unavailable",
  );
  const fencedRoot = fake.read(fixture.scorebookPath);
  assert.equal(fencedRoot.authDeleteReconciliation.status, "retiring");
  assert.match(
    fake.read(fixture.gamePath).diamondScorebookInstanceId,
    /^auth-delete-[a-f0-9]{64}$/,
  );
  assert.equal(fake.has(fixture.eventPath), true);
  assert.equal(fake.read(fixture.gamePath).status, undefined);
  const activeTask = Object.values(fake.entries()).find(
    (value) => value?.type === "diamond-auth-delete-reconciliation" && value.status === "retiring",
  );
  assert.equal(activeTask.artifactInventory.status, "scanning");

  const attempts = await runDirectAuthDeleteUntilComplete(fake, bounded);
  assert.ok(attempts > 2);
  assert.equal(fake.has(fixture.scorebookPath), false);
  assert.equal(fake.has(fixture.eventPath), false);
  assert.equal(fake.has(fixture.notificationPath), true);
  assert.deepEqual(fake.read(fixture.gamePath), {
    id: fixture.gameId,
    opaqueGameField: "keep-game",
    ...fixture.gameBefore,
  });
});

test("Diamond retirement preserves later shared-game winners and tolerates later absence", async (t) => {
  const cases = [
    {
      name: "activation-created shared projection remains sentinel-owned",
      fixture: buildRetiringActivationGeneration({ sharedExisted: false }),
      mutate() {},
      expected: null,
    },
    {
      name: "absent then later valid create",
      fixture: buildRetiringActivationGeneration({
        sharedExisted: false,
        seedShared: false,
      }),
      mutate(fake, fixture) {
        fake.write(fixture.sharedPath, {
          trackingEngine: "diamond-v2",
          diamondSourceTeamId: "team-later",
          diamondSourceGameId: "game-later",
          diamondScorebookInstanceId: uuid(990),
          homeScore: 4,
          laterWinner: true,
        });
      },
      expected: { laterWinner: true },
    },
    {
      name: "sentinel then later valid replacement",
      fixture: buildRetiringActivationGeneration(),
      mutate(fake, fixture) {
        fake.write(fixture.sharedPath, {
          trackingEngine: "diamond-v2",
          diamondSourceTeamId: "team-later",
          diamondSourceGameId: "game-later",
          diamondScorebookInstanceId: uuid(991),
          homeScore: 5,
          laterWinner: true,
        });
      },
      expected: { laterWinner: true },
    },
    {
      name: "sentinel then later deletion",
      fixture: buildRetiringActivationGeneration(),
      mutate(fake, fixture) {
        fake.remove(fixture.sharedPath);
      },
      expected: null,
    },
  ];
  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const fake = makeFirestore(testCase.fixture.documents, {
        commitMetadata: testCase.fixture.commitMetadata,
      });
      const bounded = {
        handlerOptions: {
          reconciliationInventoryPageBudget: 1,
          reconciliationInventoryPageSize: 1,
        },
      };
      await assert.rejects(
        runDirectAuthDelete(fake, bounded),
        (error) => error?.code === "unavailable",
      );
      testCase.mutate(fake, testCase.fixture);

      await runDirectAuthDeleteUntilComplete(fake, bounded);

      if (testCase.expected === null) {
        assert.equal(fake.has(testCase.fixture.sharedPath), false);
      } else {
        assert.equal(fake.read(testCase.fixture.sharedPath).laterWinner, true);
      }
      assert.equal(fake.has(testCase.fixture.scorebookPath), false);
    });
  }
});

test("Diamond retirement preserves a deleted or replaced game after sentinel withdrawal", async (t) => {
  const cases = [
    {
      name: "sentinel then manager deletion",
      mutate(fake, fixture) {
        fake.remove(fixture.gamePath);
      },
      expected: null,
    },
    {
      name: "sentinel then later legacy game replacement",
      mutate(fake, fixture) {
        fake.write(fixture.gamePath, {
          id: fixture.gameId,
          trackingEngine: "legacy-v1",
          laterWinner: true,
        });
      },
      expected: { laterWinner: true },
    },
    {
      name: "sentinel then later Diamond activation replacement",
      mutate(fake, fixture) {
        fake.write(fixture.gamePath, {
          id: fixture.gameId,
          trackingEngine: "diamond-v2",
          diamondScorebookInstanceId: uuid(992),
          laterWinner: true,
        });
      },
      expected: { laterWinner: true },
    },
    {
      name: "sentinel then exact old-generation rewrite",
      mutate(fake, fixture) {
        fake.write(fixture.gamePath, {
          id: fixture.gameId,
          trackingEngine: "diamond-v2",
          diamondScorebookInstanceId: fixture.instanceId,
          unsafeOldGenerationRewrite: true,
        });
      },
      rejects: true,
    },
  ];
  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const fixture = buildRetiringActivationGeneration();
      const fake = makeFirestore(fixture.documents, {
        commitMetadata: fixture.commitMetadata,
      });
      const bounded = {
        handlerOptions: {
          reconciliationInventoryPageBudget: 1,
          reconciliationInventoryPageSize: 1,
        },
      };
      await assert.rejects(
        runDirectAuthDelete(fake, bounded),
        (error) => error?.code === "unavailable",
      );
      testCase.mutate(fake, fixture);

      if (testCase.rejects) {
        await assert.rejects(
          runDirectAuthDeleteUntilComplete(fake, bounded),
          (error) => error?.code === "diamond-private-note-integrity-failed",
        );
        assert.equal(fake.has(fixture.scorebookPath), true);
        assert.equal(fake.read(fixture.gamePath).unsafeOldGenerationRewrite, true);
        return;
      }

      await runDirectAuthDeleteUntilComplete(fake, bounded);

      if (testCase.expected === null) {
        assert.equal(fake.has(fixture.gamePath), false);
      } else {
        assert.equal(fake.read(fixture.gamePath).laterWinner, true);
      }
      assert.equal(fake.has(fixture.scorebookPath), false);
      assert.equal(fake.has(fixture.eventPath), false);
    });
  }
});

test("direct Auth deletion fails closed on same-millisecond mutation and missing commit evidence", async (t) => {
  for (const testCase of [
    {
      name: "different timestamp nanoseconds",
      fixture: buildRetiringActivationGeneration({
        sourceCreateNanosecondOffset: 1,
        sourceUpdateNanosecondOffset: 2,
      }),
      prepare() {},
    },
    {
      name: "missing commit metadata",
      fixture: buildRetiringActivationGeneration(),
      prepare(fake, fixture) {
        fake.removeMetadata(fixture.eventPath);
      },
    },
  ]) {
    await t.test(testCase.name, async () => {
      const fake = makeFirestore(testCase.fixture.documents, {
        commitMetadata: testCase.fixture.commitMetadata,
      });
      testCase.prepare(fake, testCase.fixture);

      await assert.rejects(
        runDirectAuthDelete(fake),
        (error) => error?.code === "diamond-private-note-integrity-failed",
      );

      assert.equal(fake.has(testCase.fixture.scorebookPath), true);
      assert.equal(
        fake.read(testCase.fixture.scorebookPath).authDeleteReconciliation,
        undefined,
      );
      assert.equal(fake.has(testCase.fixture.eventPath), true);
    });
  }
});

test("direct Auth deletion restores or splices exact Diamond configuration provenance", async (t) => {
  const teamId = "team-config";
  const requestId = uuid(500);
  const successorId = uuid(501);
  const priorSettings = {
    configuredBy: "active-prior-manager",
    mode: "dark",
    rulesProfileId: "baseball-nfhs",
    explicitNull: null,
  };
  const settings = configurationSettings({
    configuredBy: UID,
    requestId,
    mode: "dark",
    rulesProfileId: "baseball-youth",
  });
  const requestPath = `teams/${teamId}/diamondConfigurationRequests/${requestId}`;
  for (const testCase of [
    {
      name: "matching current config",
      team: { diamondScorebook: settings, updatedAt: "later-authoritative-time" },
      beforeImage: { present: true, value: priorSettings },
      expectedConfig: priorSettings,
    },
    {
      name: "later manager config",
      successor: true,
      expectedConfig: configurationSettings({
        configuredBy: "active-manager",
        requestId: successorId,
        chainId: requestId,
        ordinal: 2,
        mode: "dark",
      }),
    },
    {
      name: "explicit null prior config",
      team: { diamondScorebook: settings, updatedAt: "later-authoritative-time" },
      beforeImage: { present: true, value: null },
      expectedConfig: null,
    },
    { name: "missing team", team: null, expectedConfig: undefined },
  ]) {
    await t.test(testCase.name, async () => {
      const beforeImage = testCase.beforeImage || {
        present: true,
        value: priorSettings,
      };
      const request = configurationReceipt({
        teamId,
        requestId,
        requestedBy: UID,
        settings,
        beforeImage,
        nextRequestId: testCase.successor ? successorId : null,
      });
      const successorPath =
        `teams/${teamId}/diamondConfigurationRequests/${successorId}`;
      const successor = testCase.successor
        ? configurationReceipt({
            teamId,
            requestId: successorId,
            requestedBy: "active-manager",
            settings: testCase.expectedConfig,
            beforeImage: { present: true, value: settings },
            chainId: requestId,
            ordinal: 2,
            previousRequestId: requestId,
            requestHash: `sha256:${"c".repeat(64)}`,
          })
        : null;
      const team = testCase.successor
        ? {
            diamondScorebook: testCase.expectedConfig,
            updatedAt: "later-authoritative-time",
          }
        : testCase.team;
      const fake = makeFirestore(
        {
          [requestPath]: request,
          ...(successor ? { [successorPath]: successor } : {}),
          ...(team ? { [`teams/${teamId}`]: team } : {}),
        },
        {
          commitMetadata: {
            [requestPath]: {
              createMs: Date.parse(REDACTED_AT),
              updateMs: Date.parse(REDACTED_AT),
            },
          },
        },
      );

      await runDirectAuthDelete(fake);

      assert.equal(fake.has(requestPath), false);
      if (!team) {
        assert.equal(fake.has(`teams/${teamId}`), false);
      } else {
        assert.deepEqual(
          fake.read(`teams/${teamId}`).diamondScorebook,
          testCase.expectedConfig,
        );
        assert.equal(
          fake.read(`teams/${teamId}`).updatedAt,
          "later-authoritative-time",
        );
      }
      if (successor) {
        const rewired = fake.read(successorPath);
        assert.equal(rewired.lineage.previousRequestId, null);
        assert.deepEqual(rewired.lineage.beforeImage, beforeImage);
        assert.equal(
          rewired.lineage.beforeImageHash,
          domainEngine.hashDiamondValue(beforeImage),
        );
      }
    });
  }
});

test("direct Auth configuration cleanup is order-independent and resumes a deleted-principal chain", async (t) => {
  await t.test("splices the lexical-first stale predecessor before restoring the head", async () => {
    const teamId = "team-config-chain-order";
    const chainId = uuid(520);
    const firstStaleId = uuid(521);
    const currentStaleId = uuid(522);
    const baselineSettings = configurationSettings({
      configuredBy: "active-baseline-manager",
      requestId: chainId,
      mode: "baseline-dark",
    });
    const firstStaleSettings = configurationSettings({
      configuredBy: UID,
      requestId: firstStaleId,
      chainId,
      ordinal: 2,
      mode: "stale-one",
    });
    const currentStaleSettings = configurationSettings({
      configuredBy: UID,
      requestId: currentStaleId,
      chainId,
      ordinal: 3,
      mode: "stale-two",
    });
    const baselinePath = `teams/${teamId}/diamondConfigurationRequests/${chainId}`;
    const firstStalePath =
      `teams/${teamId}/diamondConfigurationRequests/${firstStaleId}`;
    const currentStalePath =
      `teams/${teamId}/diamondConfigurationRequests/${currentStaleId}`;
    const fake = makeFirestore(
      {
        [`teams/${teamId}`]: {
          diamondScorebook: currentStaleSettings,
          opaque: "preserve-team",
        },
        [baselinePath]: configurationReceipt({
          teamId,
          requestId: chainId,
          requestedBy: "active-baseline-manager",
          settings: baselineSettings,
          nextRequestId: firstStaleId,
          requestHash: `sha256:${"1".repeat(64)}`,
        }),
        [firstStalePath]: configurationReceipt({
          teamId,
          requestId: firstStaleId,
          requestedBy: UID,
          settings: firstStaleSettings,
          beforeImage: { present: true, value: baselineSettings },
          chainId,
          ordinal: 2,
          previousRequestId: chainId,
          nextRequestId: currentStaleId,
          requestHash: `sha256:${"2".repeat(64)}`,
        }),
        [currentStalePath]: configurationReceipt({
          teamId,
          requestId: currentStaleId,
          requestedBy: UID,
          settings: currentStaleSettings,
          beforeImage: { present: true, value: firstStaleSettings },
          chainId,
          ordinal: 3,
          previousRequestId: firstStaleId,
          requestHash: `sha256:${"3".repeat(64)}`,
        }),
      },
      {
        commitMetadata: {
          [firstStalePath]: {
            createMs: Date.parse(REDACTED_AT),
            updateMs: Date.parse(REDACTED_AT) + 1,
          },
          [currentStalePath]: {
            createMs: Date.parse(REDACTED_AT),
            updateMs: Date.parse(REDACTED_AT) + 2,
          },
        },
      },
    );

    await runDirectAuthDelete(fake);

    assert.deepEqual(fake.read(`teams/${teamId}`).diamondScorebook, baselineSettings);
    assert.equal(fake.read(`teams/${teamId}`).opaque, "preserve-team");
    assert.equal(fake.has(firstStalePath), false);
    assert.equal(fake.has(currentStalePath), false);
    assert.equal(fake.read(baselinePath).lineage.nextRequestId, null);
    const configurationQuery = fake.queryLog.find(
      (entry) => entry.collectionId === "diamondConfigurationRequests",
    );
    assert.deepEqual(configurationQuery.paths, [firstStalePath, currentStalePath]);
  });

  await t.test("keeps the team dark while a bounded deleted-predecessor walk resumes", async () => {
    const teamId = "team-config-chain-resume";
    const chainId = uuid(630);
    const firstStaleId = uuid(633);
    const secondStaleId = uuid(632);
    const currentStaleId = uuid(631);
    const baselineSettings = configurationSettings({
      configuredBy: "active-baseline-manager",
      requestId: chainId,
      mode: "baseline-dark",
    });
    const firstStaleSettings = configurationSettings({
      configuredBy: UID,
      requestId: firstStaleId,
      chainId,
      ordinal: 2,
      mode: "stale-one",
    });
    const secondStaleSettings = configurationSettings({
      configuredBy: UID,
      requestId: secondStaleId,
      chainId,
      ordinal: 3,
      mode: "stale-two",
    });
    const currentStaleSettings = configurationSettings({
      configuredBy: UID,
      requestId: currentStaleId,
      chainId,
      ordinal: 4,
      mode: "stale-three",
    });
    const baselinePath = `teams/${teamId}/diamondConfigurationRequests/${chainId}`;
    const firstStalePath =
      `teams/${teamId}/diamondConfigurationRequests/${firstStaleId}`;
    const secondStalePath =
      `teams/${teamId}/diamondConfigurationRequests/${secondStaleId}`;
    const currentStalePath =
      `teams/${teamId}/diamondConfigurationRequests/${currentStaleId}`;
    const repairPath = `teams/${teamId}/diamondConfigurationRepairs/current`;
    const seed = {
      [AUTH_DELETE_BARRIER_PATH]: {
        schemaVersion: 1,
        type: "diamond-private-note-auth-delete-barrier",
        status: "auth-deleted",
        startedAt: REDACTED_AT,
      },
      [`teams/${teamId}`]: { diamondScorebook: currentStaleSettings },
      [baselinePath]: configurationReceipt({
        teamId,
        requestId: chainId,
        requestedBy: "active-baseline-manager",
        settings: baselineSettings,
        nextRequestId: firstStaleId,
        requestHash: `sha256:${"4".repeat(64)}`,
      }),
      [firstStalePath]: configurationReceipt({
        teamId,
        requestId: firstStaleId,
        requestedBy: UID,
        settings: firstStaleSettings,
        beforeImage: { present: true, value: baselineSettings },
        chainId,
        ordinal: 2,
        previousRequestId: chainId,
        nextRequestId: secondStaleId,
        requestHash: `sha256:${"5".repeat(64)}`,
      }),
      [secondStalePath]: configurationReceipt({
        teamId,
        requestId: secondStaleId,
        requestedBy: UID,
        settings: secondStaleSettings,
        beforeImage: { present: true, value: firstStaleSettings },
        chainId,
        ordinal: 3,
        previousRequestId: firstStaleId,
        nextRequestId: currentStaleId,
        requestHash: `sha256:${"6".repeat(64)}`,
      }),
      [currentStalePath]: configurationReceipt({
        teamId,
        requestId: currentStaleId,
        requestedBy: UID,
        settings: currentStaleSettings,
        beforeImage: { present: true, value: secondStaleSettings },
        chainId,
        ordinal: 4,
        previousRequestId: secondStaleId,
        requestHash: `sha256:${"7".repeat(64)}`,
      }),
    };
    for (const [source, collectionGroup, field] of [
      ["events-actor", "events", "actorUid"],
      ["events-handoff", "events", "payload.toUid"],
      ["notes-author", "notes", "authorUid"],
      ["live-chat-sender", "chat", "senderId"],
      ["live-reactions-sender", "reactions", "senderId"],
      ["moderation-before-image-sender", "moderationBeforeImages", "senderId"],
      ["moderation-receipt-moderator", "audit", "moderatorUid"],
      ["regeneration-audit", "audit", "actorUid"],
    ]) {
      seed[`${AUTH_DELETE_BARRIER_PATH}/diamondReconciliationScans/${source}`] = {
        schemaVersion: 1,
        type: "diamond-auth-delete-scan",
        source,
        collectionGroup,
        field,
        status: "complete",
        cursorPath: null,
        epoch: 0,
        startedAt: REDACTED_AT,
      };
    }
    const commitMetadata = Object.fromEntries(
      [firstStalePath, secondStalePath, currentStalePath].map((path, index) => [
        path,
        {
          createMs: Date.parse(REDACTED_AT),
          updateMs: Date.parse(REDACTED_AT) + index + 1,
        },
      ]),
    );
    const fake = makeFirestore(seed, { commitMetadata });
    const bounded = {
      handlerOptions: { reconciliationInventoryPageBudget: 1 },
    };

    await assert.rejects(
      runDirectAuthDelete(fake, bounded),
      (error) => error?.code === "unavailable",
    );

    assert.equal(
      Object.prototype.hasOwnProperty.call(
        fake.read(`teams/${teamId}`),
        "diamondScorebook",
      ),
      false,
      "no deleted principal may be exposed between repair attempts",
    );
    assert.equal(fake.read(repairPath).cursorRequestId, firstStaleId);
    assert.equal(fake.has(currentStalePath), true, "the repair anchor stays durable");
    assert.equal(fake.has(secondStalePath), false);

    await runDirectAuthDelete(fake, bounded);

    assert.deepEqual(fake.read(`teams/${teamId}`).diamondScorebook, baselineSettings);
    assert.equal(fake.has(repairPath), false);
    assert.equal(fake.has(firstStalePath), false);
    assert.equal(fake.has(secondStalePath), false);
    assert.equal(fake.has(currentStalePath), false);
    assert.equal(fake.read(baselinePath).lineage.nextRequestId, null);
  });
});

test("direct Auth deletion removes exact Diamond live interactions and preserves a replacement winner", async () => {
  const teamId = "team-live-cleanup";
  const gameId = "game-live-cleanup";
  const instanceId = uuid(710);
  const chatPath =
    `teams/${teamId}/games/${gameId}/diamondLiveGenerations/${instanceId}/chat/diamond-chat-${"a".repeat(64)}`;
  const reactionPath =
    `teams/${teamId}/games/${gameId}/diamondLiveGenerations/${instanceId}/reactions/diamond-reaction-${"b".repeat(64)}`;
  const replacementPath =
    `teams/${teamId}/games/${gameId}/diamondLiveGenerations/${instanceId}/chat/diamond-chat-${"c".repeat(64)}`;
  const unrelatedPath = "accounts/example/chat/unrelated";
  const chat = {
    schemaVersion: 1,
    trackingEngine: "diamond-v2",
    teamId,
    gameId,
    instanceId,
    text: "Delete my message",
    senderId: UID,
    senderName: "Deleted User",
    senderPhotoUrl: null,
    isAnonymous: false,
    createdAt: "2026-09-08T11:00:00.000Z",
  };
  const replacement = {
    ...chat,
    text: "Replacement winner",
    senderId: "active-user",
    senderName: "Active User",
  };
  const fake = makeFirestore(
    {
      [chatPath]: chat,
      [replacementPath]: chat,
      [reactionPath]: {
        schemaVersion: 1,
        trackingEngine: "diamond-v2",
        teamId,
        gameId,
        instanceId,
        type: "clap",
        senderId: UID,
        createdAt: "2026-09-08T11:00:00.000Z",
      },
      [unrelatedPath]: { senderId: UID, text: "outside Diamond" },
    },
    {
      async afterQuerySnapshotHook({ scope, source, paths }) {
        if (
          scope === "group" &&
          source === "chat" &&
          paths.includes(replacementPath)
        ) {
          fake.write(replacementPath, replacement);
        }
      },
    },
  );

  await runDirectAuthDelete(fake);

  assert.equal(fake.has(chatPath), false);
  assert.equal(fake.has(reactionPath), false);
  assert.deepEqual(fake.read(replacementPath), replacement);
  assert.deepEqual(fake.read(unrelatedPath), {
    senderId: UID,
    text: "outside Diamond",
  });
});

test("direct Auth deletion restores an exact post-delete moderation before-image", async () => {
  const fixture = buildModerationProof({ lifecycle: "final" });
  const fake = makeFirestore(fixture.documents, {
    commitMetadata: fixture.commitMetadata,
  });

  await runDirectAuthDelete(fake);

  assert.deepEqual(fake.read(fixture.paths.outputPath), fixture.beforeImage);
  assert.equal(fake.has(fixture.paths.receiptPath), false);
  assert.equal(fake.has(fixture.paths.beforeImagePath), false);
  assert.equal(fake.has(fixture.paths.targetPath), false);
  assert.ok(fake.queryLog.some(
    (entry) => entry.collectionId === "audit" && entry.field === "moderatorUid",
  ));
});

test("moderation rollback preserves replacement, later moderation, and generation winners", async (t) => {
  await t.test("replacement chat", async () => {
    const fixture = buildModerationProof();
    const replacement = {
      ...fixture.beforeImage,
      senderId: "replacement.sender:3",
      senderName: "Replacement Sender",
      text: "Later replacement wins",
    };
    let fake;
    let replaced = false;
    fake = makeFirestore(fixture.documents, {
      commitMetadata: fixture.commitMetadata,
      async afterQuerySnapshotHook({ source, filters, paths }) {
        if (
          !replaced
          && source === "audit"
          && filters.some((filter) =>
            filter.field === "moderatorUid" && filter.value === UID)
          && paths.includes(fixture.paths.receiptPath)
        ) {
          replaced = true;
          fake.write(fixture.paths.outputPath, replacement);
        }
      },
    });

    await runDirectAuthDelete(fake);

    assert.deepEqual(fake.read(fixture.paths.outputPath), replacement);
    assert.equal(fake.has(fixture.paths.receiptPath), false);
    assert.equal(fake.has(fixture.paths.beforeImagePath), false);
    assert.equal(fake.has(fixture.paths.targetPath), false);
  });

  await t.test("later moderation marker", async () => {
    const fixture = buildModerationProof();
    const laterTarget = {
      ...fixture.documents[fixture.paths.targetPath],
      receiptId: `engagement-moderation-receipt-${"f".repeat(64)}`,
      requestHash: `sha256:${"e".repeat(64)}`,
    };
    const fake = makeFirestore({
      ...fixture.documents,
      [fixture.paths.targetPath]: laterTarget,
    }, { commitMetadata: fixture.commitMetadata });

    await runDirectAuthDelete(fake);

    assert.equal(fake.has(fixture.paths.outputPath), false);
    assert.deepEqual(fake.read(fixture.paths.targetPath), laterTarget);
    assert.equal(fake.has(fixture.paths.receiptPath), false);
    assert.equal(fake.has(fixture.paths.beforeImagePath), false);
  });

  await t.test("later generation", async () => {
    const fixture = buildModerationProof();
    const laterInstanceId = uuid(729);
    const laterGame = {
      trackingEngine: "diamond-v2",
      diamondScorebookInstanceId: laterInstanceId,
    };
    const laterRoot = {
      schemaVersion: 2,
      trackingEngine: "diamond-v2",
      teamId: fixture.teamId,
      gameId: fixture.gameId,
      instanceId: laterInstanceId,
    };
    const fake = makeFirestore({
      ...fixture.documents,
      [fixture.paths.gamePath]: laterGame,
      [fixture.paths.scorebookPath]: laterRoot,
    }, { commitMetadata: fixture.commitMetadata });

    await runDirectAuthDelete(fake);

    assert.equal(fake.has(fixture.paths.outputPath), false);
    assert.deepEqual(fake.read(fixture.paths.gamePath), laterGame);
    assert.deepEqual(fake.read(fixture.paths.scorebookPath), laterRoot);
    assert.equal(fake.has(fixture.paths.receiptPath), false);
    assert.equal(fake.has(fixture.paths.beforeImagePath), false);
    assert.equal(fake.has(fixture.paths.targetPath), false);
  });
});

test("moderation rollback never restores content owned by a deleting sender", async (t) => {
  for (const marker of ["request", "auth", "audit"]) {
    await t.test(marker, async () => {
      const fixture = buildModerationProof();
      const senderMarkerPath = marker === "request"
        ? `accountDeletionRequests/${fixture.senderId}`
        : marker === "auth"
          ? `accountDiamondPrivateNoteAuthDeleteBarriers/${privateNoteCore.buildDiamondPrivateNoteAuthDeleteBarrierId(fixture.senderId)}`
          : `accountDeletionAudit/${crypto.createHash("sha256").update(fixture.senderId).digest("hex")}`;
      const fake = makeFirestore({
        ...fixture.documents,
        [senderMarkerPath]: { status: "deleting" },
      }, { commitMetadata: fixture.commitMetadata });

      await runDirectAuthDelete(fake);

      assert.equal(fake.has(fixture.paths.outputPath), false);
      assert.equal(fake.has(fixture.paths.receiptPath), false);
      assert.equal(fake.has(fixture.paths.beforeImagePath), false);
      assert.equal(fake.has(fixture.paths.targetPath), false);
    });
  }
});

test("moderation cleanup rejects missing or mutable rollback evidence", async (t) => {
  await t.test("missing late before-image", async () => {
    const fixture = buildModerationProof();
    delete fixture.documents[fixture.paths.beforeImagePath];
    delete fixture.commitMetadata[fixture.paths.beforeImagePath];
    const fake = makeFirestore(fixture.documents, {
      commitMetadata: fixture.commitMetadata,
    });

    await assert.rejects(
      runDirectAuthDelete(fake),
      (error) => error?.code === "diamond-private-note-integrity-failed",
    );
    assert.equal(fake.has(fixture.paths.outputPath), false);
    assert.equal(fake.has(fixture.paths.receiptPath), true);
    assert.equal(fake.has(fixture.paths.targetPath), true);
  });

  await t.test("same-millisecond receipt mutation", async () => {
    const fixture = buildModerationProof({
      receiptCreateNanosecondOffset: 1,
      receiptUpdateNanosecondOffset: 2,
    });
    const fake = makeFirestore(fixture.documents, {
      commitMetadata: fixture.commitMetadata,
    });

    await assert.rejects(
      runDirectAuthDelete(fake),
      (error) => error?.code === "diamond-private-note-integrity-failed",
    );
    assert.equal(fake.has(fixture.paths.receiptPath), true);
    assert.equal(fake.has(fixture.paths.beforeImagePath), true);
  });

  await t.test("receipt and image commit mismatch", async () => {
    const fixture = buildModerationProof({ imageCreateNanosecondOffset: 1 });
    const fake = makeFirestore(fixture.documents, {
      commitMetadata: fixture.commitMetadata,
    });

    await assert.rejects(
      runDirectAuthDelete(fake),
      (error) => error?.code === "diamond-private-note-integrity-failed",
    );
    assert.equal(fake.has(fixture.paths.receiptPath), true);
    assert.equal(fake.has(fixture.paths.beforeImagePath), true);
    assert.equal(fake.has(fixture.paths.outputPath), false);
  });
});

test("pre-boundary and account-request moderation cleanup scrub evidence without restoration", async (t) => {
  await t.test("pre-boundary direct Auth receipt", async () => {
    const fixture = buildModerationProof({
      commitMs: Date.parse(REDACTED_AT) - 1,
    });
    const fake = makeFirestore(fixture.documents, {
      commitMetadata: fixture.commitMetadata,
    });

    await runDirectAuthDelete(fake);

    assert.equal(fake.has(fixture.paths.outputPath), false);
    assert.equal(fake.has(fixture.paths.receiptPath), false);
    assert.equal(fake.has(fixture.paths.beforeImagePath), false);
    assert.equal(fake.has(fixture.paths.targetPath), false);
  });

  await t.test("normal queued deletion", async () => {
    const fixture = buildModerationProof();
    const fake = makeFirestore({
      ...fixture.documents,
      [`accountDeletionRequests/${UID}`]: { uid: UID, status: "processing" },
    }, { commitMetadata: fixture.commitMetadata });

    await runCleanup(fake);

    assert.equal(fake.has(fixture.paths.outputPath), false);
    assert.equal(fake.has(fixture.paths.receiptPath), false);
    assert.equal(fake.has(fixture.paths.beforeImagePath), false);
    assert.equal(fake.has(fixture.paths.targetPath), false);
  });
});

test("normal sender cleanup removes copied chat content and preserves a replacement sidecar", async (t) => {
  await t.test("exact sender copy", async () => {
    const fixture = buildModerationProof({
      moderatorUid: "active.moderator:9",
      senderId: UID,
    });
    const fake = makeFirestore({
      ...fixture.documents,
      [`accountDeletionRequests/${UID}`]: { uid: UID, status: "processing" },
    }, { commitMetadata: fixture.commitMetadata });

    await runCleanup(fake);

    assert.equal(fake.has(fixture.paths.beforeImagePath), false);
    assert.equal(fake.has(fixture.paths.receiptPath), false);
    assert.equal(fake.has(fixture.paths.targetPath), false);
  });

  await t.test("replacement winner", async () => {
    const fixture = buildModerationProof({
      moderatorUid: "active.moderator:9",
      senderId: UID,
    });
    const replacement = {
      ...fixture.documents[fixture.paths.beforeImagePath],
      senderId: "active.sender:10",
      beforeImage: {
        ...fixture.beforeImage,
        senderId: "active.sender:10",
        senderName: "Active Replacement",
      },
    };
    let fake;
    let replaced = false;
    fake = makeFirestore({
      ...fixture.documents,
      [`accountDeletionRequests/${UID}`]: { uid: UID, status: "processing" },
    }, {
      commitMetadata: fixture.commitMetadata,
      async afterQuerySnapshotHook({ source, filters, paths }) {
        if (
          !replaced
          && source === "moderationBeforeImages"
          && filters.some((filter) =>
            filter.field === "senderId" && filter.value === UID)
          && paths.includes(fixture.paths.beforeImagePath)
        ) {
          replaced = true;
          fake.write(fixture.paths.beforeImagePath, replacement);
        }
      },
    });

    await runCleanup(fake);

    assert.deepEqual(fake.read(fixture.paths.beforeImagePath), replacement);
    assert.equal(fake.has(fixture.paths.receiptPath), true);
    assert.equal(fake.has(fixture.paths.targetPath), true);
  });
});

test("direct Auth moderation discovery durably resumes after a bounded receipt page", async () => {
  const seed = {
    [AUTH_DELETE_BARRIER_PATH]: {
      schemaVersion: 1,
      type: "diamond-private-note-auth-delete-barrier",
      status: "auth-deleted",
      startedAt: REDACTED_AT,
    },
  };
  const commitMetadata = {};
  const receiptPaths = [];
  for (let index = 0; index < 250; index += 1) {
    const fixture = buildModerationProof({
      teamId: `team-moderation-page-${String(index).padStart(3, "0")}`,
      gameId: `game-moderation-page-${String(index).padStart(3, "0")}`,
      requestId: uuid(1_000 + index),
      messageId: `diamond-chat-${index.toString(16).padStart(64, "0")}`,
      commitMs: Date.parse(REDACTED_AT) - 1,
    });
    Object.assign(seed, fixture.documents);
    Object.assign(commitMetadata, fixture.commitMetadata);
    receiptPaths.push(fixture.paths.receiptPath);
  }
  for (const [source, collectionGroup, field] of [
    ["existing-tasks", "diamondReconciliations", "document-id"],
    ["events-actor", "events", "actorUid"],
    ["events-handoff", "events", "payload.toUid"],
    ["notes-author", "notes", "authorUid"],
    ["live-chat-sender", "chat", "senderId"],
    ["live-reactions-sender", "reactions", "senderId"],
    ["moderation-before-image-sender", "moderationBeforeImages", "senderId"],
    ["regeneration-audit", "audit", "actorUid"],
    ["configuration-request", "diamondConfigurationRequests", "requestedBy"],
  ]) {
    seed[`${AUTH_DELETE_BARRIER_PATH}/diamondReconciliationScans/${source}`] = {
      schemaVersion: 1,
      type: "diamond-auth-delete-scan",
      source,
      collectionGroup,
      field,
      status: "complete",
      cursorPath: null,
      epoch: 0,
      startedAt: REDACTED_AT,
    };
  }
  const fake = makeFirestore(seed, { commitMetadata });
  const bounded = {
    handlerOptions: {
      reconciliationInventoryPageBudget: 1,
    },
  };

  await assert.rejects(
    runDirectAuthDelete(fake, bounded),
    (error) => error?.code === "unavailable",
  );

  const scanPath = `${AUTH_DELETE_BARRIER_PATH}/diamondReconciliationScans/moderation-receipt-moderator`;
  const expectedPaths = receiptPaths.sort();
  assert.equal(fake.read(scanPath).status, "scanning");
  assert.equal(fake.read(scanPath).cursorPath, expectedPaths.at(-1));
  assert.equal(fake.has(expectedPaths[0]), false);
  assert.equal(fake.has(expectedPaths.at(-1)), false);

  await runDirectAuthDelete(fake, bounded);

  assert.equal(fake.read(scanPath).status, "complete");
  assert.ok(fake.queryLog.some((entry) =>
    entry.collectionId === "audit"
      && entry.field === "moderatorUid"
      && entry.cursorPath === expectedPaths.at(-1)
      && entry.paths.length === 0));
});

test("direct Auth discovery persists a bounded collection-group cursor and resumes strictly after it", async () => {
  const seed = {
    [AUTH_DELETE_BARRIER_PATH]: {
      schemaVersion: 1,
      type: "diamond-private-note-auth-delete-barrier",
      status: "auth-deleted",
      startedAt: REDACTED_AT,
    },
  };
  for (const [source, collectionGroup, field] of [
    ["events-actor", "events", "actorUid"],
    ["events-handoff", "events", "payload.toUid"],
    ["notes-author", "notes", "authorUid"],
    ["live-chat-sender", "chat", "senderId"],
    ["live-reactions-sender", "reactions", "senderId"],
    ["moderation-before-image-sender", "moderationBeforeImages", "senderId"],
    ["moderation-receipt-moderator", "audit", "moderatorUid"],
    ["regeneration-audit", "audit", "actorUid"],
  ]) {
    seed[`${AUTH_DELETE_BARRIER_PATH}/diamondReconciliationScans/${source}`] = {
      schemaVersion: 1,
      type: "diamond-auth-delete-scan",
      source,
      collectionGroup,
      field,
      status: "complete",
      cursorPath: null,
      epoch: 0,
      startedAt: REDACTED_AT,
    };
  }
  const commitMetadata = {};
  const requestPaths = [];
  for (let index = 0; index < 251; index += 1) {
    const teamId = `team-config-${String(index).padStart(3, "0")}`;
    const requestId = uuid(1_000 + index);
    const path = `teams/${teamId}/diamondConfigurationRequests/${requestId}`;
    requestPaths.push(path);
    const settings = configurationSettings({
      configuredBy: UID,
      requestId,
      mode: "dark",
      requestIndex: index,
    });
    seed[path] = configurationReceipt({
      teamId,
      requestId,
      requestedBy: UID,
      settings,
      requestHash: `sha256:${index.toString(16).padStart(64, "0")}`,
    });
    commitMetadata[path] = {
      createMs: Date.parse(REDACTED_AT),
      updateMs: Date.parse(REDACTED_AT),
    };
  }
  const fake = makeFirestore(seed, { commitMetadata });
  const bounded = {
    handlerOptions: { reconciliationInventoryPageBudget: 1 },
  };

  await assert.rejects(
    runDirectAuthDelete(fake, bounded),
    (error) => error?.code === "unavailable",
  );

  const scanPath = `${AUTH_DELETE_BARRIER_PATH}/diamondReconciliationScans/configuration-request`;
  const firstCursor = fake.read(scanPath);
  assert.equal(firstCursor.status, "scanning");
  assert.equal(firstCursor.cursorPath, requestPaths[249]);
  assert.equal(fake.has(requestPaths[0]), false);
  assert.equal(fake.has(requestPaths[249]), false);
  assert.equal(fake.has(requestPaths[250]), true);

  await runDirectAuthDelete(fake, bounded);

  assert.equal(fake.read(scanPath).status, "complete");
  assert.equal(fake.has(requestPaths[250]), false);
  assert.ok(
    fake.queryLog.some(
      (entry) =>
        entry.collectionId === "diamondConfigurationRequests" &&
        entry.cursorPath === requestPaths[249] &&
        entry.paths.length === 1 &&
        entry.paths[0] === requestPaths[250],
    ),
  );
});

test("direct Auth task recovery persists a bounded cursor across terminal task history", async () => {
  const seed = {
    [AUTH_DELETE_BARRIER_PATH]: {
      schemaVersion: 1,
      type: "diamond-private-note-auth-delete-barrier",
      status: "auth-deleted",
      startedAt: REDACTED_AT,
    },
  };
  for (const [source, collectionGroup, field] of [
    ["events-actor", "events", "actorUid"],
    ["events-handoff", "events", "payload.toUid"],
    ["notes-author", "notes", "authorUid"],
    ["live-chat-sender", "chat", "senderId"],
    ["live-reactions-sender", "reactions", "senderId"],
    ["moderation-before-image-sender", "moderationBeforeImages", "senderId"],
    ["moderation-receipt-moderator", "audit", "moderatorUid"],
    ["regeneration-audit", "audit", "actorUid"],
    ["configuration-request", "diamondConfigurationRequests", "requestedBy"],
  ]) {
    seed[`${AUTH_DELETE_BARRIER_PATH}/diamondReconciliationScans/${source}`] = {
      schemaVersion: 1,
      type: "diamond-auth-delete-scan",
      source,
      collectionGroup,
      field,
      status: "complete",
      cursorPath: null,
      epoch: 0,
      startedAt: REDACTED_AT,
    };
  }
  const taskPaths = [];
  for (let index = 0; index < 251; index += 1) {
    const taskId = index.toString(16).padStart(64, "0");
    const taskPath = `${AUTH_DELETE_BARRIER_PATH}/diamondReconciliations/${taskId}`;
    taskPaths.push(taskPath);
    seed[taskPath] = {
      schemaVersion: 1,
      type: "diamond-auth-delete-reconciliation",
      status: "complete",
      taskId,
      outcome: "generation-retired",
      receiptHash: `sha256:${index.toString(16).padStart(64, "0")}`,
      completedAt: REDACTED_AT,
    };
  }
  const fake = makeFirestore(seed);
  const bounded = {
    handlerOptions: { reconciliationInventoryPageBudget: 1 },
  };

  await assert.rejects(
    runDirectAuthDelete(fake, bounded),
    (error) => error?.code === "unavailable",
  );

  const scanPath = `${AUTH_DELETE_BARRIER_PATH}/diamondReconciliationScans/existing-tasks`;
  assert.equal(fake.read(scanPath).status, "scanning");
  assert.equal(fake.read(scanPath).cursorPath, taskPaths[249]);

  await runDirectAuthDelete(fake, bounded);

  assert.equal(fake.read(scanPath).status, "complete");
  assert.equal(fake.read(scanPath).cursorPath, taskPaths[250]);
  assert.ok(
    fake.queryLog.some(
      (entry) =>
        entry.collectionId.endsWith("diamondReconciliations") &&
        entry.cursorPath === taskPaths[249] &&
        entry.paths.length === 1 &&
        entry.paths[0] === taskPaths[250],
    ),
  );
});

test("task scan epochs prevent stale completion across stage/reset interleavings", async (t) => {
  for (const mode of ["after-query", "transaction-callback-retry"]) {
    await t.test(mode, async () => {
      const seed = {
        [AUTH_DELETE_BARRIER_PATH]: {
          schemaVersion: 1,
          type: "diamond-private-note-auth-delete-barrier",
          status: "auth-deleted",
          startedAt: REDACTED_AT,
        },
      };
      for (const [source, collectionGroup, field] of [
        ["events-actor", "events", "actorUid"],
        ["events-handoff", "events", "payload.toUid"],
        ["notes-author", "notes", "authorUid"],
        ["live-chat-sender", "chat", "senderId"],
        ["live-reactions-sender", "reactions", "senderId"],
        ["moderation-before-image-sender", "moderationBeforeImages", "senderId"],
        ["moderation-receipt-moderator", "audit", "moderatorUid"],
        ["regeneration-audit", "audit", "actorUid"],
        ["configuration-request", "diamondConfigurationRequests", "requestedBy"],
      ]) {
        seed[`${AUTH_DELETE_BARRIER_PATH}/diamondReconciliationScans/${source}`] = {
          schemaVersion: 1,
          type: "diamond-auth-delete-scan",
          source,
          collectionGroup,
          field,
          status: "complete",
          cursorPath: null,
          epoch: 0,
          startedAt: REDACTED_AT,
        };
      }
      const taskId = "f".repeat(64);
      const taskPath = `${AUTH_DELETE_BARRIER_PATH}/diamondReconciliations/${taskId}`;
      const scanPath = `${AUTH_DELETE_BARRIER_PATH}/diamondReconciliationScans/existing-tasks`;
      let injected = false;
      let fake;
      const injectTaskReset = () => {
        if (injected) return;
        injected = true;
        fake.write(taskPath, {
          schemaVersion: 1,
          type: "diamond-auth-delete-reconciliation",
          status: "complete",
          taskId,
          outcome: "generation-retired",
          receiptHash: `sha256:${"e".repeat(64)}`,
          completedAt: REDACTED_AT,
        });
        fake.write(scanPath, {
          schemaVersion: 1,
          type: "diamond-auth-delete-scan",
          source: "existing-tasks",
          collectionGroup: "diamondReconciliations",
          field: "document-id",
          status: "scanning",
          cursorPath: null,
          epoch: 1,
          startedAt: REDACTED_AT,
        });
      };
      fake = makeFirestore(seed, {
        async afterQueryHook({ scope, source, paths }) {
          if (
            mode === "after-query" &&
            !injected &&
            scope === "collection" &&
            source.endsWith("/diamondReconciliations") &&
            paths.length === 0
          ) injectTaskReset();
        },
      });
      if (mode === "transaction-callback-retry") {
        const originalRunTransaction = fake.firestore.runTransaction;
        const retrySignal = new Error("simulated Firestore callback retry");
        fake.firestore.runTransaction = async (operation) => {
          if (injected) return originalRunTransaction(operation);
          try {
            return await originalRunTransaction(async (transaction) => {
              let advancesEmptyTaskScan = false;
              const proxy = {
                get: (...args) => transaction.get(...args),
                create: (...args) => transaction.create(...args),
                update: (...args) => transaction.update(...args),
                delete: (...args) => transaction.delete(...args),
                set(reference, value, options) {
                  if (
                    reference.path === scanPath &&
                    value?.status === "complete" &&
                    value?.epoch === 0
                  ) advancesEmptyTaskScan = true;
                  return transaction.set(reference, value, options);
                },
              };
              const result = await operation(proxy);
              if (advancesEmptyTaskScan) {
                injectTaskReset();
                throw retrySignal;
              }
              return result;
            });
          } catch (error) {
            if (error !== retrySignal) throw error;
            return originalRunTransaction(operation);
          }
        };
      }

      await runDirectAuthDelete(fake);

      assert.equal(injected, true);
      assert.deepEqual(fake.read(scanPath), {
        schemaVersion: 1,
        type: "diamond-auth-delete-scan",
        source: "existing-tasks",
        collectionGroup: "diamondReconciliations",
        field: "document-id",
        status: "complete",
        cursorPath: taskPath,
        epoch: 1,
        startedAt: REDACTED_AT,
      });
      const taskQueries = fake.queryLog.filter((entry) =>
        entry.collectionId.endsWith("/diamondReconciliations"),
      );
      assert.ok(taskQueries.length >= 2);
      assert.equal(taskQueries.at(-1).paths[0], taskPath);
    });
  }
});

test("a final task scan catches a concurrently staged retirement after its source disappears", async () => {
  const fixture = buildRetiringActivationGeneration();
  const stagedFake = makeFirestore(fixture.documents, {
    commitMetadata: fixture.commitMetadata,
  });
  const onePage = {
    handlerOptions: {
      reconciliationInventoryPageBudget: 1,
      reconciliationInventoryPageSize: 1,
    },
  };
  let captured = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await assert.rejects(
      runDirectAuthDelete(stagedFake, onePage),
      (error) => error?.code === "unavailable",
    );
    const state = stagedFake.entries();
    const activeTask = Object.entries(state).find(
      ([path, value]) =>
        path.includes("/diamondReconciliations/") && value?.status === "retiring",
    );
    if (!stagedFake.has(fixture.eventPath) && activeTask) {
      captured = state;
      break;
    }
  }
  assert.ok(captured, "the concurrent worker must durably remove its source then yield");

  const taskEntry = Object.entries(captured).find(
    ([path, value]) =>
      path.includes("/diamondReconciliations/") && value?.status === "retiring",
  );
  assert.ok(taskEntry);
  const taskScanPath = `${AUTH_DELETE_BARRIER_PATH}/diamondReconciliationScans/existing-tasks`;
  let injected = false;
  let fake;
  fake = makeFirestore(
    { [AUTH_DELETE_BARRIER_PATH]: captured[AUTH_DELETE_BARRIER_PATH] },
    {
      async queryHook({ scope, source, filters }) {
        if (
          injected ||
          scope !== "group" ||
          source !== "events" ||
          filters[0]?.field !== "actorUid"
        ) return;
        injected = true;
        for (const [path, value] of Object.entries(captured)) {
          if (
            path === AUTH_DELETE_BARRIER_PATH ||
            path.includes("/diamondReconciliationScans/") ||
            path === fixture.eventPath
          ) continue;
          fake.write(path, value);
        }
        fake.write(taskScanPath, {
          schemaVersion: 1,
          type: "diamond-auth-delete-scan",
          source: "existing-tasks",
          collectionGroup: "diamondReconciliations",
          field: "document-id",
          status: "scanning",
          cursorPath: null,
          epoch: 1,
          startedAt: REDACTED_AT,
        });
      },
    },
  );

  await runDirectAuthDelete(fake, {
    handlerOptions: {
      reconciliationInventoryPageBudget: 100,
      reconciliationInventoryPageSize: 1,
    },
  });

  assert.equal(injected, true);
  assert.equal(fake.has(fixture.scorebookPath), false);
  assert.equal(fake.has(fixture.eventPath), false);
  assert.equal(fake.read(taskEntry[0]).status, "complete");
  assert.equal(fake.read(taskScanPath).status, "complete");
});

test("a completed old retirement cannot erase a fresh same-path Diamond activation", async () => {
  const fixture = buildRetiringActivationGeneration();
  const fake = makeFirestore(fixture.documents, {
    commitMetadata: fixture.commitMetadata,
  });
  await runDirectAuthDelete(fake);
  const freshInstance = uuid(999);
  const freshRoot = {
    schemaVersion: 2,
    trackingEngine: "diamond-v2",
    teamId: fixture.teamId,
    gameId: fixture.gameId,
    instanceId: freshInstance,
  };
  const freshEventPath = `${fixture.scorebookPath}/events/fresh-event`;
  const freshEvent = {
    trackingEngine: "diamond-v2",
    teamId: fixture.teamId,
    gameId: fixture.gameId,
    instanceId: freshInstance,
    eventId: "fresh-event",
    actorUid: "active-manager",
  };
  const freshGame = {
    id: fixture.gameId,
    trackingEngine: "diamond-v2",
    diamondScorebookInstanceId: freshInstance,
    freshActivation: true,
  };
  fake.write(fixture.gamePath, freshGame);
  fake.write(fixture.scorebookPath, freshRoot);
  fake.write(freshEventPath, freshEvent);

  await runDirectAuthDelete(fake);

  assert.deepEqual(fake.read(fixture.gamePath), freshGame);
  assert.deepEqual(fake.read(fixture.scorebookPath), freshRoot);
  assert.deepEqual(fake.read(freshEventPath), freshEvent);
});

test("direct Auth deletion fails closed on a forged terminal barrier", async () => {
  const bundle = buildPrivateNoteDocuments();
  const fake = makeFirestore({
    ...seedBundle(bundle),
    [AUTH_DELETE_BARRIER_PATH]: {
      schemaVersion: 1,
      type: "diamond-private-note-auth-delete-barrier",
      status: "complete",
      startedAt: REDACTED_AT,
    },
  });

  await assert.rejects(
    runDirectAuthDelete(fake),
    (error) => error?.code === "diamond-private-note-integrity-failed",
  );
  assert.equal(fake.read(AUTH_DELETE_BARRIER_PATH).status, "complete");
  assert.deepEqual(fake.read(bundle.paths.notePath), bundle.note);
  assert.ok(fake.read(bundle.paths.projectionPath));
});

test("direct Auth deletion rejects malformed event identity before creating a barrier", async (t) => {
  for (const testCase of [
    { name: "principal", overrides: { user: { uid: "bad/uid" } } },
    { name: "timestamp", overrides: { context: { timestamp: "not-a-timestamp" } } },
  ]) {
    await t.test(testCase.name, async () => {
      const bundle = buildPrivateNoteDocuments();
      const fake = makeFirestore(seedBundle(bundle));

      await assert.rejects(
        runDirectAuthDelete(fake, testCase.overrides),
        (error) => error?.code === "diamond-private-note-integrity-failed",
      );

      assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), false);
      assert.deepEqual(fake.read(bundle.paths.notePath), bundle.note);
      assert.ok(fake.read(bundle.paths.projectionPath));
      assert.equal(fake.transactionCalls, 0);
    });
  }
});

test("wires the privacy cleanup before every destructive account cleanup and declares query indexes", () => {
  const root = join(__dirname, "..", "..");
  const source = readFileSync(join(root, "functions", "index.js"), "utf8");
  const helper = source.indexOf("await cleanupAccountDiamondPrivateNotes(");
  assert.ok(helper > 0);
  for (const laterOperation of [
    "await deleteAccountStorage(",
    "if (userDoc.exists) await firestore.recursiveDelete(userRef)",
    "await admin.auth().deleteUser(uid)",
  ]) {
    assert.ok(source.indexOf(laterOperation) > helper, laterOperation);
  }
  assert.match(source, /diamond-private-note-migration-required/);
  assert.match(
    source,
    /exports\.cleanupAccountDiamondPrivateNotesOnAuthDelete = functions\s+\.runWith\(\{ timeoutSeconds: 540, memory: '1GB', failurePolicy: true \}\)\s+\.auth\s+\.user\(\)\s+\.onDelete\(cleanupAccountDiamondPrivateNotesOnAuthDelete\)/,
  );

  const indexes = JSON.parse(
    readFileSync(join(root, "firestore.indexes.json"), "utf8"),
  );
  const indexed = new Set(
    indexes.fieldOverrides
      .filter((entry) =>
        entry.indexes?.some(
          (index) =>
            index.order === "ASCENDING" &&
            index.queryScope === "COLLECTION_GROUP",
        ),
      )
      .map((entry) => `${entry.collectionGroup}.${entry.fieldPath}`),
  );
  assert.ok(indexed.has("notes.authorUid"));
  assert.ok(indexed.has("notes.createdBy"));
  assert.ok(indexed.has("events.actorUid"));
  assert.ok(indexed.has("events.payload.toUid"));
  assert.ok(indexed.has("audit.actorUid"));
  assert.ok(indexed.has("audit.moderatorUid"));
  assert.ok(indexed.has("moderationBeforeImages.senderId"));
  assert.ok(indexed.has("diamondConfigurationRequests.requestedBy"));
  assert.ok(indexed.has("chat.senderId"));
  assert.ok(indexed.has("reactions.senderId"));

  const productionSources = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (["node_modules", "test"].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) productionSources.push(path);
    }
  };
  visit(join(root, "functions"));
  for (const path of productionSources) {
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /\bdeleteUsers\s*\(/,
      `bulk Auth deletion would bypass onDelete reconciliation: ${path}`,
    );
  }
});
