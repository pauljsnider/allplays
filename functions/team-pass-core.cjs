'use strict';

const {
  getStripeChargeFinancialStatus,
  reconcileStripeChargeReversal
} = require('./stripe-payment-lifecycle-core.cjs');

const TEAM_PASS_TIER = 'team-pass';
const TEAM_PASS_PRODUCT = 'team_pass';

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(email) {
  return asTrimmedString(email).toLowerCase();
}

function normalizeCurrency(value) {
  return asTrimmedString(value).toLowerCase();
}

function normalizePositiveInteger(value) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : 0;
}

function normalizeCheckoutAttemptToken(value) {
  const token = asTrimmedString(value);
  return /^[A-Za-z0-9_-]{16,128}$/.test(token) ? token : '';
}

function normalizeTeamPassCheckoutInput(data = {}) {
  const teamId = asTrimmedString(data.teamId);
  const requestedSeasonId = asTrimmedString(data.seasonId);
  const currentYear = new Date().getUTCFullYear();
  const seasonId = requestedSeasonId || String(currentYear);
  const tier = asTrimmedString(data.tier) || TEAM_PASS_TIER;

  if (!teamId) throw new Error('Missing teamId');
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(teamId)) throw new Error('Invalid teamId');
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(seasonId)) throw new Error('Invalid seasonId');
  if (tier !== TEAM_PASS_TIER) throw new Error('Unsupported team pass tier');

  return { teamId, seasonId, tier };
}

function buildTeamPassAttemptId({ seasonId, tier = TEAM_PASS_TIER } = {}) {
  const normalized = normalizeTeamPassCheckoutInput({ teamId: 'attempt', seasonId, tier });
  return `${normalized.seasonId}_${normalized.tier}`;
}

function buildTeamPassCheckoutMetadata({ teamId, seasonId, tier, purchaserUid, checkoutAttemptToken, priceId } = {}) {
  const input = normalizeTeamPassCheckoutInput({ teamId, seasonId, tier });
  const uid = asTrimmedString(purchaserUid);
  const token = normalizeCheckoutAttemptToken(checkoutAttemptToken);
  const normalizedPriceId = asTrimmedString(priceId);
  if (!uid) throw new Error('Missing purchaserUid');
  if (!token) throw new Error('Invalid checkoutAttemptToken');
  if (!normalizedPriceId) throw new Error('Missing priceId');
  return {
    product: TEAM_PASS_PRODUCT,
    ...input,
    purchaserUid: uid,
    checkoutAttemptToken: token,
    priceId: normalizedPriceId
  };
}

function isEligibleTeamPassPurchaser({ team = {}, user = {}, uid = '', email = '' } = {}) {
  const normalizedUid = asTrimmedString(uid);
  const normalizedEmail = normalizeEmail(email || user.email);
  if (!normalizedUid) return false;
  if (team.ownerId === normalizedUid) return true;

  const adminEmails = Array.isArray(team.adminEmails) ? team.adminEmails : [];
  if (normalizedEmail && adminEmails.map(normalizeEmail).includes(normalizedEmail)) return true;

  const parentTeamIds = Array.isArray(user.parentTeamIds) ? user.parentTeamIds : [];
  return parentTeamIds.includes(team.id);
}

function isPaidCheckoutSession(session = {}) {
  return session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
}

function hasTeamPassMetadata(session = {}) {
  const metadata = session.metadata || {};
  try {
    buildTeamPassCheckoutMetadata(metadata);
    return true;
  } catch (error) {
    return false;
  }
}

function shouldHandleTeamPassCheckoutEvent(event = {}) {
  const session = event?.data?.object || {};
  return [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired'
  ].includes(event.type) && session.metadata?.product === TEAM_PASS_PRODUCT;
}

function shouldUnlockTeamPassFromEvent(event = {}) {
  if (!shouldHandleTeamPassCheckoutEvent(event)) return false;
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return false;
  const session = event.data?.object || {};
  return isPaidCheckoutSession(session) && hasTeamPassMetadata(session);
}

function shouldHandleTeamPassReversalEvent(event = {}) {
  return ['charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'].includes(event?.type);
}

function getTeamPassChargeGuardFailure({ attempt = {}, charge = {} } = {}) {
  const metadata = charge.metadata || {};
  if (metadata.product !== TEAM_PASS_PRODUCT) return 'product_mismatch';
  let input;
  try {
    input = normalizeTeamPassCheckoutInput(metadata);
  } catch (error) {
    return 'metadata_invalid';
  }
  if (input.teamId !== asTrimmedString(attempt.teamId)
      || input.seasonId !== asTrimmedString(attempt.seasonId)
      || input.tier !== asTrimmedString(attempt.tier)) return 'entitlement_scope_mismatch';
  if (normalizeCheckoutAttemptToken(metadata.checkoutAttemptToken) !== normalizeCheckoutAttemptToken(attempt.checkoutAttemptToken)) {
    return 'checkout_attempt_mismatch';
  }
  if (!attempt.purchaserUid || metadata.purchaserUid !== attempt.purchaserUid) return 'purchaser_mismatch';
  if (!attempt.priceId || metadata.priceId !== attempt.priceId) return 'price_mismatch';
  const paymentIntentId = asTrimmedString(
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  );
  if (!paymentIntentId) return 'payment_intent_missing';
  if (attempt.stripePaymentIntentId && paymentIntentId !== attempt.stripePaymentIntentId) return 'payment_intent_mismatch';
  if (attempt.livemode !== undefined && Boolean(charge.livemode) !== Boolean(attempt.livemode)) return 'livemode_mismatch';
  if (normalizePositiveInteger(charge.amount) !== normalizePositiveInteger(attempt.checkoutAmountCents)) return 'charge_amount_mismatch';
  if (!normalizeCurrency(charge.currency)
      || normalizeCurrency(charge.currency) !== normalizeCurrency(attempt.checkoutCurrency)) return 'charge_currency_mismatch';
  if (!['creating', 'open', 'async_pending', 'paid', 'disputed', 'refunded', 'dispute_lost'].includes(asTrimmedString(attempt.checkoutStatus).toLowerCase())) {
    return 'checkout_state_mismatch';
  }
  return '';
}

function getTeamPassReversalStatus(event = {}, charge = {}) {
  if (!shouldHandleTeamPassReversalEvent(event)) return '';
  return getStripeChargeFinancialStatus(reconcileStripeChargeReversal({ event, charge }));
}

function reconcileTeamPassReversal({ current = {}, event = {}, charge = {} } = {}) {
  return reconcileStripeChargeReversal({ current, event, charge });
}

function getTeamPassEffectivePaymentStatus(reversal = {}) {
  return getStripeChargeFinancialStatus(reversal);
}

function getTeamPassCheckoutGuardFailure({ attempt = {}, session = {}, paidEvent = false } = {}) {
  const metadata = session.metadata || {};
  if (metadata.product !== TEAM_PASS_PRODUCT) return 'product_mismatch';

  let input;
  try {
    input = normalizeTeamPassCheckoutInput(metadata);
  } catch (error) {
    return 'metadata_invalid';
  }

  if (input.teamId !== asTrimmedString(attempt.teamId)
      || input.seasonId !== asTrimmedString(attempt.seasonId)
      || input.tier !== asTrimmedString(attempt.tier)) {
    return 'entitlement_scope_mismatch';
  }
  if (!session.id || session.id !== attempt.stripeCheckoutSessionId) return 'checkout_session_mismatch';

  const attemptToken = normalizeCheckoutAttemptToken(attempt.checkoutAttemptToken);
  const sessionToken = normalizeCheckoutAttemptToken(metadata.checkoutAttemptToken);
  if (!attemptToken || !sessionToken || attemptToken !== sessionToken) return 'checkout_attempt_mismatch';
  if (!attempt.purchaserUid || metadata.purchaserUid !== attempt.purchaserUid) return 'purchaser_mismatch';
  if (!attempt.priceId || metadata.priceId !== attempt.priceId) return 'price_mismatch';
  if (attempt.livemode !== undefined && Boolean(session.livemode) !== Boolean(attempt.livemode)) return 'livemode_mismatch';

  const status = asTrimmedString(attempt.checkoutStatus).toLowerCase();
  const allowedStatuses = paidEvent ? ['open', 'async_pending'] : ['open', 'async_pending'];
  if (!allowedStatuses.includes(status)) return 'checkout_state_mismatch';

  const amountCents = normalizePositiveInteger(session.amount_total);
  const expectedAmountCents = normalizePositiveInteger(attempt.checkoutAmountCents);
  if (!amountCents || !expectedAmountCents || amountCents !== expectedAmountCents) return 'checkout_amount_mismatch';
  if (!normalizeCurrency(session.currency)
      || normalizeCurrency(session.currency) !== normalizeCurrency(attempt.checkoutCurrency)) {
    return 'checkout_currency_mismatch';
  }
  if (paidEvent && !isPaidCheckoutSession(session)) return 'checkout_not_paid';
  return '';
}

function buildTeamPassEntitlement({ session = {}, receivedAt = null, status = 'active' } = {}) {
  const metadata = session.metadata || {};
  const { teamId, seasonId, tier } = normalizeTeamPassCheckoutInput(metadata);
  return {
    refPath: `teams/${teamId}/entitlements/${seasonId}_${tier}`,
    data: buildSafeTeamPassEntitlementProjection({
      status,
      teamId,
      seasonId,
      tier,
      updatedAt: receivedAt || null
    })
  };
}

function buildSafeTeamPassEntitlementProjection({ teamId, seasonId, tier = TEAM_PASS_TIER, status = 'inactive', updatedAt = null } = {}) {
  const input = normalizeTeamPassCheckoutInput({ teamId, seasonId, tier });
  const normalizedStatus = asTrimmedString(status).toLowerCase();
  if (!['active', 'inactive', 'expired', 'cancelled'].includes(normalizedStatus)) {
    throw new Error('Invalid team pass entitlement status');
  }
  return {
    status: normalizedStatus,
    teamId: input.teamId,
    seasonId: input.seasonId,
    tier: input.tier,
    updatedAt
  };
}

function buildTeamPassAttemptPaymentUpdate({ session = {}, eventId = '', receivedAt = null, status = 'paid' } = {}) {
  return {
    checkoutStatus: status,
    stripeCheckoutSessionId: session.id || null,
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
    stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
    stripeEventId: eventId || null,
    stripePaymentStatus: session.payment_status || null,
    updatedAt: receivedAt || null,
    ...(status === 'paid' ? { paidAt: receivedAt || null } : {})
  };
}

module.exports = {
  TEAM_PASS_TIER,
  TEAM_PASS_PRODUCT,
  normalizeTeamPassCheckoutInput,
  buildTeamPassAttemptId,
  buildTeamPassCheckoutMetadata,
  isEligibleTeamPassPurchaser,
  isPaidCheckoutSession,
  hasTeamPassMetadata,
  shouldHandleTeamPassCheckoutEvent,
  shouldUnlockTeamPassFromEvent,
  shouldHandleTeamPassReversalEvent,
  getTeamPassChargeGuardFailure,
  getTeamPassReversalStatus,
  reconcileTeamPassReversal,
  getTeamPassEffectivePaymentStatus,
  getTeamPassCheckoutGuardFailure,
  buildTeamPassEntitlement,
  buildSafeTeamPassEntitlementProjection,
  buildTeamPassAttemptPaymentUpdate
};
