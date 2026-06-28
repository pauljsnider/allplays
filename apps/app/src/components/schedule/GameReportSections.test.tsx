// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameReportSections } from './GameReportSections';

const gameReportServiceMocks = vi.hoisted(() => ({
  loadGameReportSections: vi.fn()
}));

vi.mock('../../lib/gameReportService', () => gameReportServiceMocks);

afterEach(() => {
  cleanup();
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

function buildReport(summary: string) {
  return {
    game: { id: 'game-1', liveStatus: 'live', status: 'live', homeScore: 41, awayScore: 38 },
    plays: [],
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
});
