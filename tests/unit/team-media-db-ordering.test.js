import { beforeEach, describe, expect, it, vi } from 'vitest';

const folderState = vi.hoisted(() => ({ nextMediaOrder: 0 }));
const addDocState = vi.hoisted(() => ({ nextId: 1 }));
const batchState = vi.hoisted(() => ({ batches: [] }));
const firebaseMocks = vi.hoisted(() => ({
    addDoc: vi.fn(async (_collectionRef, data) => ({ id: `media-${addDocState.nextId++}`, data })),
    collection: vi.fn((_db, path) => ({ path })),
    deleteField: vi.fn(() => 'DELETE_FIELD'),
    getCountFromServer: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    getDownloadURL: vi.fn(async () => 'https://cdn.example.test/uploaded-file'),
    deleteObject: vi.fn(async () => undefined),
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
    uploadBytes: vi.fn(async () => ({ ref: { fullPath: 'team-media/copied-upload' } })),
    updateDoc: vi.fn(async () => undefined),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    writeBatch: vi.fn(),
}));

const teamMediaUtilsMocks = vi.hoisted(() => ({
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

const uploadTaskQueue = vi.hoisted(() => []);

vi.mock('../../js/firebase.js?v=20', () => ({
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
    deleteField: firebaseMocks.deleteField,
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
    uploadBytes: firebaseMocks.uploadBytes,
    getDownloadURL: firebaseMocks.getDownloadURL,
    deleteObject: firebaseMocks.deleteObject
}));

vi.mock('../../js/firebase-images.js?v=9', () => ({
    imageStorage: {},
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn()
}));

vi.mock('../../js/team-media-utils.js?v=5', () => teamMediaUtilsMocks);

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
        batchState.batches = [];
        firebaseMocks.writeBatch.mockImplementation(() => {
            const batch = {
                deletes: [],
                updates: [],
                delete: vi.fn((docRef) => batch.deletes.push(docRef)),
                update: vi.fn((docRef, payload) => batch.updates.push({ docRef, payload })),
                commit: vi.fn(async () => undefined)
            };
            batchState.batches.push(batch);
            return batch;
        });
        uploadTaskQueue.length = 0;
        global.fetch = vi.fn(async () => ({
            ok: true,
            status: 200,
            blob: async () => new Blob(['copied-media'], { type: 'image/jpeg' })
        }));
    });

    it('assigns unique sequential orders to concurrent photo uploads without persisting download URLs', async () => {
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
            type: 'photo'
        }));
        expect(firebaseMocks.addDoc.mock.calls[0][1]).not.toHaveProperty('downloadUrl');
        expect(firebaseMocks.addDoc).toHaveBeenNthCalledWith(2, { path: 'teams/team-1/mediaItems' }, expect.objectContaining({
            folderId: 'folder-1',
            title: 'bench.jpg',
            order: 1,
            type: 'photo'
        }));
        expect(firebaseMocks.addDoc.mock.calls[1][1]).not.toHaveProperty('downloadUrl');
        expect(firebaseMocks.getDownloadURL).not.toHaveBeenCalled();
    });

    it('starts legacy folders at zero when the media order counter is missing without storing file download URLs', async () => {
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
            type: 'file'
        }));
        expect(firebaseMocks.addDoc.mock.calls[1][1]).not.toHaveProperty('downloadUrl');
        expect(firebaseMocks.getDownloadURL).not.toHaveBeenCalled();
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
            url: 'https://cdn.example.test/uploaded-file'
        });
        await expect(uploadedPhotoPromise).resolves.toMatchObject({
            id: 'media-2',
            title: 'tipoff.jpg',
            type: 'photo',
            order: 1,
            url: 'https://cdn.example.test/uploaded-file'
        });
    });

    it('re-resolves storage-backed media URLs and strips legacy cached url fields', async () => {
        firebaseMocks.getDocs.mockResolvedValueOnce({
            docs: [{
                id: 'media-cached',
                data: () => ({
                    folderId: 'folder-1',
                    type: 'photo',
                    storagePath: 'team-media/team-1/folder-1/user-1/already-cached.jpg',
                    downloadUrl: 'https://cdn.example.test/already-cached.jpg',
                    url: 'https://cdn.example.test/already-cached-persisted.jpg',
                    src: 'https://cdn.example.test/already-cached-src.jpg',
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
        firebaseMocks.getDownloadURL
            .mockResolvedValueOnce('https://cdn.example.test/already-cached-fresh.jpg')
            .mockResolvedValueOnce('https://cdn.example.test/legacy.pdf');

        const { getTeamMediaItems } = await import('../../js/db.js');
        const items = await getTeamMediaItems('team-1', 'folder-1');

        expect(firebaseMocks.getDownloadURL).toHaveBeenCalledTimes(2);
        expect(firebaseMocks.getDownloadURL).toHaveBeenNthCalledWith(1, { fullPath: 'team-media/team-1/folder-1/user-1/already-cached.jpg' });
        expect(firebaseMocks.getDownloadURL).toHaveBeenNthCalledWith(2, { fullPath: 'team-media/team-1/folder-1/user-1/legacy.pdf' });
        expect(firebaseMocks.updateDoc).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.updateDoc).toHaveBeenCalledWith(
            { path: 'teams/team-1/mediaItems/media-cached' },
            {
                downloadUrl: 'DELETE_FIELD',
                url: 'DELETE_FIELD',
                src: 'DELETE_FIELD',
                updatedAt: 'server-ts'
            }
        );
        expect(items).toEqual([
            expect.objectContaining({
                id: 'media-cached',
                storagePath: 'team-media/team-1/folder-1/user-1/already-cached.jpg',
                url: 'https://cdn.example.test/already-cached-fresh.jpg'
            }),
            expect.objectContaining({
                id: 'media-legacy',
                storagePath: 'team-media/team-1/folder-1/user-1/legacy.pdf',
                url: 'https://cdn.example.test/legacy.pdf'
            })
        ]);
        expect(items[0]).not.toHaveProperty('downloadUrl');
        expect(items[0]).not.toHaveProperty('src');
        expect(items[1]).not.toHaveProperty('downloadUrl');
    });

    it('drops persisted storage urls when fresh authorization cannot be resolved', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        firebaseMocks.getDocs.mockResolvedValueOnce({
            docs: [{
                id: 'media-stale',
                data: () => ({
                    folderId: 'folder-1',
                    type: 'photo',
                    storagePath: 'team-media/team-1/folder-1/user-1/stale.jpg',
                    url: 'https://cdn.example.test/stale-persisted.jpg',
                    src: 'https://cdn.example.test/stale-src.jpg',
                    order: 0,
                    deleted: false
                })
            }]
        });
        firebaseMocks.getDownloadURL.mockRejectedValueOnce(new Error('storage/unauthorized'));

        const { getTeamMediaItems } = await import('../../js/db.js');
        let items;
        try {
            items = await getTeamMediaItems('team-1', 'folder-1');

            expect(firebaseMocks.updateDoc).toHaveBeenCalledWith(
                { path: 'teams/team-1/mediaItems/media-stale' },
                {
                    url: 'DELETE_FIELD',
                    src: 'DELETE_FIELD',
                    updatedAt: 'server-ts'
                }
            );
            expect(warnSpy).toHaveBeenCalledWith(
                'Unable to resolve authorized team media download URL:',
                expect.any(Error)
            );
            expect(items).toEqual([
                expect.objectContaining({
                    id: 'media-stale',
                    storagePath: 'team-media/team-1/folder-1/user-1/stale.jpg'
                })
            ]);
            expect(items[0]).not.toHaveProperty('url');
            expect(items[0]).not.toHaveProperty('src');
            expect(items[0]).not.toHaveProperty('downloadUrl');
        } finally {
            warnSpy.mockRestore();
        }
    });

    it('soft-deletes large albums in multiple metadata-only batches without resolving storage URLs', async () => {
        const docs = Array.from({ length: 501 }, (_, index) => ({
            id: `media-${index + 1}`,
            data: () => ({
                folderId: 'folder-large',
                type: index % 2 === 0 ? 'photo' : 'file',
                storagePath: `team-media/team-1/folder-large/user-1/media-${index + 1}`,
                order: index,
                deleted: false
            })
        }));
        firebaseMocks.getDocs.mockResolvedValueOnce({ docs });

        const { deleteTeamMediaFolder } = await import('../../js/db.js');
        await deleteTeamMediaFolder('team-1', 'folder-large');

        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.where).toHaveBeenCalledWith('folderId', '==', 'folder-large');
        expect(firebaseMocks.getDownloadURL).not.toHaveBeenCalled();
        expect(firebaseMocks.writeBatch).toHaveBeenCalledTimes(2);
        expect(batchState.batches.map((batch) => batch.commit)).toEqual([
            expect.any(Function),
            expect.any(Function)
        ]);
        expect(batchState.batches[0].commit).toHaveBeenCalledTimes(1);
        expect(batchState.batches[1].commit).toHaveBeenCalledTimes(1);
        expect(batchState.batches[0].deletes).toEqual([]);
        expect(batchState.batches[1].deletes).toEqual([{ path: 'teams/team-1/mediaFolders/folder-large' }]);
        const updates = batchState.batches.flatMap((batch) => batch.updates);
        expect(updates).toHaveLength(501);
        expect(batchState.batches[0].updates).toHaveLength(450);
        expect(batchState.batches[1].updates).toHaveLength(51);
        expect(updates.map((entry) => entry.docRef.path)).toEqual(
            docs.map((itemDoc) => `teams/team-1/mediaItems/${itemDoc.id}`)
        );
        expect(updates[0].payload).toEqual({
            deleted: true,
            deletedAt: 'server-ts',
            updatedAt: 'server-ts'
        });
    });

    it('returns bounded media item pages with stable folder order and cursor metadata', async () => {
        const docs = [
            {
                id: 'media-1',
                data: () => ({ folderId: 'folder-1', type: 'photo', storagePath: 'team-media/team-1/folder-1/user-1/1.jpg', order: 1, deleted: false })
            },
            {
                id: 'media-2',
                data: () => ({ folderId: 'folder-1', type: 'photo', storagePath: 'team-media/team-1/folder-1/user-1/2.jpg', order: 2, deleted: false })
            },
            {
                id: 'media-3',
                data: () => ({ folderId: 'folder-1', type: 'photo', storagePath: 'team-media/team-1/folder-1/user-1/3.jpg', order: 3, deleted: false })
            }
        ];
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs })
            .mockResolvedValueOnce({ docs: [docs[2]] })
            .mockResolvedValueOnce({ docs: [] });
        firebaseMocks.getDownloadURL
            .mockResolvedValueOnce('https://cdn.example.test/1.jpg')
            .mockResolvedValueOnce('https://cdn.example.test/2.jpg')
            .mockResolvedValueOnce('https://cdn.example.test/3.jpg');

        const { getTeamMediaItemsPage } = await import('../../js/db.js');
        const firstPage = await getTeamMediaItemsPage('team-1', 'folder-1', { pageSize: 2 });
        const secondPage = await getTeamMediaItemsPage('team-1', 'folder-1', { pageSize: 2, cursor: firstPage.nextCursor });

        expect(firebaseMocks.where).toHaveBeenCalledWith('folderId', '==', 'folder-1');
        expect(firebaseMocks.orderBy).toHaveBeenCalledWith('order');
        expect(firebaseMocks.limit).toHaveBeenCalledWith(7);
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(docs[1]);
        expect(firstPage.items.map((item) => item.id)).toEqual(['media-1', 'media-2']);
        expect(firstPage.hasMore).toBe(true);
        expect(firstPage.lastDoc).toBe(docs[1]);
        expect(firstPage.nextCursor).toEqual({ kind: 'team-media-items-page', folderId: 'folder-1', phase: 'ordered', lastDoc: docs[1] });
        expect(secondPage.items.map((item) => item.id)).toEqual(['media-3']);
        expect(secondPage.hasMore).toBe(false);
        expect(secondPage.nextCursor).toBeNull();
        expect(firebaseMocks.getDownloadURL).toHaveBeenCalledTimes(3);
    });

    it('keeps deleted items from truncating later live media pages', async () => {
        const orderedBatch = [
            {
                id: 'media-1',
                data: () => ({ folderId: 'folder-1', type: 'photo', storagePath: 'team-media/team-1/folder-1/user-1/1.jpg', order: 1, deleted: false })
            },
            {
                id: 'media-deleted',
                data: () => ({ folderId: 'folder-1', type: 'photo', storagePath: 'team-media/team-1/folder-1/user-1/deleted.jpg', order: 2, deleted: true })
            },
            {
                id: 'media-2',
                data: () => ({ folderId: 'folder-1', type: 'photo', storagePath: 'team-media/team-1/folder-1/user-1/2.jpg', order: 3, deleted: false })
            },
            {
                id: 'media-3',
                data: () => ({ folderId: 'folder-1', type: 'photo', storagePath: 'team-media/team-1/folder-1/user-1/3.jpg', order: 4, deleted: false })
            }
        ];
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: orderedBatch })
            .mockResolvedValueOnce({ docs: [orderedBatch[3]] })
            .mockResolvedValueOnce({ docs: [] });
        firebaseMocks.getDownloadURL
            .mockResolvedValueOnce('https://cdn.example.test/1.jpg')
            .mockResolvedValueOnce('https://cdn.example.test/2.jpg')
            .mockResolvedValueOnce('https://cdn.example.test/3.jpg');

        const { getTeamMediaItemsPage } = await import('../../js/db.js');
        const firstPage = await getTeamMediaItemsPage('team-1', 'folder-1', { pageSize: 2 });
        const secondPage = await getTeamMediaItemsPage('team-1', 'folder-1', { pageSize: 2, cursor: firstPage.nextCursor });

        expect(firstPage.items.map((item) => item.id)).toEqual(['media-1', 'media-2']);
        expect(firstPage.hasMore).toBe(true);
        expect(secondPage.items.map((item) => item.id)).toEqual(['media-3']);
        expect(secondPage.hasMore).toBe(false);
        expect(firebaseMocks.getDownloadURL).toHaveBeenCalledTimes(3);
        expect(firebaseMocks.getDownloadURL).not.toHaveBeenCalledWith({ fullPath: 'team-media/team-1/folder-1/user-1/deleted.jpg' });
    });

    it('re-scopes storage-backed media when moving into a different album', async () => {
        teamMediaUtilsMocks.buildMoveUpdates.mockReturnValue([
            { id: 'media-1', folderId: 'folder-private', order: 3 }
        ]);
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({
                docs: [{
                    id: 'media-1',
                    data: () => ({
                        folderId: 'folder-team',
                        order: 0,
                        type: 'photo',
                        mimeType: 'image/jpeg',
                        storagePath: 'team-media/team-1/folder-team/user-1/original.jpg',
                        uploadedBy: 'user-1',
                        deleted: false
                    })
                }]
            });
        firebaseMocks.getDownloadURL.mockResolvedValueOnce('https://cdn.example.test/original.jpg');

        const { moveTeamMediaItems } = await import('../../js/db.js');
        await moveTeamMediaItems('team-1', ['media-1'], 'folder-private');

        expect(firebaseMocks.uploadBytes).toHaveBeenCalledWith(
            { fullPath: 'team-media/team-1/folder-private/user-1/original.jpg' },
            expect.any(Blob),
            { contentType: 'image/jpeg' }
        );
        expect(firebaseMocks.updateDoc).toHaveBeenCalledWith(
            { path: 'teams/team-1/mediaItems/media-1' },
            {
                folderId: 'folder-private',
                order: 3,
                storagePath: 'team-media/team-1/folder-private/user-1/original.jpg',
                updatedAt: 'server-ts'
            }
        );
        expect(firebaseMocks.deleteObject).toHaveBeenCalledWith({ fullPath: 'team-media/team-1/folder-team/user-1/original.jpg' });
    });

    it('preserves legacy media without order fields at the end of paginated reads', async () => {
        const orderedDocs = [
            {
                id: 'media-ordered',
                data: () => ({ folderId: 'folder-1', type: 'photo', storagePath: 'team-media/team-1/folder-1/user-1/ordered.jpg', order: 0, deleted: false, title: 'Ordered' })
            }
        ];
        const legacyDocs = [
            {
                id: 'media-ordered',
                data: () => ({ folderId: 'folder-1', type: 'photo', storagePath: 'team-media/team-1/folder-1/user-1/ordered.jpg', order: 0, deleted: false, title: 'Ordered' })
            },
            {
                id: 'media-legacy',
                data: () => ({ folderId: 'folder-1', type: 'photo', storagePath: 'team-media/team-1/folder-1/user-1/legacy.jpg', deleted: false, title: 'Legacy' })
            }
        ];
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: orderedDocs })
            .mockResolvedValueOnce({ docs: legacyDocs })
            .mockResolvedValueOnce({ docs: legacyDocs });
        firebaseMocks.getDownloadURL
            .mockResolvedValueOnce('https://cdn.example.test/ordered.jpg')
            .mockResolvedValueOnce('https://cdn.example.test/legacy.jpg');

        const { getTeamMediaItemsPage } = await import('../../js/db.js');
        const firstPage = await getTeamMediaItemsPage('team-1', 'folder-1', { pageSize: 1 });
        const secondPage = await getTeamMediaItemsPage('team-1', 'folder-1', { pageSize: 1, cursor: firstPage.nextCursor });

        expect(firstPage.items.map((item) => item.id)).toEqual(['media-ordered']);
        expect(firstPage.hasMore).toBe(true);
        expect(firstPage.nextCursor).toEqual({ kind: 'team-media-items-page', folderId: 'folder-1', phase: 'legacy', offset: 0 });
        expect(secondPage.items.map((item) => item.id)).toEqual(['media-legacy']);
        expect(secondPage.hasMore).toBe(false);
    });
});
