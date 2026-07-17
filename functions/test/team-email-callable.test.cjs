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
  const committedWrites = [];
  const collectionCounters = new Map();
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
      path,
      get: async () => snapshot(path),
      set: async (value, options) => {
        committedWrites.push({ path, value, options });
        state.set(path, value);
      }
    };
  }

  function collection(path) {
    return {
      doc() {
        if (path === 'mail') mailJobRefsCreated += 1;
        const nextId = (collectionCounters.get(path) || 0) + 1;
        collectionCounters.set(path, nextId);
        return doc(`${path}/auto-${nextId}`);
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
      const writes = [];
      return {
        set(ref, value, options) {
          writes.push({ path: ref.path, value, options });
        },
        async commit() {
          writes.forEach((write) => {
            committedWrites.push(write);
            state.set(write.path, write.value);
          });
        }
      };
    },
    get mailJobRefsCreated() {
      return mailJobRefsCreated;
    },
    get committedWrites() {
      return committedWrites;
    }
  };
}

function loadCallables(seed, storageMetadata = {}) {
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
    storage: () => ({
      bucket: () => ({
        file: (path) => ({
          getMetadata: async () => [{ name: path, ...storageMetadata[path] }]
        })
      })
    })
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

test('sendTeamEmail queues an authorized selected-member send with verified attachment metadata', async () => {
  const attachmentPath = 'team-email-attachments/team-1/draft-1/owner-1/plan.pdf';
  const { callables, firestore } = loadCallables({
    'teams/team-1': { ownerId: 'owner-1', adminEmails: [] },
    'users/owner-1': { fullName: 'Team Owner', email: 'owner@example.com' },
    'teams/team-1/players/player-1': {
      active: true,
      parents: [{ userId: 'parent-1', email: 'selected@example.com' }]
    },
    'teams/team-1/players/player-2': {
      active: true,
      parents: [{ userId: 'parent-2', email: 'excluded@example.com' }]
    }
  }, {
    [attachmentPath]: { size: '2048', contentType: 'application/pdf' }
  });

  const result = await callables.sendTeamEmail({
    teamId: 'team-1',
    subject: 'Practice update',
    body: 'Practice moved.',
    targetType: 'individuals',
    recipientIds: ['player:player-1'],
    attachments: [{
      name: 'plan.pdf',
      storagePath: attachmentPath,
      size: 1,
      contentType: 'text/plain'
    }]
  }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });

  assert.equal(result.status, 'sent');
  assert.equal(result.recipientCount, 1);
  const historyWrite = firestore.committedWrites.find((write) => write.path.startsWith('teams/team-1/teamEmails/'));
  assert.ok(historyWrite);
  assert.equal(historyWrite.value.targetType, 'individuals');
  assert.equal(historyWrite.value.recipientCount, 1);
  assert.deepEqual(historyWrite.value.recipientSummary, [{
    playerIds: ['player-1'],
    userIds: ['parent-1'],
    roles: ['guardian']
  }]);
  assert.deepEqual(historyWrite.value.attachments, [{
    name: 'plan.pdf',
    storagePath: attachmentPath,
    contentType: 'application/pdf',
    size: 2048
  }]);
  assert.equal(historyWrite.value.attachmentTotalBytes, 2048);

  const mailWrites = firestore.committedWrites.filter((write) => write.path.startsWith('mail/'));
  assert.equal(mailWrites.length, 1);
  assert.deepEqual(mailWrites[0].value.to, ['selected@example.com']);
  assert.equal(mailWrites[0].value.metadata.teamEmailMessageId, historyWrite.path.split('/').pop());
  assert.deepEqual(mailWrites[0].value.metadata.attachments, historyWrite.value.attachments);
  assert.equal(mailWrites[0].value.metadata.attachmentTotalBytes, 2048);
});
