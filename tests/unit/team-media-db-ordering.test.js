import { beforeEach, describe, expect, it, vi } from 'vitest';

const folderState = vi.hoisted(() => ({ nextMediaOrder: 0 }));
const addDocState = vi.hoisted(() => ({ nextId: 1 }));
const firebaseMocks = vi.hoisted(() => ({
    addDoc: vi.fn(async (_collectionRef, data) => ({ id: `media-${addDocState.nextId++}`, data })),
    collection: vi.fn((_db, path) => ({ path })),
    getCountFromServer: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    getDownloadURL: vi.fn(async () => 'https://cdn.example.test/uploaded-file'),
    doc: vi.fn((_db, path, id) => ({ path: `${path}/${id}` })),
    limit: vi.fn((value) => ({ type: 'limit', value })),
    orderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
    query: vi.fn((...parts) => parts),
    runTransaction: vi.fn(async (_db, callback) => callback({
        get: async () => ({
            exists: () => true,
            data: () => ({ nextMediaOrder: folderState.nextMediaOrder })
        }),
        update: (_ref, payload) => {
            folderState.nextMediaOrder = payload.nextMediaOrder;
        }
    })),
    serverTimestamp: vi.fn(() => 'server-ts'),
    startAfter: vi.fn((cursor) => ({ type: 'startAfter', cursor })),
    updateDoc: vi.fn(async () => undefined),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    writeBatch: vi.fn(),
}));

const uploadTaskQueue = vi.hoisted(() => []);

vi.mock('../../js/firebase.js?v=19', () => ({
    db: {},
    auth: { currentUser: { uid: 'user-1' } },
    storage: {},
    functions: {},
    collection: firebaseMocks.collection,
    getDocs: firebaseMocks.getDocs,
    getDoc: firebaseMocks.getDoc,
    doc: firebaseMocks.doc,
    addDoc: firebaseMocks.addDoc,
    updateDoc: firebaseMocks.updateDoc,
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: firebaseMocks.query,
    where: firebaseMocks.where,
    orderBy: firebaseMocks.orderBy,
    Timestamp: { now: vi.fn(() => ({ toMillis: () => Date.now() })) },
    increment: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    deleteField: vi.fn(),
    limit: firebaseMocks.limit,
    startAfter: firebaseMocks.startAfter,
    getCountFromServer: firebaseMocks.getCountFromServer,
    onSnapshot: vi.fn(),
    serverTimestamp: firebaseMocks.serverTimestamp,
    collectionGroup: vi.fn(),
    writeBatch: firebaseMocks.writeBatch,
    runTransaction: firebaseMocks.runTransaction,
    httpsCallable: vi.fn(),
    ref: vi.fn((_storage, path) => ({ fullPath: path })),
    uploadBytes: vi.fn(),
    getDownloadURL: firebaseMocks.getDownloadURL,
    deleteObject: vi.fn()
}));

vi.mock('../../js/firebase-images.js?v=6', () => ({
    imageStorage: {},
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn()
}));

vi.mock('../../js/team-media-utils.js?v=3', () => ({
    buildBulkDeleteUpdates: vi.fn(),
    buildMoveUpdates: vi.fn(),
    buildReorderUpdates: vi.fn(),
    isSafeTeamMediaUrl: vi.fn(() => true),
    isSupportedTeamMediaDocument: vi.fn(() => true),
    isSupportedTeamMediaImage: vi.fn(() => true),
    normalizeTeamMediaFolderDraft: vi.fn((draft = {}) => ({
        name: String(draft.name || '').trim(),
        visibility: String(draft.visibility || 'team').trim() || 'team'
    })),
    normalizeAlbumVisibility: vi.fn((value) => value),
    sortByMediaOrder: vi.fn((items) => items)
}));

vi.mock('../../js/vendor/firebase-storage.js', () => ({
    uploadBytesResumable: vi.fn((_storageRef, _file, _metadata) => {
        const task = {
            snapshot: { ref: { fullPath: 'team-media/mock-upload' } },
            on: vi.fn((_event, _progress, _error, complete) => {
                uploadTaskQueue.push(() => complete());
            })
        };
        return task;
    })
}));

describe('team media db ordering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        folderState.nextMediaOrder = 0;
        addDocState.nextId = 1;
        uploadTaskQueue.length = 0;
    });

    it('assigns unique sequential orders to concurrent photo uploads and stores download URLs once', async () => {
        const { uploadTeamMediaPhoto } = await import('../../js/db.js');
        const files = [
            new File(['photo-1'], 'tipoff.jpg', { type: 'image/jpeg' }),
            new File(['photo-2'], 'bench.jpg', { type: 'image/jpeg' })
        ];

        const uploadPromises = files.map((file) => uploadTeamMediaPhoto('team-1', 'folder-1', file));
        expect(uploadTaskQueue).toHaveLength(2);

        uploadTaskQueue.splice(0).forEach((complete) => complete());
        await expect(Promise.all(uploadPromises)).resolves.toEqual(['media-1', 'media-2']);

        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
        expect(firebaseMocks.runTransaction).toHaveBeenCalledTimes(2);
        expect(firebaseMocks.addDoc).toHaveBeenNthCalledWith(1, { path: 'teams/team-1/mediaItems' }, expect.objectContaining({
            folderId: 'folder-1',
            title: 'tipoff.jpg',
            order: 0,
            type: 'photo',
            downloadUrl: 'https://cdn.example.test/uploaded-file'
        }));
        expect(firebaseMocks.addDoc).toHaveBeenNthCalledWith(2, { path: 'teams/team-1/mediaItems' }, expect.objectContaining({
            folderId: 'folder-1',
            title: 'bench.jpg',
            order: 1,
            type: 'photo',
            downloadUrl: 'https://cdn.example.test/uploaded-file'
        }));
        expect(firebaseMocks.getDownloadURL).toHaveBeenCalledTimes(2);
    });

    it('starts legacy folders at zero when the media order counter is missing and stores file download URLs', async () => {
        folderState.nextMediaOrder = Number.NaN;
        const { createTeamMediaLink, uploadTeamMediaFile } = await import('../../js/db.js');
        const file = new File(['doc'], 'lineup.pdf', { type: 'application/pdf' });

        const linkId = await createTeamMediaLink('team-1', 'folder-1', {
            title: 'Replay',
            url: 'https://video.example.test/replay'
        });
        const filePromise = uploadTeamMediaFile('team-1', 'folder-1', file);
        uploadTaskQueue.splice(0).forEach((complete) => complete());
        const fileId = await filePromise;

        expect(linkId).toBe('media-1');
        expect(fileId).toBe('media-2');
        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
        expect(firebaseMocks.addDoc).toHaveBeenNthCalledWith(1, { path: 'teams/team-1/mediaItems' }, expect.objectContaining({
            title: 'Replay',
            order: 0,
            type: 'video-link'
        }));
        expect(firebaseMocks.addDoc).toHaveBeenNthCalledWith(2, { path: 'teams/team-1/mediaItems' }, expect.objectContaining({
            title: 'lineup.pdf',
            order: 1,
            type: 'file',
            downloadUrl: 'https://cdn.example.test/uploaded-file'
        }));
        expect(firebaseMocks.getDownloadURL).toHaveBeenCalledTimes(1);
    });

    it('returns the created media item for app callers that opt into the richer upload payload', async () => {
        const { uploadTeamMediaFile, uploadTeamMediaPhoto } = await import('../../js/db.js');
        const docFile = new File(['doc'], 'packet.pdf', { type: 'application/pdf' });
        const photoFile = new File(['photo'], 'tipoff.jpg', { type: 'image/jpeg' });

        const uploadedFilePromise = uploadTeamMediaFile('team-1', 'folder-1', docFile, { returnItem: true });
        const uploadedPhotoPromise = uploadTeamMediaPhoto('team-1', 'folder-1', photoFile, { returnItem: true });
        uploadTaskQueue.splice(0).forEach((complete) => complete());

        await expect(uploadedFilePromise).resolves.toMatchObject({
            id: 'media-1',
            title: 'packet.pdf',
            type: 'file',
            order: 0,
            url: 'https://cdn.example.test/uploaded-file',
            downloadUrl: 'https://cdn.example.test/uploaded-file'
        });
        await expect(uploadedPhotoPromise).resolves.toMatchObject({
            id: 'media-2',
            title: 'tipoff.jpg',
            type: 'photo',
            order: 1,
            url: 'https://cdn.example.test/uploaded-file',
            downloadUrl: 'https://cdn.example.test/uploaded-file'
        });
    });

    it('reuses cached media URLs and backfills legacy items after the first storage lookup', async () => {
        firebaseMocks.getDocs.mockResolvedValueOnce({
            docs: [{
                id: 'media-cached',
                data: () => ({
                    folderId: 'folder-1',
                    type: 'photo',
                    storagePath: 'team-media/team-1/folder-1/user-1/already-cached.jpg',
                    downloadUrl: 'https://cdn.example.test/already-cached.jpg',
                    order: 0,
                    deleted: false
                })
            }, {
                id: 'media-legacy',
                data: () => ({
                    folderId: 'folder-1',
                    type: 'file',
                    storagePath: 'team-media/team-1/folder-1/user-1/legacy.pdf',
                    order: 1,
                    deleted: false
                })
            }]
        });
        firebaseMocks.getDownloadURL.mockResolvedValueOnce('https://cdn.example.test/legacy.pdf');

        const { getTeamMediaItems } = await import('../../js/db.js');
        const items = await getTeamMediaItems('team-1', 'folder-1');

        expect(firebaseMocks.getDownloadURL).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.getDownloadURL).toHaveBeenCalledWith({ fullPath: 'team-media/team-1/folder-1/user-1/legacy.pdf' });
        expect(firebaseMocks.updateDoc).toHaveBeenCalledWith(
            { path: 'teams/team-1/mediaItems/media-legacy' },
            {
                downloadUrl: 'https://cdn.example.test/legacy.pdf',
                updatedAt: 'server-ts'
            }
        );
        expect(items).toEqual([
            expect.objectContaining({
                id: 'media-cached',
                storagePath: 'team-media/team-1/folder-1/user-1/already-cached.jpg',
                downloadUrl: 'https://cdn.example.test/already-cached.jpg'
            }),
            expect.objectContaining({
                id: 'media-legacy',
                storagePath: 'team-media/team-1/folder-1/user-1/legacy.pdf',
                downloadUrl: 'https://cdn.example.test/legacy.pdf'
            })
        ]);
    });

    it('returns bounded media item pages with stable folder order and cursor metadata', async () => {
        const docs = [
            {
                id: 'media-1',
                data: () => ({ folderId: 'folder-1', type: 'photo', downloadUrl: 'https://cdn.example.test/1.jpg', order: 1, deleted: false })
            },
            {
                id: 'media-2',
                data: () => ({ folderId: 'folder-1', type: 'photo', downloadUrl: 'https://cdn.example.test/2.jpg', order: 2, deleted: false })
            },
            {
                id: 'media-3',
                data: () => ({ folderId: 'folder-1', type: 'photo', downloadUrl: 'https://cdn.example.test/3.jpg', order: 3, deleted: false })
            }
        ];
        firebaseMocks.getDocs.mockResolvedValue({ docs });

        const { getTeamMediaItemsPage } = await import('../../js/db.js');
        const firstPage = await getTeamMediaItemsPage('team-1', 'folder-1', { pageSize: 2 });
        const secondPage = await getTeamMediaItemsPage('team-1', 'folder-1', { pageSize: 2, cursor: firstPage.nextCursor });

        expect(firebaseMocks.where).toHaveBeenCalledWith('folderId', '==', 'folder-1');
        expect(firstPage.items.map((item) => item.id)).toEqual(['media-1', 'media-2']);
        expect(firstPage.hasMore).toBe(true);
        expect(firstPage.lastDoc).toBe(docs[1]);
        expect(firstPage.nextCursor).toEqual({ kind: 'team-media-items-page', folderId: 'folder-1', offset: 2 });
        expect(secondPage.items.map((item) => item.id)).toEqual(['media-3']);
        expect(secondPage.hasMore).toBe(false);
        expect(secondPage.nextCursor).toBeNull();
    });

    it('keeps deleted items from truncating later live media pages', async () => {
        const docs = [
            {
                id: 'media-1',
                data: () => ({ folderId: 'folder-1', type: 'photo', downloadUrl: 'https://cdn.example.test/1.jpg', order: 1, deleted: false })
            },
            {
                id: 'media-deleted',
                data: () => ({ folderId: 'folder-1', type: 'photo', downloadUrl: 'https://cdn.example.test/deleted.jpg', order: 2, deleted: true })
            },
            {
                id: 'media-2',
                data: () => ({ folderId: 'folder-1', type: 'photo', downloadUrl: 'https://cdn.example.test/2.jpg', order: 3, deleted: false })
            },
            {
                id: 'media-3',
                data: () => ({ folderId: 'folder-1', type: 'photo', downloadUrl: 'https://cdn.example.test/3.jpg', order: 4, deleted: false })
            }
        ];
        firebaseMocks.getDocs.mockResolvedValue({ docs });

        const { getTeamMediaItemsPage } = await import('../../js/db.js');
        const firstPage = await getTeamMediaItemsPage('team-1', 'folder-1', { pageSize: 2 });
        const secondPage = await getTeamMediaItemsPage('team-1', 'folder-1', { pageSize: 2, cursor: firstPage.nextCursor });

        expect(firstPage.items.map((item) => item.id)).toEqual(['media-1', 'media-2']);
        expect(firstPage.hasMore).toBe(true);
        expect(secondPage.items.map((item) => item.id)).toEqual(['media-3']);
        expect(secondPage.hasMore).toBe(false);
    });

    it('preserves legacy media without order fields at the end of paginated reads', async () => {
        const docs = [
            {
                id: 'media-ordered',
                data: () => ({ folderId: 'folder-1', type: 'photo', downloadUrl: 'https://cdn.example.test/ordered.jpg', order: 0, deleted: false, title: 'Ordered' })
            },
            {
                id: 'media-legacy',
                data: () => ({ folderId: 'folder-1', type: 'photo', downloadUrl: 'https://cdn.example.test/legacy.jpg', deleted: false, title: 'Legacy' })
            }
        ];
        firebaseMocks.getDocs.mockResolvedValue({ docs });

        const { getTeamMediaItemsPage } = await import('../../js/db.js');
        const firstPage = await getTeamMediaItemsPage('team-1', 'folder-1', { pageSize: 1 });
        const secondPage = await getTeamMediaItemsPage('team-1', 'folder-1', { pageSize: 1, cursor: firstPage.nextCursor });

        expect(firstPage.items.map((item) => item.id)).toEqual(['media-ordered']);
        expect(firstPage.hasMore).toBe(true);
        expect(secondPage.items.map((item) => item.id)).toEqual(['media-legacy']);
        expect(secondPage.hasMore).toBe(false);
    });
});
