'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createCoParentInviteHandler } = require('../co-parent-invite-core.cjs');

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
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
      assert.equal(path, 'accessCodes');
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
        const transaction = {
          async get(target) {
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
            stagedCreates.push([ref.path, clone(value)]);
          },
          set(ref, value) {
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
  createInviteCode = () => 'COPE1234'
} = {}) {
  const store = createFirestore({
    'users/parent-1': { parentPlayerKeys: linked ? ['team-1::player-1'] : ['team-1::other-player'] },
    'teams/team-1': { name: 'Tigers' },
    'teams/team-1/players/player-1': { name: 'Sam' },
    ...initialDocs
  });
  const handler = createCoParentInviteHandler({
    firestore: store.firestore,
    Timestamp: { now: () => NOW, fromMillis: (millis) => ({ millis }) },
    HttpsError: TestHttpsError,
    createInviteCode
  });
  return {
    ...store,
    handler,
    context: { auth: { uid: 'parent-1' } }
  };
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
  const harness = createHarness();
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
