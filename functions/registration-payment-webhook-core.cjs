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

function registrationCheckoutSessionMatches(registration = {}, session = {}) {
    const activeSessionId = normalizeString(registration.stripeCheckoutSessionId);
    const sessionId = normalizeString(session.id);
    return Boolean(activeSessionId && sessionId && activeSessionId === sessionId);
}

function registrationCheckoutIsTerminal(registration = {}, session = {}) {
    const sessionId = normalizeString(session.id);
    const lastPaidSessionId = normalizeString(registration.lastPaidStripeCheckoutSessionId);
    return Boolean(
        (sessionId && lastPaidSessionId === sessionId)
        || registration.checkoutStatus === 'complete'
        || registration.paymentStatus === 'paid'
    );
}

function getRegistrationCheckoutLifecycleGuardFailure({
    registration = {},
    session = {},
    authorityMatches = false,
    eventType = '',
    paidEvent = false,
    expectedCurrency = ''
} = {}) {
    if (!registrationCheckoutSessionMatches(registration, session)) {
        return 'checkout_session_mismatch';
    }

    if (registrationCheckoutIsTerminal(registration, session)) {
        return paidEvent ? 'checkout_session_already_processed' : 'checkout_state_already_terminal';
    }

    if (authorityMatches !== true) {
        return 'checkout_attempt_mismatch';
    }

    // Capacity may only be fulfilled while the server still owns a reservation
    // for this registration. A cancelled/expired checkout can remain reachable
    // in browser history, so accepting its later payment would oversubscribe the
    // registration option after capacity was released.
    if (registration.registrationCapacityReleased === true) {
        return 'checkout_capacity_released';
    }

    const checkoutStatus = normalizeString(registration.checkoutStatus).toLowerCase();
    const allowedStatuses = paidEvent
        ? ['open', 'async_pending']
        : eventType === 'checkout.session.completed'
            ? ['open']
            : eventType === 'checkout.session.async_payment_failed'
                ? ['open', 'async_pending']
                : eventType === 'checkout.session.expired'
                    ? ['open']
                    : [];
    if (!allowedStatuses.includes(checkoutStatus)) {
        return 'checkout_state_mismatch';
    }

    if (!paidEvent) return '';

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
    if (registration.livemode !== undefined && Boolean(session.livemode) !== Boolean(registration.livemode)) {
        return 'checkout_livemode_mismatch';
    }

    return '';
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
    return getRegistrationCheckoutLifecycleGuardFailure({
        registration,
        session,
        authorityMatches,
        eventType: 'checkout.session.completed',
        paidEvent: true,
        expectedCurrency
    });
}

module.exports = {
    getRegistrationCheckoutLifecycleGuardFailure,
    getRegistrationPaidCheckoutGuardFailure,
    normalizeRegistrationCheckoutCurrency: normalizeCurrency
};
