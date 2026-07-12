import { functions, httpsCallable } from './firebase.js?v=20';

async function callAuthEmailFunction(name, data = {}) {
    const callable = httpsCallable(functions, name);
    const response = await callable(data);
    const result = response?.data || response || {};
    if (result.queued !== true && result.alreadyVerified !== true) {
        throw new Error('Authentication email could not be queued.');
    }
    return result;
}

export function queuePasswordResetEmail(email) {
    return callAuthEmailFunction('queuePasswordResetEmail', {
        email: String(email || '').trim().toLowerCase()
    });
}

export function queueCurrentUserVerificationEmail(idToken = '') {
    const payload = String(idToken || '').trim() ? { idToken: String(idToken).trim() } : {};
    return callAuthEmailFunction('queueEmailVerification', payload);
}

export function queueInviteSignInEmail(inviteCode) {
    return callAuthEmailFunction('queueInviteSignInEmail', {
        code: String(inviteCode || '').trim().toUpperCase()
    });
}
