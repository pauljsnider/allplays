import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { AuthState } from '../lib/types';
const m = vi.hoisted(() => ({
  complete: vi.fn(),
  request: vi.fn(),
  read: vi.fn(),
  native: vi.fn(),
  pilotSignOut: vi.fn((signOutAndClear: () => Promise<void>) => signOutAndClear()),
  authSignOut: vi.fn(() => Promise.resolve())
}));
vi.mock('../lib/webSignInPilot', () => ({
  completePilotEmail: m.complete,
  requestPilotEmail: m.request,
  readPilotEmail: m.read,
  normalizePilotEmail: (v: string) => v.trim().toLowerCase(),
  safePilotNext: () => '/home',
  pilotConfirmation: 'If eligible, check your inbox.',
  signOutPilotAccount: m.pilotSignOut
}));
vi.mock('../lib/nativeRuntime', () => ({ isNativeRuntime: m.native }));
vi.mock('../components/AuthFrame', () => ({ AuthFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
import { EmailSignIn } from './EmailSignIn';
const setup = (route = '/email-sign-in?mode=signIn&oobCode=opaque', user: unknown = null) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route
          path="/email-sign-in"
          element={<EmailSignIn auth={{ loading: false, user, refresh: vi.fn(), signOut: m.authSignOut } as unknown as AuthState} />}
        />
        <Route path="/auth" element={<p>Password page</p>} />
        <Route path="/profile" element={<p>Profile destination</p>} />
      </Routes>
    </MemoryRouter>
  );
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  m.read.mockReturnValue('');
  m.pilotSignOut.mockImplementation((signOutAndClear: () => Promise<void>) => signOutAndClear());
  m.authSignOut.mockResolvedValue(undefined);
});
it('requires explicit Continue and email entry; expired/used failure offers resend', async () => {
  m.complete.mockRejectedValue(Error('used'));
  setup();
  expect(m.complete).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Email address that received the link'), { target: { value: 'paul@allplays.ai' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('alert');
  expect(m.complete).toHaveBeenCalledOnce();
  expect(m.complete).toHaveBeenCalledWith('paul@allplays.ai', expect.any(URLSearchParams), m.authSignOut);
  fireEvent.click(screen.getByRole('button', { name: 'Request a new link' }));
  await screen.findByRole('status');
  expect(m.request).toHaveBeenCalledOnce();
});
it('remembers same-browser email and blocks repeated in-flight submits', () => {
  m.read.mockReturnValue('paul@allplays.ai');
  m.complete.mockReturnValue(new Promise(() => {}));
  setup();
  expect(screen.getByLabelText('Email address that received the link')).toHaveValue('paul@allplays.ai');
  const button = screen.getByRole('button', { name: 'Continue' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(m.complete).toHaveBeenCalledOnce();
});
it('requests can retry after network failure and resend', async () => {
  m.request.mockRejectedValueOnce(Error()).mockResolvedValue(undefined);
  setup('/email-sign-in');
  fireEvent.change(screen.getByLabelText('Email address that received the link'), { target: { value: 'paul@allplays.ai' } });
  fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));
  await screen.findByRole('status');
  expect(screen.getByRole('button', { name: 'Resend link' })).toBeEnabled();
});
it('wrong account needs an explicit sign-out', async () => {
  m.read.mockReturnValue('paul@allplays.ai');
  setup(undefined, { uid: 'other', email: 'other@example.test' });
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  expect(m.pilotSignOut).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out of current account' }));
  await waitFor(() => expect(m.authSignOut).toHaveBeenCalledOnce());
  expect(m.pilotSignOut).toHaveBeenCalledWith(m.authSignOut);
});
it('native view has no completion control', () => {
  m.native.mockReturnValue(true);
  setup();
  expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  expect(m.complete).not.toHaveBeenCalled();
});

it('clears stale invitation push before an interrupted completion can hydrate elsewhere', async () => {
  localStorage.setItem('allplays.pendingPushRoute', '/accept-invite');
  let resolve!: (route: string) => void;
  m.read.mockReturnValue('paul@allplays.ai');
  m.complete.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    })
  );
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(localStorage.getItem('allplays.pendingPushRoute')).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Use password or Google instead' }));
  await screen.findByText('Password page');
  await act(async () => {
    resolve('/profile');
  });
  expect(screen.getByText('Password page')).toBeInTheDocument();
  expect(screen.queryByText('Profile destination')).not.toBeInTheDocument();
});
it('clears stale push destination before navigation without redeeming stored invitation', async () => {
  localStorage.setItem('allplays.pendingPushRoute', '/accept-invite');
  localStorage.setItem('allplays-app-pending-invite-code', 'STALE123');
  m.read.mockReturnValue('paul@allplays.ai');
  m.complete.mockResolvedValue('/profile');
  setup();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Profile destination');
  expect(localStorage.getItem('allplays.pendingPushRoute')).toBeNull();
  expect(localStorage.getItem('allplays-app-pending-invite-code')).toBe('STALE123');
});
