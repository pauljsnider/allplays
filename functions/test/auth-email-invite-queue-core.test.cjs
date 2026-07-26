'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildInviteMailDocId } = require('../invite-email-queue-core.cjs');

test('normal invite deliveries retain one deterministic mail document', () => {
  assert.equal(buildInviteMailDocId('ABCD1234'), 'invite_ABCD1234');
  assert.equal(buildInviteMailDocId('ABCD1234'), 'invite_ABCD1234');
});

test('resends use an idempotent delivery-specific mail document', () => {
  assert.equal(
    buildInviteMailDocId('ABCD1234', {
      forceNewDelivery: true,
      deliveryId: 'retry-request-1'
    }),
    'invite_ABCD1234_retry_retry-request-1'
  );
  assert.notEqual(
    buildInviteMailDocId('ABCD1234', {
      forceNewDelivery: true,
      deliveryId: 'retry-request-1'
    }),
    buildInviteMailDocId('ABCD1234')
  );
});

test('resends require a delivery ID', () => {
  assert.throws(
    () => buildInviteMailDocId('ABCD1234', { forceNewDelivery: true }),
    /delivery ID is required/
  );
});
