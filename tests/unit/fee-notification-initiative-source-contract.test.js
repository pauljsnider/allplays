import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('fees notification initiative source contract', () => {
    it('keeps all fee notification entry points registered in Cloud Functions', () => {
        expect(functionsSource).toContain('exports.notifyFeeAssigned = functions.firestore');
        expect(functionsSource).toContain('exports.sendFeeUnpaidDueReminders = functions.pubsub');
        expect(functionsSource).toContain('exports.notifyFeeMarkedPaid = functions.firestore');
        expect(functionsSource).toContain(".document('teams/{teamId}/feeBatches/{batchId}/feeRecipients/{recipientId}')");
    });

    it('uses the fees category and fee-specific routing ids across assignment, reminder, and paid sends', () => {
        expect(functionsSource.match(/category: 'fees'/g)?.length || 0).toBeGreaterThanOrEqual(4);
        expect(functionsSource).toContain('teamId,');
        expect(functionsSource).toContain('batchId,');
        expect(functionsSource).toContain('recipientId,');
        expect(functionsSource).toContain('buildStaffFeeNotificationDestination({ teamId, batchId, recipientId })');
    });

    it('targets parents for assignment and reminders while keeping staff payment alerts separate', () => {
        expect(functionsSource).toContain('resolveFeeAssignmentPayerUserIds(teamId, data)');
        expect(functionsSource).toContain('resolveFeeReminderCandidateUserIds(teamId, data)');
        expect(functionsSource).toContain('const staffTargets = allFeeTargets.filter((target) => staffUserIds.has(target.uid) && target.uid !== payerUserId);');
        expect(functionsSource).toContain('const payerTargets = allFeeTargets.filter((target) => target.uid === payerUserId);');
    });

    it('marks due reminders sent only after opted-in payer targets exist', () => {
        const reminderTargetIndex = functionsSource.indexOf('const payerTargets = allTargets.filter((t) => candidateUserIdSet.has(t.uid));');
        const markSentIndex = functionsSource.indexOf('await doc.ref.update({');

        expect(reminderTargetIndex).toBeGreaterThan(-1);
        expect(markSentIndex).toBeGreaterThan(reminderTargetIndex);
    });
});
