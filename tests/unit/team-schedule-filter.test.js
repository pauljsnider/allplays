import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { filterScheduleEventsForPrint, getDefaultSchedulePrintOptions } from '../../js/schedule-print.js';

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

function loadGetAllEvents() {
    const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
    const start = source.indexOf('async function getAllEvents(team, dbGames) {');
    const end = source.indexOf('\n\n        async function renderSchedule(team, dbGames) {', start);

    if (start === -1 || end === -1) {
        throw new Error('Could not locate getAllEvents() in team.html');
    }

    const functionSource = source.slice(start, end);
    return new Function('context', `
        let currentTeamId = context.currentTeamId;
        let currentUser = context.currentUser;
        let currentTeamAccessInfo = context.currentTeamAccessInfo;
        let getTrackedCalendarEventUids = context.getTrackedCalendarEventUids;
        let fetchAndParseCalendar = context.fetchAndParseCalendar;
        let isTrackedCalendarEvent = context.isTrackedCalendarEvent;
        let isPracticeEvent = context.isPracticeEvent;
        let extractOpponent = context.extractOpponent;
        let normalizeAvailabilityPreferences = context.normalizeAvailabilityPreferences;
        let canManageTeamAvailability = context.canManageTeamAvailability;
        let getRsvpSummaries = context.getRsvpSummaries;
        let buildAvailabilityNoteRows = context.buildAvailabilityNoteRows;
        let getRsvps = context.getRsvps;
        let getMyRsvp = context.getMyRsvp;
        let isAvailabilityLocked = context.isAvailabilityLocked;
        let expandRecurrence = context.expandRecurrence;
        let console = context.console || globalThis.console;
        ${functionSource}
        return getAllEvents(context.team, context.dbGames);
    `);
}

function loadGetDefaultSchedulePrintEvents() {
    const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
    const start = source.indexOf('function getDefaultSchedulePrintEvents() {');
    const end = source.indexOf('\n        function renderScheduleFromControls()', start);

    if (start === -1 || end === -1) {
        throw new Error('Could not locate getDefaultSchedulePrintEvents() in team.html');
    }

    const functionSource = source.slice(start, end);
    return new Function('context', `
        let allScheduleEvents = context.allScheduleEvents;
        ${functionSource}
        return getDefaultSchedulePrintEvents();
    `);
}

function hoursFromNow(offsetHours) {
    return new Date(Date.now() + (offsetHours * 60 * 60 * 1000));
}

describe('team schedule filtering', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('defaults the team page schedule to all upcoming events while keeping recent results manual', () => {
        const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
        const getFilteredScheduleEvents = loadGetFilteredScheduleEvents();
        const completedGame = {
            type: 'db',
            isPractice: false,
            status: 'completed',
            date: hoursFromNow(-24),
            opponent: 'Past Win'
        };
        const justFinishedGame = {
            type: 'db',
            isPractice: false,
            status: 'completed',
            isCancelled: false,
            date: hoursFromNow(-1),
            opponent: 'Just Finished'
        };
        const laterGame = {
            type: 'db',
            isPractice: false,
            status: 'scheduled',
            isCancelled: false,
            date: hoursFromNow(48),
            opponent: 'Future Game'
        };
        const nextPractice = {
            type: 'db',
            isPractice: true,
            status: 'scheduled',
            isCancelled: false,
            date: hoursFromNow(24),
            opponent: 'Practice'
        };

        const initialEvents = getFilteredScheduleEvents({
            showPractices: true,
            scheduleViewFilter: 'all-upcoming',
            allScheduleEvents: [completedGame, justFinishedGame, laterGame, nextPractice]
        });
        const recentResults = getFilteredScheduleEvents({
            showPractices: true,
            scheduleViewFilter: 'recent-results',
            allScheduleEvents: [completedGame, justFinishedGame, laterGame, nextPractice]
        });

        expect(source).toContain("let scheduleViewFilter = 'all-upcoming';");
        expect(source).toContain("setScheduleFilter('all-upcoming');");
        expect(source).toContain("scheduleViewFilter = next || 'all-upcoming';");
        expect(source.indexOf('id="schedule-filter-all-upcoming"')).toBeLessThan(source.indexOf('id="schedule-filter-recent-results"'));
        expect(initialEvents.map((event) => event.opponent)).toEqual(['Practice', 'Future Game']);
        expect(recentResults.map((event) => event.opponent)).toEqual(['Just Finished', 'Past Win']);
    });

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

    it('prints the default upcoming schedule without depending on the Recent Results filter', () => {
        const getFilteredScheduleEvents = loadGetFilteredScheduleEvents();
        const getDefaultSchedulePrintEvents = loadGetDefaultSchedulePrintEvents();
        const completedGame = {
            type: 'db',
            isPractice: false,
            status: 'completed',
            date: hoursFromNow(-24),
            opponent: 'Past Win'
        };
        const upcomingGame = {
            type: 'db',
            isPractice: false,
            status: 'scheduled',
            date: hoursFromNow(24),
            opponent: 'Future Game'
        };
        const upcomingPractice = {
            type: 'db',
            isPractice: true,
            status: 'scheduled',
            date: hoursFromNow(48),
            opponent: 'Practice'
        };

        const recentResults = getFilteredScheduleEvents({
            showPractices: false,
            scheduleViewFilter: 'recent-results',
            allScheduleEvents: [completedGame, upcomingGame, upcomingPractice]
        });
        const printEvents = getDefaultSchedulePrintEvents({
            allScheduleEvents: [completedGame, upcomingGame, upcomingPractice]
        });
        const defaultPrintable = filterScheduleEventsForPrint(printEvents, getDefaultSchedulePrintOptions());

        expect(recentResults.map((event) => event.opponent)).toEqual(['Past Win']);
        expect(defaultPrintable.map((event) => event.opponent)).toEqual(['Future Game', 'Practice']);
        expect(readFileSync(new URL('../../team.html', import.meta.url), 'utf8')).toContain('printSchedule(getDefaultSchedulePrintEvents()');
    });

    it('prefills default print options for the next 30 days', () => {
        expect(getDefaultSchedulePrintOptions(new Date('2026-05-25T12:00:00Z'))).toEqual({
            startDate: '2026-05-25',
            endDate: '2026-06-24',
            eventType: 'all',
            blackAndWhite: false
        });
    });

    it('keeps default print options on local calendar days in UTC+ time zones', () => {
        const originalTimezone = process.env.TZ;
        process.env.TZ = 'Pacific/Kiritimati';
        try {
            expect(getDefaultSchedulePrintOptions(new Date(2026, 4, 25))).toEqual({
                startDate: '2026-05-25',
                endDate: '2026-06-24',
                eventType: 'all',
                blackAndWhite: false
            });
        } finally {
            process.env.TZ = originalTimezone;
        }
    });

    it('filters printable schedule events by default options and event type', () => {
        const events = [
            { date: '2026-05-01T18:00:00Z', type: 'game', opponent: 'Early' },
            { date: '2026-05-10T18:00:00Z', type: 'practice', title: 'Practice' },
            { date: '2026-05-12T18:00:00Z', type: 'game', opponent: 'In Range' },
            { date: '2026-05-13T18:00:00Z', type: 'game', opponent: 'Cancelled', isCancelled: true },
            { date: '2026-06-01T18:00:00Z', type: 'game', opponent: 'Late' }
        ];
        const baseOptions = {
            startDate: '2026-05-08',
            endDate: '2026-05-31'
        };

        const all = filterScheduleEventsForPrint(events, { ...baseOptions, eventType: 'all' });
        const games = filterScheduleEventsForPrint(events, { ...baseOptions, eventType: 'game' });
        const practices = filterScheduleEventsForPrint(events, { ...baseOptions, eventType: 'practice' });

        expect(all.map((event) => event.opponent || event.title)).toEqual(['Practice', 'In Range']);
        expect(games.map((event) => event.opponent)).toEqual(['In Range']);
        expect(practices.map((event) => event.title)).toEqual(['Practice']);
    });

    it('expands recurring practice masters into per-occurrence RSVP events on the team page', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));

        const getAllEvents = loadGetAllEvents();
        const requestedSummaryIds = [];
        const requestedMyRsvpIds = [];

        const events = await getAllEvents({
            currentTeamId: 'team-1',
            currentUser: {
                uid: 'parent-1',
                parentTeamIds: ['team-1']
            },
            currentTeamAccessInfo: {
                accessLevel: 'parent',
                hasAccess: true
            },
            team: {
                name: 'Team 1',
                availabilityPreferences: { noteVisibility: 'staff' },
                calendarUrls: []
            },
            dbGames: [
                {
                    id: 'practice-series',
                    type: 'practice',
                    isSeriesMaster: true,
                    date: new Date('2026-01-05T18:00:00Z'),
                    recurrence: {
                        freq: 'weekly',
                        interval: 1,
                        byDays: ['MO'],
                        count: 3
                    },
                    status: 'scheduled',
                    location: 'Main Field'
                }
            ],
            getTrackedCalendarEventUids: async () => [],
            fetchAndParseCalendar: async () => [],
            isTrackedCalendarEvent: () => false,
            isPracticeEvent: () => false,
            extractOpponent: () => 'Opponent',
            normalizeAvailabilityPreferences: (prefs) => prefs,
            canManageTeamAvailability: () => false,
            getRsvpSummaries: async (_teamId, gameIds) => {
                requestedSummaryIds.push(...gameIds);
                return new Map([[gameIds[1], { going: 1, maybe: 0, notGoing: 0 }]]);
            },
            buildAvailabilityNoteRows: () => [],
            getRsvps: async () => [],
            getMyRsvp: async (_teamId, gameId) => {
                requestedMyRsvpIds.push(gameId);
                return gameId === 'practice-series__2026-01-12' ? { response: 'going' } : null;
            },
            isAvailabilityLocked: () => false,
            expandRecurrence: (await import('../../js/utils.js')).expandRecurrence
        });

        expect(requestedSummaryIds).toEqual([
            'practice-series__2026-01-05',
            'practice-series__2026-01-12',
            'practice-series__2026-01-19'
        ]);
        expect(requestedMyRsvpIds).toEqual(requestedSummaryIds);
        expect(events.map((event) => event.id)).toEqual(requestedSummaryIds);
        expect(events[1]).toMatchObject({
            id: 'practice-series__2026-01-12',
            isPractice: true,
            myRsvp: 'going',
            rsvpSummary: { going: 1, maybe: 0, notGoing: 0 }
        });
        expect(events[1].date.toISOString()).toBe('2026-01-12T18:00:00.000Z');
    });

    it('wires the team availability filter and RSVP controls into team.html', () => {
        const source = readFileSync(new URL('../../team.html', import.meta.url), 'utf8');

        expect(source).toContain('id="schedule-filter-availability"');
        expect(source).toContain('submitTeamAvailabilityFromButton');
        expect(source).toContain('getRsvpSummaries');
        expect(source).toContain('no response');
    });
});
