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
        const rollbackAuthUserFn = vi.fn().mockResolvedValue(undefined);

        await expect(finalizeParentInviteSignup({
            userId: 'user-1',
            inviteCode: 'CODE1234',
            profileData: { email: 'parent@example.com' },
            redeemParentInviteFn,
            updateUserProfileFn,
            rollbackAuthUserFn
        })).rejects.toThrow(PARENT_INVITE_SIGNUP_ERROR);

        expect(rollbackAuthUserFn).toHaveBeenCalledTimes(1);
        expect(updateUserProfileFn).not.toHaveBeenCalled();
    });
});
