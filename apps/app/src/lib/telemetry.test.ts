// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAppTelemetryEvent, installReactErrorTelemetry, recordAppUxTiming } from './telemetry';

vi.mock('../../../../js/telemetry.js', () => ({}));

describe('app telemetry bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete window.AllPlaysTelemetry;
    delete window.__ALLPLAYS_REPORT_REACT_ERROR__;
  });

  it('emits timing and load error events through the shared telemetry pipeline', async () => {
    const capture = vi.fn();
    window.AllPlaysTelemetry = { capture };
    vi.spyOn(performance, 'now').mockReturnValue(160);

    recordAppUxTiming('teams summary load', 100, {
      route: '/home',
      error: new TypeError('Failed to fetch')
    });

    await Promise.resolve();

    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenNthCalledWith(
      1,
      'app_ux_timing',
      expect.objectContaining({
        label: 'teams summary load',
        durationMs: 60,
        outcome: 'error',
        route: '/home'
      }),
      {}
    );
    expect(capture).toHaveBeenNthCalledWith(
      2,
      'app_load_error',
      expect.objectContaining({
        label: 'teams summary load',
        durationMs: 60,
        route: '/home',
        errorName: 'TypeError',
        errorType: 'network'
      }),
      { flush: true }
    );
  });

  it('reports React boundary failures without misclassifying generic TypeErrors as network errors', async () => {
    const capture = vi.fn();
    window.AllPlaysTelemetry = { capture };

    installReactErrorTelemetry();

    expect(typeof window.__ALLPLAYS_REPORT_REACT_ERROR__).toBe('function');

    expect(() => {
      window.__ALLPLAYS_REPORT_REACT_ERROR__?.({
        boundaryName: 'app-root',
        error: new TypeError("Cannot read properties of undefined (reading 'team')"),
        errorInfo: { componentStack: '\n    at Home' },
        location: '/home'
      });
    }).not.toThrow();

    await Promise.resolve();

    expect(capture).toHaveBeenCalledWith(
      'app_load_error',
      expect.objectContaining({
        label: 'react render error',
        boundaryName: 'app-root',
        location: '/home',
        componentStackPresent: true,
        errorName: 'TypeError',
        errorType: 'unknown'
      }),
      { flush: true }
    );
  });

  it('degrades safely when the pipeline is unavailable', async () => {
    expect(() => captureAppTelemetryEvent('app_ux_timing', { label: 'route paint' })).not.toThrow();
    await Promise.resolve();
  });
});
