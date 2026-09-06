"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const core = require("../diamond-scorebook-core.cjs");
const {
  DIAMOND_ENGINE,
  MAX_HIGHLIGHT_CLIPS,
  createDiamondScorebookEffectHandlers,
  effectPaths,
} = require("../diamond-scorebook-effect-handlers.cjs");

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
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

class FakeDocumentReference {
  constructor(database, path) {
    this.database = database;
    this.path = path;
    this.id = path.split("/").at(-1);
  }

  get() {
    return Promise.resolve(this.database.snapshot(this));
  }
}

class FakeTransaction {
  constructor(database) {
    this.database = database;
    this.operations = [];
  }

  get(reference) {
    return Promise.resolve(this.database.snapshot(reference));
  }

  getAll(...references) {
    return Promise.resolve(
      references.map((reference) => this.database.snapshot(reference)),
    );
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
    this.operations.push({
      kind: "update",
      reference,
      value: clone(value),
    });
    return this;
  }
}

class FakeFirestore {
  constructor(seed = {}) {
    this.documents = new Map(
      Object.entries(seed).map(([path, value]) => [path, clone(value)]),
    );
    this.transactionQueue = Promise.resolve();
    this.transactionCommitCount = 0;
    this.failAfterApplyTransactions = new Set();
  }

  doc(path) {
    return new FakeDocumentReference(this, path);
  }

  snapshot(reference) {
    return new FakeDocumentSnapshot(
      reference,
      this.documents.get(reference.path),
    );
  }

  apply(operations) {
    const next = new Map(
      [...this.documents].map(([path, value]) => [path, clone(value)]),
    );
    for (const operation of operations) {
      const path = operation.reference.path;
      if (operation.kind === "update") {
        if (!next.has(path)) {
          throw Object.assign(new Error(`Missing document: ${path}`), {
            code: "not-found",
          });
        }
        next.set(path, { ...next.get(path), ...clone(operation.value) });
      } else if (operation.kind === "set") {
        next.set(
          path,
          operation.options?.merge
            ? { ...(next.get(path) || {}), ...clone(operation.value) }
            : clone(operation.value),
        );
      }
    }
    this.documents = next;
  }

  runTransaction(callback) {
    const execute = async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      this.transactionCommitCount += 1;
      const commitNumber = this.transactionCommitCount;
      this.apply(transaction.operations);
      if (this.failAfterApplyTransactions.has(commitNumber)) {
        this.failAfterApplyTransactions.delete(commitNumber);
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

  seed(path, value) {
    this.documents.set(path, clone(value));
  }

  read(path) {
    return clone(this.documents.get(path));
  }
}

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function notificationPayload({ effectId, dedupKey, sourceRevision }) {
  return {
    effectId,
    dedupKey,
    sourceRevision,
    sourceEventId: "event-8",
    title: "Game update",
    body: "Away Player homered · Score 0–1",
    category: "liveScore",
    trackingEngine: DIAMOND_ENGINE,
  };
}

function clipLinkPayload({ effectId, dedupKey, sourceRevision }) {
  return {
    effectId,
    dedupKey,
    sourceRevision,
    sourceEventId: "event-8",
    startMs: 10_000,
    endMs: 25_000,
    playDescription: "Away Player homered",
    inningLabel: "Top 1",
    scoreContext: "0–1",
    status: "candidate",
    trackingEngine: DIAMOND_ENGINE,
  };
}

function clipInvalidationPayload({ effectId, dedupKey, sourceRevision }) {
  return {
    effectId,
    dedupKey,
    sourceRevision,
    correctionEventId: "event-10",
    targetEventId: "event-8",
    status: "stale",
    reason: "scorebook-correction",
  };
}

function aiStalePayload({ sourceRevision }) {
  return {
    staleAtRevision: sourceRevision,
    affectedSourcePlayIds: ["event-8"],
    artifactFields: ["aiRecap"],
  };
}

function createEffect({
  kind = "notification",
  sourceRevision = 8,
  runRevision = 10,
  projectionKey = `projection-${"a".repeat(64)}`,
  checkpointHash = `sha256:${"c".repeat(64)}`,
  instanceId = "instance-1",
  payload,
} = {}) {
  const effectId =
    kind === "notification"
      ? `notification-r${String(sourceRevision).padStart(10, "0")}`
      : kind === "clip-link"
        ? `clip-r${String(sourceRevision).padStart(10, "0")}`
        : kind === "clip-invalidation"
          ? `clip-invalidation-r${String(sourceRevision).padStart(10, "0")}`
          : kind === "ai-stale"
            ? `ai-stale-r${String(sourceRevision).padStart(10, "0")}`
            : `shared-game-r${String(sourceRevision).padStart(10, "0")}`;
  const dedupKind =
    kind === "clip-link"
      ? "clip"
      : kind === "clip-invalidation"
        ? "clip-invalidation"
        : kind;
  const dedupKey = `${DIAMOND_ENGINE}:team-1:game-1:instance:${instanceId}:${dedupKind}:r${String(sourceRevision).padStart(10, "0")}`;
  const effectDocumentId = `${effectId}--${projectionKey.slice("projection-".length)}`;
  const paths = effectPaths(
    "team-1",
    "game-1",
    effectDocumentId,
    projectionKey,
  );
  const resolvedPayload =
    payload ||
    (kind === "notification"
      ? notificationPayload({ effectId, dedupKey, sourceRevision })
      : kind === "clip-link"
        ? clipLinkPayload({ effectId, dedupKey, sourceRevision })
        : kind === "clip-invalidation"
          ? clipInvalidationPayload({ effectId, dedupKey, sourceRevision })
          : kind === "ai-stale"
            ? aiStalePayload({ sourceRevision })
            : null);
  const effect = {
    schemaVersion: 1,
    trackingEngine: DIAMOND_ENGINE,
    teamId: "team-1",
    diamondGameId: "game-1",
    instanceId,
    diamondScorebookInstanceId: instanceId,
    projectionGeneration: instanceId,
    projectionKey,
    effectId,
    sourceRevision,
    checkpointHash,
    kind,
    dedupKey,
    status: "pending",
    requiresProjectionMarker: true,
    activationRunPath: paths.run,
    payload: resolvedPayload,
    createdAt: "2025-10-09T08:53:20.000Z",
  };
  effect.payloadHash = core.hashDiamondValue(effect);
  return {
    effect,
    effectDocumentId,
    paths,
    runRevision,
    projectionKey,
    checkpointHash,
    instanceId,
  };
}

function seedEffect(firestore, fixture, options = {}) {
  const projectionHash = options.projectionHash || `sha256:${"b".repeat(64)}`;
  const marker = {
    schemaVersion: 1,
    trackingEngine: DIAMOND_ENGINE,
    status: "current",
    instanceId: fixture.instanceId,
    sourceRevision: fixture.runRevision,
    checkpointHash: fixture.checkpointHash,
    projectionHash,
    projectionKey: fixture.projectionKey,
  };
  firestore.seed(fixture.paths.scorebook, {
    trackingEngine: DIAMOND_ENGINE,
    teamId: "team-1",
    gameId: "game-1",
    instanceId: fixture.instanceId,
    checkpoint: {
      sequence: fixture.runRevision,
      previousHash: fixture.checkpointHash,
    },
    projectionStatus: "complete",
    diamondProjectionMarker: marker,
    ...(options.root || {}),
  });
  firestore.seed(fixture.paths.game, {
    trackingEngine: DIAMOND_ENGINE,
    diamondScorebookInstanceId: fixture.instanceId,
    diamondProjectionRevision: fixture.runRevision,
    diamondProjectionCheckpointHash: fixture.checkpointHash,
    diamondProjectionHash: projectionHash,
    diamondProjectionStatus: "current",
    diamondProjectionComplete: true,
    highlightClips: [],
    ...(options.game || {}),
  });
  firestore.seed(fixture.paths.run, {
    trackingEngine: DIAMOND_ENGINE,
    teamId: "team-1",
    diamondGameId: "game-1",
    instanceId: fixture.instanceId,
    diamondScorebookInstanceId: fixture.instanceId,
    projectionGeneration: fixture.instanceId,
    projectionKey: fixture.projectionKey,
    projectionHash,
    sourceRevision: fixture.runRevision,
    checkpointHash: fixture.checkpointHash,
    status: "complete",
    complete: true,
    marker,
    ...(options.run || {}),
  });
  firestore.seed(fixture.paths.effect, fixture.effect);
}

function createHarness(options = {}) {
  const firestore = options.firestore || new FakeFirestore();
  let now = options.now || 1_760_000_000_000;
  let randomIndex = options.randomIndex || 500;
  const handlers = createDiamondScorebookEffectHandlers({
    firestore,
    core,
    clock: () => now,
    random: () => uuid(randomIndex++),
    logger: { info() {}, warn() {}, error() {} },
    sendNotification:
      options.sendNotification ||
      (async ({ idempotencyKey, instanceId }) => ({
        outcome: "sent",
        instanceId,
        idempotencyKey,
        providerReceiptId: "receipt-1",
      })),
    hooks: options.hooks || {},
    leaseMillis: options.leaseMillis || 60_000,
    retryDelayMillis: options.retryDelayMillis || 1_000,
  });
  return {
    firestore,
    handlers,
    setNow(value) {
      now = value;
    },
  };
}

function requestFor(fixture) {
  return {
    teamId: "team-1",
    gameId: "game-1",
    effectDocumentId: fixture.effectDocumentId,
  };
}

describe("Diamond scorebook effect processor", () => {
  it("sends a sanitized notification once and makes duplicate triggers terminal", async () => {
    const fixture = createEffect();
    const calls = [];
    const harness = createHarness({
      sendNotification: async (request) => {
        calls.push(clone(request));
        return {
          outcome: "sent",
          instanceId: request.instanceId,
          idempotencyKey: request.idempotencyKey,
          providerReceiptId: "provider-1",
        };
      },
    });
    seedEffect(harness.firestore, fixture);

    const first = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    const duplicate = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );

    assert.equal(first.processed, true);
    assert.equal(duplicate.processed, false);
    assert.equal(duplicate.reason, "already-terminal");
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], {
      teamId: "team-1",
      gameId: "game-1",
      instanceId: fixture.instanceId,
      sourceRevision: 8,
      sourceEventId: "event-8",
      title: "Game update",
      body: "Away Player homered · Score 0–1",
      category: "liveScore",
      liveViewerLink:
        "https://share.allplays.ai/watch?teamId=team-1&gameId=game-1",
      link: "https://share.allplays.ai/watch?teamId=team-1&gameId=game-1",
      dedupKey: fixture.effect.dedupKey,
      idempotencyKey: fixture.effect.dedupKey,
    });
    assert.doesNotMatch(
      JSON.stringify(calls[0]),
      /actor|transcript|note|currentScorer|medical/i,
    );
    assert.equal(
      harness.firestore.read(fixture.paths.effect).terminalResult
        .providerReceiptId,
      "provider-1",
    );
  });

  it("rejects an all-failed provider result but preserves partial delivery evidence", async () => {
    const failedFixture = createEffect();
    const failed = createHarness({
      sendNotification: async ({ idempotencyKey, instanceId }) => ({
        outcome: "failed",
        instanceId,
        idempotencyKey,
        providerReceiptId: "provider-failed",
      }),
    });
    seedEffect(failed.firestore, failedFixture);
    await assert.rejects(
      failed.handlers.processDiamondEffect(requestFor(failedFixture)),
      (error) =>
        error.code === "notification-result-ambiguous" && error.retryable,
    );
    assert.equal(
      failed.firestore.read(failedFixture.paths.effect).status,
      "pending",
    );

    const partialFixture = createEffect();
    const partial = createHarness({
      sendNotification: async ({ idempotencyKey, instanceId }) => ({
        outcome: "partial",
        instanceId,
        idempotencyKey,
        providerReceiptId: "provider-partial",
      }),
    });
    seedEffect(partial.firestore, partialFixture);
    const result = await partial.handlers.processDiamondEffect(
      requestFor(partialFixture),
    );
    const stored = partial.firestore.read(partialFixture.paths.effect);
    assert.equal(result.processed, true);
    assert.equal(result.status, "completed");
    assert.equal(result.terminalResult.providerOutcome, "partial");
    assert.equal(stored.terminalResult.providerOutcome, "partial");
    assert.equal(stored.terminalResult.providerReceiptId, "provider-partial");
  });

  it("requires the provider result to confirm the same immutable scorebook instance", async () => {
    const fixture = createEffect();
    const harness = createHarness({
      sendNotification: async ({ idempotencyKey }) => ({
        outcome: "sent",
        instanceId: "another-instance",
        idempotencyKey,
        providerReceiptId: "provider-wrong-generation",
      }),
    });
    seedEffect(harness.firestore, fixture);

    await assert.rejects(
      harness.handlers.processDiamondEffect(requestFor(fixture)),
      (error) =>
        error.code === "notification-result-ambiguous" && error.retryable,
    );
    assert.equal(
      harness.firestore.read(fixture.paths.effect).status,
      "pending",
    );
  });

  it("reconciles a committed terminal result without needing clock or randomness", async () => {
    const fixture = createEffect();
    const harness = createHarness();
    seedEffect(harness.firestore, fixture);
    assert.equal(
      (await harness.handlers.processDiamondEffect(requestFor(fixture)))
        .processed,
      true,
    );
    const retryHandlers = createDiamondScorebookEffectHandlers({
      firestore: harness.firestore,
      core,
      clock: () => {
        throw new Error("clock unavailable");
      },
      random: () => {
        throw new Error("random unavailable");
      },
      sendNotification: async () => {
        throw new Error("must not send");
      },
    });

    const duplicate = await retryHandlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(duplicate.processed, false);
    assert.equal(duplicate.reason, "already-terminal");
    assert.equal(duplicate.status, "completed");
  });

  it("serializes competing workers with a renewable effect lease", async () => {
    const fixture = createEffect();
    let releaseFirst;
    let enteredFirst;
    const entered = new Promise((resolve) => {
      enteredFirst = resolve;
    });
    const blocker = new Promise((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const harness = createHarness({
      sendNotification: async ({ idempotencyKey, instanceId }) => {
        calls += 1;
        return { outcome: "sent", instanceId, idempotencyKey };
      },
      hooks: {
        beforeNotification: async () => {
          enteredFirst();
          await blocker;
        },
      },
    });
    seedEffect(harness.firestore, fixture);

    const first = harness.handlers.processDiamondEffect(requestFor(fixture));
    await entered;
    const competing = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(competing.processed, false);
    assert.equal(competing.reason, "effect-lease-active");
    assert.equal(competing.retryable, true);
    releaseFirst();
    assert.equal((await first).processed, true);
    assert.equal(calls, 1);
  });

  it("terminalizes post-send ambiguity and never asks the sender to dispatch again", async () => {
    const fixture = createEffect();
    const keys = [];
    const harness = createHarness({
      sendNotification: async ({ idempotencyKey, instanceId }) => {
        keys.push(idempotencyKey);
        return {
          outcome: "delivery-uncertain",
          instanceId,
          idempotencyKey,
          providerReceiptId: "provider-uncertain",
        };
      },
    });
    seedEffect(harness.firestore, fixture);

    const first = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(first.processed, true);
    assert.equal(first.status, "completed");
    assert.equal(
      first.reason,
      "notification-push-uncertain-inbox-authoritative",
    );
    assert.equal(
      first.terminalResult.providerOutcome,
      "delivery-uncertain",
    );
    const retry = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(retry.processed, false);
    assert.equal(retry.reason, "already-terminal");
    assert.deepEqual(keys, [fixture.effect.dedupKey]);
  });

  it("reconciles a committed terminal write whose response was lost", async () => {
    const fixture = createEffect();
    let calls = 0;
    const harness = createHarness({
      sendNotification: async ({ idempotencyKey, instanceId }) => {
        calls += 1;
        return { outcome: "sent", instanceId, idempotencyKey };
      },
    });
    seedEffect(harness.firestore, fixture);
    harness.firestore.failAfterApplyTransactions.add(2);

    const result = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(result.processed, true);
    assert.equal(result.reason, "terminal-reconciled");
    assert.equal(calls, 1);
    assert.equal(
      harness.firestore.read(fixture.paths.effect).status,
      "completed",
    );
  });

  it("retries a definite notification failure without losing the effect", async () => {
    const fixture = createEffect();
    let attempts = 0;
    const harness = createHarness({
      sendNotification: async ({ idempotencyKey, instanceId }) => {
        attempts += 1;
        if (attempts === 1) throw new Error("Provider offline");
        return { outcome: "sent", instanceId, idempotencyKey };
      },
    });
    seedEffect(harness.firestore, fixture);

    await assert.rejects(
      harness.handlers.processDiamondEffect(requestFor(fixture)),
      (error) => error.code === "notification-send-failed" && error.retryable,
    );
    const afterFailure = harness.firestore.read(fixture.paths.effect);
    assert.equal(afterFailure.status, "pending");
    assert.equal(afterFailure.lastError.retryable, true);
    assert.equal(afterFailure.nextAttemptAtMs, 1_760_000_001_000);
    await assert.rejects(
      harness.handlers.onDiamondEffectWrite(
        harness.firestore.snapshot(harness.firestore.doc(fixture.paths.effect)),
        {
          params: {
            teamId: "team-1",
            gameId: "game-1",
            effectId: fixture.effectDocumentId,
          },
        },
      ),
      (error) => error.code === "effect-retry-delayed" && error.retryable,
    );
    harness.setNow(1_760_000_001_001);
    assert.equal(
      (await harness.handlers.processDiamondEffect(requestFor(fixture)))
        .processed,
      true,
    );
    assert.equal(attempts, 2);
  });

  it("discards another game generation without sending or mutating its game", async () => {
    const fixture = createEffect();
    let calls = 0;
    const harness = createHarness({
      sendNotification: async () => {
        calls += 1;
        throw new Error("must not send");
      },
    });
    seedEffect(harness.firestore, fixture, {
      root: { instanceId: "replacement-instance" },
      game: { diamondScorebookInstanceId: "replacement-instance" },
    });
    const gameBefore = harness.firestore.read(fixture.paths.game);

    const result = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(result.processed, false);
    assert.equal(result.status, "discarded");
    assert.equal(result.reason, "generation-or-owner-mismatch");
    assert.equal(calls, 0);
    assert.deepEqual(harness.firestore.read(fixture.paths.game), gameBefore);
  });

  it("classifies an effect as superseded when the authoritative head advances", async () => {
    const fixture = createEffect();
    const harness = createHarness();
    seedEffect(harness.firestore, fixture, {
      root: {
        checkpoint: {
          sequence: fixture.runRevision + 1,
          previousHash: `sha256:${"d".repeat(64)}`,
        },
        projectionStatus: "pending",
      },
    });

    const result = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(result.processed, false);
    assert.equal(result.status, "superseded");
    assert.equal(result.reason, "authoritative-head-advanced");
    assert.equal(
      harness.firestore.read(fixture.paths.effect).status,
      "superseded",
    );
  });

  it("marks a hash-tampered payload invalid without calling any adapter", async () => {
    const fixture = createEffect();
    let calls = 0;
    const harness = createHarness({
      sendNotification: async () => {
        calls += 1;
        throw new Error("must not send");
      },
    });
    seedEffect(harness.firestore, fixture);
    harness.firestore.seed(fixture.paths.effect, {
      ...fixture.effect,
      payload: { ...fixture.effect.payload, body: "Tampered body" },
    });

    const result = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(result.processed, false);
    assert.equal(result.status, "invalid");
    assert.equal(result.errorCode, "effect-integrity-failed");
    assert.equal(calls, 0);
    const duplicate = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(duplicate.reason, "already-terminal");
  });

  it("rejects a canonically hashed effect key bound to another scorebook instance", async () => {
    const fixture = createEffect();
    const harness = createHarness();
    const wrongKey = fixture.effect.dedupKey.replace(
      ":instance:instance-1:",
      ":instance:another-instance:",
    );
    const wrongEffect = {
      ...fixture.effect,
      dedupKey: wrongKey,
      payload: {
        ...fixture.effect.payload,
        dedupKey: wrongKey,
      },
    };
    delete wrongEffect.payloadHash;
    wrongEffect.payloadHash = core.hashDiamondValue(wrongEffect);
    seedEffect(harness.firestore, fixture);
    harness.firestore.seed(fixture.paths.effect, wrongEffect);

    const result = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(result.status, "invalid");
    assert.equal(result.errorCode, "invalid-effect");
  });

  it("rejects trigger parameters that do not exactly match the effect path", async () => {
    const fixture = createEffect();
    const harness = createHarness();
    seedEffect(harness.firestore, fixture);
    const before = harness.firestore.read(fixture.paths.effect);
    const snapshot = harness.firestore.snapshot(
      harness.firestore.doc(fixture.paths.effect),
    );

    await assert.rejects(
      harness.handlers.onDiamondEffectWrite(
        { after: snapshot },
        {
          params: {
            teamId: "another-team",
            gameId: "game-1",
            effectId: fixture.effectDocumentId,
          },
        },
      ),
      (error) => error.code === "invalid-effect-path" && !error.retryable,
    );
    assert.deepEqual(harness.firestore.read(fixture.paths.effect), before);
  });

  it("rejects a completed run whose embedded marker does not match", async () => {
    const fixture = createEffect();
    let calls = 0;
    const harness = createHarness({
      sendNotification: async () => {
        calls += 1;
        throw new Error("must not send");
      },
    });
    seedEffect(harness.firestore, fixture, {
      run: {
        marker: {
          status: "current",
          trackingEngine: DIAMOND_ENGINE,
          instanceId: fixture.instanceId,
          sourceRevision: fixture.runRevision,
          checkpointHash: fixture.checkpointHash,
          projectionHash: `sha256:${"e".repeat(64)}`,
          projectionKey: fixture.projectionKey,
        },
      },
    });

    const result = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(result.status, "discarded");
    assert.equal(result.reason, "projection-run-marker-mismatch");
    assert.equal(calls, 0);
  });

  it("preserves all user clips and refuses to exceed the 24-clip capacity", async () => {
    const fixture = createEffect({ kind: "clip-link" });
    const userClips = Array.from(
      { length: MAX_HIGHLIGHT_CLIPS },
      (_, index) => ({
        id: `user-${String(index + 1)}`,
        type: "score-linked",
        playEventId: "event-8",
        title: `User clip ${String(index + 1)}`,
      }),
    );
    const harness = createHarness();
    seedEffect(harness.firestore, fixture, {
      game: { highlightClips: userClips },
    });

    const result = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(result.processed, true);
    assert.equal(result.reason, "clip-capacity-reached");
    assert.deepEqual(
      harness.firestore.read(fixture.paths.game).highlightClips,
      userClips,
    );
  });

  it("links one deterministic Diamond clip without changing existing user clips", async () => {
    const fixture = createEffect({ kind: "clip-link" });
    const userClip = {
      id: "user-1",
      type: "score-linked",
      playEventId: "event-8",
      title: "User-created clip",
    };
    const harness = createHarness();
    seedEffect(harness.firestore, fixture, {
      game: { highlightClips: [userClip] },
    });

    const result = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    const clips = harness.firestore.read(fixture.paths.game).highlightClips;
    assert.equal(result.reason, "clip-linked");
    assert.equal(clips.length, 2);
    assert.deepEqual(clips[0], userClip);
    assert.equal(clips[1].diamondGenerated, true);
    assert.equal(clips[1].diamondSourceEventId, "event-8");
    assert.equal(clips[1].diamondScorebookInstanceId, "instance-1");
    assert.equal(clips[1].startMs, 10_000);
    assert.equal(clips[1].endMs, 25_000);
  });

  it("invalidates only the exact generated clip and preserves user and unrelated clips", async () => {
    const fixture = createEffect({
      kind: "clip-invalidation",
      sourceRevision: 10,
      runRevision: 10,
    });
    const userSamePlay = {
      id: "user-same-play",
      type: "score-linked",
      playEventId: "event-8",
    };
    const generatedTarget = {
      id: "diamond-target",
      trackingEngine: DIAMOND_ENGINE,
      diamondGenerated: true,
      diamondScorebookInstanceId: "instance-1",
      diamondSourceEventId: "event-8",
    };
    const generatedOther = {
      id: "diamond-other",
      trackingEngine: DIAMOND_ENGINE,
      diamondGenerated: true,
      diamondScorebookInstanceId: "instance-1",
      diamondSourceEventId: "event-7",
    };
    const oldGenerationTarget = {
      id: "diamond-old-generation",
      trackingEngine: DIAMOND_ENGINE,
      diamondGenerated: true,
      diamondScorebookInstanceId: "old-instance",
      diamondSourceEventId: "event-8",
    };
    const harness = createHarness();
    seedEffect(harness.firestore, fixture, {
      game: {
        highlightClips: [
          userSamePlay,
          generatedTarget,
          generatedOther,
          oldGenerationTarget,
        ],
      },
    });

    const result = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(result.reason, "clip-invalidated");
    assert.equal(result.terminalResult.removedCount, 1);
    assert.deepEqual(
      harness.firestore.read(fixture.paths.game).highlightClips,
      [userSamePlay, generatedOther, oldGenerationTarget],
    );
  });

  it("waits for the completed projection run and marks AI reconciliation audit-only", async () => {
    const fixture = createEffect({
      kind: "ai-stale",
      sourceRevision: 10,
      runRevision: 10,
    });
    const harness = createHarness();
    seedEffect(harness.firestore, fixture, {
      run: { status: "preparing", complete: false },
      game: {
        diamondAiState: {
          status: "stale",
          staleAtRevision: 10,
        },
      },
    });
    const triggerSnapshot = harness.firestore.snapshot(
      harness.firestore.doc(fixture.paths.effect),
    );

    await assert.rejects(
      harness.handlers.onDiamondEffectWrite(
        { after: triggerSnapshot },
        {
          params: {
            teamId: "team-1",
            gameId: "game-1",
            effectId: fixture.effectDocumentId,
          },
        },
      ),
      (error) =>
        error.retryable && error.code === "projection-run-not-complete",
    );
    harness.firestore.seed(fixture.paths.run, {
      ...harness.firestore.read(fixture.paths.run),
      status: "complete",
      complete: true,
    });
    const gameBefore = harness.firestore.read(fixture.paths.game);
    const result = await harness.handlers.processDiamondEffect(
      requestFor(fixture),
    );
    assert.equal(result.processed, true);
    assert.equal(result.reason, "ai-staleness-already-projected");
    assert.equal(result.terminalResult.auditOnly, true);
    assert.deepEqual(harness.firestore.read(fixture.paths.game), gameBefore);
  });
});
