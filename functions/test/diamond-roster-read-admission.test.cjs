"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { describe, it } = require("node:test");

const {
  DIAMOND_ROSTER_READ_CONTROL_QUARANTINE_MS,
  DIAMOND_ROSTER_READ_LEASE_MS,
  DIAMOND_ROSTER_READ_RATE_WINDOW_MS,
  DIAMOND_ROSTER_READ_SUSTAINED_WINDOW_MS,
  MAX_CONCURRENT_DIAMOND_ROSTER_READS,
  MAX_DIAMOND_ROSTER_READ_CONTROL_BYTES,
  MAX_DIAMOND_ROSTER_READS_PER_WINDOW,
  MAX_DIAMOND_ROSTER_SUSTAINED_READS_PER_WINDOW,
  createDiamondRosterReadAdmission,
} = require("../diamond-roster-read-admission.cjs");

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
    for (const { ref, value } of this.operations) {
      next.set(ref.path, clone(value));
      this.database.updateTimes.set(ref.path, this.database.nowMs);
    }
    this.database.documents = next;
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
  const admission = createDiamondRosterReadAdmission({
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
    callerUid: "manager-1",
    teamId: "team-1",
    gameId: "game-1",
    operation: "state",
    sourceRevision: 17,
    input: { visibility: "private" },
    attemptId: makeUuid(index),
    ...overrides,
  };
}

function controls(firestore) {
  return [...firestore.documents.entries()].map(([path, value]) => ({
    path,
    value: clone(value),
  }));
}

function lockControl(firestore) {
  return controls(firestore).find(({ path }) =>
    path.includes("/roster-read-lock-"),
  );
}

function rateControls(firestore) {
  return controls(firestore).filter(({ path }) =>
    /^diamondManagerStatReadControls\/[0-9a-f]{64}$/.test(path),
  );
}

describe("Diamond roster read admission", () => {
  it("atomically charges two domain-separated limits and persists bounded hash-only control state", async () => {
    const harness = createHarness();
    const reservation = await harness.admission.reserve(request(1));
    assert.equal(reservation.kind, "diamond-roster-read");
    assert.equal(rateControls(harness.firestore).length, 2);
    assert.ok(
      rateControls(harness.firestore).every(({ value }) => value.count === 1),
    );
    const lock = lockControl(harness.firestore);
    assert.equal(lock.value.activeAttempts.length, 1);
    assert.ok(
      Buffer.byteLength(JSON.stringify(lock.value), "utf8") <
        MAX_DIAMOND_ROSTER_READ_CONTROL_BYTES,
    );
    assert.doesNotMatch(
      JSON.stringify(controls(harness.firestore)),
      /manager-1|team-1|game-1|00000000-0000/,
    );
    await harness.admission.fail({ reservation });
    assert.equal(lockControl(harness.firestore).value.activeAttempts.length, 0);
  });

  it("deduplicates identical work, caps distinct concurrency, and does not charge denied calls", async () => {
    const harness = createHarness();
    const first = await harness.admission.reserve(request(10));
    const counts = () =>
      rateControls(harness.firestore).map(({ value }) => value.count);
    const afterFirst = counts();
    await assert.rejects(
      harness.admission.reserve(request(11)),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "diamond-roster-read-duplicate-active",
    );
    assert.deepEqual(counts(), afterFirst);
    const second = await harness.admission.reserve(
      request(12, {
        operation: "voice",
        input: { transcript: "next half", rulesProfileId: "rules-1" },
      }),
    );
    assert.equal(
      lockControl(harness.firestore).value.activeAttempts.length,
      MAX_CONCURRENT_DIAMOND_ROSTER_READS,
    );
    const afterSecond = counts();
    await assert.rejects(
      harness.admission.reserve(
        request(13, { sourceRevision: 18, input: { visibility: "private" } }),
      ),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "diamond-roster-read-concurrency-limited",
    );
    assert.deepEqual(counts(), afterSecond);
    await harness.admission.fail({ reservation: first });
    await harness.admission.fail({ reservation: second });
  });

  it("enforces the per-minute budget without mutating either control on rejection", async () => {
    const harness = createHarness();
    for (
      let index = 0;
      index < MAX_DIAMOND_ROSTER_READS_PER_WINDOW;
      index += 1
    ) {
      const reservation = await harness.admission.reserve(request(100 + index));
      await harness.admission.fail({ reservation });
    }
    const before = new Map(
      controls(harness.firestore).map(({ path, value }) => [path, value]),
    );
    await assert.rejects(
      harness.admission.reserve(request(999)),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "diamond-roster-read-rate-limited",
    );
    assert.deepEqual(
      new Map(
        controls(harness.firestore).map(({ path, value }) => [path, value]),
      ),
      before,
    );
  });

  it("admits the bounded retry cadence but stops it at the ten-minute sustained ceiling", async () => {
    const harness = createHarness();
    for (
      let index = 0;
      index < MAX_DIAMOND_ROSTER_SUSTAINED_READS_PER_WINDOW;
      index += 1
    ) {
      if (index > 0 && index % MAX_DIAMOND_ROSTER_READS_PER_WINDOW === 0) {
        harness.advance(DIAMOND_ROSTER_READ_RATE_WINDOW_MS + 1);
      }
      const reservation = await harness.admission.reserve(
        request(2_000 + index),
      );
      await harness.admission.fail({ reservation });
    }
    await assert.rejects(
      harness.admission.reserve(request(3_000)),
      (error) =>
        error.code === "resource-exhausted" &&
        error.details?.reason === "diamond-roster-read-rate-limited",
    );
    const elapsed =
      (MAX_DIAMOND_ROSTER_SUSTAINED_READS_PER_WINDOW /
        MAX_DIAMOND_ROSTER_READS_PER_WINDOW -
        1) *
      (DIAMOND_ROSTER_READ_RATE_WINDOW_MS + 1);
    harness.advance(DIAMOND_ROSTER_READ_SUSTAINED_WINDOW_MS - elapsed + 1);
    const reset = await harness.admission.reserve(request(3_001));
    await harness.admission.fail({ reservation: reset });
  });

  it("reconciles a reservation response loss across a rate-window boundary with one charge", async () => {
    const harness = createHarness();
    let injected = false;
    harness.firestore.hook = (phase, transaction) => {
      if (
        phase === "beforeCommit" &&
        transaction.operations.length === 3 &&
        !injected
      ) {
        injected = true;
        return "retry-after-commit";
      }
      if (phase === "afterRetryableCommit") {
        harness.advance(DIAMOND_ROSTER_READ_RATE_WINDOW_MS + 1);
      }
      return undefined;
    };
    const reservation = await harness.admission.reserve(request(300));
    assert.equal(injected, true);
    assert.ok(
      rateControls(harness.firestore).every(({ value }) => value.count === 1),
    );
    await harness.admission.fail({ reservation });
  });

  it("runs final authorization before atomic completion and reconciles an ambiguous commit", async () => {
    const harness = createHarness();
    const reservation = await harness.admission.reserve(request(400));
    let authorizationCalls = 0;
    let injected = false;
    harness.firestore.hook = (phase, transaction) => {
      if (
        phase === "beforeCommit" &&
        transaction.operations.some(({ value }) =>
          value?.recentTerminals?.some(({ status }) => status === "complete"),
        ) &&
        !injected
      ) {
        injected = true;
        return "retry-after-commit";
      }
      return undefined;
    };
    const result = await harness.admission.complete({
      reservation,
      authorize(transaction) {
        authorizationCalls += 1;
        assert.equal(transaction.operations.length, 0);
        assert.equal(
          lockControl(harness.firestore).value.activeAttempts.length,
          authorizationCalls === 1 ? 1 : 0,
        );
        return { authoritative: true };
      },
    });
    assert.deepEqual(result, { authoritative: true });
    assert.equal(injected, true);
    assert.equal(authorizationCalls, 2);
    const lock = lockControl(harness.firestore).value;
    assert.equal(lock.activeAttempts.length, 0);
    assert.equal(lock.recentTerminals.at(-1).status, "complete");
  });

  it("reconciles an ambiguous failure release without reopening or retaining capacity", async () => {
    const harness = createHarness();
    const reservation = await harness.admission.reserve(request(450));
    let injected = false;
    harness.firestore.hook = (phase, transaction) => {
      if (
        phase === "beforeCommit" &&
        transaction.operations.some(({ value }) =>
          value?.recentTerminals?.some(({ status }) => status === "failed"),
        ) &&
        !injected
      ) {
        injected = true;
        return "retry-after-commit";
      }
      return undefined;
    };
    await harness.admission.fail({ reservation });
    assert.equal(injected, true);
    assert.deepEqual(lockControl(harness.firestore).value.activeAttempts, []);
    assert.equal(
      lockControl(harness.firestore).value.recentTerminals.at(-1).status,
      "failed",
    );
  });

  it("fails closed with a valid callable error when the same attempt is already terminal", async () => {
    for (const [index, status] of [
      [460, "complete"],
      [461, "failed"],
    ]) {
      const harness = createHarness();
      const logicalRequest = request(index);
      const reservation = await harness.admission.reserve(logicalRequest);
      if (status === "complete") {
        await harness.admission.complete({
          reservation,
          authorize: () => ({ authoritative: true }),
        });
      } else {
        await harness.admission.fail({ reservation });
      }
      await assert.rejects(
        harness.admission.reserve(logicalRequest),
        (error) =>
          error.code === "unavailable" &&
          error.details?.reason ===
            "diamond-roster-read-admission-unconfirmed" &&
          /could not be reconciled/i.test(error.message),
      );
    }
  });

  it("releases failed work, prunes expired sibling leases, and cannot remove a successor", async () => {
    const harness = createHarness();
    const stale = await harness.admission.reserve(request(500));
    await harness.admission.reserve(
      request(501, {
        operation: "voice",
        input: { transcript: "switch sides", rulesProfileId: "rules-1" },
      }),
    );
    harness.advance(DIAMOND_ROSTER_READ_LEASE_MS + 1);
    const successor = await harness.admission.reserve(request(502));
    await harness.admission.fail({ reservation: stale });
    const lock = lockControl(harness.firestore).value;
    assert.equal(lock.activeAttempts.length, 1);
    assert.equal(
      lock.activeAttempts[0].attemptHash,
      successor.identity.attemptHash,
    );
    await harness.admission.fail({ reservation: successor });
  });

  it("fails closed on final authorization and releases only after explicit failure handling", async () => {
    const harness = createHarness();
    const reservation = await harness.admission.reserve(request(600));
    await assert.rejects(
      harness.admission.complete({
        reservation,
        authorize() {
          throw new TestHttpsError("permission-denied", "revoked");
        },
      }),
      (error) => error.code === "permission-denied",
    );
    assert.equal(lockControl(harness.firestore).value.activeAttempts.length, 1);
    await harness.admission.fail({ reservation });
    assert.equal(lockControl(harness.firestore).value.activeAttempts.length, 0);
  });

  it("quarantines null and malformed nested lock state, then resets the same scope after expiry", async () => {
    for (const poison of [null, { activeAttempts: [null] }]) {
      const harness = createHarness();
      const reservation = await harness.admission.reserve(request(700));
      await harness.admission.fail({ reservation });
      const lock = lockControl(harness.firestore);
      harness.firestore.seed(
        lock.path,
        poison === null ? null : { ...lock.value, ...poison },
      );
      await assert.rejects(
        harness.admission.reserve(request(701)),
        (error) =>
          error.code === "unavailable" &&
          error.details?.reason === "diamond-roster-read-control-invalid",
      );
      harness.advance(DIAMOND_ROSTER_READ_CONTROL_QUARANTINE_MS + 1);
      const recovered = await harness.admission.reserve(request(702));
      await harness.admission.fail({ reservation: recovered });
    }
  });

  it("fails closed when an attempt identity is paired with a different input hash", async () => {
    const harness = createHarness();
    const original = request(800);
    const reservation = await harness.admission.reserve(original);
    const changed = request(800, { sourceRevision: 18 });
    await assert.rejects(
      harness.admission.reserve(changed),
      (error) =>
        error.code === "unavailable" &&
        error.details?.reason === "diamond-roster-read-admission-unconfirmed",
    );
    await harness.admission.fail({ reservation });
  });
});
