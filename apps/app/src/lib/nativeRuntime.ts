import { Capacitor } from '@capacitor/core';

/**
 * Single source of truth for "are we running inside the Capacitor native
 * WebView". Android uses `https://localhost`; iOS and older shells can use
 * `capacitor:` or `ionic:`. Origin alone is not sufficient because an
 * ordinary browser can also serve HTTPS localhost, so the fallback requires
 * either a native platform result or Capacitor's injected native bridge.
 */
export function isNativeRuntime(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof window === 'undefined') return false;

  const { protocol, hostname } = window.location;
  const hasNativeOrigin = protocol === 'capacitor:'
    || protocol === 'ionic:'
    || (protocol === 'https:' && hostname === 'localhost');
  if (!hasNativeOrigin) return false;

  const platform = Capacitor.getPlatform?.();
  if (platform === 'ios' || platform === 'android') return true;

  const nativeWindow = window as typeof window & {
    androidBridge?: unknown;
    webkit?: { messageHandlers?: { bridge?: unknown } };
  };
  return Boolean(nativeWindow.androidBridge || nativeWindow.webkit?.messageHandlers?.bridge);
}
