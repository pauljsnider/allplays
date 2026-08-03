'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { deleteApp, initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const {
  createFriendInviteRedemptionCallableHandler,
  createFriendInviteRedemptionTransaction,
  extractVerifiedFriendInviteRecipientIdentities
} = require('../friend-invite-redemption-core.cjs');

class TestHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const GENERIC_ERROR = Object.freeze({
  code: 'permission-denied',
  message: 'Unable to redeem friend invite.'
});

function extract(auth) {
  return extractVerifiedFriendInviteRecipientIdentities(auth, TestHttpsError);
}

function assertGenericRejection(auth, sensitiveValues = []) {
  assert.throws(() => extract(auth), (error) => {
    assert.equal(error.code, GENERIC_ERROR.code);
    assert.equal(error.message, GENERIC_ERROR.message);
    assert.equal(error.details, undefined);

    const serialized = JSON.stringify({
      code: error.code,
      message: error.message,
      details: error.details
    });
    for (const value of sensitiveValues) {
      assert.equal(serialized.includes(value), false);
    }
    return true;
  });
}

test('extracts a normalized verified email identity', () => {
  assert.deepEqual(extract({
    uid: ' user-1 ',
    token: {
      email: ' Recipient@Example.COM ',
      email_verified: true
    }
  }), {
    uid: ' user-1 ',
    email: 'recipient@example.com',
    phone: ''
  });
});

test('extracts a canonical Firebase phone identity', () => {
  assert.deepEqual(extract({
    uid: 'user-1',
    token: { phone_number: '+13125551212' }
  }), {
    uid: 'user-1',
    email: '',
    phone: '+13125551212'
  });
});

test('extracts both usable verified identities', () => {
  assert.deepEqual(extract({
    uid: 'user-1',
    token: {
      email: 'RECIPIENT@example.com',
      email_verified: true,
      phone_number: '+442079460123'
    }
  }), {
    uid: 'user-1',
    email: 'recipient@example.com',
    phone: '+442079460123'
  });
});

test('keeps a usable verified identity when the other claim is unusable', () => {
  assert.deepEqual(extract({
    uid: 'user-1',
    token: {
      email: 'unverified@example.com',
      email_verified: false,
      phone_number: '+13125551212'
    }
  }), {
    uid: 'user-1',
    email: '',
    phone: '+13125551212'
  });

  assert.deepEqual(extract({
    uid: 'user-1',
    token: {
      email: 'verified@example.com',
      email_verified: true,
      phone_number: '(312) 555-1212'
    }
  }), {
    uid: 'user-1',
    email: 'verified@example.com',
    phone: ''
  });
});

test('rejects unauthenticated and identity-less callers with one generic error', () => {
  const rejectedAuth = [
    undefined,
    {},
    { uid: 123, token: { phone_number: '+13125551212' } },
    { uid: '   ', token: {} },
    { uid: 'user-1' },
    { uid: 'user-1', token: [] },
    { uid: 'user-1', token: {} },
    {
      uid: 'user-1',
      token: {},
      email: 'payload@example.com',
      phone_number: '+13125551212',
      profile: { email: 'profile@example.com' }
    }
  ];

  for (const auth of rejectedAuth) {
    assertGenericRejection(auth, ['target@example.com', '+13125551212', 'inviter-1']);
  }
});

test('rejects unverified email claims with one generic error', () => {
  for (const verified of [undefined, false, 1, 'true']) {
    assertGenericRejection({
      uid: 'user-1',
      token: {
        email: 'unverified@example.com',
        email_verified: verified
      }
    }, ['unverified@example.com']);
  }
});

test('rejects malformed verified email claims with one generic error', () => {
  const malformedEmails = [
    '',
    '   ',
    'recipient',
    'recipient@',
    '@example.com',
    'recipient@example',
    'recipient @example.com',
    { address: 'recipient@example.com' }
  ];

  for (const email of malformedEmails) {
    assertGenericRejection({
      uid: 'user-1',
      token: { email, email_verified: true }
    }, ['recipient@example.com', 'inviter-name']);
  }
});

test('rejects malformed phone claims with one generic error', () => {
  const malformedPhones = [
    '',
    '   ',
    '3125551212',
    '+1 (312) 555-1212',
    ' +13125551212 ',
    '+0123456789',
    '+1234567',
    '+1234567890123456',
    { number: '+13125551212' }
  ];

  for (const phone_number of malformedPhones) {
    assertGenericRejection({
      uid: 'user-1',
      token: { phone_number }
    }, ['+13125551212', 'invite-target', 'inviter-1']);
  }
});

function createCallableHarness({ result = { success: true }, rejection } = {}) {
  const calls = [];
  const redeemTransaction = async (input) => {
    calls.push(input);
    if (rejection) throw rejection;
    return result;
  };
  const handler = createFriendInviteRedemptionCallableHandler({
    redeemTransaction,
    HttpsError: TestHttpsError
  });
  return { calls, handler };
}

async function assertGenericCallableRejection(promise, sensitiveValues = []) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, GENERIC_ERROR.code);
    assert.equal(error.message, GENERIC_ERROR.message);
    assert.equal(error.details, undefined);
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
    for (const value of sensitiveValues) assert.equal(serialized.includes(value), false);
    return true;
  });
}

test('callable rejects unauthenticated and payload-only identity before redemption', async () => {
  for (const context of [undefined, {}, { auth: { uid: 'recipient-1', token: {} } }]) {
    const harness = createCallableHarness();
    await assertGenericCallableRejection(harness.handler({
      code: 'FRIEND01',
      uid: 'payload-user',
      email: 'payload@example.com',
      phone: '+13125551212',
      recipientIdentities: {
        uid: 'payload-user',
        email: 'payload@example.com',
        phone: '+13125551212'
      }
    }, context), ['payload-user', 'payload@example.com', '+13125551212', 'FRIEND01']);
    assert.deepEqual(harness.calls, []);
  }
});

test('callable forwards only verified Auth identities and the request code', async () => {
  const result = { success: true, friendshipId: 'inviter-1__recipient-1' };
  const harness = createCallableHarness({ result });
  const response = await harness.handler({
    code: ' friend01 ',
    uid: 'victim-uid',
    userId: 'victim-user-id',
    email: 'victim@example.com',
    phone: '+14155550100',
    phone_number: '+14155550101',
    recipientIdentities: {
      uid: 'victim-uid',
      email: 'victim@example.com',
      phone: '+14155550100'
    },
    profile: { email: 'profile@example.com', phone: '+14155550102' },
    fallbackIdentity: { email: 'fallback@example.com' }
  }, {
    auth: {
      uid: 'recipient-1',
      token: {
        email: ' Recipient@Example.COM ',
        email_verified: true,
        phone_number: '+13125551212'
      }
    }
  });

  assert.strictEqual(response, result);
  assert.deepEqual(harness.calls, [{
    code: ' friend01 ',
    recipientIdentities: {
      uid: 'recipient-1',
      email: 'recipient@example.com',
      phone: '+13125551212'
    }
  }]);
});

test('callable maps every redemption failure to one metadata-free public error', async () => {
  const sensitiveValues = [
    'target@example.com',
    '+13125551212',
    'inviter-1',
    'Invite Sender',
    'FRIEND01',
    'identity-mismatch'
  ];
  for (const rejection of [
    new TestHttpsError('failed-precondition', 'identity-mismatch', {
      inviteTarget: 'target@example.com',
      inviterUid: 'inviter-1'
    }),
    new Error('Invite Sender +13125551212 FRIEND01')
  ]) {
    const harness = createCallableHarness({ rejection });
    await assertGenericCallableRejection(harness.handler({ code: 'FRIEND01' }, {
      auth: {
        uid: 'recipient-1',
        token: { email: 'recipient@example.com', email_verified: true }
      }
    }), sensitiveValues);
    assert.equal(harness.calls.length, 1);
  }
});

test('functions index registers the authenticated friend invite redemption callable', () => {
  const source = readFileSync(new URL('../index.js', `file://${__filename}`), 'utf8');
  assert.match(source, /createFriendInviteRedemptionCallableHandler/);
  assert.match(source, /exports\.redeemFriendInvite\s*=\s*functions\.https\.onCall\(/);
});

const NOW_MILLIS = Date.parse('2026-08-02T21:00:00.000Z');

class FakeTimestamp {
  constructor(milliseconds) {
    this.milliseconds = Number(milliseconds);
  }

  toMillis() {
    return this.milliseconds;
  }

  static now() {
    return new FakeTimestamp(NOW_MILLIS);
  }

  static fromMillis(milliseconds) {
    return new FakeTimestamp(milliseconds);
  }
}

function clone(value) {
  if (value instanceof FakeTimestamp) return FakeTimestamp.fromMillis(value.toMillis());
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function comparableState(docs) {
  function normalize(value) {
    if (value instanceof FakeTimestamp) return { milliseconds: value.toMillis() };
    if (Array.isArray(value)) return value.map(normalize);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalize(entry)]));
  }

  return [...docs.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([docPath, value]) => [docPath, normalize(value)]);
}

function createFirestore(initialDocs = {}, { failAfterCallback = false } = {}) {
  const docs = new Map(Object.entries(initialDocs).map(([docPath, value]) => [docPath, clone(value)]));
  const metrics = {
    transactionCalls: 0,
    committedBatches: []
  };
  let queue = Promise.resolve();

  function makeRef(docPath) {
    return { path: docPath, id: docPath.split('/').pop() };
  }

  function makeSnapshot(ref) {
    const exists = docs.has(ref.path);
    return {
      id: ref.id,
      ref,
      exists,
      data: () => exists ? clone(docs.get(ref.path)) : undefined
    };
  }

  const firestore = {
    doc: makeRef,
    runTransaction(callback) {
      const execute = async () => {
        metrics.transactionCalls += 1;
        const staged = [];
        let writeStarted = false;
        const transaction = {
          async get(ref) {
            assert.equal(writeStarted, false, 'all transaction reads must precede writes');
            return makeSnapshot(ref);
          },
          set(ref, value) {
            writeStarted = true;
            staged.push({ type: 'set', ref, value: clone(value) });
          },
          update(ref, value) {
            writeStarted = true;
            staged.push({ type: 'update', ref, value: clone(value) });
          }
        };

        const result = await callback(transaction);
        if (failAfterCallback) throw new Error('injected transaction failure');
        for (const operation of staged) {
          if (operation.type === 'update' && !docs.has(operation.ref.path)) {
            throw new Error(`Missing document: ${operation.ref.path}`);
          }
        }
        for (const operation of staged) {
          const previous = docs.get(operation.ref.path) || {};
          docs.set(operation.ref.path, operation.type === 'update'
            ? { ...clone(previous), ...clone(operation.value) }
            : clone(operation.value));
        }
        metrics.committedBatches.push(staged.map((operation) => operation.ref.path));
        return result;
      };

      const pending = queue.then(execute, execute);
      queue = pending.catch(() => {});
      return pending;
    }
  };

  return { firestore, docs, metrics };
}

function activeInvite(overrides = {}) {
  return {
    code: 'FRIEND01',
    type: 'friend_invite',
    generatedBy: 'inviter-1',
    email: 'recipient@example.com',
    phone: null,
    inviterProfile: {
      displayName: 'Invite Sender',
      discoveryTeamIds: ['team-1']
    },
    expiresAt: FakeTimestamp.fromMillis(NOW_MILLIS + 60_000),
    used: false,
    usedBy: null,
    usedAt: null,
    ...overrides
  };
}

function createTransactionHarness({ invite = activeInvite(), friendship = null, failAfterCallback = false } = {}) {
  const initialDocs = {
    'accessCodes/FRIEND01': invite,
    'users/recipient-1': {
      fullName: 'Recipient One',
      parentTeamIds: ['team-1']
    }
  };
  if (friendship) initialDocs['friendships/inviter-1__recipient-1'] = friendship;
  const store = createFirestore(initialDocs, { failAfterCallback });
  const logEvents = [];
  const redeem = createFriendInviteRedemptionTransaction({
    firestore: store.firestore,
    Timestamp: FakeTimestamp,
    HttpsError: TestHttpsError,
    logger: {
      warn: (message, fields) => logEvents.push({ level: 'warn', message, fields }),
      error: (message, fields) => logEvents.push({ level: 'error', message, fields })
    }
  });
  return { ...store, redeem, logEvents };
}

function verifiedIdentities(overrides = {}) {
  return {
    uid: 'recipient-1',
    email: 'recipient@example.com',
    phone: '',
    ...overrides
  };
}

async function expectGenericTransactionRejection(promise) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, GENERIC_ERROR.code);
    assert.equal(error.message, GENERIC_ERROR.message);
    assert.equal(error.details, undefined);
    return true;
  });
}

const emulatorTest = process.env.FIRESTORE_EMULATOR_HOST ? test : test.skip;

function normalizeEmulatorValue(value) {
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(normalizeEmulatorValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, normalizeEmulatorValue(entry)])
  );
}

async function readEmulatorRedemptionState(firestore, inviteRef, friendshipRef) {
  const [inviteSnapshot, friendshipSnapshot] = await firestore.getAll(inviteRef, friendshipRef);
  return {
    invite: {
      data: normalizeEmulatorValue(inviteSnapshot.data()),
      updateTime: inviteSnapshot.updateTime.toMillis()
    },
    friendship: {
      data: normalizeEmulatorValue(friendshipSnapshot.data()),
      updateTime: friendshipSnapshot.updateTime.toMillis()
    }
  };
}

async function exerciseEmulatorRedemption(t, { inviteTarget, authToken }) {
  const fixtureId = randomUUID().replace(/-/g, '');
  const code = fixtureId.slice(0, 8).toUpperCase();
  const inviterUid = `inviter-${fixtureId}`;
  const recipientUid = `recipient-${fixtureId}`;
  const friendshipId = [inviterUid, recipientUid].sort().join('__');
  const app = initializeApp(
    { projectId: process.env.GCLOUD_PROJECT || 'demo-allplays' },
    `friend-invite-redemption-${fixtureId}`
  );
  const firestore = getFirestore(app);
  const inviteRef = firestore.doc(`accessCodes/${code}`);
  const recipientRef = firestore.doc(`users/${recipientUid}`);
  const friendshipRef = firestore.doc(`friendships/${friendshipId}`);

  t.after(async () => {
    const cleanup = firestore.batch();
    cleanup.delete(inviteRef);
    cleanup.delete(recipientRef);
    cleanup.delete(friendshipRef);
    try {
      await cleanup.commit();
    } finally {
      await deleteApp(app);
    }
  });

  const seed = firestore.batch();
  seed.set(inviteRef, {
    code,
    type: 'friend_invite',
    generatedBy: inviterUid,
    email: inviteTarget.email ?? null,
    phone: inviteTarget.phone ?? null,
    inviterProfile: {
      displayName: 'Invite Sender',
      discoveryTeamIds: ['team-emulator']
    },
    expiresAt: Timestamp.fromMillis(Date.now() + (5 * 60_000)),
    used: false,
    usedBy: null,
    usedAt: null
  });
  seed.set(recipientRef, {
    fullName: 'Recipient One',
    parentTeamIds: ['team-emulator']
  });
  await seed.commit();

  const redeemTransaction = createFriendInviteRedemptionTransaction({
    firestore,
    Timestamp,
    HttpsError: TestHttpsError,
    logger: { warn() {}, error() {} }
  });
  const callable = createFriendInviteRedemptionCallableHandler({
    redeemTransaction,
    HttpsError: TestHttpsError
  });
  const request = { code };
  const context = {
    auth: {
      uid: recipientUid,
      token: authToken
    }
  };

  const result = await callable(request, context);
  assert.deepEqual(result, {
    success: true,
    friendshipId,
    inviterName: 'Invite Sender'
  });

  const afterSuccess = await readEmulatorRedemptionState(firestore, inviteRef, friendshipRef);
  assert.equal(afterSuccess.invite.data.used, true);
  assert.equal(afterSuccess.invite.data.usedBy, recipientUid);
  assert.equal(typeof afterSuccess.invite.data.usedAt, 'number');
  assert.deepEqual(afterSuccess.friendship.data.memberIds, [inviterUid, recipientUid].sort());
  assert.equal(afterSuccess.friendship.data.requesterId, inviterUid);
  assert.equal(afterSuccess.friendship.data.recipientId, recipientUid);
  assert.equal(afterSuccess.friendship.data.status, 'accepted');
  assert.equal(afterSuccess.friendship.data.inviteCodeId, code);
  assert.equal(afterSuccess.friendship.data.source, 'friend_invite');
  assert.deepEqual(afterSuccess.friendship.data.sharedTeamIds, ['team-emulator']);
  assert.equal(afterSuccess.friendship.data.createdAt, afterSuccess.invite.data.usedAt);
  assert.equal(afterSuccess.friendship.data.acceptedAt, afterSuccess.invite.data.usedAt);
  assert.equal(afterSuccess.friendship.data.respondedAt, afterSuccess.invite.data.usedAt);
  assert.equal(afterSuccess.friendship.data.updatedAt, afterSuccess.invite.data.usedAt);

  await assertGenericCallableRejection(callable(request, context), [
    code,
    inviterUid,
    recipientUid,
    inviteTarget.email,
    inviteTarget.phone
  ].filter(Boolean));

  const afterReplay = await readEmulatorRedemptionState(firestore, inviteRef, friendshipRef);
  assert.deepEqual(afterReplay, afterSuccess);
}

emulatorTest('Firestore emulator atomically redeems and replay-protects a verified email invite', async (t) => {
  await exerciseEmulatorRedemption(t, {
    inviteTarget: { email: ' Recipient@Example.COM ' },
    authToken: {
      email: 'recipient@example.com',
      email_verified: true
    }
  });
});

emulatorTest('Firestore emulator atomically redeems and replay-protects a verified phone invite', async (t) => {
  await exerciseEmulatorRedemption(t, {
    inviteTarget: { phone: '+1 (312) 555-1212' },
    authToken: { phone_number: '+13125551212' }
  });
});

test('atomically redeems an active invite with a matching verified email', async () => {
  const harness = createTransactionHarness({
    invite: activeInvite({ email: ' Recipient@Example.COM ' })
  });

  const result = await harness.redeem({
    code: ' friend01 ',
    recipientIdentities: verifiedIdentities()
  });

  assert.deepEqual(result, {
    success: true,
    friendshipId: 'inviter-1__recipient-1',
    inviterName: 'Invite Sender'
  });
  assert.deepEqual(harness.metrics.committedBatches, [[
    'friendships/inviter-1__recipient-1',
    'accessCodes/FRIEND01'
  ]]);
  assert.deepEqual(harness.docs.get('friendships/inviter-1__recipient-1'), {
    requesterId: 'inviter-1',
    recipientId: 'recipient-1',
    memberIds: ['inviter-1', 'recipient-1'],
    status: 'accepted',
    sharedTeamIds: ['team-1'],
    sharedTeamNames: ['team-1'],
    blockedBy: [],
    source: 'friend_invite',
    inviteCodeId: 'FRIEND01',
    createdAt: FakeTimestamp.fromMillis(NOW_MILLIS),
    acceptedAt: FakeTimestamp.fromMillis(NOW_MILLIS),
    respondedAt: FakeTimestamp.fromMillis(NOW_MILLIS),
    updatedAt: FakeTimestamp.fromMillis(NOW_MILLIS)
  });
  assert.deepEqual(harness.docs.get('accessCodes/FRIEND01'), {
    ...activeInvite({ email: ' Recipient@Example.COM ' }),
    used: true,
    usedBy: 'recipient-1',
    usedAt: FakeTimestamp.fromMillis(NOW_MILLIS)
  });
});

test('redeems with a matching verified phone identity', async () => {
  const harness = createTransactionHarness({
    invite: activeInvite({ email: null, phone: '+1 (312) 555-1212' })
  });

  await assert.doesNotReject(harness.redeem({
    code: 'FRIEND01',
    recipientIdentities: verifiedIdentities({ email: '', phone: '+13125551212' })
  }));

  assert.equal(harness.docs.get('accessCodes/FRIEND01').usedBy, 'recipient-1');
  assert.equal(harness.metrics.committedBatches.length, 1);
});

test('accepts an existing unblocked friendship without changing its stable participants', async () => {
  const createdAt = FakeTimestamp.fromMillis(NOW_MILLIS - 60_000);
  const harness = createTransactionHarness({
    friendship: {
      requesterId: 'recipient-1',
      recipientId: 'inviter-1',
      memberIds: ['recipient-1', 'inviter-1'],
      status: 'pending',
      blockedBy: [],
      createdAt
    }
  });

  await harness.redeem({ code: 'FRIEND01', recipientIdentities: verifiedIdentities() });

  assert.deepEqual(harness.docs.get('friendships/inviter-1__recipient-1'), {
    requesterId: 'recipient-1',
    recipientId: 'inviter-1',
    memberIds: ['recipient-1', 'inviter-1'],
    status: 'accepted',
    sharedTeamIds: ['team-1'],
    sharedTeamNames: ['team-1'],
    blockedBy: [],
    source: 'friend_invite',
    inviteCodeId: 'FRIEND01',
    createdAt,
    acceptedAt: FakeTimestamp.fromMillis(NOW_MILLIS),
    respondedAt: FakeTimestamp.fromMillis(NOW_MILLIS),
    updatedAt: FakeTimestamp.fromMillis(NOW_MILLIS)
  });
});

test('replay returns the generic error and commits zero additional writes', async () => {
  const harness = createTransactionHarness();
  await harness.redeem({ code: 'FRIEND01', recipientIdentities: verifiedIdentities() });
  const afterSuccess = comparableState(harness.docs);

  await expectGenericTransactionRejection(
    harness.redeem({ code: 'FRIEND01', recipientIdentities: verifiedIdentities() })
  );

  assert.deepEqual(comparableState(harness.docs), afterSuccess);
  assert.equal(harness.metrics.committedBatches.length, 1);
});

test('concurrent redemption commits exactly one two-document batch', async () => {
  const harness = createTransactionHarness();
  const results = await Promise.allSettled([
    harness.redeem({ code: 'FRIEND01', recipientIdentities: verifiedIdentities() }),
    harness.redeem({ code: 'FRIEND01', recipientIdentities: verifiedIdentities() })
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.deepEqual(harness.metrics.committedBatches, [[
    'friendships/inviter-1__recipient-1',
    'accessCodes/FRIEND01'
  ]]);
});

const blockedFriendship = {
  requesterId: 'inviter-1',
  recipientId: 'recipient-1',
  memberIds: ['inviter-1', 'recipient-1'],
  status: 'blocked',
  blockedBy: ['inviter-1'],
  createdAt: FakeTimestamp.fromMillis(NOW_MILLIS - 60_000)
};

const rejectionCases = [
  ['identity mismatch', activeInvite(), null, verifiedIdentities({ email: 'wrong@example.com' })],
  ['missing target identity', activeInvite({ email: null, phone: null }), null, verifiedIdentities()],
  ['self redemption', activeInvite({ generatedBy: 'recipient-1' }), null, verifiedIdentities()],
  ['missing inviter', activeInvite({ generatedBy: null }), null, verifiedIdentities()],
  ['expired invite', activeInvite({ expiresAt: FakeTimestamp.fromMillis(NOW_MILLIS) }), null, verifiedIdentities()],
  ['missing expiry', activeInvite({ expiresAt: null }), null, verifiedIdentities()],
  ['malformed expiry', activeInvite({ expiresAt: 'tomorrow' }), null, verifiedIdentities()],
  ['used invite', activeInvite({ used: true, usedBy: 'someone', usedAt: FakeTimestamp.now() }), null, verifiedIdentities()],
  ['inconsistent usedBy', activeInvite({ usedBy: 'someone' }), null, verifiedIdentities()],
  ['inconsistent usedAt', activeInvite({ usedAt: FakeTimestamp.now() }), null, verifiedIdentities()],
  ['wrong invite type', activeInvite({ type: 'parent_invite' }), null, verifiedIdentities()],
  ['mismatched stored code', activeInvite({ code: 'FRIEND02' }), null, verifiedIdentities()],
  ['revoked invite', activeInvite({ revoked: true }), null, verifiedIdentities()],
  ['inactive invite', activeInvite({ active: false }), null, verifiedIdentities()],
  ['terminal invite status', activeInvite({ status: 'cancelled' }), null, verifiedIdentities()],
  ['blocked friendship', activeInvite(), blockedFriendship, verifiedIdentities()],
  ['nonempty blockedBy', activeInvite(), { ...blockedFriendship, status: 'accepted' }, verifiedIdentities()],
  ['malformed blockedBy', activeInvite(), { ...blockedFriendship, status: 'accepted', blockedBy: 'inviter-1' }, verifiedIdentities()],
  ['malformed participants', activeInvite(), { ...blockedFriendship, status: 'pending', blockedBy: [], memberIds: ['other-1', 'recipient-1'] }, verifiedIdentities()]
];

for (const [name, invite, friendship, recipientIdentities] of rejectionCases) {
  test(`${name} rejects generically with zero writes`, async () => {
    const harness = createTransactionHarness({ invite, friendship });
    const before = comparableState(harness.docs);

    await expectGenericTransactionRejection(harness.redeem({
      code: 'FRIEND01',
      recipientIdentities
    }));

    assert.deepEqual(comparableState(harness.docs), before);
    assert.equal(harness.metrics.committedBatches.length, 0);
    const logs = JSON.stringify(harness.logEvents);
    for (const sensitiveValue of [invite.email, invite.phone, invite.generatedBy, invite.inviterProfile?.displayName]) {
      if (sensitiveValue) assert.equal(logs.includes(String(sensitiveValue)), false);
    }
  });
}

test('missing invite and malformed code reject with zero writes', async () => {
  const missingHarness = createTransactionHarness();
  missingHarness.docs.delete('accessCodes/FRIEND01');
  const missingBefore = comparableState(missingHarness.docs);
  await expectGenericTransactionRejection(missingHarness.redeem({
    code: 'FRIEND01',
    recipientIdentities: verifiedIdentities()
  }));
  assert.deepEqual(comparableState(missingHarness.docs), missingBefore);
  assert.equal(missingHarness.metrics.committedBatches.length, 0);

  const malformedHarness = createTransactionHarness();
  const malformedBefore = comparableState(malformedHarness.docs);
  await expectGenericTransactionRejection(malformedHarness.redeem({
    code: '../friend01',
    recipientIdentities: verifiedIdentities()
  }));
  assert.deepEqual(comparableState(malformedHarness.docs), malformedBefore);
  assert.equal(malformedHarness.metrics.transactionCalls, 0);
});

test('transaction failure after staged writes rolls back both documents', async () => {
  const harness = createTransactionHarness({ failAfterCallback: true });
  const before = comparableState(harness.docs);

  await expectGenericTransactionRejection(harness.redeem({
    code: 'FRIEND01',
    recipientIdentities: verifiedIdentities()
  }));

  assert.deepEqual(comparableState(harness.docs), before);
  assert.equal(harness.metrics.committedBatches.length, 0);
});
