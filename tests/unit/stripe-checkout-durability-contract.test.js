import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const teamFeeCoreSource = readFileSync(new URL('../../functions/team-fees-core.cjs', import.meta.url), 'utf8');

function exportBlock(name, nextName) {
    const start = functionsSource.indexOf(`exports.${name} =`);
    const end = functionsSource.indexOf(`exports.${nextName} =`, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return functionsSource.slice(start, end);
}

describe('Stripe Checkout durability contract', () => {
    it('keeps every checkout creation call idempotent and validates provider destinations', () => {
        const teamPass = exportBlock('createStripeTeamPassCheckout', 'createStripeTeamFeeCheckout');
        const teamFee = exportBlock('createStripeTeamFeeCheckout', 'refundStripeTeamFeePayment');
        const registration = exportBlock('createStripeRegistrationCheckout', 'cancelStripeRegistrationCheckout');

        for (const block of [teamPass, teamFee, registration]) {
            expect(block).toContain('stripe.checkout.sessions.create({');
            expect(block).toContain('idempotencyKey:');
        }
        expect(teamPass).toContain('isCanonicalStripeCheckoutUrl');
        expect(teamFee).toContain('getNewTeamFeeCheckoutSessionFailure');
        expect(teamFeeCoreSource).toContain('function getNewTeamFeeCheckoutSessionFailure');
        expect(teamFeeCoreSource).toContain('isCanonicalStripeCheckoutUrl(session.url)');
        expect(registration).toContain('isCanonicalStripeCheckoutUrl');
    });

    it('reserves team-fee creation before Stripe and compensates persistence failure', () => {
        const teamFee = exportBlock('createStripeTeamFeeCheckout', 'refundStripeTeamFeePayment');

        expect(teamFee.indexOf('reserveTeamFeeCheckoutCreation')).toBeLessThan(
            teamFee.indexOf('stripe.checkout.sessions.create({')
        );
        expect(teamFee).toContain("expireStripeCheckoutSessionForRollback(stripe, session, 'team-fee-persistence')");
        expect(teamFee).toContain('clearTeamFeeCheckoutCreationReservation');
    });

    it('compensates registration persistence failure after Stripe succeeds', () => {
        const registration = exportBlock('createStripeRegistrationCheckout', 'cancelStripeRegistrationCheckout');

        expect(registration).toContain("expireStripeCheckoutSessionForRollback(stripe, session, 'registration-persistence')");
        expect(registration).toContain('clearRegistrationCheckoutCreationReservation');
        expect(registration).toContain('releaseRegistrationCheckoutCapacity');
    });
});
