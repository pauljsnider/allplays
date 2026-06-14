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

vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/firebase.js', () => firebaseMocks);
vi.mock('../../../../js/game-report-stats.js', () => ({
  resolveReportStatColumns: vi.fn(() => ({ statKeys: [], statLabels: {} })),
  resolveOpponentReportStatColumns: vi.fn(() => ({ oppKeys: [], oppLabels: {} }))
}));
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
});
