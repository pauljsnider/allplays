import { describe, it, expect, vi } from 'vitest';
import { createLoginRedirectCoordinator, createLoginAuthStateManager } from '../../js/login-page.js';

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

describe('login page auth state manager', () => {
    it('replays a pending authenticated user after redirect processing finishes', () => {
        const authState = createLoginAuthStateManager();
        const user = { uid: 'user-1' };

        authState.beginProcessing();

        expect(authState.captureAuthenticatedUser(user)).toBe(false);
        expect(authState.consumePendingRedirectUser()).toBe(null);

        authState.finishProcessing();

        expect(authState.consumePendingRedirectUser()).toBe(user);
        expect(authState.consumePendingRedirectUser()).toBe(null);
    });

    it('allows immediate redirect when auth processing is not active', () => {
        const authState = createLoginAuthStateManager();

        expect(authState.captureAuthenticatedUser({ uid: 'user-2' })).toBe(true);
        expect(authState.consumePendingRedirectUser()).toBe(null);
    });

    it('clears a buffered user when auth later becomes unauthenticated during processing', () => {
        const authState = createLoginAuthStateManager();

        authState.beginProcessing();
        expect(authState.captureAuthenticatedUser({ uid: 'user-3' })).toBe(false);
        expect(authState.captureAuthenticatedUser(null)).toBe(false);

        authState.finishProcessing();

        expect(authState.consumePendingRedirectUser()).toBe(null);
    });
});
