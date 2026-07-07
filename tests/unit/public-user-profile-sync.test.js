import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function loadPublicUserProfileSyncHarness(overrides = {}) {
    const start = source.indexOf('function compactPublicProfileString(value)');
    const end = source.indexOf('export async function updateUserProfile(userId, profile)');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('Could not locate public profile sync implementation in js/db.js');
    }

    const Timestamp = overrides.Timestamp || { now: vi.fn(() => 'timestamp-now') };
    const setDoc = overrides.setDoc || vi.fn().mockResolvedValue(undefined);
    const doc = overrides.doc || vi.fn((database, collectionName, documentId) => ({
        database,
        collectionName,
        documentId,
        path: `${collectionName}/${documentId}`
    }));
    const getUserProfile = overrides.getUserProfile || vi.fn();
    const auth = overrides.auth || { currentUser: { uid: 'owner-1' } };
    const callable = overrides.callable || vi.fn().mockResolvedValue({ data: { success: true } });
    const httpsCallable = overrides.httpsCallable || vi.fn(() => callable);
    const warn = overrides.warn || vi.fn();
    const harnessConsole = { warn };

    const factory = new Function(
        'Timestamp',
        'setDoc',
        'doc',
        'db',
        'getUserProfile',
        'auth',
        'httpsCallable',
        'functions',
        'console',
        `${source.slice(start, end)}; return { syncPublicUserProfile };`
    );

    return {
        ...factory(
            Timestamp,
            setDoc,
            doc,
            overrides.db || { app: 'db' },
            getUserProfile,
            auth,
            httpsCallable,
            overrides.functions || { app: 'functions' },
            harnessConsole
        ),
        Timestamp,
        setDoc,
        doc,
        getUserProfile,
        auth,
        callable,
        httpsCallable,
        warn
    };
}

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

    it('falls back to the callable when an owner presentation sync cannot directly write trusted fields', async () => {
        const directProjectionError = new Error('Missing or insufficient permissions.');
        const setDoc = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(directProjectionError);
        const harness = loadPublicUserProfileSyncHarness({
            setDoc,
            auth: { currentUser: { uid: 'owner-1' } }
        });

        await expect(harness.syncPublicUserProfile('owner-1', {
            displayName: 'Owner',
            fullName: 'Profile Owner',
            photoUrl: 'https://example.com/photo.jpg',
            parentTeamIds: ['team-1'],
            email: 'owner@example.com'
        })).resolves.toBeUndefined();

        expect(setDoc).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ path: 'publicUserProfiles/owner-1' }),
            expect.not.objectContaining({
                discoveryTeamIds: expect.anything(),
                emailHash: expect.anything()
            }),
            { merge: true }
        );
        expect(setDoc).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ path: 'publicUserProfiles/owner-1' }),
            expect.objectContaining({
                discoveryTeamIds: ['team-1'],
                emailHash: expect.any(String)
            }),
            { merge: true }
        );
        expect(harness.httpsCallable).toHaveBeenCalledWith(
            expect.anything(),
            'syncPublicUserProfileProjection'
        );
        expect(harness.callable).toHaveBeenCalledWith({ userId: 'owner-1' });
    });

    it('does not invoke the trusted projection callable for non-owner profile sync failures', async () => {
        const setDoc = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('Missing or insufficient permissions.'));
        const harness = loadPublicUserProfileSyncHarness({
            setDoc,
            auth: { currentUser: { uid: 'viewer-1' } }
        });

        await expect(harness.syncPublicUserProfile('owner-1', {
            displayName: 'Owner',
            parentTeamIds: ['team-1'],
            email: 'owner@example.com'
        })).resolves.toBeUndefined();

        expect(setDoc).toHaveBeenCalledTimes(2);
        expect(harness.httpsCallable).not.toHaveBeenCalled();
        expect(harness.callable).not.toHaveBeenCalled();
        expect(harness.warn).toHaveBeenCalledWith(
            '[public-user-profile] Trusted projection sync skipped for non-owner profile:',
            expect.any(Error)
        );
    });
});
