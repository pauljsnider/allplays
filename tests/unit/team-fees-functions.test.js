import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    normalizeTeamFeeCheckoutInput,
    normalizeTeamFeeRefundInput,
    getTeamFeeBalanceCents,
    getTeamFeeRefundedCents,
    getTeamFeeRefundableCents,
    isOnlineTeamFeeCollection,
    isTeamFeeCheckoutEligible,
    isEligibleTeamFeePayer,
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
} = require('../../functions/team-fees-core.cjs');

describe('team fee checkout function helpers', () => {
    it('normalizes bounded team fee checkout input', () => {
        expect(normalizeTeamFeeCheckoutInput({
            teamId: ' team_123 ',
            batchId: ' batch_456 ',
            feeRecipientId: ' player_789 '
        })).toEqual({
            teamId: 'team_123',
            batchId: 'batch_456',
            recipientId: 'player_789'
        });
    });

    it('computes current balance and only allows checkout for online collection recipients', () => {
        expect(getTeamFeeBalanceCents({ amountCents: 12500, paidAmountCents: 2500 })).toBe(10000);
        expect(getTeamFeeBalanceCents({ balanceDueCents: 5000, paidAmountCents: 2500 })).toBe(5000);
        expect(isOnlineTeamFeeCollection({ collectionMode: 'online_stripe' })).toBe(true);
        expect(isOnlineTeamFeeCollection({ collectionMode: 'stripe_checkout' })).toBe(true);
        expect(isOnlineTeamFeeCollection({ collectionMode: 'offline_manual' })).toBe(false);
        expect(isTeamFeeCheckoutEligible({ collectionMode: 'online_stripe', status: 'unpaid', amountCents: 12500 })).toBe(true);
        expect(isTeamFeeCheckoutEligible({ collectionMode: 'offline_manual', status: 'unpaid', amountCents: 12500 })).toBe(false);
        expect(isTeamFeeCheckoutEligible({ status: 'unpaid', amountCents: 12500 })).toBe(false);
        expect(isTeamFeeCheckoutEligible({ collectionMode: 'online_stripe', status: 'paid', amountCents: 12500 })).toBe(false);
        expect(isTeamFeeCheckoutEligible({ collectionMode: 'online_stripe', status: 'canceled', amountCents: 12500 })).toBe(false);
        expect(isTeamFeeCheckoutEligible({ collectionMode: 'online_stripe', status: 'unpaid', amountCents: 0 })).toBe(false);
    });

    it('allows owners, admins, linked parents, and direct recipients to pay', () => {
        const team = {
            id: 'team_123',
            ownerId: 'owner_1',
            adminEmails: ['Coach@Example.com']
        };
        const recipient = {
            teamId: 'team_123',
            playerId: 'player_1',
            playerKey: 'team_123::player_1',
            parentUserId: 'parent_1'
        };

        expect(isEligibleTeamFeePayer({ team, recipient, uid: 'owner_1' })).toBe(true);
        expect(isEligibleTeamFeePayer({ team, recipient, uid: 'admin_1', email: 'coach@example.com' })).toBe(true);
        expect(isEligibleTeamFeePayer({ team, recipient, uid: 'parent_1' })).toBe(true);
        expect(isEligibleTeamFeePayer({ team, recipient, uid: 'parent_2', user: { parentPlayerKeys: ['team_123::player_1'] } })).toBe(true);
        expect(isEligibleTeamFeePayer({ team, recipient, uid: 'fan_1', email: 'fan@example.com' })).toBe(false);
        expect(isEligibleTeamFeePayer({ team, recipient, uid: 'other_parent', user: { parentTeamIds: ['team_123'] } })).toBe(false);
    });

    it('builds parent-dashboard return URLs and safe Stripe metadata', () => {
        const input = { teamId: 'team_123', batchId: 'batch_456', recipientId: 'player_789' };

        expect(buildTeamFeeCheckoutUrls('https://allplays.example/', input)).toEqual({
            successUrl: 'https://allplays.example/parent-dashboard.html?feePayment=1&teamId=team_123&batchId=batch_456&recipientId=player_789&checkout=success',
            cancelUrl: 'https://allplays.example/parent-dashboard.html?feePayment=1&teamId=team_123&batchId=batch_456&recipientId=player_789&checkout=cancelled'
        });
        expect(buildTeamFeeCheckoutMetadata({ ...input, payerUid: 'user_123' })).toEqual({
            product: 'team_fee',
            teamId: 'team_123',
            batchId: 'batch_456',
            recipientId: 'player_789',
            payerUid: 'user_123'
        });
        expect(buildTeamFeeCheckoutMetadata({
            ...input,
            payerUid: 'user_123',
            checkoutAttemptToken: 'tok_1234567890abcdef',
            checkoutAmountCents: 7500
        })).toEqual({
            product: 'team_fee',
            teamId: 'team_123',
            batchId: 'batch_456',
            recipientId: 'player_789',
            payerUid: 'user_123',
            checkoutAttemptToken: 'tok_1234567890abcdef',
            checkoutAmountCents: '7500'
        });
    });

    it('reuses only currently open checkout sessions for the same amount', () => {
        const recipient = {
            checkoutUrl: 'https://checkout.stripe.test/session',
            stripeCheckoutSessionId: 'cs_123',
            checkoutAttemptToken: 'tok_1234567890abcdef',
            checkoutStatus: 'open',
            checkoutAmountCents: 7500
        };

        expect(canReuseTeamFeeCheckoutSession(recipient, 7500)).toBe(true);
        expect(canReuseTeamFeeCheckoutSession({ ...recipient, checkoutStatus: 'payment_failed' }, 7500)).toBe(false);
        expect(canReuseTeamFeeCheckoutSession({ ...recipient, checkoutStatus: 'expired' }, 7500)).toBe(false);
        expect(canReuseTeamFeeCheckoutSession({ ...recipient, checkoutAmountCents: 8000 }, 7500)).toBe(false);
        expect(canReuseTeamFeeCheckoutSession({ ...recipient, checkoutAttemptToken: '' }, 7500)).toBe(false);
    });

    it('rejects stale team fee checkout sessions when session, token, or balance drifted', () => {
        const recipient = {
            stripeCheckoutSessionId: 'cs_current',
            checkoutAttemptToken: 'tok_current_123456',
            checkoutAmountCents: 7500,
            amountDueCents: 7500,
            paidAmountCents: 0
        };
        const session = {
            id: 'cs_current',
            amount_total: 7500,
            metadata: {
                checkoutAttemptToken: 'tok_current_123456'
            }
        };
        const legacyRecipient = {
            stripeCheckoutSessionId: 'cs_legacy',
            checkoutAmountCents: 7500,
            amountDueCents: 7500,
            paidAmountCents: 0
        };
        const legacySession = {
            id: 'cs_legacy',
            metadata: {}
        };

        expect(shouldApplyTeamFeeCheckoutSession({ recipient, session })).toBe(true);
        expect(getTeamFeeCheckoutGuardFailure({ recipient, session })).toBe('');
        expect(getTeamFeeCheckoutGuardFailure({ recipient, session: { ...session, id: 'cs_old' } })).toBe('checkout_session_mismatch');
        expect(getTeamFeeCheckoutGuardFailure({ recipient, session: { ...session, metadata: { checkoutAttemptToken: 'tok_old_1234567890' } } })).toBe('checkout_attempt_mismatch');
        expect(getTeamFeeCheckoutGuardFailure({ recipient, session: { ...session, amount_total: 7000 } })).toBe('checkout_amount_mismatch');
        expect(getTeamFeeCheckoutGuardFailure({ recipient: { ...recipient, amountDueCents: 9000 }, session })).toBe('balance_mismatch');
        expect(shouldApplyTeamFeeCheckoutSession({ recipient: legacyRecipient, session: legacySession })).toBe(true);
        expect(getTeamFeeCheckoutGuardFailure({ recipient: legacyRecipient, session: legacySession })).toBe('');
        expect(getTeamFeeCheckoutGuardFailure({ recipient: legacyRecipient, session: { ...legacySession, metadata: { checkoutAttemptToken: 'tok_new_1234567890' } } })).toBe('checkout_attempt_mismatch');
    });

    it('marks paid immediate and async team fee checkout sessions as paid', () => {
        const paidSession = {
            payment_status: 'paid',
            metadata: {
                product: 'team_fee',
                teamId: 'team_123',
                batchId: 'batch_456',
                recipientId: 'player_789'
            }
        };

        expect(shouldMarkTeamFeePaidFromEvent({ type: 'checkout.session.completed', data: { object: paidSession } })).toBe(true);
        expect(shouldMarkTeamFeePaidFromEvent({
            type: 'checkout.session.async_payment_succeeded',
            data: { object: { ...paidSession, payment_status: 'unpaid' } }
        })).toBe(true);
        expect(shouldMarkTeamFeePaidFromEvent({
            type: 'checkout.session.completed',
            data: { object: { ...paidSession, payment_status: 'unpaid' } }
        })).toBe(false);
        expect(shouldMarkTeamFeePaidFromEvent({ type: 'checkout.session.expired', data: { object: paidSession } })).toBe(false);
        expect(shouldRecordTeamFeeCheckoutNotPaidFromEvent({ type: 'checkout.session.expired', data: { object: paidSession } })).toBe(true);
        expect(shouldRecordTeamFeeCheckoutNotPaidFromEvent({ type: 'checkout.session.async_payment_failed', data: { object: paidSession } })).toBe(true);
    });

    it('uses immutable Stripe or matching checkout amounts for fee payment accounting', () => {
        expect(getTeamFeeStripePaidAmountCents({
            session: { id: 'cs_123', amount_total: 10000 }
        })).toBe(10000);
        expect(getTeamFeeStripePaidAmountCents({
            recipient: { stripeCheckoutSessionId: 'cs_123', checkoutAmountCents: 9000 },
            session: { id: 'cs_123' }
        })).toBe(9000);
        expect(getTeamFeeStripePaidAmountCents({
            recipient: { stripeCheckoutSessionId: 'cs_other', checkoutAmountCents: 9000 },
            session: { id: 'cs_123' }
        })).toBe(0);
    });

    it('builds paid recipient updates with Stripe identifiers split into admin billing metadata', () => {
        const update = buildTeamFeePaidUpdate({
            recipient: { amountCents: 12500, paidAmountCents: 2500 },
            eventId: 'evt_123',
            receivedAt: 'now',
            session: {
                id: 'cs_123',
                payment_intent: 'pi_123',
                customer: 'cus_123',
                amount_total: 10000,
                currency: 'usd',
                customer_details: { email: 'parent@example.com' }
            }
        });

        expect(update).toMatchObject({
            status: 'paid',
            paidAmountCents: 12500,
            amountPaidCents: 12500,
            balanceDueCents: 0,
            checkoutStatus: 'paid',
            checkoutAttemptToken: null,
            paymentProvider: 'stripe',
            stripeCheckoutSessionId: null,
            stripePaymentAmountCents: 10000,
            hasAdminBilling: true,
        });
        expect(update.receiptMetadata).toEqual({
            provider: 'stripe',
            amountPaidCents: 10000,
            totalPaidCents: 12500,
            balanceDueCents: 0,
            currency: 'usd'
        });
        expect(update.adminBilling).toEqual({
            type: 'stripe_checkout_paid',
            provider: 'stripe',
            stripeCheckoutSessionId: 'cs_123',
            stripePaymentIntentId: 'pi_123',
            stripeCustomerId: 'cus_123',
            receiptEmail: 'parent@example.com',
            stripeEventId: 'evt_123',
            amountPaidCents: 10000,
            totalPaidCents: 12500,
            balanceDueCents: 0,
            currency: 'usd',
            paidAt: 'now',
            updatedAt: 'now'
        });
        expect(update).not.toHaveProperty('stripePaymentIntentId');
        expect(update).not.toHaveProperty('stripeCustomerId');
        expect(update).not.toHaveProperty('stripeEventId');
        expect(update).not.toHaveProperty('paymentMethod');
        expect(update.receiptMetadata).not.toHaveProperty('card');
        expect(update.receiptMetadata).not.toHaveProperty('receiptEmail');
    });

    it('normalizes refund input and computes refundable cents', () => {
        expect(normalizeTeamFeeRefundInput({
            teamId: ' team_123 ',
            batchId: ' batch_456 ',
            recipientId: ' recipient_789 ',
            amount: '12.34',
            reason: ' duplicate ',
            refundRequestId: ' refund-123 '
        })).toEqual({
            teamId: 'team_123',
            batchId: 'batch_456',
            recipientId: 'recipient_789',
            amountCents: 1234,
            reason: 'duplicate',
            refundRequestId: 'refund-123'
        });

        const recipient = {
            paidAmountCents: 6500,
            paymentLedger: [
                { type: 'stripe_refund', refundAmountCents: 2500, status: 'succeeded' },
                { type: 'stripe_refund', amountCents: 1000, status: 'pending' },
                { type: 'stripe_refund', refundAmountCents: 500, status: 'failed' }
            ]
        };
        expect(getTeamFeeRefundedCents(recipient)).toBe(3500);
        expect(getTeamFeeRefundableCents(recipient)).toBe(6500);
        expect(getTeamFeeRefundableCents({
            paidAmountCents: 8000,
            refundedAmountCents: 2000
        })).toBe(8000);
    });

    it('resolves private Stripe payment refs from admin billing metadata', () => {
        expect(getTeamFeeStripePaymentRefs({
            adminBilling: {
                stripePaymentIntentId: 'pi_private',
                stripeChargeId: 'ch_private'
            }
        })).toEqual({
            paymentIntentId: 'pi_private',
            chargeId: 'ch_private'
        });
        expect(getTeamFeeStripePaymentRefs({}, [{
            stripePaymentIntentId: 'pi_from_entry'
        }])).toEqual({
            paymentIntentId: 'pi_from_entry',
            chargeId: ''
        });
    });

    it('builds Stripe refund ledger updates without over-crediting balances', () => {
        const update = buildTeamFeeStripeRefundUpdate({
            recipient: {
                amountCents: 12500,
                paidAmountCents: 12500,
                refundedAmountCents: 2500,
                adminBilling: {
                    stripePaymentIntentId: 'pi_123',
                    stripeChargeId: 'ch_123'
                }
            },
            refund: {
                id: 're_123',
                status: 'succeeded'
            },
            amountCents: 5000,
            actorId: 'admin_1',
            reason: 'Family requested refund',
            refundedAt: 'server-now',
            ledgerRefundedAt: 'ledger-now'
        });

        expect(update).toMatchObject({
            status: 'partial',
            paidAmountCents: 7500,
            amountPaidCents: 7500,
            balanceDueCents: 5000,
            refundedAmountCents: 7500,
            amountRefundedCents: 7500,
            checkoutStatus: 'stale',
            checkoutAttemptToken: null,
            stripeCheckoutSessionId: null,
            paymentProvider: 'stripe',
            hasAdminBilling: true,
            stripeLastRefundStatus: 'succeeded'
        });
        expect(update.ledgerEntries).toEqual([{
            type: 'stripe_refund',
            amountCents: 5000,
            refundAmountCents: 5000,
            status: 'succeeded',
            refundedAt: 'ledger-now'
        }]);
        expect(update.adminBilling).toEqual({
            type: 'stripe_refund',
            provider: 'stripe',
            stripeRefundId: 're_123',
            stripePaymentIntentId: 'pi_123',
            stripeChargeId: 'ch_123',
            refundAmountCents: 5000,
            status: 'succeeded',
            reason: 'Family requested refund',
            refundedBy: 'admin_1',
            refundedAt: 'ledger-now',
            updatedAt: 'server-now'
        });
        expect(update).not.toHaveProperty('stripeLastRefundId');
        expect(update.ledgerEntries[0]).not.toHaveProperty('stripeRefundId');
        expect(update.ledgerEntries[0]).not.toHaveProperty('stripePaymentIntentId');
        expect(update.ledgerEntries[0]).not.toHaveProperty('stripeChargeId');
        expect(update.ledgerEntries[0]).not.toHaveProperty('reason');
        expect(update.ledgerEntries[0]).not.toHaveProperty('refundedBy');
    });

    it('builds typed admin billing metadata for private fee reconciliation fields', () => {
        expect(buildTeamFeeAdminBillingMetadata({
            type: 'stripe_refund',
            data: {
                stripeRefundId: 're_123',
                reason: 'Duplicate charge'
            }
        })).toEqual({
            type: 'stripe_refund',
            provider: 'stripe',
            stripeRefundId: 're_123',
            reason: 'Duplicate charge'
        });
    });

    it('guards Stripe refund callable idempotency and recording consistency', () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

        expect(source).toContain("recipientRef.collection('refundIntents').doc(refundRequestId)");
        expect(source).toContain('idempotencyKey: buildTeamFeeRefundIdempotencyKey(input, refundRequestId)');
        expect(source).toContain('fetchTeamFeePaymentAdminBilling(recipientRef)');
        expect(source).toContain('getTeamFeeStripePaymentRefs(recipient, paymentAdminBilling)');
        expect(source).toContain("buildTeamFeeAdminBillingRef(recipientRef, 'latest')");
        expect(source).toContain('const actualRefundAmount = Math.round(Number(refund.amount || 0));');
        expect(source).toContain("stripeRefundStatus !== 'succeeded'");
        expect(source).toContain('const ledgerRefundedAt = admin.firestore.Timestamp.now();');
        expect(source).toContain('hasStripeRefundLedgerEntry(latestRecipient, refund.id)');
    });

    it('guards team fee webhook processing behind the current checkout attempt', () => {
        const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

        expect(functionsSource).toContain('checkoutAttemptToken');
        expect(functionsSource).toContain('checkoutAmountCents: amountCents');
        expect(functionsSource).toContain('shouldApplyTeamFeeCheckoutSession({ recipient, session })');
        expect(functionsSource).toContain('getTeamFeeCheckoutGuardFailure({ recipient, session })');
        expect(functionsSource).toContain("ignoredReason");
        expect(functionsSource).toContain("recipientRef.collection('adminBilling').doc");
        expect(dbSource).toContain("updatePayload.checkoutStatus = 'stale'");
        expect(dbSource).toContain('updatePayload.checkoutAttemptToken = deleteField()');
        expect(dbSource).toContain('updatePayload.stripeCheckoutSessionId = deleteField()');
    });

    it('does not mark the recipient fully paid when the balance grew after checkout creation', () => {
        const update = buildTeamFeePaidUpdate({
            recipient: { amountCents: 15000, paidAmountCents: 2500 },
            eventId: 'evt_456',
            receivedAt: 'now',
            session: {
                id: 'cs_456',
                amount_total: 10000,
                currency: 'usd'
            }
        });

        expect(update).toMatchObject({
            status: 'partial',
            paidAmountCents: 12500,
            amountPaidCents: 12500,
            balanceDueCents: 2500,
            checkoutStatus: 'paid',
            stripePaymentAmountCents: 10000
        });
        expect(update.receiptMetadata).toMatchObject({
            amountPaidCents: 10000,
            totalPaidCents: 12500,
            balanceDueCents: 2500
        });
    });
});
