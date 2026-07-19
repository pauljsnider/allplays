import { describe, expect, it } from 'vitest';
import {
    MAX_ICS_OUTPUT_EVENTS,
    MAX_ICS_PARSE_BYTES,
    MAX_ICS_RAW_EVENTS,
    MAX_ICS_RECURRENCE_OCCURRENCES,
    MAX_ICS_TOTAL_RECURRENCE_OCCURRENCES,
    parseICS
} from '../../js/utils.js';

function expectCalendarParseLimit(ics, message) {
    try {
        parseICS(ics);
        throw new Error('Expected calendar parser to reject the input');
    } catch (error) {
        expect(error).toMatchObject({ code: 'CALENDAR_PARSE_LIMIT' });
        expect(error.message).toContain(message);
    }
}

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

    it('honors WKST when applying biweekly BYDAY cadence', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:biweekly-sunday-series',
            'DTSTART:20260302T180000Z',
            'DTEND:20260302T190000Z',
            'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3;BYDAY=SU;WKST=MO',
            'SUMMARY:Biweekly Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);

        expect(events).toHaveLength(3);
        expect(events.map((event) => event.dtstart.toISOString())).toEqual([
            '2026-03-08T18:00:00.000Z',
            '2026-03-22T18:00:00.000Z',
            '2026-04-05T18:00:00.000Z'
        ]);
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

    it('bounds recurrence expansion for each source event', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:bounded-series',
            'DTSTART:20260101T180000Z',
            'RRULE:FREQ=DAILY;COUNT=100000',
            'SUMMARY:Bounded Practice',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        expect(parseICS(ics)).toHaveLength(MAX_ICS_RECURRENCE_OCCURRENCES);
    });

    it('rejects source text and raw event counts above their global caps', () => {
        const oversized = `BEGIN:VCALENDAR\nX:${'A'.repeat(MAX_ICS_PARSE_BYTES)}\nEND:VCALENDAR`;
        expectCalendarParseLimit(oversized, 'parse size limit');

        const rawEvents = ['BEGIN:VCALENDAR'];
        for (let index = 0; index <= MAX_ICS_RAW_EVENTS; index += 1) {
            rawEvents.push(
                'BEGIN:VEVENT',
                `UID:raw-${index}`,
                'DTSTART:20260101T180000Z',
                `SUMMARY:Event ${index}`,
                'END:VEVENT'
            );
        }
        rawEvents.push('END:VCALENDAR');
        expectCalendarParseLimit(rawEvents.join('\n'), 'too many source events');
    });

    it('rejects aggregate recurrence amplification before it can exhaust memory', () => {
        const ics = ['BEGIN:VCALENDAR'];
        const masterCount = Math.floor(MAX_ICS_TOTAL_RECURRENCE_OCCURRENCES / MAX_ICS_RECURRENCE_OCCURRENCES) + 1;
        for (let index = 0; index < masterCount; index += 1) {
            ics.push(
                'BEGIN:VEVENT',
                `UID:repeat-${index}`,
                'DTSTART:20260101T180000Z',
                `RRULE:FREQ=DAILY;COUNT=${MAX_ICS_RECURRENCE_OCCURRENCES}`,
                `SUMMARY:Recurring ${index}`,
                'END:VEVENT'
            );
        }
        ics.push('END:VCALENDAR');

        expectCalendarParseLimit(ics.join('\n'), 'global occurrence limit');
    });

    it('enforces a final output cap across recurring and non-recurring events', () => {
        const ics = ['BEGIN:VCALENDAR'];
        const recurringMasters = Math.floor(MAX_ICS_TOTAL_RECURRENCE_OCCURRENCES / MAX_ICS_RECURRENCE_OCCURRENCES);
        const nonRecurringEvents = MAX_ICS_OUTPUT_EVENTS -
            (recurringMasters * MAX_ICS_RECURRENCE_OCCURRENCES) + 1;
        for (let index = 0; index < nonRecurringEvents; index += 1) {
            ics.push(
                'BEGIN:VEVENT',
                `UID:single-${index}`,
                'DTSTART:20260101T180000Z',
                `SUMMARY:Single ${index}`,
                'END:VEVENT'
            );
        }
        for (let index = 0; index < recurringMasters; index += 1) {
            ics.push(
                'BEGIN:VEVENT',
                `UID:output-repeat-${index}`,
                'DTSTART:20260101T180000Z',
                `RRULE:FREQ=DAILY;COUNT=${MAX_ICS_RECURRENCE_OCCURRENCES}`,
                `SUMMARY:Output recurring ${index}`,
                'END:VEVENT'
            );
        }
        ics.push('END:VCALENDAR');

        expectCalendarParseLimit(ics.join('\n'), 'output event limit');
    });
});
