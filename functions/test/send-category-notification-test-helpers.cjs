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
        auth: {
            user: () => triggerChain
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
        data: () => data
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

function buildNotificationTestEnv({
    teamId = 'team-1',
    teamDoc = {},
    parentUserIds = [],
    userDocs = {},
    authUsersByEmail = {},
    playerDocs = {},
    privateProfileDocs = {},
    gameDocs = {},
    rideOfferDocs = {},
    rideRequestDocs = {},
    indexedRecipients = [],
    indexedTargets = [],
    notificationRecipientDocs = null,
    preferenceDocs = {},
    deviceDocs = {},
    invalidTokenResponses = [],
    sendEachErrors = [],
    notificationInboxDocs = {},
    nowMillis = Date.parse('2026-06-28T12:00:00.000Z')
} = {}) {
    const dedupWrites = [];
    const inboxWrites = [];
    const inboxCleanupLimits = [];
    const auditWrites = [];
    const deletedPaths = [];
    const updatedDocs = [];
    const messagingCalls = [];
    const docStore = new Map();
    const counts = {
        teamDocGets: 0,
        parentQueries: 0,
        recipientQueries: 0,
        targetQueries: 0,
        recipientDocGets: 0,
        recipientCollectionGets: 0,
        preferenceGets: 0,
        deviceGets: 0,
        userRecordGets: 0,
        inboxAdds: 0,
        inboxCleanupQueries: 0,
        inboxCleanupLimitQueries: 0,
        inboxCleanupOffsetQueries: 0,
        dedupTransactions: 0,
        deleteCalls: 0
    };

    const notificationRecipientDocsList = notificationRecipientDocs || Array.from(
        (indexedRecipients.length ? indexedRecipients : indexedTargets).reduce((docsByUid, target, index) => {
            const uid = String(target.uid || `user-${index}`).trim();
            const existing = docsByUid.get(uid) || {
                id: uid,
                data: {
                    uid,
                    teamId,
                    roles: target.roles || ['parent'],
                    categories: {},
                    tokens: []
                }
            };
            existing.data.categories = {
                ...existing.data.categories,
                ...(target.categories || {})
            };
            const tokenEntries = Array.isArray(target.tokens)
                ? target.tokens
                : [{
                    deviceId: target.deviceId || `device-${index}`,
                    token: target.token,
                    platform: target.platform,
                    userAgent: target.userAgent
                }];
            tokenEntries.forEach((entry) => {
                if (!entry?.token) return;
                existing.data.tokens.push({
                    deviceId: entry.deviceId || `device-${existing.data.tokens.length}`,
                    token: entry.token,
                    platform: entry.platform,
                    userAgent: entry.userAgent
                });
            });
            docsByUid.set(uid, existing);
            return docsByUid;
        }, new Map()).values()
    );

    const notificationTargetDocs = indexedTargets.map((target, index) => ({
        id: `${target.uid || `user-${index}`}__${target.deviceId || `device-${index}`}`,
        data: {
            uid: target.uid,
            deviceId: target.deviceId,
            token: target.token,
            categories: target.categories || {}
        }
    }));

    function clone(value) {
        return value == null ? value : JSON.parse(JSON.stringify(value));
    }

    function makeTimestamp(millis) {
        return {
            toDate: () => new Date(millis),
            toMillis: () => millis
        };
    }

    Object.entries(notificationInboxDocs || {}).forEach(([uid, entries]) => {
        const inboxEntries = Array.isArray(entries) ? entries : [];
        inboxEntries.forEach((entry, index) => {
            const id = entry?.id || `existing-${index}`;
            const millis = Number.isFinite(Number(entry?.createdAtMillis))
                ? Number(entry.createdAtMillis)
                : nowMillis - ((index + 1) * 1000);
            writeStoredDoc(`users/${uid}/notificationInbox/${id}`, {
                category: 'schedule',
                title: `Existing ${index}`,
                body: '',
                createdAt: makeTimestamp(millis),
                readAt: null,
                ...(entry?.data || {})
            });
        });
    });

    function comparableMillis(value) {
        if (typeof value?.toMillis === 'function') {
            return value.toMillis();
        }
        if (value instanceof Date) {
            return value.getTime();
        }
        if (typeof value === 'string' || typeof value === 'number') {
            const millis = new Date(value).getTime();
            return Number.isFinite(millis) ? millis : Number(value);
        }
        return NaN;
    }

    function matchesQueryFilter(data, filter) {
        const actual = data?.[filter.field];
        if (filter.op === 'in') {
            return Array.isArray(filter.value) && filter.value.includes(actual);
        }
        if (filter.op === '==') {
            return actual === filter.value;
        }
        if (filter.op === '>=' || filter.op === '<=') {
            const actualMillis = comparableMillis(actual);
            const expectedMillis = comparableMillis(filter.value);
            if (!Number.isFinite(actualMillis) || !Number.isFinite(expectedMillis)) {
                return false;
            }
            return filter.op === '>='
                ? actualMillis >= expectedMillis
                : actualMillis <= expectedMillis;
        }
        return false;
    }

    function makeQuery(getDocs) {
        const filters = [];
        return {
            where(field, op, value) {
                filters.push({ field, op, value });
                return this;
            },
            async get() {
                const docs = getDocs().filter((docSnap) => {
                    const data = docSnap.data() || {};
                    return filters.every((filter) => matchesQueryFilter(data, filter));
                });
                return makeQuerySnapshot(docs);
            }
        };
    }

    function isDeleteSentinel(value) {
        return Boolean(value && typeof value === 'object' && value.__delete === true);
    }

    function setValueAtPath(target, pathSegments, value) {
        let cursor = target;
        for (let index = 0; index < pathSegments.length - 1; index += 1) {
            const segment = pathSegments[index];
            if (!cursor[segment] || typeof cursor[segment] !== 'object' || Array.isArray(cursor[segment])) {
                cursor[segment] = {};
            }
            cursor = cursor[segment];
        }
        cursor[pathSegments[pathSegments.length - 1]] = value;
    }

    function deleteValueAtPath(target, pathSegments) {
        let cursor = target;
        for (let index = 0; index < pathSegments.length - 1; index += 1) {
            cursor = cursor?.[pathSegments[index]];
            if (!cursor || typeof cursor !== 'object') {
                return;
            }
        }
        if (cursor && typeof cursor === 'object') {
            delete cursor[pathSegments[pathSegments.length - 1]];
        }
    }

    function writeStoredDoc(path, value) {
        docStore.set(path, clone(value));
    }

    function mergeStoredDoc(path, value) {
        const current = clone(docStore.get(path) || {});
        const incoming = clone(value) || {};

        Object.entries(incoming).forEach(([key, entryValue]) => {
            const pathSegments = key.split('.');
            if (isDeleteSentinel(entryValue)) {
                deleteValueAtPath(current, pathSegments);
                return;
            }
            setValueAtPath(current, pathSegments, entryValue);
        });

        docStore.set(path, current);
    }

    function doc(path) {
        return {
            path,
            id: String(path).split('/').pop(),
            async get() {
                if (path === `teams/${teamId}`) {
                    counts.teamDocGets += 1;
                    return makeDocSnapshot({ id: teamId, ref: this, data: teamDoc, exists: true });
                }
                if (path.startsWith('users/') && !path.includes('/notificationPreferences/') && !path.includes('/notificationDevices/') && path.split('/').length === 2) {
                    counts.userRecordGets += 1;
                    const data = userDocs[this.id];
                    return makeDocSnapshot({
                        id: this.id,
                        ref: this,
                        data,
                        exists: data !== undefined
                    });
                }
                const playerMatch = path.match(/^teams\/([^/]+)\/players\/([^/]+)$/);
                if (playerMatch) {
                    const playerId = playerMatch[2];
                    const data = playerDocs[playerId];
                    return makeDocSnapshot({
                        id: playerId,
                        ref: this,
                        data,
                        exists: data !== undefined
                    });
                }
                const gameMatch = path.match(/^teams\/([^/]+)\/games\/([^/]+)$/);
                if (gameMatch) {
                    const gameId = gameMatch[2];
                    const storedData = docStore.get(path);
                    const seededData = gameDocs[gameId];
                    const data = storedData !== undefined ? storedData : seededData;
                    return makeDocSnapshot({
                        id: gameId,
                        ref: this,
                        data,
                        exists: data !== undefined
                    });
                }
                const rideOfferMatch = path.match(/^teams\/([^/]+)\/games\/([^/]+)\/rideOffers\/([^/]+)$/);
                if (rideOfferMatch) {
                    const key = `${rideOfferMatch[2]}/${rideOfferMatch[3]}`;
                    const data = rideOfferDocs[key];
                    return makeDocSnapshot({
                        id: rideOfferMatch[3],
                        ref: this,
                        data,
                        exists: data !== undefined
                    });
                }
                const privateProfileMatch = path.match(/^teams\/([^/]+)\/players\/([^/]+)\/private\/profile$/);
                if (privateProfileMatch) {
                    const playerId = privateProfileMatch[2];
                    const data = privateProfileDocs[playerId];
                    return makeDocSnapshot({
                        id: 'profile',
                        ref: this,
                        data,
                        exists: data !== undefined
                    });
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
                    const data = docStore.get(path);
                    return makeDocSnapshot({ id: this.id, ref: this, data, exists: data !== undefined });
                }
                if (path.startsWith(`teams/${teamId}/notificationRecipients/`)) {
                    counts.recipientDocGets += 1;
                    const docId = String(path).split('/').pop();
                    const entry = notificationRecipientDocsList.find((recipientDoc) => recipientDoc.id === docId);
                    return makeDocSnapshot({
                        id: docId,
                        ref: this,
                        data: entry?.data,
                        exists: Boolean(entry)
                    });
                }
                if (docStore.has(path)) {
                    return makeDocSnapshot({ id: this.id, ref: this, data: docStore.get(path), exists: true });
                }
                return makeDocSnapshot({ id: this.id, ref: this, data: undefined, exists: false });
            },
            async set(value) {
                if (path.startsWith(`teams/${teamId}/notificationSendLog/`)) {
                    const sentAtMillis = Date.now();
                    docStore.set(path, {
                        ...clone(value),
                        sentAt: {
                            toMillis: () => sentAtMillis
                        }
                    });
                } else {
                    writeStoredDoc(path, value);
                }
                dedupWrites.push({ path, value });
            },
            async update(value) {
                mergeStoredDoc(path, value);
                updatedDocs.push({ path, value });
            },
            async delete() {
                counts.deleteCalls += 1;
                docStore.delete(path);
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
                            if (op !== 'array-contains') {
                                return makeQuerySnapshot([]);
                            }
                            if (field === 'parentTeamIds' && value === teamId) {
                                return makeQuerySnapshot(parentUserIds.map((uid) => makeDocSnapshot({
                                    id: uid,
                                    ref: doc(`users/${uid}`),
                                    data: { parentTeamIds: [teamId] },
                                    exists: true
                                })));
                            }
                            if (field === 'parentPlayerKeys') {
                                const docs = Object.entries(userDocs)
                                    .filter(([, user]) => Array.isArray(user?.parentPlayerKeys) && user.parentPlayerKeys.includes(value))
                                    .map(([uid, user]) => makeDocSnapshot({
                                        id: uid,
                                        ref: doc(`users/${uid}`),
                                        data: user,
                                        exists: true
                                    }));
                                return makeQuerySnapshot(docs);
                            }
                            return makeQuerySnapshot([]);
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
                            const docs = notificationRecipientDocsList.filter((entry) => op === '==' && value === true && entry.data.categories?.[category] === true)
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
                            return makeQuerySnapshot(notificationRecipientDocsList.slice(0, 1).map((entry) => makeDocSnapshot({
                                id: entry.id,
                                ref: doc(`${path}/${entry.id}`),
                                data: entry.data,
                                exists: true
                            })));
                        }
                    };
                },
                async get() {
                    counts.recipientCollectionGets += 1;
                    return makeQuerySnapshot(notificationRecipientDocsList.map((entry) => makeDocSnapshot({
                        id: entry.id,
                        ref: doc(`${path}/${entry.id}`),
                        data: entry.data,
                        exists: true
                    })));
                }
            };
        }

        if (path === `teams/${teamId}/notificationTargets`) {
            return {
                async get() {
                    counts.targetQueries += 1;
                    return makeQuerySnapshot(notificationTargetDocs.map((entry) => makeDocSnapshot({
                        id: entry.id,
                        ref: doc(`${path}/${entry.id}`),
                        data: entry.data,
                        exists: true
                    })));
                }
            };
        }

        if (path === `teams/${teamId}/players`) {
            return {
                async get() {
                    const docs = Object.entries(playerDocs).map(([playerId, player]) => makeDocSnapshot({
                        id: playerId,
                        ref: doc(`${path}/${playerId}`),
                        data: player,
                        exists: true
                    }));
                    return makeQuerySnapshot(docs);
                }
            };
        }

        if (path === `teams/${teamId}/notificationAudit`) {
            return {
                async add(value) {
                    auditWrites.push({ path, value });
                    return { id: `audit-${auditWrites.length}` };
                }
            };
        }

        const rideRequestsMatch = path.match(/^teams\/([^/]+)\/games\/([^/]+)\/rideOffers\/([^/]+)\/requests$/);
        if (rideRequestsMatch) {
            const key = `${rideRequestsMatch[2]}/${rideRequestsMatch[3]}`;
            return {
                async get() {
                    const docs = (rideRequestDocs[key] || []).map((entry, index) => makeDocSnapshot({
                        id: entry.id || `request-${index}`,
                        ref: doc(`${path}/${entry.id || `request-${index}`}`),
                        data: entry,
                        exists: true
                    }));
                    return makeQuerySnapshot(docs);
                }
            };
        }

        const feeRecipientsMatch = path.match(/^teams\/([^/]+)\/feeBatches\/([^/]+)\/feeRecipients$/);
        if (feeRecipientsMatch) {
            return {
                async get() {
                    const prefix = `${path}/`;
                    const docs = Array.from(docStore.entries())
                        .filter(([docPath]) => docPath.startsWith(prefix) && !docPath.slice(prefix.length).includes('/'))
                        .map(([docPath, data]) => makeDocSnapshot({
                            id: docPath.slice(prefix.length),
                            ref: doc(docPath),
                            data,
                            exists: true
                        }));
                    return makeQuerySnapshot(docs);
                }
            };
        }

        const inboxMatch = path.match(/^users\/([^/]+)\/notificationInbox$/);
        if (inboxMatch) {
            const uid = inboxMatch[1];
            const getInboxDocs = () => {
                const prefix = `${path}/`;
                return Array.from(docStore.entries())
                    .filter(([docPath]) => docPath.startsWith(prefix) && !docPath.slice(prefix.length).includes('/'))
                    .map(([docPath, data]) => makeDocSnapshot({
                        id: docPath.slice(prefix.length),
                        ref: doc(docPath),
                        data,
                        exists: true
                    }));
            };
            const sortDocs = (docs, direction = 'desc') => docs.sort((left, right) => {
                const leftMillis = comparableMillis(left.data()?.createdAt);
                const rightMillis = comparableMillis(right.data()?.createdAt);
                const leftValue = Number.isFinite(leftMillis) ? leftMillis : 0;
                const rightValue = Number.isFinite(rightMillis) ? rightMillis : 0;
                return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
            });
            const makeOrderedQuery = (direction = 'asc', cursorDoc = null) => ({
                startAfter(nextCursorDoc) {
                    return makeOrderedQuery(direction, nextCursorDoc);
                },
                limit(limitCount) {
                    return {
                        async get() {
                            counts.inboxCleanupQueries += 1;
                            counts.inboxCleanupLimitQueries += 1;
                            inboxCleanupLimits.push(limitCount);
                            let docs = sortDocs(getInboxDocs(), direction);
                            if (cursorDoc) {
                                const cursorIndex = docs.findIndex((docSnap) => docSnap.ref.path === cursorDoc.ref.path);
                                if (cursorIndex >= 0) {
                                    docs = docs.slice(cursorIndex + 1);
                                } else {
                                    const cursorMillis = comparableMillis(cursorDoc.data()?.createdAt);
                                    docs = docs.filter((docSnap) => {
                                        const docMillis = comparableMillis(docSnap.data()?.createdAt);
                                        if (!Number.isFinite(docMillis) || !Number.isFinite(cursorMillis)) return false;
                                        return direction === 'asc' ? docMillis > cursorMillis : docMillis < cursorMillis;
                                    });
                                }
                            }
                            return makeQuerySnapshot(docs.slice(0, limitCount));
                        }
                    };
                },
                offset() {
                    counts.inboxCleanupOffsetQueries += 1;
                    return {
                        async get() {
                            counts.inboxCleanupQueries += 1;
                            return makeQuerySnapshot([]);
                        }
                    };
                }
            });
            return {
                async add(value) {
                    counts.inboxAdds += 1;
                    const id = `inbox-${inboxWrites.length + 1}`;
                    const storedValue = {
                        ...clone(value),
                        createdAt: makeTimestamp(nowMillis + inboxWrites.length + 1)
                    };
                    writeStoredDoc(`${path}/${id}`, storedValue);
                    inboxWrites.push({ uid, value });
                    return { id };
                },
                orderBy(field, direction = 'asc') {
                    return makeOrderedQuery(direction);
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
                    limit() {
                        return { get: async () => makeQuerySnapshot([]) };
                    },
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
        collectionGroup(name) {
            if (name !== 'feeRecipients') {
                return makeQuery(() => []);
            }
            return makeQuery(() => Array.from(docStore.entries())
                .filter(([path]) => /\/feeRecipients\/[^/]+$/.test(path))
                .map(([path, data]) => makeDocSnapshot({
                    id: path.split('/').pop(),
                    ref: doc(path),
                    data,
                    exists: true
                })));
        },
        async getAll(...refs) {
            return Promise.all(refs.map((ref) => ref.get()));
        },
        async runTransaction(handler) {
            counts.dedupTransactions += 1;
            return handler({
                get: (ref) => ref.get(),
                set: (ref, value) => ref.set(value),
                update: (ref, value) => ref.update(value)
            });
        },
        batch() {
            return {
                set(ref, value) {
                    dedupWrites.push({ path: ref.path, value });
                },
                delete(ref) {
                    counts.deleteCalls += 1;
                    docStore.delete(ref.path);
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
            increment: (amount) => ({ __increment: amount }),
            delete: () => ({ __delete: true })
        },
        Timestamp: {
            now: () => makeTimestamp(nowMillis),
            fromDate: (date) => makeTimestamp(new Date(date).getTime()),
            fromMillis: (millis) => makeTimestamp(millis)
        }
    });

    const adminStub = {
        apps: [true],
        initializeApp: () => {},
        firestore: firestoreFactory,
        auth: () => ({
            verifyIdToken: async () => null,
            getUserByEmail: async (email) => {
                const uid = authUsersByEmail[String(email || '').trim().toLowerCase()];
                return uid ? { uid } : { uid: '' };
            }
        }),
        messaging: () => ({
            async sendEachForMulticast(message) {
                messagingCalls.push({
                    tokens: [...message.tokens],
                    title: message.notification?.title || '',
                    body: message.notification?.body || '',
                    data: { ...(message.data || {}) },
                    webLink: message.webpush?.fcmOptions?.link || '',
                    android: message.android || null,
                    apns: message.apns || null,
                    webpush: message.webpush || null
                });
                const sendError = sendEachErrors.length ? sendEachErrors.shift() : null;
                if (sendError) {
                    throw sendError;
                }
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
        inboxCleanupLimits,
        auditWrites,
        updatedDocs,
        messagingCalls,
        getNotificationInboxDocCount(uid) {
            const prefix = `users/${uid}/notificationInbox/`;
            return Array.from(docStore.keys())
                .filter((docPath) => docPath.startsWith(prefix) && !docPath.slice(prefix.length).includes('/'))
                .length;
        },
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
    const moduleExports = require(repoIndexPath);
    const internals = moduleExports._internal;

    return {
        env,
        internals,
        moduleExports,
        cleanup() {
            delete require.cache[repoIndexPath];
            Module._load = originalModuleLoad;
        }
    };
}

module.exports = {
    loadNotificationInternals
};
