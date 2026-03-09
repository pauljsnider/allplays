import { describe, expect, it } from 'vitest';
import { parseICS } from '../../js/utils.js';

describe('parseICS recurrence overrides', () => {
    it('replaces a generated recurring occurrence with its RECURRENCE-ID override', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:practice-series',
            'DTSTART:20260302T180000Z',
            'DTEND:20260302T190000Z',
            'RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO',
            'SUMMARY:Team Practice',
            'LOCATION:Gym A',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:practice-series',
            'RECURRENCE-ID:20260309T180000Z',
            'DTSTART:20260310T200000Z',
            'DTEND:20260310T210000Z',
            'SUMMARY:Team Practice - moved',
            'LOCATION:Gym B',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics).sort((a, b) => a.dtstart - b.dtstart);

        expect(events).toHaveLength(3);
        expect(events.map((event) => event.dtstart.toISOString())).toEqual([
            '2026-03-02T18:00:00.000Z',
            '2026-03-10T20:00:00.000Z',
            '2026-03-16T18:00:00.000Z'
        ]);
        expect(events.map((event) => event.id)).toEqual([
            'practice-series__2026-03-02T18:00:00.000Z',
            'practice-series__2026-03-09T18:00:00.000Z',
            'practice-series__2026-03-16T18:00:00.000Z'
        ]);
        expect(events[1].recurrenceId.toISOString()).toBe('2026-03-09T18:00:00.000Z');
        expect(events[1].summary).toBe('Team Practice - moved');
        expect(events[1].location).toBe('Gym B');
    });

    it('preserves sparse RECURRENCE-ID overrides that omit unchanged fields', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:practice-series',
            'DTSTART:20260302T180000Z',
            'DTEND:20260302T190000Z',
            'RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO',
            'SUMMARY:Team Practice',
            'LOCATION:Gym A',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:practice-series',
            'RECURRENCE-ID:20260309T180000Z',
            'DTSTART:20260310T200000Z',
            'DTEND:20260310T210000Z',
            'LOCATION:Gym B',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics).sort((a, b) => a.dtstart - b.dtstart);

        expect(events).toHaveLength(3);
        expect(events.map((event) => event.dtstart.toISOString())).toEqual([
            '2026-03-02T18:00:00.000Z',
            '2026-03-10T20:00:00.000Z',
            '2026-03-16T18:00:00.000Z'
        ]);
        expect(events[1].summary).toBe('Team Practice');
        expect(events[1].location).toBe('Gym B');
        expect(events[1].id).toBe('practice-series__2026-03-09T18:00:00.000Z');
    });

    it('suppresses generated occurrences for sparse cancelled exceptions', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:practice-series',
            'DTSTART:20260302T180000Z',
            'DTEND:20260302T190000Z',
            'RRULE:FREQ=WEEKLY;COUNT=3;BYDAY=MO',
            'SUMMARY:Team Practice',
            'END:VEVENT',
            'BEGIN:VEVENT',
            'UID:practice-series',
            'RECURRENCE-ID:20260309T180000Z',
            'STATUS:CANCELLED',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics).sort((a, b) => a.dtstart - b.dtstart);

        expect(events).toHaveLength(2);
        expect(events.map((event) => event.dtstart.toISOString())).toEqual([
            '2026-03-02T18:00:00.000Z',
            '2026-03-16T18:00:00.000Z'
        ]);
        expect(events.map((event) => event.id)).toEqual([
            'practice-series__2026-03-02T18:00:00.000Z',
            'practice-series__2026-03-16T18:00:00.000Z'
        ]);
    });
});
