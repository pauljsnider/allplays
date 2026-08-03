import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import Module from 'node:module';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

function makeFunctionsStub() {
    const triggerChain = {
        onCall: (fn) => fn,
        onRequest: (fn) => fn,
        onCreate: (fn) => fn,
        onUpdate: (fn) => fn,
        onWrite: (fn) => fn,
        onDelete: (fn) => fn,
        onRun: (fn) => fn,
        onFinalize: (fn) => fn,
        document() {
            return this;
        },
        schedule() {
            return this;
        },
        timeZone() {
            return this;
        },
        region() {
            return this;
        },
        user() {
            return this;
        },
        object() {
            return this;
        }
    };
    triggerChain.https = triggerChain;
    triggerChain.auth = triggerChain;
    triggerChain.firestore = triggerChain;
    triggerChain.pubsub = triggerChain;
    triggerChain.storage = triggerChain;

    return {
        config: () => ({}),
        https: {
            onCall: (fn) => fn,
            onRequest: (fn) => fn,
            HttpsError: class HttpsError extends Error {}
        },
        firestore: {
            document: () => triggerChain
        },
        pubsub: {
            schedule: () => triggerChain
        },
        storage: {
            object: () => triggerChain
        },
        auth: {
            user: () => triggerChain
        },
        runWith: () => triggerChain,
        region: () => triggerChain,
        logger: {
            info: () => {},
            warn: () => {},
            error: () => {}
        }
    };
}

function makeDocSnapshot(ref, data, exists = true) {
    return {
        id: ref.id,
        ref,
        exists,
        data: () => (data == null ? data : JSON.parse(JSON.stringify(data)))
    };
}

function makeQuerySnapshot(docSnaps) {
    return {
        empty: docSnaps.length === 0,
        size: docSnaps.length,
        docs: docSnaps,
        forEach(callback) {
            docSnaps.forEach(callback);
        }
    };
}

function makeChange(ref, beforeData, afterData) {
    return {
        before: makeDocSnapshot(ref, beforeData, beforeData != null),
        after: makeDocSnapshot(ref, afterData, afterData != null)
    };
}

function loadNotificationRecipientIndexEnv({
    teamDocs = {},
    userDocs = {},
    preferenceDocs = {},
    deviceDocs = {},
    authUsersByEmail = {},
    authUsersByUid = {},
    initialProjectionDocs = {},
    initialRecipientDocs = {},
    deleteFailuresByPath = {},
    maxBatchCommitOps = 450,
    teamDocGetDelayMs = 0
} = {}) {
    const deletedPaths = [];
    const batchCommitSizes = [];
    const remainingDeleteFailures = new Map(Object.entries(deleteFailuresByPath));
    let activeTeamDocGets = 0;
    let maxActiveTeamDocGets = 0;
    const docStore = new Map();

    for (const [path, value] of Object.entries(initialRecipientDocs)) {
        docStore.set(path, JSON.parse(JSON.stringify(value)));
    }
    for (const [path, value] of Object.entries(initialProjectionDocs)) {
        docStore.set(path, JSON.parse(JSON.stringify(value)));
    }

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function mergeStoredDoc(path, value) {
        const current = docStore.get(path) || {};
        docStore.set(path, {
            ...clone(current),
            ...clone(value)
        });
    }

    function getDeviceEntry(uid, deviceId) {
        return (deviceDocs[uid] || []).find((entry) => String(entry.id || '').trim() === String(deviceId || '').trim()) || null;
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function doc(path) {
        return {
            path,
            id: String(path).split('/').pop(),
            async get() {
                if (docStore.has(path)) {
                    return makeDocSnapshot(this, docStore.get(path), true);
                }

                const teamMatch = path.match(/^teams\/([^/]+)$/);
                if (teamMatch) {
                    activeTeamDocGets += 1;
                    maxActiveTeamDocGets = Math.max(maxActiveTeamDocGets, activeTeamDocGets);
                    if (teamDocGetDelayMs > 0) {
                        await delay(teamDocGetDelayMs);
                    }
                    activeTeamDocGets -= 1;
                    const team = teamDocs[teamMatch[1]];
                    return makeDocSnapshot(this, team, team !== undefined);
                }

                const userMatch = path.match(/^users\/([^/]+)$/);
                if (userMatch) {
                    const user = userDocs[userMatch[1]];
                    return makeDocSnapshot(this, user, user !== undefined);
                }

                const prefMatch = path.match(/^users\/([^/]+)\/notificationPreferences\/([^/]+)$/);
                if (prefMatch) {
                    const value = preferenceDocs[path];
                    return makeDocSnapshot(this, value, value !== undefined);
                }

                const deviceMatch = path.match(/^users\/([^/]+)\/notificationDevices\/([^/]+)$/);
                if (deviceMatch) {
                    const value = getDeviceEntry(deviceMatch[1], deviceMatch[2]);
                    return makeDocSnapshot(this, value, value !== null);
                }

                return makeDocSnapshot(this, undefined, false);
            },
            async set(value, options = {}) {
                if (options.merge) {
                    mergeStoredDoc(path, value);
                } else {
                    docStore.set(path, clone(value));
                }
            },
            async update(value) {
                mergeStoredDoc(path, value);
            },
            async delete() {
                const remainingFailures = Number(remainingDeleteFailures.get(path) || 0);
                if (remainingFailures > 0) {
                    remainingDeleteFailures.set(path, remainingFailures - 1);
                    throw new Error(`temporary delete failure for ${path}`);
                }
                deletedPaths.push(path);
                docStore.delete(path);
            },
            collection(name) {
                return collection(`${path}/${name}`);
            }
        };
    }

    function collection(path) {
        if (path === 'teams') {
            const teamQuery = {
                where(field, op, value) {
                    return {
                        async get() {
                            const docs = Object.entries(teamDocs)
                                .filter(([, team]) => {
                                    if (field === 'ownerId' && op === '==') {
                                        return String(team?.ownerId || '').trim() === String(value || '').trim();
                                    }
                                    if (field === 'adminEmails' && op === 'array-contains') {
                                        const emails = Array.isArray(team?.adminEmails) ? team.adminEmails : [];
                                        return emails.includes(value);
                                    }
                                    return false;
                                })
                                .map(([teamId, team]) => makeDocSnapshot(doc(`teams/${teamId}`), team, true));
                            return makeQuerySnapshot(docs);
                        }
                    };
                },
                select() {
                    return teamQuery;
                },
                orderBy() {
                    return teamQuery;
                },
                limit() {
                    return teamQuery;
                },
                startAfter() {
                    return teamQuery;
                },
                async get() {
                    return makeQuerySnapshot(
                        Object.entries(teamDocs).map(([teamId, team]) => makeDocSnapshot(doc(`teams/${teamId}`), team, true))
                    );
                }
            };
            return teamQuery;
        }

        if (path === 'publicProfileStaffMemberships') {
            return {
                where(field, op, value) {
                    return {
                        async get() {
                            const prefix = `${path}/`;
                            const docs = [...docStore.entries()]
                                .filter(([storedPath, membership]) => (
                                    storedPath.startsWith(prefix)
                                    && op === '=='
                                    && String(membership?.[field] || '').trim() === String(value || '').trim()
                                ))
                                .map(([storedPath, membership]) => (
                                    makeDocSnapshot(doc(storedPath), membership, true)
                                ));
                            return makeQuerySnapshot(docs);
                        }
                    };
                }
            };
        }

        if (path === 'publicUserProfiles') {
            const query = {
                orderBy() {
                    return query;
                },
                limit() {
                    return query;
                },
                startAfter() {
                    return query;
                },
                async get() {
                    const prefix = `${path}/`;
                    return makeQuerySnapshot(
                        [...docStore.entries()]
                            .filter(([storedPath]) => storedPath.startsWith(prefix))
                            .map(([storedPath, value]) => (
                                makeDocSnapshot(doc(storedPath), value, true)
                            ))
                    );
                }
            };
            return query;
        }

        if (path === 'users') {
            return {
                where(field, op, value) {
                    return {
                        async get() {
                            const docs = Object.entries(userDocs)
                                .filter(([, user]) => field === 'parentTeamIds' && op === 'array-contains' && Array.isArray(user?.parentTeamIds) && user.parentTeamIds.includes(value))
                                .map(([uid, user]) => makeDocSnapshot(doc(`users/${uid}`), user, true));
                            return makeQuerySnapshot(docs);
                        }
                    };
                }
            };
        }

        const deviceMatch = path.match(/^users\/([^/]+)\/notificationDevices$/);
        if (deviceMatch) {
            const uid = deviceMatch[1];
            return {
                async get() {
                    return makeQuerySnapshot((deviceDocs[uid] || []).map((entry, index) => {
                        const deviceId = entry.id || `device-${index}`;
                        return makeDocSnapshot(doc(`${path}/${deviceId}`), entry, true);
                    }));
                }
            };
        }

        const prefCollectionMatch = path.match(/^users\/([^/]+)\/notificationPreferences$/);
        if (prefCollectionMatch) {
            const uid = prefCollectionMatch[1];
            return {
                async get() {
                    const docs = Object.entries(preferenceDocs)
                        .filter(([prefPath]) => prefPath.startsWith(`users/${uid}/notificationPreferences/`))
                        .map(([prefPath, value]) => makeDocSnapshot(doc(prefPath), value, true));
                    return makeQuerySnapshot(docs);
                }
            };
        }

        const recipientMatch = path.match(/^teams\/([^/]+)\/notificationRecipients$/);
        if (recipientMatch) {
            const teamId = recipientMatch[1];
            const prefix = `${path}/`;
            const recipientEntries = [...docStore.entries()]
                .filter(([storedPath]) => storedPath.startsWith(prefix))
                .map(([storedPath, value]) => ({ storedPath, value }));
            return {
                where(field, op, value) {
                    return {
                        async get() {
                            const docs = recipientEntries
                                .filter(({ value: recipient }) => {
                                    if (op !== '==') return false;
                                    if (field === 'uid') {
                                        return String(recipient?.uid || '').trim() === String(value || '').trim();
                                    }
                                    const category = String(field || '').replace(/^categories\./, '');
                                    return value === true && recipient?.categories?.[category] === true;
                                })
                                .map(({ storedPath, value: recipient }) => makeDocSnapshot(doc(storedPath), recipient, true));
                            return makeQuerySnapshot(docs);
                        }
                    };
                },
                limit(size) {
                    return {
                        async get() {
                            return makeQuerySnapshot(recipientEntries.slice(0, size).map(({ storedPath, value }) => makeDocSnapshot(doc(storedPath), value, true)));
                        }
                    };
                },
                async get() {
                    return makeQuerySnapshot(recipientEntries.map(({ storedPath, value }) => makeDocSnapshot(doc(storedPath), value, true)));
                }
            };
        }

        const targetMatch = path.match(/^teams\/([^/]+)\/notificationTargets$/);
        if (targetMatch) {
            return {
                async get() {
                    return makeQuerySnapshot([]);
                }
            };
        }

        return {
            where() {
                return {
                    async get() {
                        return makeQuerySnapshot([]);
                    }
                };
            },
            limit() {
                return {
                    async get() {
                        return makeQuerySnapshot([]);
                    }
                };
            },
            async get() {
                return makeQuerySnapshot([]);
            },
            doc(id) {
                return doc(`${path}/${id}`);
            },
            async add() {
                return { id: 'noop' };
            },
            orderBy() {
                return {
                    offset() {
                        return {
                            async get() {
                                return makeQuerySnapshot([]);
                            }
                        };
                    }
                };
            }
        };
    }

    function collectionGroup(collectionName) {
        if (collectionName !== 'notificationRecipients') {
            return {
                where() {
                    return {
                        async get() {
                            return makeQuerySnapshot([]);
                        }
                    };
                }
            };
        }

        return {
            where(field, op, value) {
                return {
                    async get() {
                        const docs = [...docStore.entries()]
                            .filter(([storedPath, recipient]) => (
                                /^teams\/[^/]+\/notificationRecipients\/[^/]+$/.test(storedPath)
                                && field === 'uid'
                                && op === '=='
                                && String(recipient?.uid || '').trim() === String(value || '').trim()
                            ))
                            .map(([storedPath, recipient]) => (
                                makeDocSnapshot(doc(storedPath), recipient, true)
                            ));
                        return makeQuerySnapshot(docs);
                    }
                };
            }
        };
    }

    const firestoreState = {
        doc,
        collection,
        collectionGroup,
        async getAll(...refs) {
            return Promise.all(refs.map((ref) => ref.get()));
        },
        async runTransaction(handler) {
            return handler({
                get: (ref) => ref.get(),
                set: (ref, value, options = {}) => ref.set(value, options),
                update: (ref, value) => ref.update(value)
            });
        },
        batch() {
            const ops = [];
            return {
                set(ref, value, options = {}) {
                    ops.push(() => ref.set(value, options));
                },
                delete(ref) {
                    ops.push(() => ref.delete());
                },
                update(ref, value) {
                    ops.push(() => ref.update(value));
                },
                async commit() {
                    batchCommitSizes.push(ops.length);
                    assert.ok(
                        ops.length <= maxBatchCommitOps,
                        `Firestore batch exceeded safe test limit: ${ops.length} > ${maxBatchCommitOps}`
                    );
                    for (const op of ops) {
                        await op();
                    }
                }
            };
        }
    };

    const firestoreFactory = Object.assign(() => firestoreState, {
        FieldValue: {
            serverTimestamp: () => ({ __serverTimestamp: true }),
            delete: () => ({ __delete: true })
        },
        FieldPath: {
            documentId: () => '__name__'
        },
        Timestamp: {
            now: () => ({ toMillis: () => Date.now() })
        }
    });

    const adminStub = {
        apps: [true],
        initializeApp: () => {},
        firestore: firestoreFactory,
        auth: () => ({
            getUser: async (uid) => {
                const configured = authUsersByUid[uid];
                if (configured instanceof Error) throw configured;
                if (configured) return { uid, ...clone(configured) };
                const user = userDocs[uid];
                if (user) {
                    return {
                        uid,
                        email: user.email || user.profileEmail || null,
                        emailVerified: true
                    };
                }
                const error = new Error('Auth user not found');
                error.code = 'auth/user-not-found';
                throw error;
            },
            getUserByEmail: async (email) => {
                const uid = authUsersByEmail[String(email || '').trim().toLowerCase()];
                return uid ? { uid } : { uid: '' };
            },
            verifyIdToken: async () => null
        }),
        messaging: () => ({
            async sendEachForMulticast() {
                return { responses: [], successCount: 0, failureCount: 0 };
            }
        }),
        storage: () => ({
            bucket: () => ({ file: () => ({}) })
        })
    };

    const stripeStub = class StripeStub {
        constructor() {
            return {};
        }
    };

    Module._load = function patchedModuleLoad(request, parent, isMain) {
        if (request === 'firebase-admin') {
            return adminStub;
        }
        if (request === 'firebase-functions') {
            return makeFunctionsStub();
        }
        if (request === 'stripe') {
            return stripeStub;
        }
        return originalModuleLoad(request, parent, isMain);
    };

    delete require.cache[repoIndexPath];
    const moduleExports = require(repoIndexPath);

    return {
        moduleExports,
        internals: moduleExports._internal,
        deletedPaths,
        batchCommitSizes,
        getMaxActiveTeamDocGets() {
            return maxActiveTeamDocGets;
        },
        getDoc(path) {
            return clone(docStore.get(path));
        },
        getDocs(prefix) {
            return [...docStore.entries()]
                .filter(([path]) => path.startsWith(prefix))
                .map(([path, value]) => [path, clone(value)]);
        },
        cleanup() {
            delete require.cache[repoIndexPath];
            Module._load = originalModuleLoad;
        }
    };
}

test('preference writes update the aggregated notificationRecipients doc', async () => {
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-1': { ownerId: 'coach-1', adminEmails: [] }
        },
        userDocs: {
            'parent-1': { email: 'parent@example.com', parentTeamIds: ['team-1'] }
        },
        preferenceDocs: {
            'users/parent-1/notificationPreferences/team-1': { schedule: false, liveChat: true }
        },
        deviceDocs: {
            'parent-1': [
                { id: 'device-a', token: 'token-a', platform: 'ios' },
                { id: 'device-b', token: 'token-b', platform: 'web', userAgent: 'Safari' }
            ]
        },
        initialRecipientDocs: {
            'teams/team-1/notificationRecipients/parent-1__device-a': {
                uid: 'parent-1',
                teamId: 'team-1',
                deviceId: 'device-a',
                token: 'token-a',
                categories: { liveChat: true }
            }
        }
    });

    try {
        await env.moduleExports.syncTeamNotificationRecipientsOnPreferenceWrite(
            makeChange(
                { id: 'team-1', path: 'users/parent-1/notificationPreferences/team-1' },
                null,
                { schedule: false, liveChat: true }
            ),
            { params: { uid: 'parent-1', teamId: 'team-1' } }
        );

        assert.deepEqual(env.getDoc('teams/team-1/notificationRecipients/parent-1'), {
            uid: 'parent-1',
            teamId: 'team-1',
            roles: ['parent'],
            categories: {
                liveChat: true,
                mentions: true,
                liveScore: false,
                gameDay: false,
                schedule: false,
                rsvp: true,
                fees: true,
                practice: false,
                access: true,
                rideshare: true,
                media: false,
                awards: false,
                officiating: false
            },
            tokens: [
                { deviceId: 'device-a', token: 'token-a', platform: 'ios', userAgent: '' },
                { deviceId: 'device-b', token: 'token-b', platform: 'web', userAgent: 'Safari' }
            ],
            updatedAt: { __serverTimestamp: true }
        });
        assert.equal(env.getDoc('teams/team-1/notificationRecipients/parent-1__device-a'), undefined);
        assert.ok(env.deletedPaths.includes('teams/team-1/notificationRecipients/parent-1__device-a'));
    } finally {
        env.cleanup();
    }
});

test('backfill sync preserves legacy recipient docs when skipLegacyCleanup is enabled', async () => {
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-1': { ownerId: 'coach-1', adminEmails: [] }
        },
        userDocs: {
            'parent-1': { email: 'parent@example.com', parentTeamIds: ['team-1'] }
        },
        preferenceDocs: {
            'users/parent-1/notificationPreferences/team-1': { schedule: true }
        },
        deviceDocs: {
            'parent-1': [
                { id: 'device-a', token: 'token-a', platform: 'ios' }
            ]
        },
        initialRecipientDocs: {
            'teams/team-1/notificationRecipients/parent-1__device-a': {
                uid: 'parent-1',
                teamId: 'team-1',
                deviceId: 'device-a',
                token: 'token-a',
                categories: { schedule: true }
            }
        }
    });

    try {
        const result = await env.internals.syncNotificationRecipientForTeamUser('team-1', 'parent-1', {
            skipLegacyCleanup: true
        });

        assert.deepEqual(result, {
            uid: 'parent-1',
            teamId: 'team-1',
            roles: ['parent'],
            tokenCount: 1
        });
        assert.equal(env.getDoc('teams/team-1/notificationRecipients/parent-1__device-a')?.token, 'token-a');
        assert.deepEqual(env.deletedPaths, []);
        assert.equal(env.getDoc('teams/team-1/notificationRecipients/parent-1')?.uid, 'parent-1');
    } finally {
        env.cleanup();
    }
});

test('sync keeps opted-in users indexed when they have no push devices', async () => {
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-1': { ownerId: 'coach-1', adminEmails: [] }
        },
        userDocs: {
            'parent-1': { email: 'parent@example.com', parentTeamIds: ['team-1'] }
        },
        preferenceDocs: {
            'users/parent-1/notificationPreferences/team-1': { schedule: true }
        }
    });

    try {
        const result = await env.internals.syncNotificationRecipientForTeamUser('team-1', 'parent-1');

        assert.deepEqual(result, {
            uid: 'parent-1',
            teamId: 'team-1',
            roles: ['parent'],
            tokenCount: 0
        });
        assert.deepEqual(env.getDoc('teams/team-1/notificationRecipients/parent-1')?.tokens, []);
        assert.equal(env.getDoc('teams/team-1/notificationRecipients/parent-1')?.categories?.schedule, true);
    } finally {
        env.cleanup();
    }
});

test('Auth identity reconciliation removes former staff notifications despite a stale user email', async () => {
    const recipientPath = 'teams/team-1/notificationRecipients/admin-1';
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-1': { ownerId: 'owner-1', adminEmails: ['old-admin@example.com'] }
        },
        userDocs: {
            'admin-1': { email: 'old-admin@example.com' }
        },
        initialRecipientDocs: {
            [recipientPath]: {
                uid: 'admin-1',
                teamId: 'team-1',
                roles: ['staff'],
                categories: { schedule: true },
                tokens: []
            }
        }
    });

    try {
        const result = await env.internals.syncNotificationRecipientForTeamUser(
            'team-1',
            'admin-1',
            { authEmail: 'new-admin@example.com' }
        );

        assert.equal(result, null);
        assert.equal(env.getDoc(recipientPath), undefined);
        assert.ok(env.deletedPaths.includes(recipientPath));
    } finally {
        env.cleanup();
    }
});

test('ineligible Auth cleanup removes an owner recipient while team and user records remain', async () => {
    const recipientPath = 'teams/team-1/notificationRecipients/owner-1';
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-1': { ownerId: 'owner-1', adminEmails: [] }
        },
        userDocs: {
            'owner-1': { email: 'owner@example.com' }
        },
        initialRecipientDocs: {
            [recipientPath]: {
                uid: 'owner-1',
                teamId: 'team-1',
                roles: ['staff'],
                categories: { schedule: true },
                tokens: []
            }
        }
    });

    try {
        const result = await env.internals.syncNotificationRecipientForTeamUser(
            'team-1',
            'owner-1',
            { forceRemove: true }
        );

        assert.equal(result, null);
        assert.equal(env.getDoc(recipientPath), undefined);
        assert.ok(env.deletedPaths.includes(recipientPath));
    } finally {
        env.cleanup();
    }
});

test('callable ineligible cleanup removes parent recipients before its retry anchors', async () => {
    const userId = 'owner-1';
    const recipientPath = `teams/team-1/notificationRecipients/${userId}`;
    const parentRecipientPath = `teams/team-parent/notificationRecipients/${userId}`;
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-1': { ownerId: userId, adminEmails: [] },
            'team-parent': { ownerId: 'other-owner', adminEmails: [] }
        },
        userDocs: {
            [userId]: {
                email: 'owner@example.com',
                parentTeamIds: ['team-parent']
            }
        },
        authUsersByUid: {
            [userId]: { email: 'owner@example.com', emailVerified: false }
        },
        initialProjectionDocs: {
            [`publicUserProfiles/${userId}`]: { discoveryTeamIds: ['team-1'] },
            [`publicProfileAuthIdentities/${userId}`]: { email: 'owner@example.com' },
            [`publicProfileStaffMemberships/team-1-owner-1`]: { teamId: 'team-1', userId }
        },
        initialRecipientDocs: {
            [recipientPath]: { uid: userId, teamId: 'team-1', roles: ['staff'], tokens: [] },
            [parentRecipientPath]: { uid: userId, teamId: 'team-parent', roles: ['parent'], tokens: [] }
        },
        deleteFailuresByPath: {
            [parentRecipientPath]: 1
        }
    });

    try {
        await assert.rejects(
            env.moduleExports.syncPublicUserProfileProjection(
                { userId },
                { auth: { uid: userId, token: {} } }
            ),
            /temporary delete failure/
        );
        assert.ok(env.getDoc(`publicUserProfiles/${userId}`));
        assert.ok(env.getDoc(`publicProfileAuthIdentities/${userId}`));
        assert.ok(env.getDoc(`publicProfileStaffMemberships/team-1-owner-1`));
        assert.ok(env.getDoc(parentRecipientPath));

        await env.moduleExports.syncPublicUserProfileProjection(
            { userId },
            { auth: { uid: userId, token: {} } }
        );
        assert.equal(env.getDoc(recipientPath), undefined);
        assert.equal(env.getDoc(parentRecipientPath), undefined);
        assert.equal(env.getDoc(`publicProfileStaffMemberships/team-1-owner-1`), undefined);
        assert.equal(env.getDoc(`publicProfileAuthIdentities/${userId}`), undefined);
        assert.equal(env.getDoc(`publicUserProfiles/${userId}`), undefined);
    } finally {
        env.cleanup();
    }
});

test('scheduled ineligible sweep retries parent-recipient cleanup before deleting its profile anchor', async () => {
    const userId = 'parent-1';
    const recipientPath = `teams/team-parent/notificationRecipients/${userId}`;
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-parent': { ownerId: 'other-owner', adminEmails: [] }
        },
        userDocs: {
            [userId]: {
                email: 'parent@example.com',
                parentTeamIds: ['team-parent']
            }
        },
        authUsersByUid: {
            [userId]: {
                email: 'parent@example.com',
                emailVerified: false
            }
        },
        initialProjectionDocs: {
            [`publicUserProfiles/${userId}`]: { discoveryTeamIds: ['team-parent'] },
            [`publicProfileAuthIdentities/${userId}`]: { email: 'parent@example.com' }
        },
        initialRecipientDocs: {
            [recipientPath]: {
                uid: userId,
                teamId: 'team-parent',
                roles: ['parent'],
                tokens: [{ deviceId: 'device-a', token: 'token-a' }]
            }
        },
        deleteFailuresByPath: {
            [recipientPath]: 1
        }
    });

    try {
        await assert.rejects(
            env.moduleExports.sweepIneligiblePublicUserProfiles(),
            /temporary delete failure/
        );
        assert.ok(env.getDoc(`publicUserProfiles/${userId}`));
        assert.ok(env.getDoc(`publicProfileAuthIdentities/${userId}`));
        assert.ok(env.getDoc(recipientPath));

        await env.moduleExports.sweepIneligiblePublicUserProfiles();
        assert.equal(env.getDoc(recipientPath), undefined);
        assert.equal(env.getDoc(`publicProfileAuthIdentities/${userId}`), undefined);
        assert.equal(env.getDoc(`publicUserProfiles/${userId}`), undefined);
    } finally {
        env.cleanup();
    }
});

test('Auth-delete cleanup retries indexed parent recipients before deleting profile state', async () => {
    const userId = 'parent-1';
    const recipientPath = `teams/team-parent/notificationRecipients/${userId}`;
    const env = loadNotificationRecipientIndexEnv({
        userDocs: {
            [userId]: {
                email: 'parent@example.com',
                parentTeamIds: ['team-parent']
            }
        },
        initialProjectionDocs: {
            [`publicUserProfiles/${userId}`]: { discoveryTeamIds: ['team-parent'] },
            [`publicProfileAuthIdentities/${userId}`]: { email: 'parent@example.com' }
        },
        initialRecipientDocs: {
            [recipientPath]: {
                uid: userId,
                teamId: 'team-parent',
                roles: ['parent'],
                tokens: [{ deviceId: 'device-a', token: 'token-a' }]
            }
        },
        deleteFailuresByPath: {
            [recipientPath]: 1
        }
    });

    try {
        await assert.rejects(
            env.moduleExports.cleanupPublicUserProfileOnAuthDelete({ uid: userId }),
            /temporary delete failure/
        );
        assert.ok(env.getDoc(`publicUserProfiles/${userId}`));
        assert.ok(env.getDoc(`publicProfileAuthIdentities/${userId}`));
        assert.ok(env.getDoc(recipientPath));

        await env.moduleExports.cleanupPublicUserProfileOnAuthDelete({ uid: userId });
        assert.equal(env.getDoc(recipientPath), undefined);
        assert.equal(env.getDoc(`publicProfileAuthIdentities/${userId}`), undefined);
        assert.equal(env.getDoc(`publicUserProfiles/${userId}`), undefined);
    } finally {
        env.cleanup();
    }
});

test('private-user deletion keeps its public-profile anchor until parent recipients are removed', async () => {
    const userId = 'parent-1';
    const recipientPath = `teams/team-parent/notificationRecipients/${userId}`;
    const env = loadNotificationRecipientIndexEnv({
        initialProjectionDocs: {
            [`publicUserProfiles/${userId}`]: { discoveryTeamIds: ['team-parent'] },
            [`publicProfileAuthIdentities/${userId}`]: { email: 'parent@example.com' },
            [`publicProfileStaffMemberships/team-staff-parent-1`]: {
                userId,
                teamId: 'team-staff'
            }
        },
        initialRecipientDocs: {
            [recipientPath]: {
                uid: userId,
                teamId: 'team-parent',
                roles: ['parent'],
                tokens: [{ deviceId: 'device-a', token: 'token-a' }]
            }
        },
        deleteFailuresByPath: {
            [recipientPath]: 1
        }
    });
    const userRef = {
        id: userId,
        path: `users/${userId}`
    };
    const deletionChange = makeChange(
        userRef,
        {
            email: 'parent@example.com',
            parentTeamIds: ['team-parent']
        },
        null
    );

    try {
        await assert.rejects(
            env.moduleExports.syncPublicUserProfileOnUserWrite(
                deletionChange,
                { params: { uid: userId } }
            ),
            /temporary delete failure/
        );
        assert.ok(env.getDoc(`publicUserProfiles/${userId}`));
        assert.ok(env.getDoc(`publicProfileAuthIdentities/${userId}`));
        assert.ok(env.getDoc(`publicProfileStaffMemberships/team-staff-parent-1`));
        assert.ok(env.getDoc(recipientPath));

        await env.moduleExports.syncPublicUserProfileOnUserWrite(
            deletionChange,
            { params: { uid: userId } }
        );
        assert.equal(env.getDoc(recipientPath), undefined);
        assert.equal(env.getDoc(`publicProfileStaffMemberships/team-staff-parent-1`), undefined);
        assert.equal(env.getDoc(`publicProfileAuthIdentities/${userId}`), undefined);
        assert.equal(env.getDoc(`publicUserProfiles/${userId}`), undefined);
    } finally {
        env.cleanup();
    }
});

test('pre-provisioned admin signup immediately projects discovery and notification membership', async () => {
    const user = {
        displayName: 'New Admin',
        email: 'new-admin@example.com',
        lastLogin: 'now'
    };
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-pre-provisioned': {
                ownerId: 'owner-1',
                adminEmails: ['New-Admin@Example.com']
            }
        },
        userDocs: {
            'admin-1': user
        },
        authUsersByUid: {
            'admin-1': {
                email: 'new-admin@example.com',
                emailVerified: true,
                displayName: 'New Admin'
            }
        }
    });

    try {
        await env.moduleExports.syncPublicUserProfileOnUserWrite(
            makeChange(
                { id: 'admin-1', path: 'users/admin-1' },
                null,
                user
            ),
            { params: { uid: 'admin-1' } }
        );

        assert.deepEqual(
            env.getDoc('publicUserProfiles/admin-1')?.discoveryTeamIds,
            ['team-pre-provisioned']
        );
        assert.equal(
            env.getDoc('publicProfileAuthIdentities/admin-1')?.email,
            'new-admin@example.com'
        );
        assert.deepEqual(
            env.getDocs('publicProfileStaffMemberships/').map(([, value]) => ({
                teamId: value.teamId,
                userId: value.userId
            })),
            [{ teamId: 'team-pre-provisioned', userId: 'admin-1' }]
        );
        assert.deepEqual(
            env.getDoc('teams/team-pre-provisioned/notificationRecipients/admin-1')?.roles,
            ['staff']
        );
    } finally {
        env.cleanup();
    }
});

test('routine user writes immediately swap old and new Auth-email discovery and notifications', async () => {
    const staleUser = {
        displayName: 'Admin',
        email: 'old-admin@example.com',
        lastLogin: 'before'
    };
    const currentUser = {
        ...staleUser,
        lastLogin: 'after'
    };
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-old': {
                ownerId: 'owner-old',
                adminEmails: ['old-admin@example.com']
            },
            'team-new': {
                ownerId: 'owner-new',
                adminEmails: ['NEW-ADMIN@example.com']
            }
        },
        userDocs: {
            'admin-1': currentUser
        },
        authUsersByUid: {
            'admin-1': {
                email: 'new-admin@example.com',
                emailVerified: true,
                displayName: 'Admin'
            }
        },
        initialProjectionDocs: {
            'publicUserProfiles/admin-1': {
                displayName: 'Admin',
                discoveryTeamIds: ['team-old']
            },
            'publicProfileAuthIdentities/admin-1': {
                email: 'old-admin@example.com'
            },
            'publicProfileStaffMemberships/old-membership': {
                teamId: 'team-old',
                userId: 'admin-1'
            }
        },
        initialRecipientDocs: {
            'teams/team-old/notificationRecipients/admin-1': {
                uid: 'admin-1',
                teamId: 'team-old',
                roles: ['staff'],
                categories: { schedule: true },
                tokens: []
            }
        }
    });

    try {
        await env.moduleExports.syncPublicUserProfileOnUserWrite(
            makeChange(
                { id: 'admin-1', path: 'users/admin-1' },
                staleUser,
                currentUser
            ),
            { params: { uid: 'admin-1' } }
        );

        assert.deepEqual(
            env.getDoc('publicUserProfiles/admin-1')?.discoveryTeamIds,
            ['team-new']
        );
        assert.equal(env.getDoc('publicProfileAuthIdentities/admin-1')?.email, 'new-admin@example.com');
        assert.deepEqual(
            env.getDocs('publicProfileStaffMemberships/').map(([, value]) => value.teamId),
            ['team-new']
        );
        assert.equal(env.getDoc('teams/team-old/notificationRecipients/admin-1'), undefined);
        assert.deepEqual(
            env.getDoc('teams/team-new/notificationRecipients/admin-1')?.roles,
            ['staff']
        );
    } finally {
        env.cleanup();
    }
});

test('device notification refresh cannot recreate a former Auth-email staff recipient', async () => {
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-old': {
                ownerId: 'owner-old',
                adminEmails: ['old-admin@example.com']
            },
            'team-new': {
                ownerId: 'owner-new',
                adminEmails: ['new-admin@example.com']
            }
        },
        userDocs: {
            'admin-1': { email: 'old-admin@example.com' }
        },
        authUsersByUid: {
            'admin-1': {
                email: 'new-admin@example.com',
                emailVerified: true
            }
        },
        deviceDocs: {
            'admin-1': [{ id: 'device-1', token: 'token-1', platform: 'web' }]
        },
        initialProjectionDocs: {
            'publicProfileAuthIdentities/admin-1': {
                email: 'old-admin@example.com'
            },
            'publicProfileStaffMemberships/old-membership': {
                teamId: 'team-old',
                userId: 'admin-1'
            }
        },
        initialRecipientDocs: {
            'teams/team-old/notificationRecipients/admin-1': {
                uid: 'admin-1',
                teamId: 'team-old',
                roles: ['staff'],
                categories: { schedule: true },
                tokens: []
            }
        }
    });

    try {
        await env.moduleExports.syncTeamNotificationRecipientsOnDeviceWrite(
            makeChange(
                {
                    id: 'device-1',
                    path: 'users/admin-1/notificationDevices/device-1'
                },
                null,
                { token: 'token-1', platform: 'web' }
            ),
            { params: { uid: 'admin-1', deviceId: 'device-1' } }
        );

        assert.equal(env.getDoc('teams/team-old/notificationRecipients/admin-1'), undefined);
        assert.deepEqual(
            env.getDoc('teams/team-new/notificationRecipients/admin-1')?.roles,
            ['staff']
        );
        assert.equal(env.getDoc('publicProfileAuthIdentities/admin-1')?.email, 'new-admin@example.com');
    } finally {
        env.cleanup();
    }
});

test('device writes refresh token lists for every team the user belongs to', async () => {
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-1': { ownerId: 'coach-1', adminEmails: [] },
            'team-2': { ownerId: 'coach-2', adminEmails: ['assistant@example.com'] }
        },
        userDocs: {
            'parent-1': { email: 'assistant@example.com', parentTeamIds: ['team-1'] }
        },
        deviceDocs: {
            'parent-1': [
                { id: 'device-a', token: 'token-a', platform: 'ios' },
                { id: 'device-b', token: 'token-b', platform: 'android' }
            ]
        }
    });

    try {
        await env.moduleExports.syncTeamNotificationRecipientsOnDeviceWrite(
            makeChange(
                { id: 'device-b', path: 'users/parent-1/notificationDevices/device-b' },
                null,
                { token: 'token-b', platform: 'android' }
            ),
            { params: { uid: 'parent-1', deviceId: 'device-b' } }
        );

        assert.equal(env.getDoc('teams/team-1/notificationRecipients/parent-1')?.tokens?.length, 2);
        assert.deepEqual(env.getDoc('teams/team-2/notificationRecipients/parent-1')?.roles, ['staff']);
        assert.deepEqual(env.getDoc('teams/team-2/notificationRecipients/parent-1')?.tokens?.map((entry) => entry.token).sort(), ['token-a', 'token-b']);
    } finally {
        env.cleanup();
    }
});

test('transient Auth lookup failures preserve notification target indexes for retry', async () => {
    const targetPath = 'teams/team-1/notificationTargets/admin-1__device-a';
    const authError = Object.assign(new Error('temporary Auth outage'), {
        code: 'auth/internal-error'
    });
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-1': { ownerId: 'owner-1', adminEmails: ['admin@example.com'] }
        },
        userDocs: {
            'admin-1': { displayName: 'Email-only admin' }
        },
        preferenceDocs: {
            'users/admin-1/notificationPreferences/team-1': { schedule: true }
        },
        deviceDocs: {
            'admin-1': [{ id: 'device-a', token: 'token-a', platform: 'ios' }]
        },
        authUsersByUid: {
            'admin-1': authError
        },
        initialRecipientDocs: {
            [targetPath]: {
                uid: 'admin-1',
                teamId: 'team-1',
                deviceId: 'device-a',
                token: 'token-a'
            }
        }
    });

    try {
        await assert.rejects(
            env.moduleExports.syncTeamNotificationTargetsOnPreferenceWrite(
                makeChange(
                    { id: 'team-1', path: 'users/admin-1/notificationPreferences/team-1' },
                    { schedule: true },
                    { schedule: true }
                ),
                { params: { uid: 'admin-1', teamId: 'team-1' } }
            ),
            /temporary Auth outage/
        );
        await assert.rejects(
            env.moduleExports.syncTeamNotificationTargetsOnDeviceWrite(
                makeChange(
                    { id: 'device-a', path: 'users/admin-1/notificationDevices/device-a' },
                    { token: 'token-a', platform: 'ios' },
                    { token: 'token-a', platform: 'ios' }
                ),
                { params: { uid: 'admin-1', deviceId: 'device-a' } }
            ),
            /temporary Auth outage/
        );

        assert.equal(env.getDoc(targetPath)?.token, 'token-a');
        assert.ok(!env.deletedPaths.includes(targetPath));
    } finally {
        env.cleanup();
    }
});

test('definitively missing or disabled Auth identities remove notification target indexes', async () => {
    const runScenario = async ({ uid, authIdentity, expectedErrorCode }) => {
        const targetPath = `teams/team-1/notificationTargets/${uid}__device-a`;
        const env = loadNotificationRecipientIndexEnv({
            teamDocs: {
                'team-1': { ownerId: 'owner-1', adminEmails: ['admin@example.com'] }
            },
            userDocs: {
                [uid]: { displayName: 'Former admin' }
            },
            deviceDocs: {
                [uid]: [{ id: 'device-a', token: 'token-a', platform: 'ios' }]
            },
            authUsersByUid: {
                [uid]: authIdentity
            },
            initialRecipientDocs: {
                [targetPath]: {
                    uid,
                    teamId: 'team-1',
                    deviceId: 'device-a',
                    token: 'token-a'
                }
            }
        });

        try {
            await env.moduleExports.syncTeamNotificationTargetsOnPreferenceWrite(
                makeChange(
                    { id: 'team-1', path: `users/${uid}/notificationPreferences/team-1` },
                    { schedule: true },
                    { schedule: true }
                ),
                { params: { uid, teamId: 'team-1' } }
            );
            assert.equal(env.getDoc(targetPath), undefined, expectedErrorCode);
            assert.ok(env.deletedPaths.includes(targetPath), expectedErrorCode);
        } finally {
            env.cleanup();
        }
    };

    await runScenario({
        uid: 'missing-admin',
        authIdentity: Object.assign(new Error('Auth user not found'), {
            code: 'auth/user-not-found'
        }),
        expectedErrorCode: 'auth/user-not-found'
    });
    await runScenario({
        uid: 'disabled-admin',
        authIdentity: { email: 'admin@example.com', disabled: true },
        expectedErrorCode: 'disabled Auth record'
    });
});

test('device target sync chunks writes below the Firestore batch limit', async () => {
    const teamCount = 501;
    const teamDocs = {};
    const preferenceDocs = {};
    const parentTeamIds = [];

    for (let index = 0; index < teamCount; index += 1) {
        const teamId = `team-${index}`;
        teamDocs[teamId] = { ownerId: `coach-${index}`, adminEmails: [] };
        preferenceDocs[`users/parent-1/notificationPreferences/${teamId}`] = { schedule: true };
        parentTeamIds.push(teamId);
    }

    const env = loadNotificationRecipientIndexEnv({
        teamDocs,
        userDocs: {
            'parent-1': { email: 'parent@example.com', parentTeamIds }
        },
        preferenceDocs,
        deviceDocs: {
            'parent-1': [
                { id: 'device-a', token: 'token-a', platform: 'ios' }
            ]
        }
    });

    try {
        await env.moduleExports.syncTeamNotificationTargetsOnDeviceWrite(
            makeChange(
                { id: 'device-a', path: 'users/parent-1/notificationDevices/device-a' },
                null,
                { token: 'token-a', platform: 'ios' }
            ),
            { params: { uid: 'parent-1', deviceId: 'device-a' } }
        );

        assert.equal(env.batchCommitSizes.length, 2);
        assert.deepEqual(env.batchCommitSizes, [450, 51]);
        assert.equal(env.getDoc('teams/team-0/notificationTargets/parent-1__device-a')?.token, 'token-a');
        assert.equal(env.getDoc('teams/team-500/notificationTargets/parent-1__device-a')?.token, 'token-a');
    } finally {
        env.cleanup();
    }
});

test('device recipient sync refreshes many teams with bounded concurrency', async () => {
    const teamCount = 25;
    const teamDocs = {};
    const parentTeamIds = [];

    for (let index = 0; index < teamCount; index += 1) {
        const teamId = `team-${index}`;
        teamDocs[teamId] = { ownerId: `coach-${index}`, adminEmails: [] };
        parentTeamIds.push(teamId);
    }

    const env = loadNotificationRecipientIndexEnv({
        teamDocs,
        userDocs: {
            'parent-1': { email: 'parent@example.com', parentTeamIds }
        },
        preferenceDocs: Object.fromEntries(parentTeamIds.map((teamId) => [
            `users/parent-1/notificationPreferences/${teamId}`,
            { schedule: true }
        ])),
        deviceDocs: {
            'parent-1': [
                { id: 'device-a', token: 'token-a', platform: 'ios' },
                { id: 'device-b', token: 'token-b', platform: 'android' }
            ]
        },
        teamDocGetDelayMs: 5
    });

    try {
        await env.moduleExports.syncTeamNotificationRecipientsOnDeviceWrite(
            makeChange(
                { id: 'device-b', path: 'users/parent-1/notificationDevices/device-b' },
                null,
                { token: 'token-b', platform: 'android' }
            ),
            { params: { uid: 'parent-1', deviceId: 'device-b' } }
        );

        assert.equal(env.getMaxActiveTeamDocGets(), env.internals.NOTIFICATION_RECIPIENT_DEVICE_SYNC_CONCURRENCY);
        for (const teamId of parentTeamIds) {
            assert.deepEqual(env.getDoc(`teams/${teamId}/notificationRecipients/parent-1`)?.tokens?.map((entry) => entry.token).sort(), ['token-a', 'token-b']);
        }
    } finally {
        env.cleanup();
    }
});

test('user parentTeamIds changes add and remove aggregated recipient docs', async () => {
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-1': { ownerId: 'coach-1', adminEmails: [] },
            'team-2': { ownerId: 'coach-2', adminEmails: [] }
        },
        userDocs: {
            'parent-1': { email: 'parent@example.com', parentTeamIds: ['team-2'] }
        },
        deviceDocs: {
            'parent-1': [{ id: 'device-a', token: 'token-a', platform: 'ios' }]
        },
        initialRecipientDocs: {
            'teams/team-1/notificationRecipients/parent-1': {
                uid: 'parent-1',
                teamId: 'team-1',
                roles: ['parent'],
                categories: { schedule: true },
                tokens: [{ deviceId: 'device-a', token: 'token-a', platform: 'ios', userAgent: '' }]
            }
        }
    });

    try {
        await env.moduleExports.syncTeamNotificationRecipientsOnUserWrite(
            makeChange(
                { id: 'parent-1', path: 'users/parent-1' },
                { email: 'parent@example.com', parentTeamIds: ['team-1'] },
                { email: 'parent@example.com', parentTeamIds: ['team-2'] }
            ),
            { params: { uid: 'parent-1' } }
        );

        assert.equal(env.getDoc('teams/team-1/notificationRecipients/parent-1'), undefined);
        assert.equal(env.getDoc('teams/team-2/notificationRecipients/parent-1')?.uid, 'parent-1');
        assert.ok(env.deletedPaths.includes('teams/team-1/notificationRecipients/parent-1'));
    } finally {
        env.cleanup();
    }
});

test('team adminEmails changes swap the indexed staff recipients', async () => {
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-1': { ownerId: 'coach-1', adminEmails: ['new-admin@example.com'] }
        },
        userDocs: {
            'old-admin': { email: 'old-admin@example.com', parentTeamIds: [] },
            'new-admin': { email: 'new-admin@example.com', parentTeamIds: [] }
        },
        deviceDocs: {
            'old-admin': [{ id: 'device-old', token: 'old-token', platform: 'web' }],
            'new-admin': [{ id: 'device-new', token: 'new-token', platform: 'web' }]
        },
        authUsersByEmail: {
            'old-admin@example.com': 'old-admin',
            'new-admin@example.com': 'new-admin'
        },
        initialRecipientDocs: {
            'teams/team-1/notificationRecipients/old-admin': {
                uid: 'old-admin',
                teamId: 'team-1',
                roles: ['staff'],
                categories: { schedule: true },
                tokens: [{ deviceId: 'device-old', token: 'old-token', platform: 'web', userAgent: '' }]
            }
        }
    });

    try {
        await env.moduleExports.syncTeamNotificationRecipientsOnTeamWrite(
            makeChange(
                { id: 'team-1', path: 'teams/team-1' },
                { ownerId: 'coach-1', adminEmails: ['old-admin@example.com'] },
                { ownerId: 'coach-1', adminEmails: ['new-admin@example.com'] }
            ),
            { params: { teamId: 'team-1' } }
        );

        assert.equal(env.getDoc('teams/team-1/notificationRecipients/old-admin'), undefined);
        assert.equal(env.getDoc('teams/team-1/notificationRecipients/new-admin')?.uid, 'new-admin');
        assert.deepEqual(env.getDoc('teams/team-1/notificationRecipients/new-admin')?.roles, ['staff']);
    } finally {
        env.cleanup();
    }
});

test('getTargetsForCategory expands aggregated recipient token lists', async () => {
    const env = loadNotificationRecipientIndexEnv({
        teamDocs: {
            'team-1': { ownerId: 'coach-1', adminEmails: [] }
        },
        userDocs: {
            'parent-1': { email: 'parent@example.com', parentTeamIds: ['team-1'] }
        },
        initialRecipientDocs: {
            'teams/team-1/notificationRecipients/parent-1': {
                uid: 'parent-1',
                teamId: 'team-1',
                roles: ['parent'],
                categories: { schedule: true },
                tokens: [
                    { deviceId: 'device-a', token: 'token-a', platform: 'ios', userAgent: '' },
                    { deviceId: 'device-b', token: 'token-b', platform: 'web', userAgent: '' }
                ]
            }
        }
    });

    try {
        const targets = await env.internals.getTargetsForCategory('team-1', 'schedule');
        assert.deepEqual(targets.map((target) => `${target.uid}:${target.deviceId}:${target.token}`).sort(), [
            'coach-1:undefined:undefined',
            'parent-1:device-a:token-a',
            'parent-1:device-b:token-b'
        ]);
    } finally {
        env.cleanup();
    }
});

test('firestore rules explicitly deny client access to notificationRecipients', () => {
    const rules = readFileSync('firestore.rules', 'utf8');
    assert.match(rules, /match \/notificationRecipients\/\{uid\} \{[\s\S]*allow read, write: if false;/);
});

test('notificationRecipients uid remains indexed for collection-group cleanup', () => {
    const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
    const uidOverride = indexes.fieldOverrides.find((entry) => (
        entry.collectionGroup === 'notificationRecipients'
        && entry.fieldPath === 'uid'
    ));
    assert.ok(uidOverride);
    assert.ok(uidOverride.indexes.some((entry) => (
        entry.order === 'ASCENDING'
        && entry.queryScope === 'COLLECTION_GROUP'
    )));
});
