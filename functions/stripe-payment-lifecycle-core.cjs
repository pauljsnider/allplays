'use strict';

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizePositiveInteger(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : 0;
}

function normalizeNonNegativeInteger(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : 0;
}

function getStripeObjectId(value) {
  return normalizeString(typeof value === 'string' ? value : value?.id);
}

function getExpectedStripeLivemode(secretKey) {
  const normalized = normalizeString(secretKey);
  if (normalized.startsWith('sk_live_')) return true;
  if (normalized.startsWith('sk_test_')) return false;
  return null;
}

function classifyStoredStripeCheckoutSession(session = {}, nowMs = Date.now()) {
  const status = normalizeString(session.status).toLowerCase();
  const paymentStatus = normalizeString(session.payment_status).toLowerCase();
  const expiresAtMs = normalizePositiveInteger(session.expires_at) * 1000;

  if (!normalizeString(session.id)) return 'invalid';
  if (['paid', 'no_payment_required'].includes(paymentStatus) || status === 'complete') return 'terminal';
  if (status === 'expired' || (expiresAtMs > 0 && expiresAtMs <= nowMs)) return 'stale';
  if (status === 'open' && ['', 'open', 'unpaid'].includes(paymentStatus)) return 'reusable';
  return 'stale';
}

function normalizeStripeEventCreated(event = {}) {
  return normalizeNonNegativeInteger(event.created);
}

function reconcileStripeChargeReversal({ current = {}, event = {}, charge = {} } = {}) {
  const next = {
    stripeChargeId: getStripeObjectId(charge),
    stripePaymentIntentId: getStripeObjectId(charge.payment_intent),
    chargeAmountCents: normalizePositiveInteger(charge.amount) || normalizePositiveInteger(current.chargeAmountCents),
    refundedAmountCents: normalizeNonNegativeInteger(current.refundedAmountCents),
    refundEventCreated: normalizeNonNegativeInteger(current.refundEventCreated),
    disputeStatus: ['open', 'won', 'lost'].includes(normalizeString(current.disputeStatus).toLowerCase())
      ? normalizeString(current.disputeStatus).toLowerCase()
      : 'none',
    disputeEventCreated: normalizeNonNegativeInteger(current.disputeEventCreated),
    lastStripeEventId: normalizeString(current.lastStripeEventId)
  };
  const eventCreated = normalizeStripeEventCreated(event);
  const authoritativeRefunded = normalizeNonNegativeInteger(charge.amount_refunded);

  // A Charge's amount_refunded is cumulative source-of-truth. Never let an
  // older or partial delivery reduce the amount already observed.
  if (authoritativeRefunded > next.refundedAmountCents) {
    next.refundedAmountCents = authoritativeRefunded;
    next.refundEventCreated = Math.max(next.refundEventCreated, eventCreated);
  }

  if (event.type === 'charge.refunded') {
    next.refundEventCreated = Math.max(next.refundEventCreated, eventCreated);
  }

  let incomingDisputeStatus = '';
  if (event.type === 'charge.dispute.created') {
    incomingDisputeStatus = 'open';
  } else if (event.type === 'charge.dispute.closed') {
    const closedStatus = normalizeString(event.data?.object?.status).toLowerCase();
    if (closedStatus === 'lost') {
      incomingDisputeStatus = 'lost';
    } else if (['won', 'warning_closed', 'prevented'].includes(closedStatus)) {
      // warning_closed and prevented retain the payment; neither represents a
      // financial dispute loss.
      incomingDisputeStatus = 'won';
    } else {
      throw new Error(`Unsupported Stripe closed dispute status: ${closedStatus || 'missing'}`);
    }
  }

  const disputePrecedence = { none: 0, open: 1, lost: 2, won: 3 };
  const disputeEventCanAdvance = eventCreated > next.disputeEventCreated
    || (eventCreated === next.disputeEventCreated
      && disputePrecedence[incomingDisputeStatus] > disputePrecedence[next.disputeStatus]);
  if (incomingDisputeStatus && disputeEventCanAdvance) {
    next.disputeStatus = incomingDisputeStatus;
    next.disputeEventCreated = eventCreated;
    next.lastStripeEventId = normalizeString(event.id) || next.lastStripeEventId;
  }

  return next;
}

function getStripeChargeFinancialStatus(reversal = {}) {
  const refundedAmountCents = normalizeNonNegativeInteger(reversal.refundedAmountCents);
  const chargeAmountCents = normalizePositiveInteger(reversal.chargeAmountCents);
  if (chargeAmountCents > 0 && refundedAmountCents >= chargeAmountCents) return 'refunded';
  const disputeStatus = normalizeString(reversal.disputeStatus).toLowerCase();
  if (disputeStatus === 'open') return 'disputed';
  if (disputeStatus === 'lost') return 'dispute_lost';
  if (refundedAmountCents > 0) return 'refunded';
  return 'paid';
}

function getStripeChargeLostAmountCents(reversal = {}, chargeAmountCents = 0) {
  if (getStripeChargeFinancialStatus(reversal) !== 'dispute_lost') return 0;
  return Math.max(0, normalizePositiveInteger(chargeAmountCents) - normalizeNonNegativeInteger(reversal.refundedAmountCents));
}

module.exports = {
  classifyStoredStripeCheckoutSession,
  getExpectedStripeLivemode,
  getStripeChargeFinancialStatus,
  getStripeChargeLostAmountCents,
  getStripeObjectId,
  normalizeStripeEventCreated,
  reconcileStripeChargeReversal
};
