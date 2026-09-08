// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthPage } from './AuthPage';
import type { AuthState, AuthUser } from '../lib/types';

const authServiceMocks = vi.hoisted(() => ({
  completeGoogleRedirect: vi.fn(async (): Promise<any> => null),
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
  passwordResetConfirmationMessage: "If an account exists for that email, a reset email has been queued.",
  rememberPendingInvite: vi.fn(),
  sendResetEmail: vi.fn(),
  signInWithAppleAccount: vi.fn(),
  signInWithEmail: vi.fn(),
  signInWithGoogleAccount: vi.fn(),
  signUpWithEmail: vi.fn()
}));
const nativeRuntimeMocks = vi.hoisted(() => ({
  native: false
}));
const publicActionsMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn(async () => undefined)
}));

vi.mock('../lib/authService', () => authServiceMocks);
vi.mock('../lib/nativeRuntime', () => ({
  isNativeRuntime: () => nativeRuntimeMocks.native
}));
vi.mock('../lib/publicActions', () => publicActionsMocks);
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => 'ios'
  }
}));

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

const diamondViewerRoute = '/live-game-diamond-v2.html?teamId=team%2Fone&gameId=game+one&replay=true&clipStart=1200&clipEnd=5600';
const familyFeeRoute = '/parent-tools/fees?teamId=team-1&batchId=batch-1&recipientId=recipient-1';
const scheduleRoute = '/schedule?teamId=team-1&eventId=event-1';
const hostedDiamondAuthUrl = 'https://allplays.ai/app/#/auth?next=%2Flive-game-diamond-v2.html%3FteamId%3Dteam%252Fone%26gameId%3Dgame%2Bone%26replay%3Dtrue%26clipStart%3D1200%26clipEnd%3D5600';
const switchedHostedDiamondAuthUrl = `${hostedDiamondAuthUrl}&switch=1`;

function renderAuthPage(path = '/auth') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/auth" element={<AuthPage auth={auth} />} />
        <Route path="/parent-tools/fees" element={<div>Family fee destination</div>} />
      </Routes>
    </MemoryRouter>
  );
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderNavigableAuthPage(path = '/auth') {
  const router = createMemoryRouter([
    { path: '/auth', element: <AuthPage auth={auth} /> },
    { path: '/home', element: <div>Home destination</div> },
    { path: '/verify-pending', element: <div>Verification destination</div> },
    { path: '/teams/:teamId', element: <div>Team destination</div> }
  ], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

async function leaveAuthForTeam(router: ReturnType<typeof createMemoryRouter>) {
  await act(async () => {
    window.location.hash = '#/teams/team-1';
    await router.navigate('/teams/team-1');
  });
  expect(await screen.findByText('Team destination')).toBeTruthy();
}

describe('AuthPage native post-login routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeRuntimeMocks.native = false;
    auth.user = null;
    auth.loading = false;
    auth.refresh = vi.fn();
    auth.signOut = vi.fn();
    authServiceMocks.hydrateFirebaseUser.mockReset();
    authServiceMocks.signInWithEmail.mockReset();
    authServiceMocks.signInWithAppleAccount.mockReset();
    authServiceMocks.signInWithGoogleAccount.mockReset();
    publicActionsMocks.openPublicUrl.mockReset();
    publicActionsMocks.openPublicUrl.mockResolvedValue(undefined);
    window.location.hash = '';
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
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(authServiceMocks.signInWithEmail).toHaveBeenCalledWith('coach@example.com', 'password123'));
    await waitFor(() => expect(window.location.hash).toBe('#/home'));
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });

  it('keeps native email completion active through the StrictMode effect replay', async () => {
    authServiceMocks.signInWithEmail.mockResolvedValue({
      user: { uid: 'coach-1', email: 'coach@example.com' },
      nativeRest: true
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
      profile: {}
    });
    window.location.hash = '#/auth';

    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/auth']}>
          <Routes>
            <Route path="/auth" element={<AuthPage auth={auth} />} />
          </Routes>
        </MemoryRouter>
      </StrictMode>
    );

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

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

  it('preserves a family fee next route when Google popup fallback completes by redirect', async () => {
    authServiceMocks.completeGoogleRedirect.mockResolvedValueOnce({
      user: { uid: 'parent-1', email: 'parent@example.com' },
      wasNewUser: false
    });
    const feeRoute = '/parent-tools/fees?teamId=team-1&batchId=batch-1&recipientId=recipient-1';

    renderAuthPage(`/auth?next=${encodeURIComponent(feeRoute)}`);

    expect(await screen.findByText('Family fee destination')).toBeTruthy();
    expect(auth.refresh).toHaveBeenCalledTimes(1);
  });

  it('hard-navigates a restored session back to the exact static Diamond viewer', async () => {
    auth.user = {
      uid: 'viewer-1',
      email: 'viewer@example.com',
      displayName: 'Viewer',
      roles: ['parent']
    };
    window.location.hash = '#/auth';

    renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith(diamondViewerRoute));
    expect(window.location.hash).toBe('#/auth');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('keeps an exact viewer account-switch request on sign-in before returning as the selected account', async () => {
    auth.user = {
      uid: 'wrong-viewer',
      email: 'wrong@example.com',
      displayName: 'Wrong Viewer',
      roles: ['parent']
    };
    authServiceMocks.signInWithEmail.mockResolvedValue({
      user: { uid: 'right-viewer', email: 'right@example.com' },
      nativeRest: false
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: { uid: 'right-viewer', email: 'right@example.com', displayName: 'Right Viewer', roles: ['parent'] },
      profile: {}
    });
    window.location.hash = '#/auth';

    renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}&switch=1`);

    await waitFor(() => expect(authServiceMocks.completeGoogleRedirect).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    expect(window.location.replace).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'right@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(authServiceMocks.signInWithEmail).toHaveBeenCalledWith('right@example.com', 'password123'));
    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith(diamondViewerRoute));
  });

  it('does not suppress restored-session navigation for a non-exact account-switch value', async () => {
    auth.user = {
      uid: 'viewer-1',
      email: 'viewer@example.com',
      displayName: 'Viewer',
      roles: ['parent']
    };
    window.location.hash = '#/auth';

    renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}&switch=true`);

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith(diamondViewerRoute));
  });

  it('does not navigate a hydrated session until redirect processing has settled', async () => {
    const redirectResult = createDeferred<any>();
    authServiceMocks.completeGoogleRedirect.mockReturnValueOnce(redirectResult.promise);
    window.location.hash = '#/auth';
    const view = renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);

    await waitFor(() => expect(authServiceMocks.completeGoogleRedirect).toHaveBeenCalledTimes(1));
    auth.user = {
      uid: 'viewer-1',
      email: 'viewer@example.com',
      displayName: 'Viewer',
      roles: ['parent']
    };
    view.rerender(
      <MemoryRouter initialEntries={[`/auth?next=${encodeURIComponent(diamondViewerRoute)}`]}>
        <Routes>
          <Route path="/auth" element={<AuthPage auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    await act(async () => Promise.resolve());
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(publicActionsMocks.openPublicUrl).not.toHaveBeenCalled();

    await act(async () => {
      redirectResult.resolve(null);
      await redirectResult.promise;
    });

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith(diamondViewerRoute));
  });

  it('does not hand a native static viewer to the browser until redirect processing has settled', async () => {
    nativeRuntimeMocks.native = true;
    const redirectResult = createDeferred<any>();
    authServiceMocks.completeGoogleRedirect.mockReturnValueOnce(redirectResult.promise);

    renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);

    await waitFor(() => expect(authServiceMocks.completeGoogleRedirect).toHaveBeenCalledTimes(1));
    expect(publicActionsMocks.openPublicUrl).not.toHaveBeenCalled();
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();

    await act(async () => {
      redirectResult.resolve(null);
      await redirectResult.promise;
    });

    await waitFor(() => expect(publicActionsMocks.openPublicUrl).toHaveBeenCalledWith(hostedDiamondAuthUrl));
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('does not fall through to a restored session when redirect provisioning fails', async () => {
    const redirectResult = createDeferred<any>();
    authServiceMocks.completeGoogleRedirect.mockReturnValueOnce(redirectResult.promise);
    window.location.hash = '#/auth';
    const view = renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);

    await waitFor(() => expect(authServiceMocks.completeGoogleRedirect).toHaveBeenCalledTimes(1));
    auth.user = {
      uid: 'viewer-1',
      email: 'viewer@example.com',
      displayName: 'Viewer',
      roles: ['parent']
    };
    view.rerender(
      <MemoryRouter initialEntries={[`/auth?next=${encodeURIComponent(diamondViewerRoute)}`]}>
        <Routes>
          <Route path="/auth" element={<AuthPage auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );

    await act(async () => {
      redirectResult.reject(new Error('Invite provisioning failed.'));
      await redirectResult.promise.catch(() => undefined);
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Invite provisioning failed.');
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(publicActionsMocks.openPublicUrl).not.toHaveBeenCalled();
  });

  it('hard-navigates web email sign-in back to the exact static Diamond viewer', async () => {
    authServiceMocks.signInWithEmail.mockResolvedValue({
      user: { uid: 'viewer-1', email: 'viewer@example.com' },
      nativeRest: false
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: { uid: 'viewer-1', email: 'viewer@example.com', displayName: 'Viewer', roles: ['parent'] },
      profile: {}
    });

    renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'viewer@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith(diamondViewerRoute));
    expect(window.location.hash).toBe('');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('hard-navigates Google popup sign-in back to the exact static Diamond viewer', async () => {
    authServiceMocks.signInWithGoogleAccount.mockResolvedValue({
      user: { uid: 'viewer-1', email: 'viewer@example.com' },
      nativeRest: false,
      wasNewUser: false
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: { uid: 'viewer-1', email: 'viewer@example.com', displayName: 'Viewer', roles: ['parent'] },
      profile: {}
    });

    renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith(diamondViewerRoute));
    expect(window.location.hash).toBe('');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('hard-navigates Google popup-to-redirect completion back to the exact static Diamond viewer', async () => {
    authServiceMocks.completeGoogleRedirect.mockResolvedValueOnce({
      user: { uid: 'viewer-1', email: 'viewer@example.com' },
      wasNewUser: false
    });

    renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);

    await waitFor(() => expect(window.location.replace).toHaveBeenCalledWith(diamondViewerRoute));
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(window.location.hash).toBe('');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('hands native email document return to hosted web auth without building an app hash', async () => {
    authServiceMocks.signInWithEmail.mockResolvedValue({
      user: { uid: 'viewer-1', email: 'viewer@example.com' },
      nativeRest: true
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: { uid: 'viewer-1', email: 'viewer@example.com', displayName: 'Viewer', roles: ['parent'] },
      profile: {}
    });

    renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'viewer@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(publicActionsMocks.openPublicUrl).toHaveBeenCalledWith(hostedDiamondAuthUrl));
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('hands native Google document return to hosted web auth without building an app hash', async () => {
    authServiceMocks.signInWithGoogleAccount.mockResolvedValue({
      user: { uid: 'viewer-1', email: 'viewer@example.com' },
      nativeRest: true,
      wasNewUser: false
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: { uid: 'viewer-1', email: 'viewer@example.com', displayName: 'Viewer', roles: ['parent'] },
      profile: {}
    });

    renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(publicActionsMocks.openPublicUrl).toHaveBeenCalledWith(hostedDiamondAuthUrl));
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('hands native Apple document return to hosted web auth without building an app hash', async () => {
    nativeRuntimeMocks.native = true;
    authServiceMocks.signInWithAppleAccount.mockResolvedValue({
      user: { uid: 'viewer-1', email: 'viewer@example.com' },
      nativeRest: true,
      wasNewUser: false
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: { uid: 'viewer-1', email: 'viewer@example.com', displayName: 'Viewer', roles: ['parent'] },
      profile: {}
    });

    renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);
    await waitFor(() => expect(publicActionsMocks.openPublicUrl).toHaveBeenCalledWith(hostedDiamondAuthUrl));
    publicActionsMocks.openPublicUrl.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));

    await waitFor(() => expect(publicActionsMocks.openPublicUrl).toHaveBeenCalledWith(hostedDiamondAuthUrl));
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('hands a native static viewer next to hosted web auth before collecting native credentials', async () => {
    nativeRuntimeMocks.native = true;

    renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);

    await waitFor(() => expect(publicActionsMocks.openPublicUrl).toHaveBeenCalledWith(hostedDiamondAuthUrl));
    expect(authServiceMocks.signInWithEmail).not.toHaveBeenCalled();
    expect(authServiceMocks.signInWithGoogleAccount).not.toHaveBeenCalled();
    expect(authServiceMocks.signInWithAppleAccount).not.toHaveBeenCalled();
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('preserves an exact viewer account-switch request in the native hosted-auth handoff', async () => {
    nativeRuntimeMocks.native = true;

    renderAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}&switch=1`);

    await waitFor(() => expect(publicActionsMocks.openPublicUrl).toHaveBeenCalledWith(switchedHostedDiamondAuthUrl));
    expect(authServiceMocks.signInWithEmail).not.toHaveBeenCalled();
    expect(authServiceMocks.signInWithGoogleAccount).not.toHaveBeenCalled();
    expect(authServiceMocks.signInWithAppleAccount).not.toHaveBeenCalled();
    expect(window.location.replace).not.toHaveBeenCalled();
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('preserves the static Diamond viewer through a new email user verification handoff', async () => {
    authServiceMocks.signUpWithEmail.mockResolvedValue({
      user: { uid: 'viewer-1', email: 'viewer@example.com' }
    });
    const router = renderNavigableAuthPage(`/auth?mode=signup&next=${encodeURIComponent(diamondViewerRoute)}`);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'viewer@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Join code'), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(authServiceMocks.signUpWithEmail).toHaveBeenCalledWith(
      'viewer@example.com',
      'password123',
      'ABCD1234',
      diamondViewerRoute
    ));
    await waitFor(() => expect(router.state.location.pathname).toBe('/verify-pending'));
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe(diamondViewerRoute);
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it.each([
    ['family fee', familyFeeRoute],
    ['schedule', scheduleRoute]
  ])('preserves a valid %s route through a new email user verification handoff', async (_label, nextRoute) => {
    authServiceMocks.signUpWithEmail.mockResolvedValue({
      user: { uid: 'parent-1', email: 'parent@example.com' }
    });
    const router = renderNavigableAuthPage(`/auth?mode=signup&next=${encodeURIComponent(nextRoute)}`);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'parent@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Join code'), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(authServiceMocks.signUpWithEmail).toHaveBeenCalledWith(
      'parent@example.com',
      'password123',
      'ABCD1234',
      nextRoute
    ));
    await waitFor(() => expect(router.state.location.pathname).toBe('/verify-pending'));
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe(nextRoute);
  });

  it('drops an unsafe next route from the email signup and verification handoff', async () => {
    authServiceMocks.signUpWithEmail.mockResolvedValue({
      user: { uid: 'parent-1', email: 'parent@example.com' }
    });
    const unsafeRoute = 'https://evil.example/steal';
    const router = renderNavigableAuthPage(`/auth?mode=signup&next=${encodeURIComponent(unsafeRoute)}`);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'parent@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByLabelText('Join code'), { target: { value: 'ABCD1234' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(authServiceMocks.signUpWithEmail).toHaveBeenCalledTimes(1));
    expect(authServiceMocks.signUpWithEmail.mock.calls[0]).toEqual([
      'parent@example.com',
      'password123',
      'ABCD1234'
    ]);
    await waitFor(() => expect(router.state.location.pathname).toBe('/verify-pending'));
    expect(router.state.location.search).toBe('');
  });

  it('preserves the static Diamond viewer through a new Google redirect verification handoff', async () => {
    authServiceMocks.completeGoogleRedirect.mockResolvedValueOnce({
      user: { uid: 'viewer-1', email: 'viewer@example.com' },
      wasNewUser: true
    });
    const router = renderNavigableAuthPage(`/auth?next=${encodeURIComponent(diamondViewerRoute)}`);

    await waitFor(() => expect(router.state.location.pathname).toBe('/verify-pending'));
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe(diamondViewerRoute);
    expect(auth.refresh).toHaveBeenCalledTimes(1);
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it('does not let late Google redirect completion replace a newer team route', async () => {
    const refresh = createDeferred<AuthUser | null>();
    auth.refresh = vi.fn(() => refresh.promise);
    authServiceMocks.completeGoogleRedirect.mockResolvedValueOnce({
      user: { uid: 'coach-1', email: 'coach@example.com' },
      wasNewUser: false
    });
    window.location.hash = '#/auth';
    const router = renderNavigableAuthPage();

    await waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));
    await leaveAuthForTeam(router);
    await act(async () => {
      refresh.resolve(null);
      await refresh.promise;
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/teams/team-1'));
  });

  it('does not let late auth hydration replace a newer authenticated deep link', async () => {
    const view = renderAuthPage();

    window.location.hash = '#/teams';
    auth.user = {
      uid: 'coach-1',
      email: 'coach@example.com',
      displayName: 'Coach',
      roles: ['coach']
    };
    auth.loading = false;
    view.rerender(
      <MemoryRouter initialEntries={['/auth']}>
        <Routes>
          <Route path="/auth" element={<AuthPage auth={auth} />} />
          <Route path="/home" element={<div>Home destination</div>} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(window.location.hash).toBe('#/teams'));
    expect(screen.queryByText('Home destination')).toBeNull();
  });

  it('does not let a late web email completion replace a team opened after sign-in', async () => {
    const refresh = createDeferred<AuthUser | null>();
    auth.refresh = vi.fn(() => refresh.promise);
    authServiceMocks.signInWithEmail.mockResolvedValue({
      user: { uid: 'coach-1', email: 'coach@example.com' },
      nativeRest: false
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
      profile: {}
    });
    window.location.hash = '#/auth';
    const router = renderNavigableAuthPage();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));
    await leaveAuthForTeam(router);
    await act(async () => {
      refresh.resolve(null);
      await refresh.promise;
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/teams/team-1'));
    expect(screen.queryByText('Home destination')).toBeNull();
  });

  it('does not let a late native email completion reload over a newer team route', async () => {
    const hydration = createDeferred<{ user: AuthUser; profile: Record<string, unknown> }>();
    const refreshedUser: AuthUser = { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] };
    auth.refresh = vi.fn(async () => {
      auth.user = refreshedUser;
      return refreshedUser;
    });
    authServiceMocks.signInWithEmail.mockResolvedValue({
      user: { uid: 'coach-1', email: 'coach@example.com' },
      nativeRest: true
    });
    authServiceMocks.hydrateFirebaseUser.mockReturnValue(hydration.promise);
    window.location.hash = '#/auth';
    const router = renderNavigableAuthPage();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => expect(authServiceMocks.hydrateFirebaseUser).toHaveBeenCalledTimes(1));
    await leaveAuthForTeam(router);
    await act(async () => {
      hydration.resolve({
        user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
        profile: {}
      });
      await hydration.promise;
    });

    await waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));
    expect(auth.user).toEqual(refreshedUser);
    expect(window.location.hash).toBe('#/teams/team-1');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('does not let late Google popup completion replace a newer team route', async () => {
    const refresh = createDeferred<AuthUser | null>();
    auth.refresh = vi.fn(() => refresh.promise);
    authServiceMocks.signInWithGoogleAccount.mockResolvedValue({
      user: { uid: 'coach-1', email: 'coach@example.com' },
      nativeRest: false,
      wasNewUser: false
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
      profile: {}
    });
    window.location.hash = '#/auth';
    const router = renderNavigableAuthPage();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));
    await leaveAuthForTeam(router);
    await act(async () => {
      refresh.resolve(null);
      await refresh.promise;
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/teams/team-1'));
  });

  it('refreshes late native Google completion without reloading a newer team route', async () => {
    const hydration = createDeferred<{ user: AuthUser; profile: Record<string, unknown> }>();
    const refreshedUser: AuthUser = { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] };
    auth.refresh = vi.fn(async () => {
      auth.user = refreshedUser;
      return refreshedUser;
    });
    authServiceMocks.signInWithGoogleAccount.mockResolvedValue({
      user: { uid: 'coach-1', email: 'coach@example.com' },
      nativeRest: true,
      wasNewUser: false
    });
    authServiceMocks.hydrateFirebaseUser.mockReturnValue(hydration.promise);
    window.location.hash = '#/auth';
    const router = renderNavigableAuthPage();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(authServiceMocks.hydrateFirebaseUser).toHaveBeenCalledTimes(1));
    await leaveAuthForTeam(router);
    await act(async () => {
      hydration.resolve({
        user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
        profile: {}
      });
      await hydration.promise;
    });

    await waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));
    expect(auth.user).toEqual(refreshedUser);
    expect(window.location.hash).toBe('#/teams/team-1');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('does not let late Apple completion reload over a newer team route', async () => {
    nativeRuntimeMocks.native = true;
    const hydration = createDeferred<{ user: AuthUser; profile: Record<string, unknown> }>();
    const refreshedUser: AuthUser = { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] };
    auth.refresh = vi.fn(async () => {
      auth.user = refreshedUser;
      return refreshedUser;
    });
    authServiceMocks.signInWithAppleAccount.mockResolvedValue({
      user: { uid: 'coach-1', email: 'coach@example.com' },
      nativeRest: true,
      wasNewUser: false
    });
    authServiceMocks.hydrateFirebaseUser.mockReturnValue(hydration.promise);
    window.location.hash = '#/auth';
    const router = renderNavigableAuthPage();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));

    await waitFor(() => expect(authServiceMocks.hydrateFirebaseUser).toHaveBeenCalledTimes(1));
    await leaveAuthForTeam(router);
    await act(async () => {
      hydration.resolve({
        user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach', roles: ['coach'] },
        profile: {}
      });
      await hydration.promise;
    });

    await waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));
    expect(auth.user).toEqual(refreshedUser);
    expect(window.location.hash).toBe('#/teams/team-1');
    expect(window.location.reload).not.toHaveBeenCalled();
  });

  it('still sends a restored signed-in session away from the active auth route', async () => {
    window.location.hash = '#/auth';
    auth.user = {
      uid: 'coach-1',
      email: 'coach@example.com',
      displayName: 'Coach',
      roles: ['coach']
    };

    render(
      <MemoryRouter initialEntries={['/auth']}>
        <Routes>
          <Route path="/auth" element={<AuthPage auth={auth} />} />
          <Route path="/home" element={<div>Home destination</div>} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Home destination')).toBeTruthy();
  });

  it('routes the Apple button through native sign-in and reloads the home page', async () => {
    nativeRuntimeMocks.native = true;
    authServiceMocks.signInWithAppleAccount.mockResolvedValue({
      user: { uid: 'apple-user', email: 'apple@example.com' },
      nativeRest: true
    });
    authServiceMocks.hydrateFirebaseUser.mockResolvedValue({
      user: { uid: 'apple-user', email: 'apple@example.com', displayName: 'Apple User', roles: ['parent'] },
      profile: {}
    });

    renderAuthPage();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));

    await waitFor(() => expect(authServiceMocks.signInWithAppleAccount).toHaveBeenCalledWith(null));
    await waitFor(() => expect(window.location.hash).toBe('#/home'));
    expect(window.location.reload).toHaveBeenCalledTimes(1);
  });
});

describe('AuthPage accessibility controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeRuntimeMocks.native = true;
    auth.refresh = vi.fn();
    auth.signOut = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('exposes authentication modes as keyboard-operable tabs', () => {
    renderAuthPage();

    const tablist = screen.getByRole('tablist', { name: 'Authentication mode' });
    const signInTab = screen.getByRole('tab', { name: 'Sign in' });
    const signUpTab = screen.getByRole('tab', { name: 'Sign up' });

    expect(tablist).toBeTruthy();
    expect(signInTab.getAttribute('aria-selected')).toBe('true');
    expect(document.getElementById(signInTab.getAttribute('aria-controls') || '')).toBeTruthy();
    expect(document.getElementById(signUpTab.getAttribute('aria-controls') || '')).toBeTruthy();
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('auth-tab-login');

    fireEvent.keyDown(signInTab, { key: 'ArrowRight' });
    expect(signUpTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(signUpTab);
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('auth-tab-signup');

    fireEvent.keyDown(signUpTab, { key: 'Home' });
    expect(document.activeElement).toBe(signInTab);
    fireEvent.keyDown(signInTab, { key: 'End' });
    expect(document.activeElement).toBe(signUpTab);
    fireEvent.keyDown(signUpTab, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(signInTab);
  });

  it('shows and hides password fields without clearing their values', () => {
    renderAuthPage('/auth?mode=signup');

    const password = screen.getByLabelText('Password');
    const confirmation = screen.getByLabelText('Confirm password');
    fireEvent.change(password, { target: { value: 'secret1' } });
    fireEvent.change(confirmation, { target: { value: 'secret1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show confirmation password' }));
    expect(password.getAttribute('type')).toBe('text');
    expect(confirmation.getAttribute('type')).toBe('text');
    expect((password as HTMLInputElement).value).toBe('secret1');
    expect((confirmation as HTMLInputElement).value).toBe('secret1');

    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide confirmation password' }));
    expect(password.getAttribute('type')).toBe('password');
    expect(confirmation.getAttribute('type')).toBe('password');
    expect((password as HTMLInputElement).value).toBe('secret1');
    expect((confirmation as HTMLInputElement).value).toBe('secret1');
  });

  it('announces authentication errors and progress with live semantics', async () => {
    authServiceMocks.signInWithEmail.mockImplementation(() => new Promise(() => undefined));
    renderAuthPage();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Authentication in progress.');

    cleanup();
    authServiceMocks.signInWithEmail.mockRejectedValue(new Error('Email or password is incorrect.'));
    renderAuthPage();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
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
    expect(screen.getByText('A team or family join code is required. Then verify your email.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
    expect(screen.getByLabelText('Join code')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Enter join code' })).toBeNull();
  });

  it('describes an unverified invite code without claiming it was applied', () => {
    renderAuthPage('/auth?mode=login&code=QQQQQQQQ&type=parent');

    expect(screen.getByText(/Join code entered:/).textContent).toContain('QQQQQQQQ');
    expect(screen.getByText('We’ll verify it after you sign in or create your account.')).toBeTruthy();
    expect(screen.queryByText(/Invite code applied:/)).toBeNull();
  });

  it('stops signup before Firebase when the email is invalid for Firebase Auth', async () => {
    renderAuthPage('/auth?mode=signup&code=6WSSSW9V&type=parent');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'p@paulsnider' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
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
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
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
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
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
    fireEvent.change(screen.getByLabelText('Join code'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Activation code is required.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Join code'), { target: { value: 'abc123' } });
    expect(screen.queryByText('Activation code is required.')).toBeNull();
  });

  it('requires agreeing to the terms before any signup path is enabled', () => {
    renderAuthPage('/auth?mode=signup&code=6WSSSW9V&type=parent');

    const createButton = screen.getByRole('button', { name: 'Create account' });
    const googleButton = screen.getByRole('button', { name: 'Continue with Google' });
    const appleButton = screen.getByRole('button', { name: 'Continue with Apple' });
    const agree = screen.getByRole('checkbox', { name: /I agree/ });

    expect(createButton).toBeDisabled();
    expect(googleButton).toBeDisabled();
    expect(appleButton).toBeDisabled();

    fireEvent.click(agree);

    expect(createButton).not.toBeDisabled();
    expect(googleButton).not.toBeDisabled();
    expect(appleButton).not.toBeDisabled();
  });

  it('links the terms checkbox to the public Terms and Privacy pages', () => {
    renderAuthPage('/auth?mode=signup&code=6WSSSW9V&type=parent');

    expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', 'https://allplays.ai/terms.html');
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', 'https://allplays.ai/privacy.html');
  });

  // Anti-lockout guards: agreeing to the terms must actually let a user through
  // every signup path. If any of these regress, new users are locked out of signup.
  it('re-disables every signup path when the terms box is unchecked again', () => {
    renderAuthPage('/auth?mode=signup&code=6WSSSW9V&type=parent');

    const createButton = screen.getByRole('button', { name: 'Create account' });
    const googleButton = screen.getByRole('button', { name: 'Continue with Google' });
    const appleButton = screen.getByRole('button', { name: 'Continue with Apple' });
    const agree = screen.getByRole('checkbox', { name: /I agree/ });

    fireEvent.click(agree);
    expect(createButton).not.toBeDisabled();

    fireEvent.click(agree);
    expect(agree).not.toBeChecked();
    expect(createButton).toBeDisabled();
    expect(googleButton).toBeDisabled();
    expect(appleButton).toBeDisabled();
  });

  it('lets a user complete email signup after agreeing to the terms', async () => {
    authServiceMocks.signUpWithEmail.mockResolvedValue({ user: { uid: 'new-user', email: 'coach@example.com' } });

    renderAuthPage('/auth?mode=signup&code=6WSSSW9V&type=parent');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(authServiceMocks.signUpWithEmail).toHaveBeenCalledWith('coach@example.com', 'secret1', '6WSSSW9V'));
  });

  it('does not let late email signup completion replace a newer team route', async () => {
    const refresh = createDeferred<AuthUser | null>();
    auth.refresh = vi.fn(() => refresh.promise);
    authServiceMocks.signUpWithEmail.mockResolvedValue({ user: { uid: 'new-user', email: 'coach@example.com' } });
    window.location.hash = '#/auth';
    const router = renderNavigableAuthPage('/auth?mode=signup&code=6WSSSW9V&type=parent');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(auth.refresh).toHaveBeenCalledTimes(1));
    await leaveAuthForTeam(router);
    await act(async () => {
      refresh.resolve(null);
      await refresh.promise;
    });

    await waitFor(() => expect(router.state.location.pathname).toBe('/teams/team-1'));
  });

  it('lets a user complete Google signup after agreeing to the terms', async () => {
    authServiceMocks.signInWithGoogleAccount.mockResolvedValue(null);

    renderAuthPage('/auth?mode=signup&code=6WSSSW9V&type=parent');

    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(authServiceMocks.signInWithGoogleAccount).toHaveBeenCalledWith('6WSSSW9V'));
  });

  it('lets a user complete Apple signup after agreeing to the terms', async () => {
    authServiceMocks.signInWithAppleAccount.mockResolvedValue(null);

    renderAuthPage('/auth?mode=signup&code=6WSSSW9V&type=parent');

    fireEvent.click(screen.getByRole('checkbox', { name: /I agree/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));

    await waitFor(() => expect(authServiceMocks.signInWithAppleAccount).toHaveBeenCalledWith('6WSSSW9V'));
  });

  it('blocks every signup path until the terms box is checked', () => {
    renderAuthPage('/auth?mode=signup&code=6WSSSW9V&type=parent');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'secret1' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Apple' }));

    expect(authServiceMocks.signUpWithEmail).not.toHaveBeenCalled();
    expect(authServiceMocks.signInWithGoogleAccount).not.toHaveBeenCalled();
    expect(authServiceMocks.signInWithAppleAccount).not.toHaveBeenCalled();
  });

  it('does not show the terms checkbox in login mode', () => {
    renderAuthPage('/auth?mode=login');

    expect(screen.queryByRole('checkbox', { name: /I agree/ })).toBeNull();
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
    const submitButton = screen.getByRole('button', { name: 'Sign in' });

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

  it('exposes disclosure state and reuses the entered sign-in email', () => {
    renderAuthPage();

    const authEmail = screen.getByLabelText('Email');
    const trigger = screen.getByRole('button', { name: 'Forgot password?' });
    fireEvent.change(authEmail, { target: { value: 'coach@example.com' } });

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe('password-reset-form');

    fireEvent.click(trigger);

    const resetEmail = screen.getByLabelText('Password reset email') as HTMLInputElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(resetEmail.value).toBe('coach@example.com');

    fireEvent.change(resetEmail, { target: { value: 'updated@example.com' } });
    expect((authEmail as HTMLInputElement).value).toBe('updated@example.com');
  });

  it('shows neutral confirmation copy after requesting a reset', async () => {
    authServiceMocks.sendResetEmail.mockResolvedValue(undefined);
    renderAuthPage();

    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: ' Missing@Example.COM ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send reset email' }));

    await waitFor(() => expect(authServiceMocks.sendResetEmail).toHaveBeenCalledWith('missing@example.com'));
    expect(await screen.findByText("If an account exists for that email, a reset email has been queued.")).toBeTruthy();
    expect(screen.getByRole('status')).toHaveTextContent("If an account exists for that email, a reset email has been queued.");
    expect(screen.queryByText(/no all plays account/i)).toBeNull();
  });
});
