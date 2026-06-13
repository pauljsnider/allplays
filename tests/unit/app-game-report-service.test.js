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

function snapshot(docs) {
    return {
        forEach(callback) {
            docs.forEach((entry) => {
                callback({
                    id: entry.id,
                    data: () => entry.data
                });
            });
        }
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', sport: 'basketball' });
    dbMocks.getGame.mockResolvedValue({
        id: 'game-1',
        opponent: 'Falcons',
        status: 'completed',
        liveStatus: 'completed',
        homeScore: 42,
        awayScore: 38,
        summary: 'The Bears closed the game well.',
        opponentStats: {
            'opp-1': { name: 'Opp Guard', number: '2', pts: 8, fouls: 2 }
        }
    });
    dbMocks.getPlayers.mockResolvedValue([
        { id: 'player-1', name: 'Pat', number: '7' },
        { id: 'player-2', name: 'Sam', number: '9' }
    ]);
    dbMocks.getConfigs.mockResolvedValue([
        { id: 'cfg-1', baseType: 'basketball', columns: ['PTS', 'REB'] }
    ]);
    dbMocks.getGameEvents.mockResolvedValue([
        { id: 'play-2', playerId: 'player-2', text: 'Sam grabbed a rebound', period: 'Q2', gameTime: '4:30', timestamp: { seconds: 1779393900 } },
        { id: 'play-1', playerId: 'player-1', statKey: 'pts', value: 2, text: 'Pat scored in transition', period: 'Q1', gameTime: '8:12', timestamp: { seconds: 1779393000 } }
    ]);
    dbMocks.getTeamStatsForGame.mockResolvedValue({ turnovers: 6, assists: 11 });
    firebaseMocks.getDocs.mockResolvedValue(snapshot([
        { id: 'player-1', data: { stats: { pts: 12, reb: 5, fouls: 1 }, timeMs: 1200000 } },
        { id: 'player-2', data: { stats: { pts: 4, reb: 2 }, timeMs: 900000 } }
    ]));
});

describe('React app game report service', () => {
    it('loads game.html report sections from the existing data contracts', async () => {
        const report = await loadGameReportSections('team-1', 'game-1');

        expect(dbMocks.getTeam).toHaveBeenCalledWith('team-1', { includeInactive: true });
        expect(dbMocks.getGame).toHaveBeenCalledWith('team-1', 'game-1');
        expect(dbMocks.getPlayers).toHaveBeenCalledWith('team-1', { includeInactive: true });
        expect(firebaseMocks.collection).toHaveBeenCalledWith(firebaseMocks.db, 'teams/team-1/games/game-1/aggregatedStats');
        expect(dbMocks.getGameEvents).toHaveBeenCalledWith('team-1', 'game-1', { limit: 100 });
        expect(dbMocks.getTeamStatsForGame).toHaveBeenCalledWith('team-1', 'game-1');

        expect(report.summary).toBe('The Bears closed the game well.');
        expect(report.statKeys).toEqual(['pts', 'reb', 'fouls']);
        expect(report.playerRows[0]).toMatchObject({
            playerId: 'player-1',
            playerName: 'Pat',
            stats: { pts: 12, reb: 5, fouls: 1 },
            timeMs: 1200000
        });
        expect(report.hasPlayingTime).toBe(true);
        expect(report.plays.map((play) => play.id)).toEqual(['play-1', 'play-2']);
        expect(report.opponentRows[0]).toMatchObject({
            id: 'opp-1',
            name: 'Opp Guard',
            stats: { pts: 8, fouls: 2 }
        });
        expect(report.teamStats).toEqual({ turnovers: 6, assists: 11 });
        expect(report.teamStatKeys).toEqual(['turnovers', 'assists']);
        expect(report.teamInsights.some((insight) => insight.title === 'Offensive catalyst')).toBe(true);
    });

    it('keeps the report shell usable when optional report subcollections fail', async () => {
        dbMocks.getConfigs.mockRejectedValue(new Error('configs unavailable'));
        dbMocks.getGameEvents.mockRejectedValue(new Error('events unavailable'));
        dbMocks.getTeamStatsForGame.mockRejectedValue(new Error('team stats unavailable'));
        firebaseMocks.getDocs.mockRejectedValue(new Error('stats unavailable'));

        const report = await loadGameReportSections('team-1', 'game-1');

        expect(report.playerRows).toHaveLength(2);
        expect(report.playerRows[0].stats).toEqual({});
        expect(report.plays).toEqual([]);
        expect(report.teamStats).toEqual({});
        expect(report.statKeys).toEqual(['ast', 'fouls', 'pts', 'rebs']);
        expect(report.emptyInsightsMessage).toContain('No post-game insights');
    });

    it('throws a clear error when the game report does not exist', async () => {
        dbMocks.getGame.mockResolvedValue(null);

        await expect(loadGameReportSections('team-1', 'missing-game')).rejects.toThrow('Game not found');
    });
});
