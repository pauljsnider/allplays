import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => {
    const transactionSet = vi.fn();
    const transactionGet = vi.fn();
    return {
        db: {},
        doc: vi.fn((_db, ...segments) => ({ path: segments.filter(Boolean).join('/') })),
        collection: vi.fn(),
        collectionGroup: vi.fn(),
        getDocs: vi.fn(),
        query: vi.fn(),
        runTransaction: vi.fn(async (_db, callback) => callback({
            get: transactionGet,
            set: transactionSet,
            delete: vi.fn()
        })),
        where: vi.fn(),
        increment: vi.fn((value) => ({ __increment: value })),
        serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
        getAssignmentClaims: vi.fn(),
        claimOpenOfficiatingSlot: vi.fn(),
        getGame: vi.fn(),
        getGames: vi.fn(),
        getLiveEvents: vi.fn(),
        getPracticePacketCompletions: vi.fn(),
        getPracticeSession: vi.fn(),
        getPracticeSessionByEvent: vi.fn(),
        getPracticeSessions: vi.fn(),
        getPlayers: vi.fn(),
        getRsvpBreakdownByPlayer: vi.fn(),
        getRsvps: vi.fn(),
        getRsvpSummaries: vi.fn(),
        getTeam: vi.fn(),
        getTeams: vi.fn(),
        addGame: vi.fn(),
        addPractice: vi.fn(),
        createRideOffer: vi.fn(),
        claimAssignmentSlot: vi.fn(),
        respondToOfficiatingAssignment: vi.fn(),
        requestRideSpot: vi.fn(),
        listRideOffersForEvent: vi.fn(),
        updateRideRequestStatus: vi.fn(),
        closeRideOffer: vi.fn(),
        cancelRideRequest: vi.fn(),
        releaseAssignmentClaim: vi.fn(),
        submitRsvpForPlayer: vi.fn(),
        upsertPracticePacketCompletion: vi.fn(),
        updateGame: vi.fn(),
        updatePracticeAttendance: vi.fn(),
        updateTeam: vi.fn(),
        broadcastLiveEvent: vi.fn(),
        postChatMessage: vi.fn(),
        postSharedGameCancellationNotification: vi.fn(),
        cancelOccurrence: vi.fn(),
        transactionGet,
        transactionSet
    };
});

vi.mock('../../apps/app/src/lib/adapters/legacyScheduleDb', () => dbMocks);
vi.mock('../../apps/app/src/lib/profileService.ts', () => ({
    loadProfileDocument: vi.fn(),
    saveProfileDocument: vi.fn()
}));
vi.mock('../../apps/app/src/lib/authService.ts', () => ({
    firebaseAuth: { app: { options: { projectId: 'demo-allplays' } } },
    getNativeAuthIdToken: vi.fn()
}));
vi.mock('../../js/utils.js', () => ({
    expandRecurrence: vi.fn(() => []),
    extractOpponent: vi.fn(),
    fetchAndParseCalendar: vi.fn(),
    getCalendarEventTrackingId: vi.fn(),
    isPracticeEvent: vi.fn(),
    isTrackedCalendarEvent: vi.fn()
}));
vi.mock('../../js/parent-dashboard-practice-sessions.js', () => ({
    filterVisiblePracticeSessions: vi.fn((sessions) => sessions || [])
}));
vi.mock('../../js/parent-dashboard-packets.js', () => ({
    buildPracticePacketCompletionPayload: vi.fn()
}));
vi.mock('../../js/parent-dashboard-rsvp.js', () => ({
    resolveMyRsvpByChildForGame: vi.fn()
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
    mergeAssignmentsWithClaims: vi.fn((assignments = []) => assignments)
}));
vi.mock('../../apps/app/src/lib/chatService.ts', () => ({
    sendTeamChatMessage: vi.fn()
}));
vi.mock('../../apps/app/src/lib/chatLogic.ts', () => ({
    DEFAULT_TEAM_CONVERSATION_ID: 'team'
}));

import { buildCancelScheduledGameChatMessage, cancelScheduledGameForApp, normalizeGameScoreValue, publishLiveScoreUpdateEvent, updateGameScore } from '../../apps/app/src/lib/scheduleService.ts';
import { getNativeAuthIdToken } from '../../apps/app/src/lib/authService.ts';

const user = {
    uid: 'user-1',
    email: 'coach@example.com',
    displayName: 'Coach Pat',
    roles: ['coach']
};

beforeEach(() => {
    vi.clearAllMocks();
    const gameSnapshot = {
        id: 'game-1',
        status: 'scheduled',
        liveStatus: 'scheduled',
        liveHasData: false,
        period: 'Q2',
        liveClockMs: 321000
    };
    dbMocks.getGame.mockResolvedValue(gameSnapshot);
    dbMocks.transactionGet.mockResolvedValue({
        exists: () => true,
        data: () => gameSnapshot
    });
    vi.stubGlobal('window', {
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        location: { protocol: 'http:' }
    });
});

describe('React app schedule score updates', () => {
    it('clamps score values at zero', () => {
        expect(normalizeGameScoreValue(-3)).toBe(0);
        expect(normalizeGameScoreValue('7')).toBe(7);
        expect(normalizeGameScoreValue('not-a-score')).toBe(0);
    });

    it('writes the legacy score payload for a scheduled game', async () => {
        dbMocks.updateGame.mockResolvedValue(undefined);

        const payload = await updateGameScore('team-1', 'game-1', {
            homeScore: 5,
            awayScore: -2,
            scoreStreamSessionId: 'stream-1'
        }, user);

        expect(dbMocks.updateGame).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({
            homeScore: 5,
            awayScore: 0,
            scoreUpdatedBy: 'user-1',
            scoreStreamSessionId: 'stream-1'
        }));
        expect(dbMocks.updateGame.mock.calls[0][2].scoreUpdatedAt).toBeInstanceOf(Date);
        expect(payload).toEqual(dbMocks.updateGame.mock.calls[0][2]);
    });

    it('publishes a live play-by-play score update event', async () => {
        const payload = await publishLiveScoreUpdateEvent('team-1', 'game-1', {
            homeScore: 5,
            awayScore: 2
        }, user, {
            homeScore: 4,
            awayScore: 2
        });

        expect(dbMocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: 'teams/team-1/games/game-1' }), expect.objectContaining({
            homeScore: 5,
            awayScore: 2,
            scoreUpdatedBy: 'user-1',
            liveStatus: 'live',
            liveHasData: true,
            liveStartedAt: expect.any(Date)
        }), { merge: true });
        expect(dbMocks.transactionSet).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringContaining('teams/team-1/games/game-1/liveEvents/') }), expect.objectContaining({
            type: 'score_update',
            period: 'Q2',
            gameClockMs: 321000,
            description: 'Score update: Home 5, Away 2.',
            homeScore: 5,
            awayScore: 2,
            previousHomeScore: 4,
            previousAwayScore: 2,
            createdBy: 'user-1',
            createdByName: 'Coach Pat'
        }));
        expect(payload.createdAt).toBeInstanceOf(Date);
        expect(payload).toMatchObject({
            type: 'score_update',
            period: 'Q2',
            gameClockMs: 321000,
            homeScore: 5,
            awayScore: 2,
            previousHomeScore: 4,
            previousAwayScore: 2,
            createdBy: 'user-1',
            createdByName: 'Coach Pat'
        });
    });

    it('writes cancellation metadata and posts the legacy-style team chat notice', async () => {
        dbMocks.updateGame.mockResolvedValue(undefined);
        dbMocks.postChatMessage.mockResolvedValue(undefined);
        dbMocks.postSharedGameCancellationNotification.mockResolvedValue({ posted: true, messageId: 'msg-2' });

        const result = await cancelScheduledGameForApp({
            eventKey: 'team-1__game-1__player-1',
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
            canUpdateScore: true,
            assignments: []
        }, user);

        expect(dbMocks.updateGame).toHaveBeenCalledWith('team-1', 'game-1', expect.objectContaining({
            status: 'cancelled',
            liveStatus: 'cancelled',
            cancelledBy: 'user-1'
        }));
        expect(dbMocks.updateGame.mock.calls[0][2].cancelledAt).toBeInstanceOf(Date);
        expect(dbMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
            text: '⚠️ Game cancelled: vs. Falcons on Thu, May 21',
            senderId: 'user-1',
            senderName: 'Coach Pat',
            senderEmail: 'coach@example.com'
        }));
        expect(result).toEqual({ cancelled: true, notificationError: null });
    });

    it('posts shared-game cancellation notices to both unique team chats', async () => {
        dbMocks.updateGame.mockResolvedValue(undefined);
        dbMocks.postChatMessage.mockResolvedValue(undefined);
        dbMocks.postSharedGameCancellationNotification.mockResolvedValue({ posted: true, messageId: 'msg-2' });

        const result = await cancelScheduledGameForApp({
            eventKey: 'team-1__game-1__player-1',
            id: 'game-1',
            teamId: 'team-1',
            teamName: 'Bears',
            type: 'game',
            date: new Date('2026-05-21T18:00:00Z'),
            location: 'Main Gym',
            opponent: 'Falcons',
            opponentTeamId: 'team-2',
            sharedScheduleOpponentTeamId: 'team-2',
            counterpartTitle: 'vs. Bears',
            childId: 'player-1',
            childName: 'Pat',
            isDbGame: true,
            isCancelled: false,
            canUpdateScore: true,
            assignments: []
        }, user);

        expect(dbMocks.postChatMessage).toHaveBeenCalledTimes(1);
        expect(dbMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
            text: '⚠️ Game cancelled: vs. Falcons on Thu, May 21'
        }));
        expect(dbMocks.postSharedGameCancellationNotification).toHaveBeenCalledWith({
            teamId: 'team-1',
            gameId: 'game-1',
            counterpartTeamId: 'team-2',
            text: '⚠️ Game cancelled: vs. Bears on Thu, May 21',
            senderName: 'Coach Pat',
            senderEmail: 'coach@example.com'
        });
        expect(result).toEqual({ cancelled: true, notificationError: null });
    });

    it('atomically cancels both shared games in the native REST fallback', async () => {
        vi.stubGlobal('window', {
            setTimeout: globalThis.setTimeout.bind(globalThis),
            clearTimeout: globalThis.clearTimeout.bind(globalThis),
            location: { protocol: 'capacitor:' }
        });
        vi.mocked(getNativeAuthIdToken).mockResolvedValue('native-token');
        dbMocks.updateGame.mockRejectedValue(new Error('native fallback'));
        vi.stubGlobal('fetch', vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    name: 'projects/demo-allplays/databases/(default)/documents/teams/team-1/games/game-1',
                    fields: {
                        sharedScheduleId: { stringValue: 'shared_team-1_game-1' },
                        sharedScheduleOpponentTeamId: { stringValue: 'team-2' },
                        sharedScheduleOpponentGameId: { stringValue: 'game-2' }
                    }
                })
            })
            .mockResolvedValueOnce({ ok: true, json: async () => ({}) }));

        await cancelScheduledGameForApp({
            eventKey: 'team-1__game-1__player-1',
            id: 'game-1',
            teamId: 'team-1',
            teamName: 'Bears',
            type: 'game',
            date: new Date('2026-05-21T18:00:00Z'),
            opponent: 'Falcons',
            opponentTeamId: 'team-2',
            sharedScheduleOpponentTeamId: 'team-2',
            childId: 'player-1',
            childName: 'Pat',
            isDbGame: true,
            isCancelled: false,
            canUpdateScore: true,
            assignments: []
        }, user);

        expect(globalThis.fetch).toHaveBeenCalledTimes(2);
        const [commitUrl, commitInit] = vi.mocked(globalThis.fetch).mock.calls[1];
        const commitPayload = JSON.parse(String(commitInit.body));
        expect(commitUrl).toContain(':commit');
        expect(commitPayload.writes).toHaveLength(2);
        expect(commitPayload.writes.map((write) => write.update.name)).toEqual([
            'projects/demo-allplays/databases/(default)/documents/teams/team-1/games/game-1',
            'projects/demo-allplays/databases/(default)/documents/teams/team-2/games/game-2'
        ]);
        expect(commitPayload.writes.every((write) => (
            write.update.fields.status.stringValue === 'cancelled'
            && write.update.fields.liveStatus.stringValue === 'cancelled'
            && write.currentDocument.exists === true
        ))).toBe(true);
    });

    it('reports counterpart notification failure without failing the cancellation', async () => {
        dbMocks.updateGame.mockResolvedValue(undefined);
        dbMocks.postChatMessage.mockResolvedValue(undefined);
        dbMocks.postSharedGameCancellationNotification.mockRejectedValue(new Error('counterpart chat write failed'));

        const result = await cancelScheduledGameForApp({
            eventKey: 'team-1__game-1__player-1',
            id: 'game-1',
            teamId: 'team-1',
            teamName: 'Bears',
            type: 'game',
            date: new Date('2026-05-21T18:00:00Z'),
            location: 'Main Gym',
            opponent: 'Falcons',
            opponentTeamId: 'team-2',
            counterpartTitle: 'vs. Bears',
            childId: 'player-1',
            childName: 'Pat',
            isDbGame: true,
            isCancelled: false,
            canUpdateScore: true,
            assignments: []
        }, user);

        expect(dbMocks.updateGame).toHaveBeenCalledTimes(1);
        expect(dbMocks.postChatMessage).toHaveBeenCalledWith('team-1', expect.objectContaining({
            text: '⚠️ Game cancelled: vs. Falcons on Thu, May 21'
        }));
        expect(result).toEqual({ cancelled: true, notificationError: 'counterpart chat write failed' });
    });

    it('rejects missing cancellation inputs before writing', async () => {
        await expect(cancelScheduledGameForApp({}, user)).rejects.toThrow('A scheduled game is required before cancelling.');
        await expect(cancelScheduledGameForApp({
            eventKey: 'team-1__game-1__player-1',
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
            canUpdateScore: true,
            assignments: []
        }, {})).rejects.toThrow('Sign in before cancelling the game.');
        expect(dbMocks.updateGame).not.toHaveBeenCalled();
    });

    it('builds the cancellation chat text from title when opponent is missing', () => {
        expect(buildCancelScheduledGameChatMessage({
            title: 'Championship game',
            opponent: '',
            date: new Date('2026-05-21T18:00:00Z')
        })).toBe('⚠️ Game cancelled: Championship game on Thu, May 21');
    });
});
