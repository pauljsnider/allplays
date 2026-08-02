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
                await firestore.doc('teams/team-a').set({
                    ownerId: 'owner-a',
                    ownerEmail: 'legacy-owner@example.com',
                    adminEmails: ['admin-a@example.com']
                });
                await firestore.doc('teams/team-b').set({ ownerId: 'owner-b', adminEmails: [] });
                await firestore.doc('teams/team-a/mediaFolders/folder-a').set({ visibility: 'team' });
                await firestore.doc('teams/team-b/mediaFolders/folder-b').set({ visibility: 'team' });
                await firestore.doc('users/member-a').set({
                    isAdmin: false,
                    parentTeamIds: ['team-a'],
                    parentPlayerKeys: ['team-a::player-a'],
                    teamMediaUploadTeamIds: ['team-a']
                });
                await firestore.doc('teams/team-a/players/player-a').set({ parentIds: ['member-a'] });
                await firestore.doc('teams/team-b/players/player-b').set({ parentIds: ['owner-b'] });
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

        it('allows only the signed-in profile owner or linked player editor to upload profile photos', async () => {
            const memberStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com',
                email_verified: true
            }).storage();
            const unrelatedStorage = testEnv.authenticatedContext('unrelated', {
                email: 'unrelated@example.com',
                email_verified: true
            }).storage();

            await assertSucceeds(
                memberStorage.ref('profile-photos/users/member-a/profile.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                unrelatedStorage.ref('profile-photos/users/member-a/spoofed.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertSucceeds(
                memberStorage.ref('profile-photos/teams/team-a/players/player-a/member-a/player.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                memberStorage.ref('profile-photos/teams/team-b/players/player-b/member-a/cross-team.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                memberStorage.ref('profile-photos/teams/team-a/players/player-a/member-a/not-an-image.txt').put(
                    new Uint8Array([1]),
                    { contentType: 'text/plain' }
                )
            );
        });

        it('keeps own and linked-player profile photos available to signed-in users when verified-email enforcement is active', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('securityPolicies/verifiedEmail').set({ mode: 'enforce' });
            });
            const unverifiedParentStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com',
                email_verified: false
            }).storage();

            await assertSucceeds(
                unverifiedParentStorage.ref('profile-photos/users/member-a/unverified-profile.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertSucceeds(
                unverifiedParentStorage.ref('profile-photos/teams/team-a/players/player-a/member-a/unverified-player.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
        });

        it('allows verified team managers to replace a final team-owned photo and denies draft paths', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('securityPolicies/verifiedEmail').set({ mode: 'enforce' });
            });
            const ownerStorage = testEnv.authenticatedContext('owner-a', {
                email: 'owner-a@example.com',
                email_verified: true
            }).storage();
            const memberStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com',
                email_verified: true
            }).storage();
            const adminStorage = testEnv.authenticatedContext('admin-a', {
                email: 'admin-a@example.com',
                email_verified: true
            }).storage();

            const ownerPhotoRef = ownerStorage.ref('profile-photos/teams/team-a/team/owner-a/team.jpg');
            await assertSucceeds(
                ownerPhotoRef.put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                memberStorage.ref('profile-photos/teams/team-a/team/member-a/team.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                ownerStorage.ref('profile-photos/team-drafts/owner-a/team.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                memberStorage.ref('profile-photos/team-drafts/owner-a/spoofed.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertSucceeds(
                adminStorage.ref('profile-photos/teams/team-a/team/owner-a/team.jpg').delete()
            );
            await assertSucceeds(
                adminStorage.ref('profile-photos/teams/team-a/team/admin-a/replacement.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );

            const ownerPlayerPhotoRef = ownerStorage.ref(
                'profile-photos/teams/team-a/players/player-a/owner-a/player.jpg'
            );
            await assertSucceeds(
                ownerPlayerPhotoRef.put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertSucceeds(
                adminStorage.ref('profile-photos/teams/team-a/players/player-a/owner-a/player.jpg').delete()
            );
            await assertSucceeds(
                adminStorage.ref('profile-photos/teams/team-a/players/player-a/admin-a/replacement.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
        });

        it('allows legacy owner-email team chat uploads when the owner uid no longer matches', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('securityPolicies/verifiedEmail').set({ mode: 'enforce' });
            });

            const legacyOwnerStorage = testEnv.authenticatedContext('legacy-owner-uid', {
                email: 'legacy-owner@example.com',
                email_verified: false
            }).storage();

            await assertSucceeds(
                legacyOwnerStorage.ref('stat-sheets/team-chat/team-a/team/legacy-owner-uid/legacy-owner-photo.jpg').put(
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

        it('allows the cached legacy team chat upload path while preserving team and uploader boundaries', async () => {
            const memberStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com'
            }).storage();
            const otherMemberStorage = testEnv.authenticatedContext('other-member', {
                email: 'other@example.com'
            }).storage();

            await assertSucceeds(
                memberStorage.ref('stat-sheets/team-chat/team-a/team/member-a/cached-photo.jpg').put(
                    new Uint8Array([1]),
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
                otherMemberStorage.ref('stat-sheets/team-chat/team-a/team/member-a/wrong-uploader.jpg').put(
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
        });

        it('allows team chat image upload and own delete when verified-email policy is enforced for an unverified signed-in parent', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('securityPolicies/verifiedEmail').set({ mode: 'enforce' });
            });

            const parentStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com',
                email_verified: false
            }).storage();

            await assertSucceeds(
                parentStorage.ref('stat-sheets/team-chat/team-a/team/member-a/unverified-chat-photo.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertSucceeds(
                parentStorage.ref('stat-sheets/team-chat/team-a/team/member-a/unverified-chat-photo.jpg').delete()
            );
            await assertFails(
                parentStorage.ref('stat-sheets/team-chat/team-a/targeted-a/member-a/unverified-targeted-photo.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
        });
    }
);
