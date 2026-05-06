import { describe, expect, it } from 'vitest';
import {
    buildBalanceAdjustmentUpdate,
    buildCancelRecipientUpdate,
    buildManualPaymentUpdate,
    buildTeamFeeRecipientRecords,
    formatFeeCurrency,
    getRecipientBalanceCents,
    getRecipientPaidCents,
    isTeamFeeAdmin,
    normalizeTeamFeeDraft,
    parseTeamFeeAmountToCents,
    summarizeFeeRecipients,
    toFeeCents
} from '../../js/team-fees-admin.js';

describe('team fees admin helpers', () => {
    it('normalizes offline fee drafts and selected recipients', () => {
        const draft = normalizeTeamFeeDraft({
            title: ' Tournament dues ',
            amount: '$25.50',
            dueDate: '2026-06-01',
            notes: ' Cash or check ',
            recipientIds: ['p1', 'p2', 'p1', '']
        });

        expect(draft).toMatchObject({
            title: 'Tournament dues',
            amountCents: 2550,
            dueDate: '2026-06-01',
            notes: 'Cash or check',
            recipientIds: ['p1', 'p2'],
            collectionMode: 'offline_manual'
        });
        expect(draft.offlinePaymentInstructions).toContain('No online payment');
    });

    it('builds unpaid recipient records for the selected roster members', () => {
        const draft = normalizeTeamFeeDraft({
            title: 'Camp fee',
            amount: '10',
            dueDate: '2026-07-01',
            recipientIds: ['p2']
        });
        const records = buildTeamFeeRecipientRecords(draft, [
            { id: 'p1', name: 'Ava', number: '3' },
            { id: 'p2', name: 'Sam', number: '7' }
        ], 'team-1');

        expect(records).toEqual([
            expect.objectContaining({
                teamId: 'team-1',
                playerId: 'p2',
                playerKey: 'team-1::p2',
                playerName: 'Sam',
                playerNumber: '7',
                feeTitle: 'Camp fee',
                amountCents: 1000,
                status: 'unpaid',
                collectionMode: 'offline_manual'
            })
        ]);
    });

    it('enforces positive amounts, required fields, recipients, and admin checks', () => {
        expect(parseTeamFeeAmountToCents('12.345')).toBe(1235);
        expect(parseTeamFeeAmountToCents('0')).toBeNull();
        expect(() => normalizeTeamFeeDraft({ amount: '5', dueDate: '2026-01-01', recipientIds: ['p1'] })).toThrow('Fee title');
        expect(() => normalizeTeamFeeDraft({ title: 'Fee', amount: '5', dueDate: '2026-01-01', recipientIds: [] })).toThrow('Select at least one');
        expect(isTeamFeeAdmin({ ownerId: 'u1' }, { uid: 'u1' })).toBe(true);
        expect(isTeamFeeAdmin({ adminEmails: ['Coach@Example.com'] }, { email: 'coach@example.com' })).toBe(true);
        expect(isTeamFeeAdmin({ adminEmails: ['coach@example.com'] }, { email: 'parent@example.com' })).toBe(false);
    });

    it('summarizes assigned, paid, outstanding, and status counts', () => {
        const summary = summarizeFeeRecipients([
            { status: 'paid', amountDueCents: 5000, amountPaidCents: 5000 },
            { status: 'unpaid', amountDueCents: 7500 },
            { status: 'adjusted', amountDueCents: 2500, amountPaidCents: 500 },
            { status: 'canceled', amountDueCents: 3000 }
        ]);

        expect(summary).toEqual({
            totalAssignedCents: 15000,
            totalPaidCents: 5500,
            totalOutstandingCents: 9500,
            counts: {
                paid: 1,
                unpaid: 1,
                adjusted: 1,
                canceled: 1
            }
        });
        expect(formatFeeCurrency(summary.totalOutstandingCents)).toBe('$95.00');
    });

    it('builds manual payment, adjustment, and cancellation updates', () => {
        expect(buildManualPaymentUpdate({
            amount: '42.50',
            date: '2026-05-05',
            note: 'Cash',
            actorId: 'coach-1'
        })).toMatchObject({
            status: 'paid',
            amountPaidCents: 4250,
            paidAt: '2026-05-05',
            manualPayment: {
                amountPaidCents: 4250,
                paidAt: '2026-05-05',
                note: 'Cash',
                recordedBy: 'coach-1'
            }
        });

        expect(buildBalanceAdjustmentUpdate({ amount: '10', note: 'Sibling discount', actorId: 'coach-1' })).toMatchObject({
            status: 'adjusted',
            amountDueCents: 1000,
            adjustment: {
                amountDueCents: 1000,
                note: 'Sibling discount',
                adjustedBy: 'coach-1'
            }
        });

        expect(buildCancelRecipientUpdate({ note: 'No longer on roster', actorId: 'coach-1' })).toMatchObject({
            status: 'canceled',
            amountDueCents: 0,
            canceled: {
                note: 'No longer on roster',
                canceledBy: 'coach-1'
            }
        });
    });

    it('normalizes currency inputs and recipient balances safely', () => {
        expect(toFeeCents('12.345')).toBe(1235);
        expect(toFeeCents('-1')).toBeNull();
        expect(getRecipientBalanceCents({ status: 'canceled', amountDueCents: 5000 })).toBe(0);
        expect(getRecipientPaidCents({ status: 'paid', amountDueCents: 2500 })).toBe(2500);
        expect(() => buildManualPaymentUpdate({ amount: '0', date: '2026-05-05' })).toThrow('greater than $0');
    });
});
