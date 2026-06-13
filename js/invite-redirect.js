export function normalizeInviteCode(inviteCode) {
    const normalized = typeof inviteCode === 'string' ? inviteCode.trim().toUpperCase() : '';
    return normalized.length === 8 ? normalized : null;
}

function normalizeInviteType(inviteType) {
    const normalized = typeof inviteType === 'string' ? inviteType.trim().toLowerCase() : '';

    if (normalized === 'parent' || normalized === 'admin' || normalized === 'household') {
        return normalized;
    }

    if (normalized === 'household_invite') {
        return 'household';
    }

    return null;
}

export function getPostAuthRedirectUrl(defaultRedirectUrl, inviteCode, shouldRedeemInvite = false, inviteType = null) {
    const normalizedCode = normalizeInviteCode(inviteCode);
    if (shouldRedeemInvite && normalizedCode) {
        const searchParams = new URLSearchParams({
            code: normalizedCode
        });
        const normalizedInviteType = normalizeInviteType(inviteType);
        if (normalizedInviteType) {
            searchParams.set('type', normalizedInviteType);
        }
        return `accept-invite.html?${searchParams.toString()}`;
    }
    return defaultRedirectUrl;
}
