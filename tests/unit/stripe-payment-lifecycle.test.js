import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    classifyStoredStripeCheckoutSession,
    reconcileStripeChargeReversal,
    getStripeChargeFinancialStatus
} = require('../../functions/stripe-payment-lifecycle-core.cjs');

describe('shared Stripe payment lifecycle helpers', () => {
    it('reuses only a live open Checkout session and treats expiry or completion as stale/terminal', () => {
        const nowSeconds = 1_700_000_000;
        expect(classifyStoredStripeCheckoutSession({
            id: 'cs_open', status: 'open', payment_status: 'unpaid', expires_at: nowSeconds + 60
        }, nowSeconds * 1000)).toBe('reusable');
        expect(classifyStoredStripeCheckoutSession({
            id: 'cs_expired', status: 'open', payment_status: 'unpaid', expires_at: nowSeconds
        }, nowSeconds * 1000)).toBe('stale');
        expect(classifyStoredStripeCheckoutSession({
            id: 'cs_paid', status: 'complete', payment_status: 'paid', expires_at: nowSeconds + 60
        }, nowSeconds * 1000)).toBe('terminal');
    });

    it('never lets an older dispute event override a newer closed outcome', () => {
        const created = reconcileStripeChargeReversal({ current: {}, event: {
            id: 'evt_created', type: 'charge.dispute.created', created: 100,
            data: { object: { status: 'needs_response' } }
        }, charge: { amount_refunded: 0 } });
        const won = reconcileStripeChargeReversal({ current: created, event: {
            id: 'evt_won', type: 'charge.dispute.closed', created: 200,
            data: { object: { status: 'won' } }
        }, charge: { amount_refunded: 0 } });
        const lateCreated = reconcileStripeChargeReversal({ current: won, event: {
            id: 'evt_late_created', type: 'charge.dispute.created', created: 100,
            data: { object: { status: 'needs_response' } }
        }, charge: { amount_refunded: 0 } });

        expect(won.disputeStatus).toBe('won');
        expect(lateCreated).toEqual(won);
        expect(getStripeChargeFinancialStatus(lateCreated)).toBe('paid');
    });

    it('keeps cumulative refunds monotonic across duplicate and out-of-order events', () => {
        const refunded = reconcileStripeChargeReversal({ current: {}, event: {
            id: 'evt_refund', type: 'charge.refunded', created: 300
        }, charge: { amount_refunded: 4900 } });
        const staleRefund = reconcileStripeChargeReversal({ current: refunded, event: {
            id: 'evt_stale_refund', type: 'charge.refunded', created: 100
        }, charge: { amount_refunded: 1000 } });
        const wonAfterRefund = reconcileStripeChargeReversal({ current: staleRefund, event: {
            id: 'evt_won', type: 'charge.dispute.closed', created: 400,
            data: { object: { status: 'won' } }
        }, charge: { amount_refunded: 4900 } });

        expect(staleRefund.refundedAmountCents).toBe(4900);
        expect(getStripeChargeFinancialStatus(wonAfterRefund)).toBe('refunded');
    });
});
