'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCoParentInviteHandler } = require('../co-parent-invite-core.cjs');

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
  let transactionAttempts = 0;

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
        where(field, operator, expected) {
          assert.equal(operator, '==');
          filters.push({ field, expected });
          return query;
        }
      };
      return Object.assign(query, { kind: 'query', path, filters });
    },
    async runTransaction(handler) {
      for (;;) {
        transactionAttempts += 1;
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

  return { firestore, docs, writes, getTransactionAttempts: () => transactionAttempts };
}

function createHarness({
  linked = true,
  initialDocs = {},
  createInviteCode = () => 'COPE1234',
  rateLimitWindowMs = 24 * 60 * 60 * 1000,
  senderMaxInvites = 10,
  recipientMaxInvites = 3
} = {}) {
  let nowMillis = NOW_MILLIS;
  const store = createFirestore({
    'users/parent-1': { parentPlayerKeys: linked ? ['team-1::player-1'] : ['team-1::other-player'] },
    'users/parent-2': { parentPlayerKeys: ['team-1::player-2'] },
    'teams/team-1': { name: 'Tigers' },
    'teams/team-1/players/player-1': { name: 'Sam' },
    'teams/team-1/players/player-2': { name: 'Alex' },
    ...initialDocs
  });
  const createHandler = (overrides = {}) => createCoParentInviteHandler({
    firestore: store.firestore,
    Timestamp: {
      now: () => ({ seconds: nowMillis / 1000, nanoseconds: 0 }),
      fromMillis: (millis) => ({ millis })
    },
    HttpsError: TestHttpsError,
    createInviteCode,
    rateLimitWindowMs,
    senderMaxInvites,
    recipientMaxInvites,
    ...overrides
  });
  const handler = createHandler();
  return {
    ...store,
    handler,
    createHandler,
    setNowMillis: (value) => { nowMillis = value; },
    context: { auth: { uid: 'parent-1' } },
    secondContext: { auth: { uid: 'parent-2' } }
  };
}

function getDocsWithPrefix(docs, prefix) {
  return [...docs.entries()]
    .filter(([path]) => path.startsWith(prefix))
    .map(([path, value]) => [path, clone(value)]);
}

test('rejects unauthenticated callers without creating access or mail records', async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.handler({ teamId: 'team-1', playerId: 'player-1', email: 'parent@example.com' }, {}),
    (error) => error.code === 'unauthenticated'
  );

  assert.deepEqual(harness.writes, []);
  assert.equal([...harness.docs.keys()].some((path) => path.startsWith('mail/')), false);
});

test('rejects a caller without the exact team and player linkage without writes', async () => {
  const harness = createHarness({ linked: false });

  await assert.rejects(
    harness.handler(
      { teamId: 'team-1', playerId: 'player-1', email: 'parent@example.com' },
      harness.context
    ),
    (error) => error.code === 'permission-denied'
  );

  assert.deepEqual(harness.writes, []);
});

test('rejects a legacy parentOf link without an exact parentPlayerKeys linkage', async () => {
  const harness = createHarness({
    initialDocs: {
      'users/parent-1': {
        parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
      }
    }
  });

  await assert.rejects(
    harness.handler(
      { teamId: 'team-1', playerId: 'player-1', email: 'coparent@example.com' },
      harness.context
    ),
    (error) => error.code === 'permission-denied'
  );

  assert.deepEqual(harness.writes, []);
});

test('creates one active invite from authoritative team and player data', async () => {
  const harness = createHarness();

  const result = await harness.handler(
    { teamId: 'team-1', playerId: 'player-1', email: '  CoParent@Example.COM  ' },
    harness.context
  );

  assert.equal(result.created, true);
  assert.equal(result.reused, false);
  assert.equal(result.email, 'coparent@example.com');
  const accessCodeWrites = harness.writes.filter(([path]) => path.startsWith('accessCodes/'));
  assert.equal(accessCodeWrites.length, 1);
  assert.deepEqual(accessCodeWrites[0][1], {
    code: 'COPE1234',
    type: 'coparent_invite',
    teamId: 'team-1',
    playerId: 'player-1',
    playerName: 'Sam',
    teamName: 'Tigers',
    email: 'coparent@example.com',
    generatedBy: 'parent-1',
    createdAt: NOW,
    expiresAt: { millis: NOW_MILLIS + 7 * 24 * 60 * 60 * 1000 },
    used: false,
    usedBy: null,
    usedAt: null
  });
  assert.equal(harness.writes.filter(([path]) => path.includes('/inviteIdempotency/')).length, 1);
});

test('reuses the active invite for equivalent recipient case and whitespace', async () => {
  const harness = createHarness({ senderMaxInvites: 1, recipientMaxInvites: 1 });
  const first = await harness.handler(
    { teamId: 'team-1', playerId: 'player-1', email: ' CoParent@Example.com ' },
    harness.context
  );
  const repeated = await harness.handler(
    { teamId: 'team-1', playerId: 'player-1', email: 'coparent@example.COM' },
    harness.context
  );

  assert.equal(first.created, true);
  assert.deepEqual(repeated, {
    id: first.id,
    code: first.code,
    teamName: 'Tigers',
    playerName: 'Sam',
    email: 'coparent@example.com',
    created: false,
    reused: true
  });
  assert.equal(harness.writes.filter(([path]) => path.startsWith('accessCodes/')).length, 1);
  assert.equal([...harness.docs.keys()].filter((path) => path.startsWith('accessCodes/')).length, 1);
  const rateLimitWrites = harness.writes.filter(([path]) => path.startsWith('coParentInviteRateLimits/'));
  assert.equal(rateLimitWrites.length, 2);
  assert.deepEqual(rateLimitWrites.map(([, value]) => value.count), [1, 1]);
});

test('concurrent calls retry the idempotency conflict and return the same invite', async () => {
  const codes = ['COPE1234', 'COPE5678'];
  const harness = createHarness({ createInviteCode: () => codes.shift() });

  const [first, second] = await Promise.all([
    harness.handler(
      { teamId: 'team-1', playerId: 'player-1', email: 'CoParent@example.com' },
      harness.context
    ),
    harness.handler(
      { teamId: 'team-1', playerId: 'player-1', email: ' coparent@EXAMPLE.com ' },
      harness.context
    )
  ]);

  assert.equal(harness.getTransactionAttempts(), 3);
  assert.equal(first.code, second.code);
  assert.equal(first.created || second.created, true);
  assert.equal(first.reused || second.reused, true);
  assert.equal(harness.writes.filter(([path]) => path.startsWith('accessCodes/')).length, 1);
  assert.equal([...harness.docs.keys()].filter((path) => path.startsWith('accessCodes/')).length, 1);
  assert.equal(harness.writes.filter(([path]) => path.startsWith('coParentInviteRateLimits/')).length, 2);
  assert.deepEqual(
    getDocsWithPrefix(harness.docs, 'coParentInviteRateLimits/').map(([, value]) => value.count),
    [1, 1]
  );
});

test('rejects sender exhaustion without persisting an invite or partial recipient reservation', async () => {
  const codes = ['COPE1234', 'COPE5678'];
  const harness = createHarness({
    createInviteCode: () => codes.shift(),
    senderMaxInvites: 1,
    recipientMaxInvites: 10
  });
  await harness.handler(
    { teamId: 'team-1', playerId: 'player-1', email: 'first@example.com' },
    harness.context
  );
  harness.setNowMillis(NOW_MILLIS + 60 * 60 * 1000);
  const docsBefore = clone([...harness.docs.entries()]);
  const writesBefore = clone(harness.writes);

  await assert.rejects(
    harness.handler(
      { teamId: 'team-1', playerId: 'player-1', email: 'second@example.com' },
      harness.context
    ),
    (error) => {
      assert.equal(error.code, 'resource-exhausted');
      assert.equal(error.details.retryAfterSeconds, 23 * 60 * 60);
      return true;
    }
  );

  assert.deepEqual([...harness.docs.entries()], docsBefore);
  assert.deepEqual(harness.writes, writesBefore);
  assert.equal(getDocsWithPrefix(harness.docs, 'accessCodes/').length, 1);
  assert.equal(getDocsWithPrefix(harness.docs, 'coParentInviteRateLimits/').length, 2);
  assert.equal(getDocsWithPrefix(harness.docs, 'mail/').length, 0);
});

test('persists normalized-recipient exhaustion across callable instances and invite identifiers', async () => {
  const codes = ['COPE1234', 'COPE5678'];
  const harness = createHarness({
    createInviteCode: () => codes.shift(),
    senderMaxInvites: 10,
    recipientMaxInvites: 1
  });
  const secondHandler = harness.createHandler();
  await harness.handler(
    { teamId: 'team-1', playerId: 'player-1', email: ' Shared@Example.com ' },
    harness.context
  );
  const docsBefore = clone([...harness.docs.entries()]);
  const writesBefore = clone(harness.writes);

  await assert.rejects(
    secondHandler(
      { teamId: 'team-1', playerId: 'player-2', email: 'shared@EXAMPLE.COM' },
      harness.secondContext
    ),
    (error) => error.code === 'resource-exhausted'
  );

  assert.deepEqual([...harness.docs.entries()], docsBefore);
  assert.deepEqual(harness.writes, writesBefore);
  assert.equal(getDocsWithPrefix(harness.docs, 'accessCodes/').length, 1);
  assert.equal(getDocsWithPrefix(harness.docs, 'coParentInviteRateLimits/').length, 2);
  assert.equal(getDocsWithPrefix(harness.docs, 'mail/').length, 0);
});

test('concurrent requests cannot exceed the sender limit or leave a partial reservation', async () => {
  const codes = ['COPE1234', 'COPE5678'];
  const harness = createHarness({
    createInviteCode: () => codes.shift(),
    senderMaxInvites: 1,
    recipientMaxInvites: 10
  });

  const results = await Promise.allSettled([
    harness.handler(
      { teamId: 'team-1', playerId: 'player-1', email: 'first@example.com' },
      harness.context
    ),
    harness.handler(
      { teamId: 'team-1', playerId: 'player-1', email: 'second@example.com' },
      harness.context
    )
  ]);

  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  const rejected = results.find(({ status }) => status === 'rejected');
  assert.equal(rejected.reason.code, 'resource-exhausted');
  assert.equal(getDocsWithPrefix(harness.docs, 'accessCodes/').length, 1);
  assert.equal(getDocsWithPrefix(harness.docs, 'coParentInviteRateLimits/').length, 2);
  assert.deepEqual(
    getDocsWithPrefix(harness.docs, 'coParentInviteRateLimits/').map(([, value]) => value.count),
    [1, 1]
  );
});

test('does not reuse an expired invite', async () => {
  const harness = createHarness({
    initialDocs: {
      'accessCodes/old-code': {
        code: 'OLDX1234',
        type: 'coparent_invite',
        teamId: 'team-1',
        playerId: 'player-1',
        email: 'coparent@example.com',
        used: false,
        expiresAt: { millis: NOW_MILLIS - 1 }
      }
    }
  });

  const result = await harness.handler(
    { teamId: 'team-1', playerId: 'player-1', email: 'coparent@example.com' },
    harness.context
  );

  assert.equal(result.created, true);
  assert.equal(harness.writes.filter(([path]) => path.startsWith('accessCodes/')).length, 1);
});
