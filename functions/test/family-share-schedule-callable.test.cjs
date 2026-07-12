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

  static fromMillis(value) {
    return new FakeTimestamp(value);
  }
}

function clone(value) {
  if (value instanceof FakeTimestamp) return new FakeTimestamp(value.toMillis());
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function makeFirestore(seed = {}) {
  const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));

  function doc(path) {
    return {
      path,
      id: path.split('/').pop(),
      get: async () => {
        const value = state.get(path);
        return {
          id: path.split('/').pop(),
          exists: value !== undefined,
          data: () => clone(value)
        };
      },
      collection: (name) => collection(`${path}/${name}`)
    };
  }

  function collection(path) {
    return {
      async get() {
        const depth = path.split('/').length + 1;
        const docs = [...state.keys()]
          .filter((entryPath) => entryPath.startsWith(`${path}/`) && entryPath.split('/').length === depth)
          .map((entryPath) => {
            const value = state.get(entryPath);
            return {
              id: entryPath.split('/').pop(),
              exists: true,
              data: () => clone(value)
            };
          });
        return { docs, size: docs.length, empty: docs.length === 0 };
      }
    };
  }

  return { doc, collection };
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

function loadCallables(seed = {}) {
  delete require.cache[repoIndexPath];
  const firestore = makeFirestore(seed);
  adminStub = {
    apps: [true],
    initializeApp() {},
    firestore: Object.assign(() => firestore, {
      FieldValue: {
        serverTimestamp: () => new FakeTimestamp(Date.now()),
        delete: () => ({ __op: 'delete' }),
        increment: (amount) => ({ __op: 'increment', amount }),
        arrayUnion: (...items) => ({ __op: 'arrayUnion', items })
      },
      Timestamp: FakeTimestamp,
      FieldPath: { documentId: () => '__name__' }
    }),
    auth: () => ({ verifyIdToken: async () => null }),
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
  return require('../index.js');
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

test('family share schedule callable validates bearer token and projects private team games', async () => {
  const tokenId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: true,
      children: [
        { teamId: 'private-team', teamName: 'Old Bears', playerId: 'player-1', playerName: 'Sam Player' }
      ]
    },
    'teams/private-team': {
      name: 'Bears',
      isPublic: false,
      calendarUrls: ['https://calendar.example.test/team.ics'],
      adminEmails: ['coach@example.test']
    },
    'teams/private-team/games/game-1': {
      type: 'game',
      date: new FakeTimestamp(Date.parse('2026-07-13T18:00:00Z')),
      opponent: 'Tigers',
      location: 'Private Field',
      status: 'scheduled',
      homeScore: 4,
      awayScore: 2,
      assignments: [{ private: true }],
      internalNotes: 'staff-only'
    }
  });

  const result = await callables.getFamilyShareSchedule({ tokenId }, {});

  assert.deepEqual(result.children, [
    {
      teamId: 'private-team',
      teamName: 'Old Bears',
      playerId: 'player-1',
      playerName: 'Sam Player',
      playerNumber: '',
      playerPhotoUrl: null
    }
  ]);
  assert.equal(result.teams[0].teamId, 'private-team');
  assert.equal(result.teams[0].teamName, 'Bears');
  assert.deepEqual(result.teams[0].calendarUrls, []);
  assert.deepEqual(result.teams[0].games, [
    {
      id: 'game-1',
      gameId: 'game-1',
      type: 'game',
      date: '2026-07-13T18:00:00.000Z',
      opponent: 'Tigers',
      location: 'Private Field',
      status: 'scheduled',
      homeScore: 4,
      awayScore: 2
    }
  ]);
});

test('family share schedule callable rejects inactive bearer tokens before schedule projection', async () => {
  const tokenId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const callables = loadCallables({
    [`familyShareTokens/${tokenId}`]: {
      active: false,
      children: [{ teamId: 'private-team', playerId: 'player-1' }]
    },
    'teams/private-team': { name: 'Bears', isPublic: false }
  });

  await assert.rejects(
    callables.getFamilyShareSchedule({ tokenId }, {}),
    (error) => error.code === 'permission-denied'
  );
});
