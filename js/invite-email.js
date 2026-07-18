import { functions, httpsCallable } from './firebase.js?v=22';

export async function queueInviteEmail(inviteCode) {
    const code = String(inviteCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
        throw new Error('A valid eight-character invite code is required.');
    }
    const callable = httpsCallable(functions, 'queueInviteEmail');
    const response = await callable({ code });
    const result = response?.data || response || {};
    if (result.queued !== true) {
        throw new Error('Invite email could not be queued.');
    }
    return result;
}
