import { beforeEach, describe, expect, it, vi } from 'vitest';

const authServiceMocks = vi.hoisted(() => ({
    clearPendingInvite: vi.fn(),
    mapLegacyRedirectToAppRoute: vi.fn(() => '/home'),
    redeemInviteForUser: vi.fn()
}));

const appDataCacheMocks = vi.hoisted(() => ({
    getParentScheduleSummaryCacheKey: vi.fn((userId: string) => `parent-schedule-summary:${userId}`),
    getParentHomeSecondaryCacheKey: vi.fn((userId: string) => `parent-home-secondary:${userId}`),
    invalidateCachedAppData: vi.fn()
}));

vi.mock('./authService', () => authServiceMocks);
vi.mock('./appDataCache', () => appDataCacheMocks);

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
        expect(appDataCacheMocks.invalidateCachedAppData).not.toHaveBeenCalled();
    });

    it('invalidates the linked parent schedule caches after a successful redemption (#5247)', async () => {
        authServiceMocks.redeemInviteForUser.mockResolvedValue({ message: 'Invite accepted.', redirectUrl: 'parent-dashboard.html' });
        const refresh = vi.fn().mockResolvedValue(undefined);

        await redeemSignedInInvite({
            userId: 'parent-1',
            code: 'ab12cd34',
            email: 'parent@example.com',
            refresh
        });

        expect(appDataCacheMocks.getParentScheduleSummaryCacheKey).toHaveBeenCalledWith('parent-1');
        expect(appDataCacheMocks.getParentHomeSecondaryCacheKey).toHaveBeenCalledWith('parent-1');
        expect(appDataCacheMocks.invalidateCachedAppData).toHaveBeenCalledWith('parent-schedule-summary:parent-1');
        expect(appDataCacheMocks.invalidateCachedAppData).toHaveBeenCalledWith('parent-home-secondary:parent-1');
        // The stale pre-link summary must be cleared before the page refreshes,
        // so the refresh recomputes the parent scope with the new link instead
        // of re-serving the cached empty schedule.
        expect(appDataCacheMocks.invalidateCachedAppData.mock.invocationCallOrder[0])
            .toBeLessThan(refresh.mock.invocationCallOrder[0]);
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('does not invalidate schedule caches when redemption fails', async () => {
        authServiceMocks.redeemInviteForUser.mockRejectedValue(new Error('Invite not found.'));
        const refresh = vi.fn().mockResolvedValue(undefined);

        await expect(redeemSignedInInvite({
            userId: 'parent-1',
            code: 'ab12cd34',
            email: 'parent@example.com',
            refresh
        })).rejects.toThrow('Invite not found.');

        expect(appDataCacheMocks.invalidateCachedAppData).not.toHaveBeenCalled();
        expect(refresh).not.toHaveBeenCalled();
        expect(authServiceMocks.clearPendingInvite).not.toHaveBeenCalled();
    });
});
