'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createPasswordResetEmailWorker } = require('../auth-email-password-reset-worker.cjs');

const types = { PASSWORD_RESET: 'password_reset' };

function createHarness(overrides = {}) {
  const calls = { queued: [], deleted: 0, errors: [], warnings: [] };
  const auth = {
    async getUserByEmail(email) {
      return { uid: 'user-1', email, displayName: 'Coach' };
    },
    async generatePasswordResetLink(email) {
      return `https://identity.example/reset?email=${encodeURIComponent(email)}`;
    },
    ...overrides.auth
  };
  const worker = createPasswordResetEmailWorker({
    auth,
    logger: {
      warn(message, meta) { calls.warnings.push({ message, meta }); },
      error(message, meta) { calls.errors.push({ message, meta }); }
    },
    types,
    normalizeEmail: (value) => String(value || '').trim().toLowerCase(),
    isValidEmail: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    getActionSettings: (type) => ({ type }),
    async queueDelivery(job) { calls.queued.push(job); },
    isAlreadyExistsError: (error) => error?.code === 'already-exists',
    now: () => 1_000,
    ...overrides,
    auth
  });
  const process = (data = { type: 'password_reset', email: 'Coach@Example.com', expiresAt: 2_000 }, requestId = 'request-1') =>
    worker.processPasswordResetRequest(data, {
      requestId,
      async deleteRequest() { calls.deleted += 1; }
    });
  return { calls, process };
}

test('worker resolves the account and creates one deterministic Resend mail job', async () => {
  const { calls, process } = createHarness();
  await process();
  assert.deepEqual(calls.queued, [{
    type: 'password_reset',
    email: 'coach@example.com',
    actionUrl: 'https://identity.example/reset?email=coach%40example.com',
    displayName: 'Coach',
    uid: 'user-1',
    deliveryId: 'auth_password_reset_request-1'
  }]);
  assert.equal(calls.deleted, 1);
});

test('worker silently drops missing accounts while preserving the same cooldown', async () => {
  const { calls, process } = createHarness({
    auth: {
      async getUserByEmail() {
        throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
      }
    }
  });
  await process();
  assert.deepEqual(calls.queued, []);
  assert.deepEqual(calls.errors, []);
  assert.equal(calls.deleted, 1);
});

test('worker rethrows transient failures without deleting the internal request', async () => {
  const { calls, process } = createHarness({
    auth: {
      async generatePasswordResetLink() {
        throw Object.assign(new Error('down'), { code: 'unavailable' });
      }
    }
  });
  await assert.rejects(process(), (error) => error.code === 'unavailable');
  assert.equal(calls.errors[0].meta.code, 'unavailable');
  assert.equal(calls.deleted, 0);
});

test('worker drops a retryable failure after its server-owned retry window expires', async () => {
  const { calls, process } = createHarness({
    now: () => 2_001,
    auth: {
      async generatePasswordResetLink() {
        throw Object.assign(new Error('down'), { code: 'unavailable' });
      }
    }
  });
  await process();
  assert.equal(calls.warnings[0].message, 'Dropped expired password-reset processing request.');
  assert.deepEqual(calls.errors, []);
  assert.deepEqual(calls.queued, []);
  assert.equal(calls.deleted, 1);
});

test('worker treats an existing deterministic mail job as a successful trigger retry', async () => {
  const { calls, process } = createHarness({
    async queueDelivery() {
      throw Object.assign(new Error('duplicate'), { code: 'already-exists' });
    }
  });
  await process();
  assert.equal(calls.deleted, 1);
});

test('worker rejects malformed internal requests without sending mail', async () => {
  const { calls, process } = createHarness();
  await process({ type: 'verification', email: 'coach@example.com', expiresAt: 2_000 });
  assert.deepEqual(calls.queued, []);
  assert.equal(calls.deleted, 1);
});
