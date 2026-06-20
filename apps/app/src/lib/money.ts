export type MoneyFormatOptions = {
  locale?: string | null;
  currency?: string | null;
  signDisplay?: Intl.NumberFormatOptions['signDisplay'];
  absolute?: boolean;
};

export function formatMoneyFromCents(cents: number, options: MoneyFormatOptions = {}) {
  const safeCents = Number.isFinite(Number(cents)) ? Number(cents) : 0;
  const amount = (options.absolute ? Math.abs(safeCents) : safeCents) / 100;
  const locale = String(options.locale || '').trim() || 'en-US';
  const currency = String(options.currency || '').trim() || 'USD';

  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    signDisplay: options.signDisplay || 'auto'
  }).format(amount);
}
