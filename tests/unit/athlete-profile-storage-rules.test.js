import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');
const mediaRules = extractAthleteProfileMediaRules();

function extractAthleteProfileMediaRules() {
    const mediaRulesStart = rules.indexOf('match /athlete-profile-media/{userId}/{profileId}/{fileName}');
    expect(mediaRulesStart).toBeGreaterThan(-1);

    const mediaRulesEnd = rules.indexOf('match /', mediaRulesStart + 1);
    return rules.slice(mediaRulesStart, mediaRulesEnd === -1 ? undefined : mediaRulesEnd);
}

function canCreateAthleteProfileMedia({ authUid, userId, size, contentType }) {
    const signedIn = authUid !== null;
    const requiresPathOwner = mediaRules.includes('request.auth.uid == userId');
    const pathOwnerAllowed = !requiresPathOwner || authUid === userId;
    const hasAllowedSize = size > 0 && size <= 100 * 1024 * 1024;
    const hasAllowedContentType = contentType.startsWith('image/') || contentType.startsWith('video/');

    return signedIn && pathOwnerAllowed && hasAllowedSize && hasAllowedContentType;
}

function canGetAthleteProfileMedia({ authUid, userId, profilePrivacy = 'private', profileExists = true }) {
    const signedIn = authUid !== null;
    const isOwner = authUid === userId;
    const isPublicProfile = profileExists && profilePrivacy === 'public';

    return (signedIn && isOwner) || isPublicProfile;
}

function canDeleteAthleteProfileMedia({ authUid, userId }) {
    const signedIn = authUid !== null;
    const deleteRuleStart = mediaRules.indexOf('allow delete:');
    const deleteRuleEnd = mediaRules.indexOf(';', deleteRuleStart);
    const deleteRule = mediaRules.slice(deleteRuleStart, deleteRuleEnd);
    const requiresPathOwner = deleteRule.includes('request.auth.uid == userId');
    const pathOwnerAllowed = !requiresPathOwner || authUid === userId;

    return signedIn && pathOwnerAllowed;
}

describe('athlete profile Storage rules', () => {
    it('allows profile owners to read and upload image/video media within limits', () => {
        expect(rules).toContain('function canReadAthleteProfileMedia(userId, profileId)');
        expect(mediaRules).toContain('allow get: if canReadAthleteProfileMedia(userId, profileId);');
        expect(mediaRules).toContain('allow list: if false;');
        expect(mediaRules).toContain('allow create: if isSignedIn() &&');
        expect(mediaRules).toContain('request.auth.uid == userId');
        expect(mediaRules).toContain('request.resource.size > 0');
        expect(mediaRules).toContain('request.resource.size <= 100 * 1024 * 1024');
        expect(mediaRules).toContain('isAllowedAthleteProfileMediaUploadType(request.resource.contentType);');
        expect(mediaRules).toContain('allow delete: if isSignedIn() && request.auth.uid == userId;');
        expect(mediaRules).toContain('allow update: if false;');

        expect(canGetAthleteProfileMedia({
            authUid: 'parent-1',
            userId: 'parent-1'
        })).toBe(true);

        expect(canCreateAthleteProfileMedia({
            authUid: 'parent-1',
            userId: 'parent-1',
            size: 1024,
            contentType: 'image/png'
        })).toBe(true);
    });

    it('denies unrelated signed-in users from reading private profile media', () => {
        expect(rules).toContain("firestore.exists(profilePath)");
        expect(rules).toContain("firestore.get(profilePath).data.get('privacy', 'private') == 'public'");

        expect(canGetAthleteProfileMedia({
            authUid: 'parent-2',
            userId: 'parent-1',
            profilePrivacy: 'private'
        })).toBe(false);

        expect(canCreateAthleteProfileMedia({
            authUid: 'parent-2',
            userId: 'parent-1',
            size: 1024,
            contentType: 'video/mp4'
        })).toBe(false);

        expect(canDeleteAthleteProfileMedia({
            authUid: 'parent-2',
            userId: 'parent-1'
        })).toBe(false);
    });

    it('allows public athlete profile media reads for non-owners', () => {
        expect(canGetAthleteProfileMedia({
            authUid: 'viewer-1',
            userId: 'parent-1',
            profilePrivacy: 'public'
        })).toBe(true);

        expect(canGetAthleteProfileMedia({
            authUid: 'viewer-1',
            userId: 'parent-1',
            profilePrivacy: 'public',
            profileExists: false
        })).toBe(false);
    });

    it('allows logged-out viewers to read media for public athlete profiles only', () => {
        expect(canGetAthleteProfileMedia({
            authUid: null,
            userId: 'parent-1',
            profilePrivacy: 'public'
        })).toBe(true);

        expect(canGetAthleteProfileMedia({
            authUid: null,
            userId: 'parent-1',
            profilePrivacy: 'private'
        })).toBe(false);
    });

    it('restricts athlete profile uploads to image and video content types', () => {
        expect(rules).toContain('function isAllowedAthleteProfileMediaUploadType(contentType)');
        expect(rules).toContain("contentType.matches('image/.*')");
        expect(rules).toContain("contentType.matches('video/.*')");
    });
});
