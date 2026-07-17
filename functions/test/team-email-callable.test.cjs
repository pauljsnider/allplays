const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

let adminStub;
let functionsStub;
let StripeStub;

function patchedModuleLoad(request, parent, isMain) {
  if (request === 'firebase-admin' && adminStub) return adminStub;
  if (request === 'firebase-functions' && functionsStub) return functionsStub;
  if (request === 'stripe' && StripeStub) return StripeStub;
  return originalModuleLoad(request, parent, isMain);
}

function makeFunctionsStub() {
  class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  }

  const triggerChain = {
    onCall: (handler) => handler,
    onRequest: (handler) => handler,
    onCreate: (handler) => handler,
    onUpdate: (handler) => handler,
    onWrite: (handler) => handler,
    onDelete: (handler) => handler,
    onRun: (handler) => handler,
    document() { return this; },
    schedule() { return this; },
    timeZone() { return this; }
  };
  triggerChain.https = triggerChain;
  triggerChain.firestore = triggerChain;
  triggerChain.pubsub = triggerChain;

  return {
    config: () => ({ stripe: { secret_key: 'sk_test_123', app_url: 'https://allplays.test' } }),
    auth: { user: () => triggerChain },
    https: { HttpsError, onCall: (handler) => handler, onRequest: (handler) => handler },
    firestore: { document: () => triggerChain },
    pubsub: { schedule: () => triggerChain },
    runWith: () => triggerChain,
    logger: { error() {}, warn() {}, info() {} }
  };
}

function makeFirestore(seed) {
  const state = new Map(Object.entries(seed));
  let mailJobRefsCreated = 0;

  function snapshot(path) {
    const value = state.get(path);
    return {
      id: path.split('/').pop(),
      exists: value !== undefined,
      data: () => value
    };
  }

  function doc(path) {
    return {
      id: path.split('/').pop(),
      get: async () => snapshot(path)
    };
  }

  function collection(path) {
    return {
      doc() {
        if (path === 'mail') mailJobRefsCreated += 1;
        return { id: `auto-${mailJobRefsCreated || 1}` };
      },
      async get() {
        const depth = path.split('/').length + 1;
        const docs = [...state.keys()]
          .filter((entryPath) => entryPath.startsWith(`${path}/`) && entryPath.split('/').length === depth)
          .map(snapshot);
        return { docs };
      }
    };
  }

  return {
    doc,
    collection,
    batch() {
      throw new Error('A rejected send must not create a write batch.');
    },
    get mailJobRefsCreated() {
      return mailJobRefsCreated;
    }
  };
}

function loadCallables(seed) {
  delete require.cache[repoIndexPath];
  const firestore = makeFirestore(seed);
  const fieldValue = {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    delete: () => ({ __op: 'delete' }),
    increment: (amount) => ({ __op: 'increment', amount }),
    arrayUnion: (...items) => ({ __op: 'arrayUnion', items })
  };
  adminStub = {
    apps: [true],
    initializeApp() {},
    firestore: Object.assign(() => firestore, {
      FieldValue: fieldValue,
      FieldPath: { documentId: () => '__name__' }
    }),
    auth: () => ({ verifyIdToken: async () => null }),
    messaging: () => ({}),
    storage: () => ({ bucket: () => ({ file: () => ({}) }) })
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
  return { callables: require('../index.js'), firestore };
}

test.beforeEach(() => {
  Module._load = patchedModuleLoad;
});

test.afterEach(() => {
  delete require.cache[repoIndexPath];
  Module._load = originalModuleLoad;
  adminStub = null;
  functionsStub = null;
  StripeStub = null;
});

test('sendTeamEmail rejects an unauthorized caller before creating mail jobs', async () => {
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'owner-1', adminEmails: ['coach@example.com'] },
    'users/outsider-1': { isAdmin: false }
  });

  await assert.rejects(
    callables.sendTeamEmail(
      { teamId: 'team-1', subject: 'Update', body: 'Practice moved.' },
      { auth: { uid: 'outsider-1', token: { email: 'outsider@example.com' } } }
    ),
    (error) => error.code === 'permission-denied'
  );
  assert.equal(firestore.mailJobRefsCreated, 0);
});

test('sendTeamEmail rejects a cross-team recipient before creating mail jobs', async () => {
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'owner-1', adminEmails: [] },
    'users/owner-1': { fullName: 'Owner' },
    'teams/team-1/players/player-1': {
      active: true,
      parents: [{ userId: 'parent-1', email: 'parent@example.com' }]
    }
  });

  await assert.rejects(
    callables.sendTeamEmail({
      teamId: 'team-1',
      subject: 'Update',
      body: 'Practice moved.',
      targetType: 'individuals',
      recipientIds: ['player:other-team-player']
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } }),
    (error) => error.code === 'invalid-argument' && /no longer eligible/.test(error.message)
  );
  assert.equal(firestore.mailJobRefsCreated, 0);
});
