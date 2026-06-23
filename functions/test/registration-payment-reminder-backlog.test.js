const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

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

function getNested(target, path) {
    return String(path || '').split('.').filter(Boolean)
        .reduce((cursor, key) => (cursor == null ? undefined : cursor[key]), target);
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

function compareQueryRecord(left, right, orderField) {
    const leftValue = String(getNested(left.data, orderField) || '');
    const rightValue = String(getNested(right.data, orderField) || '');
    if (leftValue !== rightValue) {
        return leftValue < rightValue ? -1 : 1;
    }
    return left.path.localeCompare(right.path);
}

function makeFirestore(seed = {}) {
    const state = new Map(Object.entries(clone(seed)));
    const queryLog = [];
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
                const current = Number(getNested(target, key) || 0);
                setNested(target, key, current + value.amount);
            } else if (isOp(value, 'arrayUnion')) {
                const current = getNested(target, key);
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

    function makeSnapshot(path, ref, data) {
        const snapshotData = clone(data);
        return {
            exists: data !== undefined,
            id: String(path).split('/').pop(),
            ref,
            data: () => clone(snapshotData)
        };
    }

    function doc(path) {
        return {
            path,
            id: String(path).split('/').pop(),
            async get() {
                return makeSnapshot(path, this, state.get(path));
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

    function collectionGroup(groupName, filters = [], orderField = '', limitCount = null, cursor = null) {
        return {
            where(field, op, value) {
                return collectionGroup(groupName, [...filters, { field, op, value }], orderField, limitCount, cursor);
            },
            orderBy(field) {
                return collectionGroup(groupName, filters, field, limitCount, cursor);
            },
            limit(count) {
                return collectionGroup(groupName, filters, orderField, Number(count), cursor);
            },
            startAfter(nextCursor) {
                return collectionGroup(groupName, filters, orderField, limitCount, nextCursor);
            },
            async get() {
                queryLog.push({
                    groupName,
                    filters: clone(filters),
                    orderField,
                    limitCount,
                    cursorPath: cursor?.ref?.path || null,
                    cursorValue: cursor ? getNested(cursor.data(), orderField) : null
                });

                const cursorRecord = cursor
                    ? { path: cursor.ref.path, data: cursor.data() }
                    : null;
                let records = Array.from(state.entries())
                    .filter(([path]) => path.split('/').at(-2) === groupName)
                    .map(([path, data]) => ({ path, data }));

                filters.forEach((filter) => {
                    if (filter.op !== '<=') {
                        throw new Error(`Unsupported test query operator: ${filter.op}`);
                    }
                    records = records.filter((record) => {
                        const value = getNested(record.data, filter.field);
                        return value !== undefined && value !== null && String(value) <= String(filter.value || '');
                    });
                });

                if (orderField) {
                    records.sort((left, right) => compareQueryRecord(left, right, orderField));
                }

                if (cursorRecord) {
                    records = records.filter((record) => compareQueryRecord(record, cursorRecord, orderField) > 0);
                }

                const page = records.slice(0, limitCount || records.length);
                return {
                    docs: page.map((record) => makeSnapshot(record.path, doc(record.path), record.data))
                };
            }
        };
    }

    return {
        _state: state,
        _queryLog: queryLog,
        doc,
        collection,
        collectionGroup: (groupName) => collectionGroup(groupName),
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
        countCollection(pathPrefix) {
            return Array.from(state.keys()).filter((path) => path.startsWith(`${pathPrefix}/`)).length;
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

function installModuleStubs(firestore) {
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
                checkout: { sessions: { create: async () => ({}) } },
                webhooks: {
                    constructEvent: () => {
                        throw new Error('Not implemented in test.');
                    }
                }
            };
        }
    };
}

function buildRegistrationSeed(count, dueIso) {
    const seed = {};
    for (let index = 1; index <= count; index++) {
        const registrationId = `reg-${String(index).padStart(3, '0')}`;
        const path = `teams/team-1/registrationForms/form-1/registrations/${registrationId}`;
        seed[path] = {
            id: registrationId,
            teamId: 'team-1',
            formId: 'form-1',
            status: index === 61 ? 'closed' : 'pending',
            paymentStatus: index === 60 ? 'paid' : 'payment_failed',
            programName: 'Summer camp',
            feeAmountCents: 7500,
            currency: 'USD',
            guardian: {
                email: `parent-${String(index).padStart(3, '0')}@example.com`
            },
            paymentReminder: {
                status: 'active',
                recipientEmail: `parent-${String(index).padStart(3, '0')}@example.com`,
                retryUrl: 'https://allplays.test/registration.html?retryPayment=1',
                reminderCount: 0,
                lastEventId: 'evt_failed',
                nextReminderAt: dueIso
            }
        };
    }
    return seed;
}

function loadReminderWorker(seed) {
    delete require.cache[repoIndexPath];
    const firestore = makeFirestore(seed);
    installModuleStubs(firestore);
    const mod = require('../index.js');
    return {
        firestore,
        queueDueRegistrationFailedPaymentReminders: mod.queueDueRegistrationFailedPaymentReminders
    };
}

test.beforeEach(() => {
    delete require.cache[repoIndexPath];
    Module._load = patchedModuleLoad;
    adminStub = null;
    functionsStub = null;
    StripeStub = null;
});

test.afterEach(() => {
    delete require.cache[repoIndexPath];
    Module._load = originalModuleLoad;
    adminStub = null;
    functionsStub = null;
    StripeStub = null;
});

test('drains overdue registration payment reminders across ordered cursor pages', async () => {
    const dueIso = '2026-06-01T12:00:00.000Z';
    const { firestore, queueDueRegistrationFailedPaymentReminders } = loadReminderWorker(
        buildRegistrationSeed(65, dueIso)
    );

    const summary = await queueDueRegistrationFailedPaymentReminders();

    assert.equal(summary.pagesAttempted, 2);
    assert.equal(summary.stoppedBecause, 'drained');
    assert.equal(summary.examinedCount, 65);
    assert.equal(summary.processedCount, 65);
    assert.equal(summary.queuedCount, 63);
    assert.equal(summary.stoppedCount, 2);
    assert.equal(summary.missingEmailCount, 0);
    assert.equal(summary.queuedPaths.length, 63);
    assert.ok(summary.queuedPaths.includes('teams/team-1/registrationForms/form-1/registrations/reg-055'));

    assert.equal(firestore._queryLog.length, 2);
    assert.deepEqual(firestore._queryLog[0].filters, [{
        field: 'paymentReminder.nextReminderAt',
        op: '<=',
        value: summary.dueIso
    }]);
    assert.equal(firestore._queryLog[0].orderField, 'paymentReminder.nextReminderAt');
    assert.equal(firestore._queryLog[0].limitCount, 50);
    assert.equal(firestore._queryLog[0].cursorPath, null);
    assert.equal(firestore._queryLog[1].cursorPath, 'teams/team-1/registrationForms/form-1/registrations/reg-050');
    assert.equal(firestore._queryLog[1].cursorValue, dueIso);

    const laterRegistration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-055');
    assert.equal(laterRegistration.paymentReminder.reminderCount, 1);
    assert.equal(laterRegistration.paymentReminder.status, 'active');
    assert.equal(laterRegistration.paymentReminder.lastReminderKind, 'followup');
    assert.ok(laterRegistration.paymentReminder.nextReminderAt > dueIso);

    const laterMail = firestore.snapshot(`mail/${laterRegistration.paymentReminder.lastMailId}`);
    assert.equal(laterMail.metadata.registrationId, 'reg-055');
    assert.equal(laterMail.metadata.reminderKind, 'followup');
    assert.equal(laterMail.metadata.reminderNumber, 1);

    const paidRegistration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-060');
    assert.equal(paidRegistration.paymentReminder.status, 'paid');
    assert.equal(Object.prototype.hasOwnProperty.call(paidRegistration.paymentReminder, 'nextReminderAt'), false);

    const closedRegistration = firestore.snapshot('teams/team-1/registrationForms/form-1/registrations/reg-061');
    assert.equal(closedRegistration.paymentReminder.status, 'closed');
    assert.equal(Object.prototype.hasOwnProperty.call(closedRegistration.paymentReminder, 'nextReminderAt'), false);

    const mailCountAfterFirstRun = firestore.countCollection('mail');
    const secondSummary = await queueDueRegistrationFailedPaymentReminders();

    assert.equal(secondSummary.examinedCount, 0);
    assert.equal(secondSummary.queuedCount, 0);
    assert.equal(firestore.countCollection('mail'), mailCountAfterFirstRun);
});
