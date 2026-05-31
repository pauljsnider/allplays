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
    buildManualPaymentUpdate,
    loadTeamFeeManagementModel,
    recordOfflineTeamFeePayment,
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

    it('builds a paid update when payment covers the balance', () => {
        const update = buildManualPaymentUpdate({
            amount: '50.00',
            date: '2026-05-28',
            currentBalanceCents: 5000,
            currentPaidCents: 2500
        });

        expect(update.status).toBe('paid');
        expect(update.amountPaidCents).toBe(7500);
        expect(update.remainingBalanceCents).toBe(0);
        expect(update.paidAt).toBe('2026-05-28');
    });

    it('rejects invalid amount and missing payment date', () => {
        expect(() => buildManualPaymentUpdate({ amount: '0', date: '2026-05-28' })).toThrow('greater than $0');
        expect(() => buildManualPaymentUpdate({ amount: '-1.00', date: '2026-05-28' })).toThrow('greater than $0');
        expect(() => buildManualPaymentUpdate({ amount: '5.00', date: '' })).toThrow('payment date');
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
        expect(dbMocks.updateTeamFeeRecipient).not.toHaveBeenCalled();
    });
});
