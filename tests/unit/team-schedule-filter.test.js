import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { filterScheduleEventsForPrint } from '../../js/schedule-print.js';

function loadGetFilteredScheduleEvents() {
    const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
    const start = source.indexOf('function getFilteredScheduleEvents() {');
    const end = source.indexOf('\n        function renderScheduleFromControls()', start);

    if (start === -1 || end === -1) {
        throw new Error('Could not locate getFilteredScheduleEvents() in team.html');
    }

    const functionSource = source.slice(start, end);
    return new Function('context', `
        let allScheduleEvents = context.allScheduleEvents;
        let showPractices = context.showPractices;
        let scheduleViewFilter = context.scheduleViewFilter;
        ${functionSource}
        return getFilteredScheduleEvents();
    `);
}

function hoursFromNow(offsetHours) {
    return new Date(Date.now() + (offsetHours * 60 * 60 * 1000));
}

describe('team schedule filtering', () => {
    it('forces practice visibility for the upcoming-practices filter even when the checkbox is off', () => {
        const getFilteredScheduleEvents = loadGetFilteredScheduleEvents();
        const result = getFilteredScheduleEvents({
            showPractices: false,
            scheduleViewFilter: 'upcoming-practices',
            allScheduleEvents: [
                {
                    type: 'db',
                    isPractice: false,
                    status: 'scheduled',
                    date: hoursFromNow(24),
                    opponent: 'Rivals FC'
                },
                {
                    type: 'calendar',
                    isPractice: true,
                    isCancelled: false,
                    date: hoursFromNow(25),
                    opponent: 'Practice'
                }
            ]
        });

        expect(result).toHaveLength(1);
        expect(result[0].isPractice).toBe(true);
        expect(result[0].opponent).toBe('Practice');
    });

    it('keeps cancelled future events out of all-upcoming and in past-events', () => {
        const getFilteredScheduleEvents = loadGetFilteredScheduleEvents();
        const cancelledEvent = {
            type: 'calendar',
            isPractice: false,
            isCancelled: true,
            date: hoursFromNow(48),
            opponent: 'Storm'
        };

        const allUpcoming = getFilteredScheduleEvents({
            showPractices: true,
            scheduleViewFilter: 'all-upcoming',
            allScheduleEvents: [cancelledEvent]
        });
        const pastEvents = getFilteredScheduleEvents({
            showPractices: true,
            scheduleViewFilter: 'past-events',
            allScheduleEvents: [cancelledEvent]
        });

        expect(allUpcoming).toHaveLength(0);
        expect(pastEvents).toHaveLength(1);
        expect(pastEvents[0].opponent).toBe('Storm');
    });

    it('shows only upcoming tracked games and practices in the availability view', () => {
        const getFilteredScheduleEvents = loadGetFilteredScheduleEvents();
        const result = getFilteredScheduleEvents({
            showPractices: false,
            scheduleViewFilter: 'availability',
            allScheduleEvents: [
                { type: 'calendar', isPractice: false, isCancelled: false, date: hoursFromNow(24), opponent: 'Imported' },
                { type: 'db', isPractice: false, isCancelled: false, date: hoursFromNow(25), opponent: 'Rivals' },
                { type: 'db', isPractice: true, isCancelled: false, date: hoursFromNow(26), opponent: 'Practice' },
                { type: 'db', isPractice: false, isCancelled: true, date: hoursFromNow(27), opponent: 'Cancelled' },
                { type: 'db', isPractice: false, isCancelled: false, date: hoursFromNow(-24), opponent: 'Past' }
            ]
        });

        expect(result.map((event) => event.opponent)).toEqual(['Rivals', 'Practice']);
    });

    it('filters printable schedule events by date range and event type', () => {
        const events = [
            { date: '2026-05-01T18:00:00Z', type: 'game', opponent: 'Early' },
            { date: '2026-05-10T18:00:00Z', type: 'practice', title: 'Practice' },
            { date: '2026-05-12T18:00:00Z', type: 'game', opponent: 'In Range' },
            { date: '2026-06-01T18:00:00Z', type: 'game', opponent: 'Late' }
        ];

        const games = filterScheduleEventsForPrint(events, {
            startDate: '2026-05-08',
            endDate: '2026-05-31',
            eventType: 'game'
        });

        expect(games.map((event) => event.opponent)).toEqual(['In Range']);
    });

    it('wires the team availability filter and RSVP controls into team.html', () => {
        const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');

        expect(source).toContain('id="schedule-filter-availability"');
        expect(source).toContain('submitTeamAvailabilityFromButton');
        expect(source).toContain('getRsvpSummaries');
        expect(source).toContain('no response');
    });
});
