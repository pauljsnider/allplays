import { describe, expect, it, vi } from 'vitest';
import {
  formatDateTileParts,
  formatEventDate,
  formatEventTime,
  formatLongEventDate,
  formatLongMonthDay,
  formatMonthYear,
  formatShortMonthDay,
  resolveEventTimeZone
} from '../../apps/app/src/lib/datetime';
import { formatMoneyFromCents } from '../../apps/app/src/lib/money';
import { formatEventDateLabel, formatEventTimeLabel, getScheduleForecastHref } from '../../apps/app/src/lib/scheduleLogic';

describe('app Intl formatters', () => {
  it('formats schedule dates and times with an explicit event timezone', () => {
    const date = new Date('2026-07-20T23:30:00.000Z');

    expect(formatEventDate(date, { timeZone: 'America/New_York' })).toBe('Mon, Jul 20');
    expect(formatEventTime(date, { timeZone: 'America/New_York' })).toBe('7:30 PM');
    expect(formatLongEventDate(date, { timeZone: 'America/New_York' })).toBe('Monday, July 20, 2026');
    expect(formatLongMonthDay(date, { timeZone: 'America/New_York' })).toBe('Monday, July 20');
    expect(formatMonthYear(date, { timeZone: 'America/New_York' })).toBe('July 2026');
    expect(formatShortMonthDay(date, { timeZone: 'America/New_York' })).toBe('Jul 20');
    expect(formatDateTileParts(date, { timeZone: 'America/New_York' })).toEqual({
      month: 'Jul',
      day: '20',
      weekday: 'Mon'
    });
  });

  it('keeps scheduleLogic labels on the shared formatter path', () => {
    const date = new Date('2026-07-20T23:30:00.000Z');

    expect(formatEventDateLabel(date, { timeZone: 'America/Los_Angeles' })).toBe('Mon, Jul 20');
    expect(formatEventTimeLabel(date, { timeZone: 'America/Los_Angeles' })).toBe('4:30 PM');
  });

  it('uses timezone-aware dates for forecast search links', () => {
    const href = getScheduleForecastHref('Central Park, New York', new Date('2026-07-20T23:30:00.000Z'));
    const url = new URL(href);

    expect(url.searchParams.get('q')).toMatch(/weather in Central Park, New York on /);
  });

  it('falls back to the viewer timezone when an event timezone is absent or invalid', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      locale: 'en-US',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'America/Chicago'
    });

    expect(resolveEventTimeZone()).toBe('America/Chicago');
    expect(resolveEventTimeZone('Not/AZone')).toBe('America/Chicago');
  });

  it('formats currency and signed incentive amounts through Intl.NumberFormat', () => {
    expect(formatMoneyFromCents(123456)).toBe('$1,234.56');
    expect(formatMoneyFromCents(-2500, { signDisplay: 'always' })).toBe('-$25.00');
    expect(formatMoneyFromCents(2500, { signDisplay: 'always' })).toBe('+$25.00');
    expect(formatMoneyFromCents(-2500, { absolute: true })).toBe('$25.00');
    expect(formatMoneyFromCents(123456, { locale: 'en-GB', currency: 'GBP' })).toBe('£1,234.56');
  });
});
