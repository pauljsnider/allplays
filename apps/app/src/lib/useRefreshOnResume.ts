import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export type RefreshOnResumeFn = () => void | Promise<void>;

export type UseRefreshOnResumeOptions = {
  /** Only refresh when the last refresh is at least this old. Defaults to 5 minutes. */
  staleAfterMs?: number;
  /** Disable the listeners entirely (e.g. while signed out). Defaults to true. */
  enabled?: boolean;
};

export type RefreshOnResumeDeps = {
  appPlugin?: Pick<typeof CapacitorApp, 'addListener'>;
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (pluginName: string) => boolean;
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  now?: () => number;
};

const defaultStaleAfterMs = 5 * 60_000;

/**
 * Refreshes a page when the app returns to the foreground (Capacitor `App.appStateChange`)
 * or the browser tab regains visibility (`visibilitychange`), but only when the data is
 * older than `staleAfterMs`. This keeps rapid app-switching from hammering the network while
 * still pulling fresh data after a real backgrounding gap.
 *
 * The refresh callback is held in a ref so callers can pass an inline closure without
 * re-subscribing the listeners on every render.
 */
export function useRefreshOnResume(
  refreshFn: RefreshOnResumeFn,
  { staleAfterMs = defaultStaleAfterMs, enabled = true }: UseRefreshOnResumeOptions = {},
  deps: RefreshOnResumeDeps = {}
) {
  const refreshRef = useRef(refreshFn);
  const lastRefreshAtRef = useRef<number>((deps.now || Date.now)());
  const prevActiveRef = useRef<boolean | null>(null);

  useEffect(() => {
    refreshRef.current = refreshFn;
  }, [refreshFn]);

  useEffect(() => {
    if (!enabled) return;

    const now = deps.now || (() => Date.now());
    // Treat (re)mount/enable as a fresh load so we don't immediately refire.
    lastRefreshAtRef.current = now();

    const maybeRefresh = () => {
      const elapsed = now() - lastRefreshAtRef.current;
      if (elapsed < staleAfterMs) return;
      lastRefreshAtRef.current = now();
      void Promise.resolve(refreshRef.current()).catch((error) => {
        console.warn('[refresh-on-resume] Refresh failed:', error);
      });
    };

    const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
    const handleVisibility = () => {
      if (!doc || doc.visibilityState === 'visible') {
        maybeRefresh();
      }
    };
    doc?.addEventListener('visibilitychange', handleVisibility);

    let removeAppListener = () => {};
    let disposed = false;
    const isNativePlatform = deps.isNativePlatform || (() => Capacitor.isNativePlatform());
    const isPluginAvailable = deps.isPluginAvailable
      || ((pluginName: string) => (Capacitor as any).isPluginAvailable?.(pluginName) !== false);

    async function registerAppStateListener() {
      if (!isNativePlatform() || !isPluginAvailable('App')) return;
      const plugin = deps.appPlugin || CapacitorApp;
      const handle = await plugin.addListener('appStateChange', ({ isActive }) => {
        if (prevActiveRef.current === false && isActive) {
          maybeRefresh();
        }
        prevActiveRef.current = isActive;
      });
      if (disposed) {
        void handle.remove();
        return;
      }
      removeAppListener = () => {
        void handle.remove();
      };
    }

    void registerAppStateListener();

    return () => {
      disposed = true;
      doc?.removeEventListener('visibilitychange', handleVisibility);
      removeAppListener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, staleAfterMs]);
}
