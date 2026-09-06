"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  DIAMOND_ENGINE,
  LEGACY_TRACKING_COLLECTIONS,
  MAX_PRIVATE_EVENT_PAGE_BYTES,
  createDiamondScorebookHandlers,
  paths,
} = require("../diamond-scorebook-handlers.cjs");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function fieldValue(value, field) {
  return field.split(".").reduce((current, key) => current?.[key], value);
}

class TestHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "HttpsError";
    this.code = code;
    this.details = details;
  }
}

class FakeDocumentSnapshot {
  constructor(reference, value) {
    this.ref = reference;
    this.id = reference.id;
    this.exists = value !== undefined;
    this._value = clone(value);
  }

  data() {
    return clone(this._value);
  }
}

class FakeQuerySnapshot {
  constructor(documents) {
    this.docs = documents;
    this.size = documents.length;
    this.empty = documents.length === 0;
  }
}

class FakeDocumentReference {
  constructor(database, path) {
    this.database = database;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  get() {
    return Promise.resolve(this.database._documentSnapshot(this));
  }
}

class FakeQuery {
  constructor(database, path, filters = [], ordering = null, maximum = null) {
    this.database = database;
    this.path = path;
    this.filters = filters;
    this.ordering = ordering;
    this.maximum = maximum;
  }

  where(field, operator, value) {
    return new FakeQuery(
      this.database,
      this.path,
      [...this.filters, { field, operator, value }],
      this.ordering,
      this.maximum,
    );
  }

  orderBy(field, direction = "asc") {
    return new FakeQuery(
      this.database,
      this.path,
      this.filters,
      { field, direction },
      this.maximum,
    );
  }

  limit(maximum) {
    return new FakeQuery(
      this.database,
      this.path,
      this.filters,
      this.ordering,
      maximum,
    );
  }

  get() {
    return Promise.resolve(this.database._querySnapshot(this));
  }
}

class FakeTransaction {
  constructor(database) {
    this.database = database;
    this.operations = [];
    this.readPaths = [];
    database.transactionReadBatches.push(this.readPaths);
  }

  get(reference) {
    this.readPaths.push(reference.path);
    if (reference instanceof FakeQuery)
      return Promise.resolve(this.database._querySnapshot(reference));
    return Promise.resolve(this.database._documentSnapshot(reference));
  }

  getAll(...references) {
    this.database.transactionBulkGetCalls =
      (this.database.transactionBulkGetCalls || 0) + 1;
    this.database.lastTransactionBulkGetCount = references.length;
    return Promise.resolve(
      references.map((reference) => this.database._documentSnapshot(reference)),
    );
  }

  create(reference, value) {
    this.operations.push({ kind: "create", reference, value: clone(value) });
  }

  set(reference, value, options = {}) {
    this.operations.push({
      kind: "set",
      reference,
      value: clone(value),
      options: clone(options),
    });
  }

  update(reference, value) {
    this.operations.push({ kind: "update", reference, value: clone(value) });
  }

  delete(reference) {
    this.operations.push({ kind: "delete", reference });
  }

  commit() {
    const next = new Map(
      [...this.database.documents].map(([path, value]) => [path, clone(value)]),
    );
    for (const operation of this.operations) {
      const path = operation.reference.path;
      if (operation.kind === "create") {
        if (next.has(path))
          throw Object.assign(new Error(`Document already exists: ${path}`), {
            code: "already-exists",
          });
        next.set(path, clone(operation.value));
      } else if (operation.kind === "set") {
        const value = operation.options?.merge
          ? { ...(next.get(path) || {}), ...clone(operation.value) }
          : clone(operation.value);
        next.set(path, value);
      } else if (operation.kind === "update") {
        if (!next.has(path))
          throw Object.assign(new Error(`Document does not exist: ${path}`), {
            code: "not-found",
          });
        next.set(path, { ...next.get(path), ...clone(operation.value) });
      } else if (operation.kind === "delete") {
        next.delete(path);
      }
    }
    this.database.documents = next;
  }
}

class FakeFirestore {
  constructor(seed = {}) {
    this.documents = new Map(
      Object.entries(seed).map(([path, value]) => [path, clone(value)]),
    );
    this.transactionQueue = Promise.resolve();
    this.queryHook = null;
    this.bulkGetHook = null;
    this.bulkGetCalls = 0;
    this.transactionReadBatches = [];
  }

  doc(path) {
    return new FakeDocumentReference(this, path);
  }

  collection(path) {
    return new FakeQuery(this, path);
  }

  async getAll(...references) {
    this.bulkGetCalls += 1;
    const readOptions = references.at(-1)?.fieldMask ? references.pop() : null;
    const snapshots = references.map((reference) => {
      const original = this._documentSnapshot(reference);
      if (!original.exists || !readOptions) return original;
      const data = original.data();
      const masked = Object.fromEntries(
        readOptions.fieldMask
          .filter((field) => Object.prototype.hasOwnProperty.call(data, field))
          .map((field) => [field, data[field]]),
      );
      return new FakeDocumentSnapshot(reference, masked);
    });
    this.lastBulkGet = {
      count: references.length,
      fieldMask: readOptions?.fieldMask ? [...readOptions.fieldMask] : null,
    };
    if (typeof this.bulkGetHook === "function") {
      await this.bulkGetHook(references, snapshots);
    }
    return snapshots;
  }

  _documentSnapshot(reference) {
    return new FakeDocumentSnapshot(
      reference,
      this.documents.get(reference.path),
    );
  }

  _querySnapshot(query) {
    const prefix = `${query.path}/`;
    let rows = [...this.documents.entries()]
      .filter(
        ([path]) =>
          path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
      )
      .map(([path, value]) => new FakeDocumentSnapshot(this.doc(path), value));
    for (const filter of query.filters) {
      rows = rows.filter((document) => {
        const value = fieldValue(document.data(), filter.field);
        if (filter.operator === ">") return value > filter.value;
        if (filter.operator === "<") return value < filter.value;
        if (filter.operator === "<=") return value <= filter.value;
        if (filter.operator === "==") return value === filter.value;
        throw new Error(`Unsupported fake query operator ${filter.operator}`);
      });
    }
    if (query.ordering) {
      const multiplier = query.ordering.direction === "desc" ? -1 : 1;
      rows.sort((left, right) => {
        const leftValue = fieldValue(left.data(), query.ordering.field);
        const rightValue = fieldValue(right.data(), query.ordering.field);
        if (leftValue < rightValue) return -1 * multiplier;
        if (leftValue > rightValue) return 1 * multiplier;
        return left.id.localeCompare(right.id) * multiplier;
      });
    } else {
      rows.sort((left, right) => left.id.localeCompare(right.id));
    }
    if (Number.isInteger(query.maximum)) rows = rows.slice(0, query.maximum);
    const result = new FakeQuerySnapshot(rows);
    if (typeof this.queryHook === "function") this.queryHook(query, result);
    return result;
  }

  runTransaction(callback) {
    const run = async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      transaction.commit();
      return result;
    };
    const pending = this.transactionQueue.then(run, run);
    this.transactionQueue = pending.catch(() => {});
    return pending;
  }

  async recursiveDelete(reference) {
    const prefix = `${reference.path}/`;
    for (const path of [...this.documents.keys()]) {
      if (path === reference.path || path.startsWith(prefix))
        this.documents.delete(path);
    }
  }

  seed(path, value) {
    this.documents.set(path, clone(value));
  }

  delete(path) {
    this.documents.delete(path);
  }

  read(path) {
    return clone(this.documents.get(path));
  }

  countDirectChildren(collectionPath) {
    const prefix = `${collectionPath}/`;
    return [...this.documents.keys()].filter(
      (path) =>
        path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
    ).length;
  }
}

function makeUuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const DIAMOND_APP_BUILD = 2;

function baseDocuments(overrides = {}) {
  return {
    "securityPolicies/diamondScorebook": {
      mode: "enabled",
      revision: 1,
      teamIds: [],
      rolloutPercent: 100,
    },
    "teams/team-1": {
      id: "team-1",
      ownerId: "manager-1",
      name: "Comets",
      sport: "baseball",
      active: true,
      isPublic: true,
      teamPermissions: {
        scorekeeping: { mode: "selected", memberIds: ["scorer-1"] },
      },
      diamondScorebook: {
        enabled: true,
        sport: "baseball",
        rulesProfileId: "baseball-youth",
        rulesProfileVersion: 1,
        captureMode: "quick",
      },
    },
    "teams/team-1/players/home-1": {
      name: "Home Hitter",
      number: "7",
      medicalInfo: "must never leave the selected projection",
    },
    "teams/opponent-1": {
      id: "opponent-1",
      ownerId: "opponent-manager",
      name: "Rockets",
      sport: "baseball",
      active: true,
      isPublic: true,
    },
    "teams/opponent-1/players/away-1": {
      displayName: "Away Hitter",
      jerseyNumber: "12",
      guardianEmail: "private@example.com",
    },
    "users/manager-1": { isAdmin: false },
    "users/scorer-1": { isAdmin: false },
    "teams/team-1/statTrackerConfigs/baseball-standard": {
      name: "Baseball Standard",
      baseType: "Baseball",
      statDefinitions: [
        { id: "ab", scope: "player", visibility: "public" },
        { id: "avg", scope: "player", visibility: "public" },
        { id: "bb", scope: "player", visibility: "public" },
        { id: "fp", scope: "player", visibility: "public" },
        { id: "h", scope: "player", visibility: "public" },
        { id: "r", scope: "player", visibility: "public" },
        { id: "rbi", scope: "player", visibility: "public" },
      ],
    },
    "teams/team-1/games/game-1": {
      id: "game-1",
      teamId: "team-1",
      type: "game",
      status: "scheduled",
      visibility: "public",
      opponentName: "Rockets",
      homeTeamId: "team-1",
      awayTeamId: "opponent-1",
      statTrackerConfigId: "baseball-standard",
    },
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const firestore =
    overrides.firestore ||
    new FakeFirestore(baseDocuments(overrides.documents));
  const authUsers = new Map(
    Object.entries({
      "manager-1": {
        uid: "manager-1",
        disabled: false,
        email: "manager@example.com",
        emailVerified: true,
      },
      "scorer-1": {
        uid: "scorer-1",
        disabled: false,
        email: "scorer@example.com",
        emailVerified: true,
      },
      ...(overrides.authUsers || {}),
    }),
  );
  const auth = {
    async getUser(uid) {
      if (!authUsers.has(uid))
        throw Object.assign(new Error("missing"), {
          code: "auth/user-not-found",
        });
      return clone(authUsers.get(uid));
    },
  };
  let randomIndex = 100;
  const handlers = createDiamondScorebookHandlers({
    firestore,
    auth,
    HttpsError: TestHttpsError,
    clock: overrides.clock || (() => 1_750_000_000_000),
    random: () => makeUuid(randomIndex++),
    logger: { info() {}, warn() {}, error() {} },
    resolveDelegatedAccess({ uid, user, team }) {
      const full = user?.isAdmin === true || team?.ownerId === uid;
      const selectedScorers =
        team?.teamPermissions?.scorekeeping?.mode === "selected"
          ? team.teamPermissions.scorekeeping.memberIds || []
          : [];
      const scorekeeping =
        full ||
        selectedScorers.includes(uid) ||
        (Array.isArray(team?.scorekeeperIds) &&
          team.scorekeeperIds.includes(uid));
      return { full, scorekeeping, parent: false };
    },
    isPublicGame(team, game) {
      return team?.isPublic === true && game?.visibility === "public";
    },
    recursiveDelete:
      overrides.recursiveDelete ||
      ((reference) => firestore.recursiveDelete(reference)),
  });
  return {
    firestore,
    authUsers,
    handlers,
    managerContext: {
      auth: { uid: "manager-1", token: { email: "stale-token@example.com" } },
    },
    scorerContext: { auth: { uid: "scorer-1" } },
  };
}

async function activate(harness, requestId = makeUuid(1)) {
  return harness.handlers.activateDiamondGame(
    {
      requestId,
      teamId: "team-1",
      gameId: "game-1",
      captureMode: "quick",
      appBuild: DIAMOND_APP_BUILD,
    },
    harness.managerContext,
  );
}

async function submit(
  harness,
  {
    commandId,
    expectedRevision,
    type,
    payload = {},
    context = harness.managerContext,
    appBuild = DIAMOND_APP_BUILD,
    expectedInstanceId = null,
    leaseId = "__current__",
  },
) {
  const root = harness.firestore.read(paths("team-1", "game-1").scorebook);
  const resolvedLeaseId =
    type === "cancel"
      ? undefined
      : leaseId === "__current__"
        ? root?.scorerLease?.leaseId
        : leaseId;
  return harness.handlers.submitDiamondCommand(
    {
      schemaVersion: 2,
      commandId,
      teamId: "team-1",
      gameId: "game-1",
      appBuild,
      expectedInstanceId: expectedInstanceId ?? root?.instanceId,
      ...(resolvedLeaseId ? { leaseId: resolvedLeaseId } : {}),
      expectedRevision,
      rulesProfileId: "baseball-youth",
      rulesProfileVersion: 1,
      type,
      payload,
    },
    context,
  );
}

async function changeScorerLease(
  harness,
  {
    requestId,
    operation,
    targetUid,
    context = harness.managerContext,
    appBuild = DIAMOND_APP_BUILD,
    expectedInstanceId = null,
    expectedRevision = null,
  },
) {
  const root = harness.firestore.read(paths("team-1", "game-1").scorebook);
  return harness.handlers.acquireDiamondScorerLease(
    {
      requestId,
      teamId: "team-1",
      gameId: "game-1",
      appBuild,
      expectedInstanceId: expectedInstanceId ?? root?.instanceId,
      expectedRevision: expectedRevision ?? root?.checkpoint?.sequence,
      operation,
      ...(targetUid ? { targetUid } : {}),
    },
    context,
  );
}

async function startGame(harness) {
  const home = await submit(harness, {
    commandId: makeUuid(20),
    expectedRevision: 1,
    type: "set_lineup",
    payload: {
      side: "home",
      entries: [{ slot: 1, playerId: "home-1", displayName: "Home Hitter" }],
    },
  });
  assert.equal(home.outcome, "accepted");
  const away = await submit(harness, {
    commandId: makeUuid(21),
    expectedRevision: 2,
    type: "set_lineup",
    payload: {
      side: "away",
      entries: [{ slot: 1, playerId: "away-1", displayName: "Away Hitter" }],
    },
  });
  assert.equal(away.outcome, "accepted");
  const homeDefense = await submit(harness, {
    commandId: makeUuid(22),
    expectedRevision: 3,
    type: "set_defensive_alignment",
    payload: {
      side: "home",
      assignments: [{ playerId: "home-1", position: "P" }],
    },
  });
  assert.equal(homeDefense.outcome, "accepted");
  const awayDefense = await submit(harness, {
    commandId: makeUuid(23),
    expectedRevision: 4,
    type: "set_defensive_alignment",
    payload: {
      side: "away",
      assignments: [{ playerId: "away-1", position: "P" }],
    },
  });
  assert.equal(awayDefense.outcome, "accepted");
  const started = await submit(harness, {
    commandId: makeUuid(24),
    expectedRevision: 5,
    type: "start",
  });
  assert.equal(started.outcome, "accepted");
  return started;
}

const TEST_CHECKPOINT_HASH = `sha256:${"a".repeat(64)}`;
const TEST_STAT_CONFIG_HASH = `sha256:${"b".repeat(64)}`;
const TEST_PROJECTION_HASH = `sha256:${"d".repeat(64)}`;

function seedManagerStatProjection(
  harness,
  {
    gameId = "game-1",
    playerId = "home-1",
    revision = 7,
    instanceId = makeUuid(700),
    projectionHash = TEST_PROJECTION_HASH,
  } = {},
) {
  const gamePath = paths("team-1", gameId).game;
  const existingGame = harness.firestore.read(gamePath) || {
    id: gameId,
    teamId: "team-1",
    type: "game",
    status: "completed",
  };
  harness.firestore.seed(gamePath, {
    ...existingGame,
    trackingEngine: DIAMOND_ENGINE,
    diamondScorebookInstanceId: instanceId,
    diamondProjectionRevision: revision,
    diamondProjectionCheckpointHash: TEST_CHECKPOINT_HASH,
    diamondProjectionHash: projectionHash,
    diamondProjectionStatus: "current",
    diamondProjectionComplete: true,
    diamondStatConfigSnapshotHash: TEST_STAT_CONFIG_HASH,
  });
  harness.firestore.seed(
    `${paths("team-1", gameId).diamondStatGeneration(instanceId)}/privatePlayerStats/${playerId}`,
    {
      trackingEngine: DIAMOND_ENGINE,
      teamId: "team-1",
      diamondGameId: gameId,
      playerId,
      side: "home",
      authoritative: true,
      complete: true,
      projectionSchemaVersion: 1,
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      sourceRevision: revision,
      checkpointHash: TEST_CHECKPOINT_HASH,
      statConfigSnapshotHash: TEST_STAT_CONFIG_HASH,
      projectionHash,
      stats: { ab: 3, h: 1 },
      observedStats: {},
      derivedStats: { avg: 1 / 3 },
      observedDerivedStats: {},
      statCoverage: { ab: "complete", h: "complete", avg: "complete" },
      coverage: {
        batting: "complete",
        baserunning: "complete",
        pitching: "complete",
        fielding: "complete",
        situational: "complete",
        pitches: "complete",
        sensors: "not_collected",
      },
      statSources: { h: ["play-1"] },
      sourcePlayIds: ["play-1"],
    },
  );
  harness.firestore.seed(
    `${paths("team-1", gameId).diamondStatGeneration(instanceId)}/teamStats/team`,
    {
      trackingEngine: DIAMOND_ENGINE,
      teamId: "team-1",
      diamondGameId: gameId,
      side: "home",
      complete: true,
      projectionSchemaVersion: 1,
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      sourceRevision: revision,
      checkpointHash: TEST_CHECKPOINT_HASH,
      statConfigSnapshotHash: TEST_STAT_CONFIG_HASH,
      projectionHash,
      stats: { r: 4, h: 7 },
      observedStats: {},
      statCoverage: { r: "complete", h: "complete" },
      coverage: { batting: "complete" },
      inningLines: { home: [1, 0, 3], away: [0, 1, 0] },
    },
  );
  return {
    gameId,
    instanceId,
    sourceRevision: revision,
    checkpointHash: TEST_CHECKPOINT_HASH,
    statConfigSnapshotHash: TEST_STAT_CONFIG_HASH,
    projectionHash,
  };
}

function seedPublicTeamStatProjection(
  harness,
  { stats = { h: 7, r: 4 }, projectionHash = TEST_PROJECTION_HASH } = {},
) {
  const resourcePaths = paths("team-1", "game-1");
  const game = harness.firestore.read(resourcePaths.game);
  const publicState = harness.firestore.read(resourcePaths.publicState);
  const sourceRevision = publicState.sourceRevision ?? publicState.revision;
  const checkpointHash = publicState.checkpointHash;
  const instanceId = game.diamondScorebookInstanceId;
  const publicStatIds = Object.keys(stats).sort();
  const diamondPublicTeamStats = {
    trackingEngine: DIAMOND_ENGINE,
    projectionSchemaVersion: 1,
    sourceRevision,
    checkpointHash,
    coverage: { batting: "complete" },
    publicStatIds,
    side: "home",
    complete: true,
    stats,
    observedStats: {},
    statCoverage: Object.fromEntries(
      publicStatIds.map((statId) => [statId, "complete"]),
    ),
    teamId: "team-1",
    diamondGameId: "game-1",
    instanceId,
    diamondScorebookInstanceId: instanceId,
    projectionGeneration: instanceId,
    statConfigSnapshotHash: game.diamondStatConfigSnapshotHash,
    projectionHash,
  };
  harness.firestore.seed(resourcePaths.game, {
    ...game,
    diamondProjectionRevision: sourceRevision,
    diamondProjectionCheckpointHash: checkpointHash,
    diamondProjectionHash: projectionHash,
    diamondProjectionStatus: "current",
    diamondProjectionComplete: true,
    diamondPublicTeamStats,
  });
  return diamondPublicTeamStats;
}

describe("Diamond scorebook handler factory", () => {
  it("bulk-loads only exact complete manager stat generations and rechecks access", async () => {
    const harness = createHarness({
      documents: {
        "teams/team-1/games/game-2": {
          id: "game-2",
          teamId: "team-1",
          type: "game",
          status: "completed",
        },
      },
    });
    const firstHead = seedManagerStatProjection(harness);
    const secondHead = seedManagerStatProjection(harness, {
      gameId: "game-2",
      revision: 9,
      instanceId: makeUuid(701),
    });

    const result = await harness.handlers.getDiamondManagerStats(
      {
        teamId: "team-1",
        gameHeads: [secondHead, firstHead],
        playerIds: ["home-1"],
      },
      harness.managerContext,
    );

    assert.equal(harness.firestore.bulkGetCalls, 1);
    assert.equal(harness.firestore.transactionBulkGetCalls, 2);
    assert.equal(harness.firestore.lastBulkGet.count, 4);
    assert.ok(harness.firestore.lastBulkGet.fieldMask.length > 0);
    assert.equal(
      harness.firestore.lastBulkGet.fieldMask.includes("statSources"),
      false,
    );
    assert.equal(
      harness.firestore.lastBulkGet.fieldMask.includes("sourcePlayIds"),
      false,
    );
    assert.equal(result.status, "complete");
    assert.equal(result.complete, true);
    assert.equal(result.truncated, false);
    assert.equal(result.visibility, "manager-internal");
    assert.equal(result.expectedDocumentCount, 2);
    assert.equal(result.documentCount, 2);
    assert.equal(result.missingDocumentCount, 0);
    assert.equal(result.expectedTeamDocumentCount, 2);
    assert.equal(result.teamDocumentCount, 2);
    assert.equal(result.missingTeamDocumentCount, 0);
    assert.equal(result.absenceConfirmed, false);
    assert.ok(result.responseByteCount > 0);
    assert.ok(result.responseByteCount <= result.responseByteLimit);
    assert.deepEqual(
      result.documents.map(({ gameId, playerId }) => `${gameId}:${playerId}`),
      ["game-1:home-1", "game-2:home-1"],
    );
    assert.ok(
      result.documents.every(({ data }) => data.authoritative === true),
    );
    assert.ok(
      result.documents.every(({ data }) => data.statSources === undefined),
    );
    assert.deepEqual(
      result.teamDocuments.map(({ gameId }) => gameId),
      ["game-1", "game-2"],
    );
  });

  it("keeps the 40-game by 25-player season response in one masked bulk read under its byte cap", async () => {
    const harness = createHarness();
    const gameHeads = [];
    const playerIds = Array.from(
      { length: 25 },
      (_, index) => `player-${String(index + 1).padStart(2, "0")}`,
    );
    for (let gameIndex = 0; gameIndex < 40; gameIndex += 1) {
      const gameId = `game-${String(gameIndex + 1).padStart(2, "0")}`;
      harness.firestore.seed(paths("team-1", gameId).game, {
        id: gameId,
        teamId: "team-1",
        type: "game",
        status: "completed",
      });
      let head;
      for (
        let playerIndex = 0;
        playerIndex < playerIds.length;
        playerIndex += 1
      ) {
        head = seedManagerStatProjection(harness, {
          gameId,
          playerId: playerIds[playerIndex],
          revision: gameIndex + 1,
          instanceId: makeUuid(800 + gameIndex),
        });
      }
      gameHeads.push(head);
    }

    const result = await harness.handlers.getDiamondManagerStats(
      { teamId: "team-1", gameHeads, playerIds },
      harness.managerContext,
    );

    assert.equal(harness.firestore.bulkGetCalls, 1);
    assert.equal(harness.firestore.lastBulkGet.count, 1_040);
    assert.equal(harness.firestore.lastTransactionBulkGetCount, 82);
    assert.equal(result.documentCount, 1_000);
    assert.equal(result.teamDocumentCount, 40);
    assert.equal(result.missingDocumentCount, 0);
    assert.ok(result.responseByteCount < result.responseByteLimit);
    assert.ok(
      result.documents.every(({ data }) => data.statSources === undefined),
    );
  });

  it("denies public callers and delegated scorekeepers before private reads", async () => {
    const harness = createHarness({
      documents: {
        "users/parent-1": { isAdmin: false },
        "teams/team-1/games/game-2": {
          id: "game-2",
          teamId: "team-1",
          type: "game",
          status: "completed",
        },
      },
      authUsers: {
        "parent-1": {
          uid: "parent-1",
          disabled: false,
          email: "parent@example.com",
          emailVerified: true,
        },
      },
    });
    const firstHead = seedManagerStatProjection(harness);
    const secondHead = seedManagerStatProjection(harness, {
      gameId: "game-2",
      revision: 9,
      instanceId: makeUuid(701),
    });
    const request = {
      teamId: "team-1",
      gameHeads: [firstHead],
      playerIds: ["home-1"],
    };

    await assert.rejects(
      harness.handlers.getDiamondManagerStats(request, {
        auth: { uid: "parent-1" },
      }),
      (error) => error.code === "permission-denied",
    );
    await assert.rejects(
      harness.handlers.getDiamondManagerStats(
        { ...request, gameHeads: [firstHead, secondHead] },
        harness.scorerContext,
      ),
      (error) => error.code === "permission-denied",
    );
    assert.equal(harness.firestore.bulkGetCalls, 0);

    await assert.rejects(
      harness.handlers.getDiamondManagerStats(request, harness.scorerContext),
      (error) => error.code === "permission-denied",
    );
    assert.equal(harness.firestore.bulkGetCalls, 0);

    const managerGame = await harness.handlers.getDiamondManagerStats(
      request,
      harness.managerContext,
    );
    assert.equal(managerGame.documentCount, 1);
    assert.equal(harness.firestore.lastBulkGet.fieldMask, null);
    assert.deepEqual(managerGame.documents[0].data.statSources, {
      h: ["play-1"],
    });
    assert.equal(harness.firestore.bulkGetCalls, 1);
  });

  it("returns no private payload when a role or exact game head changes during the bulk read", async () => {
    const staleHeadHarness = createHarness();
    const staleHead = seedManagerStatProjection(staleHeadHarness);
    staleHeadHarness.firestore.bulkGetHook = () => {
      staleHeadHarness.firestore.seed(paths("team-1", "game-1").game, {
        ...staleHeadHarness.firestore.read(paths("team-1", "game-1").game),
        diamondProjectionRevision: staleHead.sourceRevision + 1,
      });
    };
    await assert.rejects(
      staleHeadHarness.handlers.getDiamondManagerStats(
        {
          teamId: "team-1",
          gameHeads: [staleHead],
          playerIds: ["home-1"],
        },
        staleHeadHarness.managerContext,
      ),
      (error) =>
        error.code === "aborted" &&
        error.details?.reason === "manager-stat-game-head-mismatch",
    );

    const reprojectedHarness = createHarness();
    const reprojectedHead = seedManagerStatProjection(reprojectedHarness);
    reprojectedHarness.firestore.bulkGetHook = () => {
      reprojectedHarness.firestore.seed(paths("team-1", "game-1").game, {
        ...reprojectedHarness.firestore.read(paths("team-1", "game-1").game),
        diamondProjectionHash: `sha256:${"f".repeat(64)}`,
      });
    };
    await assert.rejects(
      reprojectedHarness.handlers.getDiamondManagerStats(
        {
          teamId: "team-1",
          gameHeads: [reprojectedHead],
          playerIds: ["home-1"],
        },
        reprojectedHarness.managerContext,
      ),
      (error) =>
        error.code === "aborted" &&
        error.details?.reason === "manager-stat-game-head-mismatch",
    );

    const revokedHarness = createHarness();
    const revokedHead = seedManagerStatProjection(revokedHarness);
    revokedHarness.firestore.bulkGetHook = () => {
      revokedHarness.firestore.seed("teams/team-1", {
        ...revokedHarness.firestore.read("teams/team-1"),
        ownerId: "replacement-manager",
      });
    };
    await assert.rejects(
      revokedHarness.handlers.getDiamondManagerStats(
        {
          teamId: "team-1",
          gameHeads: [revokedHead],
          playerIds: ["home-1"],
        },
        revokedHarness.managerContext,
      ),
      (error) => error.code === "permission-denied",
    );
  });

  it("rejects malformed private stat documents and over-bound requests fail before reads", async () => {
    const wrongHeadHarness = createHarness();
    const wrongHead = seedManagerStatProjection(wrongHeadHarness);
    await assert.rejects(
      wrongHeadHarness.handlers.getDiamondManagerStats(
        {
          teamId: "team-1",
          gameHeads: [
            { ...wrongHead, projectionHash: `sha256:${"f".repeat(64)}` },
          ],
          playerIds: ["home-1"],
        },
        wrongHeadHarness.managerContext,
      ),
      (error) =>
        error.code === "aborted" &&
        error.details?.reason === "manager-stat-game-head-mismatch",
    );
    await assert.rejects(
      wrongHeadHarness.handlers.getDiamondManagerStats(
        {
          teamId: "team-1",
          gameHeads: [
            Object.fromEntries(
              Object.entries(wrongHead).filter(
                ([key]) => key !== "projectionHash",
              ),
            ),
          ],
          playerIds: ["home-1"],
        },
        wrongHeadHarness.managerContext,
      ),
      (error) => error.code === "invalid-argument",
    );
    assert.equal(wrongHeadHarness.firestore.bulkGetCalls, 0);

    const harness = createHarness();
    const head = seedManagerStatProjection(harness);
    const privatePath = `${paths("team-1", "game-1").diamondStatGeneration(head.instanceId)}/privatePlayerStats/home-1`;
    harness.firestore.seed(privatePath, {
      ...harness.firestore.read(privatePath),
      statConfigSnapshotHash: `sha256:${"c".repeat(64)}`,
    });
    await assert.rejects(
      harness.handlers.getDiamondManagerStats(
        { teamId: "team-1", gameHeads: [head], playerIds: ["home-1"] },
        harness.managerContext,
      ),
      (error) =>
        error.code === "aborted" &&
        error.details?.reason === "manager-stat-document-mismatch",
    );

    await assert.rejects(
      harness.handlers.getDiamondManagerStats(
        {
          teamId: "team-1",
          gameHeads: Array.from({ length: 41 }, (_, index) => ({
            ...head,
            gameId: `game-${String(index + 1)}`,
          })),
          playerIds: ["home-1"],
        },
        harness.managerContext,
      ),
      (error) => error.code === "invalid-argument",
    );
    assert.equal(harness.firestore.bulkGetCalls, 1);

    const corruptTeamHarness = createHarness();
    const corruptTeamHead = seedManagerStatProjection(corruptTeamHarness);
    const teamPath = `${paths("team-1", "game-1").diamondStatGeneration(corruptTeamHead.instanceId)}/teamStats/team`;
    corruptTeamHarness.firestore.seed(teamPath, {
      ...corruptTeamHarness.firestore.read(teamPath),
      projectionGeneration: makeUuid(999),
    });
    await assert.rejects(
      corruptTeamHarness.handlers.getDiamondManagerStats(
        {
          teamId: "team-1",
          gameHeads: [corruptTeamHead],
          playerIds: ["home-1"],
        },
        corruptTeamHarness.managerContext,
      ),
      (error) =>
        error.code === "aborted" &&
        error.details?.reason === "manager-team-stat-document-mismatch",
    );

    const mixedPlayerHarness = createHarness();
    const mixedPlayerHead = seedManagerStatProjection(mixedPlayerHarness);
    const mixedPlayerPath = `${paths("team-1", "game-1").diamondStatGeneration(mixedPlayerHead.instanceId)}/privatePlayerStats/home-1`;
    mixedPlayerHarness.firestore.seed(mixedPlayerPath, {
      ...mixedPlayerHarness.firestore.read(mixedPlayerPath),
      projectionHash: `sha256:${"f".repeat(64)}`,
    });
    await assert.rejects(
      mixedPlayerHarness.handlers.getDiamondManagerStats(
        {
          teamId: "team-1",
          gameHeads: [mixedPlayerHead],
          playerIds: ["home-1"],
        },
        mixedPlayerHarness.managerContext,
      ),
      (error) =>
        error.code === "aborted" &&
        error.details?.reason === "manager-stat-document-mismatch",
    );

    const mixedTeamHarness = createHarness();
    const mixedTeamHead = seedManagerStatProjection(mixedTeamHarness);
    const mixedTeamPath = `${paths("team-1", "game-1").diamondStatGeneration(mixedTeamHead.instanceId)}/teamStats/team`;
    mixedTeamHarness.firestore.seed(mixedTeamPath, {
      ...mixedTeamHarness.firestore.read(mixedTeamPath),
      projectionHash: `sha256:${"f".repeat(64)}`,
    });
    await assert.rejects(
      mixedTeamHarness.handlers.getDiamondManagerStats(
        {
          teamId: "team-1",
          gameHeads: [mixedTeamHead],
          playerIds: ["home-1"],
        },
        mixedTeamHarness.managerContext,
      ),
      (error) =>
        error.code === "aborted" &&
        error.details?.reason === "manager-team-stat-document-mismatch",
    );
  });
  it("configures a team idempotently with a server-private receipt and canonical profile", async () => {
    const harness = createHarness({
      documents: {
        "teams/team-1": {
          id: "team-1",
          ownerId: "manager-1",
          name: "Comets",
          sport: "baseball",
          active: true,
          isPublic: true,
        },
      },
    });
    const request = {
      requestId: makeUuid(2),
      teamId: "team-1",
      appBuild: DIAMOND_APP_BUILD,
      sport: "baseball",
      rulesProfileId: null,
      captureMode: "full",
      enabled: true,
    };
    const first = await harness.handlers.configureDiamondTeam(
      request,
      harness.managerContext,
    );
    const second = await harness.handlers.configureDiamondTeam(
      request,
      harness.managerContext,
    );
    assert.deepEqual(second, first);
    assert.equal(first.enabled, true);
    assert.equal(first.captureMode, "full");
    assert.equal(first.rulesProfileId, "baseball-youth");
    assert.equal(first.settings.captureMode, "full");
    assert.equal(
      harness.firestore.read("teams/team-1").diamondScorebook.configuredBy,
      "manager-1",
    );
    assert.ok(
      harness.firestore.read(
        `teams/team-1/diamondConfigurationRequests/${request.requestId}`,
      ),
    );

    await assert.rejects(
      harness.handlers.configureDiamondTeam(
        { ...request, rulesProfileId: "baseball-nfhs" },
        harness.managerContext,
      ),
      (error) => error.code === "already-exists",
    );
  });

  it("performs no team-configuration writes while rollout policy is dark", async () => {
    const dark = createHarness({
      documents: {
        "securityPolicies/diamondScorebook": {
          mode: "disabled",
          revision: 8,
          teamIds: [],
          minimumAppBuild: 99,
        },
        "teams/team-1": {
          ...baseDocuments()["teams/team-1"],
          diamondScorebook: undefined,
        },
      },
    });
    const enabledRequest = {
      requestId: makeUuid(5),
      teamId: "team-1",
      appBuild: DIAMOND_APP_BUILD,
      sport: "baseball",
      rulesProfileId: "baseball-youth",
      rulesProfileVersion: 1,
      captureMode: "quick",
      enabled: true,
    };
    const before = [...dark.firestore.documents.entries()];
    await assert.rejects(
      dark.handlers.configureDiamondTeam(enabledRequest, dark.managerContext),
      (error) => error.code === "failed-precondition",
    );
    const disabledRequest = {
      ...enabledRequest,
      requestId: makeUuid(6),
      enabled: false,
    };
    await assert.rejects(
      dark.handlers.configureDiamondTeam(disabledRequest, dark.managerContext),
      (error) => error.code === "failed-precondition",
    );
    assert.deepEqual([...dark.firestore.documents.entries()], before);
  });

  it("fails closed for missing, malformed, and unreadable policy state", async () => {
    for (const policy of [
      undefined,
      { mode: "enabled", revision: 0, teamIds: [] },
      { mode: "future", revision: 1, teamIds: [] },
    ]) {
      const documents = baseDocuments();
      if (policy === undefined)
        delete documents["securityPolicies/diamondScorebook"];
      else documents["securityPolicies/diamondScorebook"] = policy;
      const harness = createHarness({
        firestore: new FakeFirestore(documents),
      });
      const access = await harness.handlers.getDiamondAccess(
        {
          teamId: "team-1",
          gameId: "game-1",
          appBuild: DIAMOND_APP_BUILD,
        },
        harness.managerContext,
      );
      assert.equal(access.policyMode, "disabled");
      assert.equal(access.canActivate, false);
      await assert.rejects(
        activate(harness),
        (error) => error.code === "failed-precondition",
      );
    }

    const harness = createHarness();
    const original = harness.firestore._documentSnapshot.bind(
      harness.firestore,
    );
    harness.firestore._documentSnapshot = (reference) => {
      if (reference.path === "securityPolicies/diamondScorebook")
        throw new Error("read failed");
      return original(reference);
    };
    const access = await harness.handlers.getDiamondAccess(
      { teamId: "team-1", appBuild: DIAMOND_APP_BUILD },
      harness.managerContext,
    );
    assert.equal(access.policyMode, "disabled");
    assert.equal(access.reason, "policy-unreadable");
  });

  it("requires a positive compatibility generation and applies the policy minimum", async () => {
    for (const appBuild of [undefined, null, 0, -1, "2"]) {
      const harness = createHarness();
      await assert.rejects(
        harness.handlers.getDiamondAccess(
          { teamId: "team-1", gameId: "game-1", appBuild },
          harness.managerContext,
        ),
        (error) => error.code === "invalid-argument",
      );
    }

    const harness = createHarness({
      documents: {
        "securityPolicies/diamondScorebook": {
          mode: "enabled",
          revision: 2,
          teamIds: [],
          rolloutPercent: 100,
          minimumAppBuild: 3,
        },
      },
    });
    const access = await harness.handlers.getDiamondAccess(
      {
        teamId: "team-1",
        gameId: "game-1",
        appBuild: DIAMOND_APP_BUILD,
      },
      harness.managerContext,
    );
    assert.equal(access.canActivate, false);
    assert.equal(access.reason, "minimum-app-build");
    await assert.rejects(
      activate(harness),
      (error) => error.code === "failed-precondition",
    );
  });

  it("enforces percentage cohorts per game while retaining explicit team allowlists", async () => {
    const outsideCohort = createHarness({
      documents: {
        "securityPolicies/diamondScorebook": {
          mode: "enabled",
          revision: 3,
          teamIds: [],
          rolloutPercent: 1,
        },
      },
    });
    const teamAccess = await outsideCohort.handlers.getDiamondAccess(
      { teamId: "team-1", appBuild: DIAMOND_APP_BUILD },
      outsideCohort.managerContext,
    );
    assert.equal(teamAccess.available, true);
    const gameAccess = await outsideCohort.handlers.getDiamondAccess(
      {
        teamId: "team-1",
        gameId: "game-1",
        appBuild: DIAMOND_APP_BUILD,
      },
      outsideCohort.managerContext,
    );
    assert.equal(gameAccess.canActivate, false);
    assert.equal(gameAccess.reason, "game-not-in-rollout");
    await assert.rejects(
      activate(outsideCohort),
      (error) =>
        error.code === "failed-precondition" &&
        error.details?.reason === "game-not-in-rollout",
    );

    const allowlisted = createHarness({
      documents: {
        "securityPolicies/diamondScorebook": {
          mode: "enabled",
          revision: 4,
          teamIds: ["team-1"],
          rolloutPercent: 1,
        },
      },
    });
    assert.equal((await activate(allowlisted)).activated, true);
  });

  it("blocks inactive teams, legacy/shared data, and unknown tracking engines without claiming a game", async () => {
    const inactive = createHarness({
      documents: {
        "teams/team-1": { ...baseDocuments()["teams/team-1"], active: false },
      },
    });
    await assert.rejects(
      activate(inactive),
      (error) => error.code === "failed-precondition",
    );
    assert.equal(
      inactive.firestore.read("teams/team-1/games/game-1").trackingEngine,
      undefined,
    );

    for (const collectionName of LEGACY_TRACKING_COLLECTIONS) {
      const legacy = createHarness();
      legacy.firestore.seed(
        `teams/team-1/games/game-1/${collectionName}/legacy-1`,
        { value: 1 },
      );
      await assert.rejects(
        activate(legacy),
        (error) => error.code === "failed-precondition",
      );
      assert.equal(
        legacy.firestore.read("teams/team-1/games/game-1").trackingEngine,
        undefined,
      );
    }

    const unknown = createHarness({
      documents: {
        "teams/team-1/games/game-1": {
          ...baseDocuments()["teams/team-1/games/game-1"],
          trackingEngine: "diamond-v3",
        },
      },
    });
    await assert.rejects(
      activate(unknown),
      (error) => error.code === "failed-precondition",
    );

    const shared = createHarness({
      documents: {
        "teams/team-1/games/game-1": {
          ...baseDocuments()["teams/team-1/games/game-1"],
          isSharedGame: true,
          sharedScheduleId: "shared-schedule-1",
          sharedScheduleOpponentTeamId: "team-2",
          sharedScheduleOpponentGameId: "game-2",
        },
      },
    });
    await assert.rejects(
      activate(shared),
      (error) =>
        error.code === "failed-precondition" &&
        error.details?.reason === "shared-game-requires-canonical-scorebook",
    );
    assert.equal(
      shared.firestore.read("teams/team-1/games/game-1").trackingEngine,
      undefined,
    );
  });

  it("atomically activates, pins a generation, and exposes bounded private roster candidates only", async () => {
    const harness = createHarness();
    const result = await activate(harness);
    assert.equal(result.activated, true);
    assert.equal(result.trackingEngine, DIAMOND_ENGINE);
    assert.equal(result.state.revision, 1);
    assert.deepEqual(result.state.presentation.availablePlayers.home, [
      {
        playerId: "home-1",
        displayName: "Home Hitter",
        name: "Home Hitter",
        jerseyNumber: "7",
        number: "7",
      },
    ]);
    assert.deepEqual(result.state.presentation.availablePlayers.away, [
      {
        playerId: "away-1",
        displayName: "Away Hitter",
        name: "Away Hitter",
        jerseyNumber: "12",
        number: "12",
      },
    ]);
    assert.deepEqual(
      result.state.lease.eligibleScorers.map((entry) => entry.playerId),
      ["manager-1", "scorer-1"],
    );
    assert.doesNotMatch(
      JSON.stringify(result.state),
      /medicalInfo|guardianEmail|private@example/i,
    );
    const game = harness.firestore.read("teams/team-1/games/game-1");
    const root = harness.firestore.read(paths("team-1", "game-1").scorebook);
    assert.equal(game.trackingEngine, DIAMOND_ENGINE);
    assert.equal(result.state.instanceId, root.instanceId);
    assert.equal(root.instanceId, game.diamondScorebookInstanceId);
    assert.equal(root.rolloutModeAtActivation, "enabled");
    assert.equal(root.rolloutPercentAtActivation, 100);
    assert.equal(root.rolloutBucketAtActivation, 98);
    assert.equal(root.rolloutAllowlistedAtActivation, false);
    assert.equal(root.statConfigSnapshot.configId, "baseball-standard");
    assert.deepEqual(root.statConfigSnapshot.privatePlayerStatIds, []);
    assert.match(root.statConfigSnapshot.snapshotHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(
      game.diamondStatConfigSnapshotHash,
      root.statConfigSnapshot.snapshotHash,
    );
    const publicState = harness.firestore.read(
      paths("team-1", "game-1").publicState,
    );
    assert.doesNotMatch(
      JSON.stringify(publicState),
      /availablePlayers|medicalInfo|guardianEmail|currentScorerUid/,
    );
  });

  it("requires and transactionally pins a bounded exact stat config before claiming a game", async () => {
    const cases = [
      {
        mutate(documents) {
          delete documents["teams/team-1/games/game-1"].statTrackerConfigId;
        },
        reason: "id-invalid",
      },
      {
        mutate(documents) {
          documents["teams/team-1/games/game-1"].statTrackerConfigId =
            "missing-config";
        },
        reason: "missing",
      },
      {
        mutate(documents) {
          documents[
            "teams/team-1/statTrackerConfigs/baseball-standard"
          ].statDefinitions = [{ id: "hr", visibility: "private" }];
        },
        reason: "malformed",
      },
      {
        mutate(documents) {
          documents[
            "teams/team-1/statTrackerConfigs/baseball-standard"
          ].statDefinitions = [
            { id: "hr", scope: "player", visibility: "public" },
            { id: "hr", scope: "player", visibility: "private" },
          ];
        },
        reason: "duplicate",
      },
      {
        mutate(documents) {
          documents[
            "teams/team-1/statTrackerConfigs/baseball-standard"
          ].statDefinitions = Array.from({ length: 257 }, (_, index) => ({
            id: `stat_${String(index)}`,
            scope: "player",
            visibility: "public",
          }));
        },
        reason: "too-large",
      },
    ];
    for (const testCase of cases) {
      const documents = baseDocuments();
      testCase.mutate(documents);
      const harness = createHarness({
        firestore: new FakeFirestore(documents),
      });
      await assert.rejects(
        activate(harness),
        (error) =>
          error.code === "failed-precondition" &&
          String(error.details?.reason || "").includes(testCase.reason),
      );
      assert.equal(
        harness.firestore.read("teams/team-1/games/game-1").trackingEngine,
        undefined,
      );
      assert.equal(
        harness.firestore.read(paths("team-1", "game-1").scorebook),
        undefined,
      );
    }

    const unreadable = createHarness();
    const originalRead = unreadable.firestore._documentSnapshot.bind(
      unreadable.firestore,
    );
    unreadable.firestore._documentSnapshot = (reference) => {
      if (
        reference.path === "teams/team-1/statTrackerConfigs/baseball-standard"
      ) {
        throw Object.assign(new Error("read failed"), {
          code: "firestore-unavailable",
        });
      }
      return originalRead(reference);
    };
    await assert.rejects(
      activate(unreadable),
      (error) =>
        error.code === "unavailable" &&
        error.details?.reason === "firestore-unavailable",
    );
    assert.equal(
      unreadable.firestore.read(paths("team-1", "game-1").scorebook),
      undefined,
    );
  });

  it("fails closed before activation when quick or full stat configs are incompatible", async () => {
    const incompatibleCases = [
      {
        label: "missing sport declaration",
        mutate(config) {
          delete config.baseType;
        },
      },
      {
        label: "mismatched sport declaration",
        mutate(config) {
          config.baseType = "Softball";
        },
      },
      {
        label: "empty player catalog",
        mutate(config) {
          config.statDefinitions = [];
        },
      },
      {
        label: "missing required player stat",
        mutate(config) {
          config.statDefinitions = config.statDefinitions.filter(
            (definition) => definition.id !== "fp",
          );
        },
      },
      {
        label: "no explicitly public player stat",
        mutate(config) {
          config.statDefinitions = config.statDefinitions.map((definition) => ({
            ...definition,
            visibility: "private",
          }));
        },
      },
    ];
    for (const captureMode of ["quick", "full"]) {
      for (const incompatibleCase of incompatibleCases) {
        const documents = baseDocuments();
        incompatibleCase.mutate(
          documents["teams/team-1/statTrackerConfigs/baseball-standard"],
        );
        const harness = createHarness({
          firestore: new FakeFirestore(documents),
        });
        await assert.rejects(
          harness.handlers.activateDiamondGame(
            {
              requestId: makeUuid(
                920 +
                  (captureMode === "full" ? 20 : 0) +
                  incompatibleCases.indexOf(incompatibleCase),
              ),
              teamId: "team-1",
              gameId: "game-1",
              captureMode,
              appBuild: DIAMOND_APP_BUILD,
            },
            harness.managerContext,
          ),
          (error) =>
            error.code === "failed-precondition" &&
            error.details?.reason === "diamond-stat-config-incompatible",
          `${captureMode}: ${incompatibleCase.label}`,
        );
        const game = harness.firestore.read("teams/team-1/games/game-1");
        assert.equal(game.trackingEngine, undefined);
        assert.equal(game.diamondScorebookInstanceId, undefined);
        assert.equal(
          harness.firestore.read(paths("team-1", "game-1").scorebook),
          undefined,
        );
        assert.equal(
          harness.firestore.countDirectChildren(
            paths("team-1", "game-1").events,
          ),
          0,
        );
      }
    }
  });

  it("accepts Softball as a fastpitch-compatible stat config sport", async () => {
    const documents = baseDocuments();
    documents["teams/team-1"] = {
      ...documents["teams/team-1"],
      sport: "fastpitch",
      diamondScorebook: {
        ...documents["teams/team-1"].diamondScorebook,
        sport: "fastpitch",
        rulesProfileId: "fastpitch-youth",
      },
    };
    documents["teams/team-1/statTrackerConfigs/baseball-standard"].baseType =
      "Softball";
    documents["teams/team-1/games/game-1"].sport = "fastpitch";
    const harness = createHarness({ firestore: new FakeFirestore(documents) });
    const result = await activate(harness);
    assert.equal(result.activated, true);
    assert.equal(
      harness.firestore.read("teams/team-1/games/game-1").trackingEngine,
      DIAMOND_ENGINE,
    );
  });

  it("reconciles activation from the immutable pin and rejects a damaged committed pin", async () => {
    const harness = createHarness();
    const requestId = makeUuid(8);
    await activate(harness, requestId);
    const resourcePaths = paths("team-1", "game-1");
    const committedRoot = harness.firestore.read(resourcePaths.scorebook);
    harness.firestore.delete(
      resourcePaths.statTrackerConfig("baseball-standard"),
    );
    const retry = await activate(harness, requestId);
    assert.equal(retry.activated, true);
    assert.equal(
      harness.firestore.read(resourcePaths.scorebook).statConfigSnapshot
        .snapshotHash,
      committedRoot.statConfigSnapshot.snapshotHash,
    );

    harness.firestore.seed(resourcePaths.scorebook, {
      ...committedRoot,
      statConfigSnapshot: {
        ...committedRoot.statConfigSnapshot,
        privatePlayerStatIds: ["hr"],
      },
    });
    await assert.rejects(
      activate(harness, requestId),
      (error) =>
        error.code === "failed-precondition" &&
        error.details?.reason === "stat-config-snapshot-integrity",
    );
  });

  it("keeps canonical home/away labels and roster sides correct when AllPlays is the away team", async () => {
    const harness = createHarness({
      documents: {
        "teams/team-1/games/game-1": {
          ...baseDocuments()["teams/team-1/games/game-1"],
          homeTeamId: "opponent-1",
          awayTeamId: "team-1",
          homeTeamName: "Rockets",
          awayTeamName: "Comets",
          isHome: false,
        },
      },
    });
    const activation = await activate(harness);
    assert.deepEqual(
      harness.firestore.read(paths("team-1", "game-1").scorebook)
        .orientationSnapshot,
      {
        schemaVersion: 1,
        managedSide: "away",
        opponentSide: "home",
        managedTeamId: "team-1",
        opponentTeamId: "opponent-1",
        homeTeamId: "opponent-1",
        awayTeamId: "team-1",
        teamName: "Comets",
        opponentName: "Rockets",
        homeName: "Rockets",
        awayName: "Comets",
      },
    );
    assert.equal(activation.state.presentation.managedSide, "away");
    assert.equal(activation.state.homeName, "Rockets");
    assert.equal(activation.state.awayName, "Comets");
    assert.equal(
      activation.state.presentation.availablePlayers.away[0].playerId,
      "home-1",
    );
    assert.equal(
      activation.state.presentation.availablePlayers.home[0].playerId,
      "away-1",
    );
    const publicGame = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(publicGame.game.teamName, "Rockets");
    assert.equal(publicGame.game.opponent, "Comets");
  });

  it("fails activation on ambiguous orientation and keeps a valid pin authoritative", async () => {
    const missing = createHarness({
      documents: {
        "teams/team-1/games/game-1": {
          ...baseDocuments()["teams/team-1/games/game-1"],
          homeTeamId: null,
          awayTeamId: null,
          isHome: null,
        },
      },
    });
    await assert.rejects(
      activate(missing),
      (error) =>
        error.code === "failed-precondition" &&
        error.details?.reason === "orientation-side-required",
    );
    assert.equal(
      missing.firestore.read("teams/team-1/games/game-1").trackingEngine,
      undefined,
    );
    assert.equal(
      missing.firestore.read(paths("team-1", "game-1").scorebook),
      undefined,
    );

    const conflicting = createHarness({
      documents: {
        "teams/team-1/games/game-1": {
          ...baseDocuments()["teams/team-1/games/game-1"],
          isHome: false,
        },
      },
    });
    await assert.rejects(
      activate(conflicting),
      (error) =>
        error.code === "failed-precondition" &&
        error.details?.reason === "orientation-side-conflict",
    );

    const pinned = createHarness();
    await activate(pinned);
    const gamePath = "teams/team-1/games/game-1";
    pinned.firestore.seed(gamePath, {
      ...pinned.firestore.read(gamePath),
      isHome: false,
      teamSide: "away",
      homeAway: "away",
      homeTeamId: "opponent-1",
      awayTeamId: "team-1",
      opponentTeamId: "opponent-1",
      opponentName: "Mutated Rockets",
      homeTeamName: "Mutated Rockets",
      awayTeamName: "Mutated Comets",
    });
    const retried = await activate(pinned);
    assert.equal(retried.state.presentation.managedSide, "home");
    assert.equal(retried.state.homeName, "Comets");
    assert.equal(retried.state.awayName, "Rockets");
    const state = await pinned.handlers.getDiamondState(
      { teamId: "team-1", gameId: "game-1", visibility: "private" },
      pinned.managerContext,
    );
    assert.equal(state.presentation.managedSide, "home");
    assert.equal(state.homeName, "Comets");
    assert.equal(state.awayName, "Rockets");
    assert.equal(
      state.presentation.availablePlayers.home[0].playerId,
      "home-1",
    );
  });

  it("does not use an arbitrary private opponentTeamId as Admin-SDK roster authority", async () => {
    const harness = createHarness({
      documents: {
        "teams/private-target": {
          id: "private-target",
          ownerId: "other-owner",
          name: "Private Team",
          sport: "baseball",
          active: true,
          isPublic: false,
        },
        "teams/private-target/players/secret-player": {
          displayName: "Secret Child Name",
          jerseyNumber: "99",
        },
        "teams/team-1/games/game-1": {
          ...baseDocuments()["teams/team-1/games/game-1"],
          homeTeamId: "team-1",
          awayTeamId: "private-target",
          opponentTeamId: "private-target",
        },
      },
    });
    const activation = await activate(harness);
    assert.deepEqual(activation.state.presentation.availablePlayers.away, []);
    assert.doesNotMatch(
      JSON.stringify(activation.state),
      /Secret Child Name|secret-player/,
    );
  });

  it("reconciles committed configuration and activation retries after policy shutdown", async () => {
    const configureHarness = createHarness({
      documents: {
        "teams/team-1": {
          id: "team-1",
          ownerId: "manager-1",
          name: "Comets",
          sport: "baseball",
          active: true,
          isPublic: true,
        },
      },
    });
    const configuration = {
      requestId: makeUuid(3),
      teamId: "team-1",
      appBuild: DIAMOND_APP_BUILD,
      sport: "baseball",
      rulesProfileId: "baseball-youth",
      rulesProfileVersion: 1,
      captureMode: "quick",
      enabled: true,
    };
    const configured = await configureHarness.handlers.configureDiamondTeam(
      configuration,
      configureHarness.managerContext,
    );
    configureHarness.firestore.seed("securityPolicies/diamondScorebook", {
      mode: "disabled",
      revision: 2,
      teamIds: [],
    });
    assert.deepEqual(
      await configureHarness.handlers.configureDiamondTeam(
        configuration,
        configureHarness.managerContext,
      ),
      configured,
    );

    const activationHarness = createHarness();
    const activationRequest = {
      requestId: makeUuid(4),
      teamId: "team-1",
      gameId: "game-1",
      captureMode: "quick",
      appBuild: DIAMOND_APP_BUILD,
    };
    const activated = await activationHarness.handlers.activateDiamondGame(
      activationRequest,
      activationHarness.managerContext,
    );
    activationHarness.firestore.seed("securityPolicies/diamondScorebook", {
      mode: "disabled",
      revision: 2,
      teamIds: [],
    });
    const retried = await activationHarness.handlers.activateDiamondGame(
      activationRequest,
      activationHarness.managerContext,
    );
    assert.equal(retried.activated, true);
    assert.equal(retried.state.revision, activated.state.revision);
  });

  it("returns duplicate for the same command body and rejects commandId reuse with another body", async () => {
    const harness = createHarness();
    await activate(harness);
    const command = {
      commandId: makeUuid(30),
      expectedRevision: 1,
      type: "set_lineup",
      payload: { side: "home", entries: [{ slot: 1, playerId: "home-1" }] },
    };
    const first = await submit(harness, command);
    const duplicate = await submit(harness, command);
    assert.equal(first.outcome, "accepted");
    assert.equal(duplicate.outcome, "duplicate");
    assert.equal(duplicate.revision, first.revision);
    assert.equal(
      harness.firestore.countDirectChildren(paths("team-1", "game-1").events),
      2,
    );

    const conflict = await submit(harness, {
      ...command,
      payload: { side: "away", entries: [{ slot: 1, playerId: "away-1" }] },
    });
    assert.equal(conflict.outcome, "rejected");
    assert.equal(conflict.rejection.code, "idempotency-conflict");
    assert.equal(
      harness.firestore.countDirectChildren(paths("team-1", "game-1").events),
      2,
    );
  });

  it("reconciles an exact committed command retry after emergency policy disable", async () => {
    const harness = createHarness();
    await activate(harness);
    const command = {
      commandId: makeUuid(35),
      expectedRevision: 1,
      type: "set_lineup",
      payload: { side: "home", entries: [{ slot: 1, playerId: "home-1" }] },
    };
    const accepted = await submit(harness, command);
    harness.firestore.seed("securityPolicies/diamondScorebook", {
      mode: "disabled",
      revision: 2,
      teamIds: [],
    });
    const duplicate = await submit(harness, command);
    assert.equal(accepted.outcome, "accepted");
    assert.equal(duplicate.outcome, "duplicate");
    assert.equal(duplicate.revision, accepted.revision);
  });

  it("checks the minimum compatibility generation for new commands but not exact committed retries", async () => {
    const harness = createHarness();
    await activate(harness);
    const command = {
      commandId: makeUuid(36),
      expectedRevision: 1,
      type: "set_lineup",
      payload: { side: "home", entries: [{ slot: 1, playerId: "home-1" }] },
    };
    const accepted = await submit(harness, command);
    harness.firestore.seed("securityPolicies/diamondScorebook", {
      mode: "enabled",
      revision: 2,
      teamIds: [],
      rolloutPercent: 100,
      minimumAppBuild: 3,
    });
    const duplicate = await submit(harness, command);
    assert.equal(duplicate.outcome, "duplicate");
    assert.equal(duplicate.revision, accepted.revision);

    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(37),
        expectedRevision: 2,
        type: "set_lineup",
        payload: {
          side: "away",
          entries: [{ slot: 1, playerId: "away-1" }],
        },
      }),
      (error) => error.code === "failed-precondition",
    );
    assert.equal(
      harness.firestore.read(paths("team-1", "game-1").command(makeUuid(37))),
      undefined,
    );
  });

  it("requires command build and instance pins and fences a deleted/recreated game before receipt reconciliation", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const originalInstanceId = harness.firestore.read(
      resourcePaths.scorebook,
    ).instanceId;
    const rawCommand = {
      schemaVersion: 2,
      commandId: makeUuid(38),
      teamId: "team-1",
      gameId: "game-1",
      appBuild: DIAMOND_APP_BUILD,
      expectedInstanceId: originalInstanceId,
      leaseId: harness.firestore.read(resourcePaths.scorebook).scorerLease
        .leaseId,
      expectedRevision: 1,
      rulesProfileId: "baseball-youth",
      rulesProfileVersion: 1,
      type: "set_lineup",
      payload: { side: "home", entries: [{ slot: 1, playerId: "home-1" }] },
    };
    for (const patch of [
      { appBuild: undefined },
      { appBuild: 0 },
      { expectedInstanceId: undefined },
      { expectedInstanceId: "not-a-generation" },
    ]) {
      await assert.rejects(
        harness.handlers.submitDiamondCommand(
          { ...rawCommand, ...patch },
          harness.managerContext,
        ),
        (error) => error.code === "invalid-argument",
      );
    }

    const accepted = await harness.handlers.submitDiamondCommand(
      rawCommand,
      harness.managerContext,
    );
    assert.equal(accepted.outcome, "accepted");
    await assert.rejects(
      harness.handlers.submitDiamondCommand(
        {
          ...rawCommand,
          expectedInstanceId: makeUuid(901),
        },
        harness.managerContext,
      ),
      (error) =>
        error.code === "aborted" && error.details?.reason === "stale-instance",
    );

    const replacementInstanceId = makeUuid(902);
    harness.firestore.seed(resourcePaths.scorebook, {
      ...harness.firestore.read(resourcePaths.scorebook),
      instanceId: replacementInstanceId,
    });
    harness.firestore.seed(resourcePaths.game, {
      ...harness.firestore.read(resourcePaths.game),
      diamondScorebookInstanceId: replacementInstanceId,
    });
    await assert.rejects(
      harness.handlers.submitDiamondCommand(
        {
          ...rawCommand,
          commandId: makeUuid(39),
          expectedInstanceId: originalInstanceId,
          expectedRevision: 2,
        },
        harness.managerContext,
      ),
      (error) =>
        error.code === "aborted" && error.details?.reason === "stale-instance",
    );
    assert.equal(
      harness.firestore.read(resourcePaths.command(makeUuid(39))),
      undefined,
    );
    assert.equal(
      harness.firestore.countDirectChildren(resourcePaths.events),
      2,
    );
  });

  it("rejects malformed nested scoring values at the callable boundary without writes", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const before = [...harness.firestore.documents.entries()].map(
      ([path, value]) => [path, clone(value)],
    );
    const malformedCommandId = makeUuid(390);
    await assert.rejects(
      harness.handlers.submitDiamondCommand(
        {
          schemaVersion: 2,
          commandId: malformedCommandId,
          teamId: "team-1",
          gameId: "game-1",
          appBuild: DIAMOND_APP_BUILD,
          expectedInstanceId: harness.firestore.read(resourcePaths.scorebook)
            .instanceId,
          leaseId: harness.firestore.read(resourcePaths.scorebook).scorerLease
            .leaseId,
          expectedRevision: 1,
          rulesProfileId: "baseball-youth",
          rulesProfileVersion: 1,
          type: "record_plate_appearance",
          payload: {
            batterId: "away-1",
            pitcherId: "home-1",
            result: "single",
            batterAdvance: {
              to: "first",
              countsRun: "false",
            },
            runnerAdvances: [],
            outsOnPlay: 0,
            runsBattedIn: -999,
          },
        },
        harness.managerContext,
      ),
      (error) =>
        error.code === "invalid-argument" && /countsRun/i.test(error.message),
    );
    assert.equal(
      harness.firestore.read(resourcePaths.command(malformedCommandId)),
      undefined,
    );
    assert.deepEqual([...harness.firestore.documents.entries()], before);
  });

  it("serializes concurrent devices and definitively rejects the stale expected revision", async () => {
    const harness = createHarness();
    await activate(harness);
    const [left, right] = await Promise.all([
      submit(harness, {
        commandId: makeUuid(31),
        expectedRevision: 1,
        type: "set_lineup",
        payload: { side: "home", entries: [{ slot: 1, playerId: "home-1" }] },
      }),
      submit(harness, {
        commandId: makeUuid(32),
        expectedRevision: 1,
        type: "set_lineup",
        payload: { side: "away", entries: [{ slot: 1, playerId: "away-1" }] },
      }),
    ]);
    assert.deepEqual([left.outcome, right.outcome].sort(), [
      "accepted",
      "rejected",
    ]);
    const rejection =
      left.outcome === "rejected" ? left.rejection : right.rejection;
    assert.equal(rejection.code, "stale-revision");
    assert.equal(rejection.retryable, true);
    assert.equal(
      harness.firestore.read(paths("team-1", "game-1").scorebook).checkpoint
        .sequence,
      2,
    );
  });

  it("persists, renews, and rotates the scorer lease while rejecting stale tokens", async () => {
    let nowMs = 1_750_000_000_000;
    const harness = createHarness({ clock: () => nowMs });
    const activationRequestId = makeUuid(320);
    const activation = await activate(harness, activationRequestId);
    const resourcePaths = paths("team-1", "game-1");
    const activatedRoot = harness.firestore.read(resourcePaths.scorebook);
    assert.deepEqual(activatedRoot.scorerLease, {
      holderUid: "manager-1",
      leaseId: activationRequestId,
      expiresAtMillis: nowMs + 15 * 60 * 1000,
      epoch: 1,
      acquiredAt: new Date(nowMs).toISOString(),
      renewedAt: new Date(nowMs).toISOString(),
    });
    assert.equal(activation.state.lease.status, "owned");
    assert.equal(activation.state.lease.canScore, true);
    assert.equal(activation.state.lease.leaseId, activationRequestId);

    nowMs += 60_000;
    const lineup = await submit(harness, {
      commandId: makeUuid(321),
      expectedRevision: 1,
      type: "set_lineup",
      payload: { side: "home", entries: [{ slot: 1, playerId: "home-1" }] },
    });
    assert.equal(lineup.outcome, "accepted");
    const renewed = harness.firestore.read(resourcePaths.scorebook).scorerLease;
    assert.equal(renewed.leaseId, activationRequestId);
    assert.equal(renewed.epoch, 1);
    assert.equal(renewed.expiresAtMillis, nowMs + 15 * 60 * 1000);

    const handoffCommandId = makeUuid(322);
    const handoff = await submit(harness, {
      commandId: handoffCommandId,
      expectedRevision: 2,
      type: "scorer_handoff",
      payload: { toUid: "scorer-1" },
    });
    assert.equal(handoff.outcome, "accepted");
    assert.deepEqual(
      harness.firestore.read(resourcePaths.scorebook).scorerLease,
      {
        holderUid: "scorer-1",
        leaseId: handoffCommandId,
        expiresAtMillis: nowMs + 15 * 60 * 1000,
        epoch: 2,
        acquiredAt: new Date(nowMs).toISOString(),
        renewedAt: new Date(nowMs).toISOString(),
      },
    );
    assert.equal(handoff.state.lease.status, "held-by-other");
    assert.equal(handoff.state.lease.leaseId, null);
    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(323),
        expectedRevision: 3,
        type: "set_lineup",
        leaseId: activationRequestId,
        payload: { side: "away", entries: [{ slot: 1, playerId: "away-1" }] },
      }),
      (error) =>
        error.code === "unavailable" &&
        error.details?.reason === "lease-held-by-other",
    );
  });

  it("acquires or manager-recovers only an expired lease with durable idempotent audit", async () => {
    let nowMs = 1_750_000_000_000;
    const harness = createHarness({ clock: () => nowMs });
    await activate(harness, makeUuid(324));
    const resourcePaths = paths("team-1", "game-1");

    await assert.rejects(
      changeScorerLease(harness, {
        requestId: makeUuid(325),
        operation: "recover",
        targetUid: "scorer-1",
      }),
      (error) =>
        error.code === "unavailable" &&
        error.details?.reason === "lease-active",
    );
    await assert.rejects(
      changeScorerLease(harness, {
        requestId: makeUuid(326),
        operation: "recover",
        context: harness.scorerContext,
      }),
      (error) => error.code === "permission-denied",
    );

    nowMs += 16 * 60 * 1000;
    const requestId = makeUuid(327);
    const recovered = await changeScorerLease(harness, {
      requestId,
      operation: "recover",
      targetUid: "scorer-1",
    });
    assert.equal(recovered.outcome, "accepted");
    assert.equal(recovered.revision, 2);
    assert.equal(recovered.state.lease.status, "held-by-other");
    assert.equal(recovered.state.lease.leaseId, null);
    const root = harness.firestore.read(resourcePaths.scorebook);
    assert.equal(root.scorerLease.holderUid, "scorer-1");
    assert.equal(root.scorerLease.leaseId, requestId);
    assert.equal(root.scorerLease.epoch, 2);
    const audit = harness.firestore.read(resourcePaths.audit(requestId));
    assert.equal(audit.type, "scorer-lease-changed");
    assert.equal(audit.operation, "recover");
    assert.equal(audit.actorUid, "manager-1");
    assert.equal(audit.previousHolderUid, "manager-1");
    assert.equal(audit.nextHolderUid, "scorer-1");

    harness.firestore.seed("securityPolicies/diamondScorebook", {
      mode: "disabled",
      revision: 2,
      teamIds: [],
    });
    const duplicate = await changeScorerLease(harness, {
      requestId,
      operation: "recover",
      targetUid: "scorer-1",
      expectedRevision: 1,
    });
    assert.equal(duplicate.outcome, "duplicate");
    assert.equal(
      harness.firestore.countDirectChildren(resourcePaths.events),
      2,
    );

    const scorerState = await harness.handlers.getDiamondState(
      { teamId: "team-1", gameId: "game-1", visibility: "private" },
      harness.scorerContext,
    );
    assert.equal(scorerState.lease.status, "owned");
    assert.equal(scorerState.lease.leaseId, requestId);
  });

  it("allows delegated scorekeepers but keeps configuration, activation, and recovery manager-only", async () => {
    const harness = createHarness({
      documents: {
        "teams/team-1": {
          ...baseDocuments()["teams/team-1"],
          scorekeeperIds: ["scorer-1"],
        },
      },
    });
    await assert.rejects(
      activate({ ...harness, managerContext: harness.scorerContext }),
      (error) => error.code === "permission-denied",
    );
    await activate(harness);
    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(33),
        expectedRevision: 1,
        type: "set_lineup",
        context: harness.scorerContext,
        payload: { side: "home", entries: [{ slot: 1, playerId: "home-1" }] },
      }),
      (error) =>
        error.code === "unavailable" &&
        error.details?.reason === "lease-held-by-other",
    );
    let canonicalEventReads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === paths("team-1", "game-1").events) {
        canonicalEventReads += 1;
      }
    };
    await assert.rejects(
      harness.handlers.regenerateDiamondProjection(
        { teamId: "team-1", gameId: "game-1" },
        harness.scorerContext,
      ),
      (error) => error.code === "permission-denied",
    );
    assert.equal(canonicalEventReads, 0);
  });

  it("lets the verified manager cancel after scorer handoff during rollback without exposing the reason", async () => {
    const privateReason = "Player medical detail must stay manager-private";
    const harness = createHarness({
      documents: {
        "teams/team-1": {
          ...baseDocuments()["teams/team-1"],
          scorekeeperIds: ["scorer-1"],
        },
      },
    });
    await activate(harness);
    const handoff = await submit(harness, {
      commandId: makeUuid(330),
      expectedRevision: 1,
      type: "scorer_handoff",
      payload: { toUid: "scorer-1" },
    });
    assert.equal(handoff.outcome, "accepted");

    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(331),
        expectedRevision: 2,
        type: "cancel",
        context: harness.scorerContext,
        payload: { confirmed: true, reason: privateReason },
      }),
      (error) => error.code === "permission-denied",
    );

    harness.firestore.seed("securityPolicies/diamondScorebook", {
      mode: "disabled",
      revision: 2,
      teamIds: [],
    });
    const command = {
      commandId: makeUuid(332),
      expectedRevision: 2,
      type: "cancel",
      payload: { confirmed: true, reason: privateReason },
    };
    const accepted = await submit(harness, command);
    const duplicate = await submit(harness, command);
    const resourcePaths = paths("team-1", "game-1");
    const game = harness.firestore.read(resourcePaths.game);
    const publicState = harness.firestore.read(resourcePaths.publicState);
    const publicEvent = harness.firestore.read(
      resourcePaths.publicEvent(accepted.eventId),
    );

    assert.equal(accepted.outcome, "accepted");
    assert.equal(accepted.state.state.lifecycle, "cancelled");
    assert.equal(duplicate.outcome, "duplicate");
    assert.equal(game.status, "cancelled");
    assert.equal(game.liveStatus, "cancelled");
    assert.equal(publicState.lifecycle, "cancelled");
    assert.equal(publicState.readOnlyReason, "game-cancelled");
    assert.equal(publicEvent.description, "Game cancelled");
    assert.equal(
      JSON.stringify({ publicState, publicEvent }).includes(privateReason),
      false,
    );
    assert.equal(
      harness.firestore.countDirectChildren(resourcePaths.events),
      3,
    );
  });

  it("keeps private notes and scorer identity out of public state and replay", async () => {
    const harness = createHarness();
    await activate(harness);
    const noteText = "Coach says keep the medical detail private";
    const result = await submit(harness, {
      commandId: makeUuid(34),
      expectedRevision: 1,
      type: "private_note",
      payload: { text: noteText },
    });
    assert.equal(result.outcome, "accepted");
    assert.ok(
      harness.firestore.read(paths("team-1", "game-1").note(result.eventId)),
    );
    assert.equal(
      harness.firestore.read(
        paths("team-1", "game-1").publicEvent(result.eventId),
      ),
      undefined,
    );
    await assert.rejects(
      harness.handlers.getDiamondState(
        { teamId: "team-1", gameId: "game-1", visibility: "public" },
        harness.managerContext,
      ),
      (error) => error.code === "invalid-argument",
    );
    await assert.rejects(
      harness.handlers.listDiamondEvents(
        {
          teamId: "team-1",
          gameId: "game-1",
          visibility: "public",
          limit: 20,
        },
        harness.managerContext,
      ),
      (error) => error.code === "invalid-argument",
    );
    const publicGame = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
      limit: 20,
    });
    const serialized = JSON.stringify(publicGame);
    assert.doesNotMatch(
      serialized,
      /Coach says|manager-1|currentScorerUid|commandHash|actorUid/,
    );
    assert.equal(
      publicGame.events.some((event) => event.type === "private_note"),
      false,
    );
  });

  it("returns only bounded private event summaries with exact byte and pagination evidence", async () => {
    const harness = createHarness();
    await activate(harness);
    await submit(harness, {
      commandId: makeUuid(341),
      expectedRevision: 1,
      type: "private_note",
      payload: { text: "Staff-only note" },
    });

    const first = await harness.handlers.listDiamondEvents(
      {
        teamId: "team-1",
        gameId: "game-1",
        visibility: "private",
        limit: 1,
      },
      harness.managerContext,
    );
    assert.deepEqual(Object.keys(first).sort(), [
      "accessComplete",
      "collectionComplete",
      "complete",
      "items",
      "nextCursor",
      "responseByteCount",
      "responseByteLimit",
      "sourceRevision",
    ]);
    assert.equal(first.sourceRevision, 2);
    assert.equal(first.collectionComplete, false);
    assert.equal(first.nextCursor, "1");
    assert.equal(first.responseByteLimit, MAX_PRIVATE_EVENT_PAGE_BYTES);
    assert.equal(
      first.responseByteCount,
      Buffer.byteLength(JSON.stringify(first), "utf8"),
    );
    assert.deepEqual(
      Object.keys(first.items[0]).sort(),
      Object.keys(first.items[0])
        .filter((key) =>
          [
            "eventId",
            "sequence",
            "revision",
            "type",
            "payload",
            "voidsEventId",
            "supersedesEventId",
            "createdAt",
            "serverTimestampMs",
          ].includes(key),
        )
        .sort(),
    );
    assert.equal(first.items[0].actorUid, undefined);
    assert.equal(first.items[0].commandId, undefined);
    assert.equal(first.items[0].commandHash, undefined);
    assert.equal(first.items[0].hash, undefined);
    assert.equal(first.items[0].before, undefined);
    assert.equal(first.items[0].after, undefined);

    const second = await harness.handlers.listDiamondEvents(
      {
        teamId: "team-1",
        gameId: "game-1",
        visibility: "private",
        limit: 1,
        cursor: first.nextCursor,
      },
      harness.managerContext,
    );
    assert.equal(second.sourceRevision, 2);
    assert.equal(second.collectionComplete, true);
    assert.equal(second.nextCursor, null);
    assert.equal(second.items[0].type, "private_note");
    assert.deepEqual(second.items[0].payload, { text: "Staff-only note" });
    assert.equal(
      second.responseByteCount,
      Buffer.byteLength(JSON.stringify(second), "utf8"),
    );
  });

  it("rejects a private event page that exceeds the scorer-view byte bound", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const eventPath = [...harness.firestore.documents.keys()].find((path) =>
      path.startsWith(`${resourcePaths.events}/`),
    );
    assert.ok(eventPath);
    const event = harness.firestore.read(eventPath);
    harness.firestore.seed(eventPath, {
      ...event,
      payload: { value: "x".repeat(MAX_PRIVATE_EVENT_PAGE_BYTES) },
    });

    await assert.rejects(
      harness.handlers.listDiamondEvents(
        {
          teamId: "team-1",
          gameId: "game-1",
          visibility: "private",
          limit: 1,
        },
        harness.managerContext,
      ),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "private-event-page-too-large",
    );
  });

  it("byte-packs the largest private event prefix when valid maximum lineups exceed one response", async () => {
    const playerEntries = Array.from({ length: 25 }, (_, index) => {
      const playerId = `player-${String(index + 1).padStart(2, "0")}-${"p".repeat(105)}`;
      return {
        slot: index + 1,
        playerId,
        displayName: `${String(index + 1).padStart(2, "0")}-${"N".repeat(157)}`,
        jerseyNumber: "9".repeat(32),
        starter: true,
        battingRole: "regular",
      };
    });
    const playerDocuments = Object.fromEntries(
      playerEntries.map((entry) => [
        `teams/team-1/players/${entry.playerId}`,
        {
          name: entry.displayName,
          number: entry.jerseyNumber,
        },
      ]),
    );
    const harness = createHarness({ documents: playerDocuments });
    await activate(harness);
    const accepted = await submit(harness, {
      commandId: makeUuid(342),
      expectedRevision: 1,
      type: "set_lineup",
      payload: { side: "home", entries: playerEntries },
    });
    assert.equal(accepted.outcome, "accepted");

    const resourcePaths = paths("team-1", "game-1");
    const largeEventPath = resourcePaths.event(accepted.eventId);
    const largeEvent = harness.firestore.read(largeEventPath);
    assert.ok(
      Buffer.byteLength(JSON.stringify(largeEvent.payload), "utf8") > 8_000,
    );
    for (let sequence = 3; sequence <= 201; sequence += 1) {
      harness.firestore.seed(
        resourcePaths.event(
          `large-lineup-${String(sequence).padStart(3, "0")}`,
        ),
        {
          ...largeEvent,
          eventId: `large-lineup-${String(sequence).padStart(3, "0")}`,
          sequence,
          revision: sequence,
          serverTimestampMs: 1_750_000_000_000 + sequence,
        },
      );
    }
    const root = harness.firestore.read(resourcePaths.scorebook);
    harness.firestore.seed(resourcePaths.scorebook, {
      ...root,
      checkpoint: {
        ...root.checkpoint,
        sequence: 201,
        state: { ...root.checkpoint.state, revision: 201 },
      },
    });

    const pages = [];
    const sequences = [];
    let cursor;
    do {
      const page = await harness.handlers.listDiamondEvents(
        {
          teamId: "team-1",
          gameId: "game-1",
          visibility: "private",
          limit: 200,
          ...(cursor ? { cursor } : {}),
        },
        harness.managerContext,
      );
      pages.push(page);
      sequences.push(...page.items.map((item) => item.sequence));
      assert.ok(page.items.length >= 1);
      assert.ok(page.responseByteCount <= page.responseByteLimit);
      assert.equal(
        page.responseByteCount,
        Buffer.byteLength(JSON.stringify(page), "utf8"),
      );
      cursor = page.nextCursor;
    } while (cursor);

    assert.ok(pages.length > 1);
    assert.equal(pages[0].collectionComplete, false);
    assert.equal(pages.at(-1).collectionComplete, true);
    assert.deepEqual(
      sequences,
      Array.from({ length: 201 }, (_, index) => index + 1),
    );
  });

  it("returns no private event page when Auth or scorekeeping access changes during the read", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    harness.firestore.queryHook = (query) => {
      if (query.path !== resourcePaths.events) return;
      harness.authUsers.set("scorer-1", {
        ...harness.authUsers.get("scorer-1"),
        disabled: true,
      });
    };

    await assert.rejects(
      harness.handlers.listDiamondEvents(
        {
          teamId: "team-1",
          gameId: "game-1",
          visibility: "private",
          limit: 1,
        },
        harness.scorerContext,
      ),
      (error) => error.code === "permission-denied",
    );
  });

  it("reauthorizes private access, game generation, and root revision in one transaction", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const transactionsBeforeRead =
      harness.firestore.transactionReadBatches.length;
    harness.firestore.queryHook = (query) => {
      if (query.path !== resourcePaths.events) return;
      const team = harness.firestore.read(resourcePaths.team);
      harness.firestore.seed(resourcePaths.team, {
        ...team,
        ownerId: "replacement-manager",
      });
    };

    await assert.rejects(
      harness.handlers.listDiamondEvents(
        {
          teamId: "team-1",
          gameId: "game-1",
          visibility: "private",
          limit: 1,
        },
        harness.managerContext,
      ),
      (error) => error.code === "permission-denied",
    );
    assert.equal(
      harness.firestore.transactionReadBatches.length,
      transactionsBeforeRead + 1,
    );
    assert.deepEqual(
      new Set(harness.firestore.transactionReadBatches.at(-1)),
      new Set([
        resourcePaths.team,
        resourcePaths.user("manager-1"),
        resourcePaths.game,
        resourcePaths.rsvp("manager-1"),
        resourcePaths.scorebook,
      ]),
    );
  });

  it("parses voice into a confirmation-only proposal without any persistence", async () => {
    const harness = createHarness();
    await activate(harness);
    const before = [...harness.firestore.documents.entries()];
    const proposal = await harness.handlers.parseDiamondVoice(
      {
        teamId: "team-1",
        gameId: "game-1",
        expectedRevision: 1,
        rulesProfileId: "baseball-youth",
        rulesProfileVersion: 1,
        transcript: "single to right field",
      },
      harness.managerContext,
    );
    assert.equal(proposal.requiresConfirmation, true);
    assert.equal(proposal.mutatesState, false);
    assert.equal(proposal.confirmable, false);
    assert.equal(proposal.type, "record_plate_appearance");
    assert.deepEqual([...harness.firestore.documents.entries()], before);
  });

  it("paginates more than 1,500 public replay events without treating a page as complete history", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    for (const path of [...harness.firestore.documents.keys()]) {
      if (path.startsWith(`${resourcePaths.publicEvents}/`))
        harness.firestore.delete(path);
    }
    for (let sequence = 1; sequence <= 1_605; sequence += 1) {
      harness.firestore.seed(
        `${resourcePaths.publicEvents}/event-${String(sequence).padStart(5, "0")}`,
        {
          schemaVersion: 2,
          instanceId: harness.firestore.read(resourcePaths.game)
            .diamondScorebookInstanceId,
          eventId: `event-${sequence}`,
          sequence,
          revision: sequence,
          sourceRevision: sequence,
          type: "record_pitch",
          description: "Pitch recorded",
          inning: 1,
          half: "top",
          score: { home: 0, away: 0 },
          outs: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      );
    }
    const publicState = harness.firestore.read(resourcePaths.publicState);
    publicState.revision = 1_605;
    publicState.sourceRevision = 1_605;
    harness.firestore.seed(resourcePaths.publicState, publicState);

    let cursor = null;
    let total = 0;
    let pages = 0;
    do {
      const page = await harness.handlers.getPublicDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
        limit: 200,
        cursor,
      });
      pages += 1;
      total += page.events.length;
      if (page.nextCursor) assert.equal(page.complete, false);
      cursor = page.nextCursor;
      if (!cursor) assert.equal(page.complete, true);
    } while (cursor);
    assert.equal(total, 1_605);
    assert.equal(pages, 9);
  });

  it("replays the full canonical history for corrections and preserves them after rollback", async () => {
    const harness = createHarness();
    await activate(harness);
    await startGame(harness);
    const pitch = await submit(harness, {
      commandId: makeUuid(40),
      expectedRevision: 6,
      type: "record_pitch",
      payload: { batterId: "away-1", pitcherId: "home-1", result: "ball" },
    });
    assert.equal(pitch.state.state.inning.balls, 1);
    harness.firestore.seed("securityPolicies/diamondScorebook", {
      mode: "disabled",
      revision: 2,
      teamIds: [],
    });
    const correction = await submit(harness, {
      commandId: makeUuid(41),
      expectedRevision: 7,
      type: "void_event",
      payload: {
        targetEventId: pitch.eventId,
        reason: "Pitch was never delivered",
      },
    });
    assert.equal(correction.outcome, "accepted");
    assert.equal(correction.revision, 8);
    assert.equal(correction.state.state.inning.balls, 0);

    const originalQuery = harness.firestore._querySnapshot.bind(
      harness.firestore,
    );
    harness.firestore._querySnapshot = (query) => {
      if (query.path === paths("team-1", "game-1").events)
        throw new Error("history temporarily unavailable");
      return originalQuery(query);
    };
    const duplicateCorrection = await submit(harness, {
      commandId: makeUuid(41),
      expectedRevision: 7,
      type: "void_event",
      payload: {
        targetEventId: pitch.eventId,
        reason: "Pitch was never delivered",
      },
    });
    assert.equal(duplicateCorrection.outcome, "duplicate");
    assert.equal(duplicateCorrection.revision, 8);

    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(42),
        expectedRevision: 8,
        type: "record_pitch",
        payload: { batterId: "away-1", pitcherId: "home-1", result: "ball" },
      }),
      (error) => error.code === "failed-precondition",
    );
  });

  it("validates play-linked details against complete canonical history before writing", async () => {
    const harness = createHarness();
    await activate(harness);
    await startGame(harness);
    const play = await submit(harness, {
      commandId: makeUuid(45),
      expectedRevision: 6,
      type: "record_plate_appearance",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "ground_out",
        batterAdvance: { to: "out", outKind: "batter_runner" },
        runnerAdvances: [],
        outsOnPlay: 1,
      },
    });
    assert.equal(play.outcome, "accepted");
    assert.equal(play.revision, 7);

    const rejected = await submit(harness, {
      commandId: makeUuid(46),
      expectedRevision: 7,
      type: "record_fielding",
      payload: {
        playEventId: "missing-play",
        fielding: { putoutBy: "home-1", battedBall: "ground" },
      },
    });
    assert.equal(rejected.outcome, "rejected");
    assert.equal(rejected.revision, 7);
    assert.equal(rejected.rejection.code, "unknown-play-target");
    assert.equal(
      harness.firestore.read(paths("team-1", "game-1").command(makeUuid(46))),
      undefined,
    );

    const accepted = await submit(harness, {
      commandId: makeUuid(47),
      expectedRevision: 7,
      type: "record_fielding",
      payload: {
        playEventId: play.eventId,
        fielding: { putoutBy: "home-1", battedBall: "ground" },
      },
    });
    assert.equal(accepted.outcome, "accepted");
    assert.equal(accepted.revision, 8);
  });

  it("rejects fielding, runner, and pitcher identities that do not belong to the cited play", async () => {
    const harness = createHarness();
    await activate(harness);
    await startGame(harness);
    const play = await submit(harness, {
      commandId: makeUuid(48),
      expectedRevision: 6,
      type: "record_plate_appearance",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "home_run",
        batterAdvance: { to: "home", countsRun: true },
        runnerAdvances: [],
        outsOnPlay: 0,
        runsBattedIn: 1,
      },
    });
    assert.equal(play.outcome, "accepted");

    const wrongFielder = await submit(harness, {
      commandId: makeUuid(49),
      expectedRevision: 7,
      type: "record_fielding",
      payload: {
        playEventId: play.eventId,
        fielding: { putoutBy: "away-1" },
      },
    });
    assert.equal(wrongFielder.outcome, "rejected");
    assert.equal(wrongFielder.rejection.code, "invalid-fielding-participant");

    const wrongRunner = await submit(harness, {
      commandId: makeUuid(50),
      expectedRevision: 7,
      type: "record_scoring_judgment",
      payload: {
        playEventId: play.eventId,
        runnerId: "away-2",
        earned: true,
      },
    });
    assert.equal(wrongRunner.outcome, "rejected");
    assert.equal(wrongRunner.rejection.code, "invalid-scoring-participant");

    const wrongPitcher = await submit(harness, {
      commandId: makeUuid(51),
      expectedRevision: 7,
      type: "record_scoring_judgment",
      payload: {
        playEventId: play.eventId,
        runnerId: "away-1",
        responsiblePitcherId: "home-2",
      },
    });
    assert.equal(wrongPitcher.outcome, "rejected");
    assert.equal(
      wrongPitcher.rejection.code,
      "responsible-pitcher-role-mismatch",
    );
    assert.equal(
      harness.firestore.read(paths("team-1", "game-1").command(makeUuid(51))),
      undefined,
    );
  });

  it("authorizes full private replay before reading events and reauthorizes before commit", async () => {
    const harness = createHarness({
      authUsers: {
        "outsider-1": {
          uid: "outsider-1",
          disabled: false,
          email: "outsider@example.com",
          emailVerified: true,
        },
      },
    });
    await activate(harness);
    await startGame(harness);
    const play = await submit(harness, {
      commandId: makeUuid(470),
      expectedRevision: 6,
      type: "record_plate_appearance",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "ground_out",
        batterAdvance: { to: "out", outKind: "batter_runner" },
        runnerAdvances: [],
        outsOnPlay: 1,
      },
    });
    const resourcePaths = paths("team-1", "game-1");
    let canonicalEventReads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) canonicalEventReads += 1;
    };
    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(471),
        expectedRevision: 7,
        type: "record_fielding",
        context: { auth: { uid: "outsider-1" } },
        payload: {
          playEventId: play.eventId,
          fielding: { putoutBy: "home-1" },
        },
      }),
      (error) => error.code === "permission-denied",
    );
    assert.equal(canonicalEventReads, 0);
    assert.equal(
      harness.firestore.read(resourcePaths.command(makeUuid(471))),
      undefined,
    );

    const originalRunTransaction = harness.firestore.runTransaction.bind(
      harness.firestore,
    );
    let revokedBeforeTransaction = false;
    harness.firestore.runTransaction = (callback) => {
      if (!revokedBeforeTransaction) {
        revokedBeforeTransaction = true;
        const team = harness.firestore.read("teams/team-1");
        harness.firestore.seed("teams/team-1", {
          ...team,
          ownerId: "replacement-manager",
        });
      }
      return originalRunTransaction(callback);
    };
    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(472),
        expectedRevision: 7,
        type: "record_fielding",
        payload: {
          playEventId: play.eventId,
          fielding: { putoutBy: "home-1" },
        },
      }),
      (error) => error.code === "permission-denied",
    );
    assert.ok(canonicalEventReads > 0);
    assert.equal(
      harness.firestore.read(resourcePaths.command(makeUuid(472))),
      undefined,
    );
    assert.equal(
      harness.firestore.countDirectChildren(resourcePaths.events),
      7,
    );
  });

  it("uses normal scoring policy for active fielding and resilient correction policy only after reopen", async () => {
    const harness = createHarness();
    await activate(harness);
    await startGame(harness);
    const play = await submit(harness, {
      commandId: makeUuid(473),
      expectedRevision: 6,
      type: "record_plate_appearance",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "ground_out",
        batterAdvance: { to: "out", outKind: "batter_runner" },
        runnerAdvances: [],
        outsOnPlay: 1,
      },
    });
    harness.firestore.seed("securityPolicies/diamondScorebook", {
      mode: "disabled",
      revision: 2,
      teamIds: [],
    });
    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(474),
        expectedRevision: 7,
        type: "record_fielding",
        payload: {
          playEventId: play.eventId,
          fielding: { putoutBy: "home-1" },
        },
      }),
      (error) => error.code === "failed-precondition",
    );
    assert.equal(
      harness.firestore.read(paths("team-1", "game-1").command(makeUuid(474))),
      undefined,
    );

    harness.firestore.seed("securityPolicies/diamondScorebook", {
      mode: "enabled",
      revision: 3,
      teamIds: [],
      rolloutPercent: 100,
    });
    await submit(harness, {
      commandId: makeUuid(475),
      expectedRevision: 7,
      type: "rules_decision",
      payload: {
        code: "end_game_weather",
        description: "The umpire declared the shortened game official.",
      },
    });
    await submit(harness, {
      commandId: makeUuid(476),
      expectedRevision: 8,
      type: "finalize",
      payload: { confirmed: true },
    });
    harness.firestore.seed("securityPolicies/diamondScorebook", {
      mode: "disabled",
      revision: 4,
      teamIds: [],
    });
    const reopened = await submit(harness, {
      commandId: makeUuid(477),
      expectedRevision: 9,
      type: "reopen_for_correction",
      payload: { reason: "Official scorer is adding the fielding chain." },
    });
    assert.equal(reopened.state.state.lifecycle, "correction");
    const correction = await submit(harness, {
      commandId: makeUuid(478),
      expectedRevision: 10,
      type: "record_fielding",
      payload: {
        playEventId: play.eventId,
        fielding: { putoutBy: "home-1", battedBall: "ground" },
      },
    });
    assert.equal(correction.outcome, "accepted");
    assert.equal(correction.revision, 11);
  });

  it("uses revision/hash CAS when a correction races another authoritative update", async () => {
    const harness = createHarness();
    await activate(harness);
    await startGame(harness);
    const pitch = await submit(harness, {
      commandId: makeUuid(43),
      expectedRevision: 6,
      type: "record_pitch",
      payload: { batterId: "away-1", pitcherId: "home-1", result: "ball" },
    });
    const rootPath = paths("team-1", "game-1").scorebook;
    let injected = false;
    harness.firestore.queryHook = (query) => {
      if (injected || query.path !== paths("team-1", "game-1").events) return;
      injected = true;
      const root = harness.firestore.read(rootPath);
      root.checkpoint = {
        ...root.checkpoint,
        sequence: root.checkpoint.sequence + 1,
        state: {
          ...root.checkpoint.state,
          revision: root.checkpoint.state.revision + 1,
        },
      };
      harness.firestore.seed(rootPath, root);
    };
    const correction = await submit(harness, {
      commandId: makeUuid(44),
      expectedRevision: 7,
      type: "void_event",
      payload: { targetEventId: pitch.eventId, reason: "Racing correction" },
    });
    assert.equal(correction.outcome, "rejected");
    assert.equal(correction.rejection.code, "stale-revision");
    assert.equal(
      harness.firestore.read(paths("team-1", "game-1").command(makeUuid(44))),
      undefined,
    );
  });

  it("repairs from complete history and queues the authoritative projector without notifications", async () => {
    const harness = createHarness();
    await activate(harness);
    const rootPath = paths("team-1", "game-1").scorebook;
    const corrupt = harness.firestore.read(rootPath);
    corrupt.checkpoint.state = {
      ...corrupt.checkpoint.state,
      score: { home: 99, away: 0 },
    };
    harness.firestore.seed(rootPath, corrupt);
    const result = await harness.handlers.regenerateDiamondProjection(
      {
        teamId: "team-1",
        gameId: "game-1",
        expectedRevision: 1,
      },
      harness.managerContext,
    );
    assert.equal(result.regenerated, false);
    assert.equal(result.regenerationQueued, true);
    assert.equal(result.projectionStatus, "pending");
    assert.equal(result.notificationsSuppressed, true);
    assert.deepEqual(result.state.state.score, { home: 0, away: 0 });
    assert.equal(
      harness.firestore.read(rootPath).checkpoint.state.score.home,
      0,
    );
    const repairedRoot = harness.firestore.read(rootPath);
    assert.equal(repairedRoot.projectionStatus, "pending");
    assert.equal(repairedRoot.projectionRequest.sourceRevision, 1);
    assert.equal(repairedRoot.projectionRequest.requestedBy, "manager-1");
    assert.equal(
      harness.firestore.read(paths("team-1", "game-1").game)
        .diamondProjectionStatus,
      "pending",
    );
  });

  it("keeps projection replay read failures retryable and reauthorizes before repair commit", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const originalDoc = harness.firestore.doc.bind(harness.firestore);
    harness.firestore.doc = (path) => {
      const reference = originalDoc(path);
      if (path === resourcePaths.scorebook) {
        reference.get = () => Promise.reject(new Error("transient root read"));
      }
      return reference;
    };
    await assert.rejects(
      harness.handlers.regenerateDiamondProjection(
        { teamId: "team-1", gameId: "game-1", expectedRevision: 1 },
        harness.managerContext,
      ),
      (error) => error.code === "unavailable",
    );
    harness.firestore.doc = originalDoc;

    const originalRunTransaction = harness.firestore.runTransaction.bind(
      harness.firestore,
    );
    let revokedBeforeCommit = false;
    harness.firestore.runTransaction = (callback) => {
      if (!revokedBeforeCommit) {
        revokedBeforeCommit = true;
        const team = harness.firestore.read("teams/team-1");
        harness.firestore.seed("teams/team-1", {
          ...team,
          ownerId: "replacement-manager",
        });
      }
      return originalRunTransaction(callback);
    };
    const auditCollection = `${resourcePaths.scorebook}/audit`;
    const auditCount = harness.firestore.countDirectChildren(auditCollection);
    await assert.rejects(
      harness.handlers.regenerateDiamondProjection(
        { teamId: "team-1", gameId: "game-1", expectedRevision: 1 },
        harness.managerContext,
      ),
      (error) => error.code === "permission-denied",
    );
    assert.equal(
      harness.firestore.countDirectChildren(auditCollection),
      auditCount,
    );
  });

  it("serves newest public plays first and pins each page to the loaded projection revision", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const projection = harness.firestore.read(resourcePaths.publicState);
    projection.revision = 3;
    projection.sourceRevision = 3;
    harness.firestore.seed(resourcePaths.publicState, projection);
    for (let sequence = 2; sequence <= 4; sequence += 1) {
      harness.firestore.seed(
        `${resourcePaths.publicEvents}/viewer-${String(sequence)}`,
        {
          schemaVersion: 2,
          instanceId: harness.firestore.read(resourcePaths.game)
            .diamondScorebookInstanceId,
          eventId: `viewer-${String(sequence)}`,
          sequence,
          revision: sequence,
          sourceRevision: sequence,
          type: "record_pitch",
          description: `Pitch ${String(sequence)}`,
          inning: 1,
          half: "top",
          score: { home: 0, away: 0 },
          outs: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      );
    }

    const newest = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
      limit: 2,
    });
    assert.deepEqual(
      newest.events.map((event) => event.id),
      ["viewer-3", "viewer-2"],
    );
    assert.match(newest.nextCursor, /^bootstrap:v1:3:[0-9a-f]{64}:2$/);
    assert.match(newest.projectionToken, /^bootstrap:3:sha256:[0-9a-f]{64}$/);
    assert.equal(newest.sourceRevision, 3);
    assert.equal(
      newest.events.some((event) => event.id === "viewer-4"),
      false,
    );

    const earlier = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
      limit: 2,
      cursor: newest.nextCursor,
    });
    assert.deepEqual(
      earlier.events.map((event) => event.revision),
      [1],
    );
    assert.equal(earlier.nextCursor, null);
    assert.equal(earlier.complete, true);
  });

  it("serves correction-safe projected replay pages and rejects mixed projection generations", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const instanceId = harness.firestore.read(
      resourcePaths.game,
    ).diamondScorebookInstanceId;
    const checkpointHash = harness.firestore.read(
      resourcePaths.publicState,
    ).checkpointHash;
    const projectionHash = `sha256:${"b".repeat(64)}`;
    const sourceRevision = 110;
    const envelope = {
      trackingEngine: DIAMOND_ENGINE,
      teamId: "team-1",
      diamondGameId: "game-1",
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      sourceRevision,
      checkpointHash,
      projectionHash,
    };
    const makePlay = (revision) => ({
      schemaVersion: 2,
      eventId: `effective-${String(revision)}`,
      playId: `effective-${String(revision)}`,
      sourceEventId: `source-${String(revision)}`,
      sequence: revision,
      revision,
      sourceRevision,
      type: revision === 103 ? "record_plate_appearance" : "record_pitch",
      description:
        revision === 103
          ? "Corrected scoring play"
          : `Pitch ${String(revision)}`,
      inning: { number: 7, half: "bottom" },
      score: { home: revision === 103 ? 4 : 3, away: 3 },
      corrected: revision === 103,
      serverTimestampMs: 1_750_000_000_000 + revision,
    });
    const pageOneItems = Array.from({ length: 100 }, (_, index) =>
      makePlay(index + 1),
    );
    const pageTwoItems = [101, 102, 103].map(makePlay);
    harness.firestore.seed(resourcePaths.publicState, {
      ...harness.firestore.read(resourcePaths.publicState),
      ...envelope,
      revision: sourceRevision,
      projectionStatus: "complete",
      score: { home: 4, away: 3 },
    });
    harness.firestore.seed(resourcePaths.game, {
      ...harness.firestore.read(resourcePaths.game),
      diamondProjectionStatus: "current",
      diamondProjectionRevision: sourceRevision,
      diamondProjectionCheckpointHash: checkpointHash,
      diamondProjectionHash: projectionHash,
    });
    harness.firestore.seed(resourcePaths.publicReplay, {
      ...envelope,
      complete: true,
      collectionComplete: true,
      ordering: "effective-source-revision",
      revisionGapsAllowed: true,
      pageSize: 100,
      pageCount: 2,
      itemCount: 103,
      firstPageId: "page-000001",
      lastPageId: "page-000002",
    });
    harness.firestore.seed(resourcePaths.publicReplayPage("page-000001"), {
      ...envelope,
      complete: true,
      ordering: "effective-source-revision",
      revisionGapsAllowed: true,
      pageNumber: 1,
      pageSize: 100,
      itemCount: 100,
      items: pageOneItems,
      nextPageId: "page-000002",
    });
    harness.firestore.seed(resourcePaths.publicReplayPage("page-000002"), {
      ...envelope,
      complete: true,
      ordering: "effective-source-revision",
      revisionGapsAllowed: true,
      pageNumber: 2,
      pageSize: 100,
      itemCount: 3,
      items: pageTwoItems,
      nextPageId: null,
    });

    const newest = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
      limit: 4,
    });
    assert.deepEqual(
      newest.events.map((event) => event.id),
      ["effective-103", "effective-102", "effective-101", "effective-100"],
    );
    assert.equal(newest.events[0].inning, 7);
    assert.equal(newest.events[0].half, "bottom");
    assert.equal(newest.events[0].isCorrection, true);
    assert.match(newest.events[0].createdAt, /^2025-/);
    assert.equal(
      newest.events.some((event) => event.id === "voided-home-run"),
      false,
    );
    assert.equal(
      newest.projectionToken,
      `current:${String(sourceRevision)}:${projectionHash}`,
    );
    assert.match(newest.nextCursor, /^replay:v1:110:[0-9a-f]{64}:1:1$/);

    const remainder = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
      limit: 200,
      cursor: newest.nextCursor,
    });
    assert.equal(remainder.events.length, 99);
    assert.equal(remainder.events[0].id, "effective-99");
    assert.equal(remainder.events[98].id, "effective-1");
    assert.equal(remainder.nextCursor, null);
    assert.equal(remainder.complete, true);

    await assert.rejects(
      harness.handlers.getPublicDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
        cursor: `bootstrap:v1:${String(sourceRevision)}:${checkpointHash.slice(7)}:100`,
      }),
      (error) => error.code === "failed-precondition",
    );

    const malformedPage = harness.firestore.read(
      resourcePaths.publicReplayPage("page-000002"),
    );
    malformedPage.items = malformedPage.items.slice(0, 2);
    harness.firestore.seed(
      resourcePaths.publicReplayPage("page-000002"),
      malformedPage,
    );
    await assert.rejects(
      harness.handlers.getPublicDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      }),
      (error) => error.code === "unavailable",
    );
  });

  it("serves the legacy-compatible public game envelope without private fields", async () => {
    const harness = createHarness();
    await activate(harness);
    const result = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
      limit: 50,
    });
    assert.equal(
      result.instanceId,
      harness.firestore.read(paths("team-1", "game-1").game)
        .diamondScorebookInstanceId,
    );
    assert.equal(result.game.trackingEngine, DIAMOND_ENGINE);
    assert.equal(result.game.teamName, "Comets");
    assert.equal(result.game.opponent, "Rockets");
    assert.equal(result.events.length, 1);
    assert.doesNotMatch(
      JSON.stringify(result),
      /manager-1|actorUid|commandHash|availablePlayers/,
    );

    harness.firestore.seed("teams/team-1/games/game-1", {
      ...harness.firestore.read("teams/team-1/games/game-1"),
      visibility: "private",
    });
    await assert.rejects(
      harness.handlers.getPublicDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      }),
      (error) => error.code === "not-found",
    );
  });

  it("returns only an exact sanitized public team-stat envelope and fails malformed subsets closed", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const publicTeamStats = seedPublicTeamStatProjection(harness);

    const complete = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.deepEqual(complete.diamondStats, {
      schemaVersion: 1,
      trackingEngine: DIAMOND_ENGINE,
      status: "complete",
      complete: true,
      instanceId: publicTeamStats.instanceId,
      sourceRevision: publicTeamStats.sourceRevision,
      checkpointHash: publicTeamStats.checkpointHash,
      statConfigSnapshotHash: publicTeamStats.statConfigSnapshotHash,
      projectionHash: publicTeamStats.projectionHash,
      publicTeamStats,
    });
    assert.doesNotMatch(
      JSON.stringify(complete.diamondStats),
      /private|manager|inningLines|statSources|sourcePlayIds/,
    );

    const game = harness.firestore.read(resourcePaths.game);
    harness.firestore.seed(resourcePaths.game, {
      ...game,
      diamondPublicTeamStats: {
        ...game.diamondPublicTeamStats,
        stats: { ...game.diamondPublicTeamStats.stats, e: 99 },
      },
    });
    const malformed = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.deepEqual(malformed.diamondStats, {
      schemaVersion: 1,
      trackingEngine: DIAMOND_ENGINE,
      status: "partial",
      complete: false,
    });
  });

  it("reauthorizes visibility and generation after public replay assembly", async () => {
    for (const mutate of [
      (harness, resourcePaths) => {
        harness.firestore.seed(resourcePaths.game, {
          ...harness.firestore.read(resourcePaths.game),
          visibility: "private",
          isPublic: false,
          shareable: false,
        });
      },
      (harness, resourcePaths) => {
        harness.firestore.seed(resourcePaths.game, {
          ...harness.firestore.read(resourcePaths.game),
          diamondScorebookInstanceId: makeUuid(997),
        });
      },
      (harness, resourcePaths) => {
        harness.firestore.delete(resourcePaths.game);
      },
      (harness, resourcePaths) => {
        harness.firestore.seed(resourcePaths.game, {
          ...harness.firestore.read(resourcePaths.game),
          diamondProjectionComplete: false,
        });
      },
    ]) {
      const harness = createHarness();
      await activate(harness);
      const resourcePaths = paths("team-1", "game-1");
      const runTransaction = harness.firestore.runTransaction.bind(
        harness.firestore,
      );
      let publicReadTransactions = 0;
      harness.firestore.runTransaction = async (callback) => {
        const result = await runTransaction(callback);
        publicReadTransactions += 1;
        if (publicReadTransactions === 1) mutate(harness, resourcePaths);
        return result;
      };

      await assert.rejects(
        harness.handlers.getPublicDiamondGame({
          teamId: "team-1",
          gameId: "game-1",
        }),
        (error) => error.code === "unavailable",
      );
      assert.equal(publicReadTransactions, 2);
    }
  });

  it("builds the public envelope only from the final coherent metadata snapshot", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const runTransaction = harness.firestore.runTransaction.bind(
      harness.firestore,
    );
    let publicReadTransactions = 0;
    harness.firestore.runTransaction = async (callback) => {
      const result = await runTransaction(callback);
      publicReadTransactions += 1;
      if (publicReadTransactions === 1) {
        harness.firestore.seed(resourcePaths.game, {
          ...harness.firestore.read(resourcePaths.game),
          location: "Fresh Field",
        });
      }
      return result;
    };

    const result = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });

    assert.equal(publicReadTransactions, 2);
    assert.equal(result.game.location, "Fresh Field");
  });

  it("fails the public viewer closed when the game and projection generations differ", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    harness.firestore.seed(resourcePaths.publicState, {
      ...harness.firestore.read(resourcePaths.publicState),
      instanceId: makeUuid(999),
    });

    await assert.rejects(
      harness.handlers.getPublicDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      }),
      (error) => error.code === "unavailable",
    );

    const noncanonicalInstanceId = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
    harness.firestore.seed(resourcePaths.game, {
      ...harness.firestore.read(resourcePaths.game),
      diamondScorebookInstanceId: noncanonicalInstanceId,
    });
    harness.firestore.seed(resourcePaths.publicState, {
      ...harness.firestore.read(resourcePaths.publicState),
      instanceId: noncanonicalInstanceId,
    });
    await assert.rejects(
      harness.handlers.getPublicDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      }),
      (error) => error.code === "unavailable",
    );
  });

  it("projects only HTTPS live and non-paywalled replay media into the Diamond viewer", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const publicState = harness.firestore.read(resourcePaths.publicState);
    const game = harness.firestore.read(resourcePaths.game);

    harness.firestore.seed(resourcePaths.publicState, {
      ...publicState,
      lifecycle: "active",
    });
    harness.firestore.seed(resourcePaths.game, {
      ...game,
      videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    const live = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.deepEqual(live.game.media, {
      mode: "live",
      publicUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      durationMs: 0,
    });

    harness.firestore.seed(resourcePaths.publicState, {
      ...publicState,
      lifecycle: "final",
    });
    harness.firestore.seed(resourcePaths.game, {
      ...game,
      status: "completed",
      liveStatus: "completed",
      replayVideo: {
        provider: "youtube",
        videoId: "dQw4w9WgXcQ",
        status: "ready",
        embedUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
        publicUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
      replayVideoDurationMs: 3_600_000,
    });
    const replay = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.deepEqual(replay.game.media, {
      mode: "replay",
      publicUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      durationMs: 3_600_000,
    });

    harness.firestore.seed(resourcePaths.game, {
      ...harness.firestore.read(resourcePaths.game),
      recordedReplayPaywallEnabled: true,
    });
    const paywalled = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(paywalled.game.media, null);

    harness.firestore.seed(resourcePaths.publicState, {
      ...publicState,
      lifecycle: "active",
    });
    harness.firestore.seed(resourcePaths.game, {
      ...game,
      videoUrl: "http://video.example.test/live",
    });
    const insecure = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(insecure.game.media, null);
  });

  it("deletes only descendants that match the deleted game generation and records a durable cleanup lock", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const gamePath = resourcePaths.game;
    const deletedGame = harness.firestore.read(gamePath);
    harness.firestore.seed(resourcePaths.publicReplay, {
      schemaVersion: 2,
      trackingEngine: DIAMOND_ENGINE,
      teamId: "team-1",
      diamondGameId: "game-1",
      instanceId: deletedGame.diamondScorebookInstanceId,
      pageCount: 1,
    });
    harness.firestore.seed(resourcePaths.publicReplayPage("page-000001"), {
      schemaVersion: 2,
      trackingEngine: DIAMOND_ENGINE,
      teamId: "team-1",
      diamondGameId: "game-1",
      instanceId: deletedGame.diamondScorebookInstanceId,
      pageId: "page-000001",
      items: [],
    });
    for (const collectionId of [
      "notes",
      "effects",
      "commands",
      "projectionRuns",
      "aiPublicationReceipts",
    ]) {
      harness.firestore.seed(
        resourcePaths.scorebookChildCollection(collectionId) + "/owned",
        { instanceId: deletedGame.diamondScorebookInstanceId },
      );
    }
    const snapshot = new FakeDocumentSnapshot(
      harness.firestore.doc(gamePath),
      deletedGame,
    );
    harness.firestore.delete(gamePath);
    const result = await harness.handlers.cleanupDeletedDiamondGame(snapshot);
    assert.equal(result.cleaned, true);
    assert.equal(harness.firestore.read(resourcePaths.scorebook), undefined);
    assert.equal(harness.firestore.read(resourcePaths.publicState), undefined);
    assert.equal(harness.firestore.read(resourcePaths.publicReplay), undefined);
    assert.equal(
      harness.firestore.read(resourcePaths.publicReplayPage("page-000001")),
      undefined,
    );
    for (const collectionId of [
      "notes",
      "effects",
      "commands",
      "projectionRuns",
      "aiPublicationReceipts",
    ]) {
      assert.equal(
        harness.firestore.read(
          resourcePaths.scorebookChildCollection(collectionId) + "/owned",
        ),
        undefined,
      );
    }
    assert.deepEqual(harness.firestore.read(resourcePaths.cleanupLock), {
      schemaVersion: 1,
      generation: deletedGame.diamondScorebookInstanceId,
      status: "complete",
      complete: true,
      updatedAt: "2025-06-15T15:06:40.000Z",
      completedAt: "2025-06-15T15:06:40.000Z",
    });
  });

  it("cleans a replay-page-only orphan even when replay and scorebook parent documents are absent", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const deletedGame = harness.firestore.read(resourcePaths.game);
    const generation = deletedGame.diamondScorebookInstanceId;
    await harness.firestore.recursiveDelete(
      harness.firestore.doc(resourcePaths.scorebook),
    );
    await harness.firestore.recursiveDelete(
      harness.firestore.doc(resourcePaths.publicState),
    );
    harness.firestore.seed(resourcePaths.publicReplayPage("page-orphan"), {
      schemaVersion: 2,
      trackingEngine: DIAMOND_ENGINE,
      teamId: "team-1",
      diamondGameId: "game-1",
      instanceId: generation,
      pageId: "page-orphan",
      items: [],
    });
    const snapshot = new FakeDocumentSnapshot(
      harness.firestore.doc(resourcePaths.game),
      deletedGame,
    );
    harness.firestore.delete(resourcePaths.game);

    const result = await harness.handlers.cleanupDeletedDiamondGame(snapshot);
    assert.equal(result.cleaned, true);
    assert.equal(
      harness.firestore.read(resourcePaths.publicReplayPage("page-orphan")),
      undefined,
    );
    assert.equal(
      harness.firestore.read(resourcePaths.cleanupLock).generation,
      generation,
    );
  });

  it("throws retryable unavailable errors for incomplete parent and descendant reads", async () => {
    for (const failedPathKind of ["parent", "descendant"]) {
      const harness = createHarness();
      await activate(harness);
      const resourcePaths = paths("team-1", "game-1");
      const deletedGame = harness.firestore.read(resourcePaths.game);
      const snapshot = new FakeDocumentSnapshot(
        harness.firestore.doc(resourcePaths.game),
        deletedGame,
      );
      harness.firestore.delete(resourcePaths.game);
      const failedPath =
        failedPathKind === "parent"
          ? resourcePaths.game
          : resourcePaths.scorebook;
      const originalSnapshot = harness.firestore._documentSnapshot.bind(
        harness.firestore,
      );
      let failed = false;
      harness.firestore._documentSnapshot = (reference) => {
        if (!failed && reference.path === failedPath) {
          failed = true;
          throw Object.assign(new Error("transient read failure"), {
            code: "unavailable",
          });
        }
        return originalSnapshot(reference);
      };

      await assert.rejects(
        harness.handlers.cleanupDeletedDiamondGame(snapshot),
        (error) => error.code === "unavailable",
      );
      assert.ok(harness.firestore.read(resourcePaths.scorebook));
    }
  });

  it("deletes every owned sibling stat projection while preserving foreign documents", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const deletedGame = harness.firestore.read(resourcePaths.game);
    const generation = deletedGame.diamondScorebookInstanceId;
    const owned = {
      schemaVersion: 1,
      trackingEngine: DIAMOND_ENGINE,
      teamId: "team-1",
      diamondGameId: "game-1",
      instanceId: generation,
      diamondScorebookInstanceId: generation,
      projectionGeneration: generation,
    };
    harness.firestore.seed(`${resourcePaths.aggregatedStats}/owned-player`, {
      ...owned,
      stats: { ab: 1 },
    });
    harness.firestore.seed(`${resourcePaths.privatePlayerStats}/owned-player`, {
      ...owned,
      stats: { pitches: 4 },
    });
    harness.firestore.seed(`${resourcePaths.teamStats}/team`, {
      ...owned,
      stats: { r: 1 },
    });
    harness.firestore.seed(`${resourcePaths.aggregatedStats}/foreign-player`, {
      ...owned,
      instanceId: makeUuid(997),
      diamondScorebookInstanceId: makeUuid(997),
      projectionGeneration: makeUuid(997),
    });
    const snapshot = new FakeDocumentSnapshot(
      harness.firestore.doc(resourcePaths.game),
      deletedGame,
    );
    harness.firestore.delete(resourcePaths.game);

    const result = await harness.handlers.cleanupDeletedDiamondGame(snapshot);
    assert.equal(result.cleaned, true);
    assert.equal(result.retained, true);
    assert.equal(
      harness.firestore.read(`${resourcePaths.aggregatedStats}/owned-player`),
      undefined,
    );
    assert.equal(
      harness.firestore.read(
        `${resourcePaths.privatePlayerStats}/owned-player`,
      ),
      undefined,
    );
    assert.equal(
      harness.firestore.read(`${resourcePaths.teamStats}/team`),
      undefined,
    );
    assert.ok(
      harness.firestore.read(`${resourcePaths.aggregatedStats}/foreign-player`),
    );
  });

  it("deletes only exact-generation Diamond trees after a same-path legacy game is recreated", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const deletedGame = harness.firestore.read(resourcePaths.game);
    const generation = deletedGame.diamondScorebookInstanceId;
    const foreignGeneration = makeUuid(997);
    harness.firestore.seed(
      `${resourcePaths.diamondLiveGeneration(generation)}/chat/owned-chat`,
      {
        text: "old generation",
      },
    );
    harness.firestore.seed(
      `${resourcePaths.diamondLiveGeneration(generation)}/reactions/owned-reaction`,
      {
        type: "clap",
      },
    );
    harness.firestore.seed(
      `${resourcePaths.diamondStatGeneration(generation)}/publicPlayerStats/p1`,
      {
        stats: { h: 1 },
      },
    );
    harness.firestore.seed(`teams/team-1/games/game-1/liveChat/classic-chat`, {
      text: "classic",
    });
    harness.firestore.seed(
      `${resourcePaths.diamondLiveGeneration(foreignGeneration)}/reactions/foreign-reaction`,
      {
        type: "heart",
      },
    );
    const snapshot = new FakeDocumentSnapshot(
      harness.firestore.doc(resourcePaths.game),
      deletedGame,
    );
    harness.firestore.delete(resourcePaths.game);
    harness.firestore.seed(resourcePaths.game, {
      type: "game",
      trackingEngine: "legacy",
      status: "scheduled",
    });

    const result = await harness.handlers.cleanupDeletedDiamondGame(snapshot);
    assert.equal(result.cleaned, true);
    assert.equal(
      harness.firestore.read(
        `${resourcePaths.diamondLiveGeneration(generation)}/chat/owned-chat`,
      ),
      undefined,
    );
    assert.equal(
      harness.firestore.read(
        `${resourcePaths.diamondLiveGeneration(generation)}/reactions/owned-reaction`,
      ),
      undefined,
    );
    assert.equal(
      harness.firestore.read(
        `${resourcePaths.diamondStatGeneration(generation)}/publicPlayerStats/p1`,
      ),
      undefined,
    );
    assert.ok(
      harness.firestore.read(`teams/team-1/games/game-1/liveChat/classic-chat`),
    );
    assert.ok(
      harness.firestore.read(
        `${resourcePaths.diamondLiveGeneration(foreignGeneration)}/reactions/foreign-reaction`,
      ),
    );
    assert.equal(harness.firestore.read(resourcePaths.scorebook), undefined);
    assert.equal(harness.firestore.read(resourcePaths.publicState), undefined);
    assert.equal(
      harness.firestore.read(resourcePaths.game).trackingEngine,
      "legacy",
    );
  });

  it("recursively clears a large exact-generation interaction tree without touching another generation", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const deletedGame = harness.firestore.read(resourcePaths.game);
    const generation = deletedGame.diamondScorebookInstanceId;
    const foreignGeneration = makeUuid(997);
    const interactionCount = 1_501;
    for (let index = 0; index < interactionCount; index += 1) {
      harness.firestore.seed(
        `${resourcePaths.diamondLiveGeneration(generation)}/chat/chat-${String(index).padStart(4, "0")}`,
        { text: `Message ${String(index)}` },
      );
    }
    harness.firestore.seed(
      `${resourcePaths.diamondLiveGeneration(foreignGeneration)}/chat/foreign`,
      { text: "new generation" },
    );
    const snapshot = new FakeDocumentSnapshot(
      harness.firestore.doc(resourcePaths.game),
      deletedGame,
    );
    harness.firestore.delete(resourcePaths.game);

    const completed =
      await harness.handlers.cleanupDeletedDiamondGame(snapshot);
    assert.equal(completed.cleaned, true);
    assert.equal(
      harness.firestore.countDirectChildren(
        `${resourcePaths.diamondLiveGeneration(generation)}/chat`,
      ),
      0,
    );
    assert.ok(
      harness.firestore.read(
        `${resourcePaths.diamondLiveGeneration(foreignGeneration)}/chat/foreign`,
      ),
    );
  });

  it("replaces only a completed stale cleanup lock and blocks an active older generation", async () => {
    const completed = createHarness();
    await activate(completed);
    const completedPaths = paths("team-1", "game-1");
    const deletedGame = completed.firestore.read(completedPaths.game);
    completed.firestore.seed(completedPaths.cleanupLock, {
      schemaVersion: 1,
      generation: makeUuid(991),
      status: "complete",
      complete: true,
    });
    const snapshot = new FakeDocumentSnapshot(
      completed.firestore.doc(completedPaths.game),
      deletedGame,
    );
    completed.firestore.delete(completedPaths.game);
    const result = await completed.handlers.cleanupDeletedDiamondGame(snapshot);
    assert.equal(result.cleaned, true);
    assert.equal(
      completed.firestore.read(completedPaths.cleanupLock).generation,
      deletedGame.diamondScorebookInstanceId,
    );

    const active = createHarness();
    await activate(active);
    const activePaths = paths("team-1", "game-1");
    const activeDeletedGame = active.firestore.read(activePaths.game);
    active.firestore.seed(activePaths.cleanupLock, {
      schemaVersion: 1,
      generation: makeUuid(992),
      status: "deleting",
      complete: false,
    });
    const activeSnapshot = new FakeDocumentSnapshot(
      active.firestore.doc(activePaths.game),
      activeDeletedGame,
    );
    active.firestore.delete(activePaths.game);
    await assert.rejects(
      active.handlers.cleanupDeletedDiamondGame(activeSnapshot),
      (error) => error.code === "unavailable",
    );
    assert.ok(active.firestore.read(activePaths.scorebook));
    assert.equal(
      active.firestore.read(activePaths.cleanupLock).generation,
      makeUuid(992),
    );
  });

  it("CAS-clears only an exact shared-game Diamond projection and preserves unrelated shared state", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const sharedGamePath =
      "organizations/organization-1/sharedGames/shared-game-1";
    const deletedGame = {
      ...harness.firestore.read(resourcePaths.game),
      sharedGamePath,
    };
    harness.firestore.seed(resourcePaths.game, deletedGame);
    const generation = deletedGame.diamondScorebookInstanceId;
    harness.firestore.seed(sharedGamePath, {
      homeTeamId: "team-1",
      awayTeamId: "opponent-1",
      homeGameId: "game-1",
      chatEnabled: true,
      unrelatedTournamentField: "preserve-me",
      trackingEngine: DIAMOND_ENGINE,
      homeScore: 4,
      awayScore: 3,
      status: "completed",
      liveStatus: "completed",
      diamondProjectionRevision: 12,
      diamondProjectionCheckpointHash: "sha256:checkpoint",
      diamondProjectionStatus: "current",
      diamondSourceTeamId: "team-1",
      diamondSourceGameId: "game-1",
      diamondScorebookInstanceId: generation,
      diamondProjectionHash: "sha256:projection",
    });
    const snapshot = new FakeDocumentSnapshot(
      harness.firestore.doc(resourcePaths.game),
      deletedGame,
    );
    harness.firestore.delete(resourcePaths.game);

    const result = await harness.handlers.cleanupDeletedDiamondGame(snapshot);
    assert.equal(result.cleaned, true);
    assert.deepEqual(harness.firestore.read(sharedGamePath), {
      homeTeamId: "team-1",
      awayTeamId: "opponent-1",
      homeGameId: "game-1",
      chatEnabled: true,
      unrelatedTournamentField: "preserve-me",
    });

    const foreign = createHarness();
    await activate(foreign);
    const foreignPaths = paths("team-1", "game-1");
    const foreignDeletedGame = {
      ...foreign.firestore.read(foreignPaths.game),
      sharedGamePath,
    };
    foreign.firestore.seed(foreignPaths.game, foreignDeletedGame);
    const foreignShared = {
      homeTeamId: "team-1",
      awayTeamId: "opponent-1",
      homeGameId: "game-1",
      trackingEngine: DIAMOND_ENGINE,
      homeScore: 8,
      diamondSourceTeamId: "another-team",
      diamondSourceGameId: "another-game",
      diamondScorebookInstanceId: makeUuid(996),
      unrelatedTournamentField: "foreign-owner",
    };
    foreign.firestore.seed(sharedGamePath, foreignShared);
    const foreignSnapshot = new FakeDocumentSnapshot(
      foreign.firestore.doc(foreignPaths.game),
      foreignDeletedGame,
    );
    foreign.firestore.delete(foreignPaths.game);
    const foreignResult =
      await foreign.handlers.cleanupDeletedDiamondGame(foreignSnapshot);
    assert.equal(foreignResult.cleaned, true);
    assert.equal(foreignResult.retained, true);
    assert.deepEqual(foreign.firestore.read(sharedGamePath), foreignShared);
  });

  it("throws unavailable when cleanup races recreation or cannot verify recursive deletion", async () => {
    const raced = createHarness();
    await activate(raced);
    const racedPaths = paths("team-1", "game-1");
    const racedGame = raced.firestore.read(racedPaths.game);
    const racedSnapshot = new FakeDocumentSnapshot(
      raced.firestore.doc(racedPaths.game),
      racedGame,
    );
    raced.firestore.delete(racedPaths.game);
    const runTransaction = raced.firestore.runTransaction.bind(raced.firestore);
    let injected = false;
    raced.firestore.runTransaction = (callback) => {
      if (!injected) {
        injected = true;
        raced.firestore.seed(racedPaths.game, {
          id: "game-1",
          trackingEngine: "legacy-v1",
        });
      }
      return runTransaction(callback);
    };
    await assert.rejects(
      raced.handlers.cleanupDeletedDiamondGame(racedSnapshot),
      (error) => error.code === "unavailable",
    );

    const unverified = createHarness({ recursiveDelete: async () => {} });
    await activate(unverified);
    const unverifiedPaths = paths("team-1", "game-1");
    const unverifiedGame = unverified.firestore.read(unverifiedPaths.game);
    const unverifiedSnapshot = new FakeDocumentSnapshot(
      unverified.firestore.doc(unverifiedPaths.game),
      unverifiedGame,
    );
    unverified.firestore.delete(unverifiedPaths.game);
    await assert.rejects(
      unverified.handlers.cleanupDeletedDiamondGame(unverifiedSnapshot),
      (error) => error.code === "unavailable",
    );
    assert.equal(
      unverified.firestore.read(unverifiedPaths.cleanupLock).status,
      "deleting",
    );
  });

  it("retains replay descendants from another generation or an incomplete bounded inventory", async () => {
    const generationMismatch = createHarness();
    await activate(generationMismatch);
    const mismatchPaths = paths("team-1", "game-1");
    const deletedGame = generationMismatch.firestore.read(mismatchPaths.game);
    const snapshot = new FakeDocumentSnapshot(
      generationMismatch.firestore.doc(mismatchPaths.game),
      deletedGame,
    );
    generationMismatch.firestore.seed(
      mismatchPaths.publicReplayPage("page-foreign"),
      {
        instanceId: makeUuid(998),
        items: [],
      },
    );
    generationMismatch.firestore.delete(mismatchPaths.game);
    const mismatch =
      await generationMismatch.handlers.cleanupDeletedDiamondGame(snapshot);
    assert.equal(mismatch.retained, true);
    assert.equal(mismatch.reason, "descendant-generation-mismatch");
    assert.ok(
      generationMismatch.firestore.read(
        mismatchPaths.publicReplayPage("page-foreign"),
      ),
    );

    const overBound = createHarness();
    await activate(overBound);
    const overBoundPaths = paths("team-1", "game-1");
    const overBoundGame = overBound.firestore.read(overBoundPaths.game);
    const overBoundSnapshot = new FakeDocumentSnapshot(
      overBound.firestore.doc(overBoundPaths.game),
      overBoundGame,
    );
    for (let index = 0; index < 201; index += 1) {
      overBound.firestore.seed(
        overBoundPaths.publicReplayPage(
          `page-${String(index).padStart(6, "0")}`,
        ),
        {
          instanceId: overBoundGame.diamondScorebookInstanceId,
          items: [],
        },
      );
    }
    overBound.firestore.delete(overBoundPaths.game);
    await assert.rejects(
      overBound.handlers.cleanupDeletedDiamondGame(overBoundSnapshot),
      (error) => error.code === "unavailable",
    );

    const statOverBound = createHarness();
    await activate(statOverBound);
    const statPaths = paths("team-1", "game-1");
    const statGame = statOverBound.firestore.read(statPaths.game);
    for (let index = 0; index < 101; index += 1) {
      statOverBound.firestore.seed(
        `${statPaths.aggregatedStats}/player-${String(index).padStart(3, "0")}`,
        {
          trackingEngine: DIAMOND_ENGINE,
          teamId: "team-1",
          diamondGameId: "game-1",
          instanceId: statGame.diamondScorebookInstanceId,
        },
      );
    }
    const statSnapshot = new FakeDocumentSnapshot(
      statOverBound.firestore.doc(statPaths.game),
      statGame,
    );
    statOverBound.firestore.delete(statPaths.game);
    await assert.rejects(
      statOverBound.handlers.cleanupDeletedDiamondGame(statSnapshot),
      (error) => error.code === "unavailable",
    );
  });

  it("retains mismatched descendants under a recreated legacy parent", async () => {
    const harness = createHarness();
    await activate(harness);
    const gamePath = paths("team-1", "game-1").game;
    const deletedGame = harness.firestore.read(gamePath);
    const snapshot = new FakeDocumentSnapshot(
      harness.firestore.doc(gamePath),
      deletedGame,
    );
    const rootPath = paths("team-1", "game-1").scorebook;
    harness.firestore.seed(rootPath, {
      ...harness.firestore.read(rootPath),
      instanceId: makeUuid(999),
    });
    harness.firestore.delete(gamePath);
    const mismatch = await harness.handlers.cleanupDeletedDiamondGame(snapshot);
    assert.equal(mismatch.retained, true);
    assert.equal(mismatch.reason, "descendant-generation-mismatch");
    assert.ok(harness.firestore.read(rootPath));

    harness.firestore.seed(gamePath, {
      ...deletedGame,
      trackingEngine: undefined,
      diamondScorebookInstanceId: undefined,
    });
    const recreated =
      await harness.handlers.cleanupDeletedDiamondGame(snapshot);
    assert.equal(recreated.retained, true);
    assert.equal(recreated.reason, "descendant-generation-mismatch");
  });

  it("retains every old-generation tree when the current parent is Diamond", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const deletedGame = harness.firestore.read(resourcePaths.game);
    const generation = deletedGame.diamondScorebookInstanceId;
    harness.firestore.seed(
      `${resourcePaths.diamondLiveGeneration(generation)}/chat/old`,
      { text: "old" },
    );
    const snapshot = new FakeDocumentSnapshot(
      harness.firestore.doc(resourcePaths.game),
      deletedGame,
    );
    harness.firestore.delete(resourcePaths.game);
    harness.firestore.seed(resourcePaths.game, {
      ...deletedGame,
      diamondScorebookInstanceId: makeUuid(997),
    });

    const result = await harness.handlers.cleanupDeletedDiamondGame(snapshot);
    assert.equal(result.retained, true);
    assert.equal(result.reason, "game-recreated");
    assert.ok(
      harness.firestore.read(
        `${resourcePaths.diamondLiveGeneration(generation)}/chat/old`,
      ),
    );
    assert.ok(harness.firestore.read(resourcePaths.scorebook));
  });

  it("rejects disabled Auth users and never falls back to stale token email authority", async () => {
    const harness = createHarness({
      authUsers: {
        "manager-1": {
          uid: "manager-1",
          disabled: true,
          email: "manager@example.com",
          emailVerified: true,
        },
      },
    });
    await assert.rejects(
      harness.handlers.getDiamondAccess(
        { teamId: "team-1", appBuild: DIAMOND_APP_BUILD },
        harness.managerContext,
      ),
      (error) => error.code === "permission-denied",
    );
  });
});
