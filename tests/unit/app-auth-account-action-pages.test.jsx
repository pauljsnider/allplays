// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const authServiceMocks = vi.hoisted(() => ({
    applyEmailActionCode: vi.fn(),
    confirmReset: vi.fn(),
    getRouteForUser: vi.fn(() => '/home'),
    reloadCurrentUser: vi.fn(),
    resendVerificationEmail: vi.fn(),
    verifyResetCode: vi.fn()
}));

vi.mock('../../apps/app/src/lib/authService.ts', () => authServiceMocks);

import { ResetPassword } from '../../apps/app/src/pages/ResetPassword.tsx';
import { VerifyPending } from '../../apps/app/src/pages/VerifyPending.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function buildAuth(overrides = {}) {
    return {
        user: {
            uid: 'user-1',
            email: 'parent@example.com',
            displayName: 'Pat Parent',
            emailVerified: false,
            roles: ['parent']
        },
        profile: null,
        loading: false,
        error: null,
        roles: ['parent'],
        isParent: true,
        isCoach: false,
        isAdmin: false,
        isPlatformAdmin: false,
        refresh: vi.fn(async () => ({
            uid: 'user-1',
            email: 'parent@example.com',
            emailVerified: false,
            roles: ['parent']
        })),
        signOut: vi.fn(),
        ...overrides
    };
}

async function renderWithRoutes(initialEntry, routeElement, routePath = '/reset-password') {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: [initialEntry] },
            React.createElement(
                Routes,
                null,
                React.createElement(Route, { path: routePath, element: routeElement }),
                React.createElement(Route, { path: '/auth', element: React.createElement('div', { 'data-testid': 'auth-target' }, 'Auth target') }),
                React.createElement(Route, { path: '/home', element: React.createElement('div', { 'data-testid': 'home-target' }, 'Home target') })
            )
        ));
    });

    await flush();
    return { container, root };
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

async function waitForText(container, text) {
    for (let index = 0; index < 30; index += 1) {
        if (container.textContent.includes(text)) return;
        await flush();
    }
    throw new Error(`Timed out waiting for text: ${text}`);
}

function buttonByText(container, text) {
    return Array.from(container.querySelectorAll('button')).find((button) => button.textContent.trim() === text);
}

function inputByPlaceholder(container, placeholder) {
    return container.querySelector(`input[placeholder="${placeholder}"]`);
}

async function changeInput(input, value) {
    await act(async () => {
        const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        valueSetter?.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
}

async function submitForm(form) {
    await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
}

beforeEach(() => {
    vi.clearAllMocks();
    authServiceMocks.applyEmailActionCode.mockResolvedValue(undefined);
    authServiceMocks.confirmReset.mockResolvedValue(undefined);
    authServiceMocks.getRouteForUser.mockReturnValue('/home');
    authServiceMocks.reloadCurrentUser.mockResolvedValue(undefined);
    authServiceMocks.resendVerificationEmail.mockResolvedValue(undefined);
    authServiceMocks.verifyResetCode.mockResolvedValue('parent@example.com');
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('ResetPassword account actions', () => {
    it('rejects links without an action code before calling Firebase helpers', async () => {
        const { container } = await renderWithRoutes(
            '/reset-password?mode=resetPassword',
            React.createElement(ResetPassword)
        );

        await waitForText(container, 'No account action code was provided.');
        expect(authServiceMocks.verifyResetCode).not.toHaveBeenCalled();
        expect(authServiceMocks.applyEmailActionCode).not.toHaveBeenCalled();
    });

    it('applies verify-email action codes and shows the login handoff', async () => {
        const { container } = await renderWithRoutes(
            '/reset-password?mode=verifyEmail&oobCode=verify-code',
            React.createElement(ResetPassword)
        );

        await waitForText(container, 'Email verified. You can continue to ALL PLAYS.');
        expect(authServiceMocks.applyEmailActionCode).toHaveBeenCalledWith('verify-code');
        expect(
            Array.from(container.querySelectorAll('a[href="/auth"]')).some((link) => link.textContent === 'Continue to login')
        ).toBe(true);
    });

    it('verifies reset codes, validates local password input, and confirms the reset', async () => {
        const { container } = await renderWithRoutes(
            '/reset-password?mode=resetPassword&oobCode=reset-code',
            React.createElement(ResetPassword)
        );

        await waitForText(container, 'Reset password');
        expect(authServiceMocks.verifyResetCode).toHaveBeenCalledWith('reset-code');

        await changeInput(inputByPlaceholder(container, 'New password'), 'better-password');
        await changeInput(inputByPlaceholder(container, 'Confirm password'), 'different-password');
        await submitForm(container.querySelector('form'));
        expect(container.textContent).toContain('Passwords do not match.');
        expect(authServiceMocks.confirmReset).not.toHaveBeenCalled();

        await changeInput(inputByPlaceholder(container, 'Confirm password'), 'better-password');
        await submitForm(container.querySelector('form'));

        await waitForText(container, 'Password reset successful. Sign in with your new password.');
        expect(authServiceMocks.confirmReset).toHaveBeenCalledWith('reset-code', 'better-password');
    });
});

describe('VerifyPending page', () => {
    it('redirects signed-out users back to auth', async () => {
        const auth = buildAuth({ user: null });
        const { container } = await renderWithRoutes(
            '/verify-pending',
            React.createElement(VerifyPending, { auth }),
            '/verify-pending'
        );

        await waitForText(container, 'Auth target');
        expect(authServiceMocks.resendVerificationEmail).not.toHaveBeenCalled();
    });

    it('refreshes verification state and navigates when the user is verified', async () => {
        const auth = buildAuth({
            refresh: vi.fn(async () => ({
                uid: 'user-1',
                email: 'parent@example.com',
                emailVerified: true,
                roles: ['parent']
            }))
        });
        const { container } = await renderWithRoutes(
            '/verify-pending',
            React.createElement(VerifyPending, { auth }),
            '/verify-pending'
        );

        await waitForText(container, 'Verify your email');
        await act(async () => {
            buttonByText(container, "I've verified, continue").click();
        });
        await waitForText(container, 'Home target');

        expect(authServiceMocks.reloadCurrentUser).toHaveBeenCalledTimes(1);
        expect(auth.refresh).toHaveBeenCalledTimes(1);
        expect(authServiceMocks.getRouteForUser).toHaveBeenCalledWith(expect.objectContaining({ emailVerified: true }));
    });

    it('reveals secondary options, resends verification email, and signs out', async () => {
        const auth = buildAuth();
        const { container } = await renderWithRoutes(
            '/verify-pending',
            React.createElement(VerifyPending, { auth }),
            '/verify-pending'
        );

        await waitForText(container, 'Verify your email');
        await act(async () => {
            buttonByText(container, 'Need another option?').click();
        });
        await waitForText(container, 'Continue without verifying');

        await act(async () => {
            buttonByText(container, 'Resend verification email').click();
        });
        await waitForText(container, 'Verification email queued. Check your inbox and spam folder shortly.');
        expect(authServiceMocks.resendVerificationEmail).toHaveBeenCalledTimes(1);

        await act(async () => {
            buttonByText(container, 'Sign out').click();
        });
        await flush();
        expect(auth.signOut).toHaveBeenCalledTimes(1);
    });
});
