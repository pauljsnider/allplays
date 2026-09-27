const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPublicRsvpRateLimitBoundaries
} = require('../public-rsvp-rate-limit-core.cjs');

test('keys primary RSVP limits by token for users sharing one network', () => {
  const first = buildPublicRsvpRateLimitBoundaries({
    operation: 'write',
    token: 'token-a',
    ip: '203.0.113.10'
  });
  const second = buildPublicRsvpRateLimitBoundaries({
    operation: 'write',
    token: 'token-b',
    ip: '203.0.113.10'
  });

  assert.notEqual(first[0].boundary, second[0].boundary);
  assert.equal(first[0].boundary.includes('token-a'), false);
  assert.equal(first[0].maxRequests, 20);
  assert.equal(first[1].boundary, second[1].boundary);
  assert.equal(first[1].maxRequests, 200);
});

test('keeps read token limits isolated beneath a higher network abuse ceiling', () => {
  const boundaries = buildPublicRsvpRateLimitBoundaries({
    operation: 'read',
    token: 'token-a',
    ip: '203.0.113.10'
  });

  assert.equal(boundaries[0].maxRequests, 60);
  assert.equal(boundaries[1].maxRequests, 600);
  assert.ok(boundaries[1].maxRequests > boundaries[0].maxRequests);
});
