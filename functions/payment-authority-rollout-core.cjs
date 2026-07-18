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

function asNonNegativeSafeInteger(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

function ledgerScopeMatches({ product, record, ledger }) {
  if (product === 'registration') {
    return normalizeString(ledger.teamId) === normalizeString(record.teamId)
      && normalizeString(ledger.formId) === normalizeString(record.formId)
      && normalizeString(ledger.registrationId) === normalizeString(record.id || record.registrationId);
  }
  return normalizeString(ledger.teamId) === normalizeString(record.teamId)
    && normalizeString(ledger.batchId) === normalizeString(record.batchId)
    && normalizeString(ledger.recipientId) === normalizeString(record.id || record.recipientId);
}

function inspectStripeChargeLedgerCoverage({ product = '', record = {}, ledgers = [] } = {}) {
  const normalizedProduct = normalizeString(product);
  if (!['registration', 'team_fee'].includes(normalizedProduct)) return 'stripe_charge_ledger_invalid_product';
  if (!Array.isArray(ledgers) || ledgers.length === 0) return 'paid_stripe_record_missing_charge_ledger';

  const seenCharges = new Set();
  for (const ledger of ledgers) {
    const chargeId = normalizeString(ledger.stripeChargeId);
    const amountPaidCents = asNonNegativeSafeInteger(ledger.amountPaidCents);
    if (ledger.type !== 'stripe_charge'
        || ledger.provider !== 'stripe'
        || ledger.product !== normalizedProduct
        || !ledgerScopeMatches({ product: normalizedProduct, record, ledger })
        || !normalizeString(ledger.stripeCheckoutSessionId)
        || !normalizeString(ledger.stripePaymentIntentId)
        || !chargeId
        || seenCharges.has(chargeId)
        || amountPaidCents === null
        || amountPaidCents <= 0
        || !normalizeString(ledger.currency).toLowerCase()
        || typeof ledger.livemode !== 'boolean') {
      return 'stripe_charge_ledger_invalid';
    }
    seenCharges.add(chargeId);
    for (const field of ['refundedAmountCents', 'disputeLostAmountCents', 'refundableAmountCents']) {
      if (ledger[field] !== undefined && asNonNegativeSafeInteger(ledger[field]) === null) {
        return 'stripe_charge_ledger_invalid';
      }
    }
  }

  const sum = (field) => ledgers.reduce((total, ledger) => total + Number(ledger[field] || 0), 0);
  const grossPaidAmountCents = asNonNegativeSafeInteger(record.stripeGrossPaidAmountCents);
  if (grossPaidAmountCents === null || grossPaidAmountCents <= 0 || grossPaidAmountCents !== sum('amountPaidCents')) {
    return 'stripe_charge_ledger_gross_mismatch';
  }
  for (const [recordField, ledgerField] of [
    ['stripeRefundedAmountCents', 'refundedAmountCents'],
    ['stripeDisputeLostAmountCents', 'disputeLostAmountCents'],
    ['stripeRefundableAmountCents', 'refundableAmountCents']
  ]) {
    if (record[recordField] !== undefined) {
      const aggregate = asNonNegativeSafeInteger(record[recordField]);
      if (aggregate === null || aggregate !== sum(ledgerField)) return 'stripe_charge_ledger_aggregate_mismatch';
    }
  }

  if (normalizedProduct === 'registration') {
    if (normalizeString(record.paymentPlan?.id) === 'installments') {
      const paidInstallmentCount = asNonNegativeSafeInteger(record.paymentPlan?.paidInstallmentCount);
      const installmentLedgerCount = ledgers.filter((ledger) => normalizeString(ledger.paymentPurpose) !== 'reversal_repayment').length;
      if (paidInstallmentCount === null || paidInstallmentCount !== installmentLedgerCount) {
        return 'stripe_charge_ledger_count_mismatch';
      }
    }
    const lastPaidStripeChargeId = normalizeString(record.lastPaidStripeChargeId);
    if (!lastPaidStripeChargeId || !seenCharges.has(lastPaidStripeChargeId)) {
      return 'stripe_charge_ledger_last_charge_mismatch';
    }
  }
  return '';
}

function inspectTeamPassAttemptAuthority({ teamId = '', seasonId = '', tier = 'team-pass', attempt = {} } = {}) {
  const authorityVersion = Number(attempt.stripePaymentAuthorityVersion || attempt.legacyPaymentAuthorityVersion || 1);
  const amountCents = asNonNegativeSafeInteger(attempt.checkoutAmountCents);
  if (normalizeString(attempt.product) !== 'team_pass'
      || normalizeString(attempt.teamId) !== normalizeString(teamId)
      || normalizeString(attempt.seasonId) !== normalizeString(seasonId)
      || normalizeString(attempt.tier) !== normalizeString(tier)
      || normalizeString(attempt.checkoutStatus).toLowerCase() !== 'paid'
      || !normalizeString(attempt.stripeCheckoutSessionId)
      || !normalizeString(attempt.stripePaymentIntentId)
      || amountCents === null
      || amountCents <= 0
      || !normalizeString(attempt.checkoutCurrency).toLowerCase()
      || typeof attempt.livemode !== 'boolean'
      || (authorityVersion !== 2 && !normalizeString(attempt.stripeChargeId))) {
    return 'active_entitlement_invalid_checkout_attempt';
  }
  return '';
}

module.exports = {
  isLegacyStripeRegistrationCandidate,
  isLegacyStripeTeamFeeCandidate,
  isTeamPassEntitlementAuthorityCandidate,
  buildPaymentAuthorityRolloutBlocker,
  inspectStripeChargeLedgerCoverage,
  inspectTeamPassAttemptAuthority
};
