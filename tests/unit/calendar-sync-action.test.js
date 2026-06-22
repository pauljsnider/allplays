import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readCalendarPage() {
    return readFileSync(new URL('../../calendar.html', import.meta.url), 'utf8');
}

describe('calendar page live sync controls', () => {
    it('adds Sync Calendar controls next to the static ICS export', () => {
        const source = readCalendarPage();

        expect(source).toContain('id="export-ics-btn"');
        expect(source).toContain('id="sync-calendar"');
        expect(source).toContain('Sync Calendar');
        expect(source).toContain('id="sync-calendar-modal"');
        expect(source).toContain('id="sync-calendar-apple"');
        expect(source).toContain('Apple Calendar');
        expect(source).toContain('id="sync-calendar-google"');
        expect(source).toContain('Google Calendar');
        expect(source).toContain('id="sync-calendar-copy"');
        expect(source).toContain('Copy Link');
    });

    it('builds team-scoped Apple, Google, and HTTPS feed URLs', () => {
        const source = readCalendarPage();

        expect(source).toContain('function getSelectedSyncCalendarTeam()');
        expect(source).toContain('function getPrivateCalendarFeedUrl(team)');
        expect(source).toContain('team?.calendarSubscriptionUrl');
        expect(source).toContain('team?.calendarSubscriptionToken');
        expect(source).toContain('teamCalendarFeedFunctionUrl');
        expect(source).toContain('ALLPLAYS_TEAM_CALENDAR_FEED_URL');
        expect(source).toContain('teamCalendarFeed');
        expect(source).not.toContain('privateTeamCalendarIcs');
        expect(source).toContain("return feedUrl.replace(/^https?:\\/\\//i, 'webcal://');");
        expect(source).toContain("https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl)}");
        expect(source).toContain("navigator.clipboard.writeText(feedUrl)");
    });

    it('requires a selected team when multiple team calendars are visible', () => {
        const source = readCalendarPage();

        expect(source).toContain('Select a team before opening a live calendar subscription.');
        expect(source).toContain('const candidateTeams = calendarTeams.filter');
        expect(source).toContain('return candidateTeams.length === 1 ? candidateTeams[0] : null;');
    });
});
