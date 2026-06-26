// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  addNativeBackButtonListener,
  dispatchNativeBackDismissEvent,
  getNativeBackTarget,
  isNativeExitRoute
} from './nativeBackButton';

describe('native back button helpers', () => {
  it('maps nested app routes to stable parent routes', () => {
    expect(getNativeBackTarget('/schedule/team-1/game-1')).toBe('/schedule');
    expect(getNativeBackTarget('/schedule')).toBe('/home');
    expect(getNativeBackTarget('/messages/team-1')).toBe('/messages');
    expect(getNativeBackTarget('/teams/team-1/fees')).toBe('/teams/team-1');
    expect(getNativeBackTarget('/teams/team-1', '?tab=roster')).toBe('/teams/team-1');
    expect(getNativeBackTarget('/teams/team-1', '?tab=more')).toBe('/teams/team-1');
    expect(getNativeBackTarget('/teams/team-1', '?tab=overview')).toBe('/teams');
    expect(getNativeBackTarget('/teams/team-1')).toBe('/teams');
    expect(getNativeBackTarget('/profile', '?section=alerts')).toBe('/profile');
    expect(getNativeBackTarget('/profile', '?section=invites')).toBe('/profile');
    expect(getNativeBackTarget('/profile', '?section=security')).toBe('/profile');
    expect(getNativeBackTarget('/profile', '?section=alerts&teamId=team-2')).toBe('/profile');
    expect(getNativeBackTarget('/profile')).toBe('/home');
    expect(getNativeBackTarget('/teams/browse')).toBe('/teams');
    expect(getNativeBackTarget('/parent-tools/registrations/team-1/form-1')).toBe('/parent-tools');
    expect(getNativeBackTarget('/help/game-day')).toBe('/help');
    expect(getNativeBackTarget('/home', '?section=feed&social=create')).toBe('/home?section=feed');
    expect(getNativeBackTarget('/home', '?section=friends')).toBe('/home');
    expect(getNativeBackTarget('/home')).toBeNull();
  });

  it('treats only bare Home and auth roots as native exit routes', () => {
    expect(isNativeExitRoute('/home')).toBe(true);
    expect(isNativeExitRoute('/home', '?section=feed')).toBe(false);
    expect(isNativeExitRoute('/auth')).toBe(true);
    expect(isNativeExitRoute('/schedule')).toBe(false);
  });

  it('registers and removes the Capacitor App back listener only in native runtime', async () => {
    const remove = vi.fn();
    const onBack = vi.fn();
    const appPlugin = {
      addListener: vi.fn(async (_eventName: 'backButton', listener: (event: { canGoBack: boolean }) => void) => {
        listener({ canGoBack: true });
        return { remove };
      })
    };

    const cleanup = await addNativeBackButtonListener(onBack, {
      appPlugin: appPlugin as any,
      isNativePlatform: () => true,
      isPluginAvailable: () => true
    });

    expect(appPlugin.addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
    expect(onBack).toHaveBeenCalledWith({ canGoBack: true });
    cleanup();
    expect(remove).toHaveBeenCalled();
  });

  it('skips listener registration outside the native app runtime', async () => {
    const appPlugin = { addListener: vi.fn() };

    const cleanup = await addNativeBackButtonListener(vi.fn(), {
      appPlugin: appPlugin as any,
      isNativePlatform: () => false,
      isPluginAvailable: () => true
    });

    cleanup();
    expect(appPlugin.addListener).not.toHaveBeenCalled();
  });

  it('reports whether an overlay consumed the native back dismissal event', () => {
    const listener = (event: Event) => event.preventDefault();
    window.addEventListener('allplays:native-back-dismiss', listener);

    expect(dispatchNativeBackDismissEvent()).toBe(true);

    window.removeEventListener('allplays:native-back-dismiss', listener);
    expect(dispatchNativeBackDismissEvent()).toBe(false);
  });
});
