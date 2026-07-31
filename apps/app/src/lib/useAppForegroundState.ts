import { useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export type AppForegroundStateDeps = {
  appPlugin?: Pick<typeof CapacitorApp, 'addListener'>;
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (pluginName: string) => boolean;
  doc?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
};

/**
 * Reports whether both the browser document and native app are in the foreground.
 * Each lifecycle signal is tracked independently so duplicate or out-of-order browser
 * and Capacitor events cannot resume work while either surface is still backgrounded.
 */
export function useAppForegroundState(deps: AppForegroundStateDeps = {}) {
  const doc = deps.doc || (typeof document !== 'undefined' ? document : null);
  const browserVisibleRef = useRef(doc?.visibilityState !== 'hidden');
  const nativeActiveRef = useRef(true);
  const [isForeground, setIsForeground] = useState(
    browserVisibleRef.current && nativeActiveRef.current
  );

  useEffect(() => {
    const updateForeground = () => {
      const next = browserVisibleRef.current && nativeActiveRef.current;
      setIsForeground((current) => current === next ? current : next);
    };

    const handleVisibility = () => {
      browserVisibleRef.current = doc?.visibilityState !== 'hidden';
      updateForeground();
    };
    doc?.addEventListener('visibilitychange', handleVisibility);

    let removeAppListener = () => {};
    let disposed = false;
    const isNativePlatform = deps.isNativePlatform || (() => Capacitor.isNativePlatform());
    const isPluginAvailable = deps.isPluginAvailable
      || ((pluginName: string) => Capacitor.isPluginAvailable(pluginName));

    async function registerAppStateListener() {
      if (!isNativePlatform() || !isPluginAvailable('App')) return;
      const plugin = deps.appPlugin || CapacitorApp;
      const handle = await plugin.addListener('appStateChange', ({ isActive }) => {
        nativeActiveRef.current = isActive;
        updateForeground();
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
    // Lifecycle dependencies are intentionally fixed for the hook lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return isForeground;
}
