import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getAssignmentClaims: vi.fn(),
    getGames: vi.fn(),
    getPracticePacketCompletions: vi.fn(),
    getPracticeSession: vi.fn(),
    getPracticeSessionByEvent: vi.fn(),
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
    updatePracticeSession: vi.fn(),
    upsertPracticeSessionForEvent: vi.fn(),
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
    mergeAssignmentsWithClaims: vi.fn((assignments) => assignments || [])
}));

import {
    loadStaffPracticePacket,
    loadParentPracticePacket,
    loadParentSchedule,
    markParentPracticePacketComplete,
    saveStaffPracticePacket
} from '../../apps/app/src/lib/scheduleService.ts';

function installWindow(protocol = 'http:') {
    vi.stubGlobal('window', {
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        location: { protocol }
    });
}

function user(overrides = {}) {
    return {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent'],
        parentOf: [
            { teamId: 'team-1', playerId: 'player-1', playerName: 'Pat', teamName: 'Bears' },
            { teamId: 'team-1', playerId: 'player-2', playerName: 'Sam', teamName: 'Bears' }
        ],
        ...overrides
    };
}

function practiceEvent(overrides = {}) {
    return {
        eventKey: 'team-1::practice-1::player-1',
        id: 'practice-1',
        teamId: 'team-1',
        teamName: 'Bears',
        type: 'practice',
        date: new Date('2026-05-22T19:00:00Z'),
        location: 'Main Gym',
        opponent: null,
        title: 'Practice',
        childId: 'player-1',
        childName: 'Pat',
        isDbGame: true,
        isCancelled: false,
        assignments: [],
        practiceSessionId: 'session-1',
        practiceHomePacketSummary: '2 drills · 20 min',
        practiceHomePacket: {
            totalMinutes: 20,
            blocks: [
                { type: 'Drill', duration: 10, drillTitle: 'Ball Mastery' },
                { type: 'Drill', duration: 10, drillTitle: 'Passing Wall' }
            ]
        },
        ...overrides
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    installWindow();
    profileMocks.loadProfileDocument.mockResolvedValue({
        parentOf: user().parentOf,
        parentTeamIds: ['team-1'],
        parentPlayerKeys: ['team-1::player-1', 'team-1::player-2']
    });
    dbMocks.getPracticePacketCompletions.mockResolvedValue([
        { id: 'user-1__player-2', parentUserId: 'user-1', childId: 'player-2', childName: 'Sam', status: 'completed' }
    ]);
    dbMocks.getPracticeSession.mockResolvedValue(null);
    dbMocks.getPracticeSessionByEvent.mockResolvedValue(null);
    dbMocks.updatePracticeSession.mockResolvedValue(undefined);
    dbMocks.upsertPracticeSessionForEvent.mockResolvedValue('session-1');
    dbMocks.upsertPracticePacketCompletion.mockResolvedValue(undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('React app practice packet service', () => {
    it('loads a practice packet with completions and scoped family children', async () => {
        const event = practiceEvent();
        const packet = await loadParentPracticePacket(event, [
            event,
            practiceEvent({ eventKey: 'team-1::practice-1::player-2', childId: 'player-2', childName: 'Sam' })
        ]);

        expect(dbMocks.getPracticePacketCompletions).toHaveBeenCalledWith('team-1', 'session-1');
        expect(packet).toMatchObject({
            sessionId: 'session-1',
            teamId: 'team-1',
            eventId: 'practice-1',
            title: 'Practice',
            location: 'Main Gym'
        });
        expect(packet.homePacket.blocks).toHaveLength(2);
        expect(packet.children).toEqual([
            { id: 'player-1', name: 'Pat' },
            { id: 'player-2', name: 'Sam' }
        ]);
        expect(packet.completions).toEqual([
            expect.objectContaining({ childId: 'player-2', status: 'completed' })
        ]);
    });

    it('returns null when a practice does not have packet blocks', async () => {
        await expect(loadParentPracticePacket(practiceEvent({
            practiceHomePacketSummary: null,
            practiceHomePacket: null
        }))).resolves.toBeNull();
        expect(dbMocks.getPracticePacketCompletions).not.toHaveBeenCalled();
    });

    it('marks one child complete using the same completion payload as parent-dashboard', async () => {
        const packet = await loadParentPracticePacket(practiceEvent(), [practiceEvent()]);
        const completion = await markParentPracticePacketComplete(packet, user(), { id: 'player-1', name: 'Pat' });

        expect(dbMocks.upsertPracticePacketCompletion).toHaveBeenCalledWith('team-1', 'session-1', {
            parentUserId: 'user-1',
            parentName: 'Pat Parent',
            childId: 'player-1',
            childName: 'Pat'
        });
        expect(completion).toMatchObject({
            id: 'user-1__player-1',
            parentUserId: 'user-1',
            childId: 'player-1',
            status: 'completed'
        });
        expect(profileMocks.saveProfileDocument).not.toHaveBeenCalled();
    });

    it('loads coach packet management data with completion status', async () => {
        dbMocks.getPracticeSession.mockResolvedValue({
            id: 'session-1',
            eventId: 'practice-1',
            homePacketGenerated: true,
            homePacketContent: {
                packetTitle: 'Weekend touches',
                dueDate: '2026-05-24T12:00:00.000Z',
                totalMinutes: 15,
                blocks: [
                    { drillTitle: 'Ball Mastery', type: 'Technical', duration: 15, notes: 'Both feet' }
                ]
            }
        });

        const packet = await loadStaffPracticePacket(practiceEvent({
            isTeamAdmin: true
        }), [
            practiceEvent({ childId: 'player-1', childName: 'Pat' }),
            practiceEvent({ childId: 'player-2', childName: 'Sam' })
        ], user({ uid: 'coach-1', roles: ['coach'] }));

        expect(dbMocks.getPracticeSession).toHaveBeenCalledWith('team-1', 'session-1');
        expect(packet).toMatchObject({
            sessionId: 'session-1',
            packetTitle: 'Weekend touches',
            dueDate: '2026-05-24T12:00:00.000Z',
            totalMinutes: 15
        });
        expect(packet.children).toEqual([
            { id: 'player-1', name: 'Pat' },
            { id: 'player-2', name: 'Sam' }
        ]);
        expect(packet.completions).toEqual([
            expect.objectContaining({ childId: 'player-2', status: 'completed' })
        ]);
    });

    it('saves a coach-created packet on the linked practice session', async () => {
        const coach = user({ uid: 'coach-1', roles: ['coach'] });
        const saved = await saveStaffPracticePacket(practiceEvent({
            isTeamAdmin: true,
            practiceSessionId: null,
            practiceHomePacketSummary: null,
            practiceHomePacket: null
        }), coach, {
            packetTitle: 'Weekend touches',
            dueDate: '2026-05-24',
            blocks: [
                { drillTitle: 'Ball Mastery', type: 'Technical', duration: 12, description: 'Ten toe taps', notes: 'Both feet' },
                { drillTitle: '', duration: 8 }
            ]
        }, [practiceEvent({ childId: 'player-1', childName: 'Pat' })]);

        expect(dbMocks.upsertPracticeSessionForEvent).toHaveBeenCalledWith('team-1', 'practice-1', expect.objectContaining({
            eventId: 'practice-1',
            eventType: 'practice',
            sourcePage: 'app-schedule',
            homePacketGenerated: true,
            homePacketContent: expect.objectContaining({
                packetTitle: 'Weekend touches',
                dueDate: expect.stringContaining('2026-05-24'),
                totalMinutes: 20,
                updatedBy: 'coach-1'
            })
        }));
        const packetContent = dbMocks.upsertPracticeSessionForEvent.mock.calls[0][2].homePacketContent;
        expect(packetContent.blocks).toEqual([
            expect.objectContaining({ drillTitle: 'Ball Mastery', duration: 12, notes: 'Both feet' }),
            expect.objectContaining({ drillTitle: 'Home Drill 2', duration: 8 })
        ]);
        expect(saved).toMatchObject({
            sessionId: 'session-1',
            packetTitle: 'Weekend touches',
            totalMinutes: 20
        });
    });

    it('carries packet data from practice sessions into parent schedule events', async () => {
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears' });
        dbMocks.getGames.mockResolvedValue([
            { id: 'practice-1', type: 'practice', title: 'Practice', date: new Date('2026-05-22T19:00:00Z'), location: 'Main Gym', status: 'scheduled' }
        ]);
        dbMocks.getPracticeSessions.mockResolvedValue([
            {
                id: 'session-1',
                eventId: 'practice-1',
                title: 'Practice',
                date: new Date('2026-05-22T19:00:00Z'),
                location: 'Main Gym',
                homePacketContent: {
                    totalMinutes: 20,
                    blocks: [
                        { type: 'Drill', duration: 10, drillTitle: 'Ball Mastery' },
                        { type: 'Drill', duration: 10, drillTitle: 'Passing Wall' }
                    ]
                }
            }
        ]);
        dbMocks.getTrackedCalendarEventUids.mockResolvedValue([]);
        dbMocks.getRsvps.mockResolvedValue([]);
        dbMocks.getRsvpSummaries.mockResolvedValue(new Map());
        dbMocks.listRideOffersForEvent.mockResolvedValue([]);
        dbMocks.getAssignmentClaims.mockResolvedValue({});

        const result = await loadParentSchedule(user());
        const practice = result.events.find((event) => event.id === 'practice-1' && event.childId === 'player-1');

        expect(practice).toMatchObject({
            practiceSessionId: 'session-1',
            practiceHomePacketSummary: '2 drills · 20 min'
        });
        expect(practice.practiceHomePacket.blocks).toHaveLength(2);
    });
});
