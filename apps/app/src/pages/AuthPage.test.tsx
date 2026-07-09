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
    return '/home';
  }),
  hydrateFirebaseUser: vi.fn(),
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

  it('reloads native email sign-in to the home page', async () => {
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
    await waitFor(() => expect(window.location.hash).toBe('#/home'));
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads native Google sign-in to the home page', async () => {
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
    await waitFor(() => expect(window.location.hash).toBe('#/home'));
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });
});
