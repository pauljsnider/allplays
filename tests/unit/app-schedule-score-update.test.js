import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../js/db.js', () => dbMocks);
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

import { normalizeGameScoreValue, updateGameScore } from '../../apps/app/src/lib/scheduleService.ts';

const user = {
    uid: 'user-1',
    email: 'coach@example.com',
    displayName: 'Coach Pat',
    roles: ['coach']
};

beforeEach(() => {
    vi.clearAllMocks();
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
});
