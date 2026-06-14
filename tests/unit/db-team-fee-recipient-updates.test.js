import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function buildUpdateTeamFeeRecipient({ db = {}, doc, updateDoc, runTransaction, serverTimestamp, arrayUnion, deleteField, setDoc }) {
    const start = dbSource.indexOf('const PRIVATE_TEAM_FEE_RECIPIENT_FIELDS');
    const end = dbSource.indexOf('\nexport async function createTeamFeeBatch', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const functionSource = dbSource
        .slice(start, end)
        .replace('export async function updateTeamFeeRecipient', 'return async function updateTeamFeeRecipient');

    return new Function('db', 'doc', 'updateDoc', 'runTransaction', 'serverTimestamp', 'arrayUnion', 'deleteField', 'setDoc', functionSource)(
        db,
        doc,
        updateDoc,
        runTransaction,
        serverTimestamp,
        arrayUnion,
        deleteField,
        setDoc
    );
}

describe('updateTeamFeeRecipient manual payment validation', () => {
    it('rejects manual payments that exceed the recipient remaining balance before persisting', async () => {
        const updateDoc = vi.fn();
        const transactionUpdate = vi.fn();
        const runTransaction = vi.fn(async (_db, handler) => handler({
            get: vi.fn(async () => ({
                exists: () => true,
                data: () => ({ amountDueCents: 2500, amountPaidCents: 1500 })
            })),
            update: transactionUpdate,
            set: vi.fn()
        }));
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc,
            runTransaction,
            serverTimestamp: vi.fn(() => 'server-ts'),
            arrayUnion: vi.fn((...entries) => entries),
            deleteField: vi.fn(() => 'deleted'),
            setDoc: vi.fn()
        });

        await expect(updateTeamFeeRecipient('team-1', 'batch-1', 'recipient-1', {
            amountPaidCents: 2600,
            manualPayment: { amountPaidCents: 1100 },
            ledgerEntries: [{ type: 'offline_payment', amountCents: 1100 }]
        })).rejects.toThrow('cannot exceed the remaining balance');
        expect(updateDoc).not.toHaveBeenCalled();
        expect(transactionUpdate).not.toHaveBeenCalled();
    });

    it('rejects manual payments when the amount cannot be resolved to a finite number', async () => {
        const updateDoc = vi.fn();
        const transactionUpdate = vi.fn();
        const runTransaction = vi.fn(async (_db, handler) => handler({
            get: vi.fn(async () => ({
                exists: () => true,
                data: () => ({ amountDueCents: 2500, amountPaidCents: 1500 })
            })),
            update: transactionUpdate,
            set: vi.fn()
        }));
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc,
            runTransaction,
            serverTimestamp: vi.fn(() => 'server-ts'),
            arrayUnion: vi.fn((...entries) => entries),
            deleteField: vi.fn(() => 'deleted'),
            setDoc: vi.fn()
        });

        await expect(updateTeamFeeRecipient('team-1', 'batch-1', 'recipient-1', {
            manualPayment: {}
        })).rejects.toThrow('Manual payment amount is required');
        expect(updateDoc).not.toHaveBeenCalled();
        expect(transactionUpdate).not.toHaveBeenCalled();
    });

    it('persists manual payments that stay within the recipient remaining balance transactionally', async () => {
        const updateDoc = vi.fn(async () => undefined);
        const transactionUpdate = vi.fn();
        const transactionSet = vi.fn();
        const arrayUnion = vi.fn((...entries) => entries);
        const deleteField = vi.fn(() => 'deleted');
        const runTransaction = vi.fn(async (_db, handler) => handler({
            get: vi.fn(async () => ({
                exists: () => true,
                data: () => ({ amountDueCents: 2500, amountPaidCents: 1500 })
            })),
            update: transactionUpdate,
            set: transactionSet
        }));
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc,
            runTransaction,
            serverTimestamp: vi.fn(() => 'server-ts'),
            arrayUnion,
            deleteField,
            setDoc: vi.fn()
        });

        await expect(updateTeamFeeRecipient('team-1', 'batch-1', 'recipient-1', {
            status: 'paid',
            amountPaidCents: 2500,
            remainingBalanceCents: 0,
            manualPayment: { amountPaidCents: 1000 },
            ledgerEntries: [{ type: 'offline_payment', amountCents: 1000 }],
            adminBilling: { type: 'offline_payment', note: 'Check 1001' }
        })).resolves.toBeUndefined();

        expect(runTransaction).toHaveBeenCalledTimes(1);
        expect(updateDoc).not.toHaveBeenCalled();
        expect(transactionUpdate).toHaveBeenCalledWith(
            { path: 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1' },
            expect.objectContaining({
                amountPaidCents: 2500,
                remainingBalanceCents: 0,
                paymentLedger: [{ type: 'offline_payment', amountCents: 1000 }],
                hasAdminBilling: true,
                updatedAt: 'server-ts'
            })
        );
        expect(transactionSet).toHaveBeenCalledWith(
            { path: 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1/adminBilling/latest' },
            expect.objectContaining({
                type: 'offline_payment',
                note: 'Check 1001',
                teamId: 'team-1',
                batchId: 'batch-1',
                recipientId: 'recipient-1',
                updatedAt: 'server-ts'
            }),
            { merge: true }
        );
        expect(arrayUnion).toHaveBeenCalledWith({ type: 'offline_payment', amountCents: 1000 });
    });

    it('stores admin billing metadata outside the parent-readable recipient document for non-transactional updates', async () => {
        const updateDoc = vi.fn(async () => undefined);
        const setDoc = vi.fn(async () => undefined);
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc,
            setDoc,
            runTransaction: vi.fn(),
            serverTimestamp: vi.fn(() => 'server-ts'),
            arrayUnion: vi.fn((...entries) => entries),
            deleteField: vi.fn(() => 'deleted')
        });

        await expect(updateTeamFeeRecipient('team-1', 'batch-1', 'recipient-1', {
            status: 'partial',
            adjustment: { amountCents: -500 },
            ledgerEntries: [{ type: 'balance_adjustment', amountCents: -500 }],
            adminBilling: { type: 'balance_adjustment', reason: 'Late fee' }
        })).resolves.toBeUndefined();

        expect(updateDoc).toHaveBeenCalledWith(
            { path: 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1' },
            expect.objectContaining({
                status: 'partial',
                adjustment: { amountCents: -500 },
                paymentLedger: [{ type: 'balance_adjustment', amountCents: -500 }],
                hasAdminBilling: true,
                updatedAt: 'server-ts'
            })
        );
        expect(setDoc).toHaveBeenCalledWith(
            { path: 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1/adminBilling/latest' },
            expect.objectContaining({
                type: 'balance_adjustment',
                reason: 'Late fee',
                teamId: 'team-1',
                batchId: 'batch-1',
                recipientId: 'recipient-1',
                updatedAt: 'server-ts'
            }),
            { merge: true }
        );
    });

    it('strips private billing and staff fields from recipient updates before parent-readable writes', async () => {
        const updateDoc = vi.fn(async () => undefined);
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc,
            setDoc: vi.fn(async () => undefined),
            runTransaction: vi.fn(),
            serverTimestamp: vi.fn(() => 'server-ts'),
            arrayUnion: vi.fn((...entries) => entries),
            deleteField: vi.fn(() => 'deleted')
        });

        await updateTeamFeeRecipient('team-1', 'batch-1', 'recipient-1', {
            status: 'partial',
            notes: 'Public family note',
            refunded: {
                amountCents: 500,
                refundMethod: 'check',
                note: 'Refund check 1001',
                recordedBy: 'coach-1'
            },
            ledgerEntries: [{
                type: 'offline_refund',
                amountCents: -500,
                publicNote: 'Uniform returned',
                reason: 'Private admin reason',
                refundedBy: 'coach-1',
                stripeRefundId: 're_private'
            }],
            stripePaymentIntentId: 'pi_private',
            receiptMetadata: {
                provider: 'stripe',
                receiptEmail: 'parent@example.com',
                amountPaidCents: 500
            }
        });

        expect(updateDoc).toHaveBeenCalledWith(
            { path: 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1' },
            expect.objectContaining({
                notes: 'Public family note',
                refunded: {
                    amountCents: 500,
                    refundMethod: 'check'
                },
                receiptMetadata: {
                    provider: 'stripe',
                    amountPaidCents: 500
                },
                paymentLedger: [{
                    type: 'offline_refund',
                    amountCents: -500,
                    publicNote: 'Uniform returned'
                }]
            })
        );
        const payload = updateDoc.mock.calls[0][1];
        expect(payload).not.toHaveProperty('stripePaymentIntentId');
        expect(payload.refunded).not.toHaveProperty('note');
        expect(payload.refunded).not.toHaveProperty('recordedBy');
        expect(payload.receiptMetadata).not.toHaveProperty('receiptEmail');
        expect(payload.paymentLedger[0]).not.toHaveProperty('reason');
        expect(payload.paymentLedger[0]).not.toHaveProperty('refundedBy');
        expect(payload.paymentLedger[0]).not.toHaveProperty('stripeRefundId');
    });

    it('preserves cancellation reasons in admin billing metadata before sanitizing parent-readable fields', async () => {
        const updateDoc = vi.fn(async () => undefined);
        const setDoc = vi.fn(async () => undefined);
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc,
            setDoc,
            runTransaction: vi.fn(),
            serverTimestamp: vi.fn(() => 'server-ts'),
            arrayUnion: vi.fn((...entries) => entries),
            deleteField: vi.fn(() => 'deleted')
        });

        await updateTeamFeeRecipient('team-1', 'batch-1', 'recipient-1', {
            status: 'canceled',
            amountDueCents: 0,
            remainingBalanceCents: 0,
            canceled: {
                note: 'Family moved away',
                canceledBy: 'coach-7'
            },
            ledgerEntries: [{
                type: 'cancellation',
                amountCents: 0,
                reason: 'Family moved away',
                canceledBy: 'coach-7'
            }]
        });

        expect(updateDoc).toHaveBeenCalledWith(
            { path: 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1' },
            expect.objectContaining({
                status: 'canceled',
                amountDueCents: 0,
                remainingBalanceCents: 0,
                canceled: {},
                hasAdminBilling: true,
                paymentLedger: [{
                    type: 'cancellation',
                    amountCents: 0
                }]
            })
        );
        const payload = updateDoc.mock.calls[0][1];
        expect(payload.canceled).not.toHaveProperty('note');
        expect(payload.paymentLedger[0]).not.toHaveProperty('reason');
        expect(payload.paymentLedger[0]).not.toHaveProperty('canceledBy');
        expect(setDoc).toHaveBeenCalledWith(
            { path: 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1/adminBilling/latest' },
            expect.objectContaining({
                type: 'cancellation',
                reason: 'Family moved away',
                canceledBy: 'coach-7',
                teamId: 'team-1',
                batchId: 'batch-1',
                recipientId: 'recipient-1',
                updatedAt: 'server-ts'
            }),
            { merge: true }
        );
    });
});
