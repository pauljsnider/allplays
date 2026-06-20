import { describe, expect, it } from 'vitest';
import { formatCurrency, formatCurrencyFromCents } from './money';

describe('money helpers', () => {
  it('formats a major-unit amount as USD', () => {
    expect(formatCurrency(20)).toBe('$20.00');
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('formats a cents amount', () => {
    expect(formatCurrencyFromCents(2000)).toBe('$20.00');
    expect(formatCurrencyFromCents(12345)).toBe('$123.45');
  });

  it('honors a currency override', () => {
    expect(formatCurrencyFromCents(2000, 'EUR', 'en-US')).toBe('€20.00');
  });

  it('coerces non-finite input to zero', () => {
    expect(formatCurrency(Number.NaN)).toBe('$0.00');
    expect(formatCurrencyFromCents(undefined as unknown as number)).toBe('$0.00');
  });
});
