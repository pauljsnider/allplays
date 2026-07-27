import { buildAppUrl, getPublicAppOrigin } from './appLinks';

export const getPublicBaseUrl = getPublicAppOrigin;

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

    const searchParams = new URLSearchParams({ code: inviteCode });
    const normalizedType = normalizeAppInviteType(inviteType);
    if (normalizedType) {
        searchParams.set('type', normalizedType);
    }
    return buildAppUrl('/accept-invite', searchParams, baseUrl);
}

export function canonicalizeAppAcceptInviteUrl(
    value: string | null | undefined,
    fallbackCode = '',
    fallbackType = '',
    baseUrl = getPublicBaseUrl()
) {
    const rawUrl = String(value || '').trim();
    let code = String(fallbackCode || '').trim();
    let inviteType = String(fallbackType || '').trim();

    if (rawUrl) {
        try {
            const parsed = new URL(rawUrl, new URL(baseUrl).origin);
            const hashRoute = parsed.hash.replace(/^#/, '');
            const [, hashQuery = ''] = hashRoute.split('?', 2);
            const hashParams = new URLSearchParams(hashQuery);
            code = hashParams.get('code') || parsed.searchParams.get('code') || code;
            inviteType = hashParams.get('type') || parsed.searchParams.get('type') || inviteType;
        } catch {
            // Fall back to the explicit code/type supplied by the caller.
        }
    }

    return buildAppAcceptInviteUrl(code, inviteType, baseUrl);
}
