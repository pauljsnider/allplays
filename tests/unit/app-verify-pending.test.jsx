// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('../../apps/app/src/lib/authService.ts', () => ({
    getRouteForUser: vi.fn(() => '/home'),
    reloadCurrentUser: vi.fn(),
    resendVerificationEmail: vi.fn()
}));

import { reloadCurrentUser, resendVerificationEmail } from '../../apps/app/src/lib/authService.ts';
import { VerifyPending } from '../../apps/app/src/pages/VerifyPending.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function LocationMarker() {
    const location = useLocation();
    return React.createElement('div', { 'data-testid': 'location' }, location.pathname);
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

async function renderVerifyPending(auth) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: ['/verify-pending'] },
            React.createElement(LocationMarker),
            React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: '/verify-pending', element: React.createElement(VerifyPending, { auth }) }),
                React.createElement(Route, { path: '/home', element: React.createElement('div', null, 'Home dashboard') }),
                React.createElement(Route, { path: '/auth', element: React.createElement('div', null, 'Auth page') })
            )
        ));
    });

    return { container, root };
}

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
});

describe('VerifyPending verification return flow', () => {
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

        await act(async () => root.unmount());
    });
});
