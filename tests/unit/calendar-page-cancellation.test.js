import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readCalendarPage() {
    return readFileSync(new URL('../../calendar.html', import.meta.url), 'utf8');
}

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
    it('publishes stored events before queued feeds finish and retries queue-capacity outcomes', () => {
        const source = readCalendarPage();
        const storedEventsPublish = source.indexOf('onEvents?.(events);');
        const firstExternalFetch = source.indexOf('const icsEvents = await fetchLegacyCalendarFeed(calUrl);');

        expect(storedEventsPublish).toBeGreaterThan(-1);
        expect(firstExternalFetch).toBeGreaterThan(storedEventsPublish);
        expect(source).toContain("error?.code !== 'CALENDAR_IMPORT_QUEUE_FULL'");
        expect(source).toContain('await waitForCalendarImportCapacity();');
        expect(source).toContain('calendarEventsByTeam.set(team.id, events);');
        expect(source).toContain('publishCalendarEvents();');
    });

    it('does not convert a local import queue-capacity outcome into a partial schedule state', () => {
        const source = readCalendarPage();
        const externalLoader = source.match(/async function fetchLegacyCalendarFeed[\s\S]*?\n        }\n\n        function publishCalendarEvents/);

        expect(externalLoader?.[0]).toContain('CALENDAR_IMPORT_QUEUE_FULL');
        expect(externalLoader?.[0]).toContain('retryDeadline');
        expect(source).toContain('console.warn(\'Failed to load ICS calendar:\', e);');
        expect(source).not.toContain('partial');
    });
});
