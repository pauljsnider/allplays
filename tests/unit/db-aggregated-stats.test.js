import { beforeEach, describe, expect, it, vi } from 'vitest';

const { docMock, getDocMock } = vi.hoisted(() => ({
    docMock: vi.fn(),
    getDocMock: vi.fn(),
}));

vi.mock('../../js/firebase.js?v=9', () => ({
    db: {},
    auth: {},
    storage: {},
    collection: vi.fn(),
    getDocs: vi.fn(),
    getDoc: getDocMock,
    doc: docMock,
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    setDoc: vi.fn(),
    query: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    Timestamp: { now: vi.fn() },
    increment: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    deleteField: vi.fn(),
    limit: vi.fn(),
    startAfter: vi.fn(),
    getCountFromServer: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(),
    collectionGroup: vi.fn(),
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
}));

vi.mock('../../js/firebase-images.js?v=2', () => ({
    imageStorage: {},
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn(),
}));

vi.mock('../../js/drill-upload-paths.js?v=1', () => ({
    buildDrillDiagramUploadPaths: vi.fn(),
}));

vi.mock('../../js/access-code-utils.js?v=1', () => ({
    isAccessCodeExpired: vi.fn(),
}));

vi.mock('../../js/rsvp-doc-ids.js', () => ({
    buildCoachOverrideRsvpDocId: vi.fn(),
    shouldDeleteLegacyRsvpForOverride: vi.fn(),
}));

vi.mock('../../js/rsvp-summary.js?v=1', () => ({
    computeEffectiveRsvpSummary: vi.fn(),
}));

vi.mock('../../js/team-visibility.js?v=1', () => ({
    isTeamActive: vi.fn(),
    filterTeamsByActive: vi.fn(),
    shouldIncludeTeamInLiveOrUpcoming: vi.fn(),
    shouldIncludeTeamInReplay: vi.fn(),
}));

vi.mock('../../js/vendor/firebase-app.js', () => ({
    getApp: vi.fn(),
}));

import { getAggregatedStatsForPlayer } from '../../js/db.js';

describe('getAggregatedStatsForPlayer', () => {
    beforeEach(() => {
        docMock.mockReset();
        getDocMock.mockReset();
    });

    it('returns stats when the aggregated stats document exists', async () => {
        docMock.mockReturnValue({ path: 'stats-doc' });
        getDocMock.mockResolvedValue({
            exists: () => true,
            data: () => ({ stats: { pts: 12, reb: 4 } }),
        });

        await expect(getAggregatedStatsForPlayer('team-1', 'game-1', 'player-1')).resolves.toEqual({ pts: 12, reb: 4 });
        expect(docMock).toHaveBeenCalledWith({}, 'teams/team-1/games/game-1/aggregatedStats', 'player-1');
    });

    it('returns null when no aggregated stats document exists', async () => {
        docMock.mockReturnValue({ path: 'stats-doc' });
        getDocMock.mockResolvedValue({
            exists: () => false,
        });

        await expect(getAggregatedStatsForPlayer('team-1', 'game-1', 'player-1')).resolves.toBeNull();
    });

    it('logs context and rethrows when Firestore read fails', async () => {
        const error = new Error('permission denied');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        docMock.mockReturnValue({ path: 'stats-doc' });
        getDocMock.mockRejectedValue(error);

        await expect(getAggregatedStatsForPlayer('team-9', 'game-7', 'player-3')).rejects.toThrow(
            'Unable to load stats for player player-3: permission denied'
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            '[getAggregatedStatsForPlayer] failed to load aggregated stats',
            expect.objectContaining({
                teamId: 'team-9',
                gameId: 'game-7',
                playerId: 'player-3',
                error,
            })
        );

        consoleErrorSpy.mockRestore();
    });
});
