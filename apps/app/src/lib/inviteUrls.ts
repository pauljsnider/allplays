function getPublicBaseUrl() {
    if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)) {
        return window.location.origin;
    }
    return 'https://allplays.ai';
}

export function buildAppAcceptInviteUrl(code: string, inviteType?: string | null, baseUrl = getPublicBaseUrl()) {
    const inviteCode = String(code || '').trim().toUpperCase();
    if (!inviteCode) {
        return '';
    }

    const url = new URL('/app', baseUrl);
    const searchParams = new URLSearchParams();
    searchParams.set('code', inviteCode);

    const normalizedType = String(inviteType || '').trim().toLowerCase();
    if (normalizedType) {
        searchParams.set('type', normalizedType);
    }

    url.hash = `/accept-invite?${searchParams.toString()}`;
    return url.toString();
}
