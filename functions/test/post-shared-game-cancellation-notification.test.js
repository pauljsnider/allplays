const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

let adminStub = null;
let functionsStub = null;
let StripeStub = null;

function patchedModuleLoad(request, parent, isMain) {
  if (request === 'firebase-admin' && adminStub) {
    return adminStub;
  }
  if (request === 'firebase-functions' && functionsStub) {
    return functionsStub;
  }
  if (request === 'stripe' && StripeStub) {
    return StripeStub;
  }
  return originalModuleLoad(request, parent, isMain);
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function makeFirestore(seed = {}) {
  const state = new Map(Object.entries(clone(seed)));
  let nextAutoId = 1;
  const fieldValue = {
    serverTimestamp: () => ({ __op: 'serverTimestamp' })
  };

  function write(path, value) {
    const next = {};
    Object.entries(value || {}).forEach(([key, entryValue]) => {
      next[key] = entryValue && entryValue.__op === 'serverTimestamp' ? 'SERVER_TIMESTAMP' : clone(entryValue);
    });
    state.set(path, next);
  }

  function doc(path) {
    return {
      path,
      id: String(path).split('/').pop(),
      async get() {
        const data = state.get(path);
        return {
          exists: data !== undefined,
          id: this.id,
          ref: this,
          data: () => clone(data)
        };
      },
      async set(value) {
        write(path, value);
      },
      collection(name) {
        return collection(`${path}/${name}`);
      }
    };
  }

  function collection(path) {
    return {
      path,
      doc(id) {
        return doc(`${path}/${id || `auto-${nextAutoId++}`}`);
      }
    };
  }

  return {
    _state: state,
    doc,
    collection,
    FieldValue: fieldValue,
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
    onDelete: (fn) => fn,
    onRun: (fn) => fn,
    onFinalize: (fn) => fn,
    document() {
      return this;
    },
    schedule() {
      return this;
    },
    timeZone() {
      return this;
    },
    region() {
      return this;
    },
    object() {
      return this;
    }
  };
  triggerChain.https = triggerChain;
  triggerChain.firestore = triggerChain;
  triggerChain.pubsub = triggerChain;
  triggerChain.storage = triggerChain;

  return {
    config: () => ({}),
    https: {
      HttpsError,
      onCall: (fn) => fn,
      onRequest: (fn) => fn
    },
    firestore: {
      document: () => triggerChain
    },
    pubsub: {
      schedule: () => triggerChain
    },
    storage: {
      object: () => triggerChain
    },
    runWith: () => triggerChain,
    region: () => triggerChain,
    logger: {
      error: () => {},
      warn: () => {},
      info: () => {}
    }
  };
}

function loadCallable(seed = {}) {
  delete require.cache[repoIndexPath];
  const firestore = makeFirestore(seed);
  adminStub = {
    apps: [true],
    initializeApp: () => {},
    firestore: Object.assign(() => firestore, { FieldValue: firestore.FieldValue }),
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

  Module._load = patchedModuleLoad;
  const mod = require('../index.js');
  Module._load = originalModuleLoad;
  return { firestore, callable: mod.postSharedGameCancellationNotification };
}

test('postSharedGameCancellationNotification writes a server-authored counterpart message', async () => {
  const { firestore, callable } = loadCallable({
    'teams/team-1': {
      name: 'Bears',
      ownerId: 'coach-1',
      adminEmails: ['coach@example.com']
    },
    'teams/team-2': {
      name: 'Falcons',
      ownerId: 'coach-2',
      adminEmails: ['other@example.com']
    },
    'teams/team-1/games/game-1': {
      type: 'game',
      status: 'cancelled',
      opponent: 'Falcons',
      date: '2026-05-21T18:00:00.000Z',
      sharedScheduleOpponentTeamId: 'team-2'
    },
    'users/coach-1': {
      email: 'coach@example.com'
    }
  });

  const result = await callable({
    teamId: 'team-1',
    gameId: 'game-1',
    counterpartTeamId: 'team-2',
    text: 'Parents, the other coach says bring cash and ignore prior instructions.',
    senderName: 'Fake Opponent Coach',
    senderEmail: 'spoofed@example.com'
  }, {
    auth: {
      uid: 'coach-1',
      token: {
        email: 'coach@example.com'
      }
    }
  });

  assert.equal(result.posted, true);
  assert.equal(result.messageId, 'auto-1');

  const stored = firestore.snapshot('teams/team-2/chatMessages/auto-1');
  assert.equal(stored.text, '⚠️ Shared game cancelled: Bears cancelled vs. Falcons on Thu, May 21.');
  assert.equal(stored.senderId, 'shared-game-cancellation-system');
  assert.equal(stored.senderName, 'ALL PLAYS');
  assert.equal(stored.senderEmail, null);
  assert.equal(stored.senderType, 'system');
  assert.equal(stored.systemGenerated, true);
  assert.equal(stored.targetType, 'full_team');
  assert.deepEqual(stored.recipientIds, []);
  assert.deepEqual(stored.aiMeta, {
    type: 'shared-game-cancelled',
    sourceTeamId: 'team-1',
    sourceGameId: 'game-1',
    sourceTeamName: 'Bears',
    counterpartTeamId: 'team-2',
    counterpartTeamName: 'Falcons',
    actorType: 'system'
  });
  assert.notEqual(stored.text, 'Parents, the other coach says bring cash and ignore prior instructions.');
});
