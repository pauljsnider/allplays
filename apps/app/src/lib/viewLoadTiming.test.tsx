// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewLoadTimer, getViewLoadTimingLabel } from './viewLoadTiming';

const uxTimingMocks = vi.hoisted(() => {
  const timerEnd = vi.fn<(meta?: Record<string, unknown>) => void>();
  const timerCancel = vi.fn<(meta?: Record<string, unknown>) => void>();
  return {
    timerEnd,
    timerCancel,
    startUxTimer: vi.fn<(label: string, baseMeta?: Record<string, unknown>) => { end: typeof timerEnd; cancel: typeof timerCancel }>(() => ({ end: timerEnd, cancel: timerCancel }))
  };
});

vi.mock('./uxTiming', () => ({
  startUxTimer: (label: string, baseMeta?: Record<string, unknown>) => uxTimingMocks.startUxTimer(label, baseMeta)
}));

function TestViewTimer({ viewName = 'home today', ready = false, resetKey = 'a' }) {
  useViewLoadTimer({
    viewName,
    route: '/home?section=today',
    ready,
    resetKey,
    getBaseMeta: () => ({ section: 'today' }),
    getCompleteMeta: () => ({ playerCount: 1 })
  });
  return <div>timer</div>;
}

describe('viewLoadTiming', () => {
  beforeEach(() => {
    uxTimingMocks.startUxTimer.mockClear();
    uxTimingMocks.timerEnd.mockClear();
    uxTimingMocks.timerCancel.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it('creates stable load labels', () => {
    expect(getViewLoadTimingLabel('profile security')).toBe('profile security load');
  });

  it('starts a view-load timer and ends it when ready', async () => {
    const view = render(<TestViewTimer ready={false} />);
    expect(uxTimingMocks.startUxTimer).toHaveBeenCalledWith('home today load', {
      category: 'view_load',
      viewName: 'home today',
      route: '/home?section=today',
      section: 'today'
    });
    expect(uxTimingMocks.timerEnd).not.toHaveBeenCalled();

    view.rerender(<TestViewTimer ready />);
    await waitFor(() => {
      expect(uxTimingMocks.timerEnd).toHaveBeenCalledWith({ playerCount: 1 });
    });
  });

  it('starts a new timer when the reset key changes', () => {
    const view = render(<TestViewTimer ready={false} resetKey="a" />);
    view.rerender(<TestViewTimer ready={false} resetKey="b" />);
    expect(uxTimingMocks.startUxTimer).toHaveBeenCalledTimes(2);
  });

  it('cancels (does not complete) an abandoned timer when the view unmounts before ready', () => {
    const view = render(<TestViewTimer ready={false} />);
    expect(uxTimingMocks.startUxTimer).toHaveBeenCalledTimes(1);

    view.unmount();

    expect(uxTimingMocks.timerCancel).toHaveBeenCalledTimes(1);
    expect(uxTimingMocks.timerEnd).not.toHaveBeenCalled();
  });

  it('cancels the previous timer when the key changes before ready', () => {
    const view = render(<TestViewTimer ready={false} resetKey="a" />);
    view.rerender(<TestViewTimer ready={false} resetKey="b" />);

    expect(uxTimingMocks.timerCancel).toHaveBeenCalledTimes(1);
    expect(uxTimingMocks.timerEnd).not.toHaveBeenCalled();
  });

  it('does not cancel a timer that completed normally before unmount', async () => {
    const view = render(<TestViewTimer ready={false} />);
    view.rerender(<TestViewTimer ready />);
    await waitFor(() => {
      expect(uxTimingMocks.timerEnd).toHaveBeenCalledTimes(1);
    });

    view.unmount();

    expect(uxTimingMocks.timerCancel).not.toHaveBeenCalled();
  });
});
