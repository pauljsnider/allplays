import { beforeEach, describe, expect, it, vi } from 'vitest';

const createParentInviteCallableMock = vi.fn();
const autoAcceptParentInviteCallableMock = vi.fn();
const httpsCallableMock = vi.fn((_functions, name) => (
    name === 'createParentInvite'
        ? createParentInviteCallableMock
        : autoAcceptParentInviteCallableMock
));
const collectionMock = vi.fn((database, path) => ({ database, path }));
const getDocMock = vi.fn();
const getDocsMock = vi.fn();
const runTransactionMock = vi.fn();
const authMock = { currentUser: { uid: 'coach-1', email: 'coach@allplays.ai' } };

vi.mock('../../js/firebase.js?v=26', () => ({
    db: {},
    auth: authMock,
    functions: {},
    storage: {},
    collection: collectionMock,
    getDocs: getDocsMock,
    getDoc: getDocMock,
    doc: vi.fn((database, ...parts) => ({ id: parts.at(-1), path: parts.join('/') })),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: vi.fn((...parts) => parts),
    where: vi.fn((field, op, value) => ({ field, op, value })),
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

vi.mock('../../js/firebase-images.js?v=11', () => ({
    imageStorage: {},
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn()
}));

const teamSnapshot = {
    exists: () => true,
    id: 'team-1',
    data: () => ({ name: 'First Team', active: true, ownerId: 'coach-1' })
};

function permissionDeniedError() {
    const error = new Error('Missing or insufficient permissions.');
    error.code = 'permission-denied';
    return error;
}

describe('inviteParent protected callable routing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        getDocMock.mockResolvedValue(teamSnapshot);
        getDocsMock.mockResolvedValue({ empty: true, docs: [] });
        createParentInviteCallableMock.mockResolvedValue({
            data: {
                id: 'PARENT12',
                code: 'PARENT12',
                teamName: 'First Team',
                playerName: 'Player One',
                created: true,
                reused: false
            }
        });
        autoAcceptParentInviteCallableMock.mockResolvedValue({
            data: { autoLinked: false, existingUser: false, reason: 'no-existing-user' }
        });
    });

    it('creates through the server and never performs client-side invite writes or user scans', async () => {
        const { inviteParent } = await import('../../js/db.js');

        const result = await inviteParent('team-1', 'player-1', '1', ' Dad@AllPlays.ai ', 'Father');

        expect(createParentInviteCallableMock).toHaveBeenCalledWith({
            teamId: 'team-1',
            playerId: 'player-1',
            email: 'dad@allplays.ai',
            relation: 'Father'
        });
        expect(autoAcceptParentInviteCallableMock).toHaveBeenCalledWith({ codeId: 'PARENT12' });
        expect(runTransactionMock).not.toHaveBeenCalled();
        expect(getDocsMock).not.toHaveBeenCalled();
        expect(result).toMatchObject({ code: 'PARENT12', created: true, reused: false });
    });

    it('forwards an operation idempotency key to the protected callable', async () => {
        const { inviteParent } = await import('../../js/db.js');

        await inviteParent(
            'team-1',
            'player-1',
            '1',
            'dad@allplays.ai',
            'Father',
            { idempotencyKey: 'bulk-42:invite:player-1:dad@allplays.ai' }
        );

        expect(createParentInviteCallableMock).toHaveBeenCalledWith({
            teamId: 'team-1',
            playerId: 'player-1',
            email: 'dad@allplays.ai',
            relation: 'Father',
            idempotencyKey: 'bulk-42:invite:player-1:dad@allplays.ai'
        });
    });

    it('returns a created invite when optional auto-linking is denied', async () => {
        const { inviteParent } = await import('../../js/db.js');
        autoAcceptParentInviteCallableMock.mockRejectedValue(permissionDeniedError());

        const result = await inviteParent('team-1', 'player-1', '1', 'dad@allplays.ai', 'Father');

        expect(result).toMatchObject({
            code: 'PARENT12',
            teamName: 'First Team',
            playerName: 'Player One',
            existingUser: false,
            autoLinked: false
        });
    });

    it('preserves server auto-link results', async () => {
        const { inviteParent } = await import('../../js/db.js');
        autoAcceptParentInviteCallableMock.mockResolvedValue({
            data: { autoLinked: true, existingUser: true, userId: 'parent-1' }
        });

        const result = await inviteParent('team-1', 'player-1', '1', 'dad@allplays.ai', 'Father');

        expect(result.existingUser).toBe(true);
        expect(result.autoLinked).toBe(true);
    });

    it('creates manual share invites through the server without auto-linking', async () => {
        const { inviteParent } = await import('../../js/db.js');

        const result = await inviteParent('team-1', 'player-1', '1', '', 'Father');

        expect(createParentInviteCallableMock).toHaveBeenCalledWith({
            teamId: 'team-1',
            playerId: 'player-1',
            email: '',
            relation: 'Father'
        });
        expect(autoAcceptParentInviteCallableMock).not.toHaveBeenCalled();
        expect(result.code).toBe('PARENT12');
    });

    it('returns server-authoritative reuse without client persistence', async () => {
        const { inviteParent } = await import('../../js/db.js');
        createParentInviteCallableMock.mockResolvedValue({
            data: {
                id: 'PARENT12',
                code: 'PARENT12',
                teamName: 'First Team',
                playerName: 'Player One',
                created: false,
                reused: true
            }
        });

        const result = await inviteParent('team-1', 'player-1', '1', 'dad@allplays.ai', 'Father');

        expect(result).toMatchObject({ code: 'PARENT12', created: false, reused: true });
        expect(runTransactionMock).not.toHaveBeenCalled();
    });

    it('replays a completed auto-link without retrying the consumed code', async () => {
        const { inviteParent } = await import('../../js/db.js');
        createParentInviteCallableMock.mockResolvedValue({
            data: {
                id: 'PARENT12',
                code: 'PARENT12',
                teamName: 'First Team',
                playerName: 'Player One',
                created: false,
                reused: true,
                completed: true,
                completedBy: 'parent-1',
                completedAt: '2026-08-14T18:00:00.000Z',
                existingUser: true,
                autoLinked: true
            }
        });

        const result = await inviteParent(
            'team-1',
            'player-1',
            '1',
            'dad@allplays.ai',
            'Father',
            { idempotencyKey: 'bulk-42:invite:player-1:dad@allplays.ai' }
        );

        expect(autoAcceptParentInviteCallableMock).not.toHaveBeenCalled();
        expect(result).toMatchObject({
            code: 'PARENT12',
            completed: true,
            completedBy: 'parent-1',
            completedAt: '2026-08-14T18:00:00.000Z',
            existingUser: true,
            autoLinked: true,
            reused: true
        });
    });
});

describe('inviteAdmin permission fallback (issue #3844)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        getDocMock.mockResolvedValue(teamSnapshot);
        getDocsMock.mockImplementation(async (query) => {
            const path = Array.isArray(query)
                ? query.find((part) => typeof part?.path === 'string')?.path
                : query?.path;
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
