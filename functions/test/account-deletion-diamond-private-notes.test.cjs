"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const domainEngine = require("../diamond-engine");
const privateNoteCore = require("../diamond-private-note-core.cjs");
const {
  ACCOUNT_DIAMOND_PRIVATE_NOTE_PAGE_SIZE,
  ACCOUNT_DIAMOND_PRIVATE_NOTE_TRANSACTION_SIZE,
  cleanupAccountDiamondPrivateNotes,
  createAccountDiamondPrivateNoteAuthDeleteHandler,
} = require("../account-deletion-core.cjs");

const UID = "deleted.user:1";
const DOCUMENT_ID = Object.freeze({ kind: "document-id" });
const REDACTED_AT = "2026-09-09T12:00:00.000Z";
const AUTH_DELETE_BARRIER_PATH =
  `accountDiamondPrivateNoteAuthDeleteBarriers/${privateNoteCore.buildDiamondPrivateNoteAuthDeleteBarrierId(UID)}`;

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, clone(entry)]),
  );
}

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function buildPrivateNoteDocuments({
  teamId = "team-1",
  gameId = "game-1",
  instanceId = uuid(900),
  noteText = "private account deletion fixture",
  eventId = "event-private-1",
  commandIndex = 2,
  privacyRevision = 4,
} = {}) {
  let ledger = domainEngine.createDiamondLedger({
    teamId,
    gameId,
    rulesProfileId: "baseball-youth",
    rulesProfileVersion: 1,
    captureMode: "full",
  });
  const activate = {
    schemaVersion: domainEngine.DIAMOND_SCHEMA_VERSION,
    commandId: uuid(commandIndex - 1),
    teamId,
    gameId,
    expectedRevision: ledger.state.revision,
    rulesProfileId: ledger.rulesProfileId,
    rulesProfileVersion: ledger.rulesProfileVersion,
    type: "activate",
    payload: { initialScorerUid: UID, captureMode: "full" },
  };
  const activated = domainEngine.executeDiamondCommand(ledger, activate, {
    actorUid: UID,
    eventId: `event-activate-${String(commandIndex)}`,
    serverTimestampMs: 1_700_000_000_000 + commandIndex,
    managerAuthorized: true,
  });
  assert.equal(activated.result.outcome, "accepted");
  ledger = activated.ledger;

  const command = {
    schemaVersion: domainEngine.DIAMOND_SCHEMA_VERSION,
    commandId: uuid(commandIndex),
    teamId,
    gameId,
    expectedRevision: ledger.state.revision,
    rulesProfileId: ledger.rulesProfileId,
    rulesProfileVersion: ledger.rulesProfileVersion,
    type: "private_note",
    payload: { text: noteText },
  };
  const execution = domainEngine.executeDiamondCommand(ledger, command, {
    actorUid: UID,
    eventId,
    serverTimestampMs: 1_700_000_100_000 + commandIndex,
    managerAuthorized: true,
  });
  assert.equal(execution.result.outcome, "accepted");
  const receipt = domainEngine.createDiamondCommandReceipt(
    command,
    execution.event,
    execution.result,
  );
  const scorebookPath = `teams/${teamId}/games/${gameId}/diamondScorebooks/v2`;
  const rootPath = scorebookPath;
  const eventPath = `${scorebookPath}/events/${eventId}`;
  const notePath = `${scorebookPath}/notes/${eventId}`;
  const receiptPath = `${scorebookPath}/commands/${command.commandId}`;
  const projectionPath = `${scorebookPath}/projections/current`;
  const marker = {
    schemaVersion: 1,
    status: "current",
    instanceId,
    privateNotePrivacyRevision: privacyRevision,
    opaque: "retain-me",
  };
  return {
    paths: { rootPath, eventPath, notePath, receiptPath, projectionPath },
    event: execution.event,
    note: privateNoteCore.buildDiamondPrivateNoteRecord({
      command,
      event: execution.event,
      instanceId,
      authorUid: UID,
      createdAt: "2026-09-09T10:00:00.000Z",
      domainEngine,
    }),
    receipt: {
      ...receipt,
      instanceId,
      acceptedAt: "2026-09-09T10:00:00.000Z",
    },
    root: {
      schemaVersion: 2,
      trackingEngine: "diamond-v2",
      privateNoteStorageVersion: 1,
      privateNotePrivacyRevision: privacyRevision,
      teamId,
      gameId,
      instanceId,
      projectionStatus: "complete",
      projectionLease: { leaseId: "old-lease" },
      projectionFailure: { code: "old-failure" },
      projectionRequest: { requestId: "retain-request" },
      diamondProjectionMarker: marker,
    },
    projection: {
      schemaVersion: 1,
      trackingEngine: "diamond-v2",
      teamId,
      gameId,
      diamondGameId: gameId,
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      privateNotePrivacyRevision: privacyRevision,
      privateNotes: [{ eventId, actorUid: UID, text: noteText }],
    },
    marker,
  };
}

function seedBundle(bundle) {
  return {
    [bundle.paths.rootPath]: bundle.root,
    [bundle.paths.eventPath]: { ...bundle.event, instanceId: bundle.root.instanceId },
    [bundle.paths.notePath]: bundle.note,
    [bundle.paths.receiptPath]: bundle.receipt,
    [bundle.paths.projectionPath]: bundle.projection,
  };
}

function makeFirestore(seed = {}, options = {}) {
  const state = new Map(
    Object.entries(seed).map(([documentPath, value]) => [
      documentPath,
      clone(value),
    ]),
  );
  const queryLog = [];
  const transactionLog = [];
  let preCommitFailures = options.preCommitFailures || 0;
  let postCommitFailures = options.postCommitFailures || 0;
  const preCommitFailureCalls = new Set(options.preCommitFailureCalls || []);
  const postCommitFailureCalls = new Set(options.postCommitFailureCalls || []);
  let transactionCalls = 0;

  function snapshot(ref) {
    const value = state.get(ref.path);
    return {
      id: ref.id,
      ref,
      exists: value !== undefined,
      data: () => clone(value),
    };
  }

  function doc(documentPath) {
    const ref = {
      id: documentPath.split("/").at(-1),
      path: documentPath,
      get: async () => snapshot(ref),
    };
    return ref;
  }

  class Query {
    constructor(collectionId, field = "", value = undefined, limitValue = Infinity, cursorPath = "") {
      this.collectionId = collectionId;
      this.field = field;
      this.value = value;
      this.limitValue = limitValue;
      this.cursorPath = cursorPath;
    }

    where(field, operator, value) {
      assert.equal(operator, "==");
      return new Query(this.collectionId, field, value, this.limitValue, this.cursorPath);
    }

    orderBy(field) {
      assert.equal(field, DOCUMENT_ID);
      return new Query(this.collectionId, this.field, this.value, this.limitValue, this.cursorPath);
    }

    limit(limitValue) {
      return new Query(this.collectionId, this.field, this.value, limitValue, this.cursorPath);
    }

    startAfter(cursor) {
      return new Query(this.collectionId, this.field, this.value, this.limitValue, cursor.ref.path);
    }

    async get() {
      const paths = [...state.entries()]
        .filter(([documentPath]) => documentPath.split("/").at(-2) === this.collectionId)
        .filter(([, value]) => value?.[this.field] === this.value)
        .map(([documentPath]) => documentPath)
        .filter((documentPath) => !this.cursorPath || documentPath.localeCompare(this.cursorPath) > 0)
        .sort((left, right) => left.localeCompare(right))
        .slice(0, this.limitValue);
      queryLog.push({
        collectionId: this.collectionId,
        field: this.field,
        cursorPath: this.cursorPath,
        paths,
      });
      return { docs: paths.map((documentPath) => snapshot(doc(documentPath))), empty: paths.length === 0 };
    }
  }

  async function runTransaction(operation) {
    transactionCalls += 1;
    const operations = [];
    const writes = [];
    let writeStarted = false;
    const transaction = {
      async get(ref) {
        assert.equal(writeStarted, false, "every transaction read must precede every write");
        operations.push({ kind: "get", path: ref.path });
        return snapshot(ref);
      },
      set(ref, value, setOptions) {
        writeStarted = true;
        operations.push({ kind: "set", path: ref.path });
        writes.push({ kind: "set", ref, value: clone(value), options: setOptions });
      },
      update(ref, value) {
        writeStarted = true;
        operations.push({ kind: "update", path: ref.path });
        writes.push({ kind: "update", ref, value: clone(value) });
      },
      delete(ref) {
        writeStarted = true;
        operations.push({ kind: "delete", path: ref.path });
        writes.push({ kind: "delete", ref });
      },
    };
    const result = await operation(transaction);
    transactionLog.push(operations);
    if (preCommitFailures > 0 || preCommitFailureCalls.delete(transactionCalls)) {
      if (preCommitFailures > 0) preCommitFailures -= 1;
      const error = new Error("simulated pre-commit response failure");
      error.code = "unavailable";
      throw error;
    }
    for (const write of writes) {
      if (write.kind === "delete") {
        state.delete(write.ref.path);
      } else if (write.kind === "set" && !write.options?.merge) {
        state.set(write.ref.path, clone(write.value));
      } else {
        state.set(write.ref.path, {
          ...(state.get(write.ref.path) || {}),
          ...clone(write.value),
        });
      }
    }
    if (postCommitFailures > 0 || postCommitFailureCalls.delete(transactionCalls)) {
      if (postCommitFailures > 0) postCommitFailures -= 1;
      const error = new Error("simulated committed response loss");
      error.code = "unavailable";
      throw error;
    }
    return result;
  }

  return {
    firestore: {
      collectionGroup: (collectionId) => new Query(collectionId),
      doc,
      runTransaction,
    },
    has: (path) => state.has(path),
    read: (path) => clone(state.get(path)),
    write: (path, value) => state.set(path, clone(value)),
    entries: () => clone(Object.fromEntries(state)),
    queryLog,
    transactionLog,
    get transactionCalls() {
      return transactionCalls;
    },
  };
}

function runCleanup(fake, overrides = {}) {
  return cleanupAccountDiamondPrivateNotes({
    firestore: fake.firestore,
    uid: UID,
    documentIdField: DOCUMENT_ID,
    redactedAt: REDACTED_AT,
    pageSize: 1,
    transactionSize: 1,
    ...overrides,
  });
}

function runDirectAuthDelete(fake, overrides = {}) {
  const handler = createAccountDiamondPrivateNoteAuthDeleteHandler({
    firestore: fake.firestore,
    getDocumentIdField: () => DOCUMENT_ID,
    now: () => REDACTED_AT,
  });
  return handler(
    overrides.user || { uid: UID },
    { timestamp: REDACTED_AT, ...overrides.context },
  );
}

test("exposes bounded Diamond private-note account-deletion limits", () => {
  assert.equal(ACCOUNT_DIAMOND_PRIVATE_NOTE_PAGE_SIZE, 250);
  assert.equal(ACCOUNT_DIAMOND_PRIVATE_NOTE_TRANSACTION_SIZE, 50);
});

test("redacts indexed active notes, fences their projections, and advances past unrelated notes", async () => {
  const bundle = buildPrivateNoteDocuments();
  const unrelatedPath = "accounts/example/notes/generic-note";
  const fake = makeFirestore({
    [`accountDeletionRequests/${UID}`]: { uid: UID, status: "processing" },
    [unrelatedPath]: { authorUid: UID, text: "generic note is outside Diamond" },
    ...seedBundle(bundle),
  });

  const result = await runCleanup(fake);

  assert.equal(result.notesRedacted, 1);
  assert.equal(result.scorebooksFenced, 1);
  assert.deepEqual(fake.read(unrelatedPath), {
    authorUid: UID,
    text: "generic note is outside Diamond",
  });
  const redaction = fake.read(bundle.paths.notePath);
  assert.deepEqual(Object.keys(redaction).sort(), [
    "commandId",
    "eventId",
    "instanceId",
    "reason",
    "redactedAt",
    "revision",
    "schemaVersion",
    "status",
    "trackingEngine",
  ]);
  assert.equal(JSON.stringify(redaction).includes(UID), false);
  assert.equal(JSON.stringify(redaction).includes("private account deletion fixture"), false);
  assert.doesNotThrow(() =>
    privateNoteCore.parseDiamondPrivateNoteRedaction(
      redaction,
      bundle.event,
      bundle.root.instanceId,
      domainEngine,
    ),
  );
  assert.equal(fake.has(bundle.paths.projectionPath), false);
  const root = fake.read(bundle.paths.rootPath);
  assert.equal(root.privateNotePrivacyRevision, 5);
  assert.equal(root.projectionStatus, "pending");
  assert.equal(root.projectionLease, null);
  assert.equal(root.projectionFailure, null);
  assert.deepEqual(root.diamondProjectionMarker, bundle.marker);
  assert.deepEqual(root.projectionRequest, { requestId: "retain-request" });
  assert.ok(
    fake.queryLog.some(
      (entry) =>
        entry.collectionId === "notes" &&
        entry.field === "authorUid" &&
        entry.cursorPath === unrelatedPath,
    ),
  );

  const retry = await runCleanup(fake);
  assert.equal(retry.notesRedacted, 0);
  assert.equal(fake.read(bundle.paths.rootPath).privateNotePrivacyRevision, 5);
});

test("preflights every exact Diamond legacy source before changing active notes", async (t) => {
  const legacyCases = [
    { kind: "note" },
    {
      kind: "supersede-to-private",
      event: {
        type: "supersede_event",
        payload: {
          targetEventId: "event-public",
          reason: "legacy private replacement",
          replacement: { type: "private_note", payload: { text: "legacy replacement" } },
        },
      },
    },
    {
      kind: "void-private-target",
      event: {
        type: "void_event",
        payload: {
          targetEventId: "private-note-by-another-user",
          reason: "legacy private correction reason",
        },
      },
    },
    {
      kind: "supersede-private-target-to-public",
      event: {
        type: "supersede_event",
        payload: {
          targetEventId: "private-note-by-another-user",
          reason: "legacy private correction reason",
          replacement: {
            type: "rules_decision",
            payload: { code: "local_rule", description: "Public ruling." },
          },
        },
      },
    },
  ];
  for (const legacyCase of legacyCases) {
    await t.test(legacyCase.kind, async () => {
      const active = buildPrivateNoteDocuments();
      const seed = {
        [`accountDeletionRequests/${UID}`]: { uid: UID, status: "processing" },
        ...seedBundle(active),
      };
      if (legacyCase.kind === "note") {
        seed["teams/team-legacy/games/game-legacy/diamondScorebooks/v2/notes/event-legacy"] = {
          createdBy: UID,
          text: "legacy private note",
        };
      } else {
        seed["teams/team-legacy/games/game-legacy/diamondScorebooks/v2/events/event-legacy"] = {
          eventId: "event-legacy",
          actorUid: UID,
          ...legacyCase.event,
        };
      }
      const fake = makeFirestore(seed);

      await assert.rejects(
        runCleanup(fake),
        (error) => error?.code === "diamond-private-note-migration-required",
      );
      assert.deepEqual(fake.read(active.paths.notePath), active.note);
      assert.deepEqual(fake.read(active.paths.rootPath), active.root);
      assert.deepEqual(fake.read(active.paths.projectionPath), active.projection);
      assert.equal(fake.transactionCalls, 0);
    });
  }
});

test("fails closed on the deletion-request barrier and exact receipt identity", async (t) => {
  for (const variant of ["request", "receipt"]) {
    await t.test(variant, async () => {
      const bundle = buildPrivateNoteDocuments();
      const seed = {
        [`accountDeletionRequests/${UID}`]:
          variant === "request"
            ? { uid: UID, status: "failed" }
            : { uid: UID, status: "processing" },
        ...seedBundle(bundle),
      };
      if (variant === "receipt") {
        seed[bundle.paths.receiptPath] = {
          ...seed[bundle.paths.receiptPath],
          instanceId: uuid(901),
        };
      }
      const fake = makeFirestore(seed);

      await assert.rejects(
        runCleanup(fake),
        (error) => error?.code === "diamond-private-note-integrity-failed",
      );
      assert.deepEqual(fake.read(bundle.paths.notePath), bundle.note);
      assert.deepEqual(fake.read(bundle.paths.rootPath), bundle.root);
      assert.ok(fake.read(bundle.paths.projectionPath));
    });
  }
});

test("reconciles committed response loss and retries a definitive pre-commit failure without double fencing", async (t) => {
  for (const failureKind of ["post", "pre"]) {
    await t.test(failureKind, async () => {
      const bundle = buildPrivateNoteDocuments();
      const fake = makeFirestore(
        {
          [`accountDeletionRequests/${UID}`]: { uid: UID, status: "processing" },
          ...seedBundle(bundle),
        },
        failureKind === "post"
          ? { postCommitFailures: 1 }
          : { preCommitFailures: 1 },
      );

      const result = await runCleanup(fake);

      assert.equal(result.notesRedacted, 1);
      assert.equal(fake.read(bundle.paths.rootPath).privateNotePrivacyRevision, 5);
      assert.equal(fake.has(bundle.paths.projectionPath), false);
      assert.equal(fake.read(bundle.paths.notePath).status, "deleted");
      assert.equal(fake.transactionCalls, failureKind === "post" ? 1 : 2);
    });
  }
});

test("direct Auth deletion durably redacts private material behind a retained hash-only barrier", async () => {
  const bundle = buildPrivateNoteDocuments();
  const fake = makeFirestore(seedBundle(bundle));

  await runDirectAuthDelete(fake);

  assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), true);
  assert.equal(fake.has(bundle.paths.projectionPath), false);
  assert.equal(fake.read(bundle.paths.notePath).status, "deleted");
  assert.equal(fake.read(bundle.paths.notePath).redactedAt, REDACTED_AT);
  assert.equal(fake.read(bundle.paths.rootPath).privateNotePrivacyRevision, 5);
  const operations = fake.transactionLog.flat();
  const barrierCreated = operations.findIndex(
    ({ kind, path }) => kind === "set" && path === AUTH_DELETE_BARRIER_PATH,
  );
  const noteRedacted = operations.findIndex(
    ({ kind, path }) => kind === "set" && path === bundle.paths.notePath,
  );
  assert.ok(barrierCreated >= 0);
  assert.ok(noteRedacted > barrierCreated);
  assert.equal(
    operations.some(
      ({ kind, path }) =>
        kind === "delete" && path === AUTH_DELETE_BARRIER_PATH,
    ),
    false,
  );
  assert.equal(AUTH_DELETE_BARRIER_PATH.includes(UID), false);
  const retainedState = JSON.stringify(fake.entries());
  assert.equal(retainedState.includes(UID), false);
  assert.equal(retainedState.includes("private account deletion fixture"), false);

  await runDirectAuthDelete(fake);
  assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), true);
  assert.equal(fake.read(bundle.paths.rootPath).privateNotePrivacyRevision, 5);
  assert.equal(JSON.stringify(fake.entries()).includes(UID), false);
});

test("direct Auth deletion preserves unrelated account-deletion request states", async (t) => {
  for (const status of [null, "queued", "processing", "failed"]) {
    await t.test(status || "missing", async () => {
      const bundle = buildPrivateNoteDocuments();
      const requestPath = `accountDeletionRequests/${UID}`;
      const request = status
        ? { uid: UID, status, source: "existing-worker", opaque: "retain-me" }
        : undefined;
      const fake = makeFirestore({
        ...(request ? { [requestPath]: request } : {}),
        ...seedBundle(bundle),
      });

      await runDirectAuthDelete(fake);

      assert.equal(fake.read(bundle.paths.notePath).status, "deleted");
      assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), true);
      if (request) {
        assert.deepEqual(fake.read(requestPath), request);
      } else {
        assert.equal(fake.has(requestPath), false);
      }
    });
  }
});

test("direct Auth deletion and the normal request worker are idempotent in either order", async (t) => {
  for (const first of ["auth-delete", "request-worker"]) {
    await t.test(first, async () => {
      const bundle = buildPrivateNoteDocuments();
      const requestPath = `accountDeletionRequests/${UID}`;
      const request = { uid: UID, status: "processing", opaque: "retain-me" };
      const fake = makeFirestore({
        [requestPath]: request,
        ...seedBundle(bundle),
      });

      if (first === "auth-delete") {
        await runDirectAuthDelete(fake);
        await runCleanup(fake);
      } else {
        await runCleanup(fake);
        await runDirectAuthDelete(fake);
      }

      assert.equal(fake.read(bundle.paths.notePath).status, "deleted");
      assert.equal(fake.read(bundle.paths.rootPath).privateNotePrivacyRevision, 5);
      assert.equal(fake.has(bundle.paths.projectionPath), false);
      assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), true);
      assert.deepEqual(fake.read(requestPath), request);
    });
  }
});

test("direct Auth deletion reconciles barrier write ambiguity without exposing identity", async (t) => {
  const cases = [
    {
      name: "definitive barrier pre-commit failure",
      options: { preCommitFailureCalls: [1] },
      expectedTransactions: 3,
    },
    {
      name: "committed barrier-create response loss",
      options: { postCommitFailureCalls: [1] },
      expectedTransactions: 2,
    },
  ];
  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const bundle = buildPrivateNoteDocuments();
      const fake = makeFirestore(seedBundle(bundle), testCase.options);

      await runDirectAuthDelete(fake);

      assert.equal(fake.transactionCalls, testCase.expectedTransactions);
      assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), true);
      assert.equal(fake.read(bundle.paths.notePath).status, "deleted");
      assert.equal(fake.read(bundle.paths.rootPath).privateNotePrivacyRevision, 5);
      assert.equal(JSON.stringify(fake.entries()).includes(UID), false);
      assert.equal(
        JSON.stringify(fake.entries()).includes("private account deletion fixture"),
        false,
      );
    });
  }
});

test("direct Auth deletion retains its barrier across a failed cleanup and resumes with its original timestamp", async () => {
  const bundle = buildPrivateNoteDocuments();
  const invalidReceipt = { ...bundle.receipt, instanceId: uuid(901) };
  const fake = makeFirestore({
    ...seedBundle(bundle),
    [bundle.paths.receiptPath]: invalidReceipt,
  });

  await assert.rejects(
    runDirectAuthDelete(fake),
    (error) => error?.code === "diamond-private-note-integrity-failed",
  );
  assert.deepEqual(fake.read(AUTH_DELETE_BARRIER_PATH), {
    schemaVersion: 1,
    type: "diamond-private-note-auth-delete-barrier",
    status: "auth-deleted",
    startedAt: REDACTED_AT,
  });
  assert.deepEqual(fake.read(bundle.paths.notePath), bundle.note);
  assert.ok(fake.read(bundle.paths.projectionPath));

  fake.write(bundle.paths.receiptPath, bundle.receipt);
  await runDirectAuthDelete(fake, {
    context: { timestamp: "2026-09-10T12:00:00.000Z" },
  });

  assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), true);
  assert.equal(fake.read(bundle.paths.notePath).status, "deleted");
  assert.equal(fake.read(bundle.paths.notePath).redactedAt, REDACTED_AT);
});

test("direct Auth deletion fails closed on a forged terminal barrier", async () => {
  const bundle = buildPrivateNoteDocuments();
  const fake = makeFirestore({
    ...seedBundle(bundle),
    [AUTH_DELETE_BARRIER_PATH]: {
      schemaVersion: 1,
      type: "diamond-private-note-auth-delete-barrier",
      status: "complete",
      startedAt: REDACTED_AT,
    },
  });

  await assert.rejects(
    runDirectAuthDelete(fake),
    (error) => error?.code === "diamond-private-note-integrity-failed",
  );
  assert.equal(fake.read(AUTH_DELETE_BARRIER_PATH).status, "complete");
  assert.deepEqual(fake.read(bundle.paths.notePath), bundle.note);
  assert.ok(fake.read(bundle.paths.projectionPath));
});

test("direct Auth deletion rejects malformed event identity before creating a barrier", async (t) => {
  for (const testCase of [
    { name: "principal", overrides: { user: { uid: "bad/uid" } } },
    { name: "timestamp", overrides: { context: { timestamp: "not-a-timestamp" } } },
  ]) {
    await t.test(testCase.name, async () => {
      const bundle = buildPrivateNoteDocuments();
      const fake = makeFirestore(seedBundle(bundle));

      await assert.rejects(
        runDirectAuthDelete(fake, testCase.overrides),
        (error) => error?.code === "diamond-private-note-integrity-failed",
      );

      assert.equal(fake.has(AUTH_DELETE_BARRIER_PATH), false);
      assert.deepEqual(fake.read(bundle.paths.notePath), bundle.note);
      assert.ok(fake.read(bundle.paths.projectionPath));
      assert.equal(fake.transactionCalls, 0);
    });
  }
});

test("wires the privacy cleanup before every destructive account cleanup and declares query indexes", () => {
  const root = join(__dirname, "..", "..");
  const source = readFileSync(join(root, "functions", "index.js"), "utf8");
  const helper = source.indexOf("await cleanupAccountDiamondPrivateNotes(");
  assert.ok(helper > 0);
  for (const laterOperation of [
    "await deleteAccountStorage(",
    "if (userDoc.exists) await firestore.recursiveDelete(userRef)",
    "await admin.auth().deleteUser(uid)",
  ]) {
    assert.ok(source.indexOf(laterOperation) > helper, laterOperation);
  }
  assert.match(source, /diamond-private-note-migration-required/);
  assert.match(
    source,
    /exports\.cleanupAccountDiamondPrivateNotesOnAuthDelete = functions\s+\.runWith\(\{ timeoutSeconds: 540, memory: '1GB', failurePolicy: true \}\)\s+\.auth\s+\.user\(\)\s+\.onDelete\(cleanupAccountDiamondPrivateNotesOnAuthDelete\)/,
  );

  const indexes = JSON.parse(
    readFileSync(join(root, "firestore.indexes.json"), "utf8"),
  );
  const indexed = new Set(
    indexes.fieldOverrides
      .filter((entry) =>
        entry.indexes?.some(
          (index) =>
            index.order === "ASCENDING" &&
            index.queryScope === "COLLECTION_GROUP",
        ),
      )
      .map((entry) => `${entry.collectionGroup}.${entry.fieldPath}`),
  );
  assert.ok(indexed.has("notes.authorUid"));
  assert.ok(indexed.has("notes.createdBy"));
  assert.ok(indexed.has("events.actorUid"));
});
