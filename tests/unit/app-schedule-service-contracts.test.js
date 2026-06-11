import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getAssignmentClaims: vi.fn(),
    getGame: vi.fn(),
    getGames: vi.fn(),
    getPlayers: vi.fn(),
    getPracticePacketCompletions: vi.fn(),
    getPracticeSessionByEvent: vi.fn(),
    getPracticeSessions: vi.fn(),
    getRsvps: vi.fn(),
    getRsvpSummaries: vi.fn(),
    getTeam: vi.fn(),
    getTeams: vi.fn(),
    updateTeam: vi.fn(),
    addGame: vi.fn(),
    addPractice: vi.fn(),
    cancelOccurrence: vi.fn(),
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
vi.mock('../../apps/app/src/lib/chatService.ts', () => ({
    sendTeamChatMessage: vi.fn()
}));
vi.mock('../../apps/app/src/lib/chatLogic.ts', () => ({
    DEFAULT_TEAM_CONVERSATION_ID: 'team'
}));
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

import { addTeamCalendarUrl, cancelPracticeOccurrenceForApp, createScheduleImportGame, createScheduleImportPractice, createStaffRsvpReminderPreviewLoader, loadParentPlayerSchedule, loadParentSchedule, loadParentScheduleEventDetail, parseRecurringPracticeOccurrenceId, removeTeamCalendarUrl } from '../../apps/app/src/lib/scheduleService.ts';
import { getScheduleForecastHref, getScheduleMapHref } from '../../apps/app/src/lib/scheduleLogic.ts';

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
        notificationEmail: 'team-notify@example.com',
        calendarUrls: ['mock://team-calendar'],
        availabilityPreferences: { noteVisibility: 'team' }
    });
    dbMocks.getGame.mockResolvedValue(null);
    dbMocks.getTeams.mockResolvedValue([]);
    dbMocks.getPlayers.mockResolvedValue([]);
    dbMocks.getGames.mockResolvedValue([
        {
            id: 'game-1',
            type: 'game',
            date: new Date('2026-05-21T18:00:00Z'),
            endDate: new Date('2026-05-21T19:30:00Z'),
            location: 'Main Gym',
            opponent: 'Falcons',
            opponentTeamId: 'team-2',
            sharedScheduleOpponentTeamId: 'team-2',
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
    dbMocks.getPracticeSessionByEvent.mockResolvedValue(null);
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
        expect(dbMocks.getGames).toHaveBeenCalledTimes(1);
        expect(dbMocks.getTrackedCalendarEventUids).not.toHaveBeenCalled();
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
            opponentTeamId: 'team-2',
            sharedScheduleOpponentTeamId: 'team-2',
            counterpartTitle: 'vs. Bears',
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

    it('loads one linked player schedule without a cross-team fan-out', async () => {
        dbMocks.getTeams.mockResolvedValue([
            { id: 'team-staff-1', name: 'Staff Team 1', ownerId: 'user-1' },
            { id: 'team-staff-2', name: 'Staff Team 2', ownerId: 'user-1' }
        ]);

        const result = await loadParentPlayerSchedule(user(), { teamId: 'team-1', playerId: 'player-1' });

        expect(profileMocks.loadProfileDocument).toHaveBeenCalledWith('user-1');
        expect(dbMocks.getTeams).not.toHaveBeenCalled();
        expect(dbMocks.getTeam).toHaveBeenCalledTimes(1);
        expect(dbMocks.getTeam).toHaveBeenCalledWith('team-1');
        expect(dbMocks.getGames).toHaveBeenCalledTimes(1);
        expect(dbMocks.getGames).toHaveBeenCalledWith('team-1');
        expect(dbMocks.getPracticeSessions).toHaveBeenCalledTimes(1);
        expect(dbMocks.getPracticeSessions).toHaveBeenCalledWith('team-1');
        expect(result.children).toEqual([
            { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' },
            { teamId: 'team-1', teamName: 'Bears', playerId: 'player-2', playerName: 'Sam' }
        ]);
        expect(new Set(result.events.map((event) => event.childId))).toEqual(new Set(['player-1']));
        expect(result.events.every((event) => event.teamId === 'team-1')).toBe(true);
    });

    it('lets staff load a roster player detail without expanding every staff team', async () => {
        profileMocks.loadProfileDocument.mockResolvedValue({ parentOf: [] });
        dbMocks.getTeam.mockResolvedValue({
            id: 'team-1',
            name: 'Bears',
            ownerId: 'coach-1',
            calendarUrls: ['mock://team-calendar'],
            availabilityPreferences: { noteVisibility: 'team' }
        });
        dbMocks.getPlayers.mockResolvedValue([
            { id: 'player-1', name: 'Pat', active: true },
            { id: 'player-2', name: 'Sam', active: true }
        ]);

        const result = await loadParentPlayerSchedule({
            ...user(),
            uid: 'coach-1',
            email: 'coach@example.com',
            parentOf: [],
            coachOf: ['team-1']
        }, { teamId: 'team-1', playerId: 'player-2' });

        expect(dbMocks.getTeams).not.toHaveBeenCalled();
        expect(dbMocks.getTeam).toHaveBeenCalledWith('team-1');
        expect(dbMocks.getPlayers).toHaveBeenCalledTimes(1);
        expect(dbMocks.getPlayers).toHaveBeenCalledWith('team-1', { includeInactive: true });
        expect(result.children).toEqual([
            { teamId: 'team-1', teamName: 'Bears', playerId: 'player-2', playerName: 'Sam' }
        ]);
        expect(new Set(result.events.map((event) => event.childId))).toEqual(new Set(['player-2']));
        expect(result.events.every((event) => event.teamId === 'team-1')).toBe(true);
    });

    it('loads schedule event detail without expanding the full team schedule', async () => {
        dbMocks.getGame.mockResolvedValue({
            id: 'game-1',
            type: 'game',
            date: new Date('2026-05-21T18:00:00Z'),
            endDate: new Date('2026-05-21T19:30:00Z'),
            location: 'Main Gym',
            opponent: 'Falcons',
            opponentTeamId: 'team-2',
            sharedScheduleOpponentTeamId: 'team-2',
            status: 'scheduled',
            seasonLabel: 'Spring 2026',
            competitionType: 'league',
            assignments: [
                { role: 'Snacks', value: '', claimable: true },
                { role: 'Scorebook', value: 'Jamie', claimable: false }
            ]
        });

        const result = await loadParentScheduleEventDetail(user(), { teamId: 'team-1', eventId: 'game-1' });

        expect(dbMocks.getTeam).toHaveBeenCalledWith('team-1');
        expect(dbMocks.getGame).toHaveBeenCalledWith('team-1', 'game-1');
        expect(dbMocks.getGames).not.toHaveBeenCalled();
        expect(dbMocks.getPracticeSessions).not.toHaveBeenCalled();
        expect(utilsMocks.fetchAndParseCalendar).not.toHaveBeenCalled();
        expect(dbMocks.getPracticeSessionByEvent).not.toHaveBeenCalled();
        expect(dbMocks.getRsvpSummaries).toHaveBeenCalledWith('team-1', ['game-1']);
        expect(dbMocks.getRsvps).toHaveBeenCalledTimes(1);
        expect(dbMocks.getRsvps).toHaveBeenCalledWith('team-1', 'game-1');
        expect(dbMocks.listRideOffersForEvent).toHaveBeenCalledTimes(1);
        expect(dbMocks.listRideOffersForEvent).toHaveBeenCalledWith('team-1', 'game-1', { fallbackGameIds: [] });
        expect(dbMocks.getAssignmentClaims).toHaveBeenCalledTimes(1);
        expect(dbMocks.getAssignmentClaims).toHaveBeenCalledWith('team-1', 'game-1');

        expect(result.events).toHaveLength(2);
        expect(result.events.every((event) => event.id === 'game-1')).toBe(true);
        expect(result.events.find((event) => event.childId === 'player-1')).toMatchObject({
            myRsvp: 'going',
            myRsvpNote: 'Needs a ride home',
            teamNotificationEmail: 'team-notify@example.com',
            rideshareSummary: { offerCount: 1, seatsLeft: 2, requests: 1, pending: 1, confirmed: 0, isFull: false }
        });
        expect(result.events.find((event) => event.childId === 'player-2')).toMatchObject({
            myRsvp: 'maybe',
            myRsvpNote: 'Late arrival'
        });
    });

    it('keeps staff event detail on the lightweight team child by default', async () => {
        profileMocks.loadProfileDocument.mockResolvedValue({ parentOf: [] });
        dbMocks.getGame.mockResolvedValue({
            id: 'game-1',
            type: 'game',
            date: new Date('2026-05-21T18:00:00Z'),
            location: 'Main Gym',
            opponent: 'Falcons',
            status: 'scheduled'
        });

        const result = await loadParentScheduleEventDetail({
            ...user(),
            parentOf: [],
            coachOf: ['team-1']
        }, { teamId: 'team-1', eventId: 'game-1' });

        expect(dbMocks.getPlayers).not.toHaveBeenCalled();
        expect(dbMocks.getGames).not.toHaveBeenCalled();
        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toMatchObject({
            id: 'game-1',
            childId: 'staff-team-team-1',
            childName: 'Team schedule',
            teamNotificationEmail: 'team-notify@example.com'
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

    it('removes one staff calendar URL and is idempotent when absent', async () => {
        dbMocks.getTeam.mockResolvedValue({
            id: 'team-1',
            name: 'Bears',
            ownerId: 'user-1',
            calendarUrls: ['https://example.com/remove.ics', 'https://example.com/keep.ics']
        });

        const removed = await removeTeamCalendarUrl('team-1', ' https://example.com/remove.ics ', user());

        expect(removed).toEqual({
            removed: true,
            calendarUrls: ['https://example.com/keep.ics']
        });
        expect(dbMocks.updateTeam).toHaveBeenCalledWith('team-1', {
            calendarUrls: ['https://example.com/keep.ics']
        });

        dbMocks.updateTeam.mockClear();
        const absent = await removeTeamCalendarUrl('team-1', 'https://example.com/missing.ics', user());

        expect(absent).toEqual({
            removed: false,
            calendarUrls: ['https://example.com/remove.ics', 'https://example.com/keep.ics']
        });
        expect(dbMocks.updateTeam).not.toHaveBeenCalled();
    });

    it('persists removed staff calendar URLs through the native Firestore patch path', async () => {
        installWindow('capacitor:');
        authMocks.getNativeAuthIdToken.mockResolvedValue('native-token');
        dbMocks.getTeam.mockResolvedValue({
            id: 'team-1',
            name: 'Bears',
            ownerId: 'user-1',
            calendarUrls: ['https://example.com/remove.ics', 'https://example.com/keep.ics']
        });
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({})
        });
        vi.stubGlobal('fetch', fetchMock);

        await expect(removeTeamCalendarUrl('team-1', 'https://example.com/remove.ics', user()))
            .resolves.toMatchObject({ removed: true, calendarUrls: ['https://example.com/keep.ics'] });

        expect(dbMocks.updateTeam).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledWith(
            'https://firestore.googleapis.com/v1/projects/demo-allplays/databases/(default)/documents/teams/team-1?updateMask.fieldPaths=calendarUrls',
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({
                    fields: {
                        calendarUrls: {
                            arrayValue: {
                                values: [{ stringValue: 'https://example.com/keep.ics' }]
                            }
                        }
                    }
                })
            })
        );
    });

    it('reuses the team roster across staff RSVP reminder preview loads', async () => {
        dbMocks.getPlayers.mockResolvedValue([
            { id: 'player-1', name: 'Pat', active: true, parents: [{ email: 'pat@example.com' }] },
            { id: 'player-2', name: 'Sam', active: true, parents: [{ email: 'sam@example.com' }] }
        ]);
        dbMocks.getRsvps
            .mockResolvedValueOnce([{ playerId: 'player-1', response: 'going' }])
            .mockResolvedValueOnce([{ playerId: 'player-2', response: 'going' }]);

        const loader = createStaffRsvpReminderPreviewLoader();
        const manager = { uid: 'coach-1', email: 'coach@example.com' };
        const eventBase = {
            teamId: 'team-1',
            teamName: 'Bears',
            type: 'game',
            date: new Date('2026-05-21T18:00:00Z'),
            location: 'Main Gym',
            opponent: 'Falcons',
            title: 'vs. Falcons',
            childId: '',
            childName: '',
            isDbGame: true,
            isCancelled: false,
            status: 'scheduled',
            homeScore: null,
            awayScore: null,
            assignments: [],
            isTeamStaff: true,
            isTeamRsvpReminderManager: true
        };

        const [firstPreview, secondPreview] = await Promise.all([
            loader.loadPreview({ ...eventBase, id: 'game-1', eventKey: 'team-1:game-1' }, manager),
            loader.loadPreview({ ...eventBase, id: 'game-2', eventKey: 'team-1:game-2', opponent: 'Tigers', title: 'vs. Tigers' }, manager)
        ]);

        expect(dbMocks.getPlayers).toHaveBeenCalledTimes(1);
        expect(dbMocks.getPlayers).toHaveBeenCalledWith('team-1', { includeInactive: true });
        expect(dbMocks.getRsvps).toHaveBeenCalledTimes(2);
        expect(firstPreview.missingPlayerCount).toBe(1);
        expect(secondPreview.missingPlayerCount).toBe(1);
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

    it('fails closed when removing a calendar URL without team staff access', async () => {
        dbMocks.getTeam.mockResolvedValue({
            id: 'team-1',
            name: 'Bears',
            ownerId: 'owner-2',
            adminEmails: [],
            calendarUrls: ['https://example.com/team.ics']
        });

        await expect(removeTeamCalendarUrl('team-1', 'https://example.com/team.ics', user()))
            .rejects.toThrow('You do not have permission to manage this team schedule.');
        expect(dbMocks.updateTeam).not.toHaveBeenCalled();
    });

    it('parses recurring practice occurrence ids and rejects non-occurrence ids', () => {
        expect(parseRecurringPracticeOccurrenceId('practice-master__2026-06-05')).toEqual({
            masterId: 'practice-master',
            instanceDate: '2026-06-05'
        });
        expect(parseRecurringPracticeOccurrenceId('practice-master')).toBeNull();
        expect(parseRecurringPracticeOccurrenceId('practice-master__bad-date')).toBeNull();
    });

    it('cancels a recurring practice occurrence through the legacy recurrence override path', async () => {
        const coach = { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach' };
        const event = {
            teamId: 'team-1',
            id: 'practice-master__2026-06-05',
            isDbGame: true,
            type: 'practice',
            isCancelled: false,
            isTeamAdmin: true,
            isTeamStaff: true
        };

        await expect(cancelPracticeOccurrenceForApp(event, coach)).resolves.toEqual({
            cancelled: true,
            masterId: 'practice-master',
            instanceDate: '2026-06-05'
        });

        expect(dbMocks.cancelOccurrence).toHaveBeenCalledWith('team-1', 'practice-master', '2026-06-05');
    });

    it('rejects recurring practice occurrence cancellation without staff access or occurrence ids', async () => {
        const coach = { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach' };

        await expect(cancelPracticeOccurrenceForApp({
            teamId: 'team-1',
            id: 'practice-master__2026-06-05',
            isDbGame: true,
            type: 'practice',
            isCancelled: false,
            isTeamAdmin: false,
            isTeamStaff: false
        }, coach)).rejects.toThrow('Team owner or admin access is required to cancel this practice occurrence.');

        await expect(cancelPracticeOccurrenceForApp({
            teamId: 'team-1',
            id: 'practice-master__2026-06-05',
            isDbGame: true,
            type: 'practice',
            isCancelled: false,
            isTeamAdmin: false,
            isTeamStaff: true
        }, coach)).rejects.toThrow('Team owner or admin access is required to cancel this practice occurrence.');

        await expect(cancelPracticeOccurrenceForApp({
            teamId: 'team-1',
            id: 'practice-master',
            isDbGame: true,
            type: 'practice',
            isCancelled: false,
            isTeamAdmin: true,
            isTeamStaff: true
        }, coach)).rejects.toThrow('Only recurring practice occurrences can be cancelled here.');
    });
});

describe('scheduleLogic.ts', () => {
    it('getScheduleForecastHref returns an encoded Google search URL for weather with location and date', () => {
        const location = 'Central Park, New York';
        const date = new Date('2026-07-20T10:00:00Z');
        const formattedDate = date.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const query = `weather in ${location} on ${formattedDate}`;
        const expectedUrl = new URL('https://www.google.com/search');
        expectedUrl.searchParams.set('q', query);

        const href = getScheduleForecastHref(location, date);
        expect(href).toBe(expectedUrl.toString());
    });

    it('getScheduleForecastHref returns an encoded Google search URL for weather with location only', () => {
        const location = 'Central Park, New York';
        const query = `weather in ${location}`;
        const expectedUrl = new URL('https://www.google.com/search');
        expectedUrl.searchParams.set('q', query);

        const href = getScheduleForecastHref(location);
        expect(href).toBe(expectedUrl.toString());
    });

    it('getScheduleForecastHref returns empty string for null location', () => {
        const href = getScheduleForecastHref(null);
        expect(href).toBe('');
    });

    it('getScheduleForecastHref returns empty string for undefined location', () => {
        const href = getScheduleForecastHref(undefined);
        expect(href).toBe('');
    });

    it('getScheduleForecastHref returns empty string for empty string location', () => {
        const href = getScheduleForecastHref('');
        expect(href).toBe('');
    });

    it('getScheduleForecastHref returns empty string for TBD location', () => {
        const href = getScheduleForecastHref('TBD');
        expect(href).toBe('');
    });

    it('getScheduleForecastHref handles locations with special characters', () => {
        const location = 'O\'Connell\'s Field, Dublin!';
        const query = `weather in ${location}`;
        const expectedUrl = new URL('https://www.google.com/search');
        expectedUrl.searchParams.set('q', query);

        const href = getScheduleForecastHref(location);
        expect(href).toBe(expectedUrl.toString());
    });

    it('getScheduleMapHref returns an encoded Google Maps search URL', () => {
        const location = 'Main Gym';
        const expectedUrl = new URL('https://www.google.com/maps/search/');
        expectedUrl.searchParams.set('api', '1');
        expectedUrl.searchParams.set('query', location);
        expect(getScheduleMapHref(location)).toBe(expectedUrl.toString());
    });

    it('getScheduleMapHref returns empty string for null location', () => {
        expect(getScheduleMapHref(null)).toBe('');
    });

    it('getScheduleMapHref returns empty string for TBD location', () => {
        expect(getScheduleMapHref('TBD')).toBe('');
    });
});
