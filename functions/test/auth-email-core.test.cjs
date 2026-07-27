'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  AUTH_EMAIL_TYPES,
  buildCanonicalAuthActionUrl,
  buildAuthEmailMailDocId,
  buildAuthEmailMailJob,
  buildAuthEmailMessage,
  buildAuthEmailRateLimitId,
  getAuthEmailActionSettings,
  getInviteContinueUrl,
  normalizeAuthEmail
} = require('../auth-email-core.cjs');

test('normalizes recipients and builds a Resend verification mail job', () => {
  const job = buildAuthEmailMailJob({
    type: AUTH_EMAIL_TYPES.VERIFICATION,
    email: ' Coach@Example.COM ',
    actionUrl: 'https://allplays.ai/reset-password.html?mode=verifyEmail&oobCode=test',
    displayName: 'Coach',
    uid: 'user-1',
    now: new Date('2026-07-12T00:00:00.000Z')
  });

  assert.deepEqual(job.to, ['coach@example.com']);
  assert.equal(job.message.subject, 'Verify your ALL PLAYS email');
  assert.match(job.message.html, /Verify email/);
  assert.equal(job.metadata.provider, 'resend');
  assert.equal(job.metadata.authUserId, 'user-1');
});

test('escapes user-controlled display and invitation text in HTML templates', () => {
  const message = buildAuthEmailMessage({
    type: AUTH_EMAIL_TYPES.SIGN_IN,
    actionUrl: 'https://allplays.ai/accept-invite.html?code=TEST1234&type=admin',
    displayName: '<script>alert(1)</script>',
    contextLabel: 'Eagles\r\nBcc: attacker@example.com <img src=x onerror=alert(1)>'
  });

  assert.doesNotMatch(message.html, /<script>|<img/);
  assert.match(message.html, /&lt;script&gt;/);
  assert.match(message.html, /&lt;img/);
  assert.doesNotMatch(message.subject, /[\r\n]/);
});

test('uses the ALL PLAYS action handler and rejects off-origin invite continuations', () => {
  assert.deepEqual(getAuthEmailActionSettings(AUTH_EMAIL_TYPES.VERIFICATION), {
    url: 'https://allplays.ai/app/#/verify-pending',
    handleCodeInApp: false
  });
  assert.deepEqual(getAuthEmailActionSettings(AUTH_EMAIL_TYPES.PASSWORD_RESET), {
    url: 'https://allplays.ai/app/#/reset-password',
    handleCodeInApp: true
  });
  assert.throws(
    () => getAuthEmailActionSettings(AUTH_EMAIL_TYPES.SIGN_IN, 'https://evil.example/steal'),
    /ALL PLAYS origin/
  );
});

test('builds invite continuation URLs for each supported passwordless flow', () => {
  assert.equal(
    getInviteContinueUrl('ABCD1234', 'admin_invite'),
    'https://allplays.ai/app/#/accept-invite?code=ABCD1234&type=admin'
  );
  assert.equal(
    getInviteContinueUrl('HOME1234', 'household_invite'),
    'https://allplays.ai/app/#/accept-invite?code=HOME1234&type=household'
  );
  assert.equal(
    getInviteContinueUrl('COPE1234', 'coparent_invite'),
    'https://allplays.ai/app/#/accept-invite?code=COPE1234&type=coparent'
  );
  assert.throws(() => getInviteContinueUrl('short', 'admin_invite'), /eight-character code/);
});

test('rewrites generated Firebase actions to canonical app entry routes', () => {
  assert.equal(
    buildCanonicalAuthActionUrl(
      'https://game-flow-c6311.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=reset-code&apiKey=public-key&lang=en',
      AUTH_EMAIL_TYPES.PASSWORD_RESET
    ),
    'https://allplays.ai/app/#/reset-password?mode=resetPassword&oobCode=reset-code&apiKey=public-key&lang=en'
  );

  assert.equal(
    buildCanonicalAuthActionUrl(
      'https://game-flow-c6311.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=verify-code&apiKey=public-key',
      AUTH_EMAIL_TYPES.VERIFICATION
    ),
    'https://allplays.ai/app/#/reset-password?mode=verifyEmail&oobCode=verify-code&apiKey=public-key&next=%2Fverify-pending'
  );

  const continueUrl = encodeURIComponent(
    'https://allplays.ai/app/#/accept-invite?code=HOME1234&type=household'
  );
  assert.equal(
    buildCanonicalAuthActionUrl(
      `https://game-flow-c6311.firebaseapp.com/__/auth/action?mode=signIn&oobCode=sign-in-code&apiKey=public-key&continueUrl=${continueUrl}`,
      AUTH_EMAIL_TYPES.SIGN_IN
    ),
    'https://allplays.ai/app/#/accept-invite?code=HOME1234&type=household&mode=signIn&oobCode=sign-in-code&apiKey=public-key'
  );
});

test('rejects malformed and mismatched generated Firebase actions', () => {
  assert.throws(
    () => buildCanonicalAuthActionUrl(
      'https://game-flow-c6311.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=code',
      AUTH_EMAIL_TYPES.PASSWORD_RESET
    ),
    /does not match/
  );
  assert.throws(
    () => buildCanonicalAuthActionUrl('https://game-flow-c6311.firebaseapp.com/__/auth/action', AUTH_EMAIL_TYPES.VERIFICATION),
    /missing required parameters/
  );
});

test('mail and rate-limit identifiers do not expose recipient email addresses', () => {
  const mailId = buildAuthEmailMailDocId(
    AUTH_EMAIL_TYPES.PASSWORD_RESET,
    'private@example.com',
    123,
    'fixed'
  );
  const rateLimitId = buildAuthEmailRateLimitId(
    AUTH_EMAIL_TYPES.PASSWORD_RESET,
    'private@example.com'
  );

  assert.doesNotMatch(mailId, /private|example/);
  assert.doesNotMatch(rateLimitId, /private|example/);
  assert.equal(normalizeAuthEmail(' Private@Example.COM '), 'private@example.com');
});
