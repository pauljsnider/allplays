// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderMock = vi.fn();
const telemetryMocks = vi.hoisted(() => {
  return {
    captureAppStartupFailure: vi.fn(),
    initializeAppErrorTracking: vi.fn(),
    installReactErrorTelemetry: vi.fn()
  };
});
const uxTimingMocks = vi.hoisted(() => {
  const end = vi.fn();
  return {
    end,
    startAppStartupTimer: vi.fn(() => ({ end }))
  };
});

vi.mock('react-dom/client', () => ({
  default: {
    createRoot: vi.fn(() => ({ render: renderMock }))
  },
  createRoot: vi.fn(() => ({ render: renderMock }))
}));

vi.mock('./App', () => ({
  default: () => React.createElement('div', null, 'App')
}));

vi.mock('./components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children)
}));

vi.mock('./lib/telemetry', () => telemetryMocks);
vi.mock('./lib/uxTiming', () => uxTimingMocks);

describe('main startup telemetry wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    renderMock.mockReset();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('initializes error tracking, starts the startup timer, and ends it after the first animation frame', async () => {
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);

    await import('./main');

    expect(telemetryMocks.initializeAppErrorTracking).toHaveBeenCalledTimes(1);
    expect(telemetryMocks.installReactErrorTelemetry).toHaveBeenCalledTimes(1);
    expect(uxTimingMocks.startAppStartupTimer).toHaveBeenCalledTimes(1);
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(uxTimingMocks.end).toHaveBeenCalledWith({ phase: 'initial-render' });
    expect(telemetryMocks.captureAppStartupFailure).not.toHaveBeenCalled();
  });

  it('captures startup failures before rethrowing them', async () => {
    const startupError = new Error('render failed');
    renderMock.mockImplementationOnce(() => {
      throw startupError;
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn());

    await expect(import('./main')).rejects.toThrow('render failed');

    expect(telemetryMocks.initializeAppErrorTracking).toHaveBeenCalledTimes(1);
    expect(telemetryMocks.captureAppStartupFailure).toHaveBeenCalledWith(startupError, { phase: 'initial-render' });
    expect(uxTimingMocks.end).toHaveBeenCalledWith({ phase: 'initial-render', error: startupError });
  });
});
