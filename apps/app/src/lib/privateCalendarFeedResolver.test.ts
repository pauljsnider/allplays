// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
  functions: { name: 'mock-functions' },
  httpsCallable: vi.fn()
}));
const nativeCallableMocks = vi.hoisted(() => ({
  callNativeFirebaseFunction: vi.fn()
}));
const nativeRuntimeMocks = vi.hoisted(() => ({
  isNativeRuntime: vi.fn(() => false)
}));

vi.mock('./adapters/legacyParentTools', () => adapterMocks);
vi.mock('./nativeCallable', () => nativeCallableMocks);
vi.mock('./nativeRuntime', () => nativeRuntimeMocks);

import { resolvePrivateTeamCalendarFeedUrl } from './privateCalendarFeedResolver';

beforeEach(() => {
  vi.clearAllMocks();
  nativeRuntimeMocks.isNativeRuntime.mockReturnValue(false);
  delete (globalThis as any).__ALLPLAYS_CONFIG__;
  delete (globalThis as any).ALLPLAYS_CALENDAR_FUNCTION_URL;
  delete (globalThis as any).ALLPLAYS_TEAM_CALENDAR_FEED_URL;
});

describe('private calendar feed resolution', () => {
  it('provisions one server-authorized token for every private feed resolution', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { teamId: 'team-1', token: 'server-token', reused: false } });
    adapterMocks.httpsCallable.mockReturnValue(callable);

    await expect(resolvePrivateTeamCalendarFeedUrl(' team-1 ')).resolves.toBe(
      'https://us-central1-game-flow-c6311.cloudfunctions.net/teamCalendarFeed?teamId=team-1&token=server-token'
    );
    expect(adapterMocks.httpsCallable).toHaveBeenCalledWith(
      adapterMocks.functions,
      'getPrivateTeamCalendarFeedToken'
    );
    expect(callable).toHaveBeenCalledWith({ teamId: 'team-1' });
    expect(nativeCallableMocks.callNativeFirebaseFunction).not.toHaveBeenCalled();
  });

  it('uses the authenticated native transport before the WebView auth bridge is available', async () => {
    nativeRuntimeMocks.isNativeRuntime.mockReturnValue(true);
    nativeCallableMocks.callNativeFirebaseFunction.mockResolvedValue({
      teamId: 'team-1',
      token: 'native-token',
      reused: false
    });

    await expect(resolvePrivateTeamCalendarFeedUrl('team-1')).resolves.toBe(
      'https://us-central1-game-flow-c6311.cloudfunctions.net/teamCalendarFeed?teamId=team-1&token=native-token'
    );
    expect(nativeCallableMocks.callNativeFirebaseFunction).toHaveBeenCalledWith(
      'getPrivateTeamCalendarFeedToken',
      { teamId: 'team-1' },
      { errorLabel: 'Private calendar feed' }
    );
    expect(adapterMocks.httpsCallable).not.toHaveBeenCalled();
  });

  it('fails closed when provisioning is denied or returns no bearer', async () => {
    adapterMocks.httpsCallable.mockReturnValueOnce(vi.fn().mockRejectedValue(new Error('permission-denied')));
    await expect(resolvePrivateTeamCalendarFeedUrl('team-1')).resolves.toBe('');

    adapterMocks.httpsCallable.mockReturnValueOnce(vi.fn().mockResolvedValue({ data: { token: null } }));
    await expect(resolvePrivateTeamCalendarFeedUrl('team-1')).resolves.toBe('');

    nativeRuntimeMocks.isNativeRuntime.mockReturnValue(true);
    nativeCallableMocks.callNativeFirebaseFunction.mockRejectedValueOnce(new Error('native auth unavailable'));
    await expect(resolvePrivateTeamCalendarFeedUrl('team-1')).resolves.toBe('');
    await expect(resolvePrivateTeamCalendarFeedUrl('')).resolves.toBe('');
  });
});
