import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const teamFeesCoreSource = readFileSync(new URL('../../functions/team-fees-core.cjs', import.meta.url), 'utf8');

function getFeeAssignmentNotificationHelpers() {
    const start = functionsSource.indexOf('function formatFeeAssignmentDueDate(');
    const end = functionsSource.indexOf('\nasync function resolveFeeAssignmentPayerUserIds', start);
    const slice = functionsSource.slice(start, end);
    const utcIntl = {
        DateTimeFormat: function DateTimeFormat(locale, options = {}) {
            return new Intl.DateTimeFormat(locale, {
                ...options,
                timeZone: 'UTC'
            });
        }
    };
    return new Function(
        'coerceDate',
        'Intl',
        'getTeamFeeBalanceCents',
        'formatMoneyFromCents',
        `${slice}; return { buildFeeAssignmentNotificationBody, buildCombinedFeeAssignmentNotificationPayload };`
    )(
        (value) => (value ? new Date(value) : null),
        utcIntl,
        (recipient = {}) => Number(recipient.balanceDueCents ?? recipient.remainingBalanceCents ?? recipient.amountCents ?? recipient.feeAmountCents ?? 0),
        (cents) => `$${(Number(cents || 0) / 100).toFixed(2)}`
    );
}

describe('fee notification contract', () => {
    it('notifies assigned fee payers through the fees category with per-user claim guards', () => {
        expect(functionsSource).toContain('exports.notifyFeeAssigned = functions.firestore');
        expect(functionsSource).toContain(".document('teams/{teamId}/feeBatches/{batchId}/feeRecipients/{recipientId}')");
        expect(functionsSource).toContain("if (!NOTIFICATION_CATEGORIES.includes('fees'))");
        expect(functionsSource).toContain('const payerUserIds = await resolveFeeAssignmentPayerUserIds(teamId, data);');
        expect(functionsSource).toContain("const payerTargets = await getTargetsForCategoryUserIds(teamId, 'fees', payerUserIds, null);");
        expect(functionsSource).toContain('claimFeeAssignmentNotificationUser({ teamId, batchId, recipientId, uid })');
        expect(functionsSource).toContain('const batchRecipients = await listFeeAssignmentBatchRecipients({');
        expect(functionsSource).toContain('for (const uid of claimedUserIds)');
        expect(functionsSource).toContain('const recipientsForUser = await filterFeeAssignmentRecipientsForUser({');
        expect(functionsSource).toContain('const payload = buildCombinedFeeAssignmentNotificationPayload(recipientsForUser);');
        expect(functionsSource).toContain('targets: targetsForUser,');
        expect(functionsSource).toContain('title: payload.title');
        expect(functionsSource).toContain('body: payload.body');
        expect(functionsSource).toContain('return combineDirectNotificationResults(sendResults);');
        expect(functionsSource).toContain('await releaseFeeAssignmentNotificationClaims({');
    });

    it('builds assigned-fee push copy with amount and due-date context', () => {
        const { buildFeeAssignmentNotificationBody } = getFeeAssignmentNotificationHelpers();

        expect(buildFeeAssignmentNotificationBody({
            dueDate: '2026-08-15T12:00:00.000Z'
        }, '$45.00')).toBe('$45.00 has been assigned, due Aug 15, 2026.');
        expect(buildFeeAssignmentNotificationBody({}, '')).toBe('A new team fee has been assigned.');
    });

    it('builds one combined assigned-fee push per parent for sibling recipients', () => {
        const { buildCombinedFeeAssignmentNotificationPayload } = getFeeAssignmentNotificationHelpers();

        expect(buildCombinedFeeAssignmentNotificationPayload([
            {
                childName: 'Avery',
                feeTitle: 'Spring dues',
                amountCents: 2500,
                dueDate: '2026-07-01T12:00:00.000Z'
            },
            {
                childName: 'Blake',
                feeTitle: 'Spring dues',
                amountCents: 2500,
                dueDate: '2026-07-01T12:00:00.000Z'
            }
        ])).toEqual({
            title: 'New fees assigned: Spring dues ($50.00 total)',
            body: '$50.00 has been assigned for Avery and Blake, due Jul 1, 2026.'
        });
    });

    it('builds a combined assignment summary when one parent owes multiple distinct fees', () => {
        const { buildCombinedFeeAssignmentNotificationPayload } = getFeeAssignmentNotificationHelpers();

        expect(buildCombinedFeeAssignmentNotificationPayload([
            {
                childName: 'Avery',
                feeTitle: 'Spring dues',
                amountCents: 2500,
                dueDate: '2026-07-01T12:00:00.000Z'
            },
            {
                childName: 'Blake',
                feeTitle: 'Tournament hotel',
                amountCents: 4000,
                dueDate: '2026-07-15T12:00:00.000Z'
            }
        ])).toEqual({
            title: 'New fees assigned: 2 team fees ($65.00 total)',
            body: '$65.00 has been assigned for Avery and Blake, due Jul 1, 2026 and Jul 15, 2026.'
        });
    });

    it('resolves app-created child fee recipients and collapses each batch to one payer push', () => {
        expect(functionsSource).toContain('async function resolveFeeAssignmentPayerUserIds(teamId, recipient = {})');
        expect(functionsSource).toContain('playerId: playerId || recipient.playerId || recipient.childId');
        expect(functionsSource).toContain("const playerKey = getFeeReminderPlayerKey({");
        expect(functionsSource).toContain(".where('parentPlayerKeys', 'array-contains', playerKey)");
        expect(functionsSource).toContain('function buildFeeAssignmentNotificationClaimRef({ teamId, batchId, uid })');
        expect(functionsSource).toContain("assignmentNotificationClaims/${normalizedUid}");
        expect(functionsSource).toContain('firstRecipientId: recipientId || null');
        expect(functionsSource).toContain('if (claimSnap.exists) return false;');
    });

    it('sends due-soon reminders only to linked payers with remaining balances and marks sent after targets exist', () => {
        expect(functionsSource).toContain('function getFeeReminderPlayerKey(recipient = {}, teamId = \'\')');
        expect(functionsSource).toContain("return `${resolvedTeamId}::${playerId}`;");
        expect(functionsSource).toContain('async function resolveFeeReminderCandidateUserIds(teamId, recipient = {})');
        expect(functionsSource).toContain(".where('parentPlayerKeys', 'array-contains', playerKey)");
        expect(functionsSource).toContain("firestore.collectionGroup('feeRecipients')");
        expect(functionsSource).toContain(".where('status', 'in', ['unpaid', 'pending'])");
        expect(functionsSource).toContain(".where('dueDate', '>=', now)");
        expect(functionsSource).toContain(".where('dueDate', '<=', threeDaysLater)");
        expect(functionsSource).toContain('if (data.reminderSentAt) return null;');
        expect(functionsSource).toContain('const allTargets = await getTargetsForCategory(teamId, \'fees\', null);');
        expect(functionsSource).toContain('const payerTargets = allTargets.filter((t) => candidateUserIdSet.has(t.uid));');
        expect(functionsSource).toContain('await doc.ref.update({ reminderSentAt: admin.firestore.FieldValue.serverTimestamp() });');
        expect(functionsSource).toContain("title: `Reminder: ${title} is due soon`");
    });

    it('notifies payers and staff when fees are marked paid', () => {
        expect(functionsSource).toContain('exports.notifyFeeMarkedPaid = functions.firestore');
        expect(functionsSource).toContain("String(after.status || '').trim().toLowerCase() !== 'paid'");
        expect(functionsSource).toContain("String(before?.status || '').trim().toLowerCase() === 'paid'");
        expect(functionsSource).toContain('const staffFeeDestination = buildStaffFeeNotificationDestination({ teamId, batchId, recipientId });');
        expect(functionsSource).toContain('const paymentAmountCents = getFeePaymentAmountCents(before, after);');
        expect(functionsSource).toContain("title: wasPaymentRecorded ? `Payment received: ${title}` : `Fee paid: ${title}`");
        expect(functionsSource).toContain("body: wasPaymentRecorded\n            ? `We received your ${paymentAmountDisplay} payment. Thank you!`\n            : 'Your fee balance is now marked as paid.',\n          teamId,\n          batchId,\n          recipientId");
        expect(functionsSource).toContain('const staffTargets = allFeeTargets.filter((target) => staffUserIds.has(target.uid) && target.uid !== payerUserId);');
        expect(functionsSource).toContain("title: `Fee paid: ${title}`");
        expect(functionsSource).toContain('appRouteOverride: staffFeeDestination.appRoute');
    });

    it('keeps fee notification destination and payment amount helpers aligned with team fee accounting', () => {
        expect(functionsSource).toContain('function buildStaffFeeNotificationDestination({ teamId, batchId = null, recipientId = null })');
        expect(functionsSource).toContain('params.set(\'recipientId\', recipientId);');
        expect(functionsSource).toContain('link: `https://allplays.ai/app/#${appRoute}`');
        expect(functionsSource).toContain('function getFeePaymentAmountCents(before = {}, after = {})');
        expect(functionsSource).toContain('after.stripePaymentAmountCents');
        expect(functionsSource).toContain('after.manualPayment?.amountPaidCents');
        expect(functionsSource).toContain('after.receiptMetadata?.amountPaidCents');
        expect(functionsSource).toContain('return Math.round(afterPaid - beforePaid);');
        expect(teamFeesCoreSource).toContain('function getTeamFeeBalanceCents(recipient = {})');
        expect(teamFeesCoreSource).toContain('module.exports = {');
        expect(teamFeesCoreSource).toContain('getTeamFeeBalanceCents,');
    });
});
