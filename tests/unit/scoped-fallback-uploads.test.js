import { beforeEach, describe, expect, it, vi } from 'vitest';

const uploadState = vi.hoisted(() => ({
    calls: []
}));

const firebaseMocks = vi.hoisted(() => ({
    ref: vi.fn((targetStorage, path) => ({ targetStorage, fullPath: path })),
    uploadBytes: vi.fn(async (storageRef, file) => {
        uploadState.calls.push({ targetStorage: storageRef.targetStorage, fullPath: storageRef.fullPath, file });
        if (storageRef.targetStorage === 'image-storage') {
            throw Object.assign(new Error('denied'), { code: 'storage/unauthorized' });
        }
        return { ref: storageRef };
    }),
    getDownloadURL: vi.fn(async (storageRef) => `https://cdn.example.test/${storageRef.fullPath}`)
}));

vi.mock('../../js/firebase.js?v=18', () => ({
    db: {},
    auth: { currentUser: { uid: 'user-42' } },
    storage: 'main-storage',
    collection: vi.fn(),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    doc: vi.fn(),
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    Timestamp: { now: vi.fn(() => ({ toMillis: () => Date.now() })) },
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
    functions: {},
    httpsCallable: vi.fn(),
    ref: firebaseMocks.ref,
    uploadBytes: firebaseMocks.uploadBytes,
    getDownloadURL: firebaseMocks.getDownloadURL,
    deleteObject: vi.fn()
}));

vi.mock('../../js/firebase-images.js?v=6', () => ({
    imageStorage: 'image-storage',
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn()
}));

describe('scoped fallback uploads', () => {
    beforeEach(() => {
        uploadState.calls.length = 0;
        vi.restoreAllMocks();
        vi.clearAllMocks();
        vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
    });

    it('falls back to a team-scoped stat sheet path when image storage rejects the upload', async () => {
        const { uploadStatSheetPhoto } = await import('../../js/db.js?v=47');

        const url = await uploadStatSheetPhoto('team/alpha', {
            name: 'box score (1).png',
            size: 123,
            type: 'image/png'
        });

        expect(uploadState.calls).toHaveLength(2);
        expect(uploadState.calls[1].fullPath).toBe('stat-sheets/team-games/team_alpha/user-42/1700000000000_box_score_1_.png');
        expect(url).toBe('https://cdn.example.test/stat-sheets/team-games/team_alpha/user-42/1700000000000_box_score_1_.png');
    });

    it('falls back to a team-scoped drill path when image storage rejects the upload', async () => {
        const { uploadDrillDiagram } = await import('../../js/db.js?v=47');

        const url = await uploadDrillDiagram('team/alpha', 'drill 7', {
            name: 'diagram #1.png',
            size: 456,
            type: 'image/png'
        });

        expect(uploadState.calls).toHaveLength(2);
        expect(uploadState.calls[1].fullPath).toBe('stat-sheets/drills/team_alpha/drill_7/user-42/1700000000000_diagram_1.png');
        expect(url).toBe('https://cdn.example.test/stat-sheets/drills/team_alpha/drill_7/user-42/1700000000000_diagram_1.png');
    });
});
