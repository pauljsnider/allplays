const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

let adminStub = null;
let functionsStub = null;
let StripeStub = null;
let stripeState = null;

function patchedModuleLoad(request, parent, isMain) {
    if (request === 'firebase-admin' && adminStub) {
        return adminStub;
    }
    if (request === 'firebase-functions' && functionsStub) {
        return functionsStub;
    }
    if (request === 'stripe' && StripeStub) {
        return StripeStub;
    }
    return originalModuleLoad(request, parent, isMain);
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function setNested(target, path, value) {
    const parts = String(path || '').split('.').filter(Boolean);
    let cursor = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const key = parts[i];
        if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
            cursor[key] = {};
        }
        cursor = cursor[key];
    }
    cursor[parts[parts.length - 1]] = value;
}

function makeFirestore(seed = {}) {
    const state = new Map(Object.entries(clone(seed)));
    let nextAutoId = 1;
    let nextTransactionError = null;
    const fieldValue = {
        serverTimestamp: () => ({ __op: 'serverTimestamp' }),
        delete: () => ({ __op: 'delete' }),
        increment: (amount) => ({ __op: 'increment', amount }),
        arrayUnion: (...items) => ({ __op: 'arrayUnion', items })
    };

    function isOp(value, kind) {
        return value && typeof value === 'object' && value.__op === kind;
    }

    function applyPatch(baseValue, patchValue, merge) {
        const target = merge ? clone(baseValue || {}) : {};
        Object.entries(patchValue || {}).forEach(([key, value]) => {
            if (isOp(value, 'serverTimestamp')) {
                setNested(target, key, 'SERVER_TIMESTAMP');
            } else if (isOp(value, 'delete')) {
                const parts = key.split('.');
                const leaf = parts.pop();
                const parent = parts.reduce((acc, part) => (acc == null ? acc : acc[part]), target);
                if (parent && leaf) delete parent[leaf];
            } else if (isOp(value, 'increment')) {
                const current = Number(key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), target) || 0);
                setNested(target, key, current + value.amount);
            } else if (isOp(value, 'arrayUnion')) {
                setNested(target, key, value.items.map(clone));
            } else {
                setNested(target, key, clone(value));
            }
        });
        return target;
    }

    function write(path, value, options = {}) {
        const current = state.get(path);
        state.set(path, applyPatch(current, value, options.merge === true));
    }

    function doc(path) {
        return {
            path,
            id: String(path).split('/').pop(),
            async get() {
                const data = state.get(path);
                return {
                    exists: data !== undefined,
                    id: String(path).split('/').pop(),
                    ref: this,
                    data: () => clone(data)
                };
            },
            async set(value, options) {
                write(path, value, options || {});
            },
            async update(value) {
                if (!state.has(path)) {
                    throw new Error(`Missing document for update: ${path}`);
                }
                write(path, value, { merge: true });
            },
            collection(name) {
                return collection(`${path}/${name}`);
            }
        };
    }

    function collection(path) {
        return {
            path,
            doc(id) {
                const docId = id || `auto-${nextAutoId++}`;
                return doc(`${path}/${docId}`);
            }
        };
    }

    function collectionGroup(name) {
        const filters = [];
        const query = {
            where(field, operator, value) {
                filters.push({ field, operator, value });
                return query;
            },
            limit() {
                return query;
            },
            async get() {
                const docs = [...state.entries()]
                    .filter(([path, data]) => {
                        const parts = path.split('/');
                        return parts.at(-2) === name && filters.every((filter) => filter.operator === '==' && data?.[filter.field] === filter.value);
                    })
                    .map(([path]) => {
                        const ref = doc(path);
                        const data = state.get(path);
                        return { id: ref.id, ref, data: () => clone(data) };
                    });
                return { docs, empty: docs.length === 0, size: docs.length };
            }
        };
        return query;
    }

    return {
        _state: state,
        doc,
        collection,
        collectionGroup,
        async runTransaction(handler) {
            if (nextTransactionError) {
                const error = nextTransactionError;
                nextTransactionError = null;
                throw error;
            }
            const transaction = {
                get: (ref) => ref.get(),
                set: (ref, value, options) => ref.set(value, options),
                update: (ref, value) => ref.update(value)
            };
            return handler(transaction);
        },
        snapshot(path) {
            return clone(state.get(path));
        },
        registrationDocs() {
            return [...state.entries()]
                .filter(([path]) => path.startsWith('teams/team-1/registrationForms/form-1/registrations/'))
                .map(([path, data]) => ({ path, data: clone(data) }));
        },
        rateLimitDocs() {
            return [...state.entries()]
                .filter(([path]) => path.startsWith('publicRegistrationRateLimits/'))
                .map(([path, data]) => ({ path, data: clone(data) }));
        },
        failNextTransaction(error) {
            nextTransactionError = error;
        },
        FieldValue: fieldValue
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
        onCall: (fn) => fn,
        onRequest: (fn) => fn,
        onCreate: (fn) => fn,
        onUpdate: (fn) => fn,
        onWrite: (fn) => fn,
        onDelete: (fn) => fn,
        onRun: (fn) => fn,
        document() {
            return this;
        },
        schedule() {
            return this;
        },
        timeZone() {
            return this;
        }
    };
    triggerChain.https = triggerChain;
    triggerChain.firestore = triggerChain;
    triggerChain.pubsub = triggerChain;

    return {
        config: () => ({ stripe: {
            secret_key: 'sk_test_123', webhook_secret: 'whsec_test_123',
            app_url: 'https://allplays.test', team_pass_price_id: 'price_team_pass'
        } }),
        https: {
            HttpsError,
            onCall: (fn) => fn,
            onRequest: (fn) => fn
        },
        firestore: {
            document: () => triggerChain
        },
        auth: {
            user: () => triggerChain
        },
        pubsub: {
            schedule: () => triggerChain
        },
        runWith: () => triggerChain,
        logger: {
            error: () => {},
            warn: () => {},
            info: () => {}
        }
    };
}

function installModuleStubs(firestore) {
    stripeState = {
        checkoutSessions: [],
        checkoutSessionOptions: [],
        checkoutResponses: new Map(),
        expiredSessionIds: [],
        refundCalls: [],
        teamPassPrice: { id: 'price_team_pass', active: true, type: 'one_time', unit_amount: 4900, currency: 'usd' },
        webhookEvent: null,
        nextCheckoutResponse: null
    };
    adminStub = {
        apps: [true],
        initializeApp: () => {},
        firestore: Object.assign(() => firestore, {
            FieldValue: firestore.FieldValue,
            Timestamp: { now: () => 'TIMESTAMP_NOW' }
        }),
        auth: () => ({ verifyIdToken: async () => null }),
        messaging: () => ({})
    };
    functionsStub = makeFunctionsStub();
    StripeStub = class StripeMock {
        constructor() {
            return {
                checkout: { sessions: { create: async (payload, options) => {
                    stripeState.checkoutSessions.push(clone(payload));
                    stripeState.checkoutSessionOptions.push(clone(options));
                    const response = {
                        id: `cs_test_${stripeState.checkoutSessions.length}`,
                        url: `https://stripe.test/checkout/${stripeState.checkoutSessions.length}`,
                        payment_status: 'unpaid',
                        status: 'open',
                        livemode: false,
                        metadata: clone(payload.metadata || {}),
                        amount_total: payload.line_items?.[0]?.price_data?.unit_amount || stripeState.teamPassPrice.unit_amount,
                        currency: payload.line_items?.[0]?.price_data?.currency || stripeState.teamPassPrice.currency,
                        ...(clone(stripeState.nextCheckoutResponse) || {})
                    };
                    stripeState.checkoutResponses.set(response.id, clone(response));
                    return response;
                }, retrieve: async (sessionId) => {
                    const session = stripeState.checkoutResponses.get(sessionId);
                    if (!session) throw new Error('Checkout session not found.');
                    return clone(session);
                }, expire: async (sessionId) => {
                    const session = stripeState.checkoutResponses.get(sessionId);
                    if (!session) throw new Error('Checkout session not found.');
                    session.status = 'expired';
                    stripeState.expiredSessionIds.push(sessionId);
                    return clone(session);
                } } },
                prices: { retrieve: async () => clone(stripeState.teamPassPrice) },
                charges: { retrieve: async () => { throw new Error('Charge not implemented in test.'); } },
                refunds: { create: async (payload, options) => {
                    stripeState.refundCalls.push({ payload: clone(payload), options: clone(options) });
                    return {
                        id: `re_test_${stripeState.refundCalls.length}`,
                        status: 'succeeded',
                        amount: payload.amount,
                        payment_intent: payload.payment_intent || null,
                        charge: payload.charge || null
                    };
                } },
                webhooks: { constructEvent: () => {
                    if (!stripeState.webhookEvent) {
                        throw new Error('Not implemented in test.');
                    }
                    return clone(stripeState.webhookEvent);
                } }
            };
        }
    };
}

function loadFunctionsModule(seed) {
    delete require.cache[repoIndexPath];
    const firestore = makeFirestore(seed);
    installModuleStubs(firestore);
    const mod = require('../index.js');
    return {
        firestore,
        stripeState,
        mod
    };
}

function loadSubmitPublicRegistration(seed) {
    delete require.cache[repoIndexPath];
    const firestore = makeFirestore(seed);
    return loadSubmitPublicRegistrationWithFirestore(firestore);
}

function loadSubmitPublicRegistrationWithFirestore(firestore) {
    delete require.cache[repoIndexPath];
    installModuleStubs(firestore);
    const mod = require('../index.js');
    return {
        firestore,
        stripeState,
        submitPublicRegistration: mod.submitPublicRegistration
    };
}

function buildSeedState(formOverrides = {}) {
    return {
        'teams/team-1/registrationForms/form-1': {
            published: true,
            programName: 'Summer Camp',
            feeAmountCents: 5000,
            currency: 'USD',
            paymentSettings: { offlinePaymentEnabled: true },
            participantFields: [{ id: 'playerName', label: 'Player name', required: true }],
            guardianFields: [{ id: 'email', label: 'Email', required: true }],
            waiverText: 'Waiver',
            registrationOptions: [{ id: 'u10', title: 'U10', capacityLimit: 5, waitlistEnabled: true, active: true }],
            registrationOptionCounts: {
                u10: { enrolled: 0, waitlisted: 0 }
            },
            ...formOverrides
        }
    };
}

function buildSubmission(overrides = {}) {
    return {
        teamId: 'team-1',
        formId: 'form-1',
        participant: { playerName: 'Sam Player' },
        guardian: { email: 'parent@example.com' },
        waiverAccepted: true,
        selectedOptionId: 'u10',
        selectedPaymentPlanId: 'pay_full',
        quantity: 1,
        ...overrides
    };
}

const context = {
    rawRequest: {
        ip: '203.0.113.10',
        headers: {}
    }
};

test.beforeEach(() => {
    delete require.cache[repoIndexPath];
    Module._load = patchedModuleLoad;
    adminStub = null;
    functionsStub = null;
    StripeStub = null;
    stripeState = null;
});

test.afterEach(() => {
    delete require.cache[repoIndexPath];
    Module._load = originalModuleLoad;
    adminStub = null;
    functionsStub = null;
    StripeStub = null;
    stripeState = null;
});

test('loads unrelated callables without Firestore transaction support', () => {
    const firestore = makeFirestore();
    delete firestore.runTransaction;
    installModuleStubs(firestore);

    const mod = require('../index.js');

    assert.equal(typeof mod.getFamilyShareSchedule, 'function');
    assert.equal(typeof mod.listPublicOpportunities, 'function');
});

test('Stripe webhook rejects an invalid signature before any payment mutation', async () => {
    const { firestore, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1' }
    });
    const response = createMockResponse();
    await mod.stripeTeamPassWebhook({
        method: 'POST', rawBody: Buffer.from('forged-event'),
        headers: { 'stripe-signature': 'invalid' }
    }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(firestore.snapshot('stripeEvents/evt_forged'), undefined);
});

test('Team Pass checkout persists server authority and webhook writes only a safe public entitlement', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const checkout = await mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    const reusedCheckout = await mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });

    assert.equal(checkout.sessionId, 'cs_test_1');
    assert.deepEqual(reusedCheckout, checkout);
    assert.equal(stripeState.checkoutSessions.length, 1);
    assert.match(stripeState.checkoutSessionOptions[0].idempotencyKey, /^team_pass_checkout_/);
    const checkoutPayload = stripeState.checkoutSessions[0];
    assert.equal(checkoutPayload.metadata.product, 'team_pass');
    assert.deepEqual(checkoutPayload.payment_intent_data.metadata, checkoutPayload.metadata);

    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    stripeState.webhookEvent = {
        id: 'evt_team_pass_paid',
        type: 'checkout.session.completed',
        data: { object: {
            ...clone(session),
            payment_status: 'paid',
            payment_intent: 'pi_team_pass',
            customer: 'cus_team_pass'
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    assert.deepEqual(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass'), {
        status: 'active', teamId: 'team-pass', seasonId: '2026', tier: 'team-pass', updatedAt: 'SERVER_TIMESTAMP'
    });
    const attempt = firestore.snapshot('teams/team-pass/teamPassCheckoutAttempts/2026_team-pass');
    assert.equal(attempt.checkoutStatus, 'paid');
    assert.equal(attempt.stripePaymentIntentId, 'pi_team_pass');
    assert.equal(attempt.stripeCustomerId, 'cus_team_pass');
    assert.equal(attempt.checkoutAmountCents, 4900);

    stripeState.webhookEvent = {
        id: 'evt_team_pass_refunded',
        type: 'charge.refunded',
        data: { object: {
            object: 'charge', id: 'ch_team_pass', metadata: checkoutPayload.metadata,
            payment_intent: 'pi_team_pass', amount: 4900, amount_refunded: 4900,
            currency: 'usd', livemode: false
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass').status, 'cancelled');
    assert.equal(firestore.snapshot('teams/team-pass/teamPassCheckoutAttempts/2026_team-pass').checkoutStatus, 'refunded');
});

test('team fee checkout reserves one current attempt and reuses its Stripe session', async () => {
    const recipientPath = 'teams/team-fee/feeBatches/batch-1/feeRecipients/recipient-1';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-fee': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' },
        [recipientPath]: {
            teamId: 'team-fee', batchId: 'batch-1', collectionMode: 'online_stripe',
            amountCents: 7500, paidAmountCents: 0, balanceDueCents: 7500,
            status: 'unpaid', feeTitle: 'Tournament fee', playerName: 'Sam'
        }
    });
    const request = { teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1' };
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };

    const first = await mod.createStripeTeamFeeCheckout(request, authContext);
    const second = await mod.createStripeTeamFeeCheckout(request, authContext);

    assert.deepEqual(second, first);
    assert.equal(stripeState.checkoutSessions.length, 1);
    assert.match(stripeState.checkoutSessionOptions[0].idempotencyKey, /^team_fee_checkout_/);
    assert.deepEqual(stripeState.checkoutSessions[0].payment_intent_data.metadata, stripeState.checkoutSessions[0].metadata);
    const recipient = firestore.snapshot(recipientPath);
    assert.equal(recipient.checkoutStatus, 'open');
    assert.equal(recipient.stripeCheckoutSessionId, first.sessionId);
    assert.equal(recipient.checkoutAmountCents, 7500);
    assert.equal(recipient.checkoutCurrency, 'usd');
});

test('team fee refund rejects cross-recipient Stripe authority before creating a refund', async () => {
    const recipientPath = 'teams/team-fee/feeBatches/batch-1/feeRecipients/recipient-1';
    const { stripeState, mod } = loadFunctionsModule({
        'teams/team-fee': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' },
        [recipientPath]: {
            teamId: 'team-fee', batchId: 'batch-1', paymentProvider: 'stripe',
            amountCents: 7500, paidAmountCents: 7500, balanceDueCents: 0,
            status: 'paid', livemode: false
        },
        [`${recipientPath}/adminBilling/latest`]: {
            type: 'stripe_checkout_paid', provider: 'stripe',
            stripeCheckoutSessionId: 'cs_team_fee', stripePaymentIntentId: 'pi_team_fee',
            amountPaidCents: 7500, currency: 'usd'
        }
    });
    const session = {
        id: 'cs_team_fee', payment_status: 'paid', payment_intent: 'pi_team_fee',
        amount_total: 7500, currency: 'usd', livemode: false,
        metadata: { product: 'team_fee', teamId: 'victim-team', batchId: 'batch-1', recipientId: 'recipient-1' }
    };
    stripeState.checkoutResponses.set(session.id, session);
    const request = {
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
        amountCents: 2500, refundRequestId: 'refund_authority_test'
    };
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };

    await assert.rejects(mod.refundStripeTeamFeePayment(request, authContext), /does not match this fee recipient/);
    assert.equal(stripeState.refundCalls.length, 0);

    session.metadata.teamId = 'team-fee';
    stripeState.checkoutResponses.set(session.id, session);
    const result = await mod.refundStripeTeamFeePayment(request, authContext);
    assert.equal(result.amountCents, 2500);
    assert.equal(stripeState.refundCalls.length, 1);
    assert.equal(stripeState.refundCalls[0].payload.payment_intent, 'pi_team_fee');
    assert.match(stripeState.refundCalls[0].options.idempotencyKey, /^team_fee_refund_/);
});

test('team fee offline invalidation expires Checkout before a late paid event can change the balance', async () => {
    const recipientPath = 'teams/team-fee/feeBatches/batch-1/feeRecipients/recipient-1';
    const token = 'tok_team_fee_1234567890';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-fee': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' },
        [recipientPath]: {
            teamId: 'team-fee', batchId: 'batch-1', collectionMode: 'online_stripe',
            amountCents: 7500, paidAmountCents: 0, balanceDueCents: 7500,
            status: 'unpaid', paymentProvider: 'stripe', checkoutStatus: 'open',
            stripeCheckoutSessionId: 'cs_team_fee_open', checkoutAttemptToken: token,
            checkoutAmountCents: 7500, checkoutCurrency: 'usd', livemode: false,
            checkoutUrl: 'https://stripe.test/open'
        }
    });
    const session = {
        id: 'cs_team_fee_open', status: 'open', payment_status: 'unpaid',
        amount_total: 7500, currency: 'usd', livemode: false,
        metadata: {
            product: 'team_fee', teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
            payerUid: 'payer-1', checkoutAttemptToken: token, checkoutAmountCents: '7500'
        }
    };
    stripeState.checkoutResponses.set(session.id, session);
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };

    const result = await mod.expireStripeTeamFeeCheckout({
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1'
    }, authContext);
    assert.equal(result.expired, true);
    assert.deepEqual(stripeState.expiredSessionIds, ['cs_team_fee_open']);

    stripeState.webhookEvent = {
        id: 'evt_team_fee_late', type: 'checkout.session.completed',
        data: { object: { ...session, status: 'complete', payment_status: 'paid', payment_intent: 'pi_late' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const recipient = firestore.snapshot(recipientPath);
    assert.equal(recipient.paidAmountCents, 0);
    assert.equal(recipient.checkoutStatus, 'expired');
    assert.equal(firestore.snapshot('stripeEvents/evt_team_fee_late').ignored, true);
});

test('rejects nonexistent forms before creating a durable rate-limit document', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration({});

    await assert.rejects(
        submitPublicRegistration(buildSubmission(), context),
        (error) => {
            assert.equal(error.code, 'not-found');
            return true;
        }
    );

    assert.equal(firestore.rateLimitDocs().length, 0);
    assert.equal(firestore.registrationDocs().length, 0);
});

test('creates exactly one pending registration and reserves matching capacity', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration(buildSeedState());

    const result = await submitPublicRegistration(buildSubmission(), context);

    assert.equal(result.success, true);
    assert.equal(result.status, 'pending');
    assert.match(result.registrationId, /^auto-\d+$/);
    assert.equal(result.feeSnapshot.finalAmountDueCents, 5000);

    const form = firestore.snapshot('teams/team-1/registrationForms/form-1');
    const registrations = firestore.registrationDocs();
    assert.equal(form.registrationOptionCounts.u10.enrolled, 1);
    assert.equal(form.registrationOptionCounts.u10.waitlisted, 0);
    assert.equal(form.registrationCapacityUpdateId, result.registrationId);
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].data.status, 'pending');
    assert.equal(registrations[0].data.source, 'public-registration');
    assert.equal(registrations[0].data.selectedOption.countKey, 'u10');
});

test('accepts a free online-checkout registration without a checkout token', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration(buildSeedState({
        feeAmountCents: 0,
        paymentSettings: { offlinePaymentEnabled: false, onlineCheckoutEnabled: true }
    }));

    const result = await submitPublicRegistration(buildSubmission(), context);

    assert.equal(result.success, true);
    assert.equal(result.feeSnapshot.finalAmountDueCents, 0);
    const registrations = firestore.registrationDocs();
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].data.status, 'pending');
    assert.equal('checkoutAttemptToken' in registrations[0].data, false);
});

test('accepts an online-checkout registration discounted to zero without a checkout token', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration(buildSeedState({
        paymentSettings: { offlinePaymentEnabled: false, onlineCheckoutEnabled: true },
        discountRules: [{
            id: 'free-registration',
            type: 'quantity',
            label: 'Free registration',
            amountType: 'fixed',
            amountValue: 5000,
            minimumQuantity: 1,
            active: true
        }]
    }));

    const result = await submitPublicRegistration(buildSubmission(), context);

    assert.equal(result.feeSnapshot.finalAmountDueCents, 0);
    assert.equal(firestore.registrationDocs().length, 1);
});

test('requires a checkout token when an online registration has a balance', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration(buildSeedState({
        paymentSettings: { offlinePaymentEnabled: false, onlineCheckoutEnabled: true }
    }));

    await assert.rejects(
        submitPublicRegistration(buildSubmission(), context),
        (error) => {
            assert.equal(error.code, 'invalid-argument');
            assert.equal(error.message, 'A checkout attempt token is required.');
            return true;
        }
    );
    assert.equal(firestore.registrationDocs().length, 0);
});

test('normalizes guardian email casing for parent readback rules', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration(buildSeedState());

    const result = await submitPublicRegistration(buildSubmission({
        guardian: { email: ' Parent@Example.COM ' }
    }), context);

    const registrations = firestore.registrationDocs();
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].data.guardian.email, 'parent@example.com');
    assert.equal(result.registrationId, registrations[0].path.split('/').pop());
});

test('rejects blocked capacity without creating a registration or changing counters', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration(buildSeedState({
        registrationOptions: [
            { id: 'u10', title: 'U10', capacityLimit: 1, waitlistEnabled: false, active: true },
            { id: 'u12', title: 'U12', capacityLimit: 5, waitlistEnabled: false, active: true }
        ],
        registrationOptionCounts: {
            u10: { enrolled: 1, waitlisted: 0 },
            u12: { enrolled: 0, waitlisted: 0 }
        }
    }));

    await assert.rejects(
        submitPublicRegistration(buildSubmission(), context),
        (error) => {
            assert.equal(error.code, 'failed-precondition');
            assert.equal(error.details.reason, 'option-full');
            return true;
        }
    );

    const form = firestore.snapshot('teams/team-1/registrationForms/form-1');
    assert.equal(form.registrationOptionCounts.u10.enrolled, 1);
    assert.equal(form.registrationOptionCounts.u10.waitlisted, 0);
    assert.equal(form.registrationOptionCounts.u12.enrolled, 0);
    assert.equal(form.registrationOptionCounts.u12.waitlisted, 0);
    assert.equal(firestore.registrationDocs().length, 0);
});

test('rejects submissions when every configured option is full without a waitlist', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration(buildSeedState({
        registrationOptions: [{ id: 'u10', title: 'U10', capacityLimit: 1, waitlistEnabled: false, active: true }],
        registrationOptionCounts: {
            u10: { enrolled: 1, waitlisted: 0 }
        }
    }));

    await assert.rejects(
        submitPublicRegistration(buildSubmission({ selectedOptionId: '' }), context),
        (error) => {
            assert.equal(error.code, 'failed-precondition');
            assert.equal(error.message, 'Registration is currently unavailable. No registration options are available.');
            assert.equal(error.details.reason, 'no-options-available');
            return true;
        }
    );

    const form = firestore.snapshot('teams/team-1/registrationForms/form-1');
    assert.equal(form.registrationOptionCounts.u10.enrolled, 1);
    assert.equal(form.registrationOptionCounts.u10.waitlisted, 0);
    assert.equal(firestore.registrationDocs().length, 0);
});

test('throttles repeated anonymous submissions before reserving more capacity', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration(buildSeedState());
    const input = buildSubmission();

    await submitPublicRegistration(input, context);
    await submitPublicRegistration(input, context);
    await submitPublicRegistration(input, context);
    const formBeforeThrottle = firestore.snapshot('teams/team-1/registrationForms/form-1');
    const registrationCountBeforeThrottle = firestore.registrationDocs().length;

    await assert.rejects(
        submitPublicRegistration(input, context),
        (error) => {
            assert.equal(error.code, 'resource-exhausted');
            assert.equal(error.details.reason, 'rate-limited');
            return true;
        }
    );

    const formAfterThrottle = firestore.snapshot('teams/team-1/registrationForms/form-1');
    assert.equal(formAfterThrottle.registrationOptionCounts.u10.enrolled, formBeforeThrottle.registrationOptionCounts.u10.enrolled);
    assert.equal(firestore.registrationDocs().length, registrationCountBeforeThrottle);
});

test('isolates guardian submission limits for families sharing an IP address', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration(buildSeedState());
    const firstGuardian = buildSubmission({ guardian: { email: 'one@example.com' } });

    await submitPublicRegistration(firstGuardian, context);
    await submitPublicRegistration(firstGuardian, context);
    await submitPublicRegistration(firstGuardian, context);

    const result = await submitPublicRegistration(
        buildSubmission({ guardian: { email: 'two@example.com' } }),
        context
    );

    assert.equal(result.success, true);
    assert.equal(firestore.rateLimitDocs().length, 2);
    assert.equal(firestore.registrationDocs().length, 4);
});

test('shares submission throttling across independently loaded function handlers', async () => {
    const firstHandler = loadSubmitPublicRegistration(buildSeedState());
    const input = buildSubmission();

    await firstHandler.submitPublicRegistration(input, context);
    await firstHandler.submitPublicRegistration(input, context);

    const secondHandler = loadSubmitPublicRegistrationWithFirestore(firstHandler.firestore);
    await secondHandler.submitPublicRegistration(input, context);
    const formBeforeThrottle = firstHandler.firestore.snapshot('teams/team-1/registrationForms/form-1');
    const registrationCountBeforeThrottle = firstHandler.firestore.registrationDocs().length;

    await assert.rejects(
        secondHandler.submitPublicRegistration(input, context),
        (error) => {
            assert.equal(error.code, 'resource-exhausted');
            assert.equal(error.details.reason, 'rate-limited');
            return true;
        }
    );

    const formAfterThrottle = firstHandler.firestore.snapshot('teams/team-1/registrationForms/form-1');
    assert.equal(formAfterThrottle.registrationOptionCounts.u10.enrolled, formBeforeThrottle.registrationOptionCounts.u10.enrolled);
    assert.equal(firstHandler.firestore.registrationDocs().length, registrationCountBeforeThrottle);
});

test('does not bypass throttling when the durable reservation fails', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration(buildSeedState());
    firestore.failNextTransaction(new Error('rate-limit store unavailable'));

    await assert.rejects(
        submitPublicRegistration(buildSubmission(), context),
        /rate-limit store unavailable/
    );

    const form = firestore.snapshot('teams/team-1/registrationForms/form-1');
    assert.equal(form.registrationOptionCounts.u10.enrolled, 0);
    assert.equal(firestore.registrationDocs().length, 0);
});

test('throttles forwarded public clients behind a private proxy before reserving more capacity', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration(buildSeedState());
    const input = buildSubmission();
    const proxiedContext = {
        rawRequest: {
            ip: '10.0.0.5',
            headers: {
                'x-forwarded-for': '203.0.113.10, 10.0.0.5'
            }
        }
    };

    await submitPublicRegistration(input, proxiedContext);
    await submitPublicRegistration(input, proxiedContext);
    await submitPublicRegistration(input, proxiedContext);
    const formBeforeThrottle = firestore.snapshot('teams/team-1/registrationForms/form-1');
    const registrationCountBeforeThrottle = firestore.registrationDocs().length;

    await assert.rejects(
        submitPublicRegistration(input, proxiedContext),
        (error) => {
            assert.equal(error.code, 'resource-exhausted');
            assert.equal(error.details.reason, 'rate-limited');
            return true;
        }
    );

    const formAfterThrottle = firestore.snapshot('teams/team-1/registrationForms/form-1');
    assert.equal(formAfterThrottle.registrationOptionCounts.u10.enrolled, formBeforeThrottle.registrationOptionCounts.u10.enrolled);
    assert.equal(firestore.registrationDocs().length, registrationCountBeforeThrottle);
});

test('isolates forwarded public clients behind the same private proxy', async () => {
    const { firestore, submitPublicRegistration } = loadSubmitPublicRegistration(buildSeedState());
    const input = buildSubmission();
    const buildProxiedContext = (clientIp) => ({
        rawRequest: {
            ip: '10.0.0.5',
            headers: {
                'x-forwarded-for': `${clientIp}, 10.0.0.5`
            }
        }
    });

    await submitPublicRegistration(input, buildProxiedContext('203.0.113.10'));
    await submitPublicRegistration(input, buildProxiedContext('203.0.113.10'));
    await submitPublicRegistration(input, buildProxiedContext('203.0.113.10'));
    const formBeforeSecondClient = firestore.snapshot('teams/team-1/registrationForms/form-1');
    const registrationCountBeforeSecondClient = firestore.registrationDocs().length;

    const result = await submitPublicRegistration(input, buildProxiedContext('203.0.113.11'));

    const formAfterSecondClient = firestore.snapshot('teams/team-1/registrationForms/form-1');
    assert.equal(result.success, true);
    assert.equal(formAfterSecondClient.registrationOptionCounts.u10.enrolled, formBeforeSecondClient.registrationOptionCounts.u10.enrolled + 1);
    assert.equal(firestore.registrationDocs().length, registrationCountBeforeSecondClient + 1);
});

test('charges only the first scheduled installment for installment registrations', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule(buildSeedState({
        feeAmountCents: 12500,
        paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true },
        installmentPlan: {
            enabled: true,
            title: 'Monthly installments',
            installmentCount: 3,
            firstDueDate: '2026-07-01',
            intervalDays: 30
        }
    }));

    const submission = await mod.submitPublicRegistration(buildSubmission({
        selectedPaymentPlanId: 'installments',
        checkoutAttemptToken: 'checkouttoken123456'
    }), context);

    const registrationPath = `teams/team-1/registrationForms/form-1/registrations/${submission.registrationId}`;
    const storedRegistration = firestore.snapshot(registrationPath);
    assert.equal(storedRegistration.paymentPlan.id, 'installments');
    assert.deepEqual(storedRegistration.paymentPlan.schedule.map((entry) => entry.amountCents), [4166, 4166, 4168]);

    const checkout = await mod.createStripeRegistrationCheckout({
        teamId: 'team-1',
        formId: 'form-1',
        registrationId: submission.registrationId,
        amountCents: 12500,
        currency: 'usd',
        checkoutAttemptToken: 'checkouttoken123456'
    });

    assert.equal(checkout.checkoutUrl, 'https://stripe.test/checkout/1');
    assert.equal(stripeState.checkoutSessions.length, 1);
    assert.equal(stripeState.checkoutSessions[0].line_items[0].price_data.unit_amount, 4166);
    assert.match(stripeState.checkoutSessions[0].success_url, /paymentPlanId=installments/);

    const checkoutRegistration = firestore.snapshot(registrationPath);
    assert.equal(checkoutRegistration.checkoutAmountCents, 4166);
    assert.equal(checkoutRegistration.paymentStatus, 'checkout_open');
  });

test('keeps the stored installment schedule for later checkout attempts after form pricing changes', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule(buildSeedState({
        feeAmountCents: 12500,
        paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true },
        installmentPlan: {
            enabled: true,
            title: 'Monthly installments',
            installmentCount: 3,
            firstDueDate: '2026-07-01',
            intervalDays: 30
        }
    }));

    const submission = await mod.submitPublicRegistration(buildSubmission({
        selectedPaymentPlanId: 'installments',
        checkoutAttemptToken: 'checkouttoken123456'
    }), context);

    const registrationPath = `teams/team-1/registrationForms/form-1/registrations/${submission.registrationId}`;
    await firestore.doc(registrationPath).set({
        paymentPlan: {
            id: 'installments',
            schedule: [
                { label: 'Installment 1', dueDate: '2026-07-01', amountCents: 4166 },
                { label: 'Installment 2', dueDate: '2026-07-31', amountCents: 4166 },
                { label: 'Installment 3', dueDate: '2026-08-30', amountCents: 4168 }
            ],
            totalBalanceDueCents: 12500,
            paidInstallmentCount: 1,
            remainingBalanceCents: 8334,
            nextDueDate: '2026-07-31'
        },
        paymentStatus: 'installment_in_progress',
        balanceDueCents: 8334,
        nextPaymentDueDate: '2026-07-31'
    }, { merge: true });
    await firestore.doc('teams/team-1/registrationForms/form-1').set({
        feeAmountCents: 18000,
        installmentPlan: {
            enabled: true,
            title: 'Biweekly installments',
            installmentCount: 4,
            firstDueDate: '2026-07-10',
            intervalDays: 14
        }
    }, { merge: true });

    const checkout = await mod.createStripeRegistrationCheckout({
        teamId: 'team-1',
        formId: 'form-1',
        registrationId: submission.registrationId,
        amountCents: 18000,
        currency: 'usd',
        checkoutAttemptToken: 'checkouttoken123456'
    });

    assert.equal(checkout.checkoutUrl, 'https://stripe.test/checkout/1');
    assert.equal(stripeState.checkoutSessions[0].line_items[0].price_data.unit_amount, 4166);
    assert.match(stripeState.checkoutSessions[0].success_url, /paymentPlanId=installments/);
    assert.match(stripeState.checkoutSessions[0].success_url, /paidInstallmentCount=2/);

    const checkoutRegistration = firestore.snapshot(registrationPath);
    assert.equal(checkoutRegistration.checkoutAmountCents, 4166);
});

function createMockResponse() {
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
        send(payload) {
            this.body = payload;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
}

test('records installment payment progress after Stripe marks the first installment paid', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule(buildSeedState({
        feeAmountCents: 12500,
        paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true },
        installmentPlan: {
            enabled: true,
            title: 'Monthly installments',
            installmentCount: 3,
            firstDueDate: '2026-07-01',
            intervalDays: 30
        }
    }));

    const submission = await mod.submitPublicRegistration(buildSubmission({
        selectedPaymentPlanId: 'installments',
        checkoutAttemptToken: 'checkouttoken123456'
    }), context);

    await mod.createStripeRegistrationCheckout({
        teamId: 'team-1',
        formId: 'form-1',
        registrationId: submission.registrationId,
        amountCents: 12500,
        currency: 'usd',
        checkoutAttemptToken: 'checkouttoken123456'
    });

    stripeState.webhookEvent = {
        id: 'evt_installment_paid_1',
        type: 'checkout.session.completed',
        data: {
            object: {
                id: 'cs_test_1',
                payment_status: 'paid',
                payment_intent: 'pi_test_1',
                amount_total: 4166,
                currency: 'usd',
                metadata: {
                    product: 'registration',
                    teamId: 'team-1',
                    formId: 'form-1',
                    registrationId: submission.registrationId,
                    checkoutAttemptToken: 'checkouttoken123456'
                }
            }
        }
    };

    const req = {
        method: 'POST',
        rawBody: Buffer.from('event'),
        headers: { 'stripe-signature': 'sig_test' }
    };
    const res = createMockResponse();

    await mod.stripeTeamPassWebhook(req, res);

    assert.equal(res.statusCode, 200);
    const registration = firestore.snapshot(`teams/team-1/registrationForms/form-1/registrations/${submission.registrationId}`);
    assert.equal(registration.paymentStatus, 'installment_in_progress');
    assert.equal(registration.balanceDueCents, 8334);
    assert.equal(registration.nextPaymentDueDate, '2026-07-31');
    assert.equal(registration.paymentPlan.paidInstallmentCount, 1);
    assert.equal(registration.paymentPlan.remainingBalanceCents, 8334);
    assert.equal(registration.paymentPlan.nextDueDate, '2026-07-31');
});

async function createInstallmentCheckoutFixture() {
    const fixture = loadFunctionsModule(buildSeedState({
        feeAmountCents: 12500,
        paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true },
        installmentPlan: {
            enabled: true,
            title: 'Monthly installments',
            installmentCount: 3,
            firstDueDate: '2026-07-01',
            intervalDays: 30
        }
    }));
    const submission = await fixture.mod.submitPublicRegistration(buildSubmission({
        selectedPaymentPlanId: 'installments',
        checkoutAttemptToken: 'checkouttoken123456'
    }), context);
    await fixture.mod.createStripeRegistrationCheckout({
        teamId: 'team-1',
        formId: 'form-1',
        registrationId: submission.registrationId,
        checkoutAttemptToken: 'checkouttoken123456'
    });
    return {
        ...fixture,
        submission,
        registrationPath: `teams/team-1/registrationForms/form-1/registrations/${submission.registrationId}`
    };
}

function buildPaidInstallmentWebhookEvent({ eventId, registrationId, sessionId = 'cs_test_1', amountTotal = 4166, currency = 'usd' }) {
    return {
        id: eventId,
        type: 'checkout.session.completed',
        data: {
            object: {
                id: sessionId,
                payment_status: 'paid',
                payment_intent: `pi_${eventId}`,
                amount_total: amountTotal,
                currency,
                metadata: {
                    product: 'registration',
                    teamId: 'team-1',
                    formId: 'form-1',
                    registrationId,
                    checkoutAttemptToken: 'checkouttoken123456'
                }
            }
        }
    };
}

async function deliverStripeWebhook(mod) {
    const response = createMockResponse();
    await mod.stripeTeamPassWebhook({
        method: 'POST',
        rawBody: Buffer.from('event'),
        headers: { 'stripe-signature': 'sig_test' }
    }, response);
    return response;
}

test('ignores a signed stale registration checkout success without advancing installments', async () => {
    const { firestore, stripeState, mod, submission, registrationPath } = await createInstallmentCheckoutFixture();
    stripeState.webhookEvent = buildPaidInstallmentWebhookEvent({
        eventId: 'evt_installment_stale',
        registrationId: submission.registrationId,
        sessionId: 'cs_stale'
    });

    const response = await deliverStripeWebhook(mod);

    assert.equal(response.statusCode, 200);
    const registration = firestore.snapshot(registrationPath);
    assert.equal(registration.paymentStatus, 'checkout_open');
    assert.equal(Number(registration.paymentPlan.paidInstallmentCount || 0), 0);
    assert.equal(registration.stripeCheckoutSessionId, 'cs_test_1');
    assert.equal(firestore.snapshot('stripeEvents/evt_installment_stale').ignoredReason, 'checkout_session_mismatch');
});

test('ignores a signed registration checkout success with the wrong amount', async () => {
    const { firestore, stripeState, mod, submission, registrationPath } = await createInstallmentCheckoutFixture();
    stripeState.webhookEvent = buildPaidInstallmentWebhookEvent({
        eventId: 'evt_installment_wrong_amount',
        registrationId: submission.registrationId,
        amountTotal: 1
    });

    const response = await deliverStripeWebhook(mod);

    assert.equal(response.statusCode, 200);
    const registration = firestore.snapshot(registrationPath);
    assert.equal(registration.paymentStatus, 'checkout_open');
    assert.equal(Number(registration.paymentPlan.paidInstallmentCount || 0), 0);
    assert.equal(firestore.snapshot('stripeEvents/evt_installment_wrong_amount').ignoredReason, 'checkout_amount_mismatch');
});

test('deduplicates distinct paid events for one registration checkout session', async () => {
    const { firestore, stripeState, mod, submission, registrationPath } = await createInstallmentCheckoutFixture();
    stripeState.webhookEvent = buildPaidInstallmentWebhookEvent({
        eventId: 'evt_installment_first_delivery',
        registrationId: submission.registrationId
    });
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    stripeState.webhookEvent = buildPaidInstallmentWebhookEvent({
        eventId: 'evt_installment_replay_distinct_event',
        registrationId: submission.registrationId
    });
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    const registration = firestore.snapshot(registrationPath);
    assert.equal(registration.paymentStatus, 'installment_in_progress');
    assert.equal(registration.paymentPlan.paidInstallmentCount, 1);
    assert.equal(registration.lastPaidStripeCheckoutSessionId, 'cs_test_1');
    assert.equal(firestore.snapshot('stripeEvents/evt_installment_replay_distinct_event').ignoredReason, 'checkout_session_already_processed');
});

test('expires a cancelled Stripe checkout and ignores a late paid event after capacity release', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule(buildSeedState({
        feeAmountCents: 7500,
        paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true }
    }));
    const submission = await mod.submitPublicRegistration(buildSubmission({
        checkoutAttemptToken: 'checkouttoken123456'
    }), context);
    const checkout = await mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        checkoutAttemptToken: 'checkouttoken123456'
    });
    const checkoutPayload = stripeState.checkoutSessions[0];
    const cancelUrl = new URL(checkoutPayload.cancel_url);
    const publicCheckoutCapability = cancelUrl.searchParams.get('publicCheckoutCapability');

    const cancellation = await mod.cancelStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        checkoutAttemptToken: 'checkouttoken123456', publicCheckoutCapability
    });
    assert.equal(cancellation.released, true);
    assert.deepEqual(stripeState.expiredSessionIds, [checkout.sessionId]);

    stripeState.webhookEvent = {
        id: 'evt_late_after_cancel',
        type: 'checkout.session.completed',
        data: { object: {
            id: checkout.sessionId,
            payment_status: 'paid',
            payment_intent: 'pi_late',
            amount_total: 7500,
            currency: 'usd',
            livemode: false,
            metadata: checkoutPayload.metadata
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    const registrationPath = `teams/team-1/registrationForms/form-1/registrations/${submission.registrationId}`;
    const registration = firestore.snapshot(registrationPath);
    assert.equal(registration.checkoutStatus, 'cancelled');
    assert.equal(registration.paymentStatus, 'checkout_cancelled');
    assert.equal(registration.registrationCapacityReleased, true);
    assert.equal(firestore.snapshot('teams/team-1/registrationForms/form-1').registrationOptionCounts.u10.enrolled, 0);
    assert.equal(firestore.snapshot('stripeEvents/evt_late_after_cancel').ignored, true);
});

test('keeps capacity reserved when a later installment payment fails', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule(buildSeedState({
        feeAmountCents: 12500,
        paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true },
        installmentPlan: {
            enabled: true,
            title: 'Monthly installments',
            installmentCount: 3,
            firstDueDate: '2026-07-01',
            intervalDays: 30
        }
    }));

    const submission = await mod.submitPublicRegistration(buildSubmission({
        selectedPaymentPlanId: 'installments',
        checkoutAttemptToken: 'checkouttoken123456'
    }), context);

    const registrationPath = `teams/team-1/registrationForms/form-1/registrations/${submission.registrationId}`;
    await firestore.doc(registrationPath).set({
        paymentStatus: 'installment_in_progress',
        checkoutStatus: 'open',
        stripeCheckoutSessionId: 'cs_test_2',
        checkoutAmountCents: 4166,
        checkoutCurrency: 'usd',
        checkoutAttemptToken: 'checkouttoken123456',
        paymentPlan: {
            id: 'installments',
            schedule: [
                { label: 'Installment 1', dueDate: '2026-07-01', amountCents: 4166 },
                { label: 'Installment 2', dueDate: '2026-07-31', amountCents: 4166 },
                { label: 'Installment 3', dueDate: '2026-08-30', amountCents: 4168 }
            ],
            totalBalanceDueCents: 12500,
            paidInstallmentCount: 1,
            remainingBalanceCents: 8334,
            nextDueDate: '2026-07-31'
        },
        registrationCapacityReleased: false,
        balanceDueCents: 8334,
        nextPaymentDueDate: '2026-07-31',
        publicCheckoutCapabilityHash: ''
    }, { merge: true });

    stripeState.webhookEvent = {
        id: 'evt_installment_failed_2',
        type: 'checkout.session.async_payment_failed',
        data: {
            object: {
                id: 'cs_test_2',
                payment_status: 'failed',
                payment_intent: 'pi_test_2',
                metadata: {
                    product: 'registration',
                    teamId: 'team-1',
                    formId: 'form-1',
                    registrationId: submission.registrationId,
                    checkoutAttemptToken: 'checkouttoken123456'
                }
            }
        }
    };

    const req = {
        method: 'POST',
        rawBody: Buffer.from('event'),
        headers: { 'stripe-signature': 'sig_test' }
    };
    const res = createMockResponse();

    await mod.stripeTeamPassWebhook(req, res);

    assert.equal(res.statusCode, 200);
    const registration = firestore.snapshot(registrationPath);
    const form = firestore.snapshot('teams/team-1/registrationForms/form-1');
    assert.equal(registration.paymentStatus, 'payment_failed');
    assert.equal(registration.registrationCapacityReleased, false);
    assert.equal(form.registrationOptionCounts.u10.enrolled, 1);
});
