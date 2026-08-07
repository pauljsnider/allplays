import { Capacitor } from '@capacitor/core';

/**
 * Single source of truth for "are we running inside the Capacitor native
 * WebView" — Capacitor.isNativePlatform() alone can be unavailable during
 * early module initialization, so keep the native WebView origins as a
 * fallback. Android uses `https://localhost`; iOS and older shells can use
 * `capacitor:` or `ionic:`.
 */
export function isNativeRuntime(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof window === 'undefined') return false;

  const { protocol, hostname } = window.location;
  return protocol === 'capacitor:'
    || protocol === 'ionic:'
    || (protocol === 'https:' && hostname === 'localhost');
}
