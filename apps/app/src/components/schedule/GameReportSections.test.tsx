// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameReportSections } from './GameReportSections';

const gameReportServiceMocks = vi.hoisted(() => ({
  loadGameReportPlays: vi.fn(),
  loadGameReportSections: vi.fn()
}));

vi.mock('../../lib/gameReportService', () => gameReportServiceMocks);

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
    highlightClips: [],
    statSheetPhotoUrl: null,
    teamStatKeys: [],
    teamStats: {},
    statKeys: ['pts'],
    playerRows: [
      { playerId: 'player-1', playerName: 'Avery Smith', number: '1', stats: { pts: 8 }, timeMs: 600000, didNotPlay: false }
    ],
    statLabels: { pts: 'PTS' },
    hasPlayingTime: true,
    team: { id: 'team-1' }
  } as any;
}

describe('GameReportSections', () => {
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

  it('resets the panel when the event identity changes', async () => {
    gameReportServiceMocks.loadGameReportSections
      .mockResolvedValueOnce(buildReport('First report.'))
      .mockResolvedValueOnce({
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

    rerender(<GameReportSections event={buildEvent({ id: 'game-2', homeScore: 55, awayScore: 44, liveStatus: 'completed', status: 'completed' })} />);

    expect(screen.getByText('Loading report sections...')).toBeTruthy();

    await waitFor(() => {
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(2);
      expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenNthCalledWith(2, 'team-1', 'game-2');
      expect(screen.getByText('Second report.')).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Summary' }).className).toContain('bg-primary-600');
  });

  it('polls live plays with the lightweight loader and merges them into the current report', async () => {
    gameReportServiceMocks.loadGameReportSections.mockResolvedValue(buildReport('First report.', {}, [
      { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) }
    ]));
    gameReportServiceMocks.loadGameReportPlays.mockResolvedValue({
      game: { id: 'game-1', liveStatus: 'live', status: 'live', homeScore: 41, awayScore: 38 },
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
    expect(gameReportServiceMocks.loadGameReportPlays).toHaveBeenCalledWith('team-1', 'game-1');
    expect(screen.getByText('Late bucket')).toBeTruthy();
    expect(gameReportServiceMocks.loadGameReportSections).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Summary' }));
    expect(screen.getByText('First report.')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('uses lightweight focus refreshes only when the Plays tab is active and live', async () => {
    gameReportServiceMocks.loadGameReportSections
      .mockResolvedValueOnce(buildReport('First report.', {}, [
        { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) }
      ]))
      .mockResolvedValueOnce(buildReport('Completed report.', { liveStatus: 'completed', status: 'completed' }, [
        { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) },
        { id: 'event-late', text: 'Late bucket', period: 'Q1', clock: '0:12', timestamp: new Date(1717200060 * 1000) }
      ]));
    gameReportServiceMocks.loadGameReportPlays.mockResolvedValue({
      game: { id: 'game-1', liveStatus: 'live', status: 'live', homeScore: 41, awayScore: 38 },
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
      .mockResolvedValueOnce(buildReport('Live report.', {}, [
        { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) }
      ]))
      .mockResolvedValueOnce(buildReport('Completed report.', { liveStatus: 'completed', status: 'completed', homeScore: 43, awayScore: 40 }, [
        { id: 'event-early', text: 'Opening tip', period: 'Q1', clock: '8:00', timestamp: new Date(1717200000 * 1000) },
        { id: 'event-final', text: 'Final horn', period: 'Q4', clock: '0:00', timestamp: new Date(1717200120 * 1000) }
      ]));
    gameReportServiceMocks.loadGameReportPlays.mockResolvedValue({
      game: { id: 'game-1', liveStatus: 'live', status: 'completed', homeScore: 43, awayScore: 40 },
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
