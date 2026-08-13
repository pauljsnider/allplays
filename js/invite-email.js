import { functions, httpsCallable } from './firebase.js?v=26';

export async function queueInviteEmail(inviteCode, options = {}) {
    const code = String(inviteCode || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(code)) {
        throw new Error('A valid eight-character invite code is required.');
    }
    const forceNewDelivery = options?.forceNewDelivery === true;
    const deliveryId = forceNewDelivery
        ? String(options?.deliveryId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`)
        : '';
    const callable = httpsCallable(functions, 'queueInviteEmail');
    const response = await callable({
        code,
        ...(forceNewDelivery ? { forceNewDelivery: true, deliveryId } : {})
    });
    const result = response?.data || response || {};
    if (result.queued !== true) {
        throw new Error('Invite email could not be queued.');
    }
    return result;
}
