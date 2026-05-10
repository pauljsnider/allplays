import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    normalizeTeamFeeCheckoutInput,
    getTeamFeeBalanceCents,
    isTeamFeeCheckoutEligible,
    isEligibleTeamFeePayer,
    buildTeamFeeCheckoutUrls,
    buildTeamFeeCheckoutMetadata,
    canReuseTeamFeeCheckoutSession,
    shouldMarkTeamFeePaidFromEvent,
    shouldRecordTeamFeeCheckoutNotPaidFromEvent,
    getTeamFeeStripePaidAmountCents,
    buildTeamFeePaidUpdate
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

    it('computes current balance and rejects paid or canceled recipients', () => {
        expect(getTeamFeeBalanceCents({ amountCents: 12500, paidAmountCents: 2500 })).toBe(10000);
        expect(getTeamFeeBalanceCents({ balanceDueCents: 5000, paidAmountCents: 2500 })).toBe(5000);
        expect(isTeamFeeCheckoutEligible({ status: 'unpaid', amountCents: 12500 })).toBe(true);
        expect(isTeamFeeCheckoutEligible({ status: 'paid', amountCents: 12500 })).toBe(false);
        expect(isTeamFeeCheckoutEligible({ status: 'canceled', amountCents: 12500 })).toBe(false);
        expect(isTeamFeeCheckoutEligible({ status: 'unpaid', amountCents: 0 })).toBe(false);
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
    });

    it('reuses only currently open checkout sessions for the same amount', () => {
        const recipient = {
            checkoutUrl: 'https://checkout.stripe.test/session',
            stripeCheckoutSessionId: 'cs_123',
            checkoutStatus: 'open',
            checkoutAmountCents: 7500
        };

        expect(canReuseTeamFeeCheckoutSession(recipient, 7500)).toBe(true);
        expect(canReuseTeamFeeCheckoutSession({ ...recipient, checkoutStatus: 'payment_failed' }, 7500)).toBe(false);
        expect(canReuseTeamFeeCheckoutSession({ ...recipient, checkoutStatus: 'expired' }, 7500)).toBe(false);
        expect(canReuseTeamFeeCheckoutSession({ ...recipient, checkoutAmountCents: 8000 }, 7500)).toBe(false);
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

    it('builds paid recipient updates without raw payment method data', () => {
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
            paymentProvider: 'stripe',
            stripeCheckoutSessionId: 'cs_123',
            stripePaymentIntentId: 'pi_123',
            stripeCustomerId: 'cus_123',
            stripePaymentAmountCents: 10000,
            stripeEventId: 'evt_123'
        });
        expect(update.receiptMetadata).toEqual({
            provider: 'stripe',
            checkoutSessionId: 'cs_123',
            paymentIntentId: 'pi_123',
            amountPaidCents: 10000,
            totalPaidCents: 12500,
            balanceDueCents: 0,
            currency: 'usd',
            receiptEmail: 'parent@example.com',
            eventId: 'evt_123'
        });
        expect(update).not.toHaveProperty('paymentMethod');
        expect(update.receiptMetadata).not.toHaveProperty('card');
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
