import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getAssignmentClaims: vi.fn(),
    getGames: vi.fn(),
    getPracticePacketCompletions: vi.fn(),
    getPracticeSessions: vi.fn(),
    getRsvps: vi.fn(),
    getRsvpSummaries: vi.fn(),
    getTeam: vi.fn(),
    getTeams: vi.fn(),
    updateTeam: vi.fn(),
    addGame: vi.fn(),
    addPractice: vi.fn(),
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

const utilsMocks = vi.hoisted(() => ({
    expandRecurrence: vi.fn(() => []),
    extractOpponent: vi.fn((summary) => String(summary || '').replace(/^.*vs\.?\s*/i, '') || 'TBD'),
    fetchAndParseCalendar: vi.fn(),
    getCalendarEventTrackingId: vi.fn((event) => event.uid || ''),
    isPracticeEvent: vi.fn((summary) => /practice/i.test(String(summary || ''))),
    isTrackedCalendarEvent: vi.fn(() => false)
}));

const rsvpMocks = vi.hoisted(() => ({
    resolveMyRsvpByChildForGame: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../apps/app/src/lib/profileService.ts', () => profileMocks);
vi.mock('../../apps/app/src/lib/authService.ts', () => authMocks);
vi.mock('../../js/utils.js', () => utilsMocks);
vi.mock('../../js/parent-dashboard-practice-sessions.js', () => ({
    filterVisiblePracticeSessions: vi.fn((sessions) => sessions || [])
}));
vi.mock('../../js/parent-dashboard-packets.js', () => ({
    buildPracticePacketCompletionPayload: vi.fn(({ currentUserId, currentUser, childId, childName }) => ({
        parentUserId: currentUserId,
        parentName: currentUser.displayName || currentUser.email,
        childId,
        childName
    }))
}));
vi.mock('../../js/parent-dashboard-rsvp.js', () => rsvpMocks);
vi.mock('../../js/availability-preferences.js', () => ({
    buildAvailabilityNoteRows: vi.fn((rsvps) => rsvps
        .filter((rsvp) => rsvp.note)
        .map((rsvp) => ({
            displayName: rsvp.displayName || 'Parent',
            response: rsvp.response,
            note: rsvp.note
        }))),
    canViewAvailabilityNotes: vi.fn((preferences) => preferences?.noteVisibility === 'team'),
    formatAvailabilityCutoff: vi.fn(() => 'No cutoff'),
    isAvailabilityLocked: vi.fn(() => false),
    normalizeAvailabilityPreferences: vi.fn((preferences) => preferences || {})
}));
vi.mock('../../js/rideshare-helpers.js', () => ({
    getEventRideshareSummary: vi.fn((offers = []) => {
        const openOffers = offers.filter((offer) => offer.status !== 'closed' && offer.status !== 'cancelled');
        const totals = openOffers.reduce((acc, offer) => {
            const requests = Array.isArray(offer.requests) ? offer.requests : [];
            acc.seatsLeft += Math.max(0, Number(offer.seatCapacity || 0) - Number(offer.seatCountConfirmed || 0));
            acc.requests += requests.length;
            acc.pending += requests.filter((request) => !['confirmed', 'waitlisted', 'declined'].includes(request.status)).length;
            acc.confirmed += requests.filter((request) => request.status === 'confirmed').length;
            return acc;
        }, { seatsLeft: 0, requests: 0, pending: 0, confirmed: 0 });
        return {
            offerCount: openOffers.length,
            seatsLeft: totals.seatsLeft,
            requests: totals.requests,
            pending: totals.pending,
            confirmed: totals.confirmed,
            isFull: openOffers.length > 0 && totals.seatsLeft === 0
        };
    })
}));
vi.mock('../../js/snack-helpers.js', () => ({
    mergeAssignmentsWithClaims: vi.fn((assignments = [], claims = {}) => assignments.map((assignment) => {
        const role = String(assignment.role || '').trim();
        return {
            ...assignment,
            role,
            value: String(assignment.value || '').trim(),
            claimable: assignment.claimable === true,
            claim: assignment.claimable ? claims[role] || null : null
        };
    }))
}));

import { addTeamCalendarUrl, createScheduleImportGame, createScheduleImportPractice, loadParentSchedule } from '../../apps/app/src/lib/scheduleService.ts';

function installWindow(protocol = 'http:') {
    vi.stubGlobal('window', {
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        location: { protocol }
    });
}

function user() {
    return {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent'],
        parentOf: [
            { teamId: 'team-1', playerId: 'player-from-user', playerName: 'User fallback', teamName: 'Bears' }
        ]
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    installWindow();
    profileMocks.loadProfileDocument.mockResolvedValue({
        parentOf: [
            { teamId: 'team-1', playerId: 'player-1', playerName: 'Pat', teamName: 'Bears' },
            { teamId: 'team-1', childId: 'player-2', childName: 'Sam', teamName: 'Bears' },
            { teamId: 'team-1', playerId: 'player-1', playerName: 'Pat duplicate', teamName: 'Bears' }
        ]
    });
    dbMocks.getTeam.mockResolvedValue({
        id: 'team-1',
        name: 'Bears',
        calendarUrls: ['mock://team-calendar'],
        availabilityPreferences: { noteVisibility: 'team' }
    });
    dbMocks.getTeams.mockResolvedValue([]);
    dbMocks.getGames.mockResolvedValue([
        {
            id: 'game-1',
            type: 'game',
            date: new Date('2026-05-21T18:00:00Z'),
            endDate: new Date('2026-05-21T19:30:00Z'),
            location: 'Main Gym',
            opponent: 'Falcons',
            status: 'scheduled',
            seasonLabel: 'Spring 2026',
            competitionType: 'league',
            assignments: [
                { role: 'Snacks', value: '', claimable: true },
                { role: 'Scorebook', value: 'Jamie', claimable: false }
            ]
        },
        {
            id: 'practice-1',
            type: 'practice',
            title: 'Practice',
            date: new Date('2026-05-22T19:00:00Z'),
            location: 'North Field',
            status: 'scheduled'
        },
        {
            id: 'cancelled-1',
            type: 'game',
            date: new Date('2026-05-23T18:00:00Z'),
            location: 'Rain Field',
            opponent: 'Storm',
            status: 'cancelled'
        },
        {
            id: 'final-1',
            type: 'game',
            date: new Date('2026-05-10T18:00:00Z'),
            location: 'Main Gym',
            opponent: 'Owls',
            status: 'final',
            liveStatus: 'completed',
            liveClockMs: 494000,
            liveClockRunning: false,
            liveClockPeriod: 'Q2',
            liveClockUpdatedAt: new Date('2026-05-28T07:10:00Z'),
            homeScore: 4,
            awayScore: 2
        }
    ]);
    dbMocks.getPracticeSessions.mockResolvedValue([
        {
            id: 'session-1',
            eventId: 'practice-1',
            date: new Date('2026-05-22T19:00:00Z'),
            location: 'North Field',
            homePacketContent: {
                totalMinutes: 20,
                blocks: [
                    { type: 'Drill', duration: 10, drillTitle: 'Ball Mastery' },
                    { type: 'Drill', duration: 10, drillTitle: 'Passing Wall' }
                ]
            },
            attendance: {
                players: [
                    { playerId: 'player-1', status: 'present' },
                    { playerId: 'player-2', status: 'late' }
                ]
            }
        }
    ]);
    dbMocks.getTrackedCalendarEventUids.mockResolvedValue([]);
    utilsMocks.fetchAndParseCalendar.mockResolvedValue([
        {
            uid: 'ics-game-1',
            summary: 'Bears vs Eagles',
            dtstart: new Date('2026-05-24T18:00:00Z'),
            dtend: new Date('2026-05-24T19:00:00Z'),
            location: 'Imported Field',
            status: 'CONFIRMED'
        }
    ]);
    dbMocks.getRsvpSummaries.mockResolvedValue(new Map([
        ['game-1', { going: 1, maybe: 1, notGoing: 0, notResponded: 0, total: 2 }],
        ['practice-1', { going: 0, maybe: 0, notGoing: 0, notResponded: 2, total: 2 }],
        ['final-1', { going: 2, maybe: 0, notGoing: 0, notResponded: 0, total: 2 }]
    ]));
    dbMocks.getRsvps.mockImplementation(async (teamId, gameId) => {
        if (gameId !== 'game-1') return [];
        return [
            {
                id: 'user-1__player-1',
                userId: 'user-1',
                displayName: 'Pat Parent',
                playerIds: ['player-1'],
                response: 'going',
                note: 'Needs a ride home',
                updatedAt: new Date('2026-05-20T12:00:00Z')
            },
            {
                id: 'user-1__player-2',
                userId: 'user-1',
                displayName: 'Pat Parent',
                playerIds: ['player-2'],
                response: 'maybe',
                note: 'Late arrival',
                updatedAt: new Date('2026-05-20T12:05:00Z')
            }
        ];
    });
    rsvpMocks.resolveMyRsvpByChildForGame.mockImplementation((events, teamId, gameId) => {
        if (gameId === 'game-1') {
            return { 'player-1': 'going', 'player-2': 'maybe' };
        }
        return {};
    });
    dbMocks.listRideOffersForEvent.mockImplementation(async (teamId, gameId) => {
        if (gameId !== 'game-1') return [];
        return [
            {
                id: 'ride-1',
                driverUserId: 'driver-1',
                driverName: 'Dana Driver',
                seatCapacity: 3,
                seatCountConfirmed: 1,
                direction: 'to',
                status: 'open',
                requests: [
                    { id: 'request-1', parentUserId: 'user-1', childId: 'player-1', status: 'pending' }
                ]
            }
        ];
    });
    dbMocks.getAssignmentClaims.mockImplementation(async (teamId, gameId) => {
        if (gameId !== 'game-1') return {};
        return {
            Snacks: { id: 'Snacks', claimedByUserId: 'other-parent', claimedByName: 'Taylor' }
        };
    });
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('React app schedule service contract integration', () => {
    it('loads parent schedule data through existing site contracts without duplicating schemas', async () => {
        const result = await loadParentSchedule(user());

        expect(profileMocks.loadProfileDocument).toHaveBeenCalledWith('user-1');
        expect(dbMocks.getTeam).toHaveBeenCalledWith('team-1');
        expect(dbMocks.getGames).toHaveBeenCalledWith('team-1');
        expect(dbMocks.getPracticeSessions).toHaveBeenCalledWith('team-1');
        expect(utilsMocks.fetchAndParseCalendar).toHaveBeenCalledWith('mock://team-calendar');
        expect(dbMocks.getRsvpSummaries).toHaveBeenCalledWith('team-1', expect.arrayContaining(['game-1', 'practice-1', 'final-1']));
        expect(dbMocks.listRideOffersForEvent).toHaveBeenCalledWith('team-1', 'game-1', { fallbackGameIds: [] });
        expect(dbMocks.getAssignmentClaims).toHaveBeenCalledWith('team-1', 'game-1');

        expect(result.children).toEqual([
            { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' },
            { teamId: 'team-1', teamName: 'Bears', playerId: 'player-2', playerName: 'Sam' }
        ]);

        const patGame = result.events.find((event) => event.id === 'game-1' && event.childId === 'player-1');
        const samGame = result.events.find((event) => event.id === 'game-1' && event.childId === 'player-2');
        expect(patGame).toMatchObject({
            teamName: 'Bears',
            opponent: 'Falcons',
            myRsvp: 'going',
            myRsvpNote: 'Needs a ride home',
            rsvpSummary: { going: 1, maybe: 1, notGoing: 0, notResponded: 0, total: 2 },
            rideshareSummary: { offerCount: 1, seatsLeft: 2, requests: 1, pending: 1, confirmed: 0, isFull: false }
        });
        expect(patGame.assignments).toEqual([
            expect.objectContaining({ role: 'Snacks', claim: expect.objectContaining({ claimedByName: 'Taylor' }) }),
            expect.objectContaining({ role: 'Scorebook', value: 'Jamie', claimable: false })
        ]);
        expect(samGame).toMatchObject({
            myRsvp: 'maybe',
            myRsvpNote: 'Late arrival'
        });

        const practice = result.events.find((event) => event.id === 'practice-1' && event.childId === 'player-1');
        expect(practice).toMatchObject({
            type: 'practice',
            practiceSessionId: 'session-1',
            practiceAttendanceSummary: '2/2 present, 1 late',
            practiceHomePacketSummary: '2 drills · 20 min'
        });
        expect(practice.practiceHomePacket.blocks).toHaveLength(2);

        const cancelled = result.events.find((event) => event.id === 'cancelled-1' && event.childId === 'player-1');
        expect(cancelled).toMatchObject({
            isCancelled: true,
            opponent: 'Storm',
            myRsvp: 'not_responded'
        });

        const final = result.events.find((event) => event.id === 'final-1' && event.childId === 'player-1');
        expect(final).toMatchObject({
            status: 'final',
            liveStatus: 'completed',
            liveClockMs: 494000,
            liveClockRunning: false,
            liveClockPeriod: 'Q2',
            liveClockUpdatedAt: new Date('2026-05-28T07:10:00Z'),
            homeScore: 4,
            awayScore: 2
        });

        const imported = result.events.find((event) => event.id === 'ics-game-1' && event.childId === 'player-1');
        expect(imported).toMatchObject({
            isDbGame: false,
            isImported: true,
            sourceType: 'calendar',
            sourceLabel: 'Imported calendar',
            opponent: 'Eagles',
            location: 'Imported Field'
        });
    });

    it('falls back to user parent links when the profile has not hydrated yet', async () => {
        profileMocks.loadProfileDocument.mockResolvedValue({});

        const result = await loadParentSchedule(user());

        expect(result.children).toEqual([
            { teamId: 'team-1', teamName: 'Bears', playerId: 'player-from-user', playerName: 'User fallback' }
        ]);
        expect(result.events.some((event) => event.childId === 'player-from-user')).toBe(true);
        expect(result.events.some((event) => event.childId === 'player-1')).toBe(false);
    });

    it('does not surface parent-linked schedules for archived teams', async () => {
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', archived: true });

        const result = await loadParentSchedule(user());

        expect(dbMocks.getTeam).toHaveBeenCalledWith('team-1');
        expect(result.children).toEqual([
            { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' },
            { teamId: 'team-1', teamName: 'Bears', playerId: 'player-2', playerName: 'Sam' }
        ]);
        expect(result.events).toEqual([]);
    });

    it('applies the active-team policy to native REST team fallback reads', async () => {
        installWindow('capacitor:');
        dbMocks.getTeam.mockRejectedValue(new Error('web team read unavailable'));
        authMocks.getNativeAuthIdToken.mockResolvedValue('native-token');
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({
                name: 'projects/demo-allplays/databases/(default)/documents/teams/team-1',
                fields: {
                    name: { stringValue: 'Bears' },
                    status: { stringValue: 'archived' }
                }
            })
        })));

        const result = await loadParentSchedule(user());

        expect(fetch).toHaveBeenCalledWith(
            'https://firestore.googleapis.com/v1/projects/demo-allplays/databases/(default)/documents/teams/team-1',
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer native-token' })
            })
        );
        expect(result.events).toEqual([]);
    });

    it('adds a new staff calendar URL and avoids duplicates', async () => {
        dbMocks.getTeam.mockResolvedValue({
            id: 'team-1',
            name: 'Bears',
            ownerId: 'user-1',
            calendarUrls: ['https://example.com/existing.ics']
        });

        const added = await addTeamCalendarUrl('team-1', '  https://example.com/new.ics  ', user());

        expect(added).toEqual({
            added: true,
            calendarUrls: ['https://example.com/existing.ics', 'https://example.com/new.ics']
        });
        expect(dbMocks.updateTeam).toHaveBeenCalledWith('team-1', {
            calendarUrls: ['https://example.com/existing.ics', 'https://example.com/new.ics']
        });

        dbMocks.updateTeam.mockClear();
        const duplicate = await addTeamCalendarUrl('team-1', 'https://example.com/existing.ics', user());

        expect(duplicate).toEqual({
            added: false,
            calendarUrls: ['https://example.com/existing.ics']
        });
        expect(dbMocks.updateTeam).not.toHaveBeenCalled();
    });

    it('fails closed when adding a calendar URL without team staff access', async () => {
        dbMocks.getTeam.mockResolvedValue({
            id: 'team-1',
            name: 'Bears',
            ownerId: 'owner-2',
            adminEmails: [],
            calendarUrls: []
        });

        await expect(addTeamCalendarUrl('team-1', 'https://example.com/team.ics', user()))
            .rejects.toThrow('You do not have permission to manage this team schedule.');
        expect(dbMocks.updateTeam).not.toHaveBeenCalled();
    });

    it('creates CSV import games and practices only for staff users', async () => {
        dbMocks.getTeam.mockResolvedValue({
            id: 'team-1',
            name: 'Bears',
            ownerId: 'coach-1',
            adminEmails: []
        });
        dbMocks.addGame.mockResolvedValue('game-new');
        dbMocks.addPractice.mockResolvedValue('practice-new');
        const coach = { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach' };

        await expect(createScheduleImportGame('team-1', {
            eventType: 'game',
            startsAt: '2026-04-02T18:30',
            endsAt: '2026-04-02T20:00',
            opponent: 'Tigers',
            location: 'Field 1',
            arrivalTime: '2026-04-02T17:45',
            isHome: false,
            notes: 'Bring white kit'
        }, coach)).resolves.toBe('game-new');

        expect(dbMocks.addGame).toHaveBeenCalledWith('team-1', expect.objectContaining({
            type: 'game',
            opponent: 'Tigers',
            location: 'Field 1',
            isHome: false,
            status: 'scheduled',
            homeScore: 0,
            awayScore: 0,
            createdBy: 'coach-1'
        }));
        expect(dbMocks.addGame.mock.calls[0][1].date).toBeInstanceOf(Date);
        expect(dbMocks.addGame.mock.calls[0][1].arrivalTime).toBeInstanceOf(Date);

        await expect(createScheduleImportPractice('team-1', {
            eventType: 'practice',
            startsAt: '2026-04-04T07:00',
            endsAt: '2026-04-04T08:30',
            title: 'Speed Session',
            location: 'Field 2',
            arrivalTime: null,
            notes: 'Bring water'
        }, coach)).resolves.toBe('practice-new');

        expect(dbMocks.addPractice).toHaveBeenCalledWith('team-1', expect.objectContaining({
            type: 'practice',
            title: 'Speed Session',
            opponent: null,
            status: 'scheduled',
            createdBy: 'coach-1'
        }));

        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', ownerId: 'other-user', adminEmails: [] });
        await expect(createScheduleImportGame('team-1', {
            eventType: 'game',
            startsAt: '2026-04-02T18:30',
            opponent: 'Tigers'
        }, { uid: 'parent-1', email: 'parent@example.com' })).rejects.toThrow('permission');
    });

});
