'use strict';

/**
 * Unit tests for sendCategoryNotification and its internal helpers.
 *
 * We exercise the module without a live Firebase instance by injecting stub
 * db/messaging objects and verifying the call-routing and return values.
 */

const { describe, it, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Minimal Firestore query stub helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake Firestore QuerySnapshot.
 * @param {object[]} docs  array of plain data objects
 */
function makeSnap(docs) {
    const docsList = docs.map((data, i) => ({
        id: `doc-${i}`,
        data: () => data
    }));
    return {
        empty: docsList.length === 0,
        docs: docsList
    };
}

/**
 * Build a fake Firestore collection chain that returns a fixed snapshot.
 *
 * The chain understands: .collection().doc().collection().where().get()
 *
 * @param {Map<string, object[]>} snapshotsByPath
 *   key = "<collectionPath>" (simplified — just the last collection name used),
 *   value = array of doc data objects
 */
function makeDb(collectionSnaps) {
    // collectionSnaps: { 'notificationRecipients': [...docs], 'users': [...docs] }
    function makeQuery(docs) {
        return {
            where() { return this; },
            get() { return Promise.resolve(makeSnap(docs)); }
        };
    }

    function makeCollRef(name) {
        const docs = collectionSnaps[name] || [];
        return {
            where() { return makeQuery(docs); },
            get() { return Promise.resolve(makeSnap(docs)); },
            doc() {
                return {
                    collection(subName) { return makeCollRef(subName); },
                    set() { return Promise.resolve(); }
                };
            }
        };
    }

    const batchCommitSpy = { count: 0 };
    function makeBatch() {
        const ops = [];
        return {
            set(ref, data, opts) { ops.push({ ref, data, opts }); },
            commit() {
                batchCommitSpy.count++;
                return Promise.resolve();
            },
            _ops: ops
        };
    }

    return {
        collection(name) { return makeCollRef(name); },
        batch() { return makeBatch(); },
        _batchCommitSpy: batchCommitSpy
    };
}

/**
 * Build a fake messaging object that records multicast calls.
 * Each call resolves with { successCount, failureCount }.
 */
function makeMessaging(successPerChunk) {
    const calls = [];
    return {
        calls,
        sendEachForMulticast(message) {
            calls.push({ tokens: [...message.tokens] });
            return Promise.resolve({
                successCount: successPerChunk !== undefined ? successPerChunk : message.tokens.length,
                failureCount: 0
            });
        }
    };
}

// ---------------------------------------------------------------------------
// Pull the internal helpers out of the module under test
// ---------------------------------------------------------------------------

// functions/index.js uses `admin` at module-level, so we can't simply
// require() it without a Firebase app.  Instead we extract the internal
// helpers that are exported via exports._internal, by providing a minimal
// shim for `firebase-admin` and `firebase-functions`.
let helpers;
before(() => {
    // Provide stubs so the module can be loaded without a real Firebase env.
    require.cache[require.resolve('firebase-functions')] = {
        id: 'firebase-functions',
        filename: require.resolve('firebase-functions'),
        loaded: true,
        exports: {
            config: () => ({}),
            runWith: () => ({ https: { onRequest: () => {} } }),
            https: { onRequest: () => {} }
        }
    };

    const adminStub = {
        apps: [true], // pretend already initialized so initializeApp is skipped
        initializeApp: () => {},
        firestore: Object.assign(() => ({}), {
            FieldValue: {
                serverTimestamp: () => 'SERVERTIMESTAMP',
                increment: (n) => ({ _inc: n })
            }
        }),
        auth: () => ({ verifyIdToken: () => Promise.resolve(null) }),
        messaging: () => ({})
    };
    require.cache[require.resolve('firebase-admin')] = {
        id: 'firebase-admin',
        filename: require.resolve('firebase-admin'),
        loaded: true,
        exports: adminStub
    };

    // Now we can require the module
    const mod = require('../index.js');
    helpers = mod._internal;
    assert.ok(helpers, 'exports._internal must be present');
});

// ---------------------------------------------------------------------------
// resolveTokensFromIndex
// ---------------------------------------------------------------------------

describe('resolveTokensFromIndex', () => {
    it('returns tokens from index docs that have the category enabled', async () => {
        const db = makeDb({
            notificationRecipients: [
                { uid: 'u1', fcmTokens: ['tok-a', 'tok-b'], categories: { schedule: true } },
                { uid: 'u2', fcmTokens: ['tok-c'], categories: { schedule: true } }
            ]
        });

        const tokens = await helpers.resolveTokensFromIndex(db, 'team-1', 'schedule');
        assert.deepEqual(tokens.sort(), ['tok-a', 'tok-b', 'tok-c'].sort());
    });

    it('returns empty array when index collection is empty', async () => {
        const db = makeDb({ notificationRecipients: [] });
        const tokens = await helpers.resolveTokensFromIndex(db, 'team-1', 'schedule');
        assert.deepEqual(tokens, []);
    });

    it('skips docs with no fcmTokens field', async () => {
        const db = makeDb({
            notificationRecipients: [
                { uid: 'u1', categories: { schedule: true } }
            ]
        });
        const tokens = await helpers.resolveTokensFromIndex(db, 'team-1', 'schedule');
        assert.deepEqual(tokens, []);
    });

    it('filters out non-string entries in fcmTokens', async () => {
        const db = makeDb({
            notificationRecipients: [
                { uid: 'u1', fcmTokens: ['good-token', null, 42, ''], categories: { schedule: true } }
            ]
        });
        const tokens = await helpers.resolveTokensFromIndex(db, 'team-1', 'schedule');
        assert.deepEqual(tokens, ['good-token']);
    });
});

// ---------------------------------------------------------------------------
// resolveRecipientsLegacy
// ---------------------------------------------------------------------------

describe('resolveRecipientsLegacy', () => {
    it('returns users with tokens whose category preference is not false', async () => {
        const db = makeDb({
            users: [
                { fcmTokens: ['tok-1'], notificationPreferences: { schedule: true }, teamIds: ['team-1'] },
                { fcmTokens: ['tok-2'], notificationPreferences: {}, teamIds: ['team-1'] }
            ]
        });
        const recipients = await helpers.resolveRecipientsLegacy(db, 'team-1', 'schedule');
        const allTokens = recipients.flatMap((r) => r.fcmTokens).sort();
        assert.deepEqual(allTokens, ['tok-1', 'tok-2']);
    });

    it('excludes users who explicitly disabled the category', async () => {
        const db = makeDb({
            users: [
                { fcmTokens: ['tok-yes'], notificationPreferences: { schedule: true }, teamIds: ['team-1'] },
                { fcmTokens: ['tok-no'], notificationPreferences: { schedule: false }, teamIds: ['team-1'] }
            ]
        });
        const recipients = await helpers.resolveRecipientsLegacy(db, 'team-1', 'schedule');
        const allTokens = recipients.flatMap((r) => r.fcmTokens);
        assert.deepEqual(allTokens, ['tok-yes']);
    });

    it('excludes users with no fcmTokens', async () => {
        const db = makeDb({
            users: [
                { fcmTokens: [], notificationPreferences: { schedule: true }, teamIds: ['team-1'] },
                { notificationPreferences: { schedule: true }, teamIds: ['team-1'] }
            ]
        });
        const recipients = await helpers.resolveRecipientsLegacy(db, 'team-1', 'schedule');
        assert.equal(recipients.length, 0);
    });
});

// ---------------------------------------------------------------------------
// sendInChunks - 500-token chunking behavior
// ---------------------------------------------------------------------------

describe('sendInChunks', () => {
    it('sends all tokens in a single call when count <= 500', async () => {
        const messaging = makeMessaging();
        const tokens = Array.from({ length: 10 }, (_, i) => `tok-${i}`);
        const result = await helpers.sendInChunks(messaging, tokens, { title: 'Test', body: 'Hi' });
        assert.equal(messaging.calls.length, 1);
        assert.equal(result.successCount, 10);
        assert.equal(result.failureCount, 0);
    });

    it('splits 500 tokens into exactly 1 FCM call', async () => {
        const messaging = makeMessaging();
        const tokens = Array.from({ length: 500 }, (_, i) => `tok-${i}`);
        const result = await helpers.sendInChunks(messaging, tokens, { title: 'T', body: 'B' });
        assert.equal(messaging.calls.length, 1);
        assert.equal(messaging.calls[0].tokens.length, 500);
        assert.equal(result.successCount, 500);
    });

    it('splits 501 tokens into 2 FCM calls', async () => {
        const messaging = makeMessaging();
        const tokens = Array.from({ length: 501 }, (_, i) => `tok-${i}`);
        await helpers.sendInChunks(messaging, tokens, { title: 'T', body: 'B' });
        assert.equal(messaging.calls.length, 2);
        assert.equal(messaging.calls[0].tokens.length, 500);
        assert.equal(messaging.calls[1].tokens.length, 1);
    });

    it('splits 1000 tokens into exactly 2 FCM calls', async () => {
        const messaging = makeMessaging();
        const tokens = Array.from({ length: 1000 }, (_, i) => `tok-${i}`);
        const result = await helpers.sendInChunks(messaging, tokens, { title: 'T', body: 'B' });
        assert.equal(messaging.calls.length, 2);
        assert.equal(result.successCount, 1000);
    });

    it('aggregates successCount and failureCount across chunks', async () => {
        const messaging = makeMessaging(200); // each chunk succeeds with 200
        const tokens = Array.from({ length: 600 }, (_, i) => `tok-${i}`);
        const result = await helpers.sendInChunks(messaging, tokens, { title: 'T', body: 'B' });
        assert.equal(result.successCount, 400); // 200 + 200
        assert.equal(result.failureCount, 0);
    });
});

// ---------------------------------------------------------------------------
// backfillNotificationRecipients
// ---------------------------------------------------------------------------

describe('backfillNotificationRecipients', () => {
    it('writes one batch for recipients under the BATCH_LIMIT', async () => {
        let batchCommitCount = 0;
        let setCallCount = 0;

        const db = {
            collection() {
                return {
                    doc() {
                        return {
                            collection() {
                                return {
                                    doc() {
                                        return {
                                            // ref placeholder
                                        };
                                    }
                                };
                            }
                        };
                    }
                };
            },
            batch() {
                return {
                    set() { setCallCount++; },
                    commit() { batchCommitCount++; return Promise.resolve(); }
                };
            }
        };

        const recipients = [
            { uid: 'u1', fcmTokens: ['t1'] },
            { uid: 'u2', fcmTokens: ['t2', 't3'] }
        ];
        await helpers.backfillNotificationRecipients(db, 'team-1', recipients, 'schedule');
        assert.equal(batchCommitCount, 1);
        assert.equal(setCallCount, 2);
    });
});
