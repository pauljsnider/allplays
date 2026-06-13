import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

describe('Stripe async payment webhook handling (issue #2203)', () => {
    it('includes checkout.session.async_payment_succeeded in the list of handled registration events', () => {
        expect(source).toContain("'checkout.session.async_payment_succeeded'");
        // The full list should include all four event types
        expect(source).toContain("'checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_failed', 'checkout.session.async_payment_succeeded'");
    });

    it('marks a registration as paid when async_payment_succeeded fires', () => {
        // shouldMarkRegistrationPaidFromEvent must return true for async_payment_succeeded
        expect(source).toContain("if (event?.type === 'checkout.session.async_payment_succeeded') {");
        expect(source).toContain("return session.metadata?.product === 'registration';");
    });

    it('has an isAsyncPaymentPending helper that detects payment_status === open', () => {
        expect(source).toContain('function isAsyncPaymentPending(session) {');
        expect(source).toContain("return (session?.payment_status) === 'open';");
    });

    it('sets checkoutStatus async_pending and paymentStatus pending_payment without releasing capacity when payment_status is open', () => {
        // When checkout.session.completed fires with payment_status 'open', hold capacity
        expect(source).toContain('if (isAsyncPaymentPending(session)) {');
        expect(source).toContain("checkoutStatus: 'async_pending',");
        expect(source).toContain("paymentStatus: 'pending_payment',");
        // The async_pending block is only the if-branch content before the else;
        // verify that registrationCapacityReleased appears AFTER the async_pending block
        // (i.e., only in the else branch, not mixed in with async_pending).
        const asyncPendingStart = source.indexOf("checkoutStatus: 'async_pending',");
        const asyncPendingEnd = source.indexOf("} else {\n          const selectedOption");
        const asyncPendingBlock = source.slice(asyncPendingStart, asyncPendingEnd);
        expect(asyncPendingBlock).not.toContain('registrationCapacityReleased');
        expect(asyncPendingBlock).not.toContain('capacityReleasedAt');
    });

    it('releases capacity and marks payment_failed for non-async failure events', () => {
        // The failure path (expired / sync failure) still releases capacity
        expect(source).toContain("checkoutStatus: event.type === 'checkout.session.expired' ? 'expired' : 'payment_failed',");
        expect(source).toContain("paymentStatus: event.type === 'checkout.session.expired' ? 'checkout_expired' : 'payment_failed',");
        expect(source).toContain('registrationCapacityReleased: true,');
        expect(source).toContain('capacityReleasedAt: receivedAt,');
    });

    it('keeps existing async_payment_failed reminder email handling unchanged', () => {
        expect(source).toContain("if (event.type === 'checkout.session.async_payment_failed') {");
        expect(source).toContain("reminderLabel: 'We could not process your registration payment.',");
        expect(source).toContain("sequence: 'initial'");
    });
});
