/**
 * Centralized currency formatting (#2073) — use Intl.NumberFormat instead of
 * manual `$` concatenation so amounts are locale/currency correct and consistent.
 */
export const defaultMoneyLocale = 'en-US';
export const defaultCurrency = 'USD';

/** Format a major-unit amount (e.g. dollars) as currency. */
export function formatCurrency(amount: number, currency: string = defaultCurrency, locale: string = defaultMoneyLocale): string {
  const value = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency || defaultCurrency
  }).format(value);
}

/** Format a minor-unit amount (e.g. cents) as currency. */
export function formatCurrencyFromCents(cents: number, currency: string = defaultCurrency, locale: string = defaultMoneyLocale): string {
  return formatCurrency((Number(cents) || 0) / 100, currency, locale);
}
