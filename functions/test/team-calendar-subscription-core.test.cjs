'use strict';

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createGetOrCreatePrivateTeamCalendarFeedHandler,
  createRawCalendarSubscriptionToken,
  normalizeCalendarSubscriptionId
} = require('../team-calendar-subscription-core.cjs');
const { cleanupAccountCalendarCredentials } = require('../account-deletion-core.cjs');
const { hashCalendarToken } = require('../team-calendar-feed-core.cjs');

class HttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function makeFirestore(seed = {}, { beforeFirstCommit = null } = {}) {
  const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  const writes = [];
  let transactionQueue = Promise.resolve();
  let pendingBeforeFirstCommit = beforeFirstCommit;

  function doc(path) {
    return { path, id: path.split('/').pop() };
  }

  function snapshot(ref) {
    const value = state.get(ref.path);
    return {
      id: ref.id,
      ref,
      exists: value !== undefined,
      data: () => clone(value)
    };
  }

  function collectionGroup(name, conditions = [], limitCount = Number.POSITIVE_INFINITY, afterPath = '') {
    return {
      where(field, operator, expected) {
        return collectionGroup(name, [...conditions, { field, operator, expected }], limitCount, afterPath);
      },
      orderBy() {
        return collectionGroup(name, conditions, limitCount, afterPath);
      },
      limit(count) {
        return collectionGroup(name, conditions, Math.max(0, Math.floor(Number(count) || 0)), afterPath);
      },
      startAfter(cursor) {
        return collectionGroup(name, conditions, limitCount, cursor?.ref?.path || '');
      },
      async get() {
        const docs = [...state.entries()]
          .filter(([entryPath]) => entryPath.split('/').at(-2) === name)
          .filter(([entryPath]) => !afterPath || entryPath > afterPath)
          .filter(([, value]) => conditions.every(({ field, operator, expected }) => {
            if (operator !== '==') throw new Error(`Unsupported operator: ${operator}`);
            return value?.[field] === expected;
          }))
          .sort(([left], [right]) => left.localeCompare(right))
          .slice(0, limitCount)
          .map(([entryPath]) => snapshot(doc(entryPath)));
        return { docs, size: docs.length, empty: docs.length === 0 };
      }
    };
  }

  function runTransaction(operation) {
    const result = transactionQueue.then(async () => {
      while (true) {
        const pendingWrites = [];
        const pendingDeletes = [];
        const transaction = {
          get: async (ref) => snapshot(ref),
          set(ref, value, options = {}) {
            pendingWrites.push({ ref, value: clone(value), options: clone(options) });
          },
          delete(ref) {
            pendingDeletes.push(ref);
          }
        };
        const operationResult = await operation(transaction);
        if (pendingBeforeFirstCommit) {
          const hook = pendingBeforeFirstCommit;
          pendingBeforeFirstCommit = null;
          await hook({
            set: (path, value) => state.set(path, clone(value))
          });
          continue;
        }
        pendingDeletes.forEach((ref) => {
          state.delete(ref.path);
          writes.push({ path: ref.path, deleted: true });
        });
        pendingWrites.forEach(({ ref, value, options }) => {
          const next = options.merge
            ? { ...(state.get(ref.path) || {}), ...value }
            : value;
          state.set(ref.path, clone(next));
          writes.push({ path: ref.path, value: clone(value), options: clone(options) });
        });
        return operationResult;
      }
    });
    transactionQueue = result.catch(() => undefined);
    return result;
  }

  return {
    doc,
    collectionGroup,
    runTransaction,
    get: (path) => clone(state.get(path)),
    set: (path, value) => state.set(path, clone(value)),
    delete: (path) => state.delete(path),
    paths: () => [...state.keys()],
    writes
  };
}

function makeTokenGenerator() {
  let value = 0;
  return () => {
    value += 1;
    return Buffer.alloc(32, value);
  };
}

function makeHandler({
  seed = {},
  authUsers = {},
  randomBytes = makeTokenGenerator(),
  assertFreshAuthUser = async () => {},
  beforeFirstCommit = null
} = {}) {
  const firestore = makeFirestore(seed, { beforeFirstCommit });
  let timestampSequence = 0;
  const handler = createGetOrCreatePrivateTeamCalendarFeedHandler({
    firestore,
    auth: {
      async getUser(uid) {
        const user = authUsers[uid];
        if (!user) {
          const error = new Error('Missing Auth user');
          error.code = 'auth/user-not-found';
          throw error;
        }
        return clone(user);
      }
    },
    HttpsError,
    randomBytes,
    assertFreshAuthUser,
    serverTimestamp: () => ({ __serverTimestamp: ++timestampSequence }),
    now: () => new Date('2026-09-01T12:00:00.000Z')
  });
  return { firestore, handler };
}

function ownerSeed() {
  return {
    'teams/team-1': { ownerId: 'owner-1', adminEmails: [] },
    'users/owner-1': { parentTeamIds: [] }
  };
}

function ownerAuth() {
  return {
    'owner-1': {
      uid: 'owner-1',
      email: 'owner@example.com',
      emailVerified: true,
      disabled: false
    }
  };
}

test('wires the authenticated callable while keeping subscription secrets and lookups client-inaccessible', () => {
  const functionsSource = readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const rulesSource = readFileSync(path.join(__dirname, '..', '..', 'firestore.rules'), 'utf8');

  assert.match(
    functionsSource,
    /const getPrivateTeamCalendarFeedTokenHandler\s*=\s*createGetOrCreatePrivateTeamCalendarFeedHandler/
  );
  assert.match(
    functionsSource,
    /assertFreshAuthUser:\s*async \(\{ authUser \}\) => \{[\s\S]*email_verified: authUser\.emailVerified === true[\s\S]*'private-team-calendar-feed'[\s\S]*!verification\.verified && !verification\.exempt/
  );
  assert.match(
    functionsSource,
    /exports\.getPrivateTeamCalendarFeedToken\s*=\s*functions\.https\.onCall\(getPrivateTeamCalendarFeedTokenHandler\)/
  );
  for (const collection of ['privateCalendarSubscriptions', 'calendarTokens']) {
    const explicitPrivateRule = rulesSource.match(
      new RegExp(`match /${collection}/\\{[^}]+\\} \\{([\\s\\S]*?)\\n\\s*\\}`)
    );
    assert.ok(explicitPrivateRule, `${collection} must have an explicit server-only rule`);
    assert.match(explicitPrivateRule[1], /allow read, write: if false;/);
  }
});

test('calendar subscription IDs preserve supported punctuation and reject unsafe original values', () => {
  assert.equal(normalizeCalendarSubscriptionId('uid.with:punctuation', 'uid'), 'uid.with:punctuation');
  for (const value of [null, 7, '', ' team-1', 'team-1 ', 'team/1', 'x'.repeat(129)]) {
    assert.throws(
      () => normalizeCalendarSubscriptionId(value, 'teamId'),
      (error) => error?.code === 'invalid-argument'
    );
  }
});

test('calendar subscription token generation requires 256 secure bits', () => {
  const token = createRawCalendarSubscriptionToken(() => Buffer.alloc(32, 7));
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.throws(() => createRawCalendarSubscriptionToken(() => Buffer.alloc(31, 7)), /generation failed/);
  assert.throws(() => createRawCalendarSubscriptionToken(() => 'not-bytes'), /generation failed/);
});

test('creates a per-principal secret and a raw-token-free hashed lookup atomically', async () => {
  const { firestore, handler } = makeHandler({ seed: ownerSeed(), authUsers: ownerAuth() });

  const result = await handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } });

  assert.equal(result.teamId, 'team-1');
  assert.equal(result.reused, false);
  assert.match(result.token, /^[A-Za-z0-9_-]{43}$/);
  const tokenHash = hashCalendarToken(result.token);
  assert.deepEqual(firestore.get('teams/team-1/privateCalendarSubscriptions/owner-1'), {
    schemaVersion: 1,
    teamId: 'team-1',
    uid: 'owner-1',
    rawToken: result.token,
    tokenHash,
    active: true,
    revoked: false,
    createdAt: { __serverTimestamp: 1 },
    updatedAt: { __serverTimestamp: 1 }
  });
  const lookup = firestore.get(`teams/team-1/calendarTokens/${tokenHash}`);
  assert.deepEqual(lookup, {
    schemaVersion: 1,
    teamId: 'team-1',
    uid: 'owner-1',
    tokenHash,
    active: true,
    revoked: false,
    createdAt: { __serverTimestamp: 1 },
    updatedAt: { __serverTimestamp: 1 }
  });
  assert.equal(Object.hasOwn(lookup, 'rawToken'), false);
  assert.equal(Object.hasOwn(lookup, 'token'), false);
});

test('reuses the exact committed credential after a response retry', async () => {
  const { firestore, handler } = makeHandler({ seed: ownerSeed(), authUsers: ownerAuth() });

  const first = await handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } });
  const second = await handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } });

  assert.equal(second.token, first.token);
  assert.equal(second.reused, true);
  assert.equal(
    firestore.paths().filter((path) => path.startsWith('teams/team-1/calendarTokens/')).length,
    1
  );
});

test('serializes concurrent creates to one durable token', async () => {
  const { firestore, handler } = makeHandler({ seed: ownerSeed(), authUsers: ownerAuth() });

  const [first, second] = await Promise.all([
    handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } }),
    handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } })
  ]);

  assert.equal(first.token, second.token);
  assert.deepEqual([first.reused, second.reused].sort(), [false, true]);
  assert.equal(
    firestore.paths().filter((path) => path.startsWith('teams/team-1/calendarTokens/')).length,
    1
  );
});

test('isolates reusable credentials by stable principal on the same team', async () => {
  const seed = {
    'teams/team-1': { ownerId: 'owner-1', adminEmails: [] },
    'users/owner-1': { parentTeamIds: [] },
    'users/parent-1': { parentTeamIds: ['team-1'] }
  };
  const authUsers = {
    ...ownerAuth(),
    'parent-1': { uid: 'parent-1', email: 'parent@example.com', disabled: false }
  };
  const { firestore, handler } = makeHandler({ seed, authUsers });

  const [ownerFeed, parentFeed] = await Promise.all([
    handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } }),
    handler({ teamId: 'team-1' }, { auth: { uid: 'parent-1' } })
  ]);

  assert.notEqual(ownerFeed.token, parentFeed.token);
  assert.equal(
    firestore.get(`teams/team-1/calendarTokens/${hashCalendarToken(ownerFeed.token)}`).uid,
    'owner-1'
  );
  assert.equal(
    firestore.get(`teams/team-1/calendarTokens/${hashCalendarToken(parentFeed.token)}`).uid,
    'parent-1'
  );
});

test('rotates revoked credentials and retires the proven old lookup', async () => {
  const { firestore, handler } = makeHandler({ seed: ownerSeed(), authUsers: ownerAuth() });
  const first = await handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } });
  const firstHash = hashCalendarToken(first.token);
  firestore.set('teams/team-1/privateCalendarSubscriptions/owner-1', {
    ...firestore.get('teams/team-1/privateCalendarSubscriptions/owner-1'),
    active: false,
    revoked: true
  });

  const second = await handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } });

  assert.notEqual(second.token, first.token);
  assert.equal(second.reused, false);
  assert.deepEqual(firestore.get(`teams/team-1/calendarTokens/${firstHash}`), {
    schemaVersion: 1,
    teamId: 'team-1',
    uid: 'owner-1',
    tokenHash: firstHash,
    active: false,
    revoked: true,
    createdAt: { __serverTimestamp: 1 },
    updatedAt: { __serverTimestamp: 1 },
    revokedAt: { __serverTimestamp: 2 },
    revokedReason: 'rotated'
  });
  assert.equal(
    firestore.get(`teams/team-1/calendarTokens/${hashCalendarToken(second.token)}`).active,
    true
  );
});

test('does not treat a missing hashed lookup as a reusable credential', async () => {
  const { firestore, handler } = makeHandler({ seed: ownerSeed(), authUsers: ownerAuth() });
  const first = await handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } });
  firestore.delete(`teams/team-1/calendarTokens/${hashCalendarToken(first.token)}`);

  const second = await handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } });

  assert.notEqual(second.token, first.token);
  assert.equal(second.reused, false);
  assert.equal(
    firestore.paths().filter((path) => path.startsWith('teams/team-1/calendarTokens/')).length,
    1
  );
});

test('authorizes current parent grants and current Auth email admin grants', async () => {
  const seed = {
    'teams/team-parent': { ownerId: 'coach-1', adminEmails: [] },
    'users/parent-1': { parentTeamIds: ['team-parent'] },
    'teams/team-admin': { ownerId: 'coach-1', adminEmails: ['admin@example.com'] },
    'users/admin-1': { email: 'stale@example.com', parentTeamIds: [] }
  };
  const authUsers = {
    'parent-1': { uid: 'parent-1', email: 'parent@example.com', disabled: false },
    'admin-1': { uid: 'admin-1', email: 'ADMIN@example.com', emailVerified: true, disabled: false }
  };
  const { handler } = makeHandler({ seed, authUsers });

  await assert.doesNotReject(() => handler(
    { teamId: 'team-parent' },
    { auth: { uid: 'parent-1' } }
  ));
  await assert.doesNotReject(() => handler(
    { teamId: 'team-admin' },
    { auth: { uid: 'admin-1' } }
  ));
});

test('fails closed for stale profile grants, changed or unverified Auth emails, and disabled Auth users', async () => {
  const seed = {
    'teams/team-1': { ownerId: 'coach-1', adminEmails: ['current@example.com'] },
    'users/user-1': {
      email: 'current@example.com',
      parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
    },
    'users/disabled-1': { parentTeamIds: ['team-1'] },
    'users/unverified-1': { parentTeamIds: [] }
  };
  const authUsers = {
    'user-1': { uid: 'user-1', email: 'changed@example.com', disabled: false },
    'disabled-1': { uid: 'disabled-1', email: 'parent@example.com', disabled: true },
    'unverified-1': { uid: 'unverified-1', email: 'current@example.com', emailVerified: false, disabled: false }
  };
  const { firestore, handler } = makeHandler({ seed, authUsers });

  await assert.rejects(
    handler({ teamId: 'team-1' }, { auth: { uid: 'user-1' } }),
    (error) => error?.code === 'permission-denied'
  );
  await assert.rejects(
    handler({ teamId: 'team-1' }, { auth: { uid: 'disabled-1' } }),
    (error) => error?.code === 'unauthenticated'
  );
  await assert.rejects(
    handler({ teamId: 'team-1' }, { auth: { uid: 'unverified-1' } }),
    (error) => error?.code === 'permission-denied'
  );
  assert.equal(firestore.writes.length, 0);
});

test('evaluates the sensitive-action policy against the fresh Admin Auth record', async () => {
  const observed = [];
  const { firestore, handler } = makeHandler({
    seed: ownerSeed(),
    authUsers: {
      'owner-1': {
        uid: 'owner-1',
        email: 'owner@example.com',
        emailVerified: false,
        disabled: false
      }
    },
    assertFreshAuthUser: async ({ authUser, context }) => {
      observed.push({ authUser, context });
      if (authUser.email && authUser.emailVerified !== true) {
        throw new HttpsError('failed-precondition', 'Verify your email before continuing.');
      }
    }
  });

  await assert.rejects(
    handler(
      { teamId: 'team-1' },
      { auth: { uid: 'owner-1', token: { email_verified: true } } }
    ),
    (error) => error?.code === 'failed-precondition'
  );
  assert.equal(observed.length, 1);
  assert.equal(observed[0].authUser.emailVerified, false);
  assert.equal(observed[0].context.auth.token.email_verified, true);
  assert.equal(firestore.writes.length, 0);
});

test('does not reuse an existing token after the caller loses current team access', async () => {
  const { firestore, handler } = makeHandler({ seed: ownerSeed(), authUsers: ownerAuth() });
  const first = await handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } });
  const writesAfterCreation = firestore.writes.length;
  firestore.set('teams/team-1', { ownerId: 'new-owner', adminEmails: [] });

  await assert.rejects(
    handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } }),
    (error) => error?.code === 'permission-denied'
  );

  assert.equal(firestore.writes.length, writesAfterCreation);
  assert.equal(
    firestore.get(`teams/team-1/calendarTokens/${hashCalendarToken(first.token)}`).uid,
    'owner-1'
  );
});

test('rejects creation and reuse while account deletion is pending', async () => {
  const seed = {
    ...ownerSeed(),
    'accountDeletionRequests/owner-1': { uid: 'owner-1', status: 'queued' }
  };
  const { firestore, handler } = makeHandler({ seed, authUsers: ownerAuth() });

  await assert.rejects(
    handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } }),
    (error) => error?.code === 'failed-precondition'
  );
  assert.equal(firestore.writes.length, 0);
});

test('retries and denies issuance when account deletion starts between transaction read and commit', async () => {
  const { firestore, handler } = makeHandler({
    seed: ownerSeed(),
    authUsers: ownerAuth(),
    beforeFirstCommit: async ({ set }) => {
      set('accountDeletionRequests/owner-1', { uid: 'owner-1', status: 'queued' });
    }
  });

  await assert.rejects(
    handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } }),
    (error) => error?.code === 'failed-precondition'
  );
  assert.equal(firestore.get('teams/team-1/privateCalendarSubscriptions/owner-1'), undefined);
  assert.equal(
    firestore.paths().filter((path) => path.startsWith('teams/team-1/calendarTokens/')).length,
    0
  );
  assert.equal(firestore.writes.length, 0);
});

test('removes a token that commits immediately before account deletion is requested', async () => {
  const { firestore, handler } = makeHandler({ seed: ownerSeed(), authUsers: ownerAuth() });
  const issued = await handler({ teamId: 'team-1' }, { auth: { uid: 'owner-1' } });
  const tokenHash = hashCalendarToken(issued.token);
  firestore.set('accountDeletionRequests/owner-1', { uid: 'owner-1', status: 'queued' });

  const cleanup = await cleanupAccountCalendarCredentials({
    firestore,
    uid: 'owner-1',
    documentIdField: '__name__'
  });

  assert.equal(cleanup.secretsDeleted, 1);
  assert.equal(cleanup.lookupsDeleted, 1);
  assert.equal(firestore.get('teams/team-1/privateCalendarSubscriptions/owner-1'), undefined);
  assert.equal(firestore.get(`teams/team-1/calendarTokens/${tokenHash}`), undefined);
});

test('rejects unauthenticated, malformed, missing-team, and missing-profile requests without writes', async () => {
  const { firestore, handler } = makeHandler({ seed: ownerSeed(), authUsers: ownerAuth() });

  await assert.rejects(
    handler({ teamId: 'team-1' }, {}),
    (error) => error?.code === 'unauthenticated'
  );
  await assert.rejects(
    handler({ teamId: 'team/1' }, { auth: { uid: 'owner-1' } }),
    (error) => error?.code === 'invalid-argument'
  );
  await assert.rejects(
    handler({ teamId: 'missing-team' }, { auth: { uid: 'owner-1' } }),
    (error) => error?.code === 'not-found'
  );

  firestore.set('teams/team-2', { ownerId: 'owner-2' });
  await assert.rejects(
    handler({ teamId: 'team-2' }, { auth: { uid: 'owner-1' } }),
    (error) => error?.code === 'permission-denied'
  );
  assert.equal(firestore.writes.length, 0);
});
