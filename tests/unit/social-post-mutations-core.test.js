import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const {
    canReadSocialPostForCaller,
    getNextSocialPostLikeState,
    normalizeSocialPostId
} = require('../../functions/social-post-mutations-core.cjs');
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('social post mutation callable core', () => {
    it('matches author, explicit viewer, global-admin, and verified team access', () => {
        const base = { post: { authorId: 'author-1', visibleUserIds: ['viewer-1'] }, callerUid: 'viewer-2' };
        expect(canReadSocialPostForCaller({ ...base, callerUid: 'author-1' })).toBe(true);
        expect(canReadSocialPostForCaller({ ...base, callerUid: 'viewer-1' })).toBe(true);
        expect(canReadSocialPostForCaller({ ...base, isGlobalAdmin: true })).toBe(true);
        expect(canReadSocialPostForCaller({ ...base, canAccessTeam: true })).toBe(true);
        expect(canReadSocialPostForCaller(base)).toBe(false);
        expect(canReadSocialPostForCaller({ ...base, callerUid: 'author-1 ' })).toBe(false);
        expect(canReadSocialPostForCaller({ ...base, callerUid: 'viewer-1 ' })).toBe(false);
        expect(canReadSocialPostForCaller({ ...base, post: { ...base.post, hidden: true }, isGlobalAdmin: true })).toBe(false);
    });

    it('atomically derives add and remove count transitions and rejects malformed aggregates', () => {
        expect(getNextSocialPostLikeState({ reactionExists: false, currentCount: 2 })).toEqual({ liked: true, count: 3 });
        expect(getNextSocialPostLikeState({ reactionExists: true, currentCount: 2 })).toEqual({ liked: false, count: 1 });
        expect(getNextSocialPostLikeState({ reactionExists: true, currentCount: 0 })).toEqual({ liked: false, count: 0 });
        expect(() => getNextSocialPostLikeState({ reactionExists: false, currentCount: -1 })).toThrow('invalid');
        expect(() => getNextSocialPostLikeState({ reactionExists: false, currentCount: 1.5 })).toThrow('invalid');
    });

    it('accepts the app document-ID contract without narrowing supported punctuation', () => {
        expect(normalizeSocialPostId(' post.with:punctuation ')).toBe('post.with:punctuation');
        expect(normalizeSocialPostId('bad/path')).toBe('');
        expect(normalizeSocialPostId('')).toBe('');
    });

    it('wires verified, transactionally consistent native mutation callables', () => {
        const start = functionsSource.indexOf('exports.toggleSocialPostReaction');
        const end = functionsSource.indexOf('function normalizeParentFeePlayerLinks', start);
        const source = functionsSource.slice(start, end);
        expect(source).toContain("assertSensitiveEmailVerified(context, 'toggle-social-post-reaction')");
        expect(source).toContain('firestore.runTransaction(async (transaction) =>');
        expect(source).toContain('canReadSocialPostForCaller({');
        expect(source).toContain("'reactionCounts.like': nextState.count");
        expect(source).toContain('exports.hideSocialPostForCaller');
        expect(source).toContain("assertSensitiveEmailVerified(context, 'hide-social-post')");
        expect(source).toContain('users/${context.auth.uid}/hiddenSocialPosts/${postId}');
        expect(source).toContain('exports.commentOnSocialPostForCaller');
        expect(source).toContain("assertSensitiveEmailVerified(context, 'comment-on-social-post')");
        expect(source).toContain('requireCallableSocialPostAccess(transaction, postRef, caller)');
        expect(source).toContain('transaction.create(commentRef');
        expect(source).toContain('exports.reportSocialPostForCaller');
        expect(source).toContain("assertSensitiveEmailVerified(context, 'report-social-post')");
        expect(source).toContain('transaction.create(reportRef');
    });
});
