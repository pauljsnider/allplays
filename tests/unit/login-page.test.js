import { describe, it, expect, vi } from 'vitest';
import { createLoginRedirectCoordinator } from '../../js/login-page.js';

function createCoordinator({
    search = '?code=ab12cd34&type=parent',
    postGoogleAuthMode = null,
    defaultRedirect = 'parent-dashboard.html'
} = {}) {
    const sessionState = new Map();
    if (postGoogleAuthMode !== null) {
        sessionState.set('postGoogleAuthMode', postGoogleAuthMode);
    }

    const windowObject = {
        location: {
            search
        },
        sessionStorage: {
            getItem: vi.fn((key) => sessionState.get(key) ?? null),
            removeItem: vi.fn((key) => {
                sessionState.delete(key);
            })
        }
    };

    const coordinator = createLoginRedirectCoordinator({
        windowObject,
        getRedirectUrl: vi.fn(() => defaultRedirect),
        getPostAuthRedirectUrl: (redirect, inviteCode, shouldRedeemInvite) => (
            shouldRedeemInvite
                ? `accept-invite.html?code=${inviteCode.toUpperCase()}`
                : redirect
        )
    });

    return { coordinator, windowObject };
}

describe('login page redirect coordination', () => {
    it('treats invite type values case-insensitively when code is present', () => {
        const { coordinator } = createCoordinator({
            search: '?code=ab12cd34&type= Admin ',
            defaultRedirect: 'dashboard.html'
        });

        expect(coordinator.shouldRedeemInviteFromLogin).toBe(true);
        expect(coordinator.getPostAuthRedirect({ isAdmin: true }, coordinator.shouldRedeemInviteFromLogin))
            .toBe('accept-invite.html?code=AB12CD34');
    });

    it('does not redeem invite redirects when the invite code is missing', () => {
        const { coordinator } = createCoordinator({
            search: '?type=parent',
            defaultRedirect: 'parent-dashboard.html'
        });

        expect(coordinator.shouldRedeemInviteFromLogin).toBe(false);
        expect(coordinator.getAutoRedirectUrl({ parentOf: [{ teamId: 'team-1' }] })).toBe('parent-dashboard.html');
    });

    it('redeems the invite after Google redirect when the stored mode is login', () => {
        const { coordinator, windowObject } = createCoordinator({ postGoogleAuthMode: 'login' });

        expect(coordinator.getGoogleRedirectUrl({ parentOf: [{ teamId: 'team-1' }] }))
            .toBe('accept-invite.html?code=AB12CD34');
        expect(windowObject.sessionStorage.removeItem).toHaveBeenCalledWith('postGoogleAuthMode');
    });

    it('does not let auth auto-redirect redeem the invite after a Google signup return', () => {
        const { coordinator } = createCoordinator({ postGoogleAuthMode: 'signup' });
        const user = { parentOf: [{ teamId: 'team-1' }] };

        expect(coordinator.getGoogleRedirectUrl(user)).toBe('parent-dashboard.html');
        expect(coordinator.getAutoRedirectUrl(user)).toBe('parent-dashboard.html');
    });

    it('still redeems the invite for authenticated users who directly open an invite link', () => {
        const { coordinator } = createCoordinator({ search: '?code=ab12cd34&type=admin', defaultRedirect: 'dashboard.html' });

        expect(coordinator.getAutoRedirectUrl({ isAdmin: true })).toBe('accept-invite.html?code=AB12CD34');
    });
});
