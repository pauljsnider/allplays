import { buildLegacyJoinUrl, isValidJoinCode, normalizeJoinCode } from './join-code.js?v=1';

export function normalizeInviteCode(inviteCode) {
    const normalized = normalizeJoinCode(inviteCode);
    return isValidJoinCode(normalized) ? normalized : null;
}

export function getPostAuthRedirectUrl(defaultRedirectUrl, inviteCode, shouldRedeemInvite = false, inviteType = null) {
    const normalizedCode = normalizeInviteCode(inviteCode);
    if (shouldRedeemInvite && normalizedCode) {
        return buildLegacyJoinUrl(normalizedCode, inviteType);
    }
    return defaultRedirectUrl;
}
