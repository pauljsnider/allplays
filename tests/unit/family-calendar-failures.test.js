import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('family page external calendar failures', () => {
    it('surfaces non-blocking external calendar failures in the schedule card', () => {
        const source = readRepoFile('family.html');

        expect(source).toContain('id="external-calendar-status"');
        expect(source).toContain('let externalCalendarFailures = [];');
        expect(source).toContain('function recordExternalCalendarFailure');
        expect(source).toContain('function renderExternalCalendarStatus');
        expect(source).toContain('Some external calendars could not be loaded');
        expect(source).toContain('Events saved in ALL PLAYS are still shown.');
    });

    it('records both team and share-token calendar failures without blocking the page', () => {
        const source = readRepoFile('family.html');

        expect(source).toContain('recordExternalCalendarFailure({\n                url: calendarUrl,');
        expect(source).toContain('recordExternalCalendarFailure({\n              url: calUrl,');
        expect(source).toContain('return { calendarEvents: [] };');
        expect(source).toContain('return [];');
        expect(source).not.toContain("console.error('[family] Error fetching calendar:'");
    });

    it('explains empty schedules when external calendars could not load', () => {
        const source = readRepoFile('family.html');

        expect(source).toContain('No events in this filter.');
        expect(source).toContain('Some external calendars could not be loaded, so this schedule may be incomplete.');
    });
});
