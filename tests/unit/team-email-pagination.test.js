import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    collection: vi.fn((database, ...path) => ({ database, path })),
    query: vi.fn((...parts) => parts),
    orderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
    limit: vi.fn((value) => ({ type: 'limit', value })),
    startAfter: vi.fn((...values) => ({ type: 'startAfter', values })),
    documentId: vi.fn(() => '__name__'),
    getDocs: vi.fn()
}));

vi.mock('../../js/firebase.js?v=26', () => ({
    db: {},
    auth: { currentUser: null },
    storage: {},
    collection: firebaseMocks.collection,
    getDocs: firebaseMocks.getDocs,
    getDoc: vi.fn(),
    doc: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: firebaseMocks.query,
    where: vi.fn(),
    orderBy: firebaseMocks.orderBy,
    Timestamp: { now: vi.fn() },
    increment: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    deleteField: vi.fn(),
    limit: firebaseMocks.limit,
    startAfter: firebaseMocks.startAfter,
    getCountFromServer: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    collectionGroup: vi.fn(),
    documentId: firebaseMocks.documentId,
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
    functions: {},
    httpsCallable: vi.fn(),
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

vi.mock('../../js/team-visibility.js?v=2', () => ({
    isTeamActive: vi.fn(() => true),
    filterTeamsByActive: vi.fn((teams) => teams),
    shouldIncludeTeamInLiveOrUpcoming: vi.fn(() => true),
    shouldIncludeTeamInReplay: vi.fn(() => true)
}));

function createDoc(id, updatedAt, fields = {}) {
    return {
        id,
        data: () => ({ updatedAt, ...fields })
    };
}

describe('team email saved-content pagination', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each([
        ['drafts', 'getTeamEmailDrafts', 'emailDrafts'],
        ['templates', 'getTeamEmailTemplates', 'emailTemplates']
    ])('bounds %s pages and forwards the stable updatedAt/id cursor', async (_label, exportName, collectionName) => {
        const newerAt = { seconds: 20 };
        const olderAt = { seconds: 10 };
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: [createDoc('item-b', newerAt), createDoc('item-a', olderAt)] })
            .mockResolvedValueOnce({ docs: [createDoc('item-older', { seconds: 5 })] });
        const dbModule = await import('../../js/db.js?v=4433183-team-email-pages');

        const firstPage = await dbModule[exportName]('team-1', { pageSize: 2 });
        const secondPage = await dbModule[exportName]('team-1', { pageSize: 2, cursor: firstPage.nextCursor });

        expect(firstPage.items.map((item) => item.id)).toEqual(['item-b', 'item-a']);
        expect(firstPage.nextCursor).toEqual({ updatedAt: olderAt, id: 'item-a' });
        expect(secondPage.items.map((item) => item.id)).toEqual(['item-older']);
        expect(secondPage.nextCursor).toBeNull();
        expect(firebaseMocks.collection).toHaveBeenCalledWith(expect.anything(), 'teams', 'team-1', collectionName);
        expect(firebaseMocks.limit).toHaveBeenNthCalledWith(1, 2);
        expect(firebaseMocks.limit).toHaveBeenNthCalledWith(2, 2);
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('updatedAt', 'desc');
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('__name__', 'desc');
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(olderAt, 'item-a');
    });

    it('propagates query failures without retrying an unbounded collection read', async () => {
        firebaseMocks.getDocs.mockRejectedValue(new Error('query failed'));
        const { getTeamEmailDrafts } = await import('../../js/db.js?v=4433183-team-email-pages');

        await expect(getTeamEmailDrafts('team-1')).rejects.toThrow('query failed');
        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.limit).toHaveBeenCalledWith(25);
    });
});
