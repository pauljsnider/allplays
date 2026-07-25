#!/usr/bin/env node

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { buildAdminUserSearchHashes } = require('../functions/admin-user-search-index-core.cjs');
const APPLY = process.argv.includes('--apply');
const FIRESTORE_BATCH_LIMIT = 500;
const FIRESTORE_REST_BATCH_LIMIT = 20;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'game-flow-c6311';
const FIRESTORE_DATABASE_PATH =
    `projects/${FIREBASE_PROJECT_ID}/databases/(default)`;
const FIRESTORE_API_BASE =
    `https://firestore.googleapis.com/v1/${FIRESTORE_DATABASE_PATH}`;

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

async function firestoreRestRequest(accessToken, path, body) {
    const response = await fetch(`${FIRESTORE_API_BASE}${path}`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${accessToken}`,
            'content-type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Firestore REST ${response.status}: ${detail.slice(0, 500)}`);
    }
    return response.json();
}

async function runAccessTokenBackfill(accessToken) {
    const results = await firestoreRestRequest(accessToken, '/documents:runQuery', {
        structuredQuery: {
            from: [{ collectionId: 'users' }],
            select: {
                fields: [
                    { fieldPath: 'email' },
                    { fieldPath: 'fullName' },
                    { fieldPath: 'phone' }
                ]
            }
        }
    });
    const writes = [];
    let documentCount = 0;
    for (const result of results) {
        const document = result.document;
        if (!document?.name) continue;
        documentCount += 1;
        const userId = document.name.slice(document.name.lastIndexOf('/') + 1);
        const fields = document.fields || {};
        const hashes = buildAdminUserSearchHashes({
            email: fields.email?.stringValue,
            fullName: fields.fullName?.stringValue,
            phone: fields.phone?.stringValue
        });
        console.log(`[backfill-admin-user-search-index] ${APPLY ? 'Queue' : 'Would index'} ${userId} (${hashes.length} hashes)`);
        if (!APPLY) continue;
        writes.push({
            update: {
                name: `${FIRESTORE_DATABASE_PATH}/documents/adminUserSearch/${userId}`,
                fields: {
                    userId: { stringValue: userId },
                    hashes: {
                        arrayValue: {
                            values: hashes.map((hash) => ({ stringValue: hash }))
                        }
                    },
                    updatedAt: { timestampValue: new Date().toISOString() }
                }
            }
        });
    }

    for (let start = 0; start < writes.length; start += FIRESTORE_REST_BATCH_LIMIT) {
        const batchWrites = writes.slice(start, start + FIRESTORE_REST_BATCH_LIMIT);
        const result = await firestoreRestRequest(accessToken, '/documents:batchWrite', {
            writes: batchWrites
        });
        if (!Array.isArray(result.status) || result.status.length !== batchWrites.length) {
            throw new Error(
                `Firestore REST batch write returned ${result.status?.length ?? 0} status entries for ${batchWrites.length} writes`
            );
        }
        const failedWrite = result.status.find((status) => Number(status.code || 0) !== 0);
        if (failedWrite) {
            throw new Error(
                `Firestore REST batch write failed (${failedWrite.code}): ${failedWrite.message || 'unknown error'}`
            );
        }
    }
    console.log(`[backfill-admin-user-search-index] Done. ${APPLY ? `Wrote ${writes.length}` : `Would write ${documentCount}`} index document(s).`);
}

async function main() {
    if (process.env.GOOGLE_OAUTH_ACCESS_TOKEN) {
        await runAccessTokenBackfill(process.env.GOOGLE_OAUTH_ACCESS_TOKEN);
        return;
    }
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
