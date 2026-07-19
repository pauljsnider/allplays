const assert = require('node:assert/strict');
const test = require('node:test');
const { collectTelemetry } = require('../index.js');
const admin = require('firebase-admin');
const functions = require('firebase-functions');

const ALLOWED_ORIGIN = 'https://allplays.ai';
const NATIVE_ORIGINS = [
  'capacitor://localhost',
  'http://localhost'
];
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

function assertTelemetryCorsPolicy(response, expectedOrigin = ALLOWED_ORIGIN) {
  assert.equal(response.headers.get('access-control-allow-origin'), expectedOrigin);
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

for (const origin of NATIVE_ORIGINS) {
  test(`collectTelemetry accepts the native app origin ${origin}`, async () => {
    const response = createResponse();

    await collectTelemetry({
      method: 'OPTIONS',
      headers: {
        origin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type'
      }
    }, response);

    assert.equal(response.statusCode, 204);
    assert.equal(response.body, '');
    assertTelemetryCorsPolicy(response, origin);
  });
}

test('collectTelemetry rejects lookalike native origins without reflecting them', async () => {
  const response = createResponse();

  await collectTelemetry({
    method: 'OPTIONS',
    headers: {
      origin: 'http://localhost.evil.example',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type'
    }
  }, response);

  assert.equal(response.statusCode, 403);
  assert.deepEqual(response.body, { ok: false, error: 'Origin not allowed' });
  assert.equal(response.headers.get('access-control-allow-origin'), undefined);
  assert.equal(response.headers.get('vary'), undefined);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('collectTelemetry fails passive when ingress controls fail without exposing App Check', async (t) => {
  const appCheckToken = 'opaque-app-check-value-never-log';
  const loggedErrors = [];
  let transactionStarted = false;
  t.mock.method(functions.logger, 'error', (...args) => loggedErrors.push(args));
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

  assert.equal(response.statusCode, 204);
  assert.equal(response.body, '');
  assert.equal(transactionStarted, true);
  assertTelemetryCorsPolicy(response);
  for (const args of loggedErrors) {
    for (const arg of args) {
      const value = arg instanceof Error ? arg.message : String(arg);
      assert.equal(value.includes(appCheckToken), false);
    }
  }
  assert.deepEqual(loggedErrors[0], [
    'Telemetry ingress control failed.',
    {
      eventType: 'operational_telemetry_ingress_control_failure',
      errorCode: 'Error'
    }
  ]);
  for (const [name, value] of response.headers) {
    assert.equal(name.includes(appCheckToken), false);
    assert.equal(String(value).includes(appCheckToken), false);
  }
  assert.equal(String(response.body).includes(appCheckToken), false);
});

function buildEvents(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index}`,
    name: 'page_view',
    sessionId: `session-${index}`,
    pagePath: '/app/',
    appRoute: '/home'
  }));
}

function mockSuccessfulTelemetryPersistence(t) {
  const created = [];
  const sets = [];
  let transactionCount = 0;
  t.mock.method(admin.firestore(), 'runTransaction', async (handler) => {
    transactionCount += 1;
    return handler({
      get: async () => ({ exists: false, data: () => undefined }),
      create: (ref, data) => created.push({ path: ref.path, data }),
      set: (ref, data) => sets.push({ path: ref.path, data })
    });
  });
  return { created, sets, get transactionCount() { return transactionCount; } };
}

test('collectTelemetry rejects an actual oversized chunked body despite a spoofed small length', async (t) => {
  const verifyCalls = [];
  const persistence = mockSuccessfulTelemetryPersistence(t);
  t.mock.method(admin.appCheck(), 'verifyToken', async (token) => verifyCalls.push(token));
  const response = createResponse();

  await collectTelemetry({
    method: 'POST',
    ip: '203.0.113.40',
    headers: {
      origin: ALLOWED_ORIGIN,
      'content-length': '10'
    },
    rawBody: Buffer.alloc(64 * 1024 + 1, 0x61),
    body: { events: buildEvents(1) }
  }, response);

  assert.equal(response.statusCode, 413);
  assert.deepEqual(response.body, { ok: false, error: 'Telemetry payload too large' });
  assert.deepEqual(verifyCalls, []);
  assert.equal(persistence.transactionCount, 0);
});

test('collectTelemetry rejects an oversized serialized body when raw bytes and length are absent', async (t) => {
  const persistence = mockSuccessfulTelemetryPersistence(t);
  const response = createResponse();

  await collectTelemetry({
    method: 'POST',
    ip: '203.0.113.43',
    headers: { origin: ALLOWED_ORIGIN },
    body: {
      events: buildEvents(1),
      padding: '⚽'.repeat(30_000)
    }
  }, response);

  assert.equal(response.statusCode, 413);
  assert.deepEqual(response.body, { ok: false, error: 'Telemetry payload too large' });
  assert.equal(persistence.transactionCount, 0);
});

test('an allowed spoofed Origin remains unattested and receives the small observe-mode budget', async (t) => {
  const persistence = mockSuccessfulTelemetryPersistence(t);
  const presentedTokens = [];
  t.mock.method(admin.appCheck(), 'verifyToken', async (token) => {
    presentedTokens.push(token);
    throw new Error('invalid token');
  });
  const response = createResponse();

  await collectTelemetry({
    method: 'POST',
    ip: '203.0.113.41',
    headers: {
      origin: ALLOWED_ORIGIN,
      'x-firebase-appcheck': 'spoofed-token'
    },
    body: { events: buildEvents(20) }
  }, response);

  assert.equal(response.statusCode, 204);
  assert.equal(response.body, '');
  assert.deepEqual(presentedTokens, ['spoofed-token']);
  assert.equal(persistence.created.length, 2);
  assert.equal(persistence.transactionCount, 3); // one rate reservation + two event transactions
  assert.equal(persistence.created.every(({ data }) => data.appCheckStatus === 'invalid'), true);
});

test('missing App Check remains passive but cannot exceed the unattested event budget', async (t) => {
  const persistence = mockSuccessfulTelemetryPersistence(t);
  const verifyCalls = [];
  t.mock.method(admin.appCheck(), 'verifyToken', async (token) => verifyCalls.push(token));
  const response = createResponse();

  await collectTelemetry({
    method: 'POST',
    ip: '203.0.113.42',
    headers: {},
    body: { events: buildEvents(20) }
  }, response);

  assert.equal(response.statusCode, 204);
  assert.deepEqual(verifyCalls, []);
  assert.equal(persistence.created.length, 2);
  assert.equal(persistence.created.every(({ data }) => data.appCheckStatus === 'missing'), true);
});

for (const origin of [ALLOWED_ORIGIN, ...NATIVE_ORIGINS]) {
  test(`verified telemetry remains passive and preserves a full client batch for ${origin}`, async (t) => {
    const persistence = mockSuccessfulTelemetryPersistence(t);
    const presentedTokens = [];
    t.mock.method(admin.appCheck(), 'verifyToken', async (token) => {
      presentedTokens.push(token);
      return { appId: 'verified-firebase-app' };
    });
    const response = createResponse();

    await collectTelemetry({
      method: 'POST',
      ip: `203.0.113.${50 + NATIVE_ORIGINS.indexOf(origin)}`,
      headers: {
        origin,
        'x-firebase-appcheck': 'valid-app-check-token'
      },
      body: { events: buildEvents(20) }
    }, response);

    assert.equal(response.statusCode, 204);
    assert.equal(response.body, '');
    assert.deepEqual(presentedTokens, ['valid-app-check-token']);
    assert.equal(persistence.created.length, 15);
    assert.equal(persistence.transactionCount, 16); // one rate reservation + fifteen events
    assert.equal(persistence.created.every(({ data }) => data.appCheckStatus === 'verified'), true);
  });
}
