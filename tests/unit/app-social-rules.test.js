import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function rulesSource() {
    return readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
}

describe('React app social Firestore rules', () => {
    it('adds least-privilege collections for social posts, reactions, comments, reports, and friendships', () => {
        const source = rulesSource();

        expect(source).toContain('function canReadSocialPost(data)');
        expect(source).toContain('function isSocialPostCreatePayloadValid(data)');
        expect(source).toContain('function canModerateSocialPost(data)');
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
});
