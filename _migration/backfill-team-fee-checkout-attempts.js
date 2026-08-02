#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const {
    LEGACY_READABLE_TEAM_FEE_CHECKOUT_FIELDS,
    buildLegacyReadableTeamFeeCheckoutAttempt,
    hasLegacyReadableTeamFeeCheckoutState
} = require('../functions/team-fees-core.cjs');

const APPLY = process.argv.includes('--apply');
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'game-flow-c6311';

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

export async function backfillLegacyTeamFeeCheckoutAttempts({
    db,
    apply = APPLY,
    fieldValue = FieldValue,
    logger = console
}) {
    const snapshot = await db.collectionGroup('feeRecipients').get();
    let matched = 0;
    let migrated = 0;

    for (const recipientDoc of snapshot.docs) {
        const observedRecipient = recipientDoc.data() || {};
        if (!hasLegacyReadableTeamFeeCheckoutState(observedRecipient)) continue;
        matched += 1;
        logger.log(`[backfill-team-fee-checkout-attempts] ${apply ? 'Migrate' : 'Would migrate'} ${recipientDoc.ref.path}`);
        if (!apply) continue;

        const didMigrate = await db.runTransaction(async (transaction) => {
            const checkoutAttemptRef = recipientDoc.ref.collection('checkoutAttempts').doc('current');
            const [recipientSnap, attemptSnap] = await Promise.all([
                transaction.get(recipientDoc.ref),
                transaction.get(checkoutAttemptRef)
            ]);
            if (!recipientSnap.exists) return false;

            const recipient = recipientSnap.data() || {};
            if (!hasLegacyReadableTeamFeeCheckoutState(recipient)) return false;
            const existingAttempt = attemptSnap.exists ? (attemptSnap.data() || {}) : {};
            const now = fieldValue.serverTimestamp();
            const privateAttempt = buildLegacyReadableTeamFeeCheckoutAttempt({
                recipient,
                existingAttempt,
                now
            });

            transaction.set(checkoutAttemptRef, privateAttempt, { merge: true });
            transaction.set(recipientDoc.ref, {
                ...Object.fromEntries(LEGACY_READABLE_TEAM_FEE_CHECKOUT_FIELDS.map((field) => [
                    field,
                    fieldValue.delete()
                ])),
                updatedAt: now
            }, { merge: true });
            return true;
        });
        if (didMigrate) migrated += 1;
    }

    logger.log(`[backfill-team-fee-checkout-attempts] Done. ${apply ? `Migrated ${migrated}` : `Would migrate ${matched}`} recipient(s).`);
    return { matched, migrated };
}

async function main() {
    if (!getApps().length) initializeApp(getAdminAppOptions());
    await backfillLegacyTeamFeeCheckoutAttempts({ db: getFirestore() });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error('[backfill-team-fee-checkout-attempts] Failed:', error);
        process.exitCode = 1;
    });
}
