import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    isLegacyStripeRegistrationCandidate,
    isLegacyStripeTeamFeeCandidate,
    isTeamPassEntitlementAuthorityCandidate,
    buildPaymentAuthorityRolloutBlocker,
    inspectStripeChargeLedgerCoverage,
    inspectTeamPassAttemptAuthority
} = require('../../functions/payment-authority-rollout-core.cjs');

describe('Stripe payment-authority rollout gate', () => {
    it('selects only records carrying Stripe payment evidence', () => {
        expect(isLegacyStripeRegistrationCandidate({ paymentProvider: 'stripe', paymentStatus: 'paid' })).toBe(true);
        expect(isLegacyStripeRegistrationCandidate({ lastPaidStripeChargeId: 'ch_123' })).toBe(true);
        expect(isLegacyStripeRegistrationCandidate({ checkoutCreationReservationId: 'reservation_123' })).toBe(true);
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

    it('requires exact scope, identifiers, aggregates, and installment count for every charge ledger', () => {
        const record = {
            id: 'reg-a', teamId: 'team-a', formId: 'form-a',
            stripeGrossPaidAmountCents: 5000, stripeRefundedAmountCents: 0,
            stripeDisputeLostAmountCents: 0, paymentPlan: { id: 'installments', paidInstallmentCount: 1 },
            lastPaidStripeChargeId: 'ch_a'
        };
        const ledger = {
            type: 'stripe_charge', provider: 'stripe', product: 'registration',
            teamId: 'team-a', formId: 'form-a', registrationId: 'reg-a',
            stripeCheckoutSessionId: 'cs_a', stripePaymentIntentId: 'pi_a', stripeChargeId: 'ch_a',
            amountPaidCents: 5000, refundedAmountCents: 0, disputeLostAmountCents: 0,
            currency: 'usd', livemode: false
        };
        expect(inspectStripeChargeLedgerCoverage({ product: 'registration', record, ledgers: [ledger] })).toBe('');
        expect(inspectStripeChargeLedgerCoverage({
            product: 'registration', record, ledgers: [{ ...ledger, registrationId: 'victim' }]
        })).toBe('stripe_charge_ledger_invalid');
        expect(inspectStripeChargeLedgerCoverage({
            product: 'registration', record: { ...record, stripeGrossPaidAmountCents: 10000 }, ledgers: [ledger]
        })).toBe('stripe_charge_ledger_gross_mismatch');
        expect(inspectStripeChargeLedgerCoverage({
            product: 'registration', record: { ...record, paymentPlan: { id: 'installments', paidInstallmentCount: 2 } }, ledgers: [ledger]
        })).toBe('stripe_charge_ledger_count_mismatch');
        const repaymentLedger = {
            ...ledger, stripeCheckoutSessionId: 'cs_repay', stripePaymentIntentId: 'pi_repay',
            stripeChargeId: 'ch_repay', amountPaidCents: 2000, paymentPurpose: 'reversal_repayment'
        };
        expect(inspectStripeChargeLedgerCoverage({
            product: 'registration',
            record: { ...record, stripeGrossPaidAmountCents: 7000, lastPaidStripeChargeId: 'ch_repay' },
            ledgers: [ledger, repaymentLedger]
        })).toBe('');
    });

    it('requires complete Team Pass authority and a charge id for legacy attempts', () => {
        const attempt = {
            product: 'team_pass', teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
            checkoutStatus: 'paid', stripeCheckoutSessionId: 'cs_a', stripePaymentIntentId: 'pi_a',
            checkoutAmountCents: 4900, checkoutCurrency: 'usd', livemode: false,
            purchaserUid: 'owner-a', checkoutAttemptToken: 'legacy_1234567890abcdef', priceId: 'price_a',
            legacyPaymentAuthorityVersion: 1
        };
        expect(inspectTeamPassAttemptAuthority({
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass', attempt
        })).toBe('active_entitlement_invalid_checkout_attempt');
        expect(inspectTeamPassAttemptAuthority({
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass', attempt: { ...attempt, stripeChargeId: 'ch_a' }
        })).toBe('');
        expect(inspectTeamPassAttemptAuthority({
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
            attempt: { ...attempt, legacyPaymentAuthorityVersion: undefined, stripePaymentAuthorityVersion: 2 }
        })).toBe('');
        expect(inspectTeamPassAttemptAuthority({
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
            attempt: { ...attempt, legacyPaymentAuthorityVersion: 7, stripeChargeId: 'ch_a' }
        })).toBe('active_entitlement_invalid_checkout_attempt');
        expect(inspectTeamPassAttemptAuthority({
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
            attempt: {
                ...attempt, legacyPaymentAuthorityVersion: undefined, stripePaymentAuthorityVersion: 2,
                purchaserUid: ''
            }
        })).toBe('active_entitlement_invalid_checkout_attempt');
        for (const checkoutStatus of ['disputed', 'refunded', 'dispute_lost']) {
            expect(inspectTeamPassAttemptAuthority({
                teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
                attempt: { ...attempt, stripeChargeId: 'ch_a', checkoutStatus }
            })).toBe('active_entitlement_invalid_checkout_attempt');
        }
        for (const reversalState of [
            { chargeAmountCents: 4900, refundedAmountCents: 100, disputeStatus: 'none' },
            { chargeAmountCents: 4900, refundedAmountCents: 0, disputeStatus: 'open' },
            { chargeAmountCents: 4900, refundedAmountCents: 0, disputeStatus: 'lost' }
        ]) {
            expect(inspectTeamPassAttemptAuthority({
                teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
                attempt: { ...attempt, stripeChargeId: 'ch_a', reversalState }
            })).toBe('active_entitlement_invalid_checkout_attempt');
        }
        expect(inspectTeamPassAttemptAuthority({
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
            attempt: { ...attempt, stripeChargeId: 'ch_a', refundedAmountCents: 100 }
        })).toBe('active_entitlement_invalid_checkout_attempt');
        expect(inspectTeamPassAttemptAuthority({
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
            attempt: { ...attempt, stripeChargeId: 'ch_a', disputeStatus: 'open' }
        })).toBe('active_entitlement_invalid_checkout_attempt');
        expect(inspectTeamPassAttemptAuthority({
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
            attempt: {
                ...attempt, stripeChargeId: 'ch_a', disputeStatus: 'lost',
                reversalState: { chargeAmountCents: 4900, refundedAmountCents: 0, disputeStatus: 'none' }
            }
        })).toBe('active_entitlement_invalid_checkout_attempt');
        expect(inspectTeamPassAttemptAuthority({
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
            attempt: { ...attempt, stripeChargeId: 'ch_a', disputeLostAmountCents: 4900 }
        })).toBe('active_entitlement_invalid_checkout_attempt');
        expect(inspectTeamPassAttemptAuthority({
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
            attempt: { ...attempt, stripeChargeId: 'ch_a', disputeId: 'dp_unresolved' }
        })).toBe('active_entitlement_invalid_checkout_attempt');
        expect(inspectTeamPassAttemptAuthority({
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
            attempt: { ...attempt, stripeChargeId: 'ch_a', stripeFinancialStatus: 'disputed' }
        })).toBe('active_entitlement_invalid_checkout_attempt');
        expect(inspectTeamPassAttemptAuthority({
            teamId: 'team-a', seasonId: '2026', tier: 'team-pass',
            attempt: {
                ...attempt, stripeChargeId: 'ch_a', refundedAmountCents: 0, disputeId: 'dp_won',
                reversalState: { chargeAmountCents: 4900, refundedAmountCents: 0, disputeStatus: 'won' }
            }
        })).toBe('');
    });

    it('rejects Team Fee ledgers that violate runtime conservation, status, or parent aggregates', () => {
        const record = {
            id: 'fee-a', teamId: 'team-a', batchId: 'batch-a',
            stripeGrossPaidAmountCents: 5000, stripeRefundedAmountCents: 0,
            stripeDisputeLostAmountCents: 0, stripeRefundableAmountCents: 5000,
            stripeFinancialStatus: 'paid'
        };
        const ledger = {
            type: 'stripe_charge', provider: 'stripe', product: 'team_fee',
            teamId: 'team-a', batchId: 'batch-a', recipientId: 'fee-a',
            stripeCheckoutSessionId: 'cs_a', stripePaymentIntentId: 'pi_a', stripeChargeId: 'ch_a',
            amountPaidCents: 5000, refundedAmountCents: 0, disputeLostAmountCents: 0,
            refundableAmountCents: 5000, disputeStatus: 'none', currency: 'usd', livemode: false
        };
        expect(inspectStripeChargeLedgerCoverage({ product: 'team_fee', record, ledgers: [ledger] })).toBe('');
        expect(inspectStripeChargeLedgerCoverage({
            product: 'team_fee', record, ledgers: [{ ...ledger, refundableAmountCents: 4999 }]
        })).toBe('stripe_charge_ledger_invalid');
        expect(inspectStripeChargeLedgerCoverage({
            product: 'team_fee', record, ledgers: [{ ...ledger, disputeStatus: 'mystery' }]
        })).toBe('stripe_charge_ledger_invalid');
        expect(inspectStripeChargeLedgerCoverage({
            product: 'team_fee', record: { ...record, stripeRefundableAmountCents: undefined }, ledgers: [ledger]
        })).toBe('stripe_charge_ledger_aggregate_mismatch');
        expect(inspectStripeChargeLedgerCoverage({
            product: 'team_fee', record: { ...record, stripeFinancialStatus: 'refunded' }, ledgers: [ledger]
        })).toBe('stripe_charge_ledger_financial_status_mismatch');
    });

    it('keeps the callable dry-run-first and requires an explicit empty assertion', () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        expect(source).toContain('exports.auditStripePaymentAuthorityRollout');
        expect(source).toContain("data?.confirmation !== 'assert_no_legacy_stripe_payment_authority_v1'");
        expect(source).toContain("throw new functions.https.HttpsError('failed-precondition', 'Payment authority rollout is blocked");
        expect(source).toContain("firestore.collection('paymentAuthorityRolloutAudits').doc().set");
        expect(source).not.toContain('purgeStripePaymentAuthority');
    });

    it('guards every payment mutation callable with the server-owned rollout freeze', () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        const mutationCallables = [
            'createStripeRegistrationCheckout',
            'cancelStripeRegistrationCheckout',
            'createStripeTeamFeeCheckout',
            'expireStripeTeamFeeCheckout',
            'refundStripeTeamFeePayment',
            'createStripeTeamPassCheckout',
            'expireStripeTeamPassCheckout'
        ];
        for (const callable of mutationCallables) {
            const start = source.indexOf(`exports.${callable} =`);
            const end = source.indexOf('\nexports.', start + 1);
            expect(start, callable).toBeGreaterThanOrEqual(0);
            expect(source.slice(start, end < 0 ? source.length : end), callable)
                .toContain('await assertStripePaymentAuthorityMutationIsNotFrozen();');
        }
        expect(source.match(/await assertStripePaymentAuthorityMutationIsNotFrozen\(\);/g)).toHaveLength(7);
    });

    it('keeps rollout cleanup dry-run-first, exactly bound, and explicitly confirmed', () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        expect(source).toContain('exports.expireOpenStripePaymentAuthoritySessionsForRollout');
        expect(source).toContain('const dryRun = data?.dryRun !== false;');
        expect(source).toContain("data?.confirmation !== 'expire_open_legacy_stripe_checkout_sessions_v1'");
        expect(source).toContain('getStripePaymentAuthoritySessionBindingFailure(session, expectedLivemode)');
        expect(source).toContain('bindingFailureCount');
        expect(source).toContain('liveModeMatched');
        expect(source).toContain('testModeMatched');
    });

    it('documents a fail-closed frozen cutover and reopens only after the post-deploy assertion', () => {
        const runbook = readFileSync(new URL('../../docs/stripe-payment-authority-rollout.md', import.meta.url), 'utf8');
        for (const callable of [
            'createStripeRegistrationCheckout',
            'cancelStripeRegistrationCheckout',
            'createStripeTeamFeeCheckout',
            'expireStripeTeamFeeCheckout',
            'refundStripeTeamFeePayment',
            'createStripeTeamPassCheckout',
            'expireStripeTeamPassCheckout'
        ]) {
            expect(runbook).toContain(`\`${callable}\``);
        }
        expect(runbook).toContain('Save each full IAM policy, etag, and revision');
        expect(runbook).toContain('returns HTTP 403 before callable code runs');
        expect(runbook).toContain('webhook, audit, and cleanup endpoints remain invokable');
        expect(runbook).toContain('bindingFailureCount');
        expect(runbook).toContain('liveModeMatched');
        expect(runbook).toContain('testModeMatched');
        expect(runbook).toContain('require the same empty result twice');
        expect(runbook).toContain('Run the explicit empty assertion again after IAM restoration');
        expect(runbook).toContain('clear `paymentAuthorityRollout/control.frozen` as the final reopening step');
        expect(runbook).toContain('Do not call the ordering atomic.');
    });
});
