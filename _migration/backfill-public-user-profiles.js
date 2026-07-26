#!/usr/bin/env node
/**
 * Backfill the publicUserProfiles projection used by Friends discovery.
 *
 * Dry-run examples:
 *   node _migration/backfill-public-user-profiles.js --email parent@example.com \
 *     --project game-flow-c6311
 *   node _migration/backfill-public-user-profiles.js --all \
 *     --project game-flow-c6311
 *
 * Apply examples:
 *   node _migration/backfill-public-user-profiles.js --apply --email parent@example.com \
 *     --project game-flow-c6311 --confirm-project game-flow-c6311
 *   node _migration/backfill-public-user-profiles.js --apply --all \
 *     --project game-flow-c6311 --confirm-project game-flow-c6311
 *
 * Apply mode always requires an explicit target (--email, --uid, or --all) and
 * an exact --confirm-project match.
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const require = createRequire(import.meta.url);
const {
    buildPublicProfileStaffMembershipId,
    buildPublicUserProfileProjection,
    compactPublicProfileString,
    derivePublicProfileTeamIds,
    isPublicProfileAuthUserNotFound
} = require('../functions/public-user-profile-projection-core.cjs');

function readArg(name, argv = process.argv) {
    const prefix = `--${name}=`;
    const inline = argv.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = argv.indexOf(`--${name}`);
    return index >= 0 ? argv[index + 1] || '' : '';
}

function hasFlag(name) {
    return process.argv.includes(`--${name}`);
}

const APPLY = hasFlag('apply');
const ALL = hasFlag('all');
const TARGET_EMAIL = compactPublicProfileString(readArg('email')).toLowerCase();
const TARGET_UID = compactPublicProfileString(readArg('uid'));
export function resolveProjectId(argv = process.argv, env = process.env) {
    return compactPublicProfileString(readArg('project', argv) || env.FIREBASE_PROJECT_ID);
}

const PROJECT_ID = resolveProjectId();
const CONFIRMED_PROJECT_ID = compactPublicProfileString(readArg('confirm-project'));

function assertSafeArguments() {
    const targetCount = Number(ALL) + Number(Boolean(TARGET_EMAIL)) + Number(Boolean(TARGET_UID));
    if (targetCount !== 1) {
        throw new Error('Choose exactly one target: --email EMAIL, --uid UID, or --all.');
    }
    if (!PROJECT_ID) {
        throw new Error('Choose a Firebase project with --project PROJECT_ID or FIREBASE_PROJECT_ID.');
    }
    if (APPLY && CONFIRMED_PROJECT_ID !== PROJECT_ID) {
        throw new Error(`Apply mode requires --confirm-project ${PROJECT_ID}.`);
    }
}

function initializeAdmin() {
    if (getApps().length) return;
    initializeApp({
        credential: applicationDefault(),
        projectId: PROJECT_ID
    });
}

function addTeamId(map, key, teamId) {
    const normalizedKey = compactPublicProfileString(key);
    const normalizedTeamId = compactPublicProfileString(teamId);
    if (!normalizedKey || !normalizedTeamId) return;
    const teamIds = map.get(normalizedKey) || new Set();
    teamIds.add(normalizedTeamId);
    map.set(normalizedKey, teamIds);
}

export function buildStaffTeamIndexes(teamDocs = []) {
    const ownerTeamIds = new Map();
    const adminTeamIds = new Map();
    teamDocs.forEach((teamDoc) => {
        const team = teamDoc.data?.() || teamDoc.data || {};
        addTeamId(ownerTeamIds, team.ownerId, teamDoc.id);
        (Array.isArray(team.adminEmails) ? team.adminEmails : []).forEach((email) => {
            addTeamId(adminTeamIds, compactPublicProfileString(email).toLowerCase(), teamDoc.id);
        });
    });
    return { ownerTeamIds, adminTeamIds };
}

export function resolveProjectionTeamIds(userId, userData, authRecord, staffIndexes) {
    return derivePublicProfileTeamIds(
        userData,
        resolveProjectionStaffTeamIds(userId, userData, authRecord, staffIndexes)
    );
}

export function resolveProjectionStaffTeamIds(userId, userData, authRecord, staffIndexes) {
    const email = compactPublicProfileString(authRecord?.email || userData?.email).toLowerCase();
    return derivePublicProfileTeamIds({}, [
        ...(staffIndexes.ownerTeamIds.get(userId) || []),
        ...(staffIndexes.adminTeamIds.get(email) || [])
    ]);
}

function comparableProjection(profile = {}) {
    return {
        displayName: profile.displayName || null,
        fullName: profile.fullName || null,
        photoUrl: profile.photoUrl || null,
        discoveryTeamIds: Array.isArray(profile.discoveryTeamIds) ? profile.discoveryTeamIds : [],
        emailHash: profile.emailHash || null
    };
}

export async function resolveUserDocs(db, auth) {
    if (TARGET_UID) {
        const snap = await db.doc(`users/${TARGET_UID}`).get();
        return snap.exists ? [snap] : [];
    }
    if (TARGET_EMAIL) {
        const authRecord = await auth.getUserByEmail(TARGET_EMAIL);
        const snap = await db.doc(`users/${authRecord.uid}`).get();
        return snap.exists ? [snap] : [];
    }
    try {
        const snap = await db.collection('users').get();
        return snap.docs;
    } catch (error) {
        throw new Error(`Unable to query users collection: ${error?.message || error}`, {
            cause: error
        });
    }
}

export async function resolveOrphanPublicProfileDocs(
    db,
    auth,
    userDocs,
    options = {}
) {
    const userIds = new Set(userDocs.map((entry) => entry.id));
    let profileDocs = [];
    if (options.all === true) {
        const profileSnap = await db.collection('publicUserProfiles').get();
        profileDocs = profileSnap.docs;
    } else {
        let targetUid = compactPublicProfileString(options.targetUid);
        const targetEmail = compactPublicProfileString(options.targetEmail).toLowerCase();
        if (!targetUid && targetEmail) {
            targetUid = compactPublicProfileString((await auth.getUserByEmail(targetEmail)).uid);
        }
        if (targetUid) {
            const profileSnap = await db.doc(`publicUserProfiles/${targetUid}`).get();
            if (profileSnap.exists) profileDocs = [profileSnap];
        }
    }
    return profileDocs.filter((entry) => !userIds.has(entry.id));
}

export async function processBackfillUsers(userDocs, processUser, logger = console) {
    let failed = 0;
    for (const userDoc of userDocs) {
        try {
            await processUser(userDoc);
        } catch (error) {
            failed++;
            logger.error(`FAILED ${userDoc.id}:`, error?.message || error);
        }
    }
    return failed;
}

export async function cleanupIneligiblePublicProfile(publicProfileRef, options = {}) {
    const apply = options.apply === true;
    const logger = options.logger || console;
    logger.warn(
        `${apply ? 'DELETE' : 'WOULD DELETE'} ${publicProfileRef.path}: ${options.reason}`
    );
    if (apply) {
        await publicProfileRef.delete();
    }
}

export async function loadEligibleBackfillAuthRecord(
    auth,
    userId,
    publicProfileRef,
    options = {}
) {
    let authRecord;
    try {
        authRecord = await auth.getUser(userId);
    } catch (error) {
        if (!isPublicProfileAuthUserNotFound(error)) {
            throw error;
        }
        await cleanupIneligiblePublicProfile(publicProfileRef, {
            ...options,
            reason: 'Firebase Auth user not found.'
        });
        return { authRecord: null, status: 'missing-auth' };
    }
    if (authRecord.emailVerified !== true) {
        await cleanupIneligiblePublicProfile(publicProfileRef, {
            ...options,
            reason: 'email is not verified.'
        });
        return { authRecord: null, status: 'unverified' };
    }
    return { authRecord, status: 'eligible' };
}

export async function reconcileBackfillStaffMemberships(
    db,
    userId,
    staffTeamIds,
    options = {}
) {
    const apply = options.apply === true;
    const logger = options.logger || console;
    const existingSnap = await db.collection('publicProfileStaffMemberships')
        .where('userId', '==', userId)
        .get();
    const desiredById = new Map(
        derivePublicProfileTeamIds({}, staffTeamIds).map((teamId) => [
            buildPublicProfileStaffMembershipId(teamId, userId),
            { teamId, userId }
        ])
    );
    let changed = 0;

    for (const existingDoc of existingSnap.docs || []) {
        const desired = desiredById.get(existingDoc.id);
        const current = existingDoc.data() || {};
        if (desired && current.teamId === desired.teamId && current.userId === userId) {
            desiredById.delete(existingDoc.id);
            continue;
        }
        logger.warn(`${apply ? 'DELETE' : 'WOULD DELETE'} ${existingDoc.ref.path}`);
        if (apply) await existingDoc.ref.delete();
        changed++;
    }

    for (const [membershipId, membership] of desiredById) {
        const membershipRef = db.doc(`publicProfileStaffMemberships/${membershipId}`);
        logger.log(`${apply ? 'WRITE' : 'WOULD WRITE'} ${membershipRef.path}`, membership);
        if (apply) {
            const writePayload = { ...membership };
            if (options.updatedAt !== undefined) writePayload.updatedAt = options.updatedAt;
            await membershipRef.set(writePayload);
        }
        changed++;
    }

    return changed;
}

export async function reconcileBackfillAuthIdentity(
    db,
    userId,
    authRecord,
    options = {}
) {
    const apply = options.apply === true;
    const logger = options.logger || console;
    const identityRef = db.doc(`publicProfileAuthIdentities/${userId}`);
    const identitySnap = await identityRef.get();
    const email = compactPublicProfileString(authRecord?.email).toLowerCase();
    const currentEmail = identitySnap.exists
        ? compactPublicProfileString(identitySnap.data()?.email).toLowerCase()
        : '';
    if (email === currentEmail && Boolean(email) === identitySnap.exists) return 0;

    if (!email) {
        logger.warn(`${apply ? 'DELETE' : 'WOULD DELETE'} ${identityRef.path}`);
        if (apply) await identityRef.delete();
        return 1;
    }

    logger.log(`${apply ? 'WRITE' : 'WOULD WRITE'} ${identityRef.path}`);
    if (apply) {
        await identityRef.set({
            email,
            ...(options.updatedAt !== undefined ? { updatedAt: options.updatedAt } : {})
        });
    }
    return 1;
}

export function resolveBackfillExitCode(result = {}) {
    return Number(result.failed || 0) > 0 ? 1 : 0;
}

export async function backfillPublicUserProfiles() {
    assertSafeArguments();
    initializeAdmin();
    const db = getFirestore();
    const auth = getAuth();
    const [teamSnap, userDocs] = await Promise.all([
        db.collection('teams').get(),
        resolveUserDocs(db, auth)
    ]);
    const orphanProfileDocs = await resolveOrphanPublicProfileDocs(db, auth, userDocs, {
        all: ALL,
        targetEmail: TARGET_EMAIL,
        targetUid: TARGET_UID
    });
    const staffIndexes = buildStaffTeamIndexes(teamSnap.docs);
    let changed = 0;
    let unchanged = 0;
    let staffMembershipsChanged = 0;
    let authIdentitiesChanged = 0;
    let missingAuth = 0;
    let unverified = 0;
    let orphaned = 0;

    console.log(`Project: ${PROJECT_ID}`);
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
    console.log(`Users: ${userDocs.length}`);

    let failed = await processBackfillUsers(userDocs, async (userDoc) => {
        const userData = userDoc.data() || {};
        const publicProfileRef = db.doc(`publicUserProfiles/${userDoc.id}`);
        const authResolution = await loadEligibleBackfillAuthRecord(
            auth,
            userDoc.id,
            publicProfileRef,
            { apply: APPLY }
        );
        if (authResolution.status === 'missing-auth') {
            authIdentitiesChanged += await reconcileBackfillAuthIdentity(
                db,
                userDoc.id,
                null,
                { apply: APPLY }
            );
            staffMembershipsChanged += await reconcileBackfillStaffMemberships(
                db,
                userDoc.id,
                [],
                { apply: APPLY, updatedAt: FieldValue.serverTimestamp() }
            );
            missingAuth++;
            return;
        }
        if (authResolution.status === 'unverified') {
            authIdentitiesChanged += await reconcileBackfillAuthIdentity(
                db,
                userDoc.id,
                null,
                { apply: APPLY }
            );
            staffMembershipsChanged += await reconcileBackfillStaffMemberships(
                db,
                userDoc.id,
                [],
                { apply: APPLY, updatedAt: FieldValue.serverTimestamp() }
            );
            unverified++;
            return;
        }
        const { authRecord } = authResolution;

        const staffTeamIds = resolveProjectionStaffTeamIds(
            userDoc.id,
            userData,
            authRecord,
            staffIndexes
        );
        staffMembershipsChanged += await reconcileBackfillStaffMemberships(
            db,
            userDoc.id,
            staffTeamIds,
            { apply: APPLY, updatedAt: FieldValue.serverTimestamp() }
        );
        const discoveryTeamIds = derivePublicProfileTeamIds(userData, staffTeamIds);
        const projection = buildPublicUserProfileProjection(userData, {
            trustedEmail: authRecord.email || userData.email || null,
            trustedDisplayName: authRecord.displayName || null,
            trustedPhotoUrl: authRecord.photoURL || null,
            discoveryTeamIds
        });
        const currentSnap = await publicProfileRef.get();
        const current = currentSnap.exists ? comparableProjection(currentSnap.data() || {}) : null;
        const next = comparableProjection(projection);
        if (current && JSON.stringify(current) === JSON.stringify(next)) {
            authIdentitiesChanged += await reconcileBackfillAuthIdentity(
                db,
                userDoc.id,
                authRecord,
                { apply: APPLY, updatedAt: FieldValue.serverTimestamp() }
            );
            unchanged++;
            return;
        }

        console.log(`${APPLY ? 'WRITE' : 'WOULD WRITE'} ${publicProfileRef.path}`, {
            displayName: projection.displayName,
            discoveryTeamIds: projection.discoveryTeamIds
        });
        if (APPLY) {
            await publicProfileRef.set({
                ...projection,
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
        }
        authIdentitiesChanged += await reconcileBackfillAuthIdentity(
            db,
            userDoc.id,
            authRecord,
            { apply: APPLY, updatedAt: FieldValue.serverTimestamp() }
        );
        changed++;
    });

    failed += await processBackfillUsers(orphanProfileDocs, async (profileDoc) => {
        await cleanupIneligiblePublicProfile(profileDoc.ref, {
            apply: APPLY,
            reason: 'private user profile not found.'
        });
        authIdentitiesChanged += await reconcileBackfillAuthIdentity(
            db,
            profileDoc.id,
            null,
            { apply: APPLY }
        );
        staffMembershipsChanged += await reconcileBackfillStaffMemberships(
            db,
            profileDoc.id,
            [],
            { apply: APPLY, updatedAt: FieldValue.serverTimestamp() }
        );
        orphaned++;
    });

    console.log(`Changed: ${changed}`);
    console.log(`Unchanged: ${unchanged}`);
    console.log(`Staff memberships changed: ${staffMembershipsChanged}`);
    console.log(`Auth identities changed: ${authIdentitiesChanged}`);
    console.log(`Missing Auth users: ${missingAuth}`);
    console.log(`Unverified users: ${unverified}`);
    console.log(`Orphaned public profiles: ${orphaned}`);
    console.log(`Failed users: ${failed}`);
    return {
        changed,
        unchanged,
        staffMembershipsChanged,
        authIdentitiesChanged,
        missingAuth,
        unverified,
        orphaned,
        failed
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    backfillPublicUserProfiles()
        .then((result) => {
            process.exitCode = resolveBackfillExitCode(result);
        })
        .catch((error) => {
            console.error('Backfill failed:', error?.message || error);
            process.exitCode = 1;
        });
}
