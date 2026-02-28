import { describe, it, expect } from 'vitest';
import { parseICS } from '../../js/utils.js';

describe('ICS timezone parsing', () => {
    it('parses TZID datetime values as declared timezone instants', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART;TZID=America/New_York:20260310T180000',
            'DTEND;TZID=America/New_York:20260310T193000',
            'SUMMARY:Away Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const [event] = parseICS(ics);

        expect(event.dtstart.toISOString()).toBe('2026-03-10T22:00:00.000Z');
        expect(event.dtend.toISOString()).toBe('2026-03-10T23:30:00.000Z');
    });

    it('parses numeric UTC offsets in datetime values', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART:20260310T180000-0500',
            'SUMMARY:Offset Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const [event] = parseICS(ics);

        expect(event.dtstart.toISOString()).toBe('2026-03-10T23:00:00.000Z');
    });

    it('keeps UTC Z-suffixed datetime behavior unchanged', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART:20260310T180000Z',
            'SUMMARY:UTC Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const [event] = parseICS(ics);

        expect(event.dtstart.toISOString()).toBe('2026-03-10T18:00:00.000Z');
    });
});
