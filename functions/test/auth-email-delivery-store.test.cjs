'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAuthEmailDeliveryStore } = require('../auth-email-delivery-store.cjs');

function createStore({ nextAllowedAt = null, deleteError = null, sendDelivery = null } = {}) {
  const calls = { sets: [], creates: [], deletes: [], warnings: [] };
  let autoId = 0;
  const refs = new Map();
  const getRef = (collectionName, id) => {
    const key = `${collectionName}/${id}`;
    if (!refs.has(key)) {
      refs.set(key, {
        id,
        path: key,
        async create(value) {
          calls.creates.push({ path: key, value });
        },
        async delete() {
          calls.deletes.push(key);
          if (deleteError) throw deleteError;
        }
      });
    }
    return refs.get(key);
  };
  const firestore = {
    collection(name) {
      return { doc: (id) => getRef(name, id || `auto-${++autoId}`) };
    },
    async runTransaction(callback) {
      return callback({
        async get() {
          return { data: () => ({ nextAllowedAt }) };
        },
        set(ref, value) {
          calls.sets.push({ path: ref.path, value });
        }
      });
    }
  };
  const store = createAuthEmailDeliveryStore({
    firestore,
    Timestamp: { fromMillis: (millis) => ({ millis }) },
    FieldValue: { serverTimestamp: () => ({ server: true }) },
    logger: { warn: (message, meta) => calls.warnings.push({ message, meta }) },
    cooldownMs: 60_000,
    buildRateLimitId: (type, email, scope) => `${type}:${email}:${scope}`,
    buildMailDocId: (type, email) => `${type}:${email}`,
    buildMailJob: (input) => ({ to: [input.email], metadata: { type: input.type } }),
    sendDelivery,
    normalizeEmail: (value) => String(value).trim().toLowerCase(),
    hashRecipient: (value) => `hash:${value}`,
    now: () => 1_000
  });
  return { store, calls };
}

test('delivery reservation rejects an active recipient cooldown without rewriting it', async () => {
  const { store, calls } = createStore({ nextAllowedAt: { toMillis: () => 2_000 } });
  assert.equal(await store.reserve('verification', 'Coach@Example.com', 'user-1'), false);
  assert.deepEqual(calls.sets, []);
});

test('delivery reservation atomically records a server-owned cooldown', async () => {
  const { store, calls } = createStore({ nextAllowedAt: { toMillis: () => 500 } });
  assert.equal(await store.reserve('verification', ' Coach@Example.com ', 'user-1'), true);
  assert.deepEqual(calls.sets, [{
    path: 'authEmailRateLimits/verification: Coach@Example.com :user-1',
    value: {
      type: 'verification',
      recipientHash: 'hash:coach@example.com',
      nextAllowedAt: { millis: 61_000 },
      updatedAt: { server: true }
    }
  }]);
});

test('delivery release is idempotent to delete failures and records a warning', async () => {
  const { store, calls } = createStore({ deleteError: Object.assign(new Error('down'), { code: 'unavailable' }) });
  await store.release('password_reset', 'coach@example.com');
  assert.deepEqual(calls.deletes, ['authEmailRateLimits/password_reset:coach@example.com:']);
  assert.equal(calls.warnings[0].meta.code, 'unavailable');
});

test('delivery queue creates the Resend mail job with a server timestamp', async () => {
  const { store, calls } = createStore();
  const id = await store.queue({
    type: 'password_reset',
    email: 'coach@example.com',
    actionUrl: 'https://identity.example/reset',
    uid: 'user-1'
  });
  assert.equal(id, 'password_reset:coach@example.com');
  assert.deepEqual(calls.creates, [{
    path: 'mail/password_reset:coach@example.com',
    value: {
      to: ['coach@example.com'],
      metadata: { type: 'password_reset' },
      createdAt: { server: true }
    }
  }]);
});

test('password-reset request queue stores only deferred server work', async () => {
  const { store, calls } = createStore();
  assert.equal(await store.enqueuePasswordResetRequest(' Coach@Example.com '), 'auto-1');
  assert.deepEqual(calls.creates, [{
    path: 'authEmailRequests/auto-1',
    value: {
      type: 'password_reset',
      email: 'coach@example.com',
      createdAt: { server: true },
      expiresAt: { millis: 86_401_000 }
    }
  }]);
});

test('delivery queue accepts a deterministic id for trigger retry idempotency', async () => {
  const { store, calls } = createStore();
  await store.queue({
    type: 'password_reset',
    email: 'coach@example.com',
    actionUrl: 'https://identity.example/reset',
    deliveryId: 'auth_password_reset_request-1'
  });
  assert.equal(calls.creates[0].path, 'mail/auth_password_reset_request-1');
});

test('delivery queue can route authentication jobs directly to a tracked provider', async () => {
  const directSends = [];
  const { store, calls } = createStore({
    sendDelivery: async (delivery) => directSends.push(delivery)
  });
  const id = await store.queue({
    type: 'password_reset',
    email: 'coach@example.com',
    actionUrl: 'https://identity.example/reset',
    deliveryId: 'tracked-reset-1'
  });
  assert.equal(id, 'tracked-reset-1');
  assert.deepEqual(calls.creates, []);
  assert.deepEqual(directSends, [{
    deliveryId: 'tracked-reset-1',
    job: {
      to: ['coach@example.com'],
      metadata: { type: 'password_reset' }
    }
  }]);
});
