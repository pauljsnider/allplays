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
    isTeamActive: vi.fn((team) => team?.active !== false && team?.archived !== true),
    filterTeamsByActive: vi.fn((teams) => teams.filter((team) => team?.active !== false && team?.archived !== true)),
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

    it('uses the allow-listing callable as the primary browse boundary and forwards opaque cursors', async () => {
        const firstCursor = {
            kind: 'public-team-callable-v2',
            source: 'projection',
            searchText: 'atlanta',
            lastName: 'Atlanta United',
            lastId: 'team-atl-2'
        };
        const callable = vi.fn()
            .mockResolvedValueOnce({
                data: {
                    teams: [
                        { id: 'team-atl-1', name: 'Atlanta Fire', isPublic: true, active: true },
                        { id: 'team-atl-2', name: 'Atlanta United', isPublic: true, active: true }
                    ],
                    nextCursor: firstCursor
                }
            })
            .mockResolvedValueOnce({
                data: {
                    teams: [{ id: 'team-atl-3', name: 'Atlanta Wave', isPublic: true, active: true }],
                    nextCursor: null
                }
            });
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { discoverPublicTeams } = await import('../../js/db.js?v=107');

        const firstPage = await discoverPublicTeams({ searchText: ' Atlanta ', pageSize: 2 });
        expect(firstPage.teams.map((team) => team.id)).toEqual(['team-atl-1', 'team-atl-2']);
        expect(firstPage.nextCursor).toEqual(firstCursor);

        const secondPage = await discoverPublicTeams({ searchText: 'atlanta', pageSize: 2, cursor: firstCursor });
        expect(secondPage.teams.map((team) => team.id)).toEqual(['team-atl-3']);
        expect(callable).toHaveBeenNthCalledWith(1, { searchText: 'Atlanta', cursor: null, pageSize: 2 });
        expect(callable).toHaveBeenNthCalledWith(2, { searchText: 'atlanta', cursor: firstCursor, pageSize: 2 });
        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
    });

    it('clamps page size and rejects non-public or inactive callable output defensively', async () => {
        const callable = vi.fn().mockResolvedValue({
            data: {
                teams: [
                    { id: 'safe-team', name: 'Safe Team', isPublic: true, active: true },
                    { id: 'private-team', name: 'Private Team', isPublic: false, active: true },
                    { id: 'inactive-team', name: 'Inactive Team', isPublic: true, active: false }
                ],
                nextCursor: null
            }
        });
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { discoverPublicTeams } = await import('../../js/db.js?v=91');

        await expect(discoverPublicTeams({ pageSize: 1000 })).resolves.toEqual({
            teams: [{ id: 'safe-team', name: 'Safe Team', isPublic: true, active: true }],
            nextCursor: null
        });
        expect(callable).toHaveBeenCalledWith({ searchText: '', cursor: null, pageSize: 100 });
    });

    it('propagates callable failures instead of returning incomplete discovery data', async () => {
        const unavailable = Object.assign(new Error('offline'), { code: 'functions/unavailable' });
        firebaseMocks.httpsCallable.mockReturnValue(vi.fn().mockRejectedValue(unavailable));
        const { discoverPublicTeams } = await import('../../js/db.js?v=91');

        await expect(discoverPublicTeams()).rejects.toBe(unavailable);
        expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
    });

    it('continues bounded empty scan pages so sparse search matches are not reported missing', async () => {
        const scanCursor = {
            kind: 'public-team-callable-v2', source: 'projection', searchText: 'target', lastName: 'Middle', lastId: 'middle'
        };
        const callable = vi.fn()
            .mockResolvedValueOnce({ data: { teams: [], nextCursor: scanCursor } })
            .mockResolvedValueOnce({
                data: {
                    teams: [{ id: 'target', name: 'Target Team', isPublic: true, active: true }],
                    nextCursor: null
                }
            });
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { discoverPublicTeams } = await import('../../js/db.js?v=91');

        await expect(discoverPublicTeams({ searchText: 'target' })).resolves.toEqual({
            teams: [{ id: 'target', name: 'Target Team', isPublic: true, active: true }],
            nextCursor: null
        });
        expect(callable).toHaveBeenNthCalledWith(2, { searchText: 'target', cursor: scanCursor, pageSize: 24 });
    });

    it('returns a resumable cursor after the bounded empty-page continuation limit', async () => {
        const firstCursor = {
            kind: 'public-team-callable-v2', source: 'projection', searchText: 'target', lastName: 'Alpha', lastId: 'alpha'
        };
        const resumeCursor = {
            kind: 'public-team-callable-v2', source: 'projection', searchText: 'target', lastName: 'Middle', lastId: 'middle'
        };
        const callable = vi.fn()
            .mockResolvedValueOnce({ data: { teams: [], nextCursor: firstCursor } })
            .mockResolvedValueOnce({ data: { teams: [], nextCursor: resumeCursor } })
            .mockResolvedValueOnce({
                data: {
                    teams: [{ id: 'target', name: 'Target Team', isPublic: true, active: true }],
                    nextCursor: null
                }
            });
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { discoverPublicTeams } = await import('../../js/db.js?v=91');

        await expect(discoverPublicTeams({ searchText: 'target' })).resolves.toEqual({
            teams: [],
            nextCursor: resumeCursor
        });
        expect(callable).toHaveBeenCalledTimes(2);

        await expect(discoverPublicTeams({ searchText: 'target', cursor: resumeCursor })).resolves.toEqual({
            teams: [{ id: 'target', name: 'Target Team', isPublic: true, active: true }],
            nextCursor: null
        });
        expect(callable).toHaveBeenNthCalledWith(3, {
            searchText: 'target', cursor: resumeCursor, pageSize: 24
        });
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

    it('loads only bounded sanitized ICS payloads from the public calendar callable', async () => {
        const validCalendars = Array.from({ length: 12 }, (_, index) => `BEGIN:VCALENDAR\nX-ID:${index}\nEND:VCALENDAR`);
        const callable = vi.fn().mockResolvedValue({
            data: { calendars: [...validCalendars, null, { private: true }, 'not a calendar'] }
        });
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { getPublicTeamExternalCalendarIcs } = await import('../../js/db.js?v=91');

        await expect(getPublicTeamExternalCalendarIcs(' team-public ')).resolves.toEqual(validCalendars.slice(0, 10));
        expect(firebaseMocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'getPublicTeamExternalCalendarIcs');
        expect(callable).toHaveBeenCalledWith({ teamId: 'team-public' });
        await expect(getPublicTeamExternalCalendarIcs('  ')).resolves.toEqual([]);
        expect(callable).toHaveBeenCalledTimes(1);
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

    it('preserves inactive public presentation for replay-only lookups', async () => {
        firebaseMocks.getDoc.mockResolvedValue({ exists: () => false });
        const callable = vi.fn().mockResolvedValue({
            data: { item: { id: 'inactive-public', name: 'Replay Team', isPublic: true, active: false } }
        });
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { getTeam } = await import('../../js/db.js?v=91');

        await expect(getTeam('inactive-public', { includeInactive: true })).resolves.toMatchObject({
            id: 'inactive-public',
            name: 'Replay Team',
            isPublic: true,
            active: false
        });
        expect(callable).toHaveBeenCalledWith({ teamId: 'inactive-public', includeInactive: true });
    });

    it('preserves the missing-team null contract when the callable reports not found', async () => {
        firebaseMocks.getDoc.mockResolvedValue({ exists: () => false });
        const callable = vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { code: 'functions/not-found' }));
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { getTeam } = await import('../../js/db.js?v=91');

        await expect(getTeam('deleted-team')).resolves.toBeNull();
        expect(callable).toHaveBeenCalledWith({ teamId: 'deleted-team' });
    });

    it('falls back to callable-only nested presentation without masking projection network errors', async () => {
        firebaseMocks.getDoc.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
        const callable = vi.fn().mockResolvedValue({
            data: {
                item: {
                    id: 'team-public',
                    name: 'Public Team',
                    standingsConfig: { enabled: true },
                    tournament: { pools: [{ name: 'Pool A' }] }
                }
            }
        });
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { getTeam } = await import('../../js/db.js?v=91');

        await expect(getTeam('team-public')).resolves.toMatchObject({
            id: 'team-public',
            name: 'Public Team',
            standingsConfig: { enabled: true },
            tournament: { pools: [{ name: 'Pool A' }] }
        });

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

    it('returns an explicit placeholder only when parent-link normalization must preserve denied private scope', async () => {
        firebaseMocks.auth.currentUser = { uid: 'parent-1' };
        firebaseMocks.getDoc
            .mockRejectedValueOnce(Object.assign(new Error('private team source denied'), { code: 'permission-denied' }))
            .mockResolvedValueOnce({ exists: () => false });
        const callable = vi.fn().mockRejectedValue(Object.assign(new Error('not public'), { code: 'functions/not-found' }));
        firebaseMocks.httpsCallable.mockReturnValue(callable);
        const { getTeam } = await import('../../js/db.js?v=91');

        await expect(getTeam('private-team', {
            includeInactive: true,
            preservePermissionDenied: true
        })).resolves.toEqual({
            id: 'private-team',
            active: true,
            blockedByPermissions: true
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

    it('continues callable public-team pages past 1000 results', async () => {
        const callable = vi.fn();
        for (let pageIndex = 0; pageIndex < 11; pageIndex += 1) {
            const resultCount = pageIndex < 10 ? 100 : 1;
            const start = pageIndex * 100;
            callable.mockResolvedValueOnce({
                data: {
                    teams: Array.from({ length: resultCount }, (_, index) => ({
                        id: `public-${start + index + 1}`,
                        name: `Public ${String(start + index + 1).padStart(4, '0')}`,
                        isPublic: true,
                        active: true
                    })),
                    nextCursor: pageIndex < 10
                        ? {
                            kind: 'public-team-callable-v2',
                            source: 'projection',
                            lastId: `public-${start + resultCount}`
                        }
                        : null
                }
            });
        }
        firebaseMocks.httpsCallable.mockReturnValue(callable);

        const { getTeams } = await import('../../js/db.js?v=85');
        const teams = await getTeams({ publicOnly: true });

        expect(teams).toHaveLength(1001);
        expect(callable).toHaveBeenCalledTimes(11);
        expect(callable.mock.calls.at(-1)?.[0]?.cursor).toMatchObject({ lastId: 'public-1000' });
    });
});
