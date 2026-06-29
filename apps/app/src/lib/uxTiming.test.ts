import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const recordAppUxTiming = vi.fn();
const performanceSpanEnd = vi.fn();
const startPerformanceSpan = vi.fn((label: string) => ({
  label,
  traceName: `trace:${label}`,
  startedAt: 100,
  end: performanceSpanEnd
}));
const recordCompletedPerformanceSpan = vi.fn();

vi.mock('./telemetry', () => ({
  recordAppUxTiming
}));

vi.mock('./performanceInstrumentation', () => ({
  now: vi.fn(() => 150),
  // The local mock is typed (label: string); cast the passthrough spread to a
  // tuple so it satisfies that parameter (runtime still forwards every arg).
  startPerformanceSpan: (...args: unknown[]) => startPerformanceSpan(...(args as [string])),
  recordCompletedPerformanceSpan
}));

import {
  UX_TIMING,
  recordFirstMeaningfulRender,
  hasRecordedFirstMeaningfulRender,
  resetFirstMeaningfulRenderForTests,
  startAppStartupTimer,
  startInteractionTimer,
  startScreenMountTimer,
  startWarmResumeTimer,
  startUxTimer
} from './uxTiming';

describe('uxTiming', () => {
  beforeEach(() => {
    recordAppUxTiming.mockClear();
    performanceSpanEnd.mockClear();
    startPerformanceSpan.mockClear();
    recordCompletedPerformanceSpan.mockClear();
    resetFirstMeaningfulRenderForTests();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('declares stable app-start and core interaction spans', () => {
    expect(UX_TIMING).toMatchObject({
      appStartup: 'app startup',
      appStartToHomeRender: 'app start to home first meaningful render',
      firstMeaningfulRender: 'first meaningful render',
      warmResume: 'warm resume to interactive',
      rsvpTap: 'rsvp tap latency',
      chatSend: 'chat send latency'
    });
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

  it('marks canceled spans as abandoned in Firebase-safe metadata', () => {
    const timer = startUxTimer('schedule load', { route: 'schedule' });
    timer.cancel({ source: 'unmount' });

    expect(recordAppUxTiming).not.toHaveBeenCalled();
    expect(performanceSpanEnd).toHaveBeenCalledWith({
      route: 'schedule',
      source: 'unmount',
      abandoned: true,
      outcome: 'abandoned'
    });
  });

  it('startAppStartupTimer tags the span as startup timing', () => {
    const timer = startAppStartupTimer({ platform: 'web' });
    timer.end({ phase: 'initial-render' });
    expect(recordAppUxTiming).toHaveBeenCalledWith(UX_TIMING.appStartup, expect.any(Number), {
      category: 'startup',
      stage: 'startup',
      platform: 'web',
      phase: 'initial-render'
    });
  });

  it('startWarmResumeTimer tags the span as resume timing', () => {
    const timer = startWarmResumeTimer({ source: 'visibilitychange', elapsedMs: 10_000 });
    timer.end({ route: 'home' });
    expect(recordAppUxTiming).toHaveBeenCalledWith(UX_TIMING.warmResume, expect.any(Number), {
      category: 'resume',
      source: 'visibilitychange',
      elapsedMs: 10000,
      route: 'home'
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

  it('records first meaningful render exactly once per load and emits the cold Home span', () => {
    expect(hasRecordedFirstMeaningfulRender()).toBe(false);
    recordFirstMeaningfulRender('home', { warm: true });
    recordFirstMeaningfulRender('schedule');
    expect(hasRecordedFirstMeaningfulRender()).toBe(true);
    expect(recordAppUxTiming).toHaveBeenCalledTimes(2);
    expect(recordAppUxTiming).toHaveBeenCalledWith(UX_TIMING.appStartToHomeRender, 0, {
      category: 'startup',
      route: 'home',
      warm: true
    });
    expect(recordAppUxTiming).toHaveBeenCalledWith(UX_TIMING.firstMeaningfulRender, 0, {
      route: 'home',
      warm: true
    });
  });
});
