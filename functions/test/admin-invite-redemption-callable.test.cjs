'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRedeemAdminInviteHandler } = require('../admin-invite-redemption-core.cjs');

class TestHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const NOW = Object.freeze({ seconds: 1_800_000_000, nanoseconds: 0 });

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function makeFirestore(seed) {
  const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
  const committedWrites = [];
  let transactionCount = 0;

  function doc(path) {
    return { path };
  }

  function snapshot(ref) {
    const value = state.get(ref.path);
    return {
      exists: value !== undefined,
      data: () => clone(value)
    };
  }

  return {
    doc,
    committedWrites,
    get transactionCount() {
      return transactionCount;
    },
    snapshot: (path) => clone(state.get(path)),
    async runTransaction(callback) {
      transactionCount += 1;
      const pendingWrites = [];
      const result = await callback({
        get: async (ref) => snapshot(ref),
        set: (ref, value, options) => pendingWrites.push({ type: 'set', ref, value, options }),
        update: (ref, value) => pendingWrites.push({ type: 'update', ref, value })
      });

      for (const write of pendingWrites) {
        const current = state.get(write.ref.path);
        const next = write.type === 'set' && write.options?.merge
          ? { ...(current || {}), ...clone(write.value) }
          : { ...(current || {}), ...clone(write.value) };
        state.set(write.ref.path, next);
        committedWrites.push({ type: write.type, path: write.ref.path });
      }
      return result;
    }
  };
}

function normalizeFirestoreId(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('/')) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function createHarness({
  team,
  issuerProfile = {},
  issuerAuthUser,
  selfAddressed = false,
  recipientToken = { email_verified: true }
}) {
  const issuerUid = 'issuer-1';
  const inviteeUid = selfAddressed ? issuerUid : 'invitee-1';
  const invitedEmail = selfAddressed ? 'issuer@example.com' : 'invitee@example.com';
  const seed = {
    'accessCodes/invite-1': {
      type: 'admin_invite',
      teamId: 'team-1',
      teamName: 'Tigers',
      email: invitedEmail,
      generatedBy: issuerUid,
      used: false,
      status: 'active'
    },
    'teams/team-1': clone(team),
    [`users/${inviteeUid}`]: {
      coachOf: ['existing-team'],
      roles: ['parent']
    },
    [`users/${issuerUid}`]: clone(issuerProfile)
  };
  const firestore = makeFirestore(seed);
  async function getAuthUser(uid) {
    if (!issuerAuthUser || uid !== issuerUid) {
      const error = new Error('Auth user not found');
      error.code = 'auth/user-not-found';
      throw error;
    }
    return clone(issuerAuthUser);
  }
  const handler = createRedeemAdminInviteHandler({
    firestore,
    getAuthUser,
    getTimestamp: () => NOW,
    HttpsError: TestHttpsError,
    normalizeFirestoreId,
    nowMillis: () => 1_800_000_000_000
  });
  const context = {
    auth: {
      uid: inviteeUid,
      token: { email: invitedEmail, ...recipientToken }
    }
  };
  return { context, firestore, handler, inviteeUid, seed };
}

async function redeem(harness) {
  return harness.handler({ codeId: 'invite-1', userId: harness.inviteeUid }, harness.context);
}

for (const [label, authorization] of [
  ['current owner', {
    team: { ownerId: 'issuer-1', adminEmails: [] },
    issuerAuthUser: { uid: 'issuer-1', email: 'owner@example.com' }
  }],
  ['current email-listed administrator', {
    team: { ownerId: 'owner-1', adminEmails: ['issuer@example.com'] },
    issuerAuthUser: { uid: 'issuer-1', email: 'ISSUER@example.com' }
  }],
  ['current global administrator', {
    team: { ownerId: 'owner-1', adminEmails: [] },
    issuerProfile: { isAdmin: true },
    issuerAuthUser: { uid: 'issuer-1', email: 'global@example.com' }
  }]
]) {
  test(`redeems atomically when issued by a ${label}`, async () => {
    const harness = createHarness(authorization);

    assert.deepEqual(await redeem(harness), {
      success: true,
      codeId: 'invite-1',
      teamId: 'team-1',
      teamName: 'Tigers'
    });
    assert.deepEqual(
      harness.firestore.snapshot('teams/team-1').adminEmails,
      [...(authorization.team.adminEmails || []), 'invitee@example.com']
    );
    assert.deepEqual(harness.firestore.snapshot(`users/${harness.inviteeUid}`).coachOf, ['existing-team', 'team-1']);
    assert.deepEqual(harness.firestore.snapshot(`users/${harness.inviteeUid}`).roles, ['parent', 'coach']);
    assert.deepEqual(harness.firestore.snapshot('accessCodes/invite-1'), {
      ...harness.seed['accessCodes/invite-1'],
      used: true,
      usedBy: harness.inviteeUid,
      usedAt: NOW
    });
    assert.deepEqual(harness.firestore.committedWrites, [
      { type: 'set', path: 'teams/team-1' },
      { type: 'set', path: `users/${harness.inviteeUid}` },
      { type: 'update', path: 'accessCodes/invite-1' }
    ]);
    assert.equal(harness.firestore.transactionCount, 1);
  });
}

for (const [label, recipientToken] of [
  ['matching recipient with an unverified email', { email_verified: false }],
  ['matching recipient with a missing verification claim', {}]
]) {
  test(`denies ${label} before starting the redemption transaction`, async () => {
    const harness = createHarness({
      team: { ownerId: 'issuer-1', adminEmails: [] },
      issuerAuthUser: { uid: 'issuer-1', email: 'owner@example.com' },
      recipientToken
    });
    const before = {
      code: harness.firestore.snapshot('accessCodes/invite-1'),
      team: harness.firestore.snapshot('teams/team-1'),
      user: harness.firestore.snapshot(`users/${harness.inviteeUid}`)
    };

    await assert.rejects(
      redeem(harness),
      (error) => error.code === 'permission-denied' &&
        error.details?.reason === 'email-verification-required'
    );
    assert.equal(harness.firestore.transactionCount, 0);
    assert.deepEqual(harness.firestore.snapshot('accessCodes/invite-1'), before.code);
    assert.deepEqual(harness.firestore.snapshot('teams/team-1'), before.team);
    assert.deepEqual(harness.firestore.snapshot(`users/${harness.inviteeUid}`), before.user);
    assert.deepEqual(harness.firestore.committedWrites, []);
  });
}

test('denies a verified recipient whose authenticated email does not match', async () => {
  const harness = createHarness({
    team: { ownerId: 'issuer-1', adminEmails: [] },
    issuerAuthUser: { uid: 'issuer-1', email: 'owner@example.com' },
    recipientToken: { email: 'other@example.com', email_verified: true }
  });
  const before = {
    code: harness.firestore.snapshot('accessCodes/invite-1'),
    team: harness.firestore.snapshot('teams/team-1'),
    user: harness.firestore.snapshot(`users/${harness.inviteeUid}`)
  };

  await assert.rejects(
    harness.handler({
      codeId: 'invite-1',
      userId: harness.inviteeUid,
      userEmail: 'invitee@example.com'
    }, harness.context),
    (error) => error.code === 'permission-denied'
  );
  assert.equal(harness.firestore.transactionCount, 1);
  assert.deepEqual(harness.firestore.snapshot('accessCodes/invite-1'), before.code);
  assert.deepEqual(harness.firestore.snapshot('teams/team-1'), before.team);
  assert.deepEqual(harness.firestore.snapshot(`users/${harness.inviteeUid}`), before.user);
  assert.deepEqual(harness.firestore.committedWrites, []);
});

for (const [label, authorization] of [
  ['removed administrator', {
    team: { ownerId: 'owner-1', adminEmails: [] },
    issuerProfile: { email: 'issuer@example.com' },
    issuerAuthUser: { uid: 'issuer-1', email: 'issuer@example.com' }
  }],
  ['deleted issuer account', {
    team: { ownerId: 'owner-1', adminEmails: ['issuer@example.com'] },
    issuerProfile: { email: 'issuer@example.com' },
    issuerAuthUser: null
  }],
  ['removed administrator redeeming a self-addressed invite', {
    team: { ownerId: 'owner-1', adminEmails: [] },
    issuerProfile: { email: 'issuer@example.com' },
    issuerAuthUser: { uid: 'issuer-1', email: 'issuer@example.com' },
    selfAddressed: true
  }]
]) {
  test(`denies ${label} without team, user, or invite writes`, async () => {
    const harness = createHarness(authorization);
    const before = {
      code: harness.firestore.snapshot('accessCodes/invite-1'),
      team: harness.firestore.snapshot('teams/team-1'),
      user: harness.firestore.snapshot(`users/${harness.inviteeUid}`)
    };

    await assert.rejects(redeem(harness), (error) => error.code === 'permission-denied');
    assert.deepEqual(harness.firestore.snapshot('accessCodes/invite-1'), before.code);
    assert.deepEqual(harness.firestore.snapshot('teams/team-1'), before.team);
    assert.deepEqual(harness.firestore.snapshot(`users/${harness.inviteeUid}`), before.user);
    assert.deepEqual(harness.firestore.committedWrites, []);
  });
}

test('denies a malformed stored issuer identity before document writes', async () => {
  const harness = createHarness({
    team: { ownerId: 'owner-1', adminEmails: ['issuer@example.com'] },
    issuerAuthUser: { uid: 'issuer-1', email: 'issuer@example.com' }
  });
  const code = harness.firestore.snapshot('accessCodes/invite-1');
  code.generatedBy = { uid: 'issuer-1' };
  const malformedFirestore = makeFirestore({
    'accessCodes/invite-1': code,
    'teams/team-1': harness.firestore.snapshot('teams/team-1'),
    'users/invitee-1': harness.firestore.snapshot('users/invitee-1')
  });
  const handler = createRedeemAdminInviteHandler({
    firestore: malformedFirestore,
    getAuthUser: async () => ({ uid: 'issuer-1', email: 'issuer@example.com' }),
    getTimestamp: () => NOW,
    HttpsError: TestHttpsError,
    normalizeFirestoreId
  });

  await assert.rejects(
    handler({ codeId: 'invite-1', userId: 'invitee-1' }, harness.context),
    (error) => error.code === 'permission-denied'
  );
  assert.deepEqual(malformedFirestore.committedWrites, []);
  assert.equal(malformedFirestore.snapshot('accessCodes/invite-1').used, false);
});
