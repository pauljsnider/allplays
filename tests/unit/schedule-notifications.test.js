import { describe, expect, it } from 'vitest';
import {
    normalizeScheduleNotificationSettings,
    buildScheduleChangeMessage,
    buildRsvpReminderMessage
} from '../../js/schedule-notifications.js';

describe('schedule notification helpers', () => {
    it('normalizes reminder settings to supported defaults', () => {
        expect(normalizeScheduleNotificationSettings()).toEqual({
            enabled: true,
            reminderHours: 24,
            delivery: 'team_chat'
        });

        expect(normalizeScheduleNotificationSettings({
            enabled: false,
            reminderHours: 72,
            delivery: 'team_chat'
        })).toEqual({
            enabled: false,
            reminderHours: 72,
            delivery: 'team_chat'
        });

        expect(normalizeScheduleNotificationSettings({
            reminderHours: 12,
            delivery: 'email'
        })).toEqual({
            enabled: true,
            reminderHours: 24,
            delivery: 'team_chat'
        });
    });

    it('builds schedule change messages with event context and coach note', () => {
        const message = buildScheduleChangeMessage({
            action: 'updated',
            eventType: 'game',
            title: 'vs. Wildcats',
            dateLabel: 'Tue, Mar 10 at 6:00 PM',
            location: 'Main Gym',
            note: 'Warmups start 20 minutes early.'
        });

        expect(message).toContain('Schedule update');
        expect(message).toContain('Game');
        expect(message).toContain('vs. Wildcats');
        expect(message).toContain('Tue, Mar 10 at 6:00 PM');
        expect(message).toContain('Main Gym');
        expect(message).toContain('Coach note: Warmups start 20 minutes early.');
    });

    it('builds RSVP reminder messages for the no-response group', () => {
        const message = buildRsvpReminderMessage({
            eventType: 'practice',
            title: 'Speed & Agility Practice',
            dateLabel: 'Thu, Mar 12 at 5:30 PM',
            missingCount: 4
        });

        expect(message).toContain('RSVP reminder');
        expect(message).toContain('Practice');
        expect(message).toContain('Speed & Agility Practice');
        expect(message).toContain('Thu, Mar 12 at 5:30 PM');
        expect(message).toContain('4 player(s) still have not responded');
    });
});
