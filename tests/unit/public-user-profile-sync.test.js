import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('public user profile sync', () => {
    it('syncs presentation fields and then refreshes trusted discovery projection', () => {
        expect(source).toContain("async function syncPublicUserProfile(userId, userData = null)");
        expect(source).toContain("async function buildPublicUserProfilePresentationPayload(userData = {})");
        expect(source).toContain("const payload = await buildPublicUserProfilePresentationPayload(nextUserData);");
        expect(source).toContain("await setDoc(doc(db, 'publicUserProfiles', userId), payload, { merge: true });");
        expect(source).toContain('await syncTrustedPublicUserProfileProjection(userId, nextUserData);');
        expect(source).toContain("httpsCallable(functions, 'syncPublicUserProfileProjection')");
        expect(source).toContain('await syncPublicUserProfile(userId);');
    });

    it('keeps discovery projection fields derived from private user data only', () => {
        expect(source).toContain("async function buildTrustedPublicUserProfileProjectionPayload(userData = {})");
        expect(source).toContain("async function syncTrustedPublicUserProfileProjection(userId, userData = null)");
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

    it('exposes an authenticated server projection sync for owner membership changes', () => {
        expect(functionsSource).toContain('exports.syncPublicUserProfileProjection = functions.https.onCall');
        expect(functionsSource).toContain("const userId = normalizeFirestoreId(data?.userId || context.auth.uid, 'userId');");
        expect(functionsSource).toContain("if (userId !== context.auth.uid)");
        expect(functionsSource).toContain('trustedEmail: context.auth.token?.email || null');
        expect(functionsSource).toContain('discoveryTeamIds: derivePublicProfileTeamIds(userData)');
        expect(functionsSource).toContain('emailHash: hashPublicProfileEmail(trustedEmail)');
    });

    it('refreshes server-owned public projection when a parent membership request is approved', () => {
        expect(functionsSource).toContain('const publicProfileRef = firestore.doc(`publicUserProfiles/${requesterUserId}`);');
        expect(functionsSource).toContain('const requesterAuthRecord = await admin.auth().getUser(requesterUserId);');
        expect(functionsSource).toContain('requesterAuthEmail = requesterAuthRecord.email || null;');
        expect(functionsSource).toContain('const nextUserData = { ...userData, ...userUpdate };');
        expect(functionsSource).toContain('transaction.set(\n        publicProfileRef,\n        buildTrustedPublicUserProfileProjectionPayload(nextUserData, {');
        expect(functionsSource).toContain('trustedEmail: requesterAuthEmail');
    });
});
