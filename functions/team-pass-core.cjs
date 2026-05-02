const TEAM_PASS_TIER = 'team-pass';

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
  const normalizedEmail = normalizeEmail(email || user.email);
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

function isPaidCheckoutSession(session = {}) {
  return session.payment_status === 'paid' || session.payment_status === 'no_payment_required';
}

function shouldUnlockTeamPassFromEvent(event = {}) {
  if (!event || event.type !== 'checkout.session.completed') {
    return false;
  }
  return isPaidCheckoutSession(event.data?.object || {});
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
  isPaidCheckoutSession,
  shouldUnlockTeamPassFromEvent,
  buildTeamPassEntitlement
};
