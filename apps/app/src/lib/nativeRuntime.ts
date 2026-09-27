import { Capacitor } from '@capacitor/core';

/**
 * Single source of truth for "are we running inside the Capacitor native
 * WebView". Android uses `https://localhost`; iOS and older shells can use
 * `capacitor:` or `ionic:`. The Android origin must be recognized on its own:
 * during early startup Capacitor derives its platform result from the native
 * bridge, which may not have been injected yet.
 */
export function isNativeRuntime(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof window === 'undefined') return false;

  const { protocol, hostname } = window.location;
  return protocol === 'capacitor:'
    || protocol === 'ionic:'
    || (protocol === 'https:' && hostname === 'localhost');
}
