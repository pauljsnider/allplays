import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    getRegistrationCheckoutLifecycleGuardFailure,
    getRegistrationPaidCheckoutGuardFailure,
    normalizeRegistrationCheckoutCurrency
} = require('../../functions/registration-payment-webhook-core.cjs');

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

    it('wires the guard before registration installment or paid state mutations and persists checkout currency', () => {
        const paidBranchStart = functionsSource.indexOf('if (shouldMarkRegistrationPaidFromEvent(event)) {');
        const installmentMutation = functionsSource.indexOf('const nextPaidInstallmentCount', paidBranchStart);
        const guardCall = functionsSource.indexOf('getRegistrationPaidCheckoutGuardFailure({', paidBranchStart);

        expect(paidBranchStart).toBeGreaterThanOrEqual(0);
        expect(guardCall).toBeGreaterThan(paidBranchStart);
        expect(guardCall).toBeLessThan(installmentMutation);
        expect(functionsSource).toContain('checkoutCurrency: currency,');
        expect(functionsSource).toContain('lastPaidStripeCheckoutSessionId: session.id,');
        expect(functionsSource).toContain('getRegistrationCheckoutLifecycleGuardFailure({');
        expect(functionsSource).toContain('await stripe.checkout.sessions.expire(checkoutSessionId);');
    });
});
