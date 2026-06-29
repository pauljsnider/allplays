import { useEffect, useRef } from 'react';
import { startUxTimer } from './uxTiming';

type ViewLoadTimer = ReturnType<typeof startUxTimer>;

type ViewLoadTimerOptions = {
  viewName: string;
  route: string;
  ready: boolean;
  resetKey?: string;
  disabled?: boolean;
  getBaseMeta?: () => Record<string, unknown>;
  getCompleteMeta?: () => Record<string, unknown>;
};

export function getViewLoadTimingLabel(viewName: string) {
  return `${String(viewName || 'view').trim() || 'view'} load`;
}

export function useViewLoadTimer({
  viewName,
  route,
  ready,
  resetKey = '',
  disabled = false,
  getBaseMeta,
  getCompleteMeta
}: ViewLoadTimerOptions) {
  const timerRef = useRef<ViewLoadTimer | null>(null);
  const activeKeyRef = useRef('');
  const completedKeyRef = useRef('');
  const key = `${viewName}::${route}::${resetKey}`;

  useEffect(() => {
    timerRef.current = null;
    activeKeyRef.current = '';
    completedKeyRef.current = '';
    if (disabled || !viewName) return undefined;

    activeKeyRef.current = key;
    timerRef.current = startUxTimer(getViewLoadTimingLabel(viewName), {
      category: 'view_load',
      viewName,
      route,
      ...(getBaseMeta?.() || {})
    });

    return () => {
      if (activeKeyRef.current === key) {
        // If the view is left (or its timing key changes) before `ready` flips
        // true, the started span was never ended. Cancel it so the active
        // Firebase-trace count is released; otherwise the leak blocks later
        // loads of the same label from exporting.
        const pendingTimer = timerRef.current;
        timerRef.current = null;
        pendingTimer?.cancel?.({ route, viewName });
      }
    };
    // getBaseMeta is intentionally sampled only when a new timing key starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, key, route, viewName]);

  useEffect(() => {
    if (disabled || !ready || completedKeyRef.current === key || activeKeyRef.current !== key) return;
    const timer = timerRef.current;
    if (!timer) return;

    completedKeyRef.current = key;
    timerRef.current = null;
    timer.end(getCompleteMeta?.() || {});
    // getCompleteMeta is intentionally sampled at the ready transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, key, ready]);
}
