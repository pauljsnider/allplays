import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    deleteField,
    deleteDoc,
    doc,
    getDoc,
    setDoc,
    Timestamp,
    updateDoc
} from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

function entitlementPayload(overrides = {}) {
    return {
        teamId: 'team-a',
        seasonId: '2026',
        tier: 'team-pass',
        status: 'active',
        updatedAt: Timestamp.fromMillis(1_700_000_000_000),
        ...overrides
    };
}

describe('team entitlement Firestore rules', () => {
    it('allows client management only when the resulting entitlement is not active', () => {
        expect(rules).toContain("request.resource.data.status in ['inactive', 'expired', 'cancelled']");
        expect(rules).not.toContain("request.resource.data.status in ['active', 'inactive', 'expired', 'cancelled']");
        expect(rules).toContain("request.resource.data.keys().hasOnly(['status', 'teamId', 'seasonId', 'tier', 'updatedAt'])");
        expect(rules).toContain('match /checkoutReservations/{reservationId} {');
        expect(rules).toContain('!hasActiveRegistrationStripeAuthority(resource.data)');
        expect(rules).toContain('!hasSettledRegistrationStripeAuthority(resource.data)');
        expect(rules).toContain('hasSettledRegistrationStripeAuthority(request.resource.data)');
        expect(rules).toContain('hasNoRegistrationStripeAuthorityMutation()');
    });

    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('emulator authorization coverage', () => {
        let testEnv;

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: `allplays-team-entitlements-${Date.now()}`,
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
                await setDoc(
                    doc(firestore, 'teams/team-a/entitlements/server-active'),
                    entitlementPayload()
                );
                await setDoc(
                    doc(firestore, 'teams/team-a/entitlements/legacy-private'),
                    entitlementPayload({ stripePaymentIntentId: 'pi_private' })
                );
                await setDoc(
                    doc(firestore, 'teams/team-a/entitlements/unknown-extra'),
                    entitlementPayload({ harmlessExtra: true })
                );
                await setDoc(
                    doc(firestore, 'teams/team-a/entitlements/server-inactive'),
                    entitlementPayload({ status: 'inactive' })
                );
                await setDoc(
                    doc(firestore, 'teams/team-a/teamPassCheckoutAttempts/2026_team-pass'),
                    { teamId: 'team-a', seasonId: '2026', tier: 'team-pass', stripePaymentIntentId: 'pi_private' }
                );
                await setDoc(doc(firestore, 'teams/team-a/registrationForms/form-a'), { published: true });
                await setDoc(doc(firestore, 'teams/team-a/registrationForms/form-a/registrations/reg-a'), {
                    teamId: 'team-a', formId: 'form-a', status: 'pending'
                });
                await setDoc(doc(firestore, 'teams/team-a/registrationForms/form-a/registrations/settled-provider'), {
                    teamId: 'team-a', formId: 'form-a', status: 'approved', paymentProvider: 'stripe'
                });
                await setDoc(doc(firestore, 'teams/team-a/registrationForms/form-a/registrations/settled-complete'), {
                    teamId: 'team-a', formId: 'form-a', status: 'approved', checkoutStatus: 'complete'
                });
                await setDoc(doc(firestore, 'teams/team-a/registrationForms/form-a/registrations/settled-complete/stripeCharges/ch-complete'), {
                    type: 'stripe_charge', product: 'registration', stripeChargeId: 'ch-complete'
                });
                await setDoc(doc(firestore, 'teams/team-a/registrationForms/form-a/registrations/settled-gross'), {
                    teamId: 'team-a', formId: 'form-a', status: 'approved', stripeGrossPaidAmountCents: 5000
                });
                await setDoc(doc(firestore, 'teams/team-a/feeBatches/batch-a'), {
                    teamId: 'team-a', title: 'Tournament dues'
                });
                await setDoc(doc(firestore, 'teams/team-a/feeBatches/batch-a/feeRecipients/recipient-a'), {
                    teamId: 'team-a', batchId: 'batch-a', status: 'unpaid', amountDueCents: 2500
                });
            });
        });

        afterAll(async () => {
            await testEnv?.cleanup();
        });

        it('preserves reads of existing server-created active entitlements', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const publicDb = testEnv.unauthenticatedContext().firestore();

            await assertSucceeds(getDoc(doc(ownerDb, 'teams/team-a/entitlements/server-active')));
            await assertSucceeds(getDoc(doc(publicDb, 'teams/team-a/entitlements/server-active')));
            await assertFails(getDoc(doc(publicDb, 'teams/team-a/entitlements/legacy-private')));
            await assertFails(getDoc(doc(publicDb, 'teams/team-a/entitlements/unknown-extra')));
        });

        it('keeps Team Pass checkout attempts server-only even from team admins', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const attemptRef = doc(ownerDb, 'teams/team-a/teamPassCheckoutAttempts/2026_team-pass');
            await assertFails(getDoc(attemptRef));
            await assertFails(setDoc(attemptRef, { teamId: 'team-a', seasonId: '2026', tier: 'team-pass' }));
        });

        it('keeps registration replay reservations and charge ledgers server-only', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const reservationRef = doc(ownerDb, 'teams/team-a/registrationForms/form-a/registrations/reg-a/checkoutReservations/res-a');
            const chargeRef = doc(ownerDb, 'teams/team-a/registrationForms/form-a/registrations/reg-a/stripeCharges/ch-a');
            await assertFails(getDoc(reservationRef));
            await assertFails(setDoc(reservationRef, { stripeRequest: { mode: 'payment' } }));
            await assertFails(getDoc(chargeRef));
            await assertFails(setDoc(chargeRef, { stripeChargeId: 'ch-a' }));
        });

        it('blocks stale admin registration writes while server Stripe authority is active', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const firestore = context.firestore();
                await setDoc(doc(firestore, 'teams/team-a/registrationForms/form-a/registrations/active-payment'), {
                    teamId: 'team-a', formId: 'form-a', status: 'pending', checkoutStatus: 'open',
                    checkoutCreationReservationId: 'res-active', stripeCheckoutSessionId: 'cs-active'
                });
                await setDoc(doc(firestore, 'teams/team-a/registrationForms/form-a/registrations/cleared-payment'), {
                    teamId: 'team-a', formId: 'form-a', status: 'pending', checkoutStatus: 'expired'
                });
            });
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const activeRef = doc(ownerDb, 'teams/team-a/registrationForms/form-a/registrations/active-payment');
            const clearedRef = doc(ownerDb, 'teams/team-a/registrationForms/form-a/registrations/cleared-payment');
            const cleanCreateRef = doc(ownerDb, 'teams/team-a/registrationForms/form-a/registrations/admin-created');
            const forgedCreateRef = doc(ownerDb, 'teams/team-a/registrationForms/form-a/registrations/forged-authority');

            await assertSucceeds(setDoc(cleanCreateRef, { teamId: 'team-a', formId: 'form-a', status: 'pending' }));
            await assertFails(setDoc(forgedCreateRef, {
                teamId: 'team-a', formId: 'form-a', status: 'pending',
                checkoutStatus: 'open', stripeCheckoutSessionId: 'cs_forged'
            }));
            await assertFails(updateDoc(activeRef, { status: 'approved' }));
            await assertFails(deleteDoc(activeRef));
            await assertSucceeds(updateDoc(clearedRef, { status: 'approved' }));
            await assertFails(updateDoc(clearedRef, { stripeCheckoutSessionId: 'cs_forged' }));
            await assertFails(updateDoc(clearedRef, {
                checkoutStatus: 'creating', checkoutAttemptToken: 'tok_forged_1234567890'
            }));
            await assertSucceeds(deleteDoc(clearedRef));
        });

        it('preserves settled registration scope and parent authority while allowing safe status edits', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const providerRef = doc(ownerDb, 'teams/team-a/registrationForms/form-a/registrations/settled-provider');
            const completeRef = doc(ownerDb, 'teams/team-a/registrationForms/form-a/registrations/settled-complete');
            const grossRef = doc(ownerDb, 'teams/team-a/registrationForms/form-a/registrations/settled-gross');

            await assertSucceeds(updateDoc(providerRef, { status: 'archived' }));
            await assertFails(updateDoc(providerRef, { teamId: 'team-b' }));
            await assertFails(updateDoc(providerRef, { formId: 'form-b' }));
            await assertFails(updateDoc(completeRef, { checkoutStatus: deleteField() }));
            await assertFails(updateDoc(grossRef, { stripeGrossPaidAmountCents: deleteField() }));
            await assertFails(deleteDoc(providerRef));
            await assertFails(deleteDoc(completeRef));
            await assertFails(deleteDoc(grossRef));
        });

        it('denies client activation on create and update, including active-record edits', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const activeCreateRef = doc(ownerDb, 'teams/team-a/entitlements/client-active');
            const stagedRef = doc(ownerDb, 'teams/team-a/entitlements/client-staged');
            const existingActiveRef = doc(ownerDb, 'teams/team-a/entitlements/server-active');

            await assertFails(setDoc(activeCreateRef, entitlementPayload()));
            await assertSucceeds(setDoc(stagedRef, entitlementPayload({ status: 'inactive' })));
            await assertFails(updateDoc(stagedRef, { status: 'active' }));
            await assertFails(updateDoc(stagedRef, { arbitraryClientField: true }));
            await assertFails(updateDoc(existingActiveRef, { expiresAt: '2099-01-01T00:00:00.000Z' }));
            await assertFails(deleteDoc(existingActiveRef));
        });

        it('keeps active entitlements server-owned while preserving non-active admin cleanup', async () => {
            const adminDb = testEnv.authenticatedContext('admin-a', { email: 'admin-a@example.com' }).firestore();
            const activeRef = doc(adminDb, 'teams/team-a/entitlements/server-active');
            const inactiveRef = doc(adminDb, 'teams/team-a/entitlements/server-inactive');

            await assertFails(updateDoc(activeRef, { status: 'cancelled' }));
            await assertFails(updateDoc(activeRef, { status: 'active' }));
            await assertSucceeds(updateDoc(inactiveRef, { status: 'cancelled' }));
            await assertSucceeds(deleteDoc(inactiveRef));
        });

        it('freezes every client payment mutation while preserving reads and unrelated team work', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'paymentAuthorityRollout/control'), {
                    frozen: true,
                    reason: 'payment authority cutover'
                });
            });
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const controlRef = doc(ownerDb, 'paymentAuthorityRollout/control');
            const formRef = doc(ownerDb, 'teams/team-a/registrationForms/form-a');
            const registrationRef = doc(ownerDb, 'teams/team-a/registrationForms/form-a/registrations/reg-a');
            const batchRef = doc(ownerDb, 'teams/team-a/feeBatches/batch-a');
            const recipientRef = doc(ownerDb, 'teams/team-a/feeBatches/batch-a/feeRecipients/recipient-a');
            const billingRef = doc(ownerDb, 'teams/team-a/feeBatches/batch-a/feeRecipients/recipient-a/adminBilling/latest');
            const inactiveRef = doc(ownerDb, 'teams/team-a/entitlements/server-inactive');

            await assertFails(getDoc(controlRef));
            await assertFails(setDoc(controlRef, { frozen: false }));
            await assertSucceeds(getDoc(formRef));
            await assertSucceeds(getDoc(registrationRef));
            await assertSucceeds(getDoc(recipientRef));
            await assertSucceeds(getDoc(doc(ownerDb, 'teams/team-a/entitlements/server-active')));
            await assertSucceeds(setDoc(
                doc(ownerDb, 'teams/team-a/practiceTemplates/nonpayment-a'),
                { name: 'Unrelated practice template' }
            ));

            await assertFails(updateDoc(formRef, { programName: 'Blocked during cutover' }));
            await assertFails(setDoc(
                doc(ownerDb, 'teams/team-a/registrationForms/form-a/registrations/frozen-create'),
                { teamId: 'team-a', formId: 'form-a', status: 'pending' }
            ));
            await assertFails(updateDoc(registrationRef, { status: 'approved' }));
            await assertFails(deleteDoc(registrationRef));
            await assertFails(updateDoc(batchRef, { title: 'Blocked during cutover' }));
            await assertFails(deleteDoc(batchRef));
            await assertFails(updateDoc(recipientRef, { status: 'paid' }));
            await assertFails(deleteDoc(recipientRef));
            await assertFails(setDoc(billingRef, {
                type: 'offline_payment', teamId: 'team-a', batchId: 'batch-a', recipientId: 'recipient-a',
                amountPaidCents: 2500, recordedBy: 'owner-a'
            }));
            await assertFails(updateDoc(inactiveRef, { status: 'cancelled' }));
            await assertFails(deleteDoc(inactiveRef));
        });

        it('keeps non-admin clients from staging entitlement records', async () => {
            const unrelatedDb = testEnv.authenticatedContext('unrelated').firestore();
            await assertFails(setDoc(
                doc(unrelatedDb, 'teams/team-a/entitlements/unrelated-staged'),
                entitlementPayload({ status: 'inactive' })
            ));
        });
    });
});
