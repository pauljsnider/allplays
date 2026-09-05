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
  collection: vi.fn((_db: unknown, path: string) => path),
  db: {},
  getDocs: vi.fn()
}));

const gameReportStatsMocks = vi.hoisted(() => ({
  resolveReportStatColumns: vi.fn(() => ({ statKeys: [] as string[], statLabels: {} as Record<string, string>, statDefinitions: {} as Record<string, Record<string, unknown>> })),
  resolveOpponentReportStatColumns: vi.fn(() => ({ oppKeys: [] as string[], oppLabels: {} as Record<string, string>, oppDefinitions: {} as Record<string, Record<string, unknown>> }))
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

import { loadGameReportPlays, loadGameReportSections } from './gameReportService';

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

  it('loads only bounded game events and game status for play-by-play refreshes', async () => {
    dbMocks.getGame.mockResolvedValue({ id: 'game-1', status: 'completed', liveStatus: 'completed', homeScore: 43, awayScore: 40 });
    dbMocks.getGameEvents.mockResolvedValue([
      { id: 'event-late', message: 'Late bucket', period: '', gameTime: '0:12', timestamp: { seconds: 1717200060 } },
      { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: 1717200000000 },
      { id: '', text: 'Missing id' },
      'bad-event'
    ]);

    const plays = await loadGameReportPlays('team-1', 'game-1');

    expect(dbMocks.getGameEvents).toHaveBeenCalledWith('team-1', 'game-1', { limit: 100 });
    expect(dbMocks.getGame).toHaveBeenCalledWith('team-1', 'game-1');
    expect(dbMocks.getTeam).not.toHaveBeenCalled();
    expect(dbMocks.getPlayers).not.toHaveBeenCalled();
    expect(dbMocks.getConfigs).not.toHaveBeenCalled();
    expect(firebaseMocks.getDocs).not.toHaveBeenCalled();
    expect(dbMocks.getTeamStatsForGame).not.toHaveBeenCalled();
    expect(plays).toEqual({
      game: expect.objectContaining({
        id: 'game-1',
        status: 'completed',
        liveStatus: 'completed',
        homeScore: 43,
        awayScore: 40
      }),
      plays: [
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
      ],
      playsFresh: true
    });
  });

  it('keeps game status refreshes available when the optional event read fails', async () => {
    dbMocks.getGame.mockResolvedValue({ id: 'game-1', status: 'completed', liveStatus: 'live', homeScore: 43, awayScore: 40 });
    dbMocks.getGameEvents.mockRejectedValue(new Error('temporary event read failure'));

    const refresh = await loadGameReportPlays('team-1', 'game-1');

    expect(dbMocks.getGameEvents).toHaveBeenCalledWith('team-1', 'game-1', { limit: 100 });
    expect(refresh).toEqual({
      game: expect.objectContaining({
        id: 'game-1',
        status: 'completed',
        liveStatus: 'live',
        homeScore: 43,
        awayScore: 40
      }),
      plays: [],
      playsFresh: false
    });
  });

  it('preserves Diamond complete, observed, and unavailable evidence with source revisions', async () => {
    dbMocks.getGame.mockResolvedValue({
      id: 'game-1',
      trackingEngine: 'diamond-v2',
      diamondProjectionStatus: 'current',
      diamondProjectionRevision: 7,
      opponentStats: {
        visitor: {
          name: 'Visiting Batter',
          h: 0,
          sb: 1,
          diamondCoverage: { batting: 'complete', baserunning: 'partial' },
          diamondSourceRevision: 7
        }
      }
    });
    gameReportStatsMocks.resolveReportStatColumns.mockReturnValue({
      statKeys: ['h', 'sb', 'era'],
      statLabels: { h: 'H', sb: 'SB', era: 'ERA' },
      statDefinitions: { h: { id: 'h', precision: 0 }, sb: { id: 'sb', precision: 0 }, era: { id: 'era', precision: 2 } }
    });
    gameReportStatsMocks.resolveOpponentReportStatColumns.mockReturnValue({
      oppKeys: ['h', 'sb', 'era'],
      oppLabels: { h: 'H', sb: 'SB', era: 'ERA' },
      oppDefinitions: { h: { id: 'h' }, sb: { id: 'sb' }, era: { id: 'era', precision: 2 } }
    });
    firebaseMocks.getDocs.mockImplementation(async (path: string) => {
      const documents = path.endsWith('/teamStats')
        ? [{
            id: 'team',
            data: () => ({
              trackingEngine: 'diamond-v2',
              sourceRevision: 7,
              complete: true,
              stats: { r: 3 },
              observedStats: { h: 2 },
              statCoverage: { r: 'complete', h: 'partial', e: 'not_collected' }
            })
          }]
        : [{
            id: 'player-recorded',
            data: () => ({
              trackingEngine: 'diamond-v2',
              sourceRevision: 7,
              complete: true,
              stats: { h: 0, pitches: 81 },
              observedStats: { sb: 2 },
              statCoverage: { h: 'complete', pitches: 'complete', sb: 'partial', era: 'not_collected' },
              participated: true
            })
          }];
      return {
        docs: documents,
        forEach(callback: (docSnap: any) => void) {
          documents.forEach(callback);
        }
      };
    });

    const report = await loadGameReportSections('team-1', 'game-1');

    expect(report.playerRows[0]).toMatchObject({
      stats: { h: 0, sb: 2 },
      statPresentation: {
        statCoverage: { h: 'complete', sb: 'partial', era: 'not_collected' },
        observedStatKeys: ['sb'],
        sourceRevision: 7
      }
    });
    expect(report.playerRows[0].stats).not.toHaveProperty('pitches');
    expect(report.teamStats).toEqual({ r: 3, h: 2 });
    expect(report.opponentRows[0]).toMatchObject({
      stats: { h: 0, sb: 1 },
      statPresentation: { sourceRevision: 7, observedStatKeys: ['sb'] }
    });
    expect(report.diamond).toEqual({
      isDiamond: true,
      readOnly: true,
      status: 'current',
      pending: false,
      authoritativeRevision: 7,
      sourceRevisions: [7]
    });
  });
});
