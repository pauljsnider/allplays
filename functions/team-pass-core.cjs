const TEAM_PASS_TIER = 'team-pass';
const crypto = require('node:crypto');

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeEmail(email) {
  return asTrimmedString(email).toLowerCase();
}

function normalizeTeamPassCheckoutInput(data = {}) {
  const teamId = asTrimmedString(data.teamId);
  const requestedSeasonId = asTrimmedString(data.seasonId);
  const currentYear = new Date().getUTCFullYear();
  const seasonId = requestedSeasonId || String(currentYear);
  const tier = asTrimmedString(data.tier) || TEAM_PASS_TIER;

  if (!teamId) {
    throw new Error('Missing teamId');
  }

  if (!/^[A-Za-z0-9_-]{1,80}$/.test(teamId)) {
    throw new Error('Invalid teamId');
  }

  if (!/^[A-Za-z0-9_-]{1,40}$/.test(seasonId)) {
    throw new Error('Invalid seasonId');
  }

  if (tier !== TEAM_PASS_TIER) {
    throw new Error('Unsupported team pass tier');
  }

  return { teamId, seasonId, tier };
}

function isEligibleTeamPassPurchaser({ team = {}, user = {}, uid = '', email = '' } = {}) {
  const normalizedUid = asTrimmedString(uid);
  // Email-based authority must come from the caller's current Auth token.
  // A mutable users/{uid} profile can outlive an Auth email change.
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedUid) return false;

  if (team.ownerId === normalizedUid) return true;

  const adminEmails = Array.isArray(team.adminEmails) ? team.adminEmails : [];
  if (normalizedEmail && adminEmails.map(normalizeEmail).includes(normalizedEmail)) {
    return true;
  }

  const parentTeamIds = Array.isArray(user.parentTeamIds) ? user.parentTeamIds : [];
  if (parentTeamIds.includes(team.id)) return true;

  return false;
}

function buildTeamPassCheckoutAttemptId({ teamId, seasonId, tier } = {}) {
  const normalized = normalizeTeamPassCheckoutInput({ teamId, seasonId, tier });
  const digest = crypto.createHash('sha256')
    .update([
      normalized.teamId,
      normalized.seasonId,
      normalized.tier
    ].join('|'))
    .digest('hex');
  return `team_pass_attempt_${digest}`;
}

function buildTeamPassCheckoutIdempotencyKey({
  teamId,
  seasonId,
  tier,
  checkoutCreationReservationId
} = {}) {
  const attemptId = buildTeamPassCheckoutAttemptId({ teamId, seasonId, tier });
  const reservationId = asTrimmedString(checkoutCreationReservationId);
  if (!reservationId) throw new Error('Missing checkout creation reservation id');
  const digest = crypto.createHash('sha256')
    .update([attemptId, reservationId].join('|'))
    .digest('hex');
  return `team_pass_checkout_${digest}`;
}

function isPaidCheckoutSession(session = {}) {
  return session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
}

function hasTeamPassMetadata(session = {}) {
  const metadata = session.metadata || {};
  try {
    normalizeTeamPassCheckoutInput(metadata);
  } catch (error) {
    return false;
  }
  return Boolean(asTrimmedString(metadata.purchaserUid));
}

function shouldUnlockTeamPassFromEvent(event = {}) {
  if (!event || event.type !== 'checkout.session.completed') {
    return false;
  }

  const session = event.data?.object || {};
  return isPaidCheckoutSession(session) && hasTeamPassMetadata(session);
}

function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

function isTeamPassEntitlementActive(entitlement, { teamId = '', seasonId = '', tier = TEAM_PASS_TIER, now = new Date() } = {}) {
  if (!entitlement || typeof entitlement !== 'object' || Array.isArray(entitlement)) return false;
  if (asTrimmedString(entitlement.teamId) !== asTrimmedString(teamId)) return false;
  if (asTrimmedString(entitlement.seasonId) !== asTrimmedString(seasonId)) return false;
  if ((asTrimmedString(entitlement.tier) || TEAM_PASS_TIER) !== tier) return false;
  if (asTrimmedString(entitlement.status).toLowerCase() !== 'active') return false;
  if (entitlement.active === false || entitlement.isActive === false || entitlement.revoked === true || entitlement.isRevoked === true) return false;
  if (entitlement.revokedAt) return false;

  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const startsAtMs = timestampToMillis(entitlement.startsAt || entitlement.activeFrom);
  const expiresAtMs = timestampToMillis(entitlement.expiresAt || entitlement.activeUntil || entitlement.endsAt || entitlement.endAt);
  if (startsAtMs === undefined || expiresAtMs === undefined) return false;
  if (Number.isFinite(startsAtMs) && startsAtMs > nowMs) return false;
  if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) return false;
  return true;
}

function buildTeamPassEntitlement({ session = {}, eventId = '', receivedAt = null } = {}) {
  const metadata = session.metadata || {};
  const { teamId, seasonId, tier } = normalizeTeamPassCheckoutInput(metadata);
  const purchasedByUid = asTrimmedString(metadata.purchaserUid);
  if (!purchasedByUid) {
    throw new Error('Missing purchaserUid');
  }

  return {
    refPath: `teams/${teamId}/entitlements/${seasonId}_${tier}`,
    data: {
      provider: 'stripe',
      status: 'active',
      teamId,
      seasonId,
      tier,
      purchasedByUid,
      stripeCheckoutSessionId: session.id || null,
      stripeCustomerId: session.customer || null,
      stripePaymentIntentId: session.payment_intent || null,
      stripeEventId: eventId || null,
      updatedAt: receivedAt || null
    }
  };
}

module.exports = {
  TEAM_PASS_TIER,
  normalizeTeamPassCheckoutInput,
  isEligibleTeamPassPurchaser,
  buildTeamPassCheckoutAttemptId,
  buildTeamPassCheckoutIdempotencyKey,
  isPaidCheckoutSession,
  hasTeamPassMetadata,
  shouldUnlockTeamPassFromEvent,
  isTeamPassEntitlementActive,
  buildTeamPassEntitlement
};
