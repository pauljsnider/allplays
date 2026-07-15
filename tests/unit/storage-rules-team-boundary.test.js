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
                await firestore.doc('users/member-a-nonparticipant').set({
                    isAdmin: false,
                    parentTeamIds: ['team-a']
                });
                await firestore.doc('teams/team-a/chatConversations/targeted-a').set({
                    type: 'group',
                    participantIds: ['user:member-a']
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

        it('enforces team, conversation, uploader, MIME, and 5 MB boundaries for chat uploads', async () => {
            const memberStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com'
            }).storage();
            const nonparticipantStorage = testEnv.authenticatedContext('member-a-nonparticipant', {
                email: 'nonparticipant@example.com'
            }).storage();

            await assertSucceeds(
                memberStorage.ref('stat-sheets/team-chat/team-a/team/member-a/photo.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertSucceeds(
                memberStorage.ref('stat-sheets/team-chat/team-a/targeted-a/member-a/video.mp4').put(
                    new Uint8Array([1]),
                    { contentType: 'video/mp4' }
                )
            );
            await assertSucceeds(
                memberStorage.ref('stat-sheets/team-chat/team-a/team/member-a/max-size.jpg').put(
                    new Uint8Array(5 * 1024 * 1024),
                    { contentType: 'image/jpeg' }
                )
            );

            await assertFails(
                memberStorage.ref('stat-sheets/team-chat/team-b/team/member-a/cross-team.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                nonparticipantStorage.ref('stat-sheets/team-chat/team-a/targeted-a/member-a-nonparticipant/photo.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                memberStorage.ref('stat-sheets/team-chat/team-a/team/member-a/document.txt').put(
                    new Uint8Array([1]),
                    { contentType: 'text/plain' }
                )
            );
            await assertFails(
                memberStorage.ref('stat-sheets/team-chat/team-a/team/member-a/too-large.jpg').put(
                    new Uint8Array((5 * 1024 * 1024) + 1),
                    { contentType: 'image/jpeg' }
                )
            );
        });
    }
);
