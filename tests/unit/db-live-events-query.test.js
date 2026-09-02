import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    collection: vi.fn((_db, path) => ({ path })),
    getDocs: vi.fn(),
    onSnapshot: vi.fn(),
    orderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
    limit: vi.fn((value) => ({ type: 'limit', value })),
    query: vi.fn((collectionRef, ...constraints) => ({ collectionRef, constraints }))
}));

vi.mock('../../js/firebase.js?v=33', () => ({
    db: {},
    auth: { currentUser: null },
    storage: {},
    collection: firebaseMocks.collection,
    getDocs: firebaseMocks.getDocs,
    getDoc: vi.fn(),
    doc: vi.fn((_db, ...segments) => ({ path: segments.join('/') })),
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
    startAfter: vi.fn(),
    getCountFromServer: vi.fn(),
    onSnapshot: firebaseMocks.onSnapshot,
    serverTimestamp: vi.fn(),
    collectionGroup: vi.fn(),
    documentId: vi.fn(),
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
    functions: {},
    httpsCallable: vi.fn(),
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

const { subscribeLiveEvents, getLiveEvents } = await import('../../js/db.js?v=4433194-live-events');

function createEventDocs(count) {
    return Array.from({ length: count }, (_, index) => ({
        id: `event-${index + 1}`,
        data: () => ({ createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)) })
    }));
}

describe('live event query bounds', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('subscribes to only the newest 20 events and normalizes them chronologically', () => {
        const allEvents = createEventDocs(25);
        firebaseMocks.onSnapshot.mockImplementation((queryValue, onNext) => {
            const limitConstraint = queryValue.constraints.find((constraint) => constraint.type === 'limit');
            const newestEvents = allEvents.slice(-limitConstraint.value).reverse();
            onNext({ docs: newestEvents });
            return vi.fn();
        });
        const callback = vi.fn();

        subscribeLiveEvents('team-1', 'game-1', callback);

        expect(firebaseMocks.query).toHaveBeenCalledWith(
            { path: 'teams/team-1/games/game-1/liveEvents' },
            { type: 'orderBy', field: 'createdAt', direction: 'desc' },
            { type: 'limit', value: 20 }
        );
        expect(callback).toHaveBeenCalledWith(
            allEvents.slice(-20).map((event) => ({ id: event.id, ...event.data() }))
        );
    });

    it('keeps completed-game replay loading the full ascending timeline', async () => {
        const allEvents = createEventDocs(25);
        firebaseMocks.getDocs.mockResolvedValue({ docs: allEvents });

        await expect(getLiveEvents('team-1', 'game-1')).resolves.toEqual(
            allEvents.map((event) => ({ id: event.id, ...event.data() }))
        );
        expect(firebaseMocks.query).toHaveBeenCalledWith(
            { path: 'teams/team-1/games/game-1/liveEvents' },
            { type: 'orderBy', field: 'createdAt', direction: 'asc' }
        );
        expect(firebaseMocks.limit).not.toHaveBeenCalled();
    });
});
