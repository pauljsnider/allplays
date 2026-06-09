import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getTeam: vi.fn(),
    listTeamFeeBatches: vi.fn(),
    listTeamFeeRecipients: vi.fn(),
    updateTeamFeeRecipient: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../js/team-access.js', () => ({
    hasFullTeamAccess: (user: any, team: any) => Boolean(user?.isAdmin || user?.uid === team?.ownerId)
}));

import {
    buildBalanceAdjustmentUpdate,
    buildOfflineTeamFeeRefundUpdate,
    buildManualPaymentUpdate,
    loadTeamFeeManagementModel,
    recordOfflineTeamFeePayment,
    recordOfflineTeamFeeRefund,
    recordTeamFeeBalanceAdjustment
} from '../../apps/app/src/lib/teamFeesService.ts';

describe('React app team fee offline payment service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('builds a partial offline payment update with the legacy ledger shape', () => {
        const update = buildManualPaymentUpdate({
            amount: '25.00',
            date: '2026-05-28',
            note: 'Check 1001',
            actorId: 'coach-1',
            currentBalanceCents: 10000,
            currentPaidCents: 5000
        });

        expect(update).toMatchObject({
            status: 'partial',
            amountPaidCents: 7500,
            remainingBalanceCents: 2500,
            paidAt: null,
            manualPayment: {
                amountPaidCents: 2500,
                paidAt: '2026-05-28',
                note: 'Check 1001',
                recordedBy: 'coach-1'
            }
        });
        expect(update.ledgerEntries).toEqual([
            expect.objectContaining({
                type: 'offline_payment',
                amountCents: 2500,
                paymentDate: '2026-05-28',
                recordedBy: 'coach-1'
            })
        ]);
    });

    it('builds a paid update when payment exactly covers the remaining balance', () => {
        const update = buildManualPaymentUpdate({
            amount: '25.00',
            date: '2026-05-28',
            currentBalanceCents: 5000,
            currentPaidCents: 2500
        });

        expect(update.status).toBe('paid');
        expect(update.amountPaidCents).toBe(5000);
        expect(update.remainingBalanceCents).toBe(0);
        expect(update.paidAt).toBe('2026-05-28');
    });

    it('rejects invalid amount and missing payment date', () => {
        expect(() => buildManualPaymentUpdate({ amount: '0', date: '2026-05-28' })).toThrow('greater than $0');
        expect(() => buildManualPaymentUpdate({ amount: '-1.00', date: '2026-05-28' })).toThrow('greater than $0');
        expect(() => buildManualPaymentUpdate({ amount: '5.00', date: '' })).toThrow('payment date');
    });

    it('rejects offline payments larger than the remaining balance', () => {
        expect(() => buildManualPaymentUpdate({
            amount: '25.01',
            date: '2026-06-09',
            currentBalanceCents: 2500,
            currentPaidCents: 0
        })).toThrow('cannot exceed the remaining balance');

        expect(() => buildManualPaymentUpdate({
            amount: '10.01',
            date: '2026-06-09',
            currentBalanceCents: 2500,
            currentPaidCents: 1500
        })).toThrow('cannot exceed the remaining balance');
    });

    it('treats positive adjustments as credits that reduce the amount owed', () => {
        const update = buildBalanceAdjustmentUpdate({
            amount: '20.00',
            note: 'Scholarship credit',
            actorId: 'coach-1',
            currentBalanceCents: 15000,
            currentPaidCents: 2500
        });

        expect(update).toMatchObject({
            status: 'partial',
            amountDueCents: 13000,
            remainingBalanceCents: 10500,
            adjustment: {
                amountCents: 2000,
                previousAmountDueCents: 15000,
                amountDueCents: 13000,
                note: 'Scholarship credit',
                adjustedBy: 'coach-1'
            }
        });
        expect(update.ledgerEntries).toEqual([
            expect.objectContaining({
                type: 'balance_adjustment',
                amountCents: 2000,
                previousAmountDueCents: 15000,
                amountDueCents: 13000,
                reason: 'Scholarship credit'
            })
        ]);
    });

    it('treats negative adjustments as charges that increase the amount owed', () => {
        const update = buildBalanceAdjustmentUpdate({
            amount: '-5.00',
            note: 'Late fee',
            actorId: 'coach-1',
            currentBalanceCents: 15000,
            currentPaidCents: 0
        });

        expect(update.status).toBe('unpaid');
        expect(update.amountDueCents).toBe(15500);
        expect(update.remainingBalanceCents).toBe(15500);
        expect(update.adjustment.amountCents).toBe(-500);
    });

    it('rejects zero adjustments and missing reasons', () => {
        expect(() => buildBalanceAdjustmentUpdate({ amount: '0', note: 'No-op' })).toThrow('positive or negative adjustment');
        expect(() => buildBalanceAdjustmentUpdate({ amount: '', note: 'No-op' })).toThrow('positive or negative adjustment');
        expect(() => buildBalanceAdjustmentUpdate({ amount: '5.00', note: '' })).toThrow('adjustment reason');
    });

    it('builds partial offline refunds with the legacy ledger shape', () => {
        const update = buildOfflineTeamFeeRefundUpdate({
            refundType: 'partial',
            amount: '15.00',
            method: 'check',
            note: 'Parent returned duplicate cash payment',
            actorId: 'coach-1',
            currentBalanceCents: 10000,
            currentPaidCents: 8000
        });

        expect(update).toMatchObject({
            status: 'partial',
            amountPaidCents: 6500,
            remainingBalanceCents: 3500,
            paidAt: null,
            refunded: {
                amountCents: 1500,
                refundType: 'partial',
                refundMethod: 'check',
                note: 'Parent returned duplicate cash payment',
                recordedBy: 'coach-1'
            }
        });
        expect(update.ledgerEntries).toEqual([
            expect.objectContaining({
                type: 'offline_refund',
                amountCents: -1500,
                refundAmountCents: 1500,
                refundType: 'partial',
                refundMethod: 'check',
                methodLabel: 'Check'
            })
        ]);
    });

    it('builds full offline refunds back to unpaid', () => {
        const update = buildOfflineTeamFeeRefundUpdate({
            refundType: 'full',
            method: 'cash',
            note: 'Cash refund at practice',
            currentBalanceCents: 10000,
            currentPaidCents: 10000
        });

        expect(update.status).toBe('unpaid');
        expect(update.amountPaidCents).toBe(0);
        expect(update.remainingBalanceCents).toBe(10000);
        expect(update.paidAt).toBeNull();
    });

    it('rejects invalid offline refund input', () => {
        expect(() => buildOfflineTeamFeeRefundUpdate({
            refundType: 'partial',
            amount: '0',
            method: 'cash',
            note: 'Zero refund',
            currentBalanceCents: 10000,
            currentPaidCents: 5000
        })).toThrow('greater than $0');
        expect(() => buildOfflineTeamFeeRefundUpdate({
            refundType: 'partial',
            amount: '60.00',
            method: 'cash',
            note: 'Too much',
            currentBalanceCents: 10000,
            currentPaidCents: 5000
        })).toThrow('cannot exceed');
        expect(() => buildOfflineTeamFeeRefundUpdate({
            refundType: 'full',
            method: '',
            note: 'Missing method',
            currentBalanceCents: 10000,
            currentPaidCents: 5000
        })).toThrow('Select cash or check');
        expect(() => buildOfflineTeamFeeRefundUpdate({
            refundType: 'full',
            method: 'cash',
            note: '',
            currentBalanceCents: 10000,
            currentPaidCents: 5000
        })).toThrow('admin note');
    });

    it('loads batches and recipients only for fee managers', async () => {
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', ownerId: 'coach-1' });
        dbMocks.listTeamFeeBatches.mockResolvedValue([{ id: 'batch-1', title: 'Dues', amountCents: 10000 }]);
        dbMocks.listTeamFeeRecipients.mockResolvedValue([{ id: 'recipient-1', playerName: 'Pat Star', amountDueCents: 10000, amountPaidCents: 2500 }]);

        const model = await loadTeamFeeManagementModel('team-1', undefined, { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: [] });

        expect(model.canManageFees).toBe(true);
        expect(model.selectedBatch?.id).toBe('batch-1');
        expect(model.recipients[0]).toMatchObject({
            id: 'recipient-1',
            playerName: 'Pat Star',
            remainingBalanceCents: 7500
        });
    });

    it('writes manualPayment and paymentLedger updates to the existing recipient document', async () => {
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', ownerId: 'coach-1' });
        dbMocks.updateTeamFeeRecipient.mockResolvedValue(undefined);

        await recordOfflineTeamFeePayment({
            teamId: 'team-1',
            batchId: 'batch-1',
            recipient: {
                id: 'recipient-1',
                playerName: 'Pat Star',
                parentName: '',
                parentEmail: '',
                status: 'unpaid',
                amountDueCents: 10000,
                amountPaidCents: 0,
                remainingBalanceCents: 10000,
                paymentLedger: []
            },
            amount: '100.00',
            date: '2026-05-28',
            note: 'Cash',
            user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: [] }
        });

        expect(dbMocks.updateTeamFeeRecipient).toHaveBeenCalledWith('team-1', 'batch-1', 'recipient-1', expect.objectContaining({
            status: 'paid',
            amountPaidCents: 10000,
            remainingBalanceCents: 0,
            paidAt: '2026-05-28',
            manualPayment: expect.objectContaining({ amountPaidCents: 10000, note: 'Cash' }),
            ledgerEntries: [expect.objectContaining({ type: 'offline_payment', amountCents: 10000 })]
        }));
    });

    it('keeps recipients partial when a new offline payment does not cover the total amount due', async () => {
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', ownerId: 'coach-1' });
        dbMocks.updateTeamFeeRecipient.mockResolvedValue(undefined);

        await recordOfflineTeamFeePayment({
            teamId: 'team-1',
            batchId: 'batch-1',
            recipient: {
                id: 'recipient-1',
                playerName: 'Pat Star',
                parentName: '',
                parentEmail: '',
                status: 'partial',
                amountDueCents: 10000,
                amountPaidCents: 6000,
                remainingBalanceCents: 4000,
                paymentLedger: []
            },
            amount: '10.00',
            date: '2026-05-28',
            note: 'Cash',
            user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: [] }
        });

        expect(dbMocks.updateTeamFeeRecipient).toHaveBeenCalledWith('team-1', 'batch-1', 'recipient-1', expect.objectContaining({
            status: 'partial',
            amountPaidCents: 7000,
            remainingBalanceCents: 3000,
            paidAt: null,
            manualPayment: expect.objectContaining({ amountPaidCents: 1000, note: 'Cash' }),
            ledgerEntries: [expect.objectContaining({ type: 'offline_payment', amountCents: 1000 })]
        }));
    });

    it('writes balance adjustments to the existing recipient document', async () => {
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', ownerId: 'coach-1' });
        dbMocks.updateTeamFeeRecipient.mockResolvedValue(undefined);

        await recordTeamFeeBalanceAdjustment({
            teamId: 'team-1',
            batchId: 'batch-1',
            recipient: {
                id: 'recipient-1',
                playerName: 'Pat Star',
                parentName: '',
                parentEmail: '',
                status: 'paid',
                amountDueCents: 10000,
                amountPaidCents: 10000,
                remainingBalanceCents: 0,
                paymentLedger: []
            },
            amount: '-10.00',
            note: 'Late fee',
            user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: [] }
        });

        expect(dbMocks.updateTeamFeeRecipient).toHaveBeenCalledWith('team-1', 'batch-1', 'recipient-1', expect.objectContaining({
            status: 'partial',
            amountDueCents: 11000,
            remainingBalanceCents: 1000,
            adjustment: expect.objectContaining({ amountCents: -1000, note: 'Late fee' }),
            ledgerEntries: [expect.objectContaining({ type: 'balance_adjustment', amountCents: -1000, reason: 'Late fee' })]
        }));
    });

    it('writes offline refunds to the existing recipient document', async () => {
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', ownerId: 'coach-1' });
        dbMocks.updateTeamFeeRecipient.mockResolvedValue(undefined);

        await recordOfflineTeamFeeRefund({
            teamId: 'team-1',
            batchId: 'batch-1',
            recipient: {
                id: 'recipient-1',
                playerName: 'Pat Star',
                parentName: '',
                parentEmail: '',
                status: 'paid',
                amountDueCents: 10000,
                amountPaidCents: 10000,
                remainingBalanceCents: 0,
                paymentLedger: []
            },
            refundType: 'partial',
            amount: '25.00',
            method: 'cash',
            note: 'Refunded at the field',
            user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: [] }
        });

        expect(dbMocks.updateTeamFeeRecipient).toHaveBeenCalledWith('team-1', 'batch-1', 'recipient-1', expect.objectContaining({
            status: 'partial',
            amountPaidCents: 7500,
            remainingBalanceCents: 2500,
            refunded: expect.objectContaining({ amountCents: 2500, refundMethod: 'cash', note: 'Refunded at the field' }),
            ledgerEntries: [expect.objectContaining({ type: 'offline_refund', amountCents: -2500, refundAmountCents: 2500 })]
        }));
    });

    it('blocks non-managers from recording offline payments or adjustments', async () => {
        dbMocks.getTeam.mockResolvedValue({ id: 'team-1', name: 'Bears', ownerId: 'coach-1' });

        const recipient = {
            id: 'recipient-1',
            playerName: 'Pat Star',
            parentName: '',
            parentEmail: '',
            status: 'unpaid',
            amountDueCents: 10000,
            amountPaidCents: 0,
            remainingBalanceCents: 10000,
            paymentLedger: []
        };

        await expect(recordOfflineTeamFeePayment({
            teamId: 'team-1',
            batchId: 'batch-1',
            recipient,
            amount: '10.00',
            date: '2026-05-28',
            user: { uid: 'parent-1', email: 'parent@example.com', displayName: 'Parent', roles: [] }
        })).rejects.toThrow('do not have access');
        await expect(recordTeamFeeBalanceAdjustment({
            teamId: 'team-1',
            batchId: 'batch-1',
            recipient,
            amount: '10.00',
            note: 'Scholarship',
            user: { uid: 'parent-1', email: 'parent@example.com', displayName: 'Parent', roles: [] }
        })).rejects.toThrow('do not have access');
        await expect(recordOfflineTeamFeeRefund({
            teamId: 'team-1',
            batchId: 'batch-1',
            recipient: { ...recipient, status: 'partial', amountPaidCents: 5000, remainingBalanceCents: 5000 },
            refundType: 'full',
            method: 'cash',
            note: 'Requested by parent',
            user: { uid: 'parent-1', email: 'parent@example.com', displayName: 'Parent', roles: [] }
        })).rejects.toThrow('do not have access');
        expect(dbMocks.updateTeamFeeRecipient).not.toHaveBeenCalled();
    });

    it('rejects refund submissions with missing fee context', async () => {
        await expect(recordOfflineTeamFeeRefund({
            teamId: '',
            batchId: 'batch-1',
            recipient: {
                id: 'recipient-1',
                playerName: 'Pat Star',
                parentName: '',
                parentEmail: '',
                status: 'partial',
                amountDueCents: 10000,
                amountPaidCents: 5000,
                remainingBalanceCents: 5000,
                paymentLedger: []
            },
            refundType: 'full',
            method: 'cash',
            note: 'Missing team context',
            user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: [] }
        })).rejects.toThrow('Missing fee recipient context');
    });
});
