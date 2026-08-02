#!/usr/bin/env node

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const require = createRequire(import.meta.url);
const {
    discoverLegacyImageSignatureReferences,
    getCertificateLegacySignatureInventoryId,
    isMatchingCertificateLegacySignatureBinding
} = require('../functions/certificate-signature-cleanup-core.cjs');

const APPLY = process.argv.includes('--apply');
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'game-flow-c6311';
const LEGACY_IMAGE_BUCKET = process.env.IMAGE_STORAGE_BUCKET || 'game-flow-img.firebasestorage.app';
const MIGRATION_MARKER_PATH = 'systemMigrations/certificateLegacySignatureInventoryV1';

function getAdminAppOptions() {
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        return {
            credential: applicationDefault(),
            projectId: FIREBASE_PROJECT_ID,
            storageBucket: LEGACY_IMAGE_BUCKET
        };
    }
    const serviceAccount = JSON.parse(
        readFileSync(new URL('./serviceAccountKey.json', import.meta.url), 'utf8')
    );
    return {
        credential: cert(serviceAccount),
        projectId: FIREBASE_PROJECT_ID,
        storageBucket: LEGACY_IMAGE_BUCKET
    };
}

async function getAuthorizedUploaderIds(auth, team = {}) {
    const uploaderIds = new Set([String(team.ownerId || '').trim()].filter(Boolean));
    const managerEmails = [...new Set([
        team.ownerEmail,
        team.ownerEmailLower,
        ...(Array.isArray(team.adminEmails) ? team.adminEmails : [])
    ].map((email) => String(email || '').trim().toLowerCase()).filter(Boolean))];
    if (managerEmails.length) {
        const result = await auth.getUsers(managerEmails.slice(0, 100).map((email) => ({ email })));
        result.users.forEach((userRecord) => uploaderIds.add(userRecord.uid));
    }
    return [...uploaderIds];
}

async function writeInventoryReference(db, reference, apply) {
    const bindingId = getCertificateLegacySignatureInventoryId(reference);
    if (!bindingId) return 'skipped';
    const bindingRef = db.doc(`certificateLegacySignatureInventory/${bindingId}`);
    if (!apply) return 'would-write';
    return db.runTransaction(async (transaction) => {
        const bindingSnap = await transaction.get(bindingRef);
        const existing = bindingSnap.exists ? bindingSnap.data() || {} : null;
        if (existing && !isMatchingCertificateLegacySignatureBinding(existing, reference)) {
            transaction.set(bindingRef, {
                conflicted: true,
                lastConflictAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true });
            return 'conflicted';
        }
        transaction.set(bindingRef, {
            conflicted: false,
            legacyOwnerId: reference.legacyOwnerId,
            objectGeneration: reference.objectGeneration,
            objectKey: reference.objectKey,
            signerField: reference.legacySignerField,
            sourceUrlHash: reference.sourceUrlHash,
            storageBucketName: reference.storageBucketName,
            storagePath: reference.storagePath,
            teamId: reference.legacyTeamId,
            updatedAt: FieldValue.serverTimestamp(),
            ...(bindingSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() })
        }, { merge: true });
        return bindingSnap.exists ? 'verified' : 'created';
    });
}

export async function backfillCertificateLegacySignatureInventory({
    db,
    auth,
    legacyBucket,
    apply = APPLY
}) {
    const markerRef = db.doc(MIGRATION_MARKER_PATH);
    const markerSnap = await markerRef.get();
    if (apply && markerSnap.exists && markerSnap.data()?.status === 'completed') {
        console.log('[backfill-certificate-legacy-signature-inventory] Already completed.');
        return { defaultsDocuments: 0, references: 0, skippedCompleted: true };
    }

    const settingsSnap = await db.collectionGroup('settings').get();
    let defaultsDocuments = 0;
    let references = 0;
    let conflicts = 0;
    for (const defaultsSnap of settingsSnap.docs) {
        const pathParts = defaultsSnap.ref.path.split('/');
        if (
            defaultsSnap.id !== 'certificateDefaults' ||
            pathParts.length !== 4 ||
            pathParts[0] !== 'teams' ||
            pathParts[2] !== 'settings'
        ) continue;
        defaultsDocuments += 1;
        const teamId = pathParts[1];
        const teamSnap = await db.doc(`teams/${teamId}`).get();
        if (!teamSnap.exists) continue;
        const discovered = await discoverLegacyImageSignatureReferences({
            defaults: defaultsSnap.data() || {},
            teamId,
            legacyBucketName: LEGACY_IMAGE_BUCKET,
            allowedUploaderIds: await getAuthorizedUploaderIds(auth, teamSnap.data() || {}),
            lookupExistingUserIds: async (candidates) => {
                const result = await auth.getUsers(candidates.map((uid) => ({ uid })));
                return result.users.map((userRecord) => userRecord.uid);
            },
            getObjectMetadata: async (storagePath) => {
                const [metadata] = await legacyBucket.file(storagePath).getMetadata();
                return metadata;
            }
        });
        for (const reference of discovered) {
            const result = await writeInventoryReference(db, reference, apply);
            references += 1;
            if (result === 'conflicted') conflicts += 1;
        }
    }

    if (apply) {
        await markerRef.set({
            status: 'completed',
            defaultsDocuments,
            references,
            conflicts,
            completedAt: FieldValue.serverTimestamp()
        });
    }
    console.log(
        `[backfill-certificate-legacy-signature-inventory] ${apply ? 'Processed' : 'Would process'} ` +
        `${defaultsDocuments} defaults document(s), ${references} reference(s), ${conflicts} conflict(s).`
    );
    return { defaultsDocuments, references, conflicts, skippedCompleted: false };
}

async function main() {
    if (!getApps().length) initializeApp(getAdminAppOptions());
    await backfillCertificateLegacySignatureInventory({
        db: getFirestore(),
        auth: getAuth(),
        legacyBucket: getStorage().bucket(LEGACY_IMAGE_BUCKET)
    });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error('[backfill-certificate-legacy-signature-inventory] Failed:', error);
        process.exitCode = 1;
    });
}
