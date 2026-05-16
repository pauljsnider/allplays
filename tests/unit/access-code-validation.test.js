import { beforeEach, describe, expect, it, vi } from 'vitest';

const getDocsMock = vi.fn();
const collectionMock = vi.fn((database, path) => ({ database, path }));
const whereMock = vi.fn((field, op, value) => ({ field, op, value }));
const queryMock = vi.fn((...parts) => parts);

vi.mock('../../js/firebase.js?v=12', () => ({
    db: {},
    auth: {},
    storage: {},
    collection: collectionMock,
    getDocs: getDocsMock,
    getDoc: vi.fn(),
    doc: vi.fn((...parts) => ({ parts })),
    addDoc: vi.fn(),
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
    runTransaction: vi.fn(),
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn()
}));

vi.mock('../../js/firebase-images.js?v=4', () => ({
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

describe('validateAccessCode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
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
