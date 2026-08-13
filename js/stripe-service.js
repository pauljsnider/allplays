
import { getFunctions, httpsCallable } from './firebase.js?v=25';

export function getCanonicalStripeCheckoutUrl(value) {
    if (typeof value !== 'string' || !value || value !== value.trim()) return '';

    try {
        const destination = new URL(value);
        if (
            destination.protocol === 'https:' &&
            destination.hostname === 'checkout.stripe.com' &&
            !destination.username &&
            !destination.password &&
            !destination.port &&
            destination.pathname &&
            destination.pathname !== '/'
        ) {
            return value;
        }
    } catch {
        // Invalid destinations use the same fail-closed result.
    }

    return '';
}

function requireStripeCheckoutUrl(value) {
    const checkoutUrl = getCanonicalStripeCheckoutUrl(value);
    if (!checkoutUrl) throw new Error('Stripe returned an invalid checkout destination.');
    return checkoutUrl;
}

export async function initiateStripeCheckout(params) {
    try {
        const functions = getFunctions();
        const createCheckoutSession = httpsCallable(functions, 'createStripeRegistrationCheckout');
        const result = await createCheckoutSession(params);

        if (result && result.data && result.data.checkoutUrl) {
            return requireStripeCheckoutUrl(result.data.checkoutUrl);
        } else {
            console.error('StripeService: Invalid response from createStripeRegistrationCheckout', result);
            throw new Error('Failed to get Stripe checkout URL.');
        }
    } catch (error) {
        console.error('StripeService: Error calling createStripeRegistrationCheckout:', error);
        throw error;
    }
}

export async function cancelStripeRegistrationCheckout(params) {
    try {
        const functions = getFunctions();
        const cancelCheckoutSession = httpsCallable(functions, 'cancelStripeRegistrationCheckout');
        const result = await cancelCheckoutSession(params);
        return result?.data || { released: false };
    } catch (error) {
        console.error('StripeService: Error calling cancelStripeRegistrationCheckout:', error);
        throw error;
    }
}

export async function initiateTeamFeeCheckout(params) {
    try {
        const functions = getFunctions();
        const createCheckoutSession = httpsCallable(functions, 'createStripeTeamFeeCheckout');
        const result = await createCheckoutSession(params);

        if (result && result.data && result.data.checkoutUrl) {
            return requireStripeCheckoutUrl(result.data.checkoutUrl);
        }

        console.error('StripeService: Invalid response from createStripeTeamFeeCheckout', result);
        throw new Error('Failed to get Stripe checkout URL.');
    } catch (error) {
        console.error('StripeService: Error calling createStripeTeamFeeCheckout:', error);
        throw error;
    }
}
