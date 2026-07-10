import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@legacy/db.js', () => ({
    addGame: vi.fn(),
    addPractice: vi.fn(),
    broadcastLiveEvent: vi.fn(),
    cancelOccurrence: vi.fn(),
    clearOccurrenceOverride: vi.fn(),
    cancelRideRequest: vi.fn(),
    claimAssignmentSlot: vi.fn(),
    claimOpenOfficiatingSlot: vi.fn(),
    closeRideOffer: vi.fn(),
    createRideOffer: vi.fn(),
    getConfigs: vi.fn(),
    getAssignmentClaims: vi.fn(),
    getGame: vi.fn(),
    getGames: vi.fn(),
    getLiveEvents: vi.fn(),
    getPlayers: vi.fn(),
    getPracticePacketCompletions: vi.fn(),
    getPracticeSession: vi.fn(),
    getPracticeSessionByEvent: vi.fn(),
    getPracticeSessions: vi.fn(),
    getRsvpBreakdownByPlayer: vi.fn(),
    getRsvpSummaries: vi.fn(),
    getRsvps: vi.fn(),
    getTeam: vi.fn(),
    getTeams: vi.fn(),
    postChatMessage: vi.fn(),
    postSharedGameCancellationNotification: vi.fn(),
    releaseAssignmentClaim: vi.fn(),
    requestRideSpot: vi.fn(),
    respondToOfficiatingAssignment: vi.fn(),
    submitRsvpForPlayer: vi.fn(),
    updateEvent: vi.fn(),
    updateGame: vi.fn(),
    updateOccurrence: vi.fn(),
    updatePracticeAttendance: vi.fn(),
    updatePracticeSession: vi.fn(),
    updateRideRequestStatus: vi.fn(),
    updateSeries: vi.fn(),
    updateTeam: vi.fn(),
    upsertPracticeSessionForEvent: vi.fn(),
    upsertPracticePacketCompletion: vi.fn(),
    listRideOffersForEvent: vi.fn()
}));

vi.mock('@legacy/firebase.js', () => ({
    collection: vi.fn(),
    collectionGroup: vi.fn(),
    db: {},
    doc: vi.fn(),
    deleteField: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    increment: vi.fn(),
    query: vi.fn(),
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(),
    Timestamp: { fromDate: vi.fn((value: Date) => value) },
    where: vi.fn()
}));

import { addGame as legacyAddGame } from '@legacy/db.js';
import { addGame, buildLegacyTournamentGameDocument, buildLegacyTournamentGameDocuments, buildSingleLegacyTournamentGameDocument, LegacyTournamentGameAdapterValidationError } from './legacyScheduleDb';

const buildValidLegacyGamePayload = (overrides: Record<string, unknown> = {}) => ({
    type: 'game',
    opponent: 'Tigers',
    date: new Date('2026-06-24T18:30:00.000Z'),
    end: new Date('2026-06-24T20:00:00.000Z'),
    location: 'Main Gym',
    arrivalTime: new Date('2026-06-24T18:00:00.000Z'),
    isHome: true,
    notes: 'Bring dark jerseys',
    assignments: [],
    status: 'scheduled',
    homeScore: 0,
    awayScore: 0,
    countsTowardSeasonRecord: true,
    statTrackerConfigId: null,
    createdBy: 'coach-1',
    ...overrides
});

const validTournamentMetadata = {
    divisionName: '10U Gold',
    bracketName: 'Gold Bracket',
    roundName: 'Semifinal',
    poolName: 'Pool A'
};

beforeEach(() => {
    vi.clearAllMocks();
});

describe('legacyScheduleDb tournament mapping', () => {
    it('maps the supported single-game tournament adapter entry point to one legacy-compatible game document', () => {
        const basePayload = buildValidLegacyGamePayload();
        const tournament = validTournamentMetadata;

        const document = buildSingleLegacyTournamentGameDocument([basePayload], tournament);

        expect(document).toEqual(expect.objectContaining({
            ...basePayload,
            competitionType: 'tournament',
            tournament
        }));
    });

    it('rejects unsupported tournament row counts at the adapter entry point', () => {
        const basePayload = buildValidLegacyGamePayload();

        expect(() => buildSingleLegacyTournamentGameDocument([], validTournamentMetadata))
            .toThrow('Tournament adapter only supports a single completed tournament game.');
        expect(() => buildSingleLegacyTournamentGameDocument([basePayload, buildValidLegacyGamePayload({ opponent: 'Lions' })], validTournamentMetadata))
            .toThrow('Tournament adapter only supports a single completed tournament game.');
    });

    it('wraps legacy tournament metadata without mutating the base payload', () => {
        const basePayload = buildValidLegacyGamePayload({
            opponent: 'Lions',
            competitionType: 'league'
        });
        const tournament = {
            divisionName: '12U',
            bracketName: 'Silver',
            roundName: 'Final'
        };

        const document = buildLegacyTournamentGameDocument(basePayload, tournament);

        expect(document).toEqual(expect.objectContaining({
            type: 'game',
            opponent: 'Lions',
            competitionType: 'tournament',
            tournament
        }));
        expect(basePayload).toEqual(expect.objectContaining({
            type: 'game',
            opponent: 'Lions',
            competitionType: 'league'
        }));
    });

    it('returns an explicit error when required tournament metadata is missing', () => {
        expect(() => buildLegacyTournamentGameDocument(buildValidLegacyGamePayload(), {
            divisionName: '10U Gold',
            bracketName: '',
            roundName: 'Semifinal'
        })).toThrow(LegacyTournamentGameAdapterValidationError);
        expect(() => buildLegacyTournamentGameDocument(buildValidLegacyGamePayload(), {
            divisionName: '10U Gold',
            bracketName: '',
            roundName: 'Semifinal'
        })).toThrow('Tournament adapter requires tournament.bracketName.');
    });

    it('returns an explicit error when legacy game values are invalid', () => {
        expect(() => buildLegacyTournamentGameDocument(buildValidLegacyGamePayload({
            end: new Date('2026-06-24T18:00:00.000Z')
        }), validTournamentMetadata)).toThrow('Tournament adapter requires end to be after date.');
    });

    it('does not produce legacy tournament documents when validation fails', () => {
        expect(() => buildLegacyTournamentGameDocuments([
            buildValidLegacyGamePayload({ opponent: 'Tigers' }),
            buildValidLegacyGamePayload({ opponent: '' })
        ], validTournamentMetadata)).toThrow('Tournament adapter requires opponent.');
    });

    it('does not silently drop unsupported tournament rows from document batches', () => {
        expect(() => buildLegacyTournamentGameDocuments([
            buildValidLegacyGamePayload({ opponent: 'Tigers' }),
            null
        ], validTournamentMetadata)).toThrow('Tournament adapter requires complete tournament game payloads.');
    });
});

describe('legacyScheduleDb game persistence', () => {
    it('delegates one valid tournament document to the legacy save adapter exactly once', async () => {
        const tournamentDocument = buildSingleLegacyTournamentGameDocument([
            buildValidLegacyGamePayload()
        ], validTournamentMetadata);
        const expectedDocument = {
            ...tournamentDocument,
            tournament: {
                ...validTournamentMetadata
            }
        };
        vi.mocked(legacyAddGame).mockResolvedValueOnce('tournament-game-1');

        await expect(addGame('team-1', tournamentDocument)).resolves.toBe('tournament-game-1');

        expect(legacyAddGame).toHaveBeenCalledTimes(1);
        expect(legacyAddGame).toHaveBeenCalledWith('team-1', expectedDocument);
        expect(tournamentDocument).toStrictEqual(expectedDocument);
    });

    it('keeps non-tournament game persistence on the same single legacy delegation', async () => {
        const leagueDocument = buildValidLegacyGamePayload({
            competitionType: 'league'
        });
        vi.mocked(legacyAddGame).mockResolvedValueOnce('league-game-1');

        await expect(addGame('team-1', leagueDocument)).resolves.toBe('league-game-1');

        expect(legacyAddGame).toHaveBeenCalledTimes(1);
        expect(legacyAddGame).toHaveBeenCalledWith('team-1', leagueDocument);
    });
});
