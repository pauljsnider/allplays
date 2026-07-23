#!/usr/bin/env node

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { buildAdminUserSearchHashes } = require('../functions/admin-user-search-index-core.cjs');
const APPLY = process.argv.includes('--apply');
const FIRESTORE_BATCH_LIMIT = 500;
const FIREBASE_PROJECT_ID = 'game-flow-c6311';

function getAdminAppOptions() {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return {
            credential: applicationDefault(),
            projectId: FIREBASE_PROJECT_ID
        };
    }

    const serviceAccount = JSON.parse(
        readFileSync(new URL('./serviceAccountKey.json', import.meta.url), 'utf8')
    );
    return {
        credential: cert(serviceAccount),
        projectId: FIREBASE_PROJECT_ID
    };
}

async function main() {
    if (!getApps().length) initializeApp(getAdminAppOptions());

    const db = getFirestore();
    const snapshot = await db.collection('users').get();
    let queued = 0;
    let written = 0;
    let batch = db.batch();

    for (const userDoc of snapshot.docs) {
        const hashes = buildAdminUserSearchHashes(userDoc.data() || {});
        console.log(`[backfill-admin-user-search-index] ${APPLY ? 'Queue' : 'Would index'} ${userDoc.id} (${hashes.length} hashes)`);
        if (!APPLY) continue;

        batch.set(db.doc(`adminUserSearch/${userDoc.id}`), {
            userId: userDoc.id,
            hashes,
            updatedAt: FieldValue.serverTimestamp()
        });
        queued += 1;
        if (queued === FIRESTORE_BATCH_LIMIT) {
            await batch.commit();
            written += queued;
            queued = 0;
            batch = db.batch();
        }
    }

    if (APPLY && queued) {
        await batch.commit();
        written += queued;
    }
    console.log(`[backfill-admin-user-search-index] Done. ${APPLY ? `Wrote ${written}` : `Would write ${snapshot.size}`} index document(s).`);
}

main().catch((error) => {
    console.error('[backfill-admin-user-search-index] Failed:', error);
    process.exitCode = 1;
});
