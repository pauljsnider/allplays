"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  createDiamondScorebookNotificationSender,
  diamondNotificationProviderReceiptId,
  expectedViewerLink,
  receiptPath,
} = require("../diamond-scorebook-notification-sender.cjs");

const DEFAULT_INSTANCE_ID = "00000000-0000-4000-8000-000000000101";

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class FakeSnapshot {
  constructor(reference, value) {
    this.ref = reference;
    this.exists = value !== undefined;
    this._value = clone(value);
  }

  data() {
    return clone(this._value);
  }
}

class FakeReference {
  constructor(database, path) {
    this.database = database;
    this.path = path;
  }

  async get() {
    if (this.database.failReads > 0) {
      this.database.failReads -= 1;
      throw Object.assign(new Error("Injected read failure"), {
        code: "unavailable",
      });
    }
    return this.database.snapshot(this);
  }
}

class FakeTransaction {
  constructor(database) {
    this.database = database;
    this.operations = [];
  }

  async get(reference) {
    return this.database.snapshot(reference);
  }

  set(reference, value) {
    this.operations.push({ kind: "set", reference, value: clone(value) });
    return this;
  }

  update(reference, value) {
    this.operations.push({ kind: "update", reference, value: clone(value) });
    return this;
  }
}

class FakeFirestore {
  constructor() {
    this.documents = new Map();
    this.transactionQueue = Promise.resolve();
    this.transactionCount = 0;
    this.failBeforeTransactions = new Set();
    this.failAfterTransactions = new Set();
    this.failReads = 0;
  }

  doc(path) {
    return new FakeReference(this, path);
  }

  snapshot(reference) {
    return new FakeSnapshot(reference, this.documents.get(reference.path));
  }

  apply(operations) {
    for (const operation of operations) {
      if (operation.kind === "set") {
        this.documents.set(operation.reference.path, clone(operation.value));
        continue;
      }
      const current = this.documents.get(operation.reference.path);
      if (!current) throw new Error(`Missing ${operation.reference.path}`);
      this.documents.set(operation.reference.path, {
        ...clone(current),
        ...clone(operation.value),
      });
    }
  }

  runTransaction(callback) {
    const execute = async () => {
      this.transactionCount += 1;
      const transactionNumber = this.transactionCount;
      if (this.failBeforeTransactions.has(transactionNumber)) {
        this.failBeforeTransactions.delete(transactionNumber);
        throw Object.assign(new Error("Injected pre-commit failure"), {
          code: "unavailable",
        });
      }
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      this.apply(transaction.operations);
      if (this.failAfterTransactions.has(transactionNumber)) {
        this.failAfterTransactions.delete(transactionNumber);
        throw Object.assign(new Error("Injected committed response failure"), {
          code: "unavailable",
        });
      }
      return result;
    };
    const pending = this.transactionQueue.then(execute, execute);
    this.transactionQueue = pending.catch(() => {});
    return pending;
  }

  read(path) {
    return clone(this.documents.get(path));
  }
}

function request(overrides = {}) {
  const teamId = overrides.teamId || "team-1";
  const gameId = overrides.gameId || "game-1";
  const instanceId = overrides.instanceId || DEFAULT_INSTANCE_ID;
  const sourceRevision = overrides.sourceRevision || 8;
  const idempotencyKey = `diamond-v2:${teamId}:${gameId}:instance:${instanceId}:notification:r${String(sourceRevision).padStart(10, "0")}`;
  const link = expectedViewerLink(teamId, gameId);
  return {
    teamId,
    gameId,
    instanceId,
    sourceRevision,
    sourceEventId: "event-8",
    title: "Game update",
    body: "Away Player homered · Score 0–1",
    category: "liveScore",
    liveViewerLink: link,
    link,
    dedupKey: idempotencyKey,
    idempotencyKey,
    ...overrides,
  };
}

function deliveryResult(overrides = {}) {
  return {
    responses: [],
    successCount: 1,
    failureCount: 0,
    inboxWriteCount: 1,
    inboxCleanupCount: 0,
    inboxFailureCount: 0,
    providerDispatchAttempted: true,
    providerDeliveryUncertain: false,
    uncertainFailureCount: 0,
    ...overrides,
  };
}

function harness(options = {}) {
  const firestore = options.firestore || new FakeFirestore();
  const calls = [];
  let now = options.now || 1_760_000_000_000;
  let randomIndex = options.randomIndex || 700;
  const sender = createDiamondScorebookNotificationSender({
    firestore,
    clock: options.clock || (() => now),
    random: options.random || (() => uuid(randomIndex++)),
    leaseMillis: options.leaseMillis || 60_000,
    retryDelayMillis: options.retryDelayMillis || 5_000,
    logger: options.logger || { info() {}, warn() {}, error() {} },
    deliverNotification:
      options.deliverNotification ||
      (async (value, _metadata, hooks) => {
        calls.push(clone(value));
        await hooks.beforeProviderDispatch();
        return deliveryResult();
      }),
  });
  return {
    firestore,
    calls,
    sender,
    setNow(value) {
      now = value;
    },
  };
}

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

describe("Diamond scorebook notification sender", () => {
  it("claims one private receipt before delivery and deduplicates every later retry", async () => {
    const setup = harness();
    const value = request();
    const first = await setup.sender.sendDiamondNotification(value);
    const duplicate = await setup.sender.sendDiamondNotification(value);
    const path = receiptPath(
      value.teamId,
      value.gameId,
      value.instanceId,
      value.idempotencyKey,
    );
    const stored = setup.firestore.read(path);

    assert.equal(first.outcome, "sent");
    assert.equal(duplicate.outcome, "deduplicated");
    assert.equal(first.instanceId, value.instanceId);
    assert.equal(duplicate.instanceId, value.instanceId);
    assert.equal(first.idempotencyKey, value.idempotencyKey);
    assert.equal(
      first.providerReceiptId,
      diamondNotificationProviderReceiptId(value),
    );
    assert.equal(setup.calls.length, 1);
    assert.equal(stored.status, "completed");
    assert.equal(stored.instanceId, value.instanceId);
    assert.equal(stored.providerOutcome, "sent");
    assert.match(stored.requestHash, /^sha256:[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(stored), /Game update|homered|Score/);
    assert.match(
      path,
      /^teams\/team-1\/games\/game-1\/diamondScorebooks\/v2\/notificationReceipts\/receipt-[a-f0-9]{64}$/,
    );
  });

  it("serializes competing invocations with an active delivery lease", async () => {
    let releaseFirst;
    let enteredFirst;
    const entered = new Promise((resolve) => {
      enteredFirst = resolve;
    });
    const blocker = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let physicalSends = 0;
    const setup = harness({
      deliverNotification: async (_value, _metadata, hooks) => {
        await hooks.beforeProviderDispatch();
        physicalSends += 1;
        enteredFirst();
        await blocker;
        return deliveryResult();
      },
    });
    const first = setup.sender.sendDiamondNotification(request());
    await entered;
    await assert.rejects(
      setup.sender.sendDiamondNotification(request()),
      (error) =>
        error.code === "notification-delivery-pending" && error.retryable,
    );
    releaseFirst();
    assert.equal((await first).outcome, "sent");
    assert.equal(physicalSends, 1);
  });

  it("fails closed when one idempotency key is reused with a different payload", async () => {
    const setup = harness();
    await setup.sender.sendDiamondNotification(request());
    await assert.rejects(
      setup.sender.sendDiamondNotification(
        request({ body: "A different score update" }),
      ),
      (error) =>
        error.code === "notification-receipt-conflict" && !error.retryable,
    );
    assert.equal(setup.calls.length, 1);
  });

  it("uses distinct receipt, provider, and inbox identities after recreation at the same game revision", async () => {
    const firestore = new FakeFirestore();
    const deliveryMetadata = [];
    const inboxRows = new Map();
    const platformLogs = [];
    const setup = harness({
      firestore,
      logger: {
        info: (...args) => platformLogs.push(["info", ...args]),
        warn: (...args) => platformLogs.push(["warn", ...args]),
        error: (...args) => platformLogs.push(["error", ...args]),
      },
      deliverNotification: async (value, metadata, hooks) => {
        deliveryMetadata.push(clone(metadata));
        await hooks.beforeProviderDispatch();
        inboxRows.set(metadata.providerRequestId, {
          title: value.title,
          gameId: value.gameId,
        });
        return deliveryResult();
      },
    });
    const firstRequest = request();
    const replacementRequest = request({ instanceId: uuid(102) });

    const first = await setup.sender.sendDiamondNotification(firstRequest);
    const sameGenerationRetry =
      await setup.sender.sendDiamondNotification(firstRequest);
    const replacement =
      await setup.sender.sendDiamondNotification(replacementRequest);

    assert.equal(sameGenerationRetry.outcome, "deduplicated");
    assert.equal(deliveryMetadata.length, 2);
    assert.equal(inboxRows.size, 2);
    assert.notEqual(
      firstRequest.idempotencyKey,
      replacementRequest.idempotencyKey,
    );
    assert.notEqual(first.providerReceiptId, replacement.providerReceiptId);
    assert.notEqual(
      receiptPath(
        firstRequest.teamId,
        firstRequest.gameId,
        firstRequest.instanceId,
        firstRequest.idempotencyKey,
      ),
      receiptPath(
        replacementRequest.teamId,
        replacementRequest.gameId,
        replacementRequest.instanceId,
        replacementRequest.idempotencyKey,
      ),
    );
    assert.deepEqual(
      deliveryMetadata.map((metadata) => metadata.instanceId),
      [firstRequest.instanceId, replacementRequest.instanceId],
    );
    assert.deepEqual(
      deliveryMetadata.map((metadata) => metadata.providerRequestId),
      [first.providerReceiptId, replacement.providerReceiptId],
    );
    const serializedLogs = JSON.stringify(platformLogs);
    for (const identifier of [
      firstRequest.teamId,
      firstRequest.gameId,
      firstRequest.instanceId,
      replacementRequest.instanceId,
    ]) {
      assert.equal(serializedLogs.includes(identifier), false);
    }
  });

  it("reconciles a committed claim with a lost response and continues delivery", async () => {
    const firestore = new FakeFirestore();
    firestore.failAfterTransactions.add(1);
    const setup = harness({ firestore });
    const result = await setup.sender.sendDiamondNotification(request());
    assert.equal(result.outcome, "sent");
    assert.equal(setup.calls.length, 1);
  });

  it("makes a post-dispatch provider ambiguity terminal and never sends again", async () => {
    let physicalSends = 0;
    const metadata = [];
    const setup = harness({
      deliverNotification: async (_request, deliveryMetadata, hooks) => {
        await hooks.beforeProviderDispatch();
        physicalSends += 1;
        metadata.push(deliveryMetadata);
        return deliveryResult({
          successCount: 0,
          failureCount: 1,
          providerDeliveryUncertain: true,
          uncertainFailureCount: 1,
        });
      },
    });
    assert.equal(
      (await setup.sender.sendDiamondNotification(request())).outcome,
      "delivery-uncertain",
    );
    assert.equal(
      (await setup.sender.sendDiamondNotification(request())).outcome,
      "delivery-uncertain",
    );
    setup.setNow(1_760_000_005_001);
    const retry = await setup.sender.sendDiamondNotification(request());
    assert.equal(retry.outcome, "delivery-uncertain");
    assert.equal(physicalSends, 1);
    assert.equal(metadata.length, 1);
    const path = receiptPath(
      request().teamId,
      request().gameId,
      request().instanceId,
      request().idempotencyKey,
    );
    assert.equal(setup.firestore.read(path).status, "completed");
    assert.equal(
      setup.firestore.read(path).providerOutcome,
      "delivery-uncertain",
    );
  });

  it("also suppresses retry when the adapter throws after crossing the provider boundary", async () => {
    let physicalSends = 0;
    const setup = harness({
      deliverNotification: async (_request, _metadata, hooks) => {
        await hooks.beforeProviderDispatch();
        physicalSends += 1;
        throw Object.assign(new Error("Response lost after send"), {
          code: "unavailable",
        });
      },
    });

    assert.equal(
      (await setup.sender.sendDiamondNotification(request())).outcome,
      "delivery-uncertain",
    );
    assert.equal(
      (await setup.sender.sendDiamondNotification(request())).outcome,
      "delivery-uncertain",
    );
    assert.equal(physicalSends, 1);
  });

  it("retries a same-generation failure that occurs before provider dispatch", async () => {
    let adapterAttempts = 0;
    let physicalSends = 0;
    const setup = harness({
      deliverNotification: async (_request, _metadata, hooks) => {
        adapterAttempts += 1;
        if (adapterAttempts === 1) {
          throw Object.assign(new Error("Inbox unavailable"), {
            code: "unavailable",
          });
        }
        await hooks.beforeProviderDispatch();
        physicalSends += 1;
        return deliveryResult();
      },
    });
    await assert.rejects(
      setup.sender.sendDiamondNotification(request()),
      (error) =>
        error.code === "notification-delivery-failed-before-provider" &&
        error.retryable,
    );
    setup.setNow(1_760_000_005_001);
    assert.equal(
      (await setup.sender.sendDiamondNotification(request())).outcome,
      "sent",
    );
    assert.equal(adapterAttempts, 2);
    assert.equal(physicalSends, 1);
  });

  it("reconciles a committed completion when its transaction response is lost", async () => {
    const firestore = new FakeFirestore();
    firestore.failAfterTransactions.add(3);
    const setup = harness({ firestore });
    const first = await setup.sender.sendDiamondNotification(request());
    const retry = await setup.sender.sendDiamondNotification(request());
    assert.equal(first.outcome, "sent");
    assert.equal(retry.outcome, "deduplicated");
    assert.equal(setup.calls.length, 1);
  });

  it("uses the dispatch fence after an uncommitted completion update instead of resending", async () => {
    const firestore = new FakeFirestore();
    firestore.failBeforeTransactions.add(3);
    const setup = harness({ firestore, leaseMillis: 1_000 });

    await assert.rejects(
      setup.sender.sendDiamondNotification(request()),
      (error) =>
        error.code === "notification-receipt-unavailable" && error.retryable,
    );
    setup.setNow(1_760_000_001_001);
    assert.equal(
      (await setup.sender.sendDiamondNotification(request())).outcome,
      "delivery-uncertain",
    );
    assert.equal(setup.calls.length, 1);
    const path = receiptPath(
      request().teamId,
      request().gameId,
      request().instanceId,
      request().idempotencyKey,
    );
    assert.equal(setup.firestore.read(path).status, "processing");
    assert.equal(setup.firestore.read(path).providerDispatch.attempt, 1);
  });

  it("records no-recipient completion and keeps malformed delivery evidence retryable", async () => {
    const none = harness({ deliverNotification: async () => null });
    assert.equal(
      (await none.sender.sendDiamondNotification(request())).outcome,
      "no-recipients",
    );

    let calls = 0;
    const malformed = harness({
      deliverNotification: async () => {
        calls += 1;
        return {};
      },
    });
    await assert.rejects(
      malformed.sender.sendDiamondNotification(request()),
      (error) =>
        error.code === "notification-delivery-ambiguous" && error.retryable,
    );
    await assert.rejects(
      malformed.sender.sendDiamondNotification(request()),
      (error) => error.code === "notification-delivery-pending",
    );
    assert.equal(calls, 1);
  });

  it("keeps complete delivery failure retryable and reports partial delivery honestly", async () => {
    const failed = harness({
      deliverNotification: async (_request, _metadata, hooks) => {
        await hooks.beforeProviderDispatch();
        return deliveryResult({
          successCount: 0,
          failureCount: 2,
          inboxWriteCount: 0,
          inboxFailureCount: 0,
        });
      },
    });
    await assert.rejects(
      failed.sender.sendDiamondNotification(request()),
      (error) =>
        error.code === "notification-delivery-failed" && error.retryable,
    );
    const failedPath = receiptPath(
      request().teamId,
      request().gameId,
      request().instanceId,
      request().idempotencyKey,
    );
    assert.equal(failed.firestore.read(failedPath).status, "retryable-failure");

    const partial = harness({
      deliverNotification: async (_request, _metadata, hooks) => {
        await hooks.beforeProviderDispatch();
        return deliveryResult({
          successCount: 1,
          failureCount: 1,
          inboxWriteCount: 1,
          inboxFailureCount: 1,
        });
      },
    });
    assert.equal(
      (await partial.sender.sendDiamondNotification(request())).outcome,
      "partial",
    );
  });

  it("suppresses takeover after an expired worker crossed the provider boundary", async () => {
    let releaseFirst;
    let enteredFirst;
    const entered = new Promise((resolve) => {
      enteredFirst = resolve;
    });
    const blocker = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const setup = harness({
      leaseMillis: 1_000,
      deliverNotification: async (_request, _metadata, hooks) => {
        await hooks.beforeProviderDispatch();
        calls += 1;
        if (calls === 1) {
          enteredFirst();
          await blocker;
        }
        return deliveryResult();
      },
    });
    const first = setup.sender.sendDiamondNotification(request());
    await entered;
    setup.setNow(1_760_000_001_001);
    assert.equal(
      (await setup.sender.sendDiamondNotification(request())).outcome,
      "delivery-uncertain",
    );
    releaseFirst();
    assert.equal((await first).outcome, "sent");
    assert.equal(calls, 1);
    const path = receiptPath(
      request().teamId,
      request().gameId,
      request().instanceId,
      request().idempotencyKey,
    );
    assert.equal(setup.firestore.read(path).status, "completed");
    assert.equal(setup.firestore.read(path).attemptCount, 1);
  });

  it("rejects noncanonical links, keys, hidden fields, and unverifiable claims", async () => {
    const setup = harness();
    for (const invalid of [
      request({ link: "https://evil.example/watch" }),
      request({ idempotencyKey: "not-canonical" }),
      { ...request(), instanceId: undefined },
      request({ instanceId: "wrong/generation" }),
      request({ actorUid: "private-user" }),
    ]) {
      await assert.rejects(
        setup.sender.sendDiamondNotification(invalid),
        (error) => error.code === "invalid-notification-request",
      );
    }

    const firestore = new FakeFirestore();
    firestore.failBeforeTransactions.add(1);
    firestore.failReads = 1;
    const unavailable = harness({ firestore });
    await assert.rejects(
      unavailable.sender.sendDiamondNotification(request()),
      (error) =>
        error.code === "notification-receipt-unavailable" && error.retryable,
    );
    assert.equal(unavailable.calls.length, 0);
  });
});
