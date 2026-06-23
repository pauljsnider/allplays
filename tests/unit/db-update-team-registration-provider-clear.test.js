import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateDoc = vi.fn();
const deleteField = vi.fn(() => '__DELETE_FIELD__');
const doc = vi.fn((database, ...segments) => ({ database, path: segments.join('/') }));

vi.mock('../../js/firebase.js?v=19', () => ({
    db: { name: 'mock-db' },
    auth: {},
    storage: {},
    collection: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    doc,
    addDoc: vi.fn(),
    updateDoc,
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    Timestamp: { now: vi.fn(() => 'mock-timestamp') },
    increment: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    deleteField,
    limit: vi.fn(),
    startAfter: vi.fn(),
    getCountFromServer: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    collectionGroup: vi.fn(),
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
    functions: {},
    httpsCallable: vi.fn(),
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

vi.mock('../../js/vendor/firebase-storage.js', () => ({
    uploadBytesResumable: vi.fn()
}));

const { updateTeam } = await import('../../js/db.js');

describe('updateTeam registration provider clearing', () => {
    beforeEach(() => {
        updateDoc.mockReset();
        deleteField.mockClear();
        doc.mockClear();
    });

    it('deletes the legacy registrationProvider field when the registration source is cleared', async () => {
        await updateTeam('team-1', {
            name: 'Sharks',
            registrationSource: null
        });

        expect(deleteField).toHaveBeenCalledTimes(1);
        expect(doc).toHaveBeenCalledWith({ name: 'mock-db' }, 'teams', 'team-1');
        expect(updateDoc).toHaveBeenCalledWith(
            { database: { name: 'mock-db' }, path: 'teams/team-1' },
            expect.objectContaining({
                name: 'Sharks',
                registrationSource: null,
                registrationProvider: '__DELETE_FIELD__',
                updatedAt: 'mock-timestamp'
            })
        );
    });

    it('does not delete the legacy registrationProvider field for normal team updates', async () => {
        await updateTeam('team-1', {
            name: 'Sharks',
            registrationSource: {
                provider: 'Sports Connect',
                externalTeamId: 'SC-123'
            }
        });

        expect(deleteField).not.toHaveBeenCalled();
        expect(updateDoc).toHaveBeenCalledWith(
            { database: { name: 'mock-db' }, path: 'teams/team-1' },
            expect.not.objectContaining({
                registrationProvider: '__DELETE_FIELD__'
            })
        );
    });
});
