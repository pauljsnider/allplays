import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    runTransaction,
    setDoc,
    updateDoc
} from 'firebase/firestore';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';

const rulesSource = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const rules = compactFirestoreRules(rulesSource);
const privateAiCollections = [
    'privateAiMessages',
    'privateAiConversations',
    'privateAiPendingActions',
    'privateAiActionAudit'
];

function extractRuleBlock(marker, nextMarker) {
    return rulesSource.slice(rulesSource.indexOf(marker), rulesSource.indexOf(nextMarker));
}

describe('private AI Firestore rules', () => {
    it('requires ownership and has no platform-admin bypass in either collection', () => {
        const userPrivateAiRules = extractRuleBlock(
            'match /privateAiMessages/{messageId}',
            'match /entitlements/{entitlementId}'
        );

        expect(userPrivateAiRules).toContain('match /privateAiMessages/{messageId}');
        expect(userPrivateAiRules).toContain('match /privateAiConversations/{conversationId}');
        expect(userPrivateAiRules).toContain('match /privateAiPendingActions/{actionId}');
        expect(userPrivateAiRules).toContain('match /privateAiActionAudit/{auditId}');

        for (const collectionName of privateAiCollections) {
            const ruleBlock = extractRuleBlock(
                `match /${collectionName}/`,
                collectionName === 'privateAiActionAudit'
                    ? 'match /entitlements/{entitlementId}'
                    : `match /${privateAiCollections[privateAiCollections.indexOf(collectionName) + 1]}/`
            );
            expect(ruleBlock).toContain('allow read: if isOwner(userId);');
            expect(ruleBlock).toContain('allow create, update, delete: if isVerifiedForSensitiveWrite() && isOwner(userId);');
            expect(ruleBlock).not.toContain('isGlobalAdmin()');
        }
    });

    it('keeps prepared roster payloads behind current team-manager access', () => {
        const teamRules = extractRuleBlock(
            'match /privateAiPendingActions/{actionId}',
            '// Players subcollection'
        );

        expect(teamRules).toContain('allow read: if isTeamOwnerOrAdmin(teamId) &&');
        expect(teamRules).toContain("resource.data.get('status', '') == 'pending'");
        expect(teamRules).toContain("resource.data.get('status', '') == 'executing'");
        expect(teamRules).toContain("resource.data.get('userId', '') == request.auth.uid");
        expect(teamRules).toContain("resource.data.get('expiresAtAt', null) > request.time");
        expect(teamRules).toContain('allow create: if isVerifiedForSensitiveWrite() &&');
        expect(teamRules).toContain("request.resource.data.get('userId', '') == request.auth.uid");
        expect(teamRules).toContain('allow update: if isVerifiedForSensitiveWrite() &&');
        expect(teamRules).toContain("resource.data.get('userId', '') == request.auth.uid");
        expect(teamRules).toContain('allow delete: if isVerifiedForSensitiveWrite() &&');
        expect(teamRules).toContain("request.resource.data.get('userId', '') == resource.data.get('userId', '')");
    });

    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('emulator authorization coverage', () => {
        let testEnv;

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: `allplays-private-ai-${Date.now()}`,
                firestore: { rules }
            });
        }, 30000);

        beforeEach(async () => {
            await testEnv.clearFirestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const adminDb = context.firestore();
                await setDoc(doc(adminDb, 'users/platform-admin'), { isAdmin: true });
                await setDoc(doc(adminDb, 'teams/team-1'), {
                    ownerId: 'owner',
                    name: 'Bears',
                    adminEmails: ['second-manager@example.com']
                });
                await setDoc(doc(adminDb, 'teams/team-1/privateAiPendingActions/seeded'), {
                    userId: 'owner',
                    toolName: 'apply_roster_import',
                    status: 'pending',
                    expiresAtAt: new Date(Date.now() + 60_000),
                    args: { operations: [{ privateFamilyContacts: { parents: [{ email: 'private@example.com' }] } }] }
                });
                for (const collectionName of privateAiCollections) {
                    await setDoc(doc(adminDb, `users/owner/${collectionName}/seeded`), {
                        content: 'private history'
                    });
                }
            });
        });

        afterAll(async () => {
            await testEnv?.cleanup();
        });

        it.each(privateAiCollections)('allows owner CRUD and list for %s', async (collectionName) => {
            const ownerDb = testEnv.authenticatedContext('owner').firestore();
            const createdRef = doc(ownerDb, `users/owner/${collectionName}/created`);

            await assertSucceeds(getDoc(doc(ownerDb, `users/owner/${collectionName}/seeded`)));
            await assertSucceeds(getDocs(collection(ownerDb, `users/owner/${collectionName}`)));
            await assertSucceeds(setDoc(createdRef, { content: 'created' }));
            await assertSucceeds(updateDoc(createdRef, { content: 'updated' }));
            await assertSucceeds(deleteDoc(createdRef));
        });

        it.each(privateAiCollections)('denies cross-user and anonymous access to %s', async (collectionName) => {
            const actorDatabases = [
                testEnv.authenticatedContext('platform-admin').firestore(),
                testEnv.authenticatedContext('unrelated-user').firestore(),
                testEnv.unauthenticatedContext().firestore()
            ];

            for (const actorDb of actorDatabases) {
                const seededRef = doc(actorDb, `users/owner/${collectionName}/seeded`);
                const createdRef = doc(actorDb, `users/owner/${collectionName}/unauthorized-create`);

                await assertFails(getDoc(seededRef));
                await assertFails(getDocs(collection(actorDb, `users/owner/${collectionName}`)));
                await assertFails(setDoc(createdRef, { content: 'injected' }));
                await assertFails(updateDoc(seededRef, { content: 'altered' }));
                await assertFails(deleteDoc(seededRef));
            }
        });

        it('allows managers to read pending payloads but only the originating manager can mutate them', async () => {
            const ownerDb = testEnv.authenticatedContext('owner').firestore();
            const secondManagerDb = testEnv.authenticatedContext('second-manager', {
                email: 'second-manager@example.com',
                email_verified: true
            }).firestore();
            const unrelatedDb = testEnv.authenticatedContext('former-coach').firestore();
            const payloadPath = 'teams/team-1/privateAiPendingActions/seeded';

            await assertSucceeds(getDoc(doc(ownerDb, payloadPath)));
            await assertSucceeds(getDoc(doc(secondManagerDb, payloadPath)));
            await assertSucceeds(updateDoc(doc(ownerDb, payloadPath), {
                args: { operations: [] }
            }));
            await assertFails(updateDoc(doc(secondManagerDb, payloadPath), {
                args: { operations: [{ payload: { name: 'Tampered' } }] }
            }));
            await assertFails(setDoc(doc(secondManagerDb, payloadPath), {
                userId: 'second-manager',
                args: { operations: [] }
            }, { merge: true }));
            await assertFails(deleteDoc(doc(secondManagerDb, payloadPath)));
            await assertSucceeds(setDoc(doc(ownerDb, 'teams/team-1/privateAiPendingActions/new'), {
                userId: 'owner',
                toolName: 'apply_roster_import',
                status: 'pending',
                expiresAtAt: new Date(Date.now() + 60_000),
                args: { operations: [] }
            }));
            await assertSucceeds(setDoc(doc(ownerDb, 'teams/team-1/privateAiPendingActions/expired'), {
                userId: 'owner',
                toolName: 'apply_roster_import',
                status: 'pending',
                expiresAtAt: new Date(Date.now() - 60_000),
                args: { operations: [] }
            }));
            await assertSucceeds(setDoc(doc(secondManagerDb, 'teams/team-1/privateAiPendingActions/second-manager'), {
                userId: 'second-manager',
                toolName: 'apply_roster_import',
                status: 'pending',
                expiresAtAt: new Date(Date.now() + 60_000),
                args: { operations: [] }
            }));
            await assertFails(setDoc(doc(secondManagerDb, 'teams/team-1/privateAiPendingActions/forged'), {
                userId: 'owner',
                toolName: 'apply_roster_import',
                status: 'pending',
                expiresAtAt: new Date(Date.now() + 60_000),
                args: { operations: [] }
            }));
            await assertFails(getDoc(doc(ownerDb, 'teams/team-1/privateAiPendingActions/expired')));
            await assertFails(getDoc(doc(unrelatedDb, payloadPath)));
            await assertFails(setDoc(doc(unrelatedDb, 'teams/team-1/privateAiPendingActions/injected'), {
                args: { operations: [] }
            }));
        });

        it('keeps parent-invite idempotency records server-only', async () => {
            const ownerDb = testEnv.authenticatedContext('owner', {
                email: 'owner@example.com',
                email_verified: true
            }).firestore();
            const secondManagerDb = testEnv.authenticatedContext('second-manager', {
                email: 'second-manager@example.com',
                email_verified: true
            }).firestore();
            const unrelatedDb = testEnv.authenticatedContext('unrelated', {
                email: 'unrelated@example.com',
                email_verified: true
            }).firestore();
            const idempotencyPath = 'teams/team-1/inviteIdempotency/parent_abc123';
            const now = new Date();
            const idempotencyPayload = {
                accessCode: 'ABCD2345',
                type: 'parent_invite',
                playerId: 'player-1',
                email: 'parent@example.com',
                generatedBy: 'owner',
                createdAt: now,
                updatedAt: now
            };

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), idempotencyPath), idempotencyPayload);
            });

            for (const actorDb of [ownerDb, secondManagerDb, unrelatedDb]) {
                await assertFails(getDoc(doc(actorDb, idempotencyPath)));
                await assertFails(setDoc(doc(actorDb, `${idempotencyPath}-new`), idempotencyPayload));
                await assertFails(updateDoc(doc(actorDb, idempotencyPath), { updatedAt: new Date() }));
                await assertFails(deleteDoc(doc(actorDb, idempotencyPath)));
            }
        });

        it('lets only the originating current manager restage an executing payload', async () => {
            const ownerDb = testEnv.authenticatedContext('owner').firestore();
            const secondManagerDb = testEnv.authenticatedContext('second-manager', {
                email: 'second-manager@example.com',
                email_verified: true
            }).firestore();
            const ownerPayloadRef = doc(ownerDb, 'teams/team-1/privateAiPendingActions/seeded');
            const secondManagerPayloadRef = doc(secondManagerDb, 'teams/team-1/privateAiPendingActions/seeded');

            await assertSucceeds(updateDoc(ownerPayloadRef, { status: 'executing' }));
            await assertFails(getDoc(secondManagerPayloadRef));
            await assertSucceeds(runTransaction(ownerDb, async (transaction) => {
                const snapshot = await transaction.get(ownerPayloadRef);
                expect(snapshot.data().status).toBe('executing');
                transaction.update(ownerPayloadRef, {
                    status: 'pending',
                    args: {
                        rows: [{
                            rowNumber: 2,
                            eventType: 'practice',
                            startsAt: '2026-07-31T18:00:00.000Z'
                        }]
                    }
                });
            }));

            const restoredSnapshot = await assertSucceeds(getDoc(ownerPayloadRef));
            expect(restoredSnapshot.data()).toMatchObject({
                status: 'pending',
                args: {
                    rows: [{
                        rowNumber: 2,
                        eventType: 'practice',
                        startsAt: '2026-07-31T18:00:00.000Z'
                    }]
                }
            });
        });

        it('revokes roster and schedule preview details while retaining only safe chat summaries', async () => {
            const formerCoachId = 'former-coach';
            const formerCoachEmail = 'former-coach@example.com';
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const adminDb = context.firestore();
                await updateDoc(doc(adminDb, 'teams/team-1'), {
                    adminEmails: ['second-manager@example.com', formerCoachEmail]
                });
                await setDoc(doc(adminDb, `users/${formerCoachId}/privateAiMessages/review`), {
                    artifacts: [
                        {
                            type: 'roster-import',
                            confirmationId: 'roster-review',
                            teamId: 'team-1',
                            summary: { total: 1, invitations: 1 }
                        },
                        {
                            type: 'schedule-import',
                            confirmationId: 'schedule-review',
                            teamId: 'team-1',
                            summary: { total: 1, games: 1 }
                        }
                    ]
                });
                await setDoc(doc(adminDb, 'teams/team-1/privateAiPendingActions/roster-review'), {
                    userId: formerCoachId,
                    teamId: 'team-1',
                    toolName: 'apply_roster_import',
                    status: 'pending',
                    expiresAtAt: new Date(Date.now() + 60_000),
                    artifact: {
                        previewRows: [{
                            name: 'Private Player',
                            contacts: [{ email: 'private-parent@example.com' }]
                        }]
                    }
                });
                await setDoc(doc(adminDb, 'teams/team-1/privateAiPendingActions/schedule-review'), {
                    userId: formerCoachId,
                    teamId: 'team-1',
                    toolName: 'apply_schedule_import',
                    status: 'pending',
                    expiresAtAt: new Date(Date.now() + 60_000),
                    artifact: {
                        previewRows: [{
                            location: 'Private Field',
                            notes: 'Private note'
                        }]
                    }
                });
            });

            const formerCoachDb = testEnv.authenticatedContext(formerCoachId, {
                email: formerCoachEmail,
                email_verified: true
            }).firestore();
            const chatRef = doc(formerCoachDb, `users/${formerCoachId}/privateAiMessages/review`);
            const rosterRef = doc(formerCoachDb, 'teams/team-1/privateAiPendingActions/roster-review');
            const scheduleRef = doc(formerCoachDb, 'teams/team-1/privateAiPendingActions/schedule-review');

            await assertSucceeds(getDoc(chatRef));
            await assertSucceeds(getDoc(rosterRef));
            await assertSucceeds(getDoc(scheduleRef));

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await updateDoc(doc(context.firestore(), 'teams/team-1'), {
                    adminEmails: ['second-manager@example.com']
                });
            });

            const chatSnapshot = await assertSucceeds(getDoc(chatRef));
            expect(JSON.stringify(chatSnapshot.data())).not.toContain('Private Player');
            expect(JSON.stringify(chatSnapshot.data())).not.toContain('Private Field');
            await assertFails(getDoc(rosterRef));
            await assertFails(getDoc(scheduleRef));
        });
    });
});
