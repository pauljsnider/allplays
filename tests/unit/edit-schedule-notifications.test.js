import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function readEditSchedule() {
    return readFileSync(new URL('../../edit-schedule.html', import.meta.url), 'utf8');
}

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const { getEventTitle, coerceDate, formatScheduleUpdateDate } = require('../../functions/schedule-notification-utils.cjs');

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

    it('marks CSV-imported events with import source metadata', () => {
        const source = readEditSchedule();

        expect(source).toContain("source: 'csv_import'");
        expect(source).toContain("importedFrom: 'edit-schedule-csv'");
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

    it('renders RSVP email recipient preview for no-response players', () => {
        const source = readEditSchedule();

        expect(source).toContain('buildAvailabilityReminderRecipients(players, rsvps)');
        expect(source).toContain('buildAvailabilityReminderEmailPreview(players, rsvps, notRespondedIds)');
        expect(source).toContain('RSVP email recipient preview');
        expect(source).toContain('No eligible parent or guardian email');
        expect(source).toContain('eligible parent/guardian');
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

describe('notifyGameCreated Cloud Function trigger', () => {
    function readNotifyGameCreatedTrigger() {
        return functionsSource.slice(
            functionsSource.indexOf('const notifyGameCreated = functions.firestore'),
            functionsSource.indexOf('exports.notifyGameCreated = notifyGameCreated;')
        );
    }

    it('is wired as an onCreate trigger on the games subcollection', () => {
        const triggerBody = readNotifyGameCreatedTrigger();

        expect(triggerBody).toContain(".document('teams/{teamId}/games/{gameId}')");
        expect(triggerBody).toContain('.onCreate(');
        expect(triggerBody).toContain('return sendCreatedScheduleEventNotification({ teamId, gameId, game });');
    });

    it('routes standard create pushes through the shared schedule notification helper', () => {
        expect(functionsSource).toContain("async function sendCreatedScheduleEventNotification({ teamId, gameId, game }) {");
        expect(functionsSource).toContain("const category = isPractice ? 'practice' : 'schedule';");
        expect(functionsSource).toContain("const title = isPractice ? `New practice: ${eventTitle}` : `New game: ${eventTitle}`;");
    });

    it('skips draft events and returns null', () => {
        const triggerBody = readNotifyGameCreatedTrigger();

        expect(triggerBody).toContain("if (status === 'draft') return null;");
    });

    it('routes large app import batches to the summary workflow', () => {
        const triggerBody = readNotifyGameCreatedTrigger();

        expect(triggerBody).toContain('if (importBatch && importBatch.totalCount > 3) {');
        expect(triggerBody).toContain('return registerScheduleImportBatchEvent({ teamId, gameId, game, batch: importBatch });');
    });

    it('finalizes partial app import batches after the client writes the successful import count', () => {
        expect(functionsSource).toContain("const notifyScheduleImportBatchCompleted = functions.firestore");
        expect(functionsSource).toContain(".document('teams/{teamId}/scheduleImportNotificationBatches/{batchId}')");
        expect(functionsSource).toContain('return sendScheduleImportBatchNotifications({');
        expect(functionsSource).toContain('if (!after || !after.importCompletedAt || after.sentAt || after.notificationClaimedAt) {');
    });

    it('stamps createdBy in db helpers so creators are excluded from create pushes', () => {
        expect(dbSource).toContain('gameData.createdBy = gameData.createdBy || auth.currentUser?.uid || null;');
        expect(dbSource).toContain('eventData.createdBy = eventData.createdBy || auth.currentUser?.uid || null;');
    });

    it('getEventTitle returns practice title for practice type', () => {
        expect(getEventTitle({ type: 'practice', title: 'Morning Drills' })).toBe('Morning Drills');
        expect(getEventTitle({ type: 'practice' })).toBe('Practice');
    });

    it('getEventTitle returns vs. opponent for game type', () => {
        expect(getEventTitle({ opponent: 'Wildcats' })).toBe('vs. Wildcats');
        expect(getEventTitle({ title: 'Championship' })).toBe('Championship');
        expect(getEventTitle({})).toBe('Game');
    });

    it('coerceDate parses ISO date strings', () => {
        const result = coerceDate('2026-06-15T18:00:00.000Z');
        expect(result).toBeInstanceOf(Date);
        expect(result.getFullYear()).toBe(2026);
    });

    it('coerceDate returns null for falsy values', () => {
        expect(coerceDate(null)).toBeNull();
        expect(coerceDate('')).toBeNull();
        expect(coerceDate(undefined)).toBeNull();
    });

    it('formatScheduleUpdateDate formats a date with a timezone', () => {
        const label = formatScheduleUpdateDate('2026-06-15T23:00:00.000Z', 'America/Chicago');
        expect(label).toContain('Mon');
        expect(label).toContain('Jun');
        expect(label).toContain('15');
    });

    it('formatScheduleUpdateDate returns empty string when timezone is missing', () => {
        expect(formatScheduleUpdateDate('2026-06-15T23:00:00.000Z', '')).toBe('');
        expect(formatScheduleUpdateDate('2026-06-15T23:00:00.000Z', null)).toBe('');
    });
});
