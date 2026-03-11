import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    buildGlobalCalendarIcsEvent,
    getCalendarEventTrackingId,
    isTrackedCalendarEvent,
    parseICS
} from '../../js/utils.js';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('ICS recurring tracking ids', () => {
    it('keeps recurring occurrences distinct when matching tracked calendar events', () => {
        const ics = [
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:practice-series',
            'DTSTART:20260310T230000Z',
            'DTEND:20260311T000000Z',
            'RRULE:FREQ=WEEKLY;COUNT=3',
            'SUMMARY:Evening Practice',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n');

        const events = parseICS(ics);

        expect(events).toHaveLength(3);
        expect(getCalendarEventTrackingId(events[0])).toBe('practice-series__2026-03-10T23:00:00.000Z');
        expect(getCalendarEventTrackingId(events[1])).toBe('practice-series__2026-03-17T23:00:00.000Z');
        expect(isTrackedCalendarEvent(events[1], [events[0].id])).toBe(false);
        expect(isTrackedCalendarEvent(events[1], [events[1].id])).toBe(true);
    });

    it('uses occurrence ids in the global calendar model for recurring ICS events', () => {
        const [event] = parseICS([
            'BEGIN:VCALENDAR',
            'BEGIN:VEVENT',
            'UID:practice-series',
            'DTSTART:20260310T230000Z',
            'RRULE:FREQ=WEEKLY;COUNT=2',
            'SUMMARY:Evening Practice',
            'END:VEVENT',
            'END:VCALENDAR'
        ].join('\n'));

        const mappedEvent = buildGlobalCalendarIcsEvent({
            team: { id: 'team-1', name: 'Wildcats' },
            teamColor: '#f97316',
            event
        });

        expect(mappedEvent.id).toBe(event.id);
    });

    it('tracks calendar imports by occurrence id instead of bare uid', () => {
        const source = readEditSchedule();

        expect(source).toContain('calendarEventUid: getCalendarEventTrackingId(calendarEvent)');
    });
});
