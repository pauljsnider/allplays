import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('pre-event reminder dispatcher function', () => {
    it('registers a bounded scheduled dispatcher for due reminders', () => {
        expect(functionsSource).toContain('exports.dispatchDuePreEventReminders = functions.pubsub');
        expect(functionsSource).toContain(".schedule('every 15 minutes')");
        expect(functionsSource).toContain(".collectionGroup('games')");
        expect(functionsSource).toContain(".where('scheduleNotifications.nextReminderAt', '<=', dueIso)");
        expect(functionsSource).toContain('.limit(50)');
    });

    it('uses a transaction claim before sending and records sent audit state', () => {
        expect(functionsSource).toContain('firestore.runTransaction');
        expect(functionsSource).toContain("'scheduleNotifications.reminderStatus': 'sending'");
        expect(functionsSource).toContain("'scheduleNotifications.reminderStatus': 'sent'");
        expect(functionsSource).toContain("'scheduleNotifications.reminderSentAt': admin.firestore.FieldValue.serverTimestamp()");
        expect(functionsSource).toContain("'scheduleNotifications.nextReminderAt': admin.firestore.FieldValue.delete()");
        expect(functionsSource).toContain("'scheduleNotifications.pushSuccessCount'");
    });

    it('posts due pre-event reminders into team chat as an in-app fallback', () => {
        expect(functionsSource).toContain('async function postPreEventReminderChatMessage');
        expect(functionsSource).toContain('teams/${teamId}/chatMessages/${messageId}');
        expect(functionsSource).toContain('Schedule reminder: Upcoming team event');
        expect(functionsSource).toContain("type: 'pre-event-reminder'");
        expect(functionsSource).toContain("'scheduleNotifications.chatMessageId'");
        expect(functionsSource).toContain('chatMessageCreated');
    });

    it('keeps reminder delivery independent from chat fallback write failures', () => {
        const dispatchBody = functionsSource.slice(functionsSource.indexOf('async function dispatchDuePreEventReminders'));
        const chatWriteIndex = dispatchBody.indexOf('postPreEventReminderChatMessage');
        const chatErrorIndex = dispatchBody.indexOf("console.error('Failed to write pre-event reminder chat fallback'");
        const pushSendIndex = dispatchBody.indexOf('sendCategoryNotification({');
        const emailSendIndex = dispatchBody.indexOf('createPublicRsvpEmailDeliveries({');

        expect(chatWriteIndex).toBeGreaterThan(-1);
        expect(chatErrorIndex).toBeGreaterThan(chatWriteIndex);
        expect(pushSendIndex).toBeGreaterThan(chatErrorIndex);
        expect(emailSendIndex).toBeGreaterThan(pushSendIndex);
        expect(functionsSource).toContain("'scheduleNotifications.chatMessageError'");
    });

    it('does not route reminder fallback chat docs through live-chat push preferences', () => {
        expect(functionsSource).toContain('function isPreEventReminderChatMessage');
        expect(functionsSource).toContain("data?.aiMeta?.type === 'pre-event-reminder'");
        expect(functionsSource).toContain('if (isPreEventReminderChatMessage(data)) return null;');
    });

    it('skips cancelled, deleted, disabled, sent, sending, and past events', () => {
        expect(functionsSource).toContain('notifications.enabled === false');
        expect(functionsSource).toContain('notifications.reminderSent === true');
        expect(functionsSource).toContain("notifications.reminderStatus === 'sent'");
        expect(functionsSource).toContain("notifications.reminderStatus === 'sending'");
        expect(functionsSource).toContain("status === 'cancelled'");
        expect(functionsSource).toContain("status === 'canceled'");
        expect(functionsSource).toContain('eventDate <= now');
        expect(functionsSource).toContain('event?.deleted === true');
    });
});
