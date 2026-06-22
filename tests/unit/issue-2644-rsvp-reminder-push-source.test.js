import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const scheduleServiceSource = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');
const reminderTestSource = readFileSync(new URL('./schedule-rsvp-reminder.test.js', import.meta.url), 'utf8');

describe('issue 2644 RSVP reminder push notification source contract', () => {
    it('keeps RSVP reminder push notifications targeted to non-responding child groups', () => {
        expect(functionsSource).toContain('async function sendRsvpReminderPushNotifications({ teamId, gameId, event = {}, recipientUserIds = [], recipientTargets = [] } = {})');
        expect(functionsSource).toContain('const childIdByRecipientGroup = new Map();');
        expect(functionsSource).toContain('const userId = String(target?.userId || \'\').trim();');
        expect(functionsSource).toContain('const childId = String(target?.childId || \'\').trim();');
        expect(functionsSource).toContain('childIdByRecipientGroup.set(childId, groupUserIds);');
        expect(functionsSource).toContain("const targets = await getTargetsForCategoryUserIds(teamId, 'rsvp', userIds);");
        expect(functionsSource).toContain("childId");
    });

    it('keeps RSVP reminder push metrics flowing back to app-visible metadata', () => {
        expect(functionsSource).toContain('rsvpPushResult = await sendRsvpReminderPushNotifications({');
        expect(functionsSource).toContain('rsvpPushSuccessCount: rsvpPushResult.successCount');
        expect(functionsSource).toContain('rsvpPushFailureCount: rsvpPushResult.failureCount');
        expect(functionsSource).toContain('rsvpPushTargetCount: rsvpPushResult.targetCount');
        expect(functionsSource).toContain('rsvpPushError: rsvpPushError?.message || null');

        expect(scheduleServiceSource).toContain('const rsvpPushMetrics = normalizeStaffRsvpReminderPushMetrics(emailResult);');
        expect(scheduleServiceSource).toContain('await updateRsvpReminderMetadata(event, user, preview.missingPlayerCount, emailSentCount, rsvpPushMetrics);');
        expect(reminderTestSource).toContain('persists RSVP push metrics in reminder metadata');
        expect(reminderTestSource).toContain('persists Cloud Function RSVP push metrics from app reminder sends');
    });
});
