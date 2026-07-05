#!/usr/bin/env node

import admin from 'firebase-admin';

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

function hasOwn(data, fieldName) {
    return Object.prototype.hasOwnProperty.call(data, fieldName);
}

function getLegacyFullTeamBackfill(data = {}) {
    const targetType = String(data.targetType || 'full_team').trim() || 'full_team';
    const hasRecipientIds = hasOwn(data, 'recipientIds');
    const hasEmptyRecipients = !hasRecipientIds ||
        (Array.isArray(data.recipientIds) && data.recipientIds.length === 0);

    if (targetType !== 'full_team' || !hasEmptyRecipients) {
        return null;
    }

    const updates = {};
    if (!hasOwn(data, 'targetType')) {
        updates.targetType = 'full_team';
    }
    if (!hasRecipientIds) {
        updates.recipientIds = [];
    }

    return Object.keys(updates).length > 0 ? updates : null;
}

async function commitBatch(batch, pendingWrites, dryRun) {
    if (pendingWrites === 0 || dryRun) return;
    await batch.commit();
}

async function getTeamDocs(db, teamIds) {
    if (teamIds.length) {
        const refs = teamIds.map((teamId) => db.collection('teams').doc(teamId));
        const snapshots = await db.getAll(...refs);
        return snapshots.filter((snapshot) => snapshot.exists);
    }
    const teamsSnapshot = await db.collection('teams').get();
    return teamsSnapshot.docs;
}

async function main() {
    const options = parseArgs(process.argv.slice(2));

    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const db = admin.firestore();
    const teamDocs = await getTeamDocs(db, options.teamIds);
    let batch = db.batch();
    let pendingWrites = 0;
    let scannedCount = 0;
    let updatedCount = 0;

    for (const teamDoc of teamDocs) {
        const messagesSnapshot = await teamDoc.ref.collection('chatMessages').get();
        for (const messageDoc of messagesSnapshot.docs) {
            if (options.limit > 0 && scannedCount >= options.limit) {
                break;
            }

            scannedCount += 1;
            const updates = getLegacyFullTeamBackfill(messageDoc.data() || {});
            if (!updates) {
                continue;
            }

            batch.set(messageDoc.ref, {
                ...updates,
                legacyTargetFieldsBackfilledAt: admin.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
            pendingWrites += 1;
            updatedCount += 1;

            if (pendingWrites >= FIRESTORE_BATCH_LIMIT) {
                await commitBatch(batch, pendingWrites, options.dryRun);
                batch = db.batch();
                pendingWrites = 0;
            }
        }

        if (options.limit > 0 && scannedCount >= options.limit) {
            break;
        }
    }

    await commitBatch(batch, pendingWrites, options.dryRun);
    const action = options.dryRun ? 'Would backfill' : 'Backfilled';
    console.log(`[backfill-legacy-team-chat-target-fields] ${action} ${updatedCount} of ${scannedCount} scanned legacy team chat message(s).`);
}

main().catch((error) => {
    console.error('[backfill-legacy-team-chat-target-fields] Failed:', error);
    process.exitCode = 1;
});
