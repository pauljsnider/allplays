import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { backfillLegacyRegistrationCheckoutAttempts } from '../../_migration/backfill-registration-checkout-attempts.js';

const DELETE = Symbol('delete');

function deleteNested(target, path) {
    const parts = String(path || '').split('.').filter(Boolean);
    const leaf = parts.pop();
    const parent = parts.reduce((value, part) => value?.[part], target);
    if (parent && leaf) delete parent[leaf];
}

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

    function applyUpdate(path, value, merge = true) {
        const next = merge ? structuredClone(state.get(path) || {}) : {};
        for (const [key, entry] of Object.entries(value)) {
            if (entry === DELETE) {
                deleteNested(next, key);
            } else {
                next[key] = entry;
            }
        }
        state.set(path, next);
    }

    return {
        state,
        collectionGroup: vi.fn(() => ({
            get: async () => ({
                docs: [...state.keys()]
                    .filter((path) => /\/registrationForms\/[^/]+\/registrations\/[^/]+$/.test(path))
                    .map((path) => snapshot(path))
            })
        })),
        runTransaction: vi.fn(async (handler) => {
            const writes = [];
            const result = await handler({
                get: async (documentRef) => snapshot(documentRef.path),
                set: (documentRef, value, options) => writes.push({ type: 'set', documentRef, value, options }),
                update: (documentRef, value) => writes.push({ type: 'update', documentRef, value })
            });
            for (const write of writes) {
                applyUpdate(write.documentRef.path, write.value, write.type === 'update' || write.options?.merge === true);
            }
            return result;
        })
    };
}

const fieldValue = {
    delete: () => DELETE,
    serverTimestamp: () => 'server-now'
};

describe('registration checkout attempt backfill', () => {
    it('atomically preserves private authority and scrubs flat and nested readable bearer state', async () => {
        const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/registration-1';
        const attemptPath = `${registrationPath}/checkoutAttempts/current`;
        const db = makeFirestore({
            [registrationPath]: {
                checkoutUrl: 'https://checkout.stripe.com/c/pay/legacy',
                paymentLink: 'https://checkout.stripe.com/c/pay/legacy',
                stripeCheckoutSessionId: 'cs_legacy',
                stripePaymentIntentId: 'pi_legacy',
                lastPaidStripeCheckoutSessionId: 'cs_paid_legacy',
                checkoutAttemptToken: 'legacytoken123456',
                publicCheckoutCapabilityHash: 'legacy-capability-hash',
                checkoutAmountCents: 7500,
                checkoutCurrency: 'usd',
                checkoutCreationRequest: { idempotencyKey: 'legacy-key' },
                paymentReminder: {
                    status: 'active',
                    retryUrl: 'https://allplays.test/app/#/registration?publicCheckoutCapability=legacy'
                }
            },
            [attemptPath]: {
                checkoutUrl: 'https://checkout.stripe.com/c/pay/private',
                stripeCheckoutSessionId: 'cs_private',
                paymentRetryUrl: 'https://allplays.test/app/#/registration?publicCheckoutCapability=private'
            }
        });

        await expect(backfillLegacyRegistrationCheckoutAttempts({
            db,
            apply: true,
            fieldValue,
            logger: { log: vi.fn() }
        })).resolves.toEqual({ matched: 1, migrated: 1 });

        expect(db.state.get(attemptPath)).toMatchObject({
            checkoutUrl: 'https://checkout.stripe.com/c/pay/private',
            stripeCheckoutSessionId: 'cs_private',
            stripePaymentIntentId: 'pi_legacy',
            lastPaidStripeCheckoutSessionId: 'cs_paid_legacy',
            paymentRetryUrl: 'https://allplays.test/app/#/registration?publicCheckoutCapability=private',
            updatedAt: 'server-now'
        });
        const registration = db.state.get(registrationPath);
        for (const field of [
            'checkoutUrl',
            'paymentLink',
            'stripeCheckoutSessionId',
            'stripePaymentIntentId',
            'lastPaidStripeCheckoutSessionId',
            'checkoutAttemptToken',
            'publicCheckoutCapabilityHash',
            'checkoutAmountCents',
            'checkoutCurrency',
            'checkoutCreationRequest'
        ]) {
            expect(registration).not.toHaveProperty(field);
        }
        expect(registration.paymentReminder).toEqual({ status: 'active' });
    });

    it('keeps dry runs read-only', async () => {
        const registrationPath = 'teams/team-1/registrationForms/form-1/registrations/registration-1';
        const db = makeFirestore({
            [registrationPath]: {
                paymentReminder: { retryUrl: 'https://allplays.test/app/#/registration?publicCheckoutCapability=legacy' }
            }
        });

        await expect(backfillLegacyRegistrationCheckoutAttempts({
            db,
            apply: false,
            fieldValue,
            logger: { log: vi.fn() }
        })).resolves.toEqual({ matched: 1, migrated: 0 });
        expect(db.runTransaction).not.toHaveBeenCalled();
        expect(db.state.get(registrationPath).paymentReminder).toHaveProperty('retryUrl');
    });

    it('stages and runs both checkout backfills after compatibility functions and before the full deploy', () => {
        const workflow = readFileSync(new URL('../../.github/workflows/deploy-prod.yml', import.meta.url), 'utf8');
        const compatibilityDeploy = workflow.indexOf('checkout-migration-compatibility');
        const teamFeeBackfill = workflow.indexOf('backfill-team-fee-checkout-attempts.mjs" --apply');
        const registrationBackfill = workflow.indexOf('backfill-registration-checkout-attempts.mjs" --apply');
        const fullDeploy = workflow.indexOf('retry_firebase_deploy "hosting,functions" "application"');

        expect(workflow).toContain('registration_checkout_backfill_needed: ${{ steps.firestore_config.outputs.registration_checkout_backfill_needed }}');
        expect(workflow).toContain('functions:queueDueRegistrationFailedPaymentReminders');
        expect(compatibilityDeploy).toBeGreaterThan(-1);
        expect(teamFeeBackfill).toBeGreaterThan(compatibilityDeploy);
        expect(registrationBackfill).toBeGreaterThan(compatibilityDeploy);
        expect(fullDeploy).toBeGreaterThan(teamFeeBackfill);
        expect(fullDeploy).toBeGreaterThan(registrationBackfill);
    });
});
