const assert = require('node:assert/strict');
const test = require('node:test');
const { collectTelemetry } = require('../index.js');

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
  t.mock.method(console, 'error', (...args) => loggedErrors.push(args));
  const response = createResponse();

  await collectTelemetry({
    method: 'POST',
    headers: {
      origin: ALLOWED_ORIGIN,
      'content-type': 'application/json',
      'x-firebase-appcheck': appCheckToken
    },
    body: { events: [] }
  }, response);

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { ok: false, error: 'No telemetry events provided' });
  assertTelemetryCorsPolicy(response);
  assert.equal(JSON.stringify(loggedErrors).includes(appCheckToken), false);
  assert.equal(JSON.stringify(response).includes(appCheckToken), false);
});
