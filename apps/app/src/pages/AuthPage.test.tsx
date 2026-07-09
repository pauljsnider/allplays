// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPage } from './AuthPage';
import type { AuthState, AuthUser } from '../lib/types';

const authServiceMocks = vi.hoisted(() => ({
  completeGoogleRedirect: vi.fn(async () => null),
  describeAuthError: vi.fn((error: Error) => error.message),
  getRouteForUser: vi.fn((user: AuthUser | null) => {
    if (!user) {
      return '/auth';
    }
    if (user.isAdmin || user.roles.includes('coach') || user.roles.includes('admin') || user.roles.includes('platformAdmin')) {
      return '/teams';
    }
    return '/home';
  }),
  hydrateFirebaseUser: vi.fn(),
  isValidAuthEmail: (value: string | null | undefined) => {
    const normalized = String(value || '').trim().toLowerCase();
    const parts = normalized.split('@');
    return parts.length === 2 && Boolean(parts[0] && parts[1]?.includes('.') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized));
  },
  normalizeAuthEmail: (value: string | null | undefined) => String(value || '').trim().toLowerCase(),
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

function renderAuthPage(path = '/auth') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth" element={<AuthPage auth={auth} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AuthPage native post-login routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.refresh = vi.fn();
    auth.signOut = vi.fn();
    authServiceMocks.hydrateFirebaseUser.mockReset();
    authServiceMocks.signInWithEmail.mockReset();
    authServiceMocks.signInWithGoogleAccount.mockReset();
    window.location.hash = '';
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        hash: '',
        reload: vi.fn()
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('reloads native email sign-in to the coach/admin teams dashboard', async () => {
    authServiceMocks.signInWithEmail.mockResolvedValue({
      user: { uid: 'coach-1', email: 'coach@example.com' },
      nativeRest: true
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
      profile: {}
    });

    renderAuthPage();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Sign in' })[1]);

    await waitFor(() => expect(authServiceMocks.signInWithEmail).toHaveBeenCalledWith('coach@example.com', 'password123'));
    await waitFor(() => expect(window.location.hash).toBe('#/teams'));
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads native Google sign-in to the coach/admin teams dashboard', async () => {
    authServiceMocks.signInWithGoogleAccount.mockResolvedValue({
      user: { uid: 'admin-1', email: 'admin@example.com' },
      nativeRest: true
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: { uid: 'admin-1', email: 'admin@example.com', displayName: 'Admin', roles: ['platformAdmin'] },
      profile: {}
    });

    renderAuthPage();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(authServiceMocks.signInWithGoogleAccount).toHaveBeenCalledWith(null));
    await waitFor(() => expect(window.location.hash).toBe('#/teams'));
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });
});

describe('AuthPage signup validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.refresh = vi.fn();
    auth.signOut = vi.fn();
    authServiceMocks.signUpWithEmail.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('stops signup before Firebase when the email is invalid for Firebase Auth', async () => {
    renderAuthPage('/auth?mode=signup&code=6WSSSW9V&type=parent');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'p@paulsnider' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Enter a valid email address.')).toBeTruthy();
    expect(authServiceMocks.signUpWithEmail).not.toHaveBeenCalled();
  });

  it('normalizes a valid signup email before calling the auth service', async () => {
    authServiceMocks.signUpWithEmail.mockResolvedValue({
      user: { uid: 'new-user', email: 'coach@example.com' }
    });

    renderAuthPage('/auth?mode=signup&code=6WSSSW9V&type=parent');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' Coach@Example.COM ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(authServiceMocks.signUpWithEmail).toHaveBeenCalledWith('coach@example.com', 'secret1', '6WSSSW9V'));
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });
});
