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
const OWNER_BINDING_BATCH_LIMIT = Math.floor(BATCH_LIMIT / 2);

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function isAuthUserNotFound(error) {
    return error?.code === 'auth/user-not-found' || error?.errorInfo?.code === 'auth/user-not-found';
}

export async function planLegacyTeamOwnerBackfill(teamDocs, auth) {
    const plans = [];
    const aliasNormalizationPlans = [];
    const unresolvedTeamIds = [];

    for (const teamDoc of teamDocs) {
        const team = teamDoc.data() || {};
        if (String(team.ownerId || '').trim()) continue;
        const aliases = [...new Set([team.ownerEmailLower, team.ownerEmail].map(normalizeEmail).filter(Boolean))];
        if (aliases.length === 0) continue;
        if (aliases.length > 1) {
            throw new Error(`Legacy team ${teamDoc.id} has conflicting normalized owner aliases.`);
        }
        if (aliases.length === 1 && String(team.ownerEmailLower || '').trim() !== aliases[0]) {
            aliasNormalizationPlans.push({ teamDoc, ownerEmailLower: aliases[0] });
        }

        const resolvedUsers = new Map();
        for (const alias of aliases) {
            try {
                const user = await auth.getUserByEmail(alias);
                if (user?.uid && user.disabled !== true) resolvedUsers.set(user.uid, user);
            } catch (error) {
                if (!isAuthUserNotFound(error)) throw error;
            }
        }
        if (resolvedUsers.size === 0) {
            unresolvedTeamIds.push(teamDoc.id);
            continue;
        }
        const [user] = resolvedUsers.values();
        plans.push({ teamDoc, ownerId: user.uid });
    }

    return { plans, aliasNormalizationPlans, unresolvedTeamIds };
}

export async function backfillLegacyTeamOwnerIds({ db, auth, apply = APPLY, log = console }) {
    let snapshot = await db.collection('teams')
        .select('ownerId', 'ownerEmail', 'ownerEmailLower')
        .get();
    let planning = await planLegacyTeamOwnerBackfill(snapshot.docs, auth);
    const normalizedAliasCount = planning.aliasNormalizationPlans.length;
    log.log(`[backfill-legacy-team-owner-ids] ${apply ? 'Will normalize' : 'Would normalize'} ${planning.aliasNormalizationPlans.length} legacy owner alias(es); ${apply ? 'will migrate' : 'would migrate'} ${planning.plans.length} team(s); ${planning.unresolvedTeamIds.length} alias-only team(s) have no current Auth user.`);
    if (!apply) {
        return {
            migrated: 0,
            normalizedAliases: 0,
            unresolvedTeamIds: planning.unresolvedTeamIds
        };
    }

    for (let start = 0; start < planning.aliasNormalizationPlans.length; start += BATCH_LIMIT) {
        const batch = db.batch();
        for (const plan of planning.aliasNormalizationPlans.slice(start, start + BATCH_LIMIT)) {
            batch.update(plan.teamDoc.ref, {
                ownerEmailLower: plan.ownerEmailLower
            }, { lastUpdateTime: plan.teamDoc.updateTime });
        }
        await batch.commit();
    }

    if (planning.aliasNormalizationPlans.length > 0) {
        for (let start = 0; start < planning.aliasNormalizationPlans.length; start += BATCH_LIMIT) {
            const chunk = planning.aliasNormalizationPlans.slice(start, start + BATCH_LIMIT);
            const verified = await db.getAll(...chunk.map((plan) => plan.teamDoc.ref));
            verified.forEach((teamDoc, index) => {
                if (!teamDoc.exists || String(teamDoc.data()?.ownerEmailLower || '') !== chunk[index].ownerEmailLower) {
                    throw new Error(`Legacy team owner alias normalization failed for ${chunk[index].teamDoc.id}.`);
                }
            });
        }

        // Re-read for pre-normalization signups; later signups use the retryable Auth trigger.
        snapshot = await db.collection('teams')
            .select('ownerId', 'ownerEmail', 'ownerEmailLower')
            .get();
        planning = await planLegacyTeamOwnerBackfill(snapshot.docs, auth);
    }

    const { plans, unresolvedTeamIds } = planning;

    for (let start = 0; start < plans.length; start += OWNER_BINDING_BATCH_LIMIT) {
        const chunk = plans.slice(start, start + OWNER_BINDING_BATCH_LIMIT);
        const batch = db.batch();
        const teamIdsByOwnerId = new Map();
        for (const plan of chunk) {
            batch.update(plan.teamDoc.ref, {
                ownerId: plan.ownerId,
                ownerIdBackfilledAt: FieldValue.serverTimestamp()
            }, { lastUpdateTime: plan.teamDoc.updateTime });
            const teamIds = teamIdsByOwnerId.get(plan.ownerId) || new Set();
            teamIds.add(plan.teamDoc.id);
            teamIdsByOwnerId.set(plan.ownerId, teamIds);
        }
        for (const [ownerId, teamIds] of teamIdsByOwnerId) {
            batch.set(db.doc(`users/${ownerId}`), {
                coachOf: FieldValue.arrayUnion(...teamIds),
                roles: FieldValue.arrayUnion('coach'),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
        }
        await batch.commit();
    }

    for (let start = 0; start < plans.length; start += OWNER_BINDING_BATCH_LIMIT) {
        const chunk = plans.slice(start, start + OWNER_BINDING_BATCH_LIMIT);
        const verifiedTeams = await db.getAll(...chunk.map((plan) => plan.teamDoc.ref));
        verifiedTeams.forEach((teamDoc, index) => {
            if (!teamDoc.exists || String(teamDoc.data()?.ownerId || '') !== chunk[index].ownerId) {
                throw new Error(`Legacy team owner migration verification failed for ${chunk[index].teamDoc.id}.`);
            }
        });
        const ownerIds = [...new Set(chunk.map((plan) => plan.ownerId))];
        const verifiedOwners = await db.getAll(...ownerIds.map((ownerId) => db.doc(`users/${ownerId}`)));
        const verifiedOwnersById = new Map(ownerIds.map((ownerId, index) => [ownerId, verifiedOwners[index]]));
        chunk.forEach((plan) => {
            const owner = verifiedOwnersById.get(plan.ownerId);
            const ownerData = owner?.exists ? (owner.data() || {}) : {};
            if (
                !Array.isArray(ownerData.coachOf)
                || !ownerData.coachOf.includes(plan.teamDoc.id)
                || !Array.isArray(ownerData.roles)
                || !ownerData.roles.includes('coach')
            ) {
                throw new Error(`Legacy team owner reciprocal access verification failed for ${plan.teamDoc.id}.`);
            }
        });
    }
    log.log(`[backfill-legacy-team-owner-ids] Verified ${plans.length} canonical owner binding(s).`);
    return {
        migrated: plans.length,
        normalizedAliases: normalizedAliasCount,
        unresolvedTeamIds
    };
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
