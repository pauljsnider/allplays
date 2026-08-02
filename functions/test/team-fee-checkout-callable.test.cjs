const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const Module = require('node:module');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;
const originalPaymentsEnabled = process.env.PAYMENTS_ENABLED;

let adminStub;
let functionsStub;
let StripeStub;

function patchedModuleLoad(request, parent, isMain) {
    if (request === 'firebase-admin' && adminStub) return adminStub;
    if (request === 'firebase-functions' && functionsStub) return functionsStub;
    if (request === 'stripe' && StripeStub) return StripeStub;
    return originalModuleLoad(request, parent, isMain);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function makeFirestore(seed = {}, metrics = {}, options = {}) {
    const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
    metrics.writes = [];
    metrics.transactionCalls = 0;

    function snapshot(path) {
        const value = state.get(path);
        return {
            id: path.split('/').pop(),
            exists: value !== undefined,
            data: () => clone(value),
            ref: doc(path)
        };
    }

    function collection(path) {
        return {
            path,
            doc: (id) => doc(`${path}/${id}`),
            where() { return this; },
            orderBy() { return this; },
            limit() { return this; },
            startAfter() { return this; },
            async get() { return { docs: [], size: 0, empty: true }; }
        };
    }

    function doc(path) {
        return {
            path,
            id: path.split('/').pop(),
            get: async () => snapshot(path),
            collection: (name) => collection(`${path}/${name}`),
            set: async (value, options = {}) => write(path, value, options),
            update: async (value) => write(path, value, { merge: true })
        };
    }

    function write(path, value, options = {}) {
        const next = options.merge ? { ...(state.get(path) || {}), ...clone(value) } : clone(value);
        Object.entries(next || {}).forEach(([key, entry]) => {
            if (entry?.__op === 'delete') delete next[key];
        });
        state.set(path, next);
        metrics.writes.push({ path, value: clone(value), options: clone(options) });
    }

    return {
        _state: state,
        doc,
        collection,
        collectionGroup: collection,
        batch() {
            const operations = [];
            return {
                set: (ref, value, options) => operations.push(() => write(ref.path, value, options)),
                update: (ref, value) => operations.push(() => write(ref.path, value, { merge: true })),
                create: (ref, value) => operations.push(() => write(ref.path, value)),
                commit: async () => operations.forEach((operation) => operation())
            };
        },
        async runTransaction(handler) {
            metrics.transactionCalls += 1;
            const operations = [];
            const result = await handler({
                get: async (ref) => snapshot(ref.path),
                set: (ref, value, writeOptions) => operations.push({ ref, value, options: writeOptions }),
                update: (ref, value) => operations.push({ ref, value, options: { merge: true } }),
                delete: (ref) => operations.push({ ref, delete: true })
            });
            if (options.failTransactionWhen?.({ call: metrics.transactionCalls, operations })) {
                throw new Error('Forced Firestore transaction failure.');
            }
            operations.forEach((operation) => {
                if (operation.delete) {
                    state.delete(operation.ref.path);
                    metrics.writes.push({ path: operation.ref.path, delete: true });
                    return;
                }
                write(operation.ref.path, operation.value, operation.options);
            });
            if (options.failTransactionAfterCommitWhen?.({ call: metrics.transactionCalls, operations })) {
                throw new Error('Forced Firestore post-commit response failure.');
            }
            return result;
        }
    };
}

function makeFunctionsStub() {
    class HttpsError extends Error {
        constructor(code, message, details) {
            super(message);
            this.code = code;
            this.details = details;
        }
    }

    const triggerChain = {
        onCall: (handler) => handler,
        onRequest: (handler) => handler,
        onCreate: (handler) => handler,
        onUpdate: (handler) => handler,
        onWrite: (handler) => handler,
        onDelete: (handler) => handler,
        onRun: (handler) => handler,
        document() { return this; },
        schedule() { return this; },
        timeZone() { return this; }
    };
    triggerChain.https = triggerChain;
    triggerChain.firestore = triggerChain;
    triggerChain.pubsub = triggerChain;

    return {
        config: () => ({
            stripe: {
                secret_key: 'sk_test_123',
                webhook_secret: 'whsec_test_123',
                app_url: 'https://allplays.test',
                team_pass_price_id: 'price_team_pass'
            },
            security: { verified_email_mode: 'observe' }
        }),
        https: { HttpsError, onCall: (handler) => handler, onRequest: (handler) => handler },
        firestore: { document: () => triggerChain },
        auth: { user: () => triggerChain },
        pubsub: { schedule: () => triggerChain },
        runWith: () => triggerChain,
        logger: { error() {}, warn() {}, info() {} }
    };
}

function baseSeed(recipientOverrides = {}) {
    return {
        'teams/team-1': {
            ownerId: 'owner-1',
            adminEmails: []
        },
        'users/owner-1': {
            email: 'owner@example.com'
        },
        'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1': {
            teamId: 'team-1',
            batchId: 'batch-1',
            playerId: 'player-1',
            collectionMode: 'online_stripe',
            status: 'unpaid',
            amountDueCents: 7500,
            paidAmountCents: 0,
            ...recipientOverrides
        }
    };
}

function makeSession(overrides = {}) {
    return {
        id: 'cs_test_current',
        url: 'https://checkout.stripe.com/c/pay/cs_test_current',
        mode: 'payment',
        status: 'open',
        payment_status: 'unpaid',
        amount_total: 7500,
        metadata: {
            product: 'team_fee',
            teamId: 'team-1',
            batchId: 'batch-1',
            recipientId: 'recipient-1',
            payerUid: 'owner-1',
            checkoutAttemptToken: 'tok_current_123456',
            checkoutAmountCents: '7500'
        },
        ...overrides
    };
}

function seedWithPrivateCheckoutAttempt(session, { recipient = {}, attempt = {} } = {}) {
    const reservationId = attempt.reservationId || 'reservation-current';
    const seed = baseSeed({
        checkoutStatus: 'open',
        checkoutCreationReservationId: reservationId,
        checkoutCreationStartedAt: Date.now(),
        ...recipient
    });
    seed['teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1/checkoutAttempts/current'] = {
        reservationId,
        payerUid: session.metadata?.payerUid || 'owner-1',
        amountCents: 7500,
        checkoutUrl: session.url,
        checkoutStatus: 'open',
        checkoutAttemptToken: session.metadata?.checkoutAttemptToken,
        checkoutAmountCents: 7500,
        stripeCheckoutSessionId: session.id,
        ...attempt
    };
    return seed;
}

function loadCallable({ seed, retrieve, create, expire, firestoreOptions, webhookEvent } = {}) {
    delete require.cache[repoIndexPath];
    const metrics = { retrieveCalls: [], createCalls: [], expireCalls: [] };
    const firestore = makeFirestore(seed || baseSeed(), metrics, firestoreOptions);

    adminStub = {
        apps: [true],
        initializeApp() {},
        firestore: Object.assign(() => firestore, {
            FieldValue: {
                serverTimestamp: () => Date.now(),
                delete: () => ({ __op: 'delete' }),
                increment: (amount) => ({ __op: 'increment', amount }),
                arrayUnion: (...items) => ({ __op: 'arrayUnion', items })
            },
            Timestamp: { now: () => 'server-time', fromMillis: (value) => value },
            FieldPath: { documentId: () => '__name__' }
        }),
        auth: () => ({ verifyIdToken: async () => null }),
        messaging: () => ({})
    };
    functionsStub = makeFunctionsStub();
    StripeStub = class StripeMock {
        constructor() {
            return {
                checkout: {
                    sessions: {
                        retrieve: async (sessionId) => {
                            metrics.retrieveCalls.push(sessionId);
                            return retrieve ? retrieve(sessionId) : makeSession();
                        },
                        create: async (params, options) => {
                            metrics.createCalls.push({ params: clone(params), options: clone(options) });
                            return create ? create(params, options) : makeSession({
                                id: 'cs_test_new',
                                url: 'https://checkout.stripe.com/c/pay/cs_test_new',
                                metadata: clone(params.metadata)
                            });
                        },
                        expire: async (sessionId) => {
                            metrics.expireCalls.push(sessionId);
                            return expire ? expire(sessionId) : { id: sessionId, status: 'expired' };
                        }
                    }
                },
                refunds: { create: async () => ({}) },
                webhooks: {
                    constructEvent: () => {
                        if (webhookEvent) return clone(webhookEvent);
                        throw new Error('Not implemented in test.');
                    }
                }
            };
        }
    };

    const exports = require('../index.js');
    return {
        callable: exports.createStripeTeamFeeCheckout,
        teamPassCallable: exports.createStripeTeamPassCheckout,
        teamPassWebhook: exports.stripeTeamPassWebhook,
        firestore,
        metrics
    };
}

function makeWebhookResponse() {
    return {
        statusCode: 200,
        body: null,
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
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

const input = { teamId: 'team-1', batchId: 'batch-1', recipientId: 'recipient-1' };
const context = {
    auth: {
        uid: 'owner-1',
        token: { email: 'owner@example.com', email_verified: true }
    }
};

before(() => {
    process.env.PAYMENTS_ENABLED = 'true';
    Module._load = patchedModuleLoad;
});

after(() => {
    delete require.cache[repoIndexPath];
    Module._load = originalModuleLoad;
    if (originalPaymentsEnabled === undefined) delete process.env.PAYMENTS_ENABLED;
    else process.env.PAYMENTS_ENABLED = originalPaymentsEnabled;
});

test('reuses a valid current Stripe team-fee session without writing or creating', async () => {
    const session = makeSession();
    const { callable, metrics } = loadCallable({
        seed: seedWithPrivateCheckoutAttempt(session),
        retrieve: async () => session
    });

    await assert.doesNotReject(async () => {
        const result = await callable(input, context);
        assert.deepEqual(result, { checkoutUrl: session.url, sessionId: session.id });
    });
    assert.deepEqual(metrics.retrieveCalls, [session.id]);
    assert.equal(metrics.createCalls.length, 0);
    assert.equal(metrics.writes.length, 0);
});

test('migrates and reuses a legacy readable team-fee checkout for its original payer', async () => {
    const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
    const attemptPath = `${recipientPath}/checkoutAttempts/current`;
    const session = makeSession();
    const { callable, firestore, metrics } = loadCallable({
        seed: baseSeed({
            checkoutUrl: session.url,
            paymentLink: session.url,
            checkoutStatus: 'open',
            stripeCheckoutSessionId: session.id,
            checkoutAttemptToken: session.metadata.checkoutAttemptToken,
            checkoutAmountCents: 7500
        }),
        retrieve: async () => session
    });

    const result = await callable(input, context);

    assert.deepEqual(result, { checkoutUrl: session.url, sessionId: session.id });
    assert.deepEqual(metrics.retrieveCalls, [session.id]);
    assert.equal(metrics.createCalls.length, 0);
    const recipient = firestore._state.get(recipientPath);
    for (const field of ['checkoutUrl', 'paymentLink', 'stripeCheckoutSessionId', 'checkoutAttemptToken', 'checkoutAmountCents']) {
        assert.equal(Object.prototype.hasOwnProperty.call(recipient, field), false, `${field} must be scrubbed during migration`);
    }
    const privateAttempt = firestore._state.get(attemptPath);
    assert.equal(privateAttempt.checkoutUrl, session.url);
    assert.equal(privateAttempt.stripeCheckoutSessionId, session.id);
    assert.equal(privateAttempt.payerUid, 'owner-1');
});

test('migrates but never returns a legacy readable checkout owned by another payer', async () => {
    const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
    const attemptPath = `${recipientPath}/checkoutAttempts/current`;
    const session = makeSession({
        metadata: {
            ...makeSession().metadata,
            payerUid: 'other-admin'
        }
    });
    const seed = baseSeed({
        checkoutUrl: session.url,
        paymentLink: session.url,
        checkoutStatus: 'open',
        stripeCheckoutSessionId: session.id,
        checkoutAttemptToken: session.metadata.checkoutAttemptToken,
        checkoutAmountCents: 7500
    });
    seed['teams/team-1'].adminEmails = ['other-admin@example.com'];
    seed['users/other-admin'] = { email: 'other-admin@example.com' };
    const { callable, firestore, metrics } = loadCallable({ seed, retrieve: async () => session });

    await assert.rejects(callable(input, context), (error) => (
        error?.code === 'failed-precondition' && /belongs to another payer/i.test(error?.message || '')
    ));

    assert.deepEqual(metrics.retrieveCalls, [session.id]);
    assert.equal(metrics.createCalls.length, 0);
    const recipient = firestore._state.get(recipientPath);
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'checkoutUrl'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'stripeCheckoutSessionId'), false);
    assert.equal(firestore._state.get(attemptPath).payerUid, 'other-admin');
});

test('never returns an active checkout created by another eligible payer', async () => {
    const session = makeSession();
    const seed = seedWithPrivateCheckoutAttempt(session);
    seed['teams/team-1'].adminEmails = ['other-admin@example.com'];
    seed['users/other-admin'] = { email: 'other-admin@example.com' };
    const { callable, metrics } = loadCallable({ seed, retrieve: async () => session });

    await assert.rejects(
        callable(input, {
            auth: {
                uid: 'other-admin',
                token: { email: 'other-admin@example.com', email_verified: true }
            }
        }),
        (error) => error?.code === 'failed-precondition'
            && /belongs to another payer/i.test(error?.message || '')
    );
    assert.equal(metrics.retrieveCalls.length, 0);
    assert.equal(metrics.createCalls.length, 0);
    assert.equal(metrics.writes.length, 0);
});

test('stores checkout bearer data only in the server-private attempt document', async () => {
    const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
    const attemptPath = `${recipientPath}/checkoutAttempts/current`;
    const { callable, firestore } = loadCallable();

    const result = await callable(input, context);
    const recipient = firestore._state.get(recipientPath);
    const attempt = firestore._state.get(attemptPath);

    for (const field of ['checkoutUrl', 'paymentLink', 'stripeCheckoutSessionId', 'checkoutAttemptToken', 'checkoutAmountCents', 'checkoutCreationRequest', 'checkoutCreationPayerUid']) {
        assert.equal(Object.prototype.hasOwnProperty.call(recipient, field), false, `${field} must not be parent-readable`);
    }
    assert.match(recipient.checkoutCreationReservationId, /^[0-9a-f-]{36}$/i);
    assert.equal(attempt.checkoutUrl, result.checkoutUrl);
    assert.equal(attempt.stripeCheckoutSessionId, result.sessionId);
    assert.equal(attempt.payerUid, 'owner-1');
    assert.equal(attempt.checkoutAmountCents, 7500);
    assert.equal(attempt.checkoutCreationRequest.stripeParams.metadata.payerUid, 'owner-1');
    assert.match(attempt.checkoutCreationRequest.idempotencyKey, /^team_fee_checkout_[a-f0-9]{64}$/);
});

test('validates a paid team-fee webhook against the private attempt and then deletes it', async () => {
    const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
    const attemptPath = `${recipientPath}/checkoutAttempts/current`;
    const webhookEvent = {
        id: 'evt_team_fee_paid',
        type: 'checkout.session.completed',
        data: { object: {} }
    };
    const loaded = loadCallable({
        webhookEvent,
        create: async (params) => {
            const session = makeSession({
                id: 'cs_team_fee_paid',
                url: 'https://checkout.stripe.com/c/pay/cs_team_fee_paid',
                metadata: clone(params.metadata)
            });
            webhookEvent.data.object = {
                ...clone(session),
                status: 'complete',
                payment_status: 'paid',
                payment_intent: 'pi_team_fee_paid'
            };
            return session;
        }
    });

    await loaded.callable(input, context);
    const response = makeWebhookResponse();
    await loaded.teamPassWebhook({
        method: 'POST',
        rawBody: Buffer.from('event'),
        headers: { 'stripe-signature': 'sig_test' },
        ip: '127.0.0.3'
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { received: true, teamFeeUpdated: true });
    assert.equal(loaded.firestore._state.get(recipientPath).status, 'paid');
    assert.equal(loaded.firestore._state.has(attemptPath), false);
    assert.equal(Object.prototype.hasOwnProperty.call(
        loaded.firestore._state.get(recipientPath),
        'checkoutCreationReservationId'
    ), false);
});

test('replaces a definitively expired persisted session with a validated fresh session', async () => {
    const expired = makeSession({ status: 'expired' });
    const { callable, metrics } = loadCallable({
        seed: seedWithPrivateCheckoutAttempt(expired),
        retrieve: async () => expired
    });

    const result = await callable(input, context);
    assert.equal(result.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_new');
    assert.equal(result.sessionId, 'cs_test_new');
    assert.equal(metrics.retrieveCalls.length, 1);
    assert.equal(metrics.createCalls.length, 1);
    assert.ok(metrics.writes.some(({ path, value }) => path.endsWith('/checkoutAttempts/current') && value?.checkoutUrl === result.checkoutUrl));
});

test('replaces poisoned legacy destination metadata when no Stripe session can be reused', async () => {
    const { callable, metrics } = loadCallable({
        seed: baseSeed({
            checkoutUrl: 'https://example.com/legacy-poison',
            checkoutStatus: 'open',
            checkoutAttemptToken: 'bad token',
            checkoutAmountCents: 7500
        })
    });

    const result = await callable(input, context);
    assert.equal(result.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_new');
    assert.equal(metrics.retrieveCalls.length, 0);
    assert.equal(metrics.createCalls.length, 1);
    assert.ok(metrics.writes.some(({ path, value }) => path.endsWith('/checkoutAttempts/current') && value?.checkoutUrl === result.checkoutUrl));
});

for (const [label, checkoutUrl] of [
    ['HTTP', 'http://checkout.stripe.com/c/pay/cs_test_current'],
    ['malformed', 'not-a-url'],
    ['credential-bearing', 'https://user:pass@checkout.stripe.com/c/pay/cs_test_current'],
    ['non-Stripe', 'https://example.com/pay/cs_test_current']
]) {
    test(`fails closed for an active session with a ${label} persisted destination`, async () => {
        const session = makeSession();
        const { callable, metrics } = loadCallable({
            seed: seedWithPrivateCheckoutAttempt(session, { attempt: { checkoutUrl } }),
            retrieve: async () => session
        });

        await assert.rejects(callable(input, context), (error) => error.code === 'failed-precondition');
        assert.equal(metrics.createCalls.length, 0);
        assert.equal(metrics.writes.length, 0);
    });
}

test('fails closed when Stripe cannot determine whether the persisted session is reusable', async () => {
    const session = makeSession();
    const { callable, metrics } = loadCallable({
        seed: seedWithPrivateCheckoutAttempt(session),
        retrieve: async () => { throw new Error('provider timeout'); }
    });

    await assert.rejects(callable(input, context), (error) => error.code === 'unavailable');
    assert.equal(metrics.createCalls.length, 0);
    assert.equal(metrics.writes.length, 0);
});

test('does not persist or return an unsafe destination from fresh Stripe creation', async () => {
    const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
    const { callable, firestore, metrics } = loadCallable({
        create: async (params) => makeSession({
            id: 'cs_test_new',
            url: 'https://example.com/poisoned',
            metadata: clone(params.metadata)
        })
    });

    await assert.rejects(callable(input, context), (error) => error.code === 'internal');
    assert.equal(metrics.createCalls.length, 1);
    assert.deepEqual(metrics.expireCalls, ['cs_test_new']);
    assert.equal(metrics.writes.some(({ path, value }) => path === recipientPath && typeof value?.checkoutUrl === 'string'), false);
    const recipient = firestore._state.get(recipientPath);
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'checkoutCreationReservationId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'checkoutCreationRequest'), false);
});

test('expires a new Stripe session and clears its reservation when Firestore persistence fails', async () => {
    const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
    const { callable, firestore, metrics } = loadCallable({
        firestoreOptions: {
            failTransactionWhen: ({ operations }) => operations.some(({ value }) => typeof value?.checkoutUrl === 'string')
        }
    });

    await assert.rejects(callable(input, context), /Forced Firestore transaction failure/);

    assert.deepEqual(metrics.expireCalls, ['cs_test_new']);
    const recipient = firestore._state.get(recipientPath);
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'checkoutCreationReservationId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'checkoutCreationStartedAt'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'checkoutCreationRequest'), false);
});

test('returns a committed team-fee checkout without expiring it when the transaction response fails', async () => {
    const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
    const { callable, firestore, metrics } = loadCallable({
        firestoreOptions: {
            failTransactionAfterCommitWhen: ({ operations }) => operations.some(({ value }) => typeof value?.checkoutUrl === 'string')
        }
    });

    const result = await callable(input, context);

    assert.deepEqual(result, {
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_new',
        sessionId: 'cs_test_new'
    });
    assert.deepEqual(metrics.expireCalls, []);
    const recipient = firestore._state.get(recipientPath);
    assert.equal(recipient.checkoutStatus, 'open');
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'checkoutUrl'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'stripeCheckoutSessionId'), false);
    assert.match(recipient.checkoutCreationReservationId, /^[0-9a-f-]{36}$/i);
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'checkoutCreationRequest'), false);
    const privateAttempt = firestore._state.get(`${recipientPath}/checkoutAttempts/current`);
    assert.equal(privateAttempt.checkoutUrl, result.checkoutUrl);
    assert.equal(privateAttempt.stripeCheckoutSessionId, result.sessionId);
    assert.equal(privateAttempt.payerUid, 'owner-1');
});

test('does not expire a shared idempotent team-fee session when one concurrent persistence response fails', async () => {
    let checkoutPersistenceResponses = 0;
    let releaseFirstCreate;
    let markFirstCreateStarted;
    const firstCreateStarted = new Promise((resolve) => {
        markFirstCreateStarted = resolve;
    });
    let createCount = 0;
    const loaded = loadCallable({
        firestoreOptions: {
            failTransactionAfterCommitWhen: ({ operations }) => {
                if (!operations.some(({ value }) => typeof value?.checkoutUrl === 'string')) return false;
                checkoutPersistenceResponses += 1;
                return checkoutPersistenceResponses === 1;
            }
        },
        create: async (params) => {
            createCount += 1;
            if (createCount === 1) {
                markFirstCreateStarted();
                await new Promise((resolve) => {
                    releaseFirstCreate = resolve;
                });
            }
            return makeSession({
                id: 'cs_test_shared_commit',
                url: 'https://checkout.stripe.com/c/pay/cs_test_shared_commit',
                metadata: clone(params.metadata)
            });
        }
    });

    const firstPromise = loaded.callable(input, context);
    await firstCreateStarted;
    const secondPromise = loaded.callable(input, context);
    while (loaded.metrics.createCalls.length < 2) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    releaseFirstCreate();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    assert.deepEqual(first, second);
    assert.equal(first.sessionId, 'cs_test_shared_commit');
    assert.deepEqual(loaded.metrics.expireCalls, []);
});

test('uses one durable idempotency reservation for concurrent checkout creation', async () => {
    let releaseFirstCreate;
    let markFirstCreateStarted;
    const firstCreateStarted = new Promise((resolve) => {
        markFirstCreateStarted = resolve;
    });
    let createCount = 0;
    const loaded = loadCallable({
        create: async (params) => {
            createCount += 1;
            if (createCount === 1) {
                markFirstCreateStarted();
                await new Promise((resolve) => {
                    releaseFirstCreate = resolve;
                });
            }
            return makeSession({
                id: 'cs_test_concurrent',
                url: 'https://checkout.stripe.com/c/pay/cs_test_concurrent',
                metadata: clone(params.metadata)
            });
        }
    });

    const first = loaded.callable(input, context);
    await firstCreateStarted;
    const second = loaded.callable(input, context);
    while (loaded.metrics.createCalls.length < 2) {
        await new Promise((resolve) => setImmediate(resolve));
    }
    releaseFirstCreate();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    assert.deepEqual(firstResult, secondResult);
    assert.equal(loaded.metrics.createCalls.length, 2);
    const idempotencyKeys = loaded.metrics.createCalls.map(({ options }) => options?.idempotencyKey);
    assert.match(idempotencyKeys[0], /^team_fee_checkout_[a-f0-9]{64}$/);
    assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
    assert.deepEqual(loaded.metrics.createCalls[0], loaded.metrics.createCalls[1]);
});

test('replays the exact team-fee Stripe request after an uncertain provider response, even after the app timeout', async () => {
    const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
    const attemptPath = `${recipientPath}/checkoutAttempts/current`;
    let createCount = 0;
    const loaded = loadCallable({
        seed: baseSeed({
            feeTitle: 'Spring dues',
            playerName: 'Original Player',
            parentEmail: 'original-parent@example.com'
        }),
        create: async (params) => {
            createCount += 1;
            if (createCount === 1) {
                throw Object.assign(new Error('provider connection closed'), { type: 'StripeConnectionError' });
            }
            return makeSession({
                id: 'cs_test_uncertain_retry',
                url: 'https://checkout.stripe.com/c/pay/cs_test_uncertain_retry',
                metadata: clone(params.metadata)
            });
        }
    });

    await assert.rejects(loaded.callable(input, context), /provider connection closed/);
    const reserved = loaded.firestore._state.get(recipientPath);
    const privateAttempt = loaded.firestore._state.get(attemptPath);
    assert.equal(Object.prototype.hasOwnProperty.call(reserved, 'checkoutCreationRequest'), false);
    assert.equal(privateAttempt.payerUid, 'owner-1');
    assert.equal(privateAttempt.checkoutCreationRequest.stripeParams.customer_email, 'owner@example.com');
    reserved.feeTitle = 'Changed dues';
    reserved.playerName = 'Changed Player';
    reserved.parentEmail = 'changed-parent@example.com';
    reserved.checkoutCreationStartedAt = Date.now() - (24 * 60 * 60 * 1000);
    loaded.firestore._state.set(recipientPath, reserved);

    const retryContext = {
        auth: {
            uid: 'owner-1',
            token: { email: 'changed-owner@example.com', email_verified: true }
        }
    };
    const result = await loaded.callable(input, retryContext);

    assert.equal(result.sessionId, 'cs_test_uncertain_retry');
    assert.equal(loaded.metrics.createCalls.length, 2);
    assert.deepEqual(loaded.metrics.createCalls[1], loaded.metrics.createCalls[0]);
    assert.equal(Object.prototype.hasOwnProperty.call(
        loaded.firestore._state.get(recipientPath),
        'checkoutCreationRequest'
    ), false);
    const completedAttempt = loaded.firestore._state.get(attemptPath);
    assert.equal(completedAttempt.checkoutUrl, result.checkoutUrl);
    assert.equal(completedAttempt.stripeCheckoutSessionId, result.sessionId);
    assert.equal(completedAttempt.payerUid, 'owner-1');
});

test('does not replay one eligible payer exact request to another eligible payer', async () => {
    const seed = baseSeed();
    seed['teams/team-1'].adminEmails = ['other-admin@example.com'];
    seed['users/other-admin'] = { email: 'other-admin@example.com' };
    const loaded = loadCallable({
        seed,
        create: async () => {
            throw Object.assign(new Error('provider connection closed'), { type: 'StripeConnectionError' });
        }
    });

    await assert.rejects(loaded.callable(input, context), /provider connection closed/);
    await assert.rejects(
        loaded.callable(input, {
            auth: {
                uid: 'other-admin',
                token: { email: 'other-admin@example.com', email_verified: true }
            }
        }),
        (error) => error?.code === 'failed-precondition'
            && error?.message === 'Team fee checkout creation is already in progress.'
    );
    assert.equal(loaded.metrics.createCalls.length, 1);
});

test('clears an exact team-fee creation request after a definitive Stripe rejection', async () => {
    const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
    const attemptPath = `${recipientPath}/checkoutAttempts/current`;
    let createCount = 0;
    const loaded = loadCallable({
        create: async (params) => {
            createCount += 1;
            if (createCount === 1) {
                throw Object.assign(new Error('invalid Stripe request'), {
                    type: 'StripeInvalidRequestError',
                    statusCode: 400
                });
            }
            return makeSession({
                id: 'cs_test_after_definitive_rejection',
                url: 'https://checkout.stripe.com/c/pay/cs_test_after_definitive_rejection',
                metadata: clone(params.metadata)
            });
        }
    });

    await assert.rejects(loaded.callable(input, context), /invalid Stripe request/);
    const afterFailure = loaded.firestore._state.get(recipientPath);
    assert.equal(Object.prototype.hasOwnProperty.call(afterFailure, 'checkoutCreationReservationId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(afterFailure, 'checkoutCreationRequest'), false);
    assert.equal(loaded.firestore._state.has(attemptPath), false);

    const result = await loaded.callable(input, context);
    assert.equal(result.sessionId, 'cs_test_after_definitive_rejection');
    assert.notEqual(
        loaded.metrics.createCalls[0].options.idempotencyKey,
        loaded.metrics.createCalls[1].options.idempotencyKey
    );
});

test('uses a stable idempotency key for repeated team-pass checkout creation', async () => {
    const loaded = loadCallable({
        create: async (params) => ({
            id: 'cs_team_pass',
            url: 'https://checkout.stripe.com/c/pay/cs_team_pass',
            status: 'open',
            payment_status: 'unpaid',
            metadata: clone(params.metadata)
        })
    });
    const teamPassInput = { teamId: 'team-1', seasonId: '2026', tier: 'team-pass' };

    await loaded.teamPassCallable(teamPassInput, context);
    await loaded.teamPassCallable(teamPassInput, context);

    const idempotencyKeys = loaded.metrics.createCalls.map(({ options }) => options?.idempotencyKey);
    assert.equal(idempotencyKeys.length, 2);
    assert.match(idempotencyKeys[0], /^team_pass_checkout_[a-f0-9]{64}$/);
    assert.equal(idempotencyKeys[0], idempotencyKeys[1]);
    assert.deepEqual(loaded.metrics.createCalls[1], loaded.metrics.createCalls[0]);
    const attempt = [...loaded.firestore._state.entries()]
        .find(([path]) => path.includes('/teamPassCheckoutAttempts/'))?.[1];
    assert.equal(attempt?.status, 'open');
    assert.equal(attempt?.stripeCheckoutSessionId, 'cs_team_pass');
    assert.deepEqual(attempt?.checkoutCreationRequest?.stripeParams, loaded.metrics.createCalls[0].params);
});

test('serializes team-scoped checkout attempts without sharing checkout details across purchasers', async () => {
    let releaseFirstCreate;
    let markFirstCreateStarted;
    const firstCreateStarted = new Promise((resolve) => {
        markFirstCreateStarted = resolve;
    });
    let createCount = 0;
    const seed = baseSeed();
    seed['teams/team-1'].adminEmails = ['admin@example.com'];
    seed['users/admin-1'] = { email: 'admin@example.com' };
    const loaded = loadCallable({
        seed,
        create: async (params) => {
            createCount += 1;
            if (createCount === 1) {
                markFirstCreateStarted();
                await new Promise((resolve) => {
                    releaseFirstCreate = resolve;
                });
            }
            return {
                id: 'cs_team_pass_shared',
                url: 'https://checkout.stripe.com/c/pay/cs_team_pass_shared',
                status: 'open',
                payment_status: 'unpaid',
                metadata: clone(params.metadata)
            };
        }
    });
    const teamPassInput = { teamId: 'team-1', seasonId: '2026', tier: 'team-pass' };
    const adminContext = {
        auth: {
            uid: 'admin-1',
            token: { email: 'admin@example.com', email_verified: true }
        }
    };

    const ownerPromise = loaded.teamPassCallable(teamPassInput, context);
    await firstCreateStarted;
    await assert.rejects(
        loaded.teamPassCallable(teamPassInput, adminContext),
        (error) => error?.code === 'failed-precondition'
            && /another purchaser already has/i.test(error?.message || '')
    );
    assert.equal(loaded.metrics.createCalls.length, 1);
    releaseFirstCreate();
    const ownerResult = await ownerPromise;

    assert.equal(ownerResult.sessionId, 'cs_team_pass_shared');
    assert.equal(loaded.metrics.createCalls.length, 1);
    assert.equal(
        [...loaded.firestore._state.keys()].filter((path) => path.includes('/teamPassCheckoutAttempts/')).length,
        1
    );
});

test('does not create another checkout for an already active team pass', async () => {
    const seed = baseSeed();
    seed['teams/team-1/entitlements/2026_team-pass'] = {
        teamId: 'team-1',
        seasonId: '2026',
        tier: 'team-pass',
        status: 'active'
    };
    const loaded = loadCallable({ seed });

    await assert.rejects(
        loaded.teamPassCallable({ teamId: 'team-1', seasonId: '2026', tier: 'team-pass' }, context),
        (error) => error?.code === 'failed-precondition'
            && error?.message === 'This team already has an active team pass.'
    );
    assert.equal(loaded.metrics.createCalls.length, 0);
    assert.equal(
        [...loaded.firestore._state.keys()].some((path) => path.includes('/teamPassCheckoutAttempts/')),
        false
    );
});

test('persists and replays the exact team-pass request after an uncertain Stripe response', async () => {
    const originalPriceId = process.env.STRIPE_TEAM_PASS_PRICE_ID;
    const originalAppUrl = process.env.ALLPLAYS_APP_URL;
    process.env.STRIPE_TEAM_PASS_PRICE_ID = 'price_original_team_pass';
    process.env.ALLPLAYS_APP_URL = 'https://original.allplays.test';
    let createCount = 0;
    try {
        const loaded = loadCallable({
            create: async (params) => {
                createCount += 1;
                if (createCount === 1) {
                    throw Object.assign(new Error('provider response lost'), { type: 'StripeConnectionError' });
                }
                return {
                    id: 'cs_team_pass_recovered',
                    url: 'https://checkout.stripe.com/c/pay/cs_team_pass_recovered',
                    status: 'open',
                    payment_status: 'unpaid',
                    metadata: clone(params.metadata)
                };
            }
        });
        const teamPassInput = { teamId: 'team-1', seasonId: '2026', tier: 'team-pass' };

        await assert.rejects(loaded.teamPassCallable(teamPassInput, context), /provider response lost/);
        const reservedAttempt = [...loaded.firestore._state.entries()]
            .find(([path]) => path.includes('/teamPassCheckoutAttempts/'))?.[1];
        assert.match(reservedAttempt?.checkoutCreationRequest?.idempotencyKey || '', /^team_pass_checkout_[a-f0-9]{64}$/);
        assert.equal(reservedAttempt?.checkoutCreationRequest?.stripeParams.customer_email, 'owner@example.com');

        process.env.STRIPE_TEAM_PASS_PRICE_ID = 'price_changed_team_pass';
        process.env.ALLPLAYS_APP_URL = 'https://changed.allplays.test';
        const result = await loaded.teamPassCallable(teamPassInput, {
            auth: {
                uid: 'owner-1',
                token: { email: 'changed-owner@example.com', email_verified: true }
            }
        });

        assert.equal(result.sessionId, 'cs_team_pass_recovered');
        assert.equal(loaded.metrics.createCalls.length, 2);
        assert.deepEqual(loaded.metrics.createCalls[1], loaded.metrics.createCalls[0]);
        assert.equal(loaded.metrics.createCalls[1].params.line_items[0].price, 'price_original_team_pass');
        assert.match(loaded.metrics.createCalls[1].params.success_url, /^https:\/\/original\.allplays\.test\//);
        assert.equal(loaded.metrics.createCalls[1].params.customer_email, 'owner@example.com');
    } finally {
        if (originalPriceId === undefined) delete process.env.STRIPE_TEAM_PASS_PRICE_ID;
        else process.env.STRIPE_TEAM_PASS_PRICE_ID = originalPriceId;
        if (originalAppUrl === undefined) delete process.env.ALLPLAYS_APP_URL;
        else process.env.ALLPLAYS_APP_URL = originalAppUrl;
    }
});

test('clears a team-pass request after a definitive Stripe rejection and rotates the next key', async () => {
    let createCount = 0;
    const loaded = loadCallable({
        create: async (params) => {
            createCount += 1;
            if (createCount === 1) {
                throw Object.assign(new Error('invalid provider request'), {
                    type: 'StripeInvalidRequestError',
                    statusCode: 400
                });
            }
            return {
                id: 'cs_team_pass_after_rejection',
                url: 'https://checkout.stripe.com/c/pay/cs_team_pass_after_rejection',
                status: 'open',
                payment_status: 'unpaid',
                metadata: clone(params.metadata)
            };
        }
    });
    const teamPassInput = { teamId: 'team-1', seasonId: '2026', tier: 'team-pass' };

    await assert.rejects(loaded.teamPassCallable(teamPassInput, context), /invalid provider request/);
    const attemptAfterFailure = [...loaded.firestore._state.entries()]
        .find(([path]) => path.includes('/teamPassCheckoutAttempts/'))?.[1];
    assert.equal(Object.prototype.hasOwnProperty.call(attemptAfterFailure, 'checkoutCreationRequest'), false);

    const result = await loaded.teamPassCallable(teamPassInput, context);
    assert.equal(result.sessionId, 'cs_team_pass_after_rejection');
    assert.notEqual(
        loaded.metrics.createCalls[0].options.idempotencyKey,
        loaded.metrics.createCalls[1].options.idempotencyKey
    );
});

test('activates the team pass and removes the private exact request after paid webhook completion', async () => {
    const webhookEvent = {
        id: 'evt_team_pass_paid',
        type: 'checkout.session.completed',
        data: { object: {} }
    };
    const loaded = loadCallable({
        webhookEvent,
        create: async (params) => {
            const session = {
                id: 'cs_team_pass_paid',
                url: 'https://checkout.stripe.com/c/pay/cs_team_pass_paid',
                status: 'open',
                payment_status: 'unpaid',
                metadata: clone(params.metadata)
            };
            webhookEvent.data.object = {
                ...clone(session),
                status: 'complete',
                payment_status: 'paid',
                payment_intent: 'pi_team_pass_paid'
            };
            return session;
        }
    });

    await loaded.teamPassCallable({ teamId: 'team-1', seasonId: '2026', tier: 'team-pass' }, context);
    const response = makeWebhookResponse();
    await loaded.teamPassWebhook({
        method: 'POST',
        rawBody: Buffer.from('event'),
        headers: { 'stripe-signature': 'sig_test' },
        ip: '127.0.0.1'
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { received: true, unlocked: true });
    const entitlement = loaded.firestore._state.get('teams/team-1/entitlements/2026_team-pass');
    assert.equal(entitlement.status, 'active');
    assert.equal(entitlement.stripeCheckoutSessionId, 'cs_team_pass_paid');
    const attempt = [...loaded.firestore._state.entries()]
        .find(([path]) => path.includes('/teamPassCheckoutAttempts/'))?.[1];
    assert.equal(attempt.status, 'completed');
    assert.equal(Object.prototype.hasOwnProperty.call(attempt, 'checkoutCreationRequest'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(attempt, 'checkoutCreationReservationId'), false);
});

test('releases the durable team-pass attempt after Stripe confirms session expiration', async () => {
    const webhookEvent = {
        id: 'evt_team_pass_expired',
        type: 'checkout.session.expired',
        data: { object: {} }
    };
    const loaded = loadCallable({
        webhookEvent,
        create: async (params) => {
            const session = {
                id: 'cs_team_pass_expired',
                url: 'https://checkout.stripe.com/c/pay/cs_team_pass_expired',
                status: 'open',
                payment_status: 'unpaid',
                metadata: clone(params.metadata)
            };
            webhookEvent.data.object = {
                ...clone(session),
                status: 'expired'
            };
            return session;
        }
    });

    await loaded.teamPassCallable({ teamId: 'team-1', seasonId: '2026', tier: 'team-pass' }, context);
    const response = makeWebhookResponse();
    await loaded.teamPassWebhook({
        method: 'POST',
        rawBody: Buffer.from('event'),
        headers: { 'stripe-signature': 'sig_test' },
        ip: '127.0.0.2'
    }, response);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { received: true, unlocked: false });
    const attempt = [...loaded.firestore._state.entries()]
        .find(([path]) => path.includes('/teamPassCheckoutAttempts/'))?.[1];
    assert.equal(attempt.status, 'expired');
    assert.equal(Object.prototype.hasOwnProperty.call(attempt, 'checkoutCreationRequest'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(attempt, 'checkoutCreationReservationId'), false);
});

test('expires and rejects an untrusted team-pass checkout destination', async () => {
    const loaded = loadCallable({
        create: async (params) => ({
            id: 'cs_unsafe_team_pass',
            url: 'https://example.com/poisoned',
            status: 'open',
            payment_status: 'unpaid',
            metadata: clone(params.metadata)
        })
    });

    await assert.rejects(
        loaded.teamPassCallable({ teamId: 'team-1', seasonId: '2026', tier: 'team-pass' }, context),
        (error) => error?.code === 'internal'
    );
    assert.deepEqual(loaded.metrics.expireCalls, ['cs_unsafe_team_pass']);
});
