#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const {
    LEGACY_READABLE_REGISTRATION_CHECKOUT_FIELDS,
    buildLegacyReadableRegistrationCheckoutAttempt,
    hasLegacyReadableRegistrationCheckoutState
} = require('../functions/registration-payment-webhook-core.cjs');

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

export async function backfillLegacyRegistrationCheckoutAttempts({
    db,
    apply = APPLY,
    fieldValue = FieldValue,
    logger = console
}) {
    const snapshot = await db.collectionGroup('registrations').get();
    let matched = 0;
    let migrated = 0;

    for (const registrationDoc of snapshot.docs) {
        const observedRegistration = registrationDoc.data() || {};
        if (!hasLegacyReadableRegistrationCheckoutState(observedRegistration)) continue;
        matched += 1;
        logger.log(`[backfill-registration-checkout-attempts] ${apply ? 'Migrate' : 'Would migrate'} ${registrationDoc.ref.path}`);
        if (!apply) continue;

        const didMigrate = await db.runTransaction(async (transaction) => {
            const checkoutAttemptRef = registrationDoc.ref.collection('checkoutAttempts').doc('current');
            const [registrationSnap, attemptSnap] = await Promise.all([
                transaction.get(registrationDoc.ref),
                transaction.get(checkoutAttemptRef)
            ]);
            if (!registrationSnap.exists) return false;

            const registration = registrationSnap.data() || {};
            if (!hasLegacyReadableRegistrationCheckoutState(registration)) return false;
            const existingAttempt = attemptSnap.exists ? (attemptSnap.data() || {}) : {};
            const now = fieldValue.serverTimestamp();
            const privateAttempt = buildLegacyReadableRegistrationCheckoutAttempt({
                registration,
                existingAttempt,
                now
            });

            transaction.set(checkoutAttemptRef, privateAttempt, { merge: true });
            transaction.update(registrationDoc.ref, {
                ...Object.fromEntries(LEGACY_READABLE_REGISTRATION_CHECKOUT_FIELDS.map((field) => [
                    field,
                    fieldValue.delete()
                ])),
                'paymentReminder.retryUrl': fieldValue.delete(),
                updatedAt: now
            });
            return true;
        });
        if (didMigrate) migrated += 1;
    }

    logger.log(`[backfill-registration-checkout-attempts] Done. ${apply ? `Migrated ${migrated}` : `Would migrate ${matched}`} registration(s).`);
    return { matched, migrated };
}

async function main() {
    if (!getApps().length) initializeApp(getAdminAppOptions());
    await backfillLegacyRegistrationCheckoutAttempts({ db: getFirestore() });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error('[backfill-registration-checkout-attempts] Failed:', error);
        process.exitCode = 1;
    });
}
