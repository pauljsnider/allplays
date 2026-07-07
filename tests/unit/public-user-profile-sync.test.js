import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

describe('public user profile sync', () => {
    it('syncs only presentation fields from owner profile updates', () => {
        expect(source).toContain("async function syncPublicUserProfile(userId, userData = null)");
        expect(source).toContain("async function buildPublicUserProfilePresentationPayload(userData = {})");
        expect(source).toContain("const payload = await buildPublicUserProfilePresentationPayload(nextUserData);");
        expect(source).toContain("await setDoc(doc(db, 'publicUserProfiles', userId), payload, { merge: true });");
        expect(source).toContain('await syncPublicUserProfile(userId);');

        const syncStart = source.indexOf('async function syncPublicUserProfile(userId, userData = null)');
        const syncEnd = source.indexOf('export async function updateUserProfile', syncStart);
        const syncBlock = source.slice(syncStart, syncEnd);
        expect(syncBlock).not.toContain('discoveryTeamIds');
        expect(syncBlock).not.toContain('emailHash');
    });

    it('keeps discovery projection fields derived from private user data only', () => {
        expect(source).toContain("async function buildTrustedPublicUserProfileProjectionPayload(userData = {})");
        expect(source).toContain("discoveryTeamIds: derivePublicProfileTeamIds(userData)");
        expect(source).toContain("emailHash: await hashPublicProfileEmail(userData.email)");
        expect(source).toContain('const parentOfTeamIds = Array.isArray(userData.parentOf)');
        expect(source).toContain('const parentTeamIds = Array.isArray(userData.parentTeamIds)');
        expect(source).not.toContain('publicProfileInput.discoveryTeamIds');
        expect(source).not.toContain('publicProfileInput.emailHash');
    });

    it('refreshes the public presentation projection when parent-team links change', () => {
        expect(source).toContain('await syncPublicUserProfile(parentUserId);');
        expect(source.match(/await syncPublicUserProfile\(userId\);/g)?.length || 0).toBeGreaterThanOrEqual(4);
    });
});
