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

    const normalizedType = String(inviteType || '').trim().toLowerCase();
    if (!normalizedType) {
        const signupUrl = new URL('/login.html', baseUrl);
        signupUrl.searchParams.set('code', inviteCode);
        return signupUrl.toString();
    }

    const url = new URL('/app', baseUrl);
    const searchParams = new URLSearchParams();
    searchParams.set('code', inviteCode);
    searchParams.set('type', normalizedType);

    url.hash = `/accept-invite?${searchParams.toString()}`;
    return url.toString();
}
