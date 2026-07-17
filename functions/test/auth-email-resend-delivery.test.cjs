'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createResendAuthEmailDelivery,
  isTransientResendError
} = require('../resend-auth-email-delivery.cjs');

function createFakeFirestore(options = {}) {
  const documents = new Map();
  let autoId = 0;
  const clone = (value) => value == null ? value : structuredClone(value);
  const applyWrite = (path, input, merge = false) => {
    const current = merge ? clone(documents.get(path) || {}) : {};
    for (const [key, value] of Object.entries(input)) {
      if (value?.__fieldValue === 'delete') {
        delete current[key];
      } else if (value?.__fieldValue === 'increment') {
        current[key] = Number(current[key] || 0) + value.amount;
      } else if (value?.__fieldValue === 'serverTimestamp') {
        current[key] = 'SERVER_TIMESTAMP';
      } else {
        current[key] = clone(value);
      }
    }
    documents.set(path, current);
  };
  const snapshotFor = (ref) => ({
    id: ref.id,
    ref,
    exists: documents.has(ref.path),
    data: () => clone(documents.get(ref.path))
  });
  const docRef = (collectionName, id) => ({
    id,
    path: `${collectionName}/${id}`,
    async create(value) {
      if (documents.has(this.path)) {
        const error = new Error('already exists');
        error.code = 6;
        throw error;
      }
      applyWrite(this.path, value);
    },
    async get() {
      return snapshotFor(this);
    },
    async set(value, options = {}) {
      applyWrite(this.path, value, options.merge === true);
    },
    async update(value) {
      applyWrite(this.path, value, true);
    }
  });
  const queryFor = (collectionName, field, expected, limitValue = Infinity) => ({
    limit(value) {
      return queryFor(collectionName, field, expected, value);
    },
    async get() {
      const prefix = `${collectionName}/`;
      const docs = [];
      for (const [path, data] of documents) {
        if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) continue;
        if (data[field] !== expected) continue;
        const ref = docRef(collectionName, path.slice(prefix.length));
        docs.push(snapshotFor(ref));
        if (docs.length >= limitValue) break;
      }
      return { docs, empty: docs.length === 0 };
    }
  });
  const firestore = {
    collection(name) {
      return {
        doc: (id = `auto-${++autoId}`) => docRef(name, id),
        where: (field, operator, expected) => {
          assert.equal(operator, '==');
          return queryFor(name, field, expected);
        }
      };
    },
    batch() {
      const writes = [];
      return {
        set(ref, value, options = {}) {
          writes.push({ ref, value, options });
        },
        async commit() {
          writes.forEach(({ ref, value, options }) => applyWrite(ref.path, value, options.merge === true));
        }
      };
    },
    async runTransaction(callback) {
      const attemptCount = options.transactionAttempts || 1;
      for (let attempt = 1; attempt <= attemptCount; attempt += 1) {
        const writes = [];
        const result = await callback({
          get: async (ref) => snapshotFor(ref),
          set: (ref, value, writeOptions = {}) => writes.push({ ref, value, writeOptions })
        });
        if (attempt < attemptCount) {
          options.beforeTransactionRetry?.({
            attempt,
            set: (path, value, merge = true) => applyWrite(path, value, merge)
          });
          continue;
        }
        writes.forEach(({ ref, value, writeOptions }) => applyWrite(ref.path, value, writeOptions.merge === true));
        return result;
      }
    }
  };
  return {
    firestore,
    FieldValue: {
      delete: () => ({ __fieldValue: 'delete' }),
      increment: (amount) => ({ __fieldValue: 'increment', amount }),
      serverTimestamp: () => ({ __fieldValue: 'serverTimestamp' })
    },
    get(path) {
      return clone(documents.get(path));
    },
    has(path) {
      return documents.has(path);
    },
    set(path, value, merge = true) {
      applyWrite(path, value, merge);
    }
  };
}

function buildJob(actionUrl = 'https://allplays.ai/reset-password.html?oobCode=first') {
  return {
    to: ['coach@allplays.ai'],
    message: {
      subject: 'Reset your ALL PLAYS password',
      text: `Reset: ${actionUrl}`,
      html: `<a href="${actionUrl}">Reset</a>`
    },
    metadata: {
      type: 'auth_password_reset',
      authUserId: 'user-1',
      inviteCodeId: null
    }
  };
}

function createHarness(options = {}) {
  const db = options.db || createFakeFirestore();
  const sends = [];
  const verifies = [];
  const errors = [];
  const warnings = [];
  const resendResults = [...(options.resendResults || [{ data: { id: 'resend-message-1' } }])];
  const resend = {
    emails: {
      async send(payload, requestOptions) {
        sends.push({ payload, requestOptions });
        const result = resendResults.shift();
        if (result instanceof Error) throw result;
        return result;
      }
    },
    webhooks: {
      async verify(input) {
        verifies.push(input);
        if (options.verifyError) throw options.verifyError;
        return options.verifiedEvent;
      }
    }
  };
  const fetches = [];
  const service = createResendAuthEmailDelivery({
    firestore: db.firestore,
    FieldValue: db.FieldValue,
    logger: {
      error: (message, meta) => errors.push({ message, meta }),
      warn: (message, meta) => warnings.push({ message, meta })
    },
    resend,
    webhookSecret: 'whsec_test',
    firebaseWebApiKey: 'firebase-public-key',
    fetchImpl: async (url, request) => {
      fetches.push({ url, request });
      return options.fetchResponse || { ok: true, status: 200, json: async () => ({ email: 'coach@allplays.ai' }) };
    },
    maxSendAttempts: options.maxSendAttempts ?? 3,
    sleep: async (millis) => (options.sleeps || []).push(millis),
    now: options.now || (() => new Date('2026-07-17T12:00:00.000Z'))
  });
  return { db, errors, fetches, resend, sends, service, verifies, warnings };
}

test('Resend API delivery retries transient failures with one stable idempotency key', async () => {
  const sleeps = [];
  const harness = createHarness({
    sleeps,
    resendResults: [
      { error: { name: 'rate_limit_exceeded', message: 'slow down', statusCode: 429 } },
      { error: { name: 'internal_server_error', message: 'retry', statusCode: 503 } },
      { data: { id: 'resend-message-7' } }
    ]
  });

  const result = await harness.service.send({ deliveryId: 'auth_password_reset_request-7', job: buildJob() });

  assert.equal(result.providerMessageId, 'resend-message-7');
  assert.equal(harness.sends.length, 3);
  assert.deepEqual(sleeps, [250, 500]);
  assert.equal(new Set(harness.sends.map((entry) => entry.requestOptions.idempotencyKey)).size, 1);
  assert.equal(harness.sends[0].payload.from, 'ALL PLAYS <noreply@mail.allplays.ai>');
  assert.deepEqual(harness.sends[0].payload.tags.map((tag) => tag.name), ['category', 'auth_type', 'delivery_id']);
  assert.equal(harness.db.get('authEmailDeliveries/auth_password_reset_request-7').state, 'accepted');
  assert.equal(harness.db.get('authEmailDeliveries/auth_password_reset_request-7').attemptCount, 3);
  assert.equal(harness.db.get('authEmailDeliveries/auth_password_reset_request-7').message, undefined);
  assert.equal(harness.db.get('authEmailDeliveries/auth_password_reset_request-7').expiresAt.toISOString(), '2026-07-18T12:00:00.000Z');
  assert.equal(harness.db.get('resendEmailMessages/resend-message-7').deliveryId, 'auth_password_reset_request-7');
});

test('a function retry reuses the stored one-time link and deduplicates after acceptance', async () => {
  const harness = createHarness({
    maxSendAttempts: 1,
    resendResults: [
      { error: { name: 'validation_error', message: 'temporary test failure', statusCode: 422 } },
      { data: { id: 'resend-message-stable' } }
    ]
  });
  await assert.rejects(
    harness.service.send({ deliveryId: 'stable-delivery', job: buildJob('https://allplays.ai/reset?code=original') }),
    /temporary test failure/
  );
  await harness.service.send({
    deliveryId: 'stable-delivery',
    job: buildJob('https://allplays.ai/reset?code=must-not-replace-original')
  });
  const deduplicated = await harness.service.send({ deliveryId: 'stable-delivery', job: buildJob() });

  assert.match(harness.sends[1].payload.text, /code=original/);
  assert.doesNotMatch(harness.sends[1].payload.text, /must-not-replace/);
  assert.equal(harness.sends.length, 2);
  assert.equal(deduplicated.deduplicated, true);
});

test('non-transient provider rejection is recorded and not retried', async () => {
  const harness = createHarness({
    resendResults: [{ error: { name: 'validation_error', message: 'bad sender', statusCode: 422 } }]
  });
  await assert.rejects(harness.service.send({ deliveryId: 'rejected', job: buildJob() }), /bad sender/);
  assert.equal(harness.sends.length, 1);
  assert.equal(harness.db.get('authEmailDeliveries/rejected').state, 'send_failed');
  assert.equal(harness.errors.length, 1);
});

test('verified delivered webhook uses the exact raw body and records final delivery', async () => {
  const event = {
    type: 'email.delivered',
    created_at: '2026-07-17T12:02:00.000Z',
    data: { email_id: 'resend-message-1' }
  };
  const harness = createHarness({ verifiedEvent: event });
  await harness.service.send({ deliveryId: 'webhook-delivery', job: buildJob() });
  const response = createResponse();
  await harness.service.handleWebhook({
    method: 'POST',
    rawBody: Buffer.from('{"signed":"bytes"}'),
    headers: {
      'svix-id': 'webhook-delivered',
      'svix-timestamp': 'timestamp',
      'svix-signature': 'signature'
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(harness.verifies[0].payload, '{"signed":"bytes"}');
  assert.equal(harness.verifies[0].webhookSecret, 'whsec_test');
  assert.equal(harness.db.get('authEmailDeliveries/webhook-delivery').state, 'delivered');
  assert.equal(harness.db.get('resendWebhookEvents/webhook-delivered').status, 'processed');
});

test('invalid webhook signature is rejected without changing delivery state', async () => {
  const harness = createHarness({ verifyError: new Error('bad signature') });
  await harness.service.send({ deliveryId: 'unchanged', job: buildJob() });
  const response = createResponse();
  await harness.service.handleWebhook({
    method: 'POST',
    rawBody: Buffer.from('{}'),
    headers: { 'svix-id': 'invalid-event' }
  }, response);
  assert.equal(response.statusCode, 400);
  assert.equal(harness.db.get('authEmailDeliveries/unchanged').state, 'accepted');
  assert.equal(harness.db.has('resendWebhookEvents/invalid-event'), false);
});

test('webhook returns a retryable error while its provider-message mapping is not committed', async () => {
  const event = {
    type: 'email.bounced',
    created_at: '2026-07-17T12:02:00.000Z',
    data: { email_id: 'not-mapped-yet' }
  };
  const harness = createHarness({ verifiedEvent: event });
  const response = createResponse();
  await harness.service.handleWebhook({
    method: 'POST',
    rawBody: Buffer.from('{}'),
    headers: { 'svix-id': 'early-webhook' }
  }, response);

  assert.equal(response.statusCode, 500);
  assert.equal(harness.db.get('resendWebhookEvents/early-webhook').status, 'pending_mapping');
});

test('bounce opens an alert and sends the Firebase password-reset fallback only once', async () => {
  const harness = createHarness();
  await harness.service.send({ deliveryId: 'bounced-reset', job: buildJob() });
  const event = {
    type: 'email.bounced',
    created_at: '2026-07-17T12:05:00.000Z',
    data: { email_id: 'resend-message-1' }
  };
  const first = await harness.service.processVerifiedWebhook(event, 'bounce-event-1');
  const duplicate = await harness.service.processVerifiedWebhook(event, 'bounce-event-duplicate');

  assert.equal(first.fallbackSent, true);
  assert.equal(duplicate.fallbackSent, false);
  assert.equal(harness.fetches.length, 1);
  assert.match(harness.fetches[0].url, /accounts:sendOobCode\?key=firebase-public-key/);
  assert.deepEqual(JSON.parse(harness.fetches[0].request.body), {
    requestType: 'PASSWORD_RESET',
    email: 'coach@allplays.ai',
    continueUrl: 'https://allplays.ai/reset-password.html',
    canHandleCodeInApp: true
  });
  const delivery = harness.db.get('authEmailDeliveries/bounced-reset');
  assert.equal(delivery.state, 'bounced');
  assert.equal(delivery.fallbackState, 'sent');
  assert.equal(delivery.fallbackAttemptCount, 1);
  assert.equal(harness.db.has('emailDeliveryAlerts/resend-message-1_email_bounced'), true);
});

test('an out-of-order old bounce cannot override delivery or trigger fallback', async () => {
  const harness = createHarness();
  await harness.service.send({ deliveryId: 'ordered-delivery', job: buildJob() });
  await harness.service.processVerifiedWebhook({
    type: 'email.delivered',
    created_at: '2026-07-17T12:10:00.000Z',
    data: { email_id: 'resend-message-1' }
  }, 'new-delivered');
  const old = await harness.service.processVerifiedWebhook({
    type: 'email.bounced',
    created_at: '2026-07-17T12:01:00.000Z',
    data: { email_id: 'resend-message-1' }
  }, 'old-bounce');

  assert.equal(old.applied, false);
  assert.equal(harness.db.get('authEmailDeliveries/ordered-delivery').state, 'delivered');
  assert.equal(harness.fetches.length, 0);
  assert.equal(harness.db.has('emailDeliveryAlerts/resend-message-1_email_bounced'), false);
});

test('transaction retry discards stale fallback and alert decisions', async () => {
  const db = createFakeFirestore({
    transactionAttempts: 2,
    beforeTransactionRetry: ({ set }) => set('authEmailDeliveries/retried-delivery', {
      state: 'delivered',
      providerEventType: 'email.delivered',
      providerEventAt: '2026-07-17T12:10:00.000Z'
    })
  });
  const harness = createHarness({ db });
  await harness.service.send({ deliveryId: 'retried-delivery', job: buildJob() });
  const result = await harness.service.processVerifiedWebhook({
    type: 'email.bounced',
    created_at: '2026-07-17T12:01:00.000Z',
    data: { email_id: 'resend-message-1' }
  }, 'retried-old-bounce');

  assert.equal(result.applied, false);
  assert.equal(result.fallbackSent, false);
  assert.equal(harness.fetches.length, 0);
  assert.equal(harness.db.has('emailDeliveryAlerts/resend-message-1_email_bounced'), false);
  assert.equal(harness.db.get('authEmailDeliveries/retried-delivery').state, 'delivered');
});

test('a concurrent webhook retries until an abandoned fallback lease can be reclaimed', async () => {
  const harness = createHarness();
  await harness.service.send({ deliveryId: 'leased-fallback', job: buildJob() });
  harness.db.set('authEmailDeliveries/leased-fallback', {
    fallbackState: 'claimed',
    fallbackClaimedAt: '2026-07-17T11:59:00.000Z'
  });
  const event = {
    type: 'email.bounced',
    created_at: '2026-07-17T12:05:00.000Z',
    data: { email_id: 'resend-message-1' }
  };

  await assert.rejects(
    harness.service.processVerifiedWebhook(event, 'concurrent-bounce'),
    (error) => error.code === 'fallback-in-progress'
  );
  assert.equal(harness.fetches.length, 0);

  harness.db.set('authEmailDeliveries/leased-fallback', {
    fallbackClaimedAt: '2026-07-17T11:50:00.000Z'
  });
  const reclaimed = await harness.service.processVerifiedWebhook(event, 'reclaimed-bounce');
  assert.equal(reclaimed.fallbackSent, true);
  assert.equal(harness.fetches.length, 1);
});

test('complaint is tracked and alerted without sending another email', async () => {
  const harness = createHarness();
  await harness.service.send({ deliveryId: 'complained-delivery', job: buildJob() });
  await harness.service.processVerifiedWebhook({
    type: 'email.complained',
    created_at: '2026-07-17T12:11:00.000Z',
    data: { email_id: 'resend-message-1' }
  }, 'complaint');
  assert.equal(harness.db.get('authEmailDeliveries/complained-delivery').state, 'complained');
  assert.equal(harness.fetches.length, 0);
  assert.equal(harness.db.has('emailDeliveryAlerts/resend-message-1_email_complained'), true);
});

test('transient classification is bounded to retryable provider and network errors', () => {
  assert.equal(isTransientResendError({ statusCode: 429 }), true);
  assert.equal(isTransientResendError({ statusCode: 503 }), true);
  assert.equal(isTransientResendError({ code: 'ECONNRESET' }), true);
  assert.equal(isTransientResendError({ statusCode: 422, name: 'validation_error' }), false);
});

function createResponse() {
  return {
    statusCode: null,
    body: '',
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    }
  };
}
