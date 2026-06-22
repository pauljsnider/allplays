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
        { id: 'p1', name: 'Ava', number: '23' },
        { id: 'p2', name: 'Ben', number: '8' }
    ]);
    dbMocks.getConfigs.mockResolvedValue([]);
    dbMocks.getGameEvents.mockResolvedValue([]);
    dbMocks.getTeamStatsForGame.mockResolvedValue({
        assists: 11,
        note: 'balanced',
        verified: false,
        nested: { ignored: true },
        invalidNumber: Number.NaN
    });
    firebaseMocks.getDocs.mockResolvedValue(snapshot([
        {
            id: 'p1',
            data: {
                stats: {
                    pts: 14,
                    note: 'starter',
                    verified: true,
                    empty: null,
                    nested: { ignored: true },
                    invalidNumber: Number.NaN
                },
                timeMs: '900000',
                didNotPlay: false,
                participated: true,
                participationStatus: ' appeared ',
                participationSource: ' standard-tracker '
            }
        },
        {
            id: 'p2',
            data: {}
        }
    ]));
});

describe('React app game report stats mapping', () => {
    it('normalizes aggregated and team stat documents before report assembly', async () => {
        const report = await loadGameReportSections('team-1', 'game-1');

        expect(report.playerRows[0]).toMatchObject({
            playerId: 'p1',
            stats: {
                pts: 14,
                note: 'starter',
                verified: true,
                empty: null
            },
            timeMs: 900000,
            didNotPlay: false,
            participated: true,
            participationStatus: 'appeared',
            participationSource: 'standard-tracker'
        });
        expect(report.playerRows[0].stats).not.toHaveProperty('nested');
        expect(report.playerRows[0].stats).not.toHaveProperty('invalidNumber');
        expect(report.playerRows[1]).toMatchObject({
            playerId: 'p2',
            stats: {},
            timeMs: 0,
            didNotPlay: false,
            participated: false,
            participationStatus: '',
            participationSource: ''
        });
        expect(report.teamStats).toEqual({
            assists: 11,
            note: 'balanced',
            verified: false
        });
        expect(report.visiblePlayerRows.map((player) => player.playerId)).toEqual(['p1', 'p2']);
    });
});
