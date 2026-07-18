import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelStripeRegistrationCheckout, initiateStripeCheckout, initiateTeamFeeCheckout } from '../../js/stripe-service.js';

const mockInnerCallable = vi.fn();

vi.mock('../../js/firebase.js?v=22', () => {
    return {
        getFunctions: vi.fn(() => ({})),
        httpsCallable: vi.fn(() => mockInnerCallable)
    };
});

describe('Stripe Service', () => {
    let httpsCallable;

    beforeEach(async () => {
        const firebaseMocks = await import('../../js/firebase.js?v=22');
        httpsCallable = firebaseMocks.httpsCallable;
        httpsCallable.mockClear();
        mockInnerCallable.mockReset();
    });

    it('initiates registration checkout and returns a URL', async () => {
        mockInnerCallable.mockResolvedValueOnce({
            data: { checkoutUrl: 'https://checkout.stripe.com/mock-session-123' }
        });
        const params = {
            teamId: 'team-1',
            formId: 'form-1',
            registrationId: 'reg-123',
            amount: 10000,
            currency: 'usd',
            checkoutAttemptToken: 'attempt-token-123456'
        };

        const checkoutUrl = await initiateStripeCheckout(params);

        expect(checkoutUrl).toBe('https://checkout.stripe.com/mock-session-123');
        expect(httpsCallable).toHaveBeenCalledWith(expect.any(Object), 'createStripeRegistrationCheckout');
        expect(mockInnerCallable).toHaveBeenCalledWith(params);
    });

    it('throws when the callable fails', async () => {
        mockInnerCallable.mockRejectedValueOnce(new Error('Payment processing failed.'));

        await expect(initiateStripeCheckout({ registrationId: 'reg-456' })).rejects.toThrow('Payment processing failed.');
        expect(httpsCallable).toHaveBeenCalledWith(expect.any(Object), 'createStripeRegistrationCheckout');
    });

    it('throws when checkoutUrl is missing from the response', async () => {
        mockInnerCallable.mockResolvedValueOnce({ data: {} });

        await expect(initiateStripeCheckout({ registrationId: 'reg-789' })).rejects.toThrow('Failed to get Stripe checkout URL.');
        expect(httpsCallable).toHaveBeenCalledWith(expect.any(Object), 'createStripeRegistrationCheckout');
    });

    it('cancels registration checkout and returns release status', async () => {
        mockInnerCallable.mockResolvedValueOnce({
            data: { released: true }
        });
        const params = { teamId: 'team-1', formId: 'form-1', registrationId: 'reg-123', checkoutAttemptToken: 'attempt-token-123456' };

        const result = await cancelStripeRegistrationCheckout(params);

        expect(result).toEqual({ released: true });
        expect(httpsCallable).toHaveBeenCalledWith(expect.any(Object), 'cancelStripeRegistrationCheckout');
        expect(mockInnerCallable).toHaveBeenCalledWith(params);
    });

    it('initiates team fee checkout and returns a URL', async () => {
        mockInnerCallable.mockResolvedValueOnce({
            data: { checkoutUrl: 'https://checkout.stripe.com/team-fee-session' }
        });
        const params = { teamId: 'team-1', batchId: 'batch-1', recipientId: 'player-1' };

        const checkoutUrl = await initiateTeamFeeCheckout(params);

        expect(checkoutUrl).toBe('https://checkout.stripe.com/team-fee-session');
        expect(httpsCallable).toHaveBeenCalledWith(expect.any(Object), 'createStripeTeamFeeCheckout');
        expect(mockInnerCallable).toHaveBeenCalledWith(params);
    });
});
