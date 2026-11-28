'use strict';

// Regression tests for the resource-packets callable error mapping (#5307):
// provider failures must keep their underlying code (permission-denied /
// unavailable / ...) instead of collapsing into a generic 'internal', so the
// Home video-assignments panel can surface a real diagnostic.

const assert = require('node:assert/strict');
const test = require('node:test');
const { createResourcePacketHandlers } = require('../resource-packets-handlers.cjs');

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const functions = {
  https: {
    onCall: (handler) => handler,
    HttpsError: TestHttpsError
  }
};

function createHandlers({ getUser }) {
  return createResourcePacketHandlers({
    functions,
    db: {},
    auth: { getUser },
    enabled: () => true
  });
}

const context = { auth: { uid: 'parent-1', token: { auth_time: Math.floor(Date.now() / 1000) } } };

test('forwards a string provider error code for linkedPlayers failures', async () => {
  const failure = new Error('service unavailable');
  failure.code = 'unavailable';
  const handlers = createHandlers({ getUser: async () => { throw failure; } });

  await assert.rejects(
    handlers.query({ view: 'linkedPlayers' }, context),
    (error) => error.code === 'unavailable'
      && error.message === 'The packet could not be loaded or saved. Retry with the same request.'
  );
});

test('forwards a numeric gRPC provider error code for linkedPlayers failures', async () => {
  const failure = new Error('permission denied');
  failure.code = 7;
  const handlers = createHandlers({ getUser: async () => { throw failure; } });

  await assert.rejects(
    handlers.query({ view: 'linkedPlayers' }, context),
    (error) => error.code === 'permission-denied'
  );
});

test('keeps PacketError codes and messages unchanged', async () => {
  const handlers = createHandlers({ getUser: async () => ({ disabled: true, emailVerified: true }) });

  await assert.rejects(
    handlers.query({ view: 'linkedPlayers' }, context),
    (error) => error.code === 'permission-denied'
      && error.message === 'A verified active account is required.'
  );
});

test('collapses unknown provider error codes to internal', async () => {
  const failure = new Error('something odd');
  failure.code = 'totally-unknown';
  const handlers = createHandlers({ getUser: async () => { throw failure; } });

  await assert.rejects(
    handlers.query({ view: 'linkedPlayers' }, context),
    (error) => error.code === 'internal'
  );
});
