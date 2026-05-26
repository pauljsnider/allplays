import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getDocsMock = vi.fn();
const addDocMock = vi.fn();
const docMock = vi.fn((database, collectionPath, documentId) => ({ id: documentId, database, collectionPath, documentId }));
const runTransactionMock = vi.fn();
const collectionMock = vi.fn((database, path) => ({ database, path }));
const whereMock = vi.fn((field, op, value) => ({ field, op, value }));
const queryMock = vi.fn((...parts) => parts);

vi.mock('../../js/firebase.js?v=15', () => ({
    db: {},
    auth: {},
    storage: {},
    collection: collectionMock,
    getDocs: getDocsMock,
    getDoc: vi.fn(),
    doc: docMock,
    addDoc: addDocMock,
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: queryMock,
    where: whereMock,
    orderBy: vi.fn(),
    Timestamp: {
        now: vi.fn(() => ({ toMillis: () => Date.now() }))
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
    writeBatch: vi.fn(),
    runTransaction: runTransactionMock,
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn()
}));

vi.mock('../../js/firebase-images.js?v=6', () => ({
    imageStorage: {},
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn()
}));

function accessCodeDoc(id, data) {
    return {
        id,
        ref: { id },
        data: () => data
    };
}

describe('access code generation and validation', () => {
    let originalCryptoDescriptor;

    beforeEach(() => {
        vi.clearAllMocks();
        originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    });

    afterEach(() => {
        if (originalCryptoDescriptor) {
            Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
        }
        vi.restoreAllMocks();
    });

    it('generates codes with Web Crypto instead of Math.random', async () => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: {
                getRandomValues: vi.fn((values) => {
                    values.set([0, 1, 2, 3, 4, 5, 6, 7].slice(0, values.length));
                    return values;
                })
            }
        });
        const mathRandomSpy = vi.spyOn(Math, 'random');
        const { generateAccessCode } = await import('../../js/db.js');

        expect(generateAccessCode()).toBe('ABCDEFGH');
        expect(globalThis.crypto.getRandomValues).toHaveBeenCalled();
        expect(mathRandomSpy).not.toHaveBeenCalled();
    });

    it('retries and stores access codes under the code document id when collisions occur', async () => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: {
                getRandomValues: vi.fn((values) => {
                    values.fill(0);
                    return values;
                })
            }
        });
        const transactionSetMock = vi.fn();
        const transactionGetMock = vi.fn(async () => ({ exists: () => false }));
        getDocsMock
            .mockResolvedValueOnce({ empty: false })
            .mockResolvedValueOnce({ empty: true });
        runTransactionMock.mockImplementation(async (database, callback) => callback({
            get: transactionGetMock,
            set: transactionSetMock
        }));
        const { createAccessCode } = await import('../../js/db.js');

        const result = await createAccessCode('user-1', 'Parent@Example.com', '', 'ABCDEFGH');

        expect(result).toEqual({ id: 'AAAAAAAA', code: 'AAAAAAAA' });
        expect(getDocsMock).toHaveBeenCalledTimes(2);
        expect(docMock).toHaveBeenCalledWith({}, 'accessCodes', 'AAAAAAAA');
        expect(transactionGetMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'AAAAAAAA' }));
        expect(transactionSetMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'AAAAAAAA' }), expect.objectContaining({
            code: 'AAAAAAAA',
            generatedBy: 'user-1',
            email: 'Parent@Example.com',
            phone: null,
            used: false,
            usedBy: null,
            usedAt: null
        }));
        expect(addDocMock).not.toHaveBeenCalled();
    });

    it('selects a redeemable duplicate access code before stale matches', async () => {
        const { validateAccessCode } = await import('../../js/db.js');
        const futureExpiry = Date.now() + 60_000;
        const expiredAt = Date.now() - 60_000;

        getDocsMock.mockResolvedValue({
            empty: false,
            docs: [
                accessCodeDoc('used-parent-invite', {
                    code: 'DUP123',
                    type: 'parent_invite',
                    used: true,
                    expiresAt: futureExpiry
                }),
                accessCodeDoc('expired-admin-invite', {
                    code: 'DUP123',
                    type: 'admin_invite',
                    used: false,
                    expiresAt: expiredAt
                }),
                accessCodeDoc('current-parent-invite', {
                    code: 'DUP123',
                    type: 'parent_invite',
                    used: false,
                    expiresAt: futureExpiry,
                    teamId: 'team-1'
                })
            ]
        });

        const result = await validateAccessCode('dup123');

        expect(whereMock).toHaveBeenCalledWith('code', '==', 'DUP123');
        expect(result).toEqual({
            valid: true,
            codeId: 'current-parent-invite',
            type: 'parent_invite',
            data: {
                code: 'DUP123',
                type: 'parent_invite',
                used: false,
                expiresAt: futureExpiry,
                teamId: 'team-1'
            }
        });
    });
});
