"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const domainEngine = require("../diamond-engine");
const privateNoteCore = require("../diamond-private-note-core.cjs");

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
  MAX_CANONICAL_EVENTS,
  MAX_COMMAND_HISTORY_READ_UNITS_PER_WINDOW,
  MAX_COMMAND_HISTORY_REQUESTS_PER_WINDOW,
  MAX_COMMAND_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW,
  MAX_COMMAND_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_COMMAND_PROJECTION_READ_UNITS_PER_WINDOW,
  MAX_COMMAND_PROJECTION_REQUESTS_PER_WINDOW,
  MAX_COMMAND_PROJECTION_SUSTAINED_READ_UNITS_PER_WINDOW,
  MAX_COMMAND_PROJECTION_SUSTAINED_REQUESTS_PER_WINDOW,
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
  MAX_CONCURRENT_PRIVATE_HISTORY_GLOBAL_REQUESTS,
  MAX_CONCURRENT_PRIVATE_HISTORY_REQUESTS,
  MAX_PRIVATE_HISTORY_GLOBAL_REQUESTS_PER_WINDOW,
  MAX_PRIVATE_HISTORY_GLOBAL_SUSTAINED_READ_UNITS_PER_WINDOW,
  MAX_PRIVATE_HISTORY_GLOBAL_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_PRIVATE_HISTORY_READ_UNITS_PER_WINDOW,
  MAX_PRIVATE_HISTORY_RECENT_ADMISSIONS,
  MAX_PRIVATE_HISTORY_REPORT_PAGES,
  MAX_PRIVATE_HISTORY_REQUESTS_PER_WINDOW,
  MAX_PRIVATE_HISTORY_SUSTAINED_REQUESTS_PER_WINDOW,
  MAX_PRIVATE_HISTORY_SUSTAINED_READ_UNITS_PER_WINDOW,
  MAX_PRIVATE_EVENT_PAGE_BYTES,
  PRIVATE_HISTORY_ADMISSION_DEDUPE_MS,
  PRIVATE_HISTORY_CONTROL_QUARANTINE_MS,
  PRIVATE_HISTORY_FIXED_READ_UNITS,
  PRIVATE_HISTORY_READ_UNITS_PER_EVENT,
  PRIVATE_HISTORY_RATE_WINDOW_MS,
  PRIVATE_HISTORY_RECEIPT_RETENTION_MS,
  PRIVATE_HISTORY_REPORT_RETRY_ALLOWANCE,
  PRIVATE_HISTORY_REQUEST_LEASE_MS,
  PRIVATE_HISTORY_SUSTAINED_WINDOW_MS,
  SCORER_LEASE_DURATION_MS,
  createDiamondScorebookHandlers,
  paths,
} = require("../diamond-scorebook-handlers.cjs");
const {
  MAX_CONCURRENT_SCORER_CANDIDATE_GLOBAL_REQUESTS,
  MAX_SCORER_CANDIDATE_REQUESTS_PER_WINDOW,
  SCORER_CANDIDATE_CONTROL_QUARANTINE_MS,
  SCORER_CANDIDATE_REQUEST_LEASE_MS,
} = require("../diamond-scorer-candidate-admission.cjs");
const {
  MAX_DIAMOND_ROSTER_READS_PER_WINDOW,
} = require("../diamond-roster-read-admission.cjs");

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
    const snapshot = this.database._documentSnapshot(this);
    if (typeof this.database.documentAsyncHook === "function") {
      return Promise.resolve(
        this.database.documentAsyncHook(this, snapshot),
      ).then((override) => override ?? snapshot);
    }
    return Promise.resolve(snapshot);
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

  doc(id) {
    return this.database.doc(`${this.path}/${id}`);
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
    if (
      this.database.rejectTransactionReadsAfterWrites &&
      this.operations.length
    ) {
      throw new Error(
        `Firestore transaction read after write: ${reference.path}`,
      );
    }
    this.readPaths.push(reference.path);
    if (reference instanceof FakeQuery)
      return Promise.resolve(this.database._querySnapshot(reference));
    return Promise.resolve(this.database._documentSnapshot(reference));
  }

  getAll(...references) {
    if (
      this.database.rejectTransactionReadsAfterWrites &&
      this.operations.length
    ) {
      throw new Error("Firestore transaction bulk read after write");
    }
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
    this.documentAsyncHook = null;
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

async function activateGame(
  harness,
  {
    requestId = makeUuid(1),
    teamId = "team-1",
    gameId = "game-1",
    context = harness.managerContext,
  } = {},
) {
  return harness.handlers.activateDiamondGame(
    {
      requestId,
      teamId,
      gameId,
      captureMode: "quick",
      appBuild: DIAMOND_APP_BUILD,
    },
    context,
  );
}

async function activate(harness, requestId = makeUuid(1)) {
  return activateGame(harness, { requestId });
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
    teamId = "team-1",
    gameId = "game-1",
  },
) {
  const root = harness.firestore.read(paths(teamId, gameId).scorebook);
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
      teamId,
      gameId,
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
    teamId = "team-1",
    gameId = "game-1",
  },
) {
  const root = harness.firestore.read(paths(teamId, gameId).scorebook);
  return harness.handlers.acquireDiamondScorerLease(
    {
      requestId,
      teamId,
      gameId,
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
    teamId = "team-1",
    gameId = "game-1",
  },
) {
  return harness.handlers.regenerateDiamondProjection(
    {
      requestId,
      teamId,
      gameId,
      expectedRevision,
    },
    context,
  );
}

let scorerCandidateRequestIndex = 10_000;

async function listScorerCandidates(
  harness,
  {
    requestId = makeUuid(scorerCandidateRequestIndex++),
    context = harness.managerContext,
    teamId = "team-1",
    gameId = "game-1",
    expectedInstanceId = null,
    expectedRevision = null,
    leaseId = null,
  } = {},
) {
  const root = harness.firestore.read(paths(teamId, gameId).scorebook);
  return harness.handlers.listDiamondScorerCandidates(
    {
      requestId,
      teamId,
      gameId,
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

function regenerationAuditDocuments(
  harness,
  type = null,
  teamId = "team-1",
  gameId = "game-1",
) {
  const collectionPath = `${paths(teamId, gameId).scorebook}/audit`;
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

function commandHistoryGlobalAdmission(harness) {
  return managerStatReadControl(
    harness,
    "diamond-command-history-global-admission",
  );
}

function commandHistoryGameAdmissions(harness) {
  return managerStatReadControls(
    harness,
    "diamond-command-history-game-admission",
  );
}

function commandHistoryGameAdmission(harness) {
  const controls = commandHistoryGameAdmissions(harness);
  assert.equal(
    controls.length,
    1,
    "expected one diamond-command-history-game-admission control",
  );
  return controls[0];
}

function privateMaterialCommandHistoryAdmissions(harness, type) {
  return managerStatReadControls(harness, type);
}

function privateMaterialCommandHistoryAdmission(harness) {
  const controls = privateMaterialCommandHistoryAdmissions(
    harness,
    "diamond-private-material-command-history-admission",
  );
  assert.equal(controls.length, 1, "expected one private-material game control");
  return controls[0];
}

function privateMaterialCommandHistoryTeamAdmission(harness) {
  const controls = privateMaterialCommandHistoryAdmissions(
    harness,
    "diamond-private-material-command-history-team-admission",
  );
  assert.equal(controls.length, 1, "expected one private-material team control");
  return controls[0];
}

function privateHistoryControls(harness, type = null) {
  return managerStatReadControls(harness, type).filter(({ value }) =>
    String(value?.type || "").startsWith("diamond-private-history-read-"),
  );
}

function scorerCandidateControls(harness, type = null) {
  return managerStatReadControls(harness, type).filter(({ path }) =>
    path.includes("/scorer-candidate-"),
  );
}

function scorerCandidateControl(harness, type) {
  const controls = scorerCandidateControls(harness, type);
  assert.equal(controls.length, 1, `expected one ${type} control`);
  return controls[0];
}

function scorerCandidateRateControls(harness) {
  return managerStatReadControls(harness).filter(({ path }) =>
    /^diamondManagerStatReadControls\/[0-9a-f]{64}$/.test(path),
  );
}

function rosterReadControls(harness) {
  return managerStatReadControls(harness).filter(({ path }) =>
    path.includes("/roster-read-lock-"),
  );
}

function rosterReadControl(harness) {
  const controls = rosterReadControls(harness);
  assert.equal(controls.length, 1, "expected one roster read control");
  return controls[0];
}

function privateHistoryControl(harness, type) {
  const controls = privateHistoryControls(harness, type);
  assert.equal(controls.length, 1, `expected one ${type} control`);
  return controls[0];
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

describe("Diamond scorebook handler factory: activation and authorization", () => {

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
    const firstReceiptPath =
      `teams/team-1/diamondConfigurationRequests/${request.requestId}`;
    const firstReceipt = harness.firestore.read(firstReceiptPath);
    assert.equal(firstReceipt.schemaVersion, 2);
    assert.deepEqual(firstReceipt.lineage, {
      schemaVersion: 1,
      chainId: request.requestId,
      ordinal: 1,
      previousRequestId: null,
      nextRequestId: null,
      beforeImage: { present: false },
      beforeImageHash: domainEngine.hashDiamondValue({ present: false }),
    });
    assert.equal(first.settings.configurationChainId, request.requestId);
    assert.equal(first.settings.configurationRequestId, request.requestId);
    assert.equal(first.settings.configurationOrdinal, 1);

    await assert.rejects(
      harness.handlers.configureDiamondTeam(
        { ...request, rulesProfileId: "baseball-nfhs" },
        harness.managerContext,
      ),
      (error) => error.code === "already-exists",
    );

    const successorRequest = {
      ...request,
      requestId: makeUuid(3),
      captureMode: "quick",
    };
    const successor = await harness.handlers.configureDiamondTeam(
      successorRequest,
      harness.managerContext,
    );
    const linkedFirst = harness.firestore.read(firstReceiptPath);
    const successorReceipt = harness.firestore.read(
      `teams/team-1/diamondConfigurationRequests/${successorRequest.requestId}`,
    );
    assert.equal(linkedFirst.lineage.nextRequestId, successorRequest.requestId);
    assert.deepEqual(successorReceipt.lineage.beforeImage, {
      present: true,
      value: first.settings,
    });
    assert.equal(successorReceipt.lineage.previousRequestId, request.requestId);
    assert.equal(successorReceipt.lineage.nextRequestId, null);
    assert.equal(successorReceipt.lineage.chainId, request.requestId);
    assert.equal(successorReceipt.lineage.ordinal, 2);
    assert.equal(successor.settings.configurationChainId, request.requestId);
    assert.equal(successor.settings.configurationOrdinal, 2);

    harness.firestore.seed(
      paths("team-1", "__configuration__").configurationRepair,
      { status: "repairing" },
    );
    await assert.rejects(
      harness.handlers.configureDiamondTeam(
        successorRequest,
        harness.managerContext,
      ),
      (error) =>
        error.code === "failed-precondition" &&
        error.details?.reason === "configuration-reconciliation-pending",
      "the repair fence must block even an idempotent request retry",
    );
  });


  it("fences team configuration when every deletion barrier wins its missing-document read", async (t) => {
    for (const variant of [
      "direct-auth-delete",
      "completed-self-service-delete",
      "pending-self-service-delete",
    ]) {
      await t.test(variant, async () => {
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
          requestId: makeUuid(
            variant === "direct-auth-delete"
              ? 32_200
              : variant === "completed-self-service-delete"
                ? 32_201
                : 32_202,
          ),
          teamId: "team-1",
          appBuild: DIAMOND_APP_BUILD,
          sport: "baseball",
          rulesProfileId: null,
          captureMode: "full",
          enabled: true,
        };
        const resourcePaths = paths("team-1", "__configuration__");
        const barrierPath =
          resourcePaths.accountPrivateNoteAuthDeleteBarrier("manager-1");
        const auditPath = resourcePaths.accountDeletionAudit("manager-1");
        const requestPath =
          resourcePaths.accountDeletionRequest("manager-1");
        const teamBefore = clone(harness.firestore.read(resourcePaths.team));
        const authReadsBefore = harness.authGetUserCalls.length;
        let injected = false;
        harness.firestore.transactionHook = async (stage, transaction) => {
          const winningPath =
            variant === "direct-auth-delete"
              ? barrierPath
              : variant === "completed-self-service-delete"
                ? auditPath
                : requestPath;
          if (
            stage === "beforeCommit" &&
            !injected &&
            transaction.readPaths.includes(winningPath)
          ) {
            injected = true;
            if (variant === "direct-auth-delete") {
              harness.authUsers.delete("manager-1");
              harness.firestore.seed(barrierPath, {
                schemaVersion: 1,
                type: "diamond-private-note-auth-delete-barrier",
                status: "auth-deleted",
                startedAt: "2026-09-12T12:06:00.000Z",
              });
            } else if (variant === "completed-self-service-delete") {
              harness.firestore.seed(auditPath, {
                version: 1,
                outcome: "deleted",
              });
            } else {
              harness.firestore.seed(requestPath, {
                uid: "manager-1",
                status: "queued",
              });
            }
            return "retry";
          }
          return undefined;
        };

        await assert.rejects(
          harness.handlers.configureDiamondTeam(
            request,
            harness.managerContext,
          ),
          (error) =>
            error.code === "failed-precondition" &&
            error.details?.reason === "account-deletion-pending",
        );

        assert.equal(injected, true);
        assert.deepEqual(
          harness.firestore.read(resourcePaths.team),
          teamBefore,
        );
        assert.equal(
          harness.firestore.read(
            resourcePaths.configurationRequest(request.requestId),
          ),
          undefined,
        );
        assert.ok(
          harness.firestore.transactionReadBatches.some(
            (readPaths) =>
              readPaths.includes(requestPath) &&
              readPaths.includes(barrierPath) &&
              readPaths.includes(auditPath),
          ),
        );
        assert.equal(
          harness.authGetUserCalls.length,
          authReadsBefore + 1,
          "the deletion fence must stop configuration that already passed Auth",
        );
        if (variant === "direct-auth-delete") {
          assert.doesNotMatch(
            JSON.stringify({
              barrierPath,
              value: harness.firestore.read(barrierPath),
            }),
            /manager-1/,
          );
        }
      });
    }
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
    const activationProvenance = harness.firestore.read(
      `${paths("team-1", "game-1").scorebook}/audit/activation-provenance`,
    );
    assert.equal(
      domainEngine.hashDiamondValue(activationProvenance),
      root.activationRollbackHash,
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(root, "activationGameRollback"),
      false,
    );
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


  it("fails closed before activation when exact rollback provenance exceeds its bound", async () => {
    const documents = baseDocuments();
    documents["teams/team-1/games/game-1"].aiRecap = "x".repeat(200_001);
    const harness = createHarness({
      firestore: new FakeFirestore(documents),
    });

    await assert.rejects(
      activate(harness),
      (error) =>
        error.code === "failed-precondition" &&
        /rollback before-image exceeds its safe bound/.test(error.message),
    );

    assert.equal(
      harness.firestore.read("teams/team-1/games/game-1").trackingEngine,
      undefined,
    );
    assert.equal(
      harness.firestore.read(paths("team-1", "game-1").scorebook),
      undefined,
    );
    assert.equal(
      harness.firestore.read(
        `${paths("team-1", "game-1").scorebook}/audit/activation-provenance`,
      ),
      undefined,
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


  for (const directive of ["retry", "retry-after-commit"]) {
    it(`reconciles one private-history admission after transaction ${directive}`, async () => {
      const harness = createHarness();
      await activate(harness);
      let injected = false;
      harness.firestore.transactionHook = (phase, transaction) => {
        const admissionWrite = transactionControlWrite(
          transaction,
          "diamond-private-history-read-admission",
        );
        if (phase === "beforeCommit" && admissionWrite && !injected) {
          injected = true;
          return directive;
        }
        return undefined;
      };
      const page = await harness.handlers.listDiamondEvents(
        {
          teamId: "team-1",
          gameId: "game-1",
          visibility: "private",
          limit: 200,
        },
        harness.managerContext,
      );
      assert.equal(page.complete, true);
      assert.equal(injected, true);
      const admission = privateHistoryControl(
        harness,
        "diamond-private-history-read-admission",
      ).value;
      const scope = privateHistoryControl(
        harness,
        "diamond-private-history-read-scope",
      ).value;
      assert.equal(admission.requestCount, 1);
      assert.equal(scope.requestCount, 1);
      assert.deepEqual(admission.activeAttempts, []);
      assert.deepEqual(scope.activeAttempts, []);
      assert.equal(scope.recentTerminals.length, 1);
      assert.equal(
        harness.firestore.queryReads.filter(
          ({ path }) => path === paths("team-1", "game-1").events,
        ).length,
        1,
      );
    });
  }


  for (const failingStage of ["root", "events"]) {
    it(`releases both private-history leases after a ${failingStage} read failure`, async () => {
      const harness = createHarness();
      await activate(harness);
      const resourcePaths = paths("team-1", "game-1");
      let failed = false;
      harness.firestore.documentAsyncHook = async (reference) => {
        if (
          failingStage === "root" &&
          reference.path === resourcePaths.scorebook &&
          !failed
        ) {
          failed = true;
          throw new Error("root read failed");
        }
      };
      harness.firestore.queryAsyncHook = async (query) => {
        if (
          failingStage === "events" &&
          query.path === resourcePaths.events &&
          !failed
        ) {
          failed = true;
          throw new Error("event read failed");
        }
      };
      await assert.rejects(
        harness.handlers.listDiamondEvents(
          {
            teamId: "team-1",
            gameId: "game-1",
            visibility: "private",
            limit: 200,
          },
          harness.managerContext,
        ),
        (error) => error.code === "unavailable",
      );
      const admission = privateHistoryControl(
        harness,
        "diamond-private-history-read-admission",
      ).value;
      const scope = privateHistoryControl(
        harness,
        "diamond-private-history-read-scope",
      ).value;
      assert.deepEqual(admission.activeAttempts, []);
      assert.deepEqual(scope.activeAttempts, []);
      assert.equal(scope.recentTerminals.at(-1).status, "failed");
      harness.firestore.documentAsyncHook = null;
      harness.firestore.queryAsyncHook = null;
      const recovered = await harness.handlers.listDiamondEvents(
        {
          teamId: "team-1",
          gameId: "game-1",
          visibility: "private",
          limit: 200,
        },
        harness.managerContext,
      );
      assert.equal(recovered.complete, true);
    });
  }


  for (const controlType of [
    "diamond-private-history-read-admission",
    "diamond-private-history-read-scope",
  ]) {
    it(`fails malformed ${controlType} state closed until quarantine expiry`, async () => {
      let nowMs = 1_750_000_000_000;
      const harness = createHarness({ clock: () => nowMs });
      await activate(harness);
      const request = {
        teamId: "team-1",
        gameId: "game-1",
        visibility: "private",
        limit: 200,
      };
      await harness.handlers.listDiamondEvents(request, harness.managerContext);
      const control = privateHistoryControl(harness, controlType);
      harness.firestore.seed(control.path, {
        ...control.value,
        requestCount: "corrupt",
      });
      harness.firestore.setDocumentUpdateTime(control.path, nowMs);
      const eventReadsBefore = harness.firestore.queryReads.filter(
        ({ path }) => path === paths("team-1", "game-1").events,
      ).length;
      await assert.rejects(
        harness.handlers.listDiamondEvents(request, harness.managerContext),
        (error) =>
          error.code === "unavailable" &&
          error.details?.reason === "private-history-control-invalid",
      );
      assert.equal(
        harness.firestore.queryReads.filter(
          ({ path }) => path === paths("team-1", "game-1").events,
        ).length,
        eventReadsBefore,
      );

      nowMs += PRIVATE_HISTORY_CONTROL_QUARANTINE_MS + 1;
      const recovered = await harness.handlers.listDiamondEvents(
        request,
        harness.managerContext,
      );
      assert.equal(recovered.complete, true);
      const repaired = privateHistoryControl(harness, controlType).value;
      assert.equal(repaired.requestCount, 1);
      assert.deepEqual(repaired.activeAttempts, []);
    });
  }


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
