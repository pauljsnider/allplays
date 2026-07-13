function getPublicBaseUrl() {
    if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)) {
        return window.location.origin;
    }
    return 'https://allplays.ai';
}

const inviteTypeAliases: Record<string, string> = {
    standard: 'standard',
    site: 'standard',
    parent: 'parent',
    parent_invite: 'parent',
    admin: 'admin',
    admin_invite: 'admin',
    household: 'household',
    household_invite: 'household',
    coparent: 'coparent',
    co_parent: 'coparent',
    'co-parent': 'coparent',
    coparent_invite: 'coparent',
    friend: 'friend',
    friend_invite: 'friend'
};

export function normalizeAppInviteType(inviteType?: string | null) {
    return inviteTypeAliases[String(inviteType || '').trim().toLowerCase()] || '';
}

export function buildAppAcceptInviteUrl(code: string, inviteType?: string | null, baseUrl = getPublicBaseUrl()) {
    const inviteCode = String(code || '').trim().toUpperCase();
    if (!inviteCode) {
        return '';
    }

    const url = new URL('/app', baseUrl);
    const searchParams = new URLSearchParams();
    searchParams.set('code', inviteCode);
    const normalizedType = normalizeAppInviteType(inviteType);
    if (normalizedType) {
        searchParams.set('type', normalizedType);
    }

    url.hash = `/accept-invite?${searchParams.toString()}`;
    return url.toString();
}
