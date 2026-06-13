import { App as CapacitorApp, type BackButtonListenerEvent } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export const APP_BACK_DISMISS_EVENT = 'allplays:native-back-dismiss';
export const nativeBackExitPressWindowMs = 2000;

export type NativeBackButtonEvent = Pick<BackButtonListenerEvent, 'canGoBack'>;

type NativeBackButtonDeps = {
  appPlugin?: Pick<typeof CapacitorApp, 'addListener'>;
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (pluginName: string) => boolean;
};

export async function addNativeBackButtonListener(onBack: (event: NativeBackButtonEvent) => void, deps: NativeBackButtonDeps = {}) {
  const isNativePlatform = deps.isNativePlatform || (() => Capacitor.isNativePlatform());
  const isPluginAvailable = deps.isPluginAvailable || ((pluginName: string) => (Capacitor as any).isPluginAvailable?.(pluginName) !== false);
  if (!isNativePlatform() || !isPluginAvailable('App')) return () => {};

  const plugin = deps.appPlugin || CapacitorApp;
  const handle = await plugin.addListener('backButton', (event) => {
    onBack({ canGoBack: event.canGoBack === true });
  });
  return () => {
    void handle.remove();
  };
}

export async function exitNativeApp(appPlugin: Pick<typeof CapacitorApp, 'exitApp'> = CapacitorApp) {
  await appPlugin.exitApp();
}

export function dispatchNativeBackDismissEvent() {
  const event = new Event(APP_BACK_DISMISS_EVENT, { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export function getNativeBackTarget(pathname: string) {
  const path = normalizePathname(pathname);
  if (isNativeExitRoute(path)) return null;
  if (['/schedule', '/messages', '/teams', '/officials', '/parent-tools', '/profile', '/ai', '/help'].includes(path)) return '/home';
  if (/^\/schedule\/[^/]+\/[^/]+/.test(path)) return '/schedule';
  if (/^\/messages\/[^/]+/.test(path)) return '/messages';
  if (path === '/teams/browse') return '/teams';
  const teamSubroute = path.match(/^\/teams\/([^/]+)\/.+/);
  if (teamSubroute) return `/teams/${teamSubroute[1]}`;
  if (/^\/teams\/[^/]+$/.test(path)) return '/teams';
  if (/^\/parent-tools\/.+/.test(path)) return '/parent-tools';
  if (/^\/players\//.test(path)) return '/home';
  if (/^\/games\//.test(path)) return '/schedule';
  if (/^\/help\/.+/.test(path)) return '/help';
  if (/^\/capabilities\//.test(path)) return '/home';
  if (path === '/accept-invite' || path === '/reset-password' || path === '/verify-pending' || path === '/registration') return '/auth';
  return null;
}

export function isNativeExitRoute(pathname: string) {
  const path = normalizePathname(pathname);
  return path === '/' || path === '/home' || path === '/auth';
}

function normalizePathname(pathname: string) {
  const trimmed = String(pathname || '').trim();
  if (!trimmed || trimmed === '/') return '/';
  return trimmed.endsWith('/') && trimmed.length > 1 ? trimmed.slice(0, -1) : trimmed;
}
