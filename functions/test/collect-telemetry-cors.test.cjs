const assert = require('node:assert/strict');
const test = require('node:test');
const { collectTelemetry } = require('../index.js');
const admin = require('firebase-admin');

const ALLOWED_ORIGIN = 'https://allplays.ai';
const APP_CHECK_HEADER = 'X-Firebase-AppCheck';
const ALLOWED_HEADERS = `Authorization, Content-Type, ${APP_CHECK_HEADER}`;

function createResponse() {
  return {
    body: undefined,
    headers: new Map(),
    statusCode: 200,
    set(name, value) {
      this.headers.set(String(name).toLowerCase(), value);
      return this;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

function assertTelemetryCorsPolicy(response) {
  assert.equal(response.headers.get('access-control-allow-origin'), ALLOWED_ORIGIN);
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST,OPTIONS');
  assert.equal(response.headers.get('access-control-allow-headers'), ALLOWED_HEADERS);
  assert.equal(response.headers.get('access-control-allow-credentials'), undefined);
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.equal(response.headers.get('cache-control'), 'no-store');
}

test('collectTelemetry accepts an App Check browser preflight without changing its CORS policy', async () => {
  const response = createResponse();

  await collectTelemetry({
    method: 'OPTIONS',
    headers: {
      origin: ALLOWED_ORIGIN,
      'access-control-request-method': 'POST',
      'access-control-request-headers': `content-type,${APP_CHECK_HEADER.toLowerCase()}`
    }
  }, response);

  assert.equal(response.statusCode, 204);
  assert.equal(response.body, '');
  assertTelemetryCorsPolicy(response);
});

test('collectTelemetry handles a POST carrying App Check without exposing its token', async (t) => {
  const appCheckToken = 'opaque-app-check-value-never-log';
  const loggedErrors = [];
  let transactionStarted = false;
  t.mock.method(console, 'error', (...args) => loggedErrors.push(args));
  t.mock.method(admin.firestore(), 'runTransaction', async (updateFunction) => {
    transactionStarted = true;
    await updateFunction({
      get: async () => ({ exists: false }),
      create() {},
      set() {}
    });
    throw new Error('Simulated telemetry persistence failure');
  });
  const response = createResponse();

  await collectTelemetry({
    method: 'POST',
    headers: {
      origin: ALLOWED_ORIGIN,
      'content-type': 'application/json',
      'x-firebase-appcheck': appCheckToken
    },
    body: {
      events: [{
        id: 'event-1',
        name: 'page_view',
        sessionId: 'session-1',
        visitorId: 'visitor-1',
        pagePath: '/app/'
      }]
    }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { ok: false, error: 'Simulated telemetry persistence failure' });
  assert.equal(transactionStarted, true);
  assertTelemetryCorsPolicy(response);
  for (const args of loggedErrors) {
    for (const arg of args) {
      const value = arg instanceof Error ? arg.message : String(arg);
      assert.equal(value.includes(appCheckToken), false);
    }
  }
  for (const [name, value] of response.headers) {
    assert.equal(name.includes(appCheckToken), false);
    assert.equal(String(value).includes(appCheckToken), false);
  }
  for (const value of Object.values(response.body)) {
    assert.equal(String(value).includes(appCheckToken), false);
  }
});
