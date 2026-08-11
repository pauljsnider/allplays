import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function buildListTeamFeeRecipients({ db = {}, collection, getDocs, doc, getDoc }) {
    const start = dbSource.indexOf('export async function listTeamFeeRecipients');
    const end = dbSource.indexOf('\nexport async function updateTeamFeeRecipient', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const functionSource = dbSource
        .slice(start, end)
        .replace('export async function listTeamFeeRecipients', 'return async function listTeamFeeRecipients');

    return new Function('db', 'collection', 'getDocs', 'doc', 'getDoc', functionSource)(
        db,
        collection,
        getDocs,
        doc,
        getDoc
    );
}

describe('listTeamFeeRecipients', () => {
    it('hydrates admin-only billing metadata from the adminBilling subcollection for staff views', async () => {
        const getDocs = vi.fn(async () => ({
            docs: [
                {
                    id: 'recipient-1',
                    data: () => ({
                        playerName: 'Pat Star',
                        hasAdminBilling: true,
                        paymentLedger: [{ type: 'offline_refund', amountCents: -2500, refundAmountCents: 2500 }]
                    })
                },
                {
                    id: 'recipient-2',
                    data: () => ({
                        playerName: 'Chris Doe',
                        hasAdminBilling: false
                    })
                }
            ]
        }));
        const getDoc = vi.fn(async (ref) => ({
            exists: () => ref.path.endsWith('/recipient-1/adminBilling/latest'),
            data: () => ({ type: 'offline_refund', note: 'Refunded at the field', recordedBy: 'coach-1' })
        }));
        const listTeamFeeRecipients = buildListTeamFeeRecipients({
            collection: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            getDocs,
            doc: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            getDoc
        });

        const recipients = await listTeamFeeRecipients('team-1', 'batch-1');

        expect(getDocs).toHaveBeenCalledWith({ path: 'teams/team-1/feeBatches/batch-1/feeRecipients' });
        expect(getDoc).toHaveBeenCalledWith({ path: 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1/adminBilling/latest' });
        expect(recipients).toEqual([
            expect.objectContaining({
                id: 'recipient-2',
                playerName: 'Chris Doe',
                hasAdminBilling: false
            }),
            expect.objectContaining({
                id: 'recipient-1',
                playerName: 'Pat Star',
                hasAdminBilling: true,
                adminBilling: {
                    type: 'offline_refund',
                    note: 'Refunded at the field',
                    recordedBy: 'coach-1'
                }
            })
        ]);
    });

    it('returns 100 flagged recipients without admin billing reads in lightweight mode', async () => {
        const recipientDocs = Array.from({ length: 100 }, (_, index) => ({
            id: `recipient-${String(index + 1).padStart(3, '0')}`,
            data: () => ({
                playerName: `Player ${String(100 - index).padStart(3, '0')}`,
                hasAdminBilling: true,
                status: 'partial',
                amountDueCents: 10000,
                amountPaidCents: 2500,
                remainingBalanceCents: 7500,
                paymentLedger: [{ type: 'offline_payment', amountCents: 2500 }]
            })
        }));
        const getDocs = vi.fn(async () => ({ docs: recipientDocs }));
        const doc = vi.fn((_db, ...parts) => ({ path: parts.join('/') }));
        const getDoc = vi.fn();
        const listTeamFeeRecipients = buildListTeamFeeRecipients({
            collection: vi.fn((_db, ...parts) => ({ path: parts.join('/') })),
            getDocs,
            doc,
            getDoc
        });

        const recipients = await listTeamFeeRecipients('team-1', 'batch-1', { hydrateAdminBilling: false });

        expect(getDocs).toHaveBeenCalledTimes(1);
        expect(getDocs).toHaveBeenCalledWith({ path: 'teams/team-1/feeBatches/batch-1/feeRecipients' });
        expect(doc).not.toHaveBeenCalled();
        expect(getDoc).not.toHaveBeenCalled();
        expect(recipients).toHaveLength(100);
        expect(recipients[0]).toMatchObject({
            playerName: 'Player 001',
            hasAdminBilling: true,
            status: 'partial',
            remainingBalanceCents: 7500,
            paymentLedger: [{ type: 'offline_payment', amountCents: 2500 }]
        });
        expect(recipients[99].playerName).toBe('Player 100');
    });
});
