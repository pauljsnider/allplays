import { beforeEach, describe, expect, it, vi } from 'vitest';

const callableMock = vi.fn();
const httpsCallableMock = vi.fn(() => callableMock);
const collectionMock = vi.fn((database, path) => ({ database, path }));
const whereMock = vi.fn((field, op, value) => ({ field, op, value }));
const queryMock = vi.fn((...parts) => parts);
const getDocMock = vi.fn();
const getDocsMock = vi.fn();
const runTransactionMock = vi.fn();
const authMock = { currentUser: { uid: 'coach-1', email: 'coach@allplays.ai' } };

vi.mock('../../js/firebase.js?v=23', () => ({
    db: {},
    auth: authMock,
    functions: {},
    storage: {},
    collection: collectionMock,
    getDocs: getDocsMock,
    getDoc: getDocMock,
    doc: vi.fn((database, ...parts) => ({ id: parts[parts.length - 1], path: parts.join('/') })),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: queryMock,
    where: whereMock,
    orderBy: vi.fn(),
    Timestamp: {
        now: vi.fn(() => ({ toMillis: () => Date.now() })),
        fromMillis: vi.fn((ms) => ({ toMillis: () => ms }))
    },
    increment: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    deleteField: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    getCountFromServer: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    collectionGroup: vi.fn(),
    documentId: vi.fn(),
    writeBatch: vi.fn(),
    runTransaction: runTransactionMock,
    httpsCallable: httpsCallableMock,
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn()
}));

vi.mock('../../js/firebase.js?v=22', async () => import('../../js/firebase.js?v=23'));

vi.mock('../../js/firebase-images.js?v=10', () => ({
    imageStorage: {},
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn()
}));

function getQueryPath(q) {
    if (Array.isArray(q)) {
        const collectionPart = q.find((part) => part && typeof part.path === 'string');
        return collectionPart?.path || '';
    }
    return q?.path || '';
}

function queriedUsersCollection() {
    return getDocsMock.mock.calls.some(([q]) => getQueryPath(q) === 'users');
}

const teamSnapshot = {
    exists: () => true,
    id: 'team-1',
    data: () => ({ name: 'First Team', active: true, ownerId: 'coach-1' })
};

const playersSnapshot = {
    docs: [
        { id: 'player-1', data: () => ({ name: 'Player One', number: '1', active: true }) }
    ]
};

function permissionDeniedError() {
    const error = new Error('Missing or insufficient permissions.');
    error.code = 'permission-denied';
    return error;
}

describe('inviteParent permission fallback (issue #3844)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        getDocMock.mockResolvedValue(teamSnapshot);
        getDocsMock.mockImplementation(async (q) => {
            const path = getQueryPath(q);
            if (path.endsWith('/players')) return playersSnapshot;
            if (path === 'users') throw permissionDeniedError();
            return { empty: true, docs: [] };
        });
        runTransactionMock.mockImplementation(async (database, updateFn) => updateFn({
            get: vi.fn(async () => ({ exists: () => false })),
            set: vi.fn()
        }));
    });

    it('resolves successfully when the auto-link callable throws permission-denied', async () => {
        const { inviteParent } = await import('../../js/db.js');
        callableMock.mockRejectedValue(permissionDeniedError());

        const result = await inviteParent('team-1', 'player-1', '1', 'dad@allplays.ai', 'Father');

        expect(result.id).toBeTruthy();
        expect(result.code).toBeTruthy();
        expect(result.teamName).toBe('First Team');
        expect(result.playerName).toBe('Player One');
        expect(result.existingUser).toBe(false);
        expect(result.autoLinked).toBe(false);
    });

    it('always calls the server callable and never lists /users client-side', async () => {
        const { inviteParent } = await import('../../js/db.js');
        callableMock.mockResolvedValue({ data: { autoLinked: false, existingUser: false, reason: 'no-existing-user' } });

        const result = await inviteParent('team-1', 'player-1', '1', 'dad@allplays.ai', 'Father');

        expect(httpsCallableMock).toHaveBeenCalledWith({}, 'autoAcceptParentInviteForExistingUser');
        expect(callableMock).toHaveBeenCalledWith({ codeId: result.id });
        expect(queriedUsersCollection()).toBe(false);
        expect(result.existingUser).toBe(false);
        expect(result.autoLinked).toBe(false);
    });

    it('reports existing user and auto-link when the server links the parent', async () => {
        const { inviteParent } = await import('../../js/db.js');
        callableMock.mockResolvedValue({ data: { autoLinked: true, existingUser: true, userId: 'parent-1' } });

        const result = await inviteParent('team-1', 'player-1', '1', 'dad@allplays.ai', 'Father');

        expect(result.existingUser).toBe(true);
        expect(result.autoLinked).toBe(true);
    });

    it('treats a legacy auto-linked payload without existingUser as an existing user', async () => {
        const { inviteParent } = await import('../../js/db.js');
        callableMock.mockResolvedValue({ data: { autoLinked: true, userId: 'parent-1' } });

        const result = await inviteParent('team-1', 'player-1', '1', 'dad@allplays.ai', 'Father');

        expect(result.existingUser).toBe(true);
        expect(result.autoLinked).toBe(true);
    });

    it('skips the callable entirely when no email is provided', async () => {
        const { inviteParent } = await import('../../js/db.js');

        const result = await inviteParent('team-1', 'player-1', '1', '', 'Father');

        expect(callableMock).not.toHaveBeenCalled();
        expect(result.code).toBeTruthy();
        expect(result.existingUser).toBe(false);
        expect(result.autoLinked).toBe(false);
    });

    it('reuses the same player-scoped invite code after an interrupted retry', async () => {
        const { inviteParent } = await import('../../js/db.js');
        let storedAccessCode = null;
        const transactionSet = vi.fn((reference, value) => {
            storedAccessCode = { id: reference.id, ...value };
        });
        runTransactionMock.mockImplementation(async (database, updateFn) => updateFn({
            get: vi.fn(async () => ({
                exists: () => Boolean(storedAccessCode),
                data: () => storedAccessCode
            })),
            set: transactionSet
        }));
        callableMock.mockResolvedValue({
            data: { autoLinked: false, existingUser: false, reason: 'no-existing-user' }
        });
        const options = { idempotencyKey: 'ai_retry1:invite:player-1:dad@allplays.ai' };

        const first = await inviteParent(
            'team-1',
            'player-1',
            '1',
            'dad@allplays.ai',
            'Father',
            options
        );
        const retried = await inviteParent(
            'team-1',
            'player-1',
            '1',
            'dad@allplays.ai',
            'Father',
            options
        );

        expect(retried.code).toBe(first.code);
        expect(transactionSet).toHaveBeenCalledTimes(1);
        expect(callableMock).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['used', { used: true, usedBy: 'parent-1' }],
        ['expired', { expiresAt: { toMillis: () => Date.now() - 1 } }],
        ['revoked', { revoked: true }],
        ['auto-accepted', { autoAccepted: true }],
        ['inactive', { active: false }],
        ['removed', { status: 'removed' }],
        ['cancelled', { status: 'cancelled' }],
        ['revoked status', { status: 'revoked' }]
    ])('creates a fresh deterministic attempt instead of reusing a %s parent invite', async (_label, invalidState) => {
        const { inviteParent } = await import('../../js/db.js');
        const storedAccessCodes = new Map();
        const transactionSet = vi.fn((reference, value) => {
            storedAccessCodes.set(reference.id, { id: reference.id, ...value });
        });
        runTransactionMock.mockImplementation(async (database, updateFn) => updateFn({
            get: vi.fn(async (reference) => ({
                exists: () => storedAccessCodes.has(reference.id),
                data: () => storedAccessCodes.get(reference.id)
            })),
            set: transactionSet
        }));
        callableMock.mockResolvedValue({
            data: { autoLinked: false, existingUser: false, reason: 'no-existing-user' }
        });
        const options = { idempotencyKey: 'legacy-roster-import:team-1:player-1:dad@allplays.ai' };

        const first = await inviteParent(
            'team-1',
            'player-1',
            '1',
            'dad@allplays.ai',
            'Father',
            options
        );
        storedAccessCodes.set(first.code, {
            ...storedAccessCodes.get(first.code),
            ...invalidState
        });
        const retried = await inviteParent(
            'team-1',
            'player-1',
            '1',
            'dad@allplays.ai',
            'Father',
            options
        );

        expect(retried.code).not.toBe(first.code);
        expect(transactionSet).toHaveBeenCalledTimes(2);
        expect(callableMock).toHaveBeenCalledTimes(2);
    });
});

describe('inviteAdmin permission fallback (issue #3844)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        getDocMock.mockResolvedValue(teamSnapshot);
        getDocsMock.mockImplementation(async (q) => {
            const path = getQueryPath(q);
            if (path === 'users') throw permissionDeniedError();
            return { empty: true, docs: [] };
        });
        runTransactionMock.mockImplementation(async (database, updateFn) => updateFn({
            get: vi.fn(async () => ({ exists: () => false })),
            set: vi.fn()
        }));
    });

    it('resolves successfully when the existing-user lookup throws permission-denied', async () => {
        const { inviteAdmin } = await import('../../js/db.js');

        const result = await inviteAdmin('team-1', 'newadmin@allplays.ai');

        expect(result.id).toBeTruthy();
        expect(result.code).toBeTruthy();
        expect(result.teamName).toBe('First Team');
        expect(result.existingUser).toBe(false);
    });
});
