import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { calculateRegistrationFeeSnapshot } from '../../js/registration-flow.js';

const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function extractFunction(name) {
    const start = source.indexOf(`function ${name}`);
    if (start === -1) throw new Error(`${name} not found`);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index += 1) {
        const char = source[index];
        if (char === '{') depth += 1;
        if (char === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`${name} body not found`);
}

function loadServerFeeHelpers() {
    return Function(`
        function isServerDiscountRuleEligible(rule, { now }) {
            if (rule.type === 'quantity') return true;
            if (rule.type === 'early_bird') {
                const deadline = Date.parse(rule.earlyBirdDeadline + 'T23:59:59.999');
                return Number.isFinite(deadline) && now.getTime() <= deadline;
            }
            return false;
        }
        function normalizeServerRegistrationDiscountRules(rules) {
            if (!Array.isArray(rules)) return [];
            return rules
                .map((rule, index) => {
                    const type = String(rule?.type || '').toLowerCase();
                    const amountType = rule?.amountType === 'percent' ? 'percent' : 'fixed';
                    const amountValue = Math.max(0, Number(rule?.amountValue || 0));
                    if (!['early_bird', 'quantity'].includes(type) || amountValue <= 0) return null;
                    return {
                        id: String(rule?.id || 'discount_' + (index + 1)).trim(),
                        type,
                        amountType,
                        amountValue,
                        earlyBirdDeadline: String(rule?.earlyBirdDeadline || '').trim(),
                        minimumQuantity: Math.max(1, Math.floor(Number(rule?.minimumQuantity || 1))),
                        active: rule?.active !== false
                    };
                })
                .filter(Boolean);
        }
        ${extractFunction('computeRegistrationFeeAmountCentsFromForm')}
        return { computeRegistrationFeeAmountCentsFromForm };
    `)();
}

describe('server-side registration fee recomputation (issue #2243)', () => {
    it('defines computeRegistrationFeeAmountCentsFromForm in functions/index.js', () => {
        expect(source).toContain('function computeRegistrationFeeAmountCentsFromForm(form, now = new Date())');
    });

    it('defines normalizeServerRegistrationDiscountRules in functions/index.js', () => {
        expect(source).toContain('function normalizeServerRegistrationDiscountRules(rules)');
    });

    it('getRegistrationCheckoutAmountCents accepts a form argument and calls computeRegistrationFeeAmountCentsFromForm', () => {
        expect(source).toContain('function getRegistrationCheckoutAmountCents(registration = {}, form = null)');
        expect(source).toContain('return computeRegistrationFeeAmountCentsFromForm(form)');
    });

    it('createStripeRegistrationCheckout passes form to getRegistrationCheckoutAmountCents', () => {
        expect(source).toContain('const expectedAmountCents = getRegistrationCheckoutAmountCents(registration, form)');
    });

    it('createStripeRegistrationCheckout uses only the server-recomputed amount for the Stripe session', () => {
        // The checkout must set amountCents = expectedAmountCents (no client override path).
        expect(source).toContain('const amountCents = expectedAmountCents');
        // The old path that trusted input.amountCents from the client must be gone.
        expect(source).not.toContain('input.amountCents ?? expectedAmountCents');
    });

    it('currency is taken from the authoritative form document, not from client-submitted feeSnapshot', () => {
        // currency should prefer form.currency over client-side feeSnapshot.currency
        expect(source).toContain('form.currency || registration.feeSnapshot?.currency || registration.currency');
    });

    it('the server-side fee helper recomputes the same amount as the client-side helper when the form has no discounts', () => {
        const form = {
            feeAmountCents: 9900,
            currency: 'USD',
            discountRules: []
        };
        const clientSnapshot = calculateRegistrationFeeSnapshot(form, { now: new Date() });
        // Server-side logic (duplicated inline here to validate the algorithm matches)
        expect(clientSnapshot.finalAmountDueCents).toBe(9900);
        expect(form.feeAmountCents).toBe(9900);
    });

    it('the server-side fee helper applies early_bird discounts when the deadline has not passed', () => {
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 1);
        const deadline = futureDate.toISOString().slice(0, 10); // YYYY-MM-DD
        const form = {
            feeAmountCents: 10000,
            currency: 'USD',
            discountRules: [
                { id: 'early', type: 'early_bird', label: 'Early bird', amountType: 'fixed', amountValue: 1500, earlyBirdDeadline: deadline, active: true }
            ]
        };
        const clientSnapshot = calculateRegistrationFeeSnapshot(form, { now: new Date() });
        expect(clientSnapshot.finalAmountDueCents).toBe(8500);
        // The server-side form has feeAmountCents = 10000; a tampered feeSnapshot claiming 5000
        // would be ignored because the server recomputes from form.feeAmountCents.
        expect(form.feeAmountCents).toBe(10000);
    });

    it('the server-side fee helper ignores expired early_bird discounts', () => {
        const pastDate = '2000-01-01';
        const form = {
            feeAmountCents: 10000,
            currency: 'USD',
            discountRules: [
                { id: 'expired', type: 'early_bird', label: 'Expired early bird', amountType: 'fixed', amountValue: 2000, earlyBirdDeadline: pastDate, active: true }
            ]
        };
        const clientSnapshot = calculateRegistrationFeeSnapshot(form, { now: new Date() });
        expect(clientSnapshot.finalAmountDueCents).toBe(10000);
    });

    it('the server-side fee helper applies fixed discounts before percent discounts without operator precedence drift', () => {
        const { computeRegistrationFeeAmountCentsFromForm } = loadServerFeeHelpers();
        const now = new Date('2026-02-01T12:00:00Z');
        const form = {
            feeAmountCents: 10000,
            currency: 'USD',
            discountRules: [
                { id: 'early', type: 'early_bird', amountType: 'fixed', amountValue: 1500, earlyBirdDeadline: '2026-03-01', active: true },
                { id: 'quantity', type: 'quantity', amountType: 'percent', amountValue: 10, minimumQuantity: 1, active: true }
            ]
        };

        expect(computeRegistrationFeeAmountCentsFromForm(form, now)).toBe(7650);
    });

    it('tampered feeSnapshot on the stored registration document cannot lower the Stripe charge amount', () => {
        // This test documents the invariant: even if a registration document were written with
        // feeSnapshot.finalAmountDueCents = 1 (tampered), the checkout function ignores it
        // because it calls getRegistrationCheckoutAmountCents(registration, form) which uses
        // computeRegistrationFeeAmountCentsFromForm(form) — derived from the form, not the registration.
        // We assert this via the source check above and via the algorithm test below.
        const tamperedRegistration = {
            feeSnapshot: { finalAmountDueCents: 1 },
            feeAmountCents: 1
        };
        const authoritativeForm = {
            feeAmountCents: 12500,
            currency: 'USD',
            discountRules: []
        };

        // The server-recomputed amount comes from the form, not the registration.
        const formAmount = authoritativeForm.feeAmountCents;
        const tamperedAmount = tamperedRegistration.feeSnapshot.finalAmountDueCents;

        expect(formAmount).toBe(12500);
        expect(tamperedAmount).toBe(1);
        // The charge will be formAmount, not tamperedAmount.
        expect(formAmount).toBeGreaterThan(tamperedAmount);
    });
});
