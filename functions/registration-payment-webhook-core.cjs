'use strict';

const {
    getStripeChargeFinancialStatus,
    getStripeChargeLostAmountCents
} = require('./stripe-payment-lifecycle-core.cjs');

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

function getRegistrationPaymentIntentGuardFailure({
    registration = {},
    session = {},
    paymentIntent = {},
    allowLegacyPaymentIntentMetadata = false
} = {}) {
    const metadata = paymentIntent.metadata || {};
    const sessionPaymentIntentId = normalizeString(typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id);
    if (!sessionPaymentIntentId || paymentIntent.id !== sessionPaymentIntentId) return 'payment_intent_mismatch';
    const metadataKeys = Object.keys(metadata);
    const hasLegacyEmptyMetadata = allowLegacyPaymentIntentMetadata === true && metadataKeys.length === 0;
    if (!hasLegacyEmptyMetadata) {
        if (metadata.product !== 'registration'
            || metadata.teamId !== registration.teamId
            || metadata.formId !== registration.formId
            || metadata.registrationId !== registration.id) return 'payment_intent_scope_mismatch';
        const sessionToken = normalizeString(session.metadata?.checkoutAttemptToken);
        const intentToken = normalizeString(metadata.checkoutAttemptToken);
        if (!sessionToken || !intentToken || sessionToken !== intentToken) return 'payment_intent_attempt_mismatch';
    }
    const expectedAmount = normalizePositiveInteger(session.amount_total);
    const intentAmount = normalizePositiveInteger(paymentIntent.amount_received || paymentIntent.amount);
    if (!expectedAmount || intentAmount !== expectedAmount) return 'payment_intent_amount_mismatch';
    if (normalizeCurrency(paymentIntent.currency) !== normalizeCurrency(session.currency)) return 'payment_intent_currency_mismatch';
    if (Boolean(paymentIntent.livemode) !== Boolean(session.livemode)) return 'payment_intent_livemode_mismatch';
    const chargeId = normalizeString(typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id);
    if (!chargeId) return 'payment_intent_charge_missing';
    return '';
}

function buildRegistrationStripeChargeLedger({ registration = {}, session = {}, paymentIntent = {}, eventId = '', receivedAt = null, paymentStatusAfterCharge = 'paid' } = {}) {
    const stripeChargeId = normalizeString(typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id);
    return {
        type: 'stripe_charge',
        provider: 'stripe',
        product: 'registration',
        teamId: registration.teamId,
        formId: registration.formId,
        registrationId: registration.id,
        stripeChargeId,
        stripePaymentIntentId: paymentIntent.id,
        stripeCheckoutSessionId: session.id,
        checkoutAttemptToken: session.metadata?.checkoutAttemptToken || null,
        paymentPurpose: normalizeString(session.metadata?.paymentPurpose) || null,
        amountPaidCents: normalizePositiveInteger(session.amount_total),
        refundedAmountCents: 0,
        disputeLostAmountCents: 0,
        disputeStatus: 'none',
        disputeEventCreated: 0,
        currency: normalizeCurrency(session.currency),
        livemode: Boolean(session.livemode),
        paymentStatusAfterCharge,
        stripeEventId: eventId || null,
        ...(Object.keys(paymentIntent.metadata || {}).length === 0 ? { legacyPaymentAuthorityVersion: 1 } : {}),
        paidAt: receivedAt,
        updatedAt: receivedAt
    };
}

function getRegistrationChargeGuardFailure({ input = {}, ledger = {}, charge = {} } = {}) {
    const metadata = charge.metadata || {};
    const paymentIntentId = normalizeString(typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id);
    if (ledger.type !== 'stripe_charge' || ledger.provider !== 'stripe' || ledger.product !== 'registration') return 'charge_ledger_invalid';
    if (!charge.id || ledger.stripeChargeId !== charge.id) return 'charge_id_mismatch';
    if (!paymentIntentId || ledger.stripePaymentIntentId !== paymentIntentId) return 'charge_payment_intent_mismatch';
    if (ledger.teamId !== input.teamId || ledger.formId !== input.formId || ledger.registrationId !== input.registrationId) return 'charge_ledger_scope_mismatch';
    const hasLegacyEmptyMetadata = ledger.legacyPaymentAuthorityVersion === 1 && Object.keys(metadata).length === 0;
    if (!hasLegacyEmptyMetadata && (metadata.product !== 'registration'
        || metadata.teamId !== input.teamId
        || metadata.formId !== input.formId
        || metadata.registrationId !== input.registrationId)) return 'charge_metadata_scope_mismatch';
    if (normalizePositiveInteger(charge.amount) !== normalizePositiveInteger(ledger.amountPaidCents)) return 'charge_amount_mismatch';
    if (normalizeCurrency(charge.currency) !== normalizeCurrency(ledger.currency)) return 'charge_currency_mismatch';
    if (Boolean(charge.livemode) !== Boolean(ledger.livemode)) return 'charge_livemode_mismatch';
    return '';
}

function getRegistrationAggregateFinancialState({ registration = {}, ledgers = [] } = {}) {
    const normalized = Array.isArray(ledgers) ? ledgers : [];
    const seenChargeIds = new Set();
    const valid = normalized.length > 0 && normalized.every((ledger) => {
        const stripeChargeId = normalizeString(ledger?.stripeChargeId);
        const amountPaidCents = Number(ledger?.amountPaidCents);
        const refundedAmountCents = Number(ledger?.refundedAmountCents || 0);
        const disputeLostAmountCents = Number(ledger?.disputeLostAmountCents || 0);
        const disputeStatus = normalizeString(ledger?.disputeStatus || 'none').toLowerCase();
        if (ledger?.type !== 'stripe_charge'
            || ledger?.provider !== 'stripe'
            || ledger?.product !== 'registration'
            || ledger?.teamId !== registration.teamId
            || ledger?.formId !== registration.formId
            || ledger?.registrationId !== registration.id
            || !stripeChargeId
            || seenChargeIds.has(stripeChargeId)
            || !normalizeString(ledger?.stripePaymentIntentId)
            || !normalizeString(ledger?.stripeCheckoutSessionId)
            || !normalizeCurrency(ledger?.currency)
            || typeof ledger?.livemode !== 'boolean'
            || !['none', 'open', 'won', 'lost'].includes(disputeStatus)
            || ![amountPaidCents, refundedAmountCents, disputeLostAmountCents]
                .every((amount) => Number.isSafeInteger(amount) && amount >= 0)
            || amountPaidCents <= 0
            || refundedAmountCents + disputeLostAmountCents > amountPaidCents) return false;
        seenChargeIds.add(stripeChargeId);
        return true;
    });
    const grossPaidAmountCents = normalized.reduce((total, ledger) => total + Math.max(0, Number(ledger.amountPaidCents || 0)), 0);
    const refundedAmountCents = normalized.reduce((total, ledger) => total + Math.max(0, Number(ledger.refundedAmountCents || 0)), 0);
    const disputeLostAmountCents = normalized.reduce((total, ledger) => total + Math.max(0, Number(ledger.disputeLostAmountCents || 0)), 0);
    const disputeStatuses = normalized.map((ledger) => normalizeString(ledger.disputeStatus || 'none').toLowerCase());
    const financialStatus = disputeStatuses.includes('open')
        ? 'disputed'
        : disputeStatuses.includes('lost') || disputeLostAmountCents > 0
            ? 'dispute_lost'
            : refundedAmountCents > 0
                ? refundedAmountCents >= grossPaidAmountCents ? 'refunded' : 'partially_refunded'
                : grossPaidAmountCents > 0 ? 'paid' : 'unpaid';
    return {
        valid,
        financialStatus,
        grossPaidAmountCents,
        refundedAmountCents,
        disputeLostAmountCents
    };
}

function buildRegistrationReversalUpdate({
    registration = {}, ledger = {}, reversal = {}, charge = {}, aggregateFinancialState = null
} = {}) {
    const financialStatus = aggregateFinancialState?.financialStatus || getStripeChargeFinancialStatus(reversal);
    const chargeAmountCents = normalizePositiveInteger(charge.amount || ledger.amountPaidCents);
    const refundedAmountCents = Math.min(chargeAmountCents, Math.max(0, Number(reversal.refundedAmountCents || 0)));
    const lostAmountCents = getStripeChargeLostAmountCents(reversal, chargeAmountCents);
    const previousLedgerRefunded = Math.max(0, Number(ledger.refundedAmountCents || 0));
    const previousLedgerLost = Math.max(0, Number(ledger.disputeLostAmountCents || 0));
    const nextTotalRefunded = aggregateFinancialState
        ? aggregateFinancialState.refundedAmountCents
        : Math.max(0, Number(registration.stripeRefundedAmountCents || 0) + refundedAmountCents - previousLedgerRefunded);
    const nextTotalLost = aggregateFinancialState
        ? aggregateFinancialState.disputeLostAmountCents
        : Math.max(0, Number(registration.stripeDisputeLostAmountCents || 0) + lostAmountCents - previousLedgerLost);
    const reversalBalanceDelta = (refundedAmountCents - previousLedgerRefunded) + (lostAmountCents - previousLedgerLost);
    const grossPaid = aggregateFinancialState
        ? aggregateFinancialState.grossPaidAmountCents
        : Math.max(chargeAmountCents, Number(registration.stripeGrossPaidAmountCents || 0));
    const basePaymentStatus = normalizeString(registration.paymentStatusBeforeStripeReversal || ledger.paymentStatusAfterCharge || 'paid');
    const paymentStatus = financialStatus === 'disputed'
        ? 'disputed'
        : financialStatus === 'dispute_lost'
            ? 'dispute_lost'
            : nextTotalRefunded > 0
                ? nextTotalRefunded >= grossPaid ? 'refunded' : 'partially_refunded'
                : basePaymentStatus;
    return {
        registrationUpdate: {
            paymentStatus,
            stripeFinancialStatus: financialStatus,
            stripeGrossPaidAmountCents: grossPaid,
            stripeRefundedAmountCents: nextTotalRefunded,
            stripeDisputeLostAmountCents: nextTotalLost,
            stripeReversalBalanceCents: Math.max(0, Number(registration.stripeReversalBalanceCents || 0) + reversalBalanceDelta),
            paymentStatusBeforeStripeReversal: ['disputed', 'dispute_lost', 'refunded', 'partially_refunded'].includes(normalizeString(registration.paymentStatus))
                ? basePaymentStatus
                : normalizeString(registration.paymentStatus || basePaymentStatus),
            balanceDueCents: Math.max(0, Number(registration.balanceDueCents || 0) + reversalBalanceDelta)
        },
        ledgerUpdate: {
            refundedAmountCents,
            disputeLostAmountCents: lostAmountCents,
            disputeStatus: reversal.disputeStatus || 'none',
            disputeEventCreated: Number(reversal.disputeEventCreated || 0),
            refundEventCreated: Number(reversal.refundEventCreated || 0),
            lastStripeEventId: reversal.lastStripeEventId || null
        }
    };
}

module.exports = {
    getRegistrationCheckoutLifecycleGuardFailure,
    getRegistrationPaidCheckoutGuardFailure,
    getRegistrationPaymentIntentGuardFailure,
    buildRegistrationStripeChargeLedger,
    getRegistrationChargeGuardFailure,
    getRegistrationAggregateFinancialState,
    buildRegistrationReversalUpdate,
    normalizeRegistrationCheckoutCurrency: normalizeCurrency
};
