'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createNativeWebAuthTokenHandler,
  normalizeAuthenticatedUid
} = require('../native-web-auth-token-core.cjs');

class TestHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

test('native WebView auth token binds only the authenticated caller uid', async () => {
  const calls = [];
  const handler = createNativeWebAuthTokenHandler({
    getAuth: () => ({
      async createCustomToken(uid) {
        calls.push(uid);
        return 'caller-bound-custom-token';
      }
    }),
    HttpsError: TestHttpsError
  });

  const result = await handler(
    { uid: 'spoofed-client-uid' },
    { auth: { uid: 'native.user:1' } }
  );

  assert.deepEqual(result, { customToken: 'caller-bound-custom-token' });
  assert.deepEqual(calls, ['native.user:1']);
});

test('native WebView auth token preserves opaque caller uids byte-for-byte', async () => {
  const calls = [];
  const handler = createNativeWebAuthTokenHandler({
    getAuth: () => ({
      async createCustomToken(uid) {
        calls.push(uid);
        return `token:${uid}`;
      }
    }),
    HttpsError: TestHttpsError
  });

  await handler({}, { auth: { uid: ' victim ' } });
  await handler({}, { auth: { uid: 'victim' } });
  await handler({}, { auth: { uid: 'tenant/user' } });

  assert.deepEqual(calls, [' victim ', 'victim', 'tenant/user']);
});

test('native WebView auth token fails closed without a valid authenticated uid', async () => {
  const createCustomToken = () => {
    throw new Error('must not run');
  };
  const handler = createNativeWebAuthTokenHandler({
    getAuth: () => ({ createCustomToken }),
    HttpsError: TestHttpsError
  });

  for (const context of [
    {},
    { auth: {} },
    { auth: { uid: 'x'.repeat(129) } },
    { auth: { uid: 42 } }
  ]) {
    await assert.rejects(() => handler({}, context), (error) => error.code === 'unauthenticated');
  }
});

test('native WebView auth token converts provider failures into a retryable error', async () => {
  const handler = createNativeWebAuthTokenHandler({
    getAuth: () => ({
      async createCustomToken() {
        throw new Error('provider details must not escape');
      }
    }),
    HttpsError: TestHttpsError
  });

  await assert.rejects(
    () => handler({}, { auth: { uid: 'native-user' } }),
    (error) => error.code === 'unavailable' && !error.message.includes('provider details')
  );
});

test('native WebView uid validation accepts the complete product uid contract', () => {
  assert.equal(normalizeAuthenticatedUid(' user.with:punctuation '), ' user.with:punctuation ');
  assert.equal(normalizeAuthenticatedUid('contains/slash'), 'contains/slash');
  assert.equal(normalizeAuthenticatedUid(''), '');
});
