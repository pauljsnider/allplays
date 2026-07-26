import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const legacyAuthSource = readFileSync(new URL('../../js/auth.js', import.meta.url), 'utf8');
const appAuthSource = readFileSync(new URL('../../apps/app/src/lib/authService.ts', import.meta.url), 'utf8');

function loadPublicUserProfileSyncHarness(overrides = {}) {
    const start = source.indexOf('function compactPublicProfileString(value)');
    const end = source.indexOf('export async function createAccountMergeRequest');
    if (start === -1 || end === -1 || end <= start) {
        throw new Error('Could not locate public profile sync implementation in js/db.js');
    }
    const implementation = source.slice(start, end).replace(
        'export async function updateUserProfile(userId, profile)',
        'async function updateUserProfile(userId, profile)'
    );

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
        `${implementation}; return { syncPublicUserProfile, updateUserProfile };`
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
        expect(source).toContain('await requestTrustedPublicUserProfileProjectionSync(userId);');
        expect(source).toContain("httpsCallable(functions, 'syncPublicUserProfileProjection')");
        expect(source).toContain('await syncPublicUserProfile(userId);');
    });

    it('does not let clients derive or write trusted discovery fields', () => {
        const presentationStart = source.indexOf('async function buildPublicUserProfilePresentationPayload');
        const presentationEnd = source.indexOf('async function requestTrustedPublicUserProfileProjectionSync', presentationStart);
        const presentationSource = source.slice(presentationStart, presentationEnd);

        expect(presentationSource).not.toContain('discoveryTeamIds');
        expect(presentationSource).not.toContain('emailHash');
        expect(source).not.toContain('buildTrustedPublicUserProfileProjectionPayload');
        expect(source).not.toContain('syncTrustedPublicUserProfileProjection');
    });

    it('refreshes the public presentation projection when parent-team links change', () => {
        expect(source).toContain('await syncPublicUserProfile(parentUserId);');
        expect(source.match(/await syncPublicUserProfile\(userId\);/g)?.length || 0).toBeGreaterThanOrEqual(4);
    });

    it('exposes an authenticated server projection sync for owner membership changes', () => {
        expect(functionsSource).toContain('exports.syncPublicUserProfileProjection = functions.https.onCall');
        expect(functionsSource).toContain("const userId = normalizeFirestoreId(data?.userId || context.auth.uid, 'userId');");
        expect(functionsSource).toContain("if (userId !== context.auth.uid)");
        expect(functionsSource).toContain('email: context.auth.token?.email || null');
        expect(functionsSource).toContain('await syncPublicUserProfileProjectionForUser(userId, {');
        expect(functionsSource).toContain('emailVerified: context.auth.token?.email_verified === true');
    });

    it('enforces verified-email policy before the callable reads private profile data', () => {
        const callableStart = functionsSource.indexOf('exports.syncPublicUserProfileProjection = functions.https.onCall');
        const callableEnd = functionsSource.indexOf('exports.confirmParentAccountMerge', callableStart);
        const callableSource = functionsSource.slice(callableStart, callableEnd);
        const authCheck = callableSource.indexOf('if (!context.auth?.uid)');
        const ownershipCheck = callableSource.indexOf('if (userId !== context.auth.uid)');
        const verificationGuard = callableSource.indexOf(
            "await assertSensitiveEmailVerified(context, 'sync-public-user-profile-projection');"
        );
        const privateProfileRead = callableSource.indexOf('const userSnap = await firestore.doc(`users/${userId}`).get();');
        const projectionSync = callableSource.indexOf('await syncPublicUserProfileProjectionForUser(userId, {');

        expect(callableStart).toBeGreaterThanOrEqual(0);
        expect(callableEnd).toBeGreaterThan(callableStart);
        expect(authCheck).toBeGreaterThanOrEqual(0);
        expect(ownershipCheck).toBeGreaterThan(authCheck);
        expect(verificationGuard).toBeGreaterThan(ownershipCheck);
        expect(privateProfileRead).toBeGreaterThan(verificationGuard);
        expect(projectionSync).toBeGreaterThan(privateProfileRead);
    });

    it('converges legacy and app signup paths on the same server-owned projection', () => {
        expect(legacyAuthSource).toContain('return executeEmailPasswordSignup({');
        expect(legacyAuthSource).toContain('updateUserProfile,');
        expect(appAuthSource).toContain('return executeEmailPasswordSignup({');
        expect(appAuthSource).toContain('updateUserProfile: dbModule.updateUserProfile');
        expect(functionsSource).toMatch(
            /exports\.syncPublicUserProfileOnUserWrite = functions\s+\.runWith\(\{ failurePolicy: true \}\)\s+\.firestore/
        );
        expect(functionsSource).toContain('await syncPublicUserProfileProjectionForUser(context.params.uid, {');
        expect(functionsSource).toContain('if (authIdentity.emailVerified !== true)');
    });

    it('refreshes coach and owner discovery membership when team staff changes', () => {
        expect(functionsSource).toContain('async function getPublicProfileStaffUserIdsForTeam(team = null)');
        expect(functionsSource).toContain("const ownerId = String(team.ownerId || '').trim();");
        expect(functionsSource).toContain('const adminUserIds = await getUserIdsByEmails(team.adminEmails || []);');
        expect(functionsSource).toContain('const emailCandidates = uniqueNonEmptyStrings([rawEmail, rawEmail.toLowerCase()]);');
        expect(functionsSource).toContain('extraTeamIds: currentStaffUserIds.has(candidateUserId) ? [teamId] : []');
        expect(functionsSource).toMatch(
            /exports\.syncPublicUserProfilesOnTeamWrite = functions\s+\.runWith\(\{ failurePolicy: true \}\)\s+\.firestore/
        );
        expect(functionsSource).toContain(
            'await syncPublicUserProfilesForTeamChange(context.params.teamId, before, after);'
        );
    });

    it('refreshes server-owned public projection when a parent membership request is approved', () => {
        expect(functionsSource).toContain('const publicProfileRef = firestore.doc(`publicUserProfiles/${requesterUserId}`);');
        expect(functionsSource).toContain('const requesterAuthRecord = await admin.auth().getUser(requesterUserId);');
        expect(functionsSource).toContain('requesterAuthEmail = requesterAuthRecord.email || null;');
        expect(functionsSource).toContain('const nextUserData = { ...userData, ...userUpdate };');
        expect(functionsSource).toContain('transaction.set(\n        publicProfileRef,\n        buildTrustedPublicUserProfileProjectionPayload(nextUserData, {');
        expect(functionsSource).toContain('trustedEmail: requesterAuthEmail');
    });

    it('projects co-parent membership atomically before deferred client sync', () => {
        const callableStart = functionsSource.indexOf('exports.redeemCoParentInvite');
        const callableEnd = functionsSource.indexOf('exports.redeemAdminInvite', callableStart);
        const callableSource = functionsSource.slice(callableStart, callableEnd);

        expect(callableStart).toBeGreaterThanOrEqual(0);
        expect(callableEnd).toBeGreaterThan(callableStart);
        expect(callableSource).toContain('const publicProfileRef = firestore.doc(`publicUserProfiles/${userId}`);');
        expect(callableSource).toContain('const nextUserData = {');
        expect(callableSource).toContain('transaction.set(publicProfileRef, buildTrustedPublicUserProfileProjectionPayload(nextUserData, {');
        expect(callableSource).toContain('trustedEmail: context.auth.token?.email || userData.email || null');
    });

    it('uses the callable for trusted owner projection after writing presentation fields', async () => {
        const setDoc = vi.fn().mockResolvedValue(undefined);
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
        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(harness.httpsCallable).toHaveBeenCalledWith(
            expect.anything(),
            'syncPublicUserProfileProjection'
        );
        expect(harness.callable).toHaveBeenCalledWith({ userId: 'owner-1' });
    });

    it('keeps awaited self-profile bootstrap successful when enforce mode defers the presentation projection', async () => {
        const projectionError = new Error('Missing or insufficient permissions.');
        const setDoc = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(projectionError);
        const getUserProfile = vi.fn().mockResolvedValue({
            displayName: 'Unverified Owner',
            email: 'owner@example.com'
        });
        const harness = loadPublicUserProfileSyncHarness({ setDoc, getUserProfile });

        await expect(harness.updateUserProfile('owner-1', {
            email: 'owner@example.com',
            lastLogin: 'now'
        })).resolves.toBeUndefined();

        expect(setDoc).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ path: 'users/owner-1' }),
            expect.objectContaining({ email: 'owner@example.com', lastLogin: 'now' }),
            { merge: true }
        );
        expect(setDoc).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ path: 'publicUserProfiles/owner-1' }),
            expect.objectContaining({ displayName: 'Unverified Owner' }),
            { merge: true }
        );
        expect(harness.httpsCallable).not.toHaveBeenCalled();
        expect(harness.warn).toHaveBeenCalledWith(
            '[public-user-profile] Presentation sync deferred:',
            projectionError
        );
    });

    it('does not reject a bootstrap caller when the verified-email guard also defers callable projection', async () => {
        const callableProjectionError = new Error('Email verification is required.');
        const setDoc = vi.fn().mockResolvedValue(undefined);
        const callable = vi.fn().mockRejectedValue(callableProjectionError);
        const harness = loadPublicUserProfileSyncHarness({ setDoc, callable });

        await expect(harness.syncPublicUserProfile('owner-1', {
            displayName: 'Owner',
            parentTeamIds: ['team-1'],
            email: 'owner@example.com'
        })).resolves.toBeUndefined();

        expect(harness.callable).toHaveBeenCalledWith({ userId: 'owner-1' });
        expect(harness.warn).toHaveBeenCalledWith(
            '[public-user-profile] Trusted projection sync deferred:',
            callableProjectionError
        );
        expect(setDoc).toHaveBeenCalledTimes(1);
    });

    it('defers trusted non-owner projection to the server', async () => {
        const setDoc = vi.fn().mockResolvedValue(undefined);
        const harness = loadPublicUserProfileSyncHarness({
            setDoc,
            auth: { currentUser: { uid: 'viewer-1' } }
        });

        await expect(harness.syncPublicUserProfile('owner-1', {
            displayName: 'Owner',
            parentTeamIds: ['team-1'],
            email: 'owner@example.com'
        })).resolves.toBeUndefined();

        expect(setDoc).toHaveBeenCalledTimes(1);
        expect(harness.httpsCallable).not.toHaveBeenCalled();
        expect(harness.callable).not.toHaveBeenCalled();
        expect(harness.warn).toHaveBeenCalledWith(
            '[public-user-profile] Trusted projection sync deferred to the server for non-owner profile.'
        );
    });
});
