import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

function rulesSource() {
    return readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
}

const matchingDetailFields = [
    'kind',
    'sport',
    'ageGroup',
    'city',
    'state',
    'zip',
    'positions',
    'level',
    'timeframe',
    'openSpots',
    'playerFirstName',
    'signupUrl'
];

const matchingResponseFields = [
    'responderId',
    'responderName',
    'responderPhotoUrl',
    'teamId',
    'teamName',
    'message',
    'createdAt',
    'updatedAt'
];

function futureTimestamp(days = 30) {
    return Timestamp.fromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

function matchingDetails(overrides = {}) {
    return {
        kind: 'player_seeking_team',
        sport: 'Soccer',
        ageGroup: 'U12',
        city: 'Austin',
        state: 'TX',
        zip: '',
        positions: 'Midfield',
        level: 'Recreational',
        timeframe: 'Spring',
        openSpots: null,
        playerFirstName: 'Avery',
        signupUrl: '',
        ...overrides
    };
}

function matchingPostPayload(overrides = {}) {
    const matching = {
        ...matchingDetails(),
        ...(overrides.matching || {})
    };
    const payload = {
        type: matching.kind,
        visibility: 'community',
        status: 'open',
        authorId: 'author-1',
        authorName: 'Pat Parent',
        authorPhotoUrl: null,
        teamId: null,
        teamName: null,
        teamIds: [],
        playerIds: [],
        playerNames: matching.playerFirstName ? [matching.playerFirstName] : [],
        title: `${matching.playerFirstName} (${matching.ageGroup} ${matching.sport}) is looking for a team`,
        detail: `${matching.ageGroup} ${matching.sport} - ${matching.city}, ${matching.state}`,
        caption: 'Looking for a spring team.',
        media: [],
        matching,
        visibleUserIds: ['author-1'],
        expiresAt: futureTimestamp(),
        hidden: false,
        reportCount: 0,
        reactionCounts: {},
        commentCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...overrides
    };
    if (overrides.matching) {
        payload.matching = matching;
    }
    return payload;
}

function teamMatchingPostPayload(overrides = {}) {
    const matching = {
        ...matchingDetails({
            kind: 'team_seeking_players',
            openSpots: 2,
            playerFirstName: '',
            signupUrl: 'https://allplays.ai/signup'
        }),
        ...(overrides.matching || {})
    };
    const payload = matchingPostPayload({
        type: 'team_seeking_players',
        authorId: 'owner-1',
        authorName: 'Coach Owner',
        teamId: 'team-1',
        teamName: 'Tigers',
        teamIds: ['team-1'],
        playerNames: [],
        title: `Tigers (${matching.ageGroup} ${matching.sport}) is looking for players`,
        detail: `${matching.ageGroup} ${matching.sport} - ${matching.city}, ${matching.state} - ${matching.openSpots} open spots`,
        matching,
        visibleUserIds: ['owner-1'],
        ...overrides
    });
    if (overrides.matching) {
        payload.matching = matching;
    }
    return payload;
}

function matchingResponsePayload(overrides = {}) {
    return {
        responderId: 'responder-1',
        responderName: 'Coach Responder',
        responderPhotoUrl: null,
        teamId: 'team-1',
        teamName: 'Tigers',
        message: 'We have a roster spot and would like to connect in app.',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...overrides
    };
}

describe('Player/team matching feed Firestore rules', () => {
    it('restricts community visibility to the two matching post types with a strict payload', () => {
        const source = rulesSource();

        expect(source).toContain('function isMatchingSocialPostType(value)');
        expect(source).toContain("return value in ['player_seeking_team', 'team_seeking_players'];");
        expect(source).toContain('function isCommunityMatchingPostCreateValid(data)');
        expect(source).toContain('function isCommunityMatchingPostContractValid(data)');
        expect(source).toContain("data.get('visibility', '') == 'community' &&");
        expect(source).toContain("data.get('status', '') == 'open' &&");
        expect(source).toContain('data.keys().hasOnly(communityMatchingPostFields())');
        expect(source).toContain("data.get('expiresAt', null) is timestamp &&");
        expect(source).toContain("data.get('expiresAt', null) > request.time &&");
        expect(source).toContain("data.get('expiresAt', null) <= request.time + duration.value(90, 'd') &&");
        expect(source).toContain('hasNoCommunityMatchingPostContactInfo(data) &&');
        expect(source).toContain("data.get('authorName', '') + ' ' +");
        expect(source).toContain("matching.get('signupUrl', '')");
        expect(source).toContain("!value.matches('[\\\\s\\\\S]*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}|[0-9][0-9() .-]{8,}[0-9])[\\\\s\\\\S]*')");
        expect(source).toContain("data.get('media', []).size() == 0 &&");
        expect(source).toContain("data.get('playerIds', []).size() == 0 &&");
        expect(source).toContain('isMatchingDetailPayloadValid(data) &&');
        expect(source).toContain('isCommunityMatchingCreateScopeValid(data)');
        expect(source).toContain("!data.keys().hasAny(['authorEmail', 'email', 'phone'])");
        expect(source).toContain('isCommunityMatchingPostContractValid(data)');
        expect(source).toContain('isCommunityMatchingPostCreateValid(request.resource.data)');

        // Community visibility is NOT added to the generic social visibility list.
        expect(source).toContain("return value in ['household', 'team', 'friends', 'friends_and_team', 'public_profile'];");
    });

    it('uses multiline-safe contact-info guards', () => {
        const source = rulesSource();
        const contactGuard = source.match(/function hasNoContactInfo\(value\) \{[\s\S]*?\n    \}/)?.[0];

        expect(contactGuard).toContain('[\\\\s\\\\S]*([A-Za-z0-9._%+-]+@');
        expect(contactGuard).toContain('[A-Za-z]{2,}|');
        expect(contactGuard).toContain('|[0-9][0-9() .-]{8,}[0-9]');
        expect(contactGuard).not.toContain("matches('.*");
    });

    it('keeps the matching detail map on a field allowlist', () => {
        const source = rulesSource();
        expect(source).toContain('function matchingDetailFields()');
        expect(source).toContain('function isNonBlankString(value)');
        for (const field of matchingDetailFields) {
            expect(source).toContain(`'${field}'`);
        }
        expect(source).toContain('matching.keys().hasOnly(matchingDetailFields())');
        expect(source).toContain("matching.get('kind', '') == data.get('type', '')");
        expect(source).toContain("isNonBlankString(matching.get('sport', ''))");
        expect(source).toContain("isNonBlankString(matching.get('ageGroup', ''))");
        expect(source).toContain("isAllowedMatchingSignupUrl(matching.get('signupUrl', ''))");
        expect(source).toContain("matching.get('playerFirstName', '')");
        const signupUrlGuard = source.match(/function isAllowedMatchingSignupUrl\(value\) \{[\s\S]*?\n    \}/)?.[0];
        expect(signupUrlGuard).toContain("value.matches('https://(www[.])?allplays[.]ai/.*')");
    });

    it('requires an existing team and admin rights for team_seeking_players posts', () => {
        const source = rulesSource();
        expect(source).toContain("data.get('type', '') == 'team_seeking_players' &&");
        expect(source).toContain("exists(/databases/$(database)/documents/teams/$(data.get('teamId', ''))) &&");
        expect(source).toContain("isTeamOwnerOrAdmin(data.get('teamId', ''))");
        const teamPostGuard = source.match(/function isTeamSeekingPlayersCreateScopeValid\(data\) \{[\s\S]*?\n    \}/);
        expect(teamPostGuard?.[0]).toContain("data.get('teamName', '') == get(/databases/$(database)/documents/teams/$(data.get('teamId', ''))).data.get('name', '')");
        expect(source).toContain("data.get('type', '') == 'player_seeking_team' &&");
        expect(source).toContain("data.get('teamId', null) == null");
    });

    it('prevents direct SDK writes from widening matching post scope or derived fields', () => {
        const source = rulesSource();
        expect(source).toContain('function isCommunityMatchingCreateScopeValid(data)');
        expect(source).toContain("data.get('visibleUserIds', []) is list &&");
        expect(source).toContain("data.get('visibleUserIds', []).size() == 1 &&");
        expect(source).toContain("request.auth.uid in data.get('visibleUserIds', [])");
        expect(source).toContain('function isPlayerSeekingTeamCreateScopeValid(data)');
        expect(source).toContain("data.get('teamIds', []).size() == 0 &&");
        expect(source).toContain("matching.get('playerFirstName', '') in data.get('playerNames', [])");
        expect(source).toContain("matching.get('signupUrl', '') == ''");
        expect(source).toContain('function isTeamSeekingPlayersCreateScopeValid(data)');
        expect(source).toContain("data.get('teamIds', []).size() == 1 &&");
        expect(source).toContain("data.get('teamId', '') in data.get('teamIds', [])");
        expect(source).toContain("data.get('playerNames', []).size() == 0");
        expect(source).toContain("isNullableContactSafeString(data.get('teamName', null), 120)");
    });

    it('lets signed-in users read only matching community posts and authors manage lifecycle', () => {
        const source = rulesSource();
        const readRule = source.match(/function canReadSocialPost\(data\) \{[\s\S]*?\n    \}/);
        expect(readRule?.[0]).toContain("data.get('visibility', '') == 'community' &&");
        expect(readRule?.[0]).toContain("isMatchingSocialPostType(data.get('type', ''))");
        expect(source).toContain('function isMatchingPostAuthorLifecycleUpdateValid()');
        expect(source).toContain("request.resource.data.get('status', '') in ['open', 'filled', 'closed'] &&");
        expect(source).toContain("request.resource.data.get('type', '') == resource.data.get('type', '')");
        expect(source).toContain("request.resource.data.diff(resource.data).affectedKeys().hasOnly([\n               'status',\n               'expiresAt',\n               'updatedAt'\n             ])");
        expect(source).toContain('isMatchingPostAuthorLifecycleUpdateValid()');
    });

    it('prevents community matching posts from using generic social content updates', () => {
        const source = rulesSource();
        const genericUpdateRule = source.match(/function isSocialPostAuthorContentUpdateValid\(\) \{[\s\S]*?\n    \}/);
        expect(genericUpdateRule?.[0]).toContain("resource.data.get('visibility', '') != 'community'");
        expect(genericUpdateRule?.[0]).toContain("'media'");

        const matchingLifecycleRule = source.match(/function isMatchingPostAuthorLifecycleUpdateValid\(\) \{[\s\S]*?\n    \}/);
        expect(matchingLifecycleRule?.[0]).toContain("resource.data.get('visibility', '') == 'community'");
        expect(matchingLifecycleRule?.[0]).toContain("'status'");
        expect(matchingLifecycleRule?.[0]).toContain("'expiresAt'");
        expect(matchingLifecycleRule?.[0]).toContain("'updatedAt'");
        expect(matchingLifecycleRule?.[0]).not.toContain("'caption'");
        expect(matchingLifecycleRule?.[0]).not.toContain("'matching'");
    });

    it('blocks comments and reactions on community posts', () => {
        const source = rulesSource();
        const commentGuard = source.match(/match \/comments\/\{commentId\} \{[\s\S]*?\}/);
        const reactionGuard = source.match(/match \/reactions\/\{userId\} \{[\s\S]*?\}/);
        expect(commentGuard?.[0]).toContain("data.get('visibility', '') != 'community'");
        expect(reactionGuard?.[0]).toContain("data.get('visibility', '') != 'community'");
    });

    it('scopes matching responses to the responder, post author, and admins', () => {
        const source = rulesSource();
        expect(source).toContain('match /responses/{userId}');
        expect(source).toContain('function isMatchingResponseTargetPost(postId)');
        expect(source).toContain("post.get('authorId', '') != request.auth.uid");
        expect(source).toContain('function isBlockedMatchingPair(firstUserId, secondUserId)');
        expect(source).toContain("isBlockedFriendship(firstUserId + '__' + secondUserId)");
        expect(source).toContain("isBlockedFriendship(secondUserId + '__' + firstUserId)");
        expect(source).toContain("!isBlockedMatchingPair(post.get('authorId', ''), request.auth.uid)");
        expect(source).toContain("post.get('expiresAt', null) is timestamp &&");
        expect(source).toContain("post.get('expiresAt', null) > request.time &&");
        expect(source).toContain('function isMatchingPostAuthor(postId)');
        expect(source).toContain('function isMatchingResponsePayloadValid(data)');
        expect(source).toContain('function isMatchingResponseTeamContextValid(postId, data)');
        expect(source).toContain('isAllowedMatchingProfilePhotoUrl(data.get(\'responderPhotoUrl\', null))');
        expect(source).toContain("hasNoContactInfo(data.get('message', ''))");
        expect(source).toContain("hasNoContactInfo(data.get('responderName', ''))");
        for (const field of matchingResponseFields) {
            expect(source).toContain(`'${field}'`);
        }
        expect(source).toContain("data.get('message', '').size() <= 600");
        expect(source).toContain("post.get('type', '') == 'player_seeking_team' &&");
        expect(source).toContain("data.get('teamId', '') is string &&");
        expect(source).toContain("exists(/databases/$(database)/documents/teams/$(data.get('teamId', ''))) &&");
        expect(source).toContain("isTeamOwnerOrAdmin(data.get('teamId', ''))");
        const responseTeamGuard = source.match(/function isMatchingResponseTeamContextValid\(postId, data\) \{[\s\S]*?\n    \}/);
        expect(responseTeamGuard?.[0]).toContain("data.get('teamId', null) == null &&\n               data.get('teamName', null) == null");
        expect(responseTeamGuard?.[0]).toContain("data.get('teamName', '') == get(/databases/$(database)/documents/teams/$(data.get('teamId', ''))).data.get('name', '')");
        expect(source).toContain('isMatchingResponseTeamContextValid(postId, request.resource.data) &&');
    });

    it('allows only narrowly-validated matching response notifications in the inbox', () => {
        const source = rulesSource();
        expect(source).toContain('function isMatchingResponseNotificationCreateValid(recipientId, itemId, data)');
        expect(source).toContain("data.get('category', '') == 'matching_response' &&");
        expect(source).toContain("data.get('fromUserId', '') == request.auth.uid &&");
        expect(source).toContain("itemId == postId + '__' + request.auth.uid &&");
        expect(source).toContain("data.get('title', '') == 'New matching response' &&");
        expect(source).toContain("data.get('body', '') == 'Someone responded to your opportunity.' &&");
        expect(source).toContain("data.get('appRoute', '') == '/opportunities?view=mine' &&");
        expect(source).toContain("post.get('authorId', '') == recipientId &&");
        expect(source).toContain('!isBlockedMatchingPair(recipientId, request.auth.uid) &&');
        expect(source).toContain('exists(/databases/$(database)/documents/socialPosts/$(postId)/responses/$(request.auth.uid)) &&');
        expect(source).toContain("data.get('createdAt', null) == request.time &&");
        expect(source).toContain('allow create: if isMatchingResponseNotificationCreateValid(userId, itemId, request.resource.data);');

        const inboxBlock = source.match(/match \/notificationInbox\/\{itemId\} \{[\s\S]*?\}/);
        expect(inboxBlock?.[0]).toContain('allow update, delete: if false;');
    });

    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('matching rules engine coverage', () => {
        let testEnv;

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: `allplays-matching-notification-rules-${Date.now()}`,
                firestore: { rules: rulesSource() }
            });
        }, 30000);

        beforeEach(async () => {
            await testEnv.clearFirestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const firestore = context.firestore();
                await setDoc(doc(firestore, 'users/admin-1'), { isAdmin: true });
                await setDoc(doc(firestore, 'teams/team-1'), {
                    ownerId: 'responder-1',
                    adminEmails: ['admin@example.com'],
                    name: 'Tigers'
                });
                await setDoc(doc(firestore, 'teams/team-2'), {
                    ownerId: 'responder-2',
                    adminEmails: [],
                    name: 'Lions'
                });
                await setDoc(doc(firestore, 'socialPosts/post-1'), matchingPostPayload({ expiresAt: futureTimestamp() }));
                await setDoc(doc(firestore, 'socialPosts/post-1/responses/responder-1'), matchingResponsePayload());
            });
        });

        afterAll(async () => {
            await testEnv?.cleanup();
        });

        function notificationPayload(overrides = {}) {
            return {
                category: 'matching_response',
                title: 'New matching response',
                body: 'Someone responded to your opportunity.',
                appRoute: '/opportunities?view=mine',
                postId: 'post-1',
                fromUserId: 'responder-1',
                createdAt: serverTimestamp(),
                readAt: null,
                ...overrides
            };
        }

        it('allows valid player posts and rejects direct contact details in community posts', async () => {
            const authorDb = testEnv.authenticatedContext('author-1').firestore();
            await assertSucceeds(setDoc(doc(authorDb, 'socialPosts/player-post'), matchingPostPayload()));

            await assertFails(setDoc(doc(authorDb, 'socialPosts/contact-post'), matchingPostPayload({
                caption: 'Interested\ncoach@example.com'
            })));
            await assertFails(setDoc(doc(authorDb, 'socialPosts/signup-contact-post'), matchingPostPayload({
                matching: {
                    signupUrl: 'https://allplays.ai/signup?email=child@example.com'
                }
            })));
        });

        it('allows only team owners/admins to create team-seeking-player posts', async () => {
            const ownerDb = testEnv.authenticatedContext('responder-1').firestore();
            const adminDb = testEnv.authenticatedContext('admin-1', { email: 'admin@example.com' }).firestore();
            const coachDb = testEnv.authenticatedContext('coach-1', { email: 'coach@example.com' }).firestore();

            await assertSucceeds(setDoc(doc(ownerDb, 'socialPosts/team-owner-post'), teamMatchingPostPayload({
                authorId: 'responder-1',
                authorName: 'Team Owner',
                visibleUserIds: ['responder-1']
            })));
            await assertSucceeds(setDoc(doc(adminDb, 'socialPosts/team-admin-post'), teamMatchingPostPayload({
                authorId: 'admin-1',
                authorName: 'Team Admin',
                visibleUserIds: ['admin-1']
            })));
            await assertFails(setDoc(doc(coachDb, 'socialPosts/team-coach-post'), teamMatchingPostPayload({
                authorId: 'coach-1',
                authorName: 'Team Coach',
                visibleUserIds: ['coach-1']
            })));
        });

        it('lets signed-in users read open matching posts while authors manage lifecycle', async () => {
            const readerDb = testEnv.authenticatedContext('reader-1').firestore();
            const anonymousDb = testEnv.unauthenticatedContext().firestore();
            const authorDb = testEnv.authenticatedContext('author-1').firestore();
            const outsiderDb = testEnv.authenticatedContext('outsider-1').firestore();
            const postRef = doc(authorDb, 'socialPosts/post-1');

            await assertSucceeds(getDoc(doc(readerDb, 'socialPosts/post-1')));
            await assertFails(getDoc(doc(anonymousDb, 'socialPosts/post-1')));
            await assertSucceeds(updateDoc(postRef, {
                status: 'filled',
                updatedAt: serverTimestamp()
            }));
            await assertFails(updateDoc(doc(outsiderDb, 'socialPosts/post-1'), {
                status: 'closed',
                updatedAt: serverTimestamp()
            }));
        });

        it('enforces matching response privacy, team context, blocking, and delete boundaries', async () => {
            const responderDb = testEnv.authenticatedContext('responder-1').firestore();
            const authorDb = testEnv.authenticatedContext('author-1').firestore();
            const outsiderDb = testEnv.authenticatedContext('outsider-1').firestore();
            const responseRef = doc(responderDb, 'socialPosts/post-1/responses/responder-1');

            await assertSucceeds(setDoc(responseRef, matchingResponsePayload()));
            await assertSucceeds(getDoc(responseRef));
            await assertSucceeds(getDoc(doc(authorDb, 'socialPosts/post-1/responses/responder-1')));
            await assertFails(getDoc(doc(outsiderDb, 'socialPosts/post-1/responses/responder-1')));
            await assertFails(setDoc(responseRef, matchingResponsePayload({
                message: 'Email coach@example.com'
            })));
            await assertFails(deleteDoc(doc(outsiderDb, 'socialPosts/post-1/responses/responder-1')));
            await assertSucceeds(deleteDoc(responseRef));

            await testEnv.withSecurityRulesDisabled(async (context) => {
                const firestore = context.firestore();
                await setDoc(doc(firestore, 'friendships/author-1__responder-2'), {
                    status: 'blocked',
                    memberIds: ['author-1', 'responder-2']
                });
            });
            const blockedDb = testEnv.authenticatedContext('responder-2').firestore();
            await assertFails(setDoc(doc(blockedDb, 'socialPosts/post-1/responses/responder-2'), matchingResponsePayload({
                responderId: 'responder-2',
                responderName: 'Blocked Coach',
                teamId: 'team-2',
                teamName: 'Lions'
            })));
        });

        it('allows trusted notification copy and rejects responder-controlled title or body', async () => {
            const responderDb = testEnv.authenticatedContext('responder-1').firestore();
            const validRef = doc(responderDb, 'users/author-1/notificationInbox/post-1__responder-1');

            await assertFails(setDoc(validRef, notificationPayload({
                title: 'Urgent: contact me'
            })));
            await assertFails(setDoc(validRef, notificationPayload({
                body: 'Email attacker@example.com'
            })));
            await assertSucceeds(setDoc(validRef, notificationPayload()));
        });
    });
});
