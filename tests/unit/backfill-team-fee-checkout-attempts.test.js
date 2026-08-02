import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { backfillLegacyTeamFeeCheckoutAttempts } from '../../_migration/backfill-team-fee-checkout-attempts.js';

const DELETE = Symbol('delete');

function makeFirestore(seed) {
    const state = new Map(Object.entries(seed));

    function ref(path) {
        return {
            path,
            collection: (name) => ({
                doc: (id) => ref(`${path}/${name}/${id}`)
            })
        };
    }

    function snapshot(path) {
        const value = state.get(path);
        return {
            exists: value !== undefined,
            data: () => value,
            ref: ref(path)
        };
    }

    return {
        state,
        collectionGroup: vi.fn(() => ({
            get: async () => ({
                docs: [...state.keys()]
                    .filter((path) => /\/feeRecipients\/[^/]+$/.test(path))
                    .map((path) => snapshot(path))
            })
        })),
        runTransaction: vi.fn(async (handler) => {
            const writes = [];
            const result = await handler({
                get: async (documentRef) => snapshot(documentRef.path),
                set: (documentRef, value, options) => writes.push({ documentRef, value, options })
            });
            for (const { documentRef, value, options } of writes) {
                const next = options?.merge ? { ...(state.get(documentRef.path) || {}), ...value } : { ...value };
                for (const [key, entry] of Object.entries(next)) {
                    if (entry === DELETE) delete next[key];
                }
                state.set(documentRef.path, next);
            }
            return result;
        })
    };
}

const fieldValue = {
    delete: () => DELETE,
    serverTimestamp: () => 'server-now'
};

describe('team-fee checkout attempt backfill', () => {
    it('atomically preserves private authority and scrubs every legacy readable bearer field', async () => {
        const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
        const attemptPath = `${recipientPath}/checkoutAttempts/current`;
        const db = makeFirestore({
            [recipientPath]: {
                checkoutUrl: 'https://checkout.stripe.com/c/pay/legacy',
                checkoutURL: 'https://checkout.stripe.com/c/pay/legacy-uppercase',
                paymentLink: 'https://checkout.stripe.com/c/pay/legacy',
                paymentLinkUrl: 'https://checkout.stripe.com/c/pay/legacy-link-url',
                paymentUrl: 'https://checkout.stripe.com/c/pay/legacy-payment-url',
                checkoutStatus: 'open',
                stripeCheckoutSessionId: 'cs_legacy',
                checkoutAttemptToken: 'tok_legacy_123456',
                checkoutAmountCents: 7500,
                checkoutCreationPayerUid: 'legacy-payer',
                checkoutCreationAmountCents: 7500,
                checkoutCreationRequest: { idempotencyKey: 'legacy-key' }
            },
            [attemptPath]: {
                checkoutUrl: 'https://checkout.stripe.com/c/pay/private',
                stripeCheckoutSessionId: 'cs_private',
                payerUid: 'private-payer'
            }
        });

        await expect(backfillLegacyTeamFeeCheckoutAttempts({
            db,
            apply: true,
            fieldValue,
            logger: { log: vi.fn() }
        })).resolves.toEqual({ matched: 1, migrated: 1 });

        expect(db.state.get(attemptPath)).toMatchObject({
            checkoutUrl: 'https://checkout.stripe.com/c/pay/private',
            stripeCheckoutSessionId: 'cs_private',
            checkoutAttemptToken: 'tok_legacy_123456',
            checkoutAmountCents: 7500,
            payerUid: 'private-payer',
            updatedAt: 'server-now'
        });
        const recipient = db.state.get(recipientPath);
        for (const field of [
            'checkoutUrl',
            'checkoutURL',
            'paymentLink',
            'paymentLinkUrl',
            'paymentUrl',
            'stripeCheckoutSessionId',
            'checkoutAttemptToken',
            'checkoutAmountCents',
            'checkoutCreationPayerUid',
            'checkoutCreationAmountCents',
            'checkoutCreationRequest'
        ]) {
            expect(recipient).not.toHaveProperty(field);
        }
    });

    it.each([
        'checkoutUrl',
        'checkoutURL',
        'paymentLink',
        'paymentLinkUrl',
        'paymentUrl'
    ])('migrates and scrubs the %s bearer URL alias when it is the only legacy state', async (field) => {
        const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
        const attemptPath = `${recipientPath}/checkoutAttempts/current`;
        const checkoutUrl = `https://checkout.stripe.com/c/pay/${field}`;
        const db = makeFirestore({
            [recipientPath]: { [field]: checkoutUrl }
        });

        await expect(backfillLegacyTeamFeeCheckoutAttempts({
            db,
            apply: true,
            fieldValue,
            logger: { log: vi.fn() }
        })).resolves.toEqual({ matched: 1, migrated: 1 });

        expect(db.state.get(attemptPath)).toMatchObject({ checkoutUrl });
        expect(db.state.get(recipientPath)).not.toHaveProperty(field);
    });

    it('keeps an active checkout session only in checkoutAttempts when billing state also exists', async () => {
        const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
        const attemptPath = `${recipientPath}/checkoutAttempts/current`;
        const adminBillingPath = `${recipientPath}/adminBilling/latest`;
        const db = makeFirestore({
            [recipientPath]: {
                stripeCheckoutSessionId: 'cs_active',
                stripeCustomerId: 'cus_legacy',
                receiptEmail: 'payer@example.com'
            }
        });

        await backfillLegacyTeamFeeCheckoutAttempts({
            db,
            apply: true,
            fieldValue,
            logger: { log: vi.fn() }
        });

        expect(db.state.get(attemptPath)).toMatchObject({ stripeCheckoutSessionId: 'cs_active' });
        expect(db.state.get(adminBillingPath)).toMatchObject({
            stripeCustomerId: 'cus_legacy',
            receiptEmail: 'payer@example.com'
        });
        expect(db.state.get(adminBillingPath)).not.toHaveProperty('stripeCheckoutSessionId');
        expect(db.state.get(recipientPath)).not.toHaveProperty('stripeCheckoutSessionId');
    });

    it.each([
        ['lastPaidStripeCheckoutSessionId', 'lastPaidStripeCheckoutSessionId'],
        ['stripePaymentIntentId', 'stripePaymentIntentId'],
        ['paymentIntentId', 'stripePaymentIntentId'],
        ['stripeCustomerId', 'stripeCustomerId'],
        ['stripeChargeId', 'stripeChargeId'],
        ['stripeRefundId', 'stripeRefundId'],
        ['stripeLastRefundId', 'stripeLastRefundId'],
        ['stripeEventId', 'stripeEventId'],
        ['eventId', 'stripeEventId'],
        ['receiptEmail', 'receiptEmail'],
        ['refundedBy', 'refundedBy'],
        ['recordedBy', 'recordedBy'],
        ['adjustedBy', 'adjustedBy'],
        ['canceledBy', 'canceledBy'],
        ['latestAuditActorId', 'latestAuditActorId'],
        ['internalNote', 'internalNote'],
        ['adminNote', 'adminNote'],
        ['reason', 'reason']
    ])('moves and scrubs the top-level private billing alias %s when it is the only legacy state', async (field, privateField) => {
        const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
        const attemptPath = `${recipientPath}/checkoutAttempts/current`;
        const adminBillingPath = `${recipientPath}/adminBilling/latest`;
        const db = makeFirestore({
            [recipientPath]: { [field]: `${field}-private-value` }
        });

        await expect(backfillLegacyTeamFeeCheckoutAttempts({
            db,
            apply: true,
            fieldValue,
            logger: { log: vi.fn() }
        })).resolves.toEqual({ matched: 1, migrated: 1 });

        expect(db.state.get(adminBillingPath)).toMatchObject({
            [privateField]: `${field}-private-value`,
            type: 'legacy_readable_billing_migration'
        });
        expect(db.state.get(recipientPath)).not.toHaveProperty(field);
        expect(db.state.get(recipientPath)).toHaveProperty('hasAdminBilling', true);
        expect(db.state.has(attemptPath)).toBe(false);
    });

    it.each([
        ['checkoutSessionId', 'stripeCheckoutSessionId'],
        ['paymentIntentId', 'stripePaymentIntentId'],
        ['receiptEmail', 'receiptEmail'],
        ['eventId', 'stripeEventId']
    ])('moves and scrubs the nested receiptMetadata.%s alias while preserving public receipt data', async (field, privateField) => {
        const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
        const adminBillingPath = `${recipientPath}/adminBilling/latest`;
        const db = makeFirestore({
            [recipientPath]: {
                receiptMetadata: {
                    provider: 'stripe',
                    amountPaidCents: 2500,
                    [field]: `${field}-private-value`
                }
            }
        });

        await backfillLegacyTeamFeeCheckoutAttempts({
            db,
            apply: true,
            fieldValue,
            logger: { log: vi.fn() }
        });

        expect(db.state.get(adminBillingPath)).toMatchObject({
            [privateField]: `${field}-private-value`
        });
        expect(db.state.get(recipientPath).receiptMetadata).toEqual({
            provider: 'stripe',
            amountPaidCents: 2500
        });
    });

    it('preserves existing private billing authority and removes private ledger aliases from readable arrays', async () => {
        const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
        const adminBillingPath = `${recipientPath}/adminBilling/latest`;
        const db = makeFirestore({
            [recipientPath]: {
                stripePaymentIntentId: 'pi_legacy',
                ledgerEntries: [{
                    type: 'stripe_refund',
                    amountCents: 500,
                    receiptEmail: 'parent@example.com',
                    note: 'Private refund note',
                    receiptMetadata: {
                        paymentIntentId: 'pi_nested',
                        currency: 'usd'
                    }
                }]
            },
            [adminBillingPath]: {
                stripePaymentIntentId: 'pi_private',
                receiptEmail: 'private@example.com'
            }
        });

        await backfillLegacyTeamFeeCheckoutAttempts({
            db,
            apply: true,
            fieldValue,
            logger: { log: vi.fn() }
        });

        expect(db.state.get(adminBillingPath)).toMatchObject({
            stripePaymentIntentId: 'pi_private',
            receiptEmail: 'private@example.com',
            legacyLedgerPrivateState: {
                ledgerEntries: [{
                    index: 0,
                    receiptEmail: 'parent@example.com',
                    note: 'Private refund note',
                    receiptMetadata: { paymentIntentId: 'pi_nested' }
                }]
            }
        });
        expect(db.state.get(recipientPath).ledgerEntries).toEqual([{
            type: 'stripe_refund',
            amountCents: 500,
            receiptMetadata: { currency: 'usd' }
        }]);
    });

    it('preserves parent-visible notes on non-refund ledger entries while migrating adjacent private fields', async () => {
        const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
        const adminBillingPath = `${recipientPath}/adminBilling/latest`;
        const db = makeFirestore({
            [recipientPath]: {
                ledgerEntries: [{
                    type: 'offline_payment',
                    amountCents: 2500,
                    note: 'Paid by check at practice',
                    receiptEmail: 'payer@example.com'
                }]
            }
        });

        await backfillLegacyTeamFeeCheckoutAttempts({
            db,
            apply: true,
            fieldValue,
            logger: { log: vi.fn() }
        });

        expect(db.state.get(adminBillingPath).legacyLedgerPrivateState).toEqual({
            ledgerEntries: [{ index: 0, receiptEmail: 'payer@example.com' }]
        });
        expect(db.state.get(recipientPath).ledgerEntries).toEqual([{
            type: 'offline_payment',
            amountCents: 2500,
            note: 'Paid by check at practice'
        }]);
    });

    it('does not match or rewrite a recipient whose only ledger state is a parent-visible non-refund note', async () => {
        const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
        const originalRecipient = {
            ledgerEntries: [{
                type: 'offline_payment',
                amountCents: 2500,
                note: 'Paid by check at practice'
            }]
        };
        const db = makeFirestore({ [recipientPath]: originalRecipient });

        await expect(backfillLegacyTeamFeeCheckoutAttempts({
            db,
            apply: true,
            fieldValue,
            logger: { log: vi.fn() }
        })).resolves.toEqual({ matched: 0, migrated: 0 });

        expect(db.runTransaction).not.toHaveBeenCalled();
        expect(db.state.get(recipientPath)).toEqual(originalRecipient);
    });

    it.each([
        { kind: 'refund' },
        { action: 'payment_refund' },
        { refund: true },
        { isRefund: true },
        { refundAmountCents: 500 }
    ])('moves and scrubs a refund-only note for marker %#', async (refundMarker) => {
        const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
        const adminBillingPath = `${recipientPath}/adminBilling/latest`;
        const db = makeFirestore({
            [recipientPath]: {
                ledgerEntries: [{ ...refundMarker, note: 'Manager-only refund reason' }]
            }
        });

        await expect(backfillLegacyTeamFeeCheckoutAttempts({
            db,
            apply: true,
            fieldValue,
            logger: { log: vi.fn() }
        })).resolves.toEqual({ matched: 1, migrated: 1 });

        expect(db.state.get(adminBillingPath).legacyLedgerPrivateState.ledgerEntries[0]).toMatchObject({
            index: 0,
            note: 'Manager-only refund reason'
        });
        expect(db.state.get(recipientPath).ledgerEntries[0]).not.toHaveProperty('note');
    });

    it('keeps dry runs read-only', async () => {
        const recipientPath = 'teams/team-1/feeBatches/batch-1/feeRecipients/recipient-1';
        const db = makeFirestore({
            [recipientPath]: { checkoutUrl: 'https://checkout.stripe.com/c/pay/legacy' }
        });

        await expect(backfillLegacyTeamFeeCheckoutAttempts({
            db,
            apply: false,
            fieldValue,
            logger: { log: vi.fn() }
        })).resolves.toEqual({ matched: 1, migrated: 0 });
        expect(db.runTransaction).not.toHaveBeenCalled();
        expect(db.state.get(recipientPath)).toHaveProperty('checkoutUrl');
    });

    it('stages and runs the backfill only after compatibility functions deploy', () => {
        const workflow = readFileSync(new URL('../../.github/workflows/deploy-prod.yml', import.meta.url), 'utf8');
        const compatibilityDeploy = workflow.indexOf('checkout-migration-compatibility');
        const backfill = workflow.indexOf('backfill-team-fee-checkout-attempts.mjs\" --apply');
        const fullDeploy = workflow.indexOf('retry_firebase_deploy \"hosting,functions\" \"application\"');

        expect(workflow).toContain('team_fee_checkout_backfill_needed: ${{ steps.firestore_config.outputs.team_fee_checkout_backfill_needed }}');
        expect(workflow).toContain('cp _migration/backfill-team-fee-checkout-attempts.js');
        expect(compatibilityDeploy).toBeGreaterThan(-1);
        expect(backfill).toBeGreaterThan(compatibilityDeploy);
        expect(fullDeploy).toBeGreaterThan(backfill);
    });
});
