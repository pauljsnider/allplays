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
        expect(source).toContain("data.get('visibility', '') == 'community' &&");
        expect(source).toContain("data.get('status', '') == 'open' &&");
        expect(source).toContain('data.keys().hasOnly(communityMatchingPostFields())');
        expect(source).toContain("data.get('expiresAt', null) is timestamp &&");
        expect(source).toContain("hasNoContactInfo(data.get('caption', ''))");
        expect(source).toContain("hasNoContactInfo(request.resource.data.get('caption', ''))");
        expect(source).toContain("!value.matches('.*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Za-z]{2,}.*')");
        expect(source).toContain("!value.matches('.*[0-9][0-9() .-]{8,}[0-9].*')");
        expect(source).toContain("data.get('media', []).size() == 0 &&");
        expect(source).toContain("data.get('playerIds', []).size() == 0 &&");
        expect(source).toContain("!data.keys().hasAny(['authorEmail', 'email', 'phone'])");
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
        expect(source).toContain('data.get(\'matching\', {}).keys().hasOnly(matchingDetailFields())');
        expect(source).toContain("isNonBlankString(data.get('matching', {}).get('sport', ''))");
        expect(source).toContain("isNonBlankString(data.get('matching', {}).get('ageGroup', ''))");
    });

    it('requires an existing team and admin rights for team_seeking_players posts', () => {
        const source = rulesSource();
        expect(source).toContain("data.get('type', '') == 'team_seeking_players' &&");
        expect(source).toContain("exists(/databases/$(database)/documents/teams/$(data.get('teamId', ''))) &&");
        expect(source).toContain("isTeamOwnerOrAdmin(data.get('teamId', ''))");
        expect(source).toContain("data.get('type', '') == 'player_seeking_team' &&");
        expect(source).toContain("data.get('teamId', null) == null");
    });

    it('lets signed-in users read community posts and authors manage lifecycle', () => {
        const source = rulesSource();
        expect(source).toContain("data.get('visibility', '') == 'community' ||");
        expect(source).toContain('function isMatchingPostAuthorLifecycleUpdateValid()');
        expect(source).toContain("request.resource.data.get('status', '') in ['open', 'filled', 'closed'] &&");
        expect(source).toContain('isMatchingPostAuthorLifecycleUpdateValid()');
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
        expect(source).toContain("post.get('expiresAt', null) is timestamp &&");
        expect(source).toContain("post.get('expiresAt', null) > request.time &&");
        expect(source).toContain('function isMatchingPostAuthor(postId)');
        expect(source).toContain('function isMatchingResponsePayloadValid(data)');
        expect(source).toContain('function isMatchingResponseTeamContextValid(postId, data)');
        expect(source).toContain('isAllowedMatchingProfilePhotoUrl(data.get(\'responderPhotoUrl\', null))');
        expect(source).toContain("hasNoContactInfo(data.get('message', ''))");
        for (const field of matchingResponseFields) {
            expect(source).toContain(`'${field}'`);
        }
        expect(source).toContain("data.get('message', '').size() <= 600");
        expect(source).toContain("post.get('type', '') == 'player_seeking_team' &&");
        expect(source).toContain("data.get('teamId', '') is string &&");
        expect(source).toContain("exists(/databases/$(database)/documents/teams/$(data.get('teamId', ''))) &&");
        expect(source).toContain("isTeamOwnerOrAdmin(data.get('teamId', ''))");
        expect(source).toContain('isMatchingResponseTeamContextValid(postId, request.resource.data) &&');
    });

    it('allows only narrowly-validated matching response notifications in the inbox', () => {
        const source = rulesSource();
        expect(source).toContain('function isMatchingResponseNotificationCreateValid(recipientId, data)');
        expect(source).toContain("data.get('category', '') == 'matching_response' &&");
        expect(source).toContain("data.get('fromUserId', '') == request.auth.uid &&");
        expect(source).toContain("data.get('appRoute', '') == '/opportunities?view=mine' &&");
        expect(source).toContain("post.get('authorId', '') == recipientId &&");
        expect(source).toContain('exists(/databases/$(database)/documents/socialPosts/$(postId)/responses/$(request.auth.uid)) &&');
        expect(source).toContain('allow create: if isMatchingResponseNotificationCreateValid(userId, request.resource.data);');

        const inboxBlock = source.match(/match \/notificationInbox\/\{itemId\} \{[\s\S]*?\}/);
        expect(inboxBlock?.[0]).toContain('allow update, delete: if false;');
    });
});
