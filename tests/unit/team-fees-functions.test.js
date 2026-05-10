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
    shouldMarkTeamFeePaidFromEvent,
    shouldRecordTeamFeeCheckoutNotPaidFromEvent,
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

    it('marks only paid completed team fee checkout sessions as paid', () => {
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
            type: 'checkout.session.completed',
            data: { object: { ...paidSession, payment_status: 'unpaid' } }
        })).toBe(false);
        expect(shouldMarkTeamFeePaidFromEvent({ type: 'checkout.session.expired', data: { object: paidSession } })).toBe(false);
        expect(shouldRecordTeamFeeCheckoutNotPaidFromEvent({ type: 'checkout.session.expired', data: { object: paidSession } })).toBe(true);
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
            stripeEventId: 'evt_123'
        });
        expect(update.receiptMetadata).toEqual({
            provider: 'stripe',
            checkoutSessionId: 'cs_123',
            paymentIntentId: 'pi_123',
            amountPaidCents: 12500,
            currency: 'usd',
            receiptEmail: 'parent@example.com',
            eventId: 'evt_123'
        });
        expect(update).not.toHaveProperty('paymentMethod');
        expect(update.receiptMetadata).not.toHaveProperty('card');
    });
});
