#!/usr/bin/env node
/**
 * Create the publicTeamProfiles projection without changing source team data.
 * Dry run is the default; pass --apply to write.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const {
    buildPublicTeamProfile,
    isPublicTeamProfileSchemaValid
} = require('../functions/public-team-profile-core.cjs');
const PUBLIC_TEAM_PROFILE_MIGRATION_STATE_PATH = 'systemMigrations/publicTeamProfilesBackfill';
const PUBLIC_TEAM_PROFILE_RECONCILIATION_MAX_PASSES = 5;

function readFlag(argv, flag) {
    const index = argv.indexOf(flag);
    return index >= 0 ? String(argv[index + 1] || '').trim() : '';
}

export function parsePublicTeamBackfillArgs(argv = process.argv.slice(2)) {
    return {
        apply: argv.includes('--apply'),
        teamId: readFlag(argv, '--team') || String(process.env.TEAM_ID || '').trim(),
        projectId: readFlag(argv, '--project') || process.env.FIREBASE_PROJECT_ID || 'game-flow-c6311',
        serviceAccountPath: readFlag(argv, '--service-account') || process.env.FIREBASE_SERVICE_ACCOUNT || ''
    };
}

function initializeAdmin({ projectId, serviceAccountPath }) {
    if (getApps().length) return;
    if (serviceAccountPath) {
        initializeApp({
            credential: cert(JSON.parse(readFileSync(serviceAccountPath, 'utf8'))),
            projectId
        });
        return;
    }
    initializeApp({ projectId });
}

async function listTeams(db, teamId) {
    if (!teamId) return (await db.collection('teams').get()).docs;
    const teamSnap = await db.doc(`teams/${teamId}`).get();
    return teamSnap.exists ? [teamSnap] : [];
}

async function listPublicTeamProfiles(db) {
    return (await db.collection('publicTeamProfiles').get()).docs;
}

function stableSnapshotValue(value) {
    if (value === null || value === undefined) return value ?? null;
    if (Array.isArray(value)) return value.map(stableSnapshotValue);
    if (value instanceof Date) return { __date: value.toISOString() };
    if (typeof value?.toMillis === 'function') return { __timestampMillis: value.toMillis() };
    if (typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSnapshotValue(value[key])]));
    }
    return value;
}

function getTeamSnapshotFingerprint(teamDocs) {
    return teamDocs
        .map((teamSnap) => {
            const updateTime = teamSnap.updateTime;
            const version = typeof updateTime?.toMillis === 'function'
                ? updateTime.toMillis()
                : JSON.stringify(stableSnapshotValue(teamSnap.data() || {}));
            return `${teamSnap.id}:${version}`;
        })
        .sort()
        .join('|');
}

async function applyCurrentPublicTeamProfile(db, teamId) {
    const teamRef = db.doc(`teams/${teamId}`);
    const profileRef = db.doc(`publicTeamProfiles/${teamId}`);

    return db.runTransaction(async (transaction) => {
        // Read the source inside the write transaction so a visibility change
        // cannot commit between projection generation and the projection write.
        const currentTeamSnap = await transaction.get(teamRef);
        const profile = currentTeamSnap.exists
            ? buildPublicTeamProfile(currentTeamSnap.data() || {})
            : null;
        if (!profile) {
            const existing = await transaction.get(profileRef);
            if (!existing.exists) return 'unchanged';
            transaction.delete(profileRef);
            return 'deleted';
        }
        if (!isPublicTeamProfileSchemaValid(profile)) {
            throw new Error(`Invalid generated public team profile for ${teamId}.`);
        }
        transaction.set(profileRef, profile);
        return 'upserted';
    });
}

async function reconcilePublicTeamProfilesToFixedPoint(db) {
    for (let pass = 1; pass <= PUBLIC_TEAM_PROFILE_RECONCILIATION_MAX_PASSES; pass += 1) {
        const [beforeTeamDocs, profileDocs] = await Promise.all([
            listTeams(db, ''),
            listPublicTeamProfiles(db)
        ]);
        const reconciliationIds = new Set([
            ...beforeTeamDocs.map((teamSnap) => teamSnap.id),
            ...profileDocs.map((profileSnap) => profileSnap.id)
        ]);

        for (const teamId of reconciliationIds) {
            await applyCurrentPublicTeamProfile(db, teamId);
        }

        const afterTeamDocs = await listTeams(db, '');
        if (getTeamSnapshotFingerprint(beforeTeamDocs) === getTeamSnapshotFingerprint(afterTeamDocs)) {
            return {
                passes: pass,
                teamsReconciled: reconciliationIds.size
            };
        }
    }

    throw new Error(
        `Teams kept changing during ${PUBLIC_TEAM_PROFILE_RECONCILIATION_MAX_PASSES} reconciliation passes; ` +
        'migration completion was not recorded.'
    );
}

export async function runPublicTeamProfileBackfill(options = parsePublicTeamBackfillArgs(), dependencies = {}) {
    if (!dependencies.db) initializeAdmin(options);
    const db = dependencies.db || getFirestore();
    const migrationStateRef = db.doc(PUBLIC_TEAM_PROFILE_MIGRATION_STATE_PATH);
    if (options.apply && !options.teamId) {
        // A rerun must fail safe to the source compatibility path until a fresh
        // fixed point is proven. If the process exits early, completed remains
        // false and public discovery does not switch to a partial projection.
        await migrationStateRef.set({ completed: false }, { merge: true });
    }
    const teamDocs = await listTeams(db, options.teamId);
    const summary = {
        dryRun: !options.apply,
        teamsScanned: teamDocs.length,
        projectionsUpserted: 0,
        projectionsDeleted: 0,
        reconciliationPasses: 0,
        teamsReconciled: 0,
        migrationCompletionRecorded: false
    };

    for (const teamSnap of teamDocs) {
        if (options.apply) {
            const result = await applyCurrentPublicTeamProfile(db, teamSnap.id);
            if (result === 'upserted') summary.projectionsUpserted += 1;
            if (result === 'deleted') summary.projectionsDeleted += 1;
            continue;
        }

        const profileRef = db.doc(`publicTeamProfiles/${teamSnap.id}`);
        const profile = buildPublicTeamProfile(teamSnap.data() || {});
        if (!profile) {
            const existing = await profileRef.get();
            if (!existing.exists) continue;
            summary.projectionsDeleted += 1;
            continue;
        }
        if (!isPublicTeamProfileSchemaValid(profile)) {
            throw new Error(`Invalid generated public team profile for ${teamSnap.id}.`);
        }
        summary.projectionsUpserted += 1;
    }

    if (options.apply && !options.teamId) {
        const reconciliation = await reconcilePublicTeamProfilesToFixedPoint(db);
        summary.reconciliationPasses = reconciliation.passes;
        summary.teamsReconciled = reconciliation.teamsReconciled;
        await migrationStateRef.set({ completed: true }, { merge: true });
        summary.migrationCompletionRecorded = true;
    }

    console.log(JSON.stringify(summary, null, 2));
    return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runPublicTeamProfileBackfill()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error(error?.stack || error?.message || error);
            process.exit(1);
        });
}
