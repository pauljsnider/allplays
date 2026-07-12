const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

let adminStub = null;
let functionsStub = null;
let StripeStub = null;

function patchedModuleLoad(request, parent, isMain) {
  if (request === 'firebase-admin' && adminStub) return adminStub;
  if (request === 'firebase-functions' && functionsStub) return functionsStub;
  if (request === 'stripe' && StripeStub) return StripeStub;
  return originalModuleLoad(request, parent, isMain);
}

class FakeTimestamp {
  constructor(milliseconds) {
    this.milliseconds = Number(milliseconds);
  }

  toMillis() {
    return this.milliseconds;
  }

  toDate() {
    return new Date(this.milliseconds);
  }

  static now() {
    return new FakeTimestamp(Date.now());
  }
}

function clone(value) {
  if (value instanceof FakeTimestamp) return new FakeTimestamp(value.toMillis());
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function comparable(value) {
  return value instanceof FakeTimestamp ? value.toMillis() : value;
}

function applyPatch(current, patch) {
  const next = clone(current || {});
  for (const [key, value] of Object.entries(patch || {})) {
    if (value?.__op === 'delete') {
      delete next[key];
    } else {
      next[key] = clone(value);
    }
  }
  return next;
}

function makeFirestore(seed = {}) {
  const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));

  function makeSnapshot(path) {
    const value = state.get(path);
    return {
      id: path.split('/').pop(),
      ref: doc(path),
      exists: value !== undefined,
      data: () => clone(value)
    };
  }

  function doc(path) {
    return {
      path,
      id: path.split('/').pop(),
      get: async () => makeSnapshot(path),
      set: async (value, options = {}) => {
        state.set(path, options.merge ? applyPatch(state.get(path), value) : clone(value));
      },
      update: async (value) => {
        if (!state.has(path)) throw new Error(`Missing document: ${path}`);
        state.set(path, applyPatch(state.get(path), value));
      },
      delete: async () => {
        state.delete(path);
      },
      collection: (name) => collection(`${path}/${name}`)
    };
  }

  function makeQuery(path, filters = [], limitCount = null) {
    return {
      where(field, operator, value) {
        return makeQuery(path, [...filters, { field, operator, value }], limitCount);
      },
      limit(count) {
        return makeQuery(path, filters, Number(count));
      },
      doc(id) {
        return doc(`${path}/${id}`);
      },
      async get() {
        const depth = path.split('/').length + 1;
        let docs = [...state.keys()]
          .filter((entryPath) => entryPath.startsWith(`${path}/`) && entryPath.split('/').length === depth)
          .map(makeSnapshot)
          .filter((snapshot) => filters.every(({ field, operator, value }) => {
            if (operator !== '==') throw new Error(`Unsupported query operator: ${operator}`);
            return comparable(snapshot.data()?.[field]) === comparable(value);
          }));
        if (limitCount != null) {
          docs = docs.slice(0, limitCount);
        }
        return { docs, empty: docs.length === 0, size: docs.length };
      }
    };
  }

  function collection(path) {
    return makeQuery(path);
  }

  return {
    _state: state,
    doc,
    collection,
    async runTransaction(handler) {
      return handler({
        get: (ref) => ref.get(),
        set: (ref, value, options) => ref.set(value, options),
        update: (ref, value) => ref.update(value),
        delete: (ref) => ref.delete()
      });
    },
    snapshot(path) {
      return clone(state.get(path));
    }
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

  const triggerChain = {
    onCall: (fn) => fn,
    onRequest: (fn) => fn,
    onCreate: (fn) => fn,
    onUpdate: (fn) => fn,
    onWrite: (fn) => fn,
    onRun: (fn) => fn,
    document() { return this; },
    schedule() { return this; },
    timeZone() { return this; }
  };
  triggerChain.https = triggerChain;
  triggerChain.firestore = triggerChain;
  triggerChain.pubsub = triggerChain;

  return {
    config: () => ({ stripe: { secret_key: 'sk_test_123', app_url: 'https://allplays.test' } }),
    https: { HttpsError, onCall: (fn) => fn, onRequest: (fn) => fn },
    firestore: { document: () => triggerChain },
    pubsub: { schedule: () => triggerChain },
    runWith: () => triggerChain,
    logger: { error() {}, warn() {}, info() {} }
  };
}

function loadRollbackCallable(seed, authUsersByUid) {
  delete require.cache[repoIndexPath];
  const firestore = makeFirestore(seed);
  const fieldValue = {
    delete: () => ({ __op: 'delete' }),
    serverTimestamp: () => new FakeTimestamp(Date.now()),
    arrayUnion: (...items) => ({ __op: 'arrayUnion', items }),
    arrayRemove: (...items) => ({ __op: 'arrayRemove', items })
  };
  adminStub = {
    apps: [true],
    initializeApp() {},
    firestore: Object.assign(() => firestore, {
      FieldValue: fieldValue,
      Timestamp: FakeTimestamp,
      FieldPath: { documentId: () => '__name__' }
    }),
    auth: () => ({
      getUser: async (uid) => {
        if (!authUsersByUid[uid]) {
          const error = new Error('User not found');
          error.code = 'auth/user-not-found';
          throw error;
        }
        return authUsersByUid[uid];
      },
      verifyIdToken: async () => null
    }),
    messaging: () => ({})
  };
  functionsStub = makeFunctionsStub();
  StripeStub = class StripeMock {
    constructor() {
      return {
        checkout: { sessions: { create: async () => ({}) } },
        webhooks: { constructEvent: () => { throw new Error('Not implemented in test.'); } }
      };
    }
  };
  return { firestore, rollbackFailedSignupRedemption: require('../index.js').rollbackFailedSignupRedemption };
}

function authContext(uid) {
  return { auth: { uid, token: { email: `${uid}@example.com`, email_verified: true } } };
}

function buildRollbackSeed(uid, nowMs) {
  return {
    'accessCodes/code-1': {
      code: 'PARENT12',
      type: 'parent_invite',
      used: true,
      usedBy: uid,
      usedAt: new FakeTimestamp(nowMs - 1000),
      status: 'accepted',
      teamId: 'team-1',
      playerId: 'player-1',
      email: 'parent@example.com'
    },
    [`users/${uid}`]: {
      email: `${uid}@example.com`,
      createdAt: new FakeTimestamp(nowMs - (7 * 24 * 60 * 60 * 1000)),
      parentTeamIds: ['team-1']
    },
    [`publicUserProfiles/${uid}`]: {
      displayName: 'Existing Parent'
    },
    'teams/team-1/players/player-1/private/profile': {
      parents: [{ userId: uid, email: 'parent@example.com' }]
    }
  };
}

test.beforeEach(() => {
  delete require.cache[repoIndexPath];
  Module._load = patchedModuleLoad;
  adminStub = null;
  functionsStub = null;
  StripeStub = null;
});

test.afterEach(() => {
  delete require.cache[repoIndexPath];
  Module._load = originalModuleLoad;
  adminStub = null;
  functionsStub = null;
  StripeStub = null;
});

test('rollbackFailedSignupRedemption refuses destructive cleanup for established accounts', async () => {
  const nowMs = Date.now();
  const uid = 'existing-user';
  const { firestore, rollbackFailedSignupRedemption } = loadRollbackCallable(
    buildRollbackSeed(uid, nowMs),
    { [uid]: { uid, metadata: { creationTime: new Date(nowMs - (7 * 24 * 60 * 60 * 1000)).toISOString() } } }
  );

  const result = await rollbackFailedSignupRedemption({ code: 'parent12' }, authContext(uid));

  assert.deepEqual(result, { success: true, codeRolledBack: false, userDocDeleted: false });
  assert.equal(firestore.snapshot('accessCodes/code-1').used, true);
  assert.equal(firestore.snapshot('accessCodes/code-1').usedBy, uid);
  assert.equal(firestore.snapshot(`users/${uid}`).email, `${uid}@example.com`);
  assert.equal(firestore.snapshot(`publicUserProfiles/${uid}`).displayName, 'Existing Parent');
  assert.deepEqual(
    firestore.snapshot('teams/team-1/players/player-1/private/profile').parents,
    [{ userId: uid, email: 'parent@example.com' }]
  );
});

test('rollbackFailedSignupRedemption still cleans up newly-created failed signup accounts', async () => {
  const nowMs = Date.now();
  const uid = 'new-user';
  const { firestore, rollbackFailedSignupRedemption } = loadRollbackCallable(
    buildRollbackSeed(uid, nowMs),
    { [uid]: { uid, metadata: { creationTime: new Date(nowMs - 1000).toISOString() } } }
  );

  const result = await rollbackFailedSignupRedemption({ code: 'PARENT12' }, authContext(uid));

  assert.deepEqual(result, { success: true, codeRolledBack: true, userDocDeleted: true });
  assert.equal(firestore.snapshot('accessCodes/code-1').used, false);
  assert.equal(firestore.snapshot('accessCodes/code-1').usedBy, null);
  assert.equal(firestore.snapshot('accessCodes/code-1').usedAt, null);
  assert.equal(Object.hasOwn(firestore.snapshot('accessCodes/code-1'), 'status'), false);
  assert.equal(firestore.snapshot(`users/${uid}`), undefined);
  assert.equal(firestore.snapshot(`publicUserProfiles/${uid}`), undefined);
  assert.deepEqual(firestore.snapshot('teams/team-1/players/player-1/private/profile').parents, []);
});
