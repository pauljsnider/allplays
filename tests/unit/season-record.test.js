import { describe, it, expect } from 'vitest';
import {
  inferSeasonLabelFromGame,
  gameCountsTowardSeasonRecord,
  getTeamScorePair,
  isCompletedGame,
  calculateSeasonRecord,
  listSeasonLabels
} from '../../js/season-record.js';

describe('season record helpers', () => {
  it('infers season label from explicit seasonLabel first', () => {
    expect(inferSeasonLabelFromGame({ seasonLabel: '2026 Spring', date: '2024-01-01T00:00:00Z' })).toBe('2026 Spring');
  });

  it('falls back to year from date when season label is missing', () => {
    expect(inferSeasonLabelFromGame({ date: '2025-09-01T00:00:00Z' })).toBe('2025');
  });

  it('respects countsTowardSeasonRecord false', () => {
    expect(gameCountsTowardSeasonRecord({ countsTowardSeasonRecord: false })).toBe(false);
    expect(gameCountsTowardSeasonRecord({})).toBe(true);
  });

  it('recognizes completed games only when scores are present', () => {
    expect(isCompletedGame({ type: 'game', status: 'completed', homeScore: 2, awayScore: 1 })).toBe(true);
    expect(isCompletedGame({ type: 'game', status: 'completed' })).toBe(false);
    expect(isCompletedGame({ type: 'practice', status: 'completed', homeScore: 2, awayScore: 1 })).toBe(false);
  });

  it('calculates record by selected season and excludes no-record games', () => {
    const games = [
      { type: 'game', status: 'completed', seasonLabel: '2026', homeScore: 2, awayScore: 1 },
      { type: 'game', status: 'completed', seasonLabel: '2026', homeScore: 1, awayScore: 3 },
      { type: 'game', status: 'completed', seasonLabel: '2026', homeScore: 0, awayScore: 0 },
      { type: 'game', status: 'completed', seasonLabel: '2026', homeScore: 3, awayScore: 1, countsTowardSeasonRecord: false },
      { type: 'game', status: 'completed', seasonLabel: '2025', homeScore: 4, awayScore: 2 }
    ];

    expect(calculateSeasonRecord(games, { seasonLabel: '2026' })).toEqual({ wins: 1, losses: 1, ties: 1 });
    expect(calculateSeasonRecord(games, { seasonLabel: '2025' })).toEqual({ wins: 1, losses: 0, ties: 0 });
  });

  it('normalizes venue-oriented away scores and preserves mirrored score order', () => {
    const awayGame = { isHome: false, homeScore: 68, awayScore: 71 };
    const mirroredAwayGame = { ...awayGame, homeScore: 71, awayScore: 68, sharedScheduleSourceTeamId: 'team-alpha' };

    expect(getTeamScorePair(awayGame)).toEqual({ teamScore: 71, opponentScore: 68 });
    expect(getTeamScorePair(mirroredAwayGame)).toEqual({ teamScore: 71, opponentScore: 68 });
    expect(calculateSeasonRecord([
      { ...awayGame, type: 'game', status: 'completed', seasonLabel: '2026' },
      { ...mirroredAwayGame, type: 'game', status: 'completed', seasonLabel: '2026' }
    ], { seasonLabel: '2026' })).toEqual({ wins: 2, losses: 0, ties: 0 });
  });

  it('preserves team-oriented scores from legacy trackers and explicit writer metadata', () => {
    const legacyTrackedAwayGame = {
      isHome: false,
      homeScore: 71,
      awayScore: 68,
      opponentStats: {}
    };
    const explicitTeamOrientedGame = {
      isHome: false,
      homeScore: 3,
      awayScore: 1,
      scoreOrientation: 'team-opponent'
    };
    const explicitVenueGameWithLegacyPayload = {
      isHome: false,
      homeScore: 68,
      awayScore: 71,
      opponentStats: {},
      scoreOrientation: 'venue'
    };

    expect(getTeamScorePair(legacyTrackedAwayGame)).toEqual({ teamScore: 71, opponentScore: 68 });
    expect(getTeamScorePair(explicitTeamOrientedGame)).toEqual({ teamScore: 3, opponentScore: 1 });
    expect(getTeamScorePair(explicitVenueGameWithLegacyPayload)).toEqual({ teamScore: 71, opponentScore: 68 });
  });

  it('lists unique season labels in descending order', () => {
    const games = [
      { type: 'game', seasonLabel: '2024' },
      { type: 'game', seasonLabel: '2026' },
      { type: 'game', seasonLabel: '2025' },
      { type: 'practice', seasonLabel: '2027' }
    ];

    expect(listSeasonLabels(games)).toEqual(['2026', '2025', '2024']);
  });
});
