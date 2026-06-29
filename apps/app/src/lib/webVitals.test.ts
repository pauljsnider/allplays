// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Metric } from 'web-vitals';

const telemetryMocks = vi.hoisted(() => ({
  captureAppTelemetryEvent: vi.fn()
}));

const webVitalCallbacks = vi.hoisted(() => ({
  cls: undefined as undefined | ((metric: Metric) => void),
  fcp: undefined as undefined | ((metric: Metric) => void),
  inp: undefined as undefined | ((metric: Metric) => void),
  lcp: undefined as undefined | ((metric: Metric) => void),
  ttfb: undefined as undefined | ((metric: Metric) => void)
}));

vi.mock('./telemetry', () => telemetryMocks);
vi.mock('web-vitals', () => ({
  onCLS: vi.fn((callback: (metric: Metric) => void) => { webVitalCallbacks.cls = callback; }),
  onFCP: vi.fn((callback: (metric: Metric) => void) => { webVitalCallbacks.fcp = callback; }),
  onINP: vi.fn((callback: (metric: Metric) => void) => { webVitalCallbacks.inp = callback; }),
  onLCP: vi.fn((callback: (metric: Metric) => void) => { webVitalCallbacks.lcp = callback; }),
  onTTFB: vi.fn((callback: (metric: Metric) => void) => { webVitalCallbacks.ttfb = callback; })
}));

describe('webVitals', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    webVitalCallbacks.cls = undefined;
    webVitalCallbacks.fcp = undefined;
    webVitalCallbacks.inp = undefined;
    webVitalCallbacks.lcp = undefined;
    webVitalCallbacks.ttfb = undefined;
    const module = await import('./webVitals');
    module.resetWebVitalsMonitoringForTests();
    window.location.hash = '#/schedule';
  });

  it('registers all core web-vital reporters once', async () => {
    const module = await import('./webVitals');

    expect(await module.initializeWebVitalsMonitoring()).toBe(true);
    expect(await module.initializeWebVitalsMonitoring()).toBe(false);
    expect(webVitalCallbacks.cls).toEqual(expect.any(Function));
    expect(webVitalCallbacks.fcp).toEqual(expect.any(Function));
    expect(webVitalCallbacks.inp).toEqual(expect.any(Function));
    expect(webVitalCallbacks.lcp).toEqual(expect.any(Function));
    expect(webVitalCallbacks.ttfb).toEqual(expect.any(Function));
  });

  it('emits a rounded app_web_vital telemetry event', async () => {
    const module = await import('./webVitals');
    await module.initializeWebVitalsMonitoring();

    webVitalCallbacks.lcp?.({
      name: 'LCP',
      value: 1234.567,
      delta: 1234.567,
      id: 'vital-1',
      rating: 'needs-improvement',
      navigationType: 'navigate',
      entries: []
    } as Metric);

    expect(telemetryMocks.captureAppTelemetryEvent).toHaveBeenCalledWith('app_web_vital', {
      name: 'LCP',
      value: 1234.57,
      delta: 1234.57,
      id: 'vital-1',
      rating: 'needs-improvement',
      navigationType: 'navigate',
      route: '#/schedule'
    });
  });
});
