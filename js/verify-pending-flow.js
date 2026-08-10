import { buildLegacyJoinUrl } from './join-code.js?v=2';

export function getPendingVerificationRedirectUrl(user, getFallbackRedirectUrl, storage = globalThis.localStorage) {
    const fallbackRedirectUrl = getFallbackRedirectUrl(user);

    try {
        const inviteCode = storage?.getItem('inviteCode') || '';
        const inviteType = storage?.getItem('inviteType') || '';
        return buildLegacyJoinUrl(inviteCode, inviteType) || fallbackRedirectUrl;
    } catch (_storageError) {
        return fallbackRedirectUrl;
    }
}

export async function refreshVerifiedUserToken(user) {
    if (user?.emailVerified !== true) {
        return false;
    }

    await user.getIdToken(true);
    return true;
}
