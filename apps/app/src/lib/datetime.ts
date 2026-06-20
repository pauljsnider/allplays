export const DEFAULT_APP_LOCALE = 'en-US';

export type DateTimeFormatOptions = {
  locale?: string | null;
  timeZone?: string | null;
};

export function getViewerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function resolveDateTimeLocale(locale?: string | null) {
  return String(locale || '').trim() || DEFAULT_APP_LOCALE;
}

export function resolveEventTimeZone(timeZone?: string | null) {
  const candidate = String(timeZone || '').trim();
  if (candidate && isSupportedTimeZone(candidate)) {
    return candidate;
  }

  const viewerTimeZone = getViewerTimeZone();
  return isSupportedTimeZone(viewerTimeZone) ? viewerTimeZone : 'UTC';
}

export function formatDateTime(
  date: Date,
  formatOptions: Intl.DateTimeFormatOptions,
  options: DateTimeFormatOptions = {}
) {
  return new Intl.DateTimeFormat(resolveDateTimeLocale(options.locale), {
    ...formatOptions,
    timeZone: resolveEventTimeZone(options.timeZone)
  }).format(date);
}

export function formatEventDate(date: Date, options: DateTimeFormatOptions = {}) {
  return formatDateTime(date, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }, options);
}

export function formatEventTime(date: Date, options: DateTimeFormatOptions = {}) {
  return formatDateTime(date, {
    hour: 'numeric',
    minute: '2-digit'
  }, options);
}

export function formatLongEventDate(date: Date, options: DateTimeFormatOptions = {}) {
  return formatDateTime(date, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }, options);
}

export function formatMonthYear(date: Date, options: DateTimeFormatOptions = {}) {
  return formatDateTime(date, {
    month: 'long',
    year: 'numeric'
  }, options);
}

export function formatLongMonthDay(date: Date, options: DateTimeFormatOptions = {}) {
  return formatDateTime(date, {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  }, options);
}

export function formatShortMonthDay(date: Date, options: DateTimeFormatOptions = {}) {
  return formatDateTime(date, {
    month: 'short',
    day: 'numeric'
  }, options);
}

export function formatDateTileParts(date: Date, options: DateTimeFormatOptions = {}) {
  const formatter = new Intl.DateTimeFormat(resolveDateTimeLocale(options.locale), {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
    timeZone: resolveEventTimeZone(options.timeZone)
  });
  const parts = formatter.formatToParts(date);
  return {
    month: getPart(parts, 'month'),
    day: getPart(parts, 'day'),
    weekday: getPart(parts, 'weekday')
  };
}

function isSupportedTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat(DEFAULT_APP_LOCALE, { timeZone }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function getPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value || '';
}
