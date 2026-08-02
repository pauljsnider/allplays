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
                paymentLink: 'https://checkout.stripe.com/c/pay/legacy',
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
            'paymentLink',
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
        const compatibilityDeploy = workflow.indexOf('team-fee-checkout-migration-compatibility');
        const backfill = workflow.indexOf('backfill-team-fee-checkout-attempts.mjs\" --apply');
        const fullDeploy = workflow.indexOf('retry_firebase_deploy \"hosting,functions\" \"application\"');

        expect(workflow).toContain('team_fee_checkout_backfill_needed: ${{ steps.firestore_config.outputs.team_fee_checkout_backfill_needed }}');
        expect(workflow).toContain('cp _migration/backfill-team-fee-checkout-attempts.js');
        expect(compatibilityDeploy).toBeGreaterThan(-1);
        expect(backfill).toBeGreaterThan(compatibilityDeploy);
        expect(fullDeploy).toBeGreaterThan(backfill);
    });
});
