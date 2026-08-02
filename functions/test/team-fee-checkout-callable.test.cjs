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
                update: (ref, value) => operations.push({ ref, value, options: { merge: true } })
            });
            if (options.failTransactionWhen?.({ call: metrics.transactionCalls, operations })) {
                throw new Error('Forced Firestore transaction failure.');
            }
            operations.forEach((operation) => write(operation.ref.path, operation.value, operation.options));
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

function loadCallable({ seed, retrieve, create, expire, firestoreOptions } = {}) {
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
                webhooks: { constructEvent: () => { throw new Error('Not implemented in test.'); } }
            };
        }
    };

    const exports = require('../index.js');
    return {
        callable: exports.createStripeTeamFeeCheckout,
        teamPassCallable: exports.createStripeTeamPassCheckout,
        firestore,
        metrics
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
        seed: baseSeed({
            checkoutUrl: session.url,
            checkoutStatus: 'open',
            checkoutAttemptToken: session.metadata.checkoutAttemptToken,
            checkoutAmountCents: 7500,
            stripeCheckoutSessionId: session.id
        }),
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

test('replaces a definitively expired persisted session with a validated fresh session', async () => {
    const expired = makeSession({ status: 'expired' });
    const { callable, metrics } = loadCallable({
        seed: baseSeed({
            checkoutUrl: expired.url,
            checkoutStatus: 'open',
            checkoutAttemptToken: expired.metadata.checkoutAttemptToken,
            checkoutAmountCents: 7500,
            stripeCheckoutSessionId: expired.id
        }),
        retrieve: async () => expired
    });

    const result = await callable(input, context);
    assert.equal(result.checkoutUrl, 'https://checkout.stripe.com/c/pay/cs_test_new');
    assert.equal(result.sessionId, 'cs_test_new');
    assert.equal(metrics.retrieveCalls.length, 1);
    assert.equal(metrics.createCalls.length, 1);
    assert.ok(metrics.writes.some(({ path, value }) => path.endsWith('/recipient-1') && value.checkoutUrl === result.checkoutUrl));
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
    assert.ok(metrics.writes.some(({ path, value }) => path.endsWith('/recipient-1') && value.checkoutUrl === result.checkoutUrl));
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
            seed: baseSeed({
                checkoutUrl,
                checkoutStatus: 'open',
                checkoutAttemptToken: session.metadata.checkoutAttemptToken,
                checkoutAmountCents: 7500,
                stripeCheckoutSessionId: session.id
            }),
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
        seed: baseSeed({
            checkoutUrl: session.url,
            checkoutStatus: 'open',
            checkoutAttemptToken: session.metadata.checkoutAttemptToken,
            checkoutAmountCents: 7500,
            stripeCheckoutSessionId: session.id
        }),
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
    assert.equal(metrics.writes.some(({ value }) => Boolean(value?.checkoutUrl)), false);
    const recipient = firestore._state.get(recipientPath);
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'checkoutCreationReservationId'), false);
});

test('expires a new Stripe session and clears its reservation when Firestore persistence fails', async () => {
    const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
    const { callable, firestore, metrics } = loadCallable({
        firestoreOptions: {
            failTransactionWhen: ({ operations }) => operations.some(({ value }) => Boolean(value?.checkoutUrl))
        }
    });

    await assert.rejects(callable(input, context), /Forced Firestore transaction failure/);

    assert.deepEqual(metrics.expireCalls, ['cs_test_new']);
    const recipient = firestore._state.get(recipientPath);
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'checkoutCreationReservationId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'checkoutCreationStartedAt'), false);
});

test('returns a committed team-fee checkout without expiring it when the transaction response fails', async () => {
    const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
    const { callable, firestore, metrics } = loadCallable({
        firestoreOptions: {
            failTransactionAfterCommitWhen: ({ operations }) => operations.some(({ value }) => Boolean(value?.checkoutUrl))
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
    assert.equal(recipient.stripeCheckoutSessionId, 'cs_test_new');
    assert.equal(Object.prototype.hasOwnProperty.call(recipient, 'checkoutCreationReservationId'), false);
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
                if (!operations.some(({ value }) => Boolean(value?.checkoutUrl))) return false;
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
