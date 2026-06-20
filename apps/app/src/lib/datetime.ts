/**
 * Centralized date/time formatting (#2073).
 *
 * Timezone policy: sports schedules are meaningful in the EVENT/VENUE-local time
 * the coach entered, not the viewer's device timezone. Event dates are currently
 * stored as absolute instants without a captured venue timezone, so these helpers
 * format in the viewer's local zone (the historical behavior) — but every call
 * site routes through here, so once per-venue timezones are captured we can thread
 * a `timeZone` in one place instead of auditing 10+ `toLocaleDateString('en-US')`
 * call sites. Locale is centralized too (en-US today, swappable when i18n lands).
 */
export const defaultDateLocale = 'en-US';

export type DateInput = Date | string | number | null | undefined;

export type DateTimeFormatOptions = Intl.DateTimeFormatOptions & {
  locale?: string;
};

function toDate(value: DateInput): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (value === null || value === undefined || value === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Generic formatter — returns '' for invalid/missing dates. */
export function formatDateTime(value: DateInput, { locale = defaultDateLocale, ...options }: DateTimeFormatOptions = {}): string {
  const date = toDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat(locale, options).format(date);
}

/** e.g. "Tue, Jun 24" */
export function formatShortDate(value: DateInput, options: DateTimeFormatOptions = {}): string {
  return formatDateTime(value, { weekday: 'short', month: 'short', day: 'numeric', ...options });
}

/** e.g. "3:30 PM" */
export function formatTimeOfDay(value: DateInput, options: DateTimeFormatOptions = {}): string {
  return formatDateTime(value, { hour: 'numeric', minute: '2-digit', ...options });
}

/** e.g. "Tuesday, June 24, 2026" */
export function formatLongDate(value: DateInput, options: DateTimeFormatOptions = {}): string {
  return formatDateTime(value, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', ...options });
}
