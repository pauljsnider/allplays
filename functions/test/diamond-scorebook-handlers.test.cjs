"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  COMMAND_HISTORY_CONTROL_QUARANTINE_MS,
  COMMAND_HISTORY_RATE_WINDOW_MS,
  COMMAND_HISTORY_SUSTAINED_WINDOW_MS,
  DIAMOND_ENGINE,
  LEGACY_TRACKING_COLLECTIONS,
  MANAGER_STAT_ADMISSION_DEDUPE_MS,
  MANAGER_STAT_CONTROL_COLLECTION,
  MANAGER_STAT_RATE_WINDOW_MS,
  MANAGER_STAT_RECEIPT_RETENTION_MS,
  MANAGER_STAT_REQUEST_LEASE_MS,
  MANAGER_STAT_SUSTAINED_WINDOW_MS,
  MAX_CONCURRENT_MANAGER_STAT_REQUESTS,
  MAX_COMMAND_HISTORY_READ_UNITS_PER_WINDOW,
  MAX_COMMAND_HISTORY_REQUESTS_PER_WINDOW,
  MAX_COMMAND_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW,
  MAX_COMMAND_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_MANAGER_STAT_ADMISSIONS_PER_WINDOW,
  MAX_MANAGER_STAT_GLOBAL_READ_UNITS_PER_WINDOW,
  MAX_MANAGER_STAT_READ_UNITS_PER_WINDOW,
  MAX_MANAGER_STAT_REQUESTS_PER_WINDOW,
  MAX_MANAGER_STAT_SUSTAINED_ADMISSIONS_PER_WINDOW,
  MAX_MANAGER_STAT_SUSTAINED_GLOBAL_READ_UNITS_PER_WINDOW,
  MAX_MANAGER_STAT_SUSTAINED_READ_UNITS_PER_WINDOW,
  MAX_MANAGER_STAT_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_MANAGER_STAT_SUSTAINED_VERIFICATION_UNITS_PER_WINDOW,
  MAX_MANAGER_STAT_VERIFICATION_UNITS_PER_WINDOW,
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
    const updatedAtMs = reference.database.documentUpdateTimes.get(
      reference.path,
    );
    if (Number.isSafeInteger(updatedAtMs)) {
      this.updateTime = { toMillis: () => updatedAtMs };
    }
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
    const snapshot = this.database._querySnapshot(this);
    if (typeof this.database.queryAsyncHook === "function") {
      return Promise.resolve(this.database.queryAsyncHook(this, snapshot)).then(
        () => snapshot,
      );
    }
    return Promise.resolve(snapshot);
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
    this.database.transactionBulkGetCounts.push(references.length);
    this.readPaths.push(...references.map(({ path }) => path));
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
    // Stored values are never exposed without cloning, so a shallow map copy
    // preserves atomic commit behavior without repeatedly cloning thousands of
    // seeded stat projections in fan-out quota tests.
    const next = new Map(this.database.documents);
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
    for (const operation of this.operations) {
      this.database.documentUpdateTimes.set(
        operation.reference.path,
        this.database.commitTimestampMs,
      );
    }
    this.database.transactionCommits.push(
      this.operations.map((operation) => ({
        kind: operation.kind,
        path: operation.reference.path,
        value: clone(operation.value),
      })),
    );
  }
}

class FakeFirestore {
  constructor(seed = {}) {
    this.documents = new Map(
      Object.entries(seed).map(([path, value]) => [path, clone(value)]),
    );
    this.transactionQueue = Promise.resolve();
    this.queryHook = null;
    this.queryAsyncHook = null;
    this.bulkGetHook = null;
    this.bulkGetCalls = 0;
    this.transactionReadBatches = [];
    this.transactionBulkGetCounts = [];
    this.transactionCommits = [];
    this.transactionOptions = [];
    this.transactionHook = null;
    this.documentUpdateTimes = new Map();
    this.commitTimestampMs = 1_750_000_000_000;
    this.queryReads = [];
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
      const override = await this.bulkGetHook(references, snapshots);
      if (override !== undefined) return override;
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
    this.queryReads.push({
      path: query.path,
      filters: clone(query.filters),
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

  runTransaction(callback, transactionOptions) {
    this.transactionOptions.push(clone(transactionOptions));
    const run = async () => {
      let attempt = 0;
      const maximumAttempts = Number.isSafeInteger(
        transactionOptions?.maxAttempts,
      )
        ? transactionOptions.maxAttempts
        : Number.POSITIVE_INFINITY;
      for (;;) {
        attempt += 1;
        await this.transactionHook?.("before");
        const transaction = new FakeTransaction(this);
        const result = await callback(transaction);
        const directive = await this.transactionHook?.(
          "beforeCommit",
          transaction,
          result,
        );
        if (directive === "retry") {
          if (attempt >= maximumAttempts) {
            throw Object.assign(
              new Error("transaction attempt limit reached"),
              {
                code: "aborted",
              },
            );
          }
          continue;
        }
        if (directive === "retry-after-commit") {
          transaction.commit();
          await this.transactionHook?.(
            "afterRetryableCommit",
            transaction,
            result,
          );
          if (attempt >= maximumAttempts) {
            throw Object.assign(new Error("transaction commit was ambiguous"), {
              code: "unavailable",
            });
          }
          continue;
        }
        if (directive === "force-retry-after-commit") {
          transaction.commit();
          await this.transactionHook?.(
            "afterRetryableCommit",
            transaction,
            result,
          );
          continue;
        }
        transaction.commit();
        await this.transactionHook?.("after", transaction, result);
        return result;
      }
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

  setDocumentUpdateTime(path, milliseconds) {
    this.documentUpdateTimes.set(path, milliseconds);
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
const PROJECTION_REGENERATION_COOLDOWN_MS = 5 * 60 * 1000;
const PROJECTION_REGENERATION_RESERVATION_MS = 10 * 60 * 1000;

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
  const authGetUserCalls = [];
  const authGetUsersCalls = [];
  const auth = {
    async getUser(uid) {
      authGetUserCalls.push(uid);
      await overrides.getUserHook?.({
        uid,
        callCount: authGetUserCalls.length,
        authUsers,
        firestore,
      });
      if (!authUsers.has(uid))
        throw Object.assign(new Error("missing"), {
          code: "auth/user-not-found",
        });
      return clone(authUsers.get(uid));
    },
    async getUsers(identifiers) {
      const requested = clone(identifiers);
      authGetUsersCalls.push(requested);
      const users = [];
      const notFound = [];
      for (const identifier of identifiers) {
        if (authUsers.has(identifier.uid)) {
          users.push(clone(authUsers.get(identifier.uid)));
        } else {
          notFound.push({ uid: identifier.uid });
        }
      }
      const result = { users, notFound };
      return (
        (await overrides.getUsersHook?.({
          identifiers: requested,
          result: clone(result),
          authUsers,
          firestore,
        })) ?? result
      );
    },
  };
  let randomIndex = 100;
  const handlers = createDiamondScorebookHandlers({
    firestore,
    auth,
    HttpsError: TestHttpsError,
    clock: overrides.clock || (() => 1_750_000_000_000),
    random: overrides.random || (() => makeUuid(randomIndex++)),
    logger: { info() {}, warn() {}, error() {} },
    resolveDelegatedAccess({ uid, user, team, game, rsvp }) {
      if (overrides.viewerAccessByUid?.[uid]) {
        return clone(overrides.viewerAccessByUid[uid]);
      }
      const full = user?.isAdmin === true || team?.ownerId === uid;
      const selectedScorers =
        team?.teamPermissions?.scorekeeping?.mode === "selected"
          ? team.teamPermissions.scorekeeping.memberIds || []
          : [];
      const scorekeeping =
        full ||
        selectedScorers.includes(uid) ||
        (team?.teamPermissions?.scorekeeping?.mode === "all_confirmed" &&
          ![
            "cancelled",
            "canceled",
            "completed",
            "finished",
            "final",
            "deleted",
          ].includes(String(game?.status || "scheduled").toLowerCase()) &&
          ["going", "yes", "confirmed", "attending"].includes(
            String(rsvp?.response || rsvp?.status || "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase(),
          )) ||
        (Array.isArray(team?.scorekeeperIds) &&
          team.scorekeeperIds.includes(uid));
      return {
        full,
        scorekeeping,
        parent: false,
        videography: false,
        streaming: false,
        media: false,
      };
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
    authGetUserCalls,
    authGetUsersCalls,
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

async function regenerate(
  harness,
  {
    requestId,
    expectedRevision = null,
    context = harness.managerContext,
  },
) {
  return harness.handlers.regenerateDiamondProjection(
    {
      requestId,
      teamId: "team-1",
      gameId: "game-1",
      expectedRevision,
    },
    context,
  );
}

async function listScorerCandidates(
  harness,
  {
    context = harness.managerContext,
    expectedInstanceId = null,
    expectedRevision = null,
    leaseId = null,
  } = {},
) {
  const root = harness.firestore.read(paths("team-1", "game-1").scorebook);
  return harness.handlers.listDiamondScorerCandidates(
    {
      teamId: "team-1",
      gameId: "game-1",
      expectedInstanceId: expectedInstanceId ?? root?.instanceId,
      expectedRevision: expectedRevision ?? root?.checkpoint?.sequence,
      leaseId: leaseId ?? root?.scorerLease?.leaseId,
    },
    context,
  );
}

function directCollectionDocuments(firestore, collectionPath) {
  const prefix = `${collectionPath}/`;
  return [...firestore.documents.entries()]
    .filter(
      ([path]) =>
        path.startsWith(prefix) && !path.slice(prefix.length).includes("/"),
    )
    .map(([path, value]) => ({ path, value: clone(value) }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function regenerationAuditDocuments(harness, type = null) {
  const collectionPath = `${paths("team-1", "game-1").scorebook}/audit`;
  return directCollectionDocuments(harness.firestore, collectionPath).filter(
    ({ value }) => !type || value?.type === type,
  );
}

function regenerationControl(harness, type) {
  const matches = regenerationAuditDocuments(harness, type);
  assert.equal(matches.length, 1, `expected one ${type} document`);
  return matches[0];
}

function managerStatReadControls(harness, type = null) {
  return directCollectionDocuments(
    harness.firestore,
    MANAGER_STAT_CONTROL_COLLECTION,
  ).filter(({ value }) => !type || value?.type === type);
}

function managerStatReadControl(harness, type) {
  const controls = managerStatReadControls(harness, type);
  assert.equal(controls.length, 1, `expected one ${type} control`);
  return controls[0];
}

function commandHistoryAdmission(harness) {
  return managerStatReadControl(harness, "diamond-command-history-admission");
}

function transactionControlWrite(transaction, type, status = undefined) {
  return transaction?.operations?.find(
    ({ value }) =>
      value?.type === type &&
      (status === undefined || value?.status === status),
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
    teamId = "team-1",
    gameId = "game-1",
    playerId = "home-1",
    revision = 7,
    instanceId = makeUuid(700),
    projectionHash = TEST_PROJECTION_HASH,
  } = {},
) {
  const gamePath = paths(teamId, gameId).game;
  const existingGame = harness.firestore.read(gamePath) || {
    id: gameId,
    teamId,
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
    `${paths(teamId, gameId).diamondStatGeneration(instanceId)}/privatePlayerStats/${playerId}`,
    {
      trackingEngine: DIAMOND_ENGINE,
      teamId,
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
    `${paths(teamId, gameId).diamondStatGeneration(instanceId)}/teamStats/team`,
    {
      trackingEngine: DIAMOND_ENGINE,
      teamId,
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

function seedManagerStatRequest(
  harness,
  { gameCount, playerCount, gamePrefix = "game", teamId = "team-1" },
) {
  const playerIds = Array.from(
    { length: playerCount },
    (_, index) => `player-${String(index + 1).padStart(2, "0")}`,
  );
  const gameHeads = [];
  for (let gameIndex = 0; gameIndex < gameCount; gameIndex += 1) {
    const gameId = `${gamePrefix}-${String(gameIndex + 1).padStart(3, "0")}`;
    let head;
    for (let playerIndex = 0; playerIndex < playerIds.length; playerIndex += 1) {
      head = seedManagerStatProjection(harness, {
        teamId,
        gameId,
        playerId: playerIds[playerIndex],
        revision: gameIndex + 1,
        instanceId: makeUuid(10_000 + gameIndex),
      });
    }
    gameHeads.push(head);
  }
  return { gameHeads, playerIds };
}

async function runManagerStatChunks(harness, gameHeads, playerIds) {
  const results = [];
  for (let gameOffset = 0; gameOffset < gameHeads.length; gameOffset += 40) {
    for (let playerOffset = 0; playerOffset < playerIds.length; playerOffset += 25) {
      results.push(
        await harness.handlers.getDiamondManagerStats(
          {
            teamId: "team-1",
            gameHeads: gameHeads.slice(gameOffset, gameOffset + 40),
            playerIds: playerIds.slice(playerOffset, playerOffset + 25),
          },
          harness.managerContext,
        ),
      );
    }
  }
  return results;
}

async function runTeamInsightsManagerStatsTopology(
  harness,
  seasonGameHeadGroups,
  allGameHeads,
  playerIds,
) {
  const seasonResults = [];
  const seasonReads = (async () => {
    for (let offset = 0; offset < seasonGameHeadGroups.length; offset += 2) {
      const batchResults = await Promise.all(
        seasonGameHeadGroups
          .slice(offset, offset + 2)
          .map((gameHeads) =>
            runManagerStatChunks(harness, gameHeads, playerIds),
          ),
      );
      seasonResults.push(...batchResults.flat());
    }
  })();
  const aggregateResults = runManagerStatChunks(
    harness,
    allGameHeads,
    playerIds,
  );
  const [, resolvedAggregateResults] = await Promise.all([
    seasonReads,
    aggregateResults,
  ]);
  return {
    seasonResults,
    aggregateResults: resolvedAggregateResults,
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
    assert.equal(harness.firestore.transactionBulkGetCalls, 4);
    assert.deepEqual(harness.firestore.transactionBulkGetCounts, [2, 2, 2, 2]);
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
    assert.equal(Object.hasOwn(result, "requestId"), false);
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
    assert.deepEqual(
      harness.firestore.transactionBulkGetCounts,
      [2, 40, 2, 40],
    );
    assert.equal(result.documentCount, 1_000);
    assert.equal(result.teamDocumentCount, 40);
    assert.equal(result.missingDocumentCount, 0);
    assert.ok(result.responseByteCount < result.responseByteLimit);
    assert.ok(
      result.documents.every(({ data }) => data.statSources === undefined),
    );
  });

  it("keeps the deployed manager-stat request and response contract exact", async () => {
    let randomCalls = 0;
    const harness = createHarness({
      random() {
        randomCalls += 1;
        return makeUuid(90_000 + randomCalls);
      },
    });
    const head = seedManagerStatProjection(harness);
    const request = {
      teamId: "team-1",
      gameHeads: [head],
      playerIds: ["home-1"],
    };

    const response = await harness.handlers.getDiamondManagerStats(
      request,
      harness.managerContext,
    );
    assert.equal(response.status, "complete");
    assert.equal(Object.hasOwn(response, "requestId"), false);
    assert.equal(randomCalls, 1);

    const readsBeforeInvalidRequest = harness.firestore.transactionReadBatches.length;
    await assert.rejects(
      harness.handlers.getDiamondManagerStats(
        { ...request, requestId: makeUuid(90_100) },
        harness.managerContext,
      ),
      (error) => error.code === "invalid-argument",
    );
    assert.equal(randomCalls, 1);
    assert.equal(
      harness.firestore.transactionReadBatches.length,
      readsBeforeInvalidRequest,
    );
    assert.equal(harness.firestore.bulkGetCalls, 1);
  });

  it("charges sequential completed rereads as new bounded server attempts", async () => {
    const harness = createHarness();
    const head = seedManagerStatProjection(harness);
    const request = {
      teamId: "team-1",
      gameHeads: [head],
      playerIds: ["home-1"],
    };

    const first = await harness.handlers.getDiamondManagerStats(
      request,
      harness.managerContext,
    );
    const second = await harness.handlers.getDiamondManagerStats(
      request,
      harness.managerContext,
    );

    assert.equal(first.status, "complete");
    assert.equal(second.status, "complete");
    assert.equal(harness.firestore.bulkGetCalls, 2);
    const admission = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    assert.equal(admission.requestCount, 2);
    assert.equal(admission.verificationUnits, 6);
    assert.equal(admission.recentAttempts.length, 2);
    const scope = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-scope",
    ).value;
    assert.equal(scope.requestCount, 2);
    assert.equal(scope.readUnits, 4);
    assert.deepEqual(scope.activeAttempts, []);
    assert.equal(scope.recentTerminals.length, 2);
    assert.ok(
      scope.recentTerminals.every(({ status }) => status === "complete"),
    );
    assert.equal(managerStatReadControls(harness).length, 2);
  });

  it("admits the real three-way overlapping Team Insights fan-out", async () => {
    const harness = createHarness();
    const { gameHeads, playerIds } = seedManagerStatRequest(harness, {
      gameCount: 120,
      playerCount: 25,
      gamePrefix: "insights",
    });
    let inFlight = 0;
    let maxInFlight = 0;
    const firstWaveSignatures = [];
    let releaseFirstWave;
    const firstWave = new Promise((resolve) => {
      releaseFirstWave = resolve;
    });
    harness.firestore.bulkGetHook = async (references) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (firstWaveSignatures.length < 3) {
        firstWaveSignatures.push(
          references.map(({ path }) => path).join("\n"),
        );
        if (firstWaveSignatures.length === 3) releaseFirstWave();
        await firstWave;
      }
      inFlight -= 1;
    };

    const result = await runTeamInsightsManagerStatsTopology(
      harness,
      [
        gameHeads.slice(0, 40),
        gameHeads.slice(40, 80),
        gameHeads.slice(80, 120),
      ],
      gameHeads,
      playerIds,
    );

    assert.equal(maxInFlight, 3);
    assert.equal(new Set(firstWaveSignatures).size, 2);
    assert.equal(result.seasonResults.length, 3);
    assert.equal(result.aggregateResults.length, 3);
    assert.ok(
      [...result.seasonResults, ...result.aggregateResults].every(
        ({ status, complete }) => status === "complete" && complete === true,
      ),
    );
    assert.equal(harness.firestore.bulkGetCalls, 6);
    const scope = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-scope",
    ).value;
    assert.equal(scope.requestCount, 6);
    assert.equal(scope.readUnits, 6_240);
    assert.deepEqual(scope.activeAttempts, []);
    const admission = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    assert.equal(admission.requestCount, 6);
    assert.equal(admission.verificationUnits, 252);
  });

  it("admits a 120-label Team Insights load plus its one bounded recovery", async () => {
    const harness = createHarness();
    const { gameHeads, playerIds } = seedManagerStatRequest(harness, {
      gameCount: 120,
      playerCount: 100,
      gamePrefix: "fragmented",
    });
    const seasonGroups = gameHeads.map((head) => [head]);

    const first = await runTeamInsightsManagerStatsTopology(
      harness,
      seasonGroups,
      gameHeads,
      playerIds,
    );
    const recovery = await runTeamInsightsManagerStatsTopology(
      harness,
      seasonGroups,
      gameHeads,
      playerIds,
    );

    assert.equal(first.seasonResults.length, 480);
    assert.equal(first.aggregateResults.length, 12);
    assert.equal(recovery.seasonResults.length, 480);
    assert.equal(recovery.aggregateResults.length, 12);
    assert.ok(
      [
        ...first.seasonResults,
        ...first.aggregateResults,
        ...recovery.seasonResults,
        ...recovery.aggregateResults,
      ].every(({ status }) => status === "complete"),
    );
    assert.equal(harness.firestore.bulkGetCalls, 984);
    const scope = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-scope",
    ).value;
    assert.equal(scope.requestCount, 984);
    assert.equal(scope.readUnits, 49_920);
    assert.equal(scope.sustainedRequestCount, 984);
    assert.equal(scope.sustainedReadUnits, 49_920);
    const admission = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    assert.equal(admission.requestCount, 984);
    assert.equal(admission.verificationUnits, 3_888);
    assert.equal(admission.readUnits, 49_920);
    assert.equal(admission.sustainedRequestCount, 984);
    assert.equal(admission.sustainedVerificationUnits, 3_888);
    assert.equal(admission.sustainedReadUnits, 49_920);
    assert.ok(admission.requestCount < MAX_MANAGER_STAT_ADMISSIONS_PER_WINDOW);
    assert.ok(
      admission.verificationUnits <
        MAX_MANAGER_STAT_VERIFICATION_UNITS_PER_WINDOW,
    );

    const maxRequest = {
      teamId: "team-1",
      gameHeads: gameHeads.slice(0, 40),
      playerIds: playerIds.slice(0, 25),
    };
    for (let index = 0; index < 4; index += 1) {
      const result = await harness.handlers.getDiamondManagerStats(
        maxRequest,
        harness.managerContext,
      );
      assert.equal(result.status, "complete");
    }

    const transactionalReadsBeforeAdmissionRejection =
      harness.firestore.transactionBulkGetCounts.length;
    let rejectedResponse = null;
    await assert.rejects(
      async () => {
        rejectedResponse = await harness.handlers.getDiamondManagerStats(
          maxRequest,
          harness.managerContext,
        );
      },
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "manager-stat-admission-limited",
    );
    assert.equal(rejectedResponse, null);
    assert.equal(harness.firestore.bulkGetCalls, 988);
    assert.equal(
      harness.firestore.transactionBulkGetCounts.length,
      transactionalReadsBeforeAdmissionRejection,
    );
    assert.equal(
      harness.firestore.transactionCommits.filter((commit) =>
        commit.some(
          ({ value }) =>
            value?.type === "diamond-manager-stat-read-admission",
        ),
      ).length,
      988,
    );
    assert.equal(
      harness.firestore.transactionCommits.filter((commit) =>
        commit.some(
          ({ value }) => value?.type === "diamond-manager-stat-read-scope",
        ),
      ).length,
      1_976,
    );
  });

  it("blocks a fourth simultaneous bulk read before it starts", async () => {
    const harness = createHarness();
    const { gameHeads, playerIds } = seedManagerStatRequest(harness, {
      gameCount: 4,
      playerCount: 1,
      gamePrefix: "parallel",
    });
    let releaseBulks;
    const heldBulks = new Promise((resolve) => {
      releaseBulks = resolve;
    });
    let startedBulks = 0;
    harness.firestore.bulkGetHook = async () => {
      startedBulks += 1;
      await heldBulks;
    };
    const calls = gameHeads.map((head) =>
      harness.handlers.getDiamondManagerStats(
        { teamId: "team-1", gameHeads: [head], playerIds },
        harness.managerContext,
      ),
    );

    await assert.rejects(
      calls[3],
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "manager-stat-concurrency-limited",
    );
    assert.equal(startedBulks, MAX_CONCURRENT_MANAGER_STAT_REQUESTS);
    assert.equal(harness.firestore.bulkGetCalls, 3);
    releaseBulks();
    const completed = await Promise.all(calls.slice(0, 3));
    assert.ok(completed.every(({ status }) => status === "complete"));
    const scope = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-scope",
    ).value;
    assert.equal(scope.requestCount, 3);
    assert.equal(scope.readUnits, 6);
    assert.deepEqual(scope.activeAttempts, []);
  });

  it("enforces the weighted team ceiling before another maximum bulk read", async () => {
    const initialNowMs = 1_750_000_000_000;
    let nowMs = initialNowMs;
    const harness = createHarness({ clock: () => nowMs });
    harness.firestore.seed("teams/team-2", {
      ownerId: "manager-1",
      sport: "Baseball",
      active: true,
    });
    const otherHead = seedManagerStatProjection(harness, {
      teamId: "team-2",
      gameId: "offset-game",
      playerId: "offset-player",
      instanceId: makeUuid(20_000),
    });
    await harness.handlers.getDiamondManagerStats(
      {
        teamId: "team-2",
        gameHeads: [otherHead],
        playerIds: ["offset-player"],
      },
      harness.managerContext,
    );

    const { gameHeads, playerIds } = seedManagerStatRequest(harness, {
      gameCount: 40,
      playerCount: 25,
      gamePrefix: "weighted",
    });
    const request = { teamId: "team-1", gameHeads, playerIds };

    nowMs = initialNowMs + MANAGER_STAT_RATE_WINDOW_MS - 1;
    harness.firestore.commitTimestampMs = nowMs;
    await harness.handlers.getDiamondManagerStats(
      request,
      harness.managerContext,
    );
    nowMs += 2;
    harness.firestore.commitTimestampMs = nowMs;
    for (let attempt = 1; attempt < 63; attempt += 1) {
      const result = await harness.handlers.getDiamondManagerStats(
        request,
        harness.managerContext,
      );
      assert.equal(result.status, "complete");
    }
    assert.equal(harness.firestore.bulkGetCalls, 64);
    const scope = managerStatReadControls(
      harness,
      "diamond-manager-stat-read-scope",
    ).find(({ value }) => value.readUnits === 65_520)?.value;
    assert.ok(scope);
    assert.equal(scope.requestCount, 63);
    assert.equal(scope.readUnits, 65_520);
    assert.ok(scope.requestCount < MAX_MANAGER_STAT_REQUESTS_PER_WINDOW);

    const transactionalReadsBeforeRejection =
      harness.firestore.transactionBulkGetCounts.length;
    await assert.rejects(
      harness.handlers.getDiamondManagerStats(
        request,
        harness.managerContext,
      ),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "manager-stat-rate-limited" &&
        error.details?.retryable === true &&
        error.details?.retryAfterMs === MANAGER_STAT_RATE_WINDOW_MS - 2,
    );
    assert.equal(harness.firestore.bulkGetCalls, 64);
    assert.deepEqual(
      harness.firestore.transactionBulkGetCounts.slice(
        transactionalReadsBeforeRejection,
      ),
      [2],
    );
    const admission = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    assert.equal(admission.requestCount, 63);
    assert.equal(admission.readUnits, 65_520);
    assert.equal(scope.sustainedRequestCount, 63);
    assert.equal(scope.sustainedReadUnits, 65_520);
  });

  it("enforces the UID-global private-read ceiling across authorized teams", async () => {
    const harness = createHarness();
    harness.firestore.seed("teams/team-2", {
      ownerId: "manager-1",
      sport: "Baseball",
      active: true,
    });
    const teamOne = seedManagerStatRequest(harness, {
      gameCount: 40,
      playerCount: 25,
      gamePrefix: "global-one",
      teamId: "team-1",
    });
    const teamTwo = seedManagerStatRequest(harness, {
      gameCount: 40,
      playerCount: 25,
      gamePrefix: "global-two",
      teamId: "team-2",
    });
    const requests = [
      { teamId: "team-1", ...teamOne },
      { teamId: "team-2", ...teamTwo },
    ];

    for (let attempt = 0; attempt < 63; attempt += 1) {
      const result = await harness.handlers.getDiamondManagerStats(
        requests[attempt % requests.length],
        harness.managerContext,
      );
      assert.equal(result.status, "complete");
    }
    const scopes = managerStatReadControls(
      harness,
      "diamond-manager-stat-read-scope",
    ).map(({ value }) => value);
    assert.equal(scopes.length, 2);
    assert.ok(scopes.every(({ readUnits }) => readUnits < 34_000));
    const admission = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    assert.equal(admission.requestCount, 63);
    assert.equal(admission.readUnits, 65_520);
    assert.ok(
      admission.readUnits <= MAX_MANAGER_STAT_GLOBAL_READ_UNITS_PER_WINDOW,
    );

    const accessReadsBeforeRejection =
      harness.firestore.transactionBulkGetCounts.length;
    await assert.rejects(
      harness.handlers.getDiamondManagerStats(
        requests[1],
        harness.managerContext,
      ),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "manager-stat-admission-limited",
    );
    assert.equal(harness.firestore.bulkGetCalls, 63);
    assert.equal(
      harness.firestore.transactionBulkGetCounts.length,
      accessReadsBeforeRejection,
    );
  });

  it("bounds two burst windows inside the sustained UID and team envelope", async () => {
    const initialNowMs = 1_750_000_000_000;
    let nowMs = initialNowMs;
    const harness = createHarness({ clock: () => nowMs });
    const { gameHeads, playerIds } = seedManagerStatRequest(harness, {
      gameCount: 40,
      playerCount: 25,
      gamePrefix: "sustained",
    });
    const request = { teamId: "team-1", gameHeads, playerIds };

    for (let burst = 0; burst < 2; burst += 1) {
      if (burst > 0) {
        nowMs += MANAGER_STAT_RATE_WINDOW_MS;
        harness.firestore.commitTimestampMs = nowMs;
      }
      for (let attempt = 0; attempt < 63; attempt += 1) {
        const result = await harness.handlers.getDiamondManagerStats(
          request,
          harness.managerContext,
        );
        assert.equal(result.status, "complete");
      }
    }
    const admissionBeforeLimit = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    const scopeBeforeLimit = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-scope",
    ).value;
    assert.equal(admissionBeforeLimit.sustainedRequestCount, 126);
    assert.equal(admissionBeforeLimit.sustainedVerificationUnits, 5_292);
    assert.equal(admissionBeforeLimit.sustainedReadUnits, 131_040);
    assert.equal(scopeBeforeLimit.sustainedRequestCount, 126);
    assert.equal(scopeBeforeLimit.sustainedReadUnits, 131_040);
    assert.ok(
      admissionBeforeLimit.sustainedReadUnits <=
        MAX_MANAGER_STAT_SUSTAINED_GLOBAL_READ_UNITS_PER_WINDOW,
    );
    assert.ok(
      scopeBeforeLimit.sustainedReadUnits <=
        MAX_MANAGER_STAT_SUSTAINED_READ_UNITS_PER_WINDOW,
    );

    nowMs += MANAGER_STAT_RATE_WINDOW_MS;
    harness.firestore.commitTimestampMs = nowMs;
    const readsBeforeSustainedRejection =
      harness.firestore.transactionBulkGetCounts.length;
    await assert.rejects(
      harness.handlers.getDiamondManagerStats(
        request,
        harness.managerContext,
      ),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "manager-stat-admission-limited" &&
        error.details?.retryAfterMs ===
          MANAGER_STAT_SUSTAINED_WINDOW_MS -
            2 * MANAGER_STAT_RATE_WINDOW_MS,
    );
    assert.equal(harness.firestore.bulkGetCalls, 126);
    assert.equal(
      harness.firestore.transactionBulkGetCounts.length,
      readsBeforeSustainedRejection,
    );

    nowMs = initialNowMs + MANAGER_STAT_SUSTAINED_WINDOW_MS;
    harness.firestore.commitTimestampMs = nowMs;
    const afterSustainedReset = await harness.handlers.getDiamondManagerStats(
      request,
      harness.managerContext,
    );
    assert.equal(afterSustainedReset.status, "complete");
    const admissionAfterReset = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    const scopeAfterReset = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-scope",
    ).value;
    assert.equal(admissionAfterReset.requestCount, 1);
    assert.equal(admissionAfterReset.readUnits, 1_040);
    assert.equal(admissionAfterReset.sustainedRequestCount, 1);
    assert.equal(admissionAfterReset.sustainedReadUnits, 1_040);
    assert.equal(scopeAfterReset.requestCount, 1);
    assert.equal(scopeAfterReset.readUnits, 1_040);
    assert.equal(scopeAfterReset.sustainedRequestCount, 1);
    assert.equal(scopeAfterReset.sustainedReadUnits, 1_040);
  });

  it("bounds concurrent rotated-team max-head denials before any head or private read", async () => {
    const harness = createHarness();
    const { gameHeads, playerIds } = seedManagerStatRequest(harness, {
      gameCount: 40,
      playerCount: 25,
      gamePrefix: "denied",
    });
    const attempts = Array.from({ length: 64 }, (_, index) =>
      harness.handlers.getDiamondManagerStats(
        {
          teamId: `missing-team-${String(index + 1)}`,
          gameHeads,
          playerIds,
        },
        harness.managerContext,
      ),
    );
    const results = await Promise.allSettled(attempts);
    const admissionLimited = results.filter(
      (result) =>
        result.status === "rejected" &&
        result.reason?.details?.reason === "manager-stat-admission-limited",
    );
    const missingTeams = results.filter(
      (result) =>
        result.status === "rejected" && result.reason?.code === "not-found",
    );

    assert.equal(admissionLimited.length, 1);
    assert.equal(missingTeams.length, 63);
    assert.equal(harness.firestore.bulkGetCalls, 0);
    assert.deepEqual(
      harness.firestore.transactionBulkGetCounts,
      Array.from({ length: 63 }, () => 2),
    );
    const admission = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    assert.equal(admission.requestCount, 63);
    assert.equal(admission.verificationUnits, 2_646);
    assert.equal(admission.readUnits, 65_520);
    assert.ok(
      admission.verificationUnits <=
        MAX_MANAGER_STAT_VERIFICATION_UNITS_PER_WINDOW,
    );
    const serializedControls = JSON.stringify(managerStatReadControls(harness));
    assert.equal(serializedControls.includes("manager-1"), false);
    assert.equal(serializedControls.includes("missing-team"), false);
    assert.equal(serializedControls.includes("denied-"), false);
  });

  it("bounds serial rotated-team small-head denials by UID admission count", async () => {
    const harness = createHarness();
    const head = seedManagerStatProjection(harness);

    for (
      let attempt = 0;
      attempt < MAX_MANAGER_STAT_ADMISSIONS_PER_WINDOW;
      attempt += 1
    ) {
      await assert.rejects(
        harness.handlers.getDiamondManagerStats(
          {
            teamId: `rotated-team-${String(attempt + 1)}`,
            gameHeads: [head],
            playerIds: ["home-1"],
          },
          harness.managerContext,
        ),
        (error) => error.code === "not-found",
      );
    }
    const teamChecksBeforeLimit = harness.firestore.transactionBulkGetCounts.length;
    await assert.rejects(
      harness.handlers.getDiamondManagerStats(
        {
          teamId: "rotated-team-over-limit",
          gameHeads: [head],
          playerIds: ["home-1"],
        },
        harness.managerContext,
      ),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "manager-stat-admission-limited",
    );
    assert.equal(
      harness.firestore.transactionBulkGetCounts.length,
      teamChecksBeforeLimit,
    );
    assert.equal(teamChecksBeforeLimit, MAX_MANAGER_STAT_ADMISSIONS_PER_WINDOW);
    assert.equal(harness.firestore.bulkGetCalls, 0);
    const admission = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    assert.equal(
      admission.requestCount,
      MAX_MANAGER_STAT_ADMISSIONS_PER_WINDOW,
    );
    assert.equal(
      admission.verificationUnits,
      MAX_MANAGER_STAT_ADMISSIONS_PER_WINDOW * 3,
    );
  });

  it("reconciles one admission charge across a rate-window response loss", async () => {
    const initialNowMs = 1_750_000_000_000;
    let nowMs = initialNowMs;
    const harness = createHarness({ clock: () => nowMs });
    const head = seedManagerStatProjection(harness);
    let droppedAdmissionResponse = false;
    harness.firestore.transactionHook = async (stage, transaction) => {
      const admissionWrite = transactionControlWrite(
        transaction,
        "diamond-manager-stat-read-admission",
      );
      if (stage === "after" && admissionWrite && !droppedAdmissionResponse) {
        droppedAdmissionResponse = true;
        nowMs += MANAGER_STAT_RATE_WINDOW_MS + 1;
        harness.firestore.commitTimestampMs = nowMs;
        throw new Error("ambiguous admission commit");
      }
    };

    const result = await harness.handlers.getDiamondManagerStats(
      {
        teamId: "team-1",
        gameHeads: [head],
        playerIds: ["home-1"],
      },
      harness.managerContext,
    );

    assert.equal(result.status, "complete");
    assert.equal(harness.firestore.bulkGetCalls, 1);
    const admission = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    assert.equal(admission.windowStartedAtMs, initialNowMs);
    assert.equal(
      admission.windowResetAtMs,
      initialNowMs + MANAGER_STAT_RATE_WINDOW_MS,
    );
    assert.equal(admission.requestCount, 1);
    assert.equal(admission.verificationUnits, 3);
    assert.equal(admission.recentAttempts.length, 1);
    assert.equal(
      harness.firestore.transactionCommits.filter((commit) =>
        commit.some(
          ({ value }) =>
            value?.type === "diamond-manager-stat-read-admission",
        ),
      ).length,
      1,
    );
  });

  it("reconciles a live ambiguous reservation without a second charge or bulk", async () => {
    const harness = createHarness();
    const head = seedManagerStatProjection(harness);
    let droppedReservationResponse = false;
    harness.firestore.transactionHook = async (stage, transaction) => {
      const scopeWrite = transactionControlWrite(
        transaction,
        "diamond-manager-stat-read-scope",
      );
      if (
        stage === "after" &&
        scopeWrite?.value?.activeAttempts?.length === 1 &&
        !droppedReservationResponse
      ) {
        droppedReservationResponse = true;
        throw new Error("ambiguous reservation commit");
      }
    };

    const result = await harness.handlers.getDiamondManagerStats(
      {
        teamId: "team-1",
        gameHeads: [head],
        playerIds: ["home-1"],
      },
      harness.managerContext,
    );

    assert.equal(result.status, "complete");
    assert.equal(harness.firestore.bulkGetCalls, 1);
    const admission = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    assert.equal(admission.requestCount, 1);
    const scope = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-scope",
    ).value;
    assert.equal(scope.requestCount, 1);
    assert.equal(scope.readUnits, 2);
    assert.deepEqual(scope.activeAttempts, []);
    assert.equal(scope.recentTerminals.length, 1);
    assert.equal(scope.recentTerminals[0].status, "complete");
  });

  it("uses a fresh callback clock when an ambiguous reservation lease expires", async () => {
    const initialNowMs = 1_750_000_000_000;
    let nowMs = initialNowMs;
    const harness = createHarness({ clock: () => nowMs });
    const head = seedManagerStatProjection(harness);
    let droppedReservationResponse = false;
    harness.firestore.transactionHook = async (stage, transaction) => {
      const scopeWrite = transactionControlWrite(
        transaction,
        "diamond-manager-stat-read-scope",
      );
      if (
        stage === "after" &&
        scopeWrite?.value?.activeAttempts?.length === 1 &&
        !droppedReservationResponse
      ) {
        droppedReservationResponse = true;
        nowMs += MANAGER_STAT_REQUEST_LEASE_MS + 1;
        harness.firestore.commitTimestampMs = nowMs;
        throw new Error("delayed ambiguous reservation commit");
      }
    };

    const result = await harness.handlers.getDiamondManagerStats(
      {
        teamId: "team-1",
        gameHeads: [head],
        playerIds: ["home-1"],
      },
      harness.managerContext,
    );

    assert.equal(result.status, "complete");
    assert.equal(harness.firestore.bulkGetCalls, 1);
    const activeReservationWrites = harness.firestore.transactionCommits
      .flat()
      .filter(
        ({ value }) =>
          value?.type === "diamond-manager-stat-read-scope" &&
          value.activeAttempts?.length === 1,
      );
    assert.equal(activeReservationWrites.length, 2);
    assert.equal(
      activeReservationWrites[0].value.activeAttempts[0].startedAtMs,
      initialNowMs,
    );
    assert.equal(
      activeReservationWrites[1].value.activeAttempts[0].startedAtMs,
      nowMs,
    );
    assert.equal(
      activeReservationWrites[1].value.activeAttempts[0].leaseExpiresAtMs,
      nowMs + MANAGER_STAT_REQUEST_LEASE_MS,
    );
    assert.equal(
      activeReservationWrites[0].value.activeAttempts[0].requestHash,
      activeReservationWrites[1].value.activeAttempts[0].requestHash,
    );
    const admission = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    assert.equal(admission.requestCount, 1);
    assert.equal(admission.recentAttempts.length, 1);
  });

  it("derives reservation and completion leases from each retried callback clock", async () => {
    {
      const initialNowMs = 1_750_000_000_000;
      let nowMs = initialNowMs;
      const harness = createHarness({ clock: () => nowMs });
      const head = seedManagerStatProjection(harness);
      let retriedReservation = false;
      harness.firestore.transactionHook = async (stage, transaction) => {
        const scopeWrite = transactionControlWrite(
          transaction,
          "diamond-manager-stat-read-scope",
        );
        if (
          stage === "beforeCommit" &&
          scopeWrite?.value?.activeAttempts?.length === 1 &&
          !retriedReservation
        ) {
          retriedReservation = true;
          nowMs += MANAGER_STAT_REQUEST_LEASE_MS + 1;
          harness.firestore.commitTimestampMs = nowMs;
          return "retry";
        }
      };

      const result = await harness.handlers.getDiamondManagerStats(
        {
          teamId: "team-1",
          gameHeads: [head],
          playerIds: ["home-1"],
        },
        harness.managerContext,
      );
      assert.equal(result.status, "complete");
      const activeWrite = harness.firestore.transactionCommits
        .flat()
        .find(
          ({ value }) =>
            value?.type === "diamond-manager-stat-read-scope" &&
            value.activeAttempts?.length === 1,
        );
      assert.equal(activeWrite.value.activeAttempts[0].startedAtMs, nowMs);
      assert.equal(
        activeWrite.value.activeAttempts[0].leaseExpiresAtMs,
        nowMs + MANAGER_STAT_REQUEST_LEASE_MS,
      );
    }

    {
      let nowMs = 1_750_000_000_000;
      const harness = createHarness({ clock: () => nowMs });
      const head = seedManagerStatProjection(harness);
      let retriedCompletion = false;
      harness.firestore.transactionHook = async (stage, transaction) => {
        const scopeWrite = transactionControlWrite(
          transaction,
          "diamond-manager-stat-read-scope",
        );
        if (
          stage === "beforeCommit" &&
          scopeWrite?.value?.recentTerminals?.some(
            ({ status }) => status === "complete",
          ) &&
          !retriedCompletion
        ) {
          retriedCompletion = true;
          nowMs += MANAGER_STAT_REQUEST_LEASE_MS + 1;
          harness.firestore.commitTimestampMs = nowMs;
          return "retry";
        }
      };

      await assert.rejects(
        harness.handlers.getDiamondManagerStats(
          {
            teamId: "team-1",
            gameHeads: [head],
            playerIds: ["home-1"],
          },
          harness.managerContext,
        ),
        (error) =>
          error.code === "aborted" &&
          error.details?.reason === "manager-stat-read-reservation-lost",
      );
      assert.equal(harness.firestore.bulkGetCalls, 1);
      const scope = managerStatReadControl(
        harness,
        "diamond-manager-stat-read-scope",
      ).value;
      assert.deepEqual(scope.activeAttempts, []);
      assert.equal(scope.recentTerminals.at(-1).status, "failed");
      assert.equal(
        scope.recentTerminals.at(-1).failureCode,
        "final-access-recheck-failed",
      );
    }
  });

  it("returns an ambiguous completion only for its exact durable response hash", async () => {
    const run = async (mode) => {
      const harness = createHarness();
      const head = seedManagerStatProjection(harness);
      let droppedCompletionResponse = false;
      harness.firestore.transactionHook = async (stage, transaction) => {
        const scopeWrite = transactionControlWrite(
          transaction,
          "diamond-manager-stat-read-scope",
        );
        if (
          stage !== "after" ||
          droppedCompletionResponse ||
          !scopeWrite?.value?.recentTerminals?.some(
            ({ status }) => status === "complete",
          )
        ) {
          return;
        }
        droppedCompletionResponse = true;
        const scopePath = scopeWrite.reference.path;
        const scope = harness.firestore.read(scopePath);
        if (mode === "wrong-hash") {
          scope.recentTerminals.at(-1).responseHash = `sha256:${"f".repeat(64)}`;
          harness.firestore.seed(scopePath, scope);
        } else if (mode === "evicted") {
          scope.recentTerminals = Array.from({ length: 16 }, (_, index) => ({
            requestHash: `sha256:${index.toString(16).padStart(64, "0")}`,
            status: "complete",
            finishedAtMs: scope.updatedAtMs,
            responseHash: `sha256:${(index + 32).toString(16).padStart(64, "0")}`,
          }));
          harness.firestore.seed(scopePath, scope);
        }
        throw new Error("ambiguous completion commit");
      };
      const invocation = harness.handlers.getDiamondManagerStats(
        {
          teamId: "team-1",
          gameHeads: [head],
          playerIds: ["home-1"],
        },
        harness.managerContext,
      );
      return { harness, invocation };
    };

    const exact = await run("exact");
    await assert.doesNotReject(exact.invocation);
    assert.equal(exact.harness.firestore.bulkGetCalls, 1);

    for (const mode of ["wrong-hash", "evicted"]) {
      const candidate = await run(mode);
      await assert.rejects(
        candidate.invocation,
        (error) => error.code === "unavailable",
      );
      assert.equal(candidate.harness.firestore.bulkGetCalls, 1);
      const scope = managerStatReadControl(
        candidate.harness,
        "diamond-manager-stat-read-scope",
      ).value;
      assert.deepEqual(scope.activeAttempts, []);
      assert.ok(Buffer.byteLength(JSON.stringify(scope), "utf8") < 100 * 1024);
    }
  });

  it("closes thrown and partial bulk reads before a later invocation succeeds", async () => {
    for (const mode of ["throw", "partial"]) {
      const harness = createHarness();
      const head = seedManagerStatProjection(harness);
      const request = {
        teamId: "team-1",
        gameHeads: [head],
        playerIds: ["home-1"],
      };
      let firstBulk = true;
      harness.firestore.bulkGetHook = (_references, snapshots) => {
        if (!firstBulk) return undefined;
        firstBulk = false;
        if (mode === "throw") throw new Error("bulk transport failed");
        return snapshots.slice(0, -1);
      };

      await assert.rejects(
        harness.handlers.getDiamondManagerStats(
          request,
          harness.managerContext,
        ),
        (error) => error.code === "unavailable",
      );
      let scope = managerStatReadControl(
        harness,
        "diamond-manager-stat-read-scope",
      ).value;
      assert.deepEqual(scope.activeAttempts, []);
      assert.equal(scope.recentTerminals.at(-1).status, "failed");
      assert.equal(
        scope.recentTerminals.at(-1).failureCode,
        mode === "throw" ? "bulk-read-failed" : "bulk-read-incomplete",
      );

      const recovered = await harness.handlers.getDiamondManagerStats(
        request,
        harness.managerContext,
      );
      assert.equal(recovered.status, "complete");
      assert.equal(harness.firestore.bulkGetCalls, 2);
      scope = managerStatReadControl(
        harness,
        "diamond-manager-stat-read-scope",
      ).value;
      assert.deepEqual(scope.activeAttempts, []);
      assert.deepEqual(
        scope.recentTerminals.map(({ status }) => status),
        ["failed", "complete"],
      );
    }
  });

  it("returns no private response when final Auth is disabled or deleted", async () => {
    for (const mode of ["disabled", "deleted"]) {
      const harness = createHarness({
        getUserHook({ callCount, authUsers }) {
          if (callCount !== 2) return;
          if (mode === "disabled") {
            authUsers.set("manager-1", {
              ...authUsers.get("manager-1"),
              disabled: true,
            });
          } else {
            authUsers.delete("manager-1");
          }
        },
      });
      const head = seedManagerStatProjection(harness);
      await assert.rejects(
        harness.handlers.getDiamondManagerStats(
          {
            teamId: "team-1",
            gameHeads: [head],
            playerIds: ["home-1"],
          },
          harness.managerContext,
        ),
      );
      assert.equal(harness.firestore.bulkGetCalls, 1);
      const scope = managerStatReadControl(
        harness,
        "diamond-manager-stat-read-scope",
      ).value;
      assert.deepEqual(scope.activeAttempts, []);
      assert.equal(scope.recentTerminals.at(-1).status, "failed");
      assert.equal(
        scope.recentTerminals.at(-1).failureCode,
        "final-auth-recheck-failed",
      );
    }
  });

  it("fails malformed controls closed until their quarantine ages out", async () => {
    const initialNowMs = 1_750_000_000_000;
    let nowMs = initialNowMs;
    const harness = createHarness({ clock: () => nowMs });
    const head = seedManagerStatProjection(harness);
    const request = {
      teamId: "team-1",
      gameHeads: [head],
      playerIds: ["home-1"],
    };
    await harness.handlers.getDiamondManagerStats(
      request,
      harness.managerContext,
    );

    const admissionControl = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    );
    const malformedAdmission = { ...admissionControl.value };
    delete malformedAdmission.expiresAt;
    malformedAdmission.unexpectedTtl = true;
    harness.firestore.seed(admissionControl.path, malformedAdmission);
    harness.firestore.setDocumentUpdateTime(admissionControl.path, nowMs);
    const transactionReadsBeforeAdmissionFailure =
      harness.firestore.transactionBulkGetCounts.length;
    await assert.rejects(
      harness.handlers.getDiamondManagerStats(
        request,
        harness.managerContext,
      ),
      (error) =>
        error.code === "unavailable" &&
        error.details?.reason === "manager-stat-read-control-invalid",
    );
    assert.equal(harness.firestore.bulkGetCalls, 1);
    assert.equal(
      harness.firestore.transactionBulkGetCounts.length,
      transactionReadsBeforeAdmissionFailure,
    );

    for (const quarantineAgeMs of [
      MANAGER_STAT_RATE_WINDOW_MS,
      MANAGER_STAT_RECEIPT_RETENTION_MS,
    ]) {
      nowMs = initialNowMs + quarantineAgeMs;
      harness.firestore.commitTimestampMs = nowMs;
      await assert.rejects(
        harness.handlers.getDiamondManagerStats(
          request,
          harness.managerContext,
        ),
        (error) =>
          error.code === "unavailable" &&
          error.details?.reason === "manager-stat-read-control-invalid",
      );
      assert.equal(harness.firestore.bulkGetCalls, 1);
    }

    nowMs = initialNowMs + MANAGER_STAT_SUSTAINED_WINDOW_MS;
    harness.firestore.commitTimestampMs = nowMs;
    const afterAdmissionQuarantine =
      await harness.handlers.getDiamondManagerStats(
        request,
        harness.managerContext,
      );
    assert.equal(afterAdmissionQuarantine.status, "complete");
    assert.equal(harness.firestore.bulkGetCalls, 2);

    const scopeControl = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-scope",
    );
    const malformedScope = { ...scopeControl.value };
    malformedScope.recentTerminals = [{ untrusted: true }];
    harness.firestore.seed(scopeControl.path, malformedScope);
    harness.firestore.setDocumentUpdateTime(scopeControl.path, nowMs);
    const scopeMalformedAtMs = nowMs;
    const transactionReadsBeforeScopeFailure =
      harness.firestore.transactionBulkGetCounts.length;
    await assert.rejects(
      harness.handlers.getDiamondManagerStats(
        request,
        harness.managerContext,
      ),
      (error) =>
        error.code === "unavailable" &&
        error.details?.reason === "manager-stat-read-control-invalid",
    );
    assert.equal(harness.firestore.bulkGetCalls, 2);
    assert.deepEqual(
      harness.firestore.transactionBulkGetCounts.slice(
        transactionReadsBeforeScopeFailure,
      ),
      [2],
    );

    for (const quarantineAgeMs of [
      MANAGER_STAT_RATE_WINDOW_MS,
      MANAGER_STAT_RECEIPT_RETENTION_MS,
    ]) {
      nowMs = scopeMalformedAtMs + quarantineAgeMs;
      harness.firestore.commitTimestampMs = nowMs;
      await assert.rejects(
        harness.handlers.getDiamondManagerStats(
          request,
          harness.managerContext,
        ),
        (error) =>
          error.code === "unavailable" &&
          error.details?.reason === "manager-stat-read-control-invalid",
      );
      assert.equal(harness.firestore.bulkGetCalls, 2);
    }

    nowMs = scopeMalformedAtMs + MANAGER_STAT_SUSTAINED_WINDOW_MS;
    harness.firestore.commitTimestampMs = nowMs;
    const afterScopeQuarantine = await harness.handlers.getDiamondManagerStats(
      request,
      harness.managerContext,
    );
    assert.equal(afterScopeQuarantine.status, "complete");
    assert.equal(harness.firestore.bulkGetCalls, 3);
    const recoveredScope = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-scope",
    ).value;
    assert.deepEqual(recoveredScope.activeAttempts, []);
    assert.equal(recoveredScope.recentTerminals.length, 1);
    assert.equal(recoveredScope.recentTerminals[0].status, "complete");
  });

  it("prunes expired terminal evidence while preserving a fresh charged read", async () => {
    let nowMs = 1_750_000_000_000;
    const harness = createHarness({ clock: () => nowMs });
    const head = seedManagerStatProjection(harness);
    const request = {
      teamId: "team-1",
      gameHeads: [head],
      playerIds: ["home-1"],
    };
    await harness.handlers.getDiamondManagerStats(
      request,
      harness.managerContext,
    );
    const firstRequestHash = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-scope",
    ).value.recentTerminals[0].requestHash;

    nowMs += MANAGER_STAT_RECEIPT_RETENTION_MS;
    harness.firestore.commitTimestampMs = nowMs;
    const result = await harness.handlers.getDiamondManagerStats(
      request,
      harness.managerContext,
    );
    assert.equal(result.status, "complete");
    const scope = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-scope",
    ).value;
    assert.equal(scope.requestCount, 1);
    assert.equal(scope.readUnits, 2);
    assert.equal(scope.recentTerminals.length, 1);
    assert.notEqual(scope.recentTerminals[0].requestHash, firstRequestHash);
    assert.equal(
      scope.expiresAt.getTime(),
      nowMs + MANAGER_STAT_RECEIPT_RETENTION_MS,
    );
  });

  it("keeps maximum control rings compact, hash-only, and fixed-cardinality", async () => {
    const nowMs = 1_750_000_000_000;
    const harness = createHarness({ clock: () => nowMs });
    const head = seedManagerStatProjection(harness);
    const request = {
      teamId: "team-1",
      gameHeads: [head],
      playerIds: ["home-1"],
    };

    for (
      let attempt = 0;
      attempt < MAX_MANAGER_STAT_REQUESTS_PER_WINDOW;
      attempt += 1
    ) {
      const result = await harness.handlers.getDiamondManagerStats(
        request,
        harness.managerContext,
      );
      assert.equal(result.status, "complete");
    }
    const controls = managerStatReadControls(harness);
    assert.equal(controls.length, 2);
    const admission = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-admission",
    ).value;
    const scope = managerStatReadControl(
      harness,
      "diamond-manager-stat-read-scope",
    ).value;
    assert.equal(admission.recentAttempts.length, 256);
    assert.equal(new Set(admission.recentAttempts.map(({ attemptHash }) => attemptHash)).size, 256);
    assert.equal(scope.recentTerminals.length, 16);
    assert.equal(new Set(scope.recentTerminals.map(({ requestHash }) => requestHash)).size, 16);
    assert.deepEqual(scope.activeAttempts, []);
    assert.equal(
      admission.expiresAt.getTime(),
      nowMs + MANAGER_STAT_SUSTAINED_WINDOW_MS,
    );
    assert.equal(
      scope.expiresAt.getTime(),
      nowMs + MANAGER_STAT_SUSTAINED_WINDOW_MS,
    );
    assert.ok(Buffer.byteLength(JSON.stringify(admission), "utf8") < 100 * 1024);
    assert.ok(Buffer.byteLength(JSON.stringify(scope), "utf8") < 100 * 1024);
    assert.ok(
      controls.every(({ path }) =>
        new RegExp(
          `^${MANAGER_STAT_CONTROL_COLLECTION}/(?:admission|scope)-[0-9a-f]{64}$`,
        ).test(path),
      ),
    );
    const serializedControls = JSON.stringify(controls);
    for (const privateValue of [
      "manager-1",
      "team-1",
      "game-1",
      "home-1",
      "Home Hitter",
      "play-1",
    ]) {
      assert.equal(serializedControls.includes(privateValue), false);
    }
    assert.equal(
      harness.firestore.transactionCommits.filter((commit) =>
        commit.some(
          ({ value }) =>
            value?.type === "diamond-manager-stat-read-admission",
        ),
      ).length,
      MAX_MANAGER_STAT_REQUESTS_PER_WINDOW,
    );
    assert.equal(
      harness.firestore.transactionCommits.filter((commit) =>
        commit.some(
          ({ value }) => value?.type === "diamond-manager-stat-read-scope",
        ),
      ).length,
      MAX_MANAGER_STAT_REQUESTS_PER_WINDOW * 2,
    );
    assert.equal(
      harness.firestore.queryReads.some(
        ({ path }) => path === MANAGER_STAT_CONTROL_COLLECTION,
      ),
      false,
    );
  });

  it("isolates controls across principals and teams without storing identities", async () => {
    const harness = createHarness({
      documents: {
        "teams/team-2": {
          id: "team-2",
          ownerId: "manager-1",
          sport: "baseball",
          active: true,
        },
        "users/manager-2": { isAdmin: true },
      },
      authUsers: {
        "manager-2": {
          uid: "manager-2",
          disabled: false,
          email: "manager-2@example.com",
          emailVerified: true,
        },
      },
    });
    const teamOneHead = seedManagerStatProjection(harness);
    const teamTwoHead = seedManagerStatProjection(harness, {
      teamId: "team-2",
      gameId: "game-2",
      playerId: "player-2",
      instanceId: makeUuid(702),
    });
    await harness.handlers.getDiamondManagerStats(
      {
        teamId: "team-1",
        gameHeads: [teamOneHead],
        playerIds: ["home-1"],
      },
      harness.managerContext,
    );
    await harness.handlers.getDiamondManagerStats(
      {
        teamId: "team-2",
        gameHeads: [teamTwoHead],
        playerIds: ["player-2"],
      },
      harness.managerContext,
    );
    await harness.handlers.getDiamondManagerStats(
      {
        teamId: "team-1",
        gameHeads: [teamOneHead],
        playerIds: ["home-1"],
      },
      { auth: { uid: "manager-2" } },
    );

    const controls = managerStatReadControls(harness);
    assert.equal(
      controls.filter(
        ({ value }) =>
          value.type === "diamond-manager-stat-read-admission",
      ).length,
      2,
    );
    assert.equal(
      controls.filter(
        ({ value }) => value.type === "diamond-manager-stat-read-scope",
      ).length,
      3,
    );
    const serialized = JSON.stringify(controls);
    for (const identity of [
      "manager-1",
      "manager-2",
      "team-1",
      "team-2",
      "game-1",
      "game-2",
      "home-1",
      "player-2",
    ]) {
      assert.equal(serialized.includes(identity), false);
    }
  });

  it("fails before control or private reads when secure randomness is unavailable", async () => {
    const harness = createHarness({ random: () => "not-a-secure-uuid" });
    const head = seedManagerStatProjection(harness);
    await assert.rejects(
      harness.handlers.getDiamondManagerStats(
        {
          teamId: "team-1",
          gameHeads: [head],
          playerIds: ["home-1"],
        },
        harness.managerContext,
      ),
      (error) => error.code === "unavailable",
    );
    assert.equal(managerStatReadControls(harness).length, 0);
    assert.equal(harness.firestore.transactionReadBatches.length, 0);
    assert.equal(harness.firestore.bulkGetCalls, 0);
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

  it("returns indistinguishable not-found errors for missing and unauthorized Diamond access targets", async () => {
    const outsiderContext = { auth: { uid: "outsider-1" } };
    const createOutsiderHarness = ({
      teamPresent = true,
      gamePresent = true,
    } = {}) => {
      const documents = baseDocuments({
        "teams/team-1": {
          ...baseDocuments()["teams/team-1"],
          isPublic: false,
        },
        "teams/team-1/games/game-1": {
          ...baseDocuments()["teams/team-1/games/game-1"],
          visibility: "private",
          trackingEngine: DIAMOND_ENGINE,
        },
        "users/outsider-1": { isAdmin: false },
      });
      if (!teamPresent) delete documents["teams/team-1"];
      if (!gamePresent) delete documents["teams/team-1/games/game-1"];
      return createHarness({
        firestore: new FakeFirestore(documents),
        authUsers: {
          "outsider-1": {
            uid: "outsider-1",
            disabled: false,
            email: "outsider@example.test",
            emailVerified: true,
          },
        },
        viewerAccessByUid: {
          "outsider-1": {
            full: false,
            parent: false,
            scorekeeping: false,
            videography: false,
            streaming: false,
            media: false,
          },
        },
      });
    };
    const readError = async (harness, request) => {
      let signature = null;
      await assert.rejects(
        harness.handlers.getDiamondAccess(request, outsiderContext),
        (error) => {
          signature = {
            code: error.code,
            message: error.message,
            details: error.details ?? null,
          };
          return true;
        },
      );
      return signature;
    };

    const gameRequest = {
      teamId: "team-1",
      gameId: "game-1",
      appBuild: DIAMOND_APP_BUILD,
    };
    const gameErrors = await Promise.all([
      readError(createOutsiderHarness({ teamPresent: false }), gameRequest),
      readError(createOutsiderHarness({ gamePresent: false }), gameRequest),
      readError(createOutsiderHarness(), gameRequest),
    ]);
    assert.deepEqual(
      gameErrors,
      Array.from({ length: 3 }, () => ({
        code: "not-found",
        message: "Game not found.",
        details: null,
      })),
    );

    const teamRequest = {
      teamId: "team-1",
      appBuild: DIAMOND_APP_BUILD,
    };
    const teamErrors = await Promise.all([
      readError(createOutsiderHarness({ teamPresent: false }), teamRequest),
      readError(createOutsiderHarness(), teamRequest),
    ]);
    assert.deepEqual(
      teamErrors,
      Array.from({ length: 2 }, () => ({
        code: "not-found",
        message: "Team not found.",
        details: null,
      })),
    );
  });

  it("keeps Diamond access document read failures retryable", async () => {
    const harness = createHarness();
    const original = harness.firestore._documentSnapshot.bind(
      harness.firestore,
    );
    harness.firestore._documentSnapshot = (reference) => {
      if (reference.path === "teams/team-1") {
        throw new Error("read failed");
      }
      return original(reference);
    };

    await assert.rejects(
      harness.handlers.getDiamondAccess(
        {
          teamId: "team-1",
          gameId: "game-1",
          appBuild: DIAMOND_APP_BUILD,
        },
        harness.managerContext,
      ),
      (error) =>
        error.code === "unavailable" &&
        error.message === "Diamond access could not be verified. Try again.",
    );
  });

  it("preserves Diamond access metadata for each current private viewer role", async () => {
    const viewerAccessByUid = {
      "parent-1": { parent: true },
      "scorekeeper-2": { scorekeeping: true },
      "videographer-1": { videography: true },
      "streamer-1": { streaming: true },
      "official-uid-1": {},
      "official-email-1": {},
    };
    const authUsers = Object.fromEntries(
      Object.keys(viewerAccessByUid).map((uid) => [
        uid,
        {
          uid,
          disabled: false,
          email: `${uid}@example.test`,
          emailVerified: true,
        },
      ]),
    );
    const documents = Object.fromEntries(
      Object.keys(viewerAccessByUid).map((uid) => [
        `users/${uid}`,
        { displayName: uid },
      ]),
    );
    const harness = createHarness({
      authUsers,
      documents,
      viewerAccessByUid,
    });
    harness.firestore.seed("teams/team-1/games/game-1", {
      ...harness.firestore.read("teams/team-1/games/game-1"),
      visibility: "private",
      officiatingAuthorizedUserIds: ["official-uid-1"],
      officiatingAuthorizedEmails: ["official-email-1@example.test"],
    });

    const viewers = [
      harness.managerContext,
      harness.scorerContext,
      ...Object.keys(viewerAccessByUid).map((uid) => ({ auth: { uid } })),
    ];
    for (const viewerContext of viewers) {
      const access = await harness.handlers.getDiamondAccess(
        {
          teamId: "team-1",
          gameId: "game-1",
          appBuild: DIAMOND_APP_BUILD,
        },
        viewerContext,
      );
      assert.equal(access.policyMode, "enabled");
      assert.equal(access.sport, "baseball");
      assert.equal(access.teamOptIn, true);
      assert.equal(access.trackingEngine, null);
    }
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

  it("enforces canonical pitcher occupancy and sacrifice evidence before durable writes", async () => {
    const pitcherHarness = createHarness();
    await activate(pitcherHarness);
    await startGame(pitcherHarness);
    const pitcherPaths = paths("team-1", "game-1");
    const invalidPitcherCommandId = makeUuid(391);
    const invalidPitcher = await submit(pitcherHarness, {
      commandId: invalidPitcherCommandId,
      expectedRevision: 6,
      type: "substitute",
      payload: {
        side: "home",
        battingSlot: 1,
        outgoingPlayerId: "home-1",
        incomingPlayerId: "home-reliever",
        defensivePosition: "1B",
      },
    });
    assert.equal(invalidPitcher.outcome, "rejected");
    assert.equal(invalidPitcher.rejection.code, "missing-defensive-pitcher");
    assert.equal(
      pitcherHarness.firestore.read(pitcherPaths.scorebook).checkpoint.sequence,
      6,
    );
    assert.equal(
      pitcherHarness.firestore.read(
        pitcherPaths.command(invalidPitcherCommandId),
      ),
      undefined,
    );

    const validPitcher = await submit(pitcherHarness, {
      commandId: makeUuid(392),
      expectedRevision: 6,
      type: "substitute",
      payload: {
        side: "home",
        battingSlot: 1,
        outgoingPlayerId: "home-1",
        incomingPlayerId: "home-reliever",
      },
    });
    assert.equal(validPitcher.outcome, "accepted");
    assert.equal(
      validPitcher.state.state.lineups.home.defense.P,
      "home-reliever",
    );

    const sacrificeHarness = createHarness();
    await activate(sacrificeHarness);
    await startGame(sacrificeHarness);
    const sacrificePaths = paths("team-1", "game-1");
    const missingEvidenceCommandId = makeUuid(393);
    const missingEvidence = await submit(sacrificeHarness, {
      commandId: missingEvidenceCommandId,
      expectedRevision: 6,
      type: "record_plate_appearance",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "sacrifice_fly",
        batterAdvance: { to: "out" },
        runnerAdvances: [],
        outsOnPlay: 1,
      },
    });
    assert.equal(missingEvidence.outcome, "rejected");
    assert.equal(missingEvidence.rejection.code, "sacrifice-evidence-missing");
    assert.equal(
      sacrificeHarness.firestore.read(
        sacrificePaths.command(missingEvidenceCommandId),
      ),
      undefined,
    );

    const canceledBuntHarness = createHarness();
    await activate(canceledBuntHarness);
    await startGame(canceledBuntHarness);
    const canceledBuntPaths = paths("team-1", "game-1");
    const reached = await submit(canceledBuntHarness, {
      commandId: makeUuid(397),
      expectedRevision: 6,
      type: "record_plate_appearance",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "single",
        batterAdvance: { to: "first" },
        runnerAdvances: [],
        outsOnPlay: 0,
      },
    });
    assert.equal(reached.outcome, "accepted");
    const courtesy = await submit(canceledBuntHarness, {
      commandId: makeUuid(398),
      expectedRevision: 7,
      type: "add_courtesy_runner",
      payload: {
        side: "away",
        forPlayerId: "away-1",
        runnerId: "away-courtesy",
        base: "first",
        forRole: "pitcher",
      },
    });
    assert.equal(courtesy.outcome, "accepted");
    const canceledBuntCommandId = makeUuid(399);
    const canceledBunt = await submit(canceledBuntHarness, {
      commandId: canceledBuntCommandId,
      expectedRevision: 8,
      type: "record_plate_appearance",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "sacrifice_bunt",
        batterAdvance: { to: "out" },
        runnerAdvances: [
          {
            runnerId: "away-courtesy",
            from: "first",
            to: "home",
            cause: "batted_ball",
            countsRun: false,
          },
        ],
        outsOnPlay: 1,
      },
    });
    assert.equal(canceledBunt.outcome, "rejected");
    assert.equal(canceledBunt.rejection.code, "sacrifice-evidence-missing");
    assert.equal(
      canceledBuntHarness.firestore.read(canceledBuntPaths.scorebook)
        .checkpoint.sequence,
      8,
    );
    assert.equal(
      canceledBuntHarness.firestore.read(
        canceledBuntPaths.command(canceledBuntCommandId),
      ),
      undefined,
    );

    for (const [index, batterId] of ["away-1", "away-1"].entries()) {
      const out = await submit(sacrificeHarness, {
        commandId: makeUuid(394 + index),
        expectedRevision: 6 + index,
        type: "record_plate_appearance",
        payload: {
          batterId,
          pitcherId: "home-1",
          result: "ground_out",
          batterAdvance: { to: "out" },
          runnerAdvances: [],
          outsOnPlay: 1,
        },
      });
      assert.equal(out.outcome, "accepted");
    }
    const twoOutCommandId = makeUuid(396);
    const twoOutSacrifice = await submit(sacrificeHarness, {
      commandId: twoOutCommandId,
      expectedRevision: 8,
      type: "record_plate_appearance",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "sacrifice_bunt",
        batterAdvance: { to: "out" },
        runnerAdvances: [],
        outsOnPlay: 1,
      },
    });
    assert.equal(twoOutSacrifice.outcome, "rejected");
    assert.equal(twoOutSacrifice.rejection.code, "sacrifice-with-two-outs");
    assert.equal(
      sacrificeHarness.firestore.read(sacrificePaths.scorebook).checkpoint
        .sequence,
      8,
    );
    assert.equal(
      sacrificeHarness.firestore.read(sacrificePaths.command(twoOutCommandId)),
      undefined,
    );
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

  it("quarantines unmarked scorer-lease acquisition and recovery without writes", async () => {
    for (const [index, operation] of ["acquire", "recover"].entries()) {
      const harness = createHarness();
      await activate(harness);
      const resourcePaths = paths("team-1", "game-1");
      const unmarkedRoot = harness.firestore.read(resourcePaths.scorebook);
      delete unmarkedRoot.initialState.lineups.home.courtesyRunnerIds;
      delete unmarkedRoot.initialState.lineups.away.courtesyRunnerIds;
      delete unmarkedRoot.checkpoint.state.lineups.home.courtesyRunnerIds;
      delete unmarkedRoot.checkpoint.state.lineups.away.courtesyRunnerIds;
      harness.firestore.seed(resourcePaths.scorebook, unmarkedRoot);
      const beforeRoot = harness.firestore.read(resourcePaths.scorebook);
      const beforeEventCount = harness.firestore.countDirectChildren(
        resourcePaths.events,
      );
      const requestId = makeUuid(319 + index);

      await assert.rejects(
        changeScorerLease(harness, { requestId, operation }),
        (error) =>
          error.code === "failed-precondition" &&
          error.details?.reason === "history-required" &&
          error.details?.retryable === false,
      );

      assert.deepEqual(
        harness.firestore.read(resourcePaths.scorebook),
        beforeRoot,
      );
      assert.equal(
        harness.firestore.countDirectChildren(resourcePaths.events),
        beforeEventCount,
      );
      assert.equal(
        harness.firestore.read(resourcePaths.command(requestId)),
        undefined,
      );
      assert.equal(
        harness.firestore.read(resourcePaths.audit(requestId)),
        undefined,
      );
    }
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

  it("lists an exact confirmed RSVP scorekeeper only through the bounded handoff lookup", async () => {
    const harness = createHarness({
      authUsers: {
        "confirmed-scorer": {
          uid: "confirmed-scorer",
          disabled: false,
          displayName: "\u0000Confirmed\u007f\n Scorer",
          email: "confirmed-private@example.test",
          emailVerified: true,
        },
      },
      documents: {
        "teams/team-1": {
          ...baseDocuments()["teams/team-1"],
          teamPermissions: { scorekeeping: { mode: "all_confirmed" } },
        },
        "teams/team-1/games/game-1/rsvps/confirmed-scorer": {
          response: "confirmed",
          userId: "forged-payload-uid",
          privateNote: "must never leave the server",
        },
      },
    });
    await activate(harness);

    const result = await listScorerCandidates(harness);

    assert.deepEqual(Object.keys(result).sort(), [
      "candidates",
      "complete",
      "gameId",
      "instanceId",
      "leaseId",
      "revision",
      "schemaVersion",
      "teamId",
    ]);
    assert.equal(result.complete, true);
    assert.deepEqual(result.candidates, [
      { playerId: "confirmed-scorer", name: "Confirmed Scorer" },
    ]);
    assert.deepEqual(Object.keys(result), [
      "schemaVersion",
      "complete",
      "teamId",
      "gameId",
      "instanceId",
      "revision",
      "leaseId",
      "candidates",
    ]);
    assert.deepEqual(Object.keys(result.candidates[0]), ["playerId", "name"]);
    const rsvpQueries = harness.firestore.queryReads.filter(
      (query) => query.path === paths("team-1", "game-1").rsvps,
    );
    assert.equal(rsvpQueries.length, 2);
    assert.ok(
      rsvpQueries.every(
        (query) => query.maximum === 101 && query.filters.length === 0,
      ),
    );
    assert.deepEqual(harness.authGetUsersCalls, [
      [{ uid: "confirmed-scorer" }],
    ]);
    assert.doesNotMatch(
      JSON.stringify(result),
      /confirmed-private|forged-payload|privateNote/,
    );
  });

  it("accepts only the canonical confirmed RSVP statuses from canonical document IDs", async () => {
    const accepted = {
      "attending-scorer": { status: "ATTENDING" },
      "confirmed-scorer": { response: "  confirmed  " },
      "going-scorer": { response: "going" },
      "yes-scorer": { status: "yes" },
    };
    const excluded = {
      "declined-scorer": { response: "declined" },
      "empty-scorer": { response: "" },
      "maybe-scorer": { status: "maybe" },
      "precedence-scorer": { response: "no", status: "confirmed" },
      "padded-uid ": { response: "confirmed" },
    };
    const allUids = [...Object.keys(accepted), ...Object.keys(excluded)];
    const harness = createHarness({
      authUsers: Object.fromEntries(
        allUids.map((uid) => [
          uid,
          {
            uid,
            disabled: false,
            displayName: `Name ${uid}`,
            emailVerified: false,
          },
        ]),
      ),
      documents: {
        "teams/team-1": {
          ...baseDocuments()["teams/team-1"],
          teamPermissions: { scorekeeping: { mode: "all_confirmed" } },
        },
        ...Object.fromEntries(
          Object.entries({ ...accepted, ...excluded }).map(([uid, value]) => [
            `teams/team-1/games/game-1/rsvps/${uid}`,
            { ...value, uid: "payload-is-not-authority" },
          ]),
        ),
      },
    });
    await activate(harness);

    const result = await listScorerCandidates(harness);

    assert.deepEqual(
      result.candidates.map((candidate) => candidate.playerId),
      Object.keys(accepted).sort((left, right) => left.localeCompare(right)),
    );
  });

  it("excludes missing and disabled Auth accounts without returning partial private fields", async () => {
    const harness = createHarness({
      authUsers: {
        enabled: {
          uid: "enabled",
          disabled: false,
          displayName: "Enabled Person",
          email: "enabled-private@example.test",
        },
        disabled: {
          uid: "disabled",
          disabled: true,
          displayName: "Disabled Person",
          email: "disabled-private@example.test",
        },
      },
      documents: {
        "teams/team-1": {
          ...baseDocuments()["teams/team-1"],
          teamPermissions: { scorekeeping: { mode: "all_confirmed" } },
        },
        "teams/team-1/games/game-1/rsvps/enabled": { response: "yes" },
        "teams/team-1/games/game-1/rsvps/disabled": {
          response: "going",
        },
        "teams/team-1/games/game-1/rsvps/missing": {
          response: "attending",
        },
      },
    });
    await activate(harness);

    const result = await listScorerCandidates(harness);

    assert.deepEqual(result.candidates, [
      { playerId: "enabled", name: "Enabled Person" },
    ]);
    assert.doesNotMatch(JSON.stringify(result), /private@example|Disabled/);
  });

  it("fails closed on RSVP read errors, RSVP overflow, and partial Auth batches", async (t) => {
    await t.test("RSVP query error", async () => {
      const harness = createHarness({
        documents: {
          "teams/team-1": {
            ...baseDocuments()["teams/team-1"],
            teamPermissions: { scorekeeping: { mode: "all_confirmed" } },
          },
        },
      });
      await activate(harness);
      harness.firestore.queryHook = (query) => {
        if (query.path === paths("team-1", "game-1").rsvps) {
          throw Object.assign(new Error("denied"), {
            code: "permission-denied",
          });
        }
      };

      await assert.rejects(listScorerCandidates(harness), (error) => {
        assert.equal(error.code, "unavailable");
        assert.equal(
          error.details?.reason,
          "scorer-candidate-rsvp-read-incomplete",
        );
        return true;
      });
      assert.equal(harness.authGetUsersCalls.length, 0);
    });

    await t.test("101 RSVP records", async () => {
      const rsvps = Object.fromEntries(
        Array.from({ length: 101 }, (_, index) => [
          `teams/team-1/games/game-1/rsvps/scorer-${String(index).padStart(3, "0")}`,
          { response: "maybe" },
        ]),
      );
      const harness = createHarness({
        documents: {
          "teams/team-1": {
            ...baseDocuments()["teams/team-1"],
            teamPermissions: { scorekeeping: { mode: "all_confirmed" } },
          },
          ...rsvps,
        },
      });
      await activate(harness);

      await assert.rejects(listScorerCandidates(harness), (error) => {
        assert.equal(error.code, "failed-precondition");
        assert.equal(error.details?.reason, "scorer-candidate-rsvp-overflow");
        return true;
      });
      assert.equal(harness.authGetUsersCalls.length, 0);
    });

    await t.test("partial Auth batch", async () => {
      const harness = createHarness({
        authUsers: {
          "confirmed-1": { uid: "confirmed-1", disabled: false },
          "confirmed-2": { uid: "confirmed-2", disabled: false },
        },
        documents: {
          "teams/team-1": {
            ...baseDocuments()["teams/team-1"],
            teamPermissions: { scorekeeping: { mode: "all_confirmed" } },
          },
          "teams/team-1/games/game-1/rsvps/confirmed-1": {
            response: "confirmed",
          },
          "teams/team-1/games/game-1/rsvps/confirmed-2": {
            response: "confirmed",
          },
        },
        getUsersHook({ result }) {
          return { users: result.users.slice(0, 1), notFound: [] };
        },
      });
      await activate(harness);

      await assert.rejects(listScorerCandidates(harness), (error) => {
        assert.equal(error.code, "unavailable");
        assert.equal(
          error.details?.reason,
          "scorer-candidate-auth-result-incomplete",
        );
        return true;
      });
    });
  });

  it("uses stable selected-mode candidates without reading any RSVP collection", async () => {
    const harness = createHarness({
      authUsers: {
        "selected-2": {
          uid: "selected-2",
          disabled: false,
          displayName: "Selected Two",
        },
      },
      documents: {
        "teams/team-1": {
          ...baseDocuments()["teams/team-1"],
          teamPermissions: {
            scorekeeping: {
              mode: "selected",
              memberIds: ["scorer-1", "selected-2"],
            },
          },
        },
        "teams/team-1/games/game-1/rsvps/unrelated": {
          response: "confirmed",
        },
      },
    });
    await activate(harness);
    harness.firestore.queryReads = [];
    harness.firestore.queryHook = (query) => {
      if (query.path === paths("team-1", "game-1").rsvps) {
        throw new Error("selected mode must not enumerate RSVPs");
      }
    };

    const result = await listScorerCandidates(harness);

    assert.deepEqual(result.candidates, [
      { playerId: "scorer-1", name: "scorer-1" },
      { playerId: "selected-2", name: "Selected Two" },
    ]);
    assert.equal(
      harness.firestore.queryReads.some(
        (query) => query.path === paths("team-1", "game-1").rsvps,
      ),
      false,
    );
  });

  it("removes the current holder before enforcing the selected-mode candidate bound", async (t) => {
    function selectedHarness(targetCount) {
      const targetUids = Array.from(
        { length: targetCount },
        (_, index) => `selected-${String(index).padStart(3, "0")}`,
      );
      return {
        targetUids,
        harness: createHarness({
          authUsers: Object.fromEntries(
            targetUids.map((uid) => [uid, { uid, disabled: false }]),
          ),
          documents: {
            "teams/team-1": {
              ...baseDocuments()["teams/team-1"],
              teamPermissions: {
                scorekeeping: {
                  mode: "selected",
                  memberIds: ["manager-1", ...targetUids],
                },
              },
            },
          },
        }),
      };
    }

    await t.test("100 candidates after holder removal", async () => {
      const { harness, targetUids } = selectedHarness(100);
      await activate(harness);

      const result = await listScorerCandidates(harness);

      assert.equal(result.complete, true);
      assert.equal(result.candidates.length, 100);
      assert.deepEqual(
        result.candidates.map((candidate) => candidate.playerId),
        targetUids,
      );
      assert.equal(harness.authGetUsersCalls.length, 1);
      assert.equal(harness.authGetUsersCalls[0].length, 100);
    });

    await t.test("101 candidates after holder removal", async () => {
      const { harness } = selectedHarness(101);
      await activate(harness);

      await assert.rejects(listScorerCandidates(harness), (error) => {
        assert.equal(error.code, "failed-precondition");
        assert.equal(error.details?.reason, "scorer-candidate-overflow");
        return true;
      });
      assert.equal(harness.authGetUsersCalls.length, 0);
    });
  });

  it("rechecks Auth, access, candidate grants, revision, and lease after the account batch", async (t) => {
    function confirmedHarness(overrides = {}) {
      return createHarness({
        authUsers: {
          target: { uid: "target", disabled: false },
          ...(overrides.authUsers || {}),
        },
        documents: {
          "teams/team-1": {
            ...baseDocuments()["teams/team-1"],
            teamPermissions: { scorekeeping: { mode: "all_confirmed" } },
          },
          "teams/team-1/games/game-1/rsvps/target": {
            response: "confirmed",
          },
          ...(overrides.documents || {}),
        },
        ...overrides,
      });
    }

    await t.test("caller Auth revocation", async () => {
      const harness = confirmedHarness({
        getUsersHook({ authUsers }) {
          authUsers.set("manager-1", {
            ...authUsers.get("manager-1"),
            disabled: true,
          });
        },
      });
      await activate(harness);
      await assert.rejects(
        listScorerCandidates(harness),
        (error) => error.code === "permission-denied",
      );
    });

    await t.test("confirmed RSVP revocation", async () => {
      const harness = confirmedHarness({
        getUsersHook({ firestore }) {
          firestore.seed(paths("team-1", "game-1").rsvp("target"), {
            response: "declined",
          });
        },
      });
      await activate(harness);
      await assert.rejects(listScorerCandidates(harness), (error) => {
        assert.equal(error.code, "aborted");
        assert.equal(
          error.details?.reason,
          "scorer-candidate-source-changed",
        );
        return true;
      });
    });

    await t.test("revision race", async () => {
      const harness = confirmedHarness({
        getUsersHook({ firestore }) {
          const resourcePaths = paths("team-1", "game-1");
          const root = firestore.read(resourcePaths.scorebook);
          firestore.seed(resourcePaths.scorebook, {
            ...root,
            checkpoint: { ...root.checkpoint, sequence: 2 },
          });
        },
      });
      await activate(harness);
      await assert.rejects(listScorerCandidates(harness), (error) => {
        assert.equal(error.code, "aborted");
        assert.equal(error.details?.reason, "stale-revision");
        return true;
      });
    });

    await t.test("lease race", async () => {
      const harness = confirmedHarness({
        getUsersHook({ firestore }) {
          const resourcePaths = paths("team-1", "game-1");
          const root = firestore.read(resourcePaths.scorebook);
          firestore.seed(resourcePaths.scorebook, {
            ...root,
            scorerLease: {
              ...root.scorerLease,
              leaseId: makeUuid(399),
            },
          });
        },
      });
      await activate(harness);
      await assert.rejects(listScorerCandidates(harness), (error) => {
        assert.equal(error.code, "unavailable");
        assert.equal(error.details?.reason, "lease-token-mismatch");
        return true;
      });
    });
  });

  it("keeps the final handoff mutation authoritative after a candidate RSVP is revoked", async () => {
    const harness = createHarness({
      authUsers: {
        target: { uid: "target", disabled: false, displayName: "Target" },
      },
      documents: {
        "teams/team-1": {
          ...baseDocuments()["teams/team-1"],
          teamPermissions: { scorekeeping: { mode: "all_confirmed" } },
        },
        "teams/team-1/games/game-1/rsvps/target": {
          response: "confirmed",
        },
      },
    });
    await activate(harness);
    const listed = await listScorerCandidates(harness);
    assert.deepEqual(listed.candidates, [
      { playerId: "target", name: "Target" },
    ]);

    harness.firestore.seed(paths("team-1", "game-1").rsvp("target"), {
      response: "declined",
    });
    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(398),
        expectedRevision: 1,
        type: "scorer_handoff",
        payload: { toUid: "target" },
      }),
      (error) =>
        error.code === "failed-precondition" &&
        /current scoring access/i.test(error.message),
    );
  });

  it("does not enumerate game RSVPs while loading ordinary score snapshots", async () => {
    const harness = createHarness({
      documents: {
        "teams/team-1": {
          ...baseDocuments()["teams/team-1"],
          teamPermissions: { scorekeeping: { mode: "all_confirmed" } },
        },
      },
    });
    await activate(harness);
    harness.firestore.queryReads = [];

    await harness.handlers.getDiamondState(
      { teamId: "team-1", gameId: "game-1", visibility: "private" },
      harness.managerContext,
    );

    assert.equal(
      harness.firestore.queryReads.some(
        (query) => query.path === paths("team-1", "game-1").rsvps,
      ),
      false,
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
        {
          requestId: makeUuid(479),
          teamId: "team-1",
          gameId: "game-1",
        },
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
        fielding: { assists: ["away-1"] },
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
    let revokeDuringHistory = false;
    harness.firestore.queryHook = (query) => {
      if (query.path !== resourcePaths.events) return;
      canonicalEventReads += 1;
      if (revokeDuringHistory) {
        revokeDuringHistory = false;
        const team = harness.firestore.read("teams/team-1");
        harness.firestore.seed("teams/team-1", {
          ...team,
          ownerId: "replacement-manager",
        });
      }
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

    revokeDuringHistory = true;
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

  it("rejects every full-history command from a non-holder before reading the ledger", async () => {
    const cases = [
      [
        "record_fielding",
        {
          playEventId: makeUuid(24),
          fielding: { putoutBy: "home-1", battedBall: "ground" },
        },
      ],
      [
        "record_scoring_judgment",
        { playEventId: makeUuid(24), runnerId: "away-1", earned: true },
      ],
      [
        "void_event",
        { targetEventId: makeUuid(24), reason: "Official scoring correction" },
      ],
      [
        "supersede_event",
        {
          targetEventId: makeUuid(24),
          reason: "Official scoring replacement",
          replacement: {
            type: "record_pitch",
            payload: {
              batterId: "away-1",
              pitcherId: "home-1",
              result: "ball",
            },
          },
        },
      ],
      [
        "reopen_for_correction",
        { reason: "The official scorer must correct the book." },
      ],
      ["finalize", { confirmed: true }],
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const [type, payload] = cases[index];
      const harness = createHarness();
      await activate(harness);
      await startGame(harness);
      const resourcePaths = paths("team-1", "game-1");
      let historyReads = 0;
      harness.firestore.queryHook = (query) => {
        if (query.path === resourcePaths.events) historyReads += 1;
      };

      await assert.rejects(
        submit(harness, {
          commandId: makeUuid(1_000 + index),
          expectedRevision: 6,
          type,
          payload,
          context: harness.scorerContext,
        }),
        (error) =>
          error.code === "unavailable" &&
          error.details?.reason === "lease-held-by-other",
        type,
      );
      assert.equal(historyReads, 0, type);
      assert.equal(
        managerStatReadControls(harness, "diamond-command-history-admission")
          .length,
        0,
        type,
      );
    }
  });

  it("admits through one hash-only UID/game counter with maxAttempts one and a bounded query", async () => {
    const harness = createHarness();
    await activate(harness);
    await startGame(harness);
    const resourcePaths = paths("team-1", "game-1");
    harness.firestore.seed(`${resourcePaths.events}/uncommitted-extra`, {
      sequence: 7,
      revision: 7,
      privatePayload: "must not be read past the captured head",
    });
    let historyRows = null;
    harness.firestore.queryHook = (query, snapshot) => {
      if (query.path === resourcePaths.events) historyRows = snapshot.size;
    };

    const result = await submit(harness, {
      commandId: makeUuid(1_010),
      expectedRevision: 6,
      type: "record_fielding",
      payload: {
        playEventId: makeUuid(24),
        fielding: { putoutBy: "home-1" },
      },
    });
    assert.equal(result.outcome, "rejected");
    assert.equal(historyRows, 6);
    const control = commandHistoryAdmission(harness);
    assert.match(
      control.path,
      /^diamondManagerStatReadControls\/command-admission-[0-9a-f]{64}$/,
    );
    assert.deepEqual(Object.keys(control.value).sort(), [
      "expiresAt",
      "readUnits",
      "requestCount",
      "schemaVersion",
      "scopeHash",
      "sustainedReadUnits",
      "sustainedRequestCount",
      "sustainedWindowResetAtMs",
      "sustainedWindowStartedAtMs",
      "type",
      "updatedAtMs",
      "windowResetAtMs",
      "windowStartedAtMs",
    ]);
    assert.equal(control.value.requestCount, 1);
    assert.equal(control.value.readUnits, 6);
    assert.equal(control.value.sustainedRequestCount, 1);
    assert.equal(control.value.sustainedReadUnits, 6);
    assert.doesNotMatch(
      JSON.stringify({ path: control.path, value: control.value }),
      /manager-1|team-1|game-1|00000000-/,
    );
    assert.ok(
      harness.firestore.transactionOptions.some(
        (options) => options?.maxAttempts === 1,
      ),
    );
    const historyQuery = harness.firestore.queryReads.find(
      ({ path }) => path === resourcePaths.events,
    );
    assert.deepEqual(
      historyQuery.filters.find(({ operator }) => operator === "<="),
      { field: "sequence", operator: "<=", value: 6 },
    );

    const beforeStale = clone(control.value);
    const readsBeforeStale = harness.firestore.queryReads.length;
    const stale = await submit(harness, {
      commandId: makeUuid(1_011),
      expectedRevision: 5,
      type: "record_fielding",
      payload: {
        playEventId: makeUuid(24),
        fielding: { putoutBy: "home-1" },
      },
    });
    assert.equal(stale.rejection.code, "stale-revision");
    assert.deepEqual(commandHistoryAdmission(harness).value, beforeStale);
    assert.equal(harness.firestore.queryReads.length, readsBeforeStale);

    await submit(harness, {
      commandId: makeUuid(1_012),
      expectedRevision: 6,
      type: "record_pitch",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "ball",
      },
    });
    assert.deepEqual(commandHistoryAdmission(harness).value, beforeStale);
  });

  it("charges the captured head and stops pagination without an uncharged tail query", async () => {
    const cases = [
      { label: "zero head", head: 0, storedRows: 0, pageSizes: [] },
      { label: "single row", head: 1, storedRows: 1, pageSizes: [1] },
      { label: "exact page", head: 200, storedRows: 200, pageSizes: [200] },
      {
        label: "partial tail",
        head: 201,
        storedRows: 201,
        pageSizes: [200, 1],
      },
      { label: "empty tail", head: 201, storedRows: 200, pageSizes: [200, 0] },
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const { label, head, storedRows, pageSizes } = cases[index];
      const harness = createHarness();
      await activate(harness);
      await startGame(harness);
      const resourcePaths = paths("team-1", "game-1");
      const root = harness.firestore.read(resourcePaths.scorebook);
      if (head === 0) {
        const firstEvent = directCollectionDocuments(
          harness.firestore,
          resourcePaths.events,
        ).find(({ value }) => value.sequence === 1).value;
        root.checkpoint = {
          sequence: 0,
          previousHash: firstEvent.previousHash,
          state: clone(root.initialState),
        };
      } else {
        root.checkpoint = {
          ...root.checkpoint,
          sequence: head,
          state: { ...root.checkpoint.state, revision: head },
        };
        for (let sequence = 7; sequence <= storedRows; sequence += 1) {
          harness.firestore.seed(
            `${resourcePaths.events}/synthetic-${String(sequence).padStart(6, "0")}`,
            { sequence, revision: sequence },
          );
        }
      }
      harness.firestore.seed(resourcePaths.scorebook, root);
      const observedPageSizes = [];
      harness.firestore.queryHook = (query, snapshot) => {
        if (query.path === resourcePaths.events) {
          observedPageSizes.push(snapshot.size);
        }
      };

      const response = await submit(harness, {
        commandId: makeUuid(1_013 + index),
        expectedRevision: head,
        type: "record_fielding",
        payload: {
          playEventId: makeUuid(24),
          fielding: { putoutBy: "home-1" },
        },
      }).catch((error) => error);
      if (head === 0) assert.equal(response.outcome, "rejected", label);
      else assert.ok(response instanceof Error, label);
      assert.deepEqual(observedPageSizes, pageSizes, label);
      const control = commandHistoryAdmission(harness).value;
      assert.equal(control.readUnits, Math.max(1, head), label);
      assert.equal(control.sustainedReadUnits, Math.max(1, head), label);
      const minimumBilledReads = observedPageSizes.reduce(
        (total, size) => total + Math.max(1, size),
        0,
      );
      assert.ok(minimumBilledReads <= control.readUnits, label);
      const historyQueries = harness.firestore.queryReads.filter(
        ({ path }) => path === resourcePaths.events,
      );
      assert.ok(
        historyQueries.every(({ maximum }) => maximum <= Math.max(1, head)),
        label,
      );
      for (const query of historyQueries) {
        assert.deepEqual(
          query.filters.find(({ operator }) => operator === "<="),
          { field: "sequence", operator: "<=", value: head },
          label,
        );
      }
    }
  });

  it("enforces the intended 20k replay envelope without breaking exact receipts", async () => {
    const harness = createHarness();
    await activate(harness);
    await startGame(harness);
    const resourcePaths = paths("team-1", "game-1");
    const pitch = await submit(harness, {
      commandId: makeUuid(1_017),
      expectedRevision: 6,
      type: "record_pitch",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "ball",
      },
    });
    const receiptCommand = {
      commandId: makeUuid(1_018),
      expectedRevision: 7,
      type: "void_event",
      payload: {
        targetEventId: pitch.eventId,
        reason: "The pitch was never delivered.",
      },
    };
    assert.equal((await submit(harness, receiptCommand)).outcome, "accepted");
    const charged = clone(commandHistoryAdmission(harness).value);
    let root = harness.firestore.read(resourcePaths.scorebook);
    root.checkpoint = {
      ...root.checkpoint,
      sequence: 20_001,
      state: { ...root.checkpoint.state, revision: 20_001 },
    };
    harness.firestore.seed(resourcePaths.scorebook, root);
    let historyReads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) historyReads += 1;
    };

    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(1_019),
        expectedRevision: 20_001,
        type: "record_fielding",
        payload: {
          playEventId: pitch.eventId,
          fielding: { putoutBy: "home-1" },
        },
      }),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "command-history-replay-bound-exceeded" &&
        error.details?.maximumEvents === 20_000,
    );
    assert.equal(historyReads, 0);
    assert.deepEqual(commandHistoryAdmission(harness).value, charged);

    const duplicate = await submit(harness, receiptCommand);
    assert.equal(duplicate.outcome, "duplicate");
    assert.equal(historyReads, 0);
    assert.deepEqual(commandHistoryAdmission(harness).value, charged);

    root = harness.firestore.read(resourcePaths.scorebook);
    root.checkpoint = {
      ...root.checkpoint,
      sequence: 20_000,
      state: { ...root.checkpoint.state, revision: 20_000 },
    };
    harness.firestore.seed(resourcePaths.scorebook, root);
    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(1_020),
        expectedRevision: 20_000,
        type: "record_fielding",
        payload: {
          playEventId: pitch.eventId,
          fielding: { putoutBy: "home-1" },
        },
      }),
      (error) => error.code === "unavailable",
    );
    assert.equal(historyReads, 1);
    const atLimit = commandHistoryAdmission(harness).value;
    assert.equal(atLimit.readUnits, charged.readUnits + 20_000);
    const boundedQuery = harness.firestore.queryReads
      .filter(({ path }) => path === resourcePaths.events)
      .at(-1);
    assert.deepEqual(
      boundedQuery.filters.find(({ operator }) => operator === "<="),
      { field: "sequence", operator: "<=", value: 20_000 },
    );
  });

  it("serializes fresh IDs at burst, sustained, and weighted admission limits", async () => {
    let nowMs = 1_750_000_000_000;
    const harness = createHarness({ clock: () => nowMs });
    await activate(harness);
    await startGame(harness);
    const resourcePaths = paths("team-1", "game-1");
    let historyReads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) historyReads += 1;
    };
    const request = (index) =>
      submit(harness, {
        commandId: makeUuid(index),
        expectedRevision: 6,
        type: "record_fielding",
        payload: {
          playEventId: makeUuid(24),
          fielding: { putoutBy: "home-1" },
        },
      });

    assert.equal((await request(1_020)).outcome, "rejected");
    let control = commandHistoryAdmission(harness);
    harness.firestore.seed(control.path, {
      ...control.value,
      requestCount: MAX_COMMAND_HISTORY_REQUESTS_PER_WINDOW - 1,
      readUnits: MAX_COMMAND_HISTORY_READ_UNITS_PER_WINDOW - 6,
      sustainedRequestCount: MAX_COMMAND_HISTORY_REQUESTS_PER_WINDOW - 1,
      sustainedReadUnits: MAX_COMMAND_HISTORY_READ_UNITS_PER_WINDOW - 6,
    });
    const burst = await Promise.allSettled([
      request(1_021),
      request(1_022),
      request(1_023),
    ]);
    assert.equal(
      burst.filter(({ status }) => status === "fulfilled").length,
      1,
    );
    for (const rejected of burst.filter(
      ({ status }) => status === "rejected",
    )) {
      assert.equal(rejected.reason.code, "resource-exhausted");
      assert.equal(
        rejected.reason.details?.reason,
        "command-history-rate-limited",
      );
    }
    control = commandHistoryAdmission(harness);
    assert.equal(
      control.value.requestCount,
      MAX_COMMAND_HISTORY_REQUESTS_PER_WINDOW,
    );
    assert.equal(
      control.value.readUnits,
      MAX_COMMAND_HISTORY_READ_UNITS_PER_WINDOW,
    );
    assert.equal(historyReads, 2);

    nowMs += COMMAND_HISTORY_RATE_WINDOW_MS + 1;
    harness.firestore.commitTimestampMs = nowMs;
    harness.firestore.seed(control.path, {
      ...control.value,
      sustainedRequestCount:
        MAX_COMMAND_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW - 1,
      sustainedReadUnits:
        MAX_COMMAND_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW - 6,
    });
    const sustained = await Promise.allSettled([
      request(1_024),
      request(1_025),
    ]);
    assert.deepEqual(
      sustained.map(({ status }) => status),
      ["fulfilled", "rejected"],
    );
    assert.equal(sustained[1].reason.code, "resource-exhausted");
    control = commandHistoryAdmission(harness);
    assert.equal(
      control.value.sustainedRequestCount,
      MAX_COMMAND_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW,
    );
    assert.equal(
      control.value.sustainedReadUnits,
      MAX_COMMAND_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW,
    );
    assert.equal(historyReads, 3);
  });

  it("bounds aligned minute and sustained-window boundary bursts", async () => {
    const sustainedStartMs = COMMAND_HISTORY_SUSTAINED_WINDOW_MS * 3_000;
    let nowMs = sustainedStartMs + 8 * COMMAND_HISTORY_RATE_WINDOW_MS + 1;
    const harness = createHarness({ clock: () => nowMs });
    harness.firestore.commitTimestampMs = nowMs;
    await activate(harness);
    await startGame(harness);
    const resourcePaths = paths("team-1", "game-1");
    const root = harness.firestore.read(resourcePaths.scorebook);
    root.checkpoint = {
      ...root.checkpoint,
      sequence: 20_000,
      state: { ...root.checkpoint.state, revision: 20_000 },
    };
    harness.firestore.seed(resourcePaths.scorebook, root);
    let historyReads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) historyReads += 1;
    };
    harness.firestore.transactionHook = (phase, transaction) => {
      if (
        phase === "beforeCommit" &&
        transaction?.operations?.some(
          ({ value }) => value?.type === "diamond-command-history-admission",
        )
      ) {
        return "retry-after-commit";
      }
    };
    let nextId = 1_110;
    const attempt = () =>
      submit(harness, {
        commandId: makeUuid(nextId++),
        expectedRevision: 20_000,
        type: "record_fielding",
        payload: {
          playEventId: makeUuid(24),
          fielding: { putoutBy: "home-1" },
        },
      });
    const admitWithoutHistory = async (count) => {
      for (let index = 0; index < count; index += 1) {
        await assert.rejects(
          attempt(),
          (error) =>
            error.code === "unavailable" &&
            error.details?.reason === "command-history-admission-unconfirmed",
        );
      }
    };
    const rejectAtLimit = () =>
      assert.rejects(
        attempt(),
        (error) =>
          error.code === "resource-exhausted" &&
          error.details?.reason === "command-history-rate-limited",
      );

    // The previous sustained window reaches 120k over two aligned minutes.
    await admitWithoutHistory(2);
    nowMs = sustainedStartMs + COMMAND_HISTORY_SUSTAINED_WINDOW_MS - 1;
    harness.firestore.commitTimestampMs = nowMs;
    await admitWithoutHistory(4);
    await rejectAtLimit();
    let control = commandHistoryAdmission(harness).value;
    assert.equal(control.readUnits, 80_000);
    assert.equal(control.sustainedReadUnits, 120_000);
    assert.equal(
      control.windowStartedAtMs,
      sustainedStartMs + 9 * COMMAND_HISTORY_RATE_WINDOW_MS,
    );
    assert.equal(control.sustainedWindowStartedAtMs, sustainedStartMs);

    // Both counters reset exactly at the shared 10m/minute boundary. Four
    // recovery attempts fit; the next minute adds only 40k before the new
    // sustained window closes, for 240k across the two adjacent 10m windows.
    nowMs = sustainedStartMs + COMMAND_HISTORY_SUSTAINED_WINDOW_MS;
    harness.firestore.commitTimestampMs = nowMs;
    await admitWithoutHistory(4);
    nowMs += COMMAND_HISTORY_RATE_WINDOW_MS;
    harness.firestore.commitTimestampMs = nowMs;
    await admitWithoutHistory(2);
    await rejectAtLimit();
    control = commandHistoryAdmission(harness).value;
    assert.equal(control.requestCount, 2);
    assert.equal(control.readUnits, 40_000);
    assert.equal(control.sustainedRequestCount, 6);
    assert.equal(control.sustainedReadUnits, 120_000);
    assert.equal(
      control.windowStartedAtMs,
      sustainedStartMs +
        COMMAND_HISTORY_SUSTAINED_WINDOW_MS +
        COMMAND_HISTORY_RATE_WINDOW_MS,
    );
    assert.equal(
      control.sustainedWindowStartedAtMs,
      sustainedStartMs + COMMAND_HISTORY_SUSTAINED_WINDOW_MS,
    );
    assert.equal(historyReads, 0);
  });

  it("atomically bounds shallow replay admissions across aligned windows", async () => {
    const sustainedStartMs = COMMAND_HISTORY_SUSTAINED_WINDOW_MS * 3_100;
    let nowMs = sustainedStartMs + 5 * COMMAND_HISTORY_RATE_WINDOW_MS + 1;
    const harness = createHarness({ clock: () => nowMs });
    harness.firestore.commitTimestampMs = nowMs;
    await activate(harness);
    await startGame(harness);
    const resourcePaths = paths("team-1", "game-1");
    let historyReads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) historyReads += 1;
    };
    harness.firestore.transactionHook = (phase, transaction) => {
      if (
        phase === "beforeCommit" &&
        transaction?.operations?.some(
          ({ value }) => value?.type === "diamond-command-history-admission",
        )
      ) {
        return "retry-after-commit";
      }
    };
    let nextId = 1_130;
    const attempt = () =>
      submit(harness, {
        commandId: makeUuid(nextId++),
        expectedRevision: 6,
        type: "record_fielding",
        payload: {
          playEventId: makeUuid(24),
          fielding: { putoutBy: "home-1" },
        },
      });
    const admitConcurrently = async () => {
      const outcomes = await Promise.allSettled(
        Array.from(
          { length: MAX_COMMAND_HISTORY_REQUESTS_PER_WINDOW },
          attempt,
        ),
      );
      assert.ok(
        outcomes.every(
          ({ status, reason }) =>
            status === "rejected" &&
            reason.code === "unavailable" &&
            reason.details?.reason === "command-history-admission-unconfirmed",
        ),
      );
    };
    const rejectAtLimit = () =>
      assert.rejects(
        attempt(),
        (error) =>
          error.code === "resource-exhausted" &&
          error.details?.reason === "command-history-rate-limited",
      );

    for (let minute = 5; minute < 9; minute += 1) {
      nowMs = sustainedStartMs + minute * COMMAND_HISTORY_RATE_WINDOW_MS + 1;
      harness.firestore.commitTimestampMs = nowMs;
      await admitConcurrently();
      await rejectAtLimit();
    }
    assert.equal(
      commandHistoryAdmission(harness).value.sustainedRequestCount,
      MAX_COMMAND_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW,
    );
    nowMs = sustainedStartMs + 9 * COMMAND_HISTORY_RATE_WINDOW_MS + 1;
    harness.firestore.commitTimestampMs = nowMs;
    await rejectAtLimit();

    for (let minute = 10; minute < 14; minute += 1) {
      nowMs = sustainedStartMs + minute * COMMAND_HISTORY_RATE_WINDOW_MS + 1;
      harness.firestore.commitTimestampMs = nowMs;
      await admitConcurrently();
      await rejectAtLimit();
    }
    nowMs = sustainedStartMs + 14 * COMMAND_HISTORY_RATE_WINDOW_MS + 1;
    harness.firestore.commitTimestampMs = nowMs;
    await rejectAtLimit();
    const control = commandHistoryAdmission(harness).value;
    assert.equal(
      control.sustainedRequestCount,
      MAX_COMMAND_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW,
    );
    assert.equal(MAX_COMMAND_HISTORY_REQUESTS_PER_WINDOW * 2, 32);
    assert.equal(MAX_COMMAND_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW * 2, 128);
    assert.equal(historyReads, 0);
  });

  it("fails malformed admission state closed until its quarantine expires", async () => {
    let nowMs = 1_750_000_000_000;
    const harness = createHarness({ clock: () => nowMs });
    await activate(harness);
    await startGame(harness);
    const resourcePaths = paths("team-1", "game-1");
    let historyReads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) historyReads += 1;
    };
    const command = (index) => ({
      commandId: makeUuid(index),
      expectedRevision: 6,
      type: "record_fielding",
      payload: {
        playEventId: makeUuid(24),
        fielding: { putoutBy: "home-1" },
      },
    });
    await submit(harness, command(1_030));
    const control = commandHistoryAdmission(harness);
    const invalidControls = [
      {
        ...control.value,
        requestCount: 0,
        readUnits: 0,
      },
      {
        ...control.value,
        sustainedRequestCount: 0,
        sustainedReadUnits: 0,
      },
      {
        ...control.value,
        requestCount: 1,
        readUnits: 20_001,
        sustainedRequestCount: 1,
        sustainedReadUnits: 20_001,
      },
      {
        ...control.value,
        windowStartedAtMs: control.value.windowStartedAtMs + 1,
        windowResetAtMs: control.value.windowResetAtMs + 1,
      },
      {
        ...control.value,
        updatedAtMs: control.value.windowResetAtMs,
      },
      {
        ...control.value,
        callerUid: "manager-1",
      },
    ];
    for (let index = 0; index < invalidControls.length; index += 1) {
      harness.firestore.seed(control.path, invalidControls[index]);
      await assert.rejects(
        submit(harness, command(1_031 + index)),
        (error) =>
          error.code === "unavailable" &&
          error.details?.reason === "command-history-control-invalid",
      );
    }
    assert.equal(historyReads, 1);

    nowMs += COMMAND_HISTORY_CONTROL_QUARANTINE_MS + 1;
    harness.firestore.commitTimestampMs = nowMs;
    const recovered = await submit(harness, command(1_039));
    assert.equal(recovered.outcome, "rejected");
    assert.equal(historyReads, 2);
    const replacement = commandHistoryAdmission(harness).value;
    assert.equal(replacement.callerUid, undefined);
    assert.equal(replacement.requestCount, 1);
    assert.equal(replacement.readUnits, 6);
  });

  it("never reads history after an ambiguous or unexpectedly retried admission", async () => {
    for (const mode of ["ambiguous", "enabled", "disabled", "deleted"]) {
      const harness = createHarness();
      await activate(harness);
      await startGame(harness);
      const resourcePaths = paths("team-1", "game-1");
      let historyReads = 0;
      let injected = false;
      harness.firestore.queryHook = (query) => {
        if (query.path === resourcePaths.events) historyReads += 1;
      };
      harness.firestore.transactionHook = (phase, transaction) => {
        const admissionWrite = transaction?.operations?.some(
          ({ value }) => value?.type === "diamond-command-history-admission",
        );
        if (phase === "beforeCommit" && admissionWrite && !injected) {
          injected = true;
          return mode === "ambiguous"
            ? "retry-after-commit"
            : "force-retry-after-commit";
        }
        if (phase === "afterRetryableCommit" && mode === "disabled") {
          harness.authUsers.get("manager-1").disabled = true;
        }
        if (phase === "afterRetryableCommit" && mode === "deleted") {
          harness.authUsers.delete("manager-1");
        }
      };

      await assert.rejects(
        submit(harness, {
          commandId: makeUuid(
            1_040 +
              ["ambiguous", "enabled", "disabled", "deleted"].indexOf(mode),
          ),
          expectedRevision: 6,
          type: "record_fielding",
          payload: {
            playEventId: makeUuid(24),
            fielding: { putoutBy: "home-1" },
          },
        }),
        (error) => {
          if (mode === "disabled" || mode === "deleted") {
            return error.code === "permission-denied";
          }
          return (
            error.code === "unavailable" &&
            [
              "command-history-admission-retried",
              "command-history-admission-unconfirmed",
            ].includes(error.details?.reason)
          );
        },
        mode,
      );
      assert.equal(injected, true, mode);
      assert.equal(historyReads, 0, mode);
      const control = commandHistoryAdmission(harness).value;
      assert.equal(control.requestCount, 1, mode);
      assert.equal(control.readUnits, 6, mode);
      assert.equal(
        harness.firestore.read(
          resourcePaths.command(
            makeUuid(
              1_040 +
                ["ambiguous", "enabled", "disabled", "deleted"].indexOf(mode),
            ),
          ),
        ),
        undefined,
        mode,
      );
      assert.ok(
        harness.firestore.transactionOptions.some(
          (options) => options?.maxAttempts === 1,
        ),
        mode,
      );
    }
  });

  it("keeps exact and conflicting committed retries receipt-first and uncharged", async () => {
    const harness = createHarness();
    await activate(harness);
    await startGame(harness);
    const pitch = await submit(harness, {
      commandId: makeUuid(1_050),
      expectedRevision: 6,
      type: "record_pitch",
      payload: {
        batterId: "away-1",
        pitcherId: "home-1",
        result: "ball",
      },
    });
    const resourcePaths = paths("team-1", "game-1");
    const command = {
      commandId: makeUuid(1_051),
      expectedRevision: 7,
      type: "void_event",
      leaseId: harness.firestore.read(resourcePaths.scorebook).scorerLease
        .leaseId,
      payload: {
        targetEventId: pitch.eventId,
        reason: "The pitch was never delivered.",
      },
    };
    let historyReads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) historyReads += 1;
    };
    const accepted = await submit(harness, command);
    assert.equal(accepted.outcome, "accepted");
    const charged = clone(commandHistoryAdmission(harness).value);

    harness.firestore.seed("securityPolicies/diamondScorebook", {
      mode: "disabled",
      revision: 2,
      teamIds: [],
    });
    const root = harness.firestore.read(resourcePaths.scorebook);
    root.scorerLease = {
      ...root.scorerLease,
      holderUid: "scorer-1",
      leaseId: makeUuid(1_052),
    };
    harness.firestore.seed(resourcePaths.scorebook, root);
    const duplicate = await submit(harness, command);
    assert.equal(duplicate.outcome, "duplicate");
    const conflict = await submit(harness, {
      ...command,
      payload: {
        ...command.payload,
        reason: "A different correction using the same command ID.",
      },
    });
    assert.equal(conflict.outcome, "rejected");
    assert.equal(conflict.rejection.code, "idempotency-conflict");
    assert.equal(historyReads, 1);
    assert.deepEqual(commandHistoryAdmission(harness).value, charged);

    harness.authUsers.get("manager-1").disabled = true;
    await assert.rejects(
      submit(harness, command),
      (error) => error.code === "permission-denied",
    );
    assert.equal(historyReads, 1);
  });

  it("rechecks Auth, access, policy, lease, and the full source after history", async () => {
    const races = ["auth", "access", "policy", "lease", "source", "head"];
    for (const race of races) {
      const harness = createHarness();
      await activate(harness);
      await startGame(harness);
      const resourcePaths = paths("team-1", "game-1");
      let historyReads = 0;
      harness.firestore.queryHook = (query) => {
        if (query.path !== resourcePaths.events) return;
        historyReads += 1;
        if (race === "auth") {
          harness.authUsers.get("manager-1").disabled = true;
        } else if (race === "access") {
          const team = harness.firestore.read(resourcePaths.team);
          harness.firestore.seed(resourcePaths.team, {
            ...team,
            ownerId: "replacement-manager",
          });
        } else if (race === "policy") {
          harness.firestore.seed("securityPolicies/diamondScorebook", {
            mode: "disabled",
            revision: 2,
            teamIds: [],
          });
        } else {
          const root = harness.firestore.read(resourcePaths.scorebook);
          if (race === "lease") {
            root.scorerLease = {
              ...root.scorerLease,
              holderUid: "scorer-1",
              leaseId: makeUuid(1_060),
            };
          } else if (race === "source") {
            root.captureMode = "standard";
          } else {
            root.checkpoint = {
              ...root.checkpoint,
              sequence: root.checkpoint.sequence + 1,
              state: {
                ...root.checkpoint.state,
                revision: root.checkpoint.state.revision + 1,
              },
            };
          }
          harness.firestore.seed(resourcePaths.scorebook, root);
        }
      };
      const commandId = makeUuid(1_061 + races.indexOf(race));
      await assert.rejects(
        submit(harness, {
          commandId,
          expectedRevision: 6,
          type: "record_fielding",
          payload: {
            playEventId: makeUuid(24),
            fielding: { putoutBy: "home-1" },
          },
        }),
        (error) => {
          if (race === "auth" || race === "access") {
            return error.code === "permission-denied";
          }
          if (race === "policy") return error.code === "failed-precondition";
          if (race === "lease") {
            return (
              error.code === "unavailable" &&
              error.details?.reason === "lease-held-by-other"
            );
          }
          return (
            error.code === "aborted" &&
            error.details?.reason === "command-history-source-changed"
          );
        },
        race,
      );
      assert.equal(historyReads, 1, race);
      assert.equal(
        harness.firestore.read(resourcePaths.command(commandId)),
        undefined,
        race,
      );
      assert.equal(
        harness.firestore.countDirectChildren(resourcePaths.events),
        6,
        race,
      );
      assert.equal(commandHistoryAdmission(harness).value.requestCount, 1);
    }
  });

  it("rejects preexisting and in-flight same-head checkpoint corruption", async () => {
    for (const phase of ["before-admission", "during-history"]) {
      const harness = createHarness();
      await activate(harness);
      await startGame(harness);
      const resourcePaths = paths("team-1", "game-1");
      const corrupt = () => {
        const root = harness.firestore.read(resourcePaths.scorebook);
        root.checkpoint.state.score.home = 41;
        harness.firestore.seed(resourcePaths.scorebook, root);
      };
      if (phase === "before-admission") corrupt();
      let historyReads = 0;
      harness.firestore.queryHook = (query) => {
        if (query.path !== resourcePaths.events) return;
        historyReads += 1;
        if (phase === "during-history") corrupt();
      };
      const commandId = makeUuid(phase === "before-admission" ? 1_070 : 1_071);
      await assert.rejects(
        submit(harness, {
          commandId,
          expectedRevision: 6,
          type: "record_fielding",
          payload: {
            playEventId: makeUuid(24),
            fielding: { putoutBy: "home-1" },
          },
        }),
        (error) =>
          error.details?.reason ===
          (phase === "before-admission"
            ? "command-history-checkpoint-state-mismatch"
            : "command-history-source-changed"),
        phase,
      );
      assert.equal(historyReads, 1, phase);
      assert.equal(
        harness.firestore.read(resourcePaths.command(commandId)),
        undefined,
        phase,
      );
      assert.equal(
        harness.firestore.countDirectChildren(resourcePaths.events),
        6,
        phase,
      );
    }
  });

  it("reauthorizes an ambiguously committed final callback and preserves receipt-first recovery", async () => {
    for (const mode of ["disabled", "deleted", "lease-expired"]) {
      let nowMs = 1_750_000_000_000;
      const harness = createHarness({ clock: () => nowMs });
      const eligibleManager = clone(harness.authUsers.get("manager-1"));
      await activate(harness);
      await startGame(harness);
      const pitch = await submit(harness, {
        commandId: makeUuid(1_080),
        expectedRevision: 6,
        type: "record_pitch",
        payload: {
          batterId: "away-1",
          pitcherId: "home-1",
          result: "ball",
        },
      });
      const resourcePaths = paths("team-1", "game-1");
      const commandId = makeUuid(
        1_081 + ["disabled", "deleted", "lease-expired"].indexOf(mode),
      );
      let historyReads = 0;
      let retried = false;
      harness.firestore.queryHook = (query) => {
        if (query.path === resourcePaths.events) historyReads += 1;
      };
      harness.firestore.transactionHook = (phase, transaction) => {
        const writesReceipt = transaction?.operations?.some(
          ({ kind, reference }) =>
            kind === "create" &&
            reference.path === resourcePaths.command(commandId),
        );
        if (phase === "beforeCommit" && writesReceipt && !retried) {
          retried = true;
          return "force-retry-after-commit";
        }
        if (phase === "afterRetryableCommit" && retried) {
          if (mode === "disabled") {
            harness.authUsers.get("manager-1").disabled = true;
          } else if (mode === "deleted") {
            harness.authUsers.delete("manager-1");
          } else {
            nowMs =
              harness.firestore.read(resourcePaths.scorebook).scorerLease
                .expiresAtMillis + 1;
            harness.firestore.commitTimestampMs = nowMs;
          }
        }
      };

      const command = {
        commandId,
        expectedRevision: 7,
        type: "void_event",
        payload: {
          targetEventId: pitch.eventId,
          reason: "The pitch was never delivered.",
        },
      };
      await assert.rejects(
        submit(harness, command),
        (error) =>
          error.code ===
          (mode === "lease-expired" ? "unavailable" : "permission-denied"),
        mode,
      );
      assert.equal(retried, true, mode);
      assert.equal(historyReads, 1, mode);
      assert.ok(harness.firestore.read(resourcePaths.command(commandId)), mode);
      assert.equal(
        harness.firestore.countDirectChildren(resourcePaths.events),
        8,
        mode,
      );

      harness.firestore.transactionHook = null;
      if (mode === "disabled" || mode === "deleted") {
        harness.authUsers.set("manager-1", clone(eligibleManager));
      }
      const recovered = await submit(harness, command);
      assert.equal(recovered.outcome, "duplicate", mode);
      assert.equal(recovered.revision, 8, mode);
      assert.equal(historyReads, 1, mode);
      assert.equal(
        harness.firestore.countDirectChildren(resourcePaths.events),
        8,
        mode,
      );
      assert.equal(commandHistoryAdmission(harness).value.requestCount, 1, mode);
    }
  });

  it("validates policy, lease, and exact source before returning raced receipts", async () => {
    for (const race of ["conflict", "policy", "lease", "head"]) {
      const harness = createHarness();
      await activate(harness);
      await startGame(harness);
      const target = await submit(
        harness,
        race === "policy"
          ? {
              commandId: makeUuid(1_090),
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
            }
          : {
              commandId: makeUuid(1_090),
              expectedRevision: 6,
              type: "record_pitch",
              payload: {
                batterId: "away-1",
                pitcherId: "home-1",
                result: "ball",
              },
            },
      );
      const resourcePaths = paths("team-1", "game-1");
      let releaseWinner;
      let releaseLoser;
      let signalBoth;
      const winnerGate = new Promise((resolve) => {
        releaseWinner = resolve;
      });
      const loserGate = new Promise((resolve) => {
        releaseLoser = resolve;
      });
      const bothReading = new Promise((resolve) => {
        signalBoth = resolve;
      });
      let historyReads = 0;
      harness.firestore.queryAsyncHook = async (query) => {
        if (query.path !== resourcePaths.events) return;
        historyReads += 1;
        if (historyReads === 2) signalBoth();
        await (historyReads === 1 ? winnerGate : loserGate);
      };
      const commandId = makeUuid(
        1_091 + ["conflict", "policy", "lease", "head"].indexOf(race),
      );
      const attempt = (variant) =>
        submit(
          harness,
          race === "policy"
            ? {
                commandId,
                expectedRevision: 7,
                type: "record_fielding",
                payload: {
                  playEventId: target.eventId,
                  fielding: { putoutBy: "home-1", battedBall: variant },
                },
              }
            : {
                commandId,
                expectedRevision: 7,
                type: "void_event",
                payload: { targetEventId: target.eventId, reason: variant },
              },
        );
      const winner = attempt(
        race === "policy" ? "ground" : "Official scorer correction A",
      );
      const loser = attempt(
        race === "policy" ? "line" : "Official scorer correction B",
      );
      await bothReading;
      releaseWinner();
      assert.equal((await winner).outcome, "accepted", race);

      if (race === "policy") {
        harness.firestore.seed("securityPolicies/diamondScorebook", {
          mode: "disabled",
          revision: 2,
          teamIds: [],
        });
      } else if (race === "lease" || race === "head") {
        const root = harness.firestore.read(resourcePaths.scorebook);
        if (race === "lease") {
          root.scorerLease = {
            ...root.scorerLease,
            holderUid: "scorer-1",
            leaseId: makeUuid(1_095),
          };
        } else {
          root.checkpoint.state.score.home = 41;
        }
        harness.firestore.seed(resourcePaths.scorebook, root);
      }
      releaseLoser();

      if (race === "conflict") {
        const conflict = await loser;
        assert.equal(conflict.outcome, "rejected");
        assert.equal(conflict.rejection.code, "idempotency-conflict");
      } else {
        await assert.rejects(
          loser,
          (error) => {
            if (race === "policy") return error.code === "failed-precondition";
            if (race === "lease") {
              return (
                error.code === "unavailable" &&
                error.details?.reason === "lease-held-by-other"
              );
            }
            return (
              error.code === "unavailable" &&
              error.details?.reason === "command-history-receipt-head-mismatch"
            );
          },
          race,
        );
      }
      assert.equal(historyReads, 2, race);
      assert.equal(
        harness.firestore.countDirectChildren(resourcePaths.events),
        8,
        race,
      );
      assert.equal(commandHistoryAdmission(harness).value.requestCount, 2);
    }
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
    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(44),
        expectedRevision: 7,
        type: "void_event",
        payload: { targetEventId: pitch.eventId, reason: "Racing correction" },
      }),
      (error) =>
        error.code === "aborted" &&
        error.details?.reason === "command-history-source-changed",
    );
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
        requestId: makeUuid(480),
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

  it("deduplicates repeated same-revision regeneration before replay or queue writes", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    let canonicalHistoryReads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) canonicalHistoryReads += 1;
    };

    const requestId = makeUuid(481);
    const first = await regenerate(harness, { requestId, expectedRevision: 1 });
    const firstRequest = harness.firestore.read(
      resourcePaths.scorebook,
    ).projectionRequest;
    const firstAuditCount = harness.firestore.countDirectChildren(
      `${resourcePaths.scorebook}/audit`,
    );

    const repeated = await regenerate(harness, {
      requestId,
      expectedRevision: 1,
    });

    assert.equal(first.regenerationQueued, true);
    assert.equal(repeated.deduplicated, true);
    assert.equal(canonicalHistoryReads, 1);
    assert.equal(
      harness.firestore.countDirectChildren(`${resourcePaths.scorebook}/audit`),
      firstAuditCount,
    );
    assert.deepEqual(
      harness.firestore.read(resourcePaths.scorebook).projectionRequest,
      firstRequest,
    );
    await assert.rejects(
      regenerate(harness, {
        requestId: makeUuid(482),
        expectedRevision: 1,
      }),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "projection-regeneration-rate-limited",
    );
    assert.equal(canonicalHistoryReads, 1);
  });

  it("serializes a cross-manager reservation and upgrades only a proven blocked follower", async () => {
    const harness = createHarness({
      documents: { "users/admin-1": { isAdmin: true } },
      authUsers: {
        "admin-1": {
          uid: "admin-1",
          disabled: false,
          email: "admin@example.com",
          emailVerified: true,
        },
      },
    });
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    let releaseHistory;
    let historyStarted;
    const historyGate = new Promise((resolve) => {
      releaseHistory = resolve;
    });
    const started = new Promise((resolve) => {
      historyStarted = resolve;
    });
    let canonicalHistoryReads = 0;
    harness.firestore.queryAsyncHook = async (query) => {
      if (query.path !== resourcePaths.events) return;
      canonicalHistoryReads += 1;
      historyStarted();
      await historyGate;
    };
    const ownerRequestId = makeUuid(485);
    const owner = regenerate(harness, {
      requestId: ownerRequestId,
      expectedRevision: 1,
    });
    await started;
    assert.equal(
      regenerationControl(
        harness,
        "projection-regeneration-receipt",
      ).value.status,
      "reserved",
    );
    assert.equal(
      harness.firestore.read(resourcePaths.scorebook).projectionRequest,
      undefined,
    );
    for (const [requestId, reason] of [
      [ownerRequestId, "projection-regeneration-in-progress"],
      [makeUuid(514), "projection-regeneration-rate-limited"],
    ]) {
      await assert.rejects(
        regenerate(harness, { requestId, expectedRevision: 1 }),
        (error) =>
          error.code === "resource-exhausted" &&
          error.details?.reason === reason,
      );
    }
    const adminContext = { auth: { uid: "admin-1" } };
    await assert.rejects(
      regenerate(harness, {
        requestId: makeUuid(486),
        expectedRevision: 1,
        context: adminContext,
      }),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "projection-regeneration-in-progress",
    );
    releaseHistory();
    assert.equal((await owner).regenerationQueued, true);
    const follower = await regenerate(harness, {
      requestId: makeUuid(486),
      expectedRevision: 1,
      context: adminContext,
    });
    assert.equal(follower.deduplicated, true);
    assert.equal(canonicalHistoryReads, 1);
    assert.equal(
      regenerationAuditDocuments(
        harness,
        "projection-regeneration-requested",
      ).length,
      1,
    );
  });

  it("replays an accepted request after head advancement and rejects requestId input drift", async () => {
    const harness = createHarness();
    await activate(harness);
    const requestId = makeUuid(487);
    await regenerate(harness, { requestId, expectedRevision: 1 });
    await submit(harness, {
      commandId: makeUuid(488),
      expectedRevision: 1,
      type: "set_lineup",
      payload: {
        side: "home",
        entries: [{ slot: 1, playerId: "home-1" }],
      },
    });

    const retry = await regenerate(harness, {
      requestId,
      expectedRevision: 1,
    });
    assert.equal(retry.deduplicated, true);
    assert.equal(retry.revision, 1);
    await assert.rejects(
      regenerate(harness, { requestId, expectedRevision: null }),
      (error) => error.code === "already-exists",
    );
  });

  it("replays durable receipts and rate limits without requiring fresh randomness", async () => {
    let randomAvailable = true;
    let randomIndex = 700;
    const harness = createHarness({
      random: () => {
        if (!randomAvailable) throw new Error("rng unavailable");
        return makeUuid(randomIndex++);
      },
    });
    await activate(harness);
    const requestId = makeUuid(502);
    await regenerate(harness, { requestId, expectedRevision: 1 });
    randomAvailable = false;
    assert.equal(
      (
        await regenerate(harness, {
          requestId,
          expectedRevision: 1,
        })
      ).deduplicated,
      true,
    );
    await assert.rejects(
      regenerate(harness, {
        requestId: makeUuid(503),
        expectedRevision: 1,
      }),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "projection-regeneration-rate-limited",
    );
  });

  it("replays an exact accepted receipt despite malformed unrelated controls", async () => {
    for (const type of [
      "projection-regeneration-rate",
      "projection-regeneration-claim",
    ]) {
      const harness = createHarness();
      await activate(harness);
      const requestId = makeUuid(type.endsWith("rate") ? 504 : 505);
      await regenerate(harness, { requestId, expectedRevision: 1 });
      const control = regenerationControl(harness, type);
      harness.firestore.seed(control.path, { malformed: true });
      assert.equal(
        (
          await regenerate(harness, {
            requestId,
            expectedRevision: 1,
          })
        ).deduplicated,
        true,
      );
    }
  });

  it("retains failed work across the actor and global cooldown horizons", async () => {
    let nowMs = 1_750_000_000_000;
    const harness = createHarness({ clock: () => nowMs });
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    let canonicalHistoryReads = 0;
    harness.firestore.queryAsyncHook = (query) => {
      if (query.path !== resourcePaths.events) return;
      canonicalHistoryReads += 1;
      throw new Error("transient history failure");
    };
    const requestId = makeUuid(489);
    await assert.rejects(
      regenerate(harness, { requestId, expectedRevision: 1 }),
      (error) => error.code === "unavailable",
    );
    assert.equal(
      regenerationControl(
        harness,
        "projection-regeneration-receipt",
      ).value.status,
      "failed",
    );
    assert.equal(
      regenerationControl(harness, "projection-regeneration-claim").value
        .status,
      "failed",
    );
    await assert.rejects(
      regenerate(harness, { requestId, expectedRevision: 1 }),
      (error) => error.code === "resource-exhausted",
    );
    nowMs += PROJECTION_REGENERATION_COOLDOWN_MS + 1;
    harness.firestore.commitTimestampMs = nowMs;
    harness.firestore.queryAsyncHook = null;
    await assert.rejects(
      regenerate(harness, { requestId, expectedRevision: 1 }),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "projection-regeneration-in-progress",
    );
    nowMs = 1_750_000_000_000 + PROJECTION_REGENERATION_RESERVATION_MS + 1;
    harness.firestore.commitTimestampMs = nowMs;
    const recovered = await regenerate(harness, {
      requestId,
      expectedRevision: 1,
    });
    assert.equal(recovered.regenerationQueued, true);
    assert.equal(canonicalHistoryReads, 1);
  });

  it("holds failed downstream work globally after the actor cooldown expires", async () => {
    let nowMs = 1_750_000_000_000;
    const harness = createHarness({
      clock: () => nowMs,
      documents: { "users/admin-1": { isAdmin: true } },
      authUsers: {
        "admin-1": {
          uid: "admin-1",
          disabled: false,
          email: "admin@example.com",
          emailVerified: true,
        },
      },
    });
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    let reads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) reads += 1;
    };
    await regenerate(harness, {
      requestId: makeUuid(506),
      expectedRevision: 1,
    });
    const queuedRoot = harness.firestore.read(resourcePaths.scorebook);
    harness.firestore.seed(resourcePaths.scorebook, {
      ...queuedRoot,
      projectionStatus: "failed",
    });
    nowMs += PROJECTION_REGENERATION_COOLDOWN_MS + 1;
    harness.firestore.commitTimestampMs = nowMs;
    const blockedRequestId = makeUuid(507);
    for (const [requestId, context] of [
      [blockedRequestId, harness.managerContext],
      [makeUuid(508), { auth: { uid: "admin-1" } }],
    ]) {
      await assert.rejects(
        regenerate(harness, { requestId, expectedRevision: 1, context }),
        (error) =>
          error.code === "resource-exhausted" &&
          error.details?.reason === "projection-regeneration-in-progress",
      );
    }
    assert.equal(reads, 1);

    nowMs =
      1_750_000_000_000 + PROJECTION_REGENERATION_RESERVATION_MS + 2;
    harness.firestore.commitTimestampMs = nowMs;
    assert.equal(
      (
        await regenerate(harness, {
          requestId: blockedRequestId,
          expectedRevision: 1,
        })
      ).regenerationQueued,
      true,
    );
    assert.equal(reads, 2);
  });

  it("fails final commit when Auth or the immutable game generation changes during replay", async () => {
    for (const kind of ["auth", "generation"]) {
      const harness = createHarness();
      await activate(harness);
      const resourcePaths = paths("team-1", "game-1");
      harness.firestore.queryAsyncHook = (query) => {
        if (query.path !== resourcePaths.events) return;
        if (kind === "auth") {
          harness.authUsers.get("manager-1").disabled = true;
        } else {
          const game = harness.firestore.read(resourcePaths.game);
          harness.firestore.seed(resourcePaths.game, {
            ...game,
            diamondScorebookInstanceId: makeUuid(999),
          });
        }
      };
      await assert.rejects(
        regenerate(harness, {
          requestId: makeUuid(kind === "auth" ? 490 : 491),
          expectedRevision: 1,
        }),
        (error) =>
          error.code ===
          (kind === "auth" ? "permission-denied" : "failed-precondition"),
      );
      assert.equal(
        regenerationAuditDocuments(
          harness,
          "projection-regeneration-requested",
        ).length,
        0,
      );
      assert.equal(
        harness.firestore.read(resourcePaths.scorebook).projectionRequest,
        undefined,
      );
    }
  });

  it("fails final commit when same-chain checkpoint state changes during replay", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    let reads = 0;
    harness.firestore.queryAsyncHook = (query) => {
      if (query.path !== resourcePaths.events) return;
      reads += 1;
      const root = harness.firestore.read(resourcePaths.scorebook);
      root.checkpoint.state.score.home = 41;
      harness.firestore.seed(resourcePaths.scorebook, root);
    };
    await assert.rejects(
      regenerate(harness, {
        requestId: makeUuid(509),
        expectedRevision: 1,
      }),
      (error) => error.code === "aborted",
    );
    assert.equal(reads, 1);
    assert.equal(
      regenerationAuditDocuments(
        harness,
        "projection-regeneration-requested",
      ).length,
      0,
    );
    assert.equal(
      harness.firestore.read(resourcePaths.scorebook).projectionRequest,
      undefined,
    );
  });

  it("aborts without mutating a projector lease acquired after reservation", async () => {
    for (const kind of ["active", "expired"]) {
      const harness = createHarness();
      await activate(harness);
      const resourcePaths = paths("team-1", "game-1");
      let reads = 0;
      let lateLease;
      harness.firestore.queryAsyncHook = (query) => {
        if (query.path !== resourcePaths.events) return;
        reads += 1;
        const head = regenerationControl(
          harness,
          "projection-regeneration-claim",
        ).value.sourceHead;
        const root = harness.firestore.read(resourcePaths.scorebook);
        lateLease = {
          schemaVersion: 1,
          trackingEngine: "diamond-v2",
          leaseId: makeUuid(kind === "active" ? 515 : 516),
          instanceId: head.instanceId,
          sourceRevision: head.sourceRevision,
          checkpointHash: head.checkpointHash,
          statConfigSnapshotHash: head.statConfigSnapshotHash,
          orientationSnapshotHash: head.orientationSnapshotHash,
          projectionKey: `late-${kind}`,
          acquiredAtMs: 1_750_000_000_000,
          expiresAtMs:
            1_750_000_000_000 + (kind === "active" ? 60_000 : -1),
        };
        harness.firestore.seed(resourcePaths.scorebook, {
          ...root,
          projectionStatus: "pending",
          projectionLease: lateLease,
        });
      };
      await assert.rejects(
        regenerate(harness, {
          requestId: makeUuid(kind === "active" ? 517 : 518),
          expectedRevision: 1,
        }),
        (error) => error.code === "aborted",
      );
      const root = harness.firestore.read(resourcePaths.scorebook);
      assert.equal(reads, 1);
      assert.deepEqual(root.projectionLease, lateLease);
      assert.equal(root.projectionRequest, undefined);
      assert.equal(
        regenerationControl(
          harness,
          "projection-regeneration-receipt",
        ).value.status,
        "reserved",
      );
      assert.equal(
        regenerationAuditDocuments(
          harness,
          "projection-regeneration-requested",
        ).length,
        0,
      );
    }
  });

  it("replaces an unchanged stale lease while committing a repaired checkpoint", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const root = harness.firestore.read(resourcePaths.scorebook);
    harness.firestore.seed(resourcePaths.scorebook, {
      ...root,
      projectionLease: {
        leaseId: makeUuid(519),
        expiresAtMs: 1_750_000_000_000 - 1,
      },
    });
    const result = await regenerate(harness, {
      requestId: makeUuid(520),
      expectedRevision: 1,
    });
    assert.equal(result.regenerationQueued, true);
    assert.equal(
      harness.firestore.read(resourcePaths.scorebook).projectionLease,
      null,
    );
  });

  it("reconciles reservation and final-commit response ambiguity without replaying twice", async () => {
    for (const failurePhase of ["reservation", "commit"]) {
      const harness = createHarness();
      await activate(harness);
      const resourcePaths = paths("team-1", "game-1");
      let transactions = 0;
      let canonicalHistoryReads = 0;
      harness.firestore.queryHook = (query) => {
        if (query.path === resourcePaths.events) canonicalHistoryReads += 1;
      };
      harness.firestore.transactionHook = (phase) => {
        if (phase !== "after") return;
        transactions += 1;
        if (
          (failurePhase === "reservation" && transactions === 1) ||
          (failurePhase === "commit" && transactions === 2)
        ) {
          throw new Error("response lost after commit");
        }
      };
      const result = await regenerate(harness, {
        requestId: makeUuid(failurePhase === "reservation" ? 492 : 493),
        expectedRevision: 1,
      });
      assert.equal(result.regenerationQueued, true);
      assert.equal(canonicalHistoryReads, 1);
      assert.equal(
        regenerationAuditDocuments(
          harness,
          "projection-regeneration-requested",
        ).length,
        1,
      );
    }

    const precommit = createHarness();
    await activate(precommit);
    let first = true;
    let reads = 0;
    precommit.firestore.queryHook = (query) => {
      if (query.path === paths("team-1", "game-1").events) reads += 1;
    };
    precommit.firestore.transactionHook = (phase) => {
      if (phase === "before" && first) {
        first = false;
        throw new Error("reservation not committed");
      }
    };
    await assert.rejects(
      regenerate(precommit, {
        requestId: makeUuid(494),
        expectedRevision: 1,
      }),
      (error) => error.code === "unavailable",
    );
    assert.equal(reads, 0);
  });

  it("replays an ambiguously committed receipt after the root changes", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    let transactions = 0;
    let reads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) reads += 1;
    };
    harness.firestore.transactionHook = (phase) => {
      if (phase !== "after" || ++transactions !== 2) return;
      const root = harness.firestore.read(resourcePaths.scorebook);
      root.checkpoint.state.score.home = 73;
      root.projectionStatus = "failed";
      harness.firestore.seed(resourcePaths.scorebook, root);
      throw new Error("final response lost after later root change");
    };
    const result = await regenerate(harness, {
      requestId: makeUuid(510),
      expectedRevision: 1,
    });
    assert.equal(result.deduplicated, true);
    assert.equal(result.revision, 1);
    assert.equal(reads, 1);
  });

  it("does not read history when Auth is revoked after an ambiguous reservation commit", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    let reads = 0;
    let firstCommit = true;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) reads += 1;
    };
    harness.firestore.transactionHook = (phase) => {
      if (phase !== "after" || !firstCommit) return;
      firstCommit = false;
      harness.authUsers.get("manager-1").disabled = true;
      throw new Error("reservation response lost");
    };
    await assert.rejects(
      regenerate(harness, {
        requestId: makeUuid(511),
        expectedRevision: 1,
      }),
      (error) => error.code === "permission-denied",
    );
    assert.equal(reads, 0);
    assert.equal(
      regenerationControl(
        harness,
        "projection-regeneration-receipt",
      ).value.status,
      "reserved",
    );
  });

  it("rejects stale revisions and root-game generation mismatches before history or controls", async () => {
    for (const kind of ["revision", "generation"]) {
      const harness = createHarness();
      await activate(harness);
      const resourcePaths = paths("team-1", "game-1");
      if (kind === "generation") {
        const game = harness.firestore.read(resourcePaths.game);
        harness.firestore.seed(resourcePaths.game, {
          ...game,
          diamondScorebookInstanceId: makeUuid(999),
        });
      }
      let reads = 0;
      harness.firestore.queryHook = (query) => {
        if (query.path === resourcePaths.events) reads += 1;
      };
      await assert.rejects(
        regenerate(harness, {
          requestId: makeUuid(kind === "revision" ? 512 : 513),
          expectedRevision: kind === "revision" ? 0 : 1,
        }),
        (error) =>
          error.code ===
          (kind === "revision" ? "aborted" : "failed-precondition"),
      );
      assert.equal(reads, 0);
      assert.equal(
        regenerationAuditDocuments(harness).some(({ value }) =>
          value?.type?.startsWith("projection-regeneration-"),
        ),
        false,
      );
    }
  });

  it("fails malformed private controls closed and replaces them only after quarantine", async () => {
    let nowMs = 1_750_000_000_000;
    const harness = createHarness({ clock: () => nowMs });
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const claimPath = `${resourcePaths.scorebook}/audit/projection-regeneration-claim`;
    harness.firestore.seed(claimPath, { malformed: true });
    harness.firestore.setDocumentUpdateTime(claimPath, nowMs);
    let reads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) reads += 1;
    };
    await assert.rejects(
      regenerate(harness, {
        requestId: makeUuid(495),
        expectedRevision: 1,
      }),
      (error) =>
        error.code === "unavailable" &&
        error.details?.reason === "projection-regeneration-control-invalid",
    );
    assert.equal(reads, 0);
    nowMs += PROJECTION_REGENERATION_RESERVATION_MS + 1;
    harness.firestore.commitTimestampMs = nowMs;
    const result = await regenerate(harness, {
      requestId: makeUuid(496),
      expectedRevision: 1,
    });
    assert.equal(result.regenerationQueued, true);
    assert.equal(reads, 1);
  });

  it("deduplicates rollout-era queued work before history and rate-limits fresh actor requests", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const root = harness.firestore.read(resourcePaths.scorebook);
    harness.firestore.seed(resourcePaths.scorebook, {
      ...root,
      projectionStatus: "pending",
      projectionRequest: {
        requestId: makeUuid(497),
        sourceRevision: 1,
        requestedAt: new Date(1_750_000_000_000).toISOString(),
      },
    });
    let reads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) reads += 1;
    };
    await assert.rejects(
      regenerate(harness, {
        requestId: makeUuid(498),
        expectedRevision: 1,
      }),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "projection-regeneration-in-progress",
    );
    await assert.rejects(
      regenerate(harness, {
        requestId: makeUuid(499),
        expectedRevision: 1,
      }),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "projection-regeneration-rate-limited",
    );
    assert.equal(reads, 0);
  });

  it("does not dedupe a distinct same-chain checkpoint corruption or collide with scorer audit IDs", async () => {
    let nowMs = 1_750_000_000_000;
    const harness = createHarness({ clock: () => nowMs });
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const requestId = makeUuid(500);
    harness.firestore.seed(resourcePaths.audit(requestId), {
      type: "scorer-lease-acquired",
      instanceId: harness.firestore.read(resourcePaths.scorebook).instanceId,
    });
    let reads = 0;
    harness.firestore.queryHook = (query) => {
      if (query.path === resourcePaths.events) reads += 1;
    };
    const corrupt = harness.firestore.read(resourcePaths.scorebook);
    corrupt.checkpoint.state.score.home = 55;
    harness.firestore.seed(resourcePaths.scorebook, corrupt);
    await regenerate(harness, { requestId, expectedRevision: 1 });
    nowMs += PROJECTION_REGENERATION_RESERVATION_MS + 1;
    harness.firestore.commitTimestampMs = nowMs;
    const secondCorruption = harness.firestore.read(resourcePaths.scorebook);
    secondCorruption.checkpoint.state.score.home = 77;
    harness.firestore.seed(resourcePaths.scorebook, secondCorruption);
    await regenerate(harness, {
      requestId: makeUuid(501),
      expectedRevision: 1,
    });
    assert.equal(reads, 2);
    assert.equal(
      harness.firestore.read(resourcePaths.scorebook).checkpoint.state.score
        .home,
      0,
    );
    assert.ok(harness.firestore.read(resourcePaths.audit(requestId)));
  });

  it("keeps projection replay read failures retryable and reauthorizes before repair commit", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    harness.firestore.queryAsyncHook = (query) => {
      if (query.path === resourcePaths.events) {
        throw new Error("transient event read");
      }
    };
    await assert.rejects(
      harness.handlers.regenerateDiamondProjection(
        {
          requestId: makeUuid(483),
          teamId: "team-1",
          gameId: "game-1",
          expectedRevision: 1,
        },
        harness.managerContext,
      ),
      (error) => error.code === "unavailable",
    );
    harness.firestore.queryAsyncHook = null;

    const revokedHarness = createHarness();
    await activate(revokedHarness);
    const revokedPaths = paths("team-1", "game-1");
    const originalRunTransaction = revokedHarness.firestore.runTransaction.bind(
      revokedHarness.firestore,
    );
    let revokedBeforeCommit = false;
    revokedHarness.firestore.runTransaction = (callback) => {
      if (revokedBeforeCommit) {
        revokedBeforeCommit = false;
        const team = revokedHarness.firestore.read("teams/team-1");
        revokedHarness.firestore.seed("teams/team-1", {
          ...team,
          ownerId: "replacement-manager",
        });
      }
      return originalRunTransaction(callback);
    };
    revokedHarness.firestore.queryAsyncHook = (query) => {
      if (query.path === revokedPaths.events) revokedBeforeCommit = true;
    };
    const auditCount = regenerationAuditDocuments(
      revokedHarness,
      "projection-regeneration-requested",
    ).length;
    await assert.rejects(
      revokedHarness.handlers.regenerateDiamondProjection(
        {
          requestId: makeUuid(484),
          teamId: "team-1",
          gameId: "game-1",
          expectedRevision: 1,
        },
        revokedHarness.managerContext,
      ),
      (error) => error.code === "permission-denied",
    );
    assert.equal(
      regenerationAuditDocuments(
        revokedHarness,
        "projection-regeneration-requested",
      ).length,
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

    harness.firestore.seed(resourcePaths.game, {
      ...harness.firestore.read(resourcePaths.game),
      visibility: "private",
      shareable: false,
    });
    const privateNewest = await harness.handlers.getPublicDiamondGame(
      { teamId: "team-1", gameId: "game-1", limit: 4 },
      harness.managerContext,
    );
    assert.deepEqual(
      privateNewest.events.map((event) => event.id),
      newest.events.map((event) => event.id),
    );
    assert.equal(privateNewest.projectionToken, newest.projectionToken);
    const privateRemainder = await harness.handlers.getPublicDiamondGame(
      {
        teamId: "team-1",
        gameId: "game-1",
        limit: 200,
        cursor: privateNewest.nextCursor,
      },
      harness.managerContext,
    );
    assert.equal(privateRemainder.events.length, 99);
    assert.equal(privateRemainder.complete, true);
    harness.firestore.seed(resourcePaths.game, {
      ...harness.firestore.read(resourcePaths.game),
      visibility: "public",
    });

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

  it("returns the server-authoritative Diamond interaction window for every viewer page", async () => {
    const nowMillis = Date.parse("2026-11-02T07:30:00.000Z");
    const harness = createHarness({ clock: () => nowMillis });
    harness.firestore.seed("teams/team-1", {
      ...harness.firestore.read("teams/team-1"),
      timeZone: "America/Los_Angeles",
    });
    harness.firestore.seed("teams/team-1/games/game-1", {
      ...harness.firestore.read("teams/team-1/games/game-1"),
      date: "2026-11-01T07:30:00.000Z",
    });
    await activate(harness);

    const sameGameDay = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
      limit: 50,
    });
    assert.equal(sameGameDay.game.interactionWindowOpen, true);

    const resourcePaths = paths("team-1", "game-1");
    harness.firestore.seed(resourcePaths.team, {
      ...harness.firestore.read(resourcePaths.team),
      timeZone: "not/a-zone",
    });
    const invalidZone = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
      limit: 50,
    });
    assert.equal(invalidZone.game.interactionWindowOpen, false);

    harness.firestore.seed(resourcePaths.publicState, {
      ...harness.firestore.read(resourcePaths.publicState),
      lifecycle: "final",
    });
    const inconsistentLifecycle = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
      limit: 50,
    });
    assert.equal(inconsistentLifecycle.game.interactionWindowOpen, false);

    harness.firestore.seed(resourcePaths.game, {
      ...harness.firestore.read(resourcePaths.game),
      diamondLifecycle: "final",
      status: "completed",
      liveStatus: "completed",
    });
    const final = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
      limit: 50,
    });
    assert.equal(final.game.interactionWindowOpen, false);
  });

  it("serves the same sanitized viewer envelope to every current private-game viewer role", async () => {
    const privateLocation =
      "Field 4\nArrival Time: 5:00 PM\nAssignments: Snacks - Parent Name";
    const viewerAccessByUid = {
      "parent-1": { parent: true },
      "scorekeeper-2": { scorekeeping: true },
      "videographer-1": { videography: true },
      "streamer-1": { streaming: true },
      "official-uid-1": {},
      "official-email-1": {},
    };
    const authUsers = Object.fromEntries(
      Object.keys(viewerAccessByUid).map((uid) => [
        uid,
        {
          uid,
          disabled: false,
          email: `${uid}@example.test`,
          emailVerified: true,
        },
      ]),
    );
    const documents = Object.fromEntries(
      Object.keys(viewerAccessByUid).map((uid) => [
        `users/${uid}`,
        { displayName: uid, privateProfileNote: "profile-secret" },
      ]),
    );
    const harness = createHarness({
      authUsers,
      documents,
      viewerAccessByUid,
    });
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    harness.firestore.seed(resourcePaths.team, {
      ...harness.firestore.read(resourcePaths.team),
      isPublic: false,
      ownerEmail: "private-owner@example.test",
      adminEmails: ["private-admin@example.test"],
    });
    harness.firestore.seed(resourcePaths.game, {
      ...harness.firestore.read(resourcePaths.game),
      visibility: "private",
      shareable: false,
      location: privateLocation,
      privateCoachNotes: "game-secret",
      officiatingAuthorizedUserIds: ["official-uid-1"],
      officiatingAuthorizedEmails: ["official-email-1@example.test"],
    });
    harness.firestore.seed(resourcePaths.publicState, {
      ...harness.firestore.read(resourcePaths.publicState),
      actorUid: "private-actor",
      commandHash: `sha256:${"f".repeat(64)}`,
      availablePlayers: [{ medicalInfo: "projection-secret" }],
    });
    for (const [path, value] of harness.firestore.documents.entries()) {
      if (path.startsWith(`${resourcePaths.publicEvents}/`)) {
        harness.firestore.seed(path, {
          ...value,
          actorUid: "private-event-actor",
          privateNote: "event-secret",
        });
      }
    }

    const contexts = [
      harness.managerContext,
      ...Object.keys(viewerAccessByUid).map((uid) => ({ auth: { uid } })),
    ];
    for (const viewerContext of contexts) {
      const result = await harness.handlers.getPublicDiamondGame(
        { teamId: "team-1", gameId: "game-1", limit: 50 },
        viewerContext,
      );
      assert.equal(result.game.trackingEngine, DIAMOND_ENGINE);
      assert.equal(
        result.instanceId,
        harness.firestore.read(resourcePaths.game).diamondScorebookInstanceId,
      );
      assert.equal(result.game.location, "Field 4");
      assert.doesNotMatch(
        JSON.stringify(result),
        /Arrival Time|Assignments|Parent Name/,
      );
      assert.doesNotMatch(
        JSON.stringify(result),
        /private-owner|private-admin|profile-secret|game-secret|projection-secret|event-secret|private-actor|commandHash|availablePlayers/,
      );
    }

    const finalReadPaths = new Set(
      harness.firestore.transactionReadBatches.at(-1),
    );
    assert.deepEqual(
      finalReadPaths,
      new Set([
        resourcePaths.team,
        resourcePaths.user("official-email-1"),
        resourcePaths.game,
        resourcePaths.rsvp("official-email-1"),
        resourcePaths.publicState,
      ]),
    );
  });

  it("keeps a media-only role outside a private Diamond viewer", async () => {
    const harness = createHarness({
      authUsers: {
        "media-1": {
          uid: "media-1",
          disabled: false,
          email: "media-1@example.test",
          emailVerified: true,
        },
      },
      documents: {
        "users/media-1": { displayName: "Media only" },
      },
      viewerAccessByUid: {
        "media-1": { media: true },
      },
    });
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    harness.firestore.seed(resourcePaths.team, {
      ...harness.firestore.read(resourcePaths.team),
      isPublic: false,
    });
    harness.firestore.seed(resourcePaths.game, {
      ...harness.firestore.read(resourcePaths.game),
      visibility: "private",
      shareable: false,
    });

    await assert.rejects(
      harness.handlers.getPublicDiamondGame(
        { teamId: "team-1", gameId: "game-1", limit: 50 },
        { auth: { uid: "media-1" } },
      ),
      (error) => error.code === "not-found",
    );
  });

  it("returns no private viewer page when delegated access becomes media-only during assembly", async () => {
    const viewerAccessByUid = {
      "viewer-1": { videography: true },
    };
    const harness = createHarness({
      authUsers: {
        "viewer-1": {
          uid: "viewer-1",
          disabled: false,
          email: "viewer-1@example.test",
          emailVerified: true,
        },
      },
      documents: {
        "users/viewer-1": { displayName: "Current viewer" },
      },
      viewerAccessByUid,
    });
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    harness.firestore.seed(resourcePaths.team, {
      ...harness.firestore.read(resourcePaths.team),
      isPublic: false,
    });
    harness.firestore.seed(resourcePaths.game, {
      ...harness.firestore.read(resourcePaths.game),
      visibility: "private",
      shareable: false,
    });
    harness.firestore.queryHook = (query) => {
      if (query.path !== resourcePaths.publicEvents) return;
      harness.firestore.queryHook = null;
      viewerAccessByUid["viewer-1"] = { media: true };
    };

    await assert.rejects(
      harness.handlers.getPublicDiamondGame(
        { teamId: "team-1", gameId: "game-1", limit: 50 },
        { auth: { uid: "viewer-1" } },
      ),
      (error) => error.code === "not-found",
    );
  });

  it("keeps anonymous and unrelated callers outside a private Diamond viewer", async () => {
    const harness = createHarness({
      authUsers: {
        "unrelated-1": {
          uid: "unrelated-1",
          disabled: false,
          email: "unrelated@example.test",
          emailVerified: true,
        },
        "unverified-official-email": {
          uid: "unverified-official-email",
          disabled: false,
          email: "official@example.test",
          emailVerified: false,
        },
      },
      documents: {
        "users/unrelated-1": { isAdmin: false },
        "users/unverified-official-email": { isAdmin: false },
      },
      viewerAccessByUid: {
        "unrelated-1": {
          full: false,
          parent: false,
          scorekeeping: false,
          videography: false,
          streaming: false,
          media: false,
        },
        "unverified-official-email": {
          full: false,
          parent: false,
          scorekeeping: false,
          videography: false,
          streaming: false,
          media: false,
        },
      },
    });
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    harness.firestore.seed(resourcePaths.game, {
      ...harness.firestore.read(resourcePaths.game),
      visibility: "private",
      shareable: false,
      officiatingAuthorizedEmails: ["official@example.test"],
    });

    for (const viewerContext of [
      undefined,
      {
        auth: {
          uid: "unrelated-1",
          token: { email: "official@example.test", email_verified: true },
        },
      },
      { auth: { uid: "unverified-official-email" } },
    ]) {
      await assert.rejects(
        harness.handlers.getPublicDiamondGame(
          { teamId: "team-1", gameId: "game-1" },
          viewerContext,
        ),
        (error) => error.code === "not-found",
      );
    }
  });

  it("returns no private viewer payload after access, visibility, or exact head changes", async () => {
    const mutations = [
      (harness, resourcePaths) => {
        harness.firestore.seed(resourcePaths.team, {
          ...harness.firestore.read(resourcePaths.team),
          ownerId: "replacement-manager",
        });
      },
      (harness, resourcePaths) => {
        harness.firestore.seed(resourcePaths.game, {
          ...harness.firestore.read(resourcePaths.game),
          visibility: "public",
        });
      },
      (harness, resourcePaths) => {
        harness.firestore.seed(resourcePaths.game, {
          ...harness.firestore.read(resourcePaths.game),
          diamondProjectionRevision:
            harness.firestore.read(resourcePaths.game)
              .diamondProjectionRevision + 1,
        });
      },
      (harness, resourcePaths) => {
        harness.firestore.seed(resourcePaths.game, {
          ...harness.firestore.read(resourcePaths.game),
          diamondScorebookInstanceId: makeUuid(998),
        });
      },
    ];

    for (const mutate of mutations) {
      const harness = createHarness();
      await activate(harness);
      const resourcePaths = paths("team-1", "game-1");
      harness.firestore.seed(resourcePaths.game, {
        ...harness.firestore.read(resourcePaths.game),
        visibility: "private",
        shareable: false,
      });
      harness.firestore.queryHook = (query) => {
        if (query.path !== resourcePaths.publicEvents) return;
        harness.firestore.queryHook = null;
        mutate(harness, resourcePaths);
      };

      await assert.rejects(
        harness.handlers.getPublicDiamondGame(
          { teamId: "team-1", gameId: "game-1", limit: 50 },
          harness.managerContext,
        ),
        (error) => ["not-found", "unavailable"].includes(error.code),
      );
    }
  });

  it("rechecks the enabled Auth principal after private replay assembly", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    harness.firestore.seed(resourcePaths.game, {
      ...harness.firestore.read(resourcePaths.game),
      visibility: "private",
      shareable: false,
    });
    harness.firestore.queryHook = (query) => {
      if (query.path !== resourcePaths.publicEvents) return;
      harness.firestore.queryHook = null;
      harness.authUsers.set("manager-1", {
        ...harness.authUsers.get("manager-1"),
        disabled: true,
      });
    };

    await assert.rejects(
      harness.handlers.getPublicDiamondGame(
        { teamId: "team-1", gameId: "game-1", limit: 50 },
        harness.managerContext,
      ),
      (error) => error.code === "permission-denied",
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
    for (const { mutate, expectedCode, expectedMessage } of [
      {
        expectedCode: "not-found",
        expectedMessage: "Public Diamond game not found.",
        mutate(harness, resourcePaths) {
          harness.firestore.seed(resourcePaths.game, {
            ...harness.firestore.read(resourcePaths.game),
            visibility: "private",
            isPublic: false,
            shareable: false,
          });
        },
      },
      {
        expectedCode: "unavailable",
        expectedMessage:
          "The public Diamond game changed while it was loading. Try again.",
        mutate(harness, resourcePaths) {
          harness.firestore.seed(resourcePaths.game, {
            ...harness.firestore.read(resourcePaths.game),
            diamondScorebookInstanceId: makeUuid(997),
          });
        },
      },
      {
        expectedCode: "not-found",
        expectedMessage: "Public Diamond game not found.",
        mutate(harness, resourcePaths) {
          harness.firestore.delete(resourcePaths.game);
        },
      },
      {
        expectedCode: "unavailable",
        expectedMessage:
          "The public Diamond game changed while it was loading. Try again.",
        mutate(harness, resourcePaths) {
          harness.firestore.seed(resourcePaths.game, {
            ...harness.firestore.read(resourcePaths.game),
            diamondProjectionComplete: false,
          });
        },
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
        (error) =>
          error.code === expectedCode && error.message === expectedMessage,
      );
      assert.equal(publicReadTransactions, 2);
    }
  });

  it("sanitizes sensitive location suffixes for the anonymous public viewer", async () => {
    const sensitiveLocation =
      "Field 4\nArrival Time: 5:00 PM\nAssignments: Snacks - Parent Name";
    const harness = createHarness({
      documents: {
        "teams/team-1/games/game-1": {
          ...baseDocuments()["teams/team-1/games/game-1"],
          location: sensitiveLocation,
        },
      },
    });
    await activate(harness);

    const publicResult = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(publicResult.game.location, "Field 4");
    assert.doesNotMatch(
      JSON.stringify(publicResult),
      /Arrival Time|Assignments|Parent Name/,
    );
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
          location:
            "Fresh Field\nArrival Time: 6:15 PM\nAssignments: Drinks - Parent Name",
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
    assert.doesNotMatch(
      JSON.stringify(result),
      /Arrival Time|Assignments|Parent Name/,
    );
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

  it("falls back to sanitized team live media while preserving the per-game URL", async () => {
    const harness = createHarness();
    await activate(harness);
    const resourcePaths = paths("team-1", "game-1");
    const publicState = harness.firestore.read(resourcePaths.publicState);
    const game = harness.firestore.read(resourcePaths.game);
    const team = harness.firestore.read(resourcePaths.team);
    harness.firestore.seed(resourcePaths.publicState, {
      ...publicState,
      lifecycle: "active",
    });

    harness.firestore.seed(resourcePaths.team, {
      ...team,
      twitchChannel: "allplays_live",
      streamEmbedUrl: "https://www.youtube.com/embed/abcdefghijk",
      youtubeVideoId: "lmnopqrstuv",
    });
    harness.firestore.seed(resourcePaths.game, {
      ...game,
      videoUrl: "https://video.example.test/game-specific",
    });
    const gameSpecific = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(
      gameSpecific.game.media.publicUrl,
      "https://video.example.test/game-specific",
    );

    harness.firestore.seed(resourcePaths.game, game);
    const twitch = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.deepEqual(twitch.game.media, {
      mode: "live",
      publicUrl: "https://www.twitch.tv/allplays_live",
      durationMs: 0,
    });

    harness.firestore.seed(resourcePaths.team, {
      ...team,
      twitchChannel: "unsafe/channel",
      streamEmbedUrl: "http://video.example.test/insecure",
      youtubeEmbedUrl: "https://www.youtube.com/embed/abcdefghijk",
      youtubeVideoId: "lmnopqrstuv",
    });
    const youtubeEmbed = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(
      youtubeEmbed.game.media.publicUrl,
      "https://www.youtube.com/embed/abcdefghijk",
    );

    harness.firestore.seed(resourcePaths.team, {
      ...team,
      streamEmbedUrl: "http://video.example.test/insecure",
      youtubeEmbedUrl: "javascript:alert(1)",
      youtubeVideoId: "lmnopqrstuv",
    });
    const youtubeVideoId = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(
      youtubeVideoId.game.media.publicUrl,
      "https://www.youtube.com/watch?v=lmnopqrstuv",
    );

    harness.firestore.seed(resourcePaths.team, {
      ...team,
      twitchChannel: "unsafe/channel",
      streamEmbedUrl: "http://video.example.test/insecure",
      youtubeEmbedUrl: "https://viewer:secret@video.example.test/embed",
      youtubeVideoId: "not-a-video-id",
    });
    const unsafe = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
    });
    assert.equal(unsafe.game.media, null);
  });

  it("ignores no-engine and recognized legacy deletions without Firestore reads", async () => {
    for (const trackingEngine of [
      undefined,
      "legacy",
      "legacy-v1",
      "classic",
      "standard",
    ]) {
      const harness = createHarness();
      const resourcePaths = paths("team-1", "game-1");
      const deletedGame = harness.firestore.read(resourcePaths.game);
      if (trackingEngine !== undefined) {
        deletedGame.trackingEngine = trackingEngine;
      }
      const snapshot = new FakeDocumentSnapshot(
        harness.firestore.doc(resourcePaths.game),
        deletedGame,
      );
      harness.firestore.delete(resourcePaths.game);
      const documentsBeforeCleanup = [...harness.firestore.documents.entries()];
      let documentReadCount = 0;
      let queryReadCount = 0;
      const originalDocumentSnapshot = harness.firestore._documentSnapshot.bind(
        harness.firestore,
      );
      const originalQuerySnapshot = harness.firestore._querySnapshot.bind(
        harness.firestore,
      );
      harness.firestore._documentSnapshot = (reference) => {
        documentReadCount += 1;
        return originalDocumentSnapshot(reference);
      };
      harness.firestore._querySnapshot = (query) => {
        queryReadCount += 1;
        return originalQuerySnapshot(query);
      };

      const result = await harness.handlers.cleanupDeletedDiamondGame(snapshot);

      assert.deepEqual(result, {
        cleaned: true,
        retained: false,
        reason: "not-a-diamond-game",
      });
      assert.equal(documentReadCount, 0);
      assert.equal(queryReadCount, 0);
      assert.deepEqual(
        [...harness.firestore.documents.entries()],
        documentsBeforeCleanup,
      );
    }
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
