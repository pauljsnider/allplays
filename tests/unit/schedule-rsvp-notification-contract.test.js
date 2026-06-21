import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const scheduleLogicSource = readFileSync(new URL('../../apps/app/src/lib/scheduleLogic.ts', import.meta.url), 'utf8');
const scheduleServiceSource = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');

describe('schedule and RSVP notification contract', () => {
    it('sends created-event notifications unless the event is draft or part of a large import batch', () => {
        expect(functionsSource).toContain('async function sendCreatedScheduleEventNotification({ teamId, gameId, game })');
        expect(functionsSource).toContain('if (game.source || game.sourceMetadata) return null;');
        expect(functionsSource).toContain("const category = isPractice ? 'practice' : 'schedule';");
        expect(functionsSource).toContain('title: payload.title');
        expect(functionsSource).toContain('const notifyGameCreated = functions.firestore');
        expect(functionsSource).toContain(".document('teams/{teamId}/games/{gameId}')");
        expect(functionsSource).toContain("if (status === 'draft') return null;");
        expect(functionsSource).toContain('if (importBatch && importBatch.totalCount > 3) {');
        expect(functionsSource).toContain('return registerScheduleImportBatchEvent({ teamId, gameId, game, batch: importBatch });');
        expect(functionsSource).toContain('return sendCreatedScheduleEventNotification({ teamId, gameId, game });');
    });

    it('summarizes large schedule imports and deduplicates the individual event ids', () => {
        expect(functionsSource).toContain('async function sendScheduleImportBatchNotifications({ teamId, batchId, batch })');
        expect(functionsSource).toContain('if (totalCount > 3) {');
        expect(functionsSource).toContain('const payload = buildScheduleImportSummaryPayload({ totalCount, gameCount, practiceCount });');
        expect(functionsSource).toContain("dedupKey: `import-batch:${batchId}`");
        expect(functionsSource).toContain("eventIds.map((eventId) => markNotificationDedupSent(teamId, 'schedule', eventId))");
        expect(functionsSource).toContain('exports.notifyScheduleImportBatchCompleted = notifyScheduleImportBatchCompleted;');
        expect(functionsSource).toContain('exports._internal.notifyScheduleImportBatchCompleted = notifyScheduleImportBatchCompleted;');
    });

    it('dispatches scheduled reminders to schedule push, public RSVP email, and RSVP push targets', () => {
        expect(functionsSource).toContain("collectionGroup('games')");
        expect(functionsSource).toContain(".where('scheduleNotifications.nextReminderAt', '<=', dueIso)");
        expect(functionsSource).toContain('const payload = buildPreEventReminderPayload({ teamId, gameId, event: claimedEvent });');
        expect(functionsSource).toContain("category: 'schedule'");
        expect(functionsSource).toContain('const emailResult = await createPublicRsvpEmailDeliveries({');
        expect(functionsSource).toContain('rsvpPushResult = await sendRsvpReminderPushNotifications({');
        expect(functionsSource).toContain('recipientUserIds: emailResult.recipientUserIds');
        expect(functionsSource).toContain('rsvpPushSuccessCount: rsvpPushResult.successCount');
        expect(functionsSource).toContain('rsvpPushTargetCount: rsvpPushResult.targetCount');
    });

    it('sends RSVP reminder pushes through the rsvp category with event deep links', () => {
        expect(functionsSource).toContain('async function sendRsvpReminderPushNotifications({ teamId, gameId, event = {}, recipientUserIds = [] } = {})');
        expect(functionsSource).toContain("const targets = await getTargetsForCategoryUserIds(teamId, 'rsvp', recipientUserIds);");
        expect(functionsSource).toContain("category: 'rsvp'");
        expect(functionsSource).toContain('eventId: gameId');
        expect(functionsSource).toContain('targetCount: targets.length');
        expect(functionsSource).toContain("return `/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(scheduleEventId)}?section=availability`;");
    });

    it('persists app-initiated RSVP reminder push metrics in schedule notification metadata', () => {
        expect(scheduleLogicSource).toContain('lastRsvpPushSuccessCount');
        expect(scheduleLogicSource).toContain('lastRsvpPushFailureCount');
        expect(scheduleLogicSource).toContain('lastRsvpPushTargetCount');
        expect(scheduleLogicSource).toContain('lastRsvpPushError');
        expect(scheduleServiceSource).toContain('normalizeStaffRsvpReminderPushMetrics(emailResult)');
        expect(scheduleServiceSource).toContain('await updateRsvpReminderMetadata(event, user, preview.missingPlayerCount, emailSentCount, rsvpPushMetrics);');
    });
});
