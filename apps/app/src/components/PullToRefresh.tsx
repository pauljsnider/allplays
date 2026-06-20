import { useRef, useState, type ReactNode } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';

const triggerThresholdPx = 72;
const maxPullPx = 110;
const pullResistance = 0.5;

type PullToRefreshProps = {
  onRefresh: () => Promise<unknown> | unknown;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
};

function scrollTop() {
  if (typeof window === 'undefined') return 0;
  return window.scrollY || document.documentElement?.scrollTop || document.body?.scrollTop || 0;
}

/**
 * Lightweight pull-to-refresh wrapper for window-scrolled pages (#2044). When the
 * page is scrolled to the top and the user drags down past the threshold, it calls
 * onRefresh and shows a spinner until it resolves. Inert on non-touch devices.
 */
export function PullToRefresh({ onRefresh, disabled = false, className, children }: PullToRefreshProps) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef<number | null>(null);
  const trackingRef = useRef(false);

  const beginTracking = (clientY: number) => {
    if (disabled || refreshing || scrollTop() > 0) {
      trackingRef.current = false;
      startYRef.current = null;
      return;
    }
    trackingRef.current = true;
    startYRef.current = clientY;
  };

  const updateTracking = (clientY: number) => {
    if (!trackingRef.current || startYRef.current === null || refreshing) return;
    const delta = clientY - startYRef.current;
    if (delta <= 0 || scrollTop() > 0) {
      setPullDistance(0);
      return;
    }
    setPullDistance(Math.min(maxPullPx, delta * pullResistance));
  };

  const endTracking = async () => {
    if (!trackingRef.current) return;
    trackingRef.current = false;
    startYRef.current = null;
    if (pullDistance < triggerThresholdPx) {
      setPullDistance(0);
      return;
    }
    setRefreshing(true);
    setPullDistance(triggerThresholdPx);
    try {
      await onRefresh();
    } catch {
      // The wrapped page surfaces its own load errors; PTR just stops spinning.
    } finally {
      setRefreshing(false);
      setPullDistance(0);
    }
  };

  const progress = Math.min(1, pullDistance / triggerThresholdPx);
  const indicatorHeight = refreshing ? triggerThresholdPx : pullDistance;
  const active = refreshing || pullDistance > 0;

  return (
    <div
      className={className}
      data-testid="pull-to-refresh"
      onTouchStart={(event) => beginTracking(event.touches[0]?.clientY ?? 0)}
      onTouchMove={(event) => updateTracking(event.touches[0]?.clientY ?? 0)}
      onTouchEnd={() => { void endTracking(); }}
      onTouchCancel={() => { void endTracking(); }}
    >
      <div
        className="flex items-center justify-center overflow-hidden text-primary-600 transition-[height] duration-150 ease-out"
        style={{ height: indicatorHeight }}
        role="status"
        aria-live="polite"
        aria-hidden={!active}
      >
        {active ? (
          <span className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.04em]" style={{ opacity: refreshing ? 1 : 0.4 + progress * 0.6 }}>
            {refreshing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Refreshing
              </>
            ) : (
              <>
                <ArrowDown
                  className="h-4 w-4 transition-transform"
                  style={{ transform: `rotate(${progress >= 1 ? 180 : 0}deg)` }}
                  aria-hidden="true"
                />
                {progress >= 1 ? 'Release to refresh' : 'Pull to refresh'}
              </>
            )}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}
