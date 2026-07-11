// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const authServiceMocks = vi.hoisted(() => ({
    clearPendingInvite: vi.fn(),
    completeEmailLink: vi.fn(),
    completeGoogleRedirect: vi.fn(async () => null),
    describeAuthError: vi.fn((error) => error.message),
    getRouteForUser: vi.fn(() => '/home'),
    hydrateFirebaseUser: vi.fn(),
    isEmailLink: vi.fn(() => false),
    mapLegacyRedirectToAppRoute: vi.fn((value) => value || '/home'),
    readPendingInvite: vi.fn(() => ({ code: '', type: '' })),
    redeemInviteForUser: vi.fn(),
    rememberPendingInvite: vi.fn(),
    sendResetEmail: vi.fn(),
    signInWithEmail: vi.fn(),
    signInWithGoogleAccount: vi.fn(),
    signUpWithEmail: vi.fn(),
}));

vi.mock('../../apps/app/src/lib/authService.ts', () => authServiceMocks);

import { AcceptInvite } from '../../apps/app/src/pages/AcceptInvite.tsx';
import { AuthPage } from '../../apps/app/src/pages/AuthPage.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const auth = {
    user: null,
    profile: null,
    loading: false,
    error: null,
    roles: [],
    isParent: false,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: vi.fn(),
    signOut: vi.fn(),
};

async function renderRoute(entry, path, element) {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
        root.render(React.createElement(
            MemoryRouter,
            { initialEntries: [entry] },
            React.createElement(
                Routes,
                null,
                React.createElement(Route, { path, element })
            )
        ));
    });

    await flush();
    return { container, root };
}

function renderAuthPage(entry) {
    return renderRoute(entry, '/auth', React.createElement(AuthPage, { auth }));
}

function renderAcceptInvite(entry) {
    return renderRoute(entry, '/accept-invite', React.createElement(AcceptInvite, { auth }));
}

async function flush() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

function findButton(container, text) {
    return Array.from(container.querySelectorAll('button')).find((element) => element.textContent.trim() === text);
}

function findLink(container, pattern) {
    return Array.from(container.querySelectorAll('a')).find((element) => pattern.test(element.textContent));
}

function findInputByLabel(container, labelText) {
    return Array.from(container.querySelectorAll('input')).find(
        (element) => element.labels && Array.from(element.labels).some((label) => label.textContent.includes(labelText))
    );
}

beforeEach(() => {
    vi.clearAllMocks();
    authServiceMocks.completeGoogleRedirect.mockResolvedValue(null);
    authServiceMocks.describeAuthError.mockImplementation((error) => error.message);
    authServiceMocks.getRouteForUser.mockReturnValue('/home');
    authServiceMocks.isEmailLink.mockReturnValue(false);
    authServiceMocks.mapLegacyRedirectToAppRoute.mockImplementation((value) => value || '/home');
    authServiceMocks.readPendingInvite.mockReturnValue({ code: '', type: '' });
});

afterEach(() => {
    document.body.innerHTML = '';
});

describe('AuthPage invite mode defaults', () => {
    it('defaults bare invite links to sign up mode and prefills the code', async () => {
        const { container } = await renderAuthPage('/auth?code=ABCDEFGH&type=parent');

        expect(container.querySelector('h1')?.textContent).toBe('Create your account');
        expect(findButton(container, 'Sign up')?.className).toContain('bg-white');
        expect(findInputByLabel(container, 'Activation or invite code')?.value).toBe('ABCDEFGH');
        expect(findButton(container, 'Create account')).toBeTruthy();
    });

    it('defaults invite login links to sign in mode', async () => {
        const { container } = await renderAuthPage('/auth?code=ABCDEFGH&type=parent&mode=login');

        expect(container.querySelector('h1')?.textContent).toBe('Sign in');
        expect(findButton(container, 'Sign in')?.className).toContain('bg-white');
        expect(findInputByLabel(container, 'Activation or invite code')).toBeUndefined();
        expect(container.textContent).toContain('Invite code entered:');
        expect(container.textContent).toContain('We’ll verify it after you sign in or create your account.');
        expect(container.textContent).not.toContain('Invite code applied:');
        expect(container.textContent).toContain('ABCDEFGH');
    });

    it('defaults invite signup links to sign up mode and prefills the code', async () => {
        const { container } = await renderAuthPage('/auth?code=ABCDEFGH&type=parent&mode=signup');

        expect(container.querySelector('h1')?.textContent).toBe('Create your account');
        expect(findInputByLabel(container, 'Activation or invite code')?.value).toBe('ABCDEFGH');
        expect(findButton(container, 'Create account')).toBeTruthy();
    });
});

describe('AcceptInvite auth handoff', () => {
    it('preserves invite code and login intent for existing-account redemption', async () => {
        const { container } = await renderAcceptInvite('/accept-invite?code=ABCDEFGH&type=parent');

        expect(container.textContent).toContain('Invite code entered');
        expect(container.textContent).toContain('We’ll verify this code after you sign in or create your account.');
        expect(container.textContent).not.toContain('Invite found');
        expect(findLink(container, /sign in to accept/i)?.getAttribute('href')).toBe('/auth?code=ABCDEFGH&type=parent&mode=login');
        expect(findLink(container, /create account with code/i)?.getAttribute('href')).toBe('/auth?code=ABCDEFGH&type=parent&mode=signup');
    });
});
