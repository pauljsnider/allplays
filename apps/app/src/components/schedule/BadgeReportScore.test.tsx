// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GameReportSectionContent } from './GameReportSectionContent';
import { mapGameReportGameRecord } from '../../lib/firestore/mappers';
import type { GameReportData } from '../../lib/gameReportService';
vi.mock('../../lib/liveGameAnnouncer', () => ({ useLiveGameAnnouncer: () => ({ supported: false }) }));
afterEach(cleanup);
it('renders a managed-team victory after venue-oriented away completion', () => {
  const game = mapGameReportGameRecord({ isHome: false, homeScore: 3, awayScore: 9, scoreOrientation: 'venue', status: 'completed' });
  const report = { game, summary: '', plays: [], opponentRows: [], opponentStatKeys: [], teamInsights: [], playerInsightRows: [], publishedAiRecap: null, highlightClips: [], statSheetPhotoUrl: null, teamStatKeys: [], teamStats: {}, teamStatLabels: {} } as unknown as GameReportData;
  render(<GameReportSectionContent report={report} activeSection="summary" />);
  expect(screen.getByText('9-3')).toBeTruthy();
  expect(screen.getByText('Victory')).toBeTruthy();
});
