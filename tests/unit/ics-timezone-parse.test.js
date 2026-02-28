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

    it('parses positive numeric UTC offsets by subtracting from local time', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART:20260310T180000+0500',
            'SUMMARY:Offset Plus Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const [event] = parseICS(ics);

        expect(event.dtstart.toISOString()).toBe('2026-03-10T13:00:00.000Z');
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

    it('falls back when shortOffset hour is not zero-padded', () => {
        const realDateTimeFormat = Intl.DateTimeFormat;
        vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) {
            if (options && options.timeZoneName === 'shortOffset') {
                return {
                    formatToParts() {
                        return [{ type: 'timeZoneName', value: 'GMT-5' }];
                    }
                };
            }
            return new realDateTimeFormat(locale, options);
        });

        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART;TZID=America/New_York:20260310T180000',
            'SUMMARY:Non Padded Offset Game',
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

    it('drops events with out-of-range numeric UTC offset hours and emits warning', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART:20260310T180000-9999',
            'SUMMARY:Bad Offset Hour Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith('Invalid ICS numeric UTC offset:', '20260310T180000-9999');
    });

    it('drops events when numeric UTC offset hour exceeds +/-14 and emits warning', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART:20260310T180000+2599',
            'SUMMARY:Bad Offset Range Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith('Invalid ICS numeric UTC offset:', '20260310T180000+2599');
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

    it('drops events when TZID is malformed and emits warning', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART;TZID=/:20260310T180000',
            'SUMMARY:Malformed TZID Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            'Malformed ICS TZID value, dropping event date:',
            '/',
            '20260310T180000'
        );
    });

    it('unescapes quoted TZID parameter separators before timezone resolution', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART;TZID="Custom\\,Zone\\;Region":20260310T180000',
            'SUMMARY:Escaped TZID Separators',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            'Unable to resolve ICS TZID datetime, dropping event date:',
            'Custom,Zone;Region',
            '20260310T180000'
        );
    });

    it('unescapes escaped quotes inside quoted TZID parameter values', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART;TZID="Custom\\\"Zone":20260310T180000',
            'SUMMARY:Escaped TZID Quote',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);
        expect(events).toHaveLength(0);
        expect(warnSpy).toHaveBeenCalledWith(
            'Unable to resolve ICS TZID datetime, dropping event date:',
            'Custom"Zone',
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

    it('warns when timezone offset iteration does not converge', () => {
        const realDateTimeFormat = Intl.DateTimeFormat;
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        let alternatingCall = 0;

        vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function (locale, options) {
            if (options && options.timeZoneName === 'shortOffset') {
                return {
                    formatToParts() {
                        alternatingCall += 1;
                        return [{
                            type: 'timeZoneName',
                            value: alternatingCall % 2 === 0 ? 'GMT-04' : 'GMT-05'
                        }];
                    }
                };
            }
            return new realDateTimeFormat(locale, options);
        });

        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'DTSTART;TZID=America/New_York:20260310T180000',
            'SUMMARY:Oscillating Offset Game',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const [event] = parseICS(ics);
        expect(event).toBeDefined();
        expect(event.dtstart instanceof Date).toBe(true);
        expect(
            warnSpy.mock.calls.some((call) => (
                call[0] === 'Timezone offset iteration did not converge for ICS TZID datetime:'
            ))
        ).toBe(true);
    });
});
