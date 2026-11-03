import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getDocMock = vi.fn();
const transactionGet = vi.fn();
const transactionSet = vi.fn();
const runTransactionMock = vi.fn((_db, work) => work({ get: transactionGet, set: transactionSet }));
const callableMock = vi.fn();
const httpsCallableMock = vi.fn(() => callableMock);
const collectionMock = vi.fn((database, path) => ({ database, path }));
const whereMock = vi.fn((field, op, value) => ({ field, op, value }));
const queryMock = vi.fn((...parts) => parts);

vi.mock('../../js/firebase.js?v=33', () => ({
    db: {},
    auth: { currentUser: null },
    functions: {},
    storage: {},
    collection: collectionMock,
    getDocs: vi.fn(),
    getDoc: getDocMock,
    doc: vi.fn((...parts) => ({ parts })),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: queryMock,
    where: whereMock,
    orderBy: vi.fn(),
    Timestamp: {
        now: vi.fn(() => new Date('2026-01-01T00:00:00Z')),
        fromMillis: vi.fn((value) => new Date(value))
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


vi.mock('../../js/firebase-images.js?v=18', () => ({
    imageStorage: {},
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn()
}));

describe('friend invite creation through the shared database module', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('crypto', { getRandomValues: (values) => values.fill(0) });
        transactionGet.mockResolvedValue({ exists: () => false });
        getDocMock.mockResolvedValue({ exists: () => true, data: () => ({
            displayName: 'Invite Sender',
            email: 'sender@example.com',
            phone: '555-0100',
            parentOf: [{ teamId: ' team-1 ' }, { teamId: 'team-1' }, {}],
            parentTeamIds: ['team-2', '', 'team-1']
        }) });
    });

    afterEach(() => vi.unstubAllGlobals());

    it('creates an email-only friend invite from legacy Profile without a supplied code', async () => {
        const { createAccessCode } = await import('../../js/db.js');
        await expect(createAccessCode('sender-1', 'friend@example.com', '', undefined, { type: 'friend_invite' }))
            .resolves.toMatchObject({ code: 'AAAAAAAA' });
        expect(transactionSet).toHaveBeenCalledOnce();
        const [reference, payload] = transactionSet.mock.calls[0];
        expect(reference.parts.slice(1)).toEqual(['accessCodes', 'AAAAAAAA']);
        expect(payload).toMatchObject({
            code: 'AAAAAAAA', type: 'friend_invite', generatedBy: 'sender-1',
            email: 'friend@example.com', phone: null, used: false,
            inviterProfile: {
                displayName: 'Invite Sender', fullName: 'Invite Sender', photoUrl: null,
                discoveryTeamIds: ['team-1', 'team-2']
            }
        });
        expect(Object.keys(payload.inviterProfile).sort()).toEqual([
            'discoveryTeamIds', 'displayName', 'fullName', 'photoUrl'
        ]);
        expect(payload.expiresAt.getTime()).toBeGreaterThan(Date.now());
        expect(callableMock).not.toHaveBeenCalled();
    });

    it('creates through the React SDK path with its supplied code and tolerates a missing profile', async () => {
        const { createAccessCode } = await import('../../js/db.js');
        getDocMock.mockResolvedValue({ exists: () => false });
        await expect(createAccessCode('sender-1', 'friend@example.com', '', 'FRIEND12', { type: 'friend_invite' }))
            .resolves.toMatchObject({ code: 'FRIEND12' });
        expect(transactionSet.mock.calls[0][1].inviterProfile).toEqual({
            displayName: null, fullName: null, photoUrl: null, discoveryTeamIds: []
        });
    });

    it('does not overwrite a colliding code and returns the next securely generated code', async () => {
        const { createAccessCode } = await import('../../js/db.js');
        transactionGet.mockResolvedValueOnce({ exists: () => true });
        await expect(createAccessCode('sender-1', 'friend@example.com', '', 'FRIEND12', { type: 'friend_invite' }))
            .resolves.toMatchObject({ code: 'AAAAAAAA' });
        expect(transactionSet).toHaveBeenCalledOnce();
        expect(transactionSet.mock.calls[0][1].code).toBe('AAAAAAAA');
    });
});
