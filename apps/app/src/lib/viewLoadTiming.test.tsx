// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useViewLoadTimer, getViewLoadTimingLabel } from './viewLoadTiming';

const uxTimingMocks = vi.hoisted(() => {
  const timerEnd = vi.fn<(meta?: Record<string, unknown>) => void>();
  return {
    timerEnd,
    startUxTimer: vi.fn<(label: string, baseMeta?: Record<string, unknown>) => { end: typeof timerEnd }>(() => ({ end: timerEnd }))
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
});
