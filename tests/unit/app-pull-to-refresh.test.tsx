// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PullToRefresh } from '../../apps/app/src/components/PullToRefresh';
import {
  PULL_TO_REFRESH_MAX_DISTANCE_PX,
  getPullToRefreshDistance,
  getPullToRefreshIndicatorHeight,
  isPullToRefreshReady
} from '../../apps/app/src/lib/pullToRefresh';

describe('pull to refresh', () => {
  afterEach(() => {
    cleanup();
  });

  it('calculates pull distance only when the page is at the top', () => {
    expect(getPullToRefreshDistance(100, 260, 0)).toBe(88);
    expect(getPullToRefreshDistance(100, 400, 0)).toBe(PULL_TO_REFRESH_MAX_DISTANCE_PX);
    expect(getPullToRefreshDistance(100, 80, 0)).toBe(0);
    expect(getPullToRefreshDistance(100, 260, 12)).toBe(0);
  });

  it('reports readiness and indicator height from the shared threshold', () => {
    expect(isPullToRefreshReady(71)).toBe(false);
    expect(isPullToRefreshReady(72)).toBe(true);
    expect(getPullToRefreshIndicatorHeight(22.4, false)).toBe(22);
    expect(getPullToRefreshIndicatorHeight(0, true)).toBe(48);
  });

  it('calls onRefresh after a threshold pull gesture', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { getByTestId } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="surface">content</div>
      </PullToRefresh>
    );
    const surface = getByTestId('surface').parentElement as HTMLElement;

    fireEvent.touchStart(surface, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(surface, { touches: [{ clientY: 160 }], cancelable: true });
    fireEvent.touchEnd(surface);

    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('ignores short pulls', () => {
    const onRefresh = vi.fn();
    const { getByTestId } = render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="surface">content</div>
      </PullToRefresh>
    );
    const surface = getByTestId('surface').parentElement as HTMLElement;

    fireEvent.touchStart(surface, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(surface, { touches: [{ clientY: 40 }], cancelable: true });
    fireEvent.touchEnd(surface);

    expect(onRefresh).not.toHaveBeenCalled();
  });
});
