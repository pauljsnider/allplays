#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const {
    LEGACY_READABLE_TEAM_FEE_CHECKOUT_FIELDS,
    LEGACY_READABLE_TEAM_FEE_BILLING_FIELDS,
    LEGACY_READABLE_TEAM_FEE_RECEIPT_FIELDS,
    LEGACY_READABLE_TEAM_FEE_LEDGER_FIELDS,
    buildLegacyReadableTeamFeeCheckoutAttempt,
    buildLegacyReadableTeamFeeAdminBilling,
    hasLegacyReadableTeamFeeCheckoutState,
    hasLegacyReadableTeamFeeBillingState
} = require('../functions/team-fees-core.cjs');

const APPLY = process.argv.includes('--apply');
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'game-flow-c6311';
const LEGACY_LEDGER_PRIVATE_FIELDS = new Set([
    ...LEGACY_READABLE_TEAM_FEE_CHECKOUT_FIELDS,
    ...LEGACY_READABLE_TEAM_FEE_BILLING_FIELDS,
    ...LEGACY_READABLE_TEAM_FEE_RECEIPT_FIELDS,
    'note'
]);

function scrubLegacyLedgerPrivateState(value) {
    if (Array.isArray(value)) return value.map(scrubLegacyLedgerPrivateState);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => !LEGACY_LEDGER_PRIVATE_FIELDS.has(key))
        .map(([key, childValue]) => [key, scrubLegacyLedgerPrivateState(childValue)]));
}

function buildReadableRecipientScrub(recipient, fieldValue) {
    const scrub = Object.fromEntries([
        ...new Set([
            ...LEGACY_READABLE_TEAM_FEE_CHECKOUT_FIELDS,
            ...LEGACY_READABLE_TEAM_FEE_BILLING_FIELDS
        ])
    ].map((field) => [field, fieldValue.delete()]));

    const receiptMetadata = recipient.receiptMetadata;
    if (receiptMetadata && typeof receiptMetadata === 'object' && !Array.isArray(receiptMetadata)) {
        const safeReceiptMetadata = Object.fromEntries(Object.entries(receiptMetadata).filter(([field]) => (
            !LEGACY_READABLE_TEAM_FEE_RECEIPT_FIELDS.includes(field)
        )));
        scrub.receiptMetadata = Object.keys(safeReceiptMetadata).length
            ? safeReceiptMetadata
            : fieldValue.delete();
    }

    LEGACY_READABLE_TEAM_FEE_LEDGER_FIELDS.forEach((field) => {
        if (!Array.isArray(recipient[field])) return;
        scrub[field] = scrubLegacyLedgerPrivateState(recipient[field]);
    });

    return scrub;
}

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
        if (!hasLegacyReadableTeamFeeCheckoutState(observedRecipient)
            && !hasLegacyReadableTeamFeeBillingState(observedRecipient)) continue;
        matched += 1;
        logger.log(`[backfill-team-fee-checkout-attempts] ${apply ? 'Migrate' : 'Would migrate'} ${recipientDoc.ref.path}`);
        if (!apply) continue;

        const didMigrate = await db.runTransaction(async (transaction) => {
            const checkoutAttemptRef = recipientDoc.ref.collection('checkoutAttempts').doc('current');
            const adminBillingRef = recipientDoc.ref.collection('adminBilling').doc('latest');
            const [recipientSnap, attemptSnap, adminBillingSnap] = await Promise.all([
                transaction.get(recipientDoc.ref),
                transaction.get(checkoutAttemptRef),
                transaction.get(adminBillingRef)
            ]);
            if (!recipientSnap.exists) return false;

            const recipient = recipientSnap.data() || {};
            const hasCheckoutState = hasLegacyReadableTeamFeeCheckoutState(recipient);
            const hasBillingState = hasLegacyReadableTeamFeeBillingState(recipient);
            if (!hasCheckoutState && !hasBillingState) return false;
            const now = fieldValue.serverTimestamp();

            if (hasCheckoutState) {
                transaction.set(checkoutAttemptRef, buildLegacyReadableTeamFeeCheckoutAttempt({
                    recipient,
                    existingAttempt: attemptSnap.exists ? (attemptSnap.data() || {}) : {},
                    now
                }), { merge: true });
            }
            if (hasBillingState) {
                transaction.set(adminBillingRef, buildLegacyReadableTeamFeeAdminBilling({
                    recipient,
                    existingAdminBilling: adminBillingSnap.exists ? (adminBillingSnap.data() || {}) : {},
                    now
                }), { merge: true });
            }
            transaction.set(recipientDoc.ref, {
                ...buildReadableRecipientScrub(recipient, fieldValue),
                ...(hasBillingState ? { hasAdminBilling: true } : {}),
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
