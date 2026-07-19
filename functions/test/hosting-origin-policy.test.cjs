const { test } = require('node:test');
const assert = require('node:assert');
const {
  isAllPlaysFirebaseHostingOrigin
} = require('../hosting-origin-policy.cjs');

test('allows the project default Firebase Hosting origins', () => {
  assert.strictEqual(isAllPlaysFirebaseHostingOrigin('https://game-flow-c6311.web.app'), true);
  assert.strictEqual(isAllPlaysFirebaseHostingOrigin('https://game-flow-c6311.firebaseapp.com'), true);
});

test('allows project-scoped Firebase Hosting preview channels', () => {
  assert.strictEqual(
    isAllPlaysFirebaseHostingOrigin('https://game-flow-c6311--pr-4045-j0xbcyb5.web.app'),
    true
  );
  assert.strictEqual(
    isAllPlaysFirebaseHostingOrigin('https://game-flow-c6311--staging.firebaseapp.com'),
    true
  );
});

test('rejects lookalike, cross-project, non-HTTPS, and non-origin values', () => {
  [
    'https://other-project.web.app',
    'https://game-flow-c6311.web.app.evil.example',
    'https://game-flow-c6311--preview.web.app.evil.example',
    'http://game-flow-c6311.web.app',
    'https://game-flow-c6311.web.app:444',
    'https://game-flow-c6311.web.app/path',
    'not-an-origin',
    ''
  ].forEach((origin) => {
    assert.strictEqual(isAllPlaysFirebaseHostingOrigin(origin), false, origin);
  });
});
