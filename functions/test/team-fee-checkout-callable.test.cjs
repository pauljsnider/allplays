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

function makeFirestore(seed = {}, metrics = {}) {
    const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
    metrics.writes = [];

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
            const operations = [];
            const result = await handler({
                get: async (ref) => snapshot(ref.path),
                set: (ref, value, options) => operations.push(() => write(ref.path, value, options)),
                update: (ref, value) => operations.push(() => write(ref.path, value, { merge: true }))
            });
            operations.forEach((operation) => operation());
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
            stripe: { secret_key: 'sk_test_123', app_url: 'https://allplays.test' },
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

function loadCallable({ seed, retrieve, create } = {}) {
    delete require.cache[repoIndexPath];
    const metrics = { retrieveCalls: [], createCalls: [] };
    const firestore = makeFirestore(seed || baseSeed(), metrics);

    adminStub = {
        apps: [true],
        initializeApp() {},
        firestore: Object.assign(() => firestore, {
            FieldValue: {
                serverTimestamp: () => 'server-time',
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
                        create: async (params) => {
                            metrics.createCalls.push(clone(params));
                            return create ? create(params) : makeSession({
                                id: 'cs_test_new',
                                url: 'https://checkout.stripe.com/c/pay/cs_test_new',
                                metadata: clone(params.metadata)
                            });
                        }
                    }
                },
                refunds: { create: async () => ({}) },
                webhooks: { constructEvent: () => { throw new Error('Not implemented in test.'); } }
            };
        }
    };

    const exports = require('../index.js');
    return { callable: exports.createStripeTeamFeeCheckout, firestore, metrics };
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
    const { callable, metrics } = loadCallable({
        create: async (params) => makeSession({
            id: 'cs_test_new',
            url: 'https://example.com/poisoned',
            metadata: clone(params.metadata)
        })
    });

    await assert.rejects(callable(input, context), (error) => error.code === 'internal');
    assert.equal(metrics.createCalls.length, 1);
    assert.equal(metrics.writes.length, 0);
});
