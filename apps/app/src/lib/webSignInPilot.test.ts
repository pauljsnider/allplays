import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
  call: vi.fn(),
  signIn: vi.fn(),
  signOutAndClear: vi.fn(),
  native: vi.fn(),
  auth: { currentUser: null as null | { uid: string; email: string } }
}));
vi.mock('./adapters/legacyAccountDb', () => ({ functions: {}, httpsCallable: () => m.call }));
vi.mock('./firebaseAuthRuntime', () => ({ auth: m.auth, signInWithEmailLink: m.signIn }));
vi.mock('./nativeRuntime', () => ({ isNativeRuntime: m.native }));
import { completePilotEmail, readPilotEmail, requestPilotEmail, safePilotNext, signOutPilotAccount } from './webSignInPilot';
const params = () => new URLSearchParams('mode=signIn&oobCode=opaque&apiKey=public&email=attacker@example.test&next=//evil.test');
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  m.auth.currentUser = null;
  m.call.mockResolvedValue({ data: { uid: 'original', next: '/profile' } });
  m.signIn.mockResolvedValue({ user: { uid: 'original' } });
});
it('remembers normalized email after successful request and defaults unsafe next', async () => {
  await requestPilotEmail(' PAUL@allplays.ai ', '//evil.test');
  expect(m.call).toHaveBeenCalledWith({ email: 'paul@allplays.ai', next: '/home' });
  expect(readPilotEmail()).toBe('paul@allplays.ai');
  m.call.mockRejectedValueOnce(Error());
  await expect(requestPilotEmail('other@example.test', '/home')).rejects.toThrow();
  expect(readPilotEmail()).toBe('paul@allplays.ai');
});
it('preflights entered email before Firebase and ignores URL email/next and stale invite', async () => {
  localStorage.setItem('allplays-app-pending-invite-code', 'STALE123');
  expect(await completePilotEmail('paul@allplays.ai', params(), m.signOutAndClear)).toBe('/profile');
  expect(m.call).toHaveBeenCalledWith({ email: 'paul@allplays.ai', code: 'opaque' });
  expect(m.signIn).toHaveBeenCalledWith(m.auth, 'paul@allplays.ai', expect.not.stringContaining('attacker'));
  expect(m.call.mock.invocationCallOrder[0]).toBeLessThan(m.signIn.mock.invocationCallOrder[0]);
  expect(localStorage.getItem('allplays-app-pending-invite-code')).toBe('STALE123');
});
it('preflight failure and missing action never redeem', async () => {
  m.call.mockRejectedValue(Error());
  await expect(completePilotEmail('paul@allplays.ai', params(), m.signOutAndClear)).rejects.toThrow();
  await expect(completePilotEmail('paul@allplays.ai', new URLSearchParams(), m.signOutAndClear)).rejects.toThrow();
  expect(m.signIn).not.toHaveBeenCalled();
});
it('wrong account is not silently switched', async () => {
  m.auth.currentUser = { uid: 'other', email: 'other@example.test' };
  await expect(completePilotEmail('paul@allplays.ai', params(), m.signOutAndClear)).rejects.toThrow(/different account/);
  expect(m.signIn).not.toHaveBeenCalled();
  expect(m.signOutAndClear).not.toHaveBeenCalled();
});
it('wrong-account recovery uses the app-level sign-out and cache cleanup', async () => {
  await signOutPilotAccount(m.signOutAndClear);
  expect(m.signOutAndClear).toHaveBeenCalledOnce();
});
it('interrupted hydration can continue using preflight-approved existing session', async () => {
  m.auth.currentUser = { uid: 'original', email: 'paul@allplays.ai' };
  expect(await completePilotEmail('paul@allplays.ai', params(), m.signOutAndClear)).toBe('/profile');
  expect(m.signIn).not.toHaveBeenCalled();
});
it('identity mismatch uses the app-level sign-out and cache cleanup', async () => {
  m.signIn.mockResolvedValue({ user: { uid: 'replacement' } });
  await expect(completePilotEmail('paul@allplays.ai', params(), m.signOutAndClear)).rejects.toThrow(/identity changed/);
  expect(m.signOutAndClear).toHaveBeenCalledOnce();
});
it('native runtime never calls backend or Firebase', async () => {
  m.native.mockReturnValue(true);
  await expect(requestPilotEmail('paul@allplays.ai', '/home')).rejects.toThrow(/browser/);
  await expect(completePilotEmail('paul@allplays.ai', params(), m.signOutAndClear)).rejects.toThrow(/browser/);
  expect(m.call).not.toHaveBeenCalled();
});
it('only exact non-action destinations are accepted', () => {
  for (const route of ['/accept-invite', '/home?code=STALE123', '/auth', '/\\evil', '//evil', '/profile#x', null])
    expect(safePilotNext(route)).toBe('/home');
});
