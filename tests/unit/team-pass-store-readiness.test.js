import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

const clientSources = [
    'apps/app/src/pages/TeamDetail.tsx',
    'apps/app/src/lib/teamDetailService.ts',
    'js/team-pass.js'
];
const functionsSource = read('functions/index.js');

function exportBlock(name, nextName) {
    const start = functionsSource.indexOf(`exports.${name} =`);
    const end = functionsSource.indexOf(`exports.${nextName} =`, start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return functionsSource.slice(start, end);
}

describe('Team Pass store readiness', () => {
    it.each(clientSources)('contains no Team Pass purchase surface in %s', (relativePath) => {
        const source = read(relativePath);
        const purchaseLabel = ['Buy', 'Team Pass'].join(' ');
        const checkoutCallable = ['createStripe', 'TeamPassCheckout'].join('');

        expect(source).not.toContain(purchaseLabel);
        expect(source).not.toContain('data-team-pass-checkout');
        expect(source).not.toContain(checkoutCallable);
        expect(source).not.toContain('checkout.stripe.com');
    });

    it('rejects old-client Team Pass checkout calls before auth, storage, or Stripe', () => {
        const callable = exportBlock('createStripeTeamPassCheckout', 'createStripeTeamFeeCheckout');

        expect(callable).toContain("'failed-precondition'");
        expect(callable).toContain("'Team Pass sales are not available.'");
        expect(callable).not.toContain('context.auth');
        expect(callable).not.toContain('firestore');
        expect(callable).not.toContain('stripe.checkout.sessions.create');
    });

    it('preserves real-world team-fee checkout separately', () => {
        const teamFeeCallable = exportBlock('createStripeTeamFeeCheckout', 'refundStripeTeamFeePayment');

        expect(teamFeeCallable).toContain('assertPaymentsEnabled');
        expect(teamFeeCallable).toContain('stripe.checkout.sessions.create');
    });
});
