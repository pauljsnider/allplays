import { describe, expect, it, vi } from 'vitest';
import { initiateStripeCheckout } from '../../js/stripe-service.js';

// Mock Firebase Functions
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { initiateStripeCheckout } from '../../js/stripe-service.js';

// Define the mock for the *inner* callable function here, outside vi.mock
const mockInnerCallable = vi.fn((params) => {
    if (params.amount === 10000) { // Simulate a successful payment amount
        return Promise.resolve({ data: { checkoutUrl: 'https://checkout.stripe.com/mock-session-123' } });
    } else if (params.amount === 5000) { // Another success case
        return Promise.resolve({ data: { checkoutUrl: 'https://checkout.stripe.com/mock-session-456' } });
    } else if (params.amount === 0) { // No payment amount - should trigger client-side error before this
        return Promise.resolve({ data: { checkoutUrl: null } }); // Simulate invalid response from function
    } else if (params.triggerError) { // Simulate a function error
        return Promise.reject(new Error('Firebase Function error: Payment processing failed.'));
    }
    return Promise.resolve({ data: {} }); // Default empty response
});

// Mock Firebase Functions
vi.mock('../../js/firebase.js', () => {
    const getFunctions = vi.fn(() => ({ /* mock functions instance */ }));
    const httpsCallable = vi.fn(() => mockInnerCallable); // Always return the pre-defined mockInnerCallable

    return {
        getFunctions,
        httpsCallable,
        mockInnerCallable, // Make mockInnerCallable accessible for clearing in beforeEach
    };
});

describe('Stripe Service', () => {
    // Import the mocked functions (and the inner callable spy)
    let httpsCallable;
    let mockInnerCallableRef;

    beforeEach(async () => {
        const firebaseMocks = await import('../../js/firebase.js');
        httpsCallable = firebaseMocks.httpsCallable;
        mockInnerCallableRef = firebaseMocks.mockInnerCallable;

        httpsCallable.mockClear();
        mockInnerCallableRef.mockClear();
    });

    it('should successfully initiate Stripe checkout and return a URL', async () => {
        const params = {
            registrationId: 'reg-123',
            amount: 10000,
            currency: 'usd',
            successUrl: 'http://localhost/success',
            cancelUrl: 'http://localhost/cancel',
            metadata: { teamId: 't1', formId: 'f1' }
        };

        const checkoutUrl = await initiateStripeCheckout(params);

        expect(checkoutUrl).toBe('https://checkout.stripe.com/mock-session-123');
        expect(httpsCallable).toHaveBeenCalledWith(expect.any(Object), 'createStripeCheckoutSession');
        expect(mockInnerCallableRef).toHaveBeenCalledWith(params);
    });

    it('should throw an error if the Firebase Function call fails', async () => {
        const params = {
            registrationId: 'reg-456',
            amount: 20000,
            currency: 'usd',
            successUrl: 'http://localhost/success',
            cancelUrl: 'http://localhost/cancel',
            triggerError: true
        };

        await expect(initiateStripeCheckout(params)).rejects.toThrow('Firebase Function error: Payment processing failed.');
        expect(httpsCallable).toHaveBeenCalledWith(expect.any(Object), 'createStripeCheckoutSession');
        expect(mockInnerCallableRef).toHaveBeenCalledWith(params);
    });

    it('should throw an error if checkoutUrl is missing from the response', async () => {
        const params = {
            registrationId: 'reg-789',
            amount: 0,
            currency: 'usd',
            successUrl: 'http://localhost/success',
            cancelUrl: 'http://localhost/cancel'
        };

        await expect(initiateStripeCheckout(params)).rejects.toThrow('Failed to get Stripe checkout URL.');
        expect(httpsCallable).toHaveBeenCalledWith(expect.any(Object), 'createStripeCheckoutSession');
        expect(mockInnerCallableRef).toHaveBeenCalledWith(params);
    });
});
