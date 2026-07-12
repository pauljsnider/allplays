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
  isValidAuthEmail: (value: string | null | undefined) => {
    const normalized = String(value || '').trim().toLowerCase();
    const parts = normalized.split('@');
    return parts.length === 2 && Boolean(parts[0] && parts[1]?.includes('.') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized));
  },
  normalizeAuthEmail: (value: string | null | undefined) => String(value || '').trim().toLowerCase(),
  passwordResetConfirmationMessage: "If an account exists for that email, we've sent a reset link.",
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

  it('opens the signup form when requested without an invite code', () => {
    renderAuthPage('/auth?mode=signup');

    expect(screen.getByRole('heading', { name: 'Create your account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
    expect(screen.getByLabelText('Activation or invite code')).toBeTruthy();
  });

  it('describes an unverified invite code without claiming it was applied', () => {
    renderAuthPage('/auth?mode=login&code=QQQQQQQQ&type=parent');

    expect(screen.getByText(/Invite code entered:/).textContent).toContain('QQQQQQQQ');
    expect(screen.getByText('We’ll verify it after you sign in or create your account.')).toBeTruthy();
    expect(screen.queryByText(/Invite code applied:/)).toBeNull();
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

  it('clears signup validation errors when the related field is edited', async () => {
    renderAuthPage('/auth?mode=signup&code=6WSSSW9V&type=parent');

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');
    const confirmPasswordInput = screen.getByLabelText('Confirm password');

    fireEvent.change(emailInput, { target: { value: 'coach@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'secret1' } });
    fireEvent.change(confirmPasswordInput, { target: { value: 'secret2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Passwords do not match.')).toBeTruthy();

    fireEvent.change(confirmPasswordInput, { target: { value: 'secret1' } });
    expect(screen.queryByText('Passwords do not match.')).toBeNull();
  });

  it('clears activation code errors when the invite code is edited', async () => {
    renderAuthPage('/auth?mode=signup');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Activation or invite code'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Activation code is required.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Activation or invite code'), { target: { value: 'abc123' } });
    expect(screen.queryByText('Activation code is required.')).toBeNull();
  });
});

describe('AuthPage sign-in error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.refresh = vi.fn();
    auth.signOut = vi.fn();
    authServiceMocks.signInWithEmail.mockReset();
    authServiceMocks.signInWithEmail.mockRejectedValue(new Error('Email or password is incorrect.'));
  });

  afterEach(() => {
    cleanup();
  });

  it('clears a failed sign-in error when either credential is edited', async () => {
    renderAuthPage();

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');
    const submitButton = screen.getAllByRole('button', { name: 'Sign in' })[1];

    fireEvent.change(emailInput, { target: { value: 'coach@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'wrong-password' } });
    fireEvent.click(submitButton);

    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();

    fireEvent.change(passwordInput, { target: { value: 'correct-password' } });
    expect(screen.queryByText('Email or password is incorrect.')).toBeNull();

    fireEvent.click(submitButton);
    expect(await screen.findByText('Email or password is incorrect.')).toBeTruthy();

    fireEvent.change(emailInput, { target: { value: 'coach-updated@example.com' } });
    expect(screen.queryByText('Email or password is incorrect.')).toBeNull();
  });
});

describe('AuthPage password reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.refresh = vi.fn();
    auth.signOut = vi.fn();
    authServiceMocks.sendResetEmail.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows neutral confirmation copy after requesting a reset', async () => {
    authServiceMocks.sendResetEmail.mockResolvedValue(undefined);
    renderAuthPage();

    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Password reset email'), {
      target: { value: ' Missing@Example.COM ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset email' }));

    await waitFor(() => expect(authServiceMocks.sendResetEmail).toHaveBeenCalledWith('missing@example.com'));
    expect(await screen.findByText("If an account exists for that email, we've sent a reset link.")).toBeTruthy();
    expect(screen.queryByText(/no all plays account/i)).toBeNull();
  });
});
