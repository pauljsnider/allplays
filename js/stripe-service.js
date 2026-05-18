
import { getFunctions, httpsCallable } from './firebase.js';

export async function initiateStripeCheckout(params) {
    try {
        const functions = getFunctions();
        const createCheckoutSession = httpsCallable(functions, 'createStripeCheckoutSession'); // Ensure this matches your Firebase Function name
        const result = await createCheckoutSession(params);

        if (result && result.data && result.data.checkoutUrl) {
            return result.data.checkoutUrl;
        } else {
            console.error('StripeService: Invalid response from createStripeCheckoutSession', result);
            throw new Error('Failed to get Stripe checkout URL.');
        }
    } catch (error) {
        console.error('StripeService: Error calling createStripeCheckoutSession:', error);
        throw error;
    }
}
