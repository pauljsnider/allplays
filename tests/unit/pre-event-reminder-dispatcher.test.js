import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
    PRE_EVENT_REMINDER_QUERY_PAGE_SIZE,
    drainDueReminderPages
} = require('../../functions/pre-event-reminder-dispatcher-core.cjs');

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function createDoc(id, dueIso, status = 'pending') {
    return {
        id,
        dueIso,
        scheduleNotifications: {
            nextReminderAt: dueIso,
            reminderStatus: status
        }
    };
}

describe('pre-event reminder dispatcher function', () => {
    it('registers a bounded scheduled dispatcher that drains ordered pages of due reminders', () => {
        expect(functionsSource).toContain('exports.dispatchDuePreEventReminders = functions.pubsub');
        expect(functionsSource).toContain(".schedule('every 15 minutes')");
        expect(functionsSource).toContain(".collectionGroup('games')");
        expect(functionsSource).toContain(".where('scheduleNotifications.nextReminderAt', '<=', dueIso)");
        expect(functionsSource).toContain(".orderBy('scheduleNotifications.nextReminderAt')");
        expect(functionsSource).toContain('drainDueReminderPages({');
        expect(functionsSource).toContain('PRE_EVENT_REMINDER_MAX_PAGES_PER_RUN');
        expect(functionsSource).toContain('PRE_EVENT_REMINDER_MAX_RUNTIME_MS');
        expect(functionsSource).not.toContain(".where('scheduleNotifications.nextReminderAt', '<=', dueIso)\n    .limit(50)\n    .get();");
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
        const rsvpPushSendIndex = dispatchBody.indexOf('sendRsvpReminderPushNotifications({');

        expect(chatWriteIndex).toBeGreaterThan(-1);
        expect(chatErrorIndex).toBeGreaterThan(chatWriteIndex);
        expect(pushSendIndex).toBeGreaterThan(chatErrorIndex);
        expect(emailSendIndex).toBeGreaterThan(pushSendIndex);
        expect(rsvpPushSendIndex).toBeGreaterThan(emailSendIndex);
        expect(dispatchBody).toContain('recipientUserIds: emailResult.recipientUserIds');
        expect(functionsSource).toContain("'scheduleNotifications.chatMessageError'");
        expect(functionsSource).toContain("firestore.collection(`teams/${teamId}/notificationTargets`)");
    });

    it('records separate RSVP reminder push metrics for scheduled reminders', () => {
        expect(functionsSource).toContain('async function sendRsvpReminderPushNotifications');
        expect(functionsSource).toContain("category: 'rsvp'");
        expect(functionsSource).toContain("'scheduleNotifications.rsvpPushSuccessCount'");
        expect(functionsSource).toContain("'scheduleNotifications.rsvpPushFailureCount'");
        expect(functionsSource).toContain("'scheduleNotifications.rsvpPushTargetCount'");
        expect(functionsSource).toContain("'scheduleNotifications.rsvpPushError'");
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

describe('drainDueReminderPages', () => {
    it('drains 120 due docs across three ordered pages in one invocation', async () => {
        const dueIso = '2026-06-03T09:00:00.000Z';
        const docs = Array.from({ length: 120 }, (_, index) => createDoc(
            `game-${String(index + 1).padStart(3, '0')}`,
            dueIso,
            'pending'
        ));
        const processedIds = [];
        const loadPage = vi.fn(async ({ cursor, limit }) => {
            const startIndex = cursor ? docs.findIndex((doc) => doc.id === cursor.id) + 1 : 0;
            const pageDocs = docs.slice(startIndex, startIndex + limit);
            return {
                docs: pageDocs,
                nextCursor: pageDocs[pageDocs.length - 1] || null
            };
        });

        const summary = await drainDueReminderPages({
            now: new Date(dueIso),
            loadPage,
            processReminder: async (doc) => {
                processedIds.push(doc.id);
                return doc.id;
            }
        });

        expect(loadPage).toHaveBeenCalledTimes(3);
        expect(summary.stoppedBecause).toBe('drained');
        expect(processedIds).toHaveLength(120);
        expect(processedIds).toEqual(docs.map((doc) => doc.id));
        expect(loadPage.mock.calls[0][0]).toMatchObject({ limit: PRE_EVENT_REMINDER_QUERY_PAGE_SIZE, cursor: null });
        expect(loadPage.mock.calls[1][0].cursor.id).toBe('game-050');
        expect(loadPage.mock.calls[2][0].cursor.id).toBe('game-100');
    });

    it('preserves skip semantics for already claimed or sent docs on later pages', async () => {
        const dueIso = '2026-06-03T09:00:00.000Z';
        const docs = [
            ...Array.from({ length: 50 }, (_, index) => createDoc(`game-a-${index + 1}`, dueIso)),
            createDoc('game-b-1', dueIso, 'sending'),
            createDoc('game-b-2', dueIso, 'sent'),
            ...Array.from({ length: 18 }, (_, index) => createDoc(`game-b-${index + 3}`, dueIso))
        ];
        const sendAttemptIds = [];

        const summary = await drainDueReminderPages({
            now: new Date(dueIso),
            loadPage: async ({ cursor, limit }) => {
                const startIndex = cursor ? docs.findIndex((doc) => doc.id === cursor.id) + 1 : 0;
                const pageDocs = docs.slice(startIndex, startIndex + limit);
                return {
                    docs: pageDocs,
                    nextCursor: pageDocs[pageDocs.length - 1] || null
                };
            },
            processReminder: async (doc) => {
                if (doc.scheduleNotifications.reminderStatus === 'sending' || doc.scheduleNotifications.reminderStatus === 'sent') {
                    return null;
                }
                sendAttemptIds.push(doc.id);
                return doc.id;
            }
        });

        expect(summary.stoppedBecause).toBe('drained');
        expect(sendAttemptIds).toHaveLength(68);
        expect(sendAttemptIds).not.toContain('game-b-1');
        expect(sendAttemptIds).not.toContain('game-b-2');
        expect(new Set(sendAttemptIds).size).toBe(sendAttemptIds.length);
    });

    it('stops cleanly when it hits the configured page guard', async () => {
        const dueIso = '2026-06-03T09:00:00.000Z';
        const docs = Array.from({ length: 130 }, (_, index) => createDoc(`game-${index + 1}`, dueIso));

        const summary = await drainDueReminderPages({
            now: new Date(dueIso),
            maxPages: 2,
            loadPage: async ({ cursor, limit }) => {
                const startIndex = cursor ? docs.findIndex((doc) => doc.id === cursor.id) + 1 : 0;
                const pageDocs = docs.slice(startIndex, startIndex + limit);
                return {
                    docs: pageDocs,
                    nextCursor: pageDocs[pageDocs.length - 1] || null
                };
            },
            processReminder: async (doc) => doc.id
        });

        expect(summary.stoppedBecause).toBe('maxPages');
        expect(summary.results).toHaveLength(100);
    });
});
