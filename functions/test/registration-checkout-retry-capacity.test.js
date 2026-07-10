import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

let adminStub = null;
let functionsStub = null;
let StripeStub = null;

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

function deleteNested(target, path) {
    const parts = String(path || '').split('.').filter(Boolean);
    let cursor = target;
    for (let i = 0; i < parts.length - 1; i++) {
        cursor = cursor?.[parts[i]];
        if (!cursor || typeof cursor !== 'object') return;
    }
    if (cursor && typeof cursor === 'object') {
        delete cursor[parts[parts.length - 1]];
    }
}

function makeFirestore(seed = {}, options = {}) {
    const state = new Map(Object.entries(clone(seed)));
    const getCounts = new Map();

    const fieldValue = {
        serverTimestamp: () => ({ __op: 'serverTimestamp' }),
        delete: () => ({ __op: 'delete' }),
        increment: (amount) => ({ __op: 'increment', amount }),
        arrayUnion: (...items) => ({ __op: 'arrayUnion', items })
    };

    const isOp = (value, kind) => value && typeof value === 'object' && value.__op === kind;

    function applyPatch(baseValue, patchValue, merge) {
        const target = merge ? clone(baseValue || {}) : {};
        Object.entries(patchValue || {}).forEach(([key, value]) => {
            if (isOp(value, 'delete')) {
                deleteNested(target, key);
            } else if (isOp(value, 'serverTimestamp')) {
                setNested(target, key, 'SERVER_TIMESTAMP');
            } else if (isOp(value, 'increment')) {
                const current = Number(key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), target) || 0);
                setNested(target, key, current + value.amount);
            } else if (isOp(value, 'arrayUnion')) {
                const current = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), target);
                const array = Array.isArray(current) ? [...current] : [];
                value.items.forEach((item) => array.push(clone(item)));
                setNested(target, key, array);
            } else {
                setNested(target, key, clone(value));
            }
        });
        return target;
    }

    function write(path, value, options = {}) {
        const current = state.get(path);
        const next = applyPatch(current, value, options.merge === true);
        state.set(path, next);
    }

    function runGetHook(path, ref) {
        const count = (getCounts.get(path) || 0) + 1;
        getCounts.set(path, count);
        if (typeof options.onGet === 'function') {
            options.onGet({ path, count, state, write, ref });
        }
    }

    function doc(path) {
        return {
            path,
            id: String(path).split('/').pop(),
            async get() {
                const data = state.get(path);
                const snapshot = {
                    exists: data !== undefined,
                    id: String(path).split('/').pop(),
                    ref: this,
                    data: () => clone(data)
                };
                runGetHook(path, this);
                return snapshot;
            },
            async set(value, options) {
                write(path, value, options || {});
            },
            async update(value) {
                const current = state.get(path);
                if (current === undefined) {
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
                return doc(`${path}/${id}`);
            }
        };
    }

    return {
        _state: state,
        doc,
        collection,
        async runTransaction(handler) {
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
        FieldValue: fieldValue
    };
}

function makeFunctionsStub() {
    class HttpsError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }

    const triggerChain = {
        onCall: (fn) => fn,
        onRequest: (fn) => fn,
        onCreate: (fn) => fn,
        onUpdate: (fn) => fn,
        onWrite: (fn) => fn,
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
        config: () => ({ stripe: { secret_key: 'sk_test_123', app_url: 'https://allplays.test' } }),
        https: {
            HttpsError,
            onCall: (fn) => fn,
            onRequest: (fn) => fn
        },
        firestore: {
            document: () => triggerChain
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

function installModuleStubs({ firestore, stripeCreateImpl }) {
    adminStub = {
        apps: [true],
        initializeApp: () => {},
        firestore: Object.assign(() => firestore, { FieldValue: firestore.FieldValue }),
        auth: () => ({ verifyIdToken: async () => null }),
        messaging: () => ({})
    };
    functionsStub = makeFunctionsStub();
    StripeStub = class StripeMock {
        constructor() {
            return {
                checkout: {
                    sessions: {
                        create: stripeCreateImpl
                    }
                },
                webhooks: {
                    constructEvent: () => {
                        throw new Error('Not implemented in test.');
                    }
                }
            };
        }
    };
}

function loadCheckoutHandler({ seed, stripeCreateImpl, firestoreOptions }) {
    delete require.cache[repoIndexPath];
    const firestore = makeFirestore(seed, firestoreOptions);
    installModuleStubs({ firestore, stripeCreateImpl });
    const mod = require('../index.js');
    return {
        firestore,
        createStripeRegistrationCheckout: mod.createStripeRegistrationCheckout
    };
}

function buildSeedState(overrides = {}) {
    return {
        'teams/team-1/registrationForms/form-1': {
            published: true,
            paymentSettings: { onlineCheckoutEnabled: true },
            feeAmountCents: 5000,
            currency: 'USD',
            registrationOptionCounts: {
                u10: {
                    enrolled: 0,
                    waitlisted: 0
                }
            }
        },
        'teams/team-1/registrationForms/form-1/registrations/reg-1': {
            teamId: 'team-1',
            formId: 'form-1',
            status: 'pending',
            registrationCapacityReleased: true,
            checkoutAttemptToken: 'attempttoken12345',
            selectedOption: {
                id: 'u10',
                countKey: 'u10',
                capacityLimit: 5
            },
            guardian: {
                email: 'parent@example.com'
            },
            ...overrides
        }
    };
}

const checkoutInput = {
    teamId: 'team-1',
    formId: 'form-1',
    registrationId: 'reg-1',
    checkoutAttemptToken: 'attempttoken12345',
    retryPayment: true
};

beforeEach(() => {
    delete require.cache[repoIndexPath];
    Module._load = patchedModuleLoad;
    adminStub = null;
    functionsStub = null;
    StripeStub = null;
});

afterEach(() => {
    delete require.cache[repoIndexPath];
    Module._load = originalModuleLoad;
    adminStub = null;
    functionsStub = null;
    StripeStub = null;
});

test('retry checkout preserves an early-bird discount captured at submission time', async () => {
    const seed = buildSeedState({
        registrationCapacityReleased: false,
        submittedAt: '2000-01-01T12:00:00.000Z',
        feeAmountCents: 10000,
        feeSnapshot: {
            currency: 'USD',
            quantity: 1,
            originalFeeAmountCents: 10000,
            subtotalAmountCents: 10000,
            discountRules: [
                { id: 'early', type: 'early_bird', amountType: 'fixed', amountValue: 2500, earlyBirdDeadline: '2000-01-02', active: true }
            ],
            appliedDiscounts: [{ id: 'early', type: 'early_bird', amountCents: 2500 }],
            finalAmountDueCents: 7500
        }
    });
    Object.assign(seed['teams/team-1/registrationForms/form-1'], {
        feeAmountCents: 10000,
        discountRules: [
            { id: 'early', type: 'early_bird', amountType: 'fixed', amountValue: 2500, earlyBirdDeadline: '2000-01-02', active: true }
        ]
    });
    let stripeCreateArgs = null;
    const { firestore, createStripeRegistrationCheckout } = loadCheckoutHandler({
        seed,
        stripeCreateImpl: async (args) => {
            stripeCreateArgs = args;
            return {
                id: 'cs_early_bird_retry',
                url: 'https://checkout.stripe.com/c/early_bird_retry',
                payment_status: 'unpaid'
            };
        }
    });

    await createStripeRegistrationCheckout(checkoutInput);

    assert.equal(stripeCreateArgs.line_items[0].price_data.unit_amount, 7500);
    const registration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-1');
    assert.equal(registration.checkoutAmountCents, 7500);
});

test('retry checkout does not grant an early-bird discount added after submission', async () => {
    const seed = buildSeedState({
        registrationCapacityReleased: false,
        submittedAt: '2000-01-01T12:00:00.000Z',
        feeAmountCents: 10000,
        feeSnapshot: {
            currency: 'USD',
            quantity: 1,
            originalFeeAmountCents: 10000,
            subtotalAmountCents: 10000,
            discountRules: [],
            appliedDiscounts: [],
            finalAmountDueCents: 10000
        }
    });
    Object.assign(seed['teams/team-1/registrationForms/form-1'], {
        feeAmountCents: 10000,
        discountRules: [
            { id: 'later-early', type: 'early_bird', amountType: 'fixed', amountValue: 2500, earlyBirdDeadline: '2000-01-02', active: true }
        ]
    });
    let stripeCreateArgs = null;
    const { firestore, createStripeRegistrationCheckout } = loadCheckoutHandler({
        seed,
        stripeCreateImpl: async (args) => {
            stripeCreateArgs = args;
            return {
                id: 'cs_later_early_bird_retry',
                url: 'https://checkout.stripe.com/c/later_early_bird_retry',
                payment_status: 'unpaid'
            };
        }
    });

    await createStripeRegistrationCheckout(checkoutInput);

    assert.equal(stripeCreateArgs.line_items[0].price_data.unit_amount, 10000);
    const registration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-1');
    assert.equal(registration.checkoutAmountCents, 10000);
});

test('rolls back reserved capacity when Stripe checkout creation fails', async () => {
    const { firestore, createStripeRegistrationCheckout } = loadCheckoutHandler({
        seed: buildSeedState(),
        stripeCreateImpl: async () => {
            throw new Error('Stripe checkout creation failed.');
        }
    });

    await assert.rejects(
        createStripeRegistrationCheckout(checkoutInput),
        /Stripe checkout creation failed\./
    );

    const form = firestore.snapshot('teams/team-1/registrationForms/form-1');
    const registration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-1');

    assert.equal(form.registrationOptionCounts.u10.enrolled, 0);
    assert.equal(registration.registrationCapacityReleased, true);
    assert.equal(registration.capacityReleasedAt, 'SERVER_TIMESTAMP');
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'checkoutStatus'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'paymentStatus'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'checkoutUrl'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'retryCapacityReservationId'), false);
});

test('does not release an overlapping retry reservation this call did not acquire', async () => {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-1';
    const formPath = 'teams/team-1/registrationForms/form-1';
    const { firestore, createStripeRegistrationCheckout } = loadCheckoutHandler({
        seed: buildSeedState(),
        firestoreOptions: {
            onGet: ({ path, count, state }) => {
                if (path === registrationPath && count === 1) {
                    const registration = clone(state.get(registrationPath));
                    registration.registrationCapacityReleased = false;
                    registration.retryCapacityReservationId = 'existing-retry-reservation';
                    state.set(registrationPath, registration);

                    const form = clone(state.get(formPath));
                    form.registrationOptionCounts.u10.enrolled = 1;
                    state.set(formPath, form);
                }
            }
        },
        stripeCreateImpl: async () => {
            throw new Error('Stripe checkout creation failed.');
        }
    });

    await assert.rejects(
        createStripeRegistrationCheckout(checkoutInput),
        /Stripe checkout creation failed\./
    );

    const form = firestore.snapshot(formPath);
    const registration = firestore.snapshot(registrationPath);

    assert.equal(form.registrationOptionCounts.u10.enrolled, 1);
    assert.equal(registration.registrationCapacityReleased, false);
    assert.equal(registration.retryCapacityReservationId, 'existing-retry-reservation');
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'capacityReleasedAt'), false);
});

test('restores capacity after retrying a previously failed session when Stripe creation fails again', async () => {
    const { firestore, createStripeRegistrationCheckout } = loadCheckoutHandler({
        seed: buildSeedState({
            checkoutStatus: 'payment_failed',
            paymentStatus: 'payment_failed',
            checkoutUrl: 'https://checkout.stripe.com/c/old_session',
            paymentLink: 'https://checkout.stripe.com/c/old_session',
            stripeCheckoutSessionId: 'cs_old_failed',
            stripePaymentStatus: 'unpaid'
        }),
        stripeCreateImpl: async () => {
            throw new Error('Stripe checkout creation failed.');
        }
    });

    await assert.rejects(
        createStripeRegistrationCheckout(checkoutInput),
        /Stripe checkout creation failed\./
    );

    const form = firestore.snapshot('teams/team-1/registrationForms/form-1');
    const registration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-1');

    assert.equal(form.registrationOptionCounts.u10.enrolled, 0);
    assert.equal(registration.registrationCapacityReleased, true);
    assert.equal(registration.checkoutStatus, 'payment_failed');
    assert.equal(registration.paymentStatus, 'payment_failed');
    assert.equal(registration.checkoutUrl, 'https://checkout.stripe.com/c/old_session');
    assert.equal(registration.stripeCheckoutSessionId, 'cs_old_failed');
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'retryCapacityReservationId'), false);
});

test('records and clears a retry capacity reservation id around Stripe checkout creation failures', async () => {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-1';
    let firestore = null;
    let reservedRetryCapacityReservationId = '';
    const loaded = loadCheckoutHandler({
        seed: buildSeedState(),
        stripeCreateImpl: async () => {
            const registration = firestore.snapshot(registrationPath);
            reservedRetryCapacityReservationId = String(registration.retryCapacityReservationId || '');
            throw new Error('Stripe checkout creation failed.');
        }
    });
    firestore = loaded.firestore;

    await assert.rejects(
        loaded.createStripeRegistrationCheckout(checkoutInput),
        /Stripe checkout creation failed\./
    );

    const registration = firestore.snapshot(registrationPath);

    assert.match(reservedRetryCapacityReservationId, /^[0-9a-f-]{36}$/i);
    assert.equal(registration.registrationCapacityReleased, true);
    assert.equal(registration.capacityReleasedAt, 'SERVER_TIMESTAMP');
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'retryCapacityReservationId'), false);
});

test('reserves capacity exactly once after a failed retry is retried successfully', async () => {
    const stripeCreateSuccess = async () => ({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/c/session_123',
        payment_status: 'unpaid'
    });
    const { firestore, createStripeRegistrationCheckout } = loadCheckoutHandler({
        seed: buildSeedState(),
        stripeCreateImpl: async () => {
            throw new Error('Stripe checkout creation failed.');
        }
    });

    await assert.rejects(
        createStripeRegistrationCheckout(checkoutInput),
        /Stripe checkout creation failed\./
    );

    delete require.cache[repoIndexPath];
    installModuleStubs({ firestore, stripeCreateImpl: stripeCreateSuccess });
    const mod = require('../index.js');
    const result = await mod.createStripeRegistrationCheckout(checkoutInput);

    const form = firestore.snapshot('teams/team-1/registrationForms/form-1');
    const registration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-1');

    assert.deepEqual(result, {
        checkoutUrl: 'https://checkout.stripe.com/c/session_123',
        sessionId: 'cs_test_123'
    });
    assert.equal(form.registrationOptionCounts.u10.enrolled, 1);
    assert.equal(registration.registrationCapacityReleased, false);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'capacityReleasedAt'), false);
    assert.equal(registration.checkoutStatus, 'open');
    assert.equal(registration.paymentStatus, 'checkout_open');
    assert.equal(registration.stripeCheckoutSessionId, 'cs_test_123');
    assert.equal(registration.checkoutAmountCents, 5000);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'retryCapacityReservationId'), false);
});

test('includes retryPayment on Stripe cancel returns for initial public registration checkout', async () => {
    let stripeCreateArgs = null;
    const { createStripeRegistrationCheckout } = loadCheckoutHandler({
        seed: buildSeedState({
            registrationCapacityReleased: false
        }),
        stripeCreateImpl: async (args) => {
            stripeCreateArgs = args;
            return {
                id: 'cs_test_initial_retry',
                url: 'https://checkout.stripe.com/c/session_initial_retry',
                payment_status: 'unpaid'
            };
        }
    });

    await createStripeRegistrationCheckout({
        teamId: 'team-1',
        formId: 'form-1',
        registrationId: 'reg-1',
        checkoutAttemptToken: 'attempttoken12345'
    });

    assert.ok(stripeCreateArgs);
    const successUrl = new URL(stripeCreateArgs.success_url);
    const cancelUrl = new URL(stripeCreateArgs.cancel_url);

    assert.equal(successUrl.origin, 'https://allplays.test');
    assert.equal(successUrl.pathname, '/registration.html');
    assert.equal(successUrl.searchParams.get('teamId'), 'team-1');
    assert.equal(successUrl.searchParams.get('formId'), 'form-1');
    assert.equal(successUrl.searchParams.get('paymentPlanId'), 'pay_full');
    assert.match(successUrl.searchParams.get('publicCheckoutCapability') || '', /^[A-Za-z0-9_-]{32,}$/);
    assert.equal(successUrl.searchParams.get('retryPayment'), null);
    assert.deepEqual(successUrl.searchParams.getAll('retryPayment'), []);
    assert.equal(successUrl.searchParams.get('status'), 'success');

    assert.equal(cancelUrl.origin, 'https://allplays.test');
    assert.equal(cancelUrl.pathname, '/registration.html');
    assert.equal(cancelUrl.searchParams.get('teamId'), 'team-1');
    assert.equal(cancelUrl.searchParams.get('formId'), 'form-1');
    assert.equal(cancelUrl.searchParams.get('paymentPlanId'), 'pay_full');
    assert.equal(cancelUrl.searchParams.get('publicCheckoutCapability'), successUrl.searchParams.get('publicCheckoutCapability'));
    assert.equal(cancelUrl.searchParams.get('retryPayment'), '1');
    assert.deepEqual(cancelUrl.searchParams.getAll('retryPayment'), ['1']);
    assert.equal(cancelUrl.searchParams.get('status'), 'cancelled');
});
