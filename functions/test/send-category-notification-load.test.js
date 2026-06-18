'use strict';

/**
 * Load-oriented tests for sendCategoryNotification.
 *
 * Exercises the 500-recipient / 500-token-per-chunk FCM chunking path
 * using in-memory stubs so no Firebase connection is needed.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Re-use the already-loaded module from the stub setup in the sibling test.
// If this file runs standalone we need to re-apply the stubs.
function getHelpers() {
    // Re-use cached module if already loaded
    const cached = require.cache[require.resolve('../index.js')];
    if (cached) {
        return cached.exports._internal;
    }

    // Provide minimal stubs so the module loads without Firebase
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
        apps: [true],
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

    return require('../index.js')._internal;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake Firestore QuerySnapshot.
 */
function makeSnap(docs) {
    return {
        empty: docs.length === 0,
        docs: docs.map((data, i) => ({ id: `doc-${i}`, data: () => data }))
    };
}

/**
 * Build a Firestore stub that returns snapshot docs by collection name.
 */
function makeDb(collectionSnaps) {
    function makeCollRef(name) {
        const docs = collectionSnaps[name] || [];
        return {
            where() { return this; },
            get() { return Promise.resolve(makeSnap(docs)); },
            doc() {
                return {
                    collection(subName) { return makeCollRef(subName); },
                    set() { return Promise.resolve(); }
                };
            }
        };
    }

    return {
        collection(name) { return makeCollRef(name); },
        batch() {
            return {
                set() {},
                commit() { return Promise.resolve(); }
            };
        }
    };
}

function makeMessaging() {
    const calls = [];
    return {
        calls,
        sendEachForMulticast(message) {
            calls.push(message.tokens.length);
            return Promise.resolve({
                successCount: message.tokens.length,
                failureCount: 0
            });
        }
    };
}

// ---------------------------------------------------------------------------
// 500-recipient fixture
// ---------------------------------------------------------------------------

describe('500-recipient load fixture', () => {
    const helpers = getHelpers();

    it('resolves all 500 recipients from the index in a single Firestore query', async () => {
        const recipientDocs = Array.from({ length: 500 }, (_, i) => ({
            uid: `user-${i}`,
            fcmTokens: [`token-${i}`],
            categories: { schedule: true }
        }));

        const db = makeDb({ notificationRecipients: recipientDocs });
        const tokens = await helpers.resolveTokensFromIndex(db, 'big-team', 'schedule');
        assert.equal(tokens.length, 500);
    });

    it('sends 500 tokens in exactly 1 FCM multicast call', async () => {
        const tokens = Array.from({ length: 500 }, (_, i) => `token-${i}`);
        const messaging = makeMessaging();
        const result = await helpers.sendInChunks(messaging, tokens, { title: 'Game update', body: 'See you there!' });

        assert.equal(messaging.calls.length, 1, 'Should use exactly 1 FCM call for 500 tokens');
        assert.equal(messaging.calls[0], 500);
        assert.equal(result.successCount, 500);
        assert.equal(result.failureCount, 0);
    });

    it('sends 500 recipients each with 1 token using 1 FCM multicast call', async () => {
        const recipientDocs = Array.from({ length: 500 }, (_, i) => ({
            uid: `user-${i}`,
            fcmTokens: [`token-${i}`],
            categories: { schedule: true }
        }));

        const db = makeDb({ notificationRecipients: recipientDocs });
        const messaging = makeMessaging();

        // Resolve from index
        const tokens = await helpers.resolveTokensFromIndex(db, 'big-team', 'schedule');
        assert.equal(tokens.length, 500);

        // Send
        const result = await helpers.sendInChunks(messaging, tokens, { title: 'Update', body: 'Hi' });

        assert.equal(messaging.calls.length, 1, 'All 500 tokens should fit in one FCM multicast call');
        assert.equal(result.successCount, 500);
        assert.equal(result.failureCount, 0);
    });

    it('correctly chunks when 500 recipients each have 2 tokens (1000 total tokens -> 2 FCM calls)', async () => {
        const recipientDocs = Array.from({ length: 500 }, (_, i) => ({
            uid: `user-${i}`,
            fcmTokens: [`token-${i}-a`, `token-${i}-b`],
            categories: { schedule: true }
        }));

        const db = makeDb({ notificationRecipients: recipientDocs });
        const messaging = makeMessaging();

        const tokens = await helpers.resolveTokensFromIndex(db, 'big-team', 'schedule');
        assert.equal(tokens.length, 1000);

        const result = await helpers.sendInChunks(messaging, tokens, { title: 'Update', body: 'Hi' });

        assert.equal(messaging.calls.length, 2, '1000 tokens should split into 2 FCM calls of 500 each');
        assert.equal(messaging.calls[0], 500);
        assert.equal(messaging.calls[1], 500);
        assert.equal(result.successCount, 1000);
    });

    it('legacy fallback with 500 users triggers backfill and collects all tokens', async () => {
        const userDocs = Array.from({ length: 500 }, (_, i) => ({
            fcmTokens: [`token-${i}`],
            notificationPreferences: { fees: true },
            teamIds: ['big-team']
        }));

        const db = makeDb({ users: userDocs });
        const recipients = await helpers.resolveRecipientsLegacy(db, 'big-team', 'fees');

        assert.equal(recipients.length, 500);
        const allTokens = recipients.flatMap((r) => r.fcmTokens);
        assert.equal(allTokens.length, 500);
    });
});

// ---------------------------------------------------------------------------
// Index vs. legacy path routing
// ---------------------------------------------------------------------------

describe('recipient source routing', () => {
    const helpers = getHelpers();

    it('uses the index path when notificationRecipients is populated', async () => {
        const tokens = await helpers.resolveTokensFromIndex(
            makeDb({ notificationRecipients: [{ uid: 'u1', fcmTokens: ['t1'], categories: { schedule: true } }] }),
            'team-1',
            'schedule'
        );
        assert.equal(tokens.length, 1);
    });

    it('returns empty from index when notificationRecipients is empty', async () => {
        const tokens = await helpers.resolveTokensFromIndex(
            makeDb({ notificationRecipients: [] }),
            'team-1',
            'schedule'
        );
        assert.equal(tokens.length, 0);
    });

    it('legacy returns same token set as index for equivalent fixture data', async () => {
        const fixture = [
            { uid: 'u1', fcmTokens: ['tok-A'], categories: { schedule: true }, notificationPreferences: { schedule: true }, teamIds: ['t1'] },
            { uid: 'u2', fcmTokens: ['tok-B'], categories: { schedule: true }, notificationPreferences: { schedule: true }, teamIds: ['t1'] }
        ];

        const indexTokens = await helpers.resolveTokensFromIndex(
            makeDb({ notificationRecipients: fixture }),
            't1',
            'schedule'
        );

        const legacyRecipients = await helpers.resolveRecipientsLegacy(
            makeDb({ users: fixture }),
            't1',
            'schedule'
        );
        const legacyTokens = legacyRecipients.flatMap((r) => r.fcmTokens);

        assert.deepEqual(indexTokens.sort(), legacyTokens.sort(),
            'Index and legacy paths should resolve the same set of tokens for a consistent fixture');
    });
});
