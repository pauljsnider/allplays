import { describe, expect, it } from 'vitest';
import { getCalendarOccurrenceTrackingId, isCalendarOccurrenceTracked } from './calendarOccurrence';

describe('calendar occurrence provenance', () => {
  it('combines a reused source ID with the normalized occurrence start', () => {
    expect(getCalendarOccurrenceTrackingId('calendar-uid-1', new Date('2026-06-04T18:00:00Z')))
      .toBe('calendar-uid-1__2026-06-04T18:00:00.000Z');
  });

  it('does not append the start twice when the parser already supplied an occurrence ID', () => {
    const occurrenceId = 'calendar-uid-1__2026-06-04T18:00:00.000Z';
    expect(getCalendarOccurrenceTrackingId(occurrenceId, '2026-06-04T18:00:00Z')).toBe(occurrenceId);
  });

  it('matches only the materialized occurrence when later occurrences reuse the source ID', () => {
    const tracked = ['calendar-uid-1__2026-06-04T18:00:00.000Z'];

    expect(isCalendarOccurrenceTracked('calendar-uid-1', '2026-06-04T18:00:00Z', tracked)).toBe(true);
    expect(isCalendarOccurrenceTracked('calendar-uid-1', '2026-06-11T18:00:00Z', tracked)).toBe(false);
  });
});
