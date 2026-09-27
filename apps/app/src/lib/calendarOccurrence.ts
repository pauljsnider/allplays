function normalizeOccurrenceDate(value: unknown) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof (value as any)?.toDate === 'function') {
    const date = (value as any).toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (!value) return null;
  const date = new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getCalendarOccurrenceTrackingId(sourceId: unknown, startsAt: unknown) {
  const normalizedSourceId = String(sourceId || '').trim();
  const normalizedStartsAt = normalizeOccurrenceDate(startsAt);
  if (!normalizedSourceId || !normalizedStartsAt) return '';
  const occurrenceSuffix = `__${normalizedStartsAt.toISOString()}`;
  return normalizedSourceId.endsWith(occurrenceSuffix)
    ? normalizedSourceId
    : `${normalizedSourceId}${occurrenceSuffix}`;
}

export function isCalendarOccurrenceTracked(sourceId: unknown, startsAt: unknown, trackedIds: unknown[] | Set<unknown>) {
  const occurrenceId = getCalendarOccurrenceTrackingId(sourceId, startsAt);
  if (!occurrenceId) return false;
  const normalizedTrackedIds = trackedIds instanceof Set
    ? trackedIds
    : new Set(Array.isArray(trackedIds) ? trackedIds : []);
  return normalizedTrackedIds.has(occurrenceId);
}
