import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeTeamNotificationPreferences,
  getNotificationCategoryForGameChange
} from '../../js/notification-preferences.js';

describe('notification preference helpers', () => {
  it('normalizes missing preferences to disabled defaults', () => {
    expect(normalizeTeamNotificationPreferences(null)).toEqual(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it('keeps explicit enabled categories', () => {
    expect(normalizeTeamNotificationPreferences({
      liveChat: true,
      liveScore: false,
      schedule: true
    })).toEqual({
      liveChat: true,
      liveScore: false,
      schedule: true
    });
  });
});

describe('game notification category detection', () => {
  it('returns liveScore when score changed', () => {
    expect(getNotificationCategoryForGameChange(
      { homeScore: 1, awayScore: 2, date: '2026-03-01' },
      { homeScore: 2, awayScore: 2, date: '2026-03-01' }
    )).toBe('liveScore');
  });

  it('returns schedule when schedule fields changed', () => {
    expect(getNotificationCategoryForGameChange(
      { date: '2026-03-01', location: 'Field A', status: 'scheduled' },
      { date: '2026-03-02', location: 'Field A', status: 'scheduled' }
    )).toBe('schedule');
  });

  it('returns null when no relevant fields changed', () => {
    expect(getNotificationCategoryForGameChange(
      { date: '2026-03-01', notes: 'A' },
      { date: '2026-03-01', notes: 'B' }
    )).toBe(null);
  });
});
