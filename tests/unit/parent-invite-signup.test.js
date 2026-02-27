import { describe, it, expect, vi } from 'vitest';
import {
    finalizeParentInviteSignup,
    PARENT_INVITE_SIGNUP_ERROR
} from '../../js/parent-invite-signup.js';

describe('parent invite signup finalization', () => {
    it('completes parent invite and profile write on success', async () => {
        const redeemParentInviteFn = vi.fn().mockResolvedValue(undefined);
        const updateUserProfileFn = vi.fn().mockResolvedValue(undefined);
        const rollbackAuthUserFn = vi.fn().mockResolvedValue(undefined);

        await finalizeParentInviteSignup({
            userId: 'user-1',
            inviteCode: 'CODE1234',
            profileData: { email: 'parent@example.com' },
            redeemParentInviteFn,
            updateUserProfileFn,
            rollbackAuthUserFn
        });

        expect(redeemParentInviteFn).toHaveBeenCalledWith('user-1', 'CODE1234');
        expect(updateUserProfileFn).toHaveBeenCalledWith('user-1', { email: 'parent@example.com' });
        expect(rollbackAuthUserFn).not.toHaveBeenCalled();
    });

    it('throws a user-facing error and rolls back auth user when invite redemption fails', async () => {
        const redeemParentInviteFn = vi.fn().mockRejectedValue(new Error('Team or Player not found'));
        const updateUserProfileFn = vi.fn().mockResolvedValue(undefined);
        const rollbackInviteRedemptionFn = vi.fn().mockResolvedValue(undefined);
        const rollbackAuthUserFn = vi.fn().mockResolvedValue(undefined);

        await expect(finalizeParentInviteSignup({
            userId: 'user-1',
            inviteCode: 'CODE1234',
            profileData: { email: 'parent@example.com' },
            redeemParentInviteFn,
            updateUserProfileFn,
            rollbackInviteRedemptionFn,
            rollbackAuthUserFn
        })).rejects.toThrow(PARENT_INVITE_SIGNUP_ERROR);

        expect(rollbackInviteRedemptionFn).not.toHaveBeenCalled();
        expect(rollbackAuthUserFn).toHaveBeenCalledTimes(1);
        expect(updateUserProfileFn).not.toHaveBeenCalled();
    });

    it('rolls back invite redemption before auth rollback when profile update fails', async () => {
        const redeemParentInviteFn = vi.fn().mockResolvedValue(undefined);
        const updateUserProfileFn = vi.fn().mockRejectedValue(new Error('Firestore unavailable'));
        const rollbackInviteRedemptionFn = vi.fn().mockResolvedValue(undefined);
        const rollbackAuthUserFn = vi.fn().mockResolvedValue(undefined);

        await expect(finalizeParentInviteSignup({
            userId: 'user-1',
            inviteCode: 'CODE1234',
            profileData: { email: 'parent@example.com' },
            redeemParentInviteFn,
            updateUserProfileFn,
            rollbackInviteRedemptionFn,
            rollbackAuthUserFn
        })).rejects.toThrow(PARENT_INVITE_SIGNUP_ERROR);

        expect(rollbackInviteRedemptionFn).toHaveBeenCalledWith('user-1', 'CODE1234');
        expect(rollbackInviteRedemptionFn.mock.invocationCallOrder[0])
            .toBeLessThan(rollbackAuthUserFn.mock.invocationCallOrder[0]);
        expect(rollbackAuthUserFn).toHaveBeenCalledTimes(1);
    });

    it('does not delete auth user when invite rollback fails after invite redemption', async () => {
        const redeemParentInviteFn = vi.fn().mockResolvedValue(undefined);
        const updateUserProfileFn = vi.fn().mockRejectedValue(new Error('Firestore unavailable'));
        const rollbackInviteRedemptionFn = vi.fn().mockRejectedValue(new Error('Rollback unavailable'));
        const rollbackAuthUserFn = vi.fn().mockResolvedValue(undefined);

        await expect(finalizeParentInviteSignup({
            userId: 'user-1',
            inviteCode: 'CODE1234',
            profileData: { email: 'parent@example.com' },
            redeemParentInviteFn,
            updateUserProfileFn,
            rollbackInviteRedemptionFn,
            rollbackAuthUserFn
        })).rejects.toThrow(PARENT_INVITE_SIGNUP_ERROR);

        expect(rollbackInviteRedemptionFn).toHaveBeenCalledWith('user-1', 'CODE1234');
        expect(rollbackAuthUserFn).not.toHaveBeenCalled();
    });
});
