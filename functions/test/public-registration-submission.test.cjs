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

function makeFirestore(seed = {}, firestoreOptions = {}) {
    const state = new Map(Object.entries(clone(seed)));
    const updateVersions = new Map([...state.keys()].map((path, index) => [path, index + 1]));
    let nextUpdateVersion = state.size + 1;
    let nextAutoId = 1;
    let nextTransactionError = null;
    let shouldRetryNextTransaction = false;
    const afterGetHooks = new Map();
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

    function write(path, value, writeOptions = {}) {
        const hasUndefined = (candidate) => candidate === undefined
            || (Array.isArray(candidate) && candidate.some(hasUndefined))
            || (candidate && typeof candidate === 'object'
                && Object.values(candidate).some(hasUndefined));
        if (firestoreOptions.rejectUndefinedWrites === true && hasUndefined(value)) {
            throw new Error(`Firestore write contains undefined value: ${path}`);
        }
        const current = state.get(path);
        state.set(path, applyPatch(current, value, writeOptions.merge === true));
        updateVersions.set(path, nextUpdateVersion++);
    }

    function doc(path) {
        return {
            path,
            id: String(path).split('/').pop(),
            async get() {
                const data = state.get(path);
                const updateVersion = updateVersions.get(path);
                const afterGet = afterGetHooks.get(path);
                if (afterGet) {
                    afterGetHooks.delete(path);
                    await afterGet({ path, data: clone(data) });
                }
                return {
                    exists: data !== undefined,
                    id: String(path).split('/').pop(),
                    ref: this,
                    updateTime: data === undefined ? undefined : {
                        seconds: updateVersion,
                        nanoseconds: 0,
                        toMillis: () => updateVersion * 1000
                    },
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
        let limitCount = null;
        let cursorPath = '';
        const filters = [];
        const query = {
            path,
            doc(id) {
                const docId = id || `auto-${nextAutoId++}`;
                return doc(`${path}/${docId}`);
            },
            limit(value) {
                limitCount = Math.max(0, Number(value) || 0);
                return query;
            },
            where(field, operator, value) {
                filters.push({ field, operator, value });
                return query;
            },
            orderBy() {
                return query;
            },
            startAfter(snapshot) {
                cursorPath = snapshot?.ref?.path || '';
                return query;
            },
            async get() {
                const parentDepth = path.split('/').length;
                let docs = [...state.entries()]
                    .filter(([candidatePath, data]) => candidatePath.startsWith(`${path}/`)
                        && candidatePath.split('/').length === parentDepth + 1
                        && (!cursorPath || candidatePath > cursorPath)
                        && filters.every((filter) => filter.operator === '==' && data?.[filter.field] === filter.value))
                    .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
                    .map(([candidatePath, data]) => {
                        const ref = doc(candidatePath);
                        return { id: ref.id, ref, exists: true, data: () => clone(data) };
                    });
                if (Number.isFinite(limitCount)) docs = docs.slice(0, limitCount);
                return { docs, empty: docs.length === 0, size: docs.length };
            }
        };
        return query;
    }

    function collectionGroup(name) {
        const filters = [];
        let limitCount = null;
        let cursorPath = '';
        const query = {
            where(field, operator, value) {
                filters.push({ field, operator, value });
                return query;
            },
            orderBy() {
                return query;
            },
            limit(value) {
                limitCount = Number(value);
                return query;
            },
            startAfter(snapshot) {
                cursorPath = snapshot?.ref?.path || '';
                return query;
            },
            async get() {
                let docs = [...state.entries()]
                    .filter(([path, data]) => {
                        const parts = path.split('/');
                        return parts.at(-2) === name
                            && (!cursorPath || path > cursorPath)
                            && filters.every((filter) => filter.operator === '==' && data?.[filter.field] === filter.value);
                    })
                    .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
                    .map(([path]) => {
                        const ref = doc(path);
                        const data = state.get(path);
                        return { id: ref.id, ref, data: () => clone(data) };
                    });
                if (Number.isFinite(limitCount)) docs = docs.slice(0, limitCount);
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
            if (shouldRetryNextTransaction) {
                shouldRetryNextTransaction = false;
                const retryAttempt = {
                    get: (ref) => ref.get(),
                    set() {},
                    update() {}
                };
                await handler(retryAttempt);
            }
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
        retryNextTransaction() {
            shouldRetryNextTransaction = true;
        },
        afterNextGet(path, handler) {
            afterGetHooks.set(path, handler);
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
        checkoutResponsesByIdempotencyKey: new Map(),
        checkoutCreateHook: null,
        checkoutRetrieveHook: null,
        checkoutExpireHook: null,
        expiredSessionIds: [],
        refundCalls: [],
        refundCreateHook: null,
        refundResponsesByIdempotencyKey: new Map(),
        paymentIntents: new Map(),
        charges: new Map(),
        chargeRetrieveHook: null,
        teamPassPrice: { id: 'price_team_pass', active: true, type: 'one_time', unit_amount: 4900, currency: 'usd' },
        webhookEvent: null,
        nextCheckoutResponse: null
    };
    adminStub = {
        apps: [true],
        initializeApp: () => {},
        firestore: Object.assign(() => firestore, {
            FieldValue: firestore.FieldValue,
            FieldPath: { documentId: () => '__name__' },
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
                    if (typeof stripeState.checkoutCreateHook === 'function') {
                        await stripeState.checkoutCreateHook({ payload: clone(payload), options: clone(options) });
                    }
                    const idempotencyKey = String(options?.idempotencyKey || '');
                    if (idempotencyKey && stripeState.checkoutResponsesByIdempotencyKey.has(idempotencyKey)) {
                        return clone(stripeState.checkoutResponsesByIdempotencyKey.get(idempotencyKey));
                    }
                    const response = {
                        id: `cs_test_${stripeState.checkoutSessions.length}`,
                        url: `https://stripe.test/checkout/${stripeState.checkoutSessions.length}`,
                        mode: payload.mode,
                        client_reference_id: payload.client_reference_id,
                        payment_status: 'unpaid',
                        status: 'open',
                        livemode: false,
                        metadata: clone(payload.metadata || {}),
                        amount_total: payload.line_items?.[0]?.price_data?.unit_amount || stripeState.teamPassPrice.unit_amount,
                        currency: payload.line_items?.[0]?.price_data?.currency || stripeState.teamPassPrice.currency,
                        ...(clone(stripeState.nextCheckoutResponse) || {})
                    };
                    stripeState.checkoutResponses.set(response.id, clone(response));
                    if (idempotencyKey) stripeState.checkoutResponsesByIdempotencyKey.set(idempotencyKey, clone(response));
                    return response;
                }, retrieve: async (sessionId) => {
                    const session = stripeState.checkoutResponses.get(sessionId);
                    if (!session) throw new Error('Checkout session not found.');
                    if (typeof stripeState.checkoutRetrieveHook === 'function') {
                        await stripeState.checkoutRetrieveHook({ sessionId, session: clone(session) });
                    }
                    return clone(session);
                }, list: async ({ payment_intent: paymentIntentId, status, starting_after: startingAfter, limit = 10 } = {}) => {
                    let sessions = [...stripeState.checkoutResponses.values()]
                        .sort((left, right) => String(left.id).localeCompare(String(right.id)));
                    if (paymentIntentId) {
                        sessions = sessions.filter((session) => String(typeof session.payment_intent === 'string'
                            ? session.payment_intent
                            : session.payment_intent?.id || '') === paymentIntentId);
                    }
                    if (status) sessions = sessions.filter((session) => String(session.status || '') === status);
                    if (startingAfter) {
                        const cursorIndex = sessions.findIndex((session) => session.id === startingAfter);
                        sessions = cursorIndex >= 0 ? sessions.slice(cursorIndex + 1) : [];
                    }
                    const page = sessions.slice(0, limit);
                    return { data: page.map(clone), has_more: sessions.length > page.length };
                }, listLineItems: async () => ({ data: [{
                    quantity: 1,
                    amount_total: stripeState.teamPassPrice.unit_amount,
                    currency: stripeState.teamPassPrice.currency,
                    price: clone(stripeState.teamPassPrice)
                }] }), expire: async (sessionId) => {
                    const session = stripeState.checkoutResponses.get(sessionId);
                    if (!session) throw new Error('Checkout session not found.');
                    session.status = 'expired';
                    for (const storedResponse of stripeState.checkoutResponsesByIdempotencyKey.values()) {
                        if (storedResponse.id === sessionId) storedResponse.status = 'expired';
                    }
                    stripeState.expiredSessionIds.push(sessionId);
                    if (typeof stripeState.checkoutExpireHook === 'function') {
                        await stripeState.checkoutExpireHook({ sessionId, session: clone(session) });
                    }
                    return clone(session);
                } } },
                prices: { retrieve: async () => clone(stripeState.teamPassPrice) },
                paymentIntents: { retrieve: async (paymentIntentId) => {
                    if (stripeState.paymentIntents.has(paymentIntentId)) return clone(stripeState.paymentIntents.get(paymentIntentId));
                    const session = stripeState.webhookEvent?.data?.object || {};
                    const paymentIntent = {
                        id: paymentIntentId,
                        amount: session.amount_total,
                        amount_received: session.amount_total,
                        currency: session.currency || 'usd',
                        livemode: Boolean(session.livemode),
                        metadata: clone(session.metadata || {}),
                        latest_charge: `ch_${paymentIntentId}`
                    };
                    stripeState.paymentIntents.set(paymentIntentId, paymentIntent);
                    stripeState.charges.set(paymentIntent.latest_charge, {
                        id: paymentIntent.latest_charge,
                        object: 'charge',
                        amount: paymentIntent.amount,
                        amount_refunded: 0,
                        currency: paymentIntent.currency,
                        livemode: paymentIntent.livemode,
                        metadata: clone(paymentIntent.metadata),
                        payment_intent: paymentIntent.id
                    });
                    return clone(paymentIntent);
                } },
                charges: { retrieve: async (chargeId) => {
                    if (typeof stripeState.chargeRetrieveHook === 'function') {
                        await stripeState.chargeRetrieveHook({ chargeId });
                    }
                    if (stripeState.charges.has(chargeId)) return clone(stripeState.charges.get(chargeId));
                    const eventObject = stripeState.webhookEvent?.data?.object || {};
                    if (eventObject.id === chargeId) return clone(eventObject);
                    throw new Error('Charge not implemented in test.');
                } },
                refunds: { create: async (payload, options) => {
                    stripeState.refundCalls.push({ payload: clone(payload), options: clone(options) });
                    const idempotencyKey = String(options?.idempotencyKey || '');
                    if (!stripeState.refundResponsesByIdempotencyKey.has(idempotencyKey)) {
                        stripeState.refundResponsesByIdempotencyKey.set(idempotencyKey, {
                            id: `re_test_${stripeState.refundResponsesByIdempotencyKey.size + 1}`,
                            status: 'succeeded',
                            amount: payload.amount,
                            payment_intent: payload.payment_intent || null,
                            charge: payload.charge || null
                        });
                    }
                    const refund = clone(stripeState.refundResponsesByIdempotencyKey.get(idempotencyKey));
                    if (typeof stripeState.refundCreateHook === 'function') {
                        await stripeState.refundCreateHook({ refund: clone(refund), payload: clone(payload), options: clone(options) });
                    }
                    return refund;
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

function loadFunctionsModule(seed, firestoreOptions) {
    delete require.cache[repoIndexPath];
    const firestore = makeFirestore(seed, firestoreOptions);
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
    assert.equal(attempt.stripeChargeId, 'ch_pi_team_pass');
    assert.equal(attempt.stripeCustomerId, 'cus_team_pass');
    assert.equal(attempt.checkoutAmountCents, 4900);
    assert.deepEqual(attempt.reversalState, {
        stripeChargeId: 'ch_pi_team_pass', stripePaymentIntentId: 'pi_team_pass',
        chargeAmountCents: 4900, refundedAmountCents: 0, refundEventCreated: 0,
        disputeStatus: 'none', disputeEventCreated: 0, lastStripeEventId: '',
        disputeLostAmountCents: 0
    });
    assert.equal(attempt.disputeLostAmountCents, 0);

    const paidAttempt = clone(attempt);
    await firestore.doc('teams/team-pass/entitlements/2026_team-pass').set({ status: 'cancelled' }, { merge: true });
    await assert.rejects(mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } }), /already has an active pass/i);
    firestore._state.delete('teams/team-pass/entitlements/2026_team-pass');
    await assert.rejects(mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } }), /already has an active pass/i);
    assert.deepEqual(firestore.snapshot('teams/team-pass/teamPassCheckoutAttempts/2026_team-pass'), paidAttempt);
    assert.equal(stripeState.checkoutSessions.length, 1);
    assert.equal(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass').status, 'active');

    stripeState.webhookEvent = {
        id: 'evt_team_pass_refunded',
        type: 'charge.refunded',
        data: { object: {
            object: 'charge', id: 'ch_pi_team_pass', metadata: checkoutPayload.metadata,
            payment_intent: 'pi_team_pass', amount: 4900, amount_refunded: 4900,
            currency: 'usd', livemode: false
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass').status, 'cancelled');
    assert.equal(firestore.snapshot('teams/team-pass/teamPassCheckoutAttempts/2026_team-pass').checkoutStatus, 'refunded');
    const refundedAttempt = clone(firestore.snapshot('teams/team-pass/teamPassCheckoutAttempts/2026_team-pass'));
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.deepEqual(firestore.snapshot('teams/team-pass/teamPassCheckoutAttempts/2026_team-pass'), refundedAttempt);
    assert.equal(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass').status, 'cancelled');
});

test('Team Pass paid webhook rejects mismatched PaymentIntent and Charge authority before unlocking', async () => {
    for (const mismatch of ['payment_intent_metadata', 'charge_metadata']) {
        const { firestore, stripeState, mod } = loadFunctionsModule({
            'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
            'users/owner-1': { email: 'owner@example.com' }
        });
        const checkout = await mod.createStripeTeamPassCheckout({
            teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
        }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
        const session = stripeState.checkoutResponses.get(checkout.sessionId);
        const paymentIntentId = `pi_team_pass_${mismatch}`;
        const chargeId = `ch_team_pass_${mismatch}`;
        const paymentIntentMetadata = mismatch === 'payment_intent_metadata'
            ? { ...clone(session.metadata), teamId: 'victim-team' }
            : clone(session.metadata);
        const chargeMetadata = mismatch === 'charge_metadata'
            ? { ...clone(session.metadata), purchaserUid: 'attacker' }
            : clone(session.metadata);
        stripeState.paymentIntents.set(paymentIntentId, {
            id: paymentIntentId, amount_received: 4900, currency: 'usd', livemode: false,
            metadata: paymentIntentMetadata, latest_charge: chargeId
        });
        stripeState.charges.set(chargeId, {
            id: chargeId, object: 'charge', amount: 4900, amount_refunded: 0,
            currency: 'usd', livemode: false, metadata: chargeMetadata,
            payment_intent: paymentIntentId
        });
        stripeState.webhookEvent = {
            id: `evt_${mismatch}`, type: 'checkout.session.completed', created: 100,
            data: { object: { ...clone(session), payment_status: 'paid', payment_intent: paymentIntentId } }
        };

        assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
        assert.equal(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass'), undefined);
        assert.equal(firestore.snapshot('teams/team-pass/teamPassCheckoutAttempts/2026_team-pass').checkoutStatus, 'open');
        assert.match(
            firestore.snapshot(`stripeEvents/evt_${mismatch}`).ignoredReason,
            mismatch === 'payment_intent_metadata' ? /payment_intent_scope_mismatch/ : /charge_purchaser_mismatch/
        );
    }
});

test('Team Pass paid webhook projects a Charge already refunded before settlement as cancelled', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const checkout = await mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    stripeState.paymentIntents.set('pi_already_refunded', {
        id: 'pi_already_refunded', amount_received: 4900, currency: 'usd', livemode: false,
        metadata: clone(session.metadata), latest_charge: 'ch_already_refunded'
    });
    stripeState.charges.set('ch_already_refunded', {
        id: 'ch_already_refunded', object: 'charge', amount: 4900, amount_refunded: 4900,
        currency: 'usd', livemode: false, metadata: clone(session.metadata),
        payment_intent: 'pi_already_refunded'
    });
    stripeState.webhookEvent = {
        id: 'evt_team_pass_paid_already_refunded', type: 'checkout.session.completed', created: 200,
        data: { object: { ...clone(session), payment_status: 'paid', payment_intent: 'pi_already_refunded' } }
    };

    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass').status, 'cancelled');
    const attempt = firestore.snapshot('teams/team-pass/teamPassCheckoutAttempts/2026_team-pass');
    assert.equal(attempt.checkoutStatus, 'refunded');
    assert.equal(attempt.stripeChargeId, 'ch_already_refunded');
    assert.equal(attempt.refundedAmountCents, 4900);
});

test('Team Pass paid webhook fails closed when latest Charge authority is missing or stale', async () => {
    {
        const { firestore, stripeState, mod } = loadFunctionsModule({
            'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
            'users/owner-1': { email: 'owner@example.com' }
        });
        const checkout = await mod.createStripeTeamPassCheckout({
            teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
        }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
        const session = stripeState.checkoutResponses.get(checkout.sessionId);
        stripeState.paymentIntents.set('pi_missing_charge', {
            id: 'pi_missing_charge', amount_received: 4900, currency: 'usd', livemode: false,
            metadata: clone(session.metadata), latest_charge: null
        });
        stripeState.webhookEvent = {
            id: 'evt_team_pass_missing_charge', type: 'checkout.session.completed', created: 100,
            data: { object: { ...clone(session), payment_status: 'paid', payment_intent: 'pi_missing_charge' } }
        };

        assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
        assert.equal(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass'), undefined);
        assert.equal(firestore.snapshot('teams/team-pass/teamPassCheckoutAttempts/2026_team-pass').checkoutStatus, 'open');
        assert.equal(firestore.snapshot('stripeEvents/evt_team_pass_missing_charge'), undefined);
    }

    {
        const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
        const { firestore, stripeState, mod } = loadFunctionsModule({
            'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
            'users/owner-1': { email: 'owner@example.com' }
        });
        const checkout = await mod.createStripeTeamPassCheckout({
            teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
        }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
        const session = stripeState.checkoutResponses.get(checkout.sessionId);
        await firestore.doc(attemptPath).set({ stripeChargeId: 'ch_stale' }, { merge: true });
        stripeState.paymentIntents.set('pi_current', {
            id: 'pi_current', amount_received: 4900, currency: 'usd', livemode: false,
            metadata: clone(session.metadata), latest_charge: 'ch_current'
        });
        stripeState.charges.set('ch_current', {
            id: 'ch_current', object: 'charge', amount: 4900, amount_refunded: 0,
            currency: 'usd', livemode: false, metadata: clone(session.metadata), payment_intent: 'pi_current'
        });
        stripeState.webhookEvent = {
            id: 'evt_team_pass_stale_charge', type: 'checkout.session.completed', created: 100,
            data: { object: { ...clone(session), payment_status: 'paid', payment_intent: 'pi_current' } }
        };

        assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
        assert.equal(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass'), undefined);
        assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'open');
        assert.equal(firestore.snapshot('stripeEvents/evt_team_pass_stale_charge').ignoredReason, 'charge_charge_mismatch');
    }
});

test('Team Pass paid webhook requires durable dispute-event evidence for a historical Charge signal', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const entitlementPath = 'teams/team-pass/entitlements/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const checkout = await mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    const paymentIntentId = 'pi_team_pass_historical_dispute';
    const chargeId = 'ch_team_pass_historical_dispute';
    stripeState.paymentIntents.set(paymentIntentId, {
        id: paymentIntentId, amount_received: 4900, currency: 'usd', livemode: false,
        metadata: clone(session.metadata), latest_charge: chargeId
    });
    stripeState.charges.set(chargeId, {
        id: chargeId, object: 'charge', amount: 4900, amount_refunded: 0,
        currency: 'usd', livemode: false, metadata: clone(session.metadata),
        payment_intent: paymentIntentId, disputed: true
    });
    const paidEvent = {
        id: 'evt_team_pass_historical_dispute_paid', type: 'checkout.session.completed', created: 300,
        data: { object: { ...clone(session), payment_status: 'paid', payment_intent: paymentIntentId } }
    };

    stripeState.webhookEvent = paidEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'open');
    assert.equal(firestore.snapshot(attemptPath).reversalState, undefined);
    assert.equal(firestore.snapshot(entitlementPath), undefined);
    assert.equal(firestore.snapshot(`stripeEvents/${paidEvent.id}`), undefined);

    stripeState.webhookEvent = {
        id: 'evt_team_pass_historical_dispute_won', type: 'charge.dispute.closed', created: 200,
        data: { object: { object: 'dispute', id: 'dp_team_pass_historical', charge: chargeId, status: 'won' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'open');
    assert.equal(firestore.snapshot(attemptPath).reversalState.disputeStatus, 'won');

    stripeState.webhookEvent = paidEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'paid');
    assert.equal(firestore.snapshot(attemptPath).reversalState.disputeStatus, 'won');
    assert.equal(firestore.snapshot(attemptPath).disputeLostAmountCents, 0);
    assert.equal(firestore.snapshot(entitlementPath).status, 'active');
});

test('Team Pass paid webhook rejects a stale open dispute after the Charge signal clears', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const entitlementPath = 'teams/team-pass/entitlements/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const checkout = await mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    const paymentIntentId = 'pi_team_pass_stale_open';
    const chargeId = 'ch_team_pass_stale_open';
    stripeState.paymentIntents.set(paymentIntentId, {
        id: paymentIntentId, amount_received: 4900, currency: 'usd', livemode: false,
        metadata: clone(session.metadata), latest_charge: chargeId
    });
    stripeState.charges.set(chargeId, {
        id: chargeId, object: 'charge', amount: 4900, amount_refunded: 0,
        currency: 'usd', livemode: false, metadata: clone(session.metadata),
        payment_intent: paymentIntentId, disputed: true
    });
    stripeState.webhookEvent = {
        id: 'evt_team_pass_stale_open_created', type: 'charge.dispute.created', created: 200,
        data: { object: { object: 'dispute', id: 'dp_team_pass_stale_open', charge: chargeId, status: 'needs_response' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).reversalState.disputeStatus, 'open');

    stripeState.charges.get(chargeId).disputed = false;
    const paidEvent = {
        id: 'evt_team_pass_stale_open_paid', type: 'checkout.session.completed', created: 300,
        data: { object: { ...clone(session), payment_status: 'paid', payment_intent: paymentIntentId } }
    };
    stripeState.webhookEvent = paidEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'open');
    assert.equal(firestore.snapshot(attemptPath).reversalState.disputeStatus, 'open');
    assert.equal(firestore.snapshot(entitlementPath), undefined);
    assert.equal(firestore.snapshot(`stripeEvents/${paidEvent.id}`), undefined);

    stripeState.webhookEvent = {
        id: 'evt_team_pass_stale_open_won', type: 'charge.dispute.closed', created: 400,
        data: { object: { object: 'dispute', id: 'dp_team_pass_stale_open', charge: chargeId, status: 'won' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).reversalState.disputeStatus, 'won');

    stripeState.webhookEvent = paidEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'paid');
    assert.equal(firestore.snapshot(entitlementPath).status, 'active');
});

test('Team Pass paid webhook rejects cross-Charge or impossible stored reversal economics', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const entitlementPath = 'teams/team-pass/entitlements/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const checkout = await mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    const paymentIntentId = 'pi_team_pass_bound_reversal';
    const chargeId = 'ch_team_pass_bound_reversal';
    stripeState.paymentIntents.set(paymentIntentId, {
        id: paymentIntentId, amount_received: 4900, currency: 'usd', livemode: false,
        metadata: clone(session.metadata), latest_charge: chargeId
    });
    stripeState.charges.set(chargeId, {
        id: chargeId, object: 'charge', amount: 4900, amount_refunded: 0,
        currency: 'usd', livemode: false, metadata: clone(session.metadata),
        payment_intent: paymentIntentId, disputed: true
    });
    await firestore.doc(attemptPath).set({
        disputeId: 'dp_wrong_charge',
        reversalState: {
            stripeChargeId: 'ch_wrong', stripePaymentIntentId: 'pi_wrong', chargeAmountCents: 9999,
            refundedAmountCents: 0, refundEventCreated: 0, disputeStatus: 'won',
            disputeEventCreated: 200, lastStripeEventId: 'evt_wrong_charge', disputeLostAmountCents: 0
        }
    }, { merge: true });
    const paidEvent = {
        id: 'evt_team_pass_bound_reversal_paid', type: 'checkout.session.completed', created: 300,
        data: { object: { ...clone(session), payment_status: 'paid', payment_intent: paymentIntentId } }
    };

    stripeState.webhookEvent = paidEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'open');
    assert.equal(firestore.snapshot(attemptPath).reversalState.stripeChargeId, 'ch_wrong');
    assert.equal(firestore.snapshot(entitlementPath), undefined);
    assert.equal(firestore.snapshot(`stripeEvents/${paidEvent.id}`), undefined);

    await firestore.doc(attemptPath).set({
        disputeId: null,
        reversalState: {
            stripeChargeId: chargeId, stripePaymentIntentId: paymentIntentId, chargeAmountCents: 4900,
            refundedAmountCents: 100, refundEventCreated: 200, disputeStatus: 'none',
            disputeEventCreated: 0, lastStripeEventId: 'evt_wrong_refund', disputeLostAmountCents: 0
        }
    }, { merge: true });
    const impossibleRefundEvent = { ...clone(paidEvent), id: 'evt_team_pass_impossible_refund_paid' };
    stripeState.webhookEvent = impossibleRefundEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    assert.equal(firestore.snapshot(attemptPath).reversalState.refundedAmountCents, 100);
    assert.equal(firestore.snapshot(entitlementPath), undefined);
    assert.equal(firestore.snapshot(`stripeEvents/${impossibleRefundEvent.id}`), undefined);
});

test('pre-authority Team Pass paid Session is migrated and credited instead of being acknowledged as unrelated', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    stripeState.paymentIntents.set('pi_team_pass_legacy', {
        id: 'pi_team_pass_legacy', amount_received: 4900, currency: 'usd', livemode: false,
        latest_charge: 'ch_team_pass_legacy', metadata: {}
    });
    stripeState.charges.set('ch_team_pass_legacy', {
        id: 'ch_team_pass_legacy', object: 'charge', amount: 4900, amount_refunded: 0,
        currency: 'usd', livemode: false, metadata: {}, payment_intent: 'pi_team_pass_legacy',
        disputed: false
    });
    const legacySession = {
        id: 'cs_team_pass_legacy', mode: 'payment', status: 'complete', payment_status: 'paid',
        payment_intent: 'pi_team_pass_legacy', customer: 'cus_team_pass_legacy',
        client_reference_id: 'team-pass:2026:owner-1', amount_total: 4900, currency: 'usd', livemode: false,
        metadata: { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass', purchaserUid: 'owner-1' }
    };
    stripeState.checkoutResponses.set(legacySession.id, clone(legacySession));
    stripeState.webhookEvent = {
        id: 'evt_team_pass_legacy_paid', type: 'checkout.session.completed', created: 100,
        data: { object: clone(legacySession) }
    };

    const response = await deliverStripeWebhook(mod);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.unlocked, true);
    assert.equal(response.body.legacyReconciled, true);
    assert.deepEqual(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass'), {
        status: 'active', teamId: 'team-pass', seasonId: '2026', tier: 'team-pass', updatedAt: 'SERVER_TIMESTAMP'
    });
    const legacyAttempts = [...firestore._state.entries()]
        .filter(([path]) => path.startsWith('teams/team-pass/teamPassCheckoutAttempts/legacy_'));
    assert.equal(legacyAttempts.length, 1);
    assert.equal(legacyAttempts[0][1].legacyPaymentAuthorityVersion, 1);
    assert.equal(legacyAttempts[0][1].stripeCheckoutSessionId, 'cs_team_pass_legacy');
    assert.equal(legacyAttempts[0][1].stripePaymentIntentId, 'pi_team_pass_legacy');
    assert.equal(legacyAttempts[0][1].stripeChargeId, 'ch_team_pass_legacy');
    assert.equal(firestore.snapshot('stripeEvents/evt_team_pass_legacy_paid').ignored, false);

    stripeState.webhookEvent = {
        id: 'evt_team_pass_legacy_refund', type: 'charge.refunded', created: 200,
        data: { object: {
            id: 'ch_team_pass_legacy', object: 'charge', metadata: {}, payment_intent: 'pi_team_pass_legacy',
            amount: 4900, amount_refunded: 4900, currency: 'usd', livemode: false
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass').status, 'cancelled');
    assert.equal([...firestore._state.entries()]
        .find(([path]) => path.startsWith('teams/team-pass/teamPassCheckoutAttempts/legacy_'))[1].checkoutStatus, 'refunded');
});

test('pre-authority Team Pass stages disputed Charge authority without credit or event dedupe', async () => {
    const entitlementPath = 'teams/team-pass/entitlements/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const paymentIntentId = 'pi_team_pass_legacy_disputed';
    const chargeId = 'ch_team_pass_legacy_disputed';
    stripeState.paymentIntents.set(paymentIntentId, {
        id: paymentIntentId, amount_received: 4900, currency: 'usd', livemode: false,
        latest_charge: chargeId, metadata: {}
    });
    stripeState.charges.set(chargeId, {
        id: chargeId, object: 'charge', amount: 4900, amount_refunded: 0,
        currency: 'usd', livemode: false, metadata: {}, payment_intent: paymentIntentId,
        disputed: true
    });
    const legacySession = {
        id: 'cs_team_pass_legacy_disputed', mode: 'payment', status: 'complete', payment_status: 'paid',
        payment_intent: paymentIntentId, customer: 'cus_team_pass_legacy_disputed',
        client_reference_id: 'team-pass:2026:owner-1', amount_total: 4900, currency: 'usd', livemode: false,
        metadata: { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass', purchaserUid: 'owner-1' }
    };
    stripeState.checkoutResponses.set(legacySession.id, clone(legacySession));
    const paidEvent = {
        id: 'evt_team_pass_legacy_disputed_paid', type: 'checkout.session.completed', created: 100,
        data: { object: clone(legacySession) }
    };

    stripeState.webhookEvent = paidEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    const stagedEntries = [...firestore._state.entries()]
        .filter(([path]) => path.startsWith('teams/team-pass/teamPassCheckoutAttempts/legacy_'));
    assert.equal(stagedEntries.length, 1);
    const [attemptPath, stagedAttempt] = stagedEntries[0];
    assert.equal(stagedAttempt.checkoutStatus, 'async_pending');
    assert.equal(stagedAttempt.stripePaymentIntentId, paymentIntentId);
    assert.equal(stagedAttempt.stripeChargeId, chargeId);
    assert.equal(stagedAttempt.reversalState.disputeStatus, 'none');
    assert.equal(firestore.snapshot(entitlementPath), undefined);
    assert.equal(firestore.snapshot(`stripeEvents/${paidEvent.id}`), undefined);

    stripeState.webhookEvent = {
        id: 'evt_team_pass_legacy_disputed_won', type: 'charge.dispute.closed', created: 200,
        data: { object: { object: 'dispute', id: 'dp_team_pass_legacy_disputed', charge: chargeId, status: 'won' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'async_pending');
    assert.equal(firestore.snapshot(attemptPath).reversalState.disputeStatus, 'won');

    stripeState.webhookEvent = paidEvent;
    const retryResponse = await deliverStripeWebhook(mod);
    assert.equal(retryResponse.statusCode, 200);
    assert.equal(retryResponse.body.unlocked, true);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'paid');
    assert.equal(firestore.snapshot(attemptPath).reversalState.disputeStatus, 'won');
    assert.equal(firestore.snapshot(entitlementPath).status, 'active');
    assert.equal(firestore.snapshot(`stripeEvents/${paidEvent.id}`).ignored, false);
});

test('pre-authority delayed Team Pass paid event projects the latest Charge refund', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const paymentIntentId = 'pi_team_pass_legacy_refunded';
    const chargeId = 'ch_team_pass_legacy_refunded';
    stripeState.paymentIntents.set(paymentIntentId, {
        id: paymentIntentId, amount_received: 4900, currency: 'usd', livemode: false,
        latest_charge: chargeId, metadata: {}
    });
    stripeState.charges.set(chargeId, {
        id: chargeId, object: 'charge', amount: 4900, amount_refunded: 4900,
        currency: 'usd', livemode: false, metadata: {}, payment_intent: paymentIntentId,
        disputed: false
    });
    const legacySession = {
        id: 'cs_team_pass_legacy_refunded', mode: 'payment', status: 'complete', payment_status: 'paid',
        payment_intent: paymentIntentId, customer: 'cus_team_pass_legacy_refunded',
        client_reference_id: 'team-pass:2026:owner-1', amount_total: 4900, currency: 'usd', livemode: false,
        metadata: { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass', purchaserUid: 'owner-1' }
    };
    stripeState.checkoutResponses.set(legacySession.id, clone(legacySession));
    stripeState.webhookEvent = {
        id: 'evt_team_pass_legacy_refunded_paid', type: 'checkout.session.completed', created: 100,
        data: { object: clone(legacySession) }
    };

    const response = await deliverStripeWebhook(mod);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.unlocked, false);
    const attempt = [...firestore._state.entries()]
        .find(([path]) => path.startsWith('teams/team-pass/teamPassCheckoutAttempts/legacy_'))[1];
    assert.equal(attempt.checkoutStatus, 'refunded');
    assert.equal(attempt.refundedAmountCents, 4900);
    assert.equal(attempt.reversalState.refundedAmountCents, 4900);
    assert.equal(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass').status, 'cancelled');
});

test('Team Pass checkout revalidates and replaces an expired stored Stripe URL', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const request = { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' };
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };
    const first = await mod.createStripeTeamPassCheckout(request, authContext);
    stripeState.checkoutResponses.get(first.sessionId).status = 'expired';

    const second = await mod.createStripeTeamPassCheckout(request, authContext);

    assert.notEqual(second.sessionId, first.sessionId);
    assert.equal(stripeState.checkoutSessions.length, 2);
    assert.equal(firestore.snapshot('teams/team-pass/teamPassCheckoutAttempts/2026_team-pass').stripeCheckoutSessionId, second.sessionId);
});

test('late duplicate Team Pass projection preserves the concurrently persisted checkout', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const sessionId = 'cs_team_pass_concurrent_winner';
    const checkoutUrl = 'https://stripe.test/checkout/team-pass-concurrent';
    stripeState.nextCheckoutResponse = { id: sessionId, url: checkoutUrl };
    stripeState.checkoutCreateHook = async ({ payload }) => {
        await firestore.doc(attemptPath).set({
            checkoutStatus: 'open',
            checkoutUrl,
            stripeCheckoutSessionId: sessionId,
            checkoutAttemptToken: payload.metadata.checkoutAttemptToken,
            purchaserUid: 'owner-1'
        }, { merge: true });
    };

    const result = await mod.createStripeTeamPassCheckout(
        { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' },
        { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } }
    );

    assert.deepEqual(result, { checkoutUrl, sessionId });
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'open');
    assert.deepEqual(stripeState.expiredSessionIds, []);
});

test('concurrent Team Pass checkout preserves an open attempt from a different purchaser', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: ['admin@example.com'] },
        'users/owner-1': { email: 'owner@example.com' },
        'users/admin-2': { email: 'admin@example.com' }
    });
    const request = { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' };
    let releaseStalePreflight;
    const stalePreflightGate = new Promise((resolve) => { releaseStalePreflight = resolve; });
    let markStalePreflightRead;
    const stalePreflightRead = new Promise((resolve) => { markStalePreflightRead = resolve; });
    firestore.afterNextGet(attemptPath, async ({ data }) => {
        assert.equal(data, undefined);
        markStalePreflightRead();
        await stalePreflightGate;
    });

    const blockedCheckout = assert.rejects(mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'admin-2', token: { email: 'admin@example.com' } }
    }), /already being created/i);
    await stalePreflightRead;

    const winner = await mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'owner@example.com' } }
    });
    const winningAttempt = firestore.snapshot(attemptPath);
    releaseStalePreflight();
    await blockedCheckout;

    assert.equal(stripeState.checkoutSessions.length, 1);
    assert.equal(winningAttempt.purchaserUid, 'owner-1');
    assert.equal(winningAttempt.stripeCheckoutSessionId, winner.sessionId);
    assert.equal(firestore.snapshot(attemptPath).purchaserUid, 'owner-1');
    assert.equal(firestore.snapshot(attemptPath).checkoutAttemptToken, winningAttempt.checkoutAttemptToken);
    assert.equal(firestore.snapshot(attemptPath).stripeCheckoutSessionId, winner.sessionId);
});

test('Team Pass never returns another purchaser\'s reusable checkout URL', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: ['admin@example.com'] },
        'users/owner-1': { email: 'owner@example.com' },
        'users/admin-2': { email: 'admin@example.com' }
    });
    const request = { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' };
    const ownerCheckout = await mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'owner@example.com' } }
    });
    const authorityBefore = firestore.snapshot(attemptPath);

    await assert.rejects(mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'admin-2', token: { email: 'admin@example.com' } }
    }), /Another purchaser already has an active Team Pass checkout/i);

    assert.equal(stripeState.checkoutSessions.length, 1);
    assert.equal(stripeState.expiredSessionIds.length, 0);
    assert.equal(ownerCheckout.sessionId, authorityBefore.stripeCheckoutSessionId);
    assert.deepEqual(firestore.snapshot(attemptPath), authorityBefore);
});

test('idempotent Team Pass replay preserves a terminal Session for webhook reconciliation', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const request = { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' };
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };
    let injected = false;
    stripeState.checkoutCreateHook = async ({ payload, options }) => {
        if (injected) return;
        injected = true;
        const response = {
            id: 'cs_team_pass_terminal_replay', url: 'https://stripe.test/checkout/team-pass-terminal',
            mode: 'payment', payment_status: 'paid', status: 'complete', payment_intent: 'pi_team_pass_terminal_replay',
            livemode: false, metadata: clone(payload.metadata), amount_total: 4900, currency: 'usd'
        };
        stripeState.checkoutResponses.set(response.id, clone(response));
        stripeState.checkoutResponsesByIdempotencyKey.set(options.idempotencyKey, clone(response));
        throw new Error('Injected post-Stripe Team Pass failure.');
    };
    await assert.rejects(mod.createStripeTeamPassCheckout(request, authContext), /Injected post-Stripe Team Pass failure/);
    await assert.rejects(mod.createStripeTeamPassCheckout(request, authContext), /payment is completing/i);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'open');
    assert.equal(firestore.snapshot(attemptPath).stripeCheckoutSessionId, 'cs_team_pass_terminal_replay');

    stripeState.webhookEvent = {
        id: 'evt_team_pass_terminal_replay', type: 'checkout.session.completed', created: 100,
        data: { object: clone(stripeState.checkoutResponses.get('cs_team_pass_terminal_replay')) }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'paid');
    assert.equal(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass').status, 'active');
});

test('failed Team Pass checkout authority cannot be replaced by another eligible purchaser', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: ['admin@example.com'] },
        'users/owner-1': { email: 'owner@example.com' },
        'users/admin-2': { email: 'admin@example.com' }
    });
    const request = { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' };
    let firstCall = true;
    stripeState.checkoutCreateHook = async () => {
        if (firstCall) {
            firstCall = false;
            throw new Error('Injected Team Pass creation failure.');
        }
    };
    await assert.rejects(mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'owner@example.com' } }
    }), /Injected Team Pass creation failure/);
    const failedAttempt = firestore.snapshot(attemptPath);
    const failedToken = failedAttempt.checkoutAttemptToken;

    await assert.rejects(mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'admin-2', token: { email: 'admin@example.com' } }
    }), /reconciled before another purchaser/i);
    assert.equal(stripeState.checkoutSessions.length, 1);
    assert.equal(firestore.snapshot(attemptPath).checkoutAttemptToken, failedToken);
    assert.equal(firestore.snapshot(attemptPath).purchaserUid, 'owner-1');

    const checkout = await mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'owner@example.com' } }
    });
    const retriedAttempt = firestore.snapshot(attemptPath);
    assert.equal(retriedAttempt.checkoutAttemptToken, failedToken);
    assert.equal(retriedAttempt.purchaserUid, 'owner-1');
    assert.equal(stripeState.checkoutSessions[1].metadata.purchaserUid, 'owner-1');
    assert.equal(stripeState.checkoutSessionOptions[1].idempotencyKey, stripeState.checkoutSessionOptions[0].idempotencyKey);
    assert.equal(retriedAttempt.stripeCheckoutSessionId, checkout.sessionId);
});

test('Team Pass retry reuses the durable Stripe request when purchaser email changes', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const request = { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' };
    let firstCall = true;
    stripeState.checkoutCreateHook = async () => {
        if (!firstCall) return;
        firstCall = false;
        throw new Error('Injected Team Pass creation failure.');
    };

    await assert.rejects(mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'owner@example.com' } }
    }), /Injected Team Pass creation failure/);
    const failedAttempt = firestore.snapshot(attemptPath);
    assert.equal(failedAttempt.stripeRequest.customer_email, 'owner@example.com');
    assert.equal(failedAttempt.stripeIdempotencyKey, stripeState.checkoutSessionOptions[0].idempotencyKey);

    await firestore.doc('users/owner-1').set({ email: 'changed@example.com' }, { merge: true });
    const checkout = await mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'changed@example.com' } }
    });

    assert.deepEqual(stripeState.checkoutSessions[1], stripeState.checkoutSessions[0]);
    assert.equal(stripeState.checkoutSessions[1].customer_email, 'owner@example.com');
    assert.equal(stripeState.checkoutSessionOptions[1].idempotencyKey, stripeState.checkoutSessionOptions[0].idempotencyKey);
    assert.equal(firestore.snapshot(attemptPath).stripeCheckoutSessionId, checkout.sessionId);
});

test('Team Pass admin recovery expires failed authority after the original purchaser loses access', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: ['admin@example.com'] },
        'users/owner-1': { email: 'owner@example.com' },
        'users/admin-2': { email: 'admin@example.com' },
        'users/parent-3': { email: 'parent@example.com', parentTeamIds: ['team-pass'] }
    });
    const request = { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' };
    let firstCall = true;
    stripeState.checkoutCreateHook = async () => {
        if (!firstCall) return;
        firstCall = false;
        throw new Error('Injected Team Pass creation failure.');
    };

    await assert.rejects(mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'owner@example.com' } }
    }), /Injected Team Pass creation failure/);
    const failedAttempt = firestore.snapshot(attemptPath);
    await firestore.doc('teams/team-pass').set({ ownerId: 'departed-owner' }, { merge: true });
    await assert.rejects(mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'owner@example.com' } }
    }), /team access/i);
    await assert.rejects(mod.expireStripeTeamPassCheckout(request, {
        auth: { uid: 'parent-3', token: { email: 'parent@example.com' } }
    }), /Only team admins/i);
    firestore.afterNextGet(attemptPath, async () => {
        await firestore.doc('teams/team-pass').set({ adminEmails: [] }, { merge: true });
    });
    await assert.rejects(mod.expireStripeTeamPassCheckout(request, {
        auth: { uid: 'admin-2', token: { email: 'admin@example.com' } }
    }), /admin access changed/i);
    assert.equal(stripeState.checkoutSessions.length, 1);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'creation_failed');
    await firestore.doc('teams/team-pass').set({ adminEmails: ['admin@example.com'] }, { merge: true });

    let releaseRecovery;
    const recoveryGate = new Promise((resolve) => { releaseRecovery = resolve; });
    let markRecoveryStarted;
    const recoveryStarted = new Promise((resolve) => { markRecoveryStarted = resolve; });
    stripeState.checkoutCreateHook = async () => {
        markRecoveryStarted();
        await recoveryGate;
    };
    const recoveryPromise = mod.expireStripeTeamPassCheckout(request, {
        auth: { uid: 'admin-2', token: { email: 'admin@example.com' } }
    });
    await recoveryStarted;
    await assert.rejects(mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'admin-2', token: { email: 'admin@example.com' } }
    }), /recovery is already in progress/i);
    await firestore.doc('teams/team-pass').set({ adminEmails: [] }, { merge: true });
    releaseRecovery();
    await assert.rejects(recoveryPromise, /access changed before the recovered checkout could be expired/i);
    assert.deepEqual(stripeState.expiredSessionIds, []);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'creation_failed');

    await firestore.doc('teams/team-pass').set({ adminEmails: ['admin@example.com'] }, { merge: true });
    stripeState.checkoutCreateHook = null;
    const recovery = await mod.expireStripeTeamPassCheckout(request, {
        auth: { uid: 'admin-2', token: { email: 'admin@example.com' } }
    });
    assert.deepEqual(recovery, { expired: true, recovered: true });
    assert.deepEqual(stripeState.checkoutSessions[1], stripeState.checkoutSessions[0]);
    assert.deepEqual(stripeState.checkoutSessions[2], stripeState.checkoutSessions[0]);
    assert.equal(stripeState.checkoutSessionOptions[2].idempotencyKey, failedAttempt.stripeIdempotencyKey);
    assert.deepEqual(stripeState.expiredSessionIds, ['cs_test_2']);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'stale');

    const replacement = await mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'admin-2', token: { email: 'admin@example.com' } }
    });
    const replacementAttempt = firestore.snapshot(attemptPath);
    assert.equal(replacementAttempt.purchaserUid, 'admin-2');
    assert.notEqual(replacementAttempt.checkoutAttemptToken, failedAttempt.checkoutAttemptToken);
    assert.notEqual(stripeState.checkoutSessionOptions[3].idempotencyKey, failedAttempt.stripeIdempotencyKey);
    assert.equal(replacementAttempt.stripeCheckoutSessionId, replacement.sessionId);
});

test('Team Pass admin recovery preserves a terminal Session for webhook reconciliation', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: ['admin@example.com'] },
        'users/owner-1': { email: 'owner@example.com' },
        'users/admin-2': { email: 'admin@example.com' }
    });
    const request = { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' };
    let signalRecoveryStarted;
    let releaseRecovery;
    const recoveryStarted = new Promise((resolve) => { signalRecoveryStarted = resolve; });
    const recoveryGate = new Promise((resolve) => { releaseRecovery = resolve; });
    stripeState.checkoutCreateHook = async ({ payload, options }) => {
        if (stripeState.checkoutResponsesByIdempotencyKey.has(options.idempotencyKey)) {
            signalRecoveryStarted();
            await recoveryGate;
            return;
        }
        const terminalSession = {
            id: 'cs_team_pass_admin_recovery_terminal',
            url: 'https://stripe.test/checkout/team-pass-admin-recovery-terminal',
            mode: 'payment', payment_status: 'paid', status: 'complete',
            payment_intent: 'pi_team_pass_admin_recovery_terminal', livemode: false,
            metadata: clone(payload.metadata), amount_total: 4900, currency: 'usd'
        };
        stripeState.checkoutResponses.set(terminalSession.id, clone(terminalSession));
        stripeState.checkoutResponsesByIdempotencyKey.set(options.idempotencyKey, clone(terminalSession));
        throw new Error('Injected post-Stripe Team Pass failure.');
    };
    await assert.rejects(mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'owner@example.com' } }
    }), /Injected post-Stripe Team Pass failure/);
    await firestore.doc('teams/team-pass').set({ ownerId: 'departed-owner' }, { merge: true });

    const recoveryPromise = mod.expireStripeTeamPassCheckout(request, {
        auth: { uid: 'admin-2', token: { email: 'admin@example.com' } }
    });
    await recoveryStarted;
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'recovering');

    const terminalSession = stripeState.checkoutResponses.get('cs_team_pass_admin_recovery_terminal');
    stripeState.webhookEvent = {
        id: 'evt_team_pass_admin_recovery_terminal_paid',
        type: 'checkout.session.completed',
        created: 100,
        data: { object: clone(terminalSession) }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    assert.equal(firestore.snapshot('stripeEvents/evt_team_pass_admin_recovery_terminal_paid'), undefined);

    releaseRecovery();
    await assert.rejects(recoveryPromise, /payment is completing/i);

    const preservedAttempt = firestore.snapshot(attemptPath);
    assert.equal(preservedAttempt.checkoutStatus, 'open');
    assert.equal(preservedAttempt.stripeCheckoutSessionId, 'cs_team_pass_admin_recovery_terminal');
    assert.equal(preservedAttempt.stripePaymentStatus, 'paid');
    assert.deepEqual(stripeState.expiredSessionIds, []);

    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'paid');
    assert.equal(firestore.snapshot('teams/team-pass/entitlements/2026_team-pass').status, 'active');
    assert.equal(firestore.snapshot('stripeEvents/evt_team_pass_admin_recovery_terminal_paid').ignored, false);
});

test('Team Pass admin recovery rechecks authorization before releasing expired authority', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: ['admin@example.com'] },
        'users/owner-1': { email: 'owner@example.com' },
        'users/admin-2': { email: 'admin@example.com' }
    });
    const request = { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' };
    let firstCall = true;
    stripeState.checkoutCreateHook = async () => {
        if (!firstCall) return;
        firstCall = false;
        throw new Error('Injected Team Pass creation failure.');
    };
    await assert.rejects(mod.createStripeTeamPassCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'owner@example.com' } }
    }), /Injected Team Pass creation failure/);
    await firestore.doc('teams/team-pass').set({ ownerId: 'departed-owner' }, { merge: true });
    stripeState.checkoutExpireHook = async () => {
        await firestore.doc('teams/team-pass').set({ adminEmails: [] }, { merge: true });
    };

    await assert.rejects(mod.expireStripeTeamPassCheckout(request, {
        auth: { uid: 'admin-2', token: { email: 'admin@example.com' } }
    }), /access changed before recovered authority could be released/i);

    assert.deepEqual(stripeState.expiredSessionIds, ['cs_test_2']);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'creation_failed');
    await firestore.doc('teams/team-pass').set({ adminEmails: ['admin@example.com'] }, { merge: true });
    stripeState.checkoutExpireHook = null;
    const recovery = await mod.expireStripeTeamPassCheckout(request, {
        auth: { uid: 'admin-2', token: { email: 'admin@example.com' } }
    });

    assert.deepEqual(recovery, { expired: true, recovered: true });
    assert.deepEqual(stripeState.expiredSessionIds, ['cs_test_2']);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'stale');
});

test('idempotent Team Pass replay supersedes an expired Session before a fresh attempt', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const request = { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' };
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };
    let injected = false;
    stripeState.checkoutCreateHook = async ({ payload, options }) => {
        if (injected) return;
        injected = true;
        const response = {
            id: 'cs_team_pass_expired_replay', url: 'https://stripe.test/checkout/team-pass-expired',
            mode: 'payment', payment_status: 'unpaid', status: 'expired', livemode: false,
            metadata: clone(payload.metadata), amount_total: 4900, currency: 'usd'
        };
        stripeState.checkoutResponses.set(response.id, clone(response));
        stripeState.checkoutResponsesByIdempotencyKey.set(options.idempotencyKey, clone(response));
        throw new Error('Injected post-Stripe Team Pass failure.');
    };
    await assert.rejects(mod.createStripeTeamPassCheckout(request, authContext), /Injected post-Stripe Team Pass failure/);
    await assert.rejects(mod.createStripeTeamPassCheckout(request, authContext), /replayed Team Pass checkout expired/i);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'stale');

    stripeState.checkoutCreateHook = null;
    const fresh = await mod.createStripeTeamPassCheckout(request, authContext);
    assert.notEqual(fresh.sessionId, 'cs_team_pass_expired_replay');
    assert.notEqual(stripeState.checkoutSessionOptions[2].idempotencyKey, stripeState.checkoutSessionOptions[1].idempotencyKey);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'open');
});

test('Team Pass entitlement backfill paginates through non-team collection-group cursors without getting stuck', async () => {
    const { mod } = loadFunctionsModule({
        'users/platform-admin': { email: 'admin@example.com', isAdmin: true },
        'teams/team-a/entitlements/2026_team-pass': {
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass', status: 'active'
        },
        'users/user-a/entitlements/2026_team-pass': {
            seasonId: '2026', tier: 'team-pass', status: 'active'
        }
    });
    const adminContext = { auth: { uid: 'platform-admin', token: { email: 'admin@example.com' } } };

    const first = await mod.backfillTeamPassEntitlementProjections({ dryRun: true, limit: 1 }, adminContext);
    assert.equal(first.matched, 1);
    assert.equal(first.eligible, 1);
    assert.equal(first.nextCursorPath, 'teams/team-a/entitlements/2026_team-pass');

    const second = await mod.backfillTeamPassEntitlementProjections({
        dryRun: true, limit: 1, cursorPath: first.nextCursorPath
    }, adminContext);
    assert.equal(second.matched, 1);
    assert.equal(second.eligible, 0);
    assert.equal(second.nextCursorPath, 'users/user-a/entitlements/2026_team-pass');

    const third = await mod.backfillTeamPassEntitlementProjections({
        dryRun: true, limit: 1, cursorPath: second.nextCursorPath
    }, adminContext);
    assert.equal(third.matched, 0);
    assert.equal(third.hasMore, false);
    assert.equal(third.nextCursorPath, null);
});

test('payment authority rollout gate audits blockers and requires an explicit empty assertion', async () => {
    const registrationPath = 'teams/team-a/registrationForms/form-a/registrations/reg-a';
    const feePath = 'teams/team-a/feeBatches/batch-a/feeRecipients/fee-a';
    const freezeId = 'freeze_payment_authority_20260718';
    const { firestore, mod } = loadFunctionsModule({
        'users/platform-admin': { email: 'admin@example.com', isAdmin: true },
        [registrationPath]: {
            id: 'reg-a', teamId: 'team-a', formId: 'form-a', paymentProvider: 'stripe',
            stripeCheckoutSessionId: 'cs_registration_legacy',
            stripeGrossPaidAmountCents: 5000,
            paymentPlan: { id: 'installments', paidInstallmentCount: 1 },
            lastPaidStripeChargeId: 'ch_registration'
        },
        [feePath]: {
            id: 'fee-a', teamId: 'team-a', batchId: 'batch-a', paymentProvider: 'stripe',
            stripeGrossPaidAmountCents: 2500, stripeRefundedAmountCents: 0,
            stripeDisputeLostAmountCents: 0, stripeRefundableAmountCents: 2500,
            stripeFinancialStatus: 'paid'
        },
        [`${feePath}/stripeCharges/ch_fee`]: {
            type: 'stripe_charge', provider: 'stripe', product: 'team_fee',
            teamId: 'team-a', batchId: 'batch-a', recipientId: 'fee-a',
            stripeCheckoutSessionId: 'cs_fee', stripePaymentIntentId: 'pi_fee', stripeChargeId: 'ch_fee',
            amountPaidCents: 2500, refundedAmountCents: 0, disputeLostAmountCents: 0, disputeStatus: 'none',
            refundableAmountCents: 2500, currency: 'usd', livemode: false
        }
    });
    const adminContext = { auth: { uid: 'platform-admin', token: { email: 'admin@example.com' } } };

    const audit = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(audit.ready, false);
    assert.equal(audit.complete, true);
    assert.equal(audit.blockerCount, 1);
    assert.deepEqual(audit.blockers[0], {
        product: 'registration', path: registrationPath, reason: 'paid_stripe_record_missing_charge_ledger'
    });
    await assert.rejects(
        mod.auditStripePaymentAuthorityRollout({
            assertEmpty: true,
            confirmation: 'assert_no_legacy_stripe_payment_authority_v1'
        }, adminContext),
        /maintenance freeze ID is required/i
    );
    await firestore.doc('paymentAuthorityRollout/control').set({ frozen: true, freezeId });
    await assert.rejects(
        mod.auditStripePaymentAuthorityRollout({
            assertEmpty: true,
            confirmation: 'assert_no_legacy_stripe_payment_authority_v1',
            freezeId: `${freezeId}_wrong`
        }, adminContext),
        /exact payment-authority maintenance freeze is not active/i
    );
    firestore.afterNextGet('paymentAuthorityRollout/control', async () => {
        await firestore.doc('paymentAuthorityRollout/control').set({ frozen: false, freezeId });
        await firestore.doc('paymentAuthorityRollout/control').set({ frozen: true, freezeId });
    });
    await assert.rejects(
        mod.auditStripePaymentAuthorityRollout({
            assertEmpty: true,
            confirmation: 'assert_no_legacy_stripe_payment_authority_v1',
            freezeId
        }, adminContext),
        /maintenance freeze changed while the operation was running/i
    );
    await firestore.doc('paymentAuthorityRollout/control').set({ frozen: true, freezeId });
    await assert.rejects(
        mod.auditStripePaymentAuthorityRollout({
            assertEmpty: true,
            confirmation: 'assert_no_legacy_stripe_payment_authority_v1',
            freezeId
        }, adminContext),
        (error) => error.code === 'failed-precondition' && error.details?.blockerCount === 1
    );

    await firestore.doc(`${registrationPath}/stripeCharges/ch_registration`).set({
        type: 'stripe_charge', provider: 'stripe', product: 'registration',
        teamId: 'team-a', formId: 'form-a', registrationId: 'reg-a',
        stripeCheckoutSessionId: 'cs_registration_legacy', stripePaymentIntentId: 'pi_registration',
        stripeChargeId: 'ch_registration', amountPaidCents: 5000,
        refundedAmountCents: 0, disputeLostAmountCents: 0, currency: 'usd', livemode: false
    });
    const asserted = await mod.auditStripePaymentAuthorityRollout({
        assertEmpty: true,
        confirmation: 'assert_no_legacy_stripe_payment_authority_v1',
        freezeId
    }, adminContext);
    assert.equal(asserted.ready, true);
    assert.equal(asserted.blockerCount, 0);

    await firestore.doc(feePath).set({ stripeGrossPaidAmountCents: 5000 }, { merge: true });
    const incompleteHistory = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(incompleteHistory.ready, false);
    assert.deepEqual(incompleteHistory.blockers, [{
        product: 'team_fee', path: feePath, reason: 'stripe_charge_ledger_gross_mismatch'
    }]);
    await firestore.doc(`${feePath}/stripeCharges/ch_fee_2`).set({
        type: 'stripe_charge', provider: 'stripe', product: 'team_fee',
        teamId: 'team-a', batchId: 'batch-a', recipientId: 'fee-a',
        stripeCheckoutSessionId: 'cs_fee_2', stripePaymentIntentId: 'pi_fee_2', stripeChargeId: 'ch_fee_2',
        amountPaidCents: 2500, refundedAmountCents: 0, disputeLostAmountCents: 0, disputeStatus: 'none',
        refundableAmountCents: 2500, currency: 'usd', livemode: false
    });
    await firestore.doc(feePath).set({ stripeRefundableAmountCents: 5000 }, { merge: true });
    const completeHistory = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(completeHistory.ready, true);
    assert.equal(completeHistory.blockerCount, 0);
    assert.equal([...firestore._state.keys()].filter((path) => path.startsWith('paymentAuthorityRolloutAudits/')).length, 5);
});

test('payment authority rollout gate requires structurally complete Team Pass attempt authority', async () => {
    const entitlementPath = 'teams/team-pass/entitlements/2026_team-pass';
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const { firestore, mod } = loadFunctionsModule({
        'users/platform-admin': { email: 'admin@example.com', isAdmin: true },
        [entitlementPath]: { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass', status: 'active' },
        [attemptPath]: {
            product: 'team_pass', teamId: 'team-pass', seasonId: '2026', tier: 'team-pass',
            checkoutStatus: 'paid', stripeCheckoutSessionId: 'cs_team_pass',
            stripePaymentIntentId: 'pi_team_pass', checkoutAmountCents: 4900,
            checkoutCurrency: 'usd', livemode: false, legacyPaymentAuthorityVersion: 1,
            purchaserUid: 'owner-1', checkoutAttemptToken: 'legacy_1234567890abcdef', priceId: 'price_team_pass'
        }
    });
    const adminContext = { auth: { uid: 'platform-admin', token: { email: 'admin@example.com' } } };

    const invalid = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(invalid.ready, false);
    assert.deepEqual(invalid.blockers, [
        { product: 'team_pass', path: entitlementPath, reason: 'active_entitlement_invalid_checkout_attempt' },
        { product: 'team_pass', path: attemptPath, reason: 'active_entitlement_invalid_checkout_attempt' }
    ]);

    await firestore.doc(attemptPath).set({ stripeChargeId: 'ch_team_pass' }, { merge: true });
    const valid = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(valid.ready, true, JSON.stringify(valid.blockers));
    assert.equal(valid.blockerCount, 0);
    const validAttempt = clone(firestore.snapshot(attemptPath));
    await firestore.doc(entitlementPath).set({ status: 'inactive' }, { merge: true });

    for (const checkoutStatus of ['', 'unexpected']) {
        await firestore.doc(attemptPath).set({ ...validAttempt, checkoutStatus });
        const invalidStatus = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
        assert.equal(invalidStatus.ready, false);
        assert.deepEqual(invalidStatus.blockers, [
            { product: 'team_pass', path: attemptPath, reason: 'team_pass_checkout_attempt_status_invalid' }
        ]);
    }

    for (const checkoutStatus of ['stale', 'expired', 'payment_failed']) {
        await firestore.doc(attemptPath).set({ ...validAttempt, checkoutStatus });
        const terminalStatus = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
        assert.equal(terminalStatus.ready, true, `${checkoutStatus}: ${JSON.stringify(terminalStatus.blockers)}`);
    }

    for (const checkoutStatus of ['refunded', 'dispute_lost']) {
        await firestore.doc(attemptPath).set({ ...validAttempt, checkoutStatus });
        const malformedSettlement = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
        assert.equal(malformedSettlement.ready, false);
        assert.deepEqual(malformedSettlement.blockers, [{
            product: 'team_pass', path: attemptPath, reason: 'team_pass_checkout_attempt_invalid'
        }]);
    }

    await firestore.doc(entitlementPath).set({ status: 'active' }, { merge: true });

    for (const checkoutStatus of ['disputed', 'refunded', 'dispute_lost']) {
        await firestore.doc(attemptPath).set({ checkoutStatus }, { merge: true });
        const financiallyIneffective = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
        assert.equal(financiallyIneffective.ready, false);
        assert.deepEqual(financiallyIneffective.blockers[0], {
            product: 'team_pass', path: entitlementPath, reason: 'active_entitlement_invalid_checkout_attempt'
        });
        if (checkoutStatus === 'disputed') {
            assert.deepEqual(financiallyIneffective.blockers[1], {
                product: 'team_pass', path: attemptPath, reason: 'team_pass_checkout_attempt_disputed'
            });
        }
    }

    await firestore.doc(attemptPath).set({
        ...validAttempt,
        checkoutStatus: 'paid',
        reversalState: { chargeAmountCents: 4900, refundedAmountCents: 0, disputeStatus: 'open' }
    });
    const stalePaidStatus = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(stalePaidStatus.ready, false);
    assert.deepEqual(stalePaidStatus.blockers, [
        { product: 'team_pass', path: entitlementPath, reason: 'active_entitlement_invalid_checkout_attempt' },
        { product: 'team_pass', path: attemptPath, reason: 'active_entitlement_invalid_checkout_attempt' }
    ]);

    await firestore.doc('teams/team-pass/teamPassCheckoutAttempts/history_repurchase').set({
        ...validAttempt,
        checkoutStatus: 'paid',
        stripeCheckoutSessionId: 'cs_team_pass_repurchase',
        stripePaymentIntentId: 'pi_team_pass_repurchase',
        stripeChargeId: 'ch_team_pass_repurchase'
    });
    const effectiveRepurchase = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(effectiveRepurchase.ready, false);
    assert.deepEqual(effectiveRepurchase.blockers, [{
        product: 'team_pass', path: attemptPath, reason: 'active_entitlement_invalid_checkout_attempt'
    }]);
});

test('payment authority rollout gate paginates and validates every charge ledger', async () => {
    const feePath = 'teams/team-a/feeBatches/batch-a/feeRecipients/fee-many';
    const seed = {
        'users/platform-admin': { email: 'admin@example.com', isAdmin: true },
        [feePath]: {
            id: 'fee-many', teamId: 'team-a', batchId: 'batch-a', paymentProvider: 'stripe',
            stripeGrossPaidAmountCents: 251, stripeRefundedAmountCents: 0,
            stripeDisputeLostAmountCents: 0, stripeRefundableAmountCents: 251,
            stripeFinancialStatus: 'paid'
        }
    };
    for (let index = 0; index < 251; index += 1) {
        const suffix = String(index).padStart(3, '0');
        seed[`${feePath}/stripeCharges/ch_${suffix}`] = {
            type: 'stripe_charge', provider: 'stripe', product: 'team_fee',
            teamId: 'team-a', batchId: 'batch-a', recipientId: 'fee-many',
            stripeCheckoutSessionId: `cs_${suffix}`, stripePaymentIntentId: `pi_${suffix}`,
            stripeChargeId: `ch_${suffix}`, amountPaidCents: 1,
            refundedAmountCents: 0, disputeLostAmountCents: 0, refundableAmountCents: 1, disputeStatus: 'none',
            currency: 'usd', livemode: false
        };
    }
    const { mod } = loadFunctionsModule(seed);
    const audit = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, {
        auth: { uid: 'platform-admin', token: { email: 'admin@example.com' } }
    });

    assert.equal(audit.complete, true);
    assert.equal(audit.ready, true);
    assert.equal(audit.blockerCount, 0);
});

test('payment authority rollout binds settled Stripe Session economics to the exact charge ledger', async () => {
    const registrationPath = 'teams/team-a/registrationForms/form-a/registrations/reg-settled';
    const ledgerPath = `${registrationPath}/stripeCharges/ch_settled`;
    const sessionId = 'cs_registration_settled';
    const paymentIntentId = 'pi_registration_settled';
    const chargeId = 'ch_settled';
    const metadata = {
        product: 'registration', teamId: 'team-a', formId: 'form-a', registrationId: 'reg-settled',
        checkoutAttemptToken: 'attempt_registration_settled_1234'
    };
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'users/platform-admin': { email: 'admin@example.com', isAdmin: true },
        [registrationPath]: {
            id: 'reg-settled', teamId: 'team-a', formId: 'form-a', paymentProvider: 'stripe',
            stripeGrossPaidAmountCents: 5000, lastPaidStripeChargeId: chargeId,
            paymentPlan: { id: 'full' }
        },
        [ledgerPath]: {
            type: 'stripe_charge', provider: 'stripe', product: 'registration',
            teamId: 'team-a', formId: 'form-a', registrationId: 'reg-settled',
            stripeCheckoutSessionId: sessionId, stripePaymentIntentId: paymentIntentId,
            stripeChargeId: chargeId, amountPaidCents: 5000,
            refundedAmountCents: 0, disputeLostAmountCents: 0, disputeStatus: 'none',
            currency: 'usd', livemode: false
        }
    });
    const adminContext = { auth: { uid: 'platform-admin', token: { email: 'admin@example.com' } } };
    stripeState.checkoutResponses.set(sessionId, {
        id: sessionId, mode: 'payment', status: 'complete', payment_status: 'paid', livemode: false,
        client_reference_id: 'team-a:form-a:reg-settled', metadata: clone(metadata),
        payment_intent: paymentIntentId, amount_total: 4900, currency: 'usd'
    });
    stripeState.paymentIntents.set(paymentIntentId, {
        id: paymentIntentId, amount: 4900, amount_received: 4900, currency: 'usd', livemode: false,
        metadata: clone(metadata), latest_charge: chargeId
    });
    stripeState.charges.set(chargeId, {
        id: chargeId, object: 'charge', amount: 4900, amount_refunded: 0,
        currency: 'usd', livemode: false, metadata: clone(metadata),
        payment_intent: paymentIntentId, disputed: false
    });

    const invalid = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(invalid.ready, false);
    assert.deepEqual(invalid.blockers, [{
        product: 'registration', path: `stripeCheckoutSessions/${sessionId}`,
        reason: 'settled_stripe_session_charge_ledger_invalid'
    }]);

    stripeState.checkoutResponses.get(sessionId).amount_total = 5000;
    stripeState.paymentIntents.get(paymentIntentId).amount = 5000;
    stripeState.paymentIntents.get(paymentIntentId).amount_received = 5000;
    stripeState.charges.get(chargeId).amount = 5000;
    const valid = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(valid.ready, true, JSON.stringify(valid.blockers));
    assert.equal(valid.blockerCount, 0);

    stripeState.charges.get(chargeId).disputed = true;
    const missingDisputeEvidence = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(missingDisputeEvidence.ready, false);
    assert.equal(missingDisputeEvidence.blockers[0]?.reason, 'settled_stripe_session_charge_ledger_invalid');

    await firestore.doc(ledgerPath).update({ disputeStatus: 'won' });
    const resolvedDisputeWithoutEventEvidence = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(resolvedDisputeWithoutEventEvidence.ready, false);
    assert.deepEqual(resolvedDisputeWithoutEventEvidence.blockers.map((blocker) => blocker.reason).sort(), [
        'settled_stripe_session_charge_ledger_invalid',
        'stripe_charge_ledger_invalid'
    ].sort());

    await firestore.doc(ledgerPath).update({
        disputeEventCreated: 100,
        lastStripeEventId: 'evt_dispute_won'
    });
    const resolvedDispute = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(resolvedDispute.ready, true, JSON.stringify(resolvedDispute.blockers));
    assert.equal(resolvedDispute.blockerCount, 0);

    await firestore.doc(ledgerPath).update({ disputeStatus: 'lost', disputeLostAmountCents: 0 });
    await firestore.doc(registrationPath).update({ stripeDisputeLostAmountCents: 0 });
    const staleLostAmount = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(staleLostAmount.ready, false);
    assert.equal(staleLostAmount.blockers[0]?.reason, 'settled_stripe_session_charge_ledger_invalid');

    await firestore.doc(ledgerPath).update({ disputeLostAmountCents: 5000 });
    const registrationWithoutLostAggregate = firestore.snapshot(registrationPath);
    delete registrationWithoutLostAggregate.stripeDisputeLostAmountCents;
    await firestore.doc(registrationPath).set(registrationWithoutLostAggregate);
    const missingParentLostAmount = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(missingParentLostAmount.ready, false);
    assert.deepEqual(missingParentLostAmount.blockers.map((blocker) => blocker.reason).sort(), [
        'settled_stripe_session_charge_ledger_invalid',
        'stripe_charge_ledger_aggregate_mismatch'
    ].sort());

    await firestore.doc(registrationPath).update({ stripeDisputeLostAmountCents: 5000 });
    const reconciledLostAmount = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(reconciledLostAmount.ready, true, JSON.stringify(reconciledLostAmount.blockers));
    assert.equal(reconciledLostAmount.blockerCount, 0);

    stripeState.charges.get(chargeId).disputed = false;
    await firestore.doc(ledgerPath).update({ disputeStatus: 'open', disputeLostAmountCents: 0 });
    await firestore.doc(registrationPath).update({ stripeDisputeLostAmountCents: 0 });
    const staleOpenDispute = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(staleOpenDispute.ready, false);
    assert.equal(staleOpenDispute.blockers[0]?.reason, 'settled_stripe_session_charge_ledger_invalid');
});

test('payment authority rollout accepts exact terminal Team Pass Session authority', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const sessionId = 'cs_team_pass_settled';
    const paymentIntentId = 'pi_team_pass_settled';
    const chargeId = 'ch_team_pass_settled';
    const metadata = {
        product: 'team_pass', teamId: 'team-pass', seasonId: '2026', tier: 'team-pass',
        purchaserUid: 'owner-1', checkoutAttemptToken: 'attempt_team_pass_settled_1234',
        priceId: 'price_team_pass'
    };
    const refundedAttempt = {
        ...clone(metadata), checkoutStatus: 'refunded', stripePaymentAuthorityVersion: 2,
        stripeCheckoutSessionId: sessionId, stripePaymentIntentId: paymentIntentId, stripeChargeId: chargeId,
        checkoutAmountCents: 4900, checkoutCurrency: 'usd', livemode: false, refundedAmountCents: 4900,
        reversalState: {
            stripePaymentIntentId: paymentIntentId, stripeChargeId: chargeId,
            chargeAmountCents: 4900, refundedAmountCents: 4900, disputeStatus: 'none'
        }
    };
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'users/platform-admin': { email: 'admin@example.com', isAdmin: true },
        [attemptPath]: refundedAttempt
    });
    const adminContext = { auth: { uid: 'platform-admin', token: { email: 'admin@example.com' } } };
    stripeState.checkoutResponses.set(sessionId, {
        id: sessionId, mode: 'payment', status: 'complete', payment_status: 'paid', livemode: false,
        client_reference_id: 'team-pass:2026:owner-1', metadata: clone(metadata),
        payment_intent: paymentIntentId, amount_total: 4900, currency: 'usd'
    });
    stripeState.paymentIntents.set(paymentIntentId, {
        id: paymentIntentId, amount: 4900, amount_received: 4900, currency: 'usd', livemode: false,
        metadata: clone(metadata), latest_charge: chargeId
    });
    stripeState.charges.set(chargeId, {
        id: chargeId, object: 'charge', amount: 4900, amount_refunded: 4900,
        currency: 'usd', livemode: false, metadata: clone(metadata),
        payment_intent: paymentIntentId, disputed: false
    });

    const refunded = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(refunded.ready, true, JSON.stringify(refunded.blockers));
    assert.equal(refunded.blockerCount, 0);

    await firestore.doc(attemptPath).set({
        ...refundedAttempt,
        checkoutStatus: 'dispute_lost',
        refundedAmountCents: 0,
        disputeLostAmountCents: 4900,
        disputeId: 'dp_team_pass_settled',
        reversalState: {
            ...refundedAttempt.reversalState,
            refundedAmountCents: 0,
            disputeStatus: 'lost',
            disputeLostAmountCents: 4900,
            disputeEventCreated: 100,
            lastStripeEventId: 'evt_team_pass_settled_lost'
        }
    });
    stripeState.charges.get(chargeId).amount_refunded = 0;
    stripeState.charges.get(chargeId).disputed = true;
    const disputeLost = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(disputeLost.ready, true, JSON.stringify(disputeLost.blockers));
    assert.equal(disputeLost.blockerCount, 0);

    await firestore.doc(attemptPath).update({ refundedAmountCents: 1 });
    const staleTerminalEconomics = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(staleTerminalEconomics.ready, false);
    assert.equal(staleTerminalEconomics.blockers.some((blocker) => (
        blocker.path === attemptPath && blocker.reason === 'team_pass_checkout_attempt_invalid'
    )), true);
});

test('payment authority rollout gate detects pointers, orphan ledgers, and paid attempts without entitlements', async () => {
    const registrationPath = 'teams/team-a/registrationForms/form-a/registrations/reg-pointer';
    const orphanLedgerPath = 'teams/team-a/feeBatches/batch-a/feeRecipients/missing-parent/stripeCharges/ch_orphan';
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2027_team-pass';
    const { firestore, mod } = loadFunctionsModule({
        'users/platform-admin': { email: 'admin@example.com', isAdmin: true },
        [registrationPath]: {
            teamId: 'team-a', formId: 'form-a', checkoutCreationReservationId: 'reservation_pointer_only'
        },
        [orphanLedgerPath]: {
            type: 'stripe_charge', provider: 'stripe', product: 'team_fee',
            teamId: 'team-a', batchId: 'batch-a', recipientId: 'missing-parent',
            stripeCheckoutSessionId: 'cs_orphan', stripePaymentIntentId: 'pi_orphan', stripeChargeId: 'ch_orphan',
            amountPaidCents: 2500, refundedAmountCents: 0, disputeLostAmountCents: 0,
            refundableAmountCents: 2500, disputeStatus: 'none', currency: 'usd', livemode: false
        },
        [attemptPath]: {
            product: 'team_pass', teamId: 'team-pass', seasonId: '2027', tier: 'team-pass',
            purchaserUid: 'owner-1', priceId: 'price_team_pass', checkoutAttemptToken: 'attempt_1234567890abcdef',
            stripePaymentAuthorityVersion: 2, checkoutStatus: 'paid',
            stripeCheckoutSessionId: 'cs_paid_no_entitlement', stripePaymentIntentId: 'pi_paid_no_entitlement',
            stripeChargeId: 'ch_paid_no_entitlement',
            checkoutAmountCents: 4900, checkoutCurrency: 'usd', livemode: false
        }
    });
    const audit = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, {
        auth: { uid: 'platform-admin', token: { email: 'admin@example.com' } }
    });

    assert.equal(audit.ready, false);
    assert.deepEqual(audit.blockers, [
        { product: 'registration', path: registrationPath, reason: 'registration_checkout_creation_in_flight' },
        { product: 'team_fee', path: orphanLedgerPath, reason: 'orphan_stripe_charge_ledger' },
        { product: 'team_pass', path: attemptPath, reason: 'paid_team_pass_attempt_missing_active_entitlement' }
    ]);
    assert.equal(audit.scanned.stripeChargeLedgers, 1);
    assert.equal(audit.scanned.teamPassCheckoutAttempts, 1);
});

test('rollout cleanup dry-runs and expires only exactly bound AllPlays open Sessions', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'users/platform-admin': { email: 'admin@example.com', isAdmin: true }
    });
    const freezeId = 'freeze_payment_authority_cleanup';
    stripeState.checkoutResponses.set('cs_rollout_team_pass', {
        id: 'cs_rollout_team_pass', mode: 'payment', status: 'open', payment_status: 'unpaid', livemode: false,
        client_reference_id: 'team-pass:2026:owner-1',
        metadata: { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass', purchaserUid: 'owner-1' }
    });
    for (let index = 0; index < 99; index += 1) {
        const id = `cs_unrelated_${String(index).padStart(3, '0')}`;
        stripeState.checkoutResponses.set(id, {
            id, mode: 'payment', status: 'open', payment_status: 'unpaid', livemode: false,
            client_reference_id: 'unrelated', metadata: { product: 'other_product' }
        });
    }
    const adminContext = { auth: { uid: 'platform-admin', token: { email: 'admin@example.com' } } };

    const auditBefore = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.deepEqual(auditBefore.blockers, [{
        product: 'team_pass', path: 'stripeCheckoutSessions/cs_rollout_team_pass',
        reason: 'open_stripe_checkout_session_must_be_expired'
    }]);
    const dryRun = await mod.expireOpenStripePaymentAuthoritySessionsForRollout({ dryRun: true }, adminContext);
    assert.deepEqual(dryRun, {
        dryRun: true, complete: true, scanned: 100, matched: 1, expired: 0,
        failureCount: 0, bindingFailureCount: 0, liveModeMatched: 0, testModeMatched: 1
    });
    assert.equal(stripeState.checkoutResponses.get('cs_rollout_team_pass').status, 'open');
    await assert.rejects(
        mod.expireOpenStripePaymentAuthoritySessionsForRollout({ dryRun: false }, adminContext),
        /confirmation is required/i
    );
    await assert.rejects(
        mod.expireOpenStripePaymentAuthoritySessionsForRollout({
            dryRun: false,
            confirmation: 'expire_open_legacy_stripe_checkout_sessions_v1',
            freezeId
        }, adminContext),
        /exact payment-authority maintenance freeze is not active/i
    );
    await firestore.doc('paymentAuthorityRollout/control').set({ frozen: true, freezeId });
    const expired = await mod.expireOpenStripePaymentAuthoritySessionsForRollout({
        dryRun: false,
        confirmation: 'expire_open_legacy_stripe_checkout_sessions_v1',
        freezeId
    }, adminContext);
    assert.equal(expired.expired, 1);
    assert.deepEqual(stripeState.expiredSessionIds, ['cs_rollout_team_pass']);
    assert.equal(stripeState.checkoutResponses.get('cs_unrelated_000').status, 'open');
    const auditAfter = await mod.auditStripePaymentAuthorityRollout({ assertEmpty: false }, adminContext);
    assert.equal(auditAfter.ready, true);
});

test('rollout cleanup stops between Session expirations when the exact freeze epoch changes', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'users/platform-admin': { email: 'admin@example.com', isAdmin: true }
    });
    const freezeId = 'freeze_payment_authority_cleanup_epoch';
    for (const suffix of ['a', 'b']) {
        stripeState.checkoutResponses.set(`cs_rollout_${suffix}`, {
            id: `cs_rollout_${suffix}`, mode: 'payment', status: 'open', payment_status: 'unpaid', livemode: false,
            client_reference_id: `team-${suffix}:2026:owner-1`,
            metadata: {
                product: 'team_pass', teamId: `team-${suffix}`, seasonId: '2026', tier: 'team-pass',
                purchaserUid: 'owner-1', priceId: 'price_team_pass',
                checkoutAttemptToken: `attempt_${suffix}_1234567890abcdef`
            }
        });
    }
    await firestore.doc('paymentAuthorityRollout/control').set({ frozen: true, freezeId });
    let freezeReplaced = false;
    stripeState.checkoutExpireHook = async () => {
        if (freezeReplaced) return;
        freezeReplaced = true;
        await firestore.doc('paymentAuthorityRollout/control').set({ frozen: false, freezeId });
        await firestore.doc('paymentAuthorityRollout/control').set({ frozen: true, freezeId });
    };

    await assert.rejects(
        mod.expireOpenStripePaymentAuthoritySessionsForRollout({
            dryRun: false,
            confirmation: 'expire_open_legacy_stripe_checkout_sessions_v1',
            freezeId
        }, { auth: { uid: 'platform-admin', token: { email: 'admin@example.com' } } }),
        /maintenance freeze changed while the operation was running/i
    );
    assert.deepEqual(stripeState.expiredSessionIds, ['cs_rollout_a']);
    assert.equal(stripeState.checkoutResponses.get('cs_rollout_b').status, 'open');
    assert.equal(
        [...firestore._state.keys()].filter((path) => path.startsWith('paymentAuthorityRolloutSessionExpirations/')).length,
        0
    );
});

test('Team Pass reversal state remains authoritative when refund arrives before paid', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const entitlementPath = 'teams/team-pass/entitlements/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const checkout = await mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    const charge = {
        object: 'charge', id: 'ch_team_pass_early_refund', metadata: clone(session.metadata),
        payment_intent: 'pi_team_pass_early_refund', amount: 4900, amount_refunded: 4900,
        currency: 'usd', livemode: false
    };
    stripeState.webhookEvent = {
        id: 'evt_team_pass_early_refund', type: 'charge.refunded', created: 200,
        data: { object: charge }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'open');
    assert.equal(firestore.snapshot(attemptPath).reversalState.refundedAmountCents, 4900);
    assert.equal(firestore.snapshot(entitlementPath), undefined);

    stripeState.paymentIntents.set('pi_team_pass_early_refund', {
        id: 'pi_team_pass_early_refund', amount_received: 4900, currency: 'usd', livemode: false,
        metadata: clone(session.metadata), latest_charge: charge.id
    });
    stripeState.charges.set(charge.id, clone(charge));

    stripeState.webhookEvent = {
        id: 'evt_team_pass_paid_after_refund', type: 'checkout.session.completed', created: 300,
        data: { object: {
            ...clone(session), payment_status: 'paid', payment_intent: 'pi_team_pass_early_refund'
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'refunded');
    assert.equal(firestore.snapshot(entitlementPath).status, 'cancelled');
});

test('empty-metadata Team Pass reversal retries after exact Session authority becomes durable', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const entitlementPath = 'teams/team-pass/entitlements/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const checkout = await mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    session.payment_intent = 'pi_team_pass_empty_metadata';
    stripeState.checkoutResponses.set(session.id, session);
    const charge = {
        object: 'charge', id: 'ch_team_pass_empty_metadata', metadata: {},
        payment_intent: 'pi_team_pass_empty_metadata', amount: 4900, amount_refunded: 4900,
        currency: 'usd', livemode: false
    };
    stripeState.charges.set(charge.id, charge);
    const durableAuthority = firestore.snapshot(attemptPath);
    firestore._state.delete(attemptPath);
    const reversalEvent = {
        id: 'evt_team_pass_empty_metadata_refund', type: 'charge.refunded', created: 200,
        data: { object: clone(charge) }
    };

    stripeState.webhookEvent = reversalEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    assert.equal(firestore.snapshot(`stripeEvents/${reversalEvent.id}`), undefined);

    await firestore.doc(attemptPath).set(durableAuthority);
    stripeState.paymentIntents.set('pi_team_pass_empty_metadata', {
        id: 'pi_team_pass_empty_metadata', amount_received: 4900, currency: 'usd', livemode: false,
        metadata: clone(session.metadata), latest_charge: charge.id
    });
    stripeState.charges.set(charge.id, {
        ...clone(charge), metadata: clone(session.metadata), amount_refunded: 0
    });
    stripeState.webhookEvent = {
        id: 'evt_team_pass_paid_before_empty_metadata_retry', type: 'checkout.session.completed', created: 100,
        data: { object: { ...clone(session), status: 'complete', payment_status: 'paid' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'paid');

    stripeState.webhookEvent = reversalEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'refunded');
    assert.equal(firestore.snapshot(entitlementPath).status, 'cancelled');
    assert.equal(firestore.snapshot(`stripeEvents/${reversalEvent.id}`).ignored, false);
});

test('Team Pass dispute close cannot be regressed by a late created event', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const checkout = await mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    const charge = {
        object: 'charge', id: 'ch_team_pass_dispute', metadata: clone(session.metadata),
        payment_intent: 'pi_team_pass_dispute', amount: 4900, amount_refunded: 0,
        currency: 'usd', livemode: false
    };
    stripeState.charges.set(charge.id, charge);

    stripeState.webhookEvent = {
        id: 'evt_team_pass_dispute_won', type: 'charge.dispute.closed', created: 300,
        data: { object: { object: 'dispute', id: 'dp_team_pass', charge: charge.id, status: 'won' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const wonState = firestore.snapshot(attemptPath).reversalState;
    assert.equal(wonState.disputeStatus, 'won');
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.deepEqual(firestore.snapshot(attemptPath).reversalState, wonState);

    stripeState.webhookEvent = {
        id: 'evt_team_pass_late_dispute_created', type: 'charge.dispute.created', created: 100,
        data: { object: { object: 'dispute', id: 'dp_team_pass', charge: charge.id, status: 'needs_response' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.deepEqual(firestore.snapshot(attemptPath).reversalState, wonState);
    assert.equal(firestore.snapshot('stripeEvents/evt_team_pass_late_dispute_created').ignoredReason, 'reversal_event_out_of_order');
});

test('Team Pass warning inquiry closure retains payment without fabricating dispute loss', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const entitlementPath = 'teams/team-pass/entitlements/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const checkout = await mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    stripeState.webhookEvent = {
        id: 'evt_team_pass_warning_paid', type: 'checkout.session.completed', created: 100,
        data: { object: { ...clone(session), payment_status: 'paid', payment_intent: 'pi_team_pass_warning' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const chargeId = 'ch_pi_team_pass_warning';

    stripeState.webhookEvent = {
        id: 'evt_team_pass_warning_created', type: 'charge.dispute.created', created: 200,
        data: { object: { object: 'dispute', id: 'dp_team_pass_warning', charge: chargeId, status: 'warning_needs_response' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'disputed');
    assert.equal(firestore.snapshot(entitlementPath).status, 'inactive');

    stripeState.webhookEvent = {
        id: 'evt_team_pass_warning_closed', type: 'charge.dispute.closed', created: 300,
        data: { object: { object: 'dispute', id: 'dp_team_pass_warning', charge: chargeId, status: 'warning_closed' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'paid');
    assert.equal(firestore.snapshot(attemptPath).reversalState.disputeStatus, 'won');
    assert.equal(firestore.snapshot(attemptPath).disputeLostAmountCents, 0);
    assert.equal(firestore.snapshot(entitlementPath).status, 'active');
});

test('Team Pass can reconcile a won dispute after persisting dispute_lost', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const entitlementPath = 'teams/team-pass/entitlements/2026_team-pass';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const checkout = await mod.createStripeTeamPassCheckout({
        teamId: 'team-pass', seasonId: '2026', tier: 'team-pass'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    stripeState.webhookEvent = {
        id: 'evt_team_pass_paid_before_dispute', type: 'checkout.session.completed', created: 100,
        data: { object: {
            ...clone(session), payment_status: 'paid', payment_intent: 'pi_team_pass_lost_then_won'
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const chargeId = 'ch_pi_team_pass_lost_then_won';
    stripeState.charges.set(chargeId, {
        object: 'charge', id: chargeId, metadata: clone(session.metadata),
        payment_intent: 'pi_team_pass_lost_then_won', amount: 4900, amount_refunded: 0,
        currency: 'usd', livemode: false
    });

    stripeState.webhookEvent = {
        id: 'evt_team_pass_dispute_lost', type: 'charge.dispute.closed', created: 200,
        data: { object: { object: 'dispute', id: 'dp_team_pass_lost_then_won', charge: chargeId, status: 'lost' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'dispute_lost');
    assert.equal(firestore.snapshot(attemptPath).disputeLostAmountCents, 4900);
    assert.equal(firestore.snapshot(attemptPath).reversalState.disputeLostAmountCents, 4900);
    assert.equal(firestore.snapshot(entitlementPath).status, 'cancelled');

    stripeState.webhookEvent = {
        id: 'evt_team_pass_dispute_won_after_lost', type: 'charge.dispute.closed', created: 300,
        data: { object: { object: 'dispute', id: 'dp_team_pass_lost_then_won', charge: chargeId, status: 'won' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'paid');
    assert.equal(firestore.snapshot(attemptPath).disputeLostAmountCents, 0);
    assert.equal(firestore.snapshot(attemptPath).reversalState.disputeLostAmountCents, 0);
    assert.equal(firestore.snapshot(entitlementPath).status, 'active');
});

test('Team Pass entitlement aggregates historical paid authority with a replacement purchase', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const entitlementPath = 'teams/team-pass/entitlements/2026_team-pass';
    const request = { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' };
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const originalCheckout = await mod.createStripeTeamPassCheckout(request, authContext);
    const originalSession = stripeState.checkoutResponses.get(originalCheckout.sessionId);
    stripeState.webhookEvent = {
        id: 'evt_team_pass_original_paid', type: 'checkout.session.completed', created: 100,
        data: { object: {
            ...clone(originalSession), status: 'complete', payment_status: 'paid',
            payment_intent: 'pi_team_pass_original'
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const originalChargeId = 'ch_pi_team_pass_original';
    const originalCharge = {
        object: 'charge', id: originalChargeId, metadata: clone(originalSession.metadata),
        payment_intent: 'pi_team_pass_original', amount: 4900, amount_refunded: 0,
        currency: 'usd', livemode: false
    };
    stripeState.charges.set(originalChargeId, originalCharge);

    stripeState.webhookEvent = {
        id: 'evt_team_pass_original_dispute_lost', type: 'charge.dispute.closed', created: 200,
        data: { object: { object: 'dispute', id: 'dp_team_pass_original', charge: originalChargeId, status: 'lost' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'dispute_lost');
    assert.equal(firestore.snapshot(entitlementPath).status, 'cancelled');

    const replacementCheckout = await mod.createStripeTeamPassCheckout(request, authContext);
    assert.notEqual(replacementCheckout.sessionId, originalCheckout.sessionId);
    assert.equal(firestore.snapshot(attemptPath).stripeCheckoutSessionId, replacementCheckout.sessionId);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'open');
    const historicalEntries = [...firestore._state.entries()].filter(([path, data]) => (
        path.startsWith('teams/team-pass/teamPassCheckoutAttempts/history_')
        && data.stripeChargeId === originalChargeId
    ));
    assert.equal(historicalEntries.length, 1);
    assert.equal(historicalEntries[0][1].checkoutStatus, 'dispute_lost');

    const replacementSession = stripeState.checkoutResponses.get(replacementCheckout.sessionId);
    stripeState.webhookEvent = {
        id: 'evt_team_pass_replacement_paid', type: 'checkout.session.completed', created: 300,
        data: { object: {
            ...clone(replacementSession), status: 'complete', payment_status: 'paid',
            payment_intent: 'pi_team_pass_replacement'
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(entitlementPath).status, 'active');
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'paid');

    stripeState.webhookEvent = {
        id: 'evt_team_pass_original_dispute_won_after_repurchase', type: 'charge.dispute.closed', created: 400,
        data: { object: { object: 'dispute', id: 'dp_team_pass_original', charge: originalChargeId, status: 'won' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(historicalEntries[0][0]).checkoutStatus, 'paid');
    assert.equal(firestore.snapshot(entitlementPath).status, 'active');
    assert.equal(firestore.snapshot(attemptPath).stripeCheckoutSessionId, replacementCheckout.sessionId);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'paid');

    const replacementCharge = {
        object: 'charge', id: 'ch_pi_team_pass_replacement', metadata: clone(replacementSession.metadata),
        payment_intent: 'pi_team_pass_replacement', amount: 4900, amount_refunded: 0,
        currency: 'usd', livemode: false
    };
    stripeState.charges.set(replacementCharge.id, clone(replacementCharge));
    stripeState.webhookEvent = {
        id: 'evt_team_pass_replacement_refunded_after_original_won', type: 'charge.refunded', created: 500,
        data: { object: { ...clone(replacementCharge), amount_refunded: 4900 } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'refunded');
    assert.equal(firestore.snapshot(historicalEntries[0][0]).checkoutStatus, 'paid');
    assert.equal(firestore.snapshot(entitlementPath).status, 'active');
});

test('Team Pass paid-authority restoration expires an open replacement before reactivation', async () => {
    const attemptPath = 'teams/team-pass/teamPassCheckoutAttempts/2026_team-pass';
    const entitlementPath = 'teams/team-pass/entitlements/2026_team-pass';
    const request = { teamId: 'team-pass', seasonId: '2026', tier: 'team-pass' };
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-pass': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' }
    });
    const originalCheckout = await mod.createStripeTeamPassCheckout(request, authContext);
    const originalSession = stripeState.checkoutResponses.get(originalCheckout.sessionId);
    stripeState.webhookEvent = {
        id: 'evt_restore_original_paid', type: 'checkout.session.completed', created: 100,
        data: { object: {
            ...clone(originalSession), status: 'complete', payment_status: 'paid',
            payment_intent: 'pi_restore_original'
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const originalChargeId = 'ch_pi_restore_original';
    const originalCharge = {
        object: 'charge', id: originalChargeId, metadata: clone(originalSession.metadata),
        payment_intent: 'pi_restore_original', amount: 4900, amount_refunded: 0,
        currency: 'usd', livemode: false
    };
    stripeState.charges.set(originalChargeId, originalCharge);
    stripeState.webhookEvent = {
        id: 'evt_restore_original_lost', type: 'charge.dispute.closed', created: 200,
        data: { object: { object: 'dispute', id: 'dp_restore_original', charge: originalChargeId, status: 'lost' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    const replacementCheckout = await mod.createStripeTeamPassCheckout(request, authContext);
    const historyPath = [...firestore._state.keys()].find((path) => (
        path.startsWith('teams/team-pass/teamPassCheckoutAttempts/history_')
    ));
    stripeState.webhookEvent = {
        id: 'evt_restore_original_won', type: 'charge.dispute.closed', created: 300,
        data: { object: { object: 'dispute', id: 'dp_restore_original', charge: originalChargeId, status: 'won' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    assert.deepEqual(stripeState.expiredSessionIds, [replacementCheckout.sessionId]);
    assert.equal(firestore.snapshot(attemptPath).checkoutStatus, 'stale');
    assert.equal(firestore.snapshot(historyPath).checkoutStatus, 'paid');
    assert.equal(firestore.snapshot(entitlementPath).status, 'active');
    await assert.rejects(mod.createStripeTeamPassCheckout(request, authContext), /already has an active pass/i);
    assert.equal(stripeState.checkoutSessions.length, 2);
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

test('team fee checkout omits customer_email when a UID-eligible payer has no email', async () => {
    const recipientPath = 'teams/team-fee/feeBatches/batch-1/feeRecipients/recipient-1';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-fee': { ownerId: 'owner-1', adminEmails: [] },
        [recipientPath]: {
            teamId: 'team-fee', batchId: 'batch-1', collectionMode: 'online_stripe',
            amountCents: 7500, paidAmountCents: 0, balanceDueCents: 7500,
            status: 'unpaid', feeTitle: 'Tournament fee', playerName: 'Sam'
        }
    }, { rejectUndefinedWrites: true });

    const checkout = await mod.createStripeTeamFeeCheckout(
        { teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1' },
        { auth: { uid: 'owner-1', token: {} } }
    );

    assert.equal(checkout.sessionId, 'cs_test_1');
    assert.equal(stripeState.checkoutSessions.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(stripeState.checkoutSessions[0], 'customer_email'), false);
    const token = stripeState.checkoutSessions[0].metadata.checkoutAttemptToken;
    const reservation = firestore.snapshot(`${recipientPath}/checkoutReservations/${token}`);
    assert.equal(Object.prototype.hasOwnProperty.call(reservation.stripeRequest, 'customer_email'), false);
    assert.equal(firestore.snapshot(recipientPath).checkoutStatus, 'open');
});

test('late duplicate team fee projection cannot downgrade or expire the persisted reservation', async () => {
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
    const sessionId = 'cs_team_fee_concurrent_winner';
    const checkoutUrl = 'https://stripe.test/checkout/team-fee-concurrent';
    stripeState.nextCheckoutResponse = { id: sessionId, url: checkoutUrl };
    stripeState.checkoutCreateHook = async ({ payload }) => {
        const token = payload.metadata.checkoutAttemptToken;
        await firestore.doc(recipientPath).set({
            checkoutStatus: 'open',
            checkoutUrl,
            stripeCheckoutSessionId: sessionId,
            checkoutAttemptToken: token,
            checkoutPayerUid: 'owner-1'
        }, { merge: true });
        await firestore.doc(`${recipientPath}/checkoutReservations/${token}`).set({
            status: 'persisted',
            stripeCheckoutSessionId: sessionId
        }, { merge: true });
    };

    const result = await mod.createStripeTeamFeeCheckout(
        { teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1' },
        { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } }
    );

    assert.deepEqual(result, { checkoutUrl, sessionId });
    assert.equal(firestore.snapshot(recipientPath).checkoutStatus, 'open');
    const token = firestore.snapshot(recipientPath).checkoutAttemptToken;
    assert.equal(firestore.snapshot(`${recipientPath}/checkoutReservations/${token}`).status, 'persisted');
    assert.deepEqual(stripeState.expiredSessionIds, []);
});

test('failed team fee checkout authority cannot be replaced by another eligible payer', async () => {
    const recipientPath = 'teams/team-fee/feeBatches/batch-1/feeRecipients/recipient-1';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-fee': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' },
        'users/parent-2': { email: 'parent@example.com' },
        [recipientPath]: {
            teamId: 'team-fee', batchId: 'batch-1', collectionMode: 'online_stripe', parentUserId: 'parent-2',
            amountCents: 7500, paidAmountCents: 0, balanceDueCents: 7500,
            status: 'unpaid', feeTitle: 'Tournament fee', playerName: 'Sam'
        }
    });
    const request = { teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1' };
    let firstCall = true;
    stripeState.checkoutCreateHook = async () => {
        if (firstCall) {
            firstCall = false;
            throw new Error('Injected Stripe creation failure.');
        }
    };
    await assert.rejects(mod.createStripeTeamFeeCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'owner@example.com' } }
    }), /Injected Stripe creation failure/);
    const failedAttempt = firestore.snapshot(recipientPath);
    const failedToken = failedAttempt.checkoutAttemptToken;
    assert.equal(failedAttempt.checkoutPayerUid, 'owner-1');

    await assert.rejects(mod.createStripeTeamFeeCheckout(request, {
        auth: { uid: 'parent-2', token: { email: 'parent@example.com' } }
    }), /safely invalidated before another payer/i);
    assert.equal(stripeState.checkoutSessions.length, 1);
    assert.equal(firestore.snapshot(recipientPath).checkoutAttemptToken, failedToken);
    assert.equal(firestore.snapshot(recipientPath).checkoutPayerUid, 'owner-1');

    const checkout = await mod.createStripeTeamFeeCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'owner@example.com' } }
    });
    const retriedAttempt = firestore.snapshot(recipientPath);
    assert.equal(retriedAttempt.checkoutAttemptToken, failedToken);
    assert.equal(retriedAttempt.checkoutPayerUid, 'owner-1');
    assert.equal(stripeState.checkoutSessions[1].metadata.payerUid, 'owner-1');
    assert.equal(stripeState.checkoutSessionOptions[1].idempotencyKey, stripeState.checkoutSessionOptions[0].idempotencyKey);
    assert.equal(retriedAttempt.stripeCheckoutSessionId, checkout.sessionId);
});

test('team fee never returns another payer\'s reusable checkout URL', async () => {
    const recipientPath = 'teams/team-fee/feeBatches/batch-1/feeRecipients/recipient-1';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-fee': { ownerId: 'owner-1', adminEmails: ['admin@example.com'] },
        'users/owner-1': { email: 'owner@example.com' },
        'users/admin-2': { email: 'admin@example.com' },
        [recipientPath]: {
            teamId: 'team-fee', batchId: 'batch-1', collectionMode: 'online_stripe',
            amountCents: 7500, paidAmountCents: 0, balanceDueCents: 7500,
            status: 'unpaid', feeTitle: 'Tournament fee', playerName: 'Sam'
        }
    });
    const request = { teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1' };
    const ownerCheckout = await mod.createStripeTeamFeeCheckout(request, {
        auth: { uid: 'owner-1', token: { email: 'owner@example.com' } }
    });
    const authorityBefore = firestore.snapshot(recipientPath);

    await assert.rejects(mod.createStripeTeamFeeCheckout(request, {
        auth: { uid: 'admin-2', token: { email: 'admin@example.com' } }
    }), /Another payer already has an active checkout/i);

    assert.equal(stripeState.checkoutSessions.length, 1);
    assert.equal(stripeState.expiredSessionIds.length, 0);
    assert.equal(ownerCheckout.sessionId, authorityBefore.stripeCheckoutSessionId);
    assert.deepEqual(firestore.snapshot(recipientPath), authorityBefore);
});

test('admin invalidation recovers and expires a sessionless failed team fee checkout before clearing authority', async () => {
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
    let injected = false;
    stripeState.checkoutCreateHook = async ({ payload, options }) => {
        if (injected) return;
        injected = true;
        const response = {
            id: 'cs_team_fee_ambiguous', url: 'https://stripe.test/checkout/ambiguous',
            payment_status: 'unpaid', status: 'open', livemode: false,
            metadata: clone(payload.metadata), amount_total: 7500, currency: 'usd'
        };
        stripeState.checkoutResponses.set(response.id, clone(response));
        stripeState.checkoutResponsesByIdempotencyKey.set(options.idempotencyKey, clone(response));
        throw new Error('Injected ambiguous network failure.');
    };
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };
    await assert.rejects(mod.createStripeTeamFeeCheckout(request, authContext), /Injected ambiguous network failure/);
    assert.equal(firestore.snapshot(recipientPath).checkoutStatus, 'creation_failed');

    const result = await mod.expireStripeTeamFeeCheckout(request, authContext);

    assert.deepEqual(result, { expired: true, recovered: true });
    assert.deepEqual(stripeState.expiredSessionIds, ['cs_team_fee_ambiguous']);
    const recipient = firestore.snapshot(recipientPath);
    assert.equal(recipient.checkoutStatus, 'expired');
    assert.equal(recipient.checkoutAttemptToken, null);
    const reservationPath = `${recipientPath}/checkoutReservations/${stripeState.checkoutSessions[0].metadata.checkoutAttemptToken}`;
    assert.equal(firestore.snapshot(reservationPath).status, 'superseded');
});

test('team fee expiration rechecks admin access immediately before Stripe invalidation', async () => {
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
    await mod.createStripeTeamFeeCheckout(request, authContext);
    stripeState.checkoutRetrieveHook = async () => {
        stripeState.checkoutRetrieveHook = null;
        await firestore.doc('teams/team-fee').set({ ownerId: 'departed-owner' }, { merge: true });
    };

    await assert.rejects(mod.expireStripeTeamFeeCheckout(request, authContext), /access changed before the fee checkout could be expired/i);
    assert.deepEqual(stripeState.expiredSessionIds, []);
    assert.equal(firestore.snapshot(recipientPath).checkoutStatus, 'open');
});

test('team fee failed-checkout recovery rechecks admin access before expiring replayed authority', async () => {
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
    let firstCreate = true;
    stripeState.checkoutCreateHook = async () => {
        if (!firstCreate) return;
        firstCreate = false;
        throw new Error('Injected fee creation failure.');
    };
    await assert.rejects(mod.createStripeTeamFeeCheckout(request, authContext), /Injected fee creation failure/);
    stripeState.checkoutCreateHook = async () => {
        stripeState.checkoutCreateHook = null;
        await firestore.doc('teams/team-fee').set({ ownerId: 'departed-owner' }, { merge: true });
    };

    await assert.rejects(mod.expireStripeTeamFeeCheckout(request, authContext), /access changed before the recovered fee checkout could be expired/i);
    assert.deepEqual(stripeState.expiredSessionIds, []);
    assert.equal(firestore.snapshot(recipientPath).checkoutStatus, 'creation_failed');
});

test('idempotent team fee replay classifies an expired Session before allowing a fresh attempt', async () => {
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
    let injected = false;
    stripeState.checkoutCreateHook = async ({ payload, options }) => {
        if (injected) return;
        injected = true;
        const response = {
            id: 'cs_team_fee_expired_replay', url: 'https://stripe.test/checkout/expired',
            payment_status: 'unpaid', status: 'expired', livemode: false,
            metadata: clone(payload.metadata), amount_total: 7500, currency: 'usd'
        };
        stripeState.checkoutResponses.set(response.id, clone(response));
        stripeState.checkoutResponsesByIdempotencyKey.set(options.idempotencyKey, clone(response));
        throw new Error('Injected post-Stripe failure.');
    };
    await assert.rejects(mod.createStripeTeamFeeCheckout(request, authContext), /Injected post-Stripe failure/);
    await assert.rejects(mod.createStripeTeamFeeCheckout(request, authContext), /replayed fee checkout expired/i);
    assert.equal(firestore.snapshot(recipientPath).checkoutStatus, 'stale');

    stripeState.checkoutCreateHook = null;
    const fresh = await mod.createStripeTeamFeeCheckout(request, authContext);

    assert.notEqual(fresh.sessionId, 'cs_team_fee_expired_replay');
    assert.notEqual(stripeState.checkoutSessionOptions[2].idempotencyKey, stripeState.checkoutSessionOptions[1].idempotencyKey);
    assert.equal(firestore.snapshot(recipientPath).checkoutStatus, 'open');
});

test('team fee checkout revalidates and replaces an expired stored Stripe URL', async () => {
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
    stripeState.checkoutResponses.get(first.sessionId).status = 'expired';

    const second = await mod.createStripeTeamFeeCheckout(request, authContext);

    assert.notEqual(second.sessionId, first.sessionId);
    assert.equal(stripeState.checkoutSessions.length, 2);
    assert.equal(firestore.snapshot(recipientPath).stripeCheckoutSessionId, second.sessionId);
});

test('team fee reversal expires a superseded live Checkout before creating current authority', async () => {
    const recipientPath = 'teams/team-fee/feeBatches/batch-1/feeRecipients/recipient-1';
    const checkoutAttemptToken = 'tok_team_fee_superseded_123456';
    const openSession = {
        id: 'cs_team_fee_superseded', url: 'https://stripe.test/checkout/superseded',
        mode: 'payment', status: 'open', payment_status: 'unpaid', amount_total: 5000,
        currency: 'usd', livemode: false,
        metadata: {
            product: 'team_fee', teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
            payerUid: 'owner-1', checkoutAttemptToken, checkoutAmountCents: '5000'
        }
    };
    const charge = {
        id: 'ch_team_fee_prior_paid', object: 'charge', payment_intent: 'pi_team_fee_prior_paid',
        amount: 5000, amount_refunded: 0, currency: 'usd', livemode: false,
        metadata: { product: 'team_fee', teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1' }
    };
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-fee': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' },
        [recipientPath]: {
            teamId: 'team-fee', batchId: 'batch-1', collectionMode: 'online_stripe',
            amountCents: 10000, paidAmountCents: 5000, amountPaidCents: 5000,
            balanceDueCents: 5000, status: 'partial', paymentProvider: 'stripe',
            stripeGrossPaidAmountCents: 5000, stripeRefundedAmountCents: 0,
            stripeDisputeLostAmountCents: 0, stripeRefundableAmountCents: 5000,
            stripeFinancialStatus: 'paid', checkoutStatus: 'open',
            stripeCheckoutSessionId: openSession.id, checkoutAttemptToken,
            checkoutPayerUid: 'owner-1', checkoutAmountCents: 5000,
            checkoutCurrency: 'usd', checkoutUrl: openSession.url, livemode: false,
            feeTitle: 'Tournament fee', playerName: 'Sam'
        },
        [`${recipientPath}/stripeCharges/${charge.id}`]: {
            type: 'stripe_charge', provider: 'stripe', product: 'team_fee',
            teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
            stripeCheckoutSessionId: 'cs_team_fee_prior_paid',
            stripePaymentIntentId: charge.payment_intent, stripeChargeId: charge.id,
            amountPaidCents: 5000, refundedAmountCents: 0, disputeLostAmountCents: 0,
            refundableAmountCents: 5000, disputeStatus: 'none', currency: 'usd', livemode: false
        }
    });
    stripeState.checkoutResponses.set(openSession.id, clone(openSession));
    stripeState.charges.set(charge.id, clone(charge));
    stripeState.webhookEvent = {
        id: 'evt_team_fee_prior_charge_refunded', type: 'charge.refunded', created: 200,
        data: { object: { ...clone(charge), amount_refunded: 1000 } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(recipientPath).checkoutStatus, 'stale');
    assert.equal(firestore.snapshot(recipientPath).balanceDueCents, 6000);

    const replacement = await mod.createStripeTeamFeeCheckout({
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });

    assert.deepEqual(stripeState.expiredSessionIds, [openSession.id]);
    assert.notEqual(replacement.sessionId, openSession.id);
    assert.equal(stripeState.checkoutSessions.at(-1).line_items[0].price_data.unit_amount, 6000);
    assert.equal(firestore.snapshot(recipientPath).stripeCheckoutSessionId, replacement.sessionId);
});

test('team fee webhook reconciles charge refunds through its server-owned charge ledger', async () => {
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
    const checkout = await mod.createStripeTeamFeeCheckout({
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    stripeState.webhookEvent = {
        id: 'evt_team_fee_paid', type: 'checkout.session.completed', created: 100,
        data: { object: { ...clone(session), payment_status: 'paid', payment_intent: 'pi_team_fee_paid' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(recipientPath).stripeRefundableAmountCents, 7500);

    const charge = stripeState.charges.get('ch_pi_team_fee_paid');
    stripeState.webhookEvent = {
        id: 'evt_team_fee_refund', type: 'charge.refunded', created: 200,
        data: { object: { ...clone(charge), amount_refunded: 2500 } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const recipient = firestore.snapshot(recipientPath);
    assert.equal(recipient.paidAmountCents, 5000);
    assert.equal(recipient.balanceDueCents, 2500);
    assert.equal(recipient.stripeRefundedAmountCents, 2500);
    assert.equal(recipient.stripeRefundableAmountCents, 5000);
    assert.equal(firestore.snapshot(`${recipientPath}/stripeCharges/ch_pi_team_fee_paid`).refundedAmountCents, 2500);
});

test('team fee paid webhook cannot mask an open dispute on a sibling charge', async () => {
    const recipientPath = 'teams/team-fee/feeBatches/batch-1/feeRecipients/recipient-1';
    const checkoutAttemptToken = 'tok_team_fee_sibling_dispute_123456';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        [recipientPath]: {
            id: 'recipient-1', teamId: 'team-fee', batchId: 'batch-1', collectionMode: 'online_stripe',
            amountCents: 10000, paidAmountCents: 5000, amountPaidCents: 5000,
            balanceDueCents: 5000, status: 'partial', paymentProvider: 'stripe',
            stripeGrossPaidAmountCents: 5000, stripeRefundedAmountCents: 0,
            stripeDisputeLostAmountCents: 0, stripeRefundableAmountCents: 5000,
            stripeFinancialStatus: 'disputed', checkoutStatus: 'open',
            stripeCheckoutSessionId: 'cs_team_fee_second_paid', checkoutAttemptToken,
            checkoutPayerUid: 'owner-1', checkoutAmountCents: 5000,
            checkoutCurrency: 'usd', checkoutUrl: 'https://stripe.test/second', livemode: false
        },
        [`${recipientPath}/stripeCharges/ch_team_fee_disputed`]: {
            type: 'stripe_charge', provider: 'stripe', product: 'team_fee',
            teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
            stripeCheckoutSessionId: 'cs_team_fee_first_paid',
            stripePaymentIntentId: 'pi_team_fee_disputed', stripeChargeId: 'ch_team_fee_disputed',
            amountPaidCents: 5000, refundedAmountCents: 0, disputeLostAmountCents: 0,
            refundableAmountCents: 5000, disputeStatus: 'open', disputeEventCreated: 100,
            currency: 'usd', livemode: false
        }
    });
    stripeState.webhookEvent = {
        id: 'evt_team_fee_second_paid_with_sibling_dispute', type: 'checkout.session.completed', created: 200,
        data: { object: {
            id: 'cs_team_fee_second_paid', mode: 'payment', status: 'complete', payment_status: 'paid',
            payment_intent: 'pi_team_fee_second_paid', amount_total: 5000, currency: 'usd', livemode: false,
            metadata: {
                product: 'team_fee', teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
                payerUid: 'owner-1', checkoutAttemptToken, checkoutAmountCents: '5000'
            }
        } }
    };

    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const recipient = firestore.snapshot(recipientPath);
    assert.equal(recipient.status, 'paid');
    assert.equal(recipient.stripeFinancialStatus, 'disputed');
    assert.equal(recipient.stripeGrossPaidAmountCents, 10000);
    assert.equal(recipient.stripeRefundedAmountCents, 0);
    assert.equal(recipient.stripeDisputeLostAmountCents, 0);
    assert.equal(recipient.stripeRefundableAmountCents, 10000);
    assert.equal(firestore.snapshot(`${recipientPath}/stripeCharges/ch_pi_team_fee_second_paid`).disputeStatus, 'none');
});

test('team fee aggregate financial status preserves an open dispute on another charge', async () => {
    const recipientPath = 'teams/team-fee/feeBatches/batch-1/feeRecipients/recipient-1';
    const commonLedger = {
        type: 'stripe_charge', provider: 'stripe', product: 'team_fee',
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
        amountPaidCents: 5000, refundedAmountCents: 0, disputeLostAmountCents: 0,
        refundableAmountCents: 5000, currency: 'usd', livemode: false
    };
    const { firestore, stripeState, mod } = loadFunctionsModule({
        [recipientPath]: {
            id: 'recipient-1', teamId: 'team-fee', batchId: 'batch-1', amountCents: 10000,
            paidAmountCents: 10000, amountPaidCents: 10000, balanceDueCents: 0,
            status: 'paid', stripeGrossPaidAmountCents: 10000,
            stripeRefundedAmountCents: 0, stripeDisputeLostAmountCents: 0,
            stripeRefundableAmountCents: 10000, stripeFinancialStatus: 'disputed'
        },
        [`${recipientPath}/stripeCharges/ch_disputed`]: {
            ...commonLedger, stripeCheckoutSessionId: 'cs_disputed',
            stripePaymentIntentId: 'pi_disputed', stripeChargeId: 'ch_disputed',
            disputeStatus: 'open', disputeEventCreated: 100
        },
        [`${recipientPath}/stripeCharges/ch_refunded`]: {
            ...commonLedger, stripeCheckoutSessionId: 'cs_refunded',
            stripePaymentIntentId: 'pi_refunded', stripeChargeId: 'ch_refunded',
            disputeStatus: 'none', disputeEventCreated: 0
        }
    });
    stripeState.webhookEvent = {
        id: 'evt_second_charge_partial_refund', type: 'charge.refunded', created: 200,
        data: { object: {
            object: 'charge', id: 'ch_refunded', payment_intent: 'pi_refunded',
            amount: 5000, amount_refunded: 1000, currency: 'usd', livemode: false,
            metadata: { product: 'team_fee', teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1' }
        } }
    };

    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const recipient = firestore.snapshot(recipientPath);
    assert.equal(recipient.stripeFinancialStatus, 'disputed');
    assert.equal(recipient.stripeGrossPaidAmountCents, 10000);
    assert.equal(recipient.stripeRefundedAmountCents, 1000);
    assert.equal(recipient.stripeDisputeLostAmountCents, 0);
    assert.equal(recipient.stripeRefundableAmountCents, 9000);
    assert.equal(recipient.paidAmountCents, 9000);
    assert.equal(recipient.balanceDueCents, 1000);
});

test('legacy team fee checkout with empty PaymentIntent metadata is still credited from exact Session authority', async () => {
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
    const checkout = await mod.createStripeTeamFeeCheckout({
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    await firestore.doc(recipientPath).set({
        stripePaymentAuthorityVersion: firestore.FieldValue.delete(),
        checkoutCurrency: firestore.FieldValue.delete(),
        livemode: firestore.FieldValue.delete(),
        checkoutPayerUid: firestore.FieldValue.delete()
    }, { merge: true });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    stripeState.paymentIntents.set('pi_team_fee_legacy', {
        id: 'pi_team_fee_legacy', latest_charge: 'ch_team_fee_legacy', amount_received: 7500,
        currency: 'usd', livemode: false, metadata: {}
    });
    stripeState.charges.set('ch_team_fee_legacy', {
        id: 'ch_team_fee_legacy', object: 'charge', metadata: {}, payment_intent: 'pi_team_fee_legacy',
        amount: 7500, amount_refunded: 0, currency: 'usd', livemode: false
    });
    stripeState.webhookEvent = {
        id: 'evt_team_fee_legacy_paid', type: 'checkout.session.completed', created: 100,
        data: { object: { ...clone(session), payment_status: 'paid', payment_intent: 'pi_team_fee_legacy' } }
    };

    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const recipient = firestore.snapshot(recipientPath);
    assert.equal(recipient.status, 'paid');
    assert.equal(recipient.paidAmountCents, 7500);
    assert.equal(recipient.balanceDueCents, 0);
    assert.equal(firestore.snapshot(`${recipientPath}/stripeCharges/ch_team_fee_legacy`).stripePaymentIntentId, 'pi_team_fee_legacy');
    assert.equal(firestore.snapshot('stripeEvents/evt_team_fee_legacy_paid').ignored, false);

    stripeState.webhookEvent = {
        id: 'evt_team_fee_legacy_refund', type: 'charge.refunded', created: 200,
        data: { object: {
            id: 'ch_team_fee_legacy', object: 'charge', metadata: {}, payment_intent: 'pi_team_fee_legacy',
            amount: 7500, amount_refunded: 2500, currency: 'usd', livemode: false
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(recipientPath).paidAmountCents, 5000);
    assert.equal(firestore.snapshot(`${recipientPath}/stripeCharges/ch_team_fee_legacy`).refundedAmountCents, 2500);
});

test('team fee settlement stages exact Charge authority until an earlier dispute can bind', async () => {
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
    const checkout = await mod.createStripeTeamFeeCheckout({
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    await firestore.doc(recipientPath).set({
        stripePaymentAuthorityVersion: firestore.FieldValue.delete()
    }, { merge: true });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    session.payment_intent = 'pi_team_fee_empty_metadata';
    stripeState.checkoutResponses.set(session.id, session);
    stripeState.paymentIntents.set('pi_team_fee_empty_metadata', {
        id: 'pi_team_fee_empty_metadata', latest_charge: 'ch_team_fee_empty_metadata',
        amount_received: 7500, currency: 'usd', livemode: false, metadata: {}
    });
    const charge = {
        object: 'charge', id: 'ch_team_fee_empty_metadata', metadata: {},
        payment_intent: 'pi_team_fee_empty_metadata', amount: 7500, amount_refunded: 0,
        currency: 'usd', livemode: false, disputed: true
    };
    stripeState.charges.set(charge.id, charge);
    const reversalEvent = {
        id: 'evt_team_fee_empty_metadata_dispute', type: 'charge.dispute.created', created: 200,
        data: { object: { object: 'dispute', id: 'dp_team_fee_empty_metadata', charge: charge.id, status: 'needs_response' } }
    };

    stripeState.webhookEvent = reversalEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    assert.equal(firestore.snapshot(`stripeEvents/${reversalEvent.id}`), undefined);

    stripeState.webhookEvent = {
        id: 'evt_team_fee_paid_before_empty_metadata_retry', type: 'checkout.session.completed', created: 100,
        data: { object: { ...clone(session), status: 'complete', payment_status: 'paid' } }
    };
    stripeState.charges.set(charge.id, { ...charge, payment_intent: 'pi_wrong_team_fee' });
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    assert.equal(firestore.snapshot(`${recipientPath}/stripeCharges/${charge.id}`), undefined);
    stripeState.charges.set(charge.id, charge);
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    assert.equal(firestore.snapshot(recipientPath).status, 'unpaid');
    assert.equal(firestore.snapshot(`stripeEvents/evt_team_fee_paid_before_empty_metadata_retry`), undefined);
    assert.equal(firestore.snapshot(`${recipientPath}/stripeCharges/${charge.id}`).settlementProjected, false);
    stripeState.webhookEvent = reversalEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(
        firestore.snapshot(`${recipientPath}/stripeCharges/${charge.id}`).lastStripeEventId,
        reversalEvent.id
    );
    stripeState.webhookEvent = {
        id: 'evt_team_fee_paid_before_empty_metadata_retry', type: 'checkout.session.completed', created: 100,
        data: { object: { ...clone(session), status: 'complete', payment_status: 'paid' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(recipientPath).stripeFinancialStatus, 'disputed');
    assert.equal(firestore.snapshot(`${recipientPath}/stripeCharges/${charge.id}`).settlementProjected, true);

    stripeState.charges.set(charge.id, { ...charge, disputed: false });
    stripeState.webhookEvent = {
        id: 'evt_team_fee_empty_metadata_dispute_won', type: 'charge.dispute.closed', created: 300,
        data: { object: { object: 'dispute', id: 'dp_team_fee_empty_metadata', charge: charge.id, status: 'won' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(recipientPath).stripeFinancialStatus, 'paid');
    assert.equal(
        firestore.snapshot(`${recipientPath}/stripeCharges/${charge.id}`).lastStripeEventId,
        'evt_team_fee_empty_metadata_dispute_won'
    );

    const refundedCharge = { ...charge, amount_refunded: 7500, disputed: false };
    stripeState.charges.set(charge.id, refundedCharge);
    stripeState.webhookEvent = {
        id: 'evt_team_fee_empty_metadata_refund', type: 'charge.refunded', created: 400,
        data: { object: clone(refundedCharge) }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(recipientPath).stripeFinancialStatus, 'refunded');
    assert.equal(firestore.snapshot(recipientPath).paidAmountCents, 0);
    assert.equal(firestore.snapshot(`${recipientPath}/stripeCharges/${charge.id}`).refundedAmountCents, 7500);
    assert.equal(
        firestore.snapshot(`${recipientPath}/stripeCharges/${charge.id}`).lastStripeEventId,
        'evt_team_fee_empty_metadata_dispute_won'
    );
});

test('team fee settlement projects the latest cumulative Charge refund without temporary paid state', async () => {
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
    const checkout = await mod.createStripeTeamFeeCheckout({
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } });
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    const paymentIntentId = 'pi_team_fee_already_refunded';
    const chargeId = 'ch_team_fee_already_refunded';
    session.payment_intent = paymentIntentId;
    stripeState.paymentIntents.set(paymentIntentId, {
        id: paymentIntentId, latest_charge: chargeId, amount_received: 7500,
        currency: 'usd', livemode: false, metadata: clone(session.metadata)
    });
    stripeState.charges.set(chargeId, {
        id: chargeId, object: 'charge', payment_intent: paymentIntentId,
        amount: 7500, amount_refunded: 7500, currency: 'usd', livemode: false,
        disputed: false, metadata: clone(session.metadata)
    });
    stripeState.webhookEvent = {
        id: 'evt_team_fee_already_refunded_paid', type: 'checkout.session.completed', created: 200,
        data: { object: { ...clone(session), status: 'complete', payment_status: 'paid' } }
    };

    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const recipient = firestore.snapshot(recipientPath);
    assert.equal(recipient.status, 'unpaid');
    assert.equal(recipient.checkoutStatus, 'stale');
    assert.equal(recipient.paidAmountCents, 0);
    assert.equal(recipient.balanceDueCents, 7500);
    assert.equal(recipient.stripeFinancialStatus, 'refunded');
    assert.equal(firestore.snapshot(`${recipientPath}/stripeCharges/${chargeId}`).refundedAmountCents, 7500);
});

test('team fee refund callable records only the ledger delta when its webhook wins the race', async () => {
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
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };
    const checkout = await mod.createStripeTeamFeeCheckout({
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1'
    }, authContext);
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    stripeState.webhookEvent = {
        id: 'evt_team_fee_paid_before_refund_race', type: 'checkout.session.completed', created: 100,
        data: { object: { ...clone(session), payment_status: 'paid', payment_intent: 'pi_team_fee_refund_race' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    stripeState.refundCreateHook = async ({ payload }) => {
        const charge = stripeState.charges.get(payload.charge);
        charge.amount_refunded = payload.amount;
        stripeState.charges.set(charge.id, charge);
        stripeState.webhookEvent = {
            id: 'evt_team_fee_refund_won_race', type: 'charge.refunded', created: 200,
            data: { object: clone(charge) }
        };
        assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    };
    const request = {
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
        amountCents: 2500, refundRequestId: 'refund_webhook_race'
    };

    const result = await mod.refundStripeTeamFeePayment(request, authContext);

    assert.equal(result.status, 'succeeded');
    assert.equal(result.amountCents, 2500);
    const recipient = firestore.snapshot(recipientPath);
    assert.equal(recipient.paidAmountCents, 5000);
    assert.equal(recipient.balanceDueCents, 2500);
    assert.equal(recipient.stripeRefundedAmountCents, 2500);
    assert.equal(recipient.stripeRefundableAmountCents, 5000);
    const chargeLedger = firestore.snapshot(`${recipientPath}/stripeCharges/ch_pi_team_fee_refund_race`);
    assert.equal(chargeLedger.refundedAmountCents, 2500);
    assert.equal(chargeLedger.refundableAmountCents, 5000);
    assert.equal(chargeLedger.pendingRefundAmountCents, 0);
    const refundIntent = firestore.snapshot(`${recipientPath}/refundIntents/refund_webhook_race`);
    assert.equal(refundIntent.status, 'recorded');
    assert.deepEqual(refundIntent.refundIds, ['re_test_1']);
});

test('team fee refund reconciliation remains pure across a Firestore transaction retry', async () => {
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
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };
    const checkout = await mod.createStripeTeamFeeCheckout({
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1'
    }, authContext);
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    stripeState.webhookEvent = {
        id: 'evt_team_fee_paid_before_transaction_retry', type: 'checkout.session.completed', created: 100,
        data: { object: { ...clone(session), payment_status: 'paid', payment_intent: 'pi_team_fee_transaction_retry' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    stripeState.refundCreateHook = async () => {
        firestore.retryNextTransaction();
        stripeState.refundCreateHook = null;
    };
    const result = await mod.refundStripeTeamFeePayment({
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
        amountCents: 2500, refundRequestId: 'refund_transaction_retry'
    }, authContext);

    assert.equal(result.status, 'succeeded');
    assert.equal(stripeState.refundCalls.length, 1);
    const recipient = firestore.snapshot(recipientPath);
    assert.equal(recipient.paidAmountCents, 5000);
    assert.equal(recipient.stripeRefundedAmountCents, 2500);
    assert.equal(recipient.stripeRefundableAmountCents, 5000);
    const chargeLedger = firestore.snapshot(`${recipientPath}/stripeCharges/ch_pi_team_fee_transaction_retry`);
    assert.equal(chargeLedger.refundedAmountCents, 2500);
    assert.equal(chargeLedger.refundableAmountCents, 5000);
    assert.equal(chargeLedger.pendingRefundAmountCents, 0);
    assert.equal(firestore.snapshot(`${recipientPath}/refundIntents/refund_transaction_retry`).status, 'recorded');
});

test('team fee full refund retries after webhook reconciliation and a callable persistence crash', async () => {
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
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };
    const checkout = await mod.createStripeTeamFeeCheckout({
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1'
    }, authContext);
    const session = stripeState.checkoutResponses.get(checkout.sessionId);
    stripeState.webhookEvent = {
        id: 'evt_team_fee_paid_before_refund_crash', type: 'checkout.session.completed', created: 100,
        data: { object: { ...clone(session), payment_status: 'paid', payment_intent: 'pi_team_fee_refund_crash' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    stripeState.refundCreateHook = async ({ payload }) => {
        const charge = stripeState.charges.get(payload.charge);
        charge.amount_refunded = payload.amount;
        stripeState.charges.set(charge.id, charge);
        stripeState.webhookEvent = {
            id: 'evt_team_fee_refund_before_callable_crash', type: 'charge.refunded', created: 200,
            data: { object: clone(charge) }
        };
        assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
        firestore.failNextTransaction(new Error('Injected callable reconciliation failure.'));
        stripeState.refundCreateHook = null;
    };
    const request = {
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
        amountCents: 7500, refundRequestId: 'refund_webhook_crash'
    };

    await assert.rejects(mod.refundStripeTeamFeePayment(request, authContext), /Injected callable reconciliation failure\./);
    assert.equal(firestore.snapshot(recipientPath).stripeRefundableAmountCents, 0);
    assert.equal(firestore.snapshot(`${recipientPath}/refundIntents/refund_webhook_crash`).status, 'processing');

    const result = await mod.refundStripeTeamFeePayment(request, authContext);

    assert.equal(result.status, 'succeeded');
    assert.deepEqual(result.refundIds, ['re_test_1']);
    assert.equal(stripeState.refundCalls.length, 2);
    assert.deepEqual(stripeState.refundCalls[1], stripeState.refundCalls[0]);
    const recipient = firestore.snapshot(recipientPath);
    assert.equal(recipient.paidAmountCents, 0);
    assert.equal(recipient.stripeRefundedAmountCents, 7500);
    assert.equal(recipient.stripeRefundableAmountCents, 0);
    const chargeLedger = firestore.snapshot(`${recipientPath}/stripeCharges/ch_pi_team_fee_refund_crash`);
    assert.equal(chargeLedger.refundedAmountCents, 7500);
    assert.equal(chargeLedger.refundableAmountCents, 0);
    assert.equal(chargeLedger.pendingRefundAmountCents, 0);
    assert.equal(firestore.snapshot(`${recipientPath}/refundIntents/refund_webhook_crash`).status, 'recorded');
});

test('team fee refund rejects cross-recipient and divergent cumulative Stripe authority before creating a refund', async () => {
    const recipientPath = 'teams/team-fee/feeBatches/batch-1/feeRecipients/recipient-1';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-fee': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' },
        [recipientPath]: {
            teamId: 'team-fee', batchId: 'batch-1', paymentProvider: 'stripe',
            amountCents: 7500, paidAmountCents: 7500, balanceDueCents: 0,
            status: 'paid', livemode: false,
            stripeGrossPaidAmountCents: 7500,
            stripeRefundedAmountCents: 0,
            stripeRefundableAmountCents: 7500
        },
        [`${recipientPath}/stripeCharges/ch_team_fee`]: {
            type: 'stripe_charge', provider: 'stripe', product: 'team_fee',
            teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
            stripeCheckoutSessionId: 'cs_team_fee', stripePaymentIntentId: 'pi_team_fee', stripeChargeId: 'ch_team_fee',
            amountPaidCents: 7500, refundedAmountCents: 0, pendingRefundAmountCents: 0,
            refundableAmountCents: 7500, disputeStatus: 'none', currency: 'usd', livemode: false
        }
    });
    const charge = {
        id: 'ch_team_fee', object: 'charge', payment_intent: 'pi_team_fee',
        amount: 7500, amount_refunded: 0, currency: 'usd', livemode: false,
        metadata: { product: 'team_fee', teamId: 'victim-team', batchId: 'batch-1', recipientId: 'recipient-1' }
    };
    stripeState.charges.set(charge.id, charge);
    const request = {
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
        amountCents: 2500, refundRequestId: 'refund_authority_test'
    };
    const authContext = { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } };

    await assert.rejects(mod.refundStripeTeamFeePayment(request, authContext), /did not match this fee recipient/);
    assert.equal(stripeState.refundCalls.length, 0);

    charge.metadata.teamId = 'team-fee';
    stripeState.charges.set(charge.id, charge);
    await firestore.doc(`${recipientPath}/stripeCharges/ch_team_fee`).update({
        refundedAmountCents: 5000,
        refundableAmountCents: 2500
    });
    await firestore.doc(recipientPath).update({
        paidAmountCents: 2500,
        balanceDueCents: 5000,
        stripeRefundedAmountCents: 5000,
        stripeRefundableAmountCents: 2500
    });
    await assert.rejects(mod.refundStripeTeamFeePayment(request, authContext), /cumulative refund authority/);
    assert.equal(stripeState.refundCalls.length, 0);

    await firestore.doc(`${recipientPath}/stripeCharges/ch_team_fee`).update({
        refundedAmountCents: 0,
        refundableAmountCents: 7500
    });
    await firestore.doc(recipientPath).update({
        paidAmountCents: 7500,
        balanceDueCents: 0,
        stripeRefundedAmountCents: 0,
        stripeRefundableAmountCents: 7500
    });
    const result = await mod.refundStripeTeamFeePayment(request, authContext);
    assert.equal(result.amountCents, 2500);
    assert.equal(stripeState.refundCalls.length, 1);
    assert.equal(stripeState.refundCalls[0].payload.charge, 'ch_team_fee');
    assert.match(stripeState.refundCalls[0].options.idempotencyKey, /^team_fee_refund_/);
});

test('team fee refund transaction rechecks admin access before any Stripe refund side effect', async () => {
    const recipientPath = 'teams/team-fee/feeBatches/batch-1/feeRecipients/recipient-1';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-fee': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' },
        [recipientPath]: {
            teamId: 'team-fee', batchId: 'batch-1', paymentProvider: 'stripe',
            amountCents: 7500, paidAmountCents: 7500, balanceDueCents: 0,
            status: 'paid', livemode: false, stripeGrossPaidAmountCents: 7500,
            stripeRefundedAmountCents: 0, stripeDisputeLostAmountCents: 0,
            stripeRefundableAmountCents: 7500, stripeFinancialStatus: 'paid'
        },
        [`${recipientPath}/stripeCharges/ch_team_fee`]: {
            type: 'stripe_charge', provider: 'stripe', product: 'team_fee',
            teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
            stripeCheckoutSessionId: 'cs_team_fee', stripePaymentIntentId: 'pi_team_fee', stripeChargeId: 'ch_team_fee',
            amountPaidCents: 7500, refundedAmountCents: 0, disputeLostAmountCents: 0,
            pendingRefundAmountCents: 0, refundableAmountCents: 7500, disputeStatus: 'none',
            currency: 'usd', livemode: false
        }
    });
    stripeState.charges.set('ch_team_fee', {
        id: 'ch_team_fee', object: 'charge', payment_intent: 'pi_team_fee',
        amount: 7500, amount_refunded: 0, currency: 'usd', livemode: false,
        metadata: { product: 'team_fee', teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1' }
    });
    stripeState.chargeRetrieveHook = async () => {
        stripeState.chargeRetrieveHook = null;
        await firestore.doc('teams/team-fee').set({ ownerId: 'departed-owner' }, { merge: true });
    };

    await assert.rejects(mod.refundStripeTeamFeePayment({
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
        amountCents: 2500, refundRequestId: 'refund_revoked_admin'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } }), /access changed before the refund could be reserved/i);

    assert.deepEqual(stripeState.refundCalls, []);
    assert.equal(firestore.snapshot(`${recipientPath}/refundIntents/refund_revoked_admin`), undefined);
    assert.equal(firestore.snapshot(`${recipientPath}/stripeCharges/ch_team_fee`).pendingRefundAmountCents, 0);
});

test('team fee refund rechecks admin access after reservation and immediately before Stripe', async () => {
    const recipientPath = 'teams/team-fee/feeBatches/batch-1/feeRecipients/recipient-1';
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-fee': { ownerId: 'owner-1', adminEmails: [] },
        'users/owner-1': { email: 'owner@example.com' },
        [recipientPath]: {
            teamId: 'team-fee', batchId: 'batch-1', paymentProvider: 'stripe',
            amountCents: 7500, paidAmountCents: 7500, balanceDueCents: 0,
            status: 'paid', livemode: false, stripeGrossPaidAmountCents: 7500,
            stripeRefundedAmountCents: 0, stripeDisputeLostAmountCents: 0,
            stripeRefundableAmountCents: 7500, stripeFinancialStatus: 'paid'
        },
        [`${recipientPath}/stripeCharges/ch_team_fee`]: {
            type: 'stripe_charge', provider: 'stripe', product: 'team_fee',
            teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
            stripeCheckoutSessionId: 'cs_team_fee', stripePaymentIntentId: 'pi_team_fee', stripeChargeId: 'ch_team_fee',
            amountPaidCents: 7500, refundedAmountCents: 0, disputeLostAmountCents: 0,
            pendingRefundAmountCents: 0, refundableAmountCents: 7500, disputeStatus: 'none',
            currency: 'usd', livemode: false
        }
    });
    stripeState.charges.set('ch_team_fee', {
        id: 'ch_team_fee', object: 'charge', payment_intent: 'pi_team_fee',
        amount: 7500, amount_refunded: 0, currency: 'usd', livemode: false,
        metadata: { product: 'team_fee', teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1' }
    });
    stripeState.chargeRetrieveHook = async () => {
        stripeState.chargeRetrieveHook = null;
        firestore.afterNextGet('teams/team-fee', async () => {
            await firestore.doc('teams/team-fee').set({ ownerId: 'departed-owner' }, { merge: true });
        });
    };

    await assert.rejects(mod.refundStripeTeamFeePayment({
        teamId: 'team-fee', batchId: 'batch-1', recipientId: 'recipient-1',
        amountCents: 2500, refundRequestId: 'refund_revoked_after_reservation'
    }, { auth: { uid: 'owner-1', token: { email: 'owner@example.com' } } }), /access changed before Stripe could issue the refund/i);

    assert.deepEqual(stripeState.refundCalls, []);
    assert.equal(firestore.snapshot(`${recipientPath}/refundIntents/refund_revoked_after_reservation`).status, 'processing');
    assert.equal(firestore.snapshot(`${recipientPath}/stripeCharges/ch_team_fee`).pendingRefundAmountCents, 2500);
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

test('registration webhook reconciles refunds against the paid charge ledger', async () => {
    const { firestore, stripeState, mod, submission, registrationPath } = await createInstallmentCheckoutFixture();
    stripeState.webhookEvent = buildPaidInstallmentWebhookEvent({
        eventId: 'evt_installment_paid_for_refund',
        registrationId: submission.registrationId
    });
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const chargeId = 'ch_pi_evt_installment_paid_for_refund';
    const charge = stripeState.charges.get(chargeId);
    stripeState.webhookEvent = {
        id: 'evt_installment_partial_refund', type: 'charge.refunded', created: 200,
        data: { object: { ...clone(charge), amount_refunded: 2000 } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    const registration = firestore.snapshot(registrationPath);
    assert.equal(registration.paymentStatus, 'partially_refunded');
    assert.equal(registration.stripeRefundedAmountCents, 2000);
    assert.equal(registration.balanceDueCents, 10334);
    assert.equal(firestore.snapshot(`${registrationPath}/stripeCharges/${chargeId}`).refundedAmountCents, 2000);
});

test('registration reversal repayment charges only reopened debt without advancing installments', async () => {
    const { firestore, stripeState, mod, submission, registrationPath } = await createInstallmentCheckoutFixture();
    const firstCheckoutPayload = stripeState.checkoutSessions[0];
    stripeState.webhookEvent = buildPaidInstallmentWebhookEvent({
        eventId: 'evt_installment_paid_before_repayment', registrationId: submission.registrationId
    });
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const firstCharge = stripeState.charges.get('ch_pi_evt_installment_paid_before_repayment');
    stripeState.webhookEvent = {
        id: 'evt_installment_refund_for_repayment', type: 'charge.refunded', created: 200,
        data: { object: { ...clone(firstCharge), amount_refunded: 2000 } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const reversed = firestore.snapshot(registrationPath);
    assert.equal(reversed.paymentStatus, 'partially_refunded');
    assert.equal(reversed.stripeReversalBalanceCents, 2000);
    assert.equal(reversed.balanceDueCents, 10334);
    assert.equal(reversed.paymentPlan.paidInstallmentCount, 1);

    const repayment = await mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        publicCheckoutCapability: firstCheckoutPayload.metadata.publicCheckoutCapability
    });
    const repaymentPayload = stripeState.checkoutSessions[1];
    assert.equal(repaymentPayload.line_items[0].price_data.unit_amount, 2000);
    assert.equal(repaymentPayload.metadata.paymentPurpose, 'reversal_repayment');
    assert.equal(repaymentPayload.metadata.paymentPlanId, 'installments');

    const repaymentSession = stripeState.checkoutResponses.get(repayment.sessionId);
    stripeState.webhookEvent = {
        id: 'evt_installment_repayment_paid', type: 'checkout.session.completed', created: 300,
        data: { object: {
            ...clone(repaymentSession), status: 'complete', payment_status: 'paid',
            payment_intent: 'pi_installment_repayment_paid'
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const repaid = firestore.snapshot(registrationPath);
    assert.equal(repaid.paymentStatus, 'installment_in_progress');
    assert.equal(repaid.stripeReversalBalanceCents, 0);
    assert.equal(repaid.balanceDueCents, 8334);
    assert.equal(repaid.paymentPlan.paidInstallmentCount, 1);
    assert.equal(repaid.stripeGrossPaidAmountCents, 6166);

    await mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        publicCheckoutCapability: repaymentPayload.metadata.publicCheckoutCapability
    });
    const nextInstallmentPayload = stripeState.checkoutSessions[2];
    assert.equal(nextInstallmentPayload.line_items[0].price_data.unit_amount, 4166);
    assert.equal(nextInstallmentPayload.metadata.paymentPurpose, '');
});

test('registration checkout blocks unresolved disputes at preflight and transaction recheck', async () => {
    const { firestore, stripeState, mod, submission, registrationPath } = await createInstallmentCheckoutFixture();
    const checkoutCapability = stripeState.checkoutSessions[0].metadata.publicCheckoutCapability;
    stripeState.webhookEvent = buildPaidInstallmentWebhookEvent({
        eventId: 'evt_installment_paid_before_dispute', registrationId: submission.registrationId
    });
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const chargeId = 'ch_pi_evt_installment_paid_before_dispute';
    stripeState.webhookEvent = {
        id: 'evt_installment_dispute_open', type: 'charge.dispute.created', created: 200,
        data: { object: { object: 'dispute', id: 'dp_registration_open', charge: chargeId, status: 'needs_response' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(registrationPath).paymentStatus, 'disputed');
    await assert.rejects(mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        publicCheckoutCapability: checkoutCapability
    }), /payment is disputed/i);
    assert.equal(stripeState.checkoutSessions.length, 1);

    await firestore.doc(registrationPath).set({
        paymentStatus: 'partially_refunded', stripeFinancialStatus: 'partially_refunded',
        stripeReversalBalanceCents: 1000, balanceDueCents: 9334
    }, { merge: true });
    firestore.afterNextGet(registrationPath, async () => {
        await firestore.doc(registrationPath).set({
            paymentStatus: 'disputed', stripeFinancialStatus: 'disputed'
        }, { merge: true });
    });
    await assert.rejects(mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        publicCheckoutCapability: checkoutCapability
    }), /payment is disputed/i);
    assert.equal(stripeState.checkoutSessions.length, 1);
});

test('registration paid webhook preserves a sibling dispute and refreshes the operational baseline', async () => {
    const { firestore, stripeState, mod, submission, registrationPath } = await createInstallmentCheckoutFixture();
    const checkoutCapability = stripeState.checkoutSessions[0].metadata.publicCheckoutCapability;
    stripeState.webhookEvent = buildPaidInstallmentWebhookEvent({
        eventId: 'evt_installment_first_paid_before_second_session_dispute',
        registrationId: submission.registrationId
    });
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    await mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        publicCheckoutCapability: checkoutCapability
    });
    const secondSession = stripeState.checkoutResponses.get('cs_test_2');
    const currentCheckoutCapability = secondSession.metadata.publicCheckoutCapability;
    const firstChargeId = 'ch_pi_evt_installment_first_paid_before_second_session_dispute';
    stripeState.webhookEvent = {
        id: 'evt_installment_first_disputed_while_second_open', type: 'charge.dispute.created', created: 200,
        data: { object: { object: 'dispute', id: 'dp_registration_paid_race', charge: firstChargeId, status: 'needs_response' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(registrationPath).stripeFinancialStatus, 'disputed');

    stripeState.webhookEvent = {
        id: 'evt_installment_second_paid_after_sibling_dispute', type: 'checkout.session.completed', created: 250,
        data: { object: {
            ...clone(secondSession), status: 'complete', payment_status: 'paid',
            payment_intent: 'pi_evt_installment_second_paid_after_sibling_dispute'
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    const disputed = firestore.snapshot(registrationPath);
    assert.equal(disputed.checkoutStatus, 'complete');
    assert.equal(disputed.paymentPlan.paidInstallmentCount, 2);
    assert.equal(disputed.paymentStatus, 'disputed');
    assert.equal(disputed.paymentStatusBeforeStripeReversal, 'installment_in_progress');
    assert.equal(disputed.stripeFinancialStatus, 'disputed');
    assert.equal(disputed.stripeGrossPaidAmountCents, 8332);
    assert.equal(disputed.stripeRefundedAmountCents, 0);
    assert.equal(disputed.stripeDisputeLostAmountCents, 0);
    assert.equal(
        firestore.snapshot(`${registrationPath}/stripeCharges/ch_pi_evt_installment_second_paid_after_sibling_dispute`).disputeStatus,
        'none'
    );
    await assert.rejects(mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        publicCheckoutCapability: currentCheckoutCapability
    }), /payment is disputed/i);
    assert.equal(stripeState.checkoutSessions.length, 2);

    stripeState.webhookEvent = {
        id: 'evt_installment_first_dispute_won_after_second_paid', type: 'charge.dispute.closed', created: 300,
        data: { object: { object: 'dispute', id: 'dp_registration_paid_race', charge: firstChargeId, status: 'won' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const resolved = firestore.snapshot(registrationPath);
    assert.equal(resolved.paymentStatus, 'installment_in_progress');
    assert.equal(resolved.stripeFinancialStatus, 'paid');
});

test('registration refund on another installment cannot clear an open dispute', async () => {
    const { firestore, stripeState, mod, submission, registrationPath } = await createInstallmentCheckoutFixture();
    const checkoutCapability = stripeState.checkoutSessions[0].metadata.publicCheckoutCapability;
    stripeState.webhookEvent = buildPaidInstallmentWebhookEvent({
        eventId: 'evt_installment_first_paid_for_cross_charge_dispute',
        registrationId: submission.registrationId
    });
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    await mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        publicCheckoutCapability: checkoutCapability
    });
    const currentCheckoutCapability = stripeState.checkoutSessions[1].metadata.publicCheckoutCapability;
    const secondSession = stripeState.checkoutResponses.get('cs_test_2');
    stripeState.webhookEvent = {
        id: 'evt_installment_second_paid_for_cross_charge_refund', type: 'checkout.session.completed', created: 150,
        data: { object: {
            ...clone(secondSession), status: 'complete', payment_status: 'paid',
            payment_intent: 'pi_evt_installment_second_paid_for_cross_charge_refund'
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    const firstChargeId = 'ch_pi_evt_installment_first_paid_for_cross_charge_dispute';
    stripeState.webhookEvent = {
        id: 'evt_installment_first_charge_dispute_open', type: 'charge.dispute.created', created: 200,
        data: { object: { object: 'dispute', id: 'dp_registration_cross_charge', charge: firstChargeId, status: 'needs_response' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(registrationPath).stripeFinancialStatus, 'disputed');

    const secondChargeId = 'ch_pi_evt_installment_second_paid_for_cross_charge_refund';
    const secondCharge = stripeState.charges.get(secondChargeId);
    stripeState.webhookEvent = {
        id: 'evt_installment_second_charge_refunded', type: 'charge.refunded', created: 300,
        data: { object: { ...clone(secondCharge), amount_refunded: 1000 } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    const registration = firestore.snapshot(registrationPath);
    assert.equal(registration.paymentStatus, 'disputed');
    assert.equal(registration.stripeFinancialStatus, 'disputed');
    assert.equal(registration.stripeGrossPaidAmountCents, 8332);
    assert.equal(registration.stripeRefundedAmountCents, 1000);
    assert.equal(registration.stripeDisputeLostAmountCents, 0);
    await assert.rejects(mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        publicCheckoutCapability: currentCheckoutCapability
    }), /payment is disputed/i);
    assert.equal(stripeState.checkoutSessions.length, 2);
});

test('registration dispute loss reopens exactly the lost charge for repayment', async () => {
    const { firestore, stripeState, mod, submission, registrationPath } = await createInstallmentCheckoutFixture();
    const checkoutCapability = stripeState.checkoutSessions[0].metadata.publicCheckoutCapability;
    stripeState.webhookEvent = buildPaidInstallmentWebhookEvent({
        eventId: 'evt_installment_paid_before_dispute_loss', registrationId: submission.registrationId
    });
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const chargeId = 'ch_pi_evt_installment_paid_before_dispute_loss';
    stripeState.webhookEvent = {
        id: 'evt_installment_dispute_lost', type: 'charge.dispute.closed', created: 200,
        data: { object: { object: 'dispute', id: 'dp_registration_lost', charge: chargeId, status: 'lost' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const lost = firestore.snapshot(registrationPath);
    assert.equal(lost.paymentStatus, 'dispute_lost');
    assert.equal(lost.stripeReversalBalanceCents, 4166);
    assert.equal(lost.balanceDueCents, 12500);
    assert.equal(lost.paymentPlan.paidInstallmentCount, 1);

    await mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        publicCheckoutCapability: checkoutCapability
    });
    const repaymentPayload = stripeState.checkoutSessions[1];
    assert.equal(repaymentPayload.line_items[0].price_data.unit_amount, 4166);
    assert.equal(repaymentPayload.metadata.paymentPurpose, 'reversal_repayment');
});

test('legacy registration checkout with empty PaymentIntent metadata is still credited from exact Session authority', async () => {
    const { firestore, stripeState, mod, submission, registrationPath } = await createInstallmentCheckoutFixture();
    await firestore.doc(registrationPath).set({
        stripePaymentAuthorityVersion: firestore.FieldValue.delete()
    }, { merge: true });
    stripeState.paymentIntents.set('pi_registration_legacy', {
        id: 'pi_registration_legacy', latest_charge: 'ch_registration_legacy', amount_received: 4166,
        currency: 'usd', livemode: false, metadata: {}
    });
    stripeState.charges.set('ch_registration_legacy', {
        id: 'ch_registration_legacy', object: 'charge', metadata: {}, payment_intent: 'pi_registration_legacy',
        amount: 4166, amount_refunded: 0, currency: 'usd', livemode: false
    });
    stripeState.webhookEvent = {
        id: 'evt_registration_legacy_paid', type: 'checkout.session.completed', created: 100,
        data: { object: {
            ...buildPaidInstallmentWebhookEvent({
                eventId: 'evt_registration_legacy_paid', registrationId: submission.registrationId
            }).data.object,
            payment_intent: 'pi_registration_legacy'
        } }
    };

    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    const registration = firestore.snapshot(registrationPath);
    assert.equal(registration.paymentStatus, 'installment_in_progress');
    assert.equal(registration.paymentPlan.paidInstallmentCount, 1);
    assert.equal(firestore.snapshot(`${registrationPath}/stripeCharges/ch_registration_legacy`).stripePaymentIntentId, 'pi_registration_legacy');
    assert.equal(firestore.snapshot('stripeEvents/evt_registration_legacy_paid').ignored, undefined);

    stripeState.webhookEvent = {
        id: 'evt_registration_legacy_refund', type: 'charge.refunded', created: 200,
        data: { object: {
            id: 'ch_registration_legacy', object: 'charge', metadata: {}, payment_intent: 'pi_registration_legacy',
            amount: 4166, amount_refunded: 1000, currency: 'usd', livemode: false
        } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(registrationPath).stripeRefundedAmountCents, 1000);
    assert.equal(firestore.snapshot(`${registrationPath}/stripeCharges/ch_registration_legacy`).refundedAmountCents, 1000);
});

test('empty-metadata registration refund retries after paid webhook creates the exact charge ledger', async () => {
    const { firestore, stripeState, mod, registrationPath } = await createInstallmentCheckoutFixture();
    await firestore.doc(registrationPath).set({
        stripePaymentAuthorityVersion: firestore.FieldValue.delete()
    }, { merge: true });
    const session = stripeState.checkoutResponses.get('cs_test_1');
    session.payment_intent = 'pi_registration_empty_metadata';
    stripeState.checkoutResponses.set(session.id, session);
    stripeState.paymentIntents.set('pi_registration_empty_metadata', {
        id: 'pi_registration_empty_metadata', latest_charge: 'ch_registration_empty_metadata',
        amount_received: 4166, currency: 'usd', livemode: false, metadata: {}
    });
    const charge = {
        object: 'charge', id: 'ch_registration_empty_metadata', metadata: {},
        payment_intent: 'pi_registration_empty_metadata', amount: 4166, amount_refunded: 4166,
        currency: 'usd', livemode: false
    };
    stripeState.charges.set(charge.id, charge);
    const reversalEvent = {
        id: 'evt_registration_empty_metadata_refund', type: 'charge.refunded', created: 200,
        data: { object: clone(charge) }
    };

    stripeState.webhookEvent = reversalEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    assert.equal(firestore.snapshot(`stripeEvents/${reversalEvent.id}`), undefined);

    stripeState.webhookEvent = {
        id: 'evt_registration_paid_before_empty_metadata_retry', type: 'checkout.session.completed', created: 100,
        data: { object: { ...clone(session), status: 'complete', payment_status: 'paid' } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(registrationPath).paymentPlan.paidInstallmentCount, 1);
    assert.equal(firestore.snapshot(registrationPath).paymentStatus, 'refunded');
    assert.equal(firestore.snapshot(registrationPath).stripeReversalBalanceCents, 4166);
    assert.equal(firestore.snapshot(`${registrationPath}/stripeCharges/${charge.id}`).refundedAmountCents, 4166);
    stripeState.webhookEvent = reversalEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(registrationPath).paymentStatus, 'refunded');
    assert.equal(firestore.snapshot(registrationPath).stripeReversalBalanceCents, 4166);
    assert.equal(firestore.snapshot(`${registrationPath}/stripeCharges/${charge.id}`).refundedAmountCents, 4166);
    assert.equal(firestore.snapshot(`stripeEvents/${reversalEvent.id}`).ignored, false);
});

test('registration settlement stages exact Charge authority until an earlier dispute can bind', async () => {
    const { firestore, stripeState, mod, submission, registrationPath } = await createInstallmentCheckoutFixture();
    const paidEvent = buildPaidInstallmentWebhookEvent({
        eventId: 'evt_registration_disputed_before_paid',
        registrationId: submission.registrationId
    });
    const session = paidEvent.data.object;
    const paymentIntentId = session.payment_intent;
    const chargeId = `ch_${paymentIntentId}`;
    stripeState.paymentIntents.set(paymentIntentId, {
        id: paymentIntentId,
        latest_charge: chargeId,
        amount_received: 4166,
        currency: 'usd',
        livemode: false,
        metadata: clone(session.metadata)
    });
    const charge = {
        id: chargeId,
        object: 'charge',
        payment_intent: paymentIntentId,
        amount: 4166,
        amount_refunded: 0,
        currency: 'usd',
        livemode: false,
        disputed: true,
        metadata: clone(session.metadata)
    };
    stripeState.charges.set(chargeId, charge);
    const disputeEvent = {
        id: 'evt_registration_dispute_created_first',
        type: 'charge.dispute.created',
        created: 200,
        data: { object: { object: 'dispute', id: 'dp_registration_first', charge: chargeId, status: 'needs_response' } }
    };

    stripeState.webhookEvent = disputeEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    stripeState.charges.set(chargeId, { ...charge, amount: 4165 });
    stripeState.webhookEvent = paidEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    assert.equal(firestore.snapshot(`${registrationPath}/stripeCharges/${chargeId}`), undefined);

    stripeState.charges.set(chargeId, charge);
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 500);
    assert.equal(Number(firestore.snapshot(registrationPath).paymentPlan.paidInstallmentCount || 0), 0);
    assert.equal(firestore.snapshot(`stripeEvents/${paidEvent.id}`), undefined);
    assert.equal(firestore.snapshot(`${registrationPath}/stripeCharges/${chargeId}`).settlementProjected, false);

    stripeState.webhookEvent = disputeEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(registrationPath).paymentStatus, 'disputed');
    stripeState.webhookEvent = paidEvent;
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(registrationPath).paymentStatus, 'disputed');
    assert.equal(firestore.snapshot(registrationPath).paymentPlan.paidInstallmentCount, 1);
    assert.equal(firestore.snapshot(`${registrationPath}/stripeCharges/${chargeId}`).settlementProjected, true);
    assert.equal(firestore.snapshot(`stripeEvents/${paidEvent.id}`).type, 'checkout.session.completed');
});

test('registration paid webhook recovers an exact durable reservation when the Stripe response was not projected', async () => {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-recovery';
    const reservationPath = `${registrationPath}/checkoutReservations/res-recovery`;
    const metadata = {
        product: 'registration', teamId: 'team-1', formId: 'form-1', registrationId: 'reg-recovery',
        checkoutAttemptToken: 'checkouttoken123456', publicCheckoutCapability: 'public_capability_12345678901234567890'
    };
    const { firestore, stripeState, mod } = loadFunctionsModule({
        'teams/team-1/registrationForms/form-1': {
            published: true, feeAmountCents: 5000, currency: 'usd',
            paymentSettings: { onlineCheckoutEnabled: true },
            registrationOptionCounts: { u10: { enrolled: 1, waitlisted: 0 } }
        },
        [registrationPath]: {
            id: 'reg-recovery', teamId: 'team-1', formId: 'form-1', status: 'pending',
            registrationCapacityReleased: false, checkoutCreationReservationId: 'res-recovery',
            checkoutAttemptToken: 'checkouttoken123456', feeSnapshot: { finalAmountDueCents: 5000 },
            selectedOption: { id: 'u10', countKey: 'u10', capacityLimit: 5 }
        },
        [reservationPath]: {
            teamId: 'team-1', formId: 'form-1', registrationId: 'reg-recovery', reservationId: 'res-recovery',
            status: 'creation_failed', issuedCheckoutAttemptToken: 'checkouttoken123456',
            issuedPublicCheckoutCapability: metadata.publicCheckoutCapability,
            amountCents: 5000, currency: 'usd', livemode: false,
            stripeIdempotencyKey: 'registration_checkout_recovery',
            stripeRequest: { metadata }
        }
    });
    stripeState.webhookEvent = {
        id: 'evt_registration_recovered_paid', type: 'checkout.session.completed', created: 200,
        data: { object: {
            id: 'cs_registration_recovered', payment_status: 'paid', payment_intent: 'pi_registration_recovered',
            amount_total: 5000, currency: 'usd', livemode: false, metadata
        } }
    };

    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    assert.equal(firestore.snapshot(registrationPath).paymentStatus, 'paid');
    assert.equal(firestore.snapshot(registrationPath).stripeCheckoutSessionId, 'cs_registration_recovered');
    assert.equal(firestore.snapshot(reservationPath).status, 'paid');
    assert.equal(firestore.snapshot(`${registrationPath}/stripeCharges/ch_pi_registration_recovered`).amountPaidCents, 5000);
});

test('registration checkout revalidates and replaces an expired stored Stripe URL', async () => {
    const { firestore, stripeState, mod } = loadFunctionsModule(buildSeedState({
        feeAmountCents: 7500,
        paymentSettings: { offlinePaymentEnabled: true, onlineCheckoutEnabled: true }
    }));
    const submission = await mod.submitPublicRegistration(buildSubmission({
        checkoutAttemptToken: 'checkouttoken123456'
    }), context);
    const request = {
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        checkoutAttemptToken: 'checkouttoken123456'
    };
    const first = await mod.createStripeRegistrationCheckout(request);
    const firstPayload = stripeState.checkoutSessions[0];
    stripeState.checkoutResponses.get(first.sessionId).status = 'expired';

    const second = await mod.createStripeRegistrationCheckout({
        ...request,
        publicCheckoutCapability: firstPayload.metadata.publicCheckoutCapability
    });

    assert.notEqual(second.sessionId, first.sessionId);
    assert.equal(stripeState.checkoutSessions.length, 2);
    const registrationPath = `teams/team-1/registrationForms/form-1/registrations/${submission.registrationId}`;
    assert.equal(firestore.snapshot(registrationPath).stripeCheckoutSessionId, second.sessionId);
});

test('registration browser cancellation preserves capacity for later installments and reversal repayment', async () => {
    const { firestore, stripeState, mod, submission, registrationPath } = await createInstallmentCheckoutFixture();
    stripeState.webhookEvent = buildPaidInstallmentWebhookEvent({
        eventId: 'evt_installment_paid_before_browser_cancels', registrationId: submission.registrationId
    });
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);
    let checkoutCapability = stripeState.checkoutSessions[0].metadata.publicCheckoutCapability;

    await mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        publicCheckoutCapability: checkoutCapability
    });
    const laterInstallmentPayload = stripeState.checkoutSessions[1];
    const laterCancellation = await mod.cancelStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        checkoutAttemptToken: laterInstallmentPayload.metadata.checkoutAttemptToken,
        publicCheckoutCapability: laterInstallmentPayload.metadata.publicCheckoutCapability
    });
    assert.deepEqual(laterCancellation, { released: false, preserved: true });
    assert.equal(firestore.snapshot('teams/team-1/registrationForms/form-1').registrationOptionCounts.u10.enrolled, 1);
    assert.equal(firestore.snapshot(registrationPath).registrationCapacityReleased, false);
    assert.deepEqual(stripeState.expiredSessionIds, ['cs_test_2']);
    checkoutCapability = laterInstallmentPayload.metadata.publicCheckoutCapability;

    await mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        publicCheckoutCapability: checkoutCapability
    });
    const supersededInstallmentPayload = stripeState.checkoutSessions[2];
    const firstCharge = stripeState.charges.get('ch_pi_evt_installment_paid_before_browser_cancels');
    stripeState.webhookEvent = {
        id: 'evt_installment_refund_while_later_checkout_open', type: 'charge.refunded', created: 200,
        data: { object: { ...clone(firstCharge), amount_refunded: 2000 } }
    };
    assert.equal((await deliverStripeWebhook(mod)).statusCode, 200);

    const repayment = await mod.createStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        publicCheckoutCapability: supersededInstallmentPayload.metadata.publicCheckoutCapability
    });
    const repaymentPayload = stripeState.checkoutSessions[3];
    assert.deepEqual(stripeState.expiredSessionIds, ['cs_test_2', 'cs_test_3']);
    assert.equal(stripeState.checkoutSessions[3].line_items[0].price_data.unit_amount, 2000);
    assert.equal(stripeState.checkoutSessions[3].metadata.paymentPurpose, 'reversal_repayment');
    assert.equal(repayment.sessionId, 'cs_test_4');

    const repaymentCancellation = await mod.cancelStripeRegistrationCheckout({
        teamId: 'team-1', formId: 'form-1', registrationId: submission.registrationId,
        checkoutAttemptToken: repaymentPayload.metadata.checkoutAttemptToken,
        publicCheckoutCapability: repaymentPayload.metadata.publicCheckoutCapability
    });
    assert.deepEqual(repaymentCancellation, { released: false, preserved: true });
    assert.equal(firestore.snapshot('teams/team-1/registrationForms/form-1').registrationOptionCounts.u10.enrolled, 1);
    assert.equal(firestore.snapshot(registrationPath).registrationCapacityReleased, false);
    assert.equal(firestore.snapshot(registrationPath).paymentPlan.paidInstallmentCount, 1);
    assert.deepEqual(stripeState.expiredSessionIds, ['cs_test_2', 'cs_test_3', 'cs_test_4']);
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
