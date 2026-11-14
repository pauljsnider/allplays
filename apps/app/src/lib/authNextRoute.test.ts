import { describe, expect, it, vi } from 'vitest';
import {
  buildPendingInviteRoute,
  completeAuthNavigation,
  getDocumentAuthNextRoute,
  getHostedDocumentAuthNextUrl,
  getSafeAuthNextRoute,
  getVerificationContinuationRoute,
  isAcceptInviteRoute
} from './authNextRoute';

function createLocation() {
  return {
    hash: '#/auth',
    reload: vi.fn(),
    replace: vi.fn()
  };
}

describe('getSafeAuthNextRoute', () => {
  it('allows local opportunity routes with queries', () => {
    expect(getSafeAuthNextRoute('/discover/opportunities/listing-1?contact=1')).toBe('/discover/opportunities/listing-1?contact=1');
  });

  it('rejects external, protocol-relative, backslash, and oversized routes', () => {
    expect(getSafeAuthNextRoute('https://evil.example')).toBe('');
    expect(getSafeAuthNextRoute('//evil.example/path')).toBe('');
    expect(getSafeAuthNextRoute('/\\evil')).toBe('');
    expect(getSafeAuthNextRoute(`/${'a'.repeat(600)}`)).toBe('');
  });
});

describe('document authentication return routes', () => {
  const diamondViewerRoute = '/live-game-diamond-v2.html?teamId=team%2Fone&gameId=game+one&replay=true#top';

  it('allowlists only the same-origin Diamond viewer and preserves its full route', () => {
    expect(getDocumentAuthNextRoute(diamondViewerRoute)).toBe(diamondViewerRoute);
    expect(getDocumentAuthNextRoute('/live-game.html?teamId=team-1&gameId=game-1')).toBe('');
    expect(getDocumentAuthNextRoute('/live-game-overlay.html?teamId=team-1&gameId=game-1')).toBe('');
    expect(getDocumentAuthNextRoute('/live-game-diamond-v2.html.evil?teamId=team-1')).toBe('');
    expect(getDocumentAuthNextRoute('//evil.example/live-game-diamond-v2.html')).toBe('');
    expect(getDocumentAuthNextRoute('https://evil.example/live-game-diamond-v2.html')).toBe('');
  });

  it('hard-navigates the allowlisted web viewer without creating a HashRouter route', async () => {
    const navigate = vi.fn();
    const locationObject = createLocation();

    await expect(
      completeAuthNavigation(diamondViewerRoute, navigate, {
        locationObject
      })
    ).resolves.toBe('document');

    expect(locationObject.replace).toHaveBeenCalledWith(diamondViewerRoute);
    expect(locationObject.hash).toBe('#/auth');
    expect(locationObject.reload).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('hands a native document destination to canonical hosted web auth', async () => {
    const navigate = vi.fn();
    const locationObject = createLocation();
    const openHostedAuth = vi.fn(async () => undefined);
    const hostedAuthUrl =
      'https://allplays.ai/app/#/auth?next=%2Flive-game-diamond-v2.html%3FteamId%3Dteam%252Fone%26gameId%3Dgame%2Bone%26replay%3Dtrue%23top';

    expect(getHostedDocumentAuthNextUrl(diamondViewerRoute)).toBe(hostedAuthUrl);
    await expect(
      completeAuthNavigation(diamondViewerRoute, navigate, {
        locationObject,
        nativeRuntime: true,
        openHostedAuth
      })
    ).resolves.toBe('hosted-auth');

    expect(openHostedAuth).toHaveBeenCalledWith(hostedAuthUrl);
    expect(locationObject.replace).not.toHaveBeenCalled();
    expect(locationObject.hash).toBe('#/auth');
    expect(locationObject.reload).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('carries only explicit account-switch intent into an allowlisted native document handoff', async () => {
    const navigate = vi.fn();
    const locationObject = createLocation();
    const openHostedAuth = vi.fn(async () => undefined);
    const switchedHostedAuthUrl =
      'https://allplays.ai/app/#/auth?next=%2Flive-game-diamond-v2.html%3FteamId%3Dteam%252Fone%26gameId%3Dgame%2Bone%26replay%3Dtrue%23top&switch=1';

    expect(getHostedDocumentAuthNextUrl(diamondViewerRoute, true)).toBe(switchedHostedAuthUrl);
    expect(getHostedDocumentAuthNextUrl('/home?switch=1', true)).toBe('');
    await expect(
      completeAuthNavigation(diamondViewerRoute, navigate, {
        accountSwitchRequested: true,
        locationObject,
        nativeRuntime: true,
        openHostedAuth
      })
    ).resolves.toBe('hosted-auth');

    expect(openHostedAuth).toHaveBeenCalledWith(switchedHostedAuthUrl);
    expect(locationObject.replace).not.toHaveBeenCalled();
    expect(locationObject.reload).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('fails closed when native hosted authentication cannot be opened', async () => {
    const navigate = vi.fn();
    const locationObject = createLocation();

    await expect(
      completeAuthNavigation(diamondViewerRoute, navigate, {
        locationObject,
        nativeRuntime: true
      })
    ).rejects.toThrow('The hosted authentication handoff is unavailable.');
    expect(locationObject.replace).not.toHaveBeenCalled();
    expect(locationObject.reload).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('preserves existing SPA navigation and native reload behavior', async () => {
    const navigate = vi.fn();
    const webLocation = createLocation();
    const nativeLocation = createLocation();

    await expect(
      completeAuthNavigation('/schedule?teamId=team-1', navigate, {
        locationObject: webLocation
      })
    ).resolves.toBe('app');
    expect(navigate).toHaveBeenCalledWith('/schedule?teamId=team-1', { replace: true });
    expect(webLocation.replace).not.toHaveBeenCalled();

    await expect(
      completeAuthNavigation('/home', navigate, {
        locationObject: nativeLocation,
        reloadApp: true
      })
    ).resolves.toBe('app-reload');
    expect(nativeLocation.hash).toBe('#/home');
    expect(nativeLocation.reload).toHaveBeenCalledTimes(1);
    expect(nativeLocation.replace).not.toHaveBeenCalled();
  });

  it('rejects an unsafe destination before invoking either navigation surface', async () => {
    const navigate = vi.fn();
    const locationObject = createLocation();

    await expect(
      completeAuthNavigation('https://evil.example/viewer', navigate, {
        locationObject
      })
    ).rejects.toThrow('A valid origin-relative authentication destination is required.');
    expect(locationObject.replace).not.toHaveBeenCalled();
    expect(locationObject.reload).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('verification continuation routes', () => {
  it('drops a continuation that points back at the verification screen', () => {
    expect(getVerificationContinuationRoute('/verify-pending')).toBe('');
    expect(getVerificationContinuationRoute('/verify-pending?next=%2Fverify-pending')).toBe('');
    expect(getVerificationContinuationRoute('/schedule?teamId=team-1')).toBe('/schedule?teamId=team-1');
    expect(getVerificationContinuationRoute('https://evil.example/x')).toBe('');
  });

  it('recognizes an invite continuation', () => {
    expect(isAcceptInviteRoute('/accept-invite?code=ABCDEFGH&type=parent')).toBe(true);
    expect(isAcceptInviteRoute('/teams')).toBe(false);
    expect(isAcceptInviteRoute('')).toBe(false);
  });

  it('builds the pending invite route without nesting invite or verification routes', () => {
    expect(buildPendingInviteRoute(' abcdefgh ', 'parent')).toBe('/accept-invite?code=ABCDEFGH&type=parent');
    expect(buildPendingInviteRoute('FRIEND12', 'friend', '/teams')).toBe('/accept-invite?code=FRIEND12&type=friend&next=%2Fteams');
    expect(buildPendingInviteRoute('ABCDEFGH', 'parent', '/verify-pending')).toBe('/accept-invite?code=ABCDEFGH&type=parent');
    expect(buildPendingInviteRoute('ABCDEFGH', 'parent', '/accept-invite?code=OTHER123&type=parent')).toBe(
      '/accept-invite?code=ABCDEFGH&type=parent'
    );
    expect(buildPendingInviteRoute('', 'parent', '/teams')).toBe('');
  });
});
