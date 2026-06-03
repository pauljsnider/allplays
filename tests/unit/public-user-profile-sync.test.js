import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

describe('public user profile sync', () => {
    it('projects safe discovery fields into publicUserProfiles after private profile updates', () => {
        expect(source).toContain("async function syncPublicUserProfile(userId, userData = null)");
        expect(source).toContain("await setDoc(doc(db, 'publicUserProfiles', userId), payload, { merge: true });");
        expect(source).toContain("discoveryTeamIds: derivePublicProfileTeamIds(userData)");
        expect(source).toContain("emailHash: await hashPublicProfileEmail(userData.email)");
        expect(source).toContain('await syncPublicUserProfile(userId);');
    });

    it('refreshes the public discovery projection when parent-team links change', () => {
        expect(source).toContain('await syncPublicUserProfile(parentUserId);');
        expect(source.match(/await syncPublicUserProfile\(userId\);/g)?.length || 0).toBeGreaterThanOrEqual(4);
    });
});
