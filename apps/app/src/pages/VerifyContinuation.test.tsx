// @vitest-environment jsdom
// Regression coverage for the verification-email return path (#5200, #5203).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../lib/types';

const state = vi.hoisted(() => ({ pending: { code: '', type: '' } }));

const authServiceMocks = vi.hoisted(() => ({
  applyEmailActionCode: vi.fn(async () => undefined),
  clearPendingInvite: vi.fn(() => {
    state.pending = { code: '', type: '' };
  }),
  completeEmailLink: vi.fn(),
  confirmReset: vi.fn(),
  getRouteForUser: vi.fn((user: unknown) => (user ? '/home' : '/auth')),
  isEmailLink: vi.fn(() => false),
  mapLegacyRedirectToAppRoute: vi.fn(() => '/home'),
  readPendingInvite: vi.fn(() => ({ code: state.pending.code, type: state.pending.type || 'parent' })),
  redeemInviteForUser: vi.fn(),
  reloadCurrentUser: vi.fn(async () => undefined),
  rememberPendingInvite: vi.fn(),
  resendVerificationEmail: vi.fn(async () => undefined),
  verifyResetCode: vi.fn()
}));

vi.mock('../lib/authService', () => authServiceMocks);
vi.mock('../lib/nativeRuntime', () => ({ isNativeRuntime: () => false }));
vi.mock('../lib/publicActions', () => ({ openPublicUrl: vi.fn(async () => undefined) }));

import { AcceptInvite } from './AcceptInvite';
import { ResetPassword } from './ResetPassword';
import { VerifyPending } from './VerifyPending';

const trail: string[] = [];
const inviteRoute = '/accept-invite?code=ABCDEFGH&type=parent';

function Trail() {
  const location = useLocation();
  const entry = `${location.pathname}${location.search}`;
  if (trail[trail.length - 1] !== entry) trail.push(entry);
  return null;
}

function makeAuth(signedIn: boolean): AuthState {
  const user = signedIn
    ? ({ uid: 'user-1', email: 'parent@example.com', displayName: 'Pat', emailVerified: true, roles: ['parent'] } as any)
    : null;
  return {
    user,
    profile: null,
    loading: false,
    error: null,
    roles: [],
    isParent: true,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: vi.fn().mockResolvedValue(user),
    signOut: vi.fn().mockResolvedValue(undefined)
  } as AuthState;
}

function renderFlow(entry: string, auth: AuthState) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Trail />
      <Routes>
        <Route path="/auth" element={<div>Auth route</div>} />
        <Route path="/accept-invite" element={<AcceptInvite auth={auth} />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-pending" element={<VerifyPending auth={auth} />} />
        <Route path="/home" element={<div>Home route</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const wait = (ms: number) =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

describe('verification email return path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.pending = { code: '', type: '' };
    trail.length = 0;
    window.location.hash = '';
    authServiceMocks.redeemInviteForUser.mockResolvedValue({ message: 'Invite accepted.', redirectUrl: 'parent-dashboard.html' });
  });

  afterEach(() => cleanup());

  it('lands on home after the default verification link accepts a pending invite (#5203)', async () => {
    state.pending = { code: 'ABCDEFGH', type: 'parent' };
    renderFlow('/reset-password?mode=verifyEmail&oobCode=OOB&next=%2Fverify-pending', makeAuth(true));

    fireEvent.click(await screen.findByRole('link', { name: 'Continue after verification' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to dashboard' }));
    expect(await screen.findByText('Invite accepted.')).toBeTruthy();
    await wait(800);

    expect(trail).toEqual(['/reset-password?mode=verifyEmail&oobCode=OOB&next=%2Fverify-pending', '/verify-pending', inviteRoute, '/home']);
    expect(screen.getByText('Home route')).toBeTruthy();
  });

  it('does not route a verified user from verify-pending back to verify-pending (#5203)', async () => {
    renderFlow('/verify-pending?next=%2Fverify-pending', makeAuth(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to dashboard' }));
    expect(await screen.findByText('Home route')).toBeTruthy();
    expect(trail).toEqual(['/verify-pending?next=%2Fverify-pending', '/home']);
  });

  it('accepts the invite carried by the verification link when this browser has no pending invite (#5200)', async () => {
    renderFlow(`/reset-password?mode=verifyEmail&oobCode=OOB&next=${encodeURIComponent(inviteRoute)}`, makeAuth(true));

    fireEvent.click(await screen.findByRole('link', { name: 'Continue after verification' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to dashboard' }));
    expect(await screen.findByText('Invite accepted.')).toBeTruthy();
    expect(authServiceMocks.redeemInviteForUser).toHaveBeenCalledWith('user-1', 'ABCDEFGH', 'parent@example.com');
    await wait(800);

    expect(trail[trail.length - 1]).toBe('/home');
  });

  it('keeps the invite through sign-in when the verification link opens signed out (#5200)', async () => {
    renderFlow(`/verify-pending?next=${encodeURIComponent(inviteRoute)}`, makeAuth(false));
    await waitFor(() => expect(trail[trail.length - 1]).toBe(`/auth?next=${encodeURIComponent(inviteRoute)}`));
  });

  it('does not nest the invite route when both the link and this browser hold the invite', async () => {
    state.pending = { code: 'ABCDEFGH', type: 'parent' };
    renderFlow(`/verify-pending?next=${encodeURIComponent(inviteRoute)}`, makeAuth(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue to dashboard' }));
    expect(await screen.findByText('Invite accepted.')).toBeTruthy();
    await wait(800);
    expect(trail).toEqual([`/verify-pending?next=${encodeURIComponent(inviteRoute)}`, inviteRoute, '/home']);
  });
});
