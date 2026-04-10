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

    it('keeps TZID weekly recurrence on the same local wall-clock time across DST', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:dst-weekly-series',
            'DTSTART;TZID=America/New_York:20260301T180000',
            'DTEND;TZID=America/New_York:20260301T190000',
            'RRULE:FREQ=WEEKLY;COUNT=3',
            'SUMMARY:DST Practice',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        const toNewYorkTime = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        expect(events).toHaveLength(3);
        expect(events.map((event) => event.dtstart.toISOString())).toEqual([
            '2026-03-01T23:00:00.000Z',
            '2026-03-08T22:00:00.000Z',
            '2026-03-15T22:00:00.000Z'
        ]);
        expect(events.map((event) => toNewYorkTime.format(event.dtstart))).toEqual([
            '18:00',
            '18:00',
            '18:00'
        ]);
    });

    it('returns zero events when EXDATE excludes every generated occurrence', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:practice-series-all-exdated',
            'DTSTART:20260302T180000Z',
            'DTEND:20260302T190000Z',
            'RRULE:FREQ=WEEKLY;COUNT=1',
            'EXDATE:20260302T180000Z',
            'SUMMARY:Team Practice',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(0);
    });

    it('does not truncate weekly COUNT expansion for long intervals', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:yearly-like-weekly-series',
            'DTSTART:20260101T180000Z',
            'DTEND:20260101T190000Z',
            'RRULE:FREQ=WEEKLY;INTERVAL=52;COUNT=20',
            'SUMMARY:Annual Practice',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);

        expect(events).toHaveLength(20);
        expect(events[0].dtstart.toISOString()).toBe('2026-01-01T18:00:00.000Z');
        expect(events[19].dtstart.toISOString()).toBe('2044-12-08T18:00:00.000Z');
    });
});
