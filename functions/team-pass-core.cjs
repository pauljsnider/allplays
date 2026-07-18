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

function isValidEntitlementCollectionGroupCursorPath(value) {
  const path = asTrimmedString(value);
  if (!path || path.length > 6_000) return false;
  const parts = path.split('/');
  return parts.length >= 4
    && parts.length % 2 === 0
    && parts[parts.length - 2] === 'entitlements'
    && parts.every((part) => part.length > 0 && part.length <= 1_500 && !['.', '..'].includes(part));
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

function hasLegacyTeamPassMetadata(session = {}) {
  const metadata = session.metadata || {};
  const metadataKeys = Object.keys(metadata).sort();
  const expectedKeys = ['purchaserUid', 'seasonId', 'teamId', 'tier'];
  if (metadataKeys.length !== expectedKeys.length
      || metadataKeys.some((key, index) => key !== expectedKeys[index])) return false;
  if (asTrimmedString(metadata.product)
      || asTrimmedString(metadata.checkoutAttemptToken)
      || asTrimmedString(metadata.priceId)) return false;
  try {
    normalizeTeamPassCheckoutInput(metadata);
  } catch (error) {
    return false;
  }
  return Boolean(asTrimmedString(metadata.purchaserUid));
}

function shouldHandleTeamPassCheckoutEvent(event = {}) {
  const session = event?.data?.object || {};
  return [
    'checkout.session.completed',
    'checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed',
    'checkout.session.expired'
  ].includes(event.type) && (
    session.metadata?.product === TEAM_PASS_PRODUCT
    || hasLegacyTeamPassMetadata(session)
  );
}

function shouldUnlockTeamPassFromEvent(event = {}) {
  if (!shouldHandleTeamPassCheckoutEvent(event)) return false;
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return false;
  const session = event.data?.object || {};
  return isPaidCheckoutSession(session) && (hasTeamPassMetadata(session) || hasLegacyTeamPassMetadata(session));
}

function getLegacyTeamPassCheckoutGuardFailure({
  session = {},
  paymentIntent = {},
  lineItems = [],
  configuredPrice = {},
  configuredPriceId = '',
  expectedLivemode = null,
  paidEvent = false
} = {}) {
  if (!hasLegacyTeamPassMetadata(session)) return 'legacy_metadata_invalid';
  const input = normalizeTeamPassCheckoutInput(session.metadata || {});
  const purchaserUid = asTrimmedString(session.metadata?.purchaserUid);
  if (asTrimmedString(session.client_reference_id) !== `${input.teamId}:${input.seasonId}:${purchaserUid}`) {
    return 'client_reference_mismatch';
  }
  if (asTrimmedString(session.mode) !== 'payment') return 'checkout_mode_mismatch';
  const checkoutLineItems = Array.isArray(lineItems) ? lineItems : [];
  const exactLineItem = checkoutLineItems.length === 1 ? checkoutLineItems[0] : null;
  const expandedLineItemPrice = exactLineItem && typeof exactLineItem.price === 'object' ? exactLineItem.price : null;
  const usesVerifiedLegacyLineItem = exactLineItem
    && Number(exactLineItem.quantity) === 1
    && expandedLineItemPrice
    && expandedLineItemPrice.type === 'one_time';
  if (checkoutLineItems.length > 0 && !usesVerifiedLegacyLineItem) return 'checkout_line_item_mismatch';
  if (!usesVerifiedLegacyLineItem
      && (!configuredPriceId || configuredPrice.id !== configuredPriceId)) return 'configured_price_mismatch';
  if (!usesVerifiedLegacyLineItem && configuredPrice.type !== 'one_time') return 'configured_price_invalid';
  const expectedAmount = normalizePositiveInteger(
    usesVerifiedLegacyLineItem
      ? exactLineItem.amount_total || expandedLineItemPrice.unit_amount
      : configuredPrice.unit_amount
  );
  if (!expectedAmount || normalizePositiveInteger(session.amount_total) !== expectedAmount) return 'checkout_amount_mismatch';
  const expectedCurrency = normalizeCurrency(
    usesVerifiedLegacyLineItem
      ? exactLineItem.currency || expandedLineItemPrice.currency
      : configuredPrice.currency
  );
  if (!expectedCurrency || normalizeCurrency(session.currency) !== expectedCurrency) return 'checkout_currency_mismatch';
  if (expectedLivemode !== null && expectedLivemode !== undefined
      && Boolean(session.livemode) !== Boolean(expectedLivemode)) return 'livemode_mismatch';
  if (!paidEvent) return '';
  if (!isPaidCheckoutSession(session)) return 'checkout_not_paid';
  const paymentIntentId = asTrimmedString(
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  );
  if (!paymentIntentId || paymentIntent.id !== paymentIntentId) return 'payment_intent_mismatch';
  if (Object.keys(paymentIntent.metadata || {}).length !== 0) return 'legacy_payment_intent_metadata_mismatch';
  if (normalizePositiveInteger(paymentIntent.amount_received || paymentIntent.amount) !== expectedAmount) {
    return 'payment_intent_amount_mismatch';
  }
  if (normalizeCurrency(paymentIntent.currency) !== expectedCurrency) return 'payment_intent_currency_mismatch';
  if (Boolean(paymentIntent.livemode) !== Boolean(session.livemode)) return 'payment_intent_livemode_mismatch';
  const chargeId = asTrimmedString(
    typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id
  );
  if (!chargeId) return 'payment_intent_charge_missing';
  return '';
}

function shouldHandleTeamPassReversalEvent(event = {}) {
  return ['charge.refunded', 'charge.dispute.created', 'charge.dispute.closed'].includes(event?.type);
}

function getTeamPassChargeGuardFailure({ attempt = {}, charge = {} } = {}) {
  const metadata = charge.metadata || {};
  const isLegacyAuthority = attempt.legacyPaymentAuthorityVersion === 1;
  const hasLegacyEmptyMetadata = isLegacyAuthority && Object.keys(metadata).length === 0;
  if (!hasLegacyEmptyMetadata && metadata.product !== TEAM_PASS_PRODUCT) return 'product_mismatch';
  let input;
  if (hasLegacyEmptyMetadata) {
    try {
      input = normalizeTeamPassCheckoutInput(attempt);
    } catch (error) {
      return 'legacy_attempt_invalid';
    }
    if (!asTrimmedString(attempt.purchaserUid)
        || !asTrimmedString(attempt.stripeCheckoutSessionId)
        || !asTrimmedString(attempt.stripeChargeId)
        || charge.id !== attempt.stripeChargeId) return 'legacy_attempt_invalid';
  } else {
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
  }
  const paymentIntentId = asTrimmedString(
    typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  );
  if (!asTrimmedString(charge.id)) return 'charge_missing';
  if (attempt.stripeChargeId && charge.id !== attempt.stripeChargeId) return 'charge_mismatch';
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

function getTeamPassPaymentIntentGuardFailure({
  attempt = {},
  session = {},
  paymentIntent = {},
  charge = {}
} = {}) {
  const sessionPaymentIntentId = asTrimmedString(
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  );
  if (!sessionPaymentIntentId || paymentIntent.id !== sessionPaymentIntentId) {
    return 'payment_intent_mismatch';
  }
  if (attempt.stripePaymentIntentId && attempt.stripePaymentIntentId !== paymentIntent.id) {
    return 'payment_intent_mismatch';
  }

  const metadata = paymentIntent.metadata || {};
  let input;
  try {
    if (metadata.product !== TEAM_PASS_PRODUCT) return 'payment_intent_scope_mismatch';
    input = normalizeTeamPassCheckoutInput(metadata);
  } catch (error) {
    return 'payment_intent_scope_mismatch';
  }
  if (input.teamId !== asTrimmedString(attempt.teamId)
      || input.seasonId !== asTrimmedString(attempt.seasonId)
      || input.tier !== asTrimmedString(attempt.tier)
      || metadata.purchaserUid !== attempt.purchaserUid
      || metadata.priceId !== attempt.priceId) {
    return 'payment_intent_scope_mismatch';
  }
  const intentToken = normalizeCheckoutAttemptToken(metadata.checkoutAttemptToken);
  const attemptToken = normalizeCheckoutAttemptToken(attempt.checkoutAttemptToken);
  const sessionToken = normalizeCheckoutAttemptToken(session.metadata?.checkoutAttemptToken);
  if (!intentToken || !attemptToken || !sessionToken
      || intentToken !== attemptToken || intentToken !== sessionToken) {
    return 'payment_intent_attempt_mismatch';
  }

  const expectedAmount = normalizePositiveInteger(attempt.checkoutAmountCents);
  if (!expectedAmount
      || normalizePositiveInteger(session.amount_total) !== expectedAmount
      || normalizePositiveInteger(paymentIntent.amount_received || paymentIntent.amount) !== expectedAmount) {
    return 'payment_intent_amount_mismatch';
  }
  const expectedCurrency = normalizeCurrency(attempt.checkoutCurrency);
  if (!expectedCurrency
      || normalizeCurrency(session.currency) !== expectedCurrency
      || normalizeCurrency(paymentIntent.currency) !== expectedCurrency) {
    return 'payment_intent_currency_mismatch';
  }
  if (attempt.livemode === undefined
      || Boolean(session.livemode) !== Boolean(attempt.livemode)
      || Boolean(paymentIntent.livemode) !== Boolean(attempt.livemode)) {
    return 'payment_intent_livemode_mismatch';
  }

  const latestChargeId = asTrimmedString(
    typeof paymentIntent.latest_charge === 'string'
      ? paymentIntent.latest_charge
      : paymentIntent.latest_charge?.id
  );
  if (!latestChargeId) return 'payment_intent_charge_missing';
  if (asTrimmedString(charge.id) !== latestChargeId) return 'payment_intent_charge_mismatch';
  const chargeGuardFailure = getTeamPassChargeGuardFailure({
    attempt: { ...attempt, stripePaymentIntentId: paymentIntent.id },
    charge
  });
  return chargeGuardFailure ? `charge_${chargeGuardFailure}` : '';
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
  isValidEntitlementCollectionGroupCursorPath,
  isEligibleTeamPassPurchaser,
  isPaidCheckoutSession,
  hasTeamPassMetadata,
  hasLegacyTeamPassMetadata,
  shouldHandleTeamPassCheckoutEvent,
  shouldUnlockTeamPassFromEvent,
  getLegacyTeamPassCheckoutGuardFailure,
  shouldHandleTeamPassReversalEvent,
  getTeamPassChargeGuardFailure,
  getTeamPassPaymentIntentGuardFailure,
  getTeamPassReversalStatus,
  reconcileTeamPassReversal,
  getTeamPassEffectivePaymentStatus,
  getTeamPassCheckoutGuardFailure,
  buildTeamPassEntitlement,
  buildSafeTeamPassEntitlementProjection,
  buildTeamPassAttemptPaymentUpdate
};
