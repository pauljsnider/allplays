import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    isLegacyStripeRegistrationCandidate,
    isLegacyStripeTeamFeeCandidate,
    isTeamPassEntitlementAuthorityCandidate,
    buildPaymentAuthorityRolloutBlocker
} = require('../../functions/payment-authority-rollout-core.cjs');

describe('Stripe payment-authority rollout gate', () => {
    it('selects only records carrying Stripe payment evidence', () => {
        expect(isLegacyStripeRegistrationCandidate({ paymentProvider: 'stripe', paymentStatus: 'paid' })).toBe(true);
        expect(isLegacyStripeRegistrationCandidate({ lastPaidStripeChargeId: 'ch_123' })).toBe(true);
        expect(isLegacyStripeRegistrationCandidate({ paymentStatus: 'paid' })).toBe(false);
        expect(isLegacyStripeTeamFeeCandidate({ stripeGrossPaidAmountCents: 2500 })).toBe(true);
        expect(isLegacyStripeTeamFeeCandidate({ status: 'paid', paidAmountCents: 2500 })).toBe(false);
        expect(isTeamPassEntitlementAuthorityCandidate({ tier: 'team-pass', status: 'active' })).toBe(true);
        expect(isTeamPassEntitlementAuthorityCandidate({ tier: 'team-pass', status: 'inactive' })).toBe(false);
    });

    it('emits stable blockers only when durable authority is absent', () => {
        expect(buildPaymentAuthorityRolloutBlocker({
            product: 'registration', path: 'teams/t/registrationForms/f/registrations/r', hasAuthorityLedger: false
        })).toEqual({
            product: 'registration',
            path: 'teams/t/registrationForms/f/registrations/r',
            reason: 'paid_stripe_record_missing_charge_ledger'
        });
        expect(buildPaymentAuthorityRolloutBlocker({
            product: 'team_pass', path: 'teams/t/entitlements/2026_team-pass', hasAuthorityLedger: false
        })?.reason).toBe('active_entitlement_missing_checkout_attempt');
        expect(buildPaymentAuthorityRolloutBlocker({
            product: 'team_fee', path: 'teams/t/feeBatches/b/feeRecipients/r', hasAuthorityLedger: true
        })).toBeNull();
    });

    it('keeps the callable dry-run-first and requires an explicit empty assertion', () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        expect(source).toContain('exports.auditStripePaymentAuthorityRollout');
        expect(source).toContain("data?.confirmation !== 'assert_no_legacy_stripe_payment_authority_v1'");
        expect(source).toContain("throw new functions.https.HttpsError('failed-precondition', 'Payment authority rollout is blocked");
        expect(source).toContain("firestore.collection('paymentAuthorityRolloutAudits').doc().set");
        expect(source).not.toContain('purgeStripePaymentAuthority');
    });
});
