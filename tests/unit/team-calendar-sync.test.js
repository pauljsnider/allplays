import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readTeamPage() {
    return readFileSync(new URL('../../team.html', import.meta.url), 'utf8');
}

function readCalendarPage() {
    return readFileSync(new URL('../../calendar.html', import.meta.url), 'utf8');
}

function readWorkflowSchedule() {
    return readFileSync(new URL('../../workflow-schedule.html', import.meta.url), 'utf8');
}

describe('team calendar sync controls', () => {
    it('adds Sync Calendar controls next to the static ICS export', () => {
        const source = readTeamPage();

        expect(source).toContain('id="download-ics"');
        expect(source).toContain('id="sync-calendar"');
        expect(source).toContain('Sync Calendar');
        expect(source).toContain('id="sync-calendar-apple"');
        expect(source).toContain('Apple Calendar');
        expect(source).toContain('id="sync-calendar-google"');
        expect(source).toContain('Google Calendar');
        expect(source).toContain('id="sync-calendar-copy"');
        expect(source).toContain('Copy Link');
    });

    it('builds Apple, Google, and HTTPS private feed URLs', () => {
        const source = readTeamPage();

        expect(source).toContain("function getPrivateCalendarFeedUrl()");
        expect(source).toContain("currentTeam?.calendarSubscriptionUrl");
        expect(source).toContain("currentTeam?.calendarSubscriptionToken");
        expect(source).toContain("teamCalendarFeed");
        expect(source).toContain("return feedUrl.replace(/^https?:\\/\\//i, 'webcal://');");
        expect(source).toContain("https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl)}");
        expect(source).toContain("navigator.clipboard.writeText(feedUrl)");
    });

    it('documents live personal calendar sync while preserving static export guidance', () => {
        const source = readWorkflowSchedule();

        expect(source).toContain('Use <strong>Sync Calendar</strong>');
        expect(source).toContain('Apple Calendar');
        expect(source).toContain('Google Calendar');
        expect(source).toContain('copy the private HTTPS subscription link');
        expect(source).toContain('Use the existing <code>.ics</code> export');
    });
});

describe('all teams calendar sync controls', () => {
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

    it('builds selected-team private subscription links and wires modal actions', () => {
        const source = readCalendarPage();

        expect(source).toContain('function getSelectedCalendarTeam()');
        expect(source).toContain('function getPrivateCalendarFeedUrl(team = getSelectedCalendarTeam())');
        expect(source).toContain('team?.calendarSubscriptionUrl');
        expect(source).toContain('team?.calendarSubscriptionToken');
        expect(source).toContain('teamCalendarFeed');
        expect(source).toContain("return feedUrl.replace(/^https?:\\/\\//i, 'webcal://');");
        expect(source).toContain('https://calendar.google.com/calendar/render?cid=${encodeURIComponent(feedUrl)}');
        expect(source).toContain('navigator.clipboard.writeText(feedUrl)');
        expect(source).toContain("document.getElementById('sync-calendar')?.addEventListener('click', openSyncCalendarModal);");
        expect(source).toContain('Choose a team before syncing its calendar.');
    });
});
