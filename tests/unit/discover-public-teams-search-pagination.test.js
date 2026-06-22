import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    collection: vi.fn((database, name) => ({ database, name })),
    query: vi.fn((...parts) => parts),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    orderBy: vi.fn((field) => ({ type: 'orderBy', field })),
    limit: vi.fn((value) => ({ type: 'limit', value })),
    startAfter: vi.fn((value) => ({ type: 'startAfter', value })),
    getDocs: vi.fn(),
}));

vi.mock('../../js/firebase.js?v=19', () => ({
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
    where: firebaseMocks.where,
    orderBy: firebaseMocks.orderBy,
    Timestamp: { now: vi.fn(() => ({ toMillis: () => Date.now() })) },
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

vi.mock('../../js/team-visibility.js?v=2', () => ({
    isTeamActive: vi.fn(() => true),
    filterTeamsByActive: vi.fn((teams) => teams),
    shouldIncludeTeamInLiveOrUpcoming: vi.fn(() => true),
    shouldIncludeTeamInReplay: vi.fn(() => true)
}));

function createTeamDoc(id, data) {
    return {
        id,
        data: () => data
    };
}

describe('discoverPublicTeams search pagination', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns opaque cursors for searched results and uses them on the next page', async () => {
        const firstAtlantaDoc = createTeamDoc('team-atl-1', {
            name: 'Atlanta Fire',
            isPublic: true,
            publicSearchName: 'atlanta fire',
            publicSearchCity: 'atlanta'
        });
        const secondAtlantaDoc = createTeamDoc('team-atl-2', {
            name: 'Atlanta United 2',
            isPublic: true,
            publicSearchName: 'atlanta united 2',
            publicSearchCity: 'atlanta'
        });
        const kansasDoc = createTeamDoc('team-kc-1', {
            name: 'Kansas City Current',
            isPublic: true,
            publicSearchCity: 'atlanta'
        });
        const zebrasDoc = createTeamDoc('team-zebras-1', {
            name: 'Zebras FC',
            isPublic: true,
            publicSearchName: 'zebras fc'
        });

        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: [firstAtlantaDoc, secondAtlantaDoc] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [firstAtlantaDoc, kansasDoc] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [zebrasDoc] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] })
            .mockResolvedValueOnce({ docs: [] });

        const { discoverPublicTeams } = await import('../../js/db.js?v=60');

        const firstPage = await discoverPublicTeams({ searchText: 'atlanta', pageSize: 2 });

        expect(firstPage.teams.map((team) => team.id)).toEqual(['team-atl-1', 'team-atl-2']);
        expect(firstPage.nextCursor).toMatchObject({
            kind: 'public-team-search',
            searchText: 'atlanta',
            bufferedTeams: [expect.objectContaining({ id: 'team-kc-1' })]
        });

        const secondPage = await discoverPublicTeams({
            searchText: 'atlanta',
            pageSize: 2,
            cursor: firstPage.nextCursor
        });

        expect(secondPage.teams.map((team) => team.id)).toEqual(['team-kc-1', 'team-zebras-1']);
        expect(secondPage.nextCursor).toBeNull();
        expect(firebaseMocks.startAfter).toHaveBeenCalledTimes(2);
        expect(firebaseMocks.startAfter).toHaveBeenNthCalledWith(1, secondAtlantaDoc);
        expect(firebaseMocks.startAfter).toHaveBeenNthCalledWith(2, kansasDoc);
    });

    it('serves the next page from buffered search teams before querying Firestore again', async () => {
        const bufferedAtlantaTeam = {
            id: 'team-atl-3',
            name: 'Atlanta United 3',
            isPublic: true,
            publicSearchName: 'atlanta united 3'
        };
        const bufferedKansasTeam = {
            id: 'team-kc-2',
            name: 'Kansas City Wave',
            isPublic: true,
            publicSearchCity: 'atlanta'
        };
        const persistedCursorDoc = createTeamDoc('team-atl-2', {
            name: 'Atlanta United 2',
            isPublic: true,
            publicSearchName: 'atlanta united 2'
        });

        const { discoverPublicTeams } = await import('../../js/db.js?v=60');

        const page = await discoverPublicTeams({
            searchText: 'atlanta',
            pageSize: 2,
            cursor: {
                kind: 'public-team-search',
                searchText: 'atlanta',
                strategyCursors: [persistedCursorDoc, null, null, null],
                bufferedTeams: [bufferedAtlantaTeam, bufferedKansasTeam]
            }
        });

        expect(page.teams.map((team) => team.id)).toEqual(['team-atl-3', 'team-kc-2']);
        expect(page.nextCursor).toMatchObject({
            kind: 'public-team-search',
            searchText: 'atlanta',
            strategyCursors: [persistedCursorDoc, null, null, null],
            bufferedTeams: []
        });
        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
        expect(firebaseMocks.startAfter).not.toHaveBeenCalled();
    });
});
