import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');

describe('athlete profile Storage rules', () => {
    it('allows signed-in profile media uploads with image/video limits', () => {
        const mediaRulesStart = rules.indexOf('match /athlete-profile-media/{userId}/{profileId}/{fileName}');
        expect(mediaRulesStart).toBeGreaterThan(-1);

        const mediaRulesEnd = rules.indexOf('match /', mediaRulesStart + 1);
        const mediaRules = rules.slice(mediaRulesStart, mediaRulesEnd === -1 ? undefined : mediaRulesEnd);

        expect(mediaRules).toContain('allow get: if isSignedIn();');
        expect(mediaRules).toContain('allow list: if false;');
        expect(mediaRules).toContain('allow create: if isSignedIn() &&');
        expect(mediaRules).toContain('request.resource.size > 0');
        expect(mediaRules).toContain('request.resource.size <= 100 * 1024 * 1024');
        expect(mediaRules).toContain('isAllowedAthleteProfileMediaUploadType(request.resource.contentType);');
        expect(mediaRules).toContain('allow delete: if isSignedIn();');
        expect(mediaRules).toContain('allow update: if false;');
    });

    it('restricts athlete profile uploads to image and video content types', () => {
        expect(rules).toContain('function isAllowedAthleteProfileMediaUploadType(contentType)');
        expect(rules).toContain("contentType.matches('image/.*')");
        expect(rules).toContain("contentType.matches('video/.*')");
    });
});
