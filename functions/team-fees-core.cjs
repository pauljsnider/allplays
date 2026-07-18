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
    const refundable = Number(recipient.stripeRefundableAmountCents);
    return Number.isSafeInteger(refundable) ? Math.max(0, refundable) : 0;
}

function getTeamFeeStripeGrossPaidCents(recipient = {}) {
    const paid = Number(recipient.stripeGrossPaidAmountCents);
    return Number.isSafeInteger(paid) ? Math.max(0, paid) : 0;
}

function getTeamFeeStripeRefundedCents(recipient = {}) {
    const refunded = Number(recipient.stripeRefundedAmountCents);
    return Number.isSafeInteger(refunded) ? Math.max(0, refunded) : 0;
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
    const parentPlayerKeys = Array.isArray(user.parentPlayerKeys) ? user.parentPlayerKeys : [];

    return Boolean(playerKey && parentPlayerKeys.includes(playerKey));
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

    const expectedCurrency = normalizeString(recipient.checkoutCurrency).toLowerCase();
    const sessionCurrency = normalizeString(session.currency).toLowerCase();
    if (!isLegacyCheckoutSession && (!expectedCurrency || !sessionCurrency || expectedCurrency !== sessionCurrency)) {
        return 'checkout_currency_mismatch';
    }
    if (!isLegacyCheckoutSession && recipient.livemode !== undefined && Boolean(session.livemode) !== Boolean(recipient.livemode)) {
        return 'checkout_livemode_mismatch';
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

function getTeamFeeRefundAuthorityFailure({ input = {}, recipient = {}, adminBilling = {}, session = {} } = {}) {
    const metadata = session.metadata || {};
    if (adminBilling.type !== 'stripe_checkout_paid' || adminBilling.provider !== 'stripe') {
        return 'billing_record_not_stripe_checkout';
    }
    if (!adminBilling.stripeCheckoutSessionId || session.id !== adminBilling.stripeCheckoutSessionId) {
        return 'checkout_session_mismatch';
    }
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
        return 'checkout_not_paid';
    }
    if (metadata.product !== 'team_fee'
        || metadata.teamId !== input.teamId
        || metadata.batchId !== input.batchId
        || metadata.recipientId !== input.recipientId) {
        return 'checkout_scope_mismatch';
    }

    const sessionPaymentIntentId = normalizeString(
        typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
    );
    const billingPaymentIntentId = normalizeString(adminBilling.stripePaymentIntentId);
    if (!sessionPaymentIntentId || !billingPaymentIntentId || sessionPaymentIntentId !== billingPaymentIntentId) {
        return 'payment_intent_mismatch';
    }

    const sessionAmountCents = Math.round(Number(session.amount_total || 0));
    const billingAmountCents = Math.round(Number(adminBilling.amountPaidCents || 0));
    if (!Number.isSafeInteger(sessionAmountCents) || sessionAmountCents <= 0 || sessionAmountCents !== billingAmountCents) {
        return 'checkout_amount_mismatch';
    }
    const sessionCurrency = normalizeString(session.currency).toLowerCase();
    const billingCurrency = normalizeString(adminBilling.currency).toLowerCase();
    if (!sessionCurrency || !billingCurrency || sessionCurrency !== billingCurrency) {
        return 'checkout_currency_mismatch';
    }
    if (recipient.livemode !== undefined && Boolean(session.livemode) !== Boolean(recipient.livemode)) {
        return 'checkout_livemode_mismatch';
    }
    if (recipient.teamId !== input.teamId || recipient.batchId !== input.batchId) {
        return 'recipient_scope_mismatch';
    }
    return '';
}

function getTeamFeePaymentIntentGuardFailure({
    recipient = {},
    session = {},
    paymentIntent = {},
    allowLegacyPaymentIntentMetadata = false
} = {}) {
    const metadata = paymentIntent.metadata || {};
    const sessionPaymentIntentId = normalizeString(
        typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
    );
    if (!sessionPaymentIntentId || paymentIntent.id !== sessionPaymentIntentId) return 'payment_intent_mismatch';
    const metadataKeys = Object.keys(metadata);
    const hasLegacyEmptyMetadata = allowLegacyPaymentIntentMetadata === true && metadataKeys.length === 0;
    if (!hasLegacyEmptyMetadata) {
        if (metadata.product !== 'team_fee'
            || metadata.teamId !== recipient.teamId
            || metadata.batchId !== recipient.batchId
            || metadata.recipientId !== recipient.id) return 'payment_intent_scope_mismatch';
        const sessionToken = normalizeCheckoutAttemptToken(session.metadata?.checkoutAttemptToken);
        const intentToken = normalizeCheckoutAttemptToken(metadata.checkoutAttemptToken);
        if (!sessionToken || !intentToken || sessionToken !== intentToken) return 'payment_intent_attempt_mismatch';
    }
    const expectedAmount = Math.round(Number(session.amount_total || 0));
    const intentAmount = Math.round(Number(paymentIntent.amount_received || paymentIntent.amount || 0));
    if (!Number.isSafeInteger(expectedAmount) || expectedAmount <= 0 || intentAmount !== expectedAmount) return 'payment_intent_amount_mismatch';
    if (normalizeString(paymentIntent.currency).toLowerCase() !== normalizeString(session.currency).toLowerCase()) {
        return 'payment_intent_currency_mismatch';
    }
    if (Boolean(paymentIntent.livemode) !== Boolean(session.livemode)) return 'payment_intent_livemode_mismatch';
    if (!normalizeString(typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id)) {
        return 'payment_intent_charge_missing';
    }
    return '';
}

function buildTeamFeeStripeChargeLedger({ recipient = {}, session = {}, paymentIntent = {}, eventId = '', receivedAt = null } = {}) {
    const stripeChargeId = normalizeString(typeof paymentIntent.latest_charge === 'string' ? paymentIntent.latest_charge : paymentIntent.latest_charge?.id);
    const amountPaidCents = Math.round(Number(session.amount_total || paymentIntent.amount_received || 0));
    return {
        type: 'stripe_charge',
        provider: 'stripe',
        product: 'team_fee',
        teamId: recipient.teamId,
        batchId: recipient.batchId,
        recipientId: recipient.id,
        stripeChargeId,
        stripePaymentIntentId: paymentIntent.id,
        stripeCheckoutSessionId: session.id,
        checkoutAttemptToken: session.metadata?.checkoutAttemptToken || null,
        amountPaidCents,
        refundedAmountCents: 0,
        pendingRefundAmountCents: 0,
        refundableAmountCents: amountPaidCents,
        disputeLostAmountCents: 0,
        disputeStatus: 'none',
        disputeEventCreated: 0,
        currency: normalizeString(session.currency).toLowerCase(),
        livemode: Boolean(session.livemode),
        stripeEventId: eventId || null,
        ...(Object.keys(paymentIntent.metadata || {}).length === 0 ? { legacyPaymentAuthorityVersion: 1 } : {}),
        paidAt: receivedAt,
        updatedAt: receivedAt
    };
}

function getTeamFeeChargeGuardFailure({ input = {}, ledger = {}, charge = {} } = {}) {
    const metadata = charge.metadata || {};
    const paymentIntentId = normalizeString(typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id);
    if (ledger.type !== 'stripe_charge' || ledger.provider !== 'stripe' || ledger.product !== 'team_fee') return 'charge_ledger_invalid';
    if (!charge.id || ledger.stripeChargeId !== charge.id) return 'charge_id_mismatch';
    if (!paymentIntentId || ledger.stripePaymentIntentId !== paymentIntentId) return 'charge_payment_intent_mismatch';
    if (ledger.teamId !== input.teamId || ledger.batchId !== input.batchId || ledger.recipientId !== input.recipientId) return 'charge_ledger_scope_mismatch';
    const hasLegacyEmptyMetadata = ledger.legacyPaymentAuthorityVersion === 1 && Object.keys(metadata).length === 0;
    if (!hasLegacyEmptyMetadata && (metadata.product !== 'team_fee'
        || metadata.teamId !== input.teamId
        || metadata.batchId !== input.batchId
        || metadata.recipientId !== input.recipientId)) return 'charge_metadata_scope_mismatch';
    if (Math.round(Number(charge.amount || 0)) !== Math.round(Number(ledger.amountPaidCents || 0))) return 'charge_amount_mismatch';
    if (normalizeString(charge.currency).toLowerCase() !== normalizeString(ledger.currency).toLowerCase()) return 'charge_currency_mismatch';
    if (Boolean(charge.livemode) !== Boolean(ledger.livemode)) return 'charge_livemode_mismatch';
    return '';
}

function allocateTeamFeeRefundAcrossCharges(ledgers = [], amountCents = 0) {
    let remaining = Math.round(Number(amountCents || 0));
    if (!Number.isSafeInteger(remaining) || remaining <= 0) return [];
    const sorted = (Array.isArray(ledgers) ? ledgers : [])
        .filter((ledger) => ledger?.type === 'stripe_charge' && ledger?.provider === 'stripe')
        .map((ledger) => {
            const refundable = Math.max(0, Math.round(Number(ledger.refundableAmountCents || 0)));
            const pending = Math.max(0, Math.round(Number(ledger.pendingRefundAmountCents || 0)));
            return { ...ledger, availableRefundAmountCents: Math.max(0, refundable - pending) };
        })
        .filter((ledger) => ledger.availableRefundAmountCents > 0 && !['open', 'lost'].includes(normalizeString(ledger.disputeStatus).toLowerCase()))
        .sort((left, right) => {
            const timeDelta = Number(right.paidAtMillis || 0) - Number(left.paidAtMillis || 0);
            return timeDelta || normalizeString(right.stripeChargeId).localeCompare(normalizeString(left.stripeChargeId));
        });
    const allocations = [];
    for (const ledger of sorted) {
        if (remaining <= 0) break;
        const allocationAmountCents = Math.min(remaining, ledger.availableRefundAmountCents);
        allocations.push({
            stripeChargeId: ledger.stripeChargeId,
            stripePaymentIntentId: ledger.stripePaymentIntentId,
            amountCents: allocationAmountCents
        });
        remaining -= allocationAmountCents;
    }
    return remaining === 0 ? allocations : [];
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
        stripeGrossPaidAmountCents: getTeamFeeStripeGrossPaidCents(recipient),
        stripeRefundedAmountCents: getTeamFeeStripeRefundedCents(recipient) + refundAmountCents,
        stripeRefundableAmountCents: Math.max(0, getTeamFeeRefundableCents(recipient) - refundAmountCents),
        stripeFinancialStatus: Math.max(0, getTeamFeeRefundableCents(recipient) - refundAmountCents) > 0 ? 'partially_refunded' : 'refunded',
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
        checkoutPayerUid: null,
        checkoutUrl: null,
        paymentLink: null,
        paymentProvider: 'stripe',
        stripeGrossPaidAmountCents: getTeamFeeStripeGrossPaidCents(recipient) + stripePaidAmountCents,
        stripeRefundedAmountCents: getTeamFeeStripeRefundedCents(recipient),
        stripeRefundableAmountCents: getTeamFeeRefundableCents(recipient) + stripePaidAmountCents,
        stripeFinancialStatus: 'paid',
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
    getTeamFeeStripeGrossPaidCents,
    getTeamFeeStripeRefundedCents,
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
    getTeamFeeRefundAuthorityFailure,
    getTeamFeePaymentIntentGuardFailure,
    buildTeamFeeStripeChargeLedger,
    getTeamFeeChargeGuardFailure,
    allocateTeamFeeRefundAcrossCharges,
    buildTeamFeePaidUpdate,
    buildTeamFeeStripeRefundUpdate
};
