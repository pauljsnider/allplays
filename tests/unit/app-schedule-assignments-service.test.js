import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getAssignmentClaims: vi.fn(),
    getGames: vi.fn(),
    getPracticePacketCompletions: vi.fn(),
    getPracticeSessions: vi.fn(),
    getRsvps: vi.fn(),
    getRsvpSummaries: vi.fn(),
    getTeam: vi.fn(),
    getTrackedCalendarEventUids: vi.fn(),
    createRideOffer: vi.fn(),
    claimAssignmentSlot: vi.fn(),
    requestRideSpot: vi.fn(),
    listRideOffersForEvent: vi.fn(),
    updateRideRequestStatus: vi.fn(),
    closeRideOffer: vi.fn(),
    cancelRideRequest: vi.fn(),
    releaseAssignmentClaim: vi.fn(),
    submitRsvpForPlayer: vi.fn(),
    upsertPracticePacketCompletion: vi.fn(),
    updateGame: vi.fn()
}));

const profileMocks = vi.hoisted(() => ({
    loadProfileDocument: vi.fn(),
    saveProfileDocument: vi.fn()
}));

const authMocks = vi.hoisted(() => ({
    firebaseAuth: {
        app: {
            options: {
                projectId: 'demo-allplays'
            }
        }
    },
    getNativeAuthIdToken: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../apps/app/src/lib/profileService.ts', () => profileMocks);
vi.mock('../../apps/app/src/lib/authService.ts', () => authMocks);
vi.mock('../../js/utils.js', () => ({
    expandRecurrence: vi.fn(() => []),
    extractOpponent: vi.fn(() => 'TBD'),
    fetchAndParseCalendar: vi.fn(() => Promise.resolve([])),
    getCalendarEventTrackingId: vi.fn(() => ''),
    isPracticeEvent: vi.fn(() => false),
    isTrackedCalendarEvent: vi.fn(() => false)
}));
vi.mock('../../js/parent-dashboard-practice-sessions.js', () => ({
    filterVisiblePracticeSessions: vi.fn((sessions) => sessions || [])
}));
vi.mock('../../js/parent-dashboard-rsvp.js', () => ({
    resolveMyRsvpByChildForGame: vi.fn(() => ({}))
}));
vi.mock('../../js/availability-preferences.js', () => ({
    buildAvailabilityNoteRows: vi.fn(() => []),
    canViewAvailabilityNotes: vi.fn(() => false),
    formatAvailabilityCutoff: vi.fn(() => 'No cutoff'),
    isAvailabilityLocked: vi.fn(() => false),
    normalizeAvailabilityPreferences: vi.fn((preferences) => preferences || {})
}));
vi.mock('../../js/rideshare-helpers.js', () => ({
    getEventRideshareSummary: vi.fn(() => ({ offerCount: 0, seatsLeft: 0, requests: 0, pending: 0, confirmed: 0, isFull: false }))
}));
vi.mock('../../js/snack-helpers.js', () => ({
    mergeAssignmentsWithClaims: vi.fn((assignments = [], claims = {}) => assignments.map((assignment) => ({
        ...assignment,
        role: String(assignment.role || '').trim(),
        value: String(assignment.value || '').trim(),
        claimable: assignment.claimable === true,
        claim: assignment.claimable ? claims[String(assignment.role || '').trim()] || null : null
    })))
}));

import {
    claimParentScheduleAssignmentSlot,
    createScheduleAssignment,
    loadParentScheduleAssignments,
    removeScheduleAssignment,
    updateScheduleAssignment,
    releaseParentScheduleAssignmentClaim
} from '../../apps/app/src/lib/scheduleService.ts';

function installWindow(protocol = 'http:') {
    vi.stubGlobal('window', {
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        location: { protocol }
    });
}

function event(overrides = {}) {
    return {
        eventKey: 'team-1::game-1::player-1',
        id: 'game-1',
        teamId: 'team-1',
        teamName: 'Bears',
        type: 'game',
        date: new Date('2026-05-21T18:00:00Z'),
        location: 'Main Gym',
        opponent: 'Falcons',
        childId: 'player-1',
        childName: 'Pat',
        isDbGame: true,
        isCancelled: false,
        assignments: [
            { role: 'Snacks', value: '', claimable: true },
            { role: 'Scorebook', value: 'Jamie', claimable: false }
        ],
        ...overrides
    };
}

function user(overrides = {}) {
    return {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent'],
        ...overrides
    };
}

function encodeFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: 'NULL_VALUE' };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    if (Array.isArray(value)) return { arrayValue: { values: value.map((entry) => encodeFirestoreValue(entry)) } };
    return {
        mapValue: {
            fields: Object.keys(value).reduce((acc, key) => {
                acc[key] = encodeFirestoreValue(value[key]);
                return acc;
            }, {})
        }
    };
}

function firestoreDoc(path, data) {
    return {
        name: `projects/demo-allplays/databases/(default)/documents/${path}`,
        fields: Object.keys(data).reduce((acc, key) => {
            acc[key] = encodeFirestoreValue(data[key]);
            return acc;
        }, {})
    };
}

function restOk(payload = {}) {
    return {
        ok: true,
        status: 200,
        json: async () => payload
    };
}

function restError(status = 404, message = 'not found') {
    return {
        ok: false,
        status,
        json: async () => ({ error: { message } })
    };
}

function parseBody(call) {
    return JSON.parse(call[1]?.body || '{}');
}

let warnSpy;

beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installWindow('http:');
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
});

afterEach(() => {
    warnSpy?.mockRestore();
    vi.unstubAllGlobals();
});

describe('React app schedule assignment service integration', () => {
    it('loads, claims, and releases assignment slots through the existing Firebase helpers', async () => {
        dbMocks.getAssignmentClaims.mockResolvedValue({
            Snacks: { id: 'Snacks', claimedByUserId: 'other-parent', claimedByName: 'Taylor' }
        });
        dbMocks.claimAssignmentSlot.mockResolvedValue(undefined);
        dbMocks.releaseAssignmentClaim.mockResolvedValue(undefined);

        const loaded = await loadParentScheduleAssignments(event());
        expect(dbMocks.getAssignmentClaims).toHaveBeenCalledWith('team-1', 'game-1');
        expect(loaded).toEqual([
            expect.objectContaining({
                role: 'Snacks',
                claimable: true,
                claim: expect.objectContaining({ claimedByName: 'Taylor' })
            }),
            expect.objectContaining({
                role: 'Scorebook',
                value: 'Jamie',
                claimable: false,
                claim: null
            })
        ]);

        await claimParentScheduleAssignmentSlot(event(), user(), ' Snacks ');
        expect(dbMocks.claimAssignmentSlot).toHaveBeenCalledWith('team-1', 'game-1', 'Snacks', { name: 'Pat Parent' });

        await releaseParentScheduleAssignmentClaim(event(), ' Snacks ');
        expect(dbMocks.releaseAssignmentClaim).toHaveBeenCalledWith('team-1', 'game-1', 'Snacks');
    });

    it('loads, claims, and releases assignment slots through native Firestore REST fallback', async () => {
        installWindow('capacitor:');
        dbMocks.getAssignmentClaims.mockRejectedValue(new Error('web claims failed'));
        dbMocks.claimAssignmentSlot.mockRejectedValue(new Error('web claim failed'));
        dbMocks.releaseAssignmentClaim.mockRejectedValue(new Error('web release failed'));

        const fetchMock = vi.fn(async (url, init = {}) => {
            const href = String(url);
            const method = init.method || 'GET';
            if (method === 'GET' && href.endsWith('/teams/team-1/games/game-1/assignmentClaims')) {
                return restOk({
                    documents: [
                        firestoreDoc('teams/team-1/games/game-1/assignmentClaims/Snacks', {
                            claimedByUserId: 'other-parent',
                            claimedByName: 'Taylor'
                        })
                    ]
                });
            }
            if (method === 'GET' && href.endsWith('/teams/team-1/games/game-1/assignmentClaims/Drinks')) {
                return restError(404, 'not found');
            }
            if (method === 'PATCH' && href.includes('/teams/team-1/games/game-1/assignmentClaims/Drinks')) {
                return restOk({});
            }
            if (method === 'GET' && href.endsWith('/teams/team-1/games/game-1/assignmentClaims/Snacks')) {
                return restOk(firestoreDoc('teams/team-1/games/game-1/assignmentClaims/Snacks', {
                    claimedByUserId: 'user-1',
                    claimedByName: 'Pat Parent'
                }));
            }
            if (method === 'DELETE' && href.endsWith('/teams/team-1/games/game-1/assignmentClaims/Snacks')) {
                return restOk({});
            }
            return restError();
        });
        vi.stubGlobal('fetch', fetchMock);

        const loaded = await loadParentScheduleAssignments(event());
        expect(authMocks.getNativeAuthIdToken).toHaveBeenCalledWith(true);
        expect(loaded[0]).toMatchObject({
            role: 'Snacks',
            claim: expect.objectContaining({ id: 'Snacks', claimedByName: 'Taylor' })
        });

        await claimParentScheduleAssignmentSlot(event({ assignments: [{ role: 'Drinks', value: '', claimable: true }] }), user(), 'Drinks');
        const claimPatch = fetchMock.mock.calls.find(([url, init]) =>
            String(url).includes('/assignmentClaims/Drinks') && init?.method === 'PATCH'
        );
        expect(parseBody(claimPatch).fields).toMatchObject({
            claimedByUserId: { stringValue: 'user-1' },
            claimedByName: { stringValue: 'Pat Parent' }
        });

        await releaseParentScheduleAssignmentClaim(event(), 'Snacks');
        expect(fetchMock.mock.calls.some(([url, init]) =>
            String(url).endsWith('/teams/team-1/games/game-1/assignmentClaims/Snacks') && init?.method === 'DELETE'
        )).toBe(true);
    });

    it('normalizes static assignments without loading claims for untracked events', async () => {
        const loaded = await loadParentScheduleAssignments(event({
            isDbGame: false,
            assignments: [
                { role: ' Snacks ', value: ' ', claimable: true },
                { role: '', value: '', claimable: true },
                { role: 'Scorebook', value: ' Jamie ', claimable: false }
            ]
        }));

        expect(dbMocks.getAssignmentClaims).not.toHaveBeenCalled();
        expect(loaded).toEqual([
            expect.objectContaining({
                role: 'Snacks',
                value: '',
                claimable: true,
                claim: null
            }),
            expect.objectContaining({
                role: 'Scorebook',
                value: 'Jamie',
                claimable: false,
                claim: null
            })
        ]);
    });

    it('rejects invalid assignment actions before hitting the data layer', async () => {
        await expect(claimParentScheduleAssignmentSlot(event({ isDbGame: false }), user(), 'Snacks')).rejects.toThrow('tracked');
        await expect(claimParentScheduleAssignmentSlot(event(), user(), '   ')).rejects.toThrow('Role is required');
        await expect(claimParentScheduleAssignmentSlot(event(), user(), 'Setup / cleanup')).rejects.toThrow('unsupported characters');
        await expect(releaseParentScheduleAssignmentClaim(event({ isCancelled: true }), 'Snacks')).rejects.toThrow('cancelled');
        expect(dbMocks.claimAssignmentSlot).not.toHaveBeenCalled();
        expect(dbMocks.releaseAssignmentClaim).not.toHaveBeenCalled();
    });

    it('lets team admins create, update, and remove assignments with the legacy payload shape', async () => {
        const adminUser = user({ uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach Carter' });
        dbMocks.updateGame.mockResolvedValue(undefined);
        dbMocks.claimAssignmentSlot.mockResolvedValue(undefined);
        dbMocks.releaseAssignmentClaim.mockResolvedValue(undefined);
        dbMocks.getAssignmentClaims.mockResolvedValue({});

        const created = await createScheduleAssignment(
            event({ assignments: [], isTeamAdmin: true }),
            adminUser,
            { role: ' Snacks ', value: 'Ignored while claimable', claimable: true }
        );

        expect(dbMocks.updateGame).toHaveBeenLastCalledWith('team-1', 'game-1', {
            assignments: [{ role: 'Snacks', value: '', claimable: true }]
        });
        expect(dbMocks.releaseAssignmentClaim).toHaveBeenLastCalledWith('team-1', 'game-1', 'Snacks');
        expect(created).toEqual([
            expect.objectContaining({ role: 'Snacks', value: '', claimable: true, claim: null })
        ]);

        await claimParentScheduleAssignmentSlot(event({ assignments: created }), user(), 'Snacks');
        expect(dbMocks.claimAssignmentSlot).toHaveBeenCalledWith('team-1', 'game-1', 'Snacks', { name: 'Pat Parent' });

        dbMocks.updateGame.mockClear();
        dbMocks.releaseAssignmentClaim.mockClear();
        const updated = await updateScheduleAssignment(
            event({ assignments: created, isTeamAdmin: true }),
            adminUser,
            'Snacks',
            { role: ' Scorebook ', value: ' Jamie ', claimable: false }
        );

        expect(dbMocks.updateGame).toHaveBeenLastCalledWith('team-1', 'game-1', {
            assignments: [{ role: 'Scorebook', value: 'Jamie', claimable: false }]
        });
        expect(dbMocks.releaseAssignmentClaim).toHaveBeenCalledWith('team-1', 'game-1', 'Snacks');
        expect(dbMocks.releaseAssignmentClaim).toHaveBeenCalledWith('team-1', 'game-1', 'Scorebook');
        expect(updated).toEqual([
            expect.objectContaining({ role: 'Scorebook', value: 'Jamie', claimable: false, claim: null })
        ]);

        dbMocks.updateGame.mockClear();
        dbMocks.releaseAssignmentClaim.mockClear();
        const removed = await removeScheduleAssignment(
            event({ assignments: updated, isTeamAdmin: true }),
            adminUser,
            'Scorebook'
        );

        expect(dbMocks.updateGame).toHaveBeenLastCalledWith('team-1', 'game-1', { assignments: [] });
        expect(dbMocks.releaseAssignmentClaim).toHaveBeenLastCalledWith('team-1', 'game-1', 'Scorebook');
        expect(removed).toEqual([]);
    });

    it('clears exact-case assignment claims when an admin changes only role casing', async () => {
        const adminUser = user({ uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach Carter' });
        dbMocks.updateGame.mockResolvedValue(undefined);
        dbMocks.releaseAssignmentClaim.mockResolvedValue(undefined);
        dbMocks.getAssignmentClaims.mockResolvedValue({});

        await updateScheduleAssignment(
            event({
                assignments: [{ role: 'snacks', value: '', claimable: true }],
                isTeamAdmin: true
            }),
            adminUser,
            'snacks',
            { role: ' Snacks ', value: '', claimable: true }
        );

        expect(dbMocks.updateGame).toHaveBeenLastCalledWith('team-1', 'game-1', {
            assignments: [{ role: 'Snacks', value: '', claimable: true }]
        });
        expect(dbMocks.releaseAssignmentClaim).toHaveBeenCalledWith('team-1', 'game-1', 'snacks');
        expect(dbMocks.releaseAssignmentClaim).toHaveBeenCalledWith('team-1', 'game-1', 'Snacks');
    });

    it('rejects assignment management for non-admin event viewers', async () => {
        await expect(createScheduleAssignment(
            event({ isTeamAdmin: false }),
            user(),
            { role: 'Snacks', claimable: true }
        )).rejects.toThrow('team owners and admins');

        await expect(updateScheduleAssignment(
            event({ isTeamAdmin: false }),
            user(),
            'Snacks',
            { role: 'Snacks', claimable: true }
        )).rejects.toThrow('team owners and admins');

        expect(dbMocks.updateGame).not.toHaveBeenCalled();
    });

    it('rejects task names that cannot safely identify assignment claim documents', async () => {
        const adminUser = user({ uid: 'coach-1', email: 'coach@example.com' });

        for (const role of ['Setup / cleanup', '.', '..', '__reserved__']) {
            await expect(createScheduleAssignment(
                event({ assignments: [], isTeamAdmin: true }),
                adminUser,
                { role, claimable: true }
            )).rejects.toThrow('unsupported characters');
        }

        expect(dbMocks.updateGame).not.toHaveBeenCalled();
        expect(dbMocks.releaseAssignmentClaim).not.toHaveBeenCalled();
    });

    it('keeps legacy static task names editable even when they are not valid claim document IDs', async () => {
        const adminUser = user({ uid: 'coach-1', email: 'coach@example.com' });
        dbMocks.updateGame.mockResolvedValue(undefined);
        dbMocks.releaseAssignmentClaim.mockResolvedValue(undefined);
        dbMocks.getAssignmentClaims.mockResolvedValue({});

        await expect(updateScheduleAssignment(
            event({
                assignments: [{ role: 'Setup / cleanup', value: 'Jamie', claimable: false }],
                isTeamAdmin: true
            }),
            adminUser,
            'Setup / cleanup',
            { role: 'Setup / cleanup', value: 'Taylor', claimable: false }
        )).resolves.toEqual([
            expect.objectContaining({ role: 'Setup / cleanup', value: 'Taylor', claimable: false })
        ]);

        expect(dbMocks.updateGame).toHaveBeenCalledWith('team-1', 'game-1', {
            assignments: [{ role: 'Setup / cleanup', value: 'Taylor', claimable: false }]
        });
    });
});
