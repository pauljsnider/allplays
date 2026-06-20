import { type ReactNode, useRef, useState, type TouchEvent } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  PULL_TO_REFRESH_THRESHOLD_PX,
  getPullToRefreshDistance,
  getPullToRefreshIndicatorHeight,
  isPullToRefreshReady
} from '../lib/pullToRefresh';

type PullToRefreshProps = {
  children: ReactNode;
  onRefresh: () => Promise<unknown> | unknown;
  disabled?: boolean;
  threshold?: number;
  className?: string;
};

export function PullToRefresh({
  children,
  onRefresh,
  disabled = false,
  threshold = PULL_TO_REFRESH_THRESHOLD_PX,
  className = ''
}: PullToRefreshProps) {
  const startYRef = useRef<number | null>(null);
  const hapticTickedRef = useRef(false);
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const ready = isPullToRefreshReady(distance, threshold);
  const indicatorHeight = getPullToRefreshIndicatorHeight(distance, refreshing);
  const isActive = indicatorHeight > 0;

  const resetPull = () => {
    startYRef.current = null;
    hapticTickedRef.current = false;
    setDistance(0);
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (disabled || refreshing || getPageScrollTop() > 0) {
      startYRef.current = null;
      return;
    }
    startYRef.current = event.touches[0]?.clientY ?? null;
    hapticTickedRef.current = false;
  };

  const handleTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (disabled || refreshing || startYRef.current === null) return;
    const nextDistance = getPullToRefreshDistance(startYRef.current, event.touches[0]?.clientY ?? startYRef.current, getPageScrollTop());
    if (nextDistance <= 0) {
      setDistance(0);
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
    setDistance(nextDistance);
    if (!hapticTickedRef.current && isPullToRefreshReady(nextDistance, threshold)) {
      hapticTickedRef.current = true;
      navigator.vibrate?.(10);
    }
  };

  const handleTouchEnd = () => {
    if (disabled || refreshing || startYRef.current === null) {
      resetPull();
      return;
    }

    const shouldRefresh = isPullToRefreshReady(distance, threshold);
    resetPull();
    if (!shouldRefresh) return;

    setRefreshing(true);
    Promise.resolve(onRefresh())
      .catch(() => {
        // The owning page already renders its refresh error state.
      })
      .finally(() => {
        setRefreshing(false);
      });
  };

  return (
    <div
      className={`pull-to-refresh-root ${className}`.trim()}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={resetPull}
    >
      <div
        className="pointer-events-none fixed left-0 right-0 z-[90] flex justify-center transition-opacity duration-150"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)',
          opacity: isActive ? 1 : 0,
          transform: `translateY(${isActive ? 0 : -12}px)`
        }}
        aria-hidden={!isActive}
      >
        <div
          role="status"
          aria-live="polite"
          className={`flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white shadow-lg transition-transform ${ready || refreshing ? 'text-primary-700' : 'text-gray-500'}`}
          style={{
            transform: `scale(${isActive ? 1 : 0.85})`,
            marginTop: `${Math.min(indicatorHeight, 48) - 48}px`
          }}
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span className="sr-only">{refreshing ? 'Refreshing' : 'Pull refresh ready'}</span>
        </div>
      </div>
      {children}
    </div>
  );
}

function getPageScrollTop() {
  if (typeof window === 'undefined') return 0;
  return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
}
