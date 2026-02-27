export const PARENT_INVITE_SIGNUP_ERROR =
    'We could not link this invite to a player. Ask your coach for a new invite code.';

/**
 * Complete parent invite onboarding as an atomic operation.
 * On failure, attempts rollback (if provided) and throws a user-facing error.
 */
export async function finalizeParentInviteSignup({
    userId,
    inviteCode,
    profileData,
    redeemParentInviteFn,
    updateUserProfileFn,
    rollbackInviteRedemptionFn,
    rollbackAuthUserFn
}) {
    let inviteRedeemed = false;

    try {
        await redeemParentInviteFn(userId, inviteCode);
        inviteRedeemed = true;
        await updateUserProfileFn(userId, profileData);
    } catch (error) {
        if (inviteRedeemed && typeof rollbackInviteRedemptionFn === 'function') {
            try {
                await rollbackInviteRedemptionFn(userId, inviteCode);
            } catch (rollbackError) {
                console.error('Failed to rollback invite redemption after parent invite error:', rollbackError);
            }
        }

        if (typeof rollbackAuthUserFn === 'function') {
            try {
                await rollbackAuthUserFn();
            } catch (rollbackError) {
                console.error('Failed to rollback auth user after parent invite error:', rollbackError);
            }
        }

        const wrapped = new Error(PARENT_INVITE_SIGNUP_ERROR);
        wrapped.cause = error;
        throw wrapped;
    }
}
