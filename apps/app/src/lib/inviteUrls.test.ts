import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAppAcceptInviteUrl, canonicalizeAppAcceptInviteUrl } from './inviteUrls';

afterEach(() => vi.unstubAllGlobals());

describe('public invite links', () => {
  it.each([
    'https://localhost',
    'http://localhost:5174',
    'http://127.0.0.1:8000',
    'http://[::1]:8000',
    'capacitor://localhost',
    'ionic://localhost',
    'file:///app/index.html'
  ])('shares a public link from %s for both implicit and explicit origins', (origin) => {
    vi.stubGlobal('window', { location: new URL(origin) });
    const expected = 'https://allplays.ai/app/#/accept-invite?code=FRIEND12&type=friend';
    expect(buildAppAcceptInviteUrl('friend12', 'friend_invite')).toBe(expected);
    expect(buildAppAcceptInviteUrl('friend12', 'friend_invite', origin)).toBe(expected);
  });

  it.each(['friend', 'admin', 'parent', 'household', 'coparent'])('normalizes an explicit native origin for %s links', (type) => {
    expect(buildAppAcceptInviteUrl('INVITE12', type, 'https://localhost')).toBe(
      `https://allplays.ai/app/#/accept-invite?code=INVITE12&type=${type}`
    );
  });

  it.each([
    'https://allplays.ai',
    'https://game-flow-c6311.web.app',
    'https://game-flow-c6311--preview-abc.web.app',
    'https://preview.example:8443'
  ])('preserves a deployed web origin %s', (origin) => {
    vi.stubGlobal('window', { location: new URL(origin) });
    expect(buildAppAcceptInviteUrl('FRIEND12', 'friend')).toBe(`${origin}/app/#/accept-invite?code=FRIEND12&type=friend`);
  });

  it.each(['https://localhost', 'capacitor://localhost'])(
    'repairs stored localhost URLs without trusting the stored host or extra query parameters from %s',
    (origin) => {
      vi.stubGlobal('window', { location: new URL('https://localhost') });
      expect(
        canonicalizeAppAcceptInviteUrl(
          'https://localhost/app/#/accept-invite?code=friend12&type=friend_invite&next=https://evil.example',
          '',
          '',
          origin
        )
      ).toBe('https://allplays.ai/app/#/accept-invite?code=FRIEND12&type=friend');
    }
  );
});
