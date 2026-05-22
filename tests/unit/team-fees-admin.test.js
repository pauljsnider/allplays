// tests/unit/team-fees-admin.test.js
import { describe, it, expect } from 'vitest'; // Import Vitest globals
import { buildManualPaymentUpdate, buildOnlineRefundRequest, getRecipientRefundableCents, isOnlineRefundEligible, buildOfflineRefundUpdate } from '../../js/team-fees-admin.js'; // Adjusted path

describe('buildManualPaymentUpdate', () => {
    it('should correctly handle missing or invalid currentBalanceCents by defaulting to a high number to prevent premature "paid" status', () => {
        const paymentAmount = '5.00'; // $5.00 payment
        const paymentAmountCents = 500;
        const date = '2026-01-01';
        const actorId = 'test-user';

        // Case 1: currentBalanceCents is undefined
        let updates = buildManualPaymentUpdate({
            amount: paymentAmount,
            date,
            actorId,
            currentBalanceCents: undefined, // Simulates missing data-balance-cents
            currentPaidCents: '0'
        });

        expect(updates.amountPaidCents).toBe(paymentAmountCents);
        // remainingBalanceCents should be MAX_SAFE_INTEGER - paymentAmountCents
        expect(updates.remainingBalanceCents).toBe(Number.MAX_SAFE_INTEGER - paymentAmountCents);
        expect(updates.status).toBe('partial'); // Should not be 'paid' if the actual balance is unknown but a payment was made

        // Case 2: currentBalanceCents is NaN
        updates = buildManualPaymentUpdate({
            amount: paymentAmount,
            date,
            actorId,
            currentBalanceCents: 'invalid-string', // Will convert to NaN
            currentPaidCents: '0'
        });

        expect(updates.amountPaidCents).toBe(paymentAmountCents);
        expect(updates.remainingBalanceCents).toBe(Number.MAX_SAFE_INTEGER - paymentAmountCents);
        expect(updates.status).toBe('partial');

        // Case 3: currentBalanceCents is 0, and a payment is made
        updates = buildManualPaymentUpdate({
            amount: paymentAmount,
            date,
            actorId,
            currentBalanceCents: '0', // Explicitly 0 outstanding balance
            currentPaidCents: '0'
        });

        expect(updates.amountPaidCents).toBe(paymentAmountCents);
        expect(updates.remainingBalanceCents).toBe(0); // 0 - 500 = -500, then Math.max(0, -500) = 0
        expect(updates.status).toBe('paid'); // Correctly 'paid' as 500 >= 0

        // Case 4: Valid currentBalanceCents (partial payment scenario)
        const initialBalanceCents = 1000; // $10.00 outstanding
        updates = buildManualPaymentUpdate({
            amount: paymentAmount, // $5.00 payment
            date,
            actorId,
            currentBalanceCents: initialBalanceCents.toString(),
            currentPaidCents: '0'
        });
        expect(updates.amountPaidCents).toBe(paymentAmountCents); // 500
        expect(updates.remainingBalanceCents).toBe(initialBalanceCents - paymentAmountCents); // 1000 - 500 = 500
        expect(updates.status).toBe('partial');
    });
});

describe('online team fee refunds', () => {
    it('builds callable refund requests in cents', () => {
        const request = buildOnlineRefundRequest({
            teamId: ' team_1 ',
            batchId: ' batch_1 ',
            recipientId: ' recipient_1 ',
            amount: '12.34',
            reason: ' duplicate payment '
        });
        expect(request).toMatchObject({
            teamId: 'team_1',
            batchId: 'batch_1',
            recipientId: 'recipient_1',
            amountCents: 1234,
            reason: 'duplicate payment'
        });
        expect(request.refundRequestId).toEqual(expect.any(String));
    });

    it('detects eligible Stripe payments and remaining refundable amount', () => {
        const recipient = {
            paymentProvider: 'stripe',
            stripePaymentIntentId: 'pi_123',
            amountPaidCents: 10000,
            refundedAmountCents: 2500
        };

        expect(getRecipientRefundableCents(recipient)).toBe(10000);
        expect(isOnlineRefundEligible(recipient)).toBe(true);
        expect(isOnlineRefundEligible({ ...recipient, stripePaymentIntentId: '', stripeChargeId: '' })).toBe(false);
        expect(isOnlineRefundEligible({ ...recipient, paymentProvider: 'manual' })).toBe(false);
    });
});

describe('buildOfflineRefundUpdate', () => {
    it('records a partial offline refund and reopens the remaining balance', () => {
        const updates = buildOfflineRefundUpdate({
            refundType: 'partial',
            amount: '4.00',
            method: 'cash',
            note: 'Refunded duplicate cash collection.',
            actorId: 'admin-1',
            currentBalanceCents: '1000',
            currentPaidCents: '1000'
        });

        expect(updates.status).toBe('partial');
        expect(updates.amountPaidCents).toBe(600);
        expect(updates.remainingBalanceCents).toBe(400);
        expect(updates.paidAt).toBeNull();
        expect(updates.refunded).toMatchObject({
            amountCents: 400,
            refundType: 'partial',
            refundMethod: 'cash',
            recordedBy: 'admin-1'
        });
        expect(updates.ledgerEntries).toEqual([
            expect.objectContaining({
                type: 'offline_refund',
                amountCents: -400,
                refundAmountCents: 400,
                refundMethod: 'cash',
                note: 'Refunded duplicate cash collection.'
            })
        ]);
    });

    it('records a full offline check refund and resets paid status to unpaid', () => {
        const updates = buildOfflineRefundUpdate({
            refundType: 'full',
            method: 'check',
            note: 'Check refund issued.',
            actorId: 'admin-2',
            currentBalanceCents: '2500',
            currentPaidCents: '2500'
        });

        expect(updates.status).toBe('unpaid');
        expect(updates.amountPaidCents).toBe(0);
        expect(updates.remainingBalanceCents).toBe(2500);
        expect(updates.paidAt).toBeNull();
        expect(updates.ledgerEntries[0]).toMatchObject({
            type: 'offline_refund',
            amountCents: -2500,
            refundAmountCents: 2500,
            refundType: 'full',
            refundMethod: 'check'
        });
    });

    it('requires a note, offline method, and refund amount no larger than paid', () => {
        expect(() => buildOfflineRefundUpdate({ refundType: 'partial', amount: '6.00', method: 'cash', note: 'Too much', currentBalanceCents: '1000', currentPaidCents: '500' })).toThrow('Refund amount cannot exceed');
        expect(() => buildOfflineRefundUpdate({ refundType: 'partial', amount: '1.00', method: 'card', note: 'Bad method', currentBalanceCents: '1000', currentPaidCents: '500' })).toThrow('Select cash or check');
        expect(() => buildOfflineRefundUpdate({ refundType: 'partial', amount: '1.00', method: 'cash', note: '', currentBalanceCents: '1000', currentPaidCents: '500' })).toThrow('Enter an admin note');
    });
});
