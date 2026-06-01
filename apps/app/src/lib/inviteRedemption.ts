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
