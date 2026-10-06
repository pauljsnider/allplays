import { readFileSync } from 'node:fs';
import { buildTrackLiveResumeState } from '../../js/track-live-state.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    collection: vi.fn((_db, path) => ({ path })),
    getDocs: vi.fn(),
    onSnapshot: vi.fn(),
    orderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
    startAfter: vi.fn((cursor) => ({ type: 'startAfter', cursor })),
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
    startAfter: firebaseMocks.startAfter,
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

const { subscribeLiveEvents, getLiveEvents } = await import('../../js/db.js?v=4433203-live-events');

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

    function servePages(allEvents) {
        firebaseMocks.getDocs.mockImplementation(async ({ constraints }) => {
            expect(constraints).toContainEqual({ type: 'limit', value: 20 });
            expect(constraints).toContainEqual({ type: 'orderBy', field: 'createdAt', direction: 'asc' });
            const cursor = constraints.find((item) => item.type === 'startAfter')?.cursor;
            const offset = cursor ? allEvents.indexOf(cursor) + 1 : 0;
            if (cursor) expect(allEvents).toContain(cursor);
            return { docs: allEvents.slice(offset, offset + 20) };
        });
    }

    it.each([0, 1, 20, 21, 40, 41])('loads all %i events with bounded ascending document-cursor reads', async (count) => {
        const allEvents = createEventDocs(count).map((event) => ({
            ...event,
            data: () => ({ createdAt: new Date(0), type: 'stat', statKey: 'pts', value: 2 })
        }));
        servePages(allEvents);
        await expect(getLiveEvents('team-1', 'game-1')).resolves.toEqual(
            allEvents.map((event) => ({ id: event.id, ...event.data() }))
        );
        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(Math.floor(count / 20) + 1);
        for (let index = 0; index < Math.floor(count / 20); index++) {
            expect(firebaseMocks.startAfter).toHaveBeenNthCalledWith(index + 1, allEvents[(index + 1) * 20 - 1]);
        }
    });

    it('preserves reset and undo events across resume page boundaries', async () => {
        const allEvents = createEventDocs(41).map((event, index) => ({
            ...event,
            data: () => ({ createdAt: new Date(index), type: index === 20 ? 'reset' : index === 40 ? 'undo' : 'stat', statKey: 'pts', value: 2, playerId: 'p1' })
        }));
        servePages(allEvents);
        const events = await getLiveEvents('team-1', 'game-1');
        expect(buildTrackLiveResumeState({ liveEvents: events })).toEqual(
            buildTrackLiveResumeState({ liveEvents: allEvents.map((event) => ({ id: event.id, ...event.data() })) })
        );
        expect(events).toHaveLength(41);
    });

    it('propagates later-page errors instead of returning partial resume history', async () => {
        servePages(createEventDocs(41));
        const error = Object.assign(new Error('denied'), { code: 'permission-denied' });
        firebaseMocks.getDocs.mockResolvedValueOnce({ docs: createEventDocs(20) }).mockRejectedValueOnce(error);
        await expect(getLiveEvents('team-1', 'game-1')).rejects.toBe(error);
    });

    it('loads the complete history before constructing Classic resume state', () => {
        const source = readFileSync(new URL('../../track-live.html', import.meta.url), 'utf8');
        expect(source).toContain('const liveEvents = await getLiveEvents(teamId, gameId);');
        expect(source).toMatch(/buildTrackLiveResumeState\(\{\s*liveEvents,/);
        expect(source).not.toContain('const liveEventsSnapshot = await getDocs(query(');
    });
});
