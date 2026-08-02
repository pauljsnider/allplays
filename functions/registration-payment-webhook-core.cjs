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

const LEGACY_READABLE_REGISTRATION_CHECKOUT_FIELDS = Object.freeze([
    'checkoutAttemptToken',
    'publicCheckoutCapabilityHash',
    'checkoutUrl',
    'paymentLink',
    'stripeCheckoutSessionId',
    'stripePaymentIntentId',
    'lastPaidStripeCheckoutSessionId',
    'checkoutAmountCents',
    'checkoutCurrency',
    'checkoutCreationRequest'
]);

function hasLegacyReadableRegistrationCheckoutState(registration = {}) {
    return LEGACY_READABLE_REGISTRATION_CHECKOUT_FIELDS.some((field) => (
        registration[field] !== undefined && registration[field] !== null && registration[field] !== ''
    )) || Boolean(normalizeString(registration.paymentReminder?.retryUrl));
}

function buildLegacyReadableRegistrationCheckoutAttempt({ registration = {}, existingAttempt = {}, now = null } = {}) {
    const authoritativeAttempt = Object.fromEntries(
        Object.entries(existingAttempt).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
    return {
        version: 1,
        ...(registration.checkoutAttemptToken ? { checkoutAttemptToken: registration.checkoutAttemptToken } : {}),
        ...(registration.publicCheckoutCapabilityHash ? { publicCheckoutCapabilityHash: registration.publicCheckoutCapabilityHash } : {}),
        ...(registration.checkoutUrl || registration.paymentLink ? { checkoutUrl: registration.checkoutUrl || registration.paymentLink } : {}),
        ...(registration.checkoutStatus ? { checkoutStatus: registration.checkoutStatus } : {}),
        ...(registration.stripeCheckoutSessionId ? { stripeCheckoutSessionId: registration.stripeCheckoutSessionId } : {}),
        ...(registration.stripePaymentIntentId ? { stripePaymentIntentId: registration.stripePaymentIntentId } : {}),
        ...(registration.lastPaidStripeCheckoutSessionId ? { lastPaidStripeCheckoutSessionId: registration.lastPaidStripeCheckoutSessionId } : {}),
        ...(registration.stripePaymentStatus ? { stripePaymentStatus: registration.stripePaymentStatus } : {}),
        ...(registration.checkoutAmountCents ? { checkoutAmountCents: registration.checkoutAmountCents } : {}),
        ...(registration.checkoutCurrency ? { checkoutCurrency: registration.checkoutCurrency } : {}),
        ...(registration.checkoutCreationReservationId ? { reservationId: registration.checkoutCreationReservationId } : {}),
        ...(registration.checkoutCreationRequest ? { checkoutCreationRequest: registration.checkoutCreationRequest } : {}),
        ...(registration.paymentReminder?.retryUrl ? { paymentRetryUrl: registration.paymentReminder.retryUrl } : {}),
        ...(registration.checkoutCreatedAt || now ? { createdAt: registration.checkoutCreatedAt || now } : {}),
        ...(now ? { updatedAt: now } : {}),
        ...authoritativeAttempt
    };
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
    checkoutAttempt = {},
    session = {},
    authorityMatches = false,
    expectedCurrency = ''
} = {}) {
    const authoritativeCheckout = Object.keys(checkoutAttempt).length > 0 ? checkoutAttempt : registration;
    const activeSessionId = normalizeString(authoritativeCheckout.stripeCheckoutSessionId);
    const sessionId = normalizeString(session.id);
    if (!activeSessionId || !sessionId || activeSessionId !== sessionId) {
        return 'checkout_session_mismatch';
    }

    const lastPaidSessionId = normalizeString(authoritativeCheckout.lastPaidStripeCheckoutSessionId);
    if (lastPaidSessionId === sessionId || authoritativeCheckout.checkoutStatus === 'complete' || registration.paymentStatus === 'paid') {
        return 'checkout_session_already_processed';
    }

    if (authorityMatches !== true) {
        return 'checkout_attempt_mismatch';
    }

    const expectedAmountCents = normalizePositiveInteger(authoritativeCheckout.checkoutAmountCents);
    const paidAmountCents = normalizePositiveInteger(session.amount_total);
    if (!expectedAmountCents || !paidAmountCents || paidAmountCents !== expectedAmountCents) {
        return 'checkout_amount_mismatch';
    }

    const storedCurrency = normalizeCurrency(authoritativeCheckout.checkoutCurrency || expectedCurrency);
    const paidCurrency = normalizeCurrency(session.currency);
    if (!storedCurrency || !paidCurrency || storedCurrency !== paidCurrency) {
        return 'checkout_currency_mismatch';
    }

    return '';
}

module.exports = {
    LEGACY_READABLE_REGISTRATION_CHECKOUT_FIELDS,
    hasLegacyReadableRegistrationCheckoutState,
    buildLegacyReadableRegistrationCheckoutAttempt,
    getRegistrationPaidCheckoutGuardFailure,
    normalizeRegistrationCheckoutCurrency: normalizeCurrency
};
