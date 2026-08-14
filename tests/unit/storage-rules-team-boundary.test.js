import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';

const firestoreRules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const storageRules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');

describe('profile photo Storage rule shape', () => {
    it('keeps uploader UIDs out of public team and player object paths', () => {
        expect(storageRules).toContain('match /profile-photos/teams/{teamId}/players/{playerId}/{fileName} {');
        expect(storageRules).toContain('match /profile-photos/teams/{teamId}/team/{fileName} {');
        expect(storageRules).not.toContain('match /profile-photos/teams/{teamId}/players/{playerId}/{userId}/{fileName} {');
        expect(storageRules).not.toContain('match /profile-photos/teams/{teamId}/team/{userId}/{fileName} {');
        expect(storageRules).toContain('match /certificate-signatures/teams/{teamId}/{fileName} {');
    });

    it('uses only canonical user scope for linked-parent player photo authority', () => {
        expect(storageRules).toContain("(teamId + '::' + playerId) in firestore.get(userPath).data.get('parentPlayerKeys', [])");
        expect(storageRules).not.toContain("data.get('parentIds', [])");
    });
});

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
                    adminEmails: ['admin-a@example.com'],
                    teamPermissions: {
                        scorekeeping: {
                            mode: 'selected',
                            memberIds: ['selected-scorekeeper']
                        },
                        videography: {
                            mode: 'selected',
                            memberIds: ['selected-videographer']
                        }
                    }
                });
                await firestore.doc('teams/team-confirmed').set({
                    ownerId: 'confirmed-owner',
                    adminEmails: [],
                    teamPermissions: {
                        scorekeeping: {
                            mode: 'all_confirmed',
                            memberIds: []
                        }
                    }
                });
                await firestore.doc('teams/team-b').set({ ownerId: 'owner-b', adminEmails: [] });
                await firestore.doc('teams/legacy-team').set({
                    ownerEmail: 'legacy-owner@example.com',
                    adminEmails: []
                });
                await firestore.doc('teams/legacy-team/players/legacy-player').set({
                    name: 'Legacy Player'
                });
                await firestore.doc('teams/legacy-team/players/legacy-player/private/profile').set({
                    medicalInfo: 'private'
                });
                await firestore.doc('teams/legacy-team/mediaFolders/private-folder').set({
                    visibility: 'private'
                });
                await firestore.doc('teams/legacy-team/mediaItems/private-item').set({
                    folderId: 'private-folder'
                });
                await firestore.doc('teams/conflicting-legacy-team').set({
                    ownerEmail: 'current@example.com',
                    ownerEmailLower: 'former@example.com',
                    adminEmails: []
                });
                await firestore.doc('teams/team-a/mediaFolders/folder-a').set({ visibility: 'team' });
                await firestore.doc('teams/team-b/mediaFolders/folder-b').set({ visibility: 'team' });
                await firestore.doc('users/member-a').set({
                    isAdmin: false,
                    parentTeamIds: ['team-a'],
                    parentPlayerKeys: ['team-a::player-a'],
                    teamMediaUploadTeamIds: ['team-a']
                });
                await firestore.doc('users/member-b').set({
                    isAdmin: false,
                    parentTeamIds: ['team-a'],
                    parentPlayerKeys: ['team-a::player-a']
                });
                await firestore.doc('users/revoked-parent').set({
                    isAdmin: false,
                    parentTeamIds: ['team-a'],
                    parentPlayerKeys: []
                });
                await firestore.doc('users/revocable-parent').set({
                    isAdmin: false,
                    parentTeamIds: ['team-a'],
                    parentPlayerKeys: ['team-a::player-a']
                });
                await firestore.doc('teams/team-a/players/player-a').set({
                    parentIds: ['member-a', 'revoked-parent', 'revocable-parent']
                });
                await firestore.doc('teams/team-b/players/player-b').set({ parentIds: ['owner-b'] });
                await firestore.doc('users/member-a-nonparticipant').set({
                    isAdmin: false,
                    parentTeamIds: ['team-a']
                });
                await firestore.doc('teams/team-a/chatConversations/targeted-a').set({
                    type: 'group',
                    participantIds: ['user:member-a']
                });
                await firestore.doc('teams/team-a/games/game-a').set({ status: 'scheduled', liveStatus: 'live' });
                await firestore.doc('teams/team-b/games/game-b').set({ status: 'scheduled', liveStatus: 'live' });
                await firestore.doc('teams/team-a/games/cancelled-game').set({ status: 'cancelled', liveStatus: 'scheduled' });
                await firestore.doc('teams/team-a/games/deleted-game').set({ status: 'scheduled', liveStatus: 'deleted' });
                await firestore.doc('teams/team-confirmed/games/game-a').set({ status: 'scheduled', liveStatus: 'live' });
                await firestore.doc('teams/team-confirmed/games/game-b').set({ status: 'scheduled', liveStatus: 'live' });
                await firestore.doc('teams/team-confirmed/games/game-a/rsvps/confirmed-scorekeeper').set({ response: 'going' });

                const storage = context.storage();
                await storage.ref('team-media/team-a/folder-a/owner-a/existing.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                );
                await storage.ref('team-media/team-b/folder-b/owner-b/existing.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                );
                await storage.ref('stat-sheets/team-games/team-a/member-a/referenced-legacy.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                );
                await storage.ref('stat-sheets/team-games/team-a/legacy-scorekeeper/manager-cleanup.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                );
                await storage.ref('stat-sheets/drills/team-a/legacy-drill/member-a/parent-existing.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                );
                await storage.ref('stat-sheets/drills/team-a/legacy-drill/legacy-uploader/manager-existing.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                );
                await storage.ref('team-email-attachments/legacy-team/draft-a/legacy-owner-uid/existing.txt').put(
                    new Uint8Array([1]),
                    { contentType: 'text/plain' }
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

        it('requires a verified matching admin email for team Storage access', async () => {
            const unverifiedAdminStorage = testEnv.authenticatedContext('admin-a', {
                email: 'admin-a@example.com',
                email_verified: false
            }).storage();
            const verifiedAdminStorage = testEnv.authenticatedContext('admin-a', {
                email: 'admin-a@example.com',
                email_verified: true
            }).storage();
            const existingTeamMediaPath = 'team-media/team-a/folder-a/owner-a/existing.jpg';

            await assertFails(unverifiedAdminStorage.ref(existingTeamMediaPath).getMetadata());
            await assertSucceeds(verifiedAdminStorage.ref(existingTeamMediaPath).getMetadata());
        });

        it('allows bounded game-scoped statsheet images for managers and exact-game scorekeepers', async () => {
            const ownerStorage = testEnv.authenticatedContext('owner-a', {
                email: 'owner-a@example.com',
                email_verified: true
            }).storage();
            const adminStorage = testEnv.authenticatedContext('admin-a', {
                email: 'admin-a@example.com',
                email_verified: true
            }).storage();
            const selectedStorage = testEnv.authenticatedContext('selected-scorekeeper', {
                email: 'selected@example.com',
                email_verified: true
            }).storage();
            const confirmedStorage = testEnv.authenticatedContext('confirmed-scorekeeper', {
                email: 'confirmed@example.com',
                email_verified: true
            }).storage();

            await assertSucceeds(ownerStorage.ref('stat-sheets/team-games/team-a/game-a/owner-a/owner.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
            await assertSucceeds(adminStorage.ref('stat-sheets/team-games/team-a/game-a/admin-a/admin.png').put(
                new Uint8Array([1]),
                { contentType: 'image/png' }
            ));
            await assertSucceeds(selectedStorage.ref('stat-sheets/team-games/team-a/game-a/selected-scorekeeper/selected.webp').put(
                new Uint8Array([1]),
                { contentType: 'image/webp' }
            ));
            await assertSucceeds(confirmedStorage.ref('stat-sheets/team-games/team-confirmed/game-a/confirmed-scorekeeper/confirmed.jpg').put(
                new Uint8Array(20 * 1024 * 1024),
                { contentType: 'image/jpeg' }
            ));
        }, 30000);

        it('preserves bounded read and cleanup access for referenced game-less statsheets', async () => {
            const parentStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com',
                email_verified: true
            }).storage();
            const ownerStorage = testEnv.authenticatedContext('owner-a', {
                email: 'owner-a@example.com',
                email_verified: true
            }).storage();
            const parentObject = parentStorage.ref('stat-sheets/team-games/team-a/member-a/referenced-legacy.jpg');
            const managerCleanupObject = ownerStorage.ref('stat-sheets/team-games/team-a/legacy-scorekeeper/manager-cleanup.jpg');

            await assertSucceeds(parentObject.getMetadata());
            await assertFails(parentObject.put(new Uint8Array([1]), { contentType: 'image/jpeg' }));
            await assertFails(parentStorage.ref('stat-sheets/team-games/team-a/legacy-scorekeeper/manager-cleanup.jpg').getMetadata());
            await assertSucceeds(parentObject.delete());

            await assertSucceeds(managerCleanupObject.getMetadata());
            await assertFails(managerCleanupObject.put(new Uint8Array([1]), { contentType: 'image/jpeg' }));
            await assertSucceeds(managerCleanupObject.delete());
        });

        it('denies ordinary team parents and cross-tenant actors from creating game-less statsheets', async () => {
            const parentStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com',
                email_verified: true
            }).storage();
            const ownerStorage = testEnv.authenticatedContext('owner-a', {
                email: 'owner-a@example.com',
                email_verified: true
            }).storage();

            await assertFails(parentStorage.ref('stat-sheets/team-games/team-a/member-a/new-legacy.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
            await assertFails(parentStorage.ref('stat-sheets/team-games/team-b/member-a/cross-team.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
            await assertFails(ownerStorage.ref('stat-sheets/team-games/team-a/owner-a/new-legacy.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
            await assertFails(parentStorage.ref('stat-sheets/team-games/team-a/legacy-scorekeeper/manager-cleanup.jpg').delete());
        });

        it('denies a scorekeeper crossing the statsheet team boundary', async () => {
            const selectedStorage = testEnv.authenticatedContext('selected-scorekeeper', {
                email: 'selected@example.com',
                email_verified: true
            }).storage();

            await assertFails(selectedStorage.ref('stat-sheets/team-games/team-b/game-b/selected-scorekeeper/cross-team.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
        });

        it('denies unauthorized, wrong-game, mismatched-uploader, invalid-type, empty, and oversized statsheets', async () => {
            const parentStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com',
                email_verified: true
            }).storage();
            const confirmedStorage = testEnv.authenticatedContext('confirmed-scorekeeper', {
                email: 'confirmed@example.com',
                email_verified: true
            }).storage();
            const selectedStorage = testEnv.authenticatedContext('selected-scorekeeper', {
                email: 'selected@example.com',
                email_verified: true
            }).storage();

            await assertFails(parentStorage.ref('stat-sheets/team-games/team-a/game-a/member-a/parent.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
            await assertFails(confirmedStorage.ref('stat-sheets/team-games/team-confirmed/game-b/confirmed-scorekeeper/wrong-game.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
            await assertFails(selectedStorage.ref('stat-sheets/team-games/team-a/game-a/another-user/mismatched.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
            await assertFails(selectedStorage.ref('stat-sheets/team-games/team-a/game-a/selected-scorekeeper/not-image.txt').put(
                new Uint8Array([1]),
                { contentType: 'text/plain' }
            ));
            await assertFails(selectedStorage.ref('stat-sheets/team-games/team-a/game-a/selected-scorekeeper/empty.jpg').put(
                new Uint8Array(0),
                { contentType: 'image/jpeg' }
            ));
            await assertFails(selectedStorage.ref('stat-sheets/team-games/team-a/game-a/selected-scorekeeper/oversized.jpg').put(
                new Uint8Array((20 * 1024 * 1024) + 1),
                { contentType: 'image/jpeg' }
            ));
            await assertFails(selectedStorage.ref('stat-sheets/team-games/team-a/cancelled-game/selected-scorekeeper/cancelled.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
        }, 30000);

        it('allows team owners and admins to upload drill images through the exact 20 MB boundary', async () => {
            const ownerStorage = testEnv.authenticatedContext('owner-a', {
                email: 'owner-a@example.com',
                email_verified: true
            }).storage();
            const adminStorage = testEnv.authenticatedContext('admin-a', {
                email: 'admin-a@example.com',
                email_verified: true
            }).storage();

            await assertSucceeds(ownerStorage.ref('stat-sheets/drills/team-a/drill-a/owner-a/owner.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
            await assertSucceeds(adminStorage.ref('stat-sheets/drills/team-a/drill-a/admin-a/boundary.png').put(
                new Uint8Array(20 * 1024 * 1024),
                { contentType: 'image/png' }
            ));
        }, 30000);

        it('denies linked parents, outsiders, mismatched uploaders, empty files, non-images, and oversized drill uploads', async () => {
            const parentStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com',
                email_verified: true
            }).storage();
            const outsiderStorage = testEnv.authenticatedContext('outsider', {
                email: 'outsider@example.com',
                email_verified: true
            }).storage();
            const ownerStorage = testEnv.authenticatedContext('owner-a', {
                email: 'owner-a@example.com',
                email_verified: true
            }).storage();

            await assertFails(parentStorage.ref('stat-sheets/drills/team-a/drill-a/member-a/parent.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
            await assertFails(outsiderStorage.ref('stat-sheets/drills/team-a/drill-a/outsider/outsider.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
            await assertFails(ownerStorage.ref('stat-sheets/drills/team-a/drill-a/another-user/mismatched.jpg').put(
                new Uint8Array([1]),
                { contentType: 'image/jpeg' }
            ));
            await assertFails(ownerStorage.ref('stat-sheets/drills/team-a/drill-a/owner-a/empty.jpg').put(
                new Uint8Array(0),
                { contentType: 'image/jpeg' }
            ));
            await assertFails(ownerStorage.ref('stat-sheets/drills/team-a/drill-a/owner-a/not-image.txt').put(
                new Uint8Array([1]),
                { contentType: 'text/plain' }
            ));
            await assertFails(ownerStorage.ref('stat-sheets/drills/team-a/drill-a/owner-a/oversized.jpg').put(
                new Uint8Array((20 * 1024 * 1024) + 1),
                { contentType: 'image/jpeg' }
            ));
        }, 30000);

        it('preserves team drill reads and authorized legacy cleanup without reopening creates', async () => {
            const parentStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com',
                email_verified: true
            }).storage();
            const ownerStorage = testEnv.authenticatedContext('owner-a', {
                email: 'owner-a@example.com',
                email_verified: true
            }).storage();
            const parentObject = parentStorage.ref('stat-sheets/drills/team-a/legacy-drill/member-a/parent-existing.jpg');
            const managerObject = ownerStorage.ref('stat-sheets/drills/team-a/legacy-drill/legacy-uploader/manager-existing.jpg');

            await assertSucceeds(parentObject.getMetadata());
            await assertSucceeds(parentObject.delete());
            await assertSucceeds(managerObject.getMetadata());
            await assertSucceeds(managerObject.delete());
        });

        it('allows managers and selected videographers to upload game clips through the exact 50 MB boundary', async () => {
            const ownerStorage = testEnv.authenticatedContext('owner-a', {
                email: 'owner-a@example.com',
                email_verified: true
            }).storage();
            const adminStorage = testEnv.authenticatedContext('admin-a', {
                email: 'admin-a@example.com',
                email_verified: true
            }).storage();
            const videographerStorage = testEnv.authenticatedContext('selected-videographer', {
                email: 'videographer@example.com',
                email_verified: true
            }).storage();

            await assertSucceeds(ownerStorage.ref('game-clips/team-a/game-a/owner-a/owner.mp4').put(
                new Uint8Array([1]),
                { contentType: 'video/mp4' }
            ));
            await assertSucceeds(adminStorage.ref('game-clips/team-a/game-a/admin-a/admin.webm').put(
                new Uint8Array([1]),
                { contentType: 'video/webm' }
            ));
            await assertSucceeds(videographerStorage.ref('game-clips/team-a/game-a/selected-videographer/boundary.mp4').put(
                new Uint8Array(50 * 1024 * 1024),
                { contentType: 'video/mp4' }
            ));
        }, 60000);

        it('denies unauthorized and cross-boundary game clip uploads', async () => {
            const parentStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com',
                email_verified: true
            }).storage();
            const outsiderStorage = testEnv.authenticatedContext('outsider', {
                email: 'outsider@example.com',
                email_verified: true
            }).storage();
            const videographerStorage = testEnv.authenticatedContext('selected-videographer', {
                email: 'videographer@example.com',
                email_verified: true
            }).storage();

            await assertFails(parentStorage.ref('game-clips/team-a/game-a/member-a/parent.mp4').put(
                new Uint8Array([1]),
                { contentType: 'video/mp4' }
            ));
            await assertFails(outsiderStorage.ref('game-clips/team-a/game-a/outsider/outsider.mp4').put(
                new Uint8Array([1]),
                { contentType: 'video/mp4' }
            ));
            await assertFails(videographerStorage.ref('game-clips/team-a/missing-game/selected-videographer/missing.mp4').put(
                new Uint8Array([1]),
                { contentType: 'video/mp4' }
            ));
            await assertFails(videographerStorage.ref('game-clips/team-a/cancelled-game/selected-videographer/cancelled.mp4').put(
                new Uint8Array([1]),
                { contentType: 'video/mp4' }
            ));
            await assertFails(videographerStorage.ref('game-clips/team-a/deleted-game/selected-videographer/deleted.mp4').put(
                new Uint8Array([1]),
                { contentType: 'video/mp4' }
            ));
            await assertFails(videographerStorage.ref('game-clips/team-a/game-a/another-user/mismatched.mp4').put(
                new Uint8Array([1]),
                { contentType: 'video/mp4' }
            ));
            await assertFails(videographerStorage.ref('game-clips/team-a/game-a/selected-videographer/not-video.txt').put(
                new Uint8Array([1]),
                { contentType: 'text/plain' }
            ));
            await assertFails(videographerStorage.ref('game-clips/team-a/game-a/selected-videographer/empty.mp4').put(
                new Uint8Array(0),
                { contentType: 'video/mp4' }
            ));
            await assertFails(videographerStorage.ref('game-clips/team-a/game-a/selected-videographer/oversized.mp4').put(
                new Uint8Array((50 * 1024 * 1024) + 1),
                { contentType: 'video/mp4' }
            ));
        }, 60000);

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
                memberStorage.ref('profile-photos/teams/team-a/players/player-a/player.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                memberStorage.ref('profile-photos/teams/team-b/players/player-b/cross-team.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                memberStorage.ref('profile-photos/teams/team-a/players/player-a/not-an-image.txt').put(
                    new Uint8Array([1]),
                    { contentType: 'text/plain' }
                )
            );
            await assertFails(
                memberStorage.ref('profile-photos/teams/team-a/players/player-a/too-large.jpg').put(
                    new Uint8Array((10 * 1024 * 1024) + 1),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                memberStorage.ref('profile-photos/teams/team-a/players/player-a').listAll()
            );

            const secondParentStorage = testEnv.authenticatedContext('member-b', {
                email: 'member-b@example.com',
                email_verified: true
            }).storage();
            await assertSucceeds(
                secondParentStorage.ref('profile-photos/teams/team-a/players/player-a/player.jpg').delete()
            );
            await assertSucceeds(
                secondParentStorage.ref('profile-photos/teams/team-a/players/player-a/replacement.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
        });

        it('denies player photo create and delete when only stale player parentIds grants access', async () => {
            const revokedParentStorage = testEnv.authenticatedContext('revoked-parent', {
                email: 'revoked-parent@example.com',
                email_verified: true
            }).storage();

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.storage().ref('profile-photos/teams/team-a/players/player-a/existing.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                );
            });

            await assertFails(
                revokedParentStorage.ref('profile-photos/teams/team-a/players/player-a/rejected.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                revokedParentStorage.ref('profile-photos/teams/team-a/players/player-a/existing.jpg').delete()
            );
        });

        it('applies canonical linked-parent revocation immediately despite stale player parentIds', async () => {
            const revocableParentStorage = testEnv.authenticatedContext('revocable-parent', {
                email: 'revocable-parent@example.com',
                email_verified: true
            }).storage();
            const existingPhoto = revocableParentStorage.ref(
                'profile-photos/teams/team-a/players/player-a/revocable.jpg'
            );

            await assertSucceeds(
                existingPhoto.put(new Uint8Array([1]), { contentType: 'image/jpeg' })
            );
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('users/revocable-parent').update({ parentPlayerKeys: [] });
            });

            await assertFails(existingPhoto.delete());
            await assertFails(
                revocableParentStorage.ref('profile-photos/teams/team-a/players/player-a/revoked.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
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
                unverifiedParentStorage.ref('profile-photos/teams/team-a/players/player-a/unverified-player.jpg').put(
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

            const ownerPhotoRef = ownerStorage.ref('profile-photos/teams/team-a/team/team.jpg');
            await assertSucceeds(
                ownerPhotoRef.put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                memberStorage.ref('profile-photos/teams/team-a/team/team.jpg').put(
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
                adminStorage.ref('profile-photos/teams/team-a/team/team.jpg').delete()
            );
            await assertSucceeds(
                adminStorage.ref('profile-photos/teams/team-a/team/replacement.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );

            const ownerPlayerPhotoRef = ownerStorage.ref(
                'profile-photos/teams/team-a/players/player-a/player.jpg'
            );
            await assertSucceeds(
                ownerPlayerPhotoRef.put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertSucceeds(
                adminStorage.ref('profile-photos/teams/team-a/players/player-a/player.jpg').delete()
            );
            await assertSucceeds(
                adminStorage.ref('profile-photos/teams/team-a/players/player-a/replacement.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
        });

        it('denies team-owned uploads to both conflicting legacy owner aliases', async () => {
            for (const [uid, email] of [
                ['current-alias', 'current@example.com'],
                ['former-alias', 'former@example.com']
            ]) {
                const storage = testEnv.authenticatedContext(uid, {
                    email,
                    email_verified: true
                }).storage();
                await assertFails(
                    storage.ref(`profile-photos/teams/conflicting-legacy-team/team/${uid}.jpg`).put(
                        new Uint8Array([1]),
                        { contentType: 'image/jpeg' }
                    )
                );
            }
        });

        it('keeps certificate images on signed-in primary Storage with team, owner, MIME, and size boundaries', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('securityPolicies/verifiedEmail').set({ mode: 'enforce' });
            });
            const ownerStorage = testEnv.authenticatedContext('owner-a', {
                email: 'owner-a@example.com',
                email_verified: true
            }).storage();
            const adminStorage = testEnv.authenticatedContext('admin-a', {
                email: 'admin-a@example.com',
                email_verified: true
            }).storage();
            const parentStorage = testEnv.authenticatedContext('member-a', {
                email: 'member-a@example.com',
                email_verified: true
            }).storage();
            const unverifiedOwnerStorage = testEnv.authenticatedContext('owner-a', {
                email: 'owner-a@example.com',
                email_verified: false
            }).storage();
            const ownerFirestore = testEnv.authenticatedContext('owner-a', {
                email: 'owner-a@example.com',
                email_verified: true
            }).firestore();
            const adminFirestore = testEnv.authenticatedContext('admin-a', {
                email: 'admin-a@example.com',
                email_verified: true
            }).firestore();

            const assetRef = ownerStorage.ref('certificate-assets/teams/team-a/background.png');
            await assertSucceeds(assetRef.put(new Uint8Array([1]), { contentType: 'image/png' }));
            await assertSucceeds(adminStorage.ref('certificate-assets/teams/team-a/background.png').getMetadata());
            await assertFails(parentStorage.ref('certificate-assets/teams/team-a/member.png').put(
                new Uint8Array([1]),
                { contentType: 'image/png' }
            ));
            await assertFails(ownerStorage.ref('certificate-assets/teams/team-b/cross-team.png').put(
                new Uint8Array([1]),
                { contentType: 'image/png' }
            ));
            await assertFails(ownerStorage.ref('certificate-assets/teams/team-a/not-image.txt').put(
                new Uint8Array([1]),
                { contentType: 'text/plain' }
            ));
            await assertFails(ownerStorage.ref('certificate-assets/teams/team-a/too-large.png').put(
                new Uint8Array((5 * 1024 * 1024) + 1),
                { contentType: 'image/png' }
            ));
            await assertFails(unverifiedOwnerStorage.ref('certificate-assets/teams/team-a/unverified.png').put(
                new Uint8Array([1]),
                { contentType: 'image/png' }
            ));
            await assertSucceeds(adminStorage.ref('certificate-assets/teams/team-a/background.png').delete());

            const signatureRef = ownerStorage.ref('certificate-signatures/teams/team-a/signature.webp');
            await assertSucceeds(signatureRef.put(new Uint8Array([1]), { contentType: 'image/webp' }));
            await assertSucceeds(signatureRef.getMetadata());
            await assertSucceeds(adminStorage.ref('certificate-signatures/teams/team-a/signature.webp').getMetadata());
            await assertSucceeds(adminStorage.ref('certificate-signatures/teams/team-a/admin.webp').put(
                new Uint8Array([1]),
                { contentType: 'image/webp' }
            ));
            await assertFails(parentStorage.ref('certificate-signatures/teams/team-a/parent.webp').put(
                new Uint8Array([1]),
                { contentType: 'image/webp' }
            ));
            await assertFails(ownerStorage.ref('certificate-signatures/teams/team-b/cross-team.webp').put(
                new Uint8Array([1]),
                { contentType: 'image/webp' }
            ));
            await assertSucceeds(adminStorage.ref('certificate-signatures/teams/team-a/signature.webp').delete());
            await assertFails(ownerFirestore.doc('teams/team-a/certificateSignatureCleanup/forged-owner').set({
                teamId: 'team-a',
                storagePath: 'certificate-signatures/users/victim/private.webp'
            }));
            await assertFails(adminFirestore.doc('teams/team-a/certificateSignatureCleanup/forged-admin').set({
                teamId: 'team-a',
                storagePath: 'certificate-signatures/users/victim/private.webp'
            }));
        });

        it('requires verified legacy email ownership while preserving UID-based ownership', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await context.firestore().doc('securityPolicies/verifiedEmail').set({ mode: 'enforce' });
            });

            const legacyOwnerContext = testEnv.authenticatedContext('legacy-owner-uid', {
                email: 'legacy-owner@example.com',
                email_verified: false
            });
            const legacyOwnerStorage = legacyOwnerContext.storage();
            const legacyOwnerFirestore = legacyOwnerContext.firestore();
            const verifiedLegacyOwnerContext = testEnv.authenticatedContext('legacy-owner-uid', {
                email: 'legacy-owner@example.com',
                email_verified: true
            });
            const verifiedLegacyOwnerStorage = verifiedLegacyOwnerContext.storage();
            const verifiedLegacyOwnerFirestore = verifiedLegacyOwnerContext.firestore();
            const canonicalOwnerContext = testEnv.authenticatedContext('owner-a', {
                email: 'owner-a@example.com',
                email_verified: false
            });

            await assertFails(legacyOwnerFirestore.doc('teams/team-a').get());
            await assertFails(
                legacyOwnerFirestore.collection('teams').where('ownerEmail', '==', 'legacy-owner@example.com').get()
            );
            await assertFails(
                legacyOwnerStorage.ref('stat-sheets/team-chat/team-a/team/legacy-owner-uid/former-owner-photo.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertSucceeds(canonicalOwnerContext.firestore().doc('teams/team-a').get());
            await assertSucceeds(
                canonicalOwnerContext.storage().ref('team-media/team-a/folder-a/owner-a/existing.jpg').getMetadata()
            );

            await assertFails(legacyOwnerFirestore.doc('teams/legacy-team').get());
            await assertFails(
                legacyOwnerStorage.ref('stat-sheets/team-chat/legacy-team/team/legacy-owner-uid/legacy-owner-photo.jpg').put(
                    new Uint8Array([1]),
                    { contentType: 'image/jpeg' }
                )
            );
            await assertFails(
                legacyOwnerFirestore.doc('teams/legacy-team/players/legacy-player/private/profile').get()
            );
            await assertFails(
                legacyOwnerFirestore.doc('teams/legacy-team/mediaItems/private-item').get()
            );
            await assertFails(
                legacyOwnerStorage.ref('team-email-attachments/legacy-team/draft-a/legacy-owner-uid/existing.txt').getMetadata()
            );

            await assertSucceeds(verifiedLegacyOwnerFirestore.doc('teams/legacy-team').get());
            await assertSucceeds(
                verifiedLegacyOwnerFirestore.doc('teams/legacy-team/players/legacy-player/private/profile').get()
            );
            await assertSucceeds(
                verifiedLegacyOwnerFirestore.doc('teams/legacy-team/mediaItems/private-item').get()
            );
            await assertSucceeds(
                verifiedLegacyOwnerStorage.ref('team-email-attachments/legacy-team/draft-a/legacy-owner-uid/existing.txt').getMetadata()
            );
            await assertSucceeds(
                verifiedLegacyOwnerStorage.ref('stat-sheets/team-chat/legacy-team/team/legacy-owner-uid/legacy-owner-photo.jpg').put(
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
