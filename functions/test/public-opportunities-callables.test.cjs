const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

let adminStub = null;
let functionsStub = null;
let StripeStub = null;

function patchedModuleLoad(request, parent, isMain) {
    if (request === 'firebase-admin' && adminStub) return adminStub;
    if (request === 'firebase-functions' && functionsStub) return functionsStub;
    if (request === 'stripe' && StripeStub) return StripeStub;
    return originalModuleLoad(request, parent, isMain);
}

class FakeTimestamp {
    constructor(milliseconds) {
        this.milliseconds = Number(milliseconds);
    }

    toMillis() {
        return this.milliseconds;
    }

    toDate() {
        return new Date(this.milliseconds);
    }

    static now() {
        return new FakeTimestamp(Date.now());
    }

    static fromDate(value) {
        return new FakeTimestamp(value.getTime());
    }

    static fromMillis(value) {
        return new FakeTimestamp(value);
    }
}

function clone(value) {
    if (value instanceof FakeTimestamp) return new FakeTimestamp(value.toMillis());
    if (Array.isArray(value)) return value.map(clone);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry)]));
}

function getNested(value, path) {
    return String(path || '').split('.').filter(Boolean)
        .reduce((cursor, key) => cursor == null ? undefined : cursor[key], value);
}

function comparable(value) {
    return value instanceof FakeTimestamp ? value.toMillis() : value;
}

function makeFirestore(seed = {}) {
    const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
    let nextAutoId = 1;

    function makeSnapshot(path) {
        const ref = doc(path);
        const value = state.get(path);
        return {
            id: path.split('/').pop(),
            ref,
            exists: value !== undefined,
            data: () => clone(value)
        };
    }

    function doc(path) {
        return {
            path,
            id: path.split('/').pop(),
            get: async () => makeSnapshot(path),
            set: async (value, options = {}) => {
                state.set(path, options.merge ? { ...(state.get(path) || {}), ...clone(value) } : clone(value));
            },
            update: async (value) => {
                if (!state.has(path)) throw new Error(`Missing document: ${path}`);
                state.set(path, { ...state.get(path), ...clone(value) });
            },
            collection: (name) => collection(`${path}/${name}`)
        };
    }

    function makeQuery(path, filters = [], orders = [], limitCount = null, cursor = null) {
        const query = {
            path,
            where(field, operator, value) {
                return makeQuery(path, [...filters, { field, operator, value }], orders, limitCount, cursor);
            },
            orderBy(field, direction = 'asc') {
                return makeQuery(path, filters, [...orders, { field, direction }], limitCount, cursor);
            },
            limit(count) {
                return makeQuery(path, filters, orders, Number(count), cursor);
            },
            startAfter(...values) {
                return makeQuery(path, filters, orders, limitCount, values.length === 1 && values[0]?.ref
                    ? { snapshot: values[0] }
                    : { values });
            },
            doc(id) {
                return doc(`${path}/${id || `auto-${nextAutoId++}`}`);
            },
            async get() {
                const depth = path.split('/').length + 1;
                let snapshots = [...state.keys()]
                    .filter((entryPath) => entryPath.startsWith(`${path}/`) && entryPath.split('/').length === depth)
                    .map(makeSnapshot);

                snapshots = snapshots.filter((snapshot) => filters.every(({ field, operator, value }) => {
                    const actual = field === '__name__' ? snapshot.id : getNested(snapshot.data(), field);
                    if (operator === '==') return comparable(actual) === comparable(value);
                    if (operator === '>') return comparable(actual) > comparable(value);
                    if (operator === 'array-contains') return Array.isArray(actual) && actual.includes(value);
                    if (operator === 'in') return Array.isArray(value) && value.includes(actual);
                    throw new Error(`Unsupported query operator: ${operator}`);
                }));

                function compareSnapshotToValues(snapshot, values) {
                    for (let index = 0; index < orders.length; index += 1) {
                        const { field, direction } = orders[index];
                        const left = comparable(field === '__name__' ? snapshot.id : getNested(snapshot.data(), field));
                        const right = comparable(values[index]);
                        if (left === right) continue;
                        const comparison = left < right ? -1 : 1;
                        return direction === 'desc' ? -comparison : comparison;
                    }
                    return 0;
                }

                snapshots.sort((leftSnapshot, rightSnapshot) => {
                    const rightValues = orders.map(({ field }) => field === '__name__'
                        ? rightSnapshot.id
                        : getNested(rightSnapshot.data(), field));
                    return compareSnapshotToValues(leftSnapshot, rightValues);
                });

                if (cursor?.snapshot) {
                    const cursorIndex = snapshots.findIndex((snapshot) => snapshot.ref.path === cursor.snapshot.ref.path);
                    snapshots = cursorIndex >= 0 ? snapshots.slice(cursorIndex + 1) : snapshots;
                } else if (cursor?.values) {
                    snapshots = snapshots.filter((snapshot) => compareSnapshotToValues(snapshot, cursor.values) > 0);
                }

                const docs = limitCount == null ? snapshots : snapshots.slice(0, limitCount);
                return { docs, size: docs.length, empty: docs.length === 0 };
            }
        };
        return query;
    }

    function collection(path) {
        return makeQuery(path);
    }

    return {
        _state: state,
        doc,
        collection,
        batch() {
            const operations = [];
            return {
                create: (ref, value) => operations.push(async () => {
                    if (state.has(ref.path)) {
                        const error = new Error(`Document already exists: ${ref.path}`);
                        error.code = 6;
                        throw error;
                    }
                    await ref.set(value);
                }),
                set: (ref, value, options) => operations.push(() => ref.set(value, options)),
                update: (ref, value) => operations.push(() => ref.update(value)),
                commit: async () => Promise.all(operations.map((operation) => operation()))
            };
        },
        snapshot(path) {
            return clone(state.get(path));
        }
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
        document() { return this; },
        schedule() { return this; },
        timeZone() { return this; }
    };
    triggerChain.https = triggerChain;
    triggerChain.firestore = triggerChain;
    triggerChain.pubsub = triggerChain;

    return {
        config: () => ({ stripe: { secret_key: 'sk_test_123', app_url: 'https://allplays.test' } }),
        https: { HttpsError, onCall: (fn) => fn, onRequest: (fn) => fn },
        firestore: { document: () => triggerChain },
        auth: { user: () => triggerChain },
        pubsub: { schedule: () => triggerChain },
        runWith: () => triggerChain,
        logger: { error() {}, warn() {}, info() {} }
    };
}

function loadCallables(seed = {}, { authUsers = {} } = {}) {
    delete require.cache[repoIndexPath];
    const firestore = makeFirestore(seed);
    const fieldValue = {
        serverTimestamp: () => new FakeTimestamp(Date.now()),
        delete: () => ({ __op: 'delete' }),
        increment: (amount) => ({ __op: 'increment', amount }),
        arrayUnion: (...items) => ({ __op: 'arrayUnion', items })
    };
    adminStub = {
        apps: [true],
        initializeApp() {},
        firestore: Object.assign(() => firestore, {
            FieldValue: fieldValue,
            Timestamp: FakeTimestamp,
            FieldPath: { documentId: () => '__name__' }
        }),
        auth: () => ({
            verifyIdToken: async () => null,
            getUser: async (uid) => {
                const authUser = authUsers[uid];
                if (!authUser) {
                    const error = new Error(`Missing auth user: ${uid}`);
                    error.code = 'auth/user-not-found';
                    throw error;
                }
                return { uid, ...clone(authUser) };
            }
        }),
        messaging: () => ({})
    };
    functionsStub = makeFunctionsStub();
    StripeStub = class StripeMock {
        constructor() {
            return {
                checkout: { sessions: { create: async () => ({}) } },
                webhooks: { constructEvent: () => { throw new Error('Not implemented in test.'); } }
            };
        }
    };
    return { firestore, callables: require('../index.js') };
}

function authContext(uid, { email = `${uid}@example.com`, verified = true, name = uid } = {}) {
    return {
        auth: { uid, token: { email, email_verified: verified, name } },
        rawRequest: { ip: `203.0.113.${uid.length + 10}`, headers: {} }
    };
}

function activeListing(overrides = {}) {
    const now = Date.now();
    return {
        kind: 'coach_or_staff',
        title: 'Assistant coach opening',
        description: 'Help lead practices and game preparation.',
        sport: 'Basketball',
        role: 'Assistant coach',
        ageGroup: 'U14',
        competitiveLevel: 'Competitive',
        city: 'Overland Park',
        state: 'KS',
        zip: '66210',
        compensationType: 'volunteer',
        teamId: 'team-1',
        teamName: 'Bears',
        status: 'active',
        createdAt: new FakeTimestamp(now - 1000),
        updatedAt: new FakeTimestamp(now - 1000),
        expiresAt: new FakeTimestamp(now + 86400000),
        authorId: 'owner',
        recipientUserIds: ['owner'],
        internalNote: 'must never be public',
        ...overrides
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

test('opportunity writes require authentication and verified inquiry replies', async () => {
    const { callables } = loadCallables();

    await assert.rejects(
        callables.createPublicOpportunity({}, {}),
        (error) => error.code === 'unauthenticated'
    );
    await assert.rejects(
        callables.replyToOpportunityInquiry({ inquiryId: 'inquiry-1', message: 'Hello' }, authContext('user-1', { verified: false })),
        (error) => error.code === 'failed-precondition'
    );
});

test('team opportunity publishing is server-authorized and returns a public-only projection', async () => {
    const input = {
        kind: 'coach_or_staff',
        title: 'Assistant coach opening',
        description: 'Help lead practices and game preparation.',
        sport: 'Basketball',
        role: 'Assistant coach',
        ageGroup: 'U14',
        competitiveLevel: 'Competitive',
        city: 'Overland Park',
        state: 'KS',
        zip: '66210',
        compensationType: 'volunteer',
        teamId: 'team-1'
    };
    const seed = {
        'teams/team-1': { ownerId: 'owner', name: 'Bears', sport: 'Basketball', isPublic: true, active: true },
        'users/owner': { email: 'owner@example.com', isAdmin: false },
        'users/outsider': { email: 'outsider@example.com', isAdmin: false }
    };
    const { firestore, callables } = loadCallables(seed);

    await assert.rejects(
        callables.createPublicOpportunity(input, authContext('outsider')),
        (error) => error.code === 'permission-denied'
    );

    const result = await callables.createPublicOpportunity(input, authContext('owner'));
    assert.equal(result.item.teamId, 'team-1');
    assert.equal(result.item.status, 'active');
    assert.equal(Object.hasOwn(result.item, 'authorId'), false);
    assert.equal(Object.hasOwn(result.item, 'recipientUserIds'), false);
    const stored = firestore.snapshot(`publicOpportunities/${result.item.id}`);
    assert.equal(stored.authorId, 'owner');
    assert.deepEqual(stored.recipientUserIds, ['owner']);
});

test('public opportunity reads strip private fields and resume from returned cursors', async () => {
    const seed = {
        'publicOpportunities/newer': activeListing({
            createdAt: new FakeTimestamp(Date.now() - 1000),
            expiresAt: new FakeTimestamp(Date.now() + 172800000)
        }),
        'publicOpportunities/older': activeListing({
            title: 'Older opening',
            createdAt: new FakeTimestamp(Date.now() - 2000),
            expiresAt: new FakeTimestamp(Date.now() + 86400000)
        })
    };
    const { callables } = loadCallables(seed);

    const detail = await callables.getPublicOpportunity({ listingId: 'newer' }, {});
    assert.equal(detail.item.id, 'newer');
    assert.equal(Object.hasOwn(detail.item, 'authorId'), false);
    assert.equal(Object.hasOwn(detail.item, 'internalNote'), false);

    const firstPage = await callables.listPublicOpportunities({ pageSize: 1 }, {});
    assert.deepEqual(firstPage.items.map((item) => item.id), ['newer']);
    assert.equal(typeof firstPage.nextCursor, 'string');
    const secondPage = await callables.listPublicOpportunities({ pageSize: 1, cursor: firstPage.nextCursor }, {});
    assert.deepEqual(secondPage.items.map((item) => item.id), ['older']);
});

test('revoked team admins lose private inquiry access with bounded, resumable stale-row scans', async () => {
    const seed = {
        'users/former-admin': { email: 'former@example.com', isAdmin: false },
        'teams/team-1': { ownerId: 'current-owner', adminEmails: ['current@example.com'] }
    };
    for (let index = 0; index < 500; index += 1) {
        seed[`opportunityInquiries/stale-${String(index).padStart(3, '0')}`] = {
            senderId: `sender-${index}`,
            teamId: 'team-1',
            participantIds: ['former-admin', `sender-${index}`],
            updatedAt: new FakeTimestamp(Date.now() - index),
            createdAt: new FakeTimestamp(Date.now() - index),
            status: 'open'
        };
    }
    seed['opportunityInquiries/valid-individual'] = {
        senderId: 'sender-valid',
        teamId: null,
        participantIds: ['former-admin', 'sender-valid'],
        listingTitle: 'Individual listing',
        updatedAt: new FakeTimestamp(Date.now() - 1000),
        createdAt: new FakeTimestamp(Date.now() - 1000),
        status: 'open'
    };
    const { callables } = loadCallables(seed);
    const context = authContext('former-admin', { email: 'former@example.com' });

    const firstPage = await callables.listOpportunityInquiries({}, context);
    assert.deepEqual(firstPage.items, []);
    assert.equal(typeof firstPage.nextCursor, 'string');
    const secondPage = await callables.listOpportunityInquiries({ cursor: firstPage.nextCursor }, context);
    assert.deepEqual(secondPage.items.map((item) => item.id), ['valid-individual']);
    assert.equal(secondPage.nextCursor, null);
    await assert.rejects(
        callables.getOpportunityInquiry({ inquiryId: 'stale-000' }, context),
        (error) => error.code === 'permission-denied'
    );
});

test('current team admins can discover and open inquiries created before their assignment', async () => {
    const createdAt = new FakeTimestamp(Date.now() - 1000);
    const seed = {
        'users/current-admin': { email: 'current@example.com', isAdmin: false },
        'teams/team-1': { ownerId: 'current-admin', adminEmails: [] },
        'opportunityInquiries/older-inquiry': {
            senderId: 'sender-1',
            teamId: 'team-1',
            participantIds: ['former-admin', 'sender-1'],
            listingTitle: 'Coach opening',
            updatedAt: createdAt,
            createdAt,
            status: 'open'
        }
    };
    const { callables } = loadCallables(seed);
    const context = authContext('current-admin', { email: 'current@example.com' });

    const result = await callables.listOpportunityInquiries({}, context);
    assert.deepEqual(result.items.map((item) => item.id), ['older-inquiry']);
    const detail = await callables.getOpportunityInquiry({ inquiryId: 'older-inquiry' }, context);
    assert.equal(detail.inquiry.id, 'older-inquiry');
});

test('direct-message callable rechecks friendship and team access on the write path', async () => {
    const seed = {
        'users/sender': { email: 'sender@example.com', isAdmin: false, parentTeamIds: ['team-1'], fullName: 'Sender' },
        'users/recipient': { email: 'recipient@example.com', isAdmin: false, parentTeamIds: ['team-1'] },
        'teams/team-1': { ownerId: 'owner', adminEmails: [] },
        'friendships/recipient__sender': {
            status: 'accepted',
            memberIds: ['recipient', 'sender'],
            sharedTeamIds: ['team-1'],
            blockedBy: []
        },
        'teams/team-1/chatConversations/direct_sender__user%3Arecipient': {
            type: 'direct',
            participantIds: ['sender', 'user:recipient'],
            participantRoles: [],
            directAccess: 'accepted_friend',
            directUserIds: ['recipient', 'sender'],
            friendshipId: 'recipient__sender',
            initiatedBy: null
        }
    };
    const { firestore, callables } = loadCallables(seed);
    const context = authContext('sender', { email: 'sender@example.com' });
    const input = {
        teamId: 'team-1',
        conversationId: 'direct_sender__user%3Arecipient',
        clientMessageId: 'client-direct-1',
        text: 'Hi friend',
        attachments: [{
            type: 'image/jpeg',
            url: 'https://firebasestorage.googleapis.com/v0/b/allplays-images/o/direct-photo.jpg?alt=media',
            path: 'team-photos/1700000000000_chat_team-1_direct_sender__user%3Arecipient_sender_photo.jpg',
            name: 'photo.jpg',
            size: 1024
        }]
    };

    const sent = await callables.sendAuthorizedDirectMessage(input, context);
    assert.equal(sent.id, 'sender__client-direct-1');
    assert.equal(
        firestore.snapshot('teams/team-1/chatConversations/direct_sender__user%3Arecipient/chatMessages/sender__client-direct-1').text,
        'Hi friend'
    );
    assert.deepEqual(
        firestore.snapshot('teams/team-1/chatConversations/direct_sender__user%3Arecipient/chatMessages/sender__client-direct-1').recipientIds,
        ['user:recipient']
    );
    assert.deepEqual(
        firestore.snapshot('teams/team-1/chatConversations/direct_sender__user%3Arecipient/chatMessages/sender__client-direct-1').attachments.map((attachment) => ({
            type: attachment.type,
            mimeType: attachment.mimeType
        })),
        [{ type: 'image', mimeType: 'image/jpeg' }]
    );

    const retried = await callables.sendAuthorizedDirectMessage({
        ...input,
        text: 'Attempted replacement',
        attachments: []
    }, context);
    assert.equal(retried.id, sent.id);
    assert.equal(retried.createdAt, sent.createdAt);
    assert.equal(
        firestore.snapshot('teams/team-1/chatConversations/direct_sender__user%3Arecipient/chatMessages/sender__client-direct-1').text,
        'Hi friend'
    );
    assert.deepEqual(
        firestore.snapshot('teams/team-1/chatConversations/direct_sender__user%3Arecipient/chatMessages/sender__client-direct-1').attachments.map((attachment) => attachment.type),
        ['image']
    );

    const sentVideo = await callables.sendAuthorizedDirectMessage({
        ...input,
        clientMessageId: 'client-direct-video',
        text: '',
        attachments: [{
            type: null,
            mimeType: 'video/mp4',
            url: 'https://firebasestorage.googleapis.com/v0/b/allplays-images/o/direct-video.mp4?alt=media',
            path: 'team-videos/1700000000001_chat_team-1_direct_sender__user%3Arecipient_sender_video.mp4',
            name: 'video.mp4',
            size: 2048
        }]
    }, context);
    assert.equal(sentVideo.id, 'sender__client-direct-video');
    assert.deepEqual(
        firestore.snapshot('teams/team-1/chatConversations/direct_sender__user%3Arecipient/chatMessages/sender__client-direct-video').attachments.map((attachment) => ({
            type: attachment.type,
            mimeType: attachment.mimeType
        })),
        [{ type: 'video', mimeType: 'video/mp4' }]
    );

    await firestore.doc('friendships/recipient__sender').update({ status: 'removed' });
    await assert.rejects(
        callables.sendAuthorizedDirectMessage({ ...input, clientMessageId: 'client-direct-2' }, context),
        (error) => error.code === 'permission-denied'
    );
});

test('team-admin direct conversations allow either participant to reply while the initiator remains an admin', async () => {
    const conversationPath = 'teams/team-1/chatConversations/direct_owner__user%3Aparent';
    const seed = {
        'users/owner': { email: 'owner@example.com', isAdmin: false },
        'users/parent': { email: 'parent@example.com', isAdmin: false, parentTeamIds: ['team-1'] },
        'teams/team-1': { ownerId: 'owner', adminEmails: [] },
        [conversationPath]: {
            type: 'direct',
            participantIds: ['owner', 'user:parent'],
            participantRoles: [],
            directAccess: 'team_admin',
            directUserIds: ['owner', 'parent'],
            friendshipId: null,
            initiatedBy: 'owner'
        }
    };
    const { firestore, callables } = loadCallables(seed);

    const sent = await callables.sendAuthorizedDirectMessage({
        teamId: 'team-1',
        conversationId: 'direct_owner__user%3Aparent',
        clientMessageId: 'parent-reply-1',
        text: 'Thanks, coach',
        attachments: []
    }, authContext('parent'));

    assert.equal(sent.id, 'parent__parent-reply-1');
    assert.equal(
        firestore.snapshot(`${conversationPath}/chatMessages/parent__parent-reply-1`).senderId,
        'parent'
    );
    assert.deepEqual(
        firestore.snapshot(`${conversationPath}/chatMessages/parent__parent-reply-1`).recipientIds,
        ['owner']
    );

    await firestore.doc('teams/team-1').update({ ownerId: 'new-owner' });
    await assert.rejects(
        callables.sendAuthorizedDirectMessage({
            teamId: 'team-1',
            conversationId: 'direct_owner__user%3Aparent',
            clientMessageId: 'parent-reply-2',
            text: 'Can you still see this?',
            attachments: []
        }, authContext('parent')),
        (error) => error.code === 'permission-denied'
    );
});

test('email-only team admins can send and receive direct replies when their user profile omits email', async () => {
    const conversationPath = 'teams/team-1/chatConversations/direct_email-admin__user%3Aparent';
    const seed = {
        'users/email-admin': { isAdmin: false },
        'users/parent': { email: 'parent@example.com', isAdmin: false, parentTeamIds: ['team-1'] },
        'teams/team-1': { ownerId: 'owner', adminEmails: ['coach@example.com'] },
        [conversationPath]: {
            type: 'direct',
            participantIds: ['email-admin', 'user:parent'],
            participantRoles: [],
            directAccess: 'team_admin',
            directUserIds: ['email-admin', 'parent'],
            friendshipId: null,
            initiatedBy: 'email-admin'
        }
    };
    const { firestore, callables } = loadCallables(seed, {
        authUsers: { 'email-admin': { email: 'coach@example.com' } }
    });
    const input = {
        teamId: 'team-1',
        conversationId: 'direct_email-admin__user%3Aparent',
        text: 'Checking in',
        attachments: []
    };

    await callables.sendAuthorizedDirectMessage(
        { ...input, clientMessageId: 'admin-first' },
        authContext('email-admin', { email: 'coach@example.com' })
    );
    await callables.sendAuthorizedDirectMessage(
        { ...input, clientMessageId: 'parent-reply', text: 'Thanks' },
        authContext('parent')
    );

    assert.equal(
        firestore.snapshot(`${conversationPath}/chatMessages/email-admin__admin-first`).senderId,
        'email-admin'
    );
    assert.equal(
        firestore.snapshot(`${conversationPath}/chatMessages/parent__parent-reply`).senderId,
        'parent'
    );
});

test('opportunity moderation trusts protected user admin state only', async () => {
    const seed = {
        'users/member': { email: 'member@example.com', isAdmin: false },
        'users/platform-admin': { email: 'admin@example.com', isAdmin: true },
        'publicOpportunityReports/report-1': {
            listingId: 'listing-1',
            listingTitle: 'Assistant coach opening',
            reporterId: 'private-reporter',
            reason: 'Unsafe content',
            status: 'open',
            createdAt: new FakeTimestamp(Date.now() - 1000)
        }
    };
    const { callables } = loadCallables(seed);

    await assert.rejects(
        callables.listPublicOpportunityReports({}, authContext('member')),
        (error) => error.code === 'permission-denied'
    );
    const result = await callables.listPublicOpportunityReports({}, authContext('platform-admin'));
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].listingId, 'listing-1');
    assert.equal(Object.hasOwn(result.items[0], 'reporterId'), false);
});
