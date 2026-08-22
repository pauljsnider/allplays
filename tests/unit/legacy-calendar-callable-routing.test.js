import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('legacy authenticated calendar routing', () => {
    it('routes every signed-in legacy schedule workflow through the team-scoped callable helper', () => {
        const calendar = readRepoFile('calendar.html');
        const team = readRepoFile('team.html');
        const parentDashboard = readRepoFile('parent-dashboard.html');
        const editSchedule = readRepoFile('edit-schedule.html');
        const gamePlan = readRepoFile('game-plan.html');

        expect(calendar).toContain('(url) => fetchAndParseCalendar(url, { teamId: team.id })');
        expect(team).toContain('fetchAndParseCalendar(calendarUrl, { teamId: currentTeamId })');
        expect(parentDashboard).toContain('fetchAndParseCalendar(calendarUrl, { teamId })');
        expect(editSchedule).toContain('fetchAndParseCalendar(calendarUrl, { teamId: currentTeamId })');
        expect(gamePlan).toContain('fetchAndParseCalendar(calendarUrl, { teamId })');

        for (const source of [calendar, team, parentDashboard, editSchedule, gamePlan]) {
            expect(source).not.toMatch(/fetchAndParseCalendar\((?:calendarUrl|calUrl)\);/);
        }
    });

    it('marks per-source failures incomplete and renders retryable warnings without discarding known events', () => {
        const calendar = readRepoFile('calendar.html');
        const team = readRepoFile('team.html');
        const parentDashboard = readRepoFile('parent-dashboard.html');
        const editSchedule = readRepoFile('edit-schedule.html');
        const gamePlan = readRepoFile('game-plan.html');

        expect(calendar).toContain("id=\"calendar-load-warning\"");
        expect(calendar).toContain('onPartial?.();');
        expect(calendar).toContain('renderCalendarCompletenessWarning(calendarLoadIncomplete);');
        expect(calendar.indexOf('onEvents?.(events);')).toBeLessThan(calendar.indexOf('// Load ICS calendar events'));

        expect(team).toContain("id=\"team-schedule-load-warning\"");
        expect(team).toContain('teamScheduleIncomplete = true;');
        expect(team).toContain('publicCalendarEvents = publicCalendarProjection.events;');
        expect(team).toContain('!publicCalendarProjection.complete || publicCalendarProjection.warnings.length > 0');
        expect(team).toContain("classList.toggle('hidden', !teamScheduleIncomplete)");
        expect(team.indexOf('for (const game of (dbGames || []))')).toBeLessThan(team.indexOf('for (const calendarSource of calendarSources)'));
        expect(team).toContain('resolveTeamExternalCalendarEventsForLoad(');
        expect(team).toContain('lastCompleteExternalScheduleEventsByTeam,\n                currentTeamId');
        expect(team).toContain('if (allEvents.length === 0 && resolvedExternalEvents.length > 0) {');

        expect(parentDashboard).toContain("id=\"parent-schedule-load-warning\"");
        expect(parentDashboard).toContain('parentScheduleIncomplete = true;');
        expect(parentDashboard).toContain("classList.toggle('hidden', !parentScheduleIncomplete)");
        expect(parentDashboard.indexOf('// DB games for this team')).toBeLessThan(parentDashboard.indexOf('// Calendar (ICS) events for this team'));

        expect(editSchedule).toContain("id=\"schedule-load-warning\"");
        expect(editSchedule).toContain('externalCalendarLoadComplete = false;');
        expect(editSchedule).toContain('calendarLoadIncomplete = !externalCalendarLoadComplete;');
        expect(editSchedule).toContain("classList.toggle('hidden', !calendarLoadIncomplete)");
        expect(editSchedule).toContain('// Add DB events (games and practices), expanding recurring series');

        expect(gamePlan).toContain("id=\"calendar-load-warning\"");
        expect(gamePlan).toContain('externalCalendarLoadComplete = false;');
        expect(gamePlan).toContain('calendarLoadIncomplete = !externalCalendarLoadComplete;');
        expect(gamePlan).toContain("classList.toggle('hidden', !calendarLoadIncomplete)");
        expect(gamePlan).toContain("combinedGames = [...games.map(g => ({ ...g, source: 'db' })), ...calendarGames]");

        for (const source of [calendar, team, parentDashboard, editSchedule, gamePlan]) {
            expect(source).toContain('Retry to load the complete');
        }
    });

    it('keeps anonymous family schedules exclusively on the versioned server projection', () => {
        const family = readRepoFile('family.html');

        expect(family).toContain('viewProjection = await getFamilyShareView(tokenId)');
        expect(family).not.toContain('fetchAndParseCalendar');
        expect(family).not.toContain('getFamilyShareToken');
        expect(family).not.toContain('resolveFamilyShareTokenChildren');
        expect(family).not.toContain('extraCalendarUrls');
        expect(family).not.toContain('getTeam(');
        expect(family).not.toContain('getGames(');
        expect(family).toContain('Number(projection?.projectionVersion) !== 2');
        expect(family).toContain('projection.externalEvents.forEach(rawEvent => {');
        expect(family).toContain('Retry this page to load the complete schedule.');
        expect(family).toContain("document.getElementById('page-error-retry')?.addEventListener('click'");
    });

    it('does not place source calendar URLs in legacy failure logs', () => {
        const sources = [
            readRepoFile('calendar.html'),
            readRepoFile('team.html'),
            readRepoFile('parent-dashboard.html'),
            readRepoFile('edit-schedule.html'),
            readRepoFile('game-plan.html'),
            readRepoFile('family.html')
        ];

        for (const source of sources) {
            expect(source).not.toMatch(/console\.(?:warn|error)\([^\n]*(?:calendarUrl|calUrl)/);
        }
    });
});
