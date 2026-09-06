// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameReportSections } from './GameReportSections';

const gameReportServiceMocks = vi.hoisted(() => ({
  loadGameReportPlays: vi.fn(),
  loadGameReportSections: vi.fn()
}));
const liveGameAnnouncerMocks = vi.hoisted(() => ({
  toggleEnabled: vi.fn()
}));
const diamondStatExportMocks = vi.hoisted(() => ({
  exportDiamondGameReportStatsCsv: vi.fn()
}));

vi.mock('../../lib/gameReportService', () => gameReportServiceMocks);
vi.mock('../../lib/diamondStatExport', () => diamondStatExportMocks);
vi.mock('../../lib/liveGameAnnouncer', () => ({
  useLiveGameAnnouncer: () => ({
    supported: true,
    enabled: false,
    paused: false,
    toggleEnabled: liveGameAnnouncerMocks.toggleEnabled
  })
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

function buildEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'game-1',
    teamId: 'team-1',
    liveStatus: 'live',
    status: 'live',
    homeScore: 41,
    awayScore: 38,
    ...overrides
  } as any;
}

function buildReport(summary: string, gameOverrides: Record<string, unknown> = {}, plays: any[] = []) {
  return {
    game: { id: 'game-1', liveStatus: 'live', status: 'live', homeScore: 41, awayScore: 38, ...gameOverrides },
    plays,
    summary,
    opponentRows: [],
    opponentStatKeys: [],
    teamInsights: [],
    playerInsightRows: [],
    publishedAiRecap: null,
    highlightClips: [],
    statSheetPhotoUrl: null,
    teamStatKeys: [],
    teamStats: {},
    statKeys: ['pts'],
    playerRows: [{ playerId: 'player-1', playerName: 'Avery Smith', number: '1', stats: { pts: 8 }, timeMs: 600000, didNotPlay: false }],
    statLabels: { pts: 'PTS' },
    hasPlayingTime: true,
    team: { id: 'team-1' }
  } as any;
}

function buildDiamondEvent(overrides: Record<string, unknown> = {}) {
  return buildEvent({
    trackingEngine: 'diamond-v2',
    diamondScorebookInstanceId: 'instance-1',
    ...overrides
  });
}

function buildDiamondReport(summary: string, gameOverrides: Record<string, unknown> = {}, plays: any[] = []) {
  return buildReport(
    summary,
    {
      trackingEngine: 'diamond-v2',
      diamondScorebookInstanceId: 'instance-1',
      ...gameOverrides
    },
    plays
  );
}

describe('GameReportSections', () => {
  it('exposes the selected report section and keeps every tab touch target usable', async () => {
    gameReportServiceMocks.loadGameReportSections.mockResolvedValueOnce(buildReport('Ready.'));
    render(<GameReportSections event={buildEvent()} />);

    await screen.findByText('Ready.');
    const summary = screen.getByRole('button', { name: 'Summary' });
    const players = screen.getByRole('button', { name: 'Players' });
    expect(summary).toHaveAttribute('aria-pressed', 'true');
    expect(players).toHaveAttribute('aria-pressed', 'false');
    expect(summary.className).toContain('min-h-11');

    fireEvent.click(players);
    expect(summary).toHaveAttribute('aria-pressed', 'false');
    expect(players).toHaveAttribute('aria-pressed', 'true');
  });

  it('offers the coverage-aware stats export only for Diamond reports', async () => {
    diamondStatExportMocks.exportDiamondGameReportStatsCsv.mockResolvedValue('downloaded');
    const diamondReport = {
      ...buildDiamondReport(''),
      diamond: {
        isDiamond: true,
        readOnly: true,
        status: 'current',
        pending: false,
        authoritativeRevision: 12,
        sourceRevisions: [12]
      }
    };
    gameReportServiceMocks.loadGameReportSections.mockResolvedValueOnce(diamondReport);

    const { rerender } = render(<GameReportSections event={buildDiamondEvent()} />);
    const exportButton = await screen.findByRole('button', { name: 'Export public CSV' });
    expect(exportButton).toHaveClass('min-h-11');
    fireEvent.click(exportButton);

    await waitFor(() => expect(diamondStatExportMocks.exportDiamondGameReportStatsCsv).toHaveBeenCalledWith(diamondReport));
    expect(screen.getByText('Stats CSV downloaded.')).toBeTruthy();

    gameReportServiceMocks.loadGameReportSections.mockResolvedValueOnce(buildReport('Legacy report.', { id: 'game-2' }));
    rerender(<GameReportSections event={buildEvent({ id: 'game-2' })} />);
    await waitFor(() => expect(screen.getByText('Legacy report.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Export public CSV' })).toBeNull();
  });

  it('shows a published Diamond AI recap with play evidence and coverage disclosure', async () => {
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue({
      ...buildDiamondReport('', { liveStatus: 'completed', status: 'completed' }),
      diamond: {
        isDiamond: true,
        readOnly: true,
        status: 'current',
        pending: false,
        authoritativeRevision: 12,
        sourceRevisions: [12]
      },
      publishedAiRecap: {
        current: true,
        sourceRevision: 12,
        publishedAt: '2026-09-05T20:00:00.000Z',
        recap: { text: 'The Falcons won 4-3.', citations: [{ eventId: 'event-12', revision: 12 }] },
        insights: [{ text: 'Avery recorded 2 hits.', citations: [{ eventId: 'event-8', revision: 8 }] }],
        coverage: { batting: 'complete', fielding: 'partial', sensors: 'not_collected' },
        dataQualityNotes: ['Fielding detail was partially captured.']
      }
    });

    render(<GameReportSections event={buildDiamondEvent({ liveStatus: 'completed', status: 'completed' })} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Insights' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Insights' }));

    expect(screen.getByText('Published AI recap')).toBeTruthy();
    expect(screen.getByText('The Falcons won 4-3.')).toBeTruthy();
    expect(screen.getByText('Avery recorded 2 hits.')).toBeTruthy();
    expect(screen.getAllByLabelText('AI recap play evidence')).toHaveLength(2);
    expect(screen.getByText(/fielding: partial/i)).toBeTruthy();
  });

  it('hides stale AI prose after a correction while preserving regeneration evidence', async () => {
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue({
      ...buildDiamondReport('', { liveStatus: 'completed', status: 'completed' }),
      diamond: {
        isDiamond: true,
        readOnly: true,
        status: 'current',
        pending: false,
        authoritativeRevision: 13,
        sourceRevisions: [13]
      },
      publishedAiRecap: {
        current: false,
        sourceRevision: 12,
        publishedAt: '2026-09-05T20:00:00.000Z',
        recap: { text: 'Outdated result.', citations: [{ eventId: 'event-12', revision: 12 }] },
        insights: [],
        coverage: {},
        dataQualityNotes: []
      }
    });

    render(<GameReportSections event={buildDiamondEvent({ liveStatus: 'completed', status: 'completed' })} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Insights' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Insights' }));

    expect(screen.getByText('AI recap needs regeneration')).toBeTruthy();
    expect(screen.queryByText('Outdated result.')).toBeNull();
  });

  it('labels partial Diamond observations and renders not-collected values as em dashes', async () => {
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue({
      ...buildDiamondReport(''),
      diamond: {
        isDiamond: true,
        readOnly: true,
        status: 'pending',
        pending: true,
        authoritativeRevision: 9,
        sourceRevisions: [8]
      },
      statKeys: ['h', 'sb', 'era', 'whip'],
      statLabels: { h: 'H', sb: 'SB', era: 'ERA', whip: 'WHIP' },
      statDefinitions: { era: { precision: 2 }, whip: { precision: 2 } },
      playerRows: [
        {
          playerId: 'player-1',
          playerName: 'Avery Smith',
          number: '1',
          stats: { h: 0, sb: 2 },
          timeMs: 0,
          didNotPlay: false,
          statPresentation: {
            isDiamond: true,
            statCoverage: { h: 'complete', sb: 'partial', era: 'not_collected', whip: 'not_collected' },
            observedStatKeys: ['sb'],
            unavailableStatKeys: ['era', 'whip']
          }
        }
      ],
      visiblePlayerRows: [],
      deferredPlayerRows: []
    });

    render(<GameReportSections event={buildDiamondEvent()} />);
    await waitFor(() => expect(screen.getByText('Diamond scorebook · Public stats · Read only')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Players' }));

    const player = screen.getByRole('link', { name: /Avery Smith/i });
    expect(within(player).getByText('Observed')).toBeTruthy();
    expect(within(player).getAllByLabelText('Not collected')).toHaveLength(2);
    expect(within(player).getAllByText('—')).toHaveLength(2);
    expect(within(player).getByLabelText('0')).toBeTruthy();
    expect(screen.getByText(/projection is pending/i)).toBeTruthy();
    expect(screen.getByText('Ledger rev 9 · Stats rev 8')).toBeTruthy();
  });

  it('keeps the empty play state primary and hides audio controls until a play exists', async () => {
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue(buildReport('Live report.'));

    render(<GameReportSections event={buildEvent()} />);

    await waitFor(() => expect(screen.getByText('Live report.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));

    expect(screen.getByText('No events logged')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Turn on audio announcements' })).toBeNull();
    expect(screen.queryByLabelText('Play-by-play audio controls')).toBeNull();
  });

  it('renders plays before the secondary audio control and keeps the toggle behavior', async () => {
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue(
      buildReport('Live report.', {}, [
        { id: 'event-1', text: 'Avery scores', period: 'Q1', clock: '7:42', timestamp: new Date(1717200000 * 1000) }
      ])
    );

    render(<GameReportSections event={buildEvent()} />);

    await waitFor(() => expect(screen.getByText('Live report.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));

    const playLog = screen.getByLabelText('Play-by-play log');
    const audioControls = screen.getByLabelText('Play-by-play audio controls');
    expect(playLog.compareDocumentPosition(audioControls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Avery scores')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Turn on audio announcements' }));
    expect(liveGameAnnouncerMocks.toggleEnabled).toHaveBeenCalledTimes(1);
  });

  it('keeps the active tab and loaded report mounted during same-event live score updates', async () => {
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue(buildReport('First report.'));

    const { rerender } = render(<GameReportSections event={buildEvent()} />);

    await waitFor(() => {
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(1);
      expect(screen.getByText('First report.')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Players' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /#1 Avery Smith/i })).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Players' }).className).toContain('bg-primary-600');

    rerender(<GameReportSections event={buildEvent({ liveStatus: 'halftime', homeScore: 42, awayScore: 40 })} />);

    await waitFor(() => {
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('button', { name: 'Players' }).className).toContain('bg-primary-600');
    expect(screen.getByRole('link', { name: /#1 Avery Smith/i })).toBeTruthy();
    expect(screen.queryByText('Loading report sections...')).toBeNull();
  });

  it('reloads the report when the same event transitions to a new live status', async () => {
    gameReportServiceMocks.loadGameReportSections
      .mockResolvedValueOnce(buildReport('Scheduled report.', { liveStatus: 'scheduled', status: 'scheduled' }))
      .mockResolvedValueOnce(buildReport('Live report.', { liveStatus: 'live', status: 'live' }));

    const { rerender } = render(<GameReportSections event={buildEvent({ liveStatus: 'scheduled', status: 'scheduled' })} />);

    await waitFor(() => {
      expect(screen.getByText('Scheduled report.')).toBeTruthy();
    });

    rerender(<GameReportSections event={buildEvent({ liveStatus: 'live', status: 'live' })} />);

    expect(screen.getByText('Loading report sections...')).toBeTruthy();

    await waitFor(() => {
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Live report.')).toBeTruthy();
    });
    expect(screen.queryByText('Scheduled report.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Summary' }).className).toContain('bg-primary-600');
  });

  it('retains one complete report through a failed refresh and recovers through Retry', async () => {
    diamondStatExportMocks.exportDiamondGameReportStatsCsv.mockResolvedValue('downloaded');
    const retainedReport = {
      ...buildDiamondReport('Complete internal report.', { liveStatus: 'scheduled', status: 'scheduled' }),
      diamond: {
        isDiamond: true,
        readOnly: true,
        status: 'current',
        pending: false,
        authoritativeRevision: 7,
        sourceRevisions: [7],
        requestedStatVisibility: 'manager-internal',
        statVisibility: 'manager-internal',
        privateStatsStatus: 'complete'
      }
    };
    const recoveredReport = {
      ...retainedReport,
      summary: 'Recovered internal report.',
      game: { ...retainedReport.game, liveStatus: 'live', status: 'live' }
    };
    gameReportServiceMocks.loadGameReportSections
      .mockResolvedValueOnce(retainedReport)
      .mockRejectedValueOnce(new Error('Diamond replay is incomplete. Try again.'))
      .mockResolvedValueOnce(recoveredReport);

    const { rerender } = render(
      <GameReportSections event={buildDiamondEvent({ liveStatus: 'scheduled', status: 'scheduled', isTeamAdmin: true })} />
    );
    await waitFor(() => expect(screen.getByText('Complete internal report.')).toBeTruthy());

    rerender(<GameReportSections event={buildDiamondEvent({ liveStatus: 'live', status: 'live', isTeamAdmin: true })} />);

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Diamond replay is incomplete. Try again.'));
    expect(screen.getByText('Complete internal report.')).toBeTruthy();
    const exportButton = screen.getByRole('button', { name: 'Export internal CSV' });
    fireEvent.click(exportButton);
    await waitFor(() => expect(diamondStatExportMocks.exportDiamondGameReportStatsCsv).toHaveBeenCalledWith(retainedReport));

    const retryButton = screen.getByRole('button', { name: 'Retry report' });
    expect(retryButton).toHaveClass('min-h-11');
    fireEvent.click(retryButton);
    expect(screen.getByText('Complete internal report.')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Recovered internal report.')).toBeTruthy());
    expect(screen.queryByText('Complete internal report.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(3);
    expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenNthCalledWith(3, 'team-1', 'game-1', {
      statVisibility: 'manager-internal'
    });
  });

  it('resets the panel when the event identity changes', async () => {
    gameReportServiceMocks.loadGameReportSections.mockResolvedValueOnce(buildReport('First report.')).mockResolvedValueOnce({
      ...buildReport('Second report.'),
      game: { id: 'game-2', liveStatus: 'completed', status: 'completed', homeScore: 55, awayScore: 44 }
    });

    const { rerender } = render(<GameReportSections event={buildEvent()} />);

    await waitFor(() => {
      expect(screen.getByText('First report.')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Players' }));
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /#1 Avery Smith/i })).toBeTruthy();
    });

    rerender(
      <GameReportSections
        event={buildEvent({ id: 'game-2', homeScore: 55, awayScore: 44, liveStatus: 'completed', status: 'completed' })}
      />
    );

    expect(screen.getByText('Loading report sections...')).toBeTruthy();

    await waitFor(() => {
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(2);
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenNthCalledWith(2, 'team-1', 'game-2', {
        statVisibility: 'public'
      });
      expect(screen.getByText('Second report.')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Summary' }).className).toContain('bg-primary-600');
  });

  it('synchronously hides a retained manager report when the team and game identity changes', async () => {
    const nextReport = new Promise(() => {});
    const managerReport = {
      ...buildDiamondReport('First manager report.'),
      diamond: {
        isDiamond: true,
        readOnly: true,
        status: 'current',
        pending: false,
        authoritativeRevision: 4,
        sourceRevisions: [4],
        requestedStatVisibility: 'manager-internal',
        statVisibility: 'manager-internal',
        requestedReplayVisibility: 'manager-internal',
        replayVisibility: 'manager-internal',
        replaySource: 'manager-private-sanitized',
        privateStatsStatus: 'complete'
      }
    };
    gameReportServiceMocks.loadGameReportSections.mockResolvedValueOnce(managerReport).mockReturnValueOnce(nextReport);

    const { rerender } = render(<GameReportSections event={buildDiamondEvent({ isTeamAdmin: true })} />);
    await waitFor(() => expect(screen.getByText('First manager report.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Export internal CSV' })).toBeTruthy();

    rerender(<GameReportSections event={buildDiamondEvent({ id: 'game-2', teamId: 'team-2', isTeamAdmin: true })} />);

    expect(screen.queryByText('First manager report.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export internal CSV' })).toBeNull();
  });

  it('synchronously hides a retained Diamond report when the same game ID gets a new scorebook instance', async () => {
    const nextReport = new Promise(() => {});
    const firstReport = {
      ...buildReport('First scorebook report.', { diamondScorebookInstanceId: 'instance-old' }),
      diamond: {
        isDiamond: true,
        readOnly: true,
        status: 'current',
        pending: false,
        authoritativeRevision: 4,
        sourceRevisions: [4],
        requestedStatVisibility: 'manager-internal',
        statVisibility: 'manager-internal',
        requestedReplayVisibility: 'manager-internal',
        replayVisibility: 'manager-internal',
        replaySource: 'manager-private-sanitized',
        privateStatsStatus: 'complete'
      }
    };
    gameReportServiceMocks.loadGameReportSections.mockResolvedValueOnce(firstReport).mockReturnValueOnce(nextReport);

    const { rerender } = render(
      <GameReportSections event={buildEvent({ isTeamAdmin: true, diamondScorebookInstanceId: 'instance-old' })} />
    );
    await waitFor(() => expect(screen.getByText('First scorebook report.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Export internal CSV' })).toBeTruthy();

    rerender(<GameReportSections event={buildEvent({ isTeamAdmin: true, diamondScorebookInstanceId: 'instance-new' })} />);

    expect(screen.queryByText('First scorebook report.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export internal CSV' })).toBeNull();
    await waitFor(() => expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(2));
  });

  it('refreshes the parent event before retrying a report from a recreated Diamond scorebook', async () => {
    const replacementReport = {
      ...buildDiamondReport('Replacement scorebook report.', {
        diamondScorebookInstanceId: 'instance-new'
      }),
      diamond: {
        isDiamond: true,
        readOnly: true,
        status: 'current',
        pending: false,
        authoritativeRevision: 1,
        sourceRevisions: [1],
        requestedStatVisibility: 'public',
        statVisibility: 'public',
        requestedReplayVisibility: 'public',
        replayVisibility: 'public',
        replaySource: 'public-sanitized',
        privateStatsStatus: 'not-requested'
      }
    };
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue(replacementReport);

    const renderController: { rerender?: ReturnType<typeof render>['rerender'] } = {};
    const refreshEvent = vi.fn(() => {
      renderController.rerender?.(
        <GameReportSections event={buildDiamondEvent({ diamondScorebookInstanceId: 'instance-new' })} onRefreshEvent={refreshEvent} />
      );
    });
    renderController.rerender = render(
      <GameReportSections event={buildDiamondEvent({ diamondScorebookInstanceId: 'instance-old' })} onRefreshEvent={refreshEvent} />
    ).rerender;

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('identity changed'));
    expect(screen.queryByText('Replacement scorebook report.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry report' }));

    await waitFor(() => expect(refreshEvent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('Replacement scorebook report.')).toBeTruthy());
    expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('polls live plays with the lightweight loader and merges them into the current report', async () => {
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue(
      buildReport('First report.', {}, [
        { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) }
      ])
    );
    gameReportServiceMocks.loadGameReportPlays.mockResolvedValue({
      game: { id: 'game-1', liveStatus: 'live', status: 'live', homeScore: 41, awayScore: 38 },
      playsFresh: true,
      plays: [
        { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) },
        { id: 'event-late', text: 'Late bucket', period: 'Q1', clock: '0:12', timestamp: new Date(1717200060 * 1000) }
      ]
    });

    render(<GameReportSections event={buildEvent()} />);

    await waitFor(() => {
      expect(screen.getByText('First report.')).toBeTruthy();
    });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));
    expect(screen.getByText('Opening tip')).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(15000);
      await Promise.resolve();
    });

    expect(gameReportServiceMocks.loadGameReportPlays).toHaveBeenCalledTimes(1);
    expect(gameReportServiceMocks.loadGameReportPlays).toHaveBeenCalledWith('team-1', 'game-1', {
      statVisibility: 'public'
    });
    expect(screen.getByText('Late bucket')).toBeTruthy();
    expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(screen.getByText('First report.')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('preserves the displayed plays when the optional event refresh is unavailable', async () => {
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue(
      buildReport('First report.', {}, [
        { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) }
      ])
    );
    gameReportServiceMocks.loadGameReportPlays.mockResolvedValue({
      game: { id: 'game-1', liveStatus: 'live', status: 'live', homeScore: 42, awayScore: 40 },
      plays: [],
      playsFresh: false
    });

    render(<GameReportSections event={buildEvent()} />);

    await waitFor(() => {
      expect(screen.getByText('First report.')).toBeTruthy();
    });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));
    await act(async () => {
      vi.advanceTimersByTime(15000);
      await Promise.resolve();
    });

    expect(gameReportServiceMocks.loadGameReportPlays).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Opening tip')).toBeTruthy();
    expect(screen.queryByText('Unable to refresh play-by-play.')).toBeNull();
  });

  it('surfaces an incomplete Diamond lightweight replay with Retry while preserving the last complete plays', async () => {
    const diamondReport = {
      ...buildDiamondReport('Complete Diamond report.', {}, [
        { id: 'event-early', text: 'Scorebook ready', period: 'Top 1', clock: '', timestamp: new Date(1717200000 * 1000) }
      ]),
      diamond: {
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
        privateStatsStatus: 'not-requested'
      }
    };
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue(diamondReport);
    gameReportServiceMocks.loadGameReportPlays.mockResolvedValue({
      game: {
        id: 'game-1',
        liveStatus: 'live',
        status: 'live',
        homeScore: 42,
        awayScore: 40,
        trackingEngine: 'diamond-v2',
        diamondScorebookInstanceId: 'instance-1'
      },
      plays: [],
      playsFresh: false,
      replayError: 'Diamond play-by-play could not be refreshed completely. Retry the report.'
    });

    render(<GameReportSections event={buildDiamondEvent()} />);
    await waitFor(() => expect(screen.getByText('Complete Diamond report.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('could not be refreshed completely'));
    expect(screen.getByText('Scorebook ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry report' }));
    await waitFor(() => expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Scorebook ready')).toBeTruthy();
  });

  it('clears manager-requested private replay on downgrade and ignores its stale lightweight result', async () => {
    let resolvePrivateRefresh!: (value: any) => void;
    let resolvePublicReport!: (value: any) => void;
    const privateRefresh = new Promise((resolve) => {
      resolvePrivateRefresh = resolve;
    });
    const publicReportLoad = new Promise((resolve) => {
      resolvePublicReport = resolve;
    });
    const managerReport = {
      ...buildDiamondReport('Manager report.', {}, [
        { id: 'manager-play', text: 'Manager replay play', period: 'Revision 4', clock: '', timestamp: null }
      ]),
      diamond: {
        isDiamond: true,
        readOnly: true,
        status: 'current',
        pending: false,
        authoritativeRevision: 4,
        sourceRevisions: [4],
        requestedStatVisibility: 'manager-internal',
        statVisibility: 'public',
        requestedReplayVisibility: 'manager-internal',
        replayVisibility: 'manager-internal',
        replaySource: 'manager-private-sanitized',
        privateStatsStatus: 'unavailable'
      }
    };
    const publicReport = {
      ...buildDiamondReport('Public report.', {}, [
        { id: 'public-play', text: 'Public replay play', period: 'Top 1', clock: '', timestamp: null }
      ]),
      diamond: {
        ...managerReport.diamond,
        requestedStatVisibility: 'public',
        statVisibility: 'public',
        requestedReplayVisibility: 'public',
        replayVisibility: 'public',
        replaySource: 'public-sanitized',
        privateStatsStatus: 'not-requested'
      }
    };
    gameReportServiceMocks.loadGameReportSections.mockResolvedValueOnce(managerReport).mockReturnValueOnce(publicReportLoad);
    gameReportServiceMocks.loadGameReportPlays.mockReturnValueOnce(privateRefresh);

    const { rerender } = render(<GameReportSections event={buildDiamondEvent({ isTeamAdmin: true })} />);
    await waitFor(() => expect(screen.getByText('Manager report.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(gameReportServiceMocks.loadGameReportPlays).toHaveBeenCalledWith('team-1', 'game-1', {
      statVisibility: 'manager-internal'
    });

    rerender(<GameReportSections event={buildDiamondEvent({ isTeamAdmin: false })} />);
    expect(screen.queryByText('Manager report.')).toBeNull();
    expect(screen.queryByText('Manager replay play')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export public CSV' })).toBeNull();

    await act(async () => {
      resolvePrivateRefresh({
        game: { id: 'game-1', liveStatus: 'live', status: 'live' },
        playsFresh: true,
        plays: [{ id: 'stale-private', text: 'Stale private play', period: 'Revision 5', clock: '', timestamp: null }],
        replay: {
          requestedVisibility: 'manager-internal',
          visibility: 'manager-internal',
          source: 'manager-private-sanitized'
        }
      });
      await Promise.resolve();
    });
    expect(screen.queryByText('Stale private play')).toBeNull();

    await act(async () => {
      resolvePublicReport(publicReport);
    });
    await waitFor(() => expect(screen.getByText('Public replay play')).toBeTruthy());
    expect(screen.queryByText('Stale private play')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(screen.getByText('Public report.')).toBeTruthy();
  });

  it('does not merge a stale lightweight result after the team and game identity change', async () => {
    let resolveStaleRefresh!: (value: any) => void;
    const staleRefresh = new Promise((resolve) => {
      resolveStaleRefresh = resolve;
    });
    const firstReport = buildReport('First report.', {}, [
      { id: 'game-1-play', text: 'First game play', period: 'Q1', clock: '', timestamp: null }
    ]);
    const secondReport = {
      ...buildReport('Second report.', { id: 'game-2' }, [
        { id: 'game-2-play', text: 'Second game play', period: 'Q1', clock: '', timestamp: null }
      ]),
      team: { id: 'team-2' }
    };
    gameReportServiceMocks.loadGameReportSections.mockResolvedValueOnce(firstReport).mockResolvedValueOnce(secondReport);
    gameReportServiceMocks.loadGameReportPlays.mockReturnValueOnce(staleRefresh);

    const { rerender } = render(<GameReportSections event={buildEvent()} />);
    await waitFor(() => expect(screen.getByText('First report.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    rerender(<GameReportSections event={buildEvent({ id: 'game-2', teamId: 'team-2' })} />);
    await waitFor(() =>
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledWith('team-2', 'game-2', {
        statVisibility: 'public'
      })
    );

    await act(async () => {
      resolveStaleRefresh({
        game: { id: 'game-1', liveStatus: 'live', status: 'live' },
        playsFresh: true,
        plays: [{ id: 'stale-play', text: 'Stale first-game play', period: 'Q1', clock: '', timestamp: null }]
      });
      await Promise.resolve();
    });

    expect(screen.queryByText('Stale first-game play')).toBeNull();
    await waitFor(() => expect(screen.getByText('Second report.')).toBeTruthy());
  });

  it('clears the old report instead of merging plays from a recreated same-ID Diamond scorebook', async () => {
    const oldReport = {
      ...buildReport('Old scorebook report.', { diamondScorebookInstanceId: 'instance-old' }, [
        { id: 'old-play', text: 'Old scorebook play', period: 'Top 1', clock: '', timestamp: null }
      ]),
      diamond: {
        isDiamond: true,
        readOnly: true,
        status: 'current',
        pending: false,
        authoritativeRevision: 4,
        sourceRevisions: [4],
        requestedStatVisibility: 'public',
        statVisibility: 'public',
        requestedReplayVisibility: 'public',
        replayVisibility: 'public',
        replaySource: 'public-sanitized',
        privateStatsStatus: 'not-requested'
      }
    };
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue(oldReport);
    gameReportServiceMocks.loadGameReportPlays.mockResolvedValue({
      game: {
        id: 'game-1',
        liveStatus: 'live',
        status: 'live',
        diamondScorebookInstanceId: 'instance-new'
      },
      playsFresh: true,
      plays: [{ id: 'new-play', text: 'Replacement scorebook play', period: 'Top 1', clock: '', timestamp: null }],
      replay: {
        requestedVisibility: 'public',
        visibility: 'public',
        source: 'public-sanitized'
      }
    });

    render(<GameReportSections event={buildEvent({ diamondScorebookInstanceId: 'instance-old' })} />);
    await waitFor(() => expect(screen.getByText('Old scorebook report.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('scorebook was recreated'));
    expect(screen.queryByText('Old scorebook play')).toBeNull();
    expect(screen.queryByText('Replacement scorebook play')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export public CSV' })).toBeNull();
  });

  it.each([
    ['a Diamond refresh with no instance ID', { trackingEngine: 'diamond-v2', diamondScorebookInstanceId: null }],
    ['a legacy refresh at the same path', { trackingEngine: 'standard', diamondScorebookInstanceId: null }]
  ])('fails closed instead of merging %s into a retained Diamond report', async (_label, refreshedGame) => {
    const oldReport = {
      ...buildReport(
        'Old scorebook report.',
        {
          trackingEngine: 'diamond-v2',
          diamondScorebookInstanceId: 'instance-old'
        },
        [{ id: 'old-play', text: 'Old scorebook play', period: 'Top 1', clock: '', timestamp: null }]
      ),
      diamond: {
        isDiamond: true,
        readOnly: true,
        status: 'current',
        pending: false,
        authoritativeRevision: 4,
        sourceRevisions: [4],
        requestedStatVisibility: 'public',
        statVisibility: 'public',
        requestedReplayVisibility: 'public',
        replayVisibility: 'public',
        replaySource: 'public-sanitized',
        privateStatsStatus: 'not-requested'
      }
    };
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue(oldReport);
    gameReportServiceMocks.loadGameReportPlays.mockResolvedValue({
      game: { id: 'game-1', liveStatus: 'live', status: 'live', ...refreshedGame },
      playsFresh: true,
      plays: [{ id: 'new-play', text: 'Unpinned replacement play', period: 'Q1', clock: '', timestamp: null }]
    });

    render(<GameReportSections event={buildDiamondEvent({ diamondScorebookInstanceId: 'instance-old' })} />);
    await waitFor(() => expect(screen.getByText('Old scorebook report.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('scorebook was recreated'));
    expect(screen.queryByText('Old scorebook play')).toBeNull();
    expect(screen.queryByText('Unpinned replacement play')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export public CSV' })).toBeNull();
  });

  it('immediately stops live focus refresh when status is cancelled even if liveStatus is stale', async () => {
    gameReportServiceMocks.loadGameReportSections
      .mockResolvedValueOnce(buildReport('Live report.'))
      .mockReturnValueOnce(new Promise(() => {}));

    const { rerender } = render(<GameReportSections event={buildEvent()} />);
    await waitFor(() => expect(screen.getByText('Live report.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));

    rerender(<GameReportSections event={buildEvent({ liveStatus: 'live', status: 'cancelled' })} />);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });

    expect(gameReportServiceMocks.loadGameReportPlays).not.toHaveBeenCalled();
    await waitFor(() => expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(2));
  });

  it('uses lightweight focus refreshes only when the Plays tab is active and live', async () => {
    gameReportServiceMocks.loadGameReportSections
      .mockResolvedValueOnce(
        buildReport('First report.', {}, [
          { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) }
        ])
      )
      .mockResolvedValueOnce(
        buildReport('Completed report.', { liveStatus: 'completed', status: 'completed' }, [
          { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) },
          { id: 'event-late', text: 'Late bucket', period: 'Q1', clock: '0:12', timestamp: new Date(1717200060 * 1000) }
        ])
      );
    gameReportServiceMocks.loadGameReportPlays.mockResolvedValue({
      game: { id: 'game-1', liveStatus: 'live', status: 'live', homeScore: 41, awayScore: 38 },
      playsFresh: true,
      plays: [
        { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) },
        { id: 'event-late', text: 'Late bucket', period: 'Q1', clock: '0:12', timestamp: new Date(1717200060 * 1000) }
      ]
    });

    const { rerender } = render(<GameReportSections event={buildEvent()} />);

    await waitFor(() => {
      expect(screen.getByText('First report.')).toBeTruthy();
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });
    expect(gameReportServiceMocks.loadGameReportPlays).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() => {
      expect(gameReportServiceMocks.loadGameReportPlays).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Late bucket')).toBeTruthy();
    });
    expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(1);

    rerender(<GameReportSections event={buildEvent({ liveStatus: 'completed', status: 'completed' })} />);

    await waitFor(() => {
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });

    expect(gameReportServiceMocks.loadGameReportPlays).toHaveBeenCalledTimes(1);
  });

  it('refreshes live status during lightweight play polling and stops polling after completion', async () => {
    gameReportServiceMocks.loadGameReportSections
      .mockResolvedValueOnce(
        buildReport('Live report.', {}, [
          { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) }
        ])
      )
      .mockResolvedValueOnce(
        buildReport('Completed report.', { liveStatus: 'completed', status: 'completed', homeScore: 43, awayScore: 40 }, [
          { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) },
          { id: 'event-final', text: 'Final horn', period: 'Q4', clock: '0:00', timestamp: new Date(1717200120 * 1000) }
        ])
      );
    gameReportServiceMocks.loadGameReportPlays.mockResolvedValue({
      game: { id: 'game-1', liveStatus: 'live', status: 'completed', homeScore: 43, awayScore: 40 },
      playsFresh: true,
      plays: [
        { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) },
        { id: 'event-final', text: 'Final horn', period: 'Q4', clock: '0:00', timestamp: new Date(1717200120 * 1000) }
      ]
    });

    render(<GameReportSections event={buildEvent()} />);

    await waitFor(() => {
      expect(screen.getByText('Live report.')).toBeTruthy();
    });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));

    await act(async () => {
      vi.advanceTimersByTime(15000);
      await Promise.resolve();
    });

    expect(screen.getByText('Final horn')).toBeTruthy();
    expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(screen.getByText('Completed report.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Plays' }));

    await act(async () => {
      vi.advanceTimersByTime(15000);
      await Promise.resolve();
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });

    expect(gameReportServiceMocks.loadGameReportPlays).toHaveBeenCalledTimes(1);
    expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(2);
  });
});
