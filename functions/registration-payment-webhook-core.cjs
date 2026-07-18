'use strict';

function normalizeString(value) {
    return String(value || '').trim();
}

function normalizeCurrency(value) {
    return normalizeString(value).toLowerCase();
}

function normalizePositiveInteger(value) {
    const normalized = Number(value);
    return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : 0;
}

/**
 * Returns a stable ignored reason when a signed Stripe paid event is not the
 * authoritative, still-open checkout for the registration.
 *
 * Stripe signatures prove who sent an event, not that the Checkout Session is
 * the registration's current payment attempt. Session, authority, amount, and
 * currency are therefore checked against server-persisted checkout state before
 * any paid/installment mutation is applied.
 */
function getRegistrationPaidCheckoutGuardFailure({
    registration = {},
    session = {},
    authorityMatches = false,
    expectedCurrency = ''
} = {}) {
    const activeSessionId = normalizeString(registration.stripeCheckoutSessionId);
    const sessionId = normalizeString(session.id);
    if (!activeSessionId || !sessionId || activeSessionId !== sessionId) {
        return 'checkout_session_mismatch';
    }

    const lastPaidSessionId = normalizeString(registration.lastPaidStripeCheckoutSessionId);
    if (lastPaidSessionId === sessionId || registration.checkoutStatus === 'complete' || registration.paymentStatus === 'paid') {
        return 'checkout_session_already_processed';
    }

    if (authorityMatches !== true) {
        return 'checkout_attempt_mismatch';
    }

    const expectedAmountCents = normalizePositiveInteger(registration.checkoutAmountCents);
    const paidAmountCents = normalizePositiveInteger(session.amount_total);
    if (!expectedAmountCents || !paidAmountCents || paidAmountCents !== expectedAmountCents) {
        return 'checkout_amount_mismatch';
    }

    const storedCurrency = normalizeCurrency(registration.checkoutCurrency || expectedCurrency);
    const paidCurrency = normalizeCurrency(session.currency);
    if (!storedCurrency || !paidCurrency || storedCurrency !== paidCurrency) {
        return 'checkout_currency_mismatch';
    }

    return '';
}

module.exports = {
    getRegistrationPaidCheckoutGuardFailure,
    normalizeRegistrationCheckoutCurrency: normalizeCurrency
};
