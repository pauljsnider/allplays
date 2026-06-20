export const PULL_TO_REFRESH_THRESHOLD_PX = 72;
export const PULL_TO_REFRESH_MAX_DISTANCE_PX = 112;

export function getPullToRefreshDistance(startY: number, currentY: number, scrollTop: number) {
  if (scrollTop > 0) return 0;
  const delta = currentY - startY;
  if (delta <= 0) return 0;
  return Math.min(PULL_TO_REFRESH_MAX_DISTANCE_PX, delta * 0.55);
}

export function isPullToRefreshReady(distance: number, threshold = PULL_TO_REFRESH_THRESHOLD_PX) {
  return distance >= threshold;
}

export function getPullToRefreshIndicatorHeight(distance: number, refreshing: boolean) {
  if (refreshing) return 48;
  return Math.round(Math.max(0, distance));
}
