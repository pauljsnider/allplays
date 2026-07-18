import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
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

    it('wires the guard before registration installment or paid state mutations and persists checkout currency', () => {
        const paidBranchStart = functionsSource.indexOf('if (shouldMarkRegistrationPaidFromEvent(event)) {');
        const installmentMutation = functionsSource.indexOf('const nextPaidInstallmentCount', paidBranchStart);
        const guardCall = functionsSource.indexOf('getRegistrationPaidCheckoutGuardFailure({', paidBranchStart);

        expect(paidBranchStart).toBeGreaterThanOrEqual(0);
        expect(guardCall).toBeGreaterThan(paidBranchStart);
        expect(guardCall).toBeLessThan(installmentMutation);
        expect(functionsSource).toContain('checkoutCurrency: currency,');
        expect(functionsSource).toContain('lastPaidStripeCheckoutSessionId: session.id,');
    });
});
