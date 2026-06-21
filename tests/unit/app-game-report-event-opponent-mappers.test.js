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
        summary: null,
        statSheetPhotoUrl: { malformed: true },
        opponentStats: {
            'opp-1': {
                name: '',
                number: '',
                pts: 9,
                active: true,
                notes: 'box-and-one',
                nested: { ignored: true }
            },
            'opp-2': null
        }
    });
    dbMocks.getPlayers.mockResolvedValue([{ id: 'player-1', name: 'Pat', number: '7' }]);
    dbMocks.getConfigs.mockResolvedValue([]);
    dbMocks.getGameEvents.mockResolvedValue([
        { id: 'event-2', text: ' Later basket ', period: 'Q2', clock: ' 02:00 ', timestamp: { seconds: 2 } },
        { id: 'event-1', message: ' Opening tip ', period: '', gameTime: ' 08:00 ', timestamp: 'not-a-date' },
        { id: '', text: 'Missing event id' }
    ]);
    dbMocks.getTeamStatsForGame.mockResolvedValue({});
    firebaseMocks.getDocs.mockResolvedValue(snapshot([]));
});

describe('React app game report event and opponent mapping', () => {
    it('builds report plays and opponent rows from normalized mapper outputs', async () => {
        const report = await loadGameReportSections('team-1', 'game-1');

        expect(report.summary).toBe('');
        expect(report.statSheetPhotoUrl).toBe('');
        expect(report.plays).toEqual([
            {
                id: 'event-1',
                text: 'Opening tip',
                period: 'Q1',
                clock: '08:00',
                timestamp: null
            },
            {
                id: 'event-2',
                text: 'Later basket',
                period: 'Q2',
                clock: '02:00',
                timestamp: new Date(2000)
            }
        ]);
        expect(report.opponentRows).toEqual([
            {
                id: 'opp-1',
                name: 'Opponent Player',
                number: '-',
                photoUrl: undefined,
                stats: {
                    pts: 9,
                    active: true
                }
            },
            {
                id: 'opp-2',
                name: 'Opponent Player',
                number: '-',
                photoUrl: undefined,
                stats: {}
            }
        ]);
    });
});
