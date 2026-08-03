#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import {
    getMigrationAdminAppOptions,
    getMigrationFirestore
} from './firebase-admin-credential.mjs';

const APPLY = process.argv.includes('--apply');
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'game-flow-c6311';
const BATCH_LIMIT = 500;

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function isAuthUserNotFound(error) {
    return error?.code === 'auth/user-not-found' || error?.errorInfo?.code === 'auth/user-not-found';
}

export async function planLegacyTeamOwnerBackfill(teamDocs, auth) {
    const plans = [];
    const unresolvedTeamIds = [];

    for (const teamDoc of teamDocs) {
        const team = teamDoc.data() || {};
        if (String(team.ownerId || '').trim()) continue;
        const aliases = [...new Set([team.ownerEmailLower, team.ownerEmail].map(normalizeEmail).filter(Boolean))];
        if (aliases.length === 0) continue;

        const resolvedUsers = new Map();
        for (const alias of aliases) {
            try {
                const user = await auth.getUserByEmail(alias);
                if (user?.uid) resolvedUsers.set(user.uid, user);
            } catch (error) {
                if (!isAuthUserNotFound(error)) throw error;
            }
        }
        if (resolvedUsers.size > 1) {
            throw new Error(`Legacy team ${teamDoc.id} has owner aliases bound to different Firebase Auth users.`);
        }
        if (resolvedUsers.size === 0) {
            unresolvedTeamIds.push(teamDoc.id);
            continue;
        }
        const [user] = resolvedUsers.values();
        plans.push({ teamDoc, ownerId: user.uid });
    }

    return { plans, unresolvedTeamIds };
}

export async function backfillLegacyTeamOwnerIds({ db, auth, apply = APPLY, log = console }) {
    const snapshot = await db.collection('teams')
        .select('ownerId', 'ownerEmail', 'ownerEmailLower')
        .get();
    const { plans, unresolvedTeamIds } = await planLegacyTeamOwnerBackfill(snapshot.docs, auth);
    log.log(`[backfill-legacy-team-owner-ids] ${apply ? 'Will migrate' : 'Would migrate'} ${plans.length} team(s); ${unresolvedTeamIds.length} alias-only team(s) have no current Auth user.`);
    if (!apply || plans.length === 0) return { migrated: 0, unresolvedTeamIds };

    for (let start = 0; start < plans.length; start += BATCH_LIMIT) {
        const batch = db.batch();
        for (const plan of plans.slice(start, start + BATCH_LIMIT)) {
            batch.update(plan.teamDoc.ref, {
                ownerId: plan.ownerId,
                ownerIdBackfilledAt: FieldValue.serverTimestamp()
            }, { lastUpdateTime: plan.teamDoc.updateTime });
        }
        await batch.commit();
    }

    for (let start = 0; start < plans.length; start += BATCH_LIMIT) {
        const chunk = plans.slice(start, start + BATCH_LIMIT);
        const verified = await db.getAll(...chunk.map((plan) => plan.teamDoc.ref));
        verified.forEach((teamDoc, index) => {
            if (!teamDoc.exists || String(teamDoc.data()?.ownerId || '') !== chunk[index].ownerId) {
                throw new Error(`Legacy team owner migration verification failed for ${chunk[index].teamDoc.id}.`);
            }
        });
    }
    log.log(`[backfill-legacy-team-owner-ids] Verified ${plans.length} canonical owner binding(s).`);
    return { migrated: plans.length, unresolvedTeamIds };
}

async function main() {
    if (!getApps().length) {
        initializeApp(getMigrationAdminAppOptions({ projectId: FIREBASE_PROJECT_ID }));
    }
    await backfillLegacyTeamOwnerIds({
        db: getMigrationFirestore({ projectId: FIREBASE_PROJECT_ID }),
        auth: getAuth(),
        apply: APPLY
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error('[backfill-legacy-team-owner-ids] Failed:', error);
        process.exitCode = 1;
    });
}
