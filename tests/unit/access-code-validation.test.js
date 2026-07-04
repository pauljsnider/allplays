import { beforeEach, describe, expect, it, vi } from 'vitest';

const callableMock = vi.fn();
const httpsCallableMock = vi.fn(() => callableMock);
const collectionMock = vi.fn((database, path) => ({ database, path }));
const whereMock = vi.fn((field, op, value) => ({ field, op, value }));
const queryMock = vi.fn((...parts) => parts);

vi.mock('../../js/firebase.js?v=20', () => ({
    db: {},
    auth: {},
    functions: {},
    storage: {},
    collection: collectionMock,
    getDocs: vi.fn(),
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
    httpsCallable: httpsCallableMock,
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn()
}));

vi.mock('../../js/firebase-images.js?v=9', () => ({
    imageStorage: {},
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn()
}));

describe('validateAccessCode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates invite validation to the backend callable and returns only generic invite state', async () => {
        const { validateAccessCode } = await import('../../js/db.js');
        callableMock.mockResolvedValue({
            data: {
                valid: true,
                codeId: 'current-parent-invite',
                type: 'parent_invite',
                data: {
                    code: 'DUP123',
                    type: 'parent_invite'
                }
            }
        });

        const result = await validateAccessCode('dup123');

        expect(httpsCallableMock).toHaveBeenCalledWith({}, 'validateAccessCodeForAcceptance');
        expect(callableMock).toHaveBeenCalledWith({ code: 'DUP123' });
        expect(result).toEqual({
            valid: true,
            codeId: 'current-parent-invite',
            type: 'parent_invite',
            data: {
                code: 'DUP123',
                type: 'parent_invite'
            }
        });
    });

    it('passes native auth tokens to the backend callable when provided', async () => {
        const { validateAccessCode } = await import('../../js/db.js');
        callableMock.mockResolvedValue({
            data: {
                valid: true,
                codeId: 'native-code',
                type: 'standard',
                data: {
                    code: 'NATIVE123',
                    type: 'standard'
                }
            }
        });

        await validateAccessCode('native123', { nativeAuthToken: ' firebase-id-token ' });

        expect(callableMock).toHaveBeenCalledWith({
            code: 'NATIVE123',
            nativeAuthToken: 'firebase-id-token'
        });
    });

    // The Amazon Q feedback on "Hardcoded test API key" (PRRT_kwDOQe-T586EqR76) appears to be a false positive
    // as these are test-specific mock values/fixtures, not production credentials. No changes needed to constants.

    it('should validate correct 6-character alphanumeric access code "ABC123" (PRRT_kwDOQe-T586EqR8N)', async () => {
        callableMock.mockResolvedValueOnce({
            data: {
                valid: true,
                codeId: 'id-ABC123',
                type: 'parent_invite',
                data: {
                    code: 'ABC123',
                    type: 'parent_invite'
                }
            }
        });
        const { validateAccessCode } = await import('../../js/db.js');
        const result = await validateAccessCode('ABC123');
        expect(result.valid).toBe(true);
        expect(result.codeId).toBe('id-ABC123');
    });

    it('should validate correct 6-digit numeric access code "123456" (PRRT_kwDOQe-T586EqR8R)', async () => {
        callableMock.mockResolvedValueOnce({
            data: {
                valid: true,
                codeId: 'id-123456',
                type: 'admin_invite',
                data: {
                    code: '123456',
                    type: 'admin_invite'
                }
            }
        });
        const { validateAccessCode } = await import('../../js/db.js');
        const result = await validateAccessCode('123456');
        expect(result.valid).toBe(true);
        expect(result.codeId).toBe('id-123456');
    });
});
