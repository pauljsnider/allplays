#!/usr/bin/env node

import admin from 'firebase-admin';
import { pathToFileURL } from 'node:url';

const DEFAULT_PAGE_SIZE = 400;
const MIGRATION_STATE_PATH = 'systemMigrations/practicePacketReminderDueAt';

function coerceDate(value) {
    if (typeof value?.toDate === 'function') return value.toDate();
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function derivePracticePacketReminderDueAt(session = {}) {
    const packet = session.homePacketContent || {};
    return coerceDate(
        packet.dueAt
        || packet.dueDate
        || packet.deadline
        || packet.deadlineAt
        || packet.completeBy
        || packet.completeByAt
        || session.date
    );
}

export async function backfillPracticePacketReminderDueAt({
    db,
    Timestamp,
    pageSize = DEFAULT_PAGE_SIZE
}) {
    let lastDoc = null;
    let scanned = 0;
    let updated = 0;
    let skipped = 0;
    let malformed = 0;

    do {
        let query = db.collectionGroup('practiceSessions')
            .orderBy(admin.firestore.FieldPath.documentId())
            .limit(pageSize);
        if (lastDoc) query = query.startAfter(lastDoc);

        const snapshot = await query.get();
        const batch = db.batch();
        let pendingWrites = 0;

        for (const docSnap of snapshot.docs) {
            scanned += 1;
            const session = docSnap.data() || {};
            if (session.homePacketGenerated !== true || session.homePacketReminderDueAt) {
                skipped += 1;
                continue;
            }

            const dueAt = derivePracticePacketReminderDueAt(session);
            if (!dueAt) {
                malformed += 1;
                continue;
            }

            batch.update(docSnap.ref, {
                homePacketReminderDueAt: Timestamp.fromDate(dueAt)
            });
            pendingWrites += 1;
        }

        if (pendingWrites) {
            await batch.commit();
            updated += pendingWrites;
        }

        lastDoc = snapshot.docs.length === pageSize
            ? snapshot.docs[snapshot.docs.length - 1]
            : null;
    } while (lastDoc);

    await db.doc(MIGRATION_STATE_PATH).set({ completed: true }, { merge: true });

    return { scanned, updated, skipped, malformed };
}

async function main() {
    if (!admin.apps.length) admin.initializeApp();
    const result = await backfillPracticePacketReminderDueAt({
        db: admin.firestore(),
        Timestamp: admin.firestore.Timestamp
    });
    console.log('[backfill-practice-packet-reminder-due-at] Done.', result);
}

const isDirectRun = process.argv[1]
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
    main().catch((error) => {
        console.error('[backfill-practice-packet-reminder-due-at] Failed:', error);
        process.exitCode = 1;
    });
}
