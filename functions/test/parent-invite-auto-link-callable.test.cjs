'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAutoAcceptParentInviteHandler } = require('../parent-invite-auto-link-callable.cjs');

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const NOW = Object.freeze({ seconds: 1_777_777_777, nanoseconds: 0 });

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createFirestore(initialDocs) {
  const docs = new Map(Object.entries(initialDocs).map(([path, value]) => [path, clone(value)]));
  const calls = { transactionCount: 0, updates: [] };

  function makeRef(path) {
    return {
      id: path.split('/').pop(),
      path,
      async get() {
        return makeSnapshot(path);
      }
    };
  }

  function makeSnapshot(path) {
    const exists = docs.has(path);
    return {
      id: path.split('/').pop(),
      ref: makeRef(path),
      exists,
      data: () => exists ? clone(docs.get(path)) : undefined
    };
  }

  const firestore = {
    doc: makeRef,
    collection(path) {
      return {
        where(field, operator, expected) {
          assert.equal(path, 'users');
          assert.equal(field, 'email');
          assert.equal(operator, '==');
          return {
            limit(count) {
              assert.equal(count, 1);
              return {
                async get() {
                  const matches = [...docs.entries()]
                    .filter(([docPath, value]) => /^users\/[^/]+$/.test(docPath) && value.email === expected)
                    .slice(0, count)
                    .map(([docPath]) => makeSnapshot(docPath));
                  return { empty: matches.length === 0, docs: matches };
                }
              };
            }
          };
        }
      };
    },
    async runTransaction(updateFn) {
      const stagedWrites = [];
      const transaction = {
        get: async (ref) => makeSnapshot(ref.path),
        set(ref, values, options) {
          stagedWrites.push([ref.path, clone(values), 'set', clone(options)]);
        },
        update(ref, values) {
          stagedWrites.push([ref.path, clone(values), 'update']);
        }
      };
      const result = await updateFn(transaction);
      for (const [path, values, operation, options] of stagedWrites) {
        if (operation === 'update') {
          assert.ok(docs.has(path), `transaction update target must exist: ${path}`);
        }
        const current = operation === 'set' && !options?.merge ? {} : docs.get(path) || {};
        docs.set(path, { ...current, ...clone(values) });
        calls.updates.push([path, clone(values), operation, clone(options)]);
      }
      calls.transactionCount += 1;
      return result;
    }
  };

  return {
    firestore,
    calls,
    read(path) {
      return clone(docs.get(path));
    }
  };
}

function createHarness({
  actorUid = 'owner-1',
  actorEmail = 'owner@example.com',
  authEmail = actorEmail,
  team = {},
  includeParent = true,
  privateProfile
} = {}) {
  const initialDocs = {
    'accessCodes/code-1': {
      type: 'parent_invite',
      teamId: 'team-1',
      playerId: 'player-1',
      playerNum: '7',
      email: 'parent@example.com',
      relation: 'Guardian',
      used: false
    },
    'teams/team-1': {
      name: 'First Team',
      ownerId: 'owner-1',
      adminEmails: [],
      ...team
    },
    'teams/team-1/players/player-1': {
      name: 'Player One',
      number: '7',
      photoUrl: 'https://images.example/player.png'
    },
    [`users/${actorUid}`]: {
      email: actorEmail,
      isAdmin: false
    }
  };
  if (includeParent) {
    initialDocs['users/parent-1'] = {
      email: 'parent@example.com',
      displayName: 'Pat Parent',
      roles: ['fan'],
      parentOf: [],
      parentTeamIds: [],
      parentPlayerKeys: []
    };
  }
  if (privateProfile !== undefined) {
    initialDocs['teams/team-1/players/player-1/private/profile'] = clone(privateProfile);
  }

  const store = createFirestore(initialDocs);
  const handler = createAutoAcceptParentInviteHandler({
    firestore: store.firestore,
    Timestamp: { now: () => NOW },
    HttpsError: TestHttpsError,
    normalizeFirestoreId(value, label) {
      const id = String(value || '').trim();
      if (!id || id.includes('/')) throw new TestHttpsError('invalid-argument', `${label} is invalid.`);
      return id;
    },
    validateCode(data) {
      if (data.type !== 'parent_invite' || data.used) {
        throw new TestHttpsError('failed-precondition', 'Parent invite is no longer available.');
      }
    },
    buildPublicProfilePayload(user, options) {
      return {
        displayName: user.displayName || null,
        discoveryTeamIds: clone(user.parentTeamIds),
        emailHash: `hash:${options.trustedEmail}`
      };
    }
  });

  return {
    ...store,
    handler,
    context: { auth: { uid: actorUid, token: { email: authEmail } } }
  };
}

test('non-global team owner can execute the callable path', async () => {
  const harness = createHarness();

  const result = await harness.handler({ codeId: 'code-1' }, harness.context);

  assert.deepEqual(result, { autoLinked: true, existingUser: true, userId: 'parent-1' });
  assert.equal(harness.calls.transactionCount, 1);
});

test('non-global adminEmails admin can execute the callable path', async () => {
  const harness = createHarness({
    actorUid: 'coach-1',
    actorEmail: 'Coach@Example.com',
    team: { adminEmails: ['coach@example.com'] }
  });

  const result = await harness.handler({ codeId: 'code-1' }, harness.context);

  assert.deepEqual(result, { autoLinked: true, existingUser: true, userId: 'parent-1' });
  assert.equal(harness.calls.transactionCount, 1);
});

test('stale profile email cannot restore legacy owner authorization', async () => {
  const harness = createHarness({
    actorUid: 'stale-owner',
    actorEmail: 'legacy-owner@example.com',
    authEmail: null,
    team: {
      ownerId: 'current-owner',
      ownerEmail: 'legacy-owner@example.com',
      ownerEmailLower: 'legacy-owner@example.com',
      adminEmails: ['legacy-owner@example.com']
    }
  });

  await assert.rejects(
    harness.handler({ codeId: 'code-1' }, harness.context),
    (error) => error.code === 'permission-denied'
  );
  assert.equal(harness.calls.transactionCount, 0);
});

test('ordinary non-admin coach cannot auto-link another user', async () => {
  const harness = createHarness({
    actorUid: 'coach-1',
    actorEmail: 'coach@example.com'
  });

  await assert.rejects(
    harness.handler({ codeId: 'code-1' }, harness.context),
    (error) => error.code === 'permission-denied'
  );
  assert.equal(harness.calls.transactionCount, 0);
  assert.deepEqual(harness.calls.updates, []);
});

test('ordinary non-admin coach cannot probe whether an invited email has an account', async () => {
  const harness = createHarness({
    actorUid: 'coach-1',
    actorEmail: 'coach@example.com',
    includeParent: false
  });

  await assert.rejects(
    harness.handler({ codeId: 'code-1' }, harness.context),
    (error) => error.code === 'permission-denied'
  );
  assert.equal(harness.calls.transactionCount, 0);
});

test('no existing user returns a stable negative result without transaction writes', async () => {
  const harness = createHarness({ includeParent: false });

  const result = await harness.handler({ codeId: 'code-1' }, harness.context);

  assert.deepEqual(result, { autoLinked: false, existingUser: false, reason: 'no-existing-user' });
  assert.equal(harness.calls.transactionCount, 0);
  assert.deepEqual(harness.calls.updates, []);
  assert.equal(harness.read('accessCodes/code-1').used, false);
});

test('existing user is linked to the player and invite atomically in one transaction', async () => {
  const harness = createHarness();

  await harness.handler({ codeId: 'code-1' }, harness.context);

  assert.equal(harness.calls.transactionCount, 1);
  assert.deepEqual(harness.calls.updates.map(([path]) => path), [
    'users/parent-1',
    'publicUserProfiles/parent-1',
    'teams/team-1/players/player-1/private/profile',
    'accessCodes/code-1'
  ]);
  assert.deepEqual(harness.read('users/parent-1'), {
    email: 'parent@example.com',
    displayName: 'Pat Parent',
    roles: ['fan', 'parent'],
    parentOf: [{
      teamId: 'team-1',
      playerId: 'player-1',
      teamName: 'First Team',
      playerName: 'Player One',
      playerNumber: '7',
      playerPhotoUrl: 'https://images.example/player.png',
      relation: 'Guardian'
    }],
    parentTeamIds: ['team-1'],
    parentPlayerKeys: ['team-1::player-1']
  });
  assert.deepEqual(harness.read('teams/team-1/players/player-1'), {
    name: 'Player One',
    number: '7',
    photoUrl: 'https://images.example/player.png'
  });
  assert.deepEqual(harness.read('publicUserProfiles/parent-1'), {
    displayName: 'Pat Parent',
    discoveryTeamIds: ['team-1'],
    emailHash: 'hash:parent@example.com',
    updatedAt: NOW
  });
  assert.deepEqual(harness.read('teams/team-1/players/player-1/private/profile'), {
    parents: [{
      userId: 'parent-1',
      email: 'parent@example.com',
      relation: 'Guardian',
      addedAt: NOW
    }]
  });
  assert.deepEqual(harness.read('accessCodes/code-1'), {
    type: 'parent_invite',
    teamId: 'team-1',
    playerId: 'player-1',
    playerNum: '7',
    email: 'parent@example.com',
    relation: 'Guardian',
    used: true,
    usedBy: 'parent-1',
    usedAt: NOW,
    status: 'accepted',
    autoAccepted: true,
    autoAcceptedAt: NOW
  });
});

test('auto-link preserves an existing private parent link without duplicating it', async () => {
  const existingParent = {
    userId: 'parent-1',
    email: 'existing@example.com',
    relation: 'Parent',
    addedAt: { seconds: 1_700_000_000, nanoseconds: 0 }
  };
  const harness = createHarness({
    privateProfile: {
      medicalNotes: 'private',
      parents: [existingParent]
    }
  });

  await harness.handler({ codeId: 'code-1' }, harness.context);

  assert.deepEqual(harness.read('teams/team-1/players/player-1/private/profile'), {
    medicalNotes: 'private',
    parents: [existingParent]
  });
  assert.equal(harness.read('teams/team-1/players/player-1').parents, undefined);
});

test('a repeated auto-link call returns the completed result without another transaction', async () => {
  const harness = createHarness();

  await harness.handler({ codeId: 'code-1' }, harness.context);
  const repeated = await harness.handler({ codeId: 'code-1' }, harness.context);

  assert.deepEqual(repeated, { autoLinked: true, existingUser: true, userId: 'parent-1' });
  assert.equal(harness.calls.transactionCount, 1);
});

test('a completed auto-link still requires current team-manager access', async () => {
  const harness = createHarness();
  await harness.handler({ codeId: 'code-1' }, harness.context);

  await assert.rejects(
    harness.handler(
      { codeId: 'code-1' },
      { auth: { uid: 'parent-1', token: { email: 'parent@example.com' } } }
    ),
    (error) => error.code === 'permission-denied'
  );
  assert.equal(harness.calls.transactionCount, 1);
});
