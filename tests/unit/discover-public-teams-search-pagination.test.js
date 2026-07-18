import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    auth: { currentUser: null },
    collection: vi.fn((database, name) => ({ database, name })),
    doc: vi.fn((database, ...segments) => ({ database, path: segments.join('/') })),
    query: vi.fn((...parts) => parts),
    where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
    orderBy: vi.fn((field) => ({ type: 'orderBy', field })),
    limit: vi.fn((value) => ({ type: 'limit', value })),
    startAfter: vi.fn((value) => ({ type: 'startAfter', value })),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
    getCountFromServer: vi.fn(),
    httpsCallable: vi.fn(),
}));

vi.mock('../../js/firebase.js?v=22', () => ({
    db: {},
    auth: firebaseMocks.auth,
    storage: {},
    collection: firebaseMocks.collection,
    getDocs: firebaseMocks.getDocs,
    getDoc: firebaseMocks.getDoc,
    doc: firebaseMocks.doc,
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
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
    functions: {},
    httpsCallable: firebaseMocks.httpsCallable,
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn()
}));

vi.mock('../../js/firebase-images.js?v=10', () => ({
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
        firebaseMocks.auth.currentUser = null;
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

        const { discoverPublicTeams } = await import('../../js/db.js?v=107');

        const firstPage = await discoverPublicTeams({ searchText: 'atlanta', pageSize: 2 });

        expect(firstPage.teams.map((team) => team.id)).toEqual(['team-atl-1', 'team-atl-2']);
        expect(firebaseMocks.collection).toHaveBeenCalledWith(expect.anything(), 'publicTeamProfiles');
        expect(firebaseMocks.where).toHaveBeenCalledWith('publicSchemaVersion', '==', 1);
        expect(firebaseMocks.where).toHaveBeenCalledWith('isPublic', '==', true);
        expect(firebaseMocks.where).toHaveBeenCalledWith('active', '==', true);
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

        const { discoverPublicTeams } = await import('../../js/db.js?v=107');

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

    it('preserves browse during an upgrade with preexisting public teams and zero projection docs', async () => {
        firebaseMocks.getDocs.mockResolvedValue({ docs: [] });
        const callable = vi.fn().mockResolvedValue({
            data: {
                teams: [{ id: 'legacy-public', name: 'Legacy Public', isPublic: true, active: true }],
                nextCursor: { kind: 'public-team-callable', searchText: '', offset: 1 }
            }
        });
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { discoverPublicTeams } = await import('../../js/db.js?v=91');

        await expect(discoverPublicTeams({ pageSize: 24 })).resolves.toEqual({
            teams: [{ id: 'legacy-public', name: 'Legacy Public', isPublic: true, active: true }],
            nextCursor: { kind: 'public-team-callable', searchText: '', offset: 1 }
        });
        expect(firebaseMocks.collection).toHaveBeenCalledWith(expect.anything(), 'publicTeamProfiles');
        expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'discoverPublicTeamProfiles');
        expect(callable).toHaveBeenCalledWith({ searchText: '', cursor: null, pageSize: 24 });
    });

    it('uses the callable when projection rules are not deployed yet without masking network failures', async () => {
        const denied = Object.assign(new Error('projection rules not deployed'), { code: 'permission-denied' });
        firebaseMocks.getDocs.mockRejectedValueOnce(denied);
        const callable = vi.fn().mockResolvedValue({
            data: { teams: [{ id: 'safe-team', name: 'Safe Team', isPublic: true, active: true }], nextCursor: null }
        });
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { discoverPublicTeams } = await import('../../js/db.js?v=91');

        await expect(discoverPublicTeams()).resolves.toMatchObject({ teams: [expect.objectContaining({ id: 'safe-team' })] });

        const unavailable = Object.assign(new Error('offline'), { code: 'unavailable' });
        firebaseMocks.getDocs.mockRejectedValueOnce(unavailable);
        await expect(discoverPublicTeams()).rejects.toBe(unavailable);
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
        const { getPublicTeamRosterCount } = await import('../../js/db.js?v=107');

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
        const { getPublicTeamRosterCount } = await import('../../js/db.js?v=107');

        await expect(getPublicTeamRosterCount('team-large-roster')).resolves.toEqual({
            count: 200,
            isCapped: true
        });
    });
});

describe('public team source/projection fallback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        firebaseMocks.auth.currentUser = null;
    });

    it('reads the strict projection directly for anonymous public detail', async () => {
        firebaseMocks.getDoc.mockResolvedValue({
            id: 'team-public',
            exists: () => true,
            data: () => ({ name: 'Public Team', isPublic: true, active: true })
        });
        const { getTeam } = await import('../../js/db.js?v=91');

        await expect(getTeam('team-public')).resolves.toMatchObject({ id: 'team-public', name: 'Public Team' });
        expect(firebaseMocks.doc).toHaveBeenCalledWith(expect.anything(), 'publicTeamProfiles', 'team-public');
        expect(firebaseMocks.httpsCallable).not.toHaveBeenCalled();
    });

    it('falls back to an allow-listed callable while a projection is missing', async () => {
        firebaseMocks.getDoc.mockResolvedValue({ exists: () => false });
        const callable = vi.fn().mockResolvedValue({ data: { item: { id: 'team-public', name: 'Public Team', sport: 'Soccer' } } });
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { getTeam } = await import('../../js/db.js?v=91');

        await expect(getTeam('team-public')).resolves.toMatchObject({ id: 'team-public', name: 'Public Team', isPublic: true });
        expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'getPublicTeamProfile');
        expect(callable).toHaveBeenCalledWith({ teamId: 'team-public' });
    });

    it('preserves the missing-team null contract when the callable reports not found', async () => {
        firebaseMocks.getDoc.mockResolvedValue({ exists: () => false });
        const callable = vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'functions/not-found' }));
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { getTeam } = await import('../../js/db.js?v=91');

        await expect(getTeam('deleted-team')).resolves.toBeNull();
        expect(callable).toHaveBeenCalledWith({ teamId: 'deleted-team' });
    });

    it('falls back when projection rules lag but does not mask projection network errors', async () => {
        firebaseMocks.getDoc.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        const callable = vi.fn().mockResolvedValue({ data: { item: { id: 'team-public', name: 'Public Team' } } });
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { getTeam } = await import('../../js/db.js?v=91');

        await expect(getTeam('team-public')).resolves.toMatchObject({ id: 'team-public', name: 'Public Team' });

        const unavailable = Object.assign(new Error('offline'), { code: 'unavailable' });
        firebaseMocks.getDoc.mockRejectedValueOnce(unavailable);
        await expect(getTeam('team-public')).rejects.toBe(unavailable);
    });

    it('uses the source for an authorized manager and never masks network errors', async () => {
        firebaseMocks.auth.currentUser = { uid: 'owner-1' };
        firebaseMocks.getDoc.mockResolvedValueOnce({
            id: 'private-team',
            exists: () => true,
            data: () => ({ name: 'Private Team', isPublic: false, active: true, ownerId: 'owner-1' })
        });
        const { getTeam } = await import('../../js/db.js?v=91');
        await expect(getTeam('private-team')).resolves.toMatchObject({ name: 'Private Team', ownerId: 'owner-1' });

        const networkError = Object.assign(new Error('offline'), { code: 'unavailable' });
        firebaseMocks.getDoc.mockRejectedValueOnce(networkError);
        await expect(getTeam('public-team')).rejects.toBe(networkError);
        expect(firebaseMocks.httpsCallable).not.toHaveBeenCalled();
    });

    it('falls back for a logged-in public nonmember only on permission denial', async () => {
        firebaseMocks.auth.currentUser = { uid: 'other-1' };
        firebaseMocks.getDoc
            .mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }))
            .mockResolvedValueOnce({
                id: 'public-team',
                exists: () => true,
                data: () => ({ name: 'Public Team', isPublic: true, active: true })
            });
        const { getTeam } = await import('../../js/db.js?v=91');

        await expect(getTeam('public-team')).resolves.toMatchObject({ name: 'Public Team' });
        expect(firebaseMocks.getDoc).toHaveBeenCalledTimes(2);
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
        const { getConfigs } = await import('../../js/db.js?v=107');

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

        const { getAllUsers } = await import('../../js/db.js?v=85');
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

        const { getTeams } = await import('../../js/db.js?v=85');
        const teams = await getTeams({ includePrivate: true });

        expect(teams).toHaveLength(101);
        expect(firebaseMocks.getDocs).toHaveBeenCalledTimes(2);
        expect(firebaseMocks.limit).toHaveBeenNthCalledWith(1, 100);
        expect(firebaseMocks.limit).toHaveBeenNthCalledWith(2, 100);
        expect(firebaseMocks.startAfter).toHaveBeenCalledWith(firstPage.at(-1));
    });
});
