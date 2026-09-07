// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../apps/app/src/lib/authService.ts', () => ({
    getRouteForUser: vi.fn(() => '/home'),
    readPendingInvite: vi.fn(() => ({ code: '', type: 'parent' })),
    reloadCurrentUser: vi.fn(),
    resendVerificationEmail: vi.fn()
}));

const nativeRuntimeMocks = vi.hoisted(() => ({ native: false }));
const publicActionMocks = vi.hoisted(() => ({ openPublicUrl: vi.fn(async () => undefined) }));

vi.mock('../../apps/app/src/lib/nativeRuntime.ts', () => ({
    isNativeRuntime: () => nativeRuntimeMocks.native
}));
vi.mock('../../apps/app/src/lib/publicActions.ts', () => publicActionMocks);

import { readPendingInvite, reloadCurrentUser, resendVerificationEmail } from '../../apps/app/src/lib/authService.ts';
import { VerifyPending } from '../../apps/app/src/pages/VerifyPending.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function LocationMarker() {
    const location = useLocation();
    return React.createElement('div', { 'data-testid': 'location' }, `${location.pathname}${location.search}`);
}

function createAuth(overrides = {}) {
    return {
        user: {
            uid: 'user-1',
            email: 'coach@example.com',
            displayName: 'Coach Example',
            emailVerified: false,
            roles: []
        },
        profile: null,
        loading: false,
        error: null,
        roles: [],
        isParent: false,
        isCoach: false,
        isAdmin: false,
        isPlatformAdmin: false,
        refresh: vi.fn().mockResolvedValue(null),
        signOut: vi.fn().mockResolvedValue(undefined),
        ...overrides
    };
}

async function renderVerifyPending(auth, entry = '/verify-pending') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: [entry] },
            React.createElement(LocationMarker),
            React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: '/verify-pending', element: React.createElement(VerifyPending, { auth }) }),
                React.createElement(Route, { path: '/home', element: React.createElement('div', null, 'Home dashboard') }),
                React.createElement(Route, { path: '/accept-invite', element: React.createElement('div', null, 'Pending invite') }),
                React.createElement(Route, { path: '/auth', element: React.createElement('div', null, 'Auth page') })
            )
        ));
    });

    return { container, root };
}

beforeEach(() => {
    nativeRuntimeMocks.native = false;
    publicActionMocks.openPublicUrl.mockReset();
    publicActionMocks.openPublicUrl.mockResolvedValue(undefined);
    Object.defineProperty(window, 'location', {
        configurable: true,
        value: {
            ...window.location,
            hash: '',
            reload: vi.fn(),
            replace: vi.fn()
        }
    });
});

function buttonByText(container, text) {
    const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent.includes(text));
    if (!button) {
        const labels = Array.from(container.querySelectorAll('button')).map((candidate) => candidate.textContent.trim() || '(unlabeled)');
        throw new Error(`Button not found: ${text}. Available buttons: ${labels.join(', ')}`);
    }
    return button;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    readPendingInvite.mockReturnValue({ code: '', type: 'parent' });
});

describe('VerifyPending verification return flow', () => {
    const diamondViewerRoute = '/live-game-diamond-v2.html?teamId=team%2Fone&gameId=game+one&replay=true&clipStart=1200&clipEnd=5600';

    it('preserves the validated static viewer next when a reloaded verification flow is signed out', async () => {
        const auth = createAuth({ user: null });
        const entry = `/verify-pending?next=${encodeURIComponent(diamondViewerRoute)}`;
        const { container, root } = await renderVerifyPending(auth, entry);

        expect(container.textContent).toContain('Auth page');
        expect(container.querySelector('[data-testid="location"]').textContent)
            .toBe(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);

        await act(async () => root.unmount());
    });

    it('checks refreshed verification status before routing an unverified user away', async () => {
        const auth = createAuth();
        auth.refresh.mockResolvedValueOnce({
            ...auth.user,
            emailVerified: true
        });
        reloadCurrentUser.mockResolvedValueOnce(true);
        const { container, root } = await renderVerifyPending(auth);

        expect(container.textContent).toContain("I've verified, continue");
        expect(container.textContent).not.toContain('Resend verification email');
        expect(container.textContent).not.toContain('Refresh status');

        await act(async () => {
            buttonByText(container, "I've verified, continue").click();
        });

        expect(reloadCurrentUser).toHaveBeenCalledTimes(1);
        expect(auth.refresh).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('Home dashboard');
        expect(container.querySelector('[data-testid="location"]').textContent).toBe('/home');

        await act(async () => root.unmount());
    });

    it('routes onward when refreshed auth state verifies a stale native fallback user', async () => {
        const refreshedUser = {
            uid: 'user-1',
            email: 'coach@example.com',
            displayName: 'Coach Example',
            emailVerified: true,
            roles: []
        };
        const auth = createAuth({
            refresh: vi.fn().mockResolvedValueOnce(refreshedUser)
        });
        reloadCurrentUser.mockResolvedValueOnce(false);
        const { container, root } = await renderVerifyPending(auth);

        await act(async () => {
            buttonByText(container, "I've verified, continue").click();
        });

        expect(reloadCurrentUser).toHaveBeenCalledTimes(1);
        expect(auth.refresh).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain('Home dashboard');
        expect(container.querySelector('[data-testid="location"]').textContent).toBe('/home');
        expect(container.textContent).not.toContain('We could not confirm verification yet.');

        await act(async () => root.unmount());
    });

    it('returns a newly verified user to the preserved admin invite', async () => {
        readPendingInvite.mockReturnValue({ code: 'ADMIN001', type: 'admin' });
        const auth = createAuth();
        auth.refresh.mockResolvedValueOnce({
            ...auth.user,
            emailVerified: true
        });
        reloadCurrentUser.mockResolvedValueOnce(true);
        const { container, root } = await renderVerifyPending(auth);

        await act(async () => {
            buttonByText(container, "I've verified, continue").click();
        });

        expect(container.querySelector('[data-testid="location"]').textContent).toBe('/accept-invite?code=ADMIN001&type=admin');
        expect(container.textContent).toContain('Pending invite');

        await act(async () => root.unmount());
    });

    it('hard-navigates a newly verified user back to the exact static Diamond viewer', async () => {
        const auth = createAuth();
        auth.refresh.mockResolvedValueOnce({
            ...auth.user,
            emailVerified: true
        });
        reloadCurrentUser.mockResolvedValueOnce(true);
        const entry = `/verify-pending?next=${encodeURIComponent(diamondViewerRoute)}`;
        const { container, root } = await renderVerifyPending(auth, entry);

        const backLink = Array.from(container.querySelectorAll('a'))
            .find((candidate) => candidate.textContent.includes('Back'));
        expect(backLink?.getAttribute('href')).toBe(diamondViewerRoute);
        const brandLink = container.querySelector('a.mb-5');
        expect(brandLink?.getAttribute('href')).toBe(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);

        await act(async () => {
            buttonByText(container, "I've verified, continue").click();
        });

        expect(window.location.replace).toHaveBeenCalledWith(diamondViewerRoute);
        expect(container.querySelector('[data-testid="location"]').textContent).toBe('/verify-pending?next=%2Flive-game-diamond-v2.html%3FteamId%3Dteam%252Fone%26gameId%3Dgame%2Bone%26replay%3Dtrue%26clipStart%3D1200%26clipEnd%3D5600');
        expect(window.location.hash).toBe('');
        expect(window.location.reload).not.toHaveBeenCalled();

        await act(async () => root.unmount());
    });

    it('uses hosted web auth after native verification instead of opening the local viewer', async () => {
        nativeRuntimeMocks.native = true;
        const auth = createAuth();
        auth.refresh.mockResolvedValueOnce({
            ...auth.user,
            emailVerified: true
        });
        reloadCurrentUser.mockResolvedValueOnce(true);
        const entry = `/verify-pending?next=${encodeURIComponent(diamondViewerRoute)}`;
        const { container, root } = await renderVerifyPending(auth, entry);

        await act(async () => {
            buttonByText(container, "I've verified, continue").click();
        });

        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith(
            'https://allplays.ai/app/#/auth?next=%2Flive-game-diamond-v2.html%3FteamId%3Dteam%252Fone%26gameId%3Dgame%2Bone%26replay%3Dtrue%26clipStart%3D1200%26clipEnd%3D5600'
        );
        expect(window.location.replace).not.toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it('renders document links for every unverified exit back to the static Diamond viewer', async () => {
        const auth = createAuth({
            refresh: vi.fn().mockResolvedValueOnce({
                uid: 'user-1',
                email: 'coach@example.com',
                displayName: 'Coach Example',
                emailVerified: false,
                roles: []
            })
        });
        reloadCurrentUser.mockResolvedValueOnce(false);
        const entry = `/verify-pending?next=${encodeURIComponent(diamondViewerRoute)}`;
        const { container, root } = await renderVerifyPending(auth, entry);

        const backLink = Array.from(container.querySelectorAll('a'))
            .find((candidate) => candidate.textContent.includes('Back'));
        expect(backLink?.getAttribute('href')).toBe(diamondViewerRoute);
        const brandLink = container.querySelector('a.mb-5');
        expect(brandLink?.getAttribute('href')).toBe(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);

        await act(async () => {
            buttonByText(container, "I've verified, continue").click();
        });

        const continueWithoutVerifying = Array.from(container.querySelectorAll('a'))
            .find((candidate) => candidate.textContent.includes('Continue without verifying'));
        expect(continueWithoutVerifying?.getAttribute('href')).toBe(diamondViewerRoute);
        expect(window.location.replace).not.toHaveBeenCalled();

        await act(async () => {
            buttonByText(container, 'Resend verification email').click();
        });
        expect(resendVerificationEmail).toHaveBeenCalledWith(diamondViewerRoute);

        await act(async () => root.unmount());
    });

    it('uses the native Browser handoff for static-viewer back and continue exits', async () => {
        nativeRuntimeMocks.native = true;
        const hostedAuthUrl = 'https://allplays.ai/app/#/auth?next=%2Flive-game-diamond-v2.html%3FteamId%3Dteam%252Fone%26gameId%3Dgame%2Bone%26replay%3Dtrue%26clipStart%3D1200%26clipEnd%3D5600';
        const auth = createAuth();
        const entry = `/verify-pending?next=${encodeURIComponent(diamondViewerRoute)}`;
        const { container, root } = await renderVerifyPending(auth, entry);

        await act(async () => {
            buttonByText(container, 'Back').click();
        });
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith(hostedAuthUrl);

        await act(async () => {
            buttonByText(container, 'Need another option?').click();
        });
        await act(async () => {
            buttonByText(container, 'Continue without verifying').click();
        });
        expect(publicActionMocks.openPublicUrl).toHaveBeenCalledTimes(2);
        expect(publicActionMocks.openPublicUrl).toHaveBeenLastCalledWith(hostedAuthUrl);
        expect(window.location.replace).not.toHaveBeenCalled();

        await act(async () => root.unmount());
    });

    it('keeps the unverified secondary path on the fallback when a family invite is pending', async () => {
        readPendingInvite.mockReturnValue({ code: 'FAMILY01', type: 'household' });
        const auth = createAuth({
            refresh: vi.fn().mockResolvedValueOnce({
                uid: 'user-1',
                email: 'coach@example.com',
                displayName: 'Coach Example',
                emailVerified: false,
                roles: []
            })
        });
        reloadCurrentUser.mockResolvedValueOnce(false);
        const { container, root } = await renderVerifyPending(auth);

        await act(async () => {
            buttonByText(container, "I've verified, continue").click();
        });

        const continueWithoutVerifying = Array.from(container.querySelectorAll('a'))
            .find((candidate) => candidate.textContent.includes('Continue without verifying'));
        expect(continueWithoutVerifying?.getAttribute('href')).toBe('/home');
        expect(readPendingInvite).not.toHaveBeenCalled();

        await act(async () => root.unmount());
    });

    it('stays on verify pending and exposes secondary options when refreshed state is still unverified', async () => {
        const auth = createAuth({
            refresh: vi.fn().mockResolvedValueOnce({
                uid: 'user-1',
                email: 'coach@example.com',
                displayName: 'Coach Example',
                emailVerified: false,
                roles: []
            })
        });
        reloadCurrentUser.mockResolvedValueOnce(false);
        const { container, root } = await renderVerifyPending(auth);

        await act(async () => {
            buttonByText(container, "I've verified, continue").click();
        });

        expect(container.querySelector('[data-testid="location"]').textContent).toBe('/verify-pending');
        expect(container.textContent).toContain('We could not confirm verification yet.');
        expect(container.textContent).toContain('Continue without verifying');
        expect(container.textContent).toContain('Resend verification email');
        expect(container.textContent).not.toContain('Refresh status');

        await act(async () => {
            buttonByText(container, 'Resend verification email').click();
        });

        expect(resendVerificationEmail).toHaveBeenCalledTimes(1);

        await act(async () => root.unmount());
    });

    it('hides resend and refresh controls when the user is already verified', async () => {
        const auth = createAuth({
            user: {
                uid: 'user-1',
                email: 'coach@example.com',
                displayName: 'Coach Example',
                emailVerified: true,
                roles: []
            }
        });
        const { container, root } = await renderVerifyPending(auth);

        expect(container.textContent).toContain('Email verified');
        expect(container.textContent).toContain('Continue to dashboard');
        expect(container.textContent).not.toContain("I've verified, continue");
        expect(container.textContent).not.toContain('Resend verification email');
        expect(container.textContent).not.toContain('Refresh status');

        auth.refresh.mockResolvedValueOnce(auth.user);
        reloadCurrentUser.mockResolvedValueOnce(true);
        await act(async () => {
            buttonByText(container, 'Continue to dashboard').click();
        });

        expect(reloadCurrentUser).toHaveBeenCalledTimes(1);
        expect(auth.refresh).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="location"]').textContent).toBe('/home');

        await act(async () => root.unmount());
    });

    it('force-refreshes an already verified session before resuming a pending invite', async () => {
        readPendingInvite.mockReturnValue({ code: 'FAMILY01', type: 'coparent' });
        const verifiedUser = {
            uid: 'user-1',
            email: 'coach@example.com',
            displayName: 'Coach Example',
            emailVerified: true,
            roles: []
        };
        const auth = createAuth({
            user: verifiedUser,
            refresh: vi.fn().mockResolvedValueOnce(verifiedUser)
        });
        reloadCurrentUser.mockResolvedValueOnce(true);
        const { container, root } = await renderVerifyPending(auth);

        expect(readPendingInvite).not.toHaveBeenCalled();
        await act(async () => {
            buttonByText(container, 'Continue to dashboard').click();
        });

        expect(reloadCurrentUser).toHaveBeenCalledTimes(1);
        expect(auth.refresh).toHaveBeenCalledTimes(1);
        expect(readPendingInvite).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="location"]').textContent).toBe('/accept-invite?code=FAMILY01&type=coparent');

        await act(async () => root.unmount());
    });
});
