#!/usr/bin/env node

import admin from 'firebase-admin';

const FIRESTORE_BATCH_LIMIT = 500;

function isTargetedLegacyMessage(data = {}) {
    return String(data.targetType || 'full_team').trim() !== 'full_team';
}

async function main() {
    if (!admin.apps.length) {
        admin.initializeApp();
    }

    const db = admin.firestore();
    const teamsSnapshot = await db.collection('teams').get();
    let batch = db.batch();
    let pendingWrites = 0;
    let quarantinedCount = 0;

    async function commitBatch(context = {}) {
        if (pendingWrites === 0) return;
        try {
            await batch.commit();
            batch = db.batch();
            pendingWrites = 0;
        } catch (error) {
            console.error('[quarantine-legacy-targeted-team-chat] Batch commit failed', {
                teamId: context.teamId || null,
                messageId: context.messageId || null,
                pendingWrites,
                error
            });
            throw error;
        }
    }

    for (const teamDoc of teamsSnapshot.docs) {
        const legacyMessagesSnapshot = await teamDoc.ref.collection('chatMessages').get();
        for (const messageDoc of legacyMessagesSnapshot.docs) {
            const message = messageDoc.data() || {};
            if (!isTargetedLegacyMessage(message)) {
                continue;
            }

            const quarantineRef = teamDoc.ref.collection('chatMessageQuarantine').doc(messageDoc.id);
            batch.set(quarantineRef, {
                ...message,
                originalPath: messageDoc.ref.path,
                quarantinedAt: admin.firestore.FieldValue.serverTimestamp(),
                quarantineReason: 'legacy-targeted-team-chat'
            }, { merge: true });
            batch.delete(messageDoc.ref);
            pendingWrites += 2;
            quarantinedCount += 1;

            if (pendingWrites >= FIRESTORE_BATCH_LIMIT - 1) {
                await commitBatch({ teamId: teamDoc.id, messageId: messageDoc.id });
            }
        }
    }

    await commitBatch();
    console.log(`[quarantine-legacy-targeted-team-chat] Quarantined ${quarantinedCount} targeted legacy team chat message(s).`);
}

main().catch((error) => {
    console.error('[quarantine-legacy-targeted-team-chat] Failed:', error);
    process.exitCode = 1;
});
