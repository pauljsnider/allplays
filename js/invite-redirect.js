export function normalizeInviteCode(inviteCode) {
    const normalized = typeof inviteCode === 'string' ? inviteCode.trim().toUpperCase() : '';
    return normalized.length === 8 ? normalized : null;
}

export function getPostAuthRedirectUrl(defaultRedirectUrl, inviteCode, shouldRedeemInvite = false) {
    const normalizedCode = normalizeInviteCode(inviteCode);
    if (shouldRedeemInvite && normalizedCode) {
        return `accept-invite.html?code=${encodeURIComponent(normalizedCode)}`;
    }
    return defaultRedirectUrl;
}
