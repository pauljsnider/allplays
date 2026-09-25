"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { describe, it } = require("node:test");

const {
  MAX_CONCURRENT_SCORER_CANDIDATE_GLOBAL_REQUESTS,
  MAX_SCORER_CANDIDATE_LOCK_BYTES,
  MAX_SCORER_CANDIDATE_RECEIPT_BYTES,
  MAX_SCORER_CANDIDATE_REQUESTS_PER_WINDOW,
  SCORER_CANDIDATE_CALLABLE_ENVELOPE_MS,
  SCORER_CANDIDATE_CONTROL_QUARANTINE_MS,
  SCORER_CANDIDATE_RATE_WINDOW_MS,
  SCORER_CANDIDATE_RECEIPT_RETENTION_MS,
  SCORER_CANDIDATE_REQUEST_LEASE_MS,
  createDiamondScorerCandidateAdmission,
} = require("../diamond-scorer-candidate-admission.cjs");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class TestHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = "HttpsError";
    this.code = code;
    this.details = details;
  }
}

class Snapshot {
  constructor(ref, value) {
    this.ref = ref;
    this.exists = value !== undefined;
    this.value = clone(value);
    const updatedAtMs = ref.database.updateTimes.get(ref.path);
    if (Number.isSafeInteger(updatedAtMs)) {
      this.updateTime = { toMillis: () => updatedAtMs };
    }
  }

  data() {
    return clone(this.value);
  }
}

class Reference {
  constructor(database, path) {
    this.database = database;
    this.path = path;
  }
}

class Collection {
  constructor(database, path) {
    this.database = database;
    this.path = path;
  }

  doc(id) {
    return this.database.doc(`${this.path}/${id}`);
  }
}

class Transaction {
  constructor(database) {
    this.database = database;
    this.readPaths = [];
    this.operations = [];
    database.readBatches.push(this.readPaths);
  }

  get(ref) {
    this.readPaths.push(ref.path);
    return Promise.resolve(
      new Snapshot(ref, this.database.documents.get(ref.path)),
    );
  }

  set(ref, value) {
    this.operations.push({ ref, value: clone(value) });
  }

  commit() {
    const next = new Map(this.database.documents);
    for (const { ref, value } of this.operations)
      next.set(ref.path, clone(value));
    this.database.documents = next;
    for (const { ref } of this.operations) {
      this.database.updateTimes.set(ref.path, this.database.nowMs);
    }
    this.database.commits.push(
      this.operations.map(({ ref, value }) => ({ path: ref.path, value })),
    );
  }
}

class Firestore {
  constructor(nowMs) {
    this.nowMs = nowMs;
    this.documents = new Map();
    this.updateTimes = new Map();
    this.commits = [];
    this.readBatches = [];
    this.queue = Promise.resolve();
    this.hook = null;
  }

  doc(path) {
    return new Reference(this, path);
  }

  collection(path) {
    return new Collection(this, path);
  }

  runTransaction(callback) {
    const run = async () => {
      const transaction = new Transaction(this);
      const result = await callback(transaction);
      const directive = await this.hook?.("beforeCommit", transaction, result);
      if (directive === "retry") throw new Error("transaction retry");
      if (directive === "retry-after-commit") {
        transaction.commit();
        await this.hook?.("afterRetryableCommit", transaction, result);
        throw new Error("ambiguous commit");
      }
      transaction.commit();
      return result;
    };
    const pending = this.queue.then(run, run);
    this.queue = pending.catch(() => {});
    return pending;
  }

  read(path) {
    return clone(this.documents.get(path));
  }

  seed(path, value, updatedAtMs = this.nowMs) {
    this.documents.set(path, clone(value));
    this.updateTimes.set(path, updatedAtMs);
  }
}

function makeUuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function hashValue(value) {
  return `sha256:${crypto
    .createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex")}`;
}

function createHarness() {
  let nowMs = 1_750_000_000_000;
  const firestore = new Firestore(nowMs);
  const admission = createDiamondScorerCandidateAdmission({
    firestore,
    collectionName: "diamondManagerStatReadControls",
    clock: () => nowMs,
    hashValue,
    makeError: (code, message, details) =>
      new TestHttpsError(code, message, details),
    logger: { error() {} },
  });
  return {
    admission,
    firestore,
    now: () => nowMs,
    advance(milliseconds) {
      nowMs += milliseconds;
      firestore.nowMs = nowMs;
    },
  };
}

function request(index = 1, overrides = {}) {
  return {
    requestId: makeUuid(index),
    teamId: "team-1",
    gameId: "game-1",
    expectedInstanceId: makeUuid(900),
    expectedRevision: 3,
    leaseId: makeUuid(901),
    ...overrides,
  };
}

function controls(firestore) {
  return [...firestore.documents.entries()].map(([path, value]) => ({
    path,
    value: clone(value),
  }));
}

function scorerControls(firestore, kind) {
  return controls(firestore).filter(({ path }) =>
    path.includes(`/scorer-candidate-${kind}-`),
  );
}

function rateControls(firestore) {
  return controls(firestore).filter(({ path }) =>
    /^diamondManagerStatReadControls\/[0-9a-f]{64}$/.test(path),
  );
}

async function reserve(harness, requestValue, execution = 1) {
  return harness.admission.reserve({
    request: requestValue,
    callerUid: "manager-1",
    executionId: makeUuid(execution),
  });
}

async function finish(harness, reservation, candidates = []) {
  let authorizationCalls = 0;
  await harness.admission.complete({
    reservation,
    candidates,
    authorize() {
      authorizationCalls += 1;
    },
  });
  return authorizationCalls;
}

describe("Diamond scorer candidate admission", () => {
  it("atomically charges four domain-separated limits and stores only bounded private receipt data", async () => {
    const harness = createHarness();
    const reservation = await reserve(harness, request(1), 101);
    assert.equal(reservation.kind, "execute");
    assert.equal(rateControls(harness.firestore).length, 4);
    assert.ok(
      rateControls(harness.firestore).every(({ value }) => value.count === 1),
    );
    assert.equal(scorerControls(harness.firestore, "global").length, 1);
    assert.equal(scorerControls(harness.firestore, "scope").length, 1);
    assert.equal(scorerControls(harness.firestore, "receipt").length, 1);

    const candidates = [
      { playerId: "candidate:1", name: "Candidate One" },
      { playerId: "candidate.2", name: "Candidate Two" },
    ];
    assert.equal(await finish(harness, reservation, candidates), 1);
    const locks = [
      ...scorerControls(harness.firestore, "global"),
      ...scorerControls(harness.firestore, "scope"),
    ];
    assert.ok(locks.every(({ value }) => value.activeAttempts.length === 0));
    assert.ok(
      locks.every(
        ({ value }) =>
          Buffer.byteLength(JSON.stringify(value), "utf8") <
          MAX_SCORER_CANDIDATE_LOCK_BYTES,
      ),
    );
    const receipt = scorerControls(harness.firestore, "receipt")[0].value;
    assert.equal(receipt.status, "complete");
    assert.equal(receipt.replayStatus, "available");
    assert.deepEqual(receipt.candidates, candidates);
    assert.ok(
      Buffer.byteLength(JSON.stringify(receipt), "utf8") <
        MAX_SCORER_CANDIDATE_RECEIPT_BYTES,
    );
    assert.doesNotMatch(
      JSON.stringify([...locks, ...rateControls(harness.firestore)]),
      /manager-1|team-1|game-1|00000000-0000/,
    );
  });

  it("replays one exact completed response without quota or candidate-source work", async () => {
    const harness = createHarness();
    const requestValue = request(2);
    await finish(harness, await reserve(harness, requestValue, 201), [
      { playerId: "target", name: "Target" },
    ]);
    const rateBefore = rateControls(harness.firestore).map(
      ({ value }) => value.count,
    );
    const replayReservation = await reserve(harness, requestValue, 202);
    assert.equal(replayReservation.kind, "replay");
    let authorityCalls = 0;
    const replayed = await harness.admission.replay({
      reservation: replayReservation,
      authorize() {
        authorityCalls += 1;
      },
    });
    assert.deepEqual(replayed, [{ playerId: "target", name: "Target" }]);
    assert.equal(authorityCalls, 1);
    assert.deepEqual(
      rateControls(harness.firestore).map(({ value }) => value.count),
      rateBefore,
    );
    await assert.rejects(
      reserve(harness, requestValue, 203),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "scorer-candidate-replay-limited",
    );
  });

  it("uses a bounded replay lease near receipt expiry and fails before fan-out at the callable boundary", async () => {
    const harness = createHarness();
    const firstRequest = request(3);
    await finish(harness, await reserve(harness, firstRequest, 301));
    harness.advance(
      SCORER_CANDIDATE_RECEIPT_RETENTION_MS -
        SCORER_CANDIDATE_REQUEST_LEASE_MS +
        1,
    );
    const replay = await reserve(harness, firstRequest, 302);
    const active = scorerControls(harness.firestore, "scope")[0].value
      .activeAttempts[0];
    const receipt = scorerControls(harness.firestore, "receipt")[0].value;
    assert.equal(replay.kind, "replay");
    assert.equal(active.leaseExpiresAtMs, receipt.expiresAt.getTime());
    assert.ok(
      active.leaseExpiresAtMs - harness.now() >
        SCORER_CANDIDATE_CALLABLE_ENVELOPE_MS,
    );
    await harness.admission.fail({ reservation: replay, failureCode: "test" });

    const secondRequest = request(4);
    await finish(harness, await reserve(harness, secondRequest, 303));
    harness.advance(
      SCORER_CANDIDATE_RECEIPT_RETENTION_MS -
        SCORER_CANDIDATE_CALLABLE_ENVELOPE_MS,
    );
    const ratesBefore = rateControls(harness.firestore).map(
      ({ value }) => value.count,
    );
    await assert.rejects(
      reserve(harness, secondRequest, 304),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "scorer-candidate-replay-expiring",
    );
    assert.deepEqual(
      rateControls(harness.firestore).map(({ value }) => value.count),
      ratesBefore,
    );
  });

  it("deduplicates one scope, caps two caller-wide active scopes, and charges nothing on denial", async () => {
    const harness = createHarness();
    const first = await reserve(harness, request(10), 401);
    const rateBefore = rateControls(harness.firestore).map(
      ({ value }) => value.count,
    );
    await assert.rejects(
      reserve(harness, request(11), 402),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "scorer-candidate-duplicate-active",
    );
    assert.deepEqual(
      rateControls(harness.firestore).map(({ value }) => value.count),
      rateBefore,
    );
    const second = await reserve(
      harness,
      request(12, { gameId: "game-2" }),
      403,
    );
    assert.equal(
      scorerControls(harness.firestore, "global")[0].value.activeAttempts
        .length,
      MAX_CONCURRENT_SCORER_CANDIDATE_GLOBAL_REQUESTS,
    );
    await assert.rejects(
      reserve(harness, request(13, { gameId: "game-3" }), 404),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "scorer-candidate-global-concurrency-limited",
    );
    await harness.admission.fail({ reservation: first, failureCode: "test" });
    await harness.admission.fail({ reservation: second, failureCode: "test" });
  });

  it("reconciles a cross-window reservation response loss with one charge", async () => {
    const harness = createHarness();
    let injected = false;
    harness.firestore.hook = (phase, transaction) => {
      if (
        phase === "beforeCommit" &&
        transaction.operations.length === 7 &&
        !injected
      ) {
        injected = true;
        return "retry-after-commit";
      }
      if (phase === "afterRetryableCommit") {
        harness.advance(SCORER_CANDIDATE_RATE_WINDOW_MS + 1);
      }
      return undefined;
    };
    const reservation = await reserve(harness, request(20), 501);
    assert.equal(reservation.kind, "execute");
    assert.equal(injected, true);
    assert.ok(
      rateControls(harness.firestore).every(({ value }) => value.count === 1),
    );
    await harness.admission.fail({ reservation, failureCode: "test" });
  });

  it("charges each confirmed failed re-execution and atomically leaves other limits unchanged on denial", async () => {
    const harness = createHarness();
    const requestValue = request(30);
    for (
      let index = 0;
      index < MAX_SCORER_CANDIDATE_REQUESTS_PER_WINDOW;
      index += 1
    ) {
      const reservation = await reserve(harness, requestValue, 600 + index);
      await harness.admission.fail({ reservation, failureCode: "transient" });
    }
    const before = new Map(
      rateControls(harness.firestore).map(({ path, value }) => [
        path,
        value.count,
      ]),
    );
    await assert.rejects(
      reserve(harness, requestValue, 700),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "scorer-candidate-rate-limited",
    );
    assert.deepEqual(
      new Map(
        rateControls(harness.firestore).map(({ path, value }) => [
          path,
          value.count,
        ]),
      ),
      before,
    );
  });

  it("reconciles ambiguous completion, replay, and failure releases without reopening capacity", async () => {
    const harness = createHarness();
    const once = (predicate) => {
      let injected = false;
      harness.firestore.hook = (phase, transaction) => {
        if (phase === "beforeCommit" && predicate(transaction) && !injected) {
          injected = true;
          return "retry-after-commit";
        }
        return undefined;
      };
      return () => injected;
    };
    const completion = await reserve(harness, request(40), 801);
    const completionInjected = once((transaction) =>
      transaction.operations.some(({ value }) => value?.status === "complete"),
    );
    assert.equal(await finish(harness, completion), 1);
    assert.equal(completionInjected(), true);

    const replay = await reserve(harness, request(40), 802);
    const replayInjected = once((transaction) =>
      transaction.operations.some(
        ({ value }) => value?.replayStatus === "completed",
      ),
    );
    let replayAuth = 0;
    await harness.admission.replay({
      reservation: replay,
      authorize() {
        replayAuth += 1;
      },
    });
    assert.equal(replayAuth, 1);
    assert.equal(replayInjected(), true);

    const failed = await reserve(harness, request(41), 803);
    const failureInjected = once((transaction) =>
      transaction.operations.some(({ value }) => value?.status === "failed"),
    );
    await harness.admission.fail({ reservation: failed, failureCode: "boom" });
    assert.equal(failureInjected(), true);
    assert.ok(
      scorerControls(harness.firestore, "global")[0].value.activeAttempts
        .length === 0,
    );
  });

  it("quarantines null and malformed nested state, then resets only after retention", async () => {
    for (const kind of ["global", "scope", "receipt"]) {
      const harness = createHarness();
      const first = await reserve(harness, request(50), 901);
      await harness.admission.fail({ reservation: first, failureCode: "test" });
      const target = scorerControls(harness.firestore, kind)[0];
      harness.firestore.seed(
        target.path,
        kind === "receipt" ? null : { ...target.value, activeAttempts: [null] },
      );
      await assert.rejects(
        reserve(harness, request(kind === "receipt" ? 50 : 51), 902),
        (error) =>
          error.code === "unavailable" &&
          error.details?.reason === "scorer-candidate-control-invalid",
      );
      harness.advance(SCORER_CANDIDATE_CONTROL_QUARANTINE_MS + 1);
      const recovered = await reserve(
        harness,
        request(kind === "receipt" ? 50 : 52),
        903,
      );
      assert.equal(recovered.kind, "execute");
      await harness.admission.fail({
        reservation: recovered,
        failureCode: "test",
      });
    }
  });

  it("fails closed on a paired lock with the wrong input hash", async () => {
    const harness = createHarness();
    const requestValue = request(55);
    const reservation = await reserve(harness, requestValue, 951);
    const poisonedInputHash = `sha256:${"f".repeat(64)}`;
    for (const kind of ["global", "scope"]) {
      const target = scorerControls(harness.firestore, kind)[0];
      harness.firestore.seed(target.path, {
        ...target.value,
        activeAttempts: target.value.activeAttempts.map((attempt) => ({
          ...attempt,
          inputHash: poisonedInputHash,
        })),
      });
    }
    await assert.rejects(
      reserve(harness, requestValue, 951),
      (error) =>
        error.code === "unavailable" &&
        error.details?.reason === "scorer-candidate-admission-unconfirmed",
    );
    await harness.admission.fail({ reservation, failureCode: "cleanup" });
    assert.equal(
      scorerControls(harness.firestore, "scope")[0].value.activeAttempts.length,
      1,
    );
  });

  it("rejects one logical request ID reused for a different input", async () => {
    const harness = createHarness();
    const original = request(56);
    const reservation = await reserve(harness, original, 961);
    await harness.admission.fail({ reservation, failureCode: "test" });
    await assert.rejects(
      reserve(
        harness,
        { ...original, expectedRevision: original.expectedRevision + 1 },
        962,
      ),
      (error) =>
        error.code === "failed-precondition" &&
        error.details?.reason === "scorer-candidate-request-conflict",
    );
  });

  it("does not let stale failure cleanup remove a successor after lease expiry", async () => {
    const harness = createHarness();
    const stale = await reserve(harness, request(60), 1001);
    harness.advance(SCORER_CANDIDATE_REQUEST_LEASE_MS + 1);
    const successor = await reserve(harness, request(61), 1002);
    await harness.admission.fail({ reservation: stale, failureCode: "late" });
    const scope = scorerControls(harness.firestore, "scope")[0].value;
    assert.equal(scope.activeAttempts.length, 1);
    assert.equal(
      scope.activeAttempts[0].executionHash,
      successor.identity.executionHash,
    );
    await harness.admission.fail({
      reservation: successor,
      failureCode: "test",
    });
  });
});
