function normalizeString(value) {
    return String(value || '').trim();
}

function normalizeTeamFeeCheckoutInput(data = {}) {
    const teamId = normalizeString(data.teamId);
    const batchId = normalizeString(data.batchId);
    const recipientId = normalizeString(data.recipientId || data.feeRecipientId);

    if (!teamId) throw new Error('Team ID is required.');
    if (!batchId) throw new Error('Fee batch ID is required.');
    if (!recipientId) throw new Error('Fee recipient ID is required.');

    return { teamId, batchId, recipientId };
}

function getTeamFeePaidCents(recipient = {}) {
    const paid = Number(recipient.paidAmountCents ?? recipient.amountPaidCents ?? recipient.totalPaidCents ?? recipient.paidCents ?? 0);
    return Number.isFinite(paid) ? Math.max(0, paid) : 0;
}

function getTeamFeeTotalCents(recipient = {}) {
    const total = Number(recipient.amountDueCents ?? recipient.balanceDueCents ?? recipient.adjustedAmountCents ?? recipient.amountCents ?? recipient.totalAmountCents ?? 0);
    return Number.isFinite(total) ? Math.max(0, total) : 0;
}

function getTeamFeeBalanceCents(recipient = {}) {
    const explicitBalance = recipient.balanceDueCents ?? recipient.remainingBalanceCents;
    if (explicitBalance !== undefined && explicitBalance !== null && explicitBalance !== '') {
        const balance = Number(explicitBalance);
        return Number.isFinite(balance) ? Math.max(0, balance) : 0;
    }

    return Math.max(0, getTeamFeeTotalCents(recipient) - getTeamFeePaidCents(recipient));
}

function isTeamFeeCheckoutEligible(recipient = {}) {
    const status = normalizeString(recipient.status || 'unpaid').toLowerCase();
    if (status === 'paid' || status === 'canceled' || status === 'cancelled') return false;
    return getTeamFeeBalanceCents(recipient) > 0;
}

function isEligibleTeamFeePayer({ team = {}, user = {}, uid = '', email = '', recipient = {} } = {}) {
    if (!uid) return false;
    if (team.ownerId && team.ownerId === uid) return true;
    if (user.isAdmin === true) return true;

    const normalizedEmail = normalizeString(email || user.email || user.profileEmail).toLowerCase();
    const adminEmails = Array.isArray(team.adminEmails) ? team.adminEmails : [];
    if (normalizedEmail && adminEmails.some((adminEmail) => normalizeString(adminEmail).toLowerCase() === normalizedEmail)) {
        return true;
    }

    if ([recipient.parentUserId, recipient.accountUserId, recipient.userId].some((value) => value && value === uid)) {
        return true;
    }

    const teamId = normalizeString(recipient.teamId || team.id);
    const playerId = normalizeString(recipient.playerId);
    const playerKey = normalizeString(recipient.playerKey || (teamId && playerId ? `${teamId}::${playerId}` : ''));
    const parentTeamIds = Array.isArray(user.parentTeamIds) ? user.parentTeamIds : [];
    const parentPlayerKeys = Array.isArray(user.parentPlayerKeys) ? user.parentPlayerKeys : [];

    return Boolean(
        (teamId && parentTeamIds.includes(teamId)) ||
        (playerKey && parentPlayerKeys.includes(playerKey))
    );
}

function buildTeamFeeCheckoutUrls(appUrl, { teamId, batchId, recipientId }) {
    const baseUrl = String(appUrl || 'https://allplays.ai').replace(/\/$/, '');
    const params = new URLSearchParams({
        feePayment: '1',
        teamId,
        batchId,
        recipientId
    });
    return {
        successUrl: `${baseUrl}/parent-dashboard.html?${params.toString()}&checkout=success`,
        cancelUrl: `${baseUrl}/parent-dashboard.html?${params.toString()}&checkout=cancelled`
    };
}

function buildTeamFeeCheckoutMetadata({ teamId, batchId, recipientId, payerUid }) {
    return {
        product: 'team_fee',
        teamId,
        batchId,
        recipientId,
        payerUid
    };
}

function shouldMarkTeamFeePaidFromEvent(event = {}) {
    const session = event?.data?.object || {};
    const metadata = session.metadata || {};
    return event.type === 'checkout.session.completed' &&
        session.payment_status === 'paid' &&
        metadata.product === 'team_fee' &&
        Boolean(metadata.teamId && metadata.batchId && metadata.recipientId);
}

function shouldRecordTeamFeeCheckoutNotPaidFromEvent(event = {}) {
    const session = event?.data?.object || {};
    const metadata = session.metadata || {};
    return ['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type) &&
        metadata.product === 'team_fee' &&
        Boolean(metadata.teamId && metadata.batchId && metadata.recipientId);
}

function buildTeamFeePaidUpdate({ recipient = {}, session = {}, eventId, receivedAt }) {
    const balanceCents = getTeamFeeBalanceCents(recipient);
    const existingPaidCents = getTeamFeePaidCents(recipient);
    const paidAmountCents = Math.max(existingPaidCents, existingPaidCents + balanceCents);

    return {
        status: 'paid',
        paidAmountCents,
        amountPaidCents: paidAmountCents,
        balanceDueCents: 0,
        checkoutStatus: 'paid',
        paymentProvider: 'stripe',
        stripeCheckoutSessionId: session.id || null,
        stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
        stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
        stripeEventId: eventId,
        paidAt: receivedAt,
        updatedAt: receivedAt,
        receiptMetadata: {
            provider: 'stripe',
            checkoutSessionId: session.id || null,
            paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
            amountPaidCents: paidAmountCents,
            currency: session.currency || 'usd',
            receiptEmail: session.customer_details?.email || session.customer_email || null,
            eventId
        }
    };
}

module.exports = {
    normalizeTeamFeeCheckoutInput,
    getTeamFeePaidCents,
    getTeamFeeTotalCents,
    getTeamFeeBalanceCents,
    isTeamFeeCheckoutEligible,
    isEligibleTeamFeePayer,
    buildTeamFeeCheckoutUrls,
    buildTeamFeeCheckoutMetadata,
    shouldMarkTeamFeePaidFromEvent,
    shouldRecordTeamFeeCheckoutNotPaidFromEvent,
    buildTeamFeePaidUpdate
};
