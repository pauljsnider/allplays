import { describe, expect, it } from 'vitest';
import { parseICS } from '../../js/utils.js';

describe('parseICS recurrence expansion', () => {
    it('expands weekly recurring events with COUNT into individual occurrences', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:practice-series',
            'DTSTART:20260302T180000Z',
            'DTEND:20260302T190000Z',
            'RRULE:FREQ=WEEKLY;COUNT=4',
            'SUMMARY:Team Practice',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);

        expect(events).toHaveLength(4);
        expect(events.map((event) => event.dtstart.toISOString())).toEqual([
            '2026-03-02T18:00:00.000Z',
            '2026-03-09T18:00:00.000Z',
            '2026-03-16T18:00:00.000Z',
            '2026-03-23T18:00:00.000Z'
        ]);
        expect(events.map((event) => event.dtend.toISOString())).toEqual([
            '2026-03-02T19:00:00.000Z',
            '2026-03-09T19:00:00.000Z',
            '2026-03-16T19:00:00.000Z',
            '2026-03-23T19:00:00.000Z'
        ]);
    });

    it('applies EXDATE exclusions to recurring occurrences', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:practice-series-with-exdate',
            'DTSTART:20260302T180000Z',
            'DTEND:20260302T190000Z',
            'RRULE:FREQ=WEEKLY;COUNT=4',
            'EXDATE:20260316T180000Z',
            'SUMMARY:Team Practice',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);

        expect(events).toHaveLength(3);
        expect(events.map((event) => event.dtstart.toISOString())).toEqual([
            '2026-03-02T18:00:00.000Z',
            '2026-03-09T18:00:00.000Z',
            '2026-03-23T18:00:00.000Z'
        ]);
    });
});
