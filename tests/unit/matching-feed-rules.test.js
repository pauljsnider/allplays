import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
        expect(source).toContain("hasNoContactInfo(data.get('title', ''))");
        expect(source).toContain("hasNoContactInfo(data.get('authorName', ''))");
        expect(source).toContain("hasNoContactInfo(data.get('detail', ''))");
        expect(source).toContain("hasNoContactInfo(data.get('caption', ''))");
        expect(source).toContain("!value.matches('.*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}.*')");
        expect(source).toContain("!value.matches('.*[0-9][0-9() .-]{8,}[0-9].*')");
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
        expect(source).toContain("hasNoContactInfo(matching.get('playerFirstName', ''))");
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
        expect(source).toContain("hasNoContactInfo(data.get('teamName', ''))");
    });

    it('lets signed-in users read only matching community posts and authors manage lifecycle', () => {
        const source = rulesSource();
        const readRule = source.match(/function canReadSocialPost\(data\) \{[\s\S]*?\n    \}/);
        expect(readRule?.[0]).toContain("data.get('visibility', '') == 'community' &&");
        expect(readRule?.[0]).toContain("isMatchingSocialPostType(data.get('type', ''))");
        expect(source).toContain('function isMatchingPostAuthorLifecycleUpdateValid()');
        expect(source).toContain("request.resource.data.get('status', '') in ['open', 'filled', 'closed'] &&");
        expect(source).toContain('isCommunityMatchingPostContractValid(request.resource.data)');
        expect(source).toContain('isMatchingPostAuthorLifecycleUpdateValid()');
    });

    it('prevents community matching posts from using generic social content updates', () => {
        const source = rulesSource();
        const genericUpdateRule = source.match(/function isSocialPostAuthorContentUpdateValid\(\) \{[\s\S]*?\n    \}/);
        expect(genericUpdateRule?.[0]).toContain("resource.data.get('visibility', '') != 'community'");
        expect(genericUpdateRule?.[0]).toContain("'media'");

        const matchingLifecycleRule = source.match(/function isMatchingPostAuthorLifecycleUpdateValid\(\) \{[\s\S]*?\n    \}/);
        expect(matchingLifecycleRule?.[0]).toContain("resource.data.get('visibility', '') == 'community'");
        expect(matchingLifecycleRule?.[0]).toContain('isCommunityMatchingPostContractValid(request.resource.data)');
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
        expect(source).toContain('function isMatchingResponseNotificationCreateValid(recipientId, data)');
        expect(source).toContain("data.get('category', '') == 'matching_response' &&");
        expect(source).toContain("data.get('fromUserId', '') == request.auth.uid &&");
        expect(source).toContain("data.get('appRoute', '') == '/opportunities?view=mine' &&");
        expect(source).toContain("post.get('authorId', '') == recipientId &&");
        expect(source).toContain('!isBlockedMatchingPair(recipientId, request.auth.uid) &&');
        expect(source).toContain('exists(/databases/$(database)/documents/socialPosts/$(postId)/responses/$(request.auth.uid)) &&');
        expect(source).toContain('allow create: if isMatchingResponseNotificationCreateValid(userId, request.resource.data);');

        const inboxBlock = source.match(/match \/notificationInbox\/\{itemId\} \{[\s\S]*?\}/);
        expect(inboxBlock?.[0]).toContain('allow update, delete: if false;');
    });
});
