// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentryMocks = vi.hoisted(() => {
  const scope = {
    setTag: vi.fn(),
    setContext: vi.fn()
  };

  return {
    scope,
    init: vi.fn(),
    captureException: vi.fn(),
    withScope: vi.fn((callback: (scope: any) => void) => callback(scope))
  };
});

vi.mock('@sentry/browser', () => sentryMocks);
vi.mock('../../../../js/telemetry.js', () => ({}));

describe('app telemetry bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete window.AllPlaysTelemetry;
    delete window.__ALLPLAYS_REPORT_REACT_ERROR__;
    delete window.__ALLPLAYS_CONFIG__;
    delete window.ALLPLAYS_ERROR_TRACKING_DSN;
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('emits timing and handled errors through telemetry and the error tracker', async () => {
    const capture = vi.fn();
    window.AllPlaysTelemetry = { capture };
    window.__ALLPLAYS_CONFIG__ = {
      errorTracking: {
        dsn: 'https://public@example.ingest.sentry.io/123'
      }
    };

    const telemetry = await import('./telemetry');
    telemetry.initializeAppErrorTracking();
    vi.spyOn(performance, 'now').mockReturnValue(160);

    telemetry.recordAppUxTiming('teams summary load', 100, {
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
    expect(sentryMocks.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://public@example.ingest.sentry.io/123',
      beforeSend: expect.any(Function)
    }));
    expect(sentryMocks.withScope).toHaveBeenCalledTimes(1);
    expect(sentryMocks.scope.setTag).toHaveBeenCalledWith('allplays_error_label', 'teams summary load');
    expect(sentryMocks.scope.setTag).toHaveBeenCalledWith('allplays_error_handled', 'true');
    expect(sentryMocks.scope.setContext).toHaveBeenCalledWith('allplays', expect.objectContaining({
      label: 'teams summary load',
      durationMs: 60,
      route: '/home'
    }));
    expect(sentryMocks.captureException).toHaveBeenCalledWith(expect.any(TypeError));
  });

  it('records app startup timing with the canonical startup stage', async () => {
    const capture = vi.fn();
    window.AllPlaysTelemetry = { capture };
    const telemetry = await import('./telemetry');

    vi.spyOn(performance, 'now')
      .mockReturnValueOnce(25)
      .mockReturnValueOnce(125);

    const timer = telemetry.startAppStartupTimer();
    timer.end({ phase: 'initial-render' });

    await Promise.resolve();

    expect(capture).toHaveBeenCalledWith(
      'app_ux_timing',
      expect.objectContaining({
        label: 'app startup',
        stage: 'startup',
        phase: 'initial-render',
        durationMs: 100,
        outcome: 'success'
      }),
      {}
    );
  });

  it('initializes only when runtime config provides a DSN, redacts sensitive payload fields, and preserves stack frames', async () => {
    const telemetry = await import('./telemetry');

    expect(telemetry.initializeAppErrorTracking()).toBe(false);
    expect(sentryMocks.init).not.toHaveBeenCalled();

    window.__ALLPLAYS_CONFIG__ = {
      sentryDsn: 'https://public@example.ingest.sentry.io/456',
      sentryEnvironment: 'production',
      sentryRelease: 'app@1.2.3'
    };

    expect(telemetry.initializeAppErrorTracking()).toBe(true);
    expect(sentryMocks.init).toHaveBeenCalledWith(expect.objectContaining({
      dsn: 'https://public@example.ingest.sentry.io/456',
      environment: 'production',
      release: 'app@1.2.3',
      beforeSend: expect.any(Function)
    }));

    const beforeSend = sentryMocks.init.mock.calls[0][0].beforeSend as (event: Record<string, unknown>) => Record<string, unknown>;
    const sanitized = beforeSend({
      request: {
        headers: {
          Authorization: 'Bearer secret-token'
        },
        url: 'https://example.test?access_token=abc123'
      },
      extra: {
        refreshToken: 'refresh-token',
        nested: {
          apiKey: 'private-key'
        }
      },
      exception: {
        values: [{
          stacktrace: {
            frames: [{
              filename: '/app/main.tsx',
              function: 'renderHome',
              lineno: 27
            }]
          }
        }]
      }
    });

    expect(sanitized.request).toEqual(expect.objectContaining({
      headers: {
        Authorization: '[REDACTED]'
      },
      url: 'https://example.test?access_token=[REDACTED]'
    }));
    expect(sanitized.extra).toEqual({
      refreshToken: '[REDACTED]',
      nested: {
        apiKey: '[REDACTED]'
      }
    });
    expect(sanitized.exception).toEqual({
      values: [{
        stacktrace: {
          frames: [{
            filename: '/app/main.tsx',
            function: 'renderHome',
            lineno: 27
          }]
        }
      }]
    });
  });

  it('reports React boundary failures without misclassifying generic TypeErrors as network errors', async () => {
    const capture = vi.fn();
    window.AllPlaysTelemetry = { capture };
    window.__ALLPLAYS_CONFIG__ = {
      errorTrackingDsn: 'https://public@example.ingest.sentry.io/789'
    };

    const telemetry = await import('./telemetry');
    telemetry.initializeAppErrorTracking();
    telemetry.installReactErrorTelemetry();

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
    expect(sentryMocks.scope.setContext).toHaveBeenCalledWith('allplays', expect.objectContaining({
      label: 'react render error',
      boundaryName: 'app-root',
      location: '/home',
      componentStackPresent: true
    }));
  });

  it('captures production unhandled errors and promise rejections through the tracker', async () => {
    window.__ALLPLAYS_CONFIG__ = {
      errorTrackingDsn: 'https://public@example.ingest.sentry.io/999'
    };

    const telemetry = await import('./telemetry');
    telemetry.initializeAppErrorTracking({ isProduction: true });

    const rejection = new Error('token=leak-me');
    window.dispatchEvent(new ErrorEvent('error', {
      message: 'boom',
      error: new Error('Authorization Bearer secret-token'),
      filename: '/app/main.js',
      lineno: 10,
      colno: 5
    }));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.reject(rejection).catch(() => undefined),
      reason: rejection
    }));

    expect(sentryMocks.captureException).toHaveBeenCalledTimes(2);
    expect(sentryMocks.scope.setTag).toHaveBeenCalledWith('allplays_error_handled', 'false');
    expect(sentryMocks.scope.setContext).toHaveBeenCalledWith('allplays', expect.objectContaining({
      label: 'window error',
      source: '/app/main.js',
      line: 10,
      column: 5
    }));
    expect(sentryMocks.scope.setContext).toHaveBeenCalledWith('allplays', expect.objectContaining({
      label: 'unhandled promise rejection',
      reason: expect.objectContaining({
        message: 'token=leak-me'
      })
    }));
  });

  it('degrades safely when the telemetry pipeline is unavailable', async () => {
    const telemetry = await import('./telemetry');

    expect(() => telemetry.captureAppTelemetryEvent('app_ux_timing', { label: 'route paint' })).not.toThrow();
    await Promise.resolve();
  });
});
