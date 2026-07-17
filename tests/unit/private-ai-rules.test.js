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
const privateAiCollections = ['privateAiMessages', 'privateAiConversations'];

function extractRuleBlock(marker, nextMarker) {
    return rules.slice(rules.indexOf(marker), rules.indexOf(nextMarker));
}

describe('private AI Firestore rules', () => {
    it('requires ownership and has no platform-admin bypass in either collection', () => {
        const messageRules = extractRuleBlock(
            'match /privateAiMessages/{messageId}',
            'match /privateAiConversations/{conversationId}'
        );
        const conversationRules = extractRuleBlock(
            'match /privateAiConversations/{conversationId}',
            'match /entitlements/{entitlementId}'
        );

        for (const ruleBlock of [messageRules, conversationRules]) {
            expect(ruleBlock).toContain('allow read, create, update, delete: if isOwner(userId);');
            expect(ruleBlock).not.toContain('isGlobalAdmin()');
        }
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
    });
});
