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

const liveGameStateMocks = vi.hoisted(() => ({
  resolveLiveStatConfig: vi.fn((input?: any) => input?.configs?.[0] || ({ diamondPublicTeamStatIds: ['r'] }))
}));

const diamondFirebaseMocks = vi.hoisted(() => ({
  functions: {},
  getPublicDiamondGame: vi.fn(),
  getDiamondManagerStats: vi.fn(),
  httpsCallable: vi.fn()
}));
const diamondScorebookMocks = vi.hoisted(() => ({
  getDiamondPrivateHistoryWindow: vi.fn(),
  getDiamondState: vi.fn()
}));
const diamondStatConfigSnapshotMocks = vi.hoisted(() => ({
  buildActivationPinnedDiamondPresentationConfig: vi.fn((config: any) => config),
  currentDiamondStatConfigMatchesActivation: vi.fn((_input?: any) => true)
}));

vi.mock('../../../../js/db.js', () => dbMocks);
vi.mock('../../../../js/firebase.js', () => firebaseMocks);
vi.mock('./adapters/legacyDiamondScorebookFirebase', () => ({
  functions: diamondFirebaseMocks.functions,
  httpsCallable: diamondFirebaseMocks.httpsCallable
}));
vi.mock('./diamondScorebookService', () => diamondScorebookMocks);
vi.mock('./diamondStatConfigSnapshot', () => diamondStatConfigSnapshotMocks);
vi.mock('../../../../js/game-report-stats.js', () => gameReportStatsMocks);
vi.mock('../../../../js/live-game-video.js', () => ({
  buildHighlightShareUrl: vi.fn(() => ''),
  normalizeGameRecapHighlightClips: vi.fn(() => [])
}));
vi.mock('../../../../js/live-game-state.js', () => liveGameStateMocks);
vi.mock('../../../../js/post-game-insights.js', () => ({
  generateGameInsights: vi.fn(() => ({ teamInsights: [], playerInsightsById: {}, emptyMessage: '' }))
}));
vi.mock('../../../../js/post-game-stat-editor.js', () => ({
  resolvePostGameTeamStatFields: vi.fn(() => [])
}));

import { loadGameReportPlays, loadGameReportSections, normalizePublishedDiamondAiRecap } from './gameReportService';

function configureCurrentDiamondReportFixture({
  configId = 'diamond-config',
  playerPublicStatIds = ['h'],
  playerStats = { h: 2 },
  teamPublicStatIds = ['r'],
  teamStats = { r: 1 }
}: {
  configId?: string;
  playerPublicStatIds?: string[];
  playerStats?: Record<string, number>;
  teamPublicStatIds?: string[];
  teamStats?: Record<string, number>;
} = {}) {
  const instanceId = '00000000-0000-4000-8000-000000000001';
  const checkpointHash = `sha256:${'a'.repeat(64)}`;
  const configHash = `sha256:${'b'.repeat(64)}`;
  const projectionHash = `sha256:${'c'.repeat(64)}`;
  dbMocks.getGame.mockResolvedValue({
    id: 'game-1',
    teamId: 'team-1',
    sport: 'baseball',
    trackingEngine: 'diamond-v2',
    statTrackerConfigId: configId,
    diamondProjectionStatus: 'current',
    diamondProjectionRevision: 7,
    diamondProjectionComplete: true,
    diamondScorebookInstanceId: instanceId,
    diamondProjectionCheckpointHash: checkpointHash,
    diamondStatConfigSnapshotHash: configHash,
    diamondProjectionHash: projectionHash,
    diamondPublicTeamStats: {
      trackingEngine: 'diamond-v2',
      projectionSchemaVersion: 1,
      sourceRevision: 7,
      checkpointHash,
      coverage: { batting: 'complete' },
      publicStatIds: teamPublicStatIds,
      side: 'home',
      complete: true,
      stats: teamStats,
      observedStats: {},
      statCoverage: Object.fromEntries(teamPublicStatIds.map((id) => [id, 'complete'])),
      teamId: 'team-1',
      diamondGameId: 'game-1',
      instanceId,
      diamondScorebookInstanceId: instanceId,
      projectionGeneration: instanceId,
      statConfigSnapshotHash: configHash,
      projectionHash
    }
  });
  firebaseMocks.getDocs.mockResolvedValue({
    forEach(callback: (docSnap: any) => void) {
      callback({
        id: 'player-recorded',
        data: () => ({
          schemaVersion: 1,
          trackingEngine: 'diamond-v2',
          projectionSchemaVersion: 1,
          playerId: 'player-recorded',
          playerName: 'Recorded Player',
          playerNumber: '3',
          sourceRevision: 7,
          checkpointHash,
          complete: true,
          publicStatIds: playerPublicStatIds,
          stats: playerStats,
          observedStats: {},
          derivedStats: {},
          observedDerivedStats: {},
          statCoverage: Object.fromEntries(playerPublicStatIds.map((id) => [id, 'complete'])),
          statSources: {},
          sourcePlayIds: [],
          unavailableDerivedStats: [],
          missingStatFamilies: [],
          coverage: { batting: 'complete' },
          participated: true,
          participationStatus: 'appeared',
          participationSource: 'diamond-v2',
          teamId: 'team-1',
          diamondGameId: 'game-1',
          instanceId,
          diamondScorebookInstanceId: instanceId,
          projectionGeneration: instanceId,
          statConfigSnapshotHash: configHash,
          projectionHash
        })
      });
    }
  });
}

function buildPublicDiamondConfig() {
  return {
    id: 'diamond-config',
    baseType: 'baseball',
    columns: ['H'],
    diamondPublicTeamStatIds: ['r'],
    statDefinitions: [{ id: 'h', label: 'H', scope: 'player', visibility: 'public' }]
  };
}

describe('gameReportService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    diamondStatConfigSnapshotMocks.buildActivationPinnedDiamondPresentationConfig.mockImplementation((config: any) => config);
    diamondStatConfigSnapshotMocks.currentDiamondStatConfigMatchesActivation.mockReturnValue(true);
    liveGameStateMocks.resolveLiveStatConfig.mockImplementation((input?: any) => input?.configs?.[0] || ({ diamondPublicTeamStatIds: ['r'] }));
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
    diamondFirebaseMocks.getPublicDiamondGame.mockResolvedValue({
      data: {
        instanceId: '00000000-0000-4000-8000-000000000001',
        sourceRevision: 7,
        projectionToken: `current:7:sha256:${'c'.repeat(64)}`,
        events: [],
        nextCursor: null,
        complete: true,
        truncated: false
      }
    });
    diamondFirebaseMocks.getDiamondManagerStats.mockRejectedValue(new Error('manager stats not configured'));
    diamondScorebookMocks.getDiamondState.mockResolvedValue({
      instanceId: '00000000-0000-4000-8000-000000000001',
      revision: 7
    });
    diamondScorebookMocks.getDiamondPrivateHistoryWindow.mockResolvedValue({
      sourceRevision: 7,
      oldestSequence: 1,
      newestSequence: 7,
      contiguous: true,
      rangeComplete: true,
      headComplete: true,
      historyComplete: true,
      hasOlder: false,
      items: []
    });
    diamondFirebaseMocks.httpsCallable.mockImplementation((_functions: unknown, name: string) => (
      name === 'getPublicDiamondGame'
        ? diamondFirebaseMocks.getPublicDiamondGame
        : diamondFirebaseMocks.getDiamondManagerStats
    ));
  });

  it('accepts only bounded, cited, published Diamond AI artifacts', () => {
    expect(normalizePublishedDiamondAiRecap({
      schemaVersion: 1,
      trackingEngine: 'diamond-v2',
      published: true,
      status: 'current',
      stale: false,
      sourceRevision: 12,
      publishedAt: '2026-09-05T20:00:00.000Z',
      recap: {
        text: 'The Falcons won 4-3.',
        citations: [{ eventId: 'event-12', revision: 12 }]
      },
      insights: [{
        text: 'Avery recorded 2 hits.',
        citations: [{ eventId: 'event-8', revision: 8 }]
      }],
      coverage: { batting: 'complete', fielding: 'partial', sensors: 'not_collected' },
      dataQualityNotes: ['Fielding detail was partially captured.']
    })).toMatchObject({
      current: true,
      sourceRevision: 12,
      recap: { text: 'The Falcons won 4-3.' },
      insights: [{ text: 'Avery recorded 2 hits.' }],
      coverage: { batting: 'complete', fielding: 'partial', sensors: 'not_collected' }
    });
    expect(normalizePublishedDiamondAiRecap({
      schemaVersion: 1,
      trackingEngine: 'diamond-v2',
      published: true,
      sourceRevision: 12,
      recap: { text: 'Uncited claim', citations: [] }
    })).toBeNull();
  });

  it('accepts a complete empty config catalog for a legacy report and keeps recorded players visible', async () => {
    const report = await loadGameReportSections('team-1', 'game-1');

    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(1);
    expect(report.visiblePlayerRows.map((player) => player.playerId)).toEqual(['player-recorded']);
    expect(report.deferredPlayerRows.map((player) => player.playerId)).toEqual(['player-deferred']);
  });

  it('retries one transient Diamond config failure and keeps the resolved public stats', async () => {
    configureCurrentDiamondReportFixture();
    const config = buildPublicDiamondConfig();
    dbMocks.getConfigs
      .mockRejectedValueOnce(new Error('temporary config read failure'))
      .mockResolvedValueOnce([config]);
    liveGameStateMocks.resolveLiveStatConfig.mockImplementationOnce(({ configs }: { configs: any[] }) => configs[0] || null);
    gameReportStatsMocks.resolveReportStatColumns.mockReturnValueOnce({
      statKeys: ['h'],
      statLabels: { h: 'H' },
      statDefinitions: { h: { id: 'h', label: 'H', scope: 'player', visibility: 'public' } }
    });

    const report = await loadGameReportSections('team-1', 'game-1');

    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(2);
    expect(report.statKeys).toEqual(['h']);
    expect(report.playerRows[0].stats).toEqual({ h: 2 });
    expect(report.teamStatKeys).toEqual(['r']);
    expect(report.teamStats).toEqual({ r: 1 });
  });

  it('retries an initially empty Diamond config read and resolves the exact config before rendering stats', async () => {
    configureCurrentDiamondReportFixture();
    const config = buildPublicDiamondConfig();
    dbMocks.getConfigs
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([config]);
    liveGameStateMocks.resolveLiveStatConfig.mockImplementationOnce(({ configs }: { configs: any[] }) => configs[0] || null);
    gameReportStatsMocks.resolveReportStatColumns.mockReturnValueOnce({
      statKeys: ['h'],
      statLabels: { h: 'H' },
      statDefinitions: { h: { id: 'h', label: 'H', scope: 'player', visibility: 'public' } }
    });

    const report = await loadGameReportSections('team-1', 'game-1');

    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(2);
    expect(report.playerRows[0].stats).toEqual({ h: 2 });
    expect(report.teamStats).toEqual({ r: 1 });
  });

  it('rejects a Diamond report after two failed config reads instead of returning empty stats', async () => {
    configureCurrentDiamondReportFixture();
    dbMocks.getConfigs.mockRejectedValue(new Error('config read unavailable'));

    await expect(loadGameReportSections('team-1', 'game-1')).rejects.toThrow(
      'Diamond statistic definitions are temporarily unavailable. Retry the report.'
    );
    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(2);
    expect(liveGameStateMocks.resolveLiveStatConfig).not.toHaveBeenCalled();
  });

  it('requires the exact referenced Diamond config instead of using another same-sport config', async () => {
    configureCurrentDiamondReportFixture();
    dbMocks.getConfigs.mockResolvedValue([{
      id: 'different-baseball-config',
      baseType: 'baseball',
      columns: ['H'],
      diamondPublicTeamStatIds: ['r']
    }]);

    await expect(loadGameReportSections('team-1', 'game-1')).rejects.toThrow(
      'Diamond statistic definitions are temporarily unavailable. Retry the report.'
    );
    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(2);
    expect(liveGameStateMocks.resolveLiveStatConfig).not.toHaveBeenCalled();
  });

  it('rejects a same-ID Diamond config whose activation-pinned snapshot hash no longer matches', async () => {
    configureCurrentDiamondReportFixture();
    const mutatedConfig = {
      ...buildPublicDiamondConfig(),
      statDefinitions: [{ id: 'h', label: 'H', scope: 'player', visibility: 'private' }]
    };
    dbMocks.getConfigs.mockResolvedValue([mutatedConfig]);
    diamondStatConfigSnapshotMocks.currentDiamondStatConfigMatchesActivation.mockReturnValue(false);

    await expect(loadGameReportSections('team-1', 'game-1')).rejects.toThrow(
      'Diamond statistic definitions are temporarily unavailable. Retry the report.'
    );

    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(2);
    expect(diamondStatConfigSnapshotMocks.currentDiamondStatConfigMatchesActivation).toHaveBeenCalledTimes(2);
    expect(diamondStatConfigSnapshotMocks.currentDiamondStatConfigMatchesActivation).toHaveBeenLastCalledWith({
      teamId: 'team-1',
      game: expect.objectContaining({
        statTrackerConfigId: 'diamond-config',
        diamondStatConfigSnapshotHash: `sha256:${'b'.repeat(64)}`
      }),
      config: mutatedConfig
    });
    expect(liveGameStateMocks.resolveLiveStatConfig).not.toHaveBeenCalled();
  });

  it('does not cache an unresolved empty Diamond config read as authoritative absence', async () => {
    configureCurrentDiamondReportFixture();
    const config = buildPublicDiamondConfig();
    dbMocks.getConfigs
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([config]);
    liveGameStateMocks.resolveLiveStatConfig.mockImplementationOnce(({ configs }: { configs: any[] }) => configs[0] || null);
    gameReportStatsMocks.resolveReportStatColumns.mockReturnValueOnce({
      statKeys: ['h'],
      statLabels: { h: 'H' },
      statDefinitions: { h: { id: 'h', label: 'H', scope: 'player', visibility: 'public' } }
    });

    await expect(loadGameReportSections('team-1', 'game-1')).rejects.toThrow(
      'Diamond statistic definitions are temporarily unavailable. Retry the report.'
    );
    const recoveredReport = await loadGameReportSections('team-1', 'game-1');

    expect(recoveredReport.diamond).toMatchObject({ isDiamond: true });
    expect(recoveredReport.playerRows[0].stats).toEqual({ h: 2 });
    expect(recoveredReport.teamStats).toEqual({ r: 1 });
    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(3);
  });

  it('accepts a resolved Diamond config whose complete public allowlist is intentionally empty', async () => {
    configureCurrentDiamondReportFixture({
      playerPublicStatIds: [],
      playerStats: {},
      teamPublicStatIds: [],
      teamStats: {}
    });
    const config = {
      id: 'diamond-config',
      baseType: 'baseball',
      columns: ['H'],
      statDefinitions: [{ id: 'h', label: 'H', scope: 'player', visibility: 'manager-internal' }]
    };
    dbMocks.getConfigs.mockResolvedValue([config]);
    liveGameStateMocks.resolveLiveStatConfig.mockImplementationOnce(({ configs }: { configs: any[] }) => configs[0] || null);

    const report = await loadGameReportSections('team-1', 'game-1');

    expect(dbMocks.getConfigs).toHaveBeenCalledTimes(1);
    expect(report.statKeys).toEqual([]);
    expect(report.playerRows[0].stats).toEqual({});
    expect(report.teamStatKeys).toEqual([]);
    expect(report.teamStats).toEqual({});
    expect(report.diamond).toMatchObject({ isDiamond: true, pending: false });
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
    const instanceId = '00000000-0000-4000-8000-000000000001';
    const checkpointHash = `sha256:${'a'.repeat(64)}`;
    const configHash = `sha256:${'b'.repeat(64)}`;
    const projectionHash = `sha256:${'c'.repeat(64)}`;
    dbMocks.getConfigs.mockResolvedValue([buildPublicDiamondConfig()]);
    dbMocks.getGame.mockResolvedValue({
      id: 'game-1',
      teamId: 'team-1',
      statTrackerConfigId: 'diamond-config',
      trackingEngine: 'diamond-v2',
      diamondProjectionStatus: 'current',
      diamondProjectionRevision: 7,
      diamondProjectionComplete: true,
      diamondScorebookInstanceId: instanceId,
      diamondProjectionCheckpointHash: checkpointHash,
      diamondStatConfigSnapshotHash: configHash,
      diamondProjectionHash: projectionHash,
      diamondPublicTeamStats: {
        trackingEngine: 'diamond-v2',
        projectionSchemaVersion: 1,
        sourceRevision: 7,
        checkpointHash,
        coverage: { batting: 'complete' },
        publicStatIds: ['r'],
        side: 'home',
        complete: true,
        stats: { r: 3 },
        observedStats: {},
        statCoverage: { r: 'complete' },
        teamId: 'team-1',
        diamondGameId: 'game-1',
        instanceId,
        diamondScorebookInstanceId: instanceId,
        projectionGeneration: instanceId,
        statConfigSnapshotHash: configHash,
        projectionHash
      },
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
    firebaseMocks.getDocs.mockImplementation(async () => {
      const documents = [{
            id: 'player-recorded',
            data: () => ({
              schemaVersion: 1,
              trackingEngine: 'diamond-v2',
              projectionSchemaVersion: 1,
              playerId: 'player-recorded',
              playerName: 'Recorded Player',
              playerNumber: '3',
              sourceRevision: 7,
              checkpointHash,
              complete: true,
              publicStatIds: ['era', 'h', 'sb'],
              stats: { h: 0 },
              observedStats: { sb: 2 },
              derivedStats: {},
              observedDerivedStats: {},
              statCoverage: { era: 'not_collected', h: 'complete', sb: 'partial' },
              statSources: {},
              sourcePlayIds: [],
              unavailableDerivedStats: ['era'],
              missingStatFamilies: [],
              coverage: { batting: 'complete' },
              participated: true,
              participationStatus: 'appeared',
              participationSource: 'diamond-v2',
              teamId: 'team-1',
              diamondGameId: 'game-1',
              instanceId,
              diamondScorebookInstanceId: instanceId,
              projectionGeneration: instanceId,
              statConfigSnapshotHash: configHash,
              projectionHash
            })
          }];
      return {
        docs: documents,
        forEach(callback: (docSnap: any) => void) {
          documents.forEach(callback);
        }
      };
    });
    dbMocks.getGameEvents.mockRejectedValue(new Error('Diamond event collection is private'));
    diamondFirebaseMocks.getPublicDiamondGame
      .mockResolvedValueOnce({
        data: {
          instanceId,
          sourceRevision: 7,
          projectionToken: `current:7:${projectionHash}`,
          events: [
            {
              id: 'event-7',
              revision: 7,
              inning: 1,
              half: 'bottom',
              description: 'Recorded Player doubled',
              createdAt: '2026-09-05T20:07:00.000Z'
            }
          ],
          nextCursor: 'cursor-1',
          complete: false,
          truncated: true
        }
      })
      .mockResolvedValueOnce({
        data: {
          instanceId,
          sourceRevision: 7,
          projectionToken: `current:7:${projectionHash}`,
          events: [
            {
              id: 'event-1',
              revision: 1,
              inning: 1,
              half: 'top',
              description: 'Scorebook ready',
              createdAt: '2026-09-05T20:01:00.000Z'
            }
          ],
          nextCursor: null,
          complete: true,
          truncated: false
        }
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
    expect(report.teamStats).toEqual({ r: 3 });
    expect(report.teamStats).not.toHaveProperty('h');
    expect(report.teamStatPresentation).toMatchObject({
      statCoverage: { r: 'complete' },
      sourceRevision: 7,
      statVisibility: 'public'
    });
    expect(firebaseMocks.collection).toHaveBeenCalledWith(
      firebaseMocks.db,
      `teams/team-1/games/game-1/diamondStatGenerations/${instanceId}/publicPlayerStats`
    );
    expect(firebaseMocks.collection).not.toHaveBeenCalledWith(
      firebaseMocks.db,
      expect.stringContaining('/teamStats')
    );
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
      sourceRevisions: [7],
      requestedStatVisibility: 'public',
      statVisibility: 'public',
      requestedReplayVisibility: 'public',
      replayVisibility: 'public',
      replaySource: 'public-sanitized',
      privateStatsStatus: 'not-requested',
      privateStatsReason: null
    });
    expect(dbMocks.getGameEvents).not.toHaveBeenCalled();
    expect(diamondFirebaseMocks.httpsCallable).toHaveBeenCalledWith(
      diamondFirebaseMocks.functions,
      'getPublicDiamondGame'
    );
    expect(diamondFirebaseMocks.getPublicDiamondGame).toHaveBeenNthCalledWith(1, {
      teamId: 'team-1',
      gameId: 'game-1',
      limit: 200,
      cursor: null
    });
    expect(diamondFirebaseMocks.getPublicDiamondGame).toHaveBeenNthCalledWith(2, {
      teamId: 'team-1',
      gameId: 'game-1',
      limit: 200,
      cursor: 'cursor-1'
    });
    expect(report.plays).toEqual([
      expect.objectContaining({ id: 'event-1', text: 'Scorebook ready', period: 'Top 1' }),
      expect.objectContaining({ id: 'event-7', text: 'Recorded Player doubled', period: 'Bottom 1' })
    ]);
  });

  it('rejects incomplete Diamond replay pages instead of reporting authoritative zero plays', async () => {
    const instanceId = '00000000-0000-4000-8000-000000000001';
    const checkpointHash = `sha256:${'a'.repeat(64)}`;
    const configHash = `sha256:${'b'.repeat(64)}`;
    const projectionHash = `sha256:${'c'.repeat(64)}`;
    dbMocks.getConfigs.mockResolvedValue([buildPublicDiamondConfig()]);
    dbMocks.getGame.mockResolvedValue({
      id: 'game-1',
      teamId: 'team-1',
      statTrackerConfigId: 'diamond-config',
      trackingEngine: 'diamond-v2',
      diamondProjectionStatus: 'current',
      diamondProjectionRevision: 7,
      diamondProjectionComplete: true,
      diamondScorebookInstanceId: instanceId,
      diamondProjectionCheckpointHash: checkpointHash,
      diamondStatConfigSnapshotHash: configHash,
      diamondProjectionHash: projectionHash,
      diamondPublicTeamStats: {
        trackingEngine: 'diamond-v2',
        projectionSchemaVersion: 1,
        sourceRevision: 7,
        checkpointHash,
        coverage: {},
        publicStatIds: [],
        side: 'home',
        complete: true,
        stats: {},
        observedStats: {},
        statCoverage: {},
        teamId: 'team-1',
        diamondGameId: 'game-1',
        instanceId,
        diamondScorebookInstanceId: instanceId,
        projectionGeneration: instanceId,
        statConfigSnapshotHash: configHash,
        projectionHash
      }
    });
    firebaseMocks.getDocs.mockResolvedValue({
      forEach() {}
    });
    diamondFirebaseMocks.getPublicDiamondGame.mockResolvedValue({
      data: {
        instanceId,
        sourceRevision: 7,
        projectionToken: `current:7:${projectionHash}`,
        events: [],
        nextCursor: null,
        complete: false,
        truncated: true
      }
    });

    await expect(loadGameReportSections('team-1', 'game-1')).rejects.toThrow(
      'Diamond public replay is incomplete'
    );
    expect(dbMocks.getGameEvents).not.toHaveBeenCalled();
  });

  it('falls back to bounded manager-authorized event summaries for a private Diamond report', async () => {
    const instanceId = '00000000-0000-4000-8000-000000000001';
    const checkpointHash = `sha256:${'a'.repeat(64)}`;
    const configHash = `sha256:${'b'.repeat(64)}`;
    const projectionHash = `sha256:${'c'.repeat(64)}`;
    dbMocks.getConfigs.mockResolvedValue([buildPublicDiamondConfig()]);
    dbMocks.getGame.mockResolvedValue({
      id: 'game-1',
      teamId: 'team-1',
      statTrackerConfigId: 'diamond-config',
      visibility: 'private',
      trackingEngine: 'diamond-v2',
      diamondProjectionStatus: 'current',
      diamondProjectionRevision: 201,
      diamondProjectionComplete: true,
      diamondScorebookInstanceId: instanceId,
      diamondProjectionCheckpointHash: checkpointHash,
      diamondStatConfigSnapshotHash: configHash,
      diamondProjectionHash: projectionHash,
      diamondPublicTeamStats: {
        trackingEngine: 'diamond-v2', projectionSchemaVersion: 1, sourceRevision: 201,
        checkpointHash, coverage: {}, publicStatIds: [], side: 'home', complete: true,
        stats: {}, observedStats: {}, statCoverage: {}, teamId: 'team-1',
        diamondGameId: 'game-1', instanceId, diamondScorebookInstanceId: instanceId,
        projectionGeneration: instanceId, statConfigSnapshotHash: configHash, projectionHash
      }
    });
    firebaseMocks.getDocs.mockResolvedValue({ forEach() {} });
    diamondFirebaseMocks.getPublicDiamondGame.mockRejectedValue(
      Object.assign(new Error('Private game is not public.'), { code: 'functions/not-found' })
    );
    diamondScorebookMocks.getDiamondState.mockResolvedValue({ instanceId, revision: 201 });
    diamondScorebookMocks.getDiamondPrivateHistoryWindow
      .mockResolvedValueOnce({
        sourceRevision: 201,
        oldestSequence: 2,
        newestSequence: 201,
        contiguous: true,
        rangeComplete: true,
        headComplete: true,
        historyComplete: false,
        hasOlder: true,
        items: Array.from({ length: 200 }, (_, index) => {
          const revision = index + 2;
          return {
            eventId: `event-${revision}`,
            sequence: revision,
            revision,
            type: revision === 201 ? 'record_plate_appearance' : 'record_pitch',
            payload: revision === 201 ? { result: 'single', batterId: 'private-player-id' } : { result: 'ball' },
            createdAt: new Date(Date.UTC(2026, 8, 5, 20, 0, revision)).toISOString(),
            voidsEventId: null,
            supersedesEventId: null
          };
        })
      })
      .mockResolvedValueOnce({
        sourceRevision: 201,
        oldestSequence: 1,
        newestSequence: 1,
        contiguous: true,
        rangeComplete: true,
        headComplete: false,
        historyComplete: false,
        hasOlder: false,
        items: [{
          eventId: 'event-1', sequence: 1, revision: 1, type: 'activate', payload: {},
          createdAt: '2026-09-05T20:00:01.000Z', voidsEventId: null, supersedesEventId: null
        }]
      });

    const report = await loadGameReportSections('team-1', 'game-1', { statVisibility: 'manager-internal' });

    expect(report.plays).toEqual([
      expect.objectContaining({ id: 'event-1', text: 'Scorebook ready', period: 'Revision 1' }),
      ...Array.from({ length: 199 }, () => expect.any(Object)),
      expect.objectContaining({ id: 'event-201', text: 'Plate appearance: single', period: 'Revision 201' })
    ]);
    expect(report.plays[200]?.text).not.toContain('private-player-id');
    expect(report.diamond).toMatchObject({
      requestedReplayVisibility: 'manager-internal',
      replayVisibility: 'manager-internal',
      replaySource: 'manager-private-sanitized'
    });
    expect(diamondScorebookMocks.getDiamondPrivateHistoryWindow).toHaveBeenNthCalledWith(1, {
      teamId: 'team-1',
      gameId: 'game-1',
      expectedRevision: 201,
      beforeSequence: null,
      windowSize: 200
    });
    expect(diamondScorebookMocks.getDiamondPrivateHistoryWindow).toHaveBeenNthCalledWith(2, {
      teamId: 'team-1',
      gameId: 'game-1',
      expectedRevision: 201,
      beforeSequence: 2,
      windowSize: 200
    });
    expect(diamondScorebookMocks.getDiamondState).toHaveBeenCalledTimes(2);
    expect(dbMocks.getGameEvents).not.toHaveBeenCalled();
  });

  it('applies canonical correction semantics, removes dependent voided attachments and private notes, and keeps revision order', async () => {
    const instanceId = '00000000-0000-4000-8000-000000000001';
    const checkpointHash = `sha256:${'a'.repeat(64)}`;
    const configHash = `sha256:${'b'.repeat(64)}`;
    const projectionHash = `sha256:${'c'.repeat(64)}`;
    dbMocks.getConfigs.mockResolvedValue([buildPublicDiamondConfig()]);
    dbMocks.getGame.mockResolvedValue({
      id: 'game-1', teamId: 'team-1', statTrackerConfigId: 'diamond-config', visibility: 'private', trackingEngine: 'diamond-v2',
      diamondProjectionStatus: 'current', diamondProjectionRevision: 9, diamondProjectionComplete: true,
      diamondScorebookInstanceId: instanceId, diamondProjectionCheckpointHash: checkpointHash,
      diamondStatConfigSnapshotHash: configHash, diamondProjectionHash: projectionHash,
      diamondPublicTeamStats: {
        trackingEngine: 'diamond-v2', projectionSchemaVersion: 1, sourceRevision: 9,
        checkpointHash, coverage: {}, publicStatIds: [], side: 'home', complete: true,
        stats: {}, observedStats: {}, statCoverage: {}, teamId: 'team-1',
        diamondGameId: 'game-1', instanceId, diamondScorebookInstanceId: instanceId,
        projectionGeneration: instanceId, statConfigSnapshotHash: configHash, projectionHash
      }
    });
    firebaseMocks.getDocs.mockResolvedValue({ forEach() {} });
    diamondFirebaseMocks.getPublicDiamondGame.mockRejectedValue(
      Object.assign(new Error('Private game is not public.'), { code: 'functions/not-found' })
    );
    diamondScorebookMocks.getDiamondState.mockResolvedValue({ instanceId, revision: 9 });
    diamondScorebookMocks.getDiamondPrivateHistoryWindow.mockResolvedValue({
      sourceRevision: 9,
      oldestSequence: 1,
      newestSequence: 9,
      contiguous: true,
      rangeComplete: true,
      headComplete: true,
      historyComplete: true,
      hasOlder: false,
      items: [
        { eventId: 'event-1', sequence: 1, revision: 1, type: 'activate', payload: {}, createdAt: '2026-09-05T20:09:00.000Z', voidsEventId: null, supersedesEventId: null },
        { eventId: 'event-2', sequence: 2, revision: 2, type: 'start', payload: {}, createdAt: '2026-09-05T20:08:00.000Z', voidsEventId: null, supersedesEventId: null },
        { eventId: 'event-3', sequence: 3, revision: 3, type: 'record_plate_appearance', payload: { result: 'single' }, createdAt: '2026-09-05T20:07:00.000Z', voidsEventId: null, supersedesEventId: null },
        { eventId: 'event-4', sequence: 4, revision: 4, type: 'record_fielding', payload: { playEventId: 'event-3' }, createdAt: '2026-09-05T20:06:00.000Z', voidsEventId: null, supersedesEventId: null },
        { eventId: 'event-5', sequence: 5, revision: 5, type: 'private_note', payload: { note: 'manager only' }, createdAt: '2026-09-05T20:05:00.000Z', voidsEventId: null, supersedesEventId: null },
        { eventId: 'event-6', sequence: 6, revision: 6, type: 'void_event', payload: { targetEventId: 'event-3', reason: 'correction' }, createdAt: '2026-09-05T20:04:00.000Z', voidsEventId: 'event-3', supersedesEventId: null },
        { eventId: 'event-7', sequence: 7, revision: 7, type: 'record_plate_appearance', payload: { result: 'double' }, createdAt: '2026-09-05T20:03:00.000Z', voidsEventId: null, supersedesEventId: null },
        { eventId: 'event-8', sequence: 8, revision: 8, type: 'record_scoring_judgment', payload: { playEventId: 'event-7' }, createdAt: '2026-09-05T20:02:00.000Z', voidsEventId: null, supersedesEventId: null },
        {
          eventId: 'event-9', sequence: 9, revision: 9, type: 'supersede_event',
          payload: {
            targetEventId: 'event-7', reason: 'correction',
            replacement: { type: 'record_plate_appearance', payload: { result: 'triple' } }
          },
          createdAt: '2026-09-05T20:01:00.000Z', voidsEventId: null, supersedesEventId: 'event-7'
        }
      ]
    });

    const report = await loadGameReportSections('team-1', 'game-1', { statVisibility: 'manager-internal' });

    expect(report.plays.map((play) => ({ id: play.id, text: play.text, period: play.period }))).toEqual([
      { id: 'event-1', text: 'Scorebook ready', period: 'Revision 1' },
      { id: 'event-2', text: 'Game started', period: 'Revision 2' },
      { id: 'event-9', text: 'Plate appearance: triple', period: 'Revision 7' },
      { id: 'event-8', text: 'Official scoring updated', period: 'Revision 8' }
    ]);
    expect(report.plays.map((play) => play.id)).not.toEqual(expect.arrayContaining(['event-3', 'event-4', 'event-5', 'event-6', 'event-7']));
  });

  it('returns retryable replay evidence while preserving game status when a Diamond lightweight replay is incomplete', async () => {
    const instanceId = '00000000-0000-4000-8000-000000000001';
    dbMocks.getGame.mockResolvedValue({
      id: 'game-1', teamId: 'team-1', trackingEngine: 'diamond-v2', liveStatus: 'live', status: 'live',
      diamondProjectionRevision: 7, diamondScorebookInstanceId: instanceId
    });
    diamondFirebaseMocks.getPublicDiamondGame.mockResolvedValue({
      data: {
        instanceId, sourceRevision: 7, projectionToken: `current:7:sha256:${'c'.repeat(64)}`,
        events: [], nextCursor: null, complete: false, truncated: true
      }
    });

    const refresh = await loadGameReportPlays('team-1', 'game-1');

    expect(refresh).toEqual({
      game: expect.objectContaining({ id: 'game-1', liveStatus: 'live', status: 'live' }),
      plays: [],
      playsFresh: false,
      replayError: 'Diamond play-by-play could not be refreshed completely. Retry the report.'
    });
  });

  it('does not grant an anonymous private-event fallback when the public Diamond game is hidden', async () => {
    const instanceId = '00000000-0000-4000-8000-000000000001';
    const checkpointHash = `sha256:${'a'.repeat(64)}`;
    const configHash = `sha256:${'b'.repeat(64)}`;
    const projectionHash = `sha256:${'c'.repeat(64)}`;
    dbMocks.getConfigs.mockResolvedValue([buildPublicDiamondConfig()]);
    dbMocks.getGame.mockResolvedValue({
      id: 'game-1',
      teamId: 'team-1',
      statTrackerConfigId: 'diamond-config',
      visibility: 'private',
      trackingEngine: 'diamond-v2',
      diamondProjectionStatus: 'current',
      diamondProjectionRevision: 7,
      diamondProjectionComplete: true,
      diamondScorebookInstanceId: instanceId,
      diamondProjectionCheckpointHash: checkpointHash,
      diamondStatConfigSnapshotHash: configHash,
      diamondProjectionHash: projectionHash,
      diamondPublicTeamStats: {
        trackingEngine: 'diamond-v2', projectionSchemaVersion: 1, sourceRevision: 7,
        checkpointHash, coverage: {}, publicStatIds: [], side: 'home', complete: true,
        stats: {}, observedStats: {}, statCoverage: {}, teamId: 'team-1',
        diamondGameId: 'game-1', instanceId, diamondScorebookInstanceId: instanceId,
        projectionGeneration: instanceId, statConfigSnapshotHash: configHash, projectionHash
      }
    });
    firebaseMocks.getDocs.mockResolvedValue({ forEach() {} });
    diamondFirebaseMocks.getPublicDiamondGame.mockRejectedValue(
      Object.assign(new Error('Private game is not public.'), { code: 'functions/not-found' })
    );

    await expect(loadGameReportSections('team-1', 'game-1')).rejects.toThrow('Private game is not public.');
    expect(diamondScorebookMocks.getDiamondState).not.toHaveBeenCalled();
    expect(diamondScorebookMocks.getDiamondPrivateHistoryWindow).not.toHaveBeenCalled();
    expect(dbMocks.getGameEvents).not.toHaveBeenCalled();
  });

  it('fails closed instead of loading private team stats when the public team subset is malformed', async () => {
    const instanceId = '00000000-0000-4000-8000-000000000001';
    const checkpointHash = `sha256:${'a'.repeat(64)}`;
    const configHash = `sha256:${'b'.repeat(64)}`;
    const projectionHash = `sha256:${'c'.repeat(64)}`;
    dbMocks.getConfigs.mockResolvedValue([buildPublicDiamondConfig()]);
    dbMocks.getGame.mockResolvedValue({
      id: 'game-1',
      teamId: 'team-1',
      statTrackerConfigId: 'diamond-config',
      trackingEngine: 'diamond-v2',
      diamondProjectionStatus: 'current',
      diamondProjectionRevision: 7,
      diamondProjectionComplete: true,
      diamondScorebookInstanceId: instanceId,
      diamondProjectionCheckpointHash: checkpointHash,
      diamondStatConfigSnapshotHash: configHash,
      diamondProjectionHash: projectionHash,
      diamondPublicTeamStats: {
        trackingEngine: 'diamond-v2', projectionSchemaVersion: 1, sourceRevision: 7,
        checkpointHash, coverage: { batting: 'complete' }, publicStatIds: ['r'],
        side: 'home', complete: true, stats: { r: 3, h: 99 }, observedStats: {},
        statCoverage: { r: 'complete' }, teamId: 'team-1', diamondGameId: 'game-1',
        instanceId, diamondScorebookInstanceId: instanceId, projectionGeneration: instanceId,
        statConfigSnapshotHash: configHash, projectionHash
      }
    });
    firebaseMocks.getDocs.mockResolvedValue({
      forEach(callback: (docSnap: any) => void) {
        callback({
          id: 'player-recorded',
          data: () => ({
            schemaVersion: 1,
            trackingEngine: 'diamond-v2',
            projectionSchemaVersion: 1,
            playerId: 'player-recorded',
            playerName: 'Recorded Player',
            playerNumber: '3',
            sourceRevision: 7,
            checkpointHash,
            complete: true,
            publicStatIds: ['h'],
            stats: { h: 1 },
            observedStats: {},
            derivedStats: {},
            observedDerivedStats: {},
            statCoverage: { h: 'complete' },
            statSources: {},
            sourcePlayIds: [],
            unavailableDerivedStats: [],
            missingStatFamilies: [],
            coverage: { batting: 'complete' },
            participated: true,
            participationStatus: 'appeared',
            participationSource: 'diamond-v2',
            teamId: 'team-1',
            diamondGameId: 'game-1',
            instanceId,
            diamondScorebookInstanceId: instanceId,
            projectionGeneration: instanceId,
            statConfigSnapshotHash: configHash,
            projectionHash
          })
        });
      }
    });

    const report = await loadGameReportSections('team-1', 'game-1');

    expect(report.teamStats).toEqual({});
    expect(report.teamStatPresentation).toMatchObject({ isDiamond: true, projectionPending: true, statVisibility: 'public' });
    expect(report.diamond).toMatchObject({ pending: true, statVisibility: 'public' });
    expect(dbMocks.getTeamStatsForGame).not.toHaveBeenCalled();
  });
});
