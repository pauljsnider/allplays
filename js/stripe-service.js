
import { getFunctions, httpsCallable } from './firebase.js';

export async function initiateStripeCheckout(params) {
    try {
        const functions = getFunctions();
        const createCheckoutSession = httpsCallable(functions, 'createStripeRegistrationCheckout');
        const result = await createCheckoutSession(params);

        if (result && result.data && result.data.checkoutUrl) {
            return result.data.checkoutUrl;
        } else {
            console.error('StripeService: Invalid response from createStripeRegistrationCheckout', result);
            throw new Error('Failed to get Stripe checkout URL.');
        }
    } catch (error) {
        console.error('StripeService: Error calling createStripeRegistrationCheckout:', error);
        throw error;
    }
}

export async function initiateTeamFeeCheckout(params) {
    try {
        const functions = getFunctions();
        const createCheckoutSession = httpsCallable(functions, 'createStripeTeamFeeCheckout');
        const result = await createCheckoutSession(params);

        if (result && result.data && result.data.checkoutUrl) {
            return result.data.checkoutUrl;
        }

        console.error('StripeService: Invalid response from createStripeTeamFeeCheckout', result);
        throw new Error('Failed to get Stripe checkout URL.');
    } catch (error) {
        console.error('StripeService: Error calling createStripeTeamFeeCheckout:', error);
        throw error;
    }
}
