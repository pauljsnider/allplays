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

function getNested(target, path) {
  return String(path || '').split('.').filter(Boolean)
    .reduce((cursor, key) => (cursor == null ? undefined : cursor[key]), target);
}

function setNested(target, path, value) {
  const parts = String(path || '').split('.').filter(Boolean);
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    const key = parts[index];
    if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

function deleteNested(target, path) {
  const parts = String(path || '').split('.').filter(Boolean);
  let cursor = target;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor = cursor?.[parts[index]];
    if (!cursor || typeof cursor !== 'object') return;
  }
  if (cursor && typeof cursor === 'object') {
    delete cursor[parts[parts.length - 1]];
  }
}

function comparable(value) {
  if (value instanceof FakeTimestamp) return value.toMillis();
  return value;
}

function makeFirestore(seed = {}) {
  const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  const fieldValue = {
    delete: () => ({ __op: 'delete' }),
    serverTimestamp: () => new FakeTimestamp(Date.now()),
    arrayUnion: (...items) => ({ __op: 'arrayUnion', items })
  };

  function applyPatch(currentValue, patchValue, merge) {
    const target = merge ? clone(currentValue || {}) : {};
    Object.entries(patchValue || {}).forEach(([key, value]) => {
      if (value && typeof value === 'object' && value.__op === 'delete') {
        deleteNested(target, key);
      } else if (value && typeof value === 'object' && value.__op === 'arrayUnion') {
        const current = getNested(target, key);
        setNested(target, key, [...(Array.isArray(current) ? current : []), ...clone(value.items)]);
      } else {
        setNested(target, key, clone(value));
      }
    });
    return target;
  }

  function makeSnapshot(path, ref) {
    const value = state.get(path);
    return {
      id: path.split('/').pop(),
      ref,
      exists: value !== undefined,
      data: () => clone(value)
    };
  }

  function write(path, value, options = {}) {
    state.set(path, applyPatch(state.get(path), value, options.merge === true));
  }

  function doc(path) {
    return {
      path,
      id: path.split('/').pop(),
      async get() {
        return makeSnapshot(path, this);
      },
      async set(value, options = {}) {
        write(path, value, options);
      },
      async update(value) {
        if (!state.has(path)) throw new Error(`Missing document for update: ${path}`);
        write(path, value, { merge: true });
      },
      async delete() {
        state.delete(path);
      },
      collection(name) {
        return collection(`${path}/${name}`);
      }
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
      async get() {
        const depth = path.split('/').length + 1;
        const docs = [...state.keys()]
          .filter((entryPath) => entryPath.startsWith(`${path}/`) && entryPath.split('/').length === depth)
          .map((entryPath) => makeSnapshot(entryPath, doc(entryPath)))
          .filter((snapshot) => filters.every(({ field, operator, value }) => {
            const actual = field === '__name__' ? snapshot.id : getNested(snapshot.data(), field);
            if (operator === '==') return comparable(actual) === comparable(value);
            throw new Error(`Unsupported query operator in test: ${operator}`);
          }))
          .slice(0, limitCount || undefined);
        return { docs, size: docs.length, empty: docs.length === 0 };
      }
    };
  }

  function collection(path) {
    const query = makeQuery(path);
    query.doc = (id) => doc(`${path}/${id}`);
    return query;
  }

  return {
    _state: state,
    FieldValue: fieldValue,
    Timestamp: FakeTimestamp,
    FieldPath: { documentId: () => '__name__' },
    doc,
    collection,
    async runTransaction(handler) {
      const transaction = {
        get: (ref) => ref.get(),
        set: (ref, value, options) => ref.set(value, options),
        update: (ref, value) => ref.update(value),
        delete: (ref) => ref.delete()
      };
      return handler(transaction);
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
    onDelete: (fn) => fn,
    onRun: (fn) => fn,
    onFinalize: (fn) => fn,
    document() { return this; },
    schedule() { return this; },
    timeZone() { return this; },
    region() { return this; },
    object() { return this; }
  };
  triggerChain.https = triggerChain;
  triggerChain.firestore = triggerChain;
  triggerChain.pubsub = triggerChain;
  triggerChain.storage = triggerChain;

  return {
    config: () => ({ stripe: { secret_key: 'sk_test_123', app_url: 'https://allplays.test' } }),
    https: { HttpsError, onCall: (fn) => fn, onRequest: (fn) => fn },
    firestore: { document: () => triggerChain },
    auth: { user: () => triggerChain },
    pubsub: { schedule: () => triggerChain },
    storage: { object: () => triggerChain },
    runWith: () => triggerChain,
    region: () => triggerChain,
    logger: { info() {}, warn() {}, error() {} }
  };
}

function loadFunctions(seed, { authUsers = {} } = {}) {
  delete require.cache[repoIndexPath];
  const firestore = makeFirestore(seed);
  const getUserCalls = [];
  adminStub = {
    apps: [true],
    initializeApp() {},
    firestore: Object.assign(() => firestore, {
      FieldValue: firestore.FieldValue,
      Timestamp: FakeTimestamp,
      FieldPath: firestore.FieldPath
    }),
    auth: () => ({
      async getUser(uid) {
        getUserCalls.push(uid);
        const record = authUsers[uid];
        if (!record) throw new Error(`Missing auth user: ${uid}`);
        return record;
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

  return { firestore, getUserCalls, mod: require('../index.js') };
}

function authContext(uid, email = `${uid}@example.com`) {
  return { auth: { uid, token: { email, email_verified: true, name: uid } } };
}

function inviteCode({
  code = 'PARENT1',
  uid = 'new-parent',
  type = 'parent_invite',
  teamId = 'team-1',
  playerId = 'player-1',
  organizerUserId = 'organizer',
  familyMembershipId = 'membership-1',
  usedAt = Date.now() - 60_000
} = {}) {
  return {
    code,
    type,
    used: true,
    usedBy: uid,
    usedAt: new FakeTimestamp(usedAt),
    status: 'used',
    teamId,
    playerId,
    organizerUserId,
    familyMembershipId,
    email: `${uid}@example.com`
  };
}

function cleanupSeed({ uid = 'new-parent', includeOtherParentLink = false, codeId = 'code-1' } = {}) {
  const cleanupLink = { teamId: 'team-1', playerId: 'player-1', teamName: 'Bears', playerName: 'Avery' };
  const otherLink = { teamId: 'team-2', playerId: 'player-2', teamName: 'Lions', playerName: 'Blake' };
  const parentOf = includeOtherParentLink ? [cleanupLink, otherLink] : [cleanupLink];
  return {
    [`accessCodes/${codeId}`]: inviteCode({ uid }),
    [`users/${uid}`]: {
      email: `${uid}@example.com`,
      displayName: 'Invite Parent',
      roles: ['parent'],
      parentOf,
      parentTeamIds: parentOf.map((link) => link.teamId),
      parentPlayerKeys: parentOf.map((link) => `${link.teamId}::${link.playerId}`)
    },
    [`publicUserProfiles/${uid}`]: {
      displayName: 'Invite Parent',
      discoveryTeamIds: parentOf.map((link) => link.teamId)
    },
    'teams/team-1/players/player-1/private/profile': {
      parents: [
        { userId: uid, name: 'Invite Parent' },
        { userId: 'existing-parent', name: 'Existing Parent' }
      ]
    },
    'users/organizer/familyMemberships/membership-1': {
      status: 'active',
      userId: uid,
      acceptedAt: new FakeTimestamp(Date.now() - 30_000),
      organizerUserId: 'organizer',
      email: `${uid}@example.com`,
      teamId: 'team-1',
      playerId: 'player-1'
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

test('cleanupFailedInviteSignup refuses destructive recovery for established auth users', async () => {
  const uid = 'established-parent';
  const oldAuthRecord = {
    uid,
    metadata: { creationTime: new Date(Date.now() - 31 * 60 * 1000).toISOString() }
  };
  const seed = cleanupSeed({ uid });
  const { firestore, mod } = loadFunctions(seed, { authUsers: { [uid]: oldAuthRecord } });

  const result = await mod.cleanupFailedInviteSignup({ code: 'PARENT1', userId: uid }, authContext(uid));

  assert.deepEqual(result, { recovered: false, inviteCount: 0, userDeleted: false });
  assert.equal(firestore.snapshot('accessCodes/code-1').used, true);
  assert.equal(firestore.snapshot(`users/${uid}`).roles[0], 'parent');
  assert.equal(firestore.snapshot(`publicUserProfiles/${uid}`).displayName, 'Invite Parent');
  assert.equal(
    firestore.snapshot('teams/team-1/players/player-1/private/profile').parents
      .some((parent) => parent.userId === uid),
    true
  );
  assert.equal(firestore.snapshot('users/organizer/familyMemberships/membership-1').status, 'active');
});

test('cleanupFailedInviteSignup restores invite state and deletes only an orphaned new parent profile', async () => {
  const uid = 'new-parent';
  const recentAuthRecord = {
    uid,
    metadata: { creationTime: new Date(Date.now() - 2 * 60 * 1000).toISOString() }
  };
  const { firestore, getUserCalls, mod } = loadFunctions(cleanupSeed({ uid }), {
    authUsers: { [uid]: recentAuthRecord }
  });

  const result = await mod.cleanupFailedInviteSignup({ code: 'PARENT1', userId: uid }, authContext(uid));

  assert.deepEqual(result, { recovered: true, inviteCount: 1, userDeleted: true });
  assert.deepEqual(getUserCalls, [uid]);

  const recoveredCode = firestore.snapshot('accessCodes/code-1');
  assert.equal(recoveredCode.used, false);
  assert.equal(recoveredCode.usedBy, null);
  assert.equal(recoveredCode.usedAt, null);
  assert.equal(Object.hasOwn(recoveredCode, 'status'), false);
  assert.equal(recoveredCode.failedSignupRecoveredBy, uid);
  assert.ok(recoveredCode.failedSignupRecoveredAt instanceof FakeTimestamp);

  assert.equal(firestore.snapshot(`users/${uid}`), undefined);
  assert.equal(firestore.snapshot(`publicUserProfiles/${uid}`), undefined);

  const privateProfile = firestore.snapshot('teams/team-1/players/player-1/private/profile');
  assert.deepEqual(privateProfile.parents, [{ userId: 'existing-parent', name: 'Existing Parent' }]);
  assert.ok(privateProfile.updatedAt instanceof FakeTimestamp);

  const membership = firestore.snapshot('users/organizer/familyMemberships/membership-1');
  assert.equal(membership.status, 'pending');
  assert.equal(Object.hasOwn(membership, 'userId'), false);
  assert.equal(Object.hasOwn(membership, 'acceptedAt'), false);
  assert.ok(membership.updatedAt instanceof FakeTimestamp);
});

test('cleanupFailedInviteSignup preserves users who have parent links outside the failed invite', async () => {
  const uid = 'multi-parent';
  const recentAuthRecord = {
    uid,
    metadata: { creationTime: new Date(Date.now() - 2 * 60 * 1000).toISOString() }
  };
  const { firestore, mod } = loadFunctions(cleanupSeed({ uid, includeOtherParentLink: true }), {
    authUsers: { [uid]: recentAuthRecord }
  });

  const result = await mod.cleanupFailedInviteSignup({ code: 'PARENT1', userId: uid }, authContext(uid));

  assert.deepEqual(result, { recovered: true, inviteCount: 1, userDeleted: false });

  const user = firestore.snapshot(`users/${uid}`);
  assert.deepEqual(user.parentOf, [{
    teamId: 'team-2',
    playerId: 'player-2',
    teamName: 'Lions',
    playerName: 'Blake'
  }]);
  assert.deepEqual(user.parentTeamIds, ['team-2']);
  assert.deepEqual(user.parentPlayerKeys, ['team-2::player-2']);
  assert.deepEqual(user.roles, ['parent']);

  const publicProfile = firestore.snapshot(`publicUserProfiles/${uid}`);
  assert.equal(publicProfile.displayName, 'Invite Parent');
  assert.deepEqual(publicProfile.discoveryTeamIds, ['team-2']);
  assert.ok(publicProfile.updatedAt instanceof FakeTimestamp);
});

test('cleanupInviteSignupOnAuthDelete uses the auth-delete record without fetching Auth again', async () => {
  const uid = 'delete-trigger-parent';
  const { firestore, getUserCalls, mod } = loadFunctions(cleanupSeed({ uid }), { authUsers: {} });

  const result = await mod.cleanupInviteSignupOnAuthDelete({
    uid,
    metadata: { creationTime: new Date(Date.now() - 60_000).toISOString() }
  });

  assert.equal(result, null);
  assert.deepEqual(getUserCalls, []);
  assert.equal(firestore.snapshot('accessCodes/code-1').used, false);
  assert.equal(firestore.snapshot(`users/${uid}`), undefined);
  assert.equal(firestore.snapshot(`publicUserProfiles/${uid}`), undefined);
});
