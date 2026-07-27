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

    it('reconciles an email change from Admin Auth even while the callable token is stale', () => {
        const callableStart = functionsSource.indexOf('exports.syncPublicUserProfileProjection = functions.https.onCall');
        const callableEnd = functionsSource.indexOf('exports.confirmParentAccountMerge', callableStart);
        const callableSource = functionsSource.slice(callableStart, callableEnd);

        expect(functionsSource).toContain('exports.syncPublicUserProfileProjection = functions.https.onCall');
        expect(functionsSource).toContain("const userId = normalizeFirestoreId(data?.userId || context.auth.uid, 'userId');");
        expect(functionsSource).toContain("if (userId !== context.auth.uid)");
        expect(callableSource).toContain('const currentAuthIdentity = await loadPublicUserProfileAuthIdentity(userId);');
        expect(functionsSource).toContain('await syncPublicUserProfileProjectionForUser(userId, {');
        expect(callableSource).toContain('authIdentity: currentAuthIdentity');
        expect(callableSource).toContain('useIndexedStaffMemberships: true');
        expect(callableSource).not.toContain('reconcilePublicProfileStaffMembershipsForAuthUser');
        expect(callableSource).not.toContain('loadCaseInsensitivePublicProfileStaffTeamIds');
        expect(callableSource).toContain('email: currentAuthIdentity.email || null');
        expect(callableSource).toContain('email_verified: currentAuthIdentity.emailVerified === true');
        expect(callableSource).not.toContain('email: context.auth.token?.email || null');
        expect(callableSource).not.toContain('const callableAuthIdentity = {');
    });

    it('enforces verified-email policy before the callable reads private profile data', () => {
        const callableStart = functionsSource.indexOf('exports.syncPublicUserProfileProjection = functions.https.onCall');
        const callableEnd = functionsSource.indexOf('exports.confirmParentAccountMerge', callableStart);
        const callableSource = functionsSource.slice(callableStart, callableEnd);
        const authCheck = callableSource.indexOf('if (!context.auth?.uid)');
        const ownershipCheck = callableSource.indexOf('if (userId !== context.auth.uid)');
        const ineligibleCleanup = callableSource.indexOf(
            'await removePublicProfileAuthorizationForIneligibleAuth('
        );
        const verificationGuard = callableSource.indexOf(
            'await assertSensitiveEmailVerified({'
        );
        const privateProfileRead = callableSource.indexOf('const userSnap = await firestore.doc(`users/${userId}`).get();');
        const projectionSync = callableSource.indexOf('await syncPublicUserProfileProjectionForUser(userId, {');

        expect(callableStart).toBeGreaterThanOrEqual(0);
        expect(callableEnd).toBeGreaterThan(callableStart);
        expect(authCheck).toBeGreaterThanOrEqual(0);
        expect(ownershipCheck).toBeGreaterThan(authCheck);
        expect(ineligibleCleanup).toBeGreaterThan(ownershipCheck);
        expect(verificationGuard).toBeGreaterThan(ineligibleCleanup);
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
        expect(functionsSource).toContain('await removePublicProfileAuthorizationForIneligibleAuth(');
    });

    it('removes stale discovery projections for unverified and deleted Auth identities', () => {
        const syncStart = functionsSource.indexOf(
            'async function syncPublicUserProfileProjectionForUser'
        );
        const syncEnd = functionsSource.indexOf(
            'async function getPublicProfileStaffUserIdsForTeam',
            syncStart
        );
        const syncSource = functionsSource.slice(syncStart, syncEnd);
        const eligibilityCleanup = syncSource.indexOf(
            'await removePublicProfileAuthorizationForIneligibleAuth('
        );

        expect(syncStart).toBeGreaterThanOrEqual(0);
        expect(syncEnd).toBeGreaterThan(syncStart);
        expect(eligibilityCleanup).toBeGreaterThanOrEqual(0);
        expect(functionsSource).toMatch(
            /exports\.cleanupPublicUserProfileOnAuthDelete = functions\.auth\s+\.user\(\)\s+\.onDelete/
        );
        expect(functionsSource).toContain('createPublicProfileAuthDeleteHandler({');
        expect(functionsSource).toContain('syncAffectedTeam: (teamId, userId) => (');
        expect(functionsSource).toContain('exports.sweepIneligiblePublicUserProfiles = functions');
        expect(functionsSource).toContain("schedule('every 24 hours')");
        expect(functionsSource).toContain('reconcileAuthIdentity: async (userId, authIdentity) => {');
        expect(functionsSource).toContain('if (!isIneligible && indexedEmail === currentEmail) return null;');
        expect(functionsSource).toContain('const previousStaffTeamIds = await loadPublicProfileStaffTeamIds(firestore, userId);');
        expect(functionsSource).toContain('const discoveryTeamIds = isIneligible');
        expect(functionsSource).toContain('loadPublicProfileStaffTeamIdsForIdentity(userId, indexedEmail)');
        expect(functionsSource).toContain('syncReconciledIdentity: async (userId, authIdentity, reconciliation) => {');
        expect(functionsSource).toContain('syncEligibleProfile: (userId, authIdentity) => (');
        expect(functionsSource).toContain('useIndexedStaffMemberships: true');
        expect(functionsSource).toContain('updateAuthIdentityIndex: true');
        expect(functionsSource).toContain('reconciliation.isIneligible');
        expect(functionsSource).toContain('? { forceRemove: true }');
        expect(functionsSource).toContain("authEmail: authIdentity.email || ''");
        expect(functionsSource).not.toContain('if (!sourceChanged) return null;');
        expect(functionsSource).not.toContain('if (publicProfileSnap.exists) return null;');
    });

    it('retains the public-profile retry anchor until ineligible recipient cleanup completes', () => {
        const cleanupStart = functionsSource.indexOf(
            'async function removePublicProfileAuthorizationForIneligibleAuth'
        );
        const cleanupEnd = functionsSource.indexOf(
            'async function reconcileRoutinePublicProfileAuthIdentity',
            cleanupStart
        );
        const cleanupSource = functionsSource.slice(cleanupStart, cleanupEnd);

        expect(cleanupSource.indexOf('syncNotificationRecipientForTeamUser')).toBeGreaterThanOrEqual(0);
        expect(cleanupSource.indexOf('await reconcilePublicProfileStaffMembershipsForUser')).toBeGreaterThan(
            cleanupSource.indexOf('syncNotificationRecipientForTeamUser')
        );
        expect(cleanupSource.indexOf('await publicProfileRef.delete()')).toBeGreaterThan(
            cleanupSource.indexOf('await authIdentityRef.delete()')
        );
    });

    it('reconciles Auth identity mismatches on routine callable and user-write refreshes', () => {
        const callableStart = functionsSource.indexOf('exports.syncPublicUserProfileProjection = functions.https.onCall');
        const callableEnd = functionsSource.indexOf('exports.confirmParentAccountMerge', callableStart);
        const callableSource = functionsSource.slice(callableStart, callableEnd);
        const userWriteStart = functionsSource.indexOf('exports.syncPublicUserProfileOnUserWrite = functions');
        const userWriteEnd = functionsSource.indexOf('exports.syncAdminUserSearchIndexOnUserWrite', userWriteStart);
        const userWriteSource = functionsSource.slice(userWriteStart, userWriteEnd);

        for (const routineSyncSource of [callableSource, userWriteSource]) {
            expect(routineSyncSource).toContain('useIndexedStaffMemberships: true');
        }
        expect(functionsSource).toContain('async function reconcileRoutinePublicProfileAuthIdentity(');
        expect(functionsSource).toContain('const indexedEmail = authIdentitySnap.exists');
        expect(functionsSource).toContain('if (authIdentitySnap.exists && indexedEmail === currentEmail)');
        expect(functionsSource).toContain('const discoveryTeamIds = await reconcilePublicProfileStaffMembershipsForAuthUser(');
        expect(functionsSource).toContain('...previousIdentityStaffTeamIds');
        expect(functionsSource).toContain('authEmail: currentEmail');
        expect(functionsSource).toContain('await authIdentityRef.set({');
        expect(userWriteSource).toContain('skipProjectionWriteIfIdentityCurrent: !sourceChanged');
        expect(functionsSource).toContain('options.skipProjectionWriteIfIdentityCurrent === true');
    });

    it('keeps mixed-case coach and owner discovery membership in a normalized uid index', () => {
        expect(functionsSource).toContain('async function getPublicProfileStaffUserIdsForTeam(team = null)');
        expect(functionsSource).toContain('return resolvePublicProfileStaffUserIds(team, {');
        expect(functionsSource).toContain('getUserByEmail: (email) => admin.auth().getUserByEmail(email)');
        expect(functionsSource).toContain('async function loadPublicProfileStaffTeamIdsForIdentity(userId, email = \'\')');
        expect(functionsSource).toContain('await reconcilePublicProfileStaffMembershipsForTeam({');
        expect(functionsSource).toContain("currentStaffUserIds: afterUserIds");
        expect(functionsSource).toContain('await reconcilePublicProfileStaffMembershipsForUser({');
        expect(functionsSource).toContain('const authoritativeTeamIds = await loadAuthoritativePublicProfileStaffTeamIds(');
        expect(functionsSource).toContain('loadCaseInsensitivePublicProfileStaffTeamIds(firestore, {');
        expect(functionsSource).toContain('documentIdField: admin.firestore.FieldPath.documentId()');
        expect(functionsSource).toContain('currentStaffTeamIds: authoritativeTeamIds');
        expect(functionsSource).toContain('...indexedUserIds');
        expect(functionsSource).toContain('loadPublicProfileStaffTeamIds(firestore, normalizedUid)');
        expect(functionsSource).toMatch(
            /exports\.syncPublicUserProfilesOnTeamWrite = functions\s+\.runWith\(\{ failurePolicy: true \}\)\s+\.firestore/
        );
        expect(functionsSource).toContain('createPublicProfileTeamWriteHandler({');
        expect(functionsSource).toContain('syncTeam: syncPublicUserProfilesForTeamChange');
        expect(functionsSource).toContain('useIndexedStaffMemberships: true');
        expect(functionsSource).toContain('if (publicUserProfileProjection.isPublicProfileAuthUserNotFound(error))');
        expect(functionsSource).toContain('throw error;');
        expect(functionsSource).toContain("reason: authIdentity.userMissing === true ? 'auth-user-missing' : 'email-unverified'");
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
