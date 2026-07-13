import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    runTransaction,
    serverTimestamp,
    setDoc,
    Timestamp,
    updateDoc,
    where
} from 'firebase/firestore';

function rulesSource() {
    return readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
}

const immutableSocialPostScopeFields = [
    'authorId',
    'teamId',
    'teamIds',
    'visibility',
    'visibleUserIds',
    'createdAt',
    'snapshot'
];

const authorSocialPostContentFields = [
    'title',
    'detail',
    'caption',
    'media',
    'updatedAt'
];

const moderatorSocialPostFields = [
    'hidden',
    'hiddenBy',
    'hiddenAt',
    'reportCount',
    'lastReportedBy',
    'lastReportedAt',
    'moderationStatus',
    'moderationReason',
    'moderatedBy',
    'moderatedAt',
    'updatedAt'
];

const ownerPublicProfilePresentationFields = [
    'displayName',
    'fullName',
    'photoUrl',
    'updatedAt'
];

function hasOnly(values, allowed) {
    return values.every((value) => allowed.includes(value));
}

function hasAny(values, candidates) {
    return values.some((value) => candidates.includes(value));
}

function isAuthorSocialPostContentUpdateValid({ actorId, authorId, affectedKeys }) {
    return actorId === authorId &&
        !hasAny(affectedKeys, immutableSocialPostScopeFields) &&
        hasOnly(affectedKeys, authorSocialPostContentFields);
}

function isAuthorSocialPostHideUpdateValid({ actorId, authorId, affectedKeys, hidden, hiddenBy }) {
    return actorId === authorId &&
        !hasAny(affectedKeys, immutableSocialPostScopeFields) &&
        hasOnly(affectedKeys, ['hidden', 'hiddenBy', 'hiddenAt', 'updatedAt']) &&
        hidden === true &&
        hiddenBy === actorId;
}

function isModeratorSocialPostUpdateValid({ canModerate, affectedKeys }) {
    return canModerate &&
        !hasAny(affectedKeys, immutableSocialPostScopeFields) &&
        hasOnly(affectedKeys, moderatorSocialPostFields);
}

function isOwnerPublicProfilePresentationWriteValid({ affectedKeys, create = false }) {
    return hasOnly(affectedKeys, ownerPublicProfilePresentationFields) &&
        (create ? !hasAny(affectedKeys, ['discoveryTeamIds', 'emailHash']) : true);
}

function isOwnerUserEmailUpdateValid({ affectedKeys, nextEmail, authEmail }) {
    return !hasAny(affectedKeys, ['email']) ||
        String(nextEmail || '').toLowerCase() === String(authEmail || '').toLowerCase();
}

function isOwnerUserMembershipUpdateValid({ affectedKeys }) {
    return !hasAny(affectedKeys, ['parentOf', 'parentTeamIds', 'parentPlayerKeys', 'playerKeys']);
}

describe('React app social Firestore rules', () => {
    it('adds least-privilege collections for social posts, reactions, comments, reports, and friendships', () => {
        const source = rulesSource();

        expect(source).toContain('function canReadSocialPost(data)');
        expect(source).toContain('function isSocialPostCreatePayloadValid(data)');
        expect(source).toContain('function canModerateSocialPost(data)');
        expect(source).toContain('function socialPostImmutableScopeFields()');
        expect(source).toContain('function isSocialPostAuthorContentUpdateValid()');
        expect(source).toContain('function isSocialPostAuthorHideUpdateValid()');
        expect(source).toContain('function isSocialPostModeratorUpdateValid()');
        expect(source).toContain('match /socialPosts/{postId}');
        expect(source).toContain('match /comments/{commentId}');
        expect(source).toContain('match /reactions/{userId}');
        expect(source).toContain('match /friendships/{friendshipId}');
        expect(source).toContain('match /socialReports/{reportId}');
        expect(source).toContain("request.auth.uid in data.get('visibleUserIds', [])");
        expect(source).toContain("data.get('teamId', '') != '' &&");
        expect(source).toContain("isTeamOwnerOrAdmin(data.get('teamId', ''))");
        expect(source).toContain('function isFriendshipMemberUpdatePayloadValid()');
    });

    it('permits accepted friendship creation only during atomic friend invite redemption', () => {
        const source = rulesSource();

        expect(source).toContain('function isFriendInviteAcceptedFriendshipCreateValid(friendshipId, data)');
        expect(source).toContain('function isFriendInviteAcceptedFriendshipUpdateValid(friendshipId)');
        expect(source).toContain('let codePath = /databases/$(database)/documents/accessCodes/$(codeId);');
        expect(source).toContain('let codeBefore = get(codePath).data;');
        expect(source).toContain('exists(codePath)');
        expect(source).toContain('existsAfter(codePath)');
        expect(source).toContain('function buildFriendshipId(firstUserId, secondUserId)');
        expect(source).toContain('data.get(\'memberIds\', []).size() == 2');
        expect(source).toContain("friendshipId == buildFriendshipId(data.get('requesterId', ''), request.auth.uid)");
        expect(source).toContain("codeBefore.get('used', false) == false");
        expect(source).toContain("codeBefore.get('usedBy', null) == null");
        expect(source).toContain("codeBefore.get('usedAt', null) == null");
        expect(source).toContain("codeAfter.get('type', null) == 'friend_invite'");
        expect(source).toContain("codeAfter.get('generatedBy', '') == data.get('requesterId', '')");
        expect(source).toContain("codeAfter.get('usedBy', '') == request.auth.uid");
        expect(source).toContain("allow create: if isFriendshipCreatePayloadValid(friendshipId, request.resource.data) ||");
        expect(source).toContain("isFriendInviteAcceptedFriendshipCreateValid(friendshipId, request.resource.data)");
        expect(source).toContain("allow update: if isFriendInviteAcceptedFriendshipUpdateValid(friendshipId) ||");
        expect(source).toContain("request.resource.data.get('source', '') == 'friend_invite'");
        expect(source).toContain("request.resource.data.get('inviteCodeId', '') == codeId");
        expect(source).toContain("friendshipId == buildFriendshipId(codeAfter.get('generatedBy', ''), request.auth.uid)");
    });

    it('prevents member updates from reactivating blocked friendships', () => {
        const source = rulesSource();

        expect(source).toContain("resource.data.get('status', '') != 'blocked'");
        expect(source).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n               'requesterId',");
        expect(source).toContain("request.resource.data.get('requesterId', '') == resource.data.get('requesterId', '')");
        expect(source).toContain("request.resource.data.get('recipientId', '') == resource.data.get('recipientId', '')");
        expect(source).toContain("request.resource.data.get('blockedBy', resource.data.get('blockedBy', [])) == resource.data.get('blockedBy', [])");
        expect(source).toContain("request.resource.data.get('status', '') == 'blocked'");
        expect(source).toContain("request.auth.uid in request.resource.data.get('blockedBy', [])");
        expect(source).toContain('isFriendInviteAcceptedFriendshipUpdateValid(friendshipId) ||\n                    isFriendshipMemberUpdatePayloadValid() ||');
    });

    it('excludes friend invites from the owner update fallback after redemption', () => {
        const source = rulesSource();

        expect(source).toContain("isFriendInviteRedemptionUpdate() ||");
        expect(source).toContain("resource.data.get('type', null) != 'friend_invite' &&");
    });

    it('allows only direct GET reads for phone-only friend invite code redemption', () => {
        const source = rulesSource();

        expect(source).toContain('function canGetPhoneOnlyFriendInviteAccessCode(data)');
        expect(source).toContain("data.get('type', null) == 'friend_invite'");
        expect(source).toContain("data.get('email', null) == null");
        expect(source).toContain("data.get('phone', null) is string");
        expect(source).toContain("data.get('used', false) == false");
        expect(source).toContain("data.get('expiresAt', null) > request.time");
        expect(source).toContain('allow get: if resource == null || canReadAccessCode(resource.data) || canGetPhoneOnlyFriendInviteAccessCode(resource.data);');
        expect(source).toContain('allow list: if canReadAccessCode(resource.data);');
    });

    it('limits missing friendship reads to exact participant GET paths', () => {
        const source = rulesSource();

        expect(source).toContain('function canGetMissingFriendship(friendshipId)');
        expect(source).toContain('!exists(friendshipPath)');
        expect(source).toContain("friendshipId.matches('^' + request.auth.uid + '__.+$')");
        expect(source).toContain("friendshipId.matches('^.+__' + request.auth.uid + '$')");
        expect(source).toContain('allow get: if canGetMissingFriendship(friendshipId) ||');
        expect(source).toContain('function canListFriendship(data)');
        expect(source).toContain("data.get('requesterId', '') == request.auth.uid");
        expect(source).toContain("data.get('recipientId', '') == request.auth.uid");
        expect(source).toContain('allow list: if canListFriendship(resource.data) || isGlobalAdmin();');
    });

    it('locks down top-level users docs and routes discovery through projected public profiles', () => {
        const source = rulesSource();

        expect(source).toContain('match /publicUserProfiles/{userId}');
        expect(source).toContain('function canReadPublicUserProfile(userId, data)');
        expect(source).toContain("data.get('discoveryTeamIds', []).hasAny(currentUserPublicProfileTeamIds())");
        expect(source).toContain("data.keys().hasOnly(['displayName', 'fullName', 'photoUrl', 'discoveryTeamIds', 'emailHash', 'updatedAt'])");
        expect(source).toContain("!data.keys().hasAny(['email', 'phone', 'parentOf', 'parentTeamIds', 'parentPlayerKeys'])");
        expect(source).toContain("function userMembershipFields()");
        expect(source).toContain("return ['parentOf', 'parentTeamIds', 'parentPlayerKeys', 'playerKeys'];");
        expect(source).toContain("(isOwner(userId) && isOwnerUserCreatePayloadValid(request.resource.data))");
        expect(source).toContain("(isOwner(userId) && isOwnerUserUpdatePayloadValid())");
        expect(source).toContain('function isOwnerUserEmailAuthBound(data)');
        expect(source).toContain("data.email.lower() == request.auth.token.email.lower()");
        expect(source).toContain("(!request.resource.data.diff(resource.data).affectedKeys().hasAny(['email']) ||");
        expect(source).toContain('allow get: if isGlobalAdmin() || isOwner(userId);');
        expect(source).toContain('allow list: if isBoundedGlobalAdminListQuery() || isOwner(userId);');
        expect(source).not.toContain('allow read: if true;  // Public profiles');

        expect(isOwnerUserEmailUpdateValid({
            affectedKeys: ['displayName', 'updatedAt'],
            nextEmail: 'forged@example.com',
            authEmail: 'owner@example.com'
        })).toBe(true);
        expect(isOwnerUserEmailUpdateValid({
            affectedKeys: ['email', 'updatedAt'],
            nextEmail: 'Owner@Example.com',
            authEmail: 'owner@example.com'
        })).toBe(true);
        expect(isOwnerUserEmailUpdateValid({
            affectedKeys: ['email', 'updatedAt'],
            nextEmail: 'forged@example.com',
            authEmail: 'owner@example.com'
        })).toBe(false);
        expect(isOwnerUserMembershipUpdateValid({
            affectedKeys: ['displayName', 'updatedAt']
        })).toBe(true);
        expect(isOwnerUserMembershipUpdateValid({
            affectedKeys: ['parentOf']
        })).toBe(false);
        expect(isOwnerUserMembershipUpdateValid({
            affectedKeys: ['parentTeamIds', 'parentPlayerKeys']
        })).toBe(false);
    });

    it('prevents profile owners from forging public discovery team ids or email hashes', () => {
        const source = rulesSource();

        expect(source).toContain('function isOwnerPublicUserProfilePresentationCreateValid(userId)');
        expect(source).toContain('function isOwnerPublicUserProfilePresentationUpdateValid(userId)');
        expect(source).toContain("request.resource.data.keys().hasOnly(['displayName', 'fullName', 'photoUrl', 'updatedAt'])");
        expect(source).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly(['displayName', 'fullName', 'photoUrl', 'updatedAt'])");
        expect(source).toContain("request.resource.data.get('discoveryTeamIds', resource.data.get('discoveryTeamIds', [])) == resource.data.get('discoveryTeamIds', [])");
        expect(source).toContain("request.resource.data.get('emailHash', resource.data.get('emailHash', null)) == resource.data.get('emailHash', null)");
        expect(source).toContain('allow create: if (isGlobalAdmin() && isPublicUserProfilePayloadValid(userId, request.resource.data)) ||');
        expect(source).toContain('allow update: if (isGlobalAdmin() && isPublicUserProfilePayloadValid(userId, request.resource.data)) ||');
        expect(source).not.toContain('allow create, update: if (isGlobalAdmin() || isOwner(userId))');

        expect(isOwnerPublicProfilePresentationWriteValid({
            create: true,
            affectedKeys: ['displayName', 'fullName', 'photoUrl', 'updatedAt']
        })).toBe(true);
        expect(isOwnerPublicProfilePresentationWriteValid({
            create: true,
            affectedKeys: ['displayName', 'discoveryTeamIds', 'updatedAt']
        })).toBe(false);
        expect(isOwnerPublicProfilePresentationWriteValid({
            affectedKeys: ['emailHash', 'updatedAt']
        })).toBe(false);
        expect(isOwnerPublicProfilePresentationWriteValid({
            affectedKeys: ['discoveryTeamIds', 'updatedAt']
        })).toBe(false);
    });

    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('public profile rules engine coverage', () => {
        let testEnv;

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: `allplays-public-profile-rules-${Date.now()}`,
                firestore: {
                    rules: rulesSource()
                }
            });
        }, 30_000);

        beforeEach(async () => {
            await testEnv.clearFirestore();
        });

        afterAll(async () => {
            await testEnv?.cleanup();
        });

        function profileRef(uid, context = testEnv.authenticatedContext(uid, { email: `${uid}@example.com` })) {
            return doc(context.firestore(), 'publicUserProfiles', uid);
        }

        async function seedPublicProfile(uid, data = {}) {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'publicUserProfiles', uid), {
                    displayName: 'Owner',
                    fullName: 'Profile Owner',
                    photoUrl: null,
                    discoveryTeamIds: ['team-1'],
                    emailHash: 'trusted-hash',
                    updatedAt: serverTimestamp(),
                    ...data
                });
            });
        }

        it('allows owner presentation-only creates and merge updates', async () => {
            const owner = testEnv.authenticatedContext('owner-1', { email: 'owner-1@example.com' });

            await assertSucceeds(setDoc(profileRef('owner-1', owner), {
                displayName: 'Owner',
                fullName: 'Owner One',
                photoUrl: null,
                updatedAt: serverTimestamp()
            }));

            await assertSucceeds(setDoc(profileRef('owner-1', owner), {
                displayName: 'Owner Updated',
                updatedAt: serverTimestamp()
            }, { merge: true }));
        });

        it('denies owner creates and merge updates that write trusted discovery fields', async () => {
            const owner = testEnv.authenticatedContext('owner-2', { email: 'owner-2@example.com' });

            await assertFails(setDoc(profileRef('owner-2', owner), {
                displayName: 'Owner',
                fullName: 'Owner Two',
                discoveryTeamIds: ['forged-team'],
                updatedAt: serverTimestamp()
            }));

            await assertFails(setDoc(profileRef('owner-2', owner), {
                displayName: 'Owner',
                fullName: 'Owner Two',
                emailHash: 'forged-hash',
                updatedAt: serverTimestamp()
            }));

            await seedPublicProfile('owner-2');
            await assertFails(setDoc(profileRef('owner-2', owner), {
                discoveryTeamIds: ['forged-team'],
                updatedAt: serverTimestamp()
            }, { merge: true }));

            await assertFails(setDoc(profileRef('owner-2', owner), {
                emailHash: 'forged-hash',
                updatedAt: serverTimestamp()
            }, { merge: true }));
        });

        it('denies non-owner public profile updates', async () => {
            await seedPublicProfile('owner-3');
            const otherUser = testEnv.authenticatedContext('other-user', { email: 'other-user@example.com' });

            await assertFails(setDoc(profileRef('owner-3', otherUser), {
                displayName: 'Other User Edit',
                updatedAt: serverTimestamp()
            }, { merge: true }));
        });

        it('denies owner writes to membership fields while allowing presentation profile updates', async () => {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'users', 'owner-membership'), {
                    email: 'owner-membership@example.com',
                    displayName: 'Owner',
                    parentOf: [],
                    parentTeamIds: [],
                    parentPlayerKeys: []
                });
            });
            const owner = testEnv.authenticatedContext('owner-membership', { email: 'owner-membership@example.com' });
            const userRef = doc(owner.firestore(), 'users', 'owner-membership');

            await assertSucceeds(updateDoc(userRef, {
                displayName: 'Owner Updated'
            }));
            await assertFails(updateDoc(userRef, {
                parentOf: [{ teamId: 'team-1', playerId: 'player-1' }]
            }));
            await assertFails(updateDoc(userRef, {
                parentTeamIds: ['team-1'],
                parentPlayerKeys: ['team-1::player-1']
            }));
        });
    });

    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('friend invite rules engine coverage', () => {
        let testEnv;

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: `allplays-friend-invite-rules-${Date.now()}`,
                firestore: {
                    rules: rulesSource()
                }
            });
        }, 30_000);

        beforeEach(async () => {
            await testEnv.clearFirestore();
        });

        afterAll(async () => {
            await testEnv?.cleanup();
        });

        function authenticatedDb(uid) {
            return testEnv.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
        }

        function accessCodePayload({ codeId, inviterId, inviteeId, email = `${inviteeId}@example.com`, phone = null }) {
            return {
                code: codeId,
                type: 'friend_invite',
                generatedBy: inviterId,
                email,
                phone,
                inviterProfile: {
                    displayName: 'Invite Sender',
                    fullName: 'Invite Sender',
                    photoUrl: null,
                    discoveryTeamIds: []
                },
                createdAt: Timestamp.fromMillis(Date.now() - 60_000),
                expiresAt: Timestamp.fromMillis(Date.now() + 86_400_000),
                used: false,
                usedBy: null,
                usedAt: null
            };
        }

        function acceptedFriendshipPayload({
            codeId,
            inviterId,
            inviteeId,
            existingFriendship = {},
            blockedBy = []
        }) {
            const now = Timestamp.now();
            return {
                requesterId: existingFriendship.requesterId || inviterId,
                recipientId: existingFriendship.recipientId || inviteeId,
                memberIds: existingFriendship.memberIds || [inviterId, inviteeId].sort(),
                status: 'accepted',
                sharedTeamIds: [],
                sharedTeamNames: [],
                blockedBy,
                source: 'friend_invite',
                inviteCodeId: codeId,
                createdAt: existingFriendship.createdAt || now,
                acceptedAt: now,
                respondedAt: now,
                updatedAt: now
            };
        }

        async function seedInvite({ codeId, inviterId, inviteeId, email, phone, friendship = null }) {
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const db = context.firestore();
                await setDoc(
                    doc(db, 'accessCodes', codeId),
                    accessCodePayload({ codeId, inviterId, inviteeId, email, phone })
                );
                await setDoc(doc(db, 'users', inviteeId), {
                    email: `${inviteeId}@example.com`,
                    isAdmin: false
                });
                if (friendship) {
                    await setDoc(
                        doc(db, 'friendships', [inviterId, inviteeId].sort().join('__')),
                        friendship
                    );
                }
            });
        }

        async function redeemInviteTransaction(db, { codeId, inviterId, inviteeId, blockedBy = [] }) {
            const codeRef = doc(db, 'accessCodes', codeId);
            const friendshipRef = doc(db, 'friendships', [inviterId, inviteeId].sort().join('__'));

            return runTransaction(db, async (transaction) => {
                const codeSnapshot = await transaction.get(codeRef);
                const friendshipSnapshot = await transaction.get(friendshipRef);
                const existingFriendship = friendshipSnapshot.exists()
                    ? friendshipSnapshot.data()
                    : {};
                const acceptedFriendship = acceptedFriendshipPayload({
                    codeId,
                    inviterId,
                    inviteeId,
                    existingFriendship,
                    blockedBy
                });

                if (friendshipSnapshot.exists()) {
                    transaction.update(friendshipRef, acceptedFriendship);
                } else {
                    transaction.set(friendshipRef, acceptedFriendship);
                }
                transaction.update(codeRef, {
                    used: true,
                    usedBy: inviteeId,
                    usedAt: Timestamp.now()
                });

                return codeSnapshot.exists();
            });
        }

        it('allows an exact path participant to read a missing doc and atomically create a friendship', async () => {
            const inviterId = 'inviter-first';
            const inviteeId = 'invitee-first';
            const codeId = 'FRIENDFIRST';
            const inviteeDb = authenticatedDb(inviteeId);
            const friendshipId = [inviterId, inviteeId].sort().join('__');
            const friendshipRef = doc(inviteeDb, 'friendships', friendshipId);

            await seedInvite({ codeId, inviterId, inviteeId });

            const missingSnapshot = await assertSucceeds(getDoc(friendshipRef));
            expect(missingSnapshot.exists()).toBe(false);
            await assertFails(getDoc(doc(authenticatedDb('unrelated-user'), 'friendships', friendshipId)));
            await assertFails(getDocs(collection(inviteeDb, 'friendships')));

            await assertSucceeds(redeemInviteTransaction(inviteeDb, { codeId, inviterId, inviteeId }));

            const createdSnapshot = await assertSucceeds(getDoc(friendshipRef));
            expect(createdSnapshot.data()).toMatchObject({
                memberIds: [inviteeId, inviterId],
                status: 'accepted',
                source: 'friend_invite',
                inviteCodeId: codeId
            });
        });

        it('denies friendship creation from an already redeemed friend invite code', async () => {
            const inviterId = 'inviter-used-code';
            const inviteeId = 'invitee-used-code';
            const codeId = 'FRIENDUSED';
            const inviteeDb = authenticatedDb(inviteeId);
            const friendshipId = [inviterId, inviteeId].sort().join('__');
            const friendshipRef = doc(inviteeDb, 'friendships', friendshipId);

            await seedInvite({ codeId, inviterId, inviteeId });
            await testEnv.withSecurityRulesDisabled(async (context) => {
                await updateDoc(doc(context.firestore(), 'accessCodes', codeId), {
                    used: true,
                    usedBy: inviteeId,
                    usedAt: Timestamp.now()
                });
            });

            await assertFails(setDoc(friendshipRef, acceptedFriendshipPayload({
                codeId,
                inviterId,
                inviteeId
            })));

            const missingSnapshot = await assertSucceeds(getDoc(friendshipRef));
            expect(missingSnapshot.exists()).toBe(false);
        });

        it('allows direct code reads for phone-only friend invites without opening collection list reads', async () => {
            const inviterId = 'inviter-phone';
            const inviteeId = 'invitee-phone';
            const codeId = 'FRIENDPHONE';
            const inviteeDb = authenticatedDb(inviteeId);

            await seedInvite({
                codeId,
                inviterId,
                inviteeId,
                email: null,
                phone: '+15555550123'
            });

            const codeSnapshot = await assertSucceeds(getDoc(doc(inviteeDb, 'accessCodes', codeId)));
            expect(codeSnapshot.data()).toMatchObject({
                type: 'friend_invite',
                email: null,
                phone: '+15555550123',
                used: false
            });
            await assertFails(getDocs(collection(inviteeDb, 'accessCodes')));
            await assertSucceeds(redeemInviteTransaction(inviteeDb, { codeId, inviterId, inviteeId }));
        });

        it('allows a member to read and atomically accept an existing pending friendship', async () => {
            const inviterId = 'inviter-pending';
            const inviteeId = 'invitee-pending';
            const codeId = 'FRIENDPENDING';
            const inviteeDb = authenticatedDb(inviteeId);
            const friendshipId = [inviterId, inviteeId].sort().join('__');
            const createdAt = Timestamp.fromMillis(Date.now() - 60_000);
            const pendingFriendship = {
                requesterId: inviterId,
                recipientId: inviteeId,
                memberIds: [inviterId, inviteeId].sort(),
                status: 'pending',
                sharedTeamIds: [],
                sharedTeamNames: [],
                blockedBy: [],
                createdAt,
                respondedAt: createdAt,
                updatedAt: createdAt
            };

            await seedInvite({ codeId, inviterId, inviteeId, friendship: pendingFriendship });

            await assertSucceeds(getDoc(doc(inviteeDb, 'friendships', friendshipId)));
            await assertSucceeds(redeemInviteTransaction(inviteeDb, { codeId, inviterId, inviteeId }));

            const updatedSnapshot = await assertSucceeds(getDoc(doc(inviteeDb, 'friendships', friendshipId)));
            expect(updatedSnapshot.data()).toMatchObject({
                status: 'accepted',
                source: 'friend_invite',
                inviteCodeId: codeId,
                createdAt
            });
        });

        it('denies blocked friendship redemption and leaves both documents unchanged', async () => {
            const inviterId = 'inviter-blocked';
            const inviteeId = 'invitee-blocked';
            const codeId = 'FRIENDBLOCKED';
            const inviteeDb = authenticatedDb(inviteeId);
            const friendshipId = [inviterId, inviteeId].sort().join('__');
            const createdAt = Timestamp.fromMillis(Date.now() - 60_000);
            const blockedFriendship = {
                requesterId: inviterId,
                recipientId: inviteeId,
                memberIds: [inviterId, inviteeId].sort(),
                status: 'blocked',
                sharedTeamIds: [],
                sharedTeamNames: [],
                blockedBy: [inviterId],
                createdAt,
                respondedAt: createdAt,
                updatedAt: createdAt
            };

            await seedInvite({ codeId, inviterId, inviteeId, friendship: blockedFriendship });

            await assertFails(redeemInviteTransaction(inviteeDb, {
                codeId,
                inviterId,
                inviteeId,
                blockedBy: []
            }));

            const friendshipSnapshot = await assertSucceeds(
                getDoc(doc(inviteeDb, 'friendships', friendshipId))
            );
            const codeSnapshot = await assertSucceeds(getDoc(doc(inviteeDb, 'accessCodes', codeId)));
            expect(friendshipSnapshot.data()).toMatchObject({
                status: 'blocked',
                blockedBy: [inviterId]
            });
            expect(codeSnapshot.data()).toMatchObject({
                used: false,
                usedBy: null,
                usedAt: null
            });
        });

        it('does not expose existing non-member friendships through deterministic path GETs', async () => {
            const attackerId = 'attacker-user';
            const otherId = 'other-user';
            const friendshipId = [attackerId, otherId].sort().join('__');

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'friendships', friendshipId), {
                    requesterId: 'member-a',
                    recipientId: 'member-b',
                    memberIds: ['member-a', 'member-b'],
                    status: 'accepted'
                });
            });

            await assertFails(getDoc(doc(authenticatedDb(attackerId), 'friendships', friendshipId)));
        });

        it('denies member updates that rewrite requester or recipient list keys', async () => {
            const requesterId = 'friend-key-requester';
            const recipientId = 'friend-key-recipient';
            const friendshipId = [requesterId, recipientId].sort().join('__');
            const recipientDb = authenticatedDb(recipientId);

            await testEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'friendships', friendshipId), {
                    requesterId,
                    recipientId,
                    memberIds: [requesterId, recipientId].sort(),
                    status: 'accepted',
                    sharedTeamIds: [],
                    sharedTeamNames: [],
                    blockedBy: []
                });
            });

            await assertFails(updateDoc(doc(recipientDb, 'friendships', friendshipId), {
                requesterId: recipientId
            }));
            await assertFails(updateDoc(doc(recipientDb, 'friendships', friendshipId), {
                recipientId: requesterId
            }));
            await assertSucceeds(updateDoc(doc(recipientDb, 'friendships', friendshipId), {
                status: 'removed'
            }));
        });

        it('lists friendships through requester and recipient equality queries only', async () => {
            const userId = 'friend-list-user';
            const userDb = authenticatedDb(userId);

            await testEnv.withSecurityRulesDisabled(async (context) => {
                const db = context.firestore();
                await setDoc(doc(db, 'friendships', 'friend-a__friend-list-user'), {
                    requesterId: 'friend-a',
                    recipientId: userId,
                    memberIds: ['friend-a', userId],
                    status: 'pending'
                });
                await setDoc(doc(db, 'friendships', 'friend-b__friend-list-user'), {
                    requesterId: userId,
                    recipientId: 'friend-b',
                    memberIds: [userId, 'friend-b'],
                    status: 'accepted'
                });
                await setDoc(doc(db, 'friendships', 'friend-c__friend-d'), {
                    requesterId: 'friend-c',
                    recipientId: 'friend-d',
                    memberIds: ['friend-c', 'friend-d'],
                    status: 'accepted'
                });
            });

            const requested = await assertSucceeds(getDocs(query(
                collection(userDb, 'friendships'),
                where('requesterId', '==', userId)
            )));
            const received = await assertSucceeds(getDocs(query(
                collection(userDb, 'friendships'),
                where('recipientId', '==', userId)
            )));

            expect(requested.docs.map((entry) => entry.id)).toEqual(['friend-b__friend-list-user']);
            expect(received.docs.map((entry) => entry.id)).toEqual(['friend-a__friend-list-user']);
            await assertFails(getDocs(collection(userDb, 'friendships')));
            await assertFails(getDocs(query(
                collection(userDb, 'friendships'),
                where('memberIds', 'array-contains', userId)
            )));
            await assertFails(getDocs(query(
                collection(userDb, 'friendships'),
                where('requesterId', '==', 'friend-c')
            )));
        });
    });

    it('locks author social post updates to content fields without changing original visibility scope', () => {
        const source = rulesSource();

        for (const field of immutableSocialPostScopeFields) {
            expect(source).toContain(`'${field}'`);
            expect(isAuthorSocialPostContentUpdateValid({
                actorId: 'author-1',
                authorId: 'author-1',
                affectedKeys: [field]
            })).toBe(false);
        }

        expect(source).toContain('!request.resource.data.diff(resource.data).affectedKeys().hasAny(socialPostImmutableScopeFields())');
        expect(source).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n               'title',");
        expect(isAuthorSocialPostContentUpdateValid({
            actorId: 'author-1',
            authorId: 'author-1',
            affectedKeys: ['title', 'detail', 'caption', 'media', 'updatedAt']
        })).toBe(true);
        expect(isAuthorSocialPostContentUpdateValid({
            actorId: 'author-1',
            authorId: 'author-1',
            affectedKeys: ['teamId', 'teamIds', 'updatedAt']
        })).toBe(false);
        expect(isAuthorSocialPostContentUpdateValid({
            actorId: 'author-1',
            authorId: 'author-1',
            affectedKeys: ['visibleUserIds', 'visibility', 'updatedAt']
        })).toBe(false);
    });

    it('allows authors to hide their own social posts without moderator permissions', () => {
        const source = rulesSource();

        expect(source).toContain('isSocialPostAuthorHideUpdateValid() ||');
        expect(source).toContain("request.resource.data.get('hidden', false) == true");
        expect(source).toContain("request.resource.data.get('hiddenBy', '') == request.auth.uid");
        expect(isAuthorSocialPostHideUpdateValid({
            actorId: 'author-1',
            authorId: 'author-1',
            affectedKeys: ['hidden', 'hiddenBy', 'hiddenAt', 'updatedAt'],
            hidden: true,
            hiddenBy: 'author-1'
        })).toBe(true);
        expect(isAuthorSocialPostHideUpdateValid({
            actorId: 'author-1',
            authorId: 'author-1',
            affectedKeys: ['hidden', 'hiddenBy', 'hiddenAt', 'updatedAt'],
            hidden: true,
            hiddenBy: 'other-user'
        })).toBe(false);
        expect(isAuthorSocialPostHideUpdateValid({
            actorId: 'author-1',
            authorId: 'author-1',
            affectedKeys: ['hidden', 'hiddenBy', 'hiddenAt', 'updatedAt'],
            hidden: false,
            hiddenBy: 'author-1'
        })).toBe(false);
        expect(isAuthorSocialPostHideUpdateValid({
            actorId: 'author-1',
            authorId: 'author-1',
            affectedKeys: ['hidden', 'hiddenBy', 'hiddenAt', 'teamIds', 'updatedAt'],
            hidden: true,
            hiddenBy: 'author-1'
        })).toBe(false);
        expect(isAuthorSocialPostHideUpdateValid({
            actorId: 'author-1',
            authorId: 'other-author',
            affectedKeys: ['hidden', 'hiddenBy', 'hiddenAt', 'updatedAt'],
            hidden: true,
            hiddenBy: 'author-1'
        })).toBe(false);
    });

    it('keeps moderator social post updates limited to hide and report metadata', () => {
        const source = rulesSource();

        expect(source).toContain('canModerateSocialPost(resource.data)');
        expect(source).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n               'hidden',");
        expect(isModeratorSocialPostUpdateValid({
            canModerate: true,
            affectedKeys: ['hidden', 'hiddenBy', 'hiddenAt', 'updatedAt']
        })).toBe(true);
        expect(isModeratorSocialPostUpdateValid({
            canModerate: true,
            affectedKeys: ['reportCount', 'lastReportedBy', 'lastReportedAt', 'updatedAt']
        })).toBe(true);
        expect(isModeratorSocialPostUpdateValid({
            canModerate: true,
            affectedKeys: ['hidden', 'teamIds', 'updatedAt']
        })).toBe(false);
        expect(isModeratorSocialPostUpdateValid({
            canModerate: false,
            affectedKeys: ['hidden', 'hiddenBy', 'hiddenAt', 'updatedAt']
        })).toBe(false);
    });
});
