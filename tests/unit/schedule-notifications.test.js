import { describe, expect, it, vi } from 'vitest';
import {
    normalizeScheduleNotificationSettings,
    buildScheduleChangeMessage,
    buildScheduleNotificationTargets,
    postScheduleNotificationTargets,
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

    it('builds notification targets for both teams without duplicates', () => {
        expect(buildScheduleNotificationTargets({
            teamId: 'team-alpha',
            title: 'vs. Bravo FC',
            counterpartTeamId: 'team-bravo',
            counterpartTitle: 'vs. Alpha FC'
        })).toEqual([
            { teamId: 'team-alpha', title: 'vs. Bravo FC' },
            { teamId: 'team-bravo', title: 'vs. Alpha FC' }
        ]);

        expect(buildScheduleNotificationTargets({
            teamId: 'team-alpha',
            title: 'vs. Bravo FC',
            counterpartTeamId: 'team-alpha',
            counterpartTitle: 'vs. Alpha FC'
        })).toEqual([
            { teamId: 'team-alpha', title: 'vs. Bravo FC' }
        ]);
    });

    it('continues notifying remaining targets after an earlier target fails', async () => {
        const postChatMessage = vi
            .fn()
            .mockRejectedValueOnce(new Error('missing team-chat permission'))
            .mockResolvedValueOnce(undefined);

        const result = await postScheduleNotificationTargets({
            targets: [
                { teamId: 'team-alpha', title: 'vs. Bravo FC' },
                { teamId: 'team-bravo', title: 'vs. Alpha FC' }
            ],
            postChatMessage,
            senderId: 'user-1',
            senderName: 'Coach Kelly',
            senderEmail: 'coach@example.com',
            buildText: (target) => `Schedule update for ${target.title}`
        });

        expect(postChatMessage).toHaveBeenNthCalledWith(1, 'team-alpha', {
            text: 'Schedule update for vs. Bravo FC',
            senderId: 'user-1',
            senderName: 'Coach Kelly',
            senderEmail: 'coach@example.com'
        });
        expect(postChatMessage).toHaveBeenNthCalledWith(2, 'team-bravo', {
            text: 'Schedule update for vs. Alpha FC',
            senderId: 'user-1',
            senderName: 'Coach Kelly',
            senderEmail: 'coach@example.com'
        });
        expect(result).toEqual({
            sent: true,
            sentCount: 1,
            failedCount: 1,
            failures: [
                { teamId: 'team-alpha', message: 'missing team-chat permission' }
            ],
            errorMessage: 'missing team-chat permission'
        });
    });

    it('reports a full failure only when every target fails', async () => {
        const postChatMessage = vi.fn().mockRejectedValue(new Error('network unavailable'));

        const result = await postScheduleNotificationTargets({
            targets: [
                { teamId: 'team-alpha', title: 'vs. Bravo FC' },
                { teamId: 'team-bravo', title: 'vs. Alpha FC' }
            ],
            postChatMessage,
            senderId: 'user-1',
            senderName: 'Coach Kelly',
            senderEmail: 'coach@example.com',
            buildText: (target) => `Schedule update for ${target.title}`
        });

        expect(result).toEqual({
            sent: false,
            sentCount: 0,
            failedCount: 2,
            failures: [
                { teamId: 'team-alpha', message: 'network unavailable' },
                { teamId: 'team-bravo', message: 'network unavailable' }
            ],
            errorMessage: 'network unavailable; network unavailable'
        });
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
