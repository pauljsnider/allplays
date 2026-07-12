const assert = require('node:assert/strict');
const test = require('node:test');
const { isAllowedPublicRsvpOrigin } = require('../public-rsvp-cors-core.cjs');

test('public RSVP CORS allows production origins', () => {
  assert.equal(isAllowedPublicRsvpOrigin('https://allplays.ai'), true);
  assert.equal(isAllowedPublicRsvpOrigin('https://www.allplays.ai'), true);
  assert.equal(isAllowedPublicRsvpOrigin('https://game-flow-c6311.web.app'), true);
  assert.equal(isAllowedPublicRsvpOrigin('https://game-flow-c6311.firebaseapp.com'), true);
});

test('public RSVP CORS allows localhost dev server ports', () => {
  assert.equal(isAllowedPublicRsvpOrigin('http://localhost:8000'), true);
  assert.equal(isAllowedPublicRsvpOrigin('http://127.0.0.1:8000'), true);
  assert.equal(isAllowedPublicRsvpOrigin('http://localhost:8004'), true);
  assert.equal(isAllowedPublicRsvpOrigin('http://127.0.0.1:8004'), true);
  assert.equal(isAllowedPublicRsvpOrigin('http://localhost:5173'), true);
  assert.equal(isAllowedPublicRsvpOrigin('http://localhost:5174'), true);
  assert.equal(isAllowedPublicRsvpOrigin('http://localhost:5175'), true);
  assert.equal(isAllowedPublicRsvpOrigin('http://127.0.0.1:5174'), true);
  assert.equal(isAllowedPublicRsvpOrigin('http://127.0.0.1:5175'), true);
});

test('public RSVP CORS allows Firebase preview channel origins', () => {
  assert.equal(isAllowedPublicRsvpOrigin('https://game-flow-c6311--pr-3864-abc123.web.app'), true);
  assert.equal(isAllowedPublicRsvpOrigin('https://game-flow-c6311--feature-x.web.app'), true);
});

test('public RSVP CORS rejects everything else', () => {
  assert.equal(isAllowedPublicRsvpOrigin('*'), false);
  assert.equal(isAllowedPublicRsvpOrigin('https://evil.example'), false);
  assert.equal(isAllowedPublicRsvpOrigin('https://game-flow-c6311--x.web.app.evil.com'), false);
  assert.equal(isAllowedPublicRsvpOrigin('http://allplays.ai'), false);
  assert.equal(isAllowedPublicRsvpOrigin('https://localhost:5174'), false);
  assert.equal(isAllowedPublicRsvpOrigin('http://localhost:5174.evil.com'), false);
  assert.equal(isAllowedPublicRsvpOrigin('http://localhost'), false);
  assert.equal(isAllowedPublicRsvpOrigin('https://game-flow-c6311--.web.app'), false);
  assert.equal(isAllowedPublicRsvpOrigin(''), false);
  assert.equal(isAllowedPublicRsvpOrigin(undefined), false);
  assert.equal(isAllowedPublicRsvpOrigin(null), false);
});
