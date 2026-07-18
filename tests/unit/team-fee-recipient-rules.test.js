import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    collectionGroup,
    deleteDoc,
    deleteField,
    doc,
    getDoc,
    getDocs,
    query,
    setDoc,
    updateDoc,
    where
} from 'firebase/firestore';
import { extractMatchBlock } from '../../scripts/validate-firebase-rules-ci.mjs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const collectionGroupBlock = extractMatchBlock(rules, 'match /{path=**}/feeRecipients/{recipientId} {');
const feeBatchesBlock = extractMatchBlock(rules, 'match /feeBatches/{batchId} {');
const nestedRecipientBlock = extractMatchBlock(feeBatchesBlock, 'match /feeRecipients/{recipientId} {');

describe('team fee recipient Firestore rules', () => {
    it('defines the feeRecipients collection-group rule exactly once', () => {
        // Regression guard: this rule was previously duplicated into two back-to-back
        // match blocks with equivalent (but not identical) logic, which made the ruleset
        // harder to audit. See tests/unit/firestore-rules-architecture-fixes.test.js.
        const occurrences = rules.split('match /{path=**}/feeRecipients/{recipientId}').length - 1;
        expect(occurrences).toBe(1);
    });

    it('passes teamId to the parent recipient helper for collection-group reads', () => {
        expect(rules).toContain('function isTeamFeeRecipientForCurrentParent(data, teamId)');
        expect(rules).not.toContain('isTeamFeeRecipientForCurrentParent(resource.data) ||');
        expect(rules).toContain('isTeamFeeRecipientForCurrentParent(resource.data, resource.data.teamId)');
    });

    it('keeps the feeRecipients collection-group rule read-only', () => {
        expect(collectionGroupBlock).toContain('allow read: if');
        expect(collectionGroupBlock).not.toMatch(/allow\s+(create|update|delete|write)\b/);
        expect(collectionGroupBlock).not.toContain('request.resource');
    });

    it('requires nested recipient payload identity to match the team and batch path', () => {
        expect(nestedRecipientBlock).toContain('request.resource.data.teamId == teamId');
        expect(nestedRecipientBlock).toContain('request.resource.data.batchId == batchId');
        expect(nestedRecipientBlock).toContain('resource.data.teamId == teamId');
        expect(nestedRecipientBlock).toContain('resource.data.batchId == batchId');
        expect(nestedRecipientBlock).toContain('hasNoPrivateTeamFeeBillingFields(request.resource.data)');
        expect(nestedRecipientBlock).toContain('hasNoIntroducedPrivateTeamFeeBillingFields()');
        expect(nestedRecipientBlock).toContain('!hasActiveTeamFeeStripeAuthority(resource.data)');
    });

    it('keeps Stripe authority server-only while allowing bounded offline billing records', () => {
        expect(rules).toContain('function hasNoPrivateTeamFeeBillingFields(data)');
        expect(rules).toContain('function hasNoIntroducedPrivateTeamFeeBillingFields()');
        expect(rules).toContain('function hasSettledTeamFeeStripeAuthority(data)');
        expect(rules).toContain("'stripePaymentIntentId'");
        expect(rules).toContain("'recordedBy'");
        expect(rules).toContain('hasNoPrivateTeamFeeBillingFields(request.resource.data)');
        expect(rules).toContain('hasNoIntroducedPrivateTeamFeeBillingFields()');
        expect(nestedRecipientBlock).toContain('!hasSettledTeamFeeStripeAuthority(resource.data)');
        expect(rules).toContain("request.resource.data.get('stripePaymentIntentId', null) == null");
        expect(rules).toContain("request.resource.data.get('checkoutPayerUid', null) == null");
        expect(rules).toContain("request.resource.data.get('stripePaymentAuthorityVersion', null) == null");
        expect(rules).toContain("!affectedKeys.hasAny([\n               'stripeGrossPaidAmountCents'");
        expect(rules).toContain("(billingId == 'latest' &&");
        expect(rules).toContain('match /adminBilling/{billingId} {');
        expect(rules).toContain('match /stripeCharges/{chargeId} {');
        expect(rules).toContain('function isSafeOfflineTeamFeeBilling(data, teamId, batchId, recipientId)');
        expect(rules).toContain('isSafeOfflineTeamFeeBilling(request.resource.data, teamId, batchId, recipientId)');
    });

    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('fee recipient rules engine coverage', () => {
        let testEnv;

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: `allplays-fee-recipient-rules-${Date.now()}`,
                firestore: { rules }
            });
        }, 30000);

        beforeEach(async () => {
            await testEnv.clearFirestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const firestore = context.firestore();
                await setDoc(doc(firestore, 'teams/team-a'), {
                    ownerId: 'owner-a',
                    adminEmails: ['admin-a@example.com']
                });
                await setDoc(doc(firestore, 'teams/team-b'), {
                    ownerId: 'owner-b',
                    adminEmails: ['admin-b@example.com']
                });
                await setDoc(doc(firestore, 'users/parent-a'), {
                    email: 'parent-a@example.com',
                    isAdmin: false,
                    parentTeamIds: ['team-a'],
                    parentPlayerKeys: ['team-a::player-a']
                });
            });
        });

        afterAll(async () => {
            await testEnv?.cleanup();
        });

        function authedFirestore(uid, email) {
            return testEnv.authenticatedContext(uid, { email }).firestore();
        }

        function recipientRef(firestore, teamId, batchId, recipientId) {
            return doc(firestore, `teams/${teamId}/feeBatches/${batchId}/feeRecipients/${recipientId}`);
        }

        function recipientPayload(teamId = 'team-a', batchId = 'batch-a') {
            return {
                teamId,
                batchId,
                parentUserId: 'parent-a',
                playerId: 'player-a',
                playerKey: 'team-a::player-a',
                status: 'unpaid',
                amountDueCents: 2500
            };
        }

        async function seedRecipient(path, data) {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), path), data);
            });
        }

        it('denies cross-team create, update, and delete even when embedded teamId names the attacker team', async () => {
            const attackerDb = authedFirestore('admin-b', 'admin-b@example.com');
            const targetRef = recipientRef(attackerDb, 'team-a', 'batch-a', 'cross-team');
            const attackerPayload = recipientPayload('team-b', 'batch-a');

            await assertFails(setDoc(targetRef, attackerPayload));

            await seedRecipient(
                'teams/team-a/feeBatches/batch-a/feeRecipients/cross-team',
                attackerPayload
            );
            await assertFails(updateDoc(targetRef, { status: 'paid' }));
            await assertFails(deleteDoc(targetRef));
        });

        it('allows same-team writes only while embedded teamId and batchId match the nested path', async () => {
            const ownerDb = authedFirestore('owner-a', 'owner-a@example.com');
            const validRef = recipientRef(ownerDb, 'team-a', 'batch-a', 'valid');
            const invalidBatchRef = recipientRef(ownerDb, 'team-a', 'batch-a', 'invalid-batch');

            await assertFails(setDoc(invalidBatchRef, recipientPayload('team-a', 'batch-b')));
            await assertSucceeds(setDoc(validRef, recipientPayload()));
            await assertFails(updateDoc(validRef, { batchId: 'batch-b' }));
            await assertSucceeds(updateDoc(validRef, { status: 'paid' }));
            await assertSucceeds(deleteDoc(validRef));
        });

        it('preserves scoped collection-group reads for linked parents and team admins', async () => {
            await seedRecipient(
                'teams/team-a/feeBatches/batch-a/feeRecipients/assigned-parent',
                recipientPayload()
            );

            const parentDb = authedFirestore('parent-a', 'parent-a@example.com');
            await assertSucceeds(getDocs(query(
                collectionGroup(parentDb, 'feeRecipients'),
                where('teamId', '==', 'team-a'),
                where('parentUserId', '==', 'parent-a')
            )));

            const adminDb = authedFirestore('admin-a', 'admin-a@example.com');
            await assertSucceeds(getDocs(query(
                collectionGroup(adminDb, 'feeRecipients'),
                where('teamId', '==', 'team-a')
            )));
        });

        it('denies forged Stripe authority and keeps server Stripe records unreadable to clients', async () => {
            const ownerDb = authedFirestore('owner-a', 'owner-a@example.com');
            const feeRef = recipientRef(ownerDb, 'team-a', 'batch-a', 'stripe-target');
            await assertSucceeds(setDoc(feeRef, recipientPayload('team-a', 'batch-a')));
            await assertFails(updateDoc(feeRef, { paymentProvider: 'stripe', stripeCheckoutSessionId: 'cs_forged' }));
            await assertFails(updateDoc(feeRef, {
                checkoutPayerUid: 'owner-a', stripePaymentAuthorityVersion: 2, checkoutReservedAtMs: Date.now()
            }));

            await seedRecipient('teams/team-a/feeBatches/batch-a/feeRecipients/stripe-target', {
                ...recipientPayload(),
                paymentProvider: 'stripe',
                hasAdminBilling: true
            });
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'teams/team-a/feeBatches/batch-a/feeRecipients/stripe-target/adminBilling/latest'), {
                    type: 'stripe_checkout_paid',
                    provider: 'stripe',
                    teamId: 'team-a', batchId: 'batch-a', recipientId: 'stripe-target',
                    stripeCheckoutSessionId: 'cs_server', stripePaymentIntentId: 'pi_server'
                });
            });

            const billingRef = doc(ownerDb, 'teams/team-a/feeBatches/batch-a/feeRecipients/stripe-target/adminBilling/latest');
            const chargeRef = doc(ownerDb, 'teams/team-a/feeBatches/batch-a/feeRecipients/stripe-target/stripeCharges/ch_server');
            await assertFails(getDoc(billingRef));
            await assertFails(updateDoc(billingRef, { stripePaymentIntentId: 'pi_attacker' }));
            await assertFails(getDoc(chargeRef));
            await assertFails(setDoc(chargeRef, { stripeChargeId: 'ch_attacker', refundableAmountCents: 2500 }));
            await assertFails(updateDoc(feeRef, { stripeRefundableAmountCents: 2500 }));
            await assertSucceeds(setDoc(billingRef, {
                type: 'offline_payment', teamId: 'team-a', batchId: 'batch-a', recipientId: 'stripe-target',
                amountPaidCents: 2500, note: 'Cash', recordedBy: 'owner-a', updatedAt: 'now'
            }));
            await assertSucceeds(getDoc(billingRef));
        });

        it('keeps settled Stripe financial aggregates immutable while allowing checkout cleanup', async () => {
            await seedRecipient('teams/team-a/feeBatches/batch-a/feeRecipients/settled-stripe', {
                ...recipientPayload(),
                paymentProvider: 'stripe',
                checkoutStatus: 'complete',
                checkoutAttemptToken: 'tok_settled_1234567890',
                checkoutUrl: 'https://checkout.stripe.test/settled',
                stripeCheckoutSessionId: 'cs_settled',
                stripeGrossPaidAmountCents: 2500,
                stripeRefundedAmountCents: 500,
                stripeRefundableAmountCents: 2000,
                stripeDisputeLostAmountCents: 0,
                stripeFinancialStatus: 'partially_refunded'
            });
            const ownerDb = authedFirestore('owner-a', 'owner-a@example.com');
            const feeRef = recipientRef(ownerDb, 'team-a', 'batch-a', 'settled-stripe');

            await assertFails(updateDoc(feeRef, {
                stripeGrossPaidAmountCents: deleteField(),
                stripeRefundedAmountCents: deleteField(),
                stripeRefundableAmountCents: deleteField(),
                stripeDisputeLostAmountCents: deleteField(),
                stripeFinancialStatus: deleteField()
            }));
            await assertFails(updateDoc(feeRef, { stripeFinancialStatus: null }));
            await assertFails(updateDoc(feeRef, { stripeRefundedAmountCents: 0 }));
            await assertFails(deleteDoc(feeRef));
            await assertSucceeds(updateDoc(feeRef, {
                checkoutStatus: 'stale',
                checkoutAttemptToken: deleteField(),
                checkoutUrl: deleteField(),
                stripeCheckoutSessionId: deleteField()
            }));
        });

        it('allows Stripe-to-offline billing migration only for the latest projection', async () => {
            const basePath = 'teams/team-a/feeBatches/batch-a/feeRecipients/billing-migration';
            await seedRecipient(basePath, {
                ...recipientPayload(),
                paymentProvider: 'stripe',
                hasAdminBilling: true
            });
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const firestore = context.firestore();
                const serverStripeBilling = {
                    type: 'stripe_checkout_paid', provider: 'stripe',
                    teamId: 'team-a', batchId: 'batch-a', recipientId: 'billing-migration',
                    stripeCheckoutSessionId: 'cs_server', stripePaymentIntentId: 'pi_server'
                };
                await setDoc(doc(firestore, `${basePath}/adminBilling/latest`), serverStripeBilling);
                await setDoc(doc(firestore, `${basePath}/adminBilling/evt_server_paid`), serverStripeBilling);
            });
            const ownerDb = authedFirestore('owner-a', 'owner-a@example.com');
            const safeOfflineBilling = {
                type: 'offline_payment', teamId: 'team-a', batchId: 'batch-a', recipientId: 'billing-migration',
                amountPaidCents: 2500, note: 'Cash', recordedBy: 'owner-a', updatedAt: 'now'
            };

            await assertSucceeds(setDoc(doc(ownerDb, `${basePath}/adminBilling/latest`), safeOfflineBilling));
            await assertFails(setDoc(doc(ownerDb, `${basePath}/adminBilling/evt_server_paid`), safeOfflineBilling));
        });

        it('blocks stale admin clients from mutating or deleting a recipient until server checkout authority is cleared', async () => {
            await seedRecipient('teams/team-a/feeBatches/batch-a/feeRecipients/active-checkout', {
                ...recipientPayload(),
                checkoutStatus: 'open',
                checkoutAttemptToken: 'tok_server_1234567890',
                stripeCheckoutSessionId: 'cs_server_active'
            });
            await seedRecipient('teams/team-a/feeBatches/batch-a/feeRecipients/cleared-checkout', {
                ...recipientPayload(),
                checkoutStatus: 'expired'
            });
            const ownerDb = authedFirestore('owner-a', 'owner-a@example.com');
            const activeRef = recipientRef(ownerDb, 'team-a', 'batch-a', 'active-checkout');
            const clearedRef = recipientRef(ownerDb, 'team-a', 'batch-a', 'cleared-checkout');

            await assertFails(updateDoc(activeRef, { status: 'paid' }));
            await assertFails(deleteDoc(activeRef));
            await assertSucceeds(updateDoc(clearedRef, { status: 'paid' }));
            await assertSucceeds(deleteDoc(clearedRef));
            await assertFails(getDoc(doc(ownerDb, 'teams/team-a/feeBatches/batch-a/feeRecipients/active-checkout/checkoutReservations/tok_server_1234567890')));
        });

        it('blocks terminal Stripe evidence while preserving expired-unpaid and offline recipient deletion', async () => {
            await seedRecipient('teams/team-a/feeBatches/batch-a/feeRecipients/legacy-charge', {
                ...recipientPayload(),
                paymentProvider: 'stripe',
                checkoutStatus: 'stale',
                stripeChargeId: 'ch_legacy_settled'
            });
            await seedRecipient('teams/team-a/feeBatches/batch-a/feeRecipients/expired-unpaid-offline-paid', {
                ...recipientPayload(),
                paymentProvider: 'stripe',
                checkoutStatus: 'expired',
                stripePaymentStatus: 'unpaid',
                status: 'paid',
                paidAmountCents: 2500
            });
            await seedRecipient('teams/team-a/feeBatches/batch-a/feeRecipients/offline-paid', {
                ...recipientPayload(),
                paymentProvider: 'offline',
                status: 'paid',
                paidAmountCents: 2500
            });
            await seedRecipient('teams/team-a/feeBatches/batch-a/feeRecipients/providerless-charge', {
                ...recipientPayload(),
                checkoutStatus: 'stale',
                stripeChargeId: 'ch_providerless'
            });
            await seedRecipient('teams/team-a/feeBatches/batch-a/feeRecipients/providerless-refund', {
                ...recipientPayload(),
                checkoutStatus: 'stale',
                stripeRefundId: 're_providerless'
            });
            await seedRecipient('teams/team-a/feeBatches/batch-a/feeRecipients/providerless-last-refund', {
                ...recipientPayload(),
                checkoutStatus: 'stale',
                stripeLastRefundId: 're_last_providerless'
            });
            const ownerDb = authedFirestore('owner-a', 'owner-a@example.com');

            await assertFails(deleteDoc(recipientRef(ownerDb, 'team-a', 'batch-a', 'legacy-charge')));
            await assertSucceeds(deleteDoc(recipientRef(ownerDb, 'team-a', 'batch-a', 'expired-unpaid-offline-paid')));
            await assertSucceeds(deleteDoc(recipientRef(ownerDb, 'team-a', 'batch-a', 'offline-paid')));
            for (const [recipientId, evidenceField] of [
                ['providerless-charge', 'stripeChargeId'],
                ['providerless-refund', 'stripeRefundId'],
                ['providerless-last-refund', 'stripeLastRefundId']
            ]) {
                const ref = recipientRef(ownerDb, 'team-a', 'batch-a', recipientId);
                await assertSucceeds(updateDoc(ref, { status: 'partial' }));
                await assertFails(updateDoc(ref, { [evidenceField]: deleteField() }));
                await assertFails(deleteDoc(ref));
            }
        });
    });
});
