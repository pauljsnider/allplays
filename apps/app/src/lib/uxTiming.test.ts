import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordAppUxTiming = vi.fn();
vi.mock('./telemetry', () => ({
  recordAppUxTiming: (...args: unknown[]) => recordAppUxTiming(...args)
}));

import {
  UX_TIMING,
  recordFirstMeaningfulRender,
  hasRecordedFirstMeaningfulRender,
  resetFirstMeaningfulRenderForTests,
  startInteractionTimer,
  startScreenMountTimer,
  startUxTimer
} from './uxTiming';

describe('uxTiming', () => {
  beforeEach(() => {
    recordAppUxTiming.mockClear();
    resetFirstMeaningfulRenderForTests();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('startUxTimer merges base meta and recorded meta', () => {
    const timer = startUxTimer('schedule load', { route: 'schedule' });
    timer.end({ eventRows: 12 });
    expect(recordAppUxTiming).toHaveBeenCalledWith('schedule load', expect.any(Number), {
      route: 'schedule',
      eventRows: 12
    });
  });

  it('startInteractionTimer tags the span as an interaction', () => {
    const timer = startInteractionTimer(UX_TIMING.rsvpTap, { response: 'going' });
    timer.end({ path: 'sdk' });
    expect(recordAppUxTiming).toHaveBeenCalledWith(UX_TIMING.rsvpTap, expect.any(Number), {
      category: 'interaction',
      response: 'going',
      path: 'sdk'
    });
  });

  it('startScreenMountTimer uses stable labels and bounded screen metadata', () => {
    const timer = startScreenMountTimer('messages', { mode: 'inbox' });
    timer.end({ teamCount: 3, unreadCount: 5 });
    expect(recordAppUxTiming).toHaveBeenCalledWith(UX_TIMING.messagesMount, expect.any(Number), {
      category: 'screen_mount',
      route: 'messages',
      mode: 'inbox',
      teamCount: 3,
      unreadCount: 5
    });
  });

  it('records first meaningful render exactly once per load', () => {
    expect(hasRecordedFirstMeaningfulRender()).toBe(false);
    recordFirstMeaningfulRender('home', { warm: true });
    recordFirstMeaningfulRender('schedule');
    expect(hasRecordedFirstMeaningfulRender()).toBe(true);
    expect(recordAppUxTiming).toHaveBeenCalledTimes(1);
    expect(recordAppUxTiming).toHaveBeenCalledWith(UX_TIMING.firstMeaningfulRender, 0, {
      route: 'home',
      warm: true
    });
  });
});
