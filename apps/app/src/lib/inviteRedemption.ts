import { getParentHomeSecondaryCacheKey, getParentScheduleSummaryCacheKey, invalidateCachedAppData } from './appDataCache';
import { clearPendingInvite, mapLegacyRedirectToAppRoute, redeemInviteForUser } from './authService';

export type SignedInInviteRedemptionOptions = {
    userId: string;
    code: string;
    email?: string | null;
    refresh?: () => Promise<unknown>;
};

export function normalizeInviteCode(code: string | null | undefined) {
    return String(code || '').trim().toUpperCase();
}

export function getValidatedInviteCode(code: string | null | undefined) {
    const normalizedCode = normalizeInviteCode(code);
    if (normalizedCode.length !== 8) {
        throw new Error('Please enter a valid 8-character invite code.');
    }
    return normalizedCode;
}

export async function redeemSignedInInvite({ userId, code, email, refresh }: SignedInInviteRedemptionOptions) {
    const normalizedCode = getValidatedInviteCode(code);
    const result = await redeemInviteForUser(userId, normalizedCode, email);
    // The parent link now exists in the profile, but this client may already
    // hold a pre-link parent schedule summary (empty children, no linked team
    // in the filters) in the persisted app-data cache. Clear it before the
    // page refreshes so the refresh recomputes the parent scope with the new
    // link instead of re-serving the cached empty schedule (#5247; the
    // cache-invalidation half of the #2525 parent-link repair requirement).
    invalidateCachedAppData(getParentScheduleSummaryCacheKey(userId));
    invalidateCachedAppData(getParentHomeSecondaryCacheKey(userId));
    if (refresh) {
        await refresh();
    }
    clearPendingInvite();
    return {
        code: normalizedCode,
        redirectPath: mapLegacyRedirectToAppRoute(result?.redirectUrl),
        message: result?.message || 'Invite accepted.',
        result
    };
}
