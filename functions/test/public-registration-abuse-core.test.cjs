const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_PUBLIC_REGISTRATION_FIELD_VALUE_LENGTH,
  assertPublicRegistrationInputLimits,
  buildPublicRegistrationDocumentId,
  buildPublicRegistrationRateLimitBoundaries,
  buildPublicRegistrationSubmissionFingerprint,
  evaluatePublicRegistrationAppCheck,
  normalizePublicRegistrationIdempotencyKey,
  normalizePublicRegistrationSecurityMode
} = require('../public-registration-abuse-core.cjs');

function validInput(overrides = {}) {
  return {
    teamId: 'team-1',
    formId: 'form-1',
    participant: { playerName: 'Sam Player' },
    guardian: { email: 'parent@example.com' },
    waiverAccepted: true,
    selectedOptionId: 'u10',
    selectedPaymentPlanId: 'pay_full',
    quantity: 1,
    checkoutAttemptToken: '',
    ...overrides
  };
}

test('defaults unknown rollout modes to observe instead of accidentally enforcing', () => {
  assert.equal(normalizePublicRegistrationSecurityMode(undefined), 'observe');
  assert.equal(normalizePublicRegistrationSecurityMode('unexpected'), 'observe');
  assert.equal(normalizePublicRegistrationSecurityMode('ENFORCE'), 'enforce');
  assert.equal(normalizePublicRegistrationSecurityMode('disabled'), 'disabled');
});

test('only a verified callable App Check context satisfies enforcement', () => {
  assert.deepEqual(evaluatePublicRegistrationAppCheck({}, 'observe'), {
    mode: 'observe', appId: '', verified: false, allowed: true
  });
  assert.equal(evaluatePublicRegistrationAppCheck({}, 'enforce').allowed, false);
  assert.deepEqual(evaluatePublicRegistrationAppCheck({ app: { appId: '1:123:web:abc' } }, 'enforce'), {
    mode: 'enforce', appId: '1:123:web:abc', verified: true, allowed: true
  });
  assert.equal(evaluatePublicRegistrationAppCheck({ rawRequest: { headers: { 'x-firebase-appcheck': 'spoofed' } } }, 'enforce').allowed, false);
});

test('never lets a raw App Check header change a rate-limit boundary', () => {
  const base = buildPublicRegistrationRateLimitBoundaries(validInput(), {}, {
    operation: 'submit', requestIp: '203.0.113.10'
  });
  const spoofed = buildPublicRegistrationRateLimitBoundaries(validInput(), {
    rawRequest: { headers: { 'x-firebase-appcheck': 'attacker-controlled' } }
  }, { operation: 'submit', requestIp: '203.0.113.10' });
  assert.deepEqual(spoofed, base);
  assert.match(base.subject, /parent@example\.com\|203\.0\.113\.10$/);
});

test('builds separate subject, network, and form abuse boundaries', () => {
  const boundaries = buildPublicRegistrationRateLimitBoundaries(validInput(), {}, {
    operation: 'submit', requestIp: '203.0.113.10'
  });
  assert.notEqual(boundaries.subject, boundaries.network);
  assert.notEqual(boundaries.network, boundaries.form);
  assert.doesNotMatch(boundaries.network, /parent@example\.com/);
  assert.doesNotMatch(boundaries.form, /parent@example\.com|203\.0\.113\.10/);
});

test('creates deterministic opaque document ids and canonical payload fingerprints', () => {
  const key = 'submission_token_1234567890';
  const first = validInput({
    participant: { firstName: 'Sam', lastName: 'Player' },
    submissionIdempotencyKey: key
  });
  const reordered = validInput({
    participant: { lastName: 'Player', firstName: 'Sam' },
    submissionIdempotencyKey: key
  });
  assert.equal(buildPublicRegistrationSubmissionFingerprint(first), buildPublicRegistrationSubmissionFingerprint(reordered));
  assert.match(buildPublicRegistrationDocumentId({ ...first, submissionIdempotencyKey: key }), /^submission_[a-f0-9]{64}$/);
  assert.notEqual(
    buildPublicRegistrationDocumentId({ ...first, submissionIdempotencyKey: key }),
    buildPublicRegistrationDocumentId({ ...first, formId: 'form-2', submissionIdempotencyKey: key })
  );
});

test('rejects weak idempotency keys and oversized or dangerous public fields', () => {
  assert.throws(() => normalizePublicRegistrationIdempotencyKey('short'), /invalid/);
  assert.throws(() => normalizePublicRegistrationIdempotencyKey('x'.repeat(129)), /invalid/);
  assert.doesNotThrow(() => normalizePublicRegistrationIdempotencyKey('submission_token_1234567890'));
  assert.throws(() => assertPublicRegistrationInputLimits(validInput({ quantity: 21 })), /between 1 and 20/);
  assert.throws(() => assertPublicRegistrationInputLimits(validInput({
    guardian: { email: 'x'.repeat(MAX_PUBLIC_REGISTRATION_FIELD_VALUE_LENGTH + 1) }
  })), /invalid value/);
  const tooMany = Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`field${index}`, 'value']));
  assert.throws(() => assertPublicRegistrationInputLimits(validInput({ participant: tooMany })), /too many fields/);
  const dangerous = Object.create(null);
  dangerous.__proto__ = 'pollution';
  assert.throws(() => assertPublicRegistrationInputLimits(validInput({ guardian: dangerous })), /invalid field/);
});
