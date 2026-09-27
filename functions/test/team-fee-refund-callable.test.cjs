const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const Module = require('node:module');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

let adminStub;
let functionsStub;
let StripeStub;
const resendStub = { Resend: class ResendMock {} };

function patchedModuleLoad(request, parent, isMain) {
    if (request === 'firebase-admin' && adminStub) return adminStub;
    if (request === 'firebase-functions' && functionsStub) return functionsStub;
    if (request === 'stripe' && StripeStub) return StripeStub;
    if (request === 'resend') return resendStub;
    return originalModuleLoad(request, parent, isMain);
}

function clone(value) {
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function makeFirestore(seed, metrics) {
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

    function materialize(value, previous) {
        if (value?.__op === 'delete') return undefined;
        if (value?.__op === 'arrayUnion') {
            return [...(Array.isArray(previous) ? previous : []), ...clone(value.items)];
        }
        return clone(value);
    }

    function write(path, value, options = {}) {
        const current = state.get(path) || {};
        const next = options.merge ? { ...current } : {};
        for (const [key, entry] of Object.entries(value || {})) {
            const materialized = materialize(entry, current[key]);
            if (materialized === undefined) delete next[key];
            else next[key] = materialized;
        }
        state.set(path, next);
        metrics.writes.push({ path, value: clone(value), options: clone(options) });
    }

    function collection(path) {
        let typeFilter = null;
        return {
            path,
            doc: (id) => doc(`${path}/${id}`),
            where(field, operator, value) {
                if (field === 'type' && operator === '==') typeFilter = value;
                return this;
            },
            limit() { return this; },
            async get() {
                const docs = [...state.keys()]
                    .filter((candidate) => candidate.startsWith(`${path}/`) && candidate.split('/').length === path.split('/').length + 1)
                    .map(snapshot)
                    .filter((candidate) => !typeFilter || candidate.data()?.type === typeFilter);
                return { docs, size: docs.length, empty: docs.length === 0 };
            }
        };
    }

    function doc(path) {
        return {
            path,
            id: path.split('/').pop(),
            get: async () => snapshot(path),
            collection: (name) => collection(`${path}/${name}`),
            set: async (value, options) => write(path, value, options),
            update: async (value) => write(path, value, { merge: true })
        };
    }

    return {
        _state: state,
        doc,
        collection,
        collectionGroup: collection,
        batch: () => ({ set() {}, update() {}, create() {}, commit: async () => {} }),
        async runTransaction(handler) {
            const operations = [];
            const result = await handler({
                get: async (ref) => snapshot(ref.path),
                set: (ref, value, options) => operations.push({ ref, value, options }),
                update: (ref, value) => operations.push({ ref, value, options: { merge: true } }),
                delete: (ref) => operations.push({ ref, delete: true })
            });
            for (const operation of operations) {
                if (operation.delete) state.delete(operation.ref.path);
                else write(operation.ref.path, operation.value, operation.options);
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
    const chain = {
        onCall: (handler) => handler,
        onRequest: (handler) => handler,
        onCreate: (handler) => handler,
        onUpdate: (handler) => handler,
        onWrite: (handler) => handler,
        onDelete: (handler) => handler,
        onRun: (handler) => handler,
        document() { return this; },
        schedule() { return this; },
        timeZone() { return this; },
        user() { return this; }
    };
    chain.https = chain;
    chain.auth = chain;
    chain.firestore = chain;
    chain.pubsub = chain;
    return {
        config: () => ({
            stripe: { secret_key: 'test-key', webhook_secret: 'test-secret', app_url: 'https://allplays.test' },
            security: { verified_email_mode: 'observe' }
        }),
        https: { HttpsError, onCall: (handler) => handler, onRequest: (handler) => handler },
        firestore: { document: () => chain },
        auth: { user: () => chain },
        pubsub: { schedule: () => chain },
        runWith: () => chain,
        logger: { error() {}, warn() {}, info() {} }
    };
}

const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-a';
const billingPath = `${recipientPath}/adminBilling/latest`;

function baseSeed(billingOverrides = {}) {
    return {
        'teams/team-1': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' },
        [recipientPath]: {
            teamId: 'team-1',
            batchId: 'batch-1',
            paymentProvider: 'stripe',
            status: 'paid',
            amountCents: 5000,
            paidAmountCents: 5000,
            amountPaidCents: 5000,
            balanceDueCents: 0,
            refundedAmountCents: 0,
            stripePaymentAmountCents: 5000,
            receiptMetadata: { provider: 'stripe', amountPaidCents: 5000, currency: 'usd' },
            paymentLedger: []
        },
        [billingPath]: {
            type: 'stripe_checkout_paid',
            provider: 'stripe',
            stripeCheckoutSessionId: 'session-a',
            stripePaymentIntentId: 'payment-a',
            amountPaidCents: 5000,
            currency: 'usd',
            ...billingOverrides
        }
    };
}

function providerSession(recipientId = 'recipient-a', paymentIntentId = 'payment-a') {
    return {
        id: `session-${recipientId === 'recipient-a' ? 'a' : 'b'}`,
        payment_intent: paymentIntentId,
        payment_status: 'paid',
        status: 'complete',
        amount_total: 5000,
        currency: 'usd',
        client_reference_id: `team-1:batch-1:${recipientId}`,
        metadata: {
            product: 'team_fee',
            teamId: 'team-1',
            batchId: 'batch-1',
            recipientId,
            checkoutAmountCents: '5000'
        }
    };
}

function providerPaymentIntent(id = 'payment-a', recipientId = 'recipient-a') {
    return {
        id,
        status: 'succeeded',
        amount: 5000,
        amount_received: 5000,
        currency: 'usd',
        latest_charge: `charge-${recipientId === 'recipient-a' ? 'a' : 'b'}`,
        metadata: {
            product: 'team_fee',
            teamId: 'team-1',
            batchId: 'batch-1',
            recipientId,
            checkoutAmountCents: '5000'
        }
    };
}

function loadCallable({ seed, sessions = {}, paymentIntents = {} }) {
    delete require.cache[repoIndexPath];
    const metrics = { sessionRetrieves: [], paymentRetrieves: [], refundCreates: [] };
    const firestore = makeFirestore(seed, metrics);
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
            Timestamp: { now: () => 'ledger-time', fromMillis: (value) => value },
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
                        retrieve: async (id) => {
                            metrics.sessionRetrieves.push(id);
                            return clone(sessions[id]);
                        },
                        create: async () => ({}),
                        expire: async () => ({})
                    }
                },
                paymentIntents: {
                    retrieve: async (id) => {
                        metrics.paymentRetrieves.push(id);
                        return clone(paymentIntents[id]);
                    }
                },
                charges: { retrieve: async () => ({}) },
                refunds: {
                    create: async (params, options) => {
                        metrics.refundCreates.push({ params: clone(params), options: clone(options) });
                        return { id: 'refund-a', status: 'succeeded', amount: params.amount, payment_intent: 'payment-a', charge: 'charge-a' };
                    }
                },
                webhooks: { constructEvent: () => { throw new Error('Not implemented in test.'); } }
            };
        }
    };
    const exports = require('../index.js');
    return { callable: exports.refundStripeTeamFeePayment, firestore, metrics };
}

const input = {
    teamId: 'team-1',
    batchId: 'batch-1',
    recipientId: 'recipient-a',
    amountCents: 2000,
    reason: 'Adjustment',
    refundRequestId: 'request-a'
};
const context = { auth: { uid: 'owner-1', token: { email: 'owner@example.com', email_verified: true } } };

before(() => { Module._load = patchedModuleLoad; });
after(() => {
    delete require.cache[repoIndexPath];
    Module._load = originalModuleLoad;
});

test('rejects a cross-recipient payment reference before any refund or local mutation', async () => {
    const { callable, metrics } = loadCallable({
        seed: baseSeed({ stripeCheckoutSessionId: 'session-b', stripePaymentIntentId: 'payment-b' }),
        sessions: { 'session-b': providerSession('recipient-b', 'payment-b') },
        paymentIntents: { 'payment-b': providerPaymentIntent('payment-b', 'recipient-b') }
    });

    await assert.rejects(() => callable(input, context), (error) => error.code === 'failed-precondition');
    assert.equal(metrics.refundCreates.length, 0);
    assert.equal(metrics.writes.length, 0);
});

test('rejects provider product, team, batch, currency, and paid-amount drift without side effects', async () => {
    const cases = [
        ['product', (session) => { session.metadata.product = 'other_product'; }],
        ['team', (session) => { session.metadata.teamId = 'team-2'; }],
        ['batch', (session) => { session.metadata.batchId = 'batch-2'; }],
        ['currency', (session) => { session.currency = 'cad'; }],
        ['paid amount', (session) => { session.amount_total = 4900; }]
    ];

    for (const [label, mutate] of cases) {
        const session = providerSession();
        mutate(session);
        const { callable, metrics } = loadCallable({
            seed: baseSeed(),
            sessions: { 'session-a': session },
            paymentIntents: { 'payment-a': providerPaymentIntent() }
        });
        await assert.rejects(() => callable({ ...input, refundRequestId: `request-${label}` }, context), (error) => error.code === 'failed-precondition');
        assert.equal(metrics.refundCreates.length, 0, label);
        assert.equal(metrics.writes.length, 0, label);
    }
});

test('refunds a correctly bound server payment exactly once across an idempotent retry', async () => {
    const { callable, firestore, metrics } = loadCallable({
        seed: baseSeed(),
        sessions: { 'session-a': providerSession() },
        paymentIntents: { 'payment-a': providerPaymentIntent() }
    });

    const first = await callable(input, context);
    const second = await callable(input, context);

    assert.deepEqual(first, { refundId: 'refund-a', status: 'succeeded', amountCents: 2000 });
    assert.deepEqual(second, first);
    assert.equal(metrics.refundCreates.length, 1);
    assert.deepEqual(metrics.sessionRetrieves, ['session-a']);
    assert.deepEqual(metrics.paymentRetrieves, ['payment-a']);
    assert.equal(firestore._state.get(recipientPath).paidAmountCents, 3000);
    assert.equal(firestore._state.get(`${recipientPath}/refundIntents/request-a`).status, 'recorded');
    assert.equal(firestore._state.get(recipientPath).paymentLedger.length, 1);
});
