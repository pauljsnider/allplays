import { describe, it, expect } from 'vitest';
import { parseICS } from '../../js/utils.js';

describe('ICS timezone parsing', () => {
    it('parses TZID-based DTSTART as the declared timezone instant', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:tzid-event-1',
            'SUMMARY:Practice',
            'DTSTART;TZID=America/New_York:20260310T180000',
            'DTEND;TZID=America/New_York:20260310T193000',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(1);
        expect(events[0].dtstart.toISOString()).toBe('2026-03-10T22:00:00.000Z');
        expect(events[0].dtend.toISOString()).toBe('2026-03-10T23:30:00.000Z');
    });

    it('keeps UTC timestamps unchanged', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:utc-event-1',
            'SUMMARY:Game',
            'DTSTART:20260310T180000Z',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(1);
        expect(events[0].dtstart.toISOString()).toBe('2026-03-10T18:00:00.000Z');
    });

    it('preserves floating local timestamps when TZID is absent', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:floating-event-1',
            'SUMMARY:Scrimmage',
            'DTSTART:20260310T180000',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(1);
        expect(events[0].dtstart.getFullYear()).toBe(2026);
        expect(events[0].dtstart.getMonth()).toBe(2);
        expect(events[0].dtstart.getDate()).toBe(10);
        expect(events[0].dtstart.getHours()).toBe(18);
    });

    it('resolves DST-gap TZID times deterministically to the post-gap local clock time', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:dst-gap-event-1',
            'SUMMARY:Gap Case',
            'DTSTART;TZID=Australia/Sydney:20261004T023000',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(1);
        expect(events[0].dtstart.toISOString()).toBe('2026-10-03T16:30:00.000Z');

        const localTime = new Intl.DateTimeFormat('en-AU', {
            timeZone: 'Australia/Sydney',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        }).format(events[0].dtstart);

        expect(localTime).toBe('03:30');
    });
});
