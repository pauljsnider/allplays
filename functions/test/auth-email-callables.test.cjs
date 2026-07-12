'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAuthEmailCallableHandlers } = require('../auth-email-callables.cjs');

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const types = {
  PASSWORD_RESET: 'password_reset',
  VERIFICATION: 'verification',
  SIGN_IN: 'sign_in'
};

function createHarness(overrides = {}) {
  const calls = {
    order: [],
    queued: [],
    released: [],
    reserved: [],
    passwordResetRequests: [],
    findOwned: []
  };
  const auth = {
    async getUserByEmail(email) {
      calls.order.push(`lookup:${email}`);
      return { uid: 'recipient-1', email, displayName: 'Recipient' };
    },
    async getUser(uid) {
      return { uid, email: 'coach@example.com', displayName: 'Coach', emailVerified: false };
    },
    async verifyIdToken(token) {
      calls.order.push(`verify:${token}`);
      return { uid: 'native-user' };
    },
    async generateEmailVerificationLink(email) {
      return `https://identity.example/verify?email=${encodeURIComponent(email)}`;
    },
    async generateSignInWithEmailLink(email) {
      return `https://identity.example/sign-in?email=${encodeURIComponent(email)}`;
    },
    ...overrides.auth
  };
  const deps = {
    auth,
    HttpsError: TestHttpsError,
    logger: {
      warn() {},
      error() {}
    },
    types,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    isValidEmail: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    checkPasswordResetRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
    async reserveDelivery(...args) {
      calls.order.push(`reserve:${args[0]}`);
      calls.reserved.push(args);
      return true;
    },
    async releaseDelivery(...args) {
      calls.released.push(args);
    },
    async queueDelivery(job) {
      calls.queued.push(job);
    },
    async enqueuePasswordResetRequest(email) {
      calls.order.push(`enqueue:${email}`);
      calls.passwordResetRequests.push(email);
    },
    getActionSettings: (type, url) => ({ type, url: url || null }),
    getInviteContinueUrl: (code, inviteType) => `https://allplays.ai/accept-invite.html?code=${code}&type=${inviteType}`,
    async findOwnedInviteCode(...args) {
      calls.findOwned.push(args);
      return {
        id: 'invite-1',
        data: {
          type: 'admin_invite',
          email: 'recipient@example.com',
          generatedBy: 'owner-1',
          teamName: 'Tigers'
        }
      };
    },
    allowedInviteTypes: new Set(['parent_invite', 'household_invite', 'coparent_invite', 'admin_invite']),
    isInviteInactive: (data) => data.used === true ||
      data.revoked === true ||
      data.active === false ||
      ['removed', 'cancelled', 'revoked'].includes(String(data.status || '').trim().toLowerCase()) ||
      data.expiresAt === 'past',
    ...overrides,
    auth
  };
  return { handlers: createAuthEmailCallableHandlers(deps), calls, deps, auth };
}

test('password reset rejects malformed email before backend work', async () => {
  const { handlers, calls } = createHarness();
  await assert.rejects(
    handlers.queuePasswordResetEmail({ email: 'not-an-email' }),
    (error) => error.code === 'invalid-argument'
  );
  assert.deepEqual(calls.reserved, []);
});

test('password reset reserves and enqueues identical deferred work without looking up the account', async () => {
  const { handlers, calls } = createHarness();
  const result = await handlers.queuePasswordResetEmail({ email: ' Missing@Example.com ' });
  assert.deepEqual(result, { queued: true });
  assert.deepEqual(calls.order, ['reserve:password_reset', 'enqueue:missing@example.com']);
  assert.deepEqual(calls.passwordResetRequests, ['missing@example.com']);
  assert.deepEqual(calls.queued, []);
});

test('password reset is neutral for rate limit, cooldown, and request-enqueue failure', async () => {
  const rateLimited = createHarness({
    checkPasswordResetRateLimit: () => ({ allowed: false, retryAfterSeconds: 30 })
  });
  assert.deepEqual(await rateLimited.handlers.queuePasswordResetEmail({ email: 'coach@example.com' }), { queued: true });
  assert.deepEqual(rateLimited.calls.reserved, []);

  const cooldown = createHarness({ reserveDelivery: async () => false });
  assert.deepEqual(await cooldown.handlers.queuePasswordResetEmail({ email: 'coach@example.com' }), { queued: true });
  assert.deepEqual(cooldown.calls.passwordResetRequests, []);

  const failed = createHarness({
    async enqueuePasswordResetRequest() { throw Object.assign(new Error('down'), { code: 'unavailable' }); }
  });
  assert.deepEqual(await failed.handlers.queuePasswordResetEmail({ email: 'coach@example.com' }), { queued: true });
  assert.deepEqual(failed.calls.released, [[types.PASSWORD_RESET, 'coach@example.com', '']]);
});

test('password reset remains neutral when cleanup of a failed reservation also fails', async () => {
  const { handlers } = createHarness({
    async enqueuePasswordResetRequest() { throw new Error('request failure'); },
    async releaseDelivery() { throw new Error('release failure'); }
  });
  assert.deepEqual(await handlers.queuePasswordResetEmail({ email: 'coach@example.com' }), { queued: true });
});

test('verification rejects unauthenticated requests and invalid native tokens', async () => {
  const anonymous = createHarness();
  await assert.rejects(
    anonymous.handlers.queueEmailVerification({}, {}),
    (error) => error.code === 'unauthenticated'
  );

  const invalidNative = createHarness({
    auth: { async verifyIdToken() { throw Object.assign(new Error('bad token'), { code: 'auth/invalid-id-token' }); } }
  });
  await assert.rejects(
    invalidNative.handlers.queueEmailVerification({ idToken: 'bad' }, {}),
    (error) => error.code === 'unauthenticated'
  );
});

test('verification accepts a server-verified native token and queues for that uid', async () => {
  const { handlers, calls } = createHarness();
  assert.deepEqual(await handlers.queueEmailVerification({ idToken: 'native-token' }, {}), { queued: true });
  assert.equal(calls.order[0], 'verify:native-token');
  assert.deepEqual(calls.reserved, [[types.VERIFICATION, 'coach@example.com', 'native-user']]);
  assert.equal(calls.queued[0].uid, 'native-user');
  assert.equal(calls.queued[0].type, types.VERIFICATION);
});

test('verification returns alreadyVerified and releases a failed reservation', async () => {
  const verified = createHarness({
    auth: { async getUser(uid) { return { uid, email: 'coach@example.com', emailVerified: true }; } }
  });
  assert.deepEqual(await verified.handlers.queueEmailVerification({}, { auth: { uid: 'user-1' } }), { alreadyVerified: true });
  assert.deepEqual(verified.calls.reserved, []);

  const failed = createHarness({
    auth: { async generateEmailVerificationLink() { throw new Error('link failure'); } }
  });
  await assert.rejects(
    failed.handlers.queueEmailVerification({}, { auth: { uid: 'user-1' } }),
    (error) => error.code === 'internal'
  );
  assert.deepEqual(failed.calls.released, [[types.VERIFICATION, 'coach@example.com', 'user-1']]);
});

test('invite email requires auth and caller-owned eligible invite', async () => {
  const anonymous = createHarness();
  await assert.rejects(
    anonymous.handlers.queueInviteSignInEmail({ code: 'ABCD1234' }, {}),
    (error) => error.code === 'unauthenticated'
  );

  const notOwned = createHarness({ findOwnedInviteCode: async () => null });
  await assert.rejects(
    notOwned.handlers.queueInviteSignInEmail({ code: 'ABCD1234' }, { auth: { uid: 'owner-1' } }),
    (error) => error.code === 'not-found'
  );
});

test('invite email rejects every invite state that redemption treats as inactive', async () => {
  for (const condition of ['used', 'revoked', 'inactive', 'removed', 'cancelled', 'status-revoked', 'expired']) {
    const { handlers } = createHarness({
      async findOwnedInviteCode() {
        return {
          id: 'invite-1',
          data: {
            type: 'admin_invite',
            email: 'recipient@example.com',
            used: condition === 'used',
            revoked: condition === 'revoked',
            active: condition === 'inactive' ? false : undefined,
            status: condition === 'status-revoked' ? 'revoked' :
              ['removed', 'cancelled'].includes(condition) ? condition : undefined,
            expiresAt: condition === 'expired' ? 'past' : null
          }
        };
      }
    });
    await assert.rejects(
      handlers.queueInviteSignInEmail({ code: 'ABCD1234' }, { auth: { uid: 'owner-1' } }),
      (error) => error.code === 'failed-precondition'
    );
  }
});

test('invite cooldown reports non-queued so callers expose a fallback code', async () => {
  const { handlers, calls } = createHarness({ reserveDelivery: async () => false });
  assert.deepEqual(
    await handlers.queueInviteSignInEmail({ code: 'ABCD1234' }, { auth: { uid: 'owner-1' } }),
    { queued: false, existingUser: true }
  );
  assert.deepEqual(calls.queued, []);
});

test('invite success queues server-generated link metadata and enforces ownership lookup inputs', async () => {
  const { handlers, calls, deps } = createHarness();
  assert.deepEqual(
    await handlers.queueInviteSignInEmail({ code: ' abcd1234 ' }, { auth: { uid: 'owner-1' } }),
    { queued: true, existingUser: true }
  );
  assert.deepEqual(calls.findOwned[0], ['ABCD1234', 'owner-1', deps.allowedInviteTypes]);
  assert.deepEqual(calls.queued[0], {
    type: types.SIGN_IN,
    email: 'recipient@example.com',
    actionUrl: 'https://identity.example/sign-in?email=recipient%40example.com',
    displayName: 'Recipient',
    contextLabel: 'Tigers',
    uid: null,
    inviteCodeId: 'invite-1'
  });
});

test('invite delivery failures release the recipient reservation', async () => {
  const { handlers, calls } = createHarness({
    auth: { async generateSignInWithEmailLink() { throw new Error('link failure'); } }
  });
  await assert.rejects(
    handlers.queueInviteSignInEmail({ code: 'ABCD1234' }, { auth: { uid: 'owner-1' } }),
    (error) => error.code === 'internal'
  );
  assert.deepEqual(calls.released, [[types.SIGN_IN, 'recipient@example.com', '']]);
});
