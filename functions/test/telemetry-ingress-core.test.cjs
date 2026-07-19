const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const {
  ATTESTED_REQUESTS_PER_WINDOW,
  MAX_APP_CHECK_TOKEN_BYTES,
  MAX_ATTESTED_EVENTS_PER_REQUEST,
  MAX_TELEMETRY_WRITES_PER_REQUEST,
  MAX_TELEMETRY_BODY_BYTES,
  MAX_UNATTESTED_EVENTS_PER_REQUEST,
  ORDINARY_TELEMETRY_WRITES_PER_REQUEST,
  TELEMETRY_AGGREGATE_SHARD_COUNT,
  UNATTESTED_REQUESTS_PER_WINDOW,
  canonicalizeTelemetryAppRoute,
  canonicalizeTelemetryEventName,
  canonicalizeTelemetryPagePath,
  deduplicateTelemetryEvents,
  getTelemetryAggregateShard,
  getTelemetryBodyByteLength,
  getTelemetryIngressPolicy,
  getTelemetryRateLimitBoundary,
  verifyTelemetryAppCheck
} = require('../telemetry-ingress-core.cjs');

test('measures the platform raw body even when Content-Length is missing or spoofed', () => {
  const oversized = Buffer.alloc(MAX_TELEMETRY_BODY_BYTES + 1, 0x61);
  assert.equal(getTelemetryBodyByteLength({
    headers: { 'content-length': '2' },
    rawBody: oversized,
    body: { events: [] }
  }), oversized.length);
});

test('measures the serialized UTF-8 body when no raw body is available', () => {
  const body = { value: '⚽'.repeat(100) };
  assert.equal(getTelemetryBodyByteLength({ body }), Buffer.byteLength(JSON.stringify(body), 'utf8'));
  assert.throws(() => {
    const circular = {};
    circular.self = circular;
    getTelemetryBodyByteLength({ body: circular });
  }, /circular/i);
});

test('server-verifies supplied App Check and does not treat missing or invalid tokens as verified', async () => {
  let verifiedToken = null;
  const verified = await verifyTelemetryAppCheck({
    headers: { 'X-Firebase-AppCheck': 'valid-web-or-native-token' }
  }, async (token) => {
    verifiedToken = token;
    return { appId: 'firebase-app-id' };
  });
  assert.equal(verifiedToken, 'valid-web-or-native-token');
  assert.deepEqual(verified, {
    status: 'verified',
    rateLimitKey: crypto.createHash('sha256').update('valid-web-or-native-token').digest('hex')
  });

  assert.deepEqual(await verifyTelemetryAppCheck({ headers: {} }, async () => {
    throw new Error('must not run');
  }), { status: 'missing' });
  assert.deepEqual(await verifyTelemetryAppCheck({
    headers: { 'x-firebase-appcheck': 'spoofed-token' }
  }, async () => {
    throw new Error('invalid token');
  }), { status: 'invalid' });

  let oversizedVerifyCalled = false;
  assert.deepEqual(await verifyTelemetryAppCheck({
    headers: { 'x-firebase-appcheck': 'x'.repeat(MAX_APP_CHECK_TOKEN_BYTES + 1) }
  }, async () => {
    oversizedVerifyCalled = true;
  }), { status: 'invalid' });
  assert.equal(oversizedVerifyCalled, false);
});

test('uses a high-entropy token fingerprint only for verified durable limits', async () => {
  const verified = await verifyTelemetryAppCheck({
    headers: { 'x-firebase-appcheck': 'high-entropy-app-check-token' }
  }, async () => ({ appId: 'firebase-app-id' }));
  const verifiedBoundary = getTelemetryRateLimitBoundary(verified);

  assert.match(verifiedBoundary, /^verified\|[a-f0-9]{64}$/);
  assert.equal(verifiedBoundary.includes('high-entropy-app-check-token'), false);
  assert.equal(getTelemetryRateLimitBoundary({ status: 'missing' }), null);
  assert.equal(getTelemetryRateLimitBoundary({ status: 'invalid' }), null);
  assert.equal(getTelemetryRateLimitBoundary({ status: 'verified', rateLimitKey: 'forged' }), null);
});

test('preserves ordinary batches while bounding observe-mode request and write budgets', () => {
  assert.deepEqual(getTelemetryIngressPolicy('verified'), {
    verified: true,
    maxEvents: MAX_ATTESTED_EVENTS_PER_REQUEST,
    maxRequests: ATTESTED_REQUESTS_PER_WINDOW
  });
  assert.deepEqual(getTelemetryIngressPolicy('invalid'), {
    verified: false,
    maxEvents: MAX_UNATTESTED_EVENTS_PER_REQUEST,
    maxRequests: UNATTESTED_REQUESTS_PER_WINDOW
  });
  assert.deepEqual(getTelemetryIngressPolicy('missing'), getTelemetryIngressPolicy('invalid'));
  assert.equal(MAX_ATTESTED_EVENTS_PER_REQUEST, 15);
  assert.equal(MAX_UNATTESTED_EVENTS_PER_REQUEST, 15);
  assert.equal(TELEMETRY_AGGREGATE_SHARD_COUNT, 16);
  assert.equal(ORDINARY_TELEMETRY_WRITES_PER_REQUEST, 20);
  assert.equal(MAX_TELEMETRY_WRITES_PER_REQUEST, 76);
  assert.ok(MAX_TELEMETRY_WRITES_PER_REQUEST < 450);
});

test('selects one deterministic finite aggregate shard per request', () => {
  const events = [{ id: 'event-one' }, { id: 'event-two' }];
  assert.match(getTelemetryAggregateShard(events), /^s(?:0\d|1[0-5])$/);
  assert.equal(getTelemetryAggregateShard(events), getTelemetryAggregateShard(events));
  assert.match(getTelemetryAggregateShard([]), /^s(?:0\d|1[0-5])$/);
});

test('maps attacker-controlled aggregate dimensions into finite buckets', () => {
  assert.equal(canonicalizeTelemetryEventName('app_workflow_timing'), 'app_workflow_timing');
  assert.equal(canonicalizeTelemetryEventName('attacker_metric_1'), 'other_event');
  assert.equal(canonicalizeTelemetryEventName('attacker_metric_2'), 'other_event');

  assert.equal(canonicalizeTelemetryPagePath('/dashboard.html'), '/dashboard.html');
  assert.equal(canonicalizeTelemetryPagePath('/random-1'), '/other');
  assert.equal(canonicalizeTelemetryPagePath('/random-2'), '/other');

  assert.equal(canonicalizeTelemetryAppRoute('/players/:id/:id'), '/players/:id/:id');
  assert.equal(canonicalizeTelemetryAppRoute('/teams/:id/fees/:id'), '/teams/:id/fees/:id');
  assert.equal(canonicalizeTelemetryAppRoute('/help/schedule-basics'), '/help/:id');
  assert.equal(canonicalizeTelemetryAppRoute('/players/attacker-one/attacker-two'), '/players/:id/:id');
  assert.equal(canonicalizeTelemetryAppRoute('/attacker/one'), '/other');
  assert.equal(canonicalizeTelemetryAppRoute('/attacker/two'), '/other');
});

test('keeps every production client event in the finite server vocabulary', () => {
  const repositoryRoot = path.resolve(__dirname, '../..');
  const clientSources = [
    'js/telemetry.js',
    'apps/app/src/lib/telemetry.ts',
    'apps/app/src/lib/webVitals.ts'
  ].map((relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8'));
  const capturedNames = new Set();
  const pattern = /(?:captureTelemetryEvent|captureAppTelemetryEvent)\(\s*['"]([^'"]+)['"]/g;
  for (const source of clientSources) {
    for (const match of source.matchAll(pattern)) capturedNames.add(match[1]);
  }

  assert.ok(capturedNames.size > 10);
  for (const name of capturedNames) {
    assert.equal(canonicalizeTelemetryEventName(name), name, `${name} must be source-controlled`);
  }
});

test('deduplicates repeated event ids before persistence cost is incurred', () => {
  assert.deepEqual(deduplicateTelemetryEvents([
    { id: 'one' },
    { id: 'one' },
    { id: 'two' },
    null
  ]), [{ id: 'one' }, { id: 'two' }]);
});
