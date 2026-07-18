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

    return {
        _state: state,
        doc,
        collection,
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
        config: () => ({ stripe: { secret_key: 'sk_test_123', webhook_secret: 'whsec_test_123', app_url: 'https://allplays.test' } }),
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
        webhookEvent: null,
        nextCheckoutResponse: null
    };
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
                checkout: { sessions: { create: async (payload) => {
                    stripeState.checkoutSessions.push(clone(payload));
                    return {
                        id: `cs_test_${stripeState.checkoutSessions.length}`,
                        url: `https://stripe.test/checkout/${stripeState.checkoutSessions.length}`,
                        payment_status: 'unpaid',
                        ...(clone(stripeState.nextCheckoutResponse) || {})
                    };
                } } },
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
