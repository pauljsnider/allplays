import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    getRegistrationCheckoutLifecycleGuardFailure,
    getRegistrationPaidCheckoutGuardFailure,
    getRegistrationPaymentIntentGuardFailure,
    buildRegistrationStripeChargeLedger,
    getRegistrationChargeGuardFailure,
    buildRegistrationReversalUpdate,
    normalizeRegistrationCheckoutCurrency
} = require('../../functions/registration-payment-webhook-core.cjs');
const { reconcileStripeChargeReversal } = require('../../functions/stripe-payment-lifecycle-core.cjs');

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function currentCheckout(overrides = {}) {
    return {
        registration: {
            stripeCheckoutSessionId: 'cs_current',
            checkoutStatus: 'open',
            paymentStatus: 'checkout_open',
            checkoutAmountCents: 7500,
            checkoutCurrency: 'usd',
            ...overrides.registration
        },
        session: {
            id: 'cs_current',
            amount_total: 7500,
            currency: 'usd',
            ...overrides.session
        },
        authorityMatches: overrides.authorityMatches ?? true,
        expectedCurrency: overrides.expectedCurrency ?? 'usd'
    };
}

describe('registration paid webhook guard', () => {
    it('accepts only the current authoritative checkout with the exact recorded amount and currency', () => {
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout())).toBe('');
    });

    it('rejects stale sessions even when their signed metadata still has valid attempt authority', () => {
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            session: { id: 'cs_stale' }
        }))).toBe('checkout_session_mismatch');
    });

    it('rejects replayed sessions before another installment can be advanced', () => {
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            registration: { lastPaidStripeCheckoutSessionId: 'cs_current' }
        }))).toBe('checkout_session_already_processed');
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            registration: { checkoutStatus: 'complete' }
        }))).toBe('checkout_session_already_processed');
    });

    it('rejects current sessions whose attempt authority no longer matches', () => {
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            authorityMatches: false
        }))).toBe('checkout_attempt_mismatch');
    });

    it('rejects missing, non-integer, and mismatched paid amounts', () => {
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            session: { amount_total: 7400 }
        }))).toBe('checkout_amount_mismatch');
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            session: { amount_total: 7500.5 }
        }))).toBe('checkout_amount_mismatch');
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            registration: { checkoutAmountCents: null }
        }))).toBe('checkout_amount_mismatch');
    });

    it('rejects missing or mismatched currency while supporting legacy records through the server-derived fallback', () => {
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            session: { currency: 'eur' }
        }))).toBe('checkout_currency_mismatch');
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            session: { currency: null }
        }))).toBe('checkout_currency_mismatch');
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            registration: { checkoutCurrency: null },
            expectedCurrency: 'USD'
        }))).toBe('');
        expect(normalizeRegistrationCheckoutCurrency(' USD ')).toBe('usd');
    });

    it('rejects paid events after cancellation or capacity release', () => {
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            registration: { checkoutStatus: 'cancelled' }
        }))).toBe('checkout_state_mismatch');
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            registration: { registrationCapacityReleased: true }
        }))).toBe('checkout_capacity_released');
    });

    it('applies non-paid events only to their current monotonic checkout state', () => {
        const base = currentCheckout();
        expect(getRegistrationCheckoutLifecycleGuardFailure({
            ...base,
            eventType: 'checkout.session.completed',
            paidEvent: false
        })).toBe('');
        expect(getRegistrationCheckoutLifecycleGuardFailure({
            ...currentCheckout({ registration: { checkoutStatus: 'async_pending' } }),
            eventType: 'checkout.session.async_payment_failed',
            paidEvent: false
        })).toBe('');
        expect(getRegistrationCheckoutLifecycleGuardFailure({
            ...currentCheckout({ registration: { checkoutStatus: 'complete', paymentStatus: 'paid' } }),
            eventType: 'checkout.session.expired',
            paidEvent: false
        })).toBe('checkout_state_already_terminal');
        expect(getRegistrationCheckoutLifecycleGuardFailure({
            ...currentCheckout({ registration: { checkoutStatus: 'cancelled' } }),
            eventType: 'checkout.session.expired',
            paidEvent: false
        })).toBe('checkout_state_mismatch');
    });

    it('rejects signed events from the wrong Stripe mode for new checkouts', () => {
        expect(getRegistrationPaidCheckoutGuardFailure(currentCheckout({
            registration: { livemode: true },
            session: { livemode: false }
        }))).toBe('checkout_livemode_mismatch');
    });

    it('binds the PaymentIntent and charge ledger to exact registration authority', () => {
        const metadata = {
            product: 'registration', teamId: 'team-a', formId: 'form-a', registrationId: 'reg-a',
            checkoutAttemptToken: 'tok_1234567890abcdef'
        };
        const registration = { id: 'reg-a', teamId: 'team-a', formId: 'form-a' };
        const session = {
            id: 'cs_123', payment_intent: 'pi_123', amount_total: 7500, currency: 'usd', livemode: false,
            metadata
        };
        const paymentIntent = {
            id: 'pi_123', latest_charge: 'ch_123', amount_received: 7500, currency: 'usd', livemode: false,
            metadata
        };
        expect(getRegistrationPaymentIntentGuardFailure({ registration, session, paymentIntent })).toBe('');
        expect(getRegistrationPaymentIntentGuardFailure({
            registration,
            session,
            paymentIntent: { ...paymentIntent, metadata: {} },
            allowLegacyPaymentIntentMetadata: true
        })).toBe('');
        expect(getRegistrationPaymentIntentGuardFailure({
            registration,
            session,
            paymentIntent: { ...paymentIntent, metadata: {} }
        })).toBe('payment_intent_scope_mismatch');
        expect(getRegistrationPaymentIntentGuardFailure({
            registration,
            session,
            paymentIntent: { ...paymentIntent, metadata: { product: 'registration' } },
            allowLegacyPaymentIntentMetadata: true
        })).toBe('payment_intent_scope_mismatch');
        expect(getRegistrationPaymentIntentGuardFailure({
            registration, session, paymentIntent: { ...paymentIntent, metadata: { ...metadata, registrationId: 'victim' } }
        })).toBe('payment_intent_scope_mismatch');
        expect(getRegistrationPaymentIntentGuardFailure({
            registration, session, paymentIntent: { ...paymentIntent, metadata: { ...metadata, checkoutAttemptToken: 'tok_wrong_1234567890' } }
        })).toBe('payment_intent_attempt_mismatch');

        const ledger = buildRegistrationStripeChargeLedger({
            registration, session, paymentIntent, paymentStatusAfterCharge: 'paid', eventId: 'evt_paid', receivedAt: 'now'
        });
        const input = { teamId: 'team-a', formId: 'form-a', registrationId: 'reg-a' };
        const charge = { id: 'ch_123', payment_intent: 'pi_123', amount: 7500, currency: 'usd', livemode: false, metadata };
        expect(getRegistrationChargeGuardFailure({ input, ledger, charge })).toBe('');
        expect(getRegistrationChargeGuardFailure({
            input, ledger, charge: { ...charge, metadata: { ...metadata, formId: 'victim' } }
        })).toBe('charge_metadata_scope_mismatch');
    });

    it('projects registration refunds and disputes from monotonic per-charge state', () => {
        const charge = { id: 'ch_123', amount: 7500, amount_refunded: 2500 };
        const ledger = {
            amountPaidCents: 7500, refundedAmountCents: 0, disputeLostAmountCents: 0,
            paymentStatusAfterCharge: 'paid'
        };
        const registration = {
            paymentStatus: 'paid', stripeGrossPaidAmountCents: 7500,
            stripeRefundedAmountCents: 0, stripeDisputeLostAmountCents: 0, balanceDueCents: 0
        };
        const partialRefund = reconcileStripeChargeReversal({ current: {}, event: {
            id: 'evt_refund', type: 'charge.refunded', created: 200
        }, charge });
        const update = buildRegistrationReversalUpdate({ registration, ledger, reversal: partialRefund, charge });
        expect(update.registrationUpdate).toMatchObject({
            paymentStatus: 'partially_refunded', stripeRefundedAmountCents: 2500, balanceDueCents: 2500
        });

        const lost = reconcileStripeChargeReversal({ current: partialRefund, event: {
            id: 'evt_lost', type: 'charge.dispute.closed', created: 300,
            data: { object: { status: 'lost' } }
        }, charge: { ...charge, amount_refunded: 2500 } });
        const lostUpdate = buildRegistrationReversalUpdate({ registration, ledger, reversal: lost, charge });
        expect(lostUpdate.registrationUpdate).toMatchObject({
            paymentStatus: 'dispute_lost', stripeRefundedAmountCents: 2500, stripeDisputeLostAmountCents: 5000
        });
    });

    it('wires the guard before registration installment or paid state mutations and persists checkout currency', () => {
        const paidBranchStart = functionsSource.indexOf('if (shouldMarkRegistrationPaidFromEvent(event)) {');
        const installmentMutation = functionsSource.indexOf('const nextPaidInstallmentCount', paidBranchStart);
        const guardCall = functionsSource.indexOf('getRegistrationPaidCheckoutGuardFailure({', paidBranchStart);

        expect(paidBranchStart).toBeGreaterThanOrEqual(0);
        expect(guardCall).toBeGreaterThan(paidBranchStart);
        expect(guardCall).toBeLessThan(installmentMutation);
        expect(functionsSource).toContain('checkoutCurrency: durableReservation.currency,');
        expect(functionsSource).toContain('lastPaidStripeCheckoutSessionId: session.id,');
        expect(functionsSource).toContain('getRegistrationCheckoutLifecycleGuardFailure({');
        expect(functionsSource).toContain('await stripe.checkout.sessions.expire(checkoutSessionId);');
    });
});
