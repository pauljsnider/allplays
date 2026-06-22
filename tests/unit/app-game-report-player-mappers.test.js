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
    dbMocks.getGame.mockResolvedValue({ id: 'game-1', summary: '', opponentStats: {} });
    dbMocks.getPlayers.mockResolvedValue([
        { id: ' p1 ' },
        { id: ' ', name: 'Missing id' },
        null,
        { id: 'p2', name: '  Sam  ', number: ' 9 ', photoUrl: ' https://example.test/sam.png ' }
    ]);
    dbMocks.getConfigs.mockResolvedValue([]);
    dbMocks.getGameEvents.mockResolvedValue([]);
    dbMocks.getTeamStatsForGame.mockResolvedValue({});
    firebaseMocks.getDocs.mockResolvedValue(snapshot([
        { id: 'p1', data: { stats: { pts: 3 }, timeMs: 0 } },
        { id: 'p2', data: { stats: {}, timeMs: 0, didNotPlay: true } }
    ]));
});

describe('React app game report player mapping', () => {
    it('filters invalid roster records and defaults missing optional player fields', async () => {
        const report = await loadGameReportSections('team-1', 'game-1');

        expect(report.playerRows).toHaveLength(2);
        expect(report.playerRows[0]).toMatchObject({
            playerId: 'p1',
            playerName: 'Player',
            number: '-',
            stats: { pts: 3 }
        });
        expect(report.playerRows[1]).toMatchObject({
            playerId: 'p2',
            playerName: 'Sam',
            number: '9',
            photoUrl: 'https://example.test/sam.png',
            didNotPlay: true
        });
        expect(report.playerRows.map((player) => player.playerId)).toEqual(['p1', 'p2']);
        expect(report.visiblePlayerRows.map((player) => player.playerId)).toEqual(['p1', 'p2']);
        expect(report.deferredPlayerRows).toEqual([]);
    });
});
