'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createParentInviteHandler } = require('../parent-invite-creation-core.cjs');
const { createInviteEmailOnCreateHandler } = require('../invite-email-trigger-core.cjs');

class TestHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const NOW_MILLIS = 1_777_777_777_000;
const NOW = Object.freeze({ seconds: NOW_MILLIS / 1000, nanoseconds: 0 });

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createFirestore(initialDocs = {}) {
  const docs = new Map(Object.entries(initialDocs).map(([path, value]) => [path, clone(value)]));
  const versions = new Map([...docs.keys()].map((path) => [path, 1]));
  const writes = [];

  function makeRef(path) {
    return { id: path.split('/').pop(), path };
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
      if (path !== 'accessCodes') {
        return { doc: (id) => makeRef(`${path}/${id}`) };
      }
      const filters = [];
      const query = {
        kind: 'query',
        path,
        filters,
        where(field, operator, expected) {
          assert.equal(operator, '==');
          filters.push({ field, expected });
          return query;
        },
        limit(value) {
          assert.equal(value, 10);
          return query;
        }
      };
      return query;
    },
    async runTransaction(handler) {
      for (;;) {
        const readVersions = new Map();
        const stagedCreates = [];
        const stagedSets = [];
        let writeStarted = false;
        const transaction = {
          async get(target) {
            assert.equal(writeStarted, false, 'transaction reads must precede writes');
            if (target.kind === 'query') {
              const matches = [...docs.entries()]
                .filter(([path, value]) => /^accessCodes\/[^/]+$/.test(path)
                  && target.filters.every(({ field, expected }) => value[field] === expected))
                .map(([path]) => makeSnapshot(path));
              return { docs: matches, empty: matches.length === 0 };
            }
            readVersions.set(target.path, versions.get(target.path) || 0);
            return makeSnapshot(target.path);
          },
          create(ref, value) {
            writeStarted = true;
            stagedCreates.push([ref.path, clone(value)]);
          },
          set(ref, value) {
            writeStarted = true;
            stagedSets.push([ref.path, clone(value)]);
          }
        };
        const result = await handler(transaction);
        const hasConflict = [...readVersions]
          .some(([path, version]) => (versions.get(path) || 0) !== version);
        if (hasConflict) continue;

        for (const [path, value] of stagedCreates) {
          assert.equal(docs.has(path), false, `create target already exists: ${path}`);
          docs.set(path, value);
          versions.set(path, (versions.get(path) || 0) + 1);
          writes.push([path, clone(value)]);
        }
        for (const [path, value] of stagedSets) {
          docs.set(path, value);
          versions.set(path, (versions.get(path) || 0) + 1);
          writes.push([path, clone(value)]);
        }
        return result;
      }
    }
  };

  return { firestore, docs, writes };
}

function createHarness({
  initialDocs = {},
  createInviteCode = () => 'PARENT12',
  senderMaxInvites = 10,
  recipientMaxInvites = 3
} = {}) {
  let nowMillis = NOW_MILLIS;
  const store = createFirestore({
    'users/owner-1': {},
    'users/admin-1': {},
    'users/platform-admin': { isAdmin: true },
    'users/unrelated-1': {},
    'teams/team-1': {
      name: 'Tigers',
      ownerId: 'owner-1',
      adminEmails: ['admin@example.com']
    },
    'teams/team-1/players/player-1': { name: 'Sam', number: '8' },
    'teams/team-1/players/player-2': { name: 'Alex', number: '9' },
    ...initialDocs
  });
  const createHandler = (overrides = {}) => createParentInviteHandler({
    firestore: store.firestore,
    Timestamp: {
      now: () => ({ seconds: nowMillis / 1000, nanoseconds: 0 }),
      fromMillis: (millis) => ({ millis })
    },
    HttpsError: TestHttpsError,
    createInviteCode,
    senderMaxInvites,
    recipientMaxInvites,
    ...overrides
  });
  return {
    ...store,
    handler: createHandler(),
    createHandler,
    setNowMillis: (value) => { nowMillis = value; },
    ownerContext: {
      auth: { uid: 'owner-1', token: { email: 'owner@example.com', email_verified: true } }
    },
    adminContext: {
      auth: { uid: 'admin-1', token: { email: 'admin@example.com', email_verified: true } }
    },
    platformAdminContext: {
      auth: { uid: 'platform-admin', token: { email: 'platform@example.com', email_verified: true } }
    },
    unrelatedContext: {
      auth: { uid: 'unrelated-1', token: { email: 'other@example.com', email_verified: true } }
    }
  };
}

function getDocsWithPrefix(docs, prefix) {
  return [...docs.entries()]
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, value]) => [path, clone(value)]);
}

function inviteInput(overrides = {}) {
  return {
    teamId: 'team-1',
    playerId: 'player-1',
    email: 'parent@example.com',
    relation: 'Guardian',
    ...overrides
  };
}

test('rejects unverified managers without persisting invite, limiter, or mail state', async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.handler(inviteInput(), {
      auth: { uid: 'owner-1', token: { email: 'owner@example.com', email_verified: false } }
    }),
    (error) => error.code === 'failed-precondition'
  );

  assert.deepEqual(harness.writes, []);
});

test('rejects unrelated and stale managers without persistence', async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.handler(inviteInput(), harness.unrelatedContext),
    (error) => error.code === 'permission-denied'
  );
  harness.docs.set('teams/team-1', {
    name: 'Tigers',
    ownerId: 'new-owner',
    adminEmails: []
  });
  await assert.rejects(
    harness.handler(inviteInput(), harness.ownerContext),
    (error) => error.code === 'permission-denied'
  );

  assert.deepEqual(harness.writes, []);
});

test('permits verified current owners, team admins, and platform admins', async () => {
  const codes = ['PARENT12', 'PARENT34', 'PARENT56'];
  const harness = createHarness({ createInviteCode: () => codes.shift() });

  const ownerResult = await harness.handler(inviteInput(), harness.ownerContext);
  const adminResult = await harness.handler(
    inviteInput({ playerId: 'player-2', email: 'second@example.com' }),
    harness.adminContext
  );
  const platformResult = await harness.handler(
    inviteInput({ email: 'third@example.com' }),
    harness.platformAdminContext
  );

  assert.equal(ownerResult.created, true);
  assert.equal(adminResult.created, true);
  assert.equal(platformResult.created, true);
  assert.equal(getDocsWithPrefix(harness.docs, 'accessCodes/').length, 3);
});

test('normalizes the recipient and reuses one active team, player, and recipient invite', async () => {
  const harness = createHarness({ senderMaxInvites: 1, recipientMaxInvites: 1 });
  const first = await harness.handler(
    inviteInput({ email: ' Parent@Example.COM ' }),
    harness.ownerContext
  );
  const repeated = await harness.handler(
    inviteInput({ email: 'parent@example.com' }),
    harness.ownerContext
  );

  assert.equal(first.created, true);
  assert.deepEqual(repeated, {
    id: first.id,
    code: first.code,
    teamName: 'Tigers',
    playerName: 'Sam',
    email: 'parent@example.com',
    created: false,
    reused: true
  });
  assert.equal(getDocsWithPrefix(harness.docs, 'accessCodes/').length, 1);
  assert.equal(getDocsWithPrefix(harness.docs, 'parentInviteRateLimits/').length, 2);
});

test('sender exhaustion creates no access code, mail, or partial recipient reservation', async () => {
  const codes = ['PARENT12', 'PARENT34'];
  const harness = createHarness({
    createInviteCode: () => codes.shift(),
    senderMaxInvites: 1,
    recipientMaxInvites: 10
  });
  await harness.handler(inviteInput({ email: 'first@example.com' }), harness.ownerContext);
  const before = clone([...harness.docs.entries()]);

  await assert.rejects(
    harness.handler(inviteInput({ email: 'second@example.com' }), harness.ownerContext),
    (error) => error.code === 'resource-exhausted'
  );

  assert.deepEqual([...harness.docs.entries()], before);
  assert.equal(getDocsWithPrefix(harness.docs, 'accessCodes/').length, 1);
  assert.equal(getDocsWithPrefix(harness.docs, 'mail/').length, 0);
  assert.equal(getDocsWithPrefix(harness.docs, 'parentInviteRateLimits/').length, 2);
});

test('normalized-recipient exhaustion creates no access code, mail, or partial sender reservation', async () => {
  const codes = ['PARENT12', 'PARENT34'];
  const harness = createHarness({
    createInviteCode: () => codes.shift(),
    senderMaxInvites: 10,
    recipientMaxInvites: 1
  });
  await harness.handler(inviteInput({ email: ' Shared@Example.com ' }), harness.ownerContext);
  const before = clone([...harness.docs.entries()]);

  await assert.rejects(
    harness.handler(
      inviteInput({ playerId: 'player-2', email: 'shared@EXAMPLE.COM' }),
      harness.adminContext
    ),
    (error) => error.code === 'resource-exhausted'
  );

  assert.deepEqual([...harness.docs.entries()], before);
  assert.equal(getDocsWithPrefix(harness.docs, 'accessCodes/').length, 1);
  assert.equal(getDocsWithPrefix(harness.docs, 'mail/').length, 0);
  assert.equal(getDocsWithPrefix(harness.docs, 'parentInviteRateLimits/').length, 2);
});

test('one callable creation triggers one initial mail while reuse and rejection add nothing', async () => {
  const codes = ['PARENT12', 'PARENT34'];
  const harness = createHarness({
    createInviteCode: () => codes.shift(),
    senderMaxInvites: 1,
    recipientMaxInvites: 10
  });
  const trigger = createInviteEmailOnCreateHandler({
    shouldQueueInviteEmail: (invite) => invite.type === 'parent_invite' && Boolean(invite.email),
    autoLinkParentInvite: async () => {},
    loadLatestInvite: async (snapshot) => snapshot.data(),
    queueInviteEmail: async (codeId, invite) => {
      const path = `mail/invite_${codeId}`;
      if (!harness.docs.has(path)) {
        harness.docs.set(path, { to: [invite.email], accessCodeId: codeId });
        harness.writes.push([path, clone(harness.docs.get(path))]);
      }
    }
  });

  const created = await harness.handler(inviteInput(), harness.ownerContext);
  const accessPath = `accessCodes/${created.code}`;
  await trigger({
    id: created.code,
    data: () => clone(harness.docs.get(accessPath))
  }, { params: { codeId: created.code } });
  const reused = await harness.handler(
    inviteInput({ email: ' PARENT@example.com ' }),
    harness.ownerContext
  );
  await assert.rejects(
    harness.handler(inviteInput({ email: 'other@example.com' }), harness.ownerContext),
    (error) => error.code === 'resource-exhausted'
  );

  assert.equal(created.created, true);
  assert.equal(reused.reused, true);
  assert.equal(getDocsWithPrefix(harness.docs, 'accessCodes/').length, 1);
  assert.equal(getDocsWithPrefix(harness.docs, 'mail/').length, 1);
});

test('manual share invites remain bounded and reusable without creating mail', async () => {
  const harness = createHarness({ senderMaxInvites: 1 });
  const first = await harness.handler(inviteInput({ email: '' }), harness.ownerContext);
  const repeated = await harness.handler(inviteInput({ email: '  ' }), harness.ownerContext);

  assert.equal(first.created, true);
  assert.equal(repeated.reused, true);
  assert.equal(getDocsWithPrefix(harness.docs, 'accessCodes/').length, 1);
  assert.equal(getDocsWithPrefix(harness.docs, 'parentInviteRateLimits/').length, 1);
  assert.equal(getDocsWithPrefix(harness.docs, 'mail/').length, 0);
});
