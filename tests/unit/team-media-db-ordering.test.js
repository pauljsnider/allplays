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
    orderBy: vi.fn(),
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
    where: vi.fn(),
    writeBatch: vi.fn(),
}));

const uploadTaskQueue = vi.hoisted(() => []);

vi.mock('../../js/firebase.js?v=18', () => ({
    db: {},
    auth: { currentUser: { uid: 'user-1' } },
    storage: {},
    functions: {},
    collection: firebaseMocks.collection,
    getDocs: firebaseMocks.getDocs,
    getDoc: firebaseMocks.getDoc,
    doc: firebaseMocks.doc,
    addDoc: firebaseMocks.addDoc,
    updateDoc: vi.fn(),
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
    limit: vi.fn(),
    startAfter: vi.fn(),
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

    it('assigns unique sequential orders to concurrent photo uploads without album reads or stored bearer URLs', async () => {
        const { uploadTeamMediaPhoto } = await import('../../js/db.js');
        const files = [
            new File(['photo-1'], 'tipoff.jpg', { type: 'image/jpeg' }),
            new File(['photo-2'], 'bench.jpg', { type: 'image/jpeg' })
        ];

        const uploadPromises = files.map((file) => uploadTeamMediaPhoto('team-1', 'folder-1', file));
        expect(uploadTaskQueue).toHaveLength(2);

        uploadTaskQueue.splice(0).forEach((complete) => complete());
        await Promise.all(uploadPromises);

        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
        expect(firebaseMocks.runTransaction).toHaveBeenCalledTimes(2);
        expect(firebaseMocks.addDoc).toHaveBeenNthCalledWith(1, { path: 'teams/team-1/mediaItems' }, expect.objectContaining({
            folderId: 'folder-1',
            title: 'tipoff.jpg',
            order: 0,
            type: 'photo'
        }));
        expect(firebaseMocks.addDoc.mock.calls[0][1]).not.toHaveProperty('url');
        expect(firebaseMocks.addDoc).toHaveBeenNthCalledWith(2, { path: 'teams/team-1/mediaItems' }, expect.objectContaining({
            folderId: 'folder-1',
            title: 'bench.jpg',
            order: 1,
            type: 'photo'
        }));
        expect(firebaseMocks.addDoc.mock.calls[1][1]).not.toHaveProperty('url');
        expect(firebaseMocks.getDownloadURL).not.toHaveBeenCalled();
    });

    it('starts legacy folders at zero when the media order counter is missing and omits stored file URLs', async () => {
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
        expect(firebaseMocks.addDoc.mock.calls[1][1]).not.toHaveProperty('url');
        expect(firebaseMocks.getDownloadURL).not.toHaveBeenCalled();
    });

    it('resolves team media download URLs from storagePath after reading authorized metadata', async () => {
        firebaseMocks.getDocs.mockResolvedValueOnce({
            docs: [{
                id: 'media-1',
                data: () => ({
                    folderId: 'folder-1',
                    type: 'photo',
                    storagePath: 'team-media/team-1/folder-1/user-1/tipoff.jpg',
                    order: 0,
                    deleted: false
                })
            }]
        });
        firebaseMocks.getDownloadURL.mockResolvedValueOnce('https://cdn.example.test/resolved-tipoff.jpg');

        const { getTeamMediaItems } = await import('../../js/db.js');
        const items = await getTeamMediaItems('team-1', 'folder-1');

        expect(firebaseMocks.getDownloadURL).toHaveBeenCalledWith({ fullPath: 'team-media/team-1/folder-1/user-1/tipoff.jpg' });
        expect(items).toEqual([expect.objectContaining({
            id: 'media-1',
            storagePath: 'team-media/team-1/folder-1/user-1/tipoff.jpg',
            downloadUrl: 'https://cdn.example.test/resolved-tipoff.jpg'
        })]);
    });
});
