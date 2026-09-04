import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const teamFeeCoreSource = readFileSync(new URL('../../functions/team-fees-core.cjs', import.meta.url), 'utf8');
const teamFeesPageSource = readFileSync(new URL('../../apps/app/src/pages/TeamFees.tsx', import.meta.url), 'utf8');
const teamFeesServiceSource = readFileSync(new URL('../../apps/app/src/lib/teamFeesService.ts', import.meta.url), 'utf8');
const agentGuidance = readFileSync(new URL('../../AGENTS.md', import.meta.url), 'utf8');

function exportBlock(name, nextName) {
    const start = functionsSource.indexOf(`exports.${name} =`);
    const end = functionsSource.indexOf(`exports.${nextName} =`, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return functionsSource.slice(start, end);
}

describe('Stripe Checkout durability contract', () => {
    it('keeps enabled checkout creation idempotent and validates provider destinations', () => {
        const teamFee = exportBlock('createStripeTeamFeeCheckout', 'refundStripeTeamFeePayment');
        const registration = exportBlock('createStripeRegistrationCheckout', 'cancelStripeRegistrationCheckout');

        expect(teamFee).toContain('stripe.checkout.sessions.create(checkoutCreationRequest.stripeParams');
        expect(teamFee).toContain('idempotencyKey: checkoutCreationRequest.idempotencyKey');
        expect(registration).toContain('stripe.checkout.sessions.create(checkoutCreationRequest.stripeParams');
        expect(registration).toContain('idempotencyKey: checkoutCreationRequest.idempotencyKey');
        expect(teamFee).toContain('getNewTeamFeeCheckoutSessionFailure');
        expect(teamFeeCoreSource).toContain('function getNewTeamFeeCheckoutSessionFailure');
        expect(teamFeeCoreSource).toContain('isCanonicalStripeCheckoutUrl(session.url)');
        expect(registration).toContain('isCanonicalStripeCheckoutUrl');
    });

    it('keeps the deployed Team Pass callable as an unconditional rejection', () => {
        const teamPass = exportBlock('createStripeTeamPassCheckout', 'createStripeTeamFeeCheckout');

        expect(teamPass).toContain("'Team Pass sales are not available.'");
        expect(teamPass).toContain("'failed-precondition'");
        expect(teamPass).not.toContain('assertPaymentsEnabled');
        expect(teamPass).not.toContain('context.auth');
        expect(teamPass).not.toContain('firestore');
        expect(teamPass).not.toContain('stripe.checkout.sessions.create');
    });

    it('keeps legacy Team Pass reconciliation private instead of deploying it as a callable', () => {
        const teamPass = exportBlock('createStripeTeamPassCheckout', 'createStripeTeamFeeCheckout');

        expect(functionsSource).toContain('async function createStripeTeamPassCheckoutLegacyForTest');
        expect(functionsSource).toContain('createStripeTeamPassCheckoutLegacyForTest,');
        expect(teamPass).not.toContain('createStripeTeamPassCheckoutLegacyForTest(');
    });

    it('never shares a manager-owned team-fee provider session with a family', () => {
        expect(teamFeesPageSource).not.toContain('initiateStaffTeamFeeCheckout');
        expect(teamFeesPageSource).not.toContain('Share the public Stripe checkout URL');
        expect(teamFeesPageSource).toContain('buildTeamFeeFamilyPaymentUrl');
        expect(teamFeesServiceSource).toContain("appendAppRouteParams('/parent-tools/fees'");
        expect(teamFeesServiceSource).toContain("buildAppUrl('/auth', { next: nextRoute }");
        expect(agentGuidance).toContain('must never create a payer-bound provider session and then copy/share that URL');
    });

    it('reserves team-fee creation before Stripe and compensates persistence failure', () => {
        const teamFee = exportBlock('createStripeTeamFeeCheckout', 'refundStripeTeamFeePayment');

        expect(teamFee.indexOf('reserveTeamFeeCheckoutCreation')).toBeLessThan(
            teamFee.indexOf('stripe.checkout.sessions.create(checkoutCreationRequest.stripeParams')
        );
        expect(teamFee).toContain("expireStripeCheckoutSessionForRollback(stripe, session, 'team-fee-persistence')");
        expect(teamFee).toContain('clearTeamFeeCheckoutCreationReservation');
    });

    it('persists and reuses the exact team-fee Stripe request across uncertain retries', () => {
        const teamFee = exportBlock('createStripeTeamFeeCheckout', 'refundStripeTeamFeePayment');

        expect(functionsSource).toContain('checkoutCreationRequest: existingRequest');
        expect(functionsSource).toContain('checkoutCreationRequest,');
        expect(functionsSource).toContain('isReusableTeamFeeCheckoutCreationRequest');
        expect(teamFee).toContain('isUncertainStripeCheckoutCreationError(error)');
        expect(teamFee).toContain('checkoutCreationRequest: admin.firestore.FieldValue.delete()');
    });

    it('compensates registration persistence failure after Stripe succeeds', () => {
        const registration = exportBlock('createStripeRegistrationCheckout', 'cancelStripeRegistrationCheckout');

        expect(registration).toContain("expireStripeCheckoutSessionForRollback(stripe, session, 'registration-persistence')");
        expect(registration).toContain('clearRegistrationCheckoutCreationReservation');
        expect(registration).toContain('releaseRegistrationCheckoutCapacity');
        expect(registration).toContain('getRegistrationCheckoutPersistenceState');
        expect(registration).toContain("persistenceState === 'committed'");
    });

    it('persists and reuses the exact registration Stripe request across uncertain retries', () => {
        const registration = exportBlock('createStripeRegistrationCheckout', 'cancelStripeRegistrationCheckout');

        expect(functionsSource).toContain('checkoutCreationRequest: proposedCheckoutCreationRequest');
        expect(functionsSource).toContain('isReusableRegistrationCheckoutCreationRequest');
        expect(registration).toContain('isUncertainStripeCheckoutCreationError(error)');
        expect(functionsSource).toContain('createRegistrationCheckoutCapability(idempotencyKey)');
        expect(functionsSource).toContain('function getRegistrationCheckoutCreationRequestCapability(request)');
        expect(registration).toContain('getRegistrationCheckoutCreationRequestCapability(checkoutCreationRequest)');
    });
});
