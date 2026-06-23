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
  collection: vi.fn(() => 'aggregated-stats-ref'),
  db: {},
  getDocs: vi.fn()
}));

const gameReportStatsMocks = vi.hoisted(() => ({
  resolveReportStatColumns: vi.fn(() => ({ statKeys: [], statLabels: {} })),
  resolveOpponentReportStatColumns: vi.fn(() => ({ oppKeys: [], oppLabels: {} }))
}));

vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/firebase.js', () => firebaseMocks);
vi.mock('../../../../js/game-report-stats.js', () => gameReportStatsMocks);
vi.mock('../../../../js/live-game-video.js', () => ({
  buildHighlightShareUrl: vi.fn(() => ''),
  normalizeGameRecapHighlightClips: vi.fn(() => [])
}));
vi.mock('../../../../js/live-game-state.js', () => ({
  resolveLiveStatConfig: vi.fn(() => ({}))
}));
vi.mock('../../../../js/post-game-insights.js', () => ({
  generateGameInsights: vi.fn(() => ({ teamInsights: [], playerInsightsById: {}, emptyMessage: '' }))
}));
vi.mock('../../../../js/post-game-stat-editor.js', () => ({
  resolvePostGameTeamStatFields: vi.fn(() => [])
}));

import { loadGameReportSections } from './gameReportService';

describe('gameReportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Falcons' });
    dbMocks.getGame.mockResolvedValue({ id: 'game-1', summary: 'Final' });
    dbMocks.getPlayers.mockResolvedValue([
      { id: 'player-recorded', name: 'Recorded Player', number: '3' },
      { id: 'player-deferred', name: 'Deferred Player', number: '9' }
    ]);
    dbMocks.getConfigs.mockResolvedValue([]);
    dbMocks.getGameEvents.mockResolvedValue([]);
    dbMocks.getTeamStatsForGame.mockResolvedValue({});
    firebaseMocks.getDocs.mockResolvedValue({
      forEach(callback: (docSnap: any) => void) {
        callback({
          id: 'player-recorded',
          data: () => ({
            stats: {},
            timeMs: 0,
            didNotPlay: false,
            participated: false,
            participationStatus: '',
            participationSource: ''
          })
        });
      }
    });
  });

  it('keeps recorded players visible even when they have no explicit participation markers', async () => {
    const report = await loadGameReportSections('team-1', 'game-1');

    expect(report.visiblePlayerRows.map((player) => player.playerId)).toEqual(['player-recorded']);
    expect(report.deferredPlayerRows.map((player) => player.playerId)).toEqual(['player-deferred']);
  });

  it('normalizes malformed and partial Firestore stats payloads at the mapper boundary', async () => {
    dbMocks.getGame.mockResolvedValue({
      id: 'game-1',
      summary: 42,
      statSheetPhotoUrl: 123,
      opponentStats: {
        'opp-1': {
          name: ' Opponent Guard ',
          number: 5,
          notes: ' linked ',
          playerId: ' opponent-player-1 ',
          pts: 11,
          fouls: '2',
          assists: { invalid: true },
          photoUrl: ' https://img.example.test/opponent.png '
        },
        'opp-2': 'bad-payload'
      }
    });
    dbMocks.getTeamStatsForGame.mockResolvedValue({ turnovers: 7, assists: '11', nested: { invalid: true } });
    dbMocks.getGameEvents.mockResolvedValue([
      { id: 'event-late', message: 'Late bucket', period: '', gameTime: '0:12', timestamp: { seconds: 1717200060 } },
      { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: 1717200000000 },
      { id: '', text: 'Missing id' }
    ]);
    firebaseMocks.getDocs.mockResolvedValue({
      forEach(callback: (docSnap: any) => void) {
        callback({
          id: 'player-recorded',
          data: () => ({
            stats: { pts: 14, rebounds: '6', bogus: { nope: true }, tech: false },
            timeMs: '900000',
            didNotPlay: 'no',
            participated: true,
            participationStatus: 8,
            participationSource: null
          })
        });
      }
    });

    const report = await loadGameReportSections('team-1', 'game-1');

    expect(report.summary).toBe('42');
    expect(report.statSheetPhotoUrl).toBe('123');
    expect(report.playerRows[0]).toMatchObject({
      playerId: 'player-recorded',
      stats: { pts: 14, rebounds: '6', tech: false },
      timeMs: 900000,
      didNotPlay: false,
      participated: true,
      participationStatus: '8',
      participationSource: ''
    });
    expect(report.opponentRows).toEqual([
      {
        id: 'opp-1',
        name: 'Opponent Guard',
        number: '5',
        photoUrl: 'https://img.example.test/opponent.png',
        stats: { pts: 11, fouls: '2' }
      },
      {
        id: 'opp-2',
        name: 'Opponent Player',
        number: '-',
        photoUrl: undefined,
        stats: {}
      }
    ]);
    expect(gameReportStatsMocks.resolveOpponentReportStatColumns).toHaveBeenCalledWith(expect.objectContaining({
      opponentStats: {
        'opp-1': { pts: 11, fouls: '2' },
        'opp-2': {}
      }
    }));
    expect(report.teamStats).toEqual({ turnovers: 7, assists: '11' });
    expect(report.plays).toEqual([
      {
        id: 'event-early',
        text: 'Opening tip',
        period: 'Q1',
        clock: '8:00',
        timestamp: new Date(1717200000 * 1000)
      },
      {
        id: 'event-late',
        text: 'Late bucket',
        period: 'Q1',
        clock: '0:12',
        timestamp: new Date(1717200060 * 1000)
      }
    ]);
  });
});
