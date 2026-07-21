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
    serverTimestamp,
    setDoc,
    updateDoc,
    writeBatch,
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

    it('uses the owner/admin-only fee financial state guard for recipient updates', () => {
        expect(rules).toContain('function canWriteTeamFeeFinancialState(teamId)');
        expect(rules).toContain('return isTeamOwnerOrAdmin(teamId);');
        expect(nestedRecipientBlock).toContain('allow update: if canWriteTeamFeeFinancialState(teamId)');
    });

    it('requires financial recipient updates to create a matching actor-attributed audit', () => {
        expect(rules).toContain('function hasRequiredTeamFeeMutationAudit(teamId, batchId, recipientId)');
        expect(rules).toContain('existsAfter(auditPath)');
        expect(rules).toContain('getAfter(auditPath).data.actorId == request.auth.uid');
        expect(rules).toContain("request.resource.data.get('latestAuditAt', null) == request.time");
        expect(rules).toContain('getAfter(auditPath).data.changedFields.toSet() == affectedKeys.intersection(financialFields.toSet())');
        expect(rules).not.toContain("request.resource.data.get('latestAuditActorId', '') == request.auth.uid");
        expect(nestedRecipientBlock).toContain('hasRequiredTeamFeeMutationAudit(teamId, batchId, recipientId)');
    });

    it('blocks private billing fields on parent-readable fee recipient documents while keeping adminBilling admin-only', () => {
        expect(rules).toContain('function hasNoPrivateTeamFeeBillingFields(data)');
        expect(rules).toContain('function hasNoIntroducedPrivateTeamFeeBillingFields()');
        expect(rules).toContain("'stripePaymentIntentId'");
        expect(rules).toContain("'recordedBy'");
        expect(rules).toContain("'latestAuditActorId'");
        expect(rules).toContain('hasNoPrivateTeamFeeBillingFields(request.resource.data)');
        expect(rules).toContain('hasNoIntroducedPrivateTeamFeeBillingFields()');
        expect(rules).toContain("request.resource.data.get('stripePaymentIntentId', null) == null");
        expect(rules).toContain('match /adminBilling/{billingId} {');
        expect(rules).toContain('allow read, create, update, delete: if isTeamOwnerOrAdmin(teamId);');
    });

    it('allows atomic append-only fee audit entries from the authenticated team admin', () => {
        expect(nestedRecipientBlock).toContain('match /audit/{auditId} {');
        expect(nestedRecipientBlock).toContain("data.get('latestAuditId', '') == auditId");
        expect(nestedRecipientBlock).toContain("data.get('latestAuditAt', null) == request.time");
        expect(nestedRecipientBlock).toContain('request.resource.data.actorId == request.auth.uid');
        expect(nestedRecipientBlock).toContain('request.resource.data.changedAt == request.time');
        expect(nestedRecipientBlock).toContain('teamFeeAuditMatchesParentMutation(teamId, batchId, recipientId, request.resource.data)');
        expect(nestedRecipientBlock).toContain('allow update, delete: if false;');
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

        async function writeAuditedUpdate(firestore, teamId, batchId, recipientId, actorId, update, auditOverrides = {}) {
            const batch = writeBatch(firestore);
            const auditId = `fee_mutation_${recipientId}`;
            batch.update(recipientRef(firestore, teamId, batchId, recipientId), {
                ...update,
                latestAuditId: auditId,
                latestAuditAt: serverTimestamp()
            });
            batch.set(doc(firestore, `teams/${teamId}/feeBatches/${batchId}/feeRecipients/${recipientId}/audit/${auditId}`), {
                teamId,
                batchId,
                recipientId,
                actorId,
                changedFields: Object.keys(update),
                mutationType: 'fee_update',
                changedAt: serverTimestamp(),
                ...auditOverrides
            });
            return batch.commit();
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
            await assertFails(updateDoc(validRef, { status: 'paid' }));
            await assertSucceeds(writeAuditedUpdate(ownerDb, 'team-a', 'batch-a', 'valid', 'owner-a', { status: 'paid' }));
            await assertSucceeds(deleteDoc(validRef));
        });

        it('denies parent fee amount/status tampering while allowing owner and admin updates', async () => {
            await seedRecipient(
                'teams/team-a/feeBatches/batch-a/feeRecipients/financial-state',
                recipientPayload()
            );

            const parentRef = recipientRef(
                authedFirestore('parent-a', 'parent-a@example.com'),
                'team-a',
                'batch-a',
                'financial-state'
            );
            await assertFails(updateDoc(parentRef, {
                amountDueCents: 1,
                status: 'paid'
            }));

            const ownerRef = recipientRef(
                authedFirestore('owner-a', 'owner-a@example.com'),
                'team-a',
                'batch-a',
                'financial-state'
            );
            await assertFails(updateDoc(ownerRef, {
                amountDueCents: 2000,
                status: 'partial'
            }));
            await assertSucceeds(writeAuditedUpdate(
                authedFirestore('owner-a', 'owner-a@example.com'),
                'team-a',
                'batch-a',
                'financial-state',
                'owner-a',
                { amountDueCents: 2000, status: 'partial' }
            ));

            const adminRef = recipientRef(
                authedFirestore('admin-a', 'admin-a@example.com'),
                'team-a',
                'batch-a',
                'financial-state'
            );
            await assertFails(updateDoc(adminRef, {
                amountDueCents: 0,
                status: 'paid'
            }));
            await assertSucceeds(writeAuditedUpdate(
                authedFirestore('admin-a', 'admin-a@example.com'),
                'team-a',
                'batch-a',
                'financial-state',
                'admin-a',
                { amountDueCents: 0, status: 'paid' }
            ));
        });

        it('denies financial updates with malformed or mismatched audit contents', async () => {
            await seedRecipient(
                'teams/team-a/feeBatches/batch-a/feeRecipients/invalid-audit',
                recipientPayload()
            );
            const ownerDb = authedFirestore('owner-a', 'owner-a@example.com');

            await assertFails(writeAuditedUpdate(
                ownerDb,
                'team-a',
                'batch-a',
                'invalid-audit',
                'owner-a',
                { status: 'paid', amountDueCents: 0 },
                { changedFields: ['status'] }
            ));
            await assertFails(writeAuditedUpdate(
                ownerDb,
                'team-a',
                'batch-a',
                'invalid-audit',
                'owner-a',
                { status: 'paid', amountDueCents: 0 },
                { mutationType: 'invented_mutation' }
            ));
        });

        it('denies phantom audits without a matching atomic financial mutation', async () => {
            const ownerDb = authedFirestore('owner-a', 'owner-a@example.com');
            await seedRecipient(
                'teams/team-a/feeBatches/batch-a/feeRecipients/existing-recipient',
                recipientPayload()
            );
            const auditPayload = {
                teamId: 'team-a',
                batchId: 'batch-a',
                recipientId: 'existing-recipient',
                actorId: 'owner-a',
                changedFields: ['status'],
                mutationType: 'fee_update',
                changedAt: serverTimestamp()
            };

            await assertFails(setDoc(
                doc(ownerDb, 'teams/team-a/feeBatches/batch-a/feeRecipients/existing-recipient/audit/phantom'),
                auditPayload
            ));
            await assertFails(setDoc(
                doc(ownerDb, 'teams/team-a/feeBatches/batch-a/feeRecipients/missing-recipient/audit/phantom'),
                { ...auditPayload, recipientId: 'missing-recipient' }
            ));

            const phantomBatch = writeBatch(ownerDb);
            phantomBatch.update(
                recipientRef(ownerDb, 'team-a', 'batch-a', 'existing-recipient'),
                { latestAuditId: 'phantom', latestAuditAt: serverTimestamp() }
            );
            phantomBatch.set(
                doc(ownerDb, 'teams/team-a/feeBatches/batch-a/feeRecipients/existing-recipient/audit/phantom'),
                auditPayload
            );
            await assertFails(phantomBatch.commit());
        });

        it('accepts an audit that omits a supplied financial field whose value did not change', async () => {
            await seedRecipient(
                'teams/team-a/feeBatches/batch-a/feeRecipients/second-partial-payment',
                {
                    ...recipientPayload(),
                    status: 'partial',
                    amountPaidCents: 500,
                    remainingBalanceCents: 2000
                }
            );

            await assertSucceeds(writeAuditedUpdate(
                authedFirestore('owner-a', 'owner-a@example.com'),
                'team-a',
                'batch-a',
                'second-partial-payment',
                'owner-a',
                { status: 'partial', amountPaidCents: 1000, remainingBalanceCents: 1500 },
                { changedFields: ['remainingBalanceCents', 'amountPaidCents'] }
            ));
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
