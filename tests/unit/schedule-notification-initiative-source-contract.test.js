import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const scheduleServiceSource = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');

describe('schedule notification initiative source contract', () => {
    it('registers created-event pushes and routes large imports to summary batching', () => {
        expect(functionsSource).toContain('const notifyGameCreated = functions.firestore');
        expect(functionsSource).toContain('exports.notifyGameCreated = notifyGameCreated;');
        expect(functionsSource).toContain('if (importBatch && importBatch.totalCount > 3) {');
        expect(functionsSource).toContain('return registerScheduleImportBatchEvent({ teamId, gameId, game, batch: importBatch });');
        expect(functionsSource).toContain("category: 'schedule'");
    });

    it('keeps schedule import summary notification state retry-safe', () => {
        expect(functionsSource).toContain('function registerScheduleImportBatchEvent({ teamId, gameId, game, batch })');
        expect(functionsSource).toContain('const nextEventIds = currentEventIds.includes(gameId) ? currentEventIds : [...currentEventIds, gameId];');
        expect(functionsSource).toContain('const alreadyCounted = currentEventIds.includes(gameId);');
        expect(functionsSource).toContain('notificationClaimedAt: admin.firestore.FieldValue.serverTimestamp()');
        expect(functionsSource).toContain('dedupKey: `import-batch:${batchId}`');
    });

    it('fans staff-triggered RSVP emails into rsvp-category push reminders', () => {
        expect(functionsSource).toContain('async function sendRsvpReminderPushNotifications({ teamId, gameId, event = {}, recipientUserIds = [], recipientTargets = [] } = {})');
        expect(functionsSource).toContain('rsvpPushResult = await sendRsvpReminderPushNotifications({');
        expect(functionsSource).toContain('rsvpPushSuccessCount: rsvpPushResult.successCount');
        expect(functionsSource).toContain('rsvpPushTargetCount: rsvpPushResult.targetCount');
        expect(functionsSource).toContain("category: 'rsvp'");
    });

    it('persists staff reminder push metrics back through the app schedule service', () => {
        expect(scheduleServiceSource).toContain('await updateRsvpReminderMetadata(event, user, preview.missingPlayerCount, emailSentCount, rsvpPushMetrics);');
        expect(scheduleServiceSource).toContain('rsvpPushSuccessCount');
        expect(scheduleServiceSource).toContain('rsvpPushTargetCount');
        expect(scheduleServiceSource).toContain('rsvpPushError');
    });
});
