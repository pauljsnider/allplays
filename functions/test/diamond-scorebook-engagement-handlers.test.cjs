"use strict";

const assert = require("node:assert/strict");
const { describe, it } = require("node:test");

const {
  DIAMOND_ENGINE,
  RATE_POLICIES,
  createDiamondLiveEngagementHandlers,
  engagementPaths,
  isDiamondInteractionWindowOpen,
  isGameDay,
  moderationPaths,
} = require("../diamond-live-engagement-handlers.cjs");

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

  delete(reference) {
    this.operations.push({ kind: "delete", reference });
  }
}

class FakeFirestore {
  constructor(seed = {}) {
    this.documents = new Map(
      Object.entries(seed).map(([path, value]) => [path, clone(value)]),
    );
    this.transactionQueue = Promise.resolve();
    this.commitCount = 0;
    this.failAfterCommit = new Set();
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
      } else if (operation.kind === "delete") {
        next.delete(path);
      }
    }
    this.documents = next;
  }

  runTransaction(callback) {
    const execute = async () => {
      const transaction = new FakeTransaction(this);
      const result = await callback(transaction);
      this.commitCount += 1;
      const commit = this.commitCount;
      this.apply(transaction.operations);
      if (this.failAfterCommit.has(commit)) {
        this.failAfterCommit.delete(commit);
        throw Object.assign(new Error("Committed response lost"), {
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

const UID = "fan-1";
const TEAM_ID = "team-1";
const GAME_ID = "game-1";
const INSTANCE_ID = "00000000-0000-4000-8000-000000000001";
const CHAT_REQUEST_ID = "00000000-0000-4000-8000-000000000002";
const REACTION_REQUEST_ID = "00000000-0000-4000-8000-000000000003";
const MODERATION_REQUEST_ID = "00000000-0000-4000-8000-000000000004";
const NOW = Date.parse("2026-09-05T18:00:00.000Z");

function baseSeed(overrides = {}) {
  const team = {
    ownerId: "owner-1",
    active: true,
    isPublic: true,
    timeZone: "America/Chicago",
    ...(overrides.team || {}),
  };
  const game = {
    type: "game",
    trackingEngine: DIAMOND_ENGINE,
    diamondScorebookInstanceId: INSTANCE_ID,
    visibility: "public",
    status: "live",
    liveStatus: "live",
    date: "2026-09-05T15:00:00.000Z",
    ...(overrides.game || {}),
  };
  const checkpoint = {
    teamId: TEAM_ID,
    gameId: GAME_ID,
    sequence: 1,
    state: {
      teamId: TEAM_ID,
      gameId: GAME_ID,
      revision: 1,
      lifecycle: "active",
      ...(overrides.root?.checkpoint?.state || {}),
    },
    ...(overrides.root?.checkpoint || {}),
  };
  checkpoint.state = {
    teamId: TEAM_ID,
    gameId: GAME_ID,
    revision: checkpoint.sequence,
    lifecycle: "active",
    ...(overrides.root?.checkpoint?.state || {}),
  };
  const root = {
    schemaVersion: 2,
    trackingEngine: DIAMOND_ENGINE,
    teamId: TEAM_ID,
    gameId: GAME_ID,
    instanceId: INSTANCE_ID,
    ...(overrides.root || {}),
    checkpoint,
  };
  return {
    [`teams/${TEAM_ID}`]: team,
    [`teams/${TEAM_ID}/games/${GAME_ID}`]: game,
    [`teams/${TEAM_ID}/games/${GAME_ID}/diamondScorebooks/v2`]: root,
    [`users/${UID}`]: {
      isAdmin: false,
      parentTeamIds: [],
      fullName: "Profile Name",
      photoUrl: "https://evil.example/profile.png",
      ...(overrides.user || {}),
    },
    ...(overrides.rsvp
      ? { [`teams/${TEAM_ID}/games/${GAME_ID}/rsvps/${UID}`]: overrides.rsvp }
      : {}),
  };
}

function chatRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    requestId: CHAT_REQUEST_ID,
    teamId: TEAM_ID,
    gameId: GAME_ID,
    expectedInstanceId: INSTANCE_ID,
    viewerMode: "live",
    text: "Great play!",
    ...overrides,
  };
}

function reactionRequest(overrides = {}) {
  return {
    schemaVersion: 1,
    requestId: REACTION_REQUEST_ID,
    teamId: TEAM_ID,
    gameId: GAME_ID,
    expectedInstanceId: INSTANCE_ID,
    viewerMode: "live",
    type: "clap",
    ...overrides,
  };
}

function moderationRequest(messageId, overrides = {}) {
  return {
    schemaVersion: 1,
    requestId: MODERATION_REQUEST_ID,
    teamId: TEAM_ID,
    gameId: GAME_ID,
    expectedInstanceId: INSTANCE_ID,
    messageId,
    ...overrides,
  };
}

function createHarness({
  seed = baseSeed(),
  now = NOW,
  clock = null,
  authUser = {},
  publicGame = true,
  access = {},
  assertSensitiveWrite = async () => {},
} = {}) {
  const firestore = new FakeFirestore(seed);
  const calls = { sensitive: [], logger: [] };
  const authRecord = {
    uid: UID,
    disabled: false,
    email: "fan@example.com",
    emailVerified: true,
    displayName: "Authoritative Fan",
    photoURL: "https://lh3.googleusercontent.com/fan/photo.jpg",
    customClaims: {},
    ...authUser,
  };
  const handlers = createDiamondLiveEngagementHandlers({
    firestore,
    auth: { getUser: async () => clone(authRecord) },
    FieldValue: {
      serverTimestamp: () => ({ __serverTimestamp: true }),
    },
    HttpsError: TestHttpsError,
    assertSensitiveWrite: async (context, operation) => {
      calls.sensitive.push({ context: clone(context), operation });
      return assertSensitiveWrite(context, operation);
    },
    resolveDelegatedAccess: () => ({
      full: false,
      parent: false,
      scorekeeping: false,
      videography: false,
      streaming: false,
      media: false,
      ...access,
    }),
    isPublicGame: () => publicGame,
    clock: clock || (() => now),
    logger: {
      info: (event, metadata) => calls.logger.push({ event, metadata }),
    },
  });
  return { handlers, firestore, calls, authRecord };
}

function context(uid = UID) {
  return { auth: uid ? { uid, token: { name: "Spoofed Token Name" } } : null };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

describe("Diamond live engagement handler factory", () => {
  it("requires server-authoritative dependencies", () => {
    assert.throws(() => createDiamondLiveEngagementHandlers(), /Firestore/);
    assert.throws(
      () =>
        createDiamondLiveEngagementHandlers({
          firestore: { doc() {}, runTransaction() {} },
        }),
      /Auth dependency/,
    );
  });

  it("uses the configured game timezone for the game-day boundary", () => {
    assert.equal(
      isGameDay(
        { date: "2026-09-06T04:30:00.000Z", timeZone: "America/Chicago" },
        {},
        Date.parse("2026-09-06T03:30:00.000Z"),
      ),
      true,
    );
    assert.equal(
      isGameDay(
        { date: "2026-09-06T06:30:00.000Z", timeZone: "America/Chicago" },
        {},
        Date.parse("2026-09-06T03:30:00.000Z"),
      ),
      false,
    );
    assert.equal(
      isGameDay(
        { date: "2026-09-05T18:00:00.000Z", timeZone: "not/a-zone" },
        {},
        NOW,
      ),
      false,
    );
    assert.equal(
      isGameDay({ date: "2026-09-05T18:00:00.000Z" }, {}, NOW),
      false,
    );
  });

  it("decides configured and ready interaction windows in the authoritative IANA timezone", () => {
    const cases = [
      {
        label: "ahead of UTC",
        lifecycle: "configured",
        game: {
          date: "2026-09-05T10:30:00.000Z",
          timeZone: "Pacific/Kiritimati",
        },
        nowMillis: Date.parse("2026-09-06T09:30:00.000Z"),
      },
      {
        label: "behind UTC across the fall DST boundary",
        lifecycle: "ready",
        game: {
          date: "2026-11-01T07:30:00.000Z",
          timeZone: "America/Los_Angeles",
        },
        nowMillis: Date.parse("2026-11-02T07:30:00.000Z"),
      },
      {
        label: "across the spring DST boundary",
        lifecycle: "configured",
        game: {
          date: "2026-03-08T05:30:00.000Z",
          timeZone: "America/New_York",
        },
        nowMillis: Date.parse("2026-03-09T03:30:00.000Z"),
      },
    ];
    for (const testCase of cases) {
      assert.equal(
        isDiamondInteractionWindowOpen({
          team: {},
          game: { type: "game", ...testCase.game },
          lifecycle: testCase.lifecycle,
          nowMillis: testCase.nowMillis,
        }),
        true,
        testCase.label,
      );
    }
  });

  it("fails the shared interaction decision closed for terminal, invalid-timezone, and off-day games", () => {
    const sameDayGame = {
      type: "game",
      date: "2026-09-05T18:00:00.000Z",
      timeZone: "America/Chicago",
    };
    for (const testCase of [
      { lifecycle: "final", game: sameDayGame },
      {
        lifecycle: "configured",
        game: { ...sameDayGame, timeZone: "not/a-zone" },
      },
      {
        lifecycle: "ready",
        game: { ...sameDayGame, timeZone: "" },
        team: { timeZone: "" },
      },
      {
        lifecycle: "configured",
        game: { ...sameDayGame, date: "2026-09-06T18:00:00.000Z" },
      },
    ]) {
      assert.equal(
        isDiamondInteractionWindowOpen({
          team: testCase.team || {},
          game: testCase.game,
          lifecycle: testCase.lifecycle,
          nowMillis: NOW,
        }),
        false,
      );
    }
  });
});

describe("Diamond live engagement authorization and validation", () => {
  it("requires authentication before reading or writing Firestore", async () => {
    const harness = createHarness();
    await rejectsCode(
      harness.handlers.postDiamondLiveChat(chatRequest(), context("")),
      "unauthenticated",
    );
    assert.equal(harness.firestore.commitCount, 0);
  });

  it("rejects disabled or missing authoritative Auth users", async () => {
    const disabled = createHarness({ authUser: { disabled: true } });
    await rejectsCode(
      disabled.handlers.postDiamondLiveChat(chatRequest(), context()),
      "permission-denied",
    );
    assert.equal(disabled.firestore.commitCount, 0);
  });

  it("runs verified-email policy semantics against the fresh Auth record", async () => {
    const harness = createHarness({
      authUser: {
        email: "fresh@example.com",
        emailVerified: false,
        customClaims: { email_verification_exempt: true },
      },
    });
    await harness.handlers.postDiamondLiveChat(chatRequest(), context());
    assert.deepEqual(harness.calls.sensitive, [
      {
        operation: "diamond-live-engagement",
        context: {
          auth: {
            uid: UID,
            token: {
              email_verification_exempt: true,
              email: "fresh@example.com",
              email_verified: false,
              name: "Authoritative Fan",
              picture: "https://lh3.googleusercontent.com/fan/photo.jpg",
            },
          },
        },
      },
    ]);
  });

  it("propagates an enforced verified-email denial without a write", async () => {
    const harness = createHarness({
      assertSensitiveWrite: async () => {
        throw new TestHttpsError("failed-precondition", "Verify email.");
      },
    });
    await rejectsCode(
      harness.handlers.postDiamondLiveChat(chatRequest(), context()),
      "failed-precondition",
    );
    assert.equal(harness.firestore.commitCount, 0);
  });

  it("allows a shareable game or a currently authorized private-game user", async () => {
    const publicHarness = createHarness();
    const publicResult = await publicHarness.handlers.postDiamondLiveChat(
      chatRequest(),
      context(),
    );
    assert.equal(publicResult.outcome, "accepted");

    for (const access of [
      { full: true },
      { parent: true },
      { scorekeeping: true },
      { videography: true },
      { streaming: true },
    ]) {
      const privateHarness = createHarness({ publicGame: false, access });
      const privateResult =
        await privateHarness.handlers.postDiamondLiveReaction(
          reactionRequest(),
          context(),
        );
      assert.equal(privateResult.outcome, "accepted");
    }

    const officialHarness = createHarness({
      publicGame: false,
      seed: baseSeed({
        game: { officiatingAuthorizedUserIds: [UID] },
      }),
    });
    const officialResult =
      await officialHarness.handlers.postDiamondLiveReaction(
        reactionRequest(),
        context(),
      );
    assert.equal(officialResult.outcome, "accepted");
  });

  it("denies an unrelated user on a private game", async () => {
    const harness = createHarness({ publicGame: false });
    await rejectsCode(
      harness.handlers.postDiamondLiveChat(chatRequest(), context()),
      "permission-denied",
    );
    assert.equal(harness.firestore.commitCount, 0);
  });

  it("denies a media-only user from posting private-game chat", async () => {
    const harness = createHarness({
      publicGame: false,
      access: { media: true },
    });
    await rejectsCode(
      harness.handlers.postDiamondLiveChat(chatRequest(), context()),
      "permission-denied",
    );
    assert.equal(harness.firestore.commitCount, 0);
  });

  it("denies a media-only user from posting private-game reactions", async () => {
    const harness = createHarness({
      publicGame: false,
      access: { media: true },
    });
    await rejectsCode(
      harness.handlers.postDiamondLiveReaction(reactionRequest(), context()),
      "permission-denied",
    );
    assert.equal(harness.firestore.commitCount, 0);
  });

  it("requires strict request fields, canonical content, a secure UUID, and live mode", async () => {
    for (const [request, code] of [
      [chatRequest({ senderId: "spoofed" }), "invalid-argument"],
      [chatRequest({ text: " padded " }), "invalid-argument"],
      [chatRequest({ requestId: "weak-id" }), "invalid-argument"],
      [chatRequest({ viewerMode: "replay" }), "failed-precondition"],
      [reactionRequest({ type: "other" }), "invalid-argument"],
    ]) {
      const harness = createHarness();
      const handler = Object.hasOwn(request, "text")
        ? harness.handlers.postDiamondLiveChat
        : harness.handlers.postDiamondLiveReaction;
      await rejectsCode(handler(request, context()), code);
      assert.equal(harness.firestore.commitCount, 0);
    }
  });

  it("requires an exact current Diamond v2 game and scorebook instance", async () => {
    for (const seed of [
      baseSeed({ game: { trackingEngine: "legacy" } }),
      baseSeed({ root: { trackingEngine: "legacy" } }),
      baseSeed({
        root: { instanceId: "00000000-0000-4000-8000-000000000009" },
      }),
    ]) {
      const harness = createHarness({ seed });
      await rejectsCode(
        harness.handlers.postDiamondLiveChat(chatRequest(), context()),
        "failed-precondition",
      );
      assert.equal(harness.firestore.commitCount, 0);
    }
  });

  it("fails closed outside a live or same-day scheduled window", async () => {
    for (const [lifecycle, game] of [
      [
        "configured",
        {
          date: "2026-09-06T18:00:00.000Z",
          status: "scheduled",
          liveStatus: "scheduled",
        },
      ],
      ["final", { status: "live", liveStatus: "live" }],
      ["correction", { status: "live", liveStatus: "live" }],
      ["cancelled", { status: "live", liveStatus: "live" }],
      ["active", { status: "final", liveStatus: "final" }],
    ]) {
      const seed = baseSeed({
        game,
        root: { checkpoint: { state: { lifecycle } } },
      });
      const harness = createHarness({ seed });
      await rejectsCode(
        harness.handlers.postDiamondLiveChat(chatRequest(), context()),
        "failed-precondition",
      );
      assert.equal(harness.firestore.commitCount, 0);
    }

    const scheduled = createHarness({
      seed: baseSeed({
        game: { status: "scheduled", liveStatus: "scheduled" },
        root: { checkpoint: { state: { lifecycle: "ready" } } },
      }),
    });
    assert.equal(
      (await scheduled.handlers.postDiamondLiveChat(chatRequest(), context()))
        .outcome,
      "accepted",
    );
  });

  it("does not infer a timezone for a same-date configured game", async () => {
    const seed = baseSeed({
      team: { timeZone: "" },
      game: {
        timeZone: "",
        timezone: "",
        status: "scheduled",
        liveStatus: "scheduled",
      },
      root: { checkpoint: { state: { lifecycle: "configured" } } },
    });
    const harness = createHarness({ seed });

    await rejectsCode(
      harness.handlers.postDiamondLiveChat(chatRequest(), context()),
      "failed-precondition",
    );
    assert.equal(harness.firestore.commitCount, 0);
  });
});

describe("Diamond live engagement durability", () => {
  it("writes generation-scoped chat with identity derived only from server records", async () => {
    const harness = createHarness();
    const result = await harness.handlers.postDiamondLiveChat(
      chatRequest(),
      context(),
    );
    const outputPath = `teams/${TEAM_ID}/games/${GAME_ID}/diamondLiveGenerations/${INSTANCE_ID}/chat/${result.messageId}`;
    assert.deepEqual(harness.firestore.read(outputPath), {
      schemaVersion: 1,
      trackingEngine: DIAMOND_ENGINE,
      teamId: TEAM_ID,
      gameId: GAME_ID,
      instanceId: INSTANCE_ID,
      text: "Great play!",
      senderId: UID,
      senderName: "Authoritative Fan",
      senderPhotoUrl: "https://lh3.googleusercontent.com/fan/photo.jpg",
      isAnonymous: false,
      createdAt: { __serverTimestamp: true },
    });
    assert.equal(result.idempotent, false);
    assert.match(result.messageId, /^diamond-chat-[a-f0-9]{64}$/);
  });

  it("drops an unsupported profile photo rather than copying unsafe user data", async () => {
    const harness = createHarness({
      authUser: {
        photoURL:
          "https://firebasestorage.googleapis.com/v0/b/attacker.firebasestorage.app/o/a.png",
      },
    });
    const result = await harness.handlers.postDiamondLiveChat(
      chatRequest(),
      context(),
    );
    const output = harness.firestore.read(
      `teams/${TEAM_ID}/games/${GAME_ID}/diamondLiveGenerations/${INSTANCE_ID}/chat/${result.messageId}`,
    );
    assert.equal(output.senderPhotoUrl, null);
  });

  it("writes reactions into the exact Diamond generation", async () => {
    const harness = createHarness();
    const result = await harness.handlers.postDiamondLiveReaction(
      reactionRequest(),
      context(),
    );
    assert.deepEqual(
      harness.firestore.read(
        `teams/${TEAM_ID}/games/${GAME_ID}/diamondLiveGenerations/${INSTANCE_ID}/reactions/${result.reactionId}`,
      ),
      {
        schemaVersion: 1,
        trackingEngine: DIAMOND_ENGINE,
        teamId: TEAM_ID,
        gameId: GAME_ID,
        instanceId: INSTANCE_ID,
        type: "clap",
        senderId: UID,
        createdAt: { __serverTimestamp: true },
      },
    );
  });

  it("returns one content-bound receipt for concurrent retries", async () => {
    const harness = createHarness();
    const [left, right] = await Promise.all([
      harness.handlers.postDiamondLiveChat(chatRequest(), context()),
      harness.handlers.postDiamondLiveChat(chatRequest(), context()),
    ]);
    assert.equal(left.messageId, right.messageId);
    assert.deepEqual([left.idempotent, right.idempotent].sort(), [false, true]);
    const outputs = [...harness.firestore.documents.keys()].filter((path) =>
      path.includes(`/diamondLiveGenerations/${INSTANCE_ID}/chat/`),
    );
    assert.equal(outputs.length, 1);
  });

  it("rejects reuse of a requestId for different content", async () => {
    const harness = createHarness();
    await harness.handlers.postDiamondLiveChat(chatRequest(), context());
    await rejectsCode(
      harness.handlers.postDiamondLiveChat(
        chatRequest({ text: "Different play" }),
        context(),
      ),
      "already-exists",
    );
    const outputs = [...harness.firestore.documents.keys()].filter((path) =>
      path.includes(`/diamondLiveGenerations/${INSTANCE_ID}/chat/`),
    );
    assert.equal(outputs.length, 1);
  });

  it("fails closed when an idempotent output loses its exact generation markers", async () => {
    const harness = createHarness();
    const first = await harness.handlers.postDiamondLiveChat(
      chatRequest(),
      context(),
    );
    const outputPath = `teams/${TEAM_ID}/games/${GAME_ID}/diamondLiveGenerations/${INSTANCE_ID}/chat/${first.messageId}`;
    const output = harness.firestore.read(outputPath);
    delete output.instanceId;
    harness.firestore.documents.set(outputPath, output);

    await rejectsCode(
      harness.handlers.postDiamondLiveChat(chatRequest(), context()),
      "already-exists",
    );
  });

  it("reconciles a committed transaction whose response was lost", async () => {
    const harness = createHarness();
    harness.firestore.failAfterCommit.add(1);
    const result = await harness.handlers.postDiamondLiveChat(
      chatRequest(),
      context(),
    );
    assert.equal(result.outcome, "accepted");
    assert.equal(result.idempotent, true);
    assert.equal(
      [...harness.firestore.documents.keys()].filter((path) =>
        path.includes(`/diamondLiveGenerations/${INSTANCE_ID}/chat/`),
      ).length,
      1,
    );
  });

  it("enforces durable per-user cooldowns separately for chat and reactions", async () => {
    let now = NOW;
    const seed = baseSeed();
    const firestore = new FakeFirestore(seed);
    const handlers = createDiamondLiveEngagementHandlers({
      firestore,
      auth: {
        getUser: async () => ({
          uid: UID,
          disabled: false,
          email: "fan@example.com",
          emailVerified: true,
        }),
      },
      FieldValue: { serverTimestamp: () => ({ __serverTimestamp: true }) },
      HttpsError: TestHttpsError,
      assertSensitiveWrite: async () => {},
      resolveDelegatedAccess: () => ({}),
      isPublicGame: () => true,
      clock: () => now,
    });
    await handlers.postDiamondLiveChat(chatRequest(), context());
    await rejectsCode(
      handlers.postDiamondLiveChat(
        chatRequest({
          requestId: "00000000-0000-4000-8000-000000000004",
          text: "Again",
        }),
        context(),
      ),
      "resource-exhausted",
    );
    await handlers.postDiamondLiveReaction(reactionRequest(), context());
    now += RATE_POLICIES.chat.cooldownMillis;
    assert.equal(
      (
        await handlers.postDiamondLiveChat(
          chatRequest({
            requestId: "00000000-0000-4000-8000-000000000004",
            text: "Again",
          }),
          context(),
        )
      ).outcome,
      "accepted",
    );
  });

  it("enforces the durable window cap and resets only after the server window expires", async () => {
    let now = NOW;
    const harness = createHarness({ clock: () => now });
    for (let index = 0; index < RATE_POLICIES.chat.maximum; index += 1) {
      const requestId = `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`;
      const result = await harness.handlers.postDiamondLiveChat(
        chatRequest({ requestId, text: `Message ${String(index + 1)}` }),
        context(),
      );
      assert.equal(result.outcome, "accepted");
      now += RATE_POLICIES.chat.cooldownMillis;
    }
    const nextRequest = chatRequest({
      requestId: "00000000-0000-4000-8000-000000000999",
      text: "One too many",
    });
    await rejectsCode(
      harness.handlers.postDiamondLiveChat(nextRequest, context()),
      "resource-exhausted",
    );

    now = NOW + RATE_POLICIES.chat.windowMillis;
    assert.equal(
      (await harness.handlers.postDiamondLiveChat(nextRequest, context()))
        .outcome,
      "accepted",
    );
  });

  it("fails closed when a stored durable rate record is malformed", async () => {
    const paths = engagementPaths(
      TEAM_ID,
      GAME_ID,
      INSTANCE_ID,
      UID,
      CHAT_REQUEST_ID,
      "chat",
      require("node:crypto"),
    );
    const seed = baseSeed();
    seed[paths.rate] = {
      schemaVersion: 1,
      trackingEngine: DIAMOND_ENGINE,
      instanceId: INSTANCE_ID,
      kind: "chat",
      actorHash: paths.actorHash,
      windowStartedAtMillis: NOW,
      lastAcceptedAtMillis: NOW + 1,
      acceptedCount: 1,
    };
    const harness = createHarness({ seed });
    await rejectsCode(
      harness.handlers.postDiamondLiveChat(chatRequest(), context()),
      "unavailable",
    );
    assert.equal(
      [...harness.firestore.documents.keys()].filter((path) =>
        path.includes(`/diamondLiveGenerations/${INSTANCE_ID}/chat/`),
      ).length,
      0,
    );
  });

  it("never puts resource identifiers into engagement telemetry", async () => {
    const harness = createHarness();
    await harness.handlers.postDiamondLiveChat(chatRequest(), context());
    assert.deepEqual(harness.calls.logger, [
      {
        event: "diamond_live_engagement_accepted",
        metadata: { kind: "chat", idempotent: false },
      },
    ]);
    assert.equal(JSON.stringify(harness.calls.logger).includes(TEAM_ID), false);
    assert.equal(JSON.stringify(harness.calls.logger).includes(GAME_ID), false);
    assert.equal(JSON.stringify(harness.calls.logger).includes(UID), false);
  });
});

describe("Diamond live chat moderation", () => {
  it("lets only a current team manager promptly remove an owned message", async () => {
    const harness = createHarness({ access: { full: true } });
    const posted = await harness.handlers.postDiamondLiveChat(
      chatRequest(),
      context(),
    );
    const outputPath = `teams/${TEAM_ID}/games/${GAME_ID}/diamondLiveGenerations/${INSTANCE_ID}/chat/${posted.messageId}`;
    assert.ok(harness.firestore.read(outputPath));

    const response = await harness.handlers.moderateDiamondLiveChat(
      moderationRequest(posted.messageId),
      context(),
    );
    assert.deepEqual(response, {
      outcome: "accepted",
      idempotent: false,
      requestId: MODERATION_REQUEST_ID,
      instanceId: INSTANCE_ID,
      messageId: posted.messageId,
      removed: true,
    });
    assert.equal(harness.firestore.read(outputPath), undefined);
    assert.equal(JSON.stringify(response).includes("reason"), false);

    const retried = await harness.handlers.moderateDiamondLiveChat(
      moderationRequest(posted.messageId),
      context(),
    );
    assert.equal(retried.idempotent, true);
    assert.deepEqual(harness.calls.logger.at(-1), {
      event: "diamond_live_engagement_moderated",
      metadata: { idempotent: true },
    });
    assert.equal(JSON.stringify(harness.calls.logger).includes(TEAM_ID), false);
    assert.equal(JSON.stringify(harness.calls.logger).includes(UID), false);
  });

  it("denies non-managers and rejects malformed or cross-generation targets", async () => {
    const harness = createHarness();
    const posted = await harness.handlers.postDiamondLiveChat(
      chatRequest(),
      context(),
    );
    await rejectsCode(
      harness.handlers.moderateDiamondLiveChat(
        moderationRequest(posted.messageId),
        context(),
      ),
      "permission-denied",
    );
    await rejectsCode(
      harness.handlers.moderateDiamondLiveChat(
        moderationRequest("other-message"),
        context(),
      ),
      "invalid-argument",
    );
    const manager = createHarness({ access: { full: true } });
    await rejectsCode(
      manager.handlers.moderateDiamondLiveChat(
        moderationRequest(posted.messageId, {
          expectedInstanceId: "00000000-0000-4000-8000-000000000099",
        }),
        context(),
      ),
      "failed-precondition",
    );
  });

  it("reconciles a committed delete with the same content-bound request", async () => {
    const harness = createHarness({ access: { full: true } });
    const posted = await harness.handlers.postDiamondLiveChat(
      chatRequest(),
      context(),
    );
    harness.firestore.failAfterCommit.add(2);
    const result = await harness.handlers.moderateDiamondLiveChat(
      moderationRequest(posted.messageId),
      context(),
    );
    assert.equal(result.idempotent, true);

    const paths = moderationPaths(
      TEAM_ID,
      GAME_ID,
      INSTANCE_ID,
      UID,
      MODERATION_REQUEST_ID,
      posted.messageId,
      require("node:crypto"),
    );
    assert.ok(harness.firestore.read(paths.receipt));
    assert.equal(harness.firestore.read(paths.output), undefined);
  });
});
