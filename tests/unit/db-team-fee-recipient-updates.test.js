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

function buildCreateTeamFeeBatch({ db = {}, doc, collection, writeBatch, serverTimestamp }) {
    const start = dbSource.indexOf('export async function createTeamFeeBatch');
    const end = dbSource.indexOf('\nfunction normalizeParentRegistrationEmail', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const functionSource = dbSource
        .slice(start, end)
        .replace('export async function createTeamFeeBatch', 'return async function createTeamFeeBatch');

    return new Function('db', 'doc', 'collection', 'writeBatch', 'serverTimestamp', functionSource)(
        db,
        doc,
        collection,
        writeBatch,
        serverTimestamp
    );
}

function buildCreateTeamFeeBatchHarness() {
    let nextBatchId = 'batch-1';
    const setCalls = [];
    const commit = vi.fn(async () => undefined);
    const writeBatch = vi.fn(() => ({
        set: vi.fn((ref, payload) => setCalls.push({ ref, payload })),
        commit
    }));
    const collection = vi.fn((_db, path) => ({ path }));
    const doc = vi.fn((_dbOrCollection, ...parts) => {
        if (parts.length === 0) return { id: nextBatchId, path: `teams/team-1/feeBatches/${nextBatchId}` };
        return { path: parts.join('/') };
    });
    const createTeamFeeBatch = buildCreateTeamFeeBatch({
        doc,
        collection,
        writeBatch,
        serverTimestamp: vi.fn(() => 'server-ts')
    });

    return { createTeamFeeBatch, setCalls, commit, doc, collection, writeBatch };
}

describe('createTeamFeeBatch collection mode persistence', () => {
    const feeDraft = {
        title: 'Tournament dues',
        amountCents: 12500,
        dueDate: '2026-06-01',
        notes: 'Includes field rental.'
    };
    const recipients = [{ playerId: 'player-1', playerName: 'Sam' }];

    it('persists offline manual mode and instructions by default', async () => {
        const { createTeamFeeBatch, setCalls, commit } = buildCreateTeamFeeBatchHarness();

        await expect(createTeamFeeBatch('team-1', feeDraft, recipients, { uid: 'admin-1', email: 'admin@example.com' })).resolves.toEqual({ id: 'batch-1' });

        expect(commit).toHaveBeenCalledTimes(1);
        expect(setCalls[0].payload).toEqual(expect.objectContaining({
            collectionMode: 'offline_manual',
            offlinePaymentInstructions: 'Collect payment outside ALL PLAYS. No online payment is processed.'
        }));
        expect(setCalls[1].payload).toEqual(expect.objectContaining({
            playerId: 'player-1',
            collectionMode: 'offline_manual',
            offlinePaymentInstructions: 'Collect payment outside ALL PLAYS. No online payment is processed.'
        }));
    });

    it('persists online Stripe mode on the batch and recipient without offline instructions', async () => {
        const { createTeamFeeBatch, setCalls, commit } = buildCreateTeamFeeBatchHarness();

        await expect(createTeamFeeBatch('team-1', { ...feeDraft, collectionMode: 'online_stripe' }, recipients, { uid: 'admin-1' })).resolves.toEqual({ id: 'batch-1' });

        expect(commit).toHaveBeenCalledTimes(1);
        expect(setCalls[0].payload).toEqual(expect.objectContaining({
            collectionMode: 'online_stripe',
            offlinePaymentInstructions: ''
        }));
        expect(setCalls[1].payload).toEqual(expect.objectContaining({
            playerId: 'player-1',
            collectionMode: 'online_stripe',
            offlinePaymentInstructions: ''
        }));
    });

    it('fails online Stripe creation when recipient checkout context is missing', async () => {
        const { createTeamFeeBatch, commit } = buildCreateTeamFeeBatchHarness();

        await expect(createTeamFeeBatch('team-1', { ...feeDraft, collectionMode: 'online_stripe' }, [{ playerName: 'Missing player id' }]))
            .rejects.toThrow('Online Stripe collection requires roster recipients with player IDs.');
        expect(commit).not.toHaveBeenCalled();
    });
});

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
                paymentLedger: [expect.objectContaining({ type: 'offline_payment', amountCents: 1000 })],
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
        expect(arrayUnion).toHaveBeenCalledWith(expect.objectContaining({ type: 'offline_payment', amountCents: 1000 }));
        expect(arrayUnion.mock.calls[0][0].ledgerEntryId).toMatch(/^offline_payment_/);
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

    it('recomputes manual payment totals from the latest recipient state', async () => {
        const transactionUpdate = vi.fn();
        const runTransaction = vi.fn(async (_db, handler) => handler({
            get: vi.fn(async () => ({
                exists: () => true,
                data: () => ({ amountDueCents: 10000, amountPaidCents: 6000 })
            })),
            update: transactionUpdate,
            set: vi.fn()
        }));
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc: vi.fn(),
            runTransaction,
            serverTimestamp: vi.fn(() => 'server-ts'),
            arrayUnion: vi.fn((...entries) => entries),
            deleteField: vi.fn(() => 'deleted'),
            setDoc: vi.fn()
        });

        await updateTeamFeeRecipient('team-1', 'batch-1', 'recipient-1', {
            status: 'partial',
            amountPaidCents: 4000,
            remainingBalanceCents: 6000,
            paidAt: null,
            manualPayment: { amountPaidCents: 4000, paidAt: '2026-07-14' },
            ledgerEntries: [{ type: 'offline_payment', amountCents: 4000, paymentDate: '2026-07-14' }]
        });

        expect(transactionUpdate).toHaveBeenCalledWith(
            { path: 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1' },
            expect.objectContaining({
                status: 'paid',
                amountPaidCents: 10000,
                remainingBalanceCents: 0,
                paidAt: '2026-07-14',
                paymentLedger: [expect.objectContaining({ type: 'offline_payment', amountCents: 4000, paymentDate: '2026-07-14' })]
            })
        );
    });

    it('adds unique ids to identical manual payment ledger entries before arrayUnion', async () => {
        const transactionUpdates = [];
        const runTransaction = vi.fn(async (_db, handler) => {
            const paidCents = runTransaction.mock.calls.length === 1 ? 0 : 1000;
            return handler({
                get: vi.fn(async () => ({
                    exists: () => true,
                    data: () => ({ amountDueCents: 5000, amountPaidCents: paidCents })
                })),
                update: vi.fn((_ref, payload) => transactionUpdates.push(payload)),
                set: vi.fn()
            });
        });
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc: vi.fn(),
            runTransaction,
            serverTimestamp: vi.fn(() => 'server-ts'),
            arrayUnion: vi.fn((...entries) => entries),
            deleteField: vi.fn(() => 'deleted'),
            setDoc: vi.fn()
        });
        const paymentUpdate = {
            manualPayment: { amountPaidCents: 1000, paidAt: '2026-07-14' },
            ledgerEntries: [{ type: 'offline_payment', amountCents: 1000, paymentDate: '2026-07-14' }]
        };

        await updateTeamFeeRecipient('team-1', 'batch-1', 'recipient-1', paymentUpdate);
        await updateTeamFeeRecipient('team-1', 'batch-1', 'recipient-1', paymentUpdate);

        expect(transactionUpdates[0].paymentLedger[0]).toEqual(expect.objectContaining({
            type: 'offline_payment',
            amountCents: 1000,
            paymentDate: '2026-07-14'
        }));
        expect(transactionUpdates[1].paymentLedger[0]).toEqual(expect.objectContaining({
            type: 'offline_payment',
            amountCents: 1000,
            paymentDate: '2026-07-14'
        }));
        expect(transactionUpdates[0].paymentLedger[0].ledgerEntryId).toMatch(/^offline_payment_/);
        expect(transactionUpdates[1].paymentLedger[0].ledgerEntryId).toMatch(/^offline_payment_/);
        expect(transactionUpdates[0].paymentLedger[0].ledgerEntryId).not.toBe(transactionUpdates[1].paymentLedger[0].ledgerEntryId);
        expect(transactionUpdates[1]).toEqual(expect.objectContaining({
            amountPaidCents: 2000,
            remainingBalanceCents: 3000,
            status: 'partial'
        }));
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

    it('rejects cancellation when the latest stored recipient has a recorded payment', async () => {
        const updateDoc = vi.fn();
        const transactionUpdate = vi.fn();
        const runTransaction = vi.fn(async (_db, handler) => handler({
            get: vi.fn(async () => ({
                exists: () => true,
                data: () => ({ amountDueCents: 2500, amountPaidCents: 500 })
            })),
            update: transactionUpdate,
            set: vi.fn()
        }));
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc,
            setDoc: vi.fn(async () => undefined),
            runTransaction,
            serverTimestamp: vi.fn(() => 'server-ts'),
            arrayUnion: vi.fn((...entries) => entries),
            deleteField: vi.fn(() => 'deleted')
        });

        await expect(updateTeamFeeRecipient('team-1', 'batch-1', 'recipient-1', {
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
        })).rejects.toThrow('Paid recipients must be refunded before canceling the balance.');

        expect(runTransaction).toHaveBeenCalledTimes(1);
        expect(updateDoc).not.toHaveBeenCalled();
        expect(transactionUpdate).not.toHaveBeenCalled();
    });

    it('preserves cancellation reasons in admin billing metadata before sanitizing parent-readable fields', async () => {
        const updateDoc = vi.fn(async () => undefined);
        const transactionUpdate = vi.fn();
        const transactionSet = vi.fn();
        const runTransaction = vi.fn(async (_db, handler) => handler({
            get: vi.fn(async () => ({
                exists: () => true,
                data: () => ({ amountDueCents: 2500, amountPaidCents: 0 })
            })),
            update: transactionUpdate,
            set: transactionSet
        }));
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc,
            setDoc: vi.fn(async () => undefined),
            runTransaction,
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

        expect(runTransaction).toHaveBeenCalledTimes(1);
        expect(updateDoc).not.toHaveBeenCalled();
        expect(transactionUpdate).toHaveBeenCalledWith(
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
        const payload = transactionUpdate.mock.calls[0][1];
        expect(payload.canceled).not.toHaveProperty('note');
        expect(payload.paymentLedger[0]).not.toHaveProperty('reason');
        expect(payload.paymentLedger[0]).not.toHaveProperty('canceledBy');
        expect(transactionSet).toHaveBeenCalledWith(
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
