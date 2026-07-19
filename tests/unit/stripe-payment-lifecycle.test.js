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

    it('retains payment for a closed warning inquiry and rejects unknown closed outcomes', () => {
        const warningOpen = reconcileStripeChargeReversal({ current: {}, event: {
            id: 'evt_warning_created', type: 'charge.dispute.created', created: 100,
            data: { object: { status: 'warning_needs_response' } }
        }, charge: { amount: 4900, amount_refunded: 0 } });
        const warningClosed = reconcileStripeChargeReversal({ current: warningOpen, event: {
            id: 'evt_warning_closed', type: 'charge.dispute.closed', created: 200,
            data: { object: { status: 'warning_closed' } }
        }, charge: { amount: 4900, amount_refunded: 0 } });
        const prevented = reconcileStripeChargeReversal({ current: warningOpen, event: {
            id: 'evt_prevented', type: 'charge.dispute.closed', created: 200,
            data: { object: { status: 'prevented' } }
        }, charge: { amount: 4900, amount_refunded: 0 } });

        expect(warningClosed.disputeStatus).toBe('won');
        expect(prevented.disputeStatus).toBe('won');
        expect(getStripeChargeFinancialStatus(warningClosed)).toBe('paid');
        expect(() => reconcileStripeChargeReversal({ current: warningOpen, event: {
            id: 'evt_unknown_closed', type: 'charge.dispute.closed', created: 200,
            data: { object: { status: 'future_status' } }
        }, charge: { amount: 4900, amount_refunded: 0 } })).toThrow(/unsupported stripe closed dispute status/i);
    });

    it('uses deterministic won precedence for same-second closed dispute events', () => {
        const lostEvent = {
            id: 'evt_lost', type: 'charge.dispute.closed', created: 200,
            data: { object: { status: 'lost' } }
        };
        const wonEvent = {
            id: 'evt_won', type: 'charge.dispute.closed', created: 200,
            data: { object: { status: 'won' } }
        };
        const charge = { amount: 4900, amount_refunded: 0 };
        const lostThenWon = reconcileStripeChargeReversal({
            current: reconcileStripeChargeReversal({ current: {}, event: lostEvent, charge }),
            event: wonEvent,
            charge
        });
        const wonThenLost = reconcileStripeChargeReversal({
            current: reconcileStripeChargeReversal({ current: {}, event: wonEvent, charge }),
            event: lostEvent,
            charge
        });

        expect(lostThenWon.disputeStatus).toBe('won');
        expect(wonThenLost.disputeStatus).toBe('won');
        expect(lostThenWon.lastStripeEventId).toBe('evt_won');
        expect(wonThenLost.lastStripeEventId).toBe('evt_won');
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
