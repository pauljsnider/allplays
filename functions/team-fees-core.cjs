function normalizeString(value) {
    return String(value || '').trim();
}

function normalizeCheckoutAttemptToken(value, label = 'checkoutAttemptToken') {
    const token = normalizeString(value);
    if (!token) return '';
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
        throw new Error(`${label} is invalid.`);
    }
    return token;
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

function normalizeTeamFeeRefundInput(data = {}) {
    const input = normalizeTeamFeeCheckoutInput(data);
    const amountCents = Math.round(Number(data.amountCents ?? Number(data.amount || 0) * 100));
    const reason = normalizeString(data.reason || data.note);
    const refundRequestId = normalizeString(data.refundRequestId || data.idempotencyKey);

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
        throw new Error('Refund amount must be greater than $0.');
    }
    if (refundRequestId && refundRequestId.includes('/')) {
        throw new Error('Refund request ID is invalid.');
    }

    return {
        ...input,
        amountCents,
        reason,
        ...(refundRequestId ? { refundRequestId } : {})
    };
}

function getTeamFeePaidCents(recipient = {}) {
    const paid = Number(recipient.paidAmountCents ?? recipient.amountPaidCents ?? recipient.totalPaidCents ?? recipient.paidCents ?? 0);
    return Number.isFinite(paid) ? Math.max(0, paid) : 0;
}

function getTeamFeeTotalCents(recipient = {}) {
    const total = Number(recipient.amountDueCents ?? recipient.balanceDueCents ?? recipient.adjustedAmountCents ?? recipient.amountCents ?? recipient.totalAmountCents ?? 0);
    return Number.isFinite(total) ? Math.max(0, total) : 0;
}

function getTeamFeeRefundedCents(recipient = {}) {
    const explicitRefunded = Number(recipient.refundedAmountCents ?? recipient.amountRefundedCents ?? recipient.totalRefundedCents);
    if (Number.isFinite(explicitRefunded) && explicitRefunded >= 0) {
        return Math.round(explicitRefunded);
    }

    const ledger = Array.isArray(recipient.paymentLedger) ? recipient.paymentLedger : Array.isArray(recipient.ledgerEntries) ? recipient.ledgerEntries : [];
    return ledger.reduce((total, entry) => {
        if (entry?.type !== 'stripe_refund' && entry?.type !== 'online_refund') return total;
        const status = normalizeString(entry.status || 'succeeded').toLowerCase();
        if (status === 'failed' || status === 'canceled' || status === 'cancelled') return total;
        const amount = Number(entry.refundAmountCents ?? entry.amountCents ?? 0);
        return total + (Number.isFinite(amount) ? Math.abs(Math.round(amount)) : 0);
    }, 0);
}

function getTeamFeeRefundableCents(recipient = {}) {
    return getTeamFeePaidCents(recipient);
}

function getTeamFeeBalanceCents(recipient = {}) {
    const explicitBalance = recipient.balanceDueCents ?? recipient.remainingBalanceCents;
    if (explicitBalance !== undefined && explicitBalance !== null && explicitBalance !== '') {
        const balance = Number(explicitBalance);
        return Number.isFinite(balance) ? Math.max(0, balance) : 0;
    }

    return Math.max(0, getTeamFeeTotalCents(recipient) - getTeamFeePaidCents(recipient));
}

function isOnlineTeamFeeCollection(recipient = {}) {
    const collectionMode = normalizeString(recipient.collectionMode).toLowerCase();
    return ['online_stripe', 'stripe', 'stripe_checkout', 'online'].includes(collectionMode);
}

function isTeamFeeCheckoutEligible(recipient = {}) {
    if (!isOnlineTeamFeeCollection(recipient)) return false;

    const status = normalizeString(recipient.status || 'unpaid').toLowerCase();
    if (status === 'paid' || status === 'canceled' || status === 'cancelled') return false;
    return getTeamFeeBalanceCents(recipient) > 0;
}

function collectParentContactUserIds(parents = []) {
    return (Array.isArray(parents) ? parents : [])
        .map((parent) => normalizeString(parent?.userId || parent?.uid || parent?.parentUserId || parent?.guardianUserId))
        .filter(Boolean);
}

function getTeamFeeRecipientTargetUserIds(recipient = {}, player = {}, privateProfile = {}) {
    const directUserIds = [
        recipient.parentUserId,
        recipient.accountUserId,
        recipient.userId,
        player.parentUserId,
        player.guardianUserId,
        privateProfile.parentUserId,
        privateProfile.guardianUserId
    ].map((value) => normalizeString(value)).filter(Boolean);
    const parentUserIds = [
        ...collectParentContactUserIds(player.parents),
        ...collectParentContactUserIds(player.privateProfileParents),
        ...collectParentContactUserIds(privateProfile.parents)
    ];

    return [...new Set([...directUserIds, ...parentUserIds])];
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

    if (getTeamFeeRecipientTargetUserIds(recipient).includes(uid)) {
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

function buildTeamFeeCheckoutMetadata({ teamId, batchId, recipientId, payerUid, checkoutAttemptToken = '', checkoutAmountCents = 0 }) {
    const metadata = {
        product: 'team_fee',
        teamId,
        batchId,
        recipientId,
        payerUid
    };

    const normalizedToken = normalizeCheckoutAttemptToken(checkoutAttemptToken);
    if (normalizedToken) {
        metadata.checkoutAttemptToken = normalizedToken;
    }

    const amountCents = Math.round(Number(checkoutAmountCents || 0));
    if (Number.isFinite(amountCents) && amountCents > 0) {
        metadata.checkoutAmountCents = String(amountCents);
    }

    return metadata;
}

function canReuseTeamFeeCheckoutSession(recipient = {}, amountCents = 0) {
    return Boolean(
        recipient.checkoutUrl &&
        recipient.stripeCheckoutSessionId &&
        normalizeCheckoutAttemptToken(recipient.checkoutAttemptToken) &&
        recipient.checkoutStatus === 'open' &&
        Number(recipient.checkoutAmountCents) === Number(amountCents)
    );
}

function getTeamFeeCheckoutGuardFailure({ recipient = {}, session = {} } = {}) {
    const activeSessionId = normalizeString(recipient.stripeCheckoutSessionId);
    const sessionId = normalizeString(session.id);
    if (!activeSessionId || !sessionId || activeSessionId !== sessionId) {
        return 'checkout_session_mismatch';
    }

    const recipientToken = normalizeCheckoutAttemptToken(recipient.checkoutAttemptToken);
    const sessionToken = normalizeCheckoutAttemptToken(session.metadata?.checkoutAttemptToken);
    const isLegacyCheckoutSession = !recipientToken && !sessionToken;
    if (!isLegacyCheckoutSession && (!recipientToken || !sessionToken || recipientToken !== sessionToken)) {
        return 'checkout_attempt_mismatch';
    }

    const sessionAmountCents = getTeamFeeStripePaidAmountCents({ recipient, session });
    const expectedCheckoutAmountCents = Math.round(Number(recipient.checkoutAmountCents || 0));
    if (!Number.isFinite(sessionAmountCents) || sessionAmountCents <= 0) {
        return 'checkout_amount_missing';
    }
    if (!Number.isFinite(expectedCheckoutAmountCents) || expectedCheckoutAmountCents <= 0 || sessionAmountCents !== expectedCheckoutAmountCents) {
        return 'checkout_amount_mismatch';
    }
    if (sessionAmountCents !== getTeamFeeBalanceCents(recipient)) {
        return 'balance_mismatch';
    }

    return '';
}

function shouldApplyTeamFeeCheckoutSession({ recipient = {}, session = {} } = {}) {
    return !getTeamFeeCheckoutGuardFailure({ recipient, session });
}

function shouldMarkTeamFeePaidFromEvent(event = {}) {
    const session = event?.data?.object || {};
    const metadata = session.metadata || {};
    const isPaidCheckoutEvent = (
        (event.type === 'checkout.session.completed' && session.payment_status === 'paid') ||
        event.type === 'checkout.session.async_payment_succeeded'
    );
    return isPaidCheckoutEvent &&
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

function getTeamFeeStripePaidAmountCents({ recipient = {}, session = {} } = {}) {
    const sessionAmount = Number(session.amount_total ?? session.amount_paid ?? session.amount_subtotal);
    if (Number.isFinite(sessionAmount) && sessionAmount > 0) {
        return Math.round(sessionAmount);
    }

    if (recipient.stripeCheckoutSessionId && session.id && recipient.stripeCheckoutSessionId === session.id) {
        const checkoutAmount = Number(recipient.checkoutAmountCents);
        if (Number.isFinite(checkoutAmount) && checkoutAmount > 0) {
            return Math.round(checkoutAmount);
        }
    }

    return 0;
}

function buildTeamFeeAdminBillingMetadata({ type, provider = 'stripe', data = {} } = {}) {
    return {
        type,
        provider,
        ...data
    };
}

function getTeamFeeStripePaymentRefs(...sources) {
    const pending = [...sources];
    while (pending.length > 0) {
        const source = pending.shift();
        if (!source) continue;
        if (Array.isArray(source)) {
            pending.unshift(...source);
            continue;
        }
        if (typeof source !== 'object') continue;

        const paymentIntentId = normalizeString(source.stripePaymentIntentId || source.paymentIntentId);
        const chargeId = normalizeString(source.stripeChargeId || source.chargeId || source.stripeLatestChargeId);
        if (paymentIntentId || chargeId) {
            return { paymentIntentId, chargeId };
        }

        if (source.adminBilling) pending.unshift(source.adminBilling);
        if (Array.isArray(source.adminBillingEntries)) pending.unshift(...source.adminBillingEntries);
    }

    return { paymentIntentId: '', chargeId: '' };
}

function buildTeamFeeStripeRefundUpdate({ recipient = {}, refund = {}, amountCents = 0, actorId = '', reason = '', refundedAt, ledgerRefundedAt = refundedAt }) {
    const refundAmountCents = Math.round(Number(amountCents || refund.amount || 0));
    const previousPaidCents = getTeamFeePaidCents(recipient);
    const previousRefundedCents = getTeamFeeRefundedCents(recipient);
    const paidAmountCents = Math.max(0, previousPaidCents - refundAmountCents);
    const refundedAmountCents = previousRefundedCents + refundAmountCents;
    const balanceDueCents = Math.max(0, getTeamFeeTotalCents(recipient) - paidAmountCents);
    const status = paidAmountCents <= 0 ? 'unpaid' : balanceDueCents > 0 ? 'partial' : 'paid';
    const refundStatus = normalizeString(refund.status || 'pending').toLowerCase() || 'pending';
    const paymentRefs = getTeamFeeStripePaymentRefs(recipient);

    return {
        status,
        paidAmountCents,
        amountPaidCents: paidAmountCents,
        balanceDueCents,
        remainingBalanceCents: balanceDueCents,
        refundedAmountCents,
        amountRefundedCents: refundedAmountCents,
        lastRefundedAt: refundedAt,
        updatedAt: refundedAt,
        checkoutStatus: 'stale',
        checkoutAttemptToken: null,
        checkoutUrl: null,
        paymentLink: null,
        stripeCheckoutSessionId: null,
        checkoutAmountCents: null,
        paymentProvider: 'stripe',
        hasAdminBilling: true,
        stripeLastRefundStatus: refundStatus,
        ledgerEntries: [{
            type: 'stripe_refund',
            amountCents: refundAmountCents,
            refundAmountCents,
            status: refundStatus,
            refundedAt: ledgerRefundedAt
        }],
        adminBilling: buildTeamFeeAdminBillingMetadata({
            type: 'stripe_refund',
            data: {
                stripeRefundId: refund.id || null,
                stripePaymentIntentId: typeof refund.payment_intent === 'string' ? refund.payment_intent : (paymentRefs.paymentIntentId || null),
                stripeChargeId: typeof refund.charge === 'string' ? refund.charge : (paymentRefs.chargeId || null),
                refundAmountCents,
                status: refundStatus,
                reason: normalizeString(reason),
                refundedBy: actorId || null,
                refundedAt: ledgerRefundedAt,
                updatedAt: refundedAt
            }
        })
    };
}

function buildTeamFeePaidUpdate({ recipient = {}, session = {}, eventId, receivedAt }) {
    const existingPaidCents = getTeamFeePaidCents(recipient);
    const stripePaidAmountCents = getTeamFeeStripePaidAmountCents({ recipient, session });
    const paidAmountCents = existingPaidCents + stripePaidAmountCents;
    const balanceDueCents = Math.max(0, getTeamFeeTotalCents(recipient) - paidAmountCents);

    return {
        status: balanceDueCents > 0 ? 'partial' : 'paid',
        paidAmountCents,
        amountPaidCents: paidAmountCents,
        balanceDueCents,
        checkoutStatus: 'paid',
        checkoutAttemptToken: null,
        checkoutUrl: null,
        paymentLink: null,
        paymentProvider: 'stripe',
        stripeCheckoutSessionId: null,
        stripePaymentAmountCents: stripePaidAmountCents,
        hasAdminBilling: true,
        paidAt: receivedAt,
        updatedAt: receivedAt,
        receiptMetadata: {
            provider: 'stripe',
            amountPaidCents: stripePaidAmountCents,
            totalPaidCents: paidAmountCents,
            balanceDueCents,
            currency: session.currency || 'usd'
        },
        adminBilling: buildTeamFeeAdminBillingMetadata({
            type: 'stripe_checkout_paid',
            data: {
                stripeCheckoutSessionId: session.id || null,
                stripePaymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : null,
                stripeCustomerId: typeof session.customer === 'string' ? session.customer : null,
                receiptEmail: session.customer_details?.email || session.customer_email || null,
                stripeEventId: eventId,
                amountPaidCents: stripePaidAmountCents,
                totalPaidCents: paidAmountCents,
                balanceDueCents,
                currency: session.currency || 'usd',
                paidAt: receivedAt,
                updatedAt: receivedAt
            }
        })
    };
}

module.exports = {
    normalizeTeamFeeCheckoutInput,
    normalizeTeamFeeRefundInput,
    getTeamFeePaidCents,
    getTeamFeeTotalCents,
    getTeamFeeBalanceCents,
    getTeamFeeRefundedCents,
    getTeamFeeRefundableCents,
    isOnlineTeamFeeCollection,
    isTeamFeeCheckoutEligible,
    isEligibleTeamFeePayer,
    getTeamFeeRecipientTargetUserIds,
    buildTeamFeeCheckoutUrls,
    buildTeamFeeCheckoutMetadata,
    canReuseTeamFeeCheckoutSession,
    getTeamFeeCheckoutGuardFailure,
    shouldApplyTeamFeeCheckoutSession,
    shouldMarkTeamFeePaidFromEvent,
    shouldRecordTeamFeeCheckoutNotPaidFromEvent,
    getTeamFeeStripePaidAmountCents,
    buildTeamFeeAdminBillingMetadata,
    getTeamFeeStripePaymentRefs,
    buildTeamFeePaidUpdate,
    buildTeamFeeStripeRefundUpdate
};
