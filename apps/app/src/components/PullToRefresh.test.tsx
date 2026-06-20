// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PullToRefresh } from './PullToRefresh';

vi.mock('lucide-react', () => ({ Loader2: () => null, ArrowDown: () => null }));

function setScrollTop(value: number) {
  Object.defineProperty(window, 'scrollY', { value, configurable: true, writable: true });
}

afterEach(() => {
  cleanup();
  setScrollTop(0);
});

function pull(el: HTMLElement, deltaY: number) {
  fireEvent.touchStart(el, { touches: [{ clientY: 0 }] });
  fireEvent.touchMove(el, { touches: [{ clientY: deltaY }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientY: deltaY }] });
}

describe('PullToRefresh', () => {
  it('triggers onRefresh when pulled past the threshold at the top', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
    pull(screen.getByTestId('pull-to-refresh'), 200); // 200 * 0.5 = 100 >= 72
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
  });

  it('does not trigger for a short pull below the threshold', () => {
    const onRefresh = vi.fn();
    render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
    pull(screen.getByTestId('pull-to-refresh'), 40); // 40 * 0.5 = 20 < 72
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does not trigger when the page is scrolled away from the top', () => {
    setScrollTop(250);
    const onRefresh = vi.fn();
    render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
    pull(screen.getByTestId('pull-to-refresh'), 200);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('does not trigger when disabled', () => {
    const onRefresh = vi.fn();
    render(<PullToRefresh onRefresh={onRefresh} disabled><p>content</p></PullToRefresh>);
    pull(screen.getByTestId('pull-to-refresh'), 200);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
