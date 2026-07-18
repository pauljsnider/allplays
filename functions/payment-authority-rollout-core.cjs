'use strict';

function normalizeString(value) {
  return String(value || '').trim();
}

function isLegacyStripeRegistrationCandidate(data = {}) {
  const paymentProvider = normalizeString(data.paymentProvider).toLowerCase();
  const hasStripeReference = [
    data.stripeCheckoutSessionId,
    data.lastPaidStripeCheckoutSessionId,
    data.stripePaymentIntentId,
    data.lastPaidStripeChargeId,
    data.stripeEventId
  ].some((value) => Boolean(normalizeString(value)));
  return paymentProvider === 'stripe'
    || hasStripeReference
    || Number(data.stripeGrossPaidAmountCents || 0) > 0;
}

function isLegacyStripeTeamFeeCandidate(data = {}) {
  const paymentProvider = normalizeString(data.paymentProvider).toLowerCase();
  const hasStripeReference = [
    data.stripeCheckoutSessionId,
    data.stripePaymentIntentId,
    data.stripeChargeId,
    data.stripeEventId
  ].some((value) => Boolean(normalizeString(value)));
  return paymentProvider === 'stripe'
    || hasStripeReference
    || Number(data.stripeGrossPaidAmountCents || 0) > 0;
}

function isTeamPassEntitlementAuthorityCandidate(data = {}) {
  return normalizeString(data.tier) === 'team-pass'
    && normalizeString(data.status).toLowerCase() === 'active';
}

function buildPaymentAuthorityRolloutBlocker({ product = '', path = '', hasAuthorityLedger = false } = {}) {
  if (hasAuthorityLedger) return null;
  const normalizedProduct = normalizeString(product);
  const normalizedPath = normalizeString(path);
  if (!['registration', 'team_fee', 'team_pass'].includes(normalizedProduct) || !normalizedPath) return null;
  return {
    product: normalizedProduct,
    path: normalizedPath,
    reason: normalizedProduct === 'team_pass'
      ? 'active_entitlement_missing_checkout_attempt'
      : 'paid_stripe_record_missing_charge_ledger'
  };
}

module.exports = {
  isLegacyStripeRegistrationCandidate,
  isLegacyStripeTeamFeeCandidate,
  isTeamPassEntitlementAuthorityCandidate,
  buildPaymentAuthorityRolloutBlocker
};
