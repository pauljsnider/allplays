import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function buildUpdateTeamFeeRecipient({ db = {}, doc, updateDoc, runTransaction, serverTimestamp, arrayUnion, deleteField }) {
    const start = dbSource.indexOf('export async function updateTeamFeeRecipient');
    const end = dbSource.indexOf('\nexport async function createTeamFeeBatch', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const functionSource = dbSource
        .slice(start, end)
        .replace('export async function updateTeamFeeRecipient', 'return async function updateTeamFeeRecipient');

    return new Function('db', 'doc', 'updateDoc', 'runTransaction', 'serverTimestamp', 'arrayUnion', 'deleteField', functionSource)(
        db,
        doc,
        updateDoc,
        runTransaction,
        serverTimestamp,
        arrayUnion,
        deleteField
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
            update: transactionUpdate
        }));
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc,
            runTransaction,
            serverTimestamp: vi.fn(() => 'server-ts'),
            arrayUnion: vi.fn((...entries) => entries),
            deleteField: vi.fn(() => 'deleted')
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
            update: transactionUpdate
        }));
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc,
            runTransaction,
            serverTimestamp: vi.fn(() => 'server-ts'),
            arrayUnion: vi.fn((...entries) => entries),
            deleteField: vi.fn(() => 'deleted')
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
        const arrayUnion = vi.fn((...entries) => entries);
        const deleteField = vi.fn(() => 'deleted');
        const runTransaction = vi.fn(async (_db, handler) => handler({
            get: vi.fn(async () => ({
                exists: () => true,
                data: () => ({ amountDueCents: 2500, amountPaidCents: 1500 })
            })),
            update: transactionUpdate
        }));
        const updateTeamFeeRecipient = buildUpdateTeamFeeRecipient({
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            updateDoc,
            runTransaction,
            serverTimestamp: vi.fn(() => 'server-ts'),
            arrayUnion,
            deleteField
        });

        await expect(updateTeamFeeRecipient('team-1', 'batch-1', 'recipient-1', {
            status: 'paid',
            amountPaidCents: 2500,
            remainingBalanceCents: 0,
            manualPayment: { amountPaidCents: 1000 },
            ledgerEntries: [{ type: 'offline_payment', amountCents: 1000 }]
        })).resolves.toBeUndefined();

        expect(runTransaction).toHaveBeenCalledTimes(1);
        expect(updateDoc).not.toHaveBeenCalled();
        expect(transactionUpdate).toHaveBeenCalledWith(
            { path: 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1' },
            expect.objectContaining({
                amountPaidCents: 2500,
                remainingBalanceCents: 0,
                paymentLedger: [{ type: 'offline_payment', amountCents: 1000 }],
                updatedAt: 'server-ts'
            })
        );
        expect(arrayUnion).toHaveBeenCalledWith({ type: 'offline_payment', amountCents: 1000 });
    });
});
