import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import Module, { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;
const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

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
                setNested(target, key, options.serverTimestampValue ?? 'SERVER_TIMESTAMP');
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
        config: () => ({ stripe: { secret_key: 'sk_test_123', app_url: 'https://allplays.test' } }),
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

function installModuleStubs({ firestore, stripeCreateImpl, stripeExpireImpl = async () => ({ status: 'expired' }) }) {
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
                        create: stripeCreateImpl,
                        expire: stripeExpireImpl
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

function loadCheckoutHandler({ seed, stripeCreateImpl, stripeExpireImpl, firestoreOptions }) {
    delete require.cache[repoIndexPath];
    const firestore = makeFirestore(seed, firestoreOptions);
    installModuleStubs({ firestore, stripeCreateImpl, stripeExpireImpl });
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

function buildRejectTeamRegistration(firestore) {
    const start = dbSource.indexOf('export async function rejectTeamRegistration');
    const end = dbSource.indexOf('\n/**', start);
    assert.ok(start >= 0 && end > start);
    const functionSource = dbSource
        .slice(start, end)
        .replace('export async function rejectTeamRegistration', 'return async function rejectTeamRegistration');

    return new Function('auth', 'doc', 'db', 'Timestamp', 'runTransaction', 'normalizeRegistrationStatus', functionSource)(
        { currentUser: { uid: 'admin-1', displayName: 'Coach' } },
        (_db, collectionPath, id) => firestore.doc(`${collectionPath}/${id}`),
        firestore,
        { now: () => 'NOW' },
        (db, callback) => db.runTransaction((transaction) => callback({
            ...transaction,
            get: async (ref) => {
                const snapshot = await transaction.get(ref);
                return { ...snapshot, exists: () => snapshot.exists };
            }
        })),
        (value) => String(value || 'pending').toLowerCase()
    );
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

test('rejecting a registration prevents a later public checkout from charging released capacity', async () => {
    let stripeCreateCalls = 0;
    const { firestore, createStripeRegistrationCheckout } = loadCheckoutHandler({
        seed: buildSeedState({
            status: 'rejected',
            registrationCapacityReleased: true,
            publicCheckoutCapabilityHash: ''
        }),
        stripeCreateImpl: async () => {
            stripeCreateCalls += 1;
            return {
                id: 'cs_rejected_registration',
                url: 'https://checkout.stripe.com/c/rejected_registration',
                payment_status: 'unpaid'
            };
        }
    });

    await assert.rejects(
        createStripeRegistrationCheckout(checkoutInput),
        (error) => error?.code === 'failed-precondition'
            && error?.message === 'Rejected registrations cannot be paid online.'
    );

    const form = firestore.snapshot('teams/team-1/registrationForms/form-1');
    const registration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-1');
    assert.equal(stripeCreateCalls, 0);
    assert.equal(form.registrationOptionCounts.u10.enrolled, 0);
    assert.equal(registration.status, 'rejected');
    assert.equal(registration.registrationCapacityReleased, true);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'checkoutStatus'), false);
});

test('checkout reserves the registration before Stripe creation so concurrent rejection cannot release capacity', async () => {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-1';
    let firestore = null;
    let releaseStripeCreation;
    let stripeCreationStarted;
    const stripeCreationBarrier = new Promise((resolve) => {
        stripeCreationStarted = resolve;
    });
    const loaded = loadCheckoutHandler({
        seed: buildSeedState({ registrationCapacityReleased: false }),
        firestoreOptions: { serverTimestampValue: Date.now() },
        stripeCreateImpl: async () => {
            stripeCreationStarted();
            await new Promise((resolve) => {
                releaseStripeCreation = resolve;
            });
            return {
                id: 'cs_concurrent_rejection',
                url: 'https://checkout.stripe.com/c/concurrent_rejection',
                payment_status: 'unpaid'
            };
        }
    });
    firestore = loaded.firestore;

    const checkoutPromise = loaded.createStripeRegistrationCheckout({
        ...checkoutInput,
        retryPayment: false
    });
    await stripeCreationBarrier;

    const registrationDuringStripeCall = firestore.snapshot(registrationPath);
    assert.match(registrationDuringStripeCall.checkoutCreationReservationId, /^[0-9a-f-]{36}$/i);
    assert.equal(registrationDuringStripeCall.status, 'pending');
    assert.equal(registrationDuringStripeCall.registrationCapacityReleased, false);

    const rejectTeamRegistration = buildRejectTeamRegistration(firestore);
    await assert.rejects(
        rejectTeamRegistration('team-1', 'form-1', 'reg-1', 'Concurrent rejection'),
        /Registration cannot be rejected while its online payment is still processing/
    );
    assert.equal(firestore.snapshot(registrationPath).status, 'pending');

    releaseStripeCreation();
    await checkoutPromise;

    const completedRegistration = firestore.snapshot(registrationPath);
    assert.equal(completedRegistration.checkoutStatus, 'open');
    assert.equal(completedRegistration.paymentStatus, 'checkout_open');
    assert.equal(Object.prototype.hasOwnProperty.call(completedRegistration, 'checkoutCreationReservationId'), false);
});

test('checkout transaction rejects a form price change after preflight without calling Stripe', async () => {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-1';
    const formPath = 'teams/team-1/registrationForms/form-1';
    let stripeCreateCalls = 0;
    const loaded = loadCheckoutHandler({
        seed: buildSeedState({ registrationCapacityReleased: false }),
        stripeCreateImpl: async () => {
            stripeCreateCalls += 1;
            throw new Error('Stripe must not be called for stale checkout details.');
        },
        firestoreOptions: {
            onGet: ({ path, count, write }) => {
                if (path === registrationPath && count === 1) {
                    write(formPath, { feeAmountCents: 6500 }, { merge: true });
                }
            }
        }
    });

    await assert.rejects(
        loaded.createStripeRegistrationCheckout({ ...checkoutInput, retryPayment: false }),
        (error) => error?.code === 'aborted' && /details changed/.test(error.message)
    );

    assert.equal(stripeCreateCalls, 0);
    const registration = loaded.firestore.snapshot(registrationPath);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'checkoutCreationReservationId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'stripeCheckoutSessionId'), false);
});

test('checkout replaces an abandoned creation reservation after its timeout', async () => {
    let stripeCreateCalls = 0;
    const staleStartedAtSeconds = Math.floor((Date.now() - (16 * 60 * 1000)) / 1000);
    const { firestore, createStripeRegistrationCheckout } = loadCheckoutHandler({
        seed: buildSeedState({
            registrationCapacityReleased: false,
            checkoutCreationReservationId: 'abandoned-reservation',
            checkoutCreationStartedAt: { seconds: staleStartedAtSeconds }
        }),
        stripeCreateImpl: async () => {
            stripeCreateCalls += 1;
            return {
                id: 'cs_recovered_reservation',
                url: 'https://checkout.stripe.com/c/recovered_reservation',
                payment_status: 'unpaid'
            };
        }
    });

    const result = await createStripeRegistrationCheckout({
        ...checkoutInput,
        retryPayment: false
    });

    assert.equal(stripeCreateCalls, 1);
    assert.deepEqual(result, {
        checkoutUrl: 'https://checkout.stripe.com/c/recovered_reservation',
        sessionId: 'cs_recovered_reservation'
    });
    const registration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-1');
    assert.equal(registration.stripeCheckoutSessionId, 'cs_recovered_reservation');
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'checkoutCreationReservationId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'checkoutCreationStartedAt'), false);
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

test('legacy retry checkout ignores stored and current discounts without a captured rule scope', async () => {
    const seed = buildSeedState({
        registrationCapacityReleased: false,
        submittedAt: '2000-01-01T12:00:00.000Z',
        feeAmountCents: 10000,
        feeSnapshot: {
            currency: 'USD',
            quantity: 1,
            originalFeeAmountCents: 10000,
            subtotalAmountCents: 10000,
            appliedDiscounts: [
                { id: 'inflated', type: 'early_bird', amountType: 'fixed', amountCents: 9000 }
            ],
            finalAmountDueCents: 1000
        }
    });
    Object.assign(seed['teams/team-1/registrationForms/form-1'], {
        feeAmountCents: 10000,
        discountRules: [
            { id: 'inflated', type: 'early_bird', amountType: 'fixed', amountValue: 2500, earlyBirdDeadline: '2000-01-02', active: true }
        ]
    });
    let stripeCreateArgs = null;
    const { firestore, createStripeRegistrationCheckout } = loadCheckoutHandler({
        seed,
        stripeCreateImpl: async (args) => {
            stripeCreateArgs = args;
            return {
                id: 'cs_legacy_applied_discount_retry',
                url: 'https://checkout.stripe.com/c/legacy_applied_discount_retry',
                payment_status: 'unpaid'
            };
        }
    });

    await createStripeRegistrationCheckout(checkoutInput);

    assert.equal(stripeCreateArgs.line_items[0].price_data.unit_amount, 10000);
    const registration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-1');
    assert.equal(registration.checkoutAmountCents, 10000);
});

test('retains capacity and a durable replay reservation when Stripe checkout creation is ambiguous', async () => {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-1';
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
    const registration = firestore.snapshot(registrationPath);

    assert.equal(form.registrationOptionCounts.u10.enrolled, 1);
    assert.equal(registration.registrationCapacityReleased, false);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'checkoutStatus'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'paymentStatus'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'checkoutUrl'), false);
    assert.match(registration.retryCapacityReservationId, /^[0-9a-f-]{36}$/i);
    assert.match(registration.checkoutCreationReservationId, /^[0-9a-f-]{36}$/i);
    const reservation = firestore.snapshot(`${registrationPath}/checkoutReservations/${registration.checkoutCreationReservationId}`);
    assert.equal(reservation.status, 'creation_failed');
    assert.equal(reservation.stripeRequest.metadata.product, 'registration');
    assert.match(reservation.stripeIdempotencyKey, /^registration_checkout_/);
});

test('checkout owner preserves an overlapping retry reservation when Stripe creation is ambiguous', async () => {
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
    assert.match(registration.checkoutCreationReservationId, /^[0-9a-f-]{36}$/i);
});

test('retry losing checkout creation ownership does not release capacity beneath the surviving checkout', async () => {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-1';
    const formPath = 'teams/team-1/registrationForms/form-1';
    let stripeCreateCalls = 0;
    const { firestore, createStripeRegistrationCheckout } = loadCheckoutHandler({
        seed: buildSeedState(),
        firestoreOptions: {
            onGet: ({ path, count, state }) => {
                if (path === registrationPath && count === 2) {
                    const registration = clone(state.get(registrationPath));
                    registration.checkoutCreationReservationId = 'surviving-checkout-owner';
                    registration.checkoutCreationStartedAt = Date.now();
                    state.set(registrationPath, registration);
                }
            }
        },
        stripeCreateImpl: async () => {
            stripeCreateCalls += 1;
            throw new Error('The losing retry must not reach Stripe.');
        }
    });

    await assert.rejects(
        createStripeRegistrationCheckout(checkoutInput),
        (error) => error?.code === 'failed-precondition'
            && error?.message === 'Registration checkout creation is already in progress.'
    );

    const form = firestore.snapshot(formPath);
    const registration = firestore.snapshot(registrationPath);

    assert.equal(stripeCreateCalls, 0);
    assert.equal(form.registrationOptionCounts.u10.enrolled, 1);
    assert.equal(registration.registrationCapacityReleased, false);
    assert.match(registration.retryCapacityReservationId, /^[0-9a-f-]{36}$/i);
    assert.equal(registration.checkoutCreationReservationId, 'surviving-checkout-owner');
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'capacityReleasedAt'), false);
});

test('holds capacity while retrying a previously failed session with a durable Stripe request', async () => {
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

    assert.equal(form.registrationOptionCounts.u10.enrolled, 1);
    assert.equal(registration.registrationCapacityReleased, false);
    assert.equal(registration.checkoutStatus, 'payment_failed');
    assert.equal(registration.paymentStatus, 'payment_failed');
    assert.equal(registration.checkoutUrl, 'https://checkout.stripe.com/c/old_session');
    assert.equal(registration.stripeCheckoutSessionId, 'cs_old_failed');
    assert.match(registration.retryCapacityReservationId, /^[0-9a-f-]{36}$/i);
    assert.match(registration.checkoutCreationReservationId, /^[0-9a-f-]{36}$/i);
});

test('records and retains retry capacity authority across Stripe creation failures', async () => {
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
    assert.equal(registration.registrationCapacityReleased, false);
    assert.equal(registration.retryCapacityReservationId, reservedRetryCapacityReservationId);
    assert.match(registration.checkoutCreationReservationId, /^[0-9a-f-]{36}$/i);
});

test('reserves capacity exactly once after a failed retry is retried successfully', async () => {
    const stripeCreateSuccess = async () => ({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/c/session_123',
        payment_status: 'unpaid',
        status: 'open',
        livemode: false,
        expires_at: Math.floor(Date.now() / 1000) + 1800
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

test('replays the exact durable Stripe request after post-Stripe persistence fails', async () => {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-1';
    const stripeCalls = [];
    const stripeCreateImpl = async (payload, options) => {
        stripeCalls.push({ payload: clone(payload), options: clone(options) });
        return {
            id: 'cs_test_durable_replay',
            url: 'https://checkout.stripe.com/c/durable_replay',
            payment_status: 'unpaid',
            status: 'open',
            livemode: false,
            expires_at: Math.floor(Date.now() / 1000) + 1800,
            metadata: clone(payload.metadata)
        };
    };
    const loaded = loadCheckoutHandler({
        seed: buildSeedState(),
        stripeCreateImpl,
        firestoreOptions: {
            onGet: ({ path, count }) => {
                if (path === registrationPath && count === 4) {
                    throw new Error('Injected registration projection failure.');
                }
            }
        }
    });

    await assert.rejects(
        loaded.createStripeRegistrationCheckout(checkoutInput),
        /Injected registration projection failure\./
    );

    const registrationAfterFailure = loaded.firestore.snapshot(registrationPath);
    const reservationId = registrationAfterFailure.checkoutCreationReservationId;
    assert.match(reservationId, /^[0-9a-f-]{36}$/i);
    const reservationPath = `${registrationPath}/checkoutReservations/${reservationId}`;
    const reservationAfterFailure = loaded.firestore.snapshot(reservationPath);
    assert.equal(reservationAfterFailure.status, 'stripe_created');
    assert.equal(reservationAfterFailure.stripeCheckoutSessionId, 'cs_test_durable_replay');

    delete require.cache[repoIndexPath];
    installModuleStubs({ firestore: loaded.firestore, stripeCreateImpl });
    const mod = require('../index.js');
    const result = await mod.createStripeRegistrationCheckout(checkoutInput);

    assert.deepEqual(result, {
        checkoutUrl: 'https://checkout.stripe.com/c/durable_replay',
        sessionId: 'cs_test_durable_replay'
    });
    assert.equal(stripeCalls.length, 2);
    assert.deepEqual(stripeCalls[1], stripeCalls[0]);
    const completedRegistration = loaded.firestore.snapshot(registrationPath);
    assert.equal(completedRegistration.stripeCheckoutSessionId, 'cs_test_durable_replay');
    assert.equal(completedRegistration.checkoutStatus, 'open');
    assert.equal(Object.prototype.hasOwnProperty.call(completedRegistration, 'checkoutCreationReservationId'), false);
    assert.equal(loaded.firestore.snapshot(reservationPath).status, 'persisted');
});

test('revokes a stale durable reservation before creating current registration charge authority', async () => {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-1';
    const formPath = 'teams/team-1/registrationForms/form-1';
    const stripeCalls = [];
    const expiredSessionIds = [];
    const sessionsByIdempotencyKey = new Map();
    const stripeCreateImpl = async (payload, options) => {
        stripeCalls.push({ payload: clone(payload), options: clone(options) });
        if (!sessionsByIdempotencyKey.has(options.idempotencyKey)) {
            const sequence = sessionsByIdempotencyKey.size + 1;
            sessionsByIdempotencyKey.set(options.idempotencyKey, {
                id: `cs_test_current_authority_${sequence}`,
                url: `https://checkout.stripe.com/c/current_authority_${sequence}`,
                payment_status: 'unpaid',
                status: 'open',
                livemode: false,
                expires_at: Math.floor(Date.now() / 1000) + 1800,
                metadata: clone(payload.metadata)
            });
        }
        return clone(sessionsByIdempotencyKey.get(options.idempotencyKey));
    };
    const stripeExpireImpl = async (sessionId) => {
        expiredSessionIds.push(sessionId);
        for (const session of sessionsByIdempotencyKey.values()) {
            if (session.id === sessionId) session.status = 'expired';
        }
        return { id: sessionId, status: 'expired' };
    };
    const loaded = loadCheckoutHandler({
        seed: buildSeedState(),
        stripeCreateImpl,
        stripeExpireImpl,
        firestoreOptions: {
            onGet: ({ path, count }) => {
                if (path === registrationPath && count === 4) {
                    throw new Error('Injected registration projection failure.');
                }
            }
        }
    });

    await assert.rejects(
        loaded.createStripeRegistrationCheckout(checkoutInput),
        /Injected registration projection failure\./
    );
    const staleReservationId = loaded.firestore.snapshot(registrationPath).checkoutCreationReservationId;
    const staleReservationPath = `${registrationPath}/checkoutReservations/${staleReservationId}`;
    const staleIdempotencyKey = stripeCalls[0].options.idempotencyKey;
    assert.equal(stripeCalls[0].payload.line_items[0].price_data.unit_amount, 5000);

    await loaded.firestore.doc(formPath).set({ feeAmountCents: 6500, currency: 'CAD' }, { merge: true });
    delete require.cache[repoIndexPath];
    installModuleStubs({ firestore: loaded.firestore, stripeCreateImpl, stripeExpireImpl });
    const mod = require('../index.js');
    const result = await mod.createStripeRegistrationCheckout(checkoutInput);

    assert.equal(stripeCalls.length, 3);
    assert.deepEqual(stripeCalls[1], stripeCalls[0]);
    assert.equal(expiredSessionIds[0], 'cs_test_current_authority_1');
    assert.notEqual(stripeCalls[2].options.idempotencyKey, staleIdempotencyKey);
    assert.equal(stripeCalls[2].payload.line_items[0].price_data.unit_amount, 6500);
    assert.equal(stripeCalls[2].payload.line_items[0].price_data.currency, 'cad');
    assert.equal(loaded.firestore.snapshot(staleReservationPath).status, 'superseded');
    assert.equal(
        loaded.firestore.snapshot(staleReservationPath).supersededReason,
        'current_checkout_authority_changed'
    );
    assert.deepEqual(result, {
        checkoutUrl: 'https://checkout.stripe.com/c/current_authority_2',
        sessionId: 'cs_test_current_authority_2'
    });
    const registration = loaded.firestore.snapshot(registrationPath);
    assert.equal(registration.checkoutAmountCents, 6500);
    assert.equal(registration.checkoutCurrency, 'cad');
    assert.equal(registration.stripeCheckoutSessionId, 'cs_test_current_authority_2');
});

test('terminal registration replay is preserved for webhook reconciliation instead of projected as open', async () => {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-1';
    const expiredSessionIds = [];
    const sharedSession = {
        id: 'cs_test_terminal_replay',
        url: 'https://checkout.stripe.com/c/terminal_replay',
        payment_status: 'unpaid',
        status: 'open',
        livemode: false,
        expires_at: Math.floor(Date.now() / 1000) + 1800
    };
    const stripeCreateImpl = async (payload) => ({ ...clone(sharedSession), metadata: clone(payload.metadata) });
    const loaded = loadCheckoutHandler({
        seed: buildSeedState(),
        stripeCreateImpl,
        stripeExpireImpl: async (sessionId) => {
            expiredSessionIds.push(sessionId);
            return { ...clone(sharedSession), status: 'expired' };
        },
        firestoreOptions: {
            onGet: ({ path, count }) => {
                if (path === registrationPath && count === 4) {
                    throw new Error('Injected registration projection failure.');
                }
            }
        }
    });
    await assert.rejects(
        loaded.createStripeRegistrationCheckout(checkoutInput),
        /Injected registration projection failure\./
    );
    const reservationId = loaded.firestore.snapshot(registrationPath).checkoutCreationReservationId;
    const reservationPath = `${registrationPath}/checkoutReservations/${reservationId}`;
    sharedSession.status = 'complete';
    sharedSession.payment_status = 'paid';

    await assert.rejects(
        loaded.createStripeRegistrationCheckout(checkoutInput),
        (error) => error?.code === 'failed-precondition' && /completing/.test(error.message)
    );

    assert.deepEqual(expiredSessionIds, []);
    assert.equal(loaded.firestore.snapshot(reservationPath).status, 'stripe_created');
    assert.equal(loaded.firestore.snapshot(reservationPath).stripeCheckoutSessionId, sharedSession.id);
    const registration = loaded.firestore.snapshot(registrationPath);
    assert.equal(registration.checkoutCreationReservationId, reservationId);
    assert.notEqual(registration.checkoutStatus, 'open');
});

test('concurrent duplicate checkout callers share one session without the replay loser expiring it', async () => {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-1';
    const stripeCalls = [];
    const expiredSessionIds = [];
    let releaseFirstStripeCall;
    let releaseReplayStripeCall;
    let markFirstStripeStarted;
    let markReplayStripeStarted;
    const firstStripeStarted = new Promise((resolve) => { markFirstStripeStarted = resolve; });
    const replayStripeStarted = new Promise((resolve) => { markReplayStripeStarted = resolve; });
    const firstStripeRelease = new Promise((resolve) => { releaseFirstStripeCall = resolve; });
    const replayStripeRelease = new Promise((resolve) => { releaseReplayStripeCall = resolve; });
    const sharedSession = {
        id: 'cs_test_concurrent_shared',
        url: 'https://checkout.stripe.com/c/concurrent_shared',
        payment_status: 'unpaid',
        status: 'open',
        livemode: false,
        expires_at: Math.floor(Date.now() / 1000) + 1800
    };
    const loaded = loadCheckoutHandler({
        seed: buildSeedState({ registrationCapacityReleased: false }),
        stripeCreateImpl: async (payload, options) => {
            stripeCalls.push({ payload: clone(payload), options: clone(options) });
            if (stripeCalls.length === 1) {
                markFirstStripeStarted();
                await firstStripeRelease;
            } else {
                markReplayStripeStarted();
                await replayStripeRelease;
            }
            return { ...clone(sharedSession), metadata: clone(payload.metadata) };
        },
        stripeExpireImpl: async (sessionId) => {
            expiredSessionIds.push(sessionId);
            return { ...clone(sharedSession), status: 'expired' };
        }
    });

    const firstCheckout = loaded.createStripeRegistrationCheckout({ ...checkoutInput, retryPayment: false });
    await firstStripeStarted;
    const reservationId = loaded.firestore.snapshot(registrationPath).checkoutCreationReservationId;
    const replayCheckout = loaded.createStripeRegistrationCheckout({ ...checkoutInput, retryPayment: false });
    await replayStripeStarted;
    releaseFirstStripeCall();
    const firstResult = await firstCheckout;
    releaseReplayStripeCall();
    const replayResult = await replayCheckout;

    assert.deepEqual(firstResult, replayResult);
    assert.deepEqual(firstResult, {
        checkoutUrl: sharedSession.url,
        sessionId: sharedSession.id
    });
    assert.equal(stripeCalls.length, 2);
    assert.deepEqual(stripeCalls[1], stripeCalls[0]);
    assert.deepEqual(expiredSessionIds, []);
    const registration = loaded.firestore.snapshot(registrationPath);
    assert.equal(registration.checkoutStatus, 'open');
    assert.equal(registration.stripeCheckoutSessionId, sharedSession.id);
    assert.equal(Object.prototype.hasOwnProperty.call(registration, 'checkoutCreationReservationId'), false);
    assert.equal(loaded.firestore.snapshot(`${registrationPath}/checkoutReservations/${reservationId}`).status, 'persisted');
});

test('supersedes an expired durable replay before creating a fresh registration checkout', async () => {
    const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/reg-1';
    const stripeCalls = [];
    const sessionsByIdempotencyKey = new Map();
    const stripeCreateImpl = async (payload, options) => {
        stripeCalls.push({ payload: clone(payload), options: clone(options) });
        if (!sessionsByIdempotencyKey.has(options.idempotencyKey)) {
            const sequence = sessionsByIdempotencyKey.size + 1;
            sessionsByIdempotencyKey.set(options.idempotencyKey, {
                id: `cs_test_replay_${sequence}`,
                url: `https://checkout.stripe.com/c/replay_${sequence}`,
                payment_status: 'unpaid',
                status: 'open',
                livemode: false,
                expires_at: Math.floor(Date.now() / 1000) + 1800,
                metadata: clone(payload.metadata)
            });
        }
        return clone(sessionsByIdempotencyKey.get(options.idempotencyKey));
    };
    const loaded = loadCheckoutHandler({
        seed: buildSeedState(),
        stripeCreateImpl,
        firestoreOptions: {
            onGet: ({ path, count }) => {
                if (path === registrationPath && count === 4) {
                    throw new Error('Injected registration projection failure.');
                }
            }
        }
    });

    await assert.rejects(
        loaded.createStripeRegistrationCheckout(checkoutInput),
        /Injected registration projection failure\./
    );
    const registrationAfterFailure = loaded.firestore.snapshot(registrationPath);
    const expiredReservationId = registrationAfterFailure.checkoutCreationReservationId;
    const expiredReservationPath = `${registrationPath}/checkoutReservations/${expiredReservationId}`;
    const firstIdempotencyKey = stripeCalls[0].options.idempotencyKey;
    sessionsByIdempotencyKey.get(firstIdempotencyKey).status = 'expired';
    sessionsByIdempotencyKey.get(firstIdempotencyKey).expires_at = Math.floor(Date.now() / 1000) - 60;

    await assert.rejects(
        loaded.createStripeRegistrationCheckout(checkoutInput),
        (error) => error?.code === 'aborted' && /expired/.test(error.message)
    );
    assert.deepEqual(stripeCalls[1], stripeCalls[0]);
    assert.equal(loaded.firestore.snapshot(expiredReservationPath).status, 'superseded');
    const registrationAfterExpiredReplay = loaded.firestore.snapshot(registrationPath);
    assert.equal(Object.prototype.hasOwnProperty.call(registrationAfterExpiredReplay, 'checkoutCreationReservationId'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(registrationAfterExpiredReplay, 'checkoutCreationStartedAt'), false);
    assert.notEqual(registrationAfterExpiredReplay.checkoutStatus, 'open');

    const replacement = await loaded.createStripeRegistrationCheckout(checkoutInput);
    assert.equal(replacement.sessionId, 'cs_test_replay_2');
    assert.notEqual(stripeCalls[2].options.idempotencyKey, firstIdempotencyKey);
    assert.equal(loaded.firestore.snapshot(registrationPath).checkoutStatus, 'open');
    assert.equal(loaded.firestore.snapshot(registrationPath).stripeCheckoutSessionId, 'cs_test_replay_2');
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
