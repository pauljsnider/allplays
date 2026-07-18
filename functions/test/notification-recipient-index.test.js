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
        object() {
            return this;
        }
    };
    triggerChain.https = triggerChain;
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
    initialRecipientDocs = {},
    maxBatchCommitOps = 450,
    teamDocGetDelayMs = 0
} = {}) {
    const deletedPaths = [];
    const batchCommitSizes = [];
    let activeTeamDocGets = 0;
    let maxActiveTeamDocGets = 0;
    const docStore = new Map();

    for (const [path, value] of Object.entries(initialRecipientDocs)) {
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
            return {
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
                async get() {
                    return makeQuerySnapshot(
                        Object.entries(teamDocs).map(([teamId, team]) => makeDocSnapshot(doc(`teams/${teamId}`), team, true))
                    );
                }
            };
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

    const firestoreState = {
        doc,
        collection,
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
        Timestamp: {
            now: () => ({ toMillis: () => Date.now() })
        }
    });

    const adminStub = {
        apps: [true],
        initializeApp: () => {},
        firestore: firestoreFactory,
        auth: () => ({
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
