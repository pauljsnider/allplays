'use strict';

const { getTeamPassEffectivePaymentStatus } = require('./team-pass-core.cjs');

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
    || Boolean(normalizeString(data.checkoutCreationReservationId))
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
    const refundedAmountCents = asNonNegativeSafeInteger(ledger.refundedAmountCents || 0);
    const disputeLostAmountCents = asNonNegativeSafeInteger(ledger.disputeLostAmountCents || 0);
    const refundableAmountCents = asNonNegativeSafeInteger(ledger.refundableAmountCents || 0);
    const disputeStatus = normalizeString(ledger.disputeStatus || 'none').toLowerCase();
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
        || typeof ledger.livemode !== 'boolean'
        || !['none', 'open', 'won', 'lost'].includes(disputeStatus)
        || refundedAmountCents === null
        || disputeLostAmountCents === null
        || refundableAmountCents === null
        || refundedAmountCents + disputeLostAmountCents > amountPaidCents
        || (normalizedProduct === 'team_fee'
          && refundedAmountCents + disputeLostAmountCents + refundableAmountCents !== amountPaidCents)) {
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
    const ledgerAggregate = sum(ledgerField);
    if (record[recordField] !== undefined || normalizedProduct === 'team_fee' || ledgerAggregate > 0) {
      const aggregate = asNonNegativeSafeInteger(record[recordField]);
      if (aggregate === null || aggregate !== ledgerAggregate) return 'stripe_charge_ledger_aggregate_mismatch';
    }
  }

  if (normalizedProduct === 'team_fee') {
    const disputeStatuses = ledgers.map((ledger) => normalizeString(ledger.disputeStatus || 'none').toLowerCase());
    const refundedAmountCents = sum('refundedAmountCents');
    const disputeLostAmountCents = sum('disputeLostAmountCents');
    const expectedFinancialStatus = disputeStatuses.includes('open')
      ? 'disputed'
      : disputeStatuses.includes('lost') || disputeLostAmountCents > 0
        ? 'dispute_lost'
        : refundedAmountCents > 0
          ? refundedAmountCents >= grossPaidAmountCents ? 'refunded' : 'partially_refunded'
          : 'paid';
    if (normalizeString(record.stripeFinancialStatus).toLowerCase() !== expectedFinancialStatus) {
      return 'stripe_charge_ledger_financial_status_mismatch';
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
  const hasV2Authority = Number(attempt.stripePaymentAuthorityVersion) === 2
    && attempt.legacyPaymentAuthorityVersion === undefined;
  const hasV1Authority = Number(attempt.legacyPaymentAuthorityVersion) === 1
    && attempt.stripePaymentAuthorityVersion === undefined;
  const amountCents = asNonNegativeSafeInteger(attempt.checkoutAmountCents);
  const reversalState = attempt.reversalState;
  const hasValidReversalState = reversalState === undefined
    || (reversalState !== null && typeof reversalState === 'object' && !Array.isArray(reversalState));
  const reversalRefundedAmountCents = reversalState?.refundedAmountCents;
  const topLevelRefundedAmountCents = attempt.refundedAmountCents;
  const reversalDisputeLostAmountCents = reversalState?.disputeLostAmountCents;
  const topLevelDisputeLostAmountCents = attempt.disputeLostAmountCents;
  const disputeStatuses = [reversalState?.disputeStatus, attempt.disputeStatus]
    .map((value) => normalizeString(value).toLowerCase())
    .filter(Boolean);
  const explicitFinancialStatuses = [attempt.reversalStatus, attempt.financialStatus, attempt.stripeFinancialStatus]
    .map((value) => normalizeString(value).toLowerCase())
    .filter(Boolean);
  const hasValidRefundAmounts = [
    reversalRefundedAmountCents,
    topLevelRefundedAmountCents,
    reversalDisputeLostAmountCents,
    topLevelDisputeLostAmountCents,
    reversalState?.chargeAmountCents
  ]
    .every((value) => value === undefined || asNonNegativeSafeInteger(value) !== null);
  const hasOnlyEffectiveDisputeSignals = disputeStatuses.every((status) => ['none', 'won'].includes(status));
  const hasWonDisputeSignal = disputeStatuses.includes('won');
  const hasResolvedDisputeId = !normalizeString(attempt.disputeId) || hasWonDisputeSignal;
  const hasEffectivePaidAuthority = hasValidReversalState
    && hasValidRefundAmounts
    && hasOnlyEffectiveDisputeSignals
    && hasResolvedDisputeId
    && explicitFinancialStatuses.every((status) => status === 'paid')
    && asNonNegativeSafeInteger(reversalRefundedAmountCents || 0) === 0
    && asNonNegativeSafeInteger(topLevelRefundedAmountCents || 0) === 0
    && asNonNegativeSafeInteger(reversalDisputeLostAmountCents || 0) === 0
    && asNonNegativeSafeInteger(topLevelDisputeLostAmountCents || 0) === 0
    && getTeamPassEffectivePaymentStatus({
      ...(hasValidReversalState && reversalState ? reversalState : {}),
      chargeAmountCents: reversalState?.chargeAmountCents || amountCents || 0,
      refundedAmountCents: reversalRefundedAmountCents ?? topLevelRefundedAmountCents ?? 0,
      disputeStatus: hasWonDisputeSignal ? 'won' : 'none'
    }) === 'paid';
  if (normalizeString(attempt.product) !== 'team_pass'
      || normalizeString(attempt.teamId) !== normalizeString(teamId)
      || normalizeString(attempt.seasonId) !== normalizeString(seasonId)
      || normalizeString(attempt.tier) !== normalizeString(tier)
      || normalizeString(attempt.checkoutStatus).toLowerCase() !== 'paid'
      || !hasEffectivePaidAuthority
      || !normalizeString(attempt.stripeCheckoutSessionId)
      || !normalizeString(attempt.stripePaymentIntentId)
      || !normalizeString(attempt.stripeChargeId)
      || !normalizeString(attempt.purchaserUid)
      || !/^[A-Za-z0-9_-]{16,128}$/.test(normalizeString(attempt.checkoutAttemptToken))
      || !normalizeString(attempt.priceId)
      || amountCents === null
      || amountCents <= 0
      || !normalizeString(attempt.checkoutCurrency).toLowerCase()
      || typeof attempt.livemode !== 'boolean'
      || (!hasV2Authority && !hasV1Authority)) {
    return 'active_entitlement_invalid_checkout_attempt';
  }
  return '';
}

function inspectSettledTeamPassAttemptAuthority({ teamId = '', seasonId = '', tier = 'team-pass', attempt = {} } = {}) {
  const checkoutStatus = normalizeString(attempt.checkoutStatus).toLowerCase();
  if (checkoutStatus === 'paid') {
    return inspectTeamPassAttemptAuthority({ teamId, seasonId, tier, attempt });
  }

  const hasV2Authority = Number(attempt.stripePaymentAuthorityVersion) === 2
    && attempt.legacyPaymentAuthorityVersion === undefined;
  const hasV1Authority = Number(attempt.legacyPaymentAuthorityVersion) === 1
    && attempt.stripePaymentAuthorityVersion === undefined;
  const amountCents = asNonNegativeSafeInteger(attempt.checkoutAmountCents);
  const reversalState = attempt.reversalState;
  const reversalRefundedAmountCents = asNonNegativeSafeInteger(reversalState?.refundedAmountCents);
  const reversalChargeAmountCents = asNonNegativeSafeInteger(reversalState?.chargeAmountCents);
  const reversalDisputeStatus = normalizeString(reversalState?.disputeStatus || 'none').toLowerCase();
  const topLevelRefundedAmountCents = attempt.refundedAmountCents === undefined
    ? reversalRefundedAmountCents
    : asNonNegativeSafeInteger(attempt.refundedAmountCents);
  const topLevelDisputeStatus = normalizeString(attempt.disputeStatus).toLowerCase();
  const effectiveStatus = getTeamPassEffectivePaymentStatus({
    chargeAmountCents: reversalChargeAmountCents || 0,
    refundedAmountCents: reversalRefundedAmountCents ?? 0,
    disputeStatus: reversalDisputeStatus
  });
  const expectedDisputeLostAmountCents = effectiveStatus === 'dispute_lost'
    ? Math.max(0, Number(reversalChargeAmountCents || 0) - Number(reversalRefundedAmountCents || 0))
    : 0;
  const explicitFinancialStatuses = [attempt.reversalStatus, attempt.financialStatus, attempt.stripeFinancialStatus]
    .map((value) => normalizeString(value).toLowerCase())
    .filter(Boolean);
  const topLevelDisputeLostAmountCents = attempt.disputeLostAmountCents === undefined
    ? null
    : asNonNegativeSafeInteger(attempt.disputeLostAmountCents);
  const reversalDisputeLostAmountCents = reversalState?.disputeLostAmountCents === undefined
    ? null
    : asNonNegativeSafeInteger(reversalState.disputeLostAmountCents);
  const hasValidDisputeLostAmounts = checkoutStatus === 'dispute_lost'
    ? topLevelDisputeLostAmountCents === expectedDisputeLostAmountCents
      && reversalDisputeLostAmountCents === expectedDisputeLostAmountCents
    : [topLevelDisputeLostAmountCents, reversalDisputeLostAmountCents]
      .every((amount) => amount === null || amount === expectedDisputeLostAmountCents);

  if (!['refunded', 'dispute_lost'].includes(checkoutStatus)
      || normalizeString(attempt.product) !== 'team_pass'
      || normalizeString(attempt.teamId) !== normalizeString(teamId)
      || normalizeString(attempt.seasonId) !== normalizeString(seasonId)
      || normalizeString(attempt.tier) !== normalizeString(tier)
      || !normalizeString(attempt.stripeCheckoutSessionId)
      || !normalizeString(attempt.stripePaymentIntentId)
      || !normalizeString(attempt.stripeChargeId)
      || !normalizeString(attempt.purchaserUid)
      || !/^[A-Za-z0-9_-]{16,128}$/.test(normalizeString(attempt.checkoutAttemptToken))
      || !normalizeString(attempt.priceId)
      || amountCents === null
      || amountCents <= 0
      || !normalizeString(attempt.checkoutCurrency).toLowerCase()
      || typeof attempt.livemode !== 'boolean'
      || (!hasV2Authority && !hasV1Authority)
      || reversalState === null
      || typeof reversalState !== 'object'
      || Array.isArray(reversalState)
      || reversalChargeAmountCents !== amountCents
      || reversalRefundedAmountCents === null
      || reversalRefundedAmountCents > amountCents
      || topLevelRefundedAmountCents === null
      || topLevelRefundedAmountCents !== reversalRefundedAmountCents
      || !['none', 'won', 'lost'].includes(reversalDisputeStatus)
      || (topLevelDisputeStatus && topLevelDisputeStatus !== reversalDisputeStatus)
      || normalizeString(reversalState.stripePaymentIntentId) !== normalizeString(attempt.stripePaymentIntentId)
      || normalizeString(reversalState.stripeChargeId) !== normalizeString(attempt.stripeChargeId)
      || effectiveStatus !== checkoutStatus
      || explicitFinancialStatuses.some((status) => status !== checkoutStatus)
      || !hasValidDisputeLostAmounts) {
    return 'team_pass_checkout_attempt_invalid';
  }
  return '';
}

module.exports = {
  isLegacyStripeRegistrationCandidate,
  isLegacyStripeTeamFeeCandidate,
  isTeamPassEntitlementAuthorityCandidate,
  buildPaymentAuthorityRolloutBlocker,
  inspectStripeChargeLedgerCoverage,
  inspectTeamPassAttemptAuthority,
  inspectSettledTeamPassAttemptAuthority
};
