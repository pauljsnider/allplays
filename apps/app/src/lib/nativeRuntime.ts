import { Capacitor } from '@capacitor/core';

/**
 * Single source of truth for "are we running inside the Capacitor native
 * WebView" — Capacitor.isNativePlatform() alone misses the `capacitor:`
 * protocol fallback some native builds boot through, so every call site
 * needs both checks. Keeping this in one place avoids the two checks
 * silently drifting apart across call sites.
 */
export function isNativeRuntime(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  return typeof window !== 'undefined' && window.location.protocol === 'capacitor:';
}
