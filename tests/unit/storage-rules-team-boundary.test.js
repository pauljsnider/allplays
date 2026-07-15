import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';

const firestoreRules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const storageRules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST)(
    'Storage rules team boundary',
    () => {
        let testEnv;

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: 'demo-allplays',
                firestore: { rules: firestoreRules },
                storage: { rules: storageRules }
            });
        }, 30000);

        beforeEach(async () => {
            await testEnv.clearFirestore();
            await testEnv.clearStorage();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const firestore = context.firestore();
                await firestore.doc('teams/team-a').set({ ownerId: 'owner-a', adminEmails: [] });
                await firestore.doc('teams/team-b').set({ ownerId: 'owner-b', adminEmails: [] });
                await firestore.doc('teams/team-a/mediaFolders/folder-a').set({ visibility: 'team' });
                await firestore.doc('teams/team-b/mediaFolders/folder-b').set({ visibility: 'team' });
                await firestore.doc('users/member-a').set({
                    isAdmin: false,
                    parentTeamIds: ['team-a'],
                    teamMediaUploadTeamIds: ['team-a']
                });

                const storage = context.storage();
                await storage.ref('team-media/team-a/folder-a/owner-a/existing.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                );
                await storage.ref('team-media/team-b/folder-b/owner-b/existing.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                );
            });
        });

        afterAll(async () => {
            await testEnv?.cleanup();
        });

        it('allows authorized team-media access and denies the same user across the team boundary', async () => {
            const memberStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com'
            }).storage();

            await assertSucceeds(
                memberStorage.ref('team-media/team-a/folder-a/owner-a/existing.jpg').getMetadata()
            );
            await assertSucceeds(
                memberStorage.ref('team-media/team-a/folder-a/member-a/new.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );

            await assertFails(
                memberStorage.ref('team-media/team-b/folder-b/owner-b/existing.jpg').getMetadata()
            );
            await assertFails(
                memberStorage.ref('team-media/team-b/folder-b/member-a/new.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
        });
    }
);
