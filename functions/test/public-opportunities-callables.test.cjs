const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');

const repoIndexPath = require.resolve('../index.js');
const originalModuleLoad = Module._load;

let adminStub = null;
let functionsStub = null;
let StripeStub = null;
let resendStub = null;

function patchedModuleLoad(request, parent, isMain) {
    if (request === 'firebase-admin' && adminStub) return adminStub;
    if (request === 'firebase-functions' && functionsStub) return functionsStub;
    if (request === 'stripe' && StripeStub) return StripeStub;
    if (request === 'resend' && resendStub) return resendStub;
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

function makeFirestore(seed = {}, { queryFailures = [], beforeTransaction = null } = {}) {
    const state = new Map(Object.entries(seed).map(([path, value]) => [path, clone(value)]));
    const queryLog = [];
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

    function makeQuery(path, filters = [], orders = [], limitCount = null, cursor = null, collectionGroupName = null) {
        const query = {
            path,
            where(field, operator, value) {
                return makeQuery(path, [...filters, { field, operator, value }], orders, limitCount, cursor, collectionGroupName);
            },
            orderBy(field, direction = 'asc') {
                return makeQuery(path, filters, [...orders, { field, direction }], limitCount, cursor, collectionGroupName);
            },
            limit(count) {
                return makeQuery(path, filters, orders, Number(count), cursor, collectionGroupName);
            },
            startAfter(...values) {
                return makeQuery(path, filters, orders, limitCount, values.length === 1 && values[0]?.ref
                    ? { snapshot: values[0] }
                    : { values }, collectionGroupName);
            },
            doc(id) {
                return doc(`${path}/${id || `auto-${nextAutoId++}`}`);
            },
            async get() {
                queryLog.push({ path, filters: clone(filters), limitCount });
                const forcedFailure = queryFailures.find((failure) => (
                    failure?.path === path
                    && (!failure.field || filters.some(({ field, operator, value }) => (
                        field === failure.field
                        && operator === failure.operator
                        && (!Object.hasOwn(failure, 'value')
                            || JSON.stringify(comparable(value)) === JSON.stringify(comparable(failure.value)))
                    )))
                ));
                if (forcedFailure) throw new Error(forcedFailure.message || 'Forced query failure');
                const depth = path.split('/').length + 1;
                let snapshots = [...state.keys()]
                    .filter((entryPath) => collectionGroupName
                        ? entryPath.split('/').at(-2) === collectionGroupName
                        : entryPath.startsWith(`${path}/`) && entryPath.split('/').length === depth)
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

    function collectionGroup(name) {
        return makeQuery(`**/${name}`, [], [], null, null, name);
    }

    return {
        _state: state,
        _queryLog: queryLog,
        doc,
        collection,
        collectionGroup,
        runTransaction: async (callback) => {
            if (typeof beforeTransaction === 'function') {
                await beforeTransaction({ state });
            }
            const operations = [];
            const result = await callback({
                get: (ref) => ref.get(),
                create: (ref, value) => operations.push({ type: 'create', ref, value }),
                set: (ref, value, options) => operations.push({ type: 'set', ref, value, options }),
                update: (ref, value) => operations.push({ type: 'update', ref, value }),
                delete: (ref) => operations.push({ type: 'delete', ref })
            });
            const nextState = new Map(state);
            for (const operation of operations) {
                const path = operation.ref.path;
                if (operation.type === 'create') {
                    if (nextState.has(path)) {
                        const error = new Error(`Document already exists: ${path}`);
                        error.code = 6;
                        throw error;
                    }
                    nextState.set(path, clone(operation.value));
                } else if (operation.type === 'set') {
                    nextState.set(path, operation.options?.merge
                        ? { ...(nextState.get(path) || {}), ...clone(operation.value) }
                        : clone(operation.value));
                } else if (operation.type === 'update') {
                    if (!nextState.has(path)) throw new Error(`Missing document: ${path}`);
                    nextState.set(path, { ...nextState.get(path), ...clone(operation.value) });
                } else if (operation.type === 'delete') {
                    nextState.delete(path);
                }
            }
            state.clear();
            nextState.forEach((value, path) => state.set(path, value));
            return result;
        },
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
        timeZone() { return this; },
        user() { return this; }
    };
    triggerChain.https = triggerChain;
    triggerChain.auth = triggerChain;
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

function loadCallables(seed = {}, { authUsers = {}, queryFailures = [], beforeTransaction = null } = {}) {
    delete require.cache[repoIndexPath];
    const firestore = makeFirestore(seed, { queryFailures, beforeTransaction });
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
            getUserByEmail: async (email) => {
                const normalizedEmail = String(email || '').trim().toLowerCase();
                const match = Object.entries(authUsers).find(([, authUser]) => (
                    authUser
                    && !(authUser instanceof Error)
                    && String(authUser.email || '').trim().toLowerCase() === normalizedEmail
                ));
                if (!match) {
                    const error = new Error(`Missing auth user email: ${normalizedEmail}`);
                    error.code = 'auth/user-not-found';
                    throw error;
                }
                const [uid, authUser] = match;
                return { uid, ...clone(authUser) };
            },
            getUser: async (uid) => {
                if (!Object.prototype.hasOwnProperty.call(authUsers, uid)) {
                    const seededUser = seed[`users/${uid}`];
                    if (seededUser) {
                        return { uid, email: seededUser.email || null, disabled: false };
                    }
                    const error = new Error(`Missing auth user: ${uid}`);
                    error.code = 'auth/user-not-found';
                    throw error;
                }
                const authUser = authUsers[uid];
                if (authUser instanceof Error) throw authUser;
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
    resendStub = { Resend: class ResendMock {} };
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
    resendStub = null;
});

test.afterEach(() => {
    delete require.cache[repoIndexPath];
    Module._load = originalModuleLoad;
    adminStub = null;
    functionsStub = null;
    StripeStub = null;
    resendStub = null;
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

test('managed-team callables return access fields only to current managers', async () => {
    const { firestore, callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com', coachOf: ['coach-team', 'coach-team-2'] },
        'users/stranger-1': { email: 'stranger@example.com' },
        'users/stale-owner': { email: 'legacy-owner@example.com' },
        'teams/private-team': {
            name: 'Private Bears',
            sport: 'Basketball',
            ownerId: 'owner-1',
            active: true,
            isPublic: false,
            availabilityPreferences: { defaultStatus: 'available' },
            calendarUrls: ['https://calendar.example.test/private-team.ics'],
            privateCalendarFeedUrl: 'https://calendar.example.test/private/private-team.ics',
            privateBillingCustomerId: 'must-not-leak'
        },
        'teams/public-team': {
            name: 'Public Bears',
            sport: 'Basketball',
            ownerId: 'someone-else',
            active: true,
            isPublic: true
        },
        'teams/coach-team': {
            name: 'Coach Bears',
            sport: 'Basketball',
            ownerId: 'someone-else',
            adminEmails: ['someone@example.com'],
            active: true,
            isPublic: false,
            privateBillingCustomerId: 'must-not-leak-to-coach'
        },
        'teams/coach-team-2': {
            name: 'Coach Cougars',
            sport: 'Basketball',
            ownerId: 'someone-else',
            adminEmails: ['someone@example.com'],
            active: true,
            isPublic: false,
            privateBillingCustomerId: 'must-not-leak-to-coach'
        },
        'teams/stale-private-team': {
            name: 'Stale Private Bears',
            ownerEmail: 'legacy-owner@example.com',
            active: true,
            isPublic: false,
            privateBillingCustomerId: 'must-not-leak-from-stale-profile'
        },
        'teams/stale-public-team': {
            name: 'Stale Public Bears',
            ownerEmailLower: 'legacy-owner@example.com',
            active: true,
            isPublic: true,
            privateBillingCustomerId: 'must-not-leak-from-public-projection'
        }
    });

    const managed = await callables.listManagedTeams({}, authContext('owner-1', { email: 'owner@example.com' }));
    assert.deepEqual(managed.items, [
        {
            id: 'coach-team',
            name: 'Coach Bears',
            sport: 'Basketball',
            photoUrl: null,
            description: null,
            active: true,
            archived: false,
            status: null,
            isPublic: false
        },
        {
            id: 'coach-team-2',
            name: 'Coach Cougars',
            sport: 'Basketball',
            photoUrl: null,
            description: null,
            active: true,
            archived: false,
            status: null,
            isPublic: false
        },
        {
            id: 'private-team',
            name: 'Private Bears',
            sport: 'Basketball',
            active: true,
            isPublic: false,
            ownerId: 'owner-1',
            availabilityPreferences: { defaultStatus: 'available' },
            calendarUrls: ['https://calendar.example.test/private-team.ics'],
            privateCalendarFeedUrl: 'https://calendar.example.test/private/private-team.ics'
        }
    ]);
    const coachTeam = managed.items.find((team) => team.id === 'coach-team');
    const secondCoachTeam = managed.items.find((team) => team.id === 'coach-team-2');
    const privateTeam = managed.items.find((team) => team.id === 'private-team');
    assert.equal('ownerId' in coachTeam, false);
    assert.equal('adminEmails' in coachTeam, false);
    assert.equal('privateBillingCustomerId' in coachTeam, false);
    assert.equal('privateBillingCustomerId' in secondCoachTeam, false);
    assert.equal('privateBillingCustomerId' in privateTeam, false);
    const evidenceQueries = firestore._queryLog.filter(({ path, filters }) => (
        path === 'accessCodes' && filters.some(({ field, value }) => field === 'type' && value === 'admin_invite')
    ));
    assert.equal(evidenceQueries.length, 1);
    assert.ok(evidenceQueries.every(({ limitCount }) => limitCount === 201));
    assert.deepEqual(
        evidenceQueries.map(({ filters }) => filters.map(({ field }) => field)),
        [['type', 'teamId']]
    );

    const privateProfile = await callables.getPublicTeamProfile(
        { teamId: 'private-team' },
        authContext('owner-1', { email: 'owner@example.com' })
    );
    assert.equal(privateProfile.item.ownerId, 'owner-1');
    assert.equal('privateBillingCustomerId' in privateProfile.item, false);

    const publicProfile = await callables.getPublicTeamProfile({ teamId: 'public-team' }, {});
    assert.equal(publicProfile.item.name, 'Public Bears');
    assert.equal('ownerId' in publicProfile.item, false);
    assert.equal('adminEmails' in publicProfile.item, false);

    await assert.rejects(
        callables.getPublicTeamProfile(
            { teamId: 'private-team' },
            authContext('stranger-1', { email: 'stranger@example.com' })
        ),
        (error) => error.code === 'not-found'
    );

    const staleProfileContext = authContext('stale-owner', { email: null });
    assert.deepEqual((await callables.listManagedTeams({}, staleProfileContext)).items, []);
    await assert.rejects(
        callables.getPublicTeamProfile({ teamId: 'stale-private-team' }, staleProfileContext),
        (error) => error.code === 'not-found'
    );
    const stalePublicProfile = await callables.getPublicTeamProfile(
        { teamId: 'stale-public-team' },
        staleProfileContext
    );
    assert.equal(stalePublicProfile.item.name, 'Stale Public Bears');
    assert.equal('ownerEmailLower' in stalePublicProfile.item, false);
    assert.equal('privateBillingCustomerId' in stalePublicProfile.item, false);
});

test('managed-team discovery normalizes legacy teamName-only documents before sorting', async () => {
    const { callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com' },
        'teams/zebra-team': {
            teamName: 'Zebras',
            ownerId: 'owner-1',
            active: true,
            isPublic: false
        },
        'teams/bears-team': {
            name: 'Bears',
            ownerId: 'owner-1',
            active: true,
            isPublic: false
        }
    });

    const managed = await callables.listManagedTeams(
        {},
        authContext('owner-1', { email: 'owner@example.com' })
    );

    assert.deepEqual(managed.items.map((team) => ({ id: team.id, name: team.name })), [
        { id: 'bears-team', name: 'Bears' },
        { id: 'zebra-team', name: 'Zebras' }
    ]);
});

test('managed-team discovery returns bounded chat thread summaries without participant data', async () => {
    const { callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com' },
        'teams/team-1': { name: 'Bears', ownerId: 'owner-1', active: true },
        'teams/team-1/chatConversations/direct-1': {
            type: 'direct',
            participantIds: ['owner-1', 'user-2'],
            directUserIds: ['owner-1', 'user-2'],
            updatedAt: new FakeTimestamp(2000),
            lastMessageAt: new FakeTimestamp(1900),
            privateNote: 'must-not-leak'
        }
    });

    const managed = await callables.listManagedTeams(
        { includeChatMetadata: true },
        authContext('owner-1', { email: 'owner@example.com' })
    );

    assert.equal(managed.isPartial, false);
    assert.equal(managed.items[0].chatAccessVerified, true);
    assert.deepEqual(managed.items[0].chatConversations, [{
        id: 'direct-1',
        type: 'direct',
        updatedAt: new FakeTimestamp(2000),
        lastMessageAt: new FakeTimestamp(1900)
    }]);
    assert.equal('participantIds' in managed.items[0].chatConversations[0], false);
});

test('managed-team chat discovery includes parent-only teams and their conversation summaries', async () => {
    const { callables } = loadCallables({
        'users/parent-1': { parentTeamIds: ['team-parent'] },
        'teams/team-parent': { name: 'Parent Bears', ownerId: 'owner-1', active: true },
        'teams/team-parent/chatConversations/group-1': {
            type: 'group',
            lastMessageAt: new FakeTimestamp(1900),
            participantIds: ['parent-1', 'owner-1']
        }
    });

    const managed = await callables.listManagedTeams(
        { includeChatMetadata: true },
        authContext('parent-1', { email: 'parent@example.com' })
    );

    assert.equal(managed.isPartial, false);
    assert.deepEqual(managed.items, [{
        id: 'team-parent',
        name: 'Parent Bears',
        sport: null,
        photoUrl: null,
        description: null,
        active: true,
        archived: false,
        status: null,
        isPublic: false,
        chatAccessVerified: true,
        chatConversations: [{
            id: 'group-1',
            type: 'group',
            updatedAt: null,
            lastMessageAt: new FakeTimestamp(1900)
        }]
    }]);
});

test('managed-team chat discovery excludes legacy coach-only grants without current chat access', async () => {
    const { callables } = loadCallables({
        'users/coach-1': { coachOf: ['team-legacy'] },
        'teams/team-legacy': { name: 'Legacy Bears', ownerId: 'owner-1', active: true },
        'teams/team-legacy/chatConversations/group-1': { type: 'group' }
    });

    const managed = await callables.listManagedTeams(
        { includeChatMetadata: true },
        authContext('coach-1', { email: 'coach@example.com' })
    );

    assert.deepEqual(managed.items, []);
    assert.equal(managed.isPartial, false);
});

test('managed-team discovery marks chat metadata partial when a thread query fails', async () => {
    const { callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com' },
        'teams/team-1': { name: 'Bears', ownerId: 'owner-1', active: true }
    }, {
        queryFailures: [{ path: 'teams/team-1/chatConversations', message: 'chat metadata unavailable' }]
    });

    const managed = await callables.listManagedTeams(
        { includeChatMetadata: true },
        authContext('owner-1', { email: 'owner@example.com' })
    );

    assert.equal(managed.isPartial, true);
    assert.equal('chatConversations' in managed.items[0], false);
});

test('authorized chat conversation projection hydrates only caller-readable allow-listed threads', async () => {
    const { callables } = loadCallables({
        'users/parent-1': { parentTeamIds: ['team-parent'] },
        'teams/team-parent': { name: 'Parent Bears', ownerId: 'owner-1', active: true },
        'teams/team-parent/chatConversations/direct-parent': {
            type: 'direct',
            name: 'Coach Taylor',
            participantIds: ['parent-1', 'user:coach-1'],
            directUserIds: ['parent-1', 'coach-1'],
            directAccess: 'team_admin',
            initiatedBy: 'coach-1',
            updatedAt: new FakeTimestamp(2000),
            lastMessageAt: new FakeTimestamp(1900),
            mutedBy: ['coach-1'],
            privateNote: 'must-not-leak'
        },
        'teams/team-parent/chatConversations/direct-other': {
            type: 'direct',
            participantIds: ['user-2', 'user-3'],
            directUserIds: ['user-2', 'user-3'],
            directAccess: 'accepted_friend'
        }
    });

    const result = await callables.listAuthorizedChatConversations(
        { teamId: 'team-parent', activeConversationId: 'direct-parent' },
        authContext('parent-1', { email: 'parent@example.com' })
    );

    assert.equal(result.isPartial, false);
    assert.deepEqual(result.items, [{
        id: 'direct-parent',
        type: 'direct',
        name: 'Coach Taylor',
        participantIds: ['parent-1', 'user:coach-1'],
        participantRoles: [],
        directAccess: 'team_admin',
        directUserIds: ['parent-1', 'coach-1'],
        friendshipId: null,
        initiatedBy: 'coach-1',
        updatedAt: '1970-01-01T00:00:02.000Z',
        lastMessageAt: '1970-01-01T00:00:01.900Z',
        isDefault: false,
        isLegacy: false
    }]);
    assert.equal('mutedBy' in result.items[0], false);
    assert.equal('privateNote' in result.items[0], false);
});

test('chat metadata callables do not repair a whitespace-distinct caller into another participant', async () => {
    const { callables } = loadCallables({
        'users/parent-1 ': { parentTeamIds: ['team-parent'] },
        'teams/team-parent': { name: 'Parent Bears', ownerId: 'owner-1', active: true },
        'teams/team-parent/chatConversations/group-parent': {
            type: 'group',
            participantIds: ['parent-1']
        },
        'teams/team-parent/chatConversations/direct-parent': {
            type: 'direct',
            directAccess: 'accepted_friend',
            participantIds: ['parent-1', 'friend-1'],
            directUserIds: ['parent-1', 'friend-1']
        }
    });
    const context = authContext('parent-1 ', { email: 'parent@example.com' });

    const managed = await callables.listManagedTeams({ includeChatMetadata: true }, context);
    assert.equal(managed.isPartial, false);
    assert.equal('chatConversations' in managed.items[0], false);

    const authorized = await callables.listAuthorizedChatConversations({ teamId: 'team-parent' }, context);
    assert.deepEqual(authorized, { items: [], isPartial: false });
    await assert.rejects(
        callables.listAuthorizedChatConversations({
            teamId: 'team-parent',
            activeConversationId: 'group-parent'
        }, context),
        (error) => error.code === 'permission-denied'
    );
});

test('authorized chat conversation projection fails closed for unavailable threads and unverified email grants', async () => {
    const { callables } = loadCallables({
        'users/email-admin': {},
        'teams/team-1': { name: 'Bears', ownerId: 'owner-1', adminEmails: ['admin@example.com'], active: true },
        'teams/team-1/chatConversations/group-1': { type: 'group' }
    });

    await assert.rejects(
        callables.listAuthorizedChatConversations(
            { teamId: 'team-1', activeConversationId: 'group-1' },
            authContext('email-admin', { email: 'admin@example.com', verified: false })
        ),
        (error) => error.code === 'permission-denied'
    );
    await assert.rejects(
        callables.listAuthorizedChatConversations(
            { teamId: 'team-1', activeConversationId: 'missing-thread' },
            authContext('owner-1')
        ),
        (error) => error.code === 'permission-denied'
    );
});

test('authorized chat conversation projection rejects an incomplete bounded scan', async () => {
    const conversations = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [
        `teams/team-1/chatConversations/group-${index}`,
        { type: 'group', participantIds: ['owner-1'] }
    ]));
    const { callables } = loadCallables({
        'users/owner-1': {},
        'teams/team-1': { name: 'Bears', ownerId: 'owner-1', active: true },
        ...conversations
    });

    await assert.rejects(
        callables.listAuthorizedChatConversations({ teamId: 'team-1' }, authContext('owner-1')),
        (error) => error.code === 'resource-exhausted'
    );
});

test('parent fee discovery returns bounded modern and legacy player assignments without private checkout state', async () => {
    const { firestore, callables } = loadCallables({
        'users/parent-1': {
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-1'],
            parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
        },
        'teams/team-1/feeBatches/batch-1/feeRecipients/modern': {
            teamId: 'team-1',
            batchId: 'batch-1',
            recipientId: 'modern',
            playerId: 'player-1',
            playerKey: 'team-1::player-1',
            amountDueCents: 2500,
            checkoutUrl: 'https://checkout.stripe.com/private',
            receiptMetadata: { amountPaidCents: 500, paymentIntentId: 'pi_private' },
            ledgerEntries: [{ type: 'payment', amountCents: 500, providerSessionId: 'cs_private' }]
        },
        'teams/team-1/feeBatches/batch-2/feeRecipients/legacy': {
            teamId: 'team-1',
            playerId: 'player-1',
            amountDueCents: 1500
        },
        'teams/team-1/feeBatches/batch-2/feeRecipients/unrelated': {
            teamId: 'team-1',
            playerId: 'player-2',
            amountDueCents: 9999
        }
    });

    const result = await callables.listParentTeamFeeRecipients({}, authContext('parent-1'));

    assert.deepEqual(result.items.map((item) => item.id).sort(), ['legacy', 'modern']);
    const legacy = result.items.find((item) => item.id === 'legacy');
    assert.equal(legacy.batchId, 'batch-2');
    assert.equal(legacy.recipientId, 'legacy');
    assert.equal(legacy.playerKey, 'team-1::player-1');
    const modern = result.items.find((item) => item.id === 'modern');
    assert.equal('checkoutUrl' in modern, false);
    assert.equal('paymentIntentId' in modern.receiptMetadata, false);
    assert.equal('providerSessionId' in modern.ledgerEntries[0], false);
    const feeQueries = firestore._queryLog.filter(({ path }) => path === '**/feeRecipients');
    assert.ok(feeQueries.length > 0);
    assert.ok(feeQueries.every(({ limitCount }) => limitCount === 101));
});

test('parent fee discovery fails closed when a bounded query overflows', async () => {
    const seed = {
        'users/parent-1': { parentTeamIds: ['team-1'] }
    };
    for (let index = 0; index < 101; index += 1) {
        seed[`teams/team-1/feeBatches/batch-1/feeRecipients/direct-${index}`] = {
            parentUserId: 'parent-1',
            amountDueCents: 100
        };
    }
    const { callables } = loadCallables(seed);

    await assert.rejects(
        callables.listParentTeamFeeRecipients({}, authContext('parent-1')),
        (error) => error.code === 'resource-exhausted'
    );
});

test('parent fee discovery is authenticated and rejects incomplete server queries', async () => {
    const seed = {
        'users/parent-1': {
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-1']
        }
    };
    const { callables } = loadCallables(seed);
    await assert.rejects(
        callables.listParentTeamFeeRecipients({}, {}),
        (error) => error.code === 'unauthenticated'
    );

    const failed = loadCallables(seed, {
        queryFailures: [{
            path: '**/feeRecipients',
            field: 'playerId',
            operator: '==',
            value: 'player-1',
            message: 'fee query failed'
        }]
    });
    await assert.rejects(
        failed.callables.listParentTeamFeeRecipients({}, authContext('parent-1')),
        /fee query failed/
    );
});

test('parent fee discovery preserves direct UID assignments for parent-team-only profiles', async () => {
    const { callables } = loadCallables({
        'users/parent-1': { parentTeamIds: ['team-1'] },
        'teams/team-1/feeBatches/batch-1/feeRecipients/direct': {
            teamId: 'team-1',
            parentUserId: 'parent-1',
            amountDueCents: 3200
        }
    });

    const result = await callables.listParentTeamFeeRecipients({}, authContext('parent-1'));

    assert.deepEqual(result.items.map((item) => item.id), ['direct']);
});

test('social mutation callables authorize native post actions server-side', async () => {
    const { firestore, callables } = loadCallables({
        'users/parent-1': {
            email: 'parent@example.com',
            isAdmin: false,
            parentTeamIds: ['team-1'],
            photoUrl: 'https://img.example.test/parent.jpg'
        },
        'teams/team-1': {
            ownerId: 'owner-1',
            adminEmails: []
        },
        'socialPosts/post.with:punctuation': {
            authorId: 'author-1',
            teamId: 'team-1',
            visibleUserIds: [],
            hidden: false,
            reactionCounts: { like: 2 }
        }
    });

    const reaction = await callables.toggleSocialPostReaction(
        { postId: 'post.with:punctuation', reactionKey: 'like' },
        authContext('parent-1', { email: 'parent@example.com' })
    );
    assert.deepEqual(reaction, { liked: true, count: 3 });
    assert.equal(
        firestore.snapshot('socialPosts/post.with:punctuation/reactions/parent-1').userId,
        'parent-1'
    );
    assert.equal(
        firestore.snapshot('socialPosts/post.with:punctuation')['reactionCounts.like'],
        3
    );

    const hidden = await callables.hideSocialPostForCaller(
        { postId: 'post.with:punctuation' },
        authContext('parent-1', { email: 'parent@example.com' })
    );
    assert.deepEqual(hidden, { hidden: true });
    assert.equal(
        firestore.snapshot('users/parent-1/hiddenSocialPosts/post.with:punctuation').postId,
        'post.with:punctuation'
    );

    const comment = await callables.commentOnSocialPostForCaller(
        { postId: 'post.with:punctuation', text: ' Great update! ' },
        authContext('parent-1', { email: 'parent@example.com', name: 'Pat Parent' })
    );
    assert.deepEqual(comment, { commented: true, commentId: 'auto-1' });
    assert.deepEqual(firestore.snapshot('socialPosts/post.with:punctuation/comments/auto-1'), {
        text: 'Great update!',
        authorId: 'parent-1',
        authorName: 'Pat Parent',
        authorPhotoUrl: 'https://img.example.test/parent.jpg',
        hidden: false,
        createdAt: firestore.snapshot('socialPosts/post.with:punctuation/comments/auto-1').createdAt,
        updatedAt: firestore.snapshot('socialPosts/post.with:punctuation/comments/auto-1').updatedAt
    });

    const report = await callables.reportSocialPostForCaller(
        { postId: 'post.with:punctuation', reason: ' Needs review ' },
        authContext('parent-1', { email: 'parent@example.com' })
    );
    assert.deepEqual(report, { reported: true, reportId: 'auto-2' });
    assert.deepEqual(firestore.snapshot('socialReports/auto-2'), {
        postId: 'post.with:punctuation',
        reporterId: 'parent-1',
        reason: 'Needs review',
        status: 'open',
        createdAt: firestore.snapshot('socialReports/auto-2').createdAt
    });
});

test('social reaction callable rejects hidden, unrelated, and malformed requests', async () => {
    const { callables } = loadCallables({
        'users/viewer-1': { email: 'viewer@example.com', parentTeamIds: [] },
        'socialPosts/private-post': {
            authorId: 'author-1',
            visibleUserIds: [],
            hidden: false,
            reactionCounts: { like: 0 }
        },
        'socialPosts/hidden-post': {
            authorId: 'viewer-1',
            visibleUserIds: ['viewer-1'],
            hidden: true,
            reactionCounts: { like: 0 }
        }
    });

    await assert.rejects(
        callables.toggleSocialPostReaction(
            { postId: 'private-post', reactionKey: 'like' },
            authContext('viewer-1', { email: 'viewer@example.com' })
        ),
        (error) => error.code === 'permission-denied'
    );
    await assert.rejects(
        callables.toggleSocialPostReaction(
            { postId: 'hidden-post', reactionKey: 'like' },
            authContext('viewer-1', { email: 'viewer@example.com' })
        ),
        (error) => error.code === 'permission-denied'
    );
    await assert.rejects(
        callables.hideSocialPostForCaller(
            { postId: 'bad/path' },
            authContext('viewer-1', { email: 'viewer@example.com' })
        ),
        (error) => error.code === 'invalid-argument'
    );
    await assert.rejects(
        callables.commentOnSocialPostForCaller(
            { postId: 'private-post', text: 'Unauthorized comment' },
            authContext('viewer-1', { email: 'viewer@example.com' })
        ),
        (error) => error.code === 'permission-denied'
    );
    await assert.rejects(
        callables.commentOnSocialPostForCaller(
            { postId: 'private-post', text: '   ' },
            authContext('viewer-1', { email: 'viewer@example.com' })
        ),
        (error) => error.code === 'invalid-argument'
    );
    await assert.rejects(
        callables.reportSocialPostForCaller(
            { postId: 'private-post', reason: 'Unauthorized report' },
            authContext('viewer-1', { email: 'viewer@example.com' })
        ),
        (error) => error.code === 'permission-denied'
    );
    await assert.rejects(
        callables.reportSocialPostForCaller(
            { postId: 'private-post', reason: { unsafe: true } },
            authContext('viewer-1', { email: 'viewer@example.com' })
        ),
        (error) => error.code === 'invalid-argument'
    );
});

test('team admin revocation atomically clears reciprocal coach access and accepted invites', async () => {
    const { firestore, callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com' },
        'users/coach-1': {
            email: 'new-coach@example.com',
            profileEmail: 'coach@example.com',
            coachOf: ['team-1', 'other-team']
        },
        'users/legacy-coach': {
            email: 'coach@example.com',
            profileEmail: 'coach@example.com',
            coachOf: ['team-1']
        },
        'teams/team-1': {
            name: 'Private Bears',
            ownerId: 'owner-1',
            ownerEmailLower: 'owner@example.com',
            adminEmails: ['Coach@Example.com'],
            isPublic: false,
            active: true
        },
        'accessCodes/admin-invite-1': {
            type: 'admin_invite',
            teamId: 'team-1',
            email: 'coach@example.com',
            used: true,
            usedBy: 'coach-1'
        }
    });

    const result = await callables.revokeTeamAdminAccess(
        { teamId: 'team-1', email: ' Coach@Example.com ' },
        authContext('owner-1', { email: 'owner@example.com' })
    );

    assert.deepEqual(result, { success: true, removedUserCount: 1 });
    assert.deepEqual(firestore.snapshot('teams/team-1').adminEmails, []);
    assert.deepEqual(firestore.snapshot('users/coach-1').coachOf, ['other-team']);
    assert.deepEqual(firestore.snapshot('users/legacy-coach').coachOf, ['team-1']);
    assert.equal(firestore.snapshot('accessCodes/admin-invite-1').revoked, true);
    assert.equal(firestore.snapshot('accessCodes/admin-invite-1').status, 'revoked');
    assert.deepEqual(
        (await callables.listManagedTeams({}, authContext('coach-1', { email: 'new-coach@example.com' }))).items,
        []
    );
});

test('team admin revocation accepts slash-free principal IDs and rejects non-string bindings', async () => {
    const { firestore, callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com' },
        'users/coach.user:1': { email: 'coach@example.com', coachOf: ['team-1'] },
        'users/12345': { email: 'unrelated@example.com', coachOf: ['team-1'] },
        'teams/team-1': {
            ownerId: 'owner-1',
            adminEmails: ['coach@example.com']
        },
        'accessCodes/dotted-principal': {
            type: 'admin_invite',
            teamId: 'team-1',
            email: 'coach@example.com',
            used: true,
            usedBy: 'coach.user:1'
        },
        'accessCodes/non-string-principal': {
            type: 'admin_invite',
            teamId: 'team-1',
            email: 'coach@example.com',
            used: true,
            usedBy: 12345
        }
    });

    const result = await callables.revokeTeamAdminAccess(
        { teamId: 'team-1', email: 'coach@example.com' },
        authContext('owner-1', { email: 'owner@example.com' })
    );

    assert.deepEqual(result, { success: true, removedUserCount: 1 });
    assert.deepEqual(firestore.snapshot('users/coach.user:1').coachOf, []);
    assert.deepEqual(firestore.snapshot('users/12345').coachOf, ['team-1']);
});

test('team admin revocation clears reciprocal coach access for a current Auth grant without an invite binding', async () => {
    const { firestore, callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com' },
        'users/legacy-coach': {
            email: 'stale-profile@example.com',
            coachOf: ['team-1', 'other-team']
        },
        'teams/team-1': {
            name: 'Private Bears',
            ownerId: 'owner-1',
            adminEmails: ['Coach@Example.com'],
            isPublic: false,
            active: true
        }
    }, {
        authUsers: {
            'legacy-coach': { email: 'coach@example.com', disabled: false }
        }
    });

    const result = await callables.revokeTeamAdminAccess(
        { teamId: 'team-1', email: ' Coach@Example.com ' },
        authContext('owner-1', { email: 'owner@example.com' })
    );

    assert.deepEqual(result, { success: true, removedUserCount: 1 });
    assert.deepEqual(firestore.snapshot('teams/team-1').adminEmails, []);
    assert.deepEqual(firestore.snapshot('users/legacy-coach').coachOf, ['other-team']);
    assert.deepEqual(
        (await callables.listManagedTeams({}, authContext('legacy-coach', { email: 'coach@example.com' }))).items,
        []
    );
});

test('team admin revocation cannot remove a canonical owner resolved through current Auth', async () => {
    const { firestore, callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com', coachOf: ['team-1'] },
        'users/platform-admin': { email: 'platform@example.com', isAdmin: true },
        'teams/team-1': {
            ownerId: 'owner-1',
            adminEmails: ['owner@example.com']
        }
    }, {
        authUsers: {
            'owner-1': { email: 'owner@example.com', disabled: false }
        }
    });

    await assert.rejects(
        callables.revokeTeamAdminAccess(
            { teamId: 'team-1', email: 'owner@example.com' },
            authContext('platform-admin', { email: 'platform@example.com' })
        ),
        (error) => error.code === 'failed-precondition'
            && error.message === 'The team owner cannot be removed from staff access.'
    );

    assert.deepEqual(firestore.snapshot('teams/team-1').adminEmails, ['owner@example.com']);
    assert.deepEqual(firestore.snapshot('users/owner-1').coachOf, ['team-1']);
});

test('team admin revocation preserves authenticated manager access before email verification', async () => {
    const { firestore, callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com' },
        'users/coach-1': { email: 'coach@example.com', coachOf: ['team-1'] },
        'teams/team-1': {
            ownerId: 'owner-1',
            adminEmails: ['coach@example.com']
        },
        'accessCodes/admin-invite-1': {
            type: 'admin_invite',
            teamId: 'team-1',
            email: 'coach@example.com',
            used: true,
            usedBy: 'coach-1'
        }
    });

    await callables.revokeTeamAdminAccess(
        { teamId: 'team-1', email: 'coach@example.com' },
        authContext('owner-1', { email: 'owner@example.com', verified: false })
    );

    assert.deepEqual(firestore.snapshot('teams/team-1').adminEmails, []);
    assert.deepEqual(firestore.snapshot('users/coach-1').coachOf, []);
});

test('canonical ownerId allows revoking a staff grant that matches a stale owner alias', async () => {
    const { firestore, callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com' },
        'users/former-owner': { email: 'former@example.com', coachOf: ['team-1'] },
        'teams/team-1': {
            ownerId: 'owner-1',
            ownerEmail: 'owner@example.com',
            ownerEmailLower: 'former@example.com',
            adminEmails: ['former@example.com']
        },
        'accessCodes/admin-invite-1': {
            type: 'admin_invite',
            teamId: 'team-1',
            email: 'former@example.com',
            used: true,
            usedBy: 'former-owner'
        }
    });

    await callables.revokeTeamAdminAccess(
        { teamId: 'team-1', email: 'former@example.com' },
        authContext('owner-1', { email: 'owner@example.com' })
    );

    assert.deepEqual(firestore.snapshot('teams/team-1').adminEmails, []);
    assert.deepEqual(firestore.snapshot('users/former-owner').coachOf, []);
    assert.equal(firestore.snapshot('accessCodes/admin-invite-1').revoked, true);
});

test('conflicting legacy owner aliases do not protect a stale staff grant', async () => {
    const { firestore, callables } = loadCallables({
        'users/platform-admin': { email: 'platform@example.com', isAdmin: true },
        'users/former-owner': { email: 'former@example.com', coachOf: ['team-1'] },
        'teams/team-1': {
            ownerEmail: 'current@example.com',
            ownerEmailLower: 'former@example.com',
            adminEmails: ['former@example.com']
        },
        'accessCodes/admin-invite-1': {
            type: 'admin_invite',
            teamId: 'team-1',
            email: 'former@example.com',
            used: true,
            usedBy: 'former-owner'
        }
    });

    await callables.revokeTeamAdminAccess(
        { teamId: 'team-1', email: 'former@example.com' },
        authContext('platform-admin', { email: 'platform@example.com' })
    );

    assert.deepEqual(firestore.snapshot('teams/team-1').adminEmails, []);
    assert.deepEqual(firestore.snapshot('users/former-owner').coachOf, []);
    assert.equal(firestore.snapshot('accessCodes/admin-invite-1').revoked, true);
});

test('email-only team admins cannot revoke their own canonical access', async () => {
    const { firestore, callables } = loadCallables({
        'users/coach-1': { email: 'coach@example.com', coachOf: ['team-1'] },
        'teams/team-1': {
            ownerId: 'owner-1',
            ownerEmailLower: 'owner@example.com',
            adminEmails: ['coach@example.com']
        },
        'accessCodes/admin-invite-1': {
            type: 'admin_invite',
            teamId: 'team-1',
            email: 'coach@example.com',
            used: true,
            usedBy: 'coach-1'
        }
    });

    await assert.rejects(
        callables.revokeTeamAdminAccess(
            { teamId: 'team-1', email: 'coach@example.com' },
            authContext('coach-1', { email: 'coach@example.com' })
        ),
        (error) => error.code === 'failed-precondition'
            && error.message === 'Team admins cannot remove their own staff access.'
    );

    assert.deepEqual(firestore.snapshot('teams/team-1').adminEmails, ['coach@example.com']);
    assert.deepEqual(firestore.snapshot('users/coach-1').coachOf, ['team-1']);
    assert.equal(firestore.snapshot('accessCodes/admin-invite-1').revoked, undefined);
});

test('managed-team discovery rejects an accepted invite whose canonical team grant was removed', async () => {
    const { callables } = loadCallables({
        'users/coach-1': { email: 'coach@example.com', coachOf: ['team-1'] },
        'teams/team-1': {
            name: 'Private Bears',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        },
        'accessCodes/admin-invite-1': {
            type: 'admin_invite',
            teamId: 'team-1',
            email: 'coach@example.com',
            used: true,
            usedBy: 'coach-1'
        }
    });

    assert.deepEqual(
        (await callables.listManagedTeams({}, authContext('coach-1', { email: 'coach@example.com' }))).items,
        []
    );
});

test('managed-team discovery rejects an orphaned pre-transaction coach grant after rollback failure', async () => {
    const { callables } = loadCallables({
        'users/coach-1': {
            email: 'coach@example.com',
            roles: ['coach'],
            coachOf: ['team-1']
        },
        'teams/team-1': {
            name: 'Private Bears',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        },
        'accessCodes/admin-invite-1': {
            type: 'admin_invite',
            teamId: 'team-1',
            email: 'coach@example.com',
            used: false
        }
    });

    assert.deepEqual(
        (await callables.listManagedTeams({}, authContext('coach-1', { email: 'coach@example.com' }))).items,
        []
    );
});

test('managed-team discovery rejects an old-email orphan after the caller changes Auth email', async () => {
    const { firestore, callables } = loadCallables({
        'users/coach-1': {
            email: 'new-coach@example.com',
            roles: ['coach'],
            coachOf: ['team-1']
        },
        'teams/team-1': {
            name: 'Private Bears',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        },
        'accessCodes/admin-invite-1': {
            type: 'admin_invite',
            teamId: 'team-1',
            email: 'old-coach@example.com',
            used: false
        }
    });

    const managed = await callables.listManagedTeams(
        {},
        authContext('coach-1', { email: 'new-coach@example.com' })
    );

    assert.deepEqual(managed.items, []);
    const teamEvidenceQuery = firestore._queryLog.find(({ path, filters }) => (
        path === 'accessCodes' && filters.some(({ field }) => field === 'teamId')
    ));
    assert.deepEqual(teamEvidenceQuery.filters, [
        { field: 'type', operator: '==', value: 'admin_invite' },
        { field: 'teamId', operator: 'in', value: ['team-1'] }
    ]);
    assert.equal(teamEvidenceQuery.limitCount, 201);
});

test('managed-team discovery rejects caller-bound or ambiguous invites without hiding grants behind another principal', async () => {
    const { callables } = loadCallables({
        'users/coach-1': {
            email: 'new-coach@example.com',
            roles: ['coach'],
            coachOf: [
                'team-used-by-caller',
                'team-used-by-other',
                'team-used-by-dotted-principal',
                'team-used-without-principal',
                'team-malformed-principal',
                'team-non-string-principal',
                'team-outbound'
            ]
        },
        'teams/team-used-by-caller': {
            name: 'Used By Caller',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        },
        'teams/team-used-by-other': {
            name: 'Used By Other',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        },
        'teams/team-used-without-principal': {
            name: 'Used Without Principal',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        },
        'teams/team-used-by-dotted-principal': {
            name: 'Used By Dotted Principal',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        },
        'teams/team-outbound': {
            name: 'Outbound Invite',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        },
        'teams/team-malformed-principal': {
            name: 'Malformed Principal',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        },
        'teams/team-non-string-principal': {
            name: 'Non-string Principal',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        },
        'accessCodes/admin-invite-used-by-caller': {
            type: 'admin_invite',
            teamId: 'team-used-by-caller',
            email: 'old-coach@example.com',
            generatedBy: 'coach-1',
            used: true,
            usedBy: 'coach-1'
        },
        'accessCodes/admin-invite-used-by-other': {
            type: 'admin_invite',
            teamId: 'team-used-by-other',
            email: 'old-coach@example.com',
            used: true,
            usedBy: 'other-user'
        },
        'accessCodes/admin-invite-used-by-dotted-principal': {
            type: 'admin_invite',
            teamId: 'team-used-by-dotted-principal',
            email: 'old-coach@example.com',
            used: true,
            usedBy: 'other.user:1'
        },
        'accessCodes/admin-invite-used-without-principal': {
            type: 'admin_invite',
            teamId: 'team-used-without-principal',
            email: 'older-coach@example.com',
            used: true
        },
        'accessCodes/admin-invite-outbound': {
            type: 'admin_invite',
            teamId: 'team-outbound',
            email: 'incoming-coach@example.com',
            generatedBy: 'coach-1',
            used: false
        },
        'accessCodes/admin-invite-malformed-principal': {
            type: 'admin_invite',
            teamId: 'team-malformed-principal',
            email: 'unknown-coach@example.com',
            used: true,
            usedBy: 'not/a/uid'
        },
        'accessCodes/admin-invite-non-string-principal': {
            type: 'admin_invite',
            teamId: 'team-non-string-principal',
            email: 'unknown-coach@example.com',
            used: true,
            usedBy: 12345
        }
    });

    const managed = await callables.listManagedTeams(
        {},
        authContext('coach-1', { email: 'new-coach@example.com' })
    );

    assert.deepEqual(managed.items.map((team) => team.id), [
        'team-used-by-dotted-principal',
        'team-used-by-other'
    ]);
    assert.equal(managed.isPartial, false);
});

test('managed-team discovery fails closed when legacy coach grant evidence cannot be checked', async () => {
    const { callables } = loadCallables({
        'users/legacy-coach': { email: 'legacy@example.com', roles: ['coach'], coachOf: ['team-1'] },
        'teams/team-1': {
            name: 'Private Bears',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        }
    }, {
        queryFailures: [{
            path: 'accessCodes',
            field: 'teamId',
            operator: 'in',
            message: 'invite evidence unavailable'
        }]
    });

    const managed = await callables.listManagedTeams(
        {},
        authContext('legacy-coach', { email: 'legacy@example.com' })
    );
    assert.deepEqual(managed.items, []);
    assert.equal(managed.isPartial, true);
});

test('managed-team discovery ignores caller-wide invite history outside candidate teams', async () => {
    const inviteHistory = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [
        `accessCodes/history-${index}`,
        {
            type: 'admin_invite',
            teamId: `former-team-${index}`,
            email: `former-${index}@example.com`,
            usedBy: 'legacy-coach'
        }
    ]));
    const { firestore, callables } = loadCallables({
        ...inviteHistory,
        'users/legacy-coach': { email: 'legacy@example.com', roles: ['coach'], coachOf: ['team-1'] },
        'teams/team-1': {
            name: 'Private Bears',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        }
    });

    const managed = await callables.listManagedTeams(
        {},
        authContext('legacy-coach', { email: 'legacy@example.com' })
    );
    assert.deepEqual(managed.items.map((team) => team.id), ['team-1']);
    assert.equal(managed.isPartial, false);
    const evidenceQueries = firestore._queryLog.filter(({ path, filters }) => (
        path === 'accessCodes' && filters.some(({ field, value }) => field === 'type' && value === 'admin_invite')
    ));
    assert.equal(evidenceQueries.length, 1);
    assert.ok(evidenceQueries.every(({ limitCount }) => limitCount === 201));
    assert.ok(evidenceQueries.every(({ filters }) => filters.some(({ field }) => field === 'teamId')));
});

test('managed-team discovery fails closed when candidate-team invite evidence exceeds its fixed read bound', async () => {
    const inviteHistory = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [
        `accessCodes/history-${index}`,
        {
            type: 'admin_invite',
            teamId: 'team-1',
            email: `former-${index}@example.com`,
            usedBy: `former-coach-${index}`
        }
    ]));
    const { firestore, callables } = loadCallables({
        ...inviteHistory,
        'users/legacy-coach': { email: 'legacy@example.com', roles: ['coach'], coachOf: ['team-1'] },
        'teams/team-1': {
            name: 'Private Bears',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        }
    });

    const managed = await callables.listManagedTeams(
        {},
        authContext('legacy-coach', { email: 'legacy@example.com' })
    );
    assert.deepEqual(managed.items, []);
    assert.equal(managed.isPartial, true);
    const evidenceQueries = firestore._queryLog.filter(({ path, filters }) => (
        path === 'accessCodes' && filters.some(({ field, value }) => field === 'type' && value === 'admin_invite')
    ));
    assert.equal(evidenceQueries.length, 1);
    assert.equal(evidenceQueries[0].limitCount, 201);
});

test('managed-team discovery caps legacy coach candidates and candidate-team evidence queries', async () => {
    const coachTeamIds = Array.from({ length: 181 }, (_, index) => `team-${index}`);
    const teamDocuments = Object.fromEntries(coachTeamIds.map((teamId) => [
        `teams/${teamId}`,
        {
            name: `Legacy Team ${teamId}`,
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        }
    ]));
    const { firestore, callables } = loadCallables({
        ...teamDocuments,
        'users/legacy-coach': {
            email: 'legacy@example.com',
            roles: ['coach'],
            coachOf: coachTeamIds
        }
    });

    const managed = await callables.listManagedTeams(
        {},
        authContext('legacy-coach', { email: 'legacy@example.com' })
    );

    assert.equal(managed.items.length, 180);
    assert.equal(managed.items.some((team) => team.id === 'team-180'), false);
    assert.equal(managed.isPartial, true);
    const teamEvidenceQueries = firestore._queryLog.filter(({ path, filters }) => (
        path === 'accessCodes' && filters.some(({ field }) => field === 'teamId')
    ));
    assert.equal(teamEvidenceQueries.length, 6);
    assert.ok(teamEvidenceQueries.every(({ filters, limitCount }) => {
        const teamFilter = filters.find(({ field }) => field === 'teamId');
        return teamFilter.operator === 'in'
            && teamFilter.value.length > 0
            && teamFilter.value.length <= 30
            && limitCount === 201;
    }));
});

test('managed-team discovery quarantines only the failed invite-evidence chunk', async () => {
    const coachTeamIds = Array.from({ length: 31 }, (_, index) => `team-${index}`);
    const teamDocuments = Object.fromEntries(coachTeamIds.map((teamId) => [
        `teams/${teamId}`,
        {
            name: `Legacy Team ${teamId}`,
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        }
    ]));
    const { callables } = loadCallables({
        ...teamDocuments,
        'users/legacy-coach': {
            email: 'legacy@example.com',
            roles: ['coach'],
            coachOf: coachTeamIds
        }
    }, {
        queryFailures: [{
            path: 'accessCodes',
            field: 'teamId',
            operator: 'in',
            value: ['team-30'],
            message: 'last invite-evidence chunk unavailable'
        }]
    });

    const managed = await callables.listManagedTeams(
        {},
        authContext('legacy-coach', { email: 'legacy@example.com' })
    );

    assert.equal(managed.items.length, 30);
    assert.equal(managed.items.some((team) => team.id === 'team-30'), false);
    assert.equal(managed.isPartial, true);
});

test('managed-team discovery checks candidate lifecycle evidence when Auth email is absent', async () => {
    const { firestore, callables } = loadCallables({
        'users/legacy-coach': { email: 'stale-profile@example.com', roles: ['coach'], coachOf: ['team-1'] },
        'teams/team-1': {
            name: 'Private Bears',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        }
    });

    const managed = await callables.listManagedTeams(
        {},
        authContext('legacy-coach', { email: null })
    );
    assert.deepEqual(managed.items.map((team) => team.id), ['team-1']);
    assert.equal(managed.isPartial, false);
    const evidenceQueries = firestore._queryLog.filter(({ path }) => path === 'accessCodes');
    assert.equal(evidenceQueries.length, 1);
    assert.deepEqual(evidenceQueries[0].filters, [
        { field: 'type', operator: '==', value: 'admin_invite' },
        { field: 'teamId', operator: 'in', value: ['team-1'] }
    ]);
});

test('managed-team discovery rejects an email-less caller when candidate lifecycle evidence is ambiguous', async () => {
    const { callables } = loadCallables({
        'users/legacy-coach': { email: 'stale-profile@example.com', roles: ['coach'], coachOf: ['team-1'] },
        'teams/team-1': {
            name: 'Private Bears',
            ownerId: 'owner-1',
            adminEmails: [],
            isPublic: false,
            active: true
        },
        'accessCodes/admin-invite-1': {
            type: 'admin_invite',
            teamId: 'team-1',
            email: 'old-coach@example.com',
            used: false
        }
    });

    const managed = await callables.listManagedTeams(
        {},
        authContext('legacy-coach', { email: null })
    );
    assert.deepEqual(managed.items, []);
    assert.equal(managed.isPartial, false);
});

test('managed-team discovery preserves a current mixed-case legacy admin grant', async () => {
    const { callables } = loadCallables({
        'users/coach-1': { email: 'coach@example.com', coachOf: ['team-1'] },
        'teams/team-1': {
            name: 'Private Bears',
            ownerId: 'owner-1',
            adminEmails: ['Coach@Example.com'],
            isPublic: false,
            active: true
        },
        'accessCodes/admin-invite-1': {
            type: 'admin_invite',
            teamId: 'team-1',
            email: 'coach@example.com',
            used: true,
            usedBy: 'coach-1'
        }
    });

    const managed = await callables.listManagedTeams(
        {},
        authContext('coach-1', { email: 'coach@example.com' })
    );
    assert.equal(managed.items.length, 1);
    assert.equal(managed.items[0].id, 'team-1');
    assert.deepEqual(managed.items[0].adminEmails, ['Coach@Example.com']);
});

test('managed-team discovery preserves successful queries and marks partial failures', async () => {
    const { callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com' },
        'teams/owned-team': {
            name: 'Owned Bears',
            ownerId: 'owner-1',
            active: true,
            isPublic: false
        }
    }, {
        queryFailures: [{
            path: 'teams',
            field: 'adminEmails',
            operator: 'array-contains',
            message: 'admin index temporarily unavailable'
        }]
    });

    const managed = await callables.listManagedTeams(
        {},
        authContext('owner-1', { email: 'owner@example.com' })
    );

    assert.equal(managed.isPartial, true);
    assert.deepEqual(managed.items.map((team) => team.id), ['owned-team']);
});

test('managed-team discovery rejects when every discovery query fails', async () => {
    const queryFailures = ['ownerId', 'adminEmails', 'ownerEmailLower', 'ownerEmail'].map((field) => ({
        path: 'teams',
        field,
        operator: field === 'adminEmails' ? 'array-contains' : '==',
        message: `${field} index temporarily unavailable`
    }));
    const { callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com' }
    }, { queryFailures });

    await assert.rejects(
        callables.listManagedTeams({}, authContext('owner-1', { email: 'owner@example.com' })),
        /index temporarily unavailable/
    );
});

test('opportunity management keeps fail-fast semantics when team discovery is partial', async () => {
    const { callables } = loadCallables({
        'users/owner-1': { email: 'owner@example.com' },
        'teams/owned-team': {
            name: 'Owned Bears',
            ownerId: 'owner-1',
            active: true,
            isPublic: true
        }
    }, {
        queryFailures: [{
            path: 'teams',
            field: 'adminEmails',
            operator: 'array-contains',
            message: 'admin index temporarily unavailable'
        }]
    });

    await assert.rejects(
        callables.listManagedPublicOpportunityTeams(
            {},
            authContext('owner-1', { email: 'owner@example.com' })
        ),
        /admin index temporarily unavailable/
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

test('direct-message transaction observes a friendship revoked immediately before commit and writes nothing', async () => {
    const conversationPath = 'teams/team-1/chatConversations/direct_sender__user%3Arecipient';
    const messagePath = `${conversationPath}/chatMessages/sender__revoked-before-commit`;
    const seed = {
        'users/sender': { parentTeamIds: ['team-1'], fullName: 'Sender' },
        'users/recipient': { parentTeamIds: ['team-1'] },
        'teams/team-1': { ownerId: 'owner', adminEmails: [] },
        'friendships/recipient__sender': {
            status: 'accepted',
            memberIds: ['recipient', 'sender'],
            sharedTeamIds: ['team-1']
        },
        [conversationPath]: {
            type: 'direct',
            participantIds: ['sender', 'user:recipient'],
            directAccess: 'accepted_friend',
            directUserIds: ['recipient', 'sender'],
            friendshipId: 'recipient__sender'
        }
    };
    const { firestore, callables } = loadCallables(seed, {
        authUsers: {
            sender: { email: 'sender@example.com', disabled: false },
            recipient: { email: 'recipient@example.com', disabled: false }
        },
        beforeTransaction: ({ state }) => {
            state.set('friendships/recipient__sender', {
                ...state.get('friendships/recipient__sender'),
                status: 'removed'
            });
        }
    });

    await assert.rejects(
        callables.sendAuthorizedDirectMessage({
            teamId: 'team-1',
            conversationId: 'direct_sender__user%3Arecipient',
            clientMessageId: 'revoked-before-commit',
            text: 'This must not land',
            attachments: []
        }, authContext('sender', { email: 'sender@example.com' })),
        (error) => error.code === 'permission-denied'
    );

    assert.equal(firestore.snapshot(messagePath), undefined);
    assert.equal(firestore.snapshot(conversationPath).lastMessageAt, undefined);
    assert.equal(firestore.snapshot(conversationPath).updatedAt, undefined);
});

test('direct-message callable rejects a caller disabled after token issuance and writes nothing', async () => {
    const conversationPath = 'teams/team-1/chatConversations/direct_owner__user%3Aparent';
    const messagePath = `${conversationPath}/chatMessages/owner__disabled-before-commit`;
    const seed = {
        'users/owner': { fullName: 'Owner' },
        'users/parent': { parentTeamIds: ['team-1'] },
        'teams/team-1': { ownerId: 'owner', adminEmails: [] },
        [conversationPath]: {
            type: 'direct',
            participantIds: ['owner', 'user:parent'],
            directAccess: 'team_admin',
            directUserIds: ['owner', 'parent'],
            initiatedBy: 'owner'
        }
    };
    const { firestore, callables } = loadCallables(seed, {
        authUsers: {
            owner: { email: 'owner@example.com', disabled: true },
            parent: { email: 'parent@example.com', disabled: false }
        }
    });

    await assert.rejects(
        callables.sendAuthorizedDirectMessage({
            teamId: 'team-1',
            conversationId: 'direct_owner__user%3Aparent',
            clientMessageId: 'disabled-before-commit',
            text: 'This must not land',
            attachments: []
        }, authContext('owner', { email: 'owner@example.com' })),
        (error) => error.code === 'permission-denied'
    );

    assert.equal(firestore.snapshot(messagePath), undefined);
    assert.equal(firestore.snapshot(conversationPath).lastMessageAt, undefined);
    assert.equal(firestore.snapshot(conversationPath).updatedAt, undefined);
});

test('direct-message callable honors unbackfilled legacy parent team links', async () => {
    const conversationPath = 'teams/team-1/chatConversations/direct_owner__user%3Alegacy-parent';
    const seed = {
        'users/owner': { email: 'owner@example.com', isAdmin: false },
        'users/legacy-parent': {
            email: 'parent@example.com',
            isAdmin: false,
            parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
        },
        'teams/team-1': { ownerId: 'owner', adminEmails: [] },
        [conversationPath]: {
            type: 'direct',
            participantIds: ['owner', 'user:legacy-parent'],
            participantRoles: [],
            directAccess: 'team_admin',
            directUserIds: ['legacy-parent', 'owner'],
            friendshipId: null,
            initiatedBy: 'owner'
        }
    };
    const { firestore, callables } = loadCallables(seed);

    const sent = await callables.sendAuthorizedDirectMessage({
        teamId: 'team-1',
        conversationId: 'direct_owner__user%3Alegacy-parent',
        clientMessageId: 'legacy-parent-reply-1',
        text: 'Legacy parent reply',
        attachments: []
    }, authContext('legacy-parent'));

    assert.equal(sent.id, 'legacy-parent__legacy-parent-reply-1');
    assert.equal(
        firestore.snapshot(`${conversationPath}/chatMessages/legacy-parent__legacy-parent-reply-1`).text,
        'Legacy parent reply'
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

test('direct-message callable rejects recipients whose Auth account is disabled', async () => {
    const conversationPath = 'teams/team-1/chatConversations/direct_owner__user%3Adisabled-parent';
    const seed = {
        'users/owner': { email: 'owner@example.com', isAdmin: false },
        'users/disabled-parent': {
            email: 'stale@example.com',
            isAdmin: false,
            parentTeamIds: ['team-1']
        },
        'teams/team-1': { ownerId: 'owner', adminEmails: [] },
        [conversationPath]: {
            type: 'direct',
            participantIds: ['owner', 'user:disabled-parent'],
            participantRoles: [],
            directAccess: 'team_admin',
            directUserIds: ['disabled-parent', 'owner'],
            friendshipId: null,
            initiatedBy: 'owner'
        }
    };
    const { callables } = loadCallables(seed, {
        authUsers: { 'disabled-parent': { email: 'stale@example.com', disabled: true } }
    });

    await assert.rejects(
        callables.sendAuthorizedDirectMessage({
            teamId: 'team-1',
            conversationId: 'direct_owner__user%3Adisabled-parent',
            clientMessageId: 'disabled-recipient-1',
            text: 'Should not send',
            attachments: []
        }, authContext('owner')),
        (error) => error.code === 'permission-denied'
    );
});

for (const authFailure of [
    { label: 'disabled canonical owners', value: { email: 'owner@example.com', disabled: true } },
    { label: 'missing canonical owner Auth records', value: null },
    { label: 'temporarily unresolvable canonical owner Auth records', value: new Error('Auth unavailable') }
]) {
    test(`direct-message callable rejects ${authFailure.label}`, async () => {
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
        const { firestore, callables } = loadCallables(seed, {
            authUsers: { owner: authFailure.value }
        });

        await assert.rejects(
            callables.sendAuthorizedDirectMessage({
                teamId: 'team-1',
                conversationId: 'direct_owner__user%3Aparent',
                clientMessageId: 'disabled-owner-recipient',
                text: 'Should not send',
                attachments: []
            }, authContext('parent')),
            (error) => error.code === 'permission-denied'
        );
        assert.equal(
            firestore.snapshot(`${conversationPath}/chatMessages/parent__disabled-owner-recipient`),
            undefined
        );
    });
}

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
