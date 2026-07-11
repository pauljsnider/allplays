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
    doc,
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
    });

    it('blocks private billing fields on parent-readable fee recipient documents while keeping adminBilling admin-only', () => {
        expect(rules).toContain('function hasNoPrivateTeamFeeBillingFields(data)');
        expect(rules).toContain('function hasNoIntroducedPrivateTeamFeeBillingFields()');
        expect(rules).toContain("'stripePaymentIntentId'");
        expect(rules).toContain("'recordedBy'");
        expect(rules).toContain('hasNoPrivateTeamFeeBillingFields(request.resource.data)');
        expect(rules).toContain('hasNoIntroducedPrivateTeamFeeBillingFields()');
        expect(rules).toContain("request.resource.data.get('stripePaymentIntentId', null) == null");
        expect(rules).toContain('match /adminBilling/{billingId} {');
        expect(rules).toContain('allow read, create, update, delete: if isTeamOwnerOrAdmin(teamId);');
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
    });
});
