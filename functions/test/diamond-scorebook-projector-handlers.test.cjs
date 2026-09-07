"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const domainEngine = require("../diamond-engine");
const projectionAdapter = require("../diamond-scorebook-projections.cjs");
const core = require("../diamond-scorebook-core.cjs");
const {
  createDiamondStatConfigSnapshot,
} = require("../diamond-stat-config.cjs");
const {
  DIAMOND_ENGINE,
  DiamondProjectorError,
  createDiamondScorebookProjectorHandlers,
  projectorPaths,
} = require("../diamond-scorebook-projector-handlers.cjs");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function fieldValue(value, field) {
  return field.split(".").reduce((current, key) => current?.[key], value);
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
    return Promise.resolve(this.database.documentSnapshot(this));
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
    return Promise.resolve(this.database.querySnapshot(this));
  }
}

class FakeWriter {
  constructor(database) {
    this.database = database;
    this.operations = [];
  }

  create(reference, value) {
    this.operations.push({ kind: "create", reference, value: clone(value) });
    return this;
  }

  set(reference, value, options = {}) {
    this.operations.push({
      kind: "set",
      reference,
      value: clone(value),
      options: clone(options),
    });
    return this;
  }

  update(reference, value) {
    this.operations.push({ kind: "update", reference, value: clone(value) });
    return this;
  }

  delete(reference) {
    this.operations.push({ kind: "delete", reference });
    return this;
  }
}

class FakeTransaction extends FakeWriter {
  get(reference) {
    if (reference instanceof FakeQuery)
      return Promise.resolve(this.database.querySnapshot(reference));
    return Promise.resolve(this.database.documentSnapshot(reference));
  }

  getAll(...references) {
    return Promise.resolve(
      references.map((reference) => this.database.documentSnapshot(reference)),
    );
  }
}

class FakeBatch extends FakeWriter {
  async commit() {
    return this.database.commitBatch(this.operations);
  }
}

class FakeFirestore {
  constructor(seed = {}) {
    this.documents = new Map(
      Object.entries(seed).map(([path, value]) => [path, clone(value)]),
    );
    this.transactionQueue = Promise.resolve();
    this.batchCommitCount = 0;
    this.failNextBatch = null;
    this.queryLog = [];
  }

  doc(path) {
    return new FakeDocumentReference(this, path);
  }

  collection(path) {
    return new FakeQuery(this, path);
  }

  batch() {
    return new FakeBatch(this);
  }

  documentSnapshot(reference) {
    return new FakeDocumentSnapshot(
      reference,
      this.documents.get(reference.path),
    );
  }

  querySnapshot(query) {
    this.queryLog.push({
      path: query.path,
      filters: clone(query.filters),
      ordering: clone(query.ordering),
      maximum: query.maximum,
    });
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
        if (filter.operator === "<=") return value <= filter.value;
        if (filter.operator === "==") return value === filter.value;
        throw new Error(`Unsupported query operator ${filter.operator}`);
      });
    }
    if (query.ordering) {
      const multiplier = query.ordering.direction === "desc" ? -1 : 1;
      rows.sort((left, right) => {
        const leftValue = fieldValue(left.data(), query.ordering.field);
        const rightValue = fieldValue(right.data(), query.ordering.field);
        if (leftValue < rightValue) return -1 * multiplier;
        if (leftValue > rightValue) return multiplier;
        return left.id.localeCompare(right.id) * multiplier;
      });
    } else {
      rows.sort((left, right) => left.id.localeCompare(right.id));
    }
    if (Number.isInteger(query.maximum)) rows = rows.slice(0, query.maximum);
    return new FakeQuerySnapshot(rows);
  }

  applyOperations(operations) {
    const next = new Map(
      [...this.documents].map(([path, value]) => [path, clone(value)]),
    );
    for (const operation of operations) {
      const path = operation.reference.path;
      if (operation.kind === "create") {
        if (next.has(path)) {
          throw Object.assign(new Error(`Document already exists: ${path}`), {
            code: "already-exists",
          });
        }
        next.set(path, clone(operation.value));
      } else if (operation.kind === "set") {
        next.set(
          path,
          operation.options?.merge
            ? { ...(next.get(path) || {}), ...clone(operation.value) }
            : clone(operation.value),
        );
      } else if (operation.kind === "update") {
        if (!next.has(path)) {
          throw Object.assign(new Error(`Missing document: ${path}`), {
            code: "not-found",
          });
        }
        next.set(path, { ...next.get(path), ...clone(operation.value) });
      } else if (operation.kind === "delete") {
        next.delete(path);
      }
    }
    this.documents = next;
  }

  async commitBatch(operations) {
    this.batchCommitCount += 1;
    const failure = this.failNextBatch;
    this.failNextBatch = null;
    if (failure?.afterApply) this.applyOperations(operations);
    if (failure)
      throw Object.assign(new Error("Injected batch ambiguity"), {
        code: "unavailable",
      });
    this.applyOperations(operations);
    return [];
  }

  runTransaction(callback) {
    const execute = async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      this.applyOperations(transaction.operations);
      return result;
    };
    const pending = this.transactionQueue.then(execute, execute);
    this.transactionQueue = pending.catch(() => {});
    return pending;
  }

  read(path) {
    return clone(this.documents.get(path));
  }

  seed(path, value) {
    this.documents.set(path, clone(value));
  }

  delete(path) {
    this.documents.delete(path);
  }

  directChildren(path) {
    const prefix = `${path}/`;
    return [...this.documents.entries()]
      .filter(
        ([candidate]) =>
          candidate.startsWith(prefix) &&
          !candidate.slice(prefix.length).includes("/"),
      )
      .map(([candidate, value]) => ({
        id: candidate.slice(prefix.length),
        path: candidate,
        data: clone(value),
      }));
  }
}

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function createGame({
  teamId = "team-1",
  gameId = "game-1",
  captureMode = "quick",
} = {}) {
  let ledger = domainEngine.createDiamondLedger({
    teamId,
    gameId,
    rulesProfileId: "baseball-youth",
    rulesProfileVersion: 1,
    captureMode,
  });
  let nextId = 1;
  const submit = (type, payload = {}) => {
    const command = {
      schemaVersion: 2,
      commandId: uuid(nextId),
      teamId,
      gameId,
      expectedRevision: ledger.state.revision,
      rulesProfileId: ledger.rulesProfileId,
      rulesProfileVersion: ledger.rulesProfileVersion,
      type,
      payload,
    };
    const execution = domainEngine.executeDiamondCommand(ledger, command, {
      actorUid: "scorer-1",
      eventId: `event-${String(nextId).padStart(6, "0")}`,
      serverTimestampMs: 1_750_000_000_000 + nextId,
    });
    assert.equal(
      execution.result.outcome,
      "accepted",
      execution.result.rejection?.message,
    );
    ledger = execution.ledger;
    nextId += 1;
    return execution.event;
  };
  submit("activate", { initialScorerUid: "scorer-1", captureMode });
  return {
    get ledger() {
      return ledger;
    },
    submit,
  };
}

function setLineupsAndStart(game, playerCount = 2) {
  const entries = (side) =>
    Array.from({ length: playerCount }, (_, index) => ({
      slot: index + 1,
      playerId: `${side}-${String(index + 1)}`,
      displayName: `${side === "home" ? "Home" : "Away"} Player ${String(index + 1)}`,
      jerseyNumber: String(index + 1),
    }));
  game.submit("set_lineup", { side: "home", entries: entries("home") });
  game.submit("set_lineup", { side: "away", entries: entries("away") });
  game.submit("set_defensive_alignment", {
    side: "home",
    assignments: [
      { playerId: "home-1", position: "P" },
      { playerId: "home-2", position: "C" },
    ],
  });
  game.submit("set_defensive_alignment", {
    side: "away",
    assignments: [
      { playerId: "away-1", position: "P" },
      { playerId: "away-2", position: "C" },
    ],
  });
  game.submit("start", {});
}

function addAwayHomeRun(game) {
  game.submit("record_pitch", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "in_play",
  });
  return game.submit("record_plate_appearance", {
    batterId: "away-1",
    pitcherId: "home-1",
    result: "home_run",
    batterAdvance: {
      to: "home",
      cause: "batted_ball",
      countsRun: true,
      earned: true,
      rbi: true,
    },
    runnerAdvances: [],
    outsOnPlay: 0,
    runsBattedIn: 1,
  });
}

function seedGame(firestore, game, options = {}) {
  const ledger = game.ledger;
  const teamId = ledger.teamId;
  const gameId = ledger.gameId;
  const instanceId = options.instanceId || "instance-1";
  const paths = projectorPaths(teamId, gameId);
  const isHome = options.isHome !== false;
  const statTrackerConfigId =
    options.game?.statTrackerConfigId || "baseball-standard";
  const statConfigSnapshot =
    options.statConfigSnapshot ||
    createDiamondStatConfigSnapshot({
      teamId,
      configId: statTrackerConfigId,
      config: options.statConfig || {
        statDefinitions: [
          { id: "ab", scope: "player", visibility: "public" },
          { id: "avg", scope: "player", visibility: "public" },
          { id: "h", scope: "player", visibility: "public" },
          { id: "hr", scope: "player", visibility: "public" },
          { id: "r", scope: "team", visibility: "public" },
        ],
      },
    });
  firestore.seed(paths.team, {
    id: teamId,
    name: "Comets",
    ownerId: "manager-1",
    sport: "baseball",
    active: true,
    isPublic: true,
  });
  firestore.seed(paths.game, {
    id: gameId,
    teamId,
    type: "game",
    trackingEngine: DIAMOND_ENGINE,
    diamondScorebookInstanceId: instanceId,
    isHome,
    homeTeamId: isHome ? teamId : "opponent-1",
    awayTeamId: isHome ? "opponent-1" : teamId,
    teamName: "Comets",
    opponent: "Rockets",
    visibility: "public",
    ...(options.game || {}),
    statTrackerConfigId,
    diamondStatConfigSnapshotHash: statConfigSnapshot.snapshotHash,
  });
  const availablePlayers = { home: [], away: [] };
  for (const side of ["home", "away"]) {
    for (const entry of ledger.state.lineups[side].battingOrder) {
      availablePlayers[side].push({
        playerId: entry.activePlayerId,
        displayName: entry.displayName,
        jerseyNumber: entry.jerseyNumber,
      });
      if ((isHome && side === "home") || (!isHome && side === "away")) {
        firestore.seed(`${paths.players}/${entry.activePlayerId}`, {
          displayName: entry.displayName,
          jerseyNumber: entry.jerseyNumber,
          medicalNote: "PRIVATE-ROSTER-SENTINEL",
        });
      }
    }
  }
  const root = {
    schemaVersion: 2,
    trackingEngine: DIAMOND_ENGINE,
    instanceId,
    teamId,
    gameId,
    rulesProfileId: ledger.rulesProfileId,
    rulesProfileVersion: ledger.rulesProfileVersion,
    captureMode: ledger.captureMode,
    initialState: ledger.initialState,
    checkpoint: domainEngine.createDiamondCheckpoint(ledger),
    statConfigSnapshot,
    orientationSnapshot: {
      schemaVersion: 1,
      managedSide: isHome ? "home" : "away",
      opponentSide: isHome ? "away" : "home",
      managedTeamId: teamId,
      opponentTeamId: "opponent-1",
      homeTeamId: isHome ? teamId : "opponent-1",
      awayTeamId: isHome ? "opponent-1" : teamId,
      teamName: "Comets",
      opponentName: "Rockets",
      homeName: isHome ? "Comets" : "Rockets",
      awayName: isHome ? "Rockets" : "Comets",
    },
    availablePlayers,
    projectionStatus: "pending",
    lastCommandType: ledger.events.at(-1)?.type || "activate",
  };
  firestore.seed(paths.scorebook, root);
  for (const event of ledger.events) {
    firestore.seed(`${paths.events}/${event.eventId}`, {
      ...event,
      instanceId,
    });
  }
  firestore.seed(paths.publicCurrent, {
    schemaVersion: 2,
    trackingEngine: DIAMOND_ENGINE,
    teamId,
    gameId,
    instanceId,
    revision: ledger.state.revision,
    sourceRevision: ledger.state.revision,
    projectionStatus: "pending",
  });
  firestore.seed(paths.statsProjection, {
    schemaVersion: 1,
    instanceId,
    status: "pending",
    sourceRevision: ledger.state.revision,
  });
  return { paths, root, instanceId };
}

function syncLedger(firestore, game, instanceId = "instance-1") {
  const ledger = game.ledger;
  const paths = projectorPaths(ledger.teamId, ledger.gameId);
  const root = firestore.read(paths.scorebook);
  firestore.seed(paths.scorebook, {
    ...root,
    checkpoint: domainEngine.createDiamondCheckpoint(ledger),
    projectionStatus: "pending",
    lastCommandType: ledger.events.at(-1)?.type,
  });
  const statsProjection = firestore.read(paths.statsProjection);
  if (statsProjection && statsProjection.trackingEngine !== DIAMOND_ENGINE) {
    firestore.seed(paths.statsProjection, {
      ...statsProjection,
      status: "pending",
      sourceRevision: ledger.state.revision,
    });
  }
  for (const event of ledger.events) {
    if (!firestore.read(`${paths.events}/${event.eventId}`)) {
      firestore.seed(`${paths.events}/${event.eventId}`, {
        ...event,
        instanceId,
      });
    }
  }
}

function createHarness(options = {}) {
  const firestore = options.firestore || new FakeFirestore();
  let now = options.now || 1_760_000_000_000;
  let randomIndex = options.randomIndex || 900;
  const handlerOptions = {
    firestore,
    core,
    domainEngine,
    projectionAdapter,
    clock: () => now,
    random: () => uuid(randomIndex++),
    logger: { info() {}, warn() {}, error() {} },
    ...(options.handlers || {}),
  };
  const handlers = createDiamondScorebookProjectorHandlers(handlerOptions);
  return {
    firestore,
    handlers,
    setNow(value) {
      now = value;
    },
    handlerOptions,
  };
}

function ownedCount(firestore, collectionPath) {
  return firestore
    .directChildren(collectionPath)
    .filter((entry) => entry.data.trackingEngine === DIAMOND_ENGINE).length;
}

describe("Diamond scorebook authoritative projector", () => {
  it("publishes a verified generation atomically and recovers while rollout policy is disabled", async () => {
    const game = createGame();
    setLineupsAndStart(game);
    addAwayHomeRun(game);
    const harness = createHarness();
    const { paths, instanceId } = seedGame(harness.firestore, game);
    harness.firestore.seed("securityPolicies/diamondScorebook", {
      mode: "disabled",
      revision: 99,
      teamIds: [],
    });

    const snapshot = harness.firestore.documentSnapshot(
      harness.firestore.doc(paths.scorebook),
    );
    const result = await harness.handlers.onDiamondScorebookWrite(
      { after: snapshot },
      { params: { teamId: "team-1", gameId: "game-1" } },
    );

    assert.equal(result.projected, true);
    const root = harness.firestore.read(paths.scorebook);
    assert.equal(root.projectionStatus, "complete");
    assert.equal(
      root.diamondProjectionMarker.sourceRevision,
      game.ledger.state.revision,
    );
    assert.equal(root.diamondProjectionMarker.instanceId, instanceId);
    assert.equal(
      root.diamondProjectionMarker.statConfigSnapshotHash,
      root.statConfigSnapshot.snapshotHash,
    );
    assert.equal(
      root.diamondProjectionMarker.orientationSnapshotHash,
      core.hashDiamondValue(root.orientationSnapshot),
    );
    assert.equal(
      harness.firestore.read(
        paths.run(root.diamondProjectionMarker.projectionKey),
      ).statConfigSnapshotHash,
      root.statConfigSnapshot.snapshotHash,
    );
    assert.equal(
      harness.firestore.read(
        paths.run(root.diamondProjectionMarker.projectionKey),
      ).orientationSnapshotHash,
      core.hashDiamondValue(root.orientationSnapshot),
    );
    assert.equal(root.projectionLease, null);
    const projectedGame = harness.firestore.read(paths.game);
    assert.equal(projectedGame.diamondProjectionStatus, "current");
    assert.equal(
      projectedGame.diamondStatConfigSnapshotHash,
      root.statConfigSnapshot.snapshotHash,
    );
    assert.deepEqual(projectedGame.diamondPublicTeamStats.publicStatIds, ["r"]);
    assert.deepEqual(projectedGame.diamondPublicTeamStats.stats, { r: 0 });
    assert.equal(
      Object.hasOwn(projectedGame.diamondPublicTeamStats.stats, "h"),
      false,
    );
    assert.equal(projectedGame.diamondPublicTeamStats.instanceId, instanceId);
    assert.equal(
      projectedGame.diamondPublicTeamStats.diamondScorebookInstanceId,
      instanceId,
    );
    assert.equal(
      projectedGame.diamondPublicTeamStats.projectionGeneration,
      instanceId,
    );
    assert.equal(
      projectedGame.diamondPublicTeamStats.sourceRevision,
      game.ledger.state.revision,
    );
    assert.equal(
      projectedGame.diamondPublicTeamStats.checkpointHash,
      game.ledger.state.checkpointHash,
    );
    assert.equal(
      projectedGame.diamondPublicTeamStats.statConfigSnapshotHash,
      root.statConfigSnapshot.snapshotHash,
    );
    assert.equal(
      projectedGame.diamondPublicTeamStats.projectionHash,
      result.projectionHash,
    );
    assert.equal(
      harness.firestore.read(paths.publicCurrent).projectionStatus,
      "complete",
    );
    assert.equal(harness.firestore.read(paths.replayManifest).complete, true);
    assert.equal(
      harness.firestore.read(paths.statsProjection).status,
      "complete",
    );
    assert.equal(
      ownedCount(harness.firestore, paths.publicPlayerStats(instanceId)) > 0,
      true,
    );
    assert.equal(
      ownedCount(harness.firestore, paths.privatePlayerStats(instanceId)) > 0,
      true,
    );
    for (const collectionPath of [
      paths.publicPlayerStats(instanceId),
      paths.privatePlayerStats(instanceId),
      paths.teamStats(instanceId),
    ]) {
      for (const entry of harness.firestore.directChildren(collectionPath)) {
        if (entry.data.trackingEngine !== DIAMOND_ENGINE) continue;
        assert.equal(
          entry.data.statConfigSnapshotHash,
          root.statConfigSnapshot.snapshotHash,
        );
      }
    }

    const duplicate = await harness.handlers.onDiamondScorebookWrite(
      {
        after: harness.firestore.documentSnapshot(
          harness.firestore.doc(paths.scorebook),
        ),
      },
      { params: { teamId: "team-1", gameId: "game-1" } },
    );
    assert.equal(duplicate.projected, false);
    assert.equal(duplicate.reason, "already-current");

    harness.firestore.seed(paths.scorebook, {
      ...harness.firestore.read(paths.scorebook),
      projectionStatus: "pending",
      projectionRequest: {
        requestId: "repair-1",
        sourceRevision: game.ledger.state.revision,
      },
    });
    const regenerated = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(regenerated.projected, true);
    assert.equal(regenerated.projectionHash, result.projectionHash);
    assert.equal(
      harness.firestore.read(paths.scorebook).projectionRequest,
      null,
    );
  });

  it("projects side, stats, and public names only from the immutable orientation snapshot", async () => {
    const game = createGame({ captureMode: "full" });
    setLineupsAndStart(game);
    addAwayHomeRun(game);
    const harness = createHarness();
    const { paths } = seedGame(harness.firestore, game, { isHome: false });
    harness.firestore.seed(paths.game, {
      ...harness.firestore.read(paths.game),
      isHome: true,
      teamSide: "home",
      homeAway: "home",
      homeTeamId: "team-1",
      awayTeamId: "mutated-opponent",
      opponentTeamId: "mutated-opponent",
      teamName: "Mutated Team",
      opponent: "Mutated Opponent",
      homeName: "Mutated Team",
      awayName: "Mutated Opponent",
    });

    const result = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });

    assert.equal(result.projected, true);
    assert.ok(
      harness.firestore.read(paths.publicPlayerStat("instance-1", "away-1")),
    );
    assert.equal(
      harness.firestore.read(paths.publicPlayerStat("instance-1", "home-1")),
      undefined,
    );
    assert.equal(
      harness.firestore.read(paths.teamStat("instance-1")).side,
      "away",
    );
    assert.equal(
      harness.firestore.read(paths.teamStat("instance-1")).stats.r,
      1,
    );
    assert.equal(
      harness.firestore.read(paths.game).diamondPublicTeamStats.side,
      "away",
    );
    const current = harness.firestore.read(paths.publicCurrent);
    assert.equal(current.teamName, "Comets");
    assert.equal(current.opponentName, "Rockets");
    assert.equal(current.homeName, "Rockets");
    assert.equal(current.awayName, "Comets");
  });

  it("fails closed when the immutable orientation snapshot is absent or malformed", async () => {
    for (const mutation of [
      ({ root }) => ({ ...root, orientationSnapshot: undefined }),
      ({ root }) => ({
        ...root,
        orientationSnapshot: {
          ...root.orientationSnapshot,
          managedSide: "away",
        },
      }),
      ({ root }) => ({
        ...root,
        orientationSnapshot: {
          ...root.orientationSnapshot,
          privateAlias: "must-not-be-accepted",
        },
      }),
    ]) {
      const game = createGame();
      setLineupsAndStart(game);
      const harness = createHarness();
      const { paths, root } = seedGame(harness.firestore, game);
      harness.firestore.seed(paths.scorebook, mutation({ root }));

      await assert.rejects(
        harness.handlers.projectDiamondGame({
          teamId: "team-1",
          gameId: "game-1",
        }),
        (error) =>
          error.code.includes("orientation-snapshot") &&
          error.retryable === false,
      );
      assert.equal(
        harness.firestore.read(paths.scorebook).projectionStatus,
        "failed",
      );
      assert.equal(
        harness.firestore.read(paths.publicPlayerStat("instance-1", "home-1")),
        undefined,
      );
    }
  });

  it("loads the selected stat config and keeps private player metrics out of public read models", async () => {
    const game = createGame({ captureMode: "full" });
    setLineupsAndStart(game);
    addAwayHomeRun(game);
    let receivedPublicPlayerIds = null;
    let receivedPublicTeamIds = null;
    const harness = createHarness({
      handlers: {
        projectionAdapter: {
          ...projectionAdapter,
          buildDiamondProjectionBundle(options) {
            receivedPublicPlayerIds = options.publicPlayerStatIds;
            receivedPublicTeamIds = options.publicTeamStatIds;
            return projectionAdapter.buildDiamondProjectionBundle(options);
          },
        },
      },
    });
    const pinnedConfig = {
      name: "Private advanced metrics",
      baseType: "Baseball",
      columns: ["G", "HR", "AVG"],
      statDefinitions: [
        { id: "g", scope: "player", visibility: "private" },
        { id: "hr", scope: "player", visibility: "private" },
        { id: "avg", scope: "player", visibility: "private" },
        { id: "r", scope: "team", visibility: "private" },
      ],
    };
    const { paths } = seedGame(harness.firestore, game, {
      isHome: false,
      game: { statTrackerConfigId: "baseball-private" },
      statConfig: pinnedConfig,
    });
    // The mutable source may later change or disappear; projection authority
    // comes only from the activation-pinned snapshot.
    harness.firestore.seed("teams/team-1/statTrackerConfigs/baseball-private", {
      statDefinitions: [
        { id: "g", scope: "player", visibility: "public" },
        { id: "hr", scope: "player", visibility: "public" },
        { id: "avg", scope: "player", visibility: "public" },
      ],
    });

    await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.deepEqual(receivedPublicPlayerIds, []);
    assert.deepEqual(receivedPublicTeamIds, []);
    const publicBatter = harness.firestore.read(
      paths.publicPlayerStat("instance-1", "away-1"),
    );
    const privateBatter = harness.firestore.read(
      paths.privatePlayerStat("instance-1", "away-1"),
    );
    for (const statId of ["avg", "g", "hr"]) {
      assert.equal(publicBatter.stats[statId], undefined);
      assert.equal(publicBatter.derivedStats?.[statId], undefined);
      assert.equal(publicBatter.statCoverage?.[statId], undefined);
      assert.equal(publicBatter.statSources?.[statId], undefined);
    }
    assert.deepEqual(publicBatter.stats, {});
    assert.equal(privateBatter.stats.g, 1);
    assert.equal(privateBatter.stats.hr, 1);
    assert.equal(privateBatter.derivedStats.avg, 1);
    for (const opponent of Object.values(
      harness.firestore.read(paths.game).opponentStats,
    )) {
      assert.equal(opponent.g, undefined);
      assert.equal(opponent.hr, undefined);
      assert.equal(opponent.avg, undefined);
    }
    const publicTeamStats = harness.firestore.read(
      paths.game,
    ).diamondPublicTeamStats;
    assert.deepEqual(publicTeamStats.publicStatIds, []);
    assert.deepEqual(publicTeamStats.stats, {});
    assert.deepEqual(publicTeamStats.observedStats, {});
    assert.deepEqual(publicTeamStats.statCoverage, {});
    assert.equal(
      harness.firestore.read(paths.teamStat("instance-1")).stats.r,
      1,
      "the callable-only team projection remains complete",
    );
  });

  it("fails closed when the immutable stat config snapshot is missing, malformed, or mismatched", async () => {
    for (const mutation of [
      ({ root }) => ({ ...root, statConfigSnapshot: undefined }),
      ({ root }) => ({
        ...root,
        statConfigSnapshot: {
          ...root.statConfigSnapshot,
          privatePlayerStatIds: ["hr"],
        },
      }),
      ({ root }) => ({
        ...root,
        statConfigSnapshot: {
          ...root.statConfigSnapshot,
          configId: "different-config",
        },
      }),
    ]) {
      const game = createGame();
      setLineupsAndStart(game);
      const harness = createHarness();
      const { paths, root } = seedGame(harness.firestore, game);
      harness.firestore.seed(paths.scorebook, mutation({ root }));
      await assert.rejects(
        harness.handlers.onDiamondScorebookWrite(
          {
            after: harness.firestore.documentSnapshot(
              harness.firestore.doc(paths.scorebook),
            ),
          },
          { params: { teamId: "team-1", gameId: "game-1" } },
        ),
        (error) =>
          error.code.startsWith("stat-config-") && error.retryable === false,
      );
      assert.equal(
        harness.firestore.read(paths.scorebook).projectionStatus,
        "failed",
      );
      assert.equal(
        harness.firestore.read(paths.publicPlayerStat("instance-1", "home-1")),
        undefined,
      );
    }

    const game = createGame();
    const harness = createHarness();
    const { paths } = seedGame(harness.firestore, game);
    harness.firestore.seed(paths.game, {
      ...harness.firestore.read(paths.game),
      diamondStatConfigSnapshotHash: core.hashDiamondValue({ forged: true }),
    });
    await assert.rejects(
      harness.handlers.onDiamondScorebookWrite(
        {
          after: harness.firestore.documentSnapshot(
            harness.firestore.doc(paths.scorebook),
          ),
        },
        { params: { teamId: "team-1", gameId: "game-1" } },
      ),
      (error) =>
        error.code === "stat-config-snapshot-mismatch" &&
        error.retryable === false,
    );
    assert.equal(
      harness.firestore.read(paths.scorebook).projectionStatus,
      "failed",
    );
  });

  it("fences a worker if the pinned stat snapshot changes before publication", async () => {
    const game = createGame();
    const firestore = new FakeFirestore();
    const { paths } = seedGame(firestore, game);
    const replacement = createDiamondStatConfigSnapshot({
      teamId: "team-1",
      configId: "baseball-standard",
      config: {
        statDefinitions: [{ id: "hr", scope: "player", visibility: "private" }],
      },
    });
    const harness = createHarness({
      firestore,
      handlers: {
        hooks: {
          async beforeFinalize() {
            firestore.seed(paths.scorebook, {
              ...firestore.read(paths.scorebook),
              statConfigSnapshot: replacement,
            });
          },
        },
      },
    });

    await assert.rejects(
      harness.handlers.projectDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      }),
      (error) => error.code === "projection-cas-failed" && error.retryable,
    );
    assert.equal(
      firestore.read(paths.publicCurrent).projectionStatus,
      "pending",
    );
    assert.equal(
      firestore.read(paths.scorebook).diamondProjectionMarker,
      undefined,
    );
  });

  it("fences a worker if the immutable orientation snapshot changes before publication", async () => {
    const game = createGame();
    const firestore = new FakeFirestore();
    const { paths } = seedGame(firestore, game);
    const harness = createHarness({
      firestore,
      handlers: {
        hooks: {
          async beforeFinalize() {
            const root = firestore.read(paths.scorebook);
            firestore.seed(paths.scorebook, {
              ...root,
              orientationSnapshot: {
                ...root.orientationSnapshot,
                teamName: "Mutated Team",
                homeName: "Mutated Team",
              },
            });
          },
        },
      },
    });

    await assert.rejects(
      harness.handlers.projectDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      }),
      (error) => error.code === "projection-cas-failed" && error.retryable,
    );
    assert.equal(
      firestore.read(paths.publicCurrent).projectionStatus,
      "pending",
    );
    assert.equal(
      firestore.read(paths.scorebook).diamondProjectionMarker,
      undefined,
    );
  });

  it("reads and verifies more than 1,500 events in bounded pages and creates revision-pinned replay pages", async () => {
    const game = createGame();
    for (let index = 2; index <= 1_605; index += 1) {
      game.submit("rules_decision", {
        code: "coverage_adjustment",
        description: `Public rules decision ${String(index)}`,
        affectedFamilies: ["situational"],
      });
    }
    const harness = createHarness();
    const { paths } = seedGame(harness.firestore, game);
    const result = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });

    assert.equal(result.sourceRevision, 1_605);
    assert.equal(result.replayPageCount, 17);
    assert.equal(
      harness.firestore.directChildren(paths.replayPages).length,
      17,
    );
    assert.equal(harness.firestore.read(paths.replayManifest).itemCount, 1_605);
    const eventQueries = harness.firestore.queryLog.filter(
      (query) => query.path === paths.events,
    );
    assert.equal(eventQueries.length, 9);
    assert.equal(
      eventQueries.every((query) => query.maximum === 200),
      true,
    );
    assert.equal(
      eventQueries.every((query) =>
        query.filters.some(
          (filter) => filter.operator === "<=" && filter.value === 1_605,
        ),
      ),
      true,
    );
  });

  it("does not publish an old bundle when the authoritative head advances during projection", async () => {
    const game = createGame();
    const firestore = new FakeFirestore();
    const { paths, instanceId } = seedGame(firestore, game);
    let advanced = false;
    const harness = createHarness({
      firestore,
      handlers: {
        hooks: {
          async beforeFinalize() {
            if (advanced) return;
            advanced = true;
            game.submit("private_note", { text: "Head advanced privately" });
            syncLedger(firestore, game, instanceId);
          },
        },
      },
    });

    await assert.rejects(
      harness.handlers.projectDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      }),
      (error) =>
        error instanceof DiamondProjectorError &&
        error.code === "projection-cas-failed" &&
        error.retryable,
    );
    assert.equal(firestore.read(paths.scorebook).projectionStatus, "pending");
    assert.equal(firestore.read(paths.scorebook).checkpoint.sequence, 2);
    assert.equal(
      firestore.read(paths.publicCurrent).projectionStatus,
      "pending",
    );

    const retry = createDiamondScorebookProjectorHandlers({
      ...harness.handlerOptions,
      firestore,
      hooks: {},
    });
    const recovered = await retry.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(recovered.projected, true);
    assert.equal(recovered.sourceRevision, 2);
  });

  it("replaces an expired stale lease but never lets a stale trigger project another head", async () => {
    const game = createGame();
    const harness = createHarness({ now: 2_000_000 });
    const { paths } = seedGame(harness.firestore, game);
    const root = harness.firestore.read(paths.scorebook);
    harness.firestore.seed(paths.scorebook, {
      ...root,
      projectionLease: {
        leaseId: uuid(700),
        instanceId: "instance-1",
        sourceRevision: 1,
        expiresAtMs: 1_999_999,
      },
    });
    const result = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(result.projected, true);

    game.submit("private_note", { text: "New head" });
    syncLedger(harness.firestore, game);
    const stale = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
      expectedInstanceId: "instance-1",
      expectedSourceRevision: 1,
      expectedCheckpointHash: result.checkpointHash,
    });
    assert.equal(stale.projected, false);
    assert.equal(stale.reason, "stale-trigger");
    assert.equal(
      harness.firestore.read(paths.scorebook).checkpoint.sequence,
      2,
    );
  });

  it("makes an active-lease trigger retryable and ignores non-v2 roots without writes", async () => {
    const game = createGame();
    const harness = createHarness({ now: 2_000_000 });
    const { paths } = seedGame(harness.firestore, game);
    const root = harness.firestore.read(paths.scorebook);
    harness.firestore.seed(paths.scorebook, {
      ...root,
      projectionLease: {
        leaseId: uuid(701),
        instanceId: "instance-1",
        sourceRevision: 1,
        expiresAtMs: 2_100_000,
      },
    });
    await assert.rejects(
      harness.handlers.onDiamondScorebookWrite(
        {
          after: harness.firestore.documentSnapshot(
            harness.firestore.doc(paths.scorebook),
          ),
        },
        { params: { teamId: "team-1", gameId: "game-1" } },
      ),
      (error) => error.code === "projection-lease-active" && error.retryable,
    );

    const legacyRoot = { ...root, trackingEngine: "legacy-v1" };
    const legacySnapshot = new FakeDocumentSnapshot(
      harness.firestore.doc(paths.scorebook),
      legacyRoot,
    );
    const before = [...harness.firestore.documents.entries()];
    const ignored = await harness.handlers.onDiamondScorebookWrite(
      { after: legacySnapshot },
      { params: { teamId: "team-1", gameId: "game-1" } },
    );
    assert.deepEqual(ignored, { projected: false, reason: "not-diamond-v2" });
    assert.deepEqual([...harness.firestore.documents.entries()], before);
  });

  it("retries a failed staging batch without publishing early or duplicating effects", async () => {
    const game = createGame();
    setLineupsAndStart(game);
    const harness = createHarness({ handlers: { batchWriteLimit: 1 } });
    const { paths } = seedGame(harness.firestore, game);
    await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    const priorProjectedRevision = game.ledger.state.revision;

    game.submit("rules_decision", {
      code: "end_game_weather",
      description: "The umpire declared the game official.",
    });
    game.submit("finalize", { confirmed: true });
    syncLedger(harness.firestore, game);
    harness.firestore.failNextBatch = { afterApply: false };
    await assert.rejects(
      harness.handlers.projectDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      }),
      (error) => error.code === "effect-stage-failed" && error.retryable,
    );
    const failedRoot = harness.firestore.read(paths.scorebook);
    assert.equal(failedRoot.projectionStatus, "pending");
    assert.equal(
      failedRoot.diamondProjectionMarker.sourceRevision,
      priorProjectedRevision,
    );
    assert.equal(harness.firestore.directChildren(paths.effects).length, 0);

    const recovered = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(recovered.projected, true);
    assert.equal(harness.firestore.directChildren(paths.effects).length, 1);
    const effect = harness.firestore.directChildren(paths.effects)[0].data;
    assert.equal(effect.kind, "notification");
    assert.equal(effect.status, "pending");
    assert.equal(effect.instanceId, "instance-1");
    assert.match(effect.dedupKey, /:instance:instance-1:notification:/);
    assert.equal(effect.payload.dedupKey, effect.dedupKey);
    assert.equal(effect.requiresProjectionMarker, true);
    assert.equal(
      harness.firestore.read(paths.scorebook).diamondProjectionMarker
        .projectionKey,
      effect.projectionKey,
    );
    assert.equal(
      harness.firestore.read(effect.activationRunPath).status,
      "complete",
    );
  });

  it("stages a distinct notification identity when the same game path and revision are recreated", async () => {
    async function projectFinalNotification(instanceId) {
      const game = createGame();
      setLineupsAndStart(game);
      const harness = createHarness({ handlers: { batchWriteLimit: 1 } });
      const { paths } = seedGame(harness.firestore, game, { instanceId });
      await harness.handlers.projectDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      });
      game.submit("rules_decision", {
        code: "end_game_weather",
        description: "The umpire declared the game official.",
      });
      game.submit("finalize", { confirmed: true });
      syncLedger(harness.firestore, game, instanceId);
      await harness.handlers.projectDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      });
      return harness.firestore.directChildren(paths.effects)[0];
    }

    const first = await projectFinalNotification("instance-1");
    const replacement = await projectFinalNotification("instance-2");

    assert.equal(first.data.sourceRevision, replacement.data.sourceRevision);
    assert.equal(first.data.effectId, replacement.data.effectId);
    assert.notEqual(first.data.dedupKey, replacement.data.dedupKey);
    assert.notEqual(first.id, replacement.id);
    assert.match(first.data.dedupKey, /:instance:instance-1:notification:/);
    assert.match(
      replacement.data.dedupKey,
      /:instance:instance-2:notification:/,
    );
  });

  it("reconciles an ambiguous committed outbox batch in the same attempt", async () => {
    const game = createGame();
    setLineupsAndStart(game);
    const harness = createHarness({ handlers: { batchWriteLimit: 1 } });
    const { paths } = seedGame(harness.firestore, game);
    await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    game.submit("rules_decision", {
      code: "end_game_weather",
      description: "The umpire declared the game official.",
    });
    game.submit("finalize", { confirmed: true });
    syncLedger(harness.firestore, game);
    harness.firestore.failNextBatch = { afterApply: true };

    const result = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(result.projected, true);
    assert.equal(harness.firestore.directChildren(paths.effects).length, 1);
    assert.equal(
      harness.firestore.read(paths.scorebook).projectionStatus,
      "complete",
    );
  });

  it("rebuilds corrected score, stats, and replay while staling AI and clips without a correction notification", async () => {
    const game = createGame({ captureMode: "full" });
    setLineupsAndStart(game);
    const homeRun = addAwayHomeRun(game);
    const harness = createHarness({
      handlers: {
        loadClipTimings: async () => ({
          [homeRun.eventId]: { startMs: 1_000, endMs: 9_000 },
        }),
      },
    });
    const { paths } = seedGame(harness.firestore, game, {
      isHome: false,
      game: {
        aiRecap: { sourceRevision: homeRun.revision, text: "Old recap" },
        insights: "Old insight",
      },
    });
    await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });

    game.submit("void_event", {
      targetEventId: homeRun.eventId,
      reason: "Official scoring correction",
    });
    syncLedger(harness.firestore, game);
    const corrected = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(corrected.projected, true);
    assert.equal(harness.firestore.read(paths.game).awayScore, 0);
    const batter = harness.firestore.read(
      paths.publicPlayerStat("instance-1", "away-1"),
    );
    assert.equal(batter.stats.hr, 0);
    const replay = harness.firestore
      .directChildren(paths.replayPages)
      .flatMap((entry) => entry.data.items);
    assert.equal(
      replay.some((play) => play.sourceEventId === homeRun.eventId),
      false,
    );
    assert.equal(harness.firestore.read(paths.game).aiRecap.status, "stale");
    assert.equal(harness.firestore.read(paths.game).aiRecap.text, "Old recap");
    assert.equal(
      harness.firestore.read(paths.game).insights.legacyValue,
      "Old insight",
    );
    const effects = harness.firestore
      .directChildren(paths.effects)
      .map((entry) => entry.data);
    assert.equal(
      effects.filter((effect) => effect.kind === "clip-invalidation").length,
      1,
    );
    assert.equal(
      effects.filter((effect) => effect.kind === "ai-stale").length,
      1,
    );
    assert.equal(
      effects.filter((effect) => effect.kind === "notification").length,
      0,
    );
    for (const effect of effects) {
      assert.match(effect.dedupKey, /:instance:instance-1:/);
    }

    const duplicate = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(duplicate.projected, false);
    assert.equal(
      harness.firestore.directChildren(paths.effects).length,
      effects.length,
    );
  });

  it("patches only an authoritatively linked shared game and emits a generation-held reconciliation record", async () => {
    const game = createGame();
    const firestore = new FakeFirestore();
    const sharedPath = "organizations/org-1/sharedGames/shared-1";
    const mismatchedRefPath = "users/attacker/sharedGames/shared-1";
    const harness = createHarness({
      firestore,
      handlers: {
        resolveSharedGame: async () => ({
          path: sharedPath,
          ref: firestore.doc(mismatchedRefPath),
          data: firestore.read(sharedPath),
        }),
      },
    });
    const { paths } = seedGame(firestore, game, {
      game: { sharedGameId: "shared-1", sharedGamePath: sharedPath },
    });
    firestore.seed(sharedPath, {
      id: "shared-1",
      homeTeamId: "team-1",
      awayTeamId: "opponent-1",
      teamIds: ["team-1", "opponent-1"],
      teamGameIds: { "team-1": "game-1" },
      status: "scheduled",
    });
    firestore.seed(mismatchedRefPath, {
      untouched: true,
      homeTeamId: "team-1",
      teamGameIds: { "team-1": "game-1" },
    });

    const result = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(result.projected, true);
    assert.equal(firestore.read(sharedPath).trackingEngine, DIAMOND_ENGINE);
    assert.equal(firestore.read(sharedPath).diamondSourceGameId, "game-1");
    assert.equal(
      firestore.read(sharedPath).diamondScorebookInstanceId,
      "instance-1",
    );
    assert.deepEqual(firestore.read(mismatchedRefPath), {
      untouched: true,
      homeTeamId: "team-1",
      teamGameIds: { "team-1": "game-1" },
    });
    const effects = firestore
      .directChildren(paths.effects)
      .map((entry) => entry.data);
    assert.equal(
      effects.filter((effect) => effect.kind === "shared-game").length,
      1,
    );
    assert.match(
      effects.find((effect) => effect.kind === "shared-game").dedupKey,
      /:instance:instance-1:shared-game:/,
    );
  });

  it("rejects a participant team's colliding local ID when a legacy shared game has only a bare source game ID", async () => {
    const game = createGame();
    const firestore = new FakeFirestore();
    const sharedPath = "organizations/org-1/sharedGames/shared-collision";
    const harness = createHarness({
      firestore,
      handlers: {
        resolveSharedGame: async () => ({
          path: sharedPath,
          data: firestore.read(sharedPath),
        }),
      },
    });
    const { paths } = seedGame(firestore, game, {
      isHome: false,
      game: { sharedGamePath: sharedPath },
    });
    const legacySharedGame = {
      id: "shared-collision",
      homeTeamId: "source-team",
      awayTeamId: "team-1",
      teamIds: ["source-team", "team-1"],
      sourceGameId: "game-1",
      status: "scheduled",
      homeScore: 4,
      awayScore: 2,
    };
    firestore.seed(sharedPath, legacySharedGame);

    await assert.rejects(
      harness.handlers.projectDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      }),
      (error) => error?.code === "invalid-shared-game",
    );

    assert.deepEqual(firestore.read(sharedPath), legacySharedGame);
    assert.equal(
      firestore.read(paths.scorebook).diamondProjectionMarker,
      undefined,
    );
  });

  it("continues an exact server-owned Diamond shared-game claim that predates team-scoped legacy bindings", async () => {
    const game = createGame();
    const firestore = new FakeFirestore();
    const sharedPath = "organizations/org-1/sharedGames/claimed-legacy";
    const harness = createHarness({
      firestore,
      handlers: {
        resolveSharedGame: async () => ({
          path: sharedPath,
          data: firestore.read(sharedPath),
        }),
      },
    });
    seedGame(firestore, game, {
      game: { sharedGamePath: sharedPath },
    });
    firestore.seed(sharedPath, {
      id: "claimed-legacy",
      homeTeamId: "team-1",
      awayTeamId: "opponent-1",
      teamIds: ["team-1", "opponent-1"],
      sourceGameId: "game-1",
      status: "scheduled",
      trackingEngine: DIAMOND_ENGINE,
      diamondSourceTeamId: "team-1",
      diamondSourceGameId: "game-1",
      diamondScorebookInstanceId: "instance-1",
    });

    const result = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });

    assert.equal(result.projected, true);
    assert.equal(firestore.read(sharedPath).trackingEngine, DIAMOND_ENGINE);
    assert.equal(firestore.read(sharedPath).diamondSourceTeamId, "team-1");
    assert.equal(firestore.read(sharedPath).diamondSourceGameId, "game-1");
  });

  for (const { label, claimFields } of [
    {
      label: "the Diamond engine marker without either owner field",
      claimFields: { trackingEngine: DIAMOND_ENGINE },
    },
    {
      label: "the Diamond engine marker with only the owner team",
      claimFields: {
        trackingEngine: DIAMOND_ENGINE,
        diamondSourceTeamId: "team-1",
      },
    },
    {
      label: "the Diamond engine marker with only the owner game",
      claimFields: {
        trackingEngine: DIAMOND_ENGINE,
        diamondSourceGameId: "game-1",
      },
    },
    {
      label: "a different Diamond owner team",
      claimFields: {
        trackingEngine: DIAMOND_ENGINE,
        diamondSourceTeamId: "opponent-1",
        diamondSourceGameId: "game-1",
      },
    },
    {
      label: "a different Diamond owner game",
      claimFields: {
        trackingEngine: DIAMOND_ENGINE,
        diamondSourceTeamId: "team-1",
        diamondSourceGameId: "other-game",
      },
    },
    {
      label: "an exact-looking owner pair without a Diamond engine marker",
      claimFields: {
        diamondSourceTeamId: "team-1",
        diamondSourceGameId: "game-1",
      },
    },
    {
      label: "an exact-looking owner pair with a different engine marker",
      claimFields: {
        trackingEngine: "legacy-v1",
        diamondSourceTeamId: "team-1",
        diamondSourceGameId: "game-1",
      },
    },
  ]) {
    it(`rejects ${label} despite simultaneous valid legacy bindings`, async () => {
      const game = createGame();
      const firestore = new FakeFirestore();
      const sharedPath =
        "organizations/org-1/sharedGames/conflicting-diamond-claim";
      const harness = createHarness({
        firestore,
        handlers: {
          resolveSharedGame: async () => ({
            path: sharedPath,
            data: firestore.read(sharedPath),
          }),
        },
      });
      seedGame(firestore, game, {
        game: { sharedGamePath: sharedPath },
      });
      const sharedGame = {
        id: "conflicting-diamond-claim",
        homeTeamId: "team-1",
        awayTeamId: "opponent-1",
        teamIds: ["team-1", "opponent-1"],
        teamGameIds: { "team-1": "game-1" },
        homeGameId: "game-1",
        status: "scheduled",
        ...claimFields,
      };
      firestore.seed(sharedPath, sharedGame);

      await assert.rejects(
        harness.handlers.projectDiamondGame({
          teamId: "team-1",
          gameId: "game-1",
        }),
        (error) =>
          error?.code === "shared-game-owner-conflict" && !error.retryable,
      );

      assert.deepEqual(firestore.read(sharedPath), sharedGame);
    });
  }

  for (const {
    label,
    isHome = true,
    sharedFields,
  } of [
    {
      label: "a team game ID map",
      sharedFields: { teamGameIds: { "team-1": "game-1" } },
    },
    {
      label: "the home side's game ID",
      sharedFields: { homeGameId: "game-1" },
    },
    {
      label: "the away side's game ID",
      isHome: false,
      sharedFields: { awayGameId: "game-1" },
    },
    {
      label: "an explicit source team and source game pair",
      sharedFields: {
        sourceTeamId: "team-1",
        sourceGameId: "game-1",
      },
    },
  ]) {
    it(`accepts a shared game bound through ${label}`, async () => {
      const game = createGame();
      const firestore = new FakeFirestore();
      const sharedPath = `organizations/org-1/sharedGames/${isHome ? "home" : "away"}-${sharedFields.sourceTeamId ? "source" : "binding"}`;
      const harness = createHarness({
        firestore,
        handlers: {
          resolveSharedGame: async () => ({
            path: sharedPath,
            data: firestore.read(sharedPath),
          }),
        },
      });
      seedGame(firestore, game, {
        isHome,
        game: { sharedGamePath: sharedPath },
      });
      firestore.seed(sharedPath, {
        id: sharedPath.split("/").at(-1),
        homeTeamId: isHome ? "team-1" : "opponent-1",
        awayTeamId: isHome ? "opponent-1" : "team-1",
        teamIds: ["team-1", "opponent-1"],
        status: "scheduled",
        ...sharedFields,
      });

      const result = await harness.handlers.projectDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      });

      assert.equal(result.projected, true);
      assert.equal(firestore.read(sharedPath).trackingEngine, DIAMOND_ENGINE);
      assert.equal(firestore.read(sharedPath).diamondSourceTeamId, "team-1");
      assert.equal(firestore.read(sharedPath).diamondSourceGameId, "game-1");
    });
  }

  for (const { label, sharedFields } of [
    {
      label: "no team-scoped game binding",
      sharedFields: {},
    },
    {
      label: "a source team without a source game",
      sharedFields: { sourceTeamId: "team-1" },
    },
    {
      label: "a matching game attributed to the other source team",
      sharedFields: {
        sourceTeamId: "opponent-1",
        sourceGameId: "game-1",
      },
    },
    {
      label: "a matching source team paired with another game",
      sharedFields: {
        sourceTeamId: "team-1",
        sourceGameId: "other-game",
      },
    },
    {
      label: "the matching game ID on the opposite side",
      sharedFields: { awayGameId: "game-1" },
    },
  ]) {
    it(`rejects ambiguous shared-game metadata with ${label}`, async () => {
      const game = createGame();
      const firestore = new FakeFirestore();
      const sharedPath = "tournaments/tournament-1/sharedGames/ambiguous";
      const harness = createHarness({
        firestore,
        handlers: {
          resolveSharedGame: async () => ({
            path: sharedPath,
            data: firestore.read(sharedPath),
          }),
        },
      });
      seedGame(firestore, game, {
        game: { sharedGamePath: sharedPath },
      });
      const sharedGame = {
        id: "ambiguous",
        homeTeamId: "team-1",
        awayTeamId: "opponent-1",
        teamIds: ["team-1", "opponent-1"],
        status: "scheduled",
        ...sharedFields,
      };
      firestore.seed(sharedPath, sharedGame);

      await assert.rejects(
        harness.handlers.projectDiamondGame({
          teamId: "team-1",
          gameId: "game-1",
        }),
        (error) => error?.code === "invalid-shared-game",
      );

      assert.deepEqual(firestore.read(sharedPath), sharedGame);
    });
  }

  it("accepts an exact server-owned Diamond claim introduced before final shared-game CAS", async () => {
    const game = createGame();
    const firestore = new FakeFirestore();
    const sharedPath = "organizations/org-1/sharedGames/claimed-before-cas";
    const harness = createHarness({
      firestore,
      handlers: {
        resolveSharedGame: async () => ({
          path: sharedPath,
          data: firestore.read(sharedPath),
        }),
        hooks: {
          async beforeFinalize() {
            const shared = firestore.read(sharedPath);
            delete shared.teamGameIds;
            shared.sourceGameId = "game-1";
            shared.trackingEngine = DIAMOND_ENGINE;
            shared.diamondSourceTeamId = "team-1";
            shared.diamondSourceGameId = "game-1";
            firestore.seed(sharedPath, shared);
          },
        },
      },
    });
    seedGame(firestore, game, {
      game: { sharedGamePath: sharedPath },
    });
    firestore.seed(sharedPath, {
      id: "claimed-before-cas",
      homeTeamId: "team-1",
      awayTeamId: "opponent-1",
      teamIds: ["team-1", "opponent-1"],
      teamGameIds: { "team-1": "game-1" },
      status: "scheduled",
    });

    const result = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });

    assert.equal(result.projected, true);
    assert.equal(firestore.read(sharedPath).trackingEngine, DIAMOND_ENGINE);
    assert.equal(firestore.read(sharedPath).diamondSourceTeamId, "team-1");
    assert.equal(firestore.read(sharedPath).diamondSourceGameId, "game-1");
  });

  for (const { label, claimFields } of [
    {
      label: "partial",
      claimFields: {
        trackingEngine: DIAMOND_ENGINE,
        diamondSourceTeamId: "team-1",
      },
    },
    {
      label: "mismatched",
      claimFields: {
        trackingEngine: DIAMOND_ENGINE,
        diamondSourceTeamId: "team-1",
        diamondSourceGameId: "other-game",
      },
    },
  ]) {
    it(`rejects a ${label} Diamond claim introduced before final CAS even when legacy bindings remain valid`, async () => {
      const game = createGame();
      const firestore = new FakeFirestore();
      const sharedPath = `organizations/org-1/sharedGames/${label}-before-cas`;
      const harness = createHarness({
        firestore,
        handlers: {
          resolveSharedGame: async () => ({
            path: sharedPath,
            data: firestore.read(sharedPath),
          }),
          hooks: {
            async beforeFinalize() {
              firestore.seed(sharedPath, {
                ...firestore.read(sharedPath),
                ...claimFields,
              });
            },
          },
        },
      });
      seedGame(firestore, game, {
        game: { sharedGamePath: sharedPath },
      });
      firestore.seed(sharedPath, {
        id: `${label}-before-cas`,
        homeTeamId: "team-1",
        awayTeamId: "opponent-1",
        teamIds: ["team-1", "opponent-1"],
        teamGameIds: { "team-1": "game-1" },
        homeGameId: "game-1",
        status: "scheduled",
      });

      await assert.rejects(
        harness.handlers.projectDiamondGame({
          teamId: "team-1",
          gameId: "game-1",
        }),
        (error) =>
          error?.code === "shared-game-cas-failed" && error.retryable,
      );

      assert.deepEqual(firestore.read(sharedPath), {
        id: `${label}-before-cas`,
        homeTeamId: "team-1",
        awayTeamId: "opponent-1",
        teamIds: ["team-1", "opponent-1"],
        teamGameIds: { "team-1": "game-1" },
        homeGameId: "game-1",
        status: "scheduled",
        ...claimFields,
      });
    });
  }

  it("revalidates the team-scoped shared-game binding at the final transaction boundary", async () => {
    const game = createGame();
    const firestore = new FakeFirestore();
    const sharedPath = "organizations/org-1/sharedGames/shared-race";
    const harness = createHarness({
      firestore,
      handlers: {
        resolveSharedGame: async () => ({
          path: sharedPath,
          data: firestore.read(sharedPath),
        }),
        hooks: {
          async beforeFinalize() {
            const shared = firestore.read(sharedPath);
            delete shared.teamGameIds;
            shared.sourceGameId = "game-1";
            firestore.seed(sharedPath, shared);
          },
        },
      },
    });
    seedGame(firestore, game, {
      game: { sharedGamePath: sharedPath },
    });
    firestore.seed(sharedPath, {
      id: "shared-race",
      homeTeamId: "team-1",
      awayTeamId: "opponent-1",
      teamIds: ["team-1", "opponent-1"],
      teamGameIds: { "team-1": "game-1" },
      status: "scheduled",
    });

    await assert.rejects(
      harness.handlers.projectDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      }),
      (error) => error?.code === "shared-game-cas-failed" && error.retryable,
    );

    const shared = firestore.read(sharedPath);
    assert.equal(shared.sourceGameId, "game-1");
    assert.equal(shared.trackingEngine, undefined);
    assert.equal(shared.diamondSourceTeamId, undefined);
  });

  it("keeps notes, transcripts, actors, audit data, and private roster fields out of every public projection", async () => {
    const sentinel = "MEDICAL-PRIVATE-TRANSCRIPT-ALPHA";
    const game = createGame({ captureMode: "full" });
    game.submit("private_note", {
      text: sentinel,
      visibility: "staff-private",
    });
    game.submit("rules_decision", {
      code: "coverage_adjustment",
      description: sentinel,
      affectedFamilies: ["situational"],
    });
    const harness = createHarness();
    const { paths } = seedGame(harness.firestore, game);
    await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });

    const publicValue = {
      current: harness.firestore.read(paths.publicCurrent),
      manifest: harness.firestore.read(paths.replayManifest),
      pages: harness.firestore
        .directChildren(paths.replayPages)
        .map((entry) => entry.data),
      publicPlayerStats: harness.firestore
        .directChildren(paths.publicPlayerStats("instance-1"))
        .map((entry) => entry.data),
      team: harness.firestore.read(paths.teamStat("instance-1")),
    };
    const serialized = JSON.stringify(publicValue);
    assert.doesNotMatch(serialized, new RegExp(sentinel));
    assert.doesNotMatch(
      serialized,
      /actorUid|transcript|medicalNote|PRIVATE-ROSTER-SENTINEL|currentScorerUid/,
    );
    const privateProjection = JSON.stringify(
      harness.firestore.read(paths.privateCurrent),
    );
    assert.match(privateProjection, new RegExp(sentinel));
  });

  it("isolates every stat generation and never touches a legacy-owned read model", async () => {
    const game = createGame();
    setLineupsAndStart(game);
    const harness = createHarness();
    const { paths, instanceId } = seedGame(harness.firestore, game);
    harness.firestore.seed(paths.replayPage("page-999999"), {
      trackingEngine: DIAMOND_ENGINE,
      teamId: "team-1",
      diamondGameId: "game-1",
      instanceId: "old-generation",
      projectionGeneration: "old-generation",
      sourceRevision: 99,
    });
    const legacyPath = "teams/team-1/games/game-1/aggregatedStats/home-1";
    harness.firestore.seed(legacyPath, {
      stats: { h: 99 },
      legacyOwner: true,
    });
    const staleGenerationPath = paths.publicPlayerStat(
      "old-generation",
      "home-1",
    );
    harness.firestore.seed(staleGenerationPath, {
      trackingEngine: DIAMOND_ENGINE,
      teamId: "team-1",
      diamondGameId: "game-1",
      instanceId: "old-generation",
      stats: { h: 88 },
    });

    await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.deepEqual(harness.firestore.read(legacyPath), {
      stats: { h: 99 },
      legacyOwner: true,
    });
    assert.equal(harness.firestore.read(staleGenerationPath).stats.h, 88);
    assert.notEqual(
      harness.firestore.read(paths.publicPlayerStat(instanceId, "home-1")),
      null,
    );
    assert.equal(
      harness.firestore.read(paths.replayPage("page-999999")).instanceId,
      "old-generation",
    );

    const root = harness.firestore.read(paths.scorebook);
    harness.firestore.seed(paths.game, {
      ...harness.firestore.read(paths.game),
      diamondScorebookInstanceId: "replacement-generation",
    });
    const generationFenced = await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(generationFenced.projected, false);
    assert.equal(generationFenced.reason, "not-diamond-owned");
    assert.equal(
      harness.firestore.read(paths.scorebook).instanceId,
      root.instanceId,
    );
  });

  it("projects 25 players for one game without scanning or mutating 40 sibling games", async () => {
    const game = createGame();
    setLineupsAndStart(game, 25);
    const harness = createHarness();
    const { paths } = seedGame(harness.firestore, game);
    for (let index = 1; index <= 40; index += 1) {
      harness.firestore.seed(
        `teams/team-1/games/sibling-${String(index).padStart(2, "0")}`,
        {
          trackingEngine: "legacy-v1",
          untouched: true,
        },
      );
    }

    await harness.handlers.projectDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(
      harness.firestore.directChildren(paths.publicPlayerStats("instance-1"))
        .length,
      25,
    );
    assert.equal(
      harness.firestore.directChildren(paths.privatePlayerStats("instance-1"))
        .length,
      25,
    );
    assert.equal(
      harness.firestore.queryLog.some(
        (query) => query.path === "teams/team-1/games",
      ),
      false,
    );
    for (let index = 1; index <= 40; index += 1) {
      assert.deepEqual(
        harness.firestore.read(
          `teams/team-1/games/sibling-${String(index).padStart(2, "0")}`,
        ),
        { trackingEngine: "legacy-v1", untouched: true },
      );
    }
  });

  it("parks deterministic failures until an explicit recovery request marks the root pending", async () => {
    const game = createGame();
    const harness = createHarness();
    const { paths } = seedGame(harness.firestore, game);
    const event = game.ledger.events[0];
    harness.firestore.seed(`${paths.events}/${event.eventId}`, {
      ...harness.firestore.read(`${paths.events}/${event.eventId}`),
      hash: `sha256:${"0".repeat(64)}`,
    });

    const pendingSnapshot = harness.firestore.documentSnapshot(
      harness.firestore.doc(paths.scorebook),
    );
    await assert.rejects(
      harness.handlers.onDiamondScorebookWrite(
        { after: pendingSnapshot },
        { params: { teamId: "team-1", gameId: "game-1" } },
      ),
      (error) => error.code === "ledger-integrity-failed" && !error.retryable,
    );
    const failedRoot = harness.firestore.read(paths.scorebook);
    assert.equal(failedRoot.projectionStatus, "failed");
    assert.equal(failedRoot.projectionFailure.retryable, false);
    assert.equal(failedRoot.projectionLease, null);

    const failedSnapshot = harness.firestore.documentSnapshot(
      harness.firestore.doc(paths.scorebook),
    );
    const ignored = await harness.handlers.onDiamondScorebookWrite(
      { after: failedSnapshot },
      { params: { teamId: "team-1", gameId: "game-1" } },
    );
    assert.deepEqual(ignored, {
      projected: false,
      reason: "projection-not-pending",
      sourceRevision: game.ledger.state.revision,
    });
    assert.deepEqual(harness.firestore.read(paths.scorebook), failedRoot);
  });

  it("requires complete bounded inventories and rejects malformed ledger generations", async () => {
    const game = createGame();
    const harness = createHarness();
    const { paths } = seedGame(harness.firestore, game);
    harness.firestore.delete(
      `${paths.events}/${game.ledger.events[0].eventId}`,
    );
    await assert.rejects(
      harness.handlers.projectDiamondGame({
        teamId: "team-1",
        gameId: "game-1",
      }),
      (error) => error.code === "ledger-incomplete" && error.retryable,
    );
    assert.equal(
      harness.firestore.read(paths.scorebook).projectionStatus,
      "pending",
    );
    assert.equal(
      harness.firestore.read(paths.publicCurrent).projectionStatus,
      "pending",
    );
  });
});
