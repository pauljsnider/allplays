import { auth } from './firebase.js';

function getFunctionsBaseUrl() {
    const configured = window.__ALLPLAYS_CONFIG__?.functionsBaseUrl || window.__ALLPLAYS_CONFIG__?.functions?.baseUrl;
    if (configured) return String(configured).replace(/\/$/, '');

    const projectId = auth.app?.options?.projectId;
    if (!projectId) {
        throw new Error('Firebase project ID is not configured.');
    }
    return `https://us-central1-${projectId}.cloudfunctions.net`;
}

export async function createTeamPassCheckout({ teamId, seasonId, tier = 'team-pass' } = {}) {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('Sign in before purchasing a Team Pass.');
    }

    const token = await user.getIdToken();
    const response = await fetch(`${getFunctionsBaseUrl()}/createStripeTeamPassCheckout`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ data: { teamId, seasonId, tier } })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.error) {
        throw new Error(payload.error?.message || 'Unable to start Team Pass checkout.');
    }

    return payload.result || payload.data || payload;
}

export async function redirectToTeamPassCheckout(options) {
    const result = await createTeamPassCheckout(options);
    if (!result.checkoutUrl) {
        throw new Error('Checkout URL was not returned.');
    }
    window.location.href = result.checkoutUrl;
    return result;
}
