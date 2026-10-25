import { describe, expect, it, vi } from 'vitest';
import { addNativeDeepLinkListener, resolveNativeDeepLinkRoute } from './nativeDeepLinkRouting';
import {
  resolvePushNotificationRoute,
  rememberPendingPushRoute,
  readPendingPushRoute,
  clearPendingPushRoute
} from './pushNotificationRouting';
const route = '/practice-resources?teamId=team&assignmentId=assignment';
describe('native assignment destinations', () => {
  it('preserves exact assignment and child through URL and push routing', () => {
    expect(resolveNativeDeepLinkRoute(`https://allplays.ai/app/#${route}`)).toBe(route);
    expect(resolvePushNotificationRoute({ data: { category: 'practice', appRoute: route } })).toBe(route);
    rememberPendingPushRoute(route);
    expect(readPendingPushRoute()).toBe(route);
    clearPendingPushRoute();
    expect(resolveNativeDeepLinkRoute('allplays://players/team/child/resources?assignmentId=assignment')).toBe(
      '/players/team/child/resources?assignmentId=assignment'
    );
  });
  it('handles cold launch and later warm links without recording any open', async () => {
    const navigate = vi.fn();
    const remove = vi.fn();
    let listener: (event: { url: string }) => void = () => {};
    const dispose = await addNativeDeepLinkListener(navigate, {
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
      appPlugin: {
        addListener: async (_name, callback) => {
          listener = callback;
          return { remove };
        },
        getLaunchUrl: async () => ({ url: `https://allplays.ai/app/#${route}` })
      }
    });
    expect(navigate).toHaveBeenCalledWith(route);
    listener({ url: 'allplays://players/team/child/resources?assignmentId=assignment' });
    expect(navigate).toHaveBeenLastCalledWith('/players/team/child/resources?assignmentId=assignment');
    dispose();
    expect(remove).toHaveBeenCalledOnce();
  });
  it('does not overwrite a newer warm link with a stale launch URL', async () => {
    const navigate = vi.fn();
    await addNativeDeepLinkListener(navigate, {
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
      appPlugin: {
        addListener: async (_name, callback) => {
          callback({ url: 'allplays://home' });
          return { remove: vi.fn() };
        },
        getLaunchUrl: async () => ({ url: `https://allplays.ai/app/#${route}` })
      }
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/home');
  });
  it('consumes a cold-start URL only once when the listener is registered again', async () => {
    const firstNavigate = vi.fn();
    const secondNavigate = vi.fn();
    const getLaunchUrl = vi.fn(async () => ({ url: `https://allplays.ai/app/#${route}` }));
    const listeners: Array<(event: { url: string }) => void> = [];
    const appPlugin = {
      addListener: async (_name: 'appUrlOpen', callback: (event: { url: string }) => void) => {
        listeners.push(callback);
        return { remove: vi.fn() };
      },
      getLaunchUrl
    };

    await addNativeDeepLinkListener(firstNavigate, {
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
      appPlugin
    });
    await addNativeDeepLinkListener(secondNavigate, {
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
      appPlugin
    });

    expect(getLaunchUrl).toHaveBeenCalledOnce();
    expect(firstNavigate).toHaveBeenCalledExactlyOnceWith(route);
    expect(secondNavigate).not.toHaveBeenCalled();
    listeners[1]?.({ url: 'allplays://home' });
    expect(secondNavigate).toHaveBeenCalledExactlyOnceWith('/home');
  });
});
