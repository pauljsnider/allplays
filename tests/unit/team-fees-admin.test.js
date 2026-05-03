import { describe, expect, it } from 'vitest';
import {
    buildTeamFeeRecipientRecords,
    isTeamFeeAdmin,
    normalizeTeamFeeDraft,
    parseTeamFeeAmountToCents
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
});
