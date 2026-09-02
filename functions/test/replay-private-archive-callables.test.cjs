'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const { readFileSync } = require('node:fs');
const {
  REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH,
  REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
  REPLAY_COMPATIBILITY_SCHEMA,
  getReplayCompatibilityReceiptPath,
  getReplayCompatibilityParentFingerprint,
  getReplayClipYouTubeIdentityRecord,
  getReplayProtectedUrlIdentityRecord,
  getReplayProtectedYouTubeIdentityRecord
} = require('../replay-private-archive-core.cjs');
const {
  ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH,
  ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA
} = require('../athlete-profile-projection-core.cjs');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;
let adminStub;
let functionsStub;

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function makeFirestore(seed = {}) {
  const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  const failures = new Map();
  const isDelete = (value) => value?.__op === 'delete';

  function applyWrite(path, value, { merge = false } = {}) {
    const next = merge ? clone(state.get(path) || {}) : {};
    Object.entries(value || {}).forEach(([key, entry]) => {
      if (isDelete(entry)) delete next[key];
      else next[key] = clone(entry);
    });
    state.set(path, next);
  }

  function doc(path) {
    return {
      path,
      id: path.split('/').pop(),
      async get() {
        if (failures.has(path)) throw failures.get(path);
        const value = state.get(path);
        return {
          id: path.split('/').pop(),
          exists: value !== undefined,
          ref: this,
          data: () => clone(value)
        };
      },
      async set(value, options) {
        applyWrite(path, value, options || {});
      },
      async update(value) {
        if (!state.has(path)) throw new Error(`Missing document: ${path}`);
        applyWrite(path, value, { merge: true });
      },
      async delete() {
        state.delete(path);
      },
      collection(name) {
        return collection(`${path}/${name}`);
      }
    };
  }

  function emptyQuery() {
    const query = {
      where() { return query; },
      orderBy() { return query; },
      limit() { return query; },
      startAfter() { return query; },
      async get() { return { docs: [], size: 0, empty: true }; }
    };
    return query;
  }

  function collection(path) {
    return {
      doc(id = 'auto-id') { return doc(`${path}/${id}`); },
      ...emptyQuery()
    };
  }

  function collectionGroup(name, conditions = [], limitCount = Number.POSITIVE_INFINITY) {
    const query = {
      where(field, operator, expected) {
        return collectionGroup(name, [...conditions, { field, operator, expected }], limitCount);
      },
      orderBy() { return query; },
      limit(count) {
        return collectionGroup(name, conditions, Math.max(0, Math.floor(Number(count) || 0)));
      },
      startAfter() { return query; },
      async get() {
        const matches = [...state.entries()]
          .filter(([path]) => path.split('/').at(-2) === name)
          .filter(([, value]) => conditions.every(({ field, operator, expected }) => {
            const actual = value?.[field];
            if (operator === '==') return actual === expected;
            if (operator === 'in') return Array.isArray(expected) && expected.includes(actual);
            if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(expected);
            if (operator === '>=') return actual >= expected;
            if (operator === '<=') return actual <= expected;
            throw new Error(`Unsupported fake query operator: ${operator}`);
          }))
          .slice(0, limitCount)
          .map(([path, value]) => ({
            id: path.split('/').pop(),
            exists: true,
            ref: { path },
            data: () => clone(value)
          }));
        return { docs: matches, size: matches.length, empty: matches.length === 0 };
      }
    };
    return query;
  }

  return {
    doc,
    collection,
    collectionGroup,
    async runTransaction(operation) {
      const writes = [];
      const transaction = {
        get: (ref) => ref.get(),
        set(ref, value, options) { writes.push(() => applyWrite(ref.path, value, options || {})); },
        update(ref, value) { writes.push(() => applyWrite(ref.path, value, { merge: true })); },
        delete(ref) { writes.push(() => state.delete(ref.path)); }
      };
      const result = await operation(transaction);
      writes.forEach((write) => write());
      return result;
    },
    snapshot(path) { return clone(state.get(path)); },
    write(path, value, options = {}) { applyWrite(path, value, options); },
    remove(path) { state.delete(path); },
    fail(path, error = new Error('read failed')) { failures.set(path, error); }
  };
}

function makeFunctionsStub() {
  class HttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  const chain = {
    onCall: (handler) => handler,
    onRequest: (handler) => handler,
    onCreate: (handler) => handler,
    onUpdate: (handler) => handler,
    onWrite: (handler) => handler,
    onDelete: (handler) => handler,
    onRun: (handler) => handler,
    document() { return chain; },
    schedule() { return chain; },
    timeZone() { return chain; },
    user() { return chain; }
  };
  chain.https = chain;
  chain.auth = chain;
  chain.firestore = chain;
  chain.pubsub = chain;
  return {
    config: () => ({ stripe: { secret_key: 'sk_test' } }),
    auth: { user: () => chain },
    https: { HttpsError, onCall: (handler) => handler, onRequest: (handler) => handler },
    firestore: { document: () => chain },
    pubsub: { schedule: () => chain },
    runWith: () => chain,
    logger: { error() {}, warn() {}, info() {} }
  };
}

function readyMigrationControl() {
  return {
    schema: REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
    status: 'ready',
    version: 1,
    attemptId: 'migration:11111111-1111-4111-8111-111111111111'
  };
}

function readyProfileBoundaryControl() {
  return {
    schema: ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA,
    version: 1,
    status: 'ready'
  };
}

function compatibilityReceiptForGame(teamId, gameId, game, overrides = {}) {
  return {
    schema: REPLAY_COMPATIBILITY_SCHEMA,
    version: 1,
    teamId,
    gameId,
    state: 'ready',
    revision: game.replayArchiveRevision || 'r:compatibility',
    lastMutationId: 'compatibility.mutation',
    lastMutationHash: 'a'.repeat(64),
    beforeStateHash: 'b'.repeat(64),
    afterStateHash: getReplayCompatibilityParentFingerprint(game),
    protectedIdentityHashes: ['c'.repeat(64)],
    ...overrides
  };
}

function loadCallables(seed = {}, options = {}) {
  const {
    authUsers = {},
    migrationControl = readyMigrationControl()
  } = options;
  const boundaryControl = Object.prototype.hasOwnProperty.call(options, 'boundaryControl')
    ? options.boundaryControl
    : migrationControl === null ? null : readyProfileBoundaryControl();
  const controlSeed = {
    ...(migrationControl === null ? {} : { [REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH]: migrationControl }),
    ...(boundaryControl === null ? {} : { [ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH]: boundaryControl })
  };
  const firestore = makeFirestore({ ...controlSeed, ...seed });
  adminStub = {
    apps: [true],
    initializeApp() {},
    firestore: Object.assign(() => firestore, {
      FieldValue: {
        serverTimestamp: () => ({ __op: 'serverTimestamp' }),
        delete: () => ({ __op: 'delete' }),
        increment: (amount) => ({ __op: 'increment', amount }),
        arrayUnion: (...items) => ({ __op: 'arrayUnion', items })
      },
      Timestamp: {
        now: () => ({ toMillis: () => Date.now() }),
        fromDate: (date) => date,
        fromMillis: (milliseconds) => ({ toMillis: () => milliseconds })
      },
      FieldPath: { documentId: () => '__name__' }
    }),
    auth: () => ({
      async getUser(uid) {
        if (Object.prototype.hasOwnProperty.call(authUsers, uid)) {
          const configured = authUsers[uid];
          if (!configured) throw Object.assign(new Error('User not found'), { code: 'auth/user-not-found' });
          return { uid, ...configured };
        }
        return { uid, email: `${uid}@example.test`, disabled: false };
      },
      verifyIdToken: async () => null
    }),
    messaging: () => ({}),
    storage: () => ({ bucket: () => ({}) })
  };
  functionsStub = makeFunctionsStub();
  delete require.cache[repoIndexPath];
  const callables = require('../index.js');
  return { callables, firestore };
}

function patchedModuleLoad(request, parent, isMain) {
  if (request === 'firebase-admin' && adminStub) return adminStub;
  if (request === 'firebase-functions' && functionsStub) return functionsStub;
  if (request === 'stripe') {
    return class StripeStub {
      constructor() {
        return { checkout: { sessions: { create: async () => ({}) } }, webhooks: {} };
      }
    };
  }
  return originalModuleLoad(request, parent, isMain);
}

function authContext(uid = 'manager.uid', email = 'manager@example.test') {
  return { auth: { uid, token: { email } } };
}

function readyArchive(revision = 'r:11111111-1111-4111-8111-111111111111') {
  return {
    schemaVersion: 1,
    state: 'ready',
    provider: 'youtube',
    videoId: 'abcdefghijk',
    title: 'Final replay',
    revision,
    lastMutationId: 'migration.1',
    lastMutationHash: 'migration'
  };
}

function makeHttpResponse() {
  const response = {
    headers: {},
    statusCode: null,
    body: null,
    ended: false,
    set(name, value) {
      response.headers[name] = value;
      return response;
    },
    status(code) {
      response.statusCode = code;
      return response;
    },
    json(body) {
      response.body = body;
      return response;
    },
    end() {
      response.ended = true;
      return response;
    }
  };
  return response;
}

test.beforeEach(() => {
  Module._load = patchedModuleLoad;
  adminStub = null;
  functionsStub = null;
});

test.afterEach(() => {
  delete require.cache[repoIndexPath];
  Module._load = originalModuleLoad;
  adminStub = null;
  functionsStub = null;
});

test('reports only authoritative replay cache readiness and never returns a cache epoch early', async () => {
  let loaded = loadCallables({}, { migrationControl: null });
  assert.deepEqual(
    await loaded.callables.getReplayPrivacyMigrationStatus({}, {}),
    { ready: false, cacheEpoch: null }
  );

  loaded = loadCallables();
  assert.deepEqual(
    await loaded.callables.getReplayPrivacyMigrationStatus({}, {}),
    { ready: true, cacheEpoch: 'private-replay-v2' }
  );

  loaded = loadCallables({}, {
    migrationControl: {
      schema: REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
      status: 'migrating',
      version: 1,
      attemptId: 'migration:11111111-1111-4111-8111-111111111111'
    }
  });
  assert.deepEqual(
    await loaded.callables.getReplayPrivacyMigrationStatus({}, {}),
    { ready: false, cacheEpoch: null }
  );
});

test('fails cache readiness closed on malformed or unreadable migration control', async () => {
  let loaded = loadCallables({}, {
    migrationControl: { schema: 'wrong', status: 'ready', version: 1, attemptId: 'bad' }
  });
  await assert.rejects(
    loaded.callables.getReplayPrivacyMigrationStatus({}, {}),
    (error) => error.code === 'unavailable'
  );

  loaded = loadCallables();
  loaded.firestore.fail(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH);
  await assert.rejects(
    loaded.callables.getReplayPrivacyMigrationStatus({}, {}),
    (error) => error.code === 'unavailable'
  );
});

test('manager set is atomic, scrubs readable replay identity, and replays one mutation idempotently', async () => {
  const { callables, firestore } = loadCallables({
    'teams/team.alpha:1': { ownerId: 'manager.uid', name: 'Bears' },
    'users/manager.uid': {},
    'teams/team.alpha:1/games/game-1': {
      type: 'game',
      status: 'completed',
      liveStatus: 'final',
      opponent: 'Tigers',
      highlightClips: [
        { id: 'matching-replay', url: 'https://youtu.be/abcdefghijk', note: 'Keep metadata' },
        { id: 'standalone', url: 'https://cdn.example.test/highlight.mp4' }
      ]
    }
  });
  const request = {
    action: 'set',
    teamId: 'team.alpha:1',
    gameId: 'game-1',
    expectedRevision: null,
    mutationId: 'client.mutation:1',
    youtubeUrl: 'https://youtu.be/abcdefghijk',
    title: 'Final replay'
  };
  const first = await callables.manageGameReplayArchive(request, authContext());
  assert.equal(first.state, 'ready');
  assert.equal(first.lastMutationId, request.mutationId);
  assert.equal(first.replayVideo.publicUrl, 'https://www.youtube.com/watch?v=abcdefghijk');

  const game = firestore.snapshot('teams/team.alpha:1/games/game-1');
  assert.equal(game.hasRecordedReplay, true);
  assert.equal(game.replayArchiveRevision, first.replayArchiveRevision);
  assert.equal('replayVideoUrl' in game, false);
  assert.equal('replayVideoTitle' in game, false);
  assert.equal('videoUrl' in game, false);
  assert.deepEqual(game.highlightClips, [
    { id: 'matching-replay', note: 'Keep metadata' },
    { id: 'standalone', url: 'https://cdn.example.test/highlight.mp4' }
  ]);
  const stored = firestore.snapshot('teams/team.alpha:1/games/game-1/privateReplay/archive');
  assert.equal(stored.videoId, 'abcdefghijk');
  assert.equal(stored.lastMutationId, request.mutationId);
  const protectedIdentity = getReplayProtectedYouTubeIdentityRecord('abcdefghijk');
  assert.deepEqual(
    firestore.snapshot(protectedIdentity.path),
    {
      ...protectedIdentity.data,
      updatedAt: { __op: 'serverTimestamp' }
    }
  );

  const retry = await callables.manageGameReplayArchive(request, authContext());
  assert.equal(retry.replayArchiveRevision, first.replayArchiveRevision);
  await assert.rejects(
    callables.manageGameReplayArchive({ ...request, youtubeUrl: 'https://youtu.be/lmnopqrstuv' }, authContext()),
    (error) => error.code === 'already-exists'
  );
});

test('replay set rejects an ID reserved by an existing standalone clip', async () => {
  const path = 'teams/team-1/games/game-1';
  const clipIdentity = getReplayClipYouTubeIdentityRecord('abcdefghijk');
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [path]: { type: 'game', status: 'completed' },
    [clipIdentity.path]: clipIdentity.data
  });
  await assert.rejects(callables.manageGameReplayArchive({
    action: 'set',
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: null,
    mutationId: 'set.excluded',
    youtubeUrl: 'https://youtu.be/abcdefghijk'
  }, authContext()), (error) => error.code === 'failed-precondition'
    && /standalone clip/.test(error.message));
  assert.equal(firestore.snapshot(`${path}/privateReplay/archive`), undefined);
  assert.equal(firestore.snapshot(path).hasRecordedReplay, undefined);
});

test('replay set rejects a current team or game structured stream identity', async () => {
  const path = 'teams/team-1/games/game-1';
  for (const [teamPatch, gamePatch] of [
    [{ youtubeEmbedUrl: 'https://www.youtube.com/embed/abcdefghijk' }, {}],
    [{}, {
      broadcastSession: {
        provider: {
          type: 'youtube',
          name: 'YouTube',
          videoId: 'abcdefghijk'
        }
      }
    }]
  ]) {
    const { callables, firestore } = loadCallables({
      'teams/team-1': { ownerId: 'manager.uid', ...teamPatch },
      'users/manager.uid': {},
      [path]: { type: 'game', status: 'completed', ...gamePatch }
    });
    await assert.rejects(callables.manageGameReplayArchive({
      action: 'set',
      teamId: 'team-1',
      gameId: 'game-1',
      expectedRevision: null,
      mutationId: 'set.structured-stream',
      youtubeUrl: 'https://youtu.be/abcdefghijk'
    }, authContext()), (error) => error.code === 'failed-precondition'
      && /already published through the team or game stream/.test(error.message));
    assert.equal(firestore.snapshot(`${path}/privateReplay/archive`), undefined);
  }
});

test('server highlight writer preserves or removes existing YouTube clips without permitting reintroduction', async () => {
  const path = 'teams/team-1/games/game-1';
  const clipIdentity = getReplayClipYouTubeIdentityRecord('abcdefghijk');
  const existingYouTube = {
    id: 'legacy-youtube',
    downloadUrl: 'https://youtu.be/abcdefghijk?t=4',
    video: { sourceUrl: 'https://www.youtube.com/embed/abcdefghijk' }
  };
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [path]: {
      type: 'game',
      status: 'completed',
      highlightClips: [existingYouTube]
    },
    [clipIdentity.path]: clipIdentity.data
  });
  const appended = { title: 'Fourth quarter', startMs: 1_000, endMs: 5_000 };
  const saved = await callables.saveGameHighlightClips({
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: null,
    mutationId: 'clips.append.1',
    highlightClips: [existingYouTube, appended]
  }, authContext());
  assert.deepEqual(saved.highlightClips, [existingYouTube, appended]);
  assert.equal(saved.lastMutationId, 'clips.append.1');
  assert.deepEqual(firestore.snapshot(path).highlightClips, [existingYouTube, appended]);

  const retry = await callables.saveGameHighlightClips({
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: null,
    mutationId: 'clips.append.1',
    highlightClips: [existingYouTube, appended]
  }, authContext());
  assert.equal(retry.highlightClipsRevision, saved.highlightClipsRevision);

  await assert.rejects(callables.saveGameHighlightClips({
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: saved.highlightClipsRevision,
    mutationId: 'clips.modify-youtube',
    highlightClips: [{ ...existingYouTube, downloadUrl: 'https://youtu.be/lmnopqrstuv' }, appended]
  }, authContext()), (error) => error.code === 'failed-precondition');

  const removed = await callables.saveGameHighlightClips({
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: saved.highlightClipsRevision,
    mutationId: 'clips.remove-youtube',
    highlightClips: [appended]
  }, authContext());
  assert.deepEqual(removed.highlightClips, [appended]);
  assert.deepEqual(firestore.snapshot(clipIdentity.path), clipIdentity.data);
  await assert.rejects(callables.saveGameHighlightClips({
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: removed.highlightClipsRevision,
    mutationId: 'clips.reintroduce-youtube',
    highlightClips: [existingYouTube, appended]
  }, authContext()), (error) => error.code === 'failed-precondition');
  await assert.rejects(callables.saveGameHighlightClips({
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: null,
    mutationId: 'clips.stale',
    highlightClips: [appended, { title: 'Late' }]
  }, authContext()), (error) => error.code === 'aborted');
});

test('server highlight writer enforces selected videographer access and rejects a new nested YouTube alias', async () => {
  const seed = {
    'teams/team-1': {
      ownerId: 'owner.uid',
      teamPermissions: { videography: { mode: 'selected', memberIds: ['video.uid'] } }
    },
    'users/video.uid': {},
    'users/parent.uid': { parentTeamIds: ['team-1'] },
    'teams/team-1/games/game-1': { type: 'game', status: 'completed' }
  };
  let loaded = loadCallables(seed);
  await assert.rejects(loaded.callables.saveGameHighlightClips({
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: null,
    mutationId: 'clips.youtube',
    highlightClips: [{ video: { publicUrl: 'https://youtu.be/abcdefghijk' } }]
  }, authContext('video.uid', 'video@example.test')), (error) => error.code === 'failed-precondition');

  loaded = loadCallables(seed);
  await assert.rejects(loaded.callables.saveGameHighlightClips({
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: null,
    mutationId: 'clips.parent',
    highlightClips: [{ mediaUrl: 'https://cdn.example.test/clip.mp4' }]
  }, authContext('parent.uid', 'parent@example.test')), (error) => error.code === 'permission-denied');
});

test('server highlight writer rejects a protected exact URL while allowing an unrelated CDN clip', async () => {
  const path = 'teams/team-1/games/game-1';
  const protectedUrl = 'https://private.example/replay.mp4?token=secret';
  const protectedIdentity = getReplayProtectedUrlIdentityRecord(protectedUrl);
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [path]: { type: 'game', status: 'completed' },
    [REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH]: readyMigrationControl(),
    [protectedIdentity.path]: protectedIdentity.data
  });

  await assert.rejects(callables.saveGameHighlightClips({
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: null,
    mutationId: 'clips.protected-url',
    highlightClips: [{ asset: { downloadUrl: `${protectedUrl}#watch` } }]
  }, authContext()), (error) => error.code === 'failed-precondition'
    && /protected replay media/.test(error.message));

  const saved = await callables.saveGameHighlightClips({
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: null,
    mutationId: 'clips.unrelated-url',
    highlightClips: [{ mediaUrl: 'https://cdn.example.test/highlight.mp4' }]
  }, authContext());
  assert.equal(saved.highlightClips[0].mediaUrl, 'https://cdn.example.test/highlight.mp4');
  assert.equal(firestore.snapshot(path).highlightClips[0].mediaUrl, 'https://cdn.example.test/highlight.mp4');
});

test('highlight writes work before the migration gate exists and freeze once migration begins', async () => {
  const path = 'teams/team-1/games/game-1';
  const seed = {
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [path]: { type: 'game', status: 'completed' }
  };
  let loaded = loadCallables(seed, { migrationControl: null });
  const saved = await loaded.callables.saveGameHighlightClips({
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: null,
    mutationId: 'clips.compatibility',
    highlightClips: [{ mediaUrl: 'https://cdn.example.test/highlight.mp4' }]
  }, authContext());
  assert.equal(saved.highlightClips[0].mediaUrl, 'https://cdn.example.test/highlight.mp4');

  loaded = loadCallables(seed, {
    migrationControl: { ...readyMigrationControl(), status: 'migrating' }
  });
  await assert.rejects(loaded.callables.saveGameHighlightClips({
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: null,
    mutationId: 'clips.migrating',
    highlightClips: []
  }, authContext()), (error) => error.code === 'failed-precondition');
});

test('management writes only across exact compatibility or finalized controls', async () => {
  const revision = 'r:11111111-1111-4111-8111-111111111111';
  const path = 'teams/team-1/games/game-1';
  const seed = {
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [path]: {
      type: 'game',
      status: 'completed',
      hasRecordedReplay: true,
      replayArchiveRevision: revision
    },
    [`${path}/privateReplay/archive`]: readyArchive(revision)
  };
  const controls = [
    ['migrating', { ...readyMigrationControl(), status: 'migrating' }],
    ['malformed', { ...readyMigrationControl(), version: 2 }]
  ];
  for (const [label, migrationControl] of controls) {
    const loaded = loadCallables(seed, { migrationControl });
    const read = await loaded.callables.manageGameReplayArchive(
      { action: 'read', teamId: 'team-1', gameId: 'game-1' },
      authContext()
    );
    assert.equal(read.state, 'ready', `${label} gate should not block a management read`);
    await assert.rejects(
      loaded.callables.manageGameReplayArchive({
        action: 'set',
        teamId: 'team-1',
        gameId: 'game-1',
        expectedRevision: revision,
        mutationId: `set.${label}`,
        youtubeUrl: 'https://youtu.be/lmnopqrstuv'
      }, authContext()),
      (error) => error.code === 'failed-precondition'
    );
    await assert.rejects(
      loaded.callables.manageGameReplayArchive({
        action: 'remove',
        teamId: 'team-1',
        gameId: 'game-1',
        expectedRevision: revision,
        mutationId: `remove.${label}`
      }, authContext()),
      (error) => error.code === 'failed-precondition'
    );
  }

  const compatibilityPath = 'teams/team-1/games/compatibility';
  const compatibility = loadCallables({
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [compatibilityPath]: {
      type: 'game',
      status: 'completed',
      replayVideoUrl: 'https://youtu.be/abcdefghijk'
    }
  }, { migrationControl: null });
  const before = await compatibility.callables.manageGameReplayArchive({
    action: 'read', teamId: 'team-1', gameId: 'compatibility'
  }, authContext());
  assert.equal(before.state, 'ready');
  assert.match(before.replayArchiveRevision, /^legacy:/);
  const compatibilityRequest = {
    action: 'set',
    teamId: 'team-1',
    gameId: 'compatibility',
    expectedRevision: before.replayArchiveRevision,
    mutationId: 'set.compatibility',
    youtubeUrl: 'https://youtu.be/lmnopqrstuv'
  };
  await assert.rejects(
    compatibility.callables.manageGameReplayArchive(compatibilityRequest, authContext()),
    (error) => error.code === 'failed-precondition'
      && error.details?.reason === 'private-replay-migration-pending'
  );
  const compatibilityGame = compatibility.firestore.snapshot(compatibilityPath);
  assert.equal(compatibilityGame.replayVideoUrl, 'https://youtu.be/abcdefghijk');
  assert.equal(compatibilityGame.hasRecordedReplay, undefined);
  assert.equal(compatibilityGame.replayArchiveRevision, undefined);
  assert.equal(compatibility.firestore.snapshot(`${compatibilityPath}/privateReplay/archive`), undefined);
  assert.equal(
    compatibility.firestore.snapshot(getReplayCompatibilityReceiptPath(compatibilityPath)),
    undefined
  );
  assert.equal(
    compatibility.firestore.snapshot(getReplayProtectedYouTubeIdentityRecord('lmnopqrstuv').path),
    undefined
  );

  const ready = loadCallables(seed);
  const result = await ready.callables.manageGameReplayArchive({
    action: 'set',
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: revision,
    mutationId: 'set.ready',
    youtubeUrl: 'https://youtu.be/lmnopqrstuv'
  }, authContext());
  assert.equal(result.state, 'ready');
  assert.deepEqual(
    ready.firestore.snapshot(getReplayProtectedYouTubeIdentityRecord('lmnopqrstuv').path),
    {
      ...getReplayProtectedYouTubeIdentityRecord('lmnopqrstuv').data,
      updatedAt: { __op: 'serverTimestamp' }
    }
  );

  for (const [label, migrationControl, boundaryControl] of [
    ['missing replay control after finalization', null, readyProfileBoundaryControl()],
    ['missing profile boundary after finalization', readyMigrationControl(), null],
    ['malformed profile boundary', readyMigrationControl(), { status: 'ready' }]
  ]) {
    const mixed = loadCallables({
      'teams/team-1': { ownerId: 'manager.uid' },
      'users/manager.uid': {},
      'teams/team-1/games/mixed': { type: 'game', status: 'completed' }
    }, { migrationControl, boundaryControl });
    await assert.rejects(mixed.callables.manageGameReplayArchive({
      action: 'set',
      teamId: 'team-1',
      gameId: 'mixed',
      expectedRevision: null,
      mutationId: `mixed.${label.replace(/\s+/g, '-')}`,
      youtubeUrl: 'https://youtu.be/lmnopqrstuv'
    }, authContext()), (error) => error.code === 'failed-precondition');
  }
});

test('compatibility reads and playback are read-only while mutations wait for migration', async () => {
  const path = 'teams/team-1/games/game-1';
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [path]: {
      type: 'game',
      status: 'completed',
      replayVideoUrl: 'https://youtu.be/abcdefghijk',
      replayVideoTitle: 'Legacy final',
      videoUrl: 'https://youtu.be/abcdefghijk',
      highlightClips: [{ id: 'full-copy', url: 'https://youtu.be/abcdefghijk', note: 'keep' }]
    }
  }, { migrationControl: null });

  const promoted = await callables.manageGameReplayArchive({
    action: 'read', teamId: 'team-1', gameId: 'game-1'
  }, authContext());
  assert.equal(promoted.state, 'ready');
  assert.equal(promoted.replayVideo.videoId, 'abcdefghijk');
  assert.match(promoted.replayArchiveRevision, /^legacy:/);
  assert.deepEqual(firestore.snapshot(path), {
    type: 'game',
    status: 'completed',
    replayVideoUrl: 'https://youtu.be/abcdefghijk',
    replayVideoTitle: 'Legacy final',
    videoUrl: 'https://youtu.be/abcdefghijk',
    highlightClips: [{ id: 'full-copy', url: 'https://youtu.be/abcdefghijk', note: 'keep' }]
  });
  assert.equal(firestore.snapshot(`${path}/privateReplay/archive`), undefined);
  assert.equal(firestore.snapshot(getReplayCompatibilityReceiptPath(path)), undefined);
  assert.equal(
    firestore.snapshot(getReplayProtectedYouTubeIdentityRecord('abcdefghijk').path),
    undefined
  );

  const playback = await callables.getGameReplayPlayback({
    teamId: 'team-1', gameId: 'game-1'
  }, authContext());
  assert.equal(playback.state, 'ready');
  assert.equal(playback.available, true);
  assert.equal(playback.replayArchiveRevision, promoted.replayArchiveRevision);
  assert.equal(playback.replayVideo.videoId, 'abcdefghijk');
  assert.equal(firestore.snapshot(`${path}/privateReplay/archive`), undefined);

  await assert.rejects(callables.manageGameReplayArchive({
    action: 'remove', teamId: 'team-1', gameId: 'game-1',
    expectedRevision: promoted.replayArchiveRevision, mutationId: 'remove.promoted'
  }, authContext()), (error) => error.code === 'failed-precondition'
    && error.details?.reason === 'private-replay-migration-pending');
  const game = firestore.snapshot(path);
  assert.equal(game.hasRecordedReplay, undefined);
  assert.equal(game.replayArchiveRevision, undefined);
  assert.equal(game.replayVideoFallbackDisabled, undefined);
  assert.equal(game.replayVideoUrl, 'https://youtu.be/abcdefghijk');
  assert.equal(game.replayVideoTitle, 'Legacy final');
  assert.equal(game.videoUrl, 'https://youtu.be/abcdefghijk');
  assert.deepEqual(game.highlightClips, [
    { id: 'full-copy', url: 'https://youtu.be/abcdefghijk', note: 'keep' }
  ]);
  assert.equal(firestore.snapshot(`${path}/privateReplay/archive`), undefined);
  assert.equal((await callables.manageGameReplayArchive({
    action: 'read', teamId: 'team-1', gameId: 'game-1'
  }, authContext())).state, 'ready');
});

test('compatibility reads preserve raw removals, reject malformed evidence, and never reopen after finalization', async () => {
  const path = 'teams/team-1/games/game-1';
  let loaded = loadCallables({
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [path]: { type: 'game', status: 'completed', replayVideoFallbackDisabled: true }
  }, { migrationControl: null });
  const removed = await loaded.callables.manageGameReplayArchive({
    action: 'read', teamId: 'team-1', gameId: 'game-1'
  }, authContext());
  assert.equal(removed.state, 'removed');
  assert.equal(loaded.firestore.snapshot(path).replayVideoFallbackDisabled, true);
  assert.equal(loaded.firestore.snapshot(getReplayCompatibilityReceiptPath(path)), undefined);

  loaded = loadCallables({
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [path]: {
      type: 'game', status: 'completed', replayStatus: 'processing',
      replayVideoUrl: 'https://youtu.be/abcdefghijk'
    }
  }, { migrationControl: null });
  await assert.rejects(loaded.callables.manageGameReplayArchive({
    action: 'read', teamId: 'team-1', gameId: 'game-1'
  }, authContext()), (error) => error.code === 'failed-precondition');
  assert.equal(loaded.firestore.snapshot(`${path}/privateReplay/archive`), undefined);
  assert.equal(loaded.firestore.snapshot(path).replayVideoUrl, 'https://youtu.be/abcdefghijk');

  const clipIdentity = getReplayClipYouTubeIdentityRecord('abcdefghijk');
  loaded = loadCallables({
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [path]: { type: 'game', status: 'completed', replayVideoUrl: 'https://youtu.be/abcdefghijk' },
    [clipIdentity.path]: clipIdentity.data
  }, { migrationControl: null });
  const readableConflict = await loaded.callables.manageGameReplayArchive({
    action: 'read', teamId: 'team-1', gameId: 'game-1'
  }, authContext());
  assert.equal(readableConflict.state, 'ready');
  assert.equal(loaded.firestore.snapshot(`${path}/privateReplay/archive`), undefined);

  loaded = loadCallables({
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [path]: { type: 'game', status: 'completed', replayVideoUrl: 'https://youtu.be/abcdefghijk' }
  }, { migrationControl: null, boundaryControl: readyProfileBoundaryControl() });
  await assert.rejects(loaded.callables.manageGameReplayArchive({
    action: 'read', teamId: 'team-1', gameId: 'game-1'
  }, authContext()), (error) => error.code === 'failed-precondition');
});

test('compatibility reads recognize historical aliases while blocked mutations preserve raw state', async () => {
  for (const status of ['complete', 'finished']) {
    const gameId = `historical-${status}`;
    const path = `teams/team-1/games/${gameId}`;
    const loaded = loadCallables({
      'teams/team-1': { ownerId: 'manager.uid' },
      'users/manager.uid': {},
      [path]: {
        type: 'game',
        status,
        liveStatus: 'scheduled',
        videoUrl: 'https://youtu.be/abcdefghijk'
      }
    }, { migrationControl: null });
    const current = await loaded.callables.manageGameReplayArchive({
      action: 'read', teamId: 'team-1', gameId
    }, authContext());
    assert.equal(current.state, 'ready', status);
    await assert.rejects(loaded.callables.manageGameReplayArchive({
      action: 'remove',
      teamId: 'team-1',
      gameId,
      expectedRevision: current.replayArchiveRevision,
      mutationId: `remove.${status}`
    }, authContext()), (error) => error.code === 'failed-precondition');
    assert.equal(loaded.firestore.snapshot(path).videoUrl, 'https://youtu.be/abcdefghijk', status);
  }

  const activePath = 'teams/team-1/games/active';
  const active = loadCallables({
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [activePath]: {
      type: 'game',
      status: 'scheduled',
      liveStatus: 'live',
      videoUrl: 'https://live.example.test/feed',
      replayVideoUrl: 'https://youtu.be/abcdefghijk'
    }
  }, { migrationControl: null });
  const current = await active.callables.manageGameReplayArchive({
    action: 'read', teamId: 'team-1', gameId: 'active'
  }, authContext());
  await assert.rejects(active.callables.manageGameReplayArchive({
    action: 'remove',
    teamId: 'team-1',
    gameId: 'active',
    expectedRevision: current.replayArchiveRevision,
    mutationId: 'remove.active'
  }, authContext()), (error) => error.code === 'failed-precondition');
  assert.equal(active.firestore.snapshot(activePath).videoUrl, 'https://live.example.test/feed');
});

test('management requires full or selected-videographer access and rejects shared/all-confirmed targets', async () => {
  const seed = {
    'teams/team-1': {
      ownerId: 'owner',
      teamPermissions: { videography: { mode: 'selected', memberIds: ['selected.user'] } }
    },
    'teams/team-1/games/game-1': { type: 'game', status: 'completed' },
    'users/selected.user': {},
    'users/parent.user': { parentTeamIds: ['team-1'] }
  };
  let loaded = loadCallables(seed);
  const selectedRead = await loaded.callables.manageGameReplayArchive(
    { action: 'read', teamId: 'team-1', gameId: 'game-1' },
    authContext('selected.user', 'selected@example.test')
  );
  assert.equal(selectedRead.state, 'none');
  await assert.rejects(
    loaded.callables.manageGameReplayArchive(
      { action: 'read', teamId: 'team-1', gameId: 'game-1' },
      authContext('parent.user', 'parent@example.test')
    ),
    (error) => error.code === 'permission-denied'
  );

  loaded = loadCallables({
    ...seed,
    'teams/team-1': {
      ownerId: 'owner',
      teamPermissions: { videography: { mode: 'all_confirmed', memberIds: ['selected.user'] } }
    }
  });
  await assert.rejects(
    loaded.callables.manageGameReplayArchive(
      { action: 'read', teamId: 'team-1', gameId: 'game-1' },
      authContext('selected.user', 'selected@example.test')
    ),
    (error) => error.code === 'permission-denied'
  );

  loaded = loadCallables({
    ...seed,
    'teams/team-1/games/game-1': { type: 'game', status: 'completed', sharedGameId: 'shared-1' }
  });
  await assert.rejects(
    loaded.callables.manageGameReplayArchive(
      { action: 'read', teamId: 'team-1', gameId: 'game-1' },
      authContext('selected.user', 'selected@example.test')
    ),
    (error) => error.code === 'failed-precondition'
  );
});

test('disabled, deleted, and stale-email Auth identities cannot manage or release a replay', async () => {
  const revision = 'r:11111111-1111-4111-8111-111111111111';
  const seed = {
    'teams/team-1': { ownerId: 'blocked.user', isPublic: true, active: true },
    'users/blocked.user': {},
    'users/deleted.user': {},
    'teams/team-1/games/game-1': {
      type: 'game', status: 'completed', visibility: 'public',
      hasRecordedReplay: true, replayArchiveRevision: revision
    },
    'teams/team-1/games/game-1/privateReplay/archive': readyArchive(revision)
  };
  let loaded = loadCallables(seed, {
    authUsers: { 'blocked.user': { email: 'blocked@example.test', disabled: true } }
  });
  await assert.rejects(
    loaded.callables.manageGameReplayArchive(
      { action: 'read', teamId: 'team-1', gameId: 'game-1' },
      authContext('blocked.user', 'blocked@example.test')
    ),
    (error) => error.code === 'permission-denied'
  );
  await assert.rejects(
    loaded.callables.getGameReplayPlayback(
      { teamId: 'team-1', gameId: 'game-1' },
      authContext('blocked.user', 'blocked@example.test')
    ),
    (error) => error.code === 'permission-denied'
  );

  loaded = loadCallables(seed, { authUsers: { 'deleted.user': null } });
  await assert.rejects(
    loaded.callables.getGameReplayPlayback(
      { teamId: 'team-1', gameId: 'game-1' },
      authContext('deleted.user', 'old@example.test')
    ),
    (error) => error.code === 'unauthenticated'
  );

  loaded = loadCallables({
    ...seed,
    'teams/team-1': { adminEmails: ['old@example.test'], isPublic: false },
    'users/changed.user': {}
  }, { authUsers: { 'changed.user': { email: 'new@example.test', disabled: false } } });
  await assert.rejects(
    loaded.callables.manageGameReplayArchive(
      { action: 'read', teamId: 'team-1', gameId: 'game-1' },
      authContext('changed.user', 'old@example.test')
    ),
    (error) => error.code === 'permission-denied'
  );
});

test('malformed canonical owner IDs cannot authorize replay management or playback through stale email aliases', async () => {
  for (const [label, ownerId] of [
    ['overlength', `${'manager.uid'}${'x'.repeat(130)}`],
    ['padded', ' manager.uid '],
    ['object', { uid: 'manager.uid' }]
  ]) {
    const path = `teams/team-1/games/${label}`;
    const loaded = loadCallables({
      'teams/team-1': {
        ownerId,
        ownerEmail: 'manager@example.test',
        ownerEmailLower: 'manager@example.test',
        isPublic: false
      },
      'users/manager.uid': {},
      [path]: {
        type: 'game', status: 'completed', replayVideoUrl: 'https://youtu.be/abcdefghijk'
      }
    }, { migrationControl: null });
    await assert.rejects(loaded.callables.manageGameReplayArchive({
      action: 'read', teamId: 'team-1', gameId: label
    }, authContext()), (error) => error.code === 'permission-denied');
    await assert.rejects(loaded.callables.manageGameReplayArchive({
      action: 'set',
      teamId: 'team-1',
      gameId: label,
      expectedRevision: null,
      mutationId: `set.${label}`,
      youtubeUrl: 'https://youtu.be/lmnopqrstuv'
    }, authContext()), (error) => error.code === 'permission-denied');
    await assert.rejects(loaded.callables.getGameReplayPlayback({
      teamId: 'team-1', gameId: label
    }, authContext()), (error) => error.code === 'permission-denied');
  }
});

test('full-manager nonfinal removal writes a durable tombstone while preserving the active videoUrl', async () => {
  const revision = 'r:11111111-1111-4111-8111-111111111111';
  const path = 'teams/team-1/games/game-1';
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'manager.uid' },
    'users/manager.uid': {},
    [path]: {
      type: 'game',
      status: 'scheduled',
      videoUrl: 'https://live.example.test/feed',
      replayVideoUrl: 'https://youtu.be/abcdefghijk',
      hasRecordedReplay: true,
      replayArchiveRevision: revision
    },
    [`${path}/privateReplay/archive`]: readyArchive(revision)
  });
  const result = await callables.manageGameReplayArchive({
    action: 'remove',
    teamId: 'team-1',
    gameId: 'game-1',
    expectedRevision: revision,
    mutationId: 'remove.1'
  }, authContext());
  assert.equal(result.state, 'removed');
  const game = firestore.snapshot(path);
  assert.equal(game.videoUrl, 'https://live.example.test/feed');
  assert.equal('replayVideoUrl' in game, false);
  assert.equal(game.hasRecordedReplay, false);
  const archive = firestore.snapshot(`${path}/privateReplay/archive`);
  assert.equal(archive.state, 'removed');
  assert.equal('videoId' in archive, false);
});

test('playback releases the private URL only across public/global or exact Team Pass boundaries', async () => {
  const revision = 'r:11111111-1111-4111-8111-111111111111';
  const path = 'teams/team-1/games/game-1';
  const baseSeed = {
    'teams/team-1': {
      ownerId: 'owner',
      isPublic: true,
      active: true,
      currentSeasonId: 'fall-26',
      recordedReplayPaywallEnabled: true
    },
    [path]: {
      type: 'game',
      status: 'completed',
      visibility: 'public',
      hasRecordedReplay: true,
      replayArchiveRevision: revision
    },
    [`${path}/privateReplay/archive`]: readyArchive(revision),
    'platformConfig/premium': { openToAll: false },
    'users/parent.user': { parentTeamIds: ['team-1'] }
  };
  let loaded = loadCallables(baseSeed);
  const anonymous = await loaded.callables.getGameReplayPlayback({ teamId: 'team-1', gameId: 'game-1' }, {});
  assert.equal(anonymous.available, false);
  assert.equal(anonymous.reason, 'team-pass-required');
  assert.equal(JSON.stringify(anonymous).includes('abcdefghijk'), false);

  const lockedParent = await loaded.callables.getGameReplayPlayback(
    { teamId: 'team-1', gameId: 'game-1', seasonId: 'fall-26' },
    authContext('parent.user', 'parent@example.test')
  );
  assert.equal(lockedParent.available, false);

  loaded = loadCallables({
    ...baseSeed,
    'teams/team-1/entitlements/fall-26_team-pass': {
      teamId: 'team-1', seasonId: 'fall-26', tier: 'team-pass', status: 'active'
    }
  });
  const unlocked = await loaded.callables.getGameReplayPlayback(
    { teamId: 'team-1', gameId: 'game-1', seasonId: 'fall-26' },
    authContext('parent.user', 'parent@example.test')
  );
  assert.equal(unlocked.available, true);
  assert.equal(unlocked.replayVideo.publicUrl, 'https://www.youtube.com/watch?v=abcdefghijk');

  loaded = loadCallables({ ...baseSeed, 'platformConfig/premium': { openToAll: true } });
  const globallyOpen = await loaded.callables.getGameReplayPlayback({ teamId: 'team-1', gameId: 'game-1' }, {});
  assert.equal(globallyOpen.available, true);
  assert.equal(globallyOpen.reason, 'global-open');
});

test('private playback preserves exact server-only complete and finished compatibility aliases', async () => {
  const revision = 'r:11111111-1111-4111-8111-111111111111';
  for (const status of ['complete', 'finished']) {
    const path = `teams/team-1/games/${status}`;
    const { callables } = loadCallables({
      'teams/team-1': { isPublic: true, active: true, recordedReplayPaywallEnabled: false },
      [path]: {
        type: 'game',
        date: '2026-08-01T18:00:00Z',
        status,
        liveStatus: 'scheduled',
        visibility: 'public',
        hasRecordedReplay: true,
        replayArchiveRevision: revision
      },
      [`${path}/privateReplay/archive`]: readyArchive(revision)
    });
    const result = await callables.getGameReplayPlayback({ teamId: 'team-1', gameId: status }, {});
    assert.equal(result.available, true);
    assert.equal(result.replayVideo.videoId, 'abcdefghijk');
    const projection = await callables.getPublicGameProjection({ teamId: 'team-1', gameId: status }, {});
    assert.equal(projection.item.hasRecordedReplay, true);
    assert.equal(JSON.stringify(projection).includes('abcdefghijk'), false);
  }
});

test('public exact projection returns a verified marker while playback remains the only URL-release boundary', async () => {
  const revision = 'r:11111111-1111-4111-8111-111111111111';
  const path = 'teams/team-1/games/game-1';
  const { callables } = loadCallables({
    'teams/team-1': { isPublic: true, active: true, name: 'Bears' },
    [path]: {
      type: 'game',
      date: '2026-08-01T18:00:00Z',
      status: 'completed',
      visibility: 'public',
      opponent: 'Tigers',
      hasRecordedReplay: true,
      replayArchiveRevision: revision,
      replayVideoUrl: 'https://youtu.be/SENTINEL01'
    },
    [`${path}/privateReplay/archive`]: readyArchive(revision)
  });
  const projection = await callables.getPublicGameProjection({ teamId: 'team-1', gameId: 'game-1' }, {});
  assert.equal(projection.item.hasRecordedReplay, true);
  assert.equal(projection.item.videoUrl, null);
  assert.equal(JSON.stringify(projection).includes('abcdefghijk'), false);
  assert.equal(JSON.stringify(projection).includes('SENTINEL01'), false);

  const playback = await callables.getGameReplayPlayback({ teamId: 'team-1', gameId: 'game-1' }, {});
  assert.equal(playback.available, true);
  assert.equal(playback.replayVideo.videoId, 'abcdefghijk');
});

test('pre-gate public projections derive URL-free replay markers from raw or receipt-backed state', async () => {
  for (const mode of ['raw', 'receipt']) {
    const gameId = `compat-${mode}`;
    const path = `teams/team-1/games/${gameId}`;
    const game = {
      type: 'game',
      date: '2026-08-01T18:00:00Z',
      status: 'completed',
      visibility: 'public',
      opponent: 'Tigers',
      replayVideo: {
        provider: 'youtube',
        videoId: 'abcdefghijk',
        publicUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
        status: 'ready'
      },
      ...(mode === 'receipt'
        ? { hasRecordedReplay: true, replayArchiveRevision: 'r:compatibility' }
        : {})
    };
    const seed = {
      'teams/team-1': { isPublic: true, active: true, name: 'Bears' },
      [path]: game
    };
    if (mode === 'receipt') {
      seed[getReplayCompatibilityReceiptPath(path)] = compatibilityReceiptForGame(
        'team-1',
        gameId,
        game
      );
    }
    const { callables } = loadCallables(seed, { migrationControl: null });

    const projection = await callables.getPublicGameProjection({ teamId: 'team-1', gameId }, {});
    assert.equal(projection.item.hasRecordedReplay, true, mode);
    assert.equal(projection.item.videoUrl, null, mode);
    assert.equal(JSON.stringify(projection).includes('abcdefghijk'), false, mode);
  }
});

test('public exact projection uses trusted path provenance to suppress automated active copies before migration', async () => {
  for (const [label, markerPatch, videoUrl] of [
    ['public marker', { isPublicProjection: true, sharedScheduleSourceTeamId: 'source-team' }, 'https://youtu.be/abcdefghijk'],
    ['forged shared marker', {
      isSharedGame: true,
      _sharedGamePath: 'organizations/org-1/sharedGames/shared-1'
    }, 'https://private.example/replay.mp4?token=secret']
  ]) {
    const path = `teams/team-1/games/${label.replace(/\s+/g, '-')}`;
    const { callables } = loadCallables({
      'teams/team-1': { isPublic: true, active: true, name: 'Bears' },
      [path]: {
        type: 'game',
        date: '2026-08-01T18:00:00Z',
        status: 'scheduled',
        liveStatus: 'live',
        visibility: 'public',
        opponent: 'Tigers',
        ...markerPatch,
        videoUrl
      }
    });

    const projection = await callables.getPublicGameProjection({
      teamId: 'team-1',
      gameId: path.split('/').pop()
    }, {});
    assert.equal(projection.item.videoUrl, null, label);
    assert.equal(JSON.stringify(projection).includes(videoUrl), false, label);
  }

  const canonicalPath = 'teams/team-1/games/canonical-live';
  const { callables } = loadCallables({
    'teams/team-1': { isPublic: true, active: true, name: 'Bears' },
    [canonicalPath]: {
      type: 'game',
      date: '2026-08-01T18:00:00Z',
      status: 'scheduled',
      liveStatus: 'live',
      visibility: 'public',
      opponent: 'Tigers',
      videoUrl: 'https://youtu.be/lmnopqrstuv'
    }
  });
  const canonical = await callables.getPublicGameProjection({
    teamId: 'team-1',
    gameId: 'canonical-live'
  }, {});
  assert.equal(canonical.item.videoUrl, 'https://youtu.be/lmnopqrstuv');
});

test('public exact projection fails closed when a replay marker lacks one exact valid private archive', async () => {
  const revision = 'r:11111111-1111-4111-8111-111111111111';
  const path = 'teams/team-1/games/game-1';
  const cases = [
    ['missing', undefined, 'completed'],
    ['invalid', { ...readyArchive(revision), provider: 'vimeo' }, 'completed'],
    ['revision mismatch', readyArchive('r:22222222-2222-4222-8222-222222222222'), 'completed'],
    ['lifecycle mismatch', readyArchive(revision), 'scheduled']
  ];

  for (const [label, archive, status] of cases) {
    const seed = {
      'teams/team-1': { isPublic: true, active: true, name: 'Bears' },
      [path]: {
        type: 'game',
        date: '2026-08-01T18:00:00Z',
        status,
        visibility: 'public',
        opponent: 'Tigers',
        hasRecordedReplay: true,
        replayArchiveRevision: revision
      }
    };
    if (archive) seed[`${path}/privateReplay/archive`] = archive;
    const { callables } = loadCallables(seed);
    await assert.rejects(
      callables.getPublicGameProjection({ teamId: 'team-1', gameId: 'game-1' }, {}),
      (error) => error.code === 'unavailable',
      label
    );
  }

  const { callables } = loadCallables({
    'teams/team-1': { isPublic: true, active: true, name: 'Bears' },
    [path]: {
      type: 'game',
      date: '2026-08-01T18:00:00Z',
      status: 'completed',
      visibility: 'public',
      opponent: 'Tigers'
    }
  });
  const absent = await callables.getPublicGameProjection({ teamId: 'team-1', gameId: 'game-1' }, {});
  assert.equal(absent.item.hasRecordedReplay, false);
});

test('public homepage returns an uncacheable error when a candidate marker has no private archive', async () => {
  const revision = 'r:11111111-1111-4111-8111-111111111111';
  const { callables } = loadCallables({
    'teams/team-1': { isPublic: true, active: true, name: 'Bears' },
    'teams/team-2': { isPublic: true, active: true, name: 'Wolves' },
    'organizations/org-1/sharedGames/shared-1': {
      type: 'game',
      status: 'scheduled',
      liveStatus: 'live',
      visibility: 'public',
      homeTeamId: 'team-1',
      awayTeamId: 'team-2',
      hasRecordedReplay: true,
      replayArchiveRevision: revision
    }
  });
  const response = makeHttpResponse();
  await callables.publicHomepageGamesV1({
    method: 'GET',
    query: {},
    headers: {},
    ip: '203.0.113.42'
  }, response);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: {
      code: 'unavailable',
      message: 'Public homepage games are temporarily unavailable.'
    }
  });
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('a gated replay requires an explicit readable global premium config while ungated playback does not', async () => {
  const revision = 'r:11111111-1111-4111-8111-111111111111';
  const path = 'teams/team-1/games/game-1';
  const gatedSeed = {
    'teams/team-1': { isPublic: true, active: true, recordedReplayPaywallEnabled: true },
    [path]: {
      type: 'game', status: 'completed', visibility: 'public',
      hasRecordedReplay: true, replayArchiveRevision: revision
    },
    [`${path}/privateReplay/archive`]: readyArchive(revision)
  };
  let loaded = loadCallables(gatedSeed);
  await assert.rejects(
    loaded.callables.getGameReplayPlayback({ teamId: 'team-1', gameId: 'game-1' }, {}),
    (error) => error.code === 'unavailable'
  );

  loaded = loadCallables({ ...gatedSeed, 'platformConfig/premium': { openToAll: 'yes' } });
  await assert.rejects(
    loaded.callables.getGameReplayPlayback({ teamId: 'team-1', gameId: 'game-1' }, {}),
    (error) => error.code === 'unavailable'
  );

  loaded = loadCallables({ ...gatedSeed, 'platformConfig/premium': { openToAll: false } });
  loaded.firestore.fail('platformConfig/premium');
  await assert.rejects(
    loaded.callables.getGameReplayPlayback({ teamId: 'team-1', gameId: 'game-1' }, {}),
    (error) => error.code === 'unavailable'
  );

  loaded = loadCallables({
    ...gatedSeed,
    'teams/team-1': { isPublic: true, active: true, recordedReplayPaywallEnabled: false }
  });
  loaded.firestore.fail('platformConfig/premium');
  const ungated = await loaded.callables.getGameReplayPlayback({ teamId: 'team-1', gameId: 'game-1' }, {});
  assert.equal(ungated.available, true);
  assert.equal(ungated.reason, 'normal-access');
});

test('playback joins an exact shared-game child archive and fails closed on marker mismatch or read failure', async () => {
  const sharedPath = 'organizations/org-1/sharedGames/shared-1';
  const syntheticId = `shared_${encodeURIComponent(sharedPath)}`;
  const revision = 'r:11111111-1111-4111-8111-111111111111';
  let loaded = loadCallables({
    'teams/team-1': { isPublic: true, active: true },
    [sharedPath]: {
      type: 'game',
      status: 'completed',
      visibility: 'public',
      homeTeamId: 'team-1',
      awayTeamId: 'team-2',
      hasRecordedReplay: true,
      replayArchiveRevision: revision
    },
    [`${sharedPath}/privateReplay/archive`]: readyArchive(revision)
  });
  const shared = await loaded.callables.getGameReplayPlayback({ teamId: 'team-1', gameId: syntheticId }, {});
  assert.equal(shared.available, true);
  assert.equal(shared.replayVideo.videoId, 'abcdefghijk');

  loaded = loadCallables({
    'teams/team-1': { isPublic: true, active: true },
    [sharedPath]: {
      type: 'game', status: 'completed', visibility: 'public', homeTeamId: 'team-1', awayTeamId: 'team-2',
      hasRecordedReplay: true, replayArchiveRevision: 'r:22222222-2222-4222-8222-222222222222'
    },
    [`${sharedPath}/privateReplay/archive`]: readyArchive(revision)
  });
  await assert.rejects(
    loaded.callables.getGameReplayPlayback({ teamId: 'team-1', gameId: syntheticId }, {}),
    (error) => error.code === 'unavailable' && !String(error.message).includes('abcdefghijk')
  );

  loaded.firestore.fail(`${sharedPath}/privateReplay/archive`, Object.assign(new Error('offline'), { code: 'unavailable' }));
  await assert.rejects(
    loaded.callables.getGameReplayPlayback({ teamId: 'team-1', gameId: syntheticId }, {}),
    (error) => error.code === 'unavailable'
  );
});

test('parent deletion removes archives and only deletes compatibility receipts after finalization', async () => {
  const canonicalParent = 'teams/team-1/games/game-1';
  const sharedParent = 'organizations/org-1/sharedGames/shared-1';
  const canonicalReceipt = getReplayCompatibilityReceiptPath(canonicalParent);
  const sharedReceipt = getReplayCompatibilityReceiptPath(sharedParent);
  const { callables, firestore } = loadCallables({
    [`${canonicalParent}/privateReplay/archive`]: readyArchive(),
    [`${sharedParent}/privateReplay/archive`]: readyArchive(),
    [canonicalReceipt]: { protectedIdentityHashes: ['hash'] },
    [sharedReceipt]: { protectedIdentityHashes: ['hash'] }
  });
  await callables.cleanupPrivateReplayArchiveOnGameDelete({ ref: { path: canonicalParent } }, {});
  await callables.cleanupPrivateReplayArchiveOnSharedGameDelete({ ref: { path: sharedParent } }, {});
  assert.equal(firestore.snapshot(`${canonicalParent}/privateReplay/archive`), undefined);
  assert.equal(firestore.snapshot(`${sharedParent}/privateReplay/archive`), undefined);
  assert.equal(firestore.snapshot(canonicalReceipt), undefined);
  assert.equal(firestore.snapshot(sharedReceipt), undefined);
  await callables.cleanupPrivateReplayArchiveOnGameDelete({ ref: { path: canonicalParent } }, {});

  const pendingParent = 'teams/team-1/games/pending';
  const pendingReceipt = getReplayCompatibilityReceiptPath(pendingParent);
  const pending = loadCallables({
    [`${pendingParent}/privateReplay/archive`]: readyArchive(),
    [pendingReceipt]: { protectedIdentityHashes: ['history-only'] }
  }, { migrationControl: null });
  await pending.callables.cleanupPrivateReplayArchiveOnGameDelete({
    ref: { path: pendingParent }
  }, {});
  assert.equal(pending.firestore.snapshot(`${pendingParent}/privateReplay/archive`), undefined);
  assert.deepEqual(pending.firestore.snapshot(pendingReceipt), {
    protectedIdentityHashes: ['history-only']
  });
});

for (const [label, parentPath, triggerName] of [
  ['canonical game', 'teams/team-1/games/recreated', 'cleanupPrivateReplayArchiveOnGameDelete'],
  ['shared game', 'organizations/org-1/sharedGames/recreated', 'cleanupPrivateReplayArchiveOnSharedGameDelete']
]) {
  test(`a delayed ${label} delete retry preserves a recreated parent's consistent archive`, async () => {
    const archivePath = `${parentPath}/privateReplay/archive`;
    const receiptPath = getReplayCompatibilityReceiptPath(parentPath);
    const { callables, firestore } = loadCallables({
      [parentPath]: {
        type: 'game',
        status: 'completed',
        hasRecordedReplay: true,
        replayArchiveRevision: 'r:recreated'
      },
      [archivePath]: readyArchive('r:recreated'),
      [receiptPath]: { protectedIdentityHashes: ['new-generation'] }
    });

    await callables[triggerName]({ ref: { path: parentPath } }, {});

    assert.equal(firestore.snapshot(parentPath).replayArchiveRevision, 'r:recreated');
    assert.equal(firestore.snapshot(archivePath).revision, 'r:recreated');
    assert.equal(firestore.snapshot(receiptPath), undefined);
  });

  test(`a delayed ${label} delete retry removes the old archive after a plain parent recreation`, async () => {
    const archivePath = `${parentPath}/privateReplay/archive`;
    const receiptPath = getReplayCompatibilityReceiptPath(parentPath);
    const { callables, firestore } = loadCallables({
      [parentPath]: {
        type: 'game',
        status: 'scheduled',
        name: 'Recreated without replay state'
      },
      [archivePath]: readyArchive('r:deleted-generation'),
      [receiptPath]: { protectedIdentityHashes: ['deleted-generation'] }
    });

    await callables[triggerName]({ ref: { path: parentPath } }, {});

    assert.equal(firestore.snapshot(parentPath).name, 'Recreated without replay state');
    assert.equal(firestore.snapshot(archivePath), undefined);
    assert.equal(firestore.snapshot(receiptPath), undefined);
  });

  test(`a pre-migration ${label} recreation retains receipt history while deleting its stale archive`, async () => {
    const archivePath = `${parentPath}/privateReplay/archive`;
    const receiptPath = getReplayCompatibilityReceiptPath(parentPath);
    const pending = loadCallables({
      [parentPath]: { type: 'game', status: 'scheduled', name: 'Pending recreation' },
      [archivePath]: readyArchive('r:deleted-generation'),
      [receiptPath]: { protectedIdentityHashes: ['history-only'] }
    }, { migrationControl: null });

    await pending.callables[triggerName]({ ref: { path: parentPath } }, {});

    assert.equal(pending.firestore.snapshot(archivePath), undefined);
    assert.deepEqual(pending.firestore.snapshot(receiptPath), {
      protectedIdentityHashes: ['history-only']
    });
  });
}

test('private replay cleanup triggers opt into retry delivery before migration', () => {
  const indexSource = readFileSync(repoIndexPath, 'utf8');
  for (const exportName of [
    'cleanupPrivateReplayArchiveOnGameDelete',
    'cleanupPrivateReplayArchiveOnSharedGameDelete'
  ]) {
    assert.match(
      indexSource,
      new RegExp(`exports\\.${exportName} = functions\\s*\\n\\s*\\.runWith\\(\\{ failurePolicy: true \\}\\)`)
    );
  }
  assert.match(
    indexSource,
    /exports\.cleanupPrivateReplayArchiveOnSharedGameDelete[\s\S]*?\.document\('\{rootCollection\}\/\{rootId\}\/sharedGames\/\{gameId\}'\)/
  );
  assert.doesNotMatch(
    indexSource,
    /cleanupPrivateReplayArchiveOnSharedGameDelete[\s\S]*?\.document\('\{path=\*\*\}\/sharedGames/
  );
});
