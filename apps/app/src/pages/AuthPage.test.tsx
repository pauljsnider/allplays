import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AcceptInvite } from './AcceptInvite';
import { AuthPage } from './AuthPage';
import type { AuthState } from '../lib/types';

const authServiceMocks = vi.hoisted(() => ({
    clearPendingInvite: vi.fn(),
    completeEmailLink: vi.fn(),
    completeGoogleRedirect: vi.fn(async () => null),
    describeAuthError: vi.fn((error: Error) => error.message),
    getRouteForUser: vi.fn(() => '/home'),
    hydrateFirebaseUser: vi.fn(),
    isEmailLink: vi.fn(() => false),
    mapLegacyRedirectToAppRoute: vi.fn((value?: string) => value || '/home'),
    readPendingInvite: vi.fn(() => ({ code: '', type: '' })),
    redeemInviteForUser: vi.fn(),
    rememberPendingInvite: vi.fn(),
    sendResetEmail: vi.fn(),
    signInWithEmail: vi.fn(),
    signInWithGoogleAccount: vi.fn(),
    signUpWithEmail: vi.fn()
}));

vi.mock('../lib/authService', () => authServiceMocks);

const auth: AuthState = {
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
    signOut: vi.fn()
};

function renderAuthPage(entry: string) {
    return render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route path="/auth" element={<AuthPage auth={auth} />} />
            </Routes>
        </MemoryRouter>
    );
}

function renderAcceptInvite(entry: string) {
    return render(
        <MemoryRouter initialEntries={[entry]}>
            <Routes>
                <Route path="/accept-invite" element={<AcceptInvite auth={auth} />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('AuthPage invite mode defaults', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authServiceMocks.completeGoogleRedirect.mockResolvedValue(null);
        authServiceMocks.describeAuthError.mockImplementation((error: Error) => error.message);
        authServiceMocks.getRouteForUser.mockReturnValue('/home');
        authServiceMocks.isEmailLink.mockReturnValue(false);
        authServiceMocks.mapLegacyRedirectToAppRoute.mockImplementation((value?: string) => value || '/home');
        authServiceMocks.readPendingInvite.mockReturnValue({ code: '', type: '' });
    });

    it('defaults invite login links to sign in mode', () => {
        renderAuthPage('/auth?code=ABCDEFGH&type=parent&mode=login');

        expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: 'Sign in' })[0]).toHaveClass('bg-white');
        expect(screen.queryByLabelText('Activation or invite code')).not.toBeInTheDocument();
        expect(screen.getByText(/Invite code applied:/)).toBeInTheDocument();
        expect(screen.getByText('ABCDEFGH')).toBeInTheDocument();
    });

    it('defaults invite signup links to sign up mode and prefills the code', () => {
        renderAuthPage('/auth?code=ABCDEFGH&type=parent&mode=signup');

        expect(screen.getByRole('heading', { name: 'Create your account' })).toBeInTheDocument();
        expect(screen.getByLabelText('Activation or invite code')).toHaveValue('ABCDEFGH');
        expect(screen.getByRole('button', { name: 'Create account' })).toBeInTheDocument();
    });
});

describe('AcceptInvite auth handoff', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authServiceMocks.readPendingInvite.mockReturnValue({ code: '', type: '' });
        authServiceMocks.isEmailLink.mockReturnValue(false);
    });

    it('preserves invite code and login intent for existing-account redemption', () => {
        renderAcceptInvite('/accept-invite?code=ABCDEFGH&type=parent');

        expect(screen.getByRole('link', { name: /sign in to accept/i })).toHaveAttribute(
            'href',
            '/auth?code=ABCDEFGH&type=parent&mode=login'
        );
        expect(screen.getByRole('link', { name: /create account with code/i })).toHaveAttribute(
            'href',
            '/auth?code=ABCDEFGH&type=parent&mode=signup'
        );
    });
});
