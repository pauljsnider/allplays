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
        expect(source).toContain('function renderExternalCalendarStatus');
        expect(source).toContain('viewProjection.calendarWarnings.forEach((label, index) => {');
        expect(source).toContain('Some external calendars could not be loaded');
        expect(source).toContain('Events saved in ALL PLAYS are still shown.');
    });

    it('uses only server-projected teams, games, and external events', () => {
        const source = readRepoFile('family.html');

        expect(source).not.toContain('fetchAndParseCalendar');
        expect(source).not.toContain('getFamilyShareToken');
        expect(source).not.toContain('extraCalendarUrls');
        expect(source).not.toContain('getTeam(');
        expect(source).not.toContain('getGames(');
        expect(source).toContain('const projectedTeam = projectedTeamsById.get(teamId);');
        expect(source).toContain('projection.externalEvents.forEach(rawEvent => {');
        expect(source).toContain('Retry this page to load the complete schedule.');
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

        expect(source).toContain("expired: ['This link has expired', 'Ask the parent to create a new family share link. Expired links never load player, team, or schedule details.']");
        expect(source).toContain('showError(...messages[authoritativeReason]);');
        expect(source).toContain('The family page link you used has expired, been revoked, or does not exist.');
    });
});
