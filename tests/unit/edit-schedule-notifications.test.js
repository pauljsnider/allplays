import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

describe('edit schedule notification wiring', () => {
    it('includes team-level reminder settings controls', () => {
        const source = readEditSchedule();

        expect(source).toContain('id="schedule-notification-settings"');
        expect(source).toContain('id="team-reminder-hours"');
        expect(source).toContain('<option value="24">24 hours before</option>');
        expect(source).toContain('<option value="48">48 hours before</option>');
        expect(source).toContain('<option value="72">72 hours before</option>');
        expect(source).toContain('id="save-team-reminder-settings-btn"');
        expect(source).toContain('id="team-reminder-settings-summary"');
    });

    it('clarifies reminder timing is stored for future delivery only', () => {
        const source = readEditSchedule();

        expect(source).toContain('Stored reminder timing');
        expect(source).toContain('saved with schedule events for future reminder delivery');
        expect(source).toContain('Timed reminders are not sent automatically today from this page.');
        expect(source).toContain('Store reminder timing on schedule events');
        expect(source).toContain('Timing to store');
        expect(source).toContain('Save Timing Defaults');
        expect(source).not.toContain('Save/edit flows can notify the team immediately, and RSVP reminders are sent from the event itself.');
        expect(source).not.toContain('Schedule reminders enabled');
    });

    it('includes notify-team and reminder-window controls in game and practice forms', () => {
        const source = readEditSchedule();

        expect(source).toContain('id="game-notify-team"');
        expect(source).toContain('id="game-notify-note"');
        expect(source).toContain('id="game-reminder-window-summary"');
        expect(source).toContain('id="game-reminder-window-detail"');
        expect(source).toContain('id="practice-notify-team"');
        expect(source).toContain('id="practice-notify-note"');
        expect(source).toContain('id="practice-reminder-window-summary"');
        expect(source).toContain('id="practice-reminder-window-detail"');
    });

    it('visually separates immediate notify-team actions from stored reminder timing', () => {
        const source = readEditSchedule();

        expect(source.match(/Immediate team chat notification/g)).toHaveLength(3);
        expect(source).toContain('Posts a team chat update now when this game is saved. Separate from stored reminder timing.');
        expect(source).toContain('Posts a team chat update now when this practice is saved. Separate from stored reminder timing.');
        expect(source).toContain('Sends immediate team chat updates after import. This does not schedule future timed reminders.');
        expect(source.match(/bg-emerald-50 border border-emerald-200 rounded-lg p-3/g)).toHaveLength(3);
        expect(source).toContain('id="csv-import-notify-team"');
        expect(source).toContain('Notify the team in chat after import');
    });

    it('wires the schedule notification helper and RSVP reminder action', () => {
        const source = readEditSchedule();

        expect(source).toContain("from './js/schedule-notifications.js?v=5'");
        expect(source).toContain('describeScheduleReminderWindow');
        expect(source).toContain('await postScheduleNotificationTargets({');
        expect(source).toContain('id="send-rsvp-reminder-btn"');
        expect(source).toContain('await sendRsvpReminder(');
        expect(source).toContain('sendPublicRsvpReminderEmails');
        expect(source).toContain("'scheduleNotifications.lastRsvpEmailCount': emailResult?.sentCount || 0");
        expect(source).toContain('await maybeNotifyScheduleChange(');
    });

    it('renders the inherited reminder window from team settings', () => {
        const source = readEditSchedule();

        expect(source).toContain('const windowDescription = describeScheduleReminderWindow(rawSettings);');
        expect(source).toContain('if (summaryEl) summaryEl.textContent = windowDescription;');
        expect(source).toContain('Inherited from the team reminder default');
    });

    it('refreshes stored event reminder state when team reminder settings change', () => {
        const source = readEditSchedule();

        expect(source).toContain('async function refreshEventReminderStateForTeamSettings(settings)');
        expect(source).toContain('await refreshEventReminderStateForTeamSettings(nextSettings);');
        expect(source).toContain("action: isCanceled ? 'cancelled' : 'updated'");
    });

    it('persists normalized team reminder settings to the team metadata path', () => {
        const source = readEditSchedule();

        expect(source).toContain('await updateTeam(currentTeamId, { scheduleNotifications: nextSettings });');
        expect(source).toContain('reminderHours: document.getElementById(\'team-reminder-hours\').value');
        expect(source).toContain('currentTeam = {\n                    ...(currentTeam || {}),\n                    scheduleNotifications: nextSettings\n                };');
        expect(source).toContain('renderTeamScheduleNotificationSettings(currentTeam);');
    });

    it('preserves scheduled reminder state when sending RSVP reminder audit updates', () => {
        const source = readEditSchedule();

        expect(source).toContain("'scheduleNotifications.lastAction': 'rsvp_reminder'");
        expect(source).toContain("'scheduleNotifications.lastRsvpReminderCount': missingCount");
        expect(source).not.toContain("action: 'rsvp_reminder',\n                            sent: true");
    });

    it('uses the submitted linked-opponent state for counterpart notifications', () => {
        const source = readEditSchedule();

        expect(source).toContain("const counterpartTeamId = gameData.opponentTeamId || null;");
        expect(source).not.toContain('gamesCache[editingGameId]?.sharedScheduleOpponentTeamId');
    });
});
