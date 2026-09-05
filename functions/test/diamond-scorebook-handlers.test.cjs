"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  DIAMOND_ENGINE,
  LEGACY_TRACKING_COLLECTIONS,
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
  }

  get(reference) {
    if (reference instanceof FakeQuery)
      return Promise.resolve(this.database._querySnapshot(reference));
    return Promise.resolve(this.database._documentSnapshot(reference));
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
  }

  doc(path) {
    return new FakeDocumentReference(this, path);
  }

  collection(path) {
    return new FakeQuery(this, path);
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

function baseDocuments(overrides = {}) {
  return {
    "securityPolicies/diamondScorebook": {
      mode: "enabled",
      revision: 1,
      teamIds: [],
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
    "teams/team-1/games/game-1": {
      id: "game-1",
      teamId: "team-1",
      type: "game",
      status: "scheduled",
      visibility: "public",
      opponentName: "Rockets",
      homeTeamId: "team-1",
      awayTeamId: "opponent-1",
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
    clock: () => 1_750_000_000_000,
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
    recursiveDelete: (reference) => firestore.recursiveDelete(reference),
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
  },
) {
  return harness.handlers.submitDiamondCommand(
    {
      schemaVersion: 2,
      commandId,
      teamId: "team-1",
      gameId: "game-1",
      expectedRevision,
      rulesProfileId: "baseball-youth",
      rulesProfileVersion: 1,
      type,
      payload,
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
  const started = await submit(harness, {
    commandId: makeUuid(22),
    expectedRevision: 3,
    type: "start",
  });
  assert.equal(started.outcome, "accepted");
  return started;
}

describe("Diamond scorebook handler factory", () => {
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
        { teamId: "team-1", gameId: "game-1" },
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
      { teamId: "team-1" },
      harness.managerContext,
    );
    assert.equal(access.policyMode, "disabled");
    assert.equal(access.reason, "policy-unreadable");
  });

  it("blocks inactive teams, legacy data, and unknown tracking engines without claiming a game", async () => {
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
    assert.equal(root.instanceId, game.diamondScorebookInstanceId);
    const publicState = harness.firestore.read(
      paths("team-1", "game-1").publicState,
    );
    assert.doesNotMatch(
      JSON.stringify(publicState),
      /availablePlayers|medicalInfo|guardianEmail|currentScorerUid/,
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
    const result = await submit(harness, {
      commandId: makeUuid(33),
      expectedRevision: 1,
      type: "set_lineup",
      context: harness.scorerContext,
      payload: { side: "home", entries: [{ slot: 1, playerId: "home-1" }] },
    });
    assert.equal(result.outcome, "rejected");
    assert.equal(result.rejection.code, "scorer-lease-lost");
    await assert.rejects(
      harness.handlers.regenerateDiamondProjection(
        { teamId: "team-1", gameId: "game-1" },
        harness.scorerContext,
      ),
      (error) => error.code === "permission-denied",
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
    const publicState = await harness.handlers.getDiamondState({
      teamId: "team-1",
      gameId: "game-1",
      visibility: "public",
    });
    const publicPage = await harness.handlers.listDiamondEvents({
      teamId: "team-1",
      gameId: "game-1",
      visibility: "public",
      limit: 20,
    });
    const serialized = JSON.stringify({ publicState, publicPage });
    assert.doesNotMatch(
      serialized,
      /Coach says|manager-1|currentScorerUid|commandHash|actorUid/,
    );
    assert.equal(
      publicPage.items.some((event) => event.type === "private_note"),
      false,
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
      const page = await harness.handlers.listDiamondEvents({
        teamId: "team-1",
        gameId: "game-1",
        visibility: "public",
        limit: 200,
        cursor,
      });
      pages += 1;
      total += page.items.length;
      if (page.nextCursor) assert.equal(page.collectionComplete, false);
      cursor = page.nextCursor;
      if (!cursor) assert.equal(page.collectionComplete, true);
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
      expectedRevision: 4,
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
      expectedRevision: 5,
      type: "void_event",
      payload: {
        targetEventId: pitch.eventId,
        reason: "Pitch was never delivered",
      },
    });
    assert.equal(correction.outcome, "accepted");
    assert.equal(correction.revision, 6);
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
      expectedRevision: 5,
      type: "void_event",
      payload: {
        targetEventId: pitch.eventId,
        reason: "Pitch was never delivered",
      },
    });
    assert.equal(duplicateCorrection.outcome, "duplicate");
    assert.equal(duplicateCorrection.revision, 6);

    await assert.rejects(
      submit(harness, {
        commandId: makeUuid(42),
        expectedRevision: 6,
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
      expectedRevision: 4,
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
    assert.equal(play.revision, 5);

    const rejected = await submit(harness, {
      commandId: makeUuid(46),
      expectedRevision: 5,
      type: "record_fielding",
      payload: {
        playEventId: "missing-play",
        fielding: { putoutBy: "home-1", battedBall: "ground" },
      },
    });
    assert.equal(rejected.outcome, "rejected");
    assert.equal(rejected.revision, 5);
    assert.equal(rejected.rejection.code, "unknown-play-target");
    assert.equal(
      harness.firestore.read(paths("team-1", "game-1").command(makeUuid(46))),
      undefined,
    );

    const accepted = await submit(harness, {
      commandId: makeUuid(47),
      expectedRevision: 5,
      type: "record_fielding",
      payload: {
        playEventId: play.eventId,
        fielding: { putoutBy: "home-1", battedBall: "ground" },
      },
    });
    assert.equal(accepted.outcome, "accepted");
    assert.equal(accepted.revision, 6);
  });

  it("uses revision/hash CAS when a correction races another authoritative update", async () => {
    const harness = createHarness();
    await activate(harness);
    await startGame(harness);
    const pitch = await submit(harness, {
      commandId: makeUuid(43),
      expectedRevision: 4,
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
      expectedRevision: 5,
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
    assert.equal(newest.nextCursor, "2");
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

  it("serves the legacy-compatible public game envelope without private fields", async () => {
    const harness = createHarness();
    await activate(harness);
    const result = await harness.handlers.getPublicDiamondGame({
      teamId: "team-1",
      gameId: "game-1",
      limit: 50,
    });
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

  it("deletes only descendants that match the deleted game generation and records a durable cleanup lock", async () => {
    const harness = createHarness();
    await activate(harness);
    const gamePath = paths("team-1", "game-1").game;
    const deletedGame = harness.firestore.read(gamePath);
    const snapshot = new FakeDocumentSnapshot(
      harness.firestore.doc(gamePath),
      deletedGame,
    );
    harness.firestore.delete(gamePath);
    const result = await harness.handlers.cleanupDeletedDiamondGame(snapshot);
    assert.equal(result.cleaned, true);
    assert.equal(
      harness.firestore.read(paths("team-1", "game-1").scorebook),
      undefined,
    );
    assert.equal(
      harness.firestore.read(paths("team-1", "game-1").publicState),
      undefined,
    );
    assert.deepEqual(
      harness.firestore.read(paths("team-1", "game-1").cleanupLock),
      {
        schemaVersion: 1,
        generation: deletedGame.diamondScorebookInstanceId,
        status: "complete",
        complete: true,
        updatedAt: "2025-06-15T15:06:40.000Z",
        completedAt: "2025-06-15T15:06:40.000Z",
      },
    );
  });

  it("retains descendants when cleanup generation is missing, mismatched, or the game was recreated", async () => {
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
    assert.equal(recreated.reason, "game-recreated");
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
        { teamId: "team-1" },
        harness.managerContext,
      ),
      (error) => error.code === "permission-denied",
    );
  });
});
