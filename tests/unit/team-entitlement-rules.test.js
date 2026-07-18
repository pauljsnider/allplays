import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
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
                    doc(firestore, 'teams/team-a/teamPassCheckoutAttempts/2026_team-pass'),
                    { teamId: 'team-a', seasonId: '2026', tier: 'team-pass', stripePaymentIntentId: 'pi_private' }
                );
                await setDoc(doc(firestore, 'teams/team-a/registrationForms/form-a'), { published: true });
                await setDoc(doc(firestore, 'teams/team-a/registrationForms/form-a/registrations/reg-a'), {
                    teamId: 'team-a', formId: 'form-a', status: 'pending'
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
        });

        it('allows team admins to deactivate an active entitlement but not reactivate it', async () => {
            const adminDb = testEnv.authenticatedContext('admin-a', { email: 'admin-a@example.com' }).firestore();
            const activeRef = doc(adminDb, 'teams/team-a/entitlements/server-active');

            await assertSucceeds(updateDoc(activeRef, { status: 'cancelled' }));
            await assertFails(updateDoc(activeRef, { status: 'active' }));
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
