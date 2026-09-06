"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const core = require("../diamond-scorebook-core.cjs");
const domainEngine = require("../diamond-engine");
const projectionAdapter = require("../diamond-scorebook-projections.cjs");
const {
  createDiamondStatConfigSnapshot,
} = require("../diamond-stat-config.cjs");
const {
  DIAMOND_ENGINE,
  MAX_PACKET_BYTES,
  MAX_RECAP_PLAYS,
  aiPaths,
  createDiamondScorebookAiHandlers,
} = require("../diamond-scorebook-ai-handlers.cjs");

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
    this.value = clone(value);
  }

  data() {
    return clone(this.value);
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
    return this.database.getDocument(this);
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
    return this.database.getQuery(this);
  }
}

class FakeTransaction {
  constructor(database) {
    this.database = database;
    this.operations = [];
  }

  get(reference) {
    return this.database.getDocument(reference);
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
}

class FakeFirestore {
  constructor(seed = {}) {
    this.documents = new Map(
      Object.entries(seed).map(([path, value]) => [path, clone(value)]),
    );
    this.transactionQueue = Promise.resolve();
    this.failDocumentPaths = new Set();
    this.failQueryPaths = new Set();
    this.queryTransform = null;
    this.queryLog = [];
    this.readLog = [];
    this.failAfterNextTransactionCommit = false;
  }

  doc(path) {
    return new FakeDocumentReference(this, path);
  }

  collection(path) {
    return new FakeQuery(this, path);
  }

  getDocument(reference) {
    this.readLog.push(reference.path);
    if (this.failDocumentPaths.has(reference.path)) {
      return Promise.reject(
        Object.assign(new Error("Injected read failure"), {
          code: "unavailable",
        }),
      );
    }
    return Promise.resolve(
      new FakeDocumentSnapshot(reference, this.documents.get(reference.path)),
    );
  }

  getQuery(query) {
    this.queryLog.push({
      path: query.path,
      filters: clone(query.filters),
      ordering: clone(query.ordering),
      maximum: query.maximum,
    });
    if (this.failQueryPaths.has(query.path)) {
      return Promise.reject(
        Object.assign(new Error("Injected query failure"), {
          code: "unavailable",
        }),
      );
    }
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
        if (filter.operator === "==") return value === filter.value;
        if (filter.operator === ">") return value > filter.value;
        if (filter.operator === "<=") return value <= filter.value;
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
    if (Number.isSafeInteger(query.maximum))
      rows = rows.slice(0, query.maximum);
    if (typeof this.queryTransform === "function") {
      rows = this.queryTransform(query, rows) || rows;
    }
    return Promise.resolve(new FakeQuerySnapshot(rows));
  }

  applyOperations(operations) {
    const next = new Map(
      [...this.documents].map(([path, value]) => [path, clone(value)]),
    );
    for (const operation of operations) {
      const path = operation.reference.path;
      if (operation.kind === "create") {
        if (next.has(path)) {
          throw Object.assign(new Error(`Document exists: ${path}`), {
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
          throw Object.assign(new Error(`Document missing: ${path}`), {
            code: "not-found",
          });
        }
        next.set(path, { ...next.get(path), ...clone(operation.value) });
      }
    }
    this.documents = next;
  }

  runTransaction(callback) {
    const run = async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      this.applyOperations(transaction.operations);
      if (
        this.failAfterNextTransactionCommit &&
        transaction.operations.length > 0
      ) {
        this.failAfterNextTransactionCommit = false;
        throw Object.assign(new Error("Injected post-commit ambiguity"), {
          code: "unavailable",
        });
      }
      return result;
    };
    const pending = this.transactionQueue.then(run, run);
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
}

function hash(value) {
  return core.hashDiamondValue(value);
}

function uuid(index = 1) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const coverage = Object.freeze({
  batting: "complete",
  baserunning: "complete",
  pitching: "complete",
  fielding: "partial",
  situational: "complete",
  pitches: "partial",
  sensors: "not_collected",
});

function publicPlay(revision, type, description, options = {}) {
  return {
    schemaVersion: 2,
    eventId: options.eventId || `event-${String(revision)}`,
    playId: options.eventId || `event-${String(revision)}`,
    sourceEventId: options.sourceEventId || `event-${String(revision)}`,
    sequence: revision,
    revision,
    type,
    description,
    inning: { number: 7, half: "bottom" },
    inningLabel: "Bottom 7",
    score: { home: 4, away: 2 },
    outs: 2,
    count: { balls: 0, strikes: 0 },
    bases: { first: null, second: null, third: null },
    coverage: { ...coverage },
    corrected: false,
    serverTimestampMs: 1_788_600_000_000 + revision,
    ...(options.patch || {}),
  };
}

function basePlays() {
  return [
    publicPlay(6, "record_pitch", "Called strike"),
    publicPlay(7, "record_plate_appearance", "Riley singled."),
    publicPlay(8, "finalize", "Game final, Home 4, Away 2."),
  ];
}

function baseDocuments(options = {}) {
  const teamId = options.teamId || "team-1";
  const gameId = options.gameId || "game-1";
  const instanceId = options.instanceId || "instance-1";
  const plays = options.plays || basePlays();
  const sourceRevision =
    options.sourceRevision ??
    Math.max(0, ...plays.map((play) => play.revision));
  const checkpointHash = hash({ checkpoint: sourceRevision, gameId });
  const projectionHash = hash({ projection: sourceRevision, gameId });
  const projectionKey = `projection-${hash({ run: sourceRevision, gameId }).slice(7)}`;
  const resourcePaths = aiPaths(teamId, gameId);
  const statConfigSnapshot = createDiamondStatConfigSnapshot({
    teamId,
    configId: "baseball-standard",
    config: {
      statDefinitions: [
        { id: "g", scope: "player", visibility: "public" },
        { id: "r", scope: "player", visibility: "public" },
        { id: "h", scope: "player", visibility: "public" },
        { id: "1b", scope: "player", visibility: "public" },
        { id: "avg", scope: "player", visibility: "public" },
        { id: "whip", scope: "player", visibility: "private" },
      ],
    },
  });
  const pageSize = 100;
  const pages = [];
  for (let offset = 0; offset < plays.length; offset += pageSize) {
    const items = plays.slice(offset, offset + pageSize);
    const pageNumber = pages.length + 1;
    const pageId = `page-${String(pageNumber).padStart(6, "0")}`;
    const nextPageId =
      offset + pageSize < plays.length
        ? `page-${String(pageNumber + 1).padStart(6, "0")}`
        : null;
    pages.push({
      pageId,
      value: {
        schemaVersion: 1,
        trackingEngine: DIAMOND_ENGINE,
        teamId,
        diamondGameId: gameId,
        instanceId,
        sourceRevision,
        checkpointHash,
        projectionHash,
        pageNumber,
        pageSize,
        itemCount: items.length,
        startRevision: items[0]?.revision ?? null,
        endRevision: items.at(-1)?.revision ?? null,
        ordering: "effective-source-revision",
        revisionGapsAllowed: true,
        items,
        nextPageId,
        nextCursor: nextPageId
          ? `${String(items.at(-1).revision)}:cursor`
          : null,
        complete: true,
        collectionComplete: nextPageId === null,
        truncated: nextPageId !== null,
      },
    });
  }
  const aggregate = {
    schemaVersion: 1,
    trackingEngine: DIAMOND_ENGINE,
    projectionSchemaVersion: 1,
    playerId: "player-1",
    teamId,
    diamondGameId: gameId,
    instanceId,
    diamondScorebookInstanceId: instanceId,
    projectionGeneration: instanceId,
    sourceRevision,
    checkpointHash,
    statConfigSnapshotHash: statConfigSnapshot.snapshotHash,
    projectionHash,
    playerName: "Riley",
    playerNumber: "7",
    stats: { g: 1, r: 2, h: 3, "1b": 2 },
    observedStats: {},
    derivedStats: { avg: 0.375 },
    observedDerivedStats: {},
    statCoverage: {
      g: "complete",
      r: "complete",
      h: "complete",
      "1b": "complete",
      avg: "complete",
    },
    coverage: { ...coverage },
    complete: true,
    ...(options.aggregate || {}),
  };
  const marker = {
    schemaVersion: 1,
    trackingEngine: DIAMOND_ENGINE,
    status: "current",
    instanceId,
    sourceRevision,
    checkpointHash,
    statConfigSnapshotHash: statConfigSnapshot.snapshotHash,
    projectionHash,
    projectionKey,
  };
  const documents = {
    [resourcePaths.team]: {
      id: teamId,
      ownerId: "manager-1",
      active: true,
      sport: "baseball",
    },
    [resourcePaths.user("manager-1")]: { isAdmin: false },
    [resourcePaths.user("manager-2")]: { isAdmin: false },
    [resourcePaths.user("scorer-1")]: { isAdmin: false },
    [resourcePaths.user("former-scorer")]: { isAdmin: false },
    [resourcePaths.game]: {
      id: gameId,
      teamId,
      type: "game",
      trackingEngine: DIAMOND_ENGINE,
      diamondScorebookInstanceId: instanceId,
      statTrackerConfigId: "baseball-standard",
      diamondStatConfigSnapshotHash: statConfigSnapshot.snapshotHash,
      diamondProjectionRevision: sourceRevision,
      diamondProjectionCheckpointHash: checkpointHash,
      diamondProjectionHash: projectionHash,
      diamondProjectionStatus: "current",
      diamondProjectionComplete: true,
      status: "completed",
      homeScore: 4,
      awayScore: 2,
    },
    [resourcePaths.scorebook]: {
      schemaVersion: 2,
      trackingEngine: DIAMOND_ENGINE,
      teamId,
      gameId,
      instanceId,
      statConfigSnapshot,
      checkpoint: {
        teamId,
        gameId,
        rulesProfileId: "baseball-youth",
        rulesProfileVersion: 1,
        captureMode: "full",
        sequence: sourceRevision,
        previousHash: checkpointHash,
        state: {
          revision: sourceRevision,
          checkpointHash,
          lifecycle: "final",
          currentScorerUid: "scorer-1",
          score: { home: 4, away: 2 },
          coverage: { ...coverage },
        },
      },
      projectionStatus: "complete",
      projectionSourceRevision: sourceRevision,
      projectionCheckpointHash: checkpointHash,
      projectionHash,
      diamondProjectionMarker: marker,
    },
    [resourcePaths.publicState]: {
      schemaVersion: 2,
      trackingEngine: DIAMOND_ENGINE,
      teamId,
      gameId,
      diamondGameId: gameId,
      instanceId,
      sourceRevision,
      checkpointHash,
      projectionHash,
      authoritative: true,
      complete: true,
      lifecycle: "final",
      status: "completed",
      projectionStatus: "complete",
      score: { home: 4, away: 2 },
      home: { name: "Comets", score: 4 },
      away: { name: "Rockets", score: 2 },
      coverage: { ...coverage },
    },
    [resourcePaths.replayManifest]: {
      schemaVersion: 1,
      trackingEngine: DIAMOND_ENGINE,
      teamId,
      diamondGameId: gameId,
      instanceId,
      sourceRevision,
      checkpointHash,
      projectionHash,
      pageSize,
      pageCount: pages.length,
      itemCount: plays.length,
      ordering: "effective-source-revision",
      revisionGapsAllowed: true,
      firstPageId: pages[0]?.pageId ?? null,
      lastPageId: pages.at(-1)?.pageId ?? null,
      complete: true,
      collectionComplete: true,
      absenceConfirmed: plays.length === 0,
    },
    [resourcePaths.projectionRun(projectionKey)]: {
      schemaVersion: 1,
      trackingEngine: DIAMOND_ENGINE,
      teamId,
      diamondGameId: gameId,
      instanceId,
      projectionKey,
      projectionHash,
      sourceRevision,
      checkpointHash,
      statConfigSnapshotHash: statConfigSnapshot.snapshotHash,
      status: "complete",
      complete: true,
      replayPageCount: pages.length,
      publicPlayerStatCount: options.aggregateCount ?? 1,
      marker,
    },
    ...(options.aggregateCount === 0
      ? {}
      : {
          [`${resourcePaths.publicPlayerStats(instanceId)}/player-1`]: aggregate,
        }),
  };
  for (const page of pages) {
    documents[`${resourcePaths.replayPages}/${page.pageId}`] = page.value;
  }
  return {
    documents,
    identity: {
      teamId,
      gameId,
      instanceId,
      sourceRevision,
      checkpointHash,
      projectionHash,
      projectionKey,
      statConfigSnapshot,
    },
    paths: resourcePaths,
  };
}

function createHarness(options = {}) {
  const base = options.base || baseDocuments(options.documentsOptions);
  const firestore = options.firestore || new FakeFirestore(base.documents);
  const authUsers = new Map(
    Object.entries({
      "manager-1": {
        uid: "manager-1",
        disabled: false,
        email: "manager@example.com",
        emailVerified: true,
      },
      "manager-2": {
        uid: "manager-2",
        disabled: false,
        email: "manager2@example.com",
        emailVerified: true,
      },
      "scorer-1": {
        uid: "scorer-1",
        disabled: false,
        email: "scorer@example.com",
        emailVerified: true,
      },
      "former-scorer": {
        uid: "former-scorer",
        disabled: false,
        email: "former@example.com",
        emailVerified: true,
      },
      "disabled-1": {
        uid: "disabled-1",
        disabled: true,
        email: "disabled@example.com",
        emailVerified: true,
      },
      ...(options.authUsers || {}),
    }),
  );
  const handlers = createDiamondScorebookAiHandlers({
    firestore,
    auth: {
      async getUser(uid) {
        const user = authUsers.get(uid);
        if (!user) {
          throw Object.assign(new Error("Missing Auth user"), {
            code: "auth/user-not-found",
          });
        }
        return clone(user);
      },
    },
    HttpsError: TestHttpsError,
    core,
    statConfig: require("../diamond-stat-config.cjs"),
    resolveDelegatedAccess: ({ uid }) => ({
      full: uid === "manager-1" || uid === "manager-2",
      scorekeeping:
        uid === "manager-1" ||
        uid === "manager-2" ||
        uid === "scorer-1" ||
        uid === "former-scorer",
    }),
    clock: options.clock || (() => 1_788_652_800_000),
  });
  return { ...base, firestore, handlers, authUsers };
}

function context(uid = "manager-1") {
  return { auth: { uid } };
}

function sourceRequest(identity) {
  return {
    teamId: identity.teamId,
    gameId: identity.gameId,
    sourceRevision: identity.sourceRevision,
  };
}

function validDraft(source) {
  const playerStat = source.packet.stats.find(
    (stat) => stat.subjectType === "player",
  );
  return {
    schemaVersion: 1,
    sourceRevision: source.sourceRevision,
    coverage: clone(source.packet.coverage),
    recap: {
      text: "Riley singled.",
      citations: [{ eventId: "event-7", revision: 7 }],
      statRefs: [],
    },
    insights: [
      {
        text: "Riley recorded 3 hits.",
        citations: [{ eventId: "event-7", revision: 7 }],
        statRefs: [{ statId: playerStat.statId, metric: "h" }],
      },
    ],
    dataQualityNotes: [
      "Partial data coverage: fielding and pitches.",
      "Not collected: sensors.",
    ],
    draft: true,
    published: false,
    requiresPublicationConfirmation: true,
    mutatesState: false,
  };
}

async function loadSource(harness, uid = "manager-1") {
  return harness.handlers.getDiamondRecapSource(
    sourceRequest(harness.identity),
    context(uid),
  );
}

describe("Diamond scorebook postgame AI handlers", () => {
  it("builds a revision-pinned public packet and excludes pitches and private read models", async () => {
    const harness = createHarness();

    const result = await loadSource(harness);

    assert.equal(result.current, true);
    assert.equal(result.sourceRevision, 8);
    assert.equal(result.checkpointHash, harness.identity.checkpointHash);
    assert.deepEqual(
      result.packet.plays.map((play) => [play.eventId, play.revision]),
      [
        ["event-7", 7],
        ["event-8", 8],
      ],
    );
    assert.equal(
      result.packet.plays.some((play) =>
        Object.prototype.hasOwnProperty.call(play, "type"),
      ),
      false,
    );
    const playerStat = result.packet.stats.find(
      (stat) => stat.subjectType === "player",
    );
    assert.equal(playerStat.subjectId, "player-1");
    assert.equal(playerStat.values.h, 3);
    assert.equal(playerStat.values["metric.1b"], 2);
    assert.equal(playerStat.values.whip, undefined);
    assert.equal(result.packet.stats[0].statId, "game-score");
    assert.equal(result.packet.stats[0].values.homeScore, 4);
    assert.equal(JSON.stringify(result).includes("actorUid"), false);
    assert.equal(JSON.stringify(result).includes("transcript"), false);
    assert.equal(
      harness.firestore.queryLog.some(({ path }) =>
        path.includes("privatePlayerStats"),
      ),
      false,
    );
  });

  it("binds identity to the game path without requiring a redundant game teamId", async () => {
    const harness = createHarness();
    const game = harness.firestore.read(harness.paths.game);
    delete game.teamId;
    harness.firestore.seed(harness.paths.game, game);
    await assert.doesNotReject(loadSource(harness));

    harness.firestore.seed(harness.paths.game, {
      ...game,
      teamId: "different-team",
    });
    await assert.rejects(loadSource(harness), {
      code: "failed-precondition",
    });
  });

  it("allows a full manager or the exact current scorer, but not another delegated scorer", async () => {
    const harness = createHarness();

    await assert.doesNotReject(loadSource(harness, "manager-1"));
    await assert.doesNotReject(loadSource(harness, "scorer-1"));
    await assert.rejects(loadSource(harness, "former-scorer"), {
      code: "permission-denied",
    });
  });

  it("requires a current enabled Auth user and exact request fields", async () => {
    const harness = createHarness();

    await assert.rejects(
      harness.handlers.getDiamondRecapSource(
        sourceRequest(harness.identity),
        {},
      ),
      { code: "unauthenticated" },
    );
    await assert.rejects(loadSource(harness, "disabled-1"), {
      code: "permission-denied",
    });
    await assert.rejects(
      harness.handlers.getDiamondRecapSource(
        { ...sourceRequest(harness.identity), actorUid: "manager-1" },
        context(),
      ),
      { code: "invalid-argument" },
    );
  });

  it("fails closed for stale, non-final, foreign-engine, or invalid stat-config state", async () => {
    for (const mutate of [
      (harness) => {
        const root = harness.firestore.read(harness.paths.scorebook);
        harness.firestore.seed(harness.paths.scorebook, {
          ...root,
          checkpoint: {
            ...root.checkpoint,
            state: { ...root.checkpoint.state, lifecycle: "correction" },
          },
        });
      },
      (harness) => {
        harness.firestore.seed(harness.paths.game, {
          ...harness.firestore.read(harness.paths.game),
          trackingEngine: "legacy-v1",
        });
      },
      (harness) => {
        const root = harness.firestore.read(harness.paths.scorebook);
        harness.firestore.seed(harness.paths.scorebook, {
          ...root,
          statConfigSnapshot: {
            ...root.statConfigSnapshot,
            privatePlayerStatIds: [],
          },
        });
      },
    ]) {
      const harness = createHarness();
      mutate(harness);
      await assert.rejects(loadSource(harness), {
        code: "failed-precondition",
      });
    }

    const stale = createHarness();
    await assert.rejects(
      stale.handlers.getDiamondRecapSource(
        { ...sourceRequest(stale.identity), sourceRevision: 7 },
        context(),
      ),
      (error) =>
        error.code === "aborted" &&
        error.details.reason === "stale-revision" &&
        error.details.authoritativeRevision === 8,
    );
  });

  it("rejects partial replay and aggregate reads instead of treating emptiness as complete", async () => {
    const replayHarness = createHarness();
    replayHarness.firestore.queryTransform = (query, rows) =>
      query.path === replayHarness.paths.replayPages ? [] : rows;
    await assert.rejects(loadSource(replayHarness), {
      code: "unavailable",
    });

    const statHarness = createHarness();
    statHarness.firestore.queryTransform = (query, rows) =>
      query.path ===
      statHarness.paths.publicPlayerStats(statHarness.identity.instanceId)
        ? []
        : rows;
    await assert.rejects(loadSource(statHarness), {
      code: "unavailable",
    });

    const empty = createHarness({
      documentsOptions: { plays: [], sourceRevision: 8, aggregateCount: 0 },
    });
    const emptyResult = await loadSource(empty);
    assert.deepEqual(emptyResult.packet.plays, []);
    assert.equal(emptyResult.packet.stats.length, 1);
  });

  it("detects a projection race after bounded page and stat loads", async () => {
    const harness = createHarness();
    let changed = false;
    harness.firestore.queryTransform = (query, rows) => {
      if (!changed && query.path === harness.paths.replayPages) {
        changed = true;
        const root = harness.firestore.read(harness.paths.scorebook);
        harness.firestore.seed(harness.paths.scorebook, {
          ...root,
          checkpoint: {
            ...root.checkpoint,
            sequence: 9,
            previousHash: hash({ checkpoint: 9 }),
            state: {
              ...root.checkpoint.state,
              revision: 9,
              checkpointHash: hash({ checkpoint: 9 }),
            },
          },
        });
      }
      return rows;
    };

    await assert.rejects(loadSource(harness), (error) => {
      return (
        error.code === "aborted" && error.details.authoritativeRevision === 9
      );
    });
  });

  it("enforces the non-pitch play and complete packet size bounds", async () => {
    const tooManyPlays = Array.from(
      { length: MAX_RECAP_PLAYS + 1 },
      (_, index) =>
        publicPlay(
          index + 1,
          "record_plate_appearance",
          `Play ${String(index + 1)}`,
        ),
    );
    const overflow = createHarness({
      documentsOptions: { plays: tooManyPlays },
    });
    await assert.rejects(loadSource(overflow), {
      code: "resource-exhausted",
    });

    const largePlays = Array.from({ length: 300 }, (_, index) =>
      publicPlay(
        index + 1,
        "record_plate_appearance",
        `Play ${String(index + 1)} ${"detail ".repeat(55).trim()}`,
      ),
    );
    const oversized = createHarness({
      documentsOptions: { plays: largePlays },
    });
    await assert.rejects(loadSource(oversized), (error) => {
      return (
        error.code === "resource-exhausted" && error.message.includes("80 KiB")
      );
    });
    assert.equal(
      Buffer.byteLength(JSON.stringify(largePlays), "utf8") > MAX_PACKET_BYTES,
      true,
    );
  });

  it("rejects actor/private replay fields and any metric not explicitly public in a public aggregate", async () => {
    const replayHarness = createHarness();
    const pagePath = `${replayHarness.paths.replayPages}/page-000001`;
    const page = replayHarness.firestore.read(pagePath);
    page.items[1].actorUid = "staff-private-id";
    replayHarness.firestore.seed(pagePath, page);
    await assert.rejects(loadSource(replayHarness), (error) =>
      ["failed-precondition", "unavailable"].includes(error.code),
    );

    const statHarness = createHarness();
    const statPath = `${statHarness.paths.publicPlayerStats(statHarness.identity.instanceId)}/player-1`;
    const aggregate = statHarness.firestore.read(statPath);
    aggregate.derivedStats.whip = 1.02;
    aggregate.statCoverage.whip = "complete";
    statHarness.firestore.seed(statPath, aggregate);
    await assert.rejects(
      loadSource(statHarness),
      (error) =>
        error.code === "failed-precondition" &&
        error.details.reason === "non-public-stat-in-public-projection",
    );

    const omittedHarness = createHarness();
    const omittedStatPath = `${omittedHarness.paths.publicPlayerStats(omittedHarness.identity.instanceId)}/player-1`;
    const omittedAggregate = omittedHarness.firestore.read(omittedStatPath);
    omittedAggregate.stats.tb = 4;
    omittedAggregate.statCoverage.tb = "complete";
    omittedHarness.firestore.seed(omittedStatPath, omittedAggregate);
    await assert.rejects(
      loadSource(omittedHarness),
      (error) =>
        error.code === "failed-precondition" &&
        error.details.reason === "non-public-stat-in-public-projection",
    );
  });

  it("publishes a validated draft with private receipt/audit evidence and no public actor data", async () => {
    const harness = createHarness();
    const source = await loadSource(harness);
    const draft = validDraft(source);
    const requestId = uuid(20);

    const result = await harness.handlers.publishDiamondAiDraft(
      {
        requestId,
        ...sourceRequest(harness.identity),
        checkpointHash: source.checkpointHash,
        draft,
      },
      context(),
    );

    assert.deepEqual(result, {
      published: true,
      current: true,
      sourceRevision: 8,
      checkpointHash: source.checkpointHash,
      publicationId: requestId,
      publishedAt: "2026-09-06T00:00:00.000Z",
    });
    const game = harness.firestore.read(harness.paths.game);
    assert.equal(game.aiRecap.publicationId, requestId);
    assert.equal(game.aiRecap.status, "current");
    assert.equal(game.aiRecap.sourceRevision, 8);
    assert.equal(game.aiRecap.published, true);
    assert.equal(JSON.stringify(game.aiRecap).includes("manager-1"), false);
    assert.equal(JSON.stringify(game.aiRecap).includes("requestHash"), false);
    const receipt = harness.firestore.read(
      harness.paths.publicationReceipt(requestId),
    );
    const audit = harness.firestore.read(
      harness.paths.publicationAudit(requestId),
    );
    assert.equal(receipt.actorUid, "manager-1");
    assert.equal(audit.actorUid, "manager-1");
    assert.match(receipt.requestHash, /^sha256:[0-9a-f]{64}$/);
  });

  it("returns exact committed retries and conflicts on changed payload or actor", async () => {
    const harness = createHarness();
    const source = await loadSource(harness);
    const draft = validDraft(source);
    const request = {
      requestId: uuid(21),
      ...sourceRequest(harness.identity),
      checkpointHash: source.checkpointHash,
      draft,
    };
    const first = await harness.handlers.publishDiamondAiDraft(
      request,
      context(),
    );
    const duplicate = await harness.handlers.publishDiamondAiDraft(
      clone(request),
      context(),
    );
    assert.deepEqual(duplicate, first);

    await assert.rejects(
      harness.handlers.publishDiamondAiDraft(
        {
          ...request,
          draft: {
            ...draft,
            recap: { ...draft.recap, text: "Riley reached on a single." },
          },
        },
        context(),
      ),
      { code: "already-exists" },
    );
    await assert.rejects(
      harness.handlers.publishDiamondAiDraft(request, context("manager-2")),
      { code: "already-exists" },
    );
  });

  it("reconciles an ambiguous committed publication without writing a second artifact", async () => {
    const harness = createHarness();
    const source = await loadSource(harness);
    const requestId = uuid(22);
    harness.firestore.failAfterNextTransactionCommit = true;

    const result = await harness.handlers.publishDiamondAiDraft(
      {
        requestId,
        ...sourceRequest(harness.identity),
        checkpointHash: source.checkpointHash,
        draft: validDraft(source),
      },
      context(),
    );

    assert.equal(result.publicationId, requestId);
    assert.equal(
      harness.firestore.read(harness.paths.publicationReceipt(requestId))
        .published,
      true,
    );
  });

  it("aborts publication when the requested hash is stale or the projection races", async () => {
    const staleHash = createHarness();
    const source = await loadSource(staleHash);
    await assert.rejects(
      staleHash.handlers.publishDiamondAiDraft(
        {
          requestId: uuid(23),
          ...sourceRequest(staleHash.identity),
          checkpointHash: hash({ wrong: true }),
          draft: validDraft(source),
        },
        context(),
      ),
      { code: "aborted" },
    );
    assert.equal(
      staleHash.firestore.read(staleHash.paths.publicationReceipt(uuid(23))),
      undefined,
    );

    const race = createHarness();
    const raceSource = await loadSource(race);
    let changed = false;
    race.firestore.queryTransform = (query, rows) => {
      if (
        !changed &&
        query.path === race.paths.publicPlayerStats(race.identity.instanceId)
      ) {
        changed = true;
        race.firestore.seed(race.paths.game, {
          ...race.firestore.read(race.paths.game),
          diamondProjectionHash: hash({ newer: true }),
        });
      }
      return rows;
    };
    await assert.rejects(
      race.handlers.publishDiamondAiDraft(
        {
          requestId: uuid(24),
          ...sourceRequest(race.identity),
          checkpointHash: raceSource.checkpointHash,
          draft: validDraft(raceSource),
        },
        context(),
      ),
      (error) => ["aborted", "failed-precondition"].includes(error.code),
    );
    assert.equal(
      race.firestore.read(race.paths.publicationReceipt(uuid(24))),
      undefined,
    );
  });

  it("revalidates flags, exact coverage, citations, public stats, numeric claims, and sensitive data", async () => {
    const cases = [
      (draft) => ({ ...draft, published: true }),
      (draft) => ({
        ...draft,
        coverage: { ...draft.coverage, sensors: "complete" },
      }),
      (draft) => ({
        ...draft,
        recap: {
          ...draft.recap,
          citations: [{ eventId: "missing-event", revision: 7 }],
        },
      }),
      (draft) => ({
        ...draft,
        insights: [
          {
            ...draft.insights[0],
            statRefs: [{ statId: "game-score", metric: "missingMetric" }],
          },
        ],
      }),
      (draft) => ({
        ...draft,
        recap: { ...draft.recap, text: "Riley drove in 99 runs." },
      }),
      (draft) => ({ ...draft, transcript: "private dictation" }),
      (draft) => ({
        ...draft,
        recap: { ...draft.recap, text: "Transcript: Riley singled." },
      }),
      (draft) => ({
        ...draft,
        dataQualityNotes: ["99 pitches were not collected."],
      }),
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const harness = createHarness();
      const source = await loadSource(harness);
      await assert.rejects(
        harness.handlers.publishDiamondAiDraft(
          {
            requestId: uuid(30 + index),
            ...sourceRequest(harness.identity),
            checkpointHash: source.checkpointHash,
            draft: cases[index](validDraft(source)),
          },
          context(),
        ),
        { code: "invalid-argument" },
      );
    }
  });

  it("writes an artifact the existing correction projector marks stale", async () => {
    const harness = createHarness();
    const source = await loadSource(harness);
    await harness.handlers.publishDiamondAiDraft(
      {
        requestId: uuid(40),
        ...sourceRequest(harness.identity),
        checkpointHash: source.checkpointHash,
        draft: validDraft(source),
      },
      context(),
    );
    const artifact = harness.firestore.read(harness.paths.game).aiRecap;

    let ledger = domainEngine.createDiamondLedger({
      teamId: "team-1",
      gameId: "game-1",
      rulesProfileId: "baseball-youth",
      rulesProfileVersion: 1,
      captureMode: "quick",
    });
    let index = 1;
    const submit = (type, payload) => {
      const execution = domainEngine.executeDiamondCommand(
        ledger,
        {
          schemaVersion: 2,
          commandId: uuid(100 + index),
          teamId: "team-1",
          gameId: "game-1",
          expectedRevision: ledger.state.revision,
          rulesProfileId: "baseball-youth",
          rulesProfileVersion: 1,
          type,
          payload,
        },
        {
          actorUid: "scorer-1",
          eventId: `canonical-${String(index)}`,
          serverTimestampMs: 1_788_600_000_000 + index,
        },
      );
      assert.notEqual(execution.result.outcome, "rejected");
      ledger = execution.ledger;
      index += 1;
      return execution.event;
    };
    submit("activate", {
      initialScorerUid: "scorer-1",
      captureMode: "quick",
    });
    submit("set_lineup", {
      side: "home",
      entries: [
        { slot: 1, playerId: "home-1", displayName: "Home Pitcher" },
        { slot: 2, playerId: "home-2", displayName: "Home Catcher" },
      ],
    });
    submit("set_lineup", {
      side: "away",
      entries: [
        { slot: 1, playerId: "away-1", displayName: "Away Batter" },
        { slot: 2, playerId: "away-2", displayName: "Away Catcher" },
      ],
    });
    submit("set_defensive_alignment", {
      side: "home",
      assignments: [
        { playerId: "home-1", position: "P" },
        { playerId: "home-2", position: "C" },
      ],
    });
    submit("set_defensive_alignment", {
      side: "away",
      assignments: [
        { playerId: "away-1", position: "P" },
        { playerId: "away-2", position: "C" },
      ],
    });
    submit("start", {});
    submit("record_pitch", {
      batterId: "away-1",
      pitcherId: "home-1",
      result: "in_play",
    });
    const target = submit("record_plate_appearance", {
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
    submit("void_event", {
      targetEventId: target.eventId,
      reason: "Remove mistaken note",
    });

    const staleness = projectionAdapter.markDiamondAiArtifactsStale({
      ledger,
      artifacts: { aiRecap: artifact },
    });
    assert.equal(staleness.required, true);
    assert.equal(staleness.artifactPatches.aiRecap.status, "stale");
    assert.equal(artifact.sourceRevision, 8);
  });
});
