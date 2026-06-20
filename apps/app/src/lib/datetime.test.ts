import { describe, expect, it } from 'vitest';
import { formatDateTime, formatLongDate, formatShortDate, formatTimeOfDay } from './datetime';

const sample = new Date('2026-06-24T15:30:00.000Z');

describe('datetime helpers', () => {
  it('formats a short date', () => {
    expect(formatShortDate(sample, { timeZone: 'UTC' })).toBe('Wed, Jun 24');
  });

  it('formats time of day', () => {
    expect(formatTimeOfDay(sample, { timeZone: 'UTC' })).toBe('3:30 PM');
  });

  it('formats a long date', () => {
    expect(formatLongDate(sample, { timeZone: 'UTC' })).toBe('Wednesday, June 24, 2026');
  });

  it('honors an explicit timeZone override', () => {
    expect(formatTimeOfDay(sample, { timeZone: 'America/New_York' })).toBe('11:30 AM');
  });

  it('accepts string/number inputs and returns empty for invalid dates', () => {
    expect(formatShortDate('2026-06-24T15:30:00.000Z', { timeZone: 'UTC' })).toBe('Wed, Jun 24');
    expect(formatShortDate(sample.getTime(), { timeZone: 'UTC' })).toBe('Wed, Jun 24');
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime('not a date')).toBe('');
    expect(formatDateTime(new Date('invalid'))).toBe('');
  });
});
