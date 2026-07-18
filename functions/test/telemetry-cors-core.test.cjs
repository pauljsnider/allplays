'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isAllowedTelemetryOrigin } = require('../telemetry-cors-core.cjs');

test('telemetry CORS allows production and Firebase Hosting RSVP origins', () => {
  assert.equal(isAllowedTelemetryOrigin('https://allplays.ai'), true);
  assert.equal(isAllowedTelemetryOrigin('https://www.allplays.ai'), true);
  assert.equal(isAllowedTelemetryOrigin('https://game-flow-c6311.web.app'), true);
  assert.equal(isAllowedTelemetryOrigin('https://game-flow-c6311.firebaseapp.com'), true);
  assert.equal(isAllowedTelemetryOrigin('https://game-flow-c6311--pr-4029-5585dlsc.web.app'), true);
});

test('telemetry CORS preserves explicitly configured origins', () => {
  const configuredOrigins = new Set(['https://telemetry-client.example.test']);
  assert.equal(isAllowedTelemetryOrigin('https://telemetry-client.example.test', configuredOrigins), true);
});

test('telemetry CORS rejects missing and lookalike origins', () => {
  assert.equal(isAllowedTelemetryOrigin(''), false);
  assert.equal(isAllowedTelemetryOrigin(undefined), false);
  assert.equal(isAllowedTelemetryOrigin('https://evil.example'), false);
  assert.equal(isAllowedTelemetryOrigin('https://game-flow-c6311--x.web.app.evil.com'), false);
  assert.equal(isAllowedTelemetryOrigin('http://allplays.ai'), false);
});
