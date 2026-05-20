// tests/unit/team-fees-admin.test.js
import { describe, it, expect } from 'vitest'; // Import Vitest globals
import { buildManualPaymentUpdate } from '../../js/team-fees-admin.js'; // Adjusted path

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