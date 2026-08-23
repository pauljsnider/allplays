import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    collection: vi.fn((database, name) => ({ database, name })),
    query: vi.fn((...parts) => parts),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    orderBy: vi.fn((field) => ({ type: 'orderBy', field })),
    limit: vi.fn((value) => ({ type: 'limit', value })),
    startAfter: vi.fn((value) => ({ type: 'startAfter', value })),
    getDocs: vi.fn(),
    getCountFromServer: vi.fn(),
    listPublicTeams: vi.fn(),
}));

vi.mock('../../js/firebase.js?v=27', () => ({
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
    getCountFromServer: firebaseMocks.getCountFromServer,
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    collectionGroup: vi.fn(),
    documentId: vi.fn(),
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
    functions: {},
    httpsCallable: vi.fn((_functions, name) => {
        if (name === 'listPublicTeams') return firebaseMocks.listPublicTeams;
        throw new Error(`Unexpected callable: ${name}`);
    }),
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

    it('uses the sanitized callable and passes its opaque cursor to the next page', async () => {
        const firstAtlantaTeam = {
            id: 'team-atl-1',
            name: 'Atlanta Fire',
            isPublic: true
        };
        const secondAtlantaTeam = {
            id: 'team-atl-2',
            name: 'Atlanta United 2',
            isPublic: true
        };
        const kansasTeam = {
            id: 'team-kc-1',
            name: 'Kansas City Current',
            isPublic: true
        };
        const zebrasTeam = {
            id: 'team-zebras-1',
            name: 'Zebras FC',
            isPublic: true
        };
        firebaseMocks.listPublicTeams
            .mockResolvedValueOnce({
                data: {
                    items: [firstAtlantaTeam, secondAtlantaTeam],
                    nextCursor: 'opaque-page-2'
                }
            })
            .mockResolvedValueOnce({
                data: {
                    items: [kansasTeam, zebrasTeam],
                    nextCursor: null
                }
            });

        const { discoverPublicTeams } = await import('../../js/db.js?v=4433183');

        const firstPage = await discoverPublicTeams({ searchText: 'atlanta', pageSize: 2 });

        expect(firstPage.teams.map((team) => team.id)).toEqual(['team-atl-1', 'team-atl-2']);
        expect(firstPage.nextCursor).toBe('opaque-page-2');

        const secondPage = await discoverPublicTeams({
            searchText: 'atlanta',
            pageSize: 2,
            cursor: firstPage.nextCursor
        });

        expect(secondPage.teams.map((team) => team.id)).toEqual(['team-kc-1', 'team-zebras-1']);
        expect(secondPage.nextCursor).toBeNull();
        expect(firebaseMocks.listPublicTeams).toHaveBeenNthCalledWith(1, {
            searchText: 'atlanta',
            pageSize: 2,
            cursor: null
        });
        expect(firebaseMocks.listPublicTeams).toHaveBeenNthCalledWith(2, {
            searchText: 'atlanta',
            pageSize: 2,
            cursor: 'opaque-page-2'
        });
        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
    });

    it('does not send legacy Firestore document cursors to the callable', async () => {
        firebaseMocks.listPublicTeams.mockResolvedValue({
            data: { items: [], nextCursor: null }
        });

        const { discoverPublicTeams } = await import('../../js/db.js?v=4433183');

        const page = await discoverPublicTeams({
            searchText: 'atlanta',
            pageSize: 2,
            cursor: {
                kind: 'public-team-search',
                searchText: 'atlanta',
                strategyCursors: [{ id: 'legacy-doc-cursor' }],
                bufferedTeams: [{ id: 'legacy-buffered-team' }]
            }
        });

        expect(page).toEqual({ teams: [], nextCursor: null });
        expect(firebaseMocks.listPublicTeams).toHaveBeenCalledWith({
            searchText: 'atlanta',
            pageSize: 2,
            cursor: null
        });
        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
    });
});

describe('public team roster count', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses a capped aggregation without loading roster documents', async () => {
        firebaseMocks.getCountFromServer.mockResolvedValue({
            data: () => ({ count: 10 })
        });
        const { getPublicTeamRosterCount } = await import('../../js/db.js?v=4433183');

        await expect(getPublicTeamRosterCount('team-roster-1')).resolves.toEqual({
            count: 10,
            isCapped: false
        });
        expect(firebaseMocks.collection).toHaveBeenCalledWith(expect.anything(), 'teams/team-roster-1/players');
        expect(firebaseMocks.limit).toHaveBeenCalledWith(201);
        expect(firebaseMocks.getCountFromServer).toHaveBeenCalledTimes(1);
        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
    });

    it('reports a lower-bound count when the public roster exceeds the cap', async () => {
        firebaseMocks.getCountFromServer.mockResolvedValue({
            data: () => ({ count: 201 })
        });
        const { getPublicTeamRosterCount } = await import('../../js/db.js?v=4433183');

        await expect(getPublicTeamRosterCount('team-large-roster')).resolves.toEqual({
            count: 200,
            isCapped: true
        });
    });
});

describe('bounded stat tracker config reads', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('caps schedule-facing config queries without changing unbounded legacy callers', async () => {
        firebaseMocks.getDocs.mockResolvedValue({
            docs: [createTeamDoc('config-1', { name: 'Basketball Standard', baseType: 'Basketball' })]
        });
        const { getConfigs } = await import('../../js/db.js?v=4433183');

        await expect(getConfigs('team-1', { limit: 100 })).resolves.toEqual([
            expect.objectContaining({ id: 'config-1', name: 'Basketball Standard' })
        ]);
        expect(firebaseMocks.limit).toHaveBeenCalledWith(100);
    });
});

describe('complete legacy collection helpers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns every authorized user while keeping each Firestore query bounded to 100', async () => {
        const firstPage = Array.from({ length: 100 }, (_, index) => createTeamDoc(`user-${index + 1}`, {
            email: `user-${String(index + 1).padStart(3, '0')}@example.com`
        }));
        const secondPage = [createTeamDoc('user-101', { email: 'user-101@example.com' })];
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: firstPage })
            .mockResolvedValueOnce({ docs: secondPage });

        const { getAllUsers } = await import('../../js/db.js?v=4433183');
        const users = await getAllUsers();

        expect(users).toHaveLength(101);
        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(2);
        expect(firebaseMocks.limit).toHaveBeenNthCalledWith(1, 100);
        expect(firebaseMocks.limit).toHaveBeenNthCalledWith(2, 100);
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(firstPage.at(-1));
    });

    it('returns every private team page instead of silently truncating at 100', async () => {
        const firstPage = Array.from({ length: 100 }, (_, index) => createTeamDoc(`team-${index + 1}`, {
            name: `Team ${String(index + 1).padStart(3, '0')}`
        }));
        const secondPage = [createTeamDoc('team-101', { name: 'Team 101' })];
        firebaseMocks.getDocs
            .mockResolvedValueOnce({ docs: firstPage })
            .mockResolvedValueOnce({ docs: secondPage });

        const { getTeams } = await import('../../js/db.js?v=4433183');
        const teams = await getTeams({ includePrivate: true });

        expect(teams).toHaveLength(101);
        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(2);
        expect(firebaseMocks.limit).toHaveBeenNthCalledWith(1, 100);
        expect(firebaseMocks.limit).toHaveBeenNthCalledWith(2, 100);
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(firstPage.at(-1));
    });

    it('returns public teams beyond the former 1,000-team cutoff', async () => {
        const pages = Array.from({ length: 11 }, (_, pageIndex) => {
            const pageSize = pageIndex === 10 ? 1 : 100;
            return {
                data: {
                    items: Array.from({ length: pageSize }, (_, itemIndex) => ({
                        id: `public-team-${(pageIndex * 100) + itemIndex + 1}`,
                        name: `Public Team ${(pageIndex * 100) + itemIndex + 1}`,
                        isPublic: true
                    })),
                    nextCursor: pageIndex < 10 ? `public-page-${pageIndex + 2}` : null
                }
            };
        });
        pages.forEach((page) => firebaseMocks.listPublicTeams.mockResolvedValueOnce(page));

        const { getTeams } = await import('../../js/db.js?v=4433183-public-team-complete');
        const teams = await getTeams({ publicOnly: true });

        expect(teams).toHaveLength(1001);
        expect(teams.at(-1)?.id).toBe('public-team-1001');
        expect(firebaseMocks.listPublicTeams).toHaveBeenCalledTimes(11);
        expect(firebaseMocks.listPublicTeams).toHaveBeenNthCalledWith(11, {
            searchText: '',
            pageSize: 100,
            cursor: 'public-page-11'
        });
    });
});
