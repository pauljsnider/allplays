#!/usr/bin/env node

import admin from 'firebase-admin';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    DEFAULT_NOTIFICATION_PREFERENCES,
    normalizeNotificationTargetCategories,
    hasEnabledNotificationCategory
} = require('../functions/notification-target-index-core.cjs');

const FIRESTORE_BATCH_LIMIT = 500;

function parseArgs(argv) {
    const options = {
        dryRun: false,
        teamIds: [],
        limit: 0
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--dry-run') {
            options.dryRun = true;
            continue;
        }
        if (arg === '--team' && argv[index + 1]) {
            options.teamIds.push(String(argv[index + 1]).trim());
            index += 1;
            continue;
        }
        if (arg.startsWith('--team=')) {
            options.teamIds.push(arg.slice('--team='.length).trim());
            continue;
        }
        if (arg === '--limit' && argv[index + 1]) {
            options.limit = Number.parseInt(argv[index + 1], 10) || 0;
            index += 1;
            continue;
        }
        if (arg.startsWith('--limit=')) {
            options.limit = Number.parseInt(arg.slice('--limit='.length), 10) || 0;
        }
    }

    options.teamIds = Array.from(new Set(options.teamIds.filter(Boolean)));
    return options;
}

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeUid(value) {
    const uid = String(value || '').trim();
    return uid && !uid.includes('/') ? uid : '';
}

function normalizeNotificationDeviceRecord(deviceId, raw = {}) {
    const token = String(raw?.token || '').trim();
    if (!token) return null;
    return {
        deviceId: String(deviceId || '').trim(),
        token,
        platform: String(raw?.platform || 'web').trim() || 'web',
        userAgent: String(raw?.userAgent || '').trim()
    };
}

function getNotificationRecipientRoles({ teamId, team = {}, user = {}, uid }) {
    const roles = new Set();
    const normalizedUid = normalizeUid(uid);
    const email = normalizeEmail(user.email || user.profileEmail);
    const adminEmails = Array.isArray(team.adminEmails)
        ? team.adminEmails.map(normalizeEmail).filter(Boolean)
        : [];
    const parentTeamIds = Array.isArray(user.parentTeamIds)
        ? user.parentTeamIds.map((entry) => String(entry || '').trim()).filter(Boolean)
        : [];

    if (normalizedUid && team.ownerId === normalizedUid) {
        roles.add('staff');
    }
    if (email && adminEmails.includes(email)) {
        roles.add('staff');
    }
    if (parentTeamIds.includes(teamId)) {
        roles.add('parent');
    }

    return Array.from(roles);
}

async function getUserIdsByEmails(emails) {
    const uniqueEmails = Array.from(new Set(
        (Array.isArray(emails) ? emails : [])
            .map(normalizeEmail)
            .filter(Boolean)
    ));
    if (!uniqueEmails.length) return [];

    const ids = new Set();
    const results = await Promise.allSettled(
        uniqueEmails.map((email) => admin.auth().getUserByEmail(email))
    );
    results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value?.uid) {
            ids.add(result.value.uid);
        }
    });
    return Array.from(ids);
}

async function getCandidateUserIdsForTeam(db, teamId, team = {}) {
    const userIds = new Set();
    const addUid = (value) => {
        const uid = normalizeUid(value);
        if (uid) userIds.add(uid);
    };

    addUid(team.ownerId);

    const parentSnap = await db.collection('users')
        .where('parentTeamIds', 'array-contains', teamId)
        .get();
    parentSnap.forEach((docSnap) => addUid(docSnap.id));

    const adminUserIds = await getUserIdsByEmails(team.adminEmails || []);
    adminUserIds.forEach(addUid);

    return Array.from(userIds);
}

async function buildRecipientPayload(db, teamId, team, uid) {
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) return null;

    const user = userSnap.data() || {};
    const roles = getNotificationRecipientRoles({ teamId, team, user, uid });
    if (!roles.length) return null;

    const [prefSnap, devicesSnap] = await Promise.all([
        db.doc(`users/${uid}/notificationPreferences/${teamId}`).get(),
        db.collection(`users/${uid}/notificationDevices`).get()
    ]);
    const preferences = prefSnap.exists
        ? { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(prefSnap.data() || {}) }
        : DEFAULT_NOTIFICATION_PREFERENCES;
    const tokens = (devicesSnap.docs || [])
        .map((deviceSnap) => normalizeNotificationDeviceRecord(deviceSnap.id, deviceSnap.data()))
        .filter(Boolean);

    if (!tokens.length || !hasEnabledNotificationCategory(preferences)) {
        return null;
    }

    return {
        uid,
        teamId,
        roles,
        categories: normalizeNotificationTargetCategories(preferences),
        tokens,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
}

async function commitBatch(batch, pendingCount, dryRun) {
    if (pendingCount === 0) return;
    if (!dryRun) {
        await batch.commit();
    }
}

async function backfillTeam(db, teamDoc, options) {
    const teamId = teamDoc.id;
    const team = teamDoc.data() || {};
    const candidateUserIds = await getCandidateUserIdsForTeam(db, teamId, team);
    let batch = db.batch();
    let pendingWrites = 0;
    let writtenCount = 0;
    let deletedCount = 0;

    for (const uid of candidateUserIds) {
        const recipientRef = db.doc(`teams/${teamId}/notificationRecipients/${uid}`);
        const payload = await buildRecipientPayload(db, teamId, team, uid);

        if (payload) {
            writtenCount += 1;
            if (!options.dryRun) {
                batch.set(recipientRef, payload, { merge: true });
            }
        } else {
            deletedCount += 1;
            if (!options.dryRun) {
                batch.delete(recipientRef);
            }
        }
        pendingWrites += 1;

        if (pendingWrites === FIRESTORE_BATCH_LIMIT) {
            await commitBatch(batch, pendingWrites, options.dryRun);
            batch = db.batch();
            pendingWrites = 0;
        }
    }

    await commitBatch(batch, pendingWrites, options.dryRun);
    return {
        teamId,
        candidateCount: candidateUserIds.length,
        writtenCount,
        deletedCount
    };
}

async function loadTargetTeams(db, options) {
    if (options.teamIds.length) {
        const snaps = await Promise.all(options.teamIds.map((teamId) => db.doc(`teams/${teamId}`).get()));
        return snaps.filter((snap) => snap.exists);
    }

    let query = db.collection('teams').orderBy(admin.firestore.FieldPath.documentId());
    if (options.limit > 0) {
        query = query.limit(options.limit);
    }
    const snap = await query.get();
    return snap.docs;
}

async function main() {
    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const options = parseArgs(process.argv.slice(2));
    const db = admin.firestore();
    const teams = await loadTargetTeams(db, options);
    let totalCandidates = 0;
    let totalWritten = 0;
    let totalDeleted = 0;

    for (const teamDoc of teams) {
        const result = await backfillTeam(db, teamDoc, options);
        totalCandidates += result.candidateCount;
        totalWritten += result.writtenCount;
        totalDeleted += result.deletedCount;
        console.log(`[backfill-notification-recipients] ${options.dryRun ? 'Dry run: ' : ''}${result.teamId}: ${result.writtenCount} indexed, ${result.deletedCount} removed/skipped from ${result.candidateCount} candidate user(s).`);
    }

    console.log(`[backfill-notification-recipients] Done. Teams=${teams.length}, candidates=${totalCandidates}, indexed=${totalWritten}, removedOrSkipped=${totalDeleted}, dryRun=${options.dryRun}.`);
}

main().catch((error) => {
    console.error('[backfill-notification-recipients] Failed:', error);
    process.exitCode = 1;
});
