import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getConfigs: vi.fn(),
    getGame: vi.fn(),
    getGameEvents: vi.fn(),
    getPlayers: vi.fn(),
    getTeam: vi.fn(),
    getTeamStatsForGame: vi.fn()
}));

const firebaseMocks = vi.hoisted(() => ({
    db: {},
    collection: vi.fn((db, path) => ({ db, path })),
    getDocs: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/firebase.js', () => firebaseMocks);

import { loadGameReportSections } from '../../apps/app/src/lib/gameReportService.ts';

function emptySnapshot() {
    return {
        forEach() {}
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getTeam.mockResolvedValue({});
    dbMocks.getGame.mockResolvedValue({});
    dbMocks.getPlayers.mockResolvedValue([]);
    dbMocks.getConfigs.mockResolvedValue([]);
    dbMocks.getGameEvents.mockResolvedValue([]);
    dbMocks.getTeamStatsForGame.mockResolvedValue({});
    firebaseMocks.getDocs.mockResolvedValue(emptySnapshot());
});

describe('React app game report metadata mapping', () => {
    it('uses mapper fallbacks when optional team and game metadata is absent', async () => {
        const report = await loadGameReportSections('team-1', 'game-1');

        expect(report.team).toMatchObject({
            id: 'team-1',
            name: null,
            sport: null
        });
        expect(report.game).toMatchObject({
            id: 'game-1',
            summary: null,
            statSheetPhotoUrl: null,
            opponentStats: {}
        });
        expect(report.summary).toBe('');
        expect(report.statSheetPhotoUrl).toBe('');
        expect(report.opponentRows).toEqual([]);
        expect(report.playerRows).toEqual([]);
        expect(dbMocks.getTeam).toHaveBeenCalledWith('team-1', { includeInactive: true });
        expect(dbMocks.getGame).toHaveBeenCalledWith('team-1', 'game-1');
    });
});
