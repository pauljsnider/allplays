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
        expect(source).toContain('id="save-team-reminder-settings-btn"');
        expect(source).toContain('24 hours before');
        expect(source).toContain('48 hours before');
        expect(source).toContain('72 hours before');
    });

    it('includes notify-team controls in game and practice forms', () => {
        const source = readEditSchedule();

        expect(source).toContain('id="game-notify-team"');
        expect(source).toContain('id="game-notify-note"');
        expect(source).toContain('id="practice-notify-team"');
        expect(source).toContain('id="practice-notify-note"');
        expect(source).toContain('Immediate team chat update. Separate from stored timed reminder metadata.');
    });

    it('shows the effective stored reminder window in event forms', () => {
        const source = readEditSchedule();

        expect(source).toContain('id="game-effective-reminder-window"');
        expect(source).toContain('id="practice-effective-reminder-window"');
        expect(source).toContain('function renderEffectiveReminderWindows');
        expect(source).toContain('Effective timed reminder metadata for this ${label}: ${settings.reminderHours} hours before start. Automated delivery is not active yet.');
    });

    it('wires the schedule notification helper and RSVP reminder action', () => {
        const source = readEditSchedule();

        expect(source).toContain("from './js/schedule-notifications.js?v=3'");
        expect(source).toContain('await postScheduleNotificationTargets({');
        expect(source).toContain('id="send-rsvp-reminder-btn"');
        expect(source).toContain('await sendRsvpReminder(');
        expect(source).toContain('await maybeNotifyScheduleChange(');
    });

    it('uses the submitted linked-opponent state for counterpart notifications', () => {
        const source = readEditSchedule();

        expect(source).toContain("const counterpartTeamId = gameData.opponentTeamId || null;");
        expect(source).not.toContain('gamesCache[editingGameId]?.sharedScheduleOpponentTeamId');
    });
});
