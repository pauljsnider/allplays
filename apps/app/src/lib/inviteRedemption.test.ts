import { beforeEach, describe, expect, it, vi } from 'vitest';

const authServiceMocks = vi.hoisted(() => ({
    clearPendingInvite: vi.fn(),
    mapLegacyRedirectToAppRoute: vi.fn(() => '/home'),
    redeemInviteForUser: vi.fn()
}));

vi.mock('./authService', () => authServiceMocks);

import { getValidatedInviteCode, normalizeInviteCode, redeemSignedInInvite } from './inviteRedemption';

describe('inviteRedemption', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('normalizes invite codes before redemption', async () => {
        authServiceMocks.redeemInviteForUser.mockResolvedValue({ message: 'Invite accepted.', redirectUrl: 'parent-dashboard.html' });
        const refresh = vi.fn().mockResolvedValue(undefined);

        await expect(redeemSignedInInvite({
            userId: 'parent-1',
            code: ' ab12cd34 ',
            email: 'parent@example.com',
            refresh
        })).resolves.toMatchObject({ code: 'AB12CD34', redirectPath: '/home', message: 'Invite accepted.' });

        expect(authServiceMocks.redeemInviteForUser).toHaveBeenCalledWith('parent-1', 'AB12CD34', 'parent@example.com');
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(authServiceMocks.clearPendingInvite).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid invite codes before network work', async () => {
        expect(normalizeInviteCode(' ab12cd34 ')).toBe('AB12CD34');
        expect(() => getValidatedInviteCode('abc123')).toThrow('Please enter a valid 8-character invite code.');
        await expect(redeemSignedInInvite({ userId: 'parent-1', code: 'short' })).rejects.toThrow('Please enter a valid 8-character invite code.');
        expect(authServiceMocks.redeemInviteForUser).not.toHaveBeenCalled();
    });
});
