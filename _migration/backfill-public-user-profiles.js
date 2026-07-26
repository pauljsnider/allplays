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
    buildPublicUserProfileProjection,
    compactPublicProfileString,
    derivePublicProfileTeamIds
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
    const email = compactPublicProfileString(authRecord?.email || userData?.email).toLowerCase();
    return derivePublicProfileTeamIds(userData, [
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
    const staffIndexes = buildStaffTeamIndexes(teamSnap.docs);
    let changed = 0;
    let unchanged = 0;
    let missingAuth = 0;
    let unverified = 0;

    console.log(`Project: ${PROJECT_ID}`);
    console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
    console.log(`Users: ${userDocs.length}`);

    const failed = await processBackfillUsers(userDocs, async (userDoc) => {
        const userData = userDoc.data() || {};
        let authRecord;
        try {
            authRecord = await auth.getUser(userDoc.id);
        } catch {
            missingAuth++;
            console.warn(`SKIP ${userDoc.id}: Firebase Auth user not found.`);
            return;
        }
        if (authRecord.emailVerified !== true) {
            unverified++;
            console.warn(`SKIP ${userDoc.id}: email is not verified.`);
            return;
        }

        const discoveryTeamIds = resolveProjectionTeamIds(
            userDoc.id,
            userData,
            authRecord,
            staffIndexes
        );
        const projection = buildPublicUserProfileProjection(userData, {
            trustedEmail: authRecord.email || userData.email || null,
            trustedDisplayName: authRecord.displayName || null,
            trustedPhotoUrl: authRecord.photoURL || null,
            discoveryTeamIds
        });
        const publicProfileRef = db.doc(`publicUserProfiles/${userDoc.id}`);
        const currentSnap = await publicProfileRef.get();
        const current = currentSnap.exists ? comparableProjection(currentSnap.data() || {}) : null;
        const next = comparableProjection(projection);
        if (current && JSON.stringify(current) === JSON.stringify(next)) {
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
        changed++;
    });

    console.log(`Changed: ${changed}`);
    console.log(`Unchanged: ${unchanged}`);
    console.log(`Missing Auth users: ${missingAuth}`);
    console.log(`Unverified users: ${unverified}`);
    console.log(`Failed users: ${failed}`);
    return { changed, unchanged, missingAuth, unverified, failed };
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
