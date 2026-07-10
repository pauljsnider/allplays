import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

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
        expect(source).toContain("request.resource.data.get('status', '') in ['pending', 'accepted', 'declined', 'removed', 'blocked']");
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
        });

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
