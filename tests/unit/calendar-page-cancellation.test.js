import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fetchLegacyCalendarFeed } from '../../js/calendar-feed-loading.js';

function readCalendarPage() {
    return readFileSync(new URL('../../calendar.html', import.meta.url), 'utf8');
}

afterEach(() => {
    vi.useRealTimers();
});

describe('calendar page ICS cancellation handling', () => {
    it('delegates synced ICS event mapping to the shared global calendar helper', () => {
        const source = readCalendarPage();

        expect(source).toContain('buildGlobalCalendarIcsEvent');
        expect(source).toContain('mergeGlobalCalendarIcsEvents');
        expect(source).toContain('events.push(...mergeGlobalCalendarIcsEvents({');
        expect(source).not.toContain("status: 'scheduled'");
    });

    it('renders compact cancelled events with an explicit cancelled badge', () => {
        const source = readCalendarPage();

        expect(source).toContain("isCancelled ? '<span class=\"text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded\">CANCELLED</span>' : ''");
    });
});

describe('legacy calendar external-feed loading', () => {
    it('publishes stored events only for the authoritative team set before queued feeds finish', () => {
        const source = readCalendarPage();
        const storedEventsPublish = source.indexOf('onEvents?.(events);');
        const firstExternalFetch = source.indexOf('const icsEvents = await fetchLegacyCalendarFeed(calUrl, fetchAndParseCalendar);');

        expect(storedEventsPublish).toBeGreaterThan(-1);
        expect(firstExternalFetch).toBeGreaterThan(storedEventsPublish);
        expect(source).toContain('calendarEventsByTeam.clear();');
        expect(source).toContain('calendarTeams.flatMap((team) => calendarEventsByTeam.get(team.id) || [])');
        expect(source).toContain('calendarEventsByTeam.set(team.id, events);');
        expect(source).toContain('publishCalendarEvents();');
    });

    it('continues retrying when queue capacity remains exhausted beyond the old deadline', async () => {
        vi.useFakeTimers();
        const queueFullError = Object.assign(new Error('queue full'), { code: 'CALENDAR_IMPORT_QUEUE_FULL' });
        let attempts = 0;
        const fetchCalendar = async () => {
            attempts += 1;
            if (attempts <= 121) throw queueFullError;
            return [{ uid: 'event-after-capacity' }];
        };
        const resultPromise = fetchLegacyCalendarFeed('https://example.com/team.ics', fetchCalendar);

        await vi.advanceTimersByTimeAsync(30250);

        await expect(resultPromise).resolves.toEqual([{ uid: 'event-after-capacity' }]);
        expect(attempts).toBe(122);
    });

    it('still rejects non-capacity feed failures', async () => {
        const invalidFeedError = new Error('invalid calendar');

        await expect(fetchLegacyCalendarFeed(
            'https://example.com/team.ics',
            async () => { throw invalidFeedError; },
            async () => {}
        )).rejects.toBe(invalidFeedError);
    });
});
