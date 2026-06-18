const Module = require('node:module');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

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
        storage: {
            object: () => triggerChain
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

function makeDocSnapshot({ id, ref, data, exists = true }) {
    return {
        id,
        ref,
        exists,
        data: () => (data == null ? data : JSON.parse(JSON.stringify(data)))
    };
}

function makeQuerySnapshot(docSnaps) {
    return {
        empty: docSnaps.length === 0,
        docs: docSnaps,
        forEach(callback) {
            docSnaps.forEach(callback);
        }
    };
}

function buildNotificationTestEnv({
    teamId = 'team-1',
    teamDoc = {},
    parentUserIds = [],
    indexedRecipients = [],
    indexedTargets = [],
    preferenceDocs = {},
    deviceDocs = {},
    invalidTokenResponses = []
} = {}) {
    const dedupWrites = [];
    const inboxWrites = [];
    const deletedPaths = [];
    const messagingCalls = [];
    const counts = {
        teamDocGets: 0,
        parentQueries: 0,
        recipientQueries: 0,
        recipientCollectionGets: 0,
        preferenceGets: 0,
        deviceGets: 0,
        inboxAdds: 0,
        inboxCleanupQueries: 0,
        dedupTransactions: 0,
        deleteCalls: 0
    };

    const notificationRecipientDocs = (indexedRecipients.length ? indexedRecipients : indexedTargets).map((target, index) => ({
        id: `${target.uid || `user-${index}`}__${target.deviceId || `device-${index}`}`,
        data: {
            uid: target.uid,
            deviceId: target.deviceId,
            token: target.token,
            categories: target.categories || {}
        }
    }));

    function doc(path) {
        return {
            path,
            id: String(path).split('/').pop(),
            async get() {
                if (path === `teams/${teamId}`) {
                    counts.teamDocGets += 1;
                    return makeDocSnapshot({ id: teamId, ref: this, data: teamDoc, exists: true });
                }
                if (path.startsWith('users/') && path.includes('/notificationPreferences/')) {
                    counts.preferenceGets += 1;
                    const data = preferenceDocs[path];
                    return makeDocSnapshot({
                        id: String(path).split('/').pop(),
                        ref: this,
                        data,
                        exists: data !== undefined
                    });
                }
                if (path.startsWith(`teams/${teamId}/notificationSendLog/`)) {
                    return makeDocSnapshot({ id: this.id, ref: this, data: undefined, exists: false });
                }
                return makeDocSnapshot({ id: this.id, ref: this, data: undefined, exists: false });
            },
            async set(value) {
                dedupWrites.push({ path, value });
            },
            async delete() {
                counts.deleteCalls += 1;
                deletedPaths.push(path);
            },
            collection(name) {
                return collection(`${path}/${name}`);
            }
        };
    }

    function collection(path) {
        if (path === 'users') {
            return {
                where(field, op, value) {
                    return {
                        async get() {
                            counts.parentQueries += 1;
                            if (field !== 'parentTeamIds' || op !== 'array-contains' || value !== teamId) {
                                return makeQuerySnapshot([]);
                            }
                            return makeQuerySnapshot(parentUserIds.map((uid) => makeDocSnapshot({
                                id: uid,
                                ref: doc(`users/${uid}`),
                                data: { parentTeamIds: [teamId] },
                                exists: true
                            })));
                        }
                    };
                }
            };
        }

        if (path === `teams/${teamId}/notificationRecipients`) {
            return {
                where(field, op, value) {
                    return {
                        async get() {
                            counts.recipientQueries += 1;
                            const category = String(field || '').replace(/^categories\./, '');
                            const docs = notificationRecipientDocs.filter((entry) => op === '==' && value === true && entry.data.categories?.[category] === true)
                                .map((entry) => makeDocSnapshot({
                                    id: entry.id,
                                    ref: doc(`${path}/${entry.id}`),
                                    data: entry.data,
                                    exists: true
                                }));
                            return makeQuerySnapshot(docs);
                        }
                    };
                },
                limit() {
                    return {
                        async get() {
                            counts.recipientCollectionGets += 1;
                            return makeQuerySnapshot(notificationRecipientDocs.slice(0, 1).map((entry) => makeDocSnapshot({
                                id: entry.id,
                                ref: doc(`${path}/${entry.id}`),
                                data: entry.data,
                                exists: true
                            })));
                        }
                    };
                }
            };
        }

        const inboxMatch = path.match(/^users\/([^/]+)\/notificationInbox$/);
        if (inboxMatch) {
            return {
                async add(value) {
                    counts.inboxAdds += 1;
                    inboxWrites.push({ uid: inboxMatch[1], value });
                    return { id: `inbox-${inboxWrites.length}` };
                },
                orderBy() {
                    return {
                        offset() {
                            return {
                                async get() {
                                    counts.inboxCleanupQueries += 1;
                                    return makeQuerySnapshot([]);
                                }
                            };
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
                    counts.deviceGets += 1;
                    const docs = (deviceDocs[uid] || []).map((entry, index) => makeDocSnapshot({
                        id: entry.id || `device-${index}`,
                        ref: doc(`${path}/${entry.id || `device-${index}`}`),
                        data: { token: entry.token },
                        exists: true
                    }));
                    return makeQuerySnapshot(docs);
                }
            };
        }

        return {
            async add() {
                return { id: 'noop' };
            },
            where() {
                return { get: async () => makeQuerySnapshot([]) };
            },
            orderBy() {
                return {
                    offset() {
                        return { get: async () => makeQuerySnapshot([]) };
                    }
                };
            },
            doc(id) {
                return doc(`${path}/${id}`);
            }
        };
    }

    const firestoreState = {
        doc,
        collection,
        async runTransaction(handler) {
            counts.dedupTransactions += 1;
            return handler({
                get: (ref) => ref.get(),
                set: (ref, value) => ref.set(value)
            });
        },
        batch() {
            return {
                set(ref, value) {
                    dedupWrites.push({ path: ref.path, value });
                },
                delete(ref) {
                    deletedPaths.push(ref.path);
                },
                update() {},
                async commit() {}
            };
        }
    };

    const firestoreFactory = Object.assign(() => firestoreState, {
        FieldValue: {
            serverTimestamp: () => ({ __serverTimestamp: true }),
            increment: (amount) => ({ __increment: amount })
        }
    });

    const adminStub = {
        apps: [true],
        initializeApp: () => {},
        firestore: firestoreFactory,
        auth: () => ({
            verifyIdToken: async () => null,
            getUserByEmail: async () => ({ uid: '' })
        }),
        messaging: () => ({
            async sendEachForMulticast(message) {
                messagingCalls.push({
                    tokens: [...message.tokens],
                    title: message.notification?.title || '',
                    body: message.notification?.body || '',
                    data: { ...(message.data || {}) },
                    webLink: message.webpush?.fcmOptions?.link || ''
                });
                const responses = message.tokens.map((token, index) => invalidTokenResponses[index] || { success: true, token });
                const failureCount = responses.filter((response) => response?.success === false).length;
                return {
                    responses,
                    successCount: responses.length - failureCount,
                    failureCount
                };
            }
        }),
        storage: () => ({
            bucket: () => ({
                file: () => ({})
            })
        })
    };

    const stripeStub = class StripeStub {
        constructor() {
            return {};
        }
    };

    return {
        counts,
        dedupWrites,
        deletedPaths,
        inboxWrites,
        messagingCalls,
        adminStub,
        firestoreState,
        functionsStub: makeFunctionsStub(),
        stripeStub
    };
}

function loadNotificationInternals(options = {}) {
    const env = buildNotificationTestEnv(options);

    Module._load = function patchedModuleLoad(request, parent, isMain) {
        if (request === 'firebase-admin') {
            return env.adminStub;
        }
        if (request === 'firebase-functions') {
            return env.functionsStub;
        }
        if (request === 'stripe') {
            return env.stripeStub;
        }
        return originalModuleLoad(request, parent, isMain);
    };

    delete require.cache[repoIndexPath];
    const internals = require(repoIndexPath)._internal;

    return {
        env,
        internals,
        cleanup() {
            delete require.cache[repoIndexPath];
            Module._load = originalModuleLoad;
        }
    };
}

module.exports = {
    loadNotificationInternals
};
