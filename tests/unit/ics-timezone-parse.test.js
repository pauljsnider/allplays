import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseICS } from '../../js/utils.js';

afterEach(() => {
    vi.restoreAllMocks();
});

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

    it('falls back when shortOffset is unavailable in the runtime', () => {
        const realDateTimeFormat = Intl.DateTimeFormat;
        vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) {
            if (options && options.timeZoneName === 'shortOffset') {
                return {
                    formatToParts() {
                        return [{ type: 'timeZoneName', value: 'EDT' }];
                    }
                };
            }
            return new realDateTimeFormat(locale, options);
        });

        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART;TZID=America/New_York:20260310T180000',
            'SUMMARY:Compatibility Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const [event] = parseICS(ics);
        expect(event.dtstart.toISOString()).toBe('2026-03-10T22:00:00.000Z');
    });

    it('falls back when shortOffset throws RangeError in unsupported browsers', () => {
        const realDateTimeFormat = Intl.DateTimeFormat;
        vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) {
            if (options && options.timeZoneName === 'shortOffset') {
                throw new RangeError('Unsupported timeZoneName value');
            }
            return new realDateTimeFormat(locale, options);
        });

        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART;TZID=America/New_York:20260310T180000',
            'SUMMARY:Compatibility Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const [event] = parseICS(ics);
        expect(event.dtstart.toISOString()).toBe('2026-03-10T22:00:00.000Z');
    });

    it('drops events with invalid numeric UTC offsets and emits warning', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART:20260310T180000+2460',
            'SUMMARY:Bad Offset Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith('Invalid ICS numeric UTC offset:', '20260310T180000+2460');
    });

    it('drops events when TZID cannot be resolved and emits warning', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART;TZID=Not/A_Real_Timezone:20260310T180000',
            'SUMMARY:Bad TZID Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            'Unable to resolve ICS TZID datetime, dropping event date:',
            'Not/A_Real_Timezone',
            '20260310T180000'
        );
    });

    it('drops non-existent DST spring-forward local times', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART;TZID=America/New_York:20260308T023000',
            'SUMMARY:DST Gap Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(0);
        expect(
            warnSpy.mock.calls.some((call) => (
                call[0] === 'Detected invalid or non-existent local time for ICS TZID datetime:'
            ))
        ).toBe(true);
    });
});
