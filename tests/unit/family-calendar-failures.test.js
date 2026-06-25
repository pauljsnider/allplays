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

        expect(source).toMatch(/recordExternalCalendarFailure\(\{\s*url:\s*calendarUrl,/);
        expect(source).toMatch(/recordExternalCalendarFailure\(\{\s*url:\s*calUrl,/);
        expect(source).toContain('return { calendarEvents: [] };');
        expect(source).toContain('return [];');
        expect(source).not.toContain("console.error('[family] Error fetching calendar:'");
    });

    it('explains empty schedules when external calendars could not load', () => {
        const source = readRepoFile('family.html');

        expect(source).toContain('No events in this filter.');
        expect(source).toContain('Some external calendars could not be loaded, so this schedule may be incomplete.');
    });

    it('shows an expired-link state before rendering any family details', () => {
        const source = readRepoFile('family.html');

        expect(source).toContain('function isFamilyShareTokenExpired(token)');
        expect(source).toContain("showError('This link has expired', 'Ask the parent to create a new family share link. Expired links never load player, team, or schedule details.')");
        expect(source).toContain('The family page link you used has expired, been revoked, or does not exist.');
    });
});
