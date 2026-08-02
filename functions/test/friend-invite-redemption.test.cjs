'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
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
    token: { phone_number: ' +13125551212 ' }
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
