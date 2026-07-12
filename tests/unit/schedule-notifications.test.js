import { describe, expect, it, vi } from 'vitest';
import {
    normalizeScheduleNotificationSettings,
    describeScheduleReminderWindow,
    buildScheduleChangeMessage,
    buildScheduleNotificationTargets,
    postScheduleNotificationTargets,
    buildAvailabilityReminderRecipients,
    buildAvailabilityReminderEmailPreview,
    buildRsvpReminderMessage,
    buildNextReminderAt,
    buildScheduleNotificationMetadata,
    sendPublicRsvpReminderEmails
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

    it('describes team default and fallback reminder windows', () => {
        expect(describeScheduleReminderWindow({ reminderHours: 24 })).toBe('Team default reminder window: 24 hours before event start.');
        expect(describeScheduleReminderWindow({ reminderHours: 48 })).toBe('Team default reminder window: 48 hours before event start.');
        expect(describeScheduleReminderWindow({ reminderHours: 72 })).toBe('Team default reminder window: 72 hours before event start.');
        expect(describeScheduleReminderWindow({})).toBe('Fallback reminder window: 24 hours before event start. No team default is set yet.');
    });

    it('builds due timestamp and pending audit metadata for pre-event reminders', () => {
        expect(buildNextReminderAt('2026-05-03T18:00:00.000Z', 48)).toBe('2026-05-01T18:00:00.000Z');

        const metadata = buildScheduleNotificationMetadata({
            settings: { enabled: true, reminderHours: 72 },
            action: 'created',
            sent: false,
            eventDate: '2026-05-03T18:00:00.000Z'
        });

        expect(metadata).toMatchObject({
            enabled: true,
            reminderHours: 72,
            delivery: 'team_chat',
            nextReminderAt: '2026-04-30T18:00:00.000Z',
            reminderStatus: 'pending',
            reminderSent: false,
            reminderSentAt: null,
            reminderCanceled: false,
            reminderCanceledAt: null,
            sent: false,
            sentAt: null,
            lastAction: 'created'
        });
    });

    it('marks disabled and canceled reminder state without leaving a due timestamp', () => {
        expect(buildScheduleNotificationMetadata({
            settings: { enabled: false, reminderHours: 24 },
            action: 'updated',
            eventDate: '2026-05-03T18:00:00.000Z'
        })).toMatchObject({
            enabled: false,
            nextReminderAt: null,
            reminderStatus: 'disabled',
            reminderSent: false,
            reminderCanceled: false
        });

        const canceledMetadata = buildScheduleNotificationMetadata({
            settings: { enabled: true, reminderHours: 24 },
            action: 'cancelled',
            userId: 'coach-1',
            eventDate: '2026-05-03T18:00:00.000Z'
        });

        expect(canceledMetadata).toMatchObject({
            enabled: true,
            nextReminderAt: null,
            reminderStatus: 'canceled',
            reminderSent: false,
            reminderCanceled: true,
            reminderCanceledBy: 'coach-1',
            lastAction: 'cancelled'
        });
        expect(canceledMetadata.reminderCanceledAt).toEqual(expect.any(String));
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

    it('targets only active roster players without an RSVP and their guardians', () => {
        const players = [
            { id: 'p1', name: 'A', parents: [{ userId: 'u1', email: 'one@example.com' }] },
            { id: 'p2', name: 'B', parents: [{ userId: 'u2', email: 'two@example.com' }] },
            { id: 'p3', name: 'C', parents: [{ userId: 'u2', email: 'two@example.com' }] },
            { id: 'p4', name: 'D', active: false, parents: [{ userId: 'u4' }] }
        ];
        const rsvps = [
            { userId: 'u1', playerIds: ['p1'], response: 'going' },
            { userId: 'coach', playerId: 'p3', response: 'maybe' },
            { userId: 'ignored', playerIds: ['p4'], response: 'not_responded' }
        ];

        expect(buildAvailabilityReminderRecipients(players, rsvps)).toEqual({
            playerIds: ['p2'],
            parentIds: ['u2'],
            parentEmails: ['two@example.com'],
            playerCount: 1,
            recipientCount: 1
        });
    });

    it('uses RSVP user links when RSVP rows omit player IDs', () => {
        const players = [
            { id: 'p1', parents: [{ userId: 'u1', email: 'one@example.com' }] },
            { id: 'p2', parents: [{ userId: 'u2', email: 'two@example.com' }] }
        ];
        const rsvps = [
            { userId: 'u1', response: 'going' }
        ];

        expect(buildAvailabilityReminderRecipients(players, rsvps)).toMatchObject({
            playerIds: ['p2'],
            parentIds: ['u2'],
            parentEmails: ['two@example.com'],
            playerCount: 1,
            recipientCount: 1
        });
    });

    it('uses private-profile parent contacts when public roster docs are redacted', () => {
        const players = [
            { id: 'p1', name: 'A', privateProfileParents: [{ userId: 'u1', email: 'one@example.com' }] },
            { id: 'p2', name: 'B', privateProfileParents: [{ userId: 'u2', email: 'two@example.com' }] }
        ];
        const rsvps = [
            { userId: 'u1', response: 'going' }
        ];

        expect(buildAvailabilityReminderRecipients(players, rsvps)).toMatchObject({
            playerIds: ['p2'],
            parentIds: ['u2'],
            parentEmails: ['two@example.com'],
            playerCount: 1,
            recipientCount: 1
        });
    });

    it('keeps push parent IDs aligned with the email reminder audience for the same no-response fixture', () => {
        const players = [
            { id: 'p1', name: 'A', parents: [{ userId: 'u1', email: 'one@example.com' }] },
            { id: 'p2', name: 'B', parents: [{ userId: 'u2', email: 'two@example.com' }] },
            { id: 'p3', name: 'C', parents: [{ userId: 'u3', email: 'three@example.com' }] }
        ];
        const rsvps = [
            { userId: 'u1', response: 'going' },
            { userId: 'u3', playerIds: ['p3'], response: 'maybe' }
        ];

        const recipients = buildAvailabilityReminderRecipients(players, rsvps);
        const preview = buildAvailabilityReminderEmailPreview(players, rsvps, new Set(recipients.playerIds));

        expect(recipients.playerIds).toEqual(['p2']);
        expect(recipients.parentIds).toEqual(['u2']);
        expect(preview.eligibleEmails).toEqual(['two@example.com']);
    });

    it('counts roster players without guardians as direct recipients', () => {
        const recipients = buildAvailabilityReminderRecipients([
            { id: 'p1', parents: [] },
            { id: 'p2', parents: [{ userId: 'u2' }] }
        ], []);

        expect(recipients.playerIds).toEqual(['p1', 'p2']);
        expect(recipients.parentIds).toEqual(['u2']);
        expect(recipients.recipientCount).toBe(2);
    });

    it('posts public RSVP email reminder requests with auth and event context', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ ok: true, sentCount: 2, linkCount: 6 })
        });
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('window', { __ALLPLAYS_CONFIG__: { functionsBaseUrl: 'https://functions.example.test/' } });

        const auth = {
            currentUser: { getIdToken: vi.fn().mockResolvedValue('id-token') },
            app: { options: { projectId: 'demo-project' } }
        };

        await expect(sendPublicRsvpReminderEmails({
            auth,
            teamId: 'team-1',
            gameId: 'game-1',
            eventType: 'game',
            eventTitle: 'vs. Wildcats',
            eventDate: new Date('2026-05-11T18:30:00.000Z')
        })).resolves.toEqual({ ok: true, sentCount: 2, linkCount: 6 });

        expect(fetchMock).toHaveBeenCalledWith('https://functions.example.test/sendPublicRsvpEmails', expect.objectContaining({
            method: 'POST',
            headers: {
                Authorization: 'Bearer id-token',
                'Content-Type': 'application/json'
            }
        }));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
            teamId: 'team-1',
            gameId: 'game-1',
            eventType: 'game',
            eventTitle: 'vs. Wildcats',
            eventDate: '2026-05-11T18:30:00.000Z'
        });

        vi.unstubAllGlobals();
    });

    it('maps network fetch failures to an actionable reminder service error', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
        vi.stubGlobal('fetch', fetchMock);
        vi.stubGlobal('window', { __ALLPLAYS_CONFIG__: { functionsBaseUrl: 'https://functions.example.test/' } });

        const auth = {
            currentUser: { getIdToken: vi.fn().mockResolvedValue('id-token') },
            app: { options: { projectId: 'demo-project' } }
        };

        await expect(sendPublicRsvpReminderEmails({
            auth,
            teamId: 'team-1',
            gameId: 'game-1',
            eventType: 'game',
            eventTitle: 'vs. Wildcats',
            eventDate: new Date('2026-05-11T18:30:00.000Z')
        })).rejects.toThrow('Could not reach the reminder service. Check your connection and try again.');

        vi.unstubAllGlobals();
    });

    it('builds parent email preview for no-response players', () => {
        const preview = buildAvailabilityReminderEmailPreview([
            { id: 'p1', name: 'A', parents: [{ userId: 'u1', email: 'one@example.com' }] },
            { id: 'p2', name: 'B', privateProfileParents: [{ userId: 'u2', email: 'pending' }] },
            { id: 'p3', name: 'C', parents: [{ userId: 'u3', email: 'three@example.com' }] }
        ], [
            { userId: 'u3', playerIds: ['p3'], response: 'going' }
        ]);

        expect(preview).toEqual({
            players: [
                {
                    playerId: 'p1',
                    playerName: 'A',
                    playerNumber: '',
                    parentEmails: ['one@example.com'],
                    hasEligibleParentEmail: true
                },
                {
                    playerId: 'p2',
                    playerName: 'B',
                    playerNumber: '',
                    parentEmails: [],
                    hasEligibleParentEmail: false
                }
            ],
            eligibleEmails: ['one@example.com'],
            eligibleEmailCount: 1,
            missingEmailPlayerIds: ['p2']
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
