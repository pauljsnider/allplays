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
    setDoc,
    updateDoc
} from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const privateAiCollections = [
    'privateAiMessages',
    'privateAiConversations',
    'privateAiPendingActions',
    'privateAiActionAudit'
];

function extractRuleBlock(marker, nextMarker) {
    return rules.slice(rules.indexOf(marker), rules.indexOf(nextMarker));
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
        expect(teamRules).toContain("resource.data.get('expiresAtAt', null) > request.time");
        expect(teamRules).toContain('allow create, update, delete: if isVerifiedForSensitiveWrite() && isTeamOwnerOrAdmin(teamId);');
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
                await setDoc(doc(adminDb, 'teams/team-1'), { ownerId: 'owner', name: 'Bears' });
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

        it('allows current team managers and denies removed or unrelated staff from roster payloads', async () => {
            const ownerDb = testEnv.authenticatedContext('owner').firestore();
            const unrelatedDb = testEnv.authenticatedContext('former-coach').firestore();
            const payloadPath = 'teams/team-1/privateAiPendingActions/seeded';

            await assertSucceeds(getDoc(doc(ownerDb, payloadPath)));
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
            await assertFails(getDoc(doc(ownerDb, 'teams/team-1/privateAiPendingActions/expired')));
            await assertFails(getDoc(doc(unrelatedDb, payloadPath)));
            await assertFails(setDoc(doc(unrelatedDb, 'teams/team-1/privateAiPendingActions/injected'), {
                args: { operations: [] }
            }));
        });
    });
});
