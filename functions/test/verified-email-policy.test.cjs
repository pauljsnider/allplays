const { test } = require('node:test');
const assert = require('node:assert');
const {
  VERIFIED_EMAIL_POLICY_PATH,
  normalizePolicy,
  getEffectiveMode,
  createVerifiedEmailSensitiveActionGuard
} = require('../verified-email-policy.cjs');

class FakeHttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function createHarness({ policy, configuredMode = 'observe', readError = null } = {}) {
  const warnings = [];
  const errors = [];
  let reads = 0;
  const firestore = {
    doc(path) {
      assert.strictEqual(path, VERIFIED_EMAIL_POLICY_PATH);
      return {
        async get() {
          reads += 1;
          if (readError) throw readError;
          return {
            exists: policy !== undefined,
            data: () => policy
          };
        }
      };
    }
  };
  const guard = createVerifiedEmailSensitiveActionGuard({
    firestore,
    HttpsError: FakeHttpsError,
    configuredMode,
    logger: {
      warn: (...args) => warnings.push(args),
      error: (...args) => errors.push(args)
    }
  });
  return { guard, warnings, errors, get reads() { return reads; } };
}

function context({ uid = 'user-1', email = 'user@example.com', verified = false, exempt = false } = {}) {
  return {
    auth: {
      uid,
      token: {
        email,
        email_verified: verified,
        email_verification_exempt: exempt
      }
    }
  };
}

test('verified email policy normalization bounds exemptions and rejects invalid modes', () => {
  const normalized = normalizePolicy({ mode: 'unexpected', exemptUserIds: [' user-1 ', '', 'bad/id', 'user-1', 'user-2'] });
  assert.deepStrictEqual(normalized, { mode: 'observe', exemptUserIds: ['user-1', 'user-2'] });
  assert.strictEqual(getEffectiveMode('enforce', 'disabled'), 'enforce');
  assert.strictEqual(getEffectiveMode('disabled', 'enforce'), 'enforce');
  assert.strictEqual(getEffectiveMode('disabled', 'observe'), 'observe');
});

test('observe mode records but allows unverified sensitive operations', async () => {
  const harness = createHarness({ policy: { mode: 'observe' }, configuredMode: 'disabled' });
  const result = await harness.guard(context(), 'send-team-email');
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, 'observed-unverified');
  assert.strictEqual(harness.warnings.length, 1);
  assert.strictEqual(harness.warnings[0][1].operation, 'send-team-email');
});

test('enforce mode rejects an unverified email but allows verified, no-email, and exempt identities', async () => {
  const harness = createHarness({ policy: { mode: 'enforce', exemptUserIds: ['legacy-user'] }, configuredMode: 'disabled' });

  await assert.rejects(harness.guard(context(), 'refund-team-fee'), (error) => {
    assert.strictEqual(error.code, 'failed-precondition');
    assert.strictEqual(error.details.reason, 'email-unverified');
    return true;
  });
  await assert.doesNotReject(harness.guard(context({ verified: true }), 'refund-team-fee'));
  await assert.doesNotReject(harness.guard(context({ email: '' }), 'refund-team-fee'));
  await assert.doesNotReject(harness.guard(context({ uid: 'legacy-user' }), 'refund-team-fee'));
  await assert.doesNotReject(harness.guard(context({ exempt: true }), 'refund-team-fee'));
});

test('deploy-time enforcement fails closed across policy downgrade and policy read failure', async () => {
  const downgraded = createHarness({ policy: { mode: 'disabled' }, configuredMode: 'enforce' });
  await assert.rejects(downgraded.guard(context(), 'create-checkout'), { code: 'failed-precondition' });

  const unavailable = createHarness({ configuredMode: 'enforce', readError: new Error('unavailable') });
  await assert.rejects(unavailable.guard(context(), 'create-checkout'), { code: 'failed-precondition' });
  assert.strictEqual(unavailable.errors.length, 1);
});

test('policy reads are cached and missing policy defaults to observation', async () => {
  const harness = createHarness({ configuredMode: 'disabled' });
  await harness.guard(context(), 'one');
  await harness.guard(context(), 'two');
  assert.strictEqual(harness.reads, 1);
  assert.strictEqual(harness.warnings.length, 2);
});
