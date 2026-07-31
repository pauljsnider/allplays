const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isPublicRsvpReplay,
  normalizePublicRsvpResponse
} = require('../public-rsvp-idempotency-core.cjs');

test('normalizes only supported public RSVP responses', () => {
  assert.equal(normalizePublicRsvpResponse(' Going '), 'going');
  assert.equal(normalizePublicRsvpResponse('NOT_GOING'), 'not_going');
  assert.equal(normalizePublicRsvpResponse('yes'), '');
});

test('identifies same-response retries without treating invalid input as a replay', () => {
  assert.equal(isPublicRsvpReplay('going', ' Going '), true);
  assert.equal(isPublicRsvpReplay('maybe', 'not_going'), false);
  assert.equal(isPublicRsvpReplay('', ''), false);
  assert.equal(isPublicRsvpReplay('unexpected', 'unexpected'), false);
});
