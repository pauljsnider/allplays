// @vitest-environment jsdom
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const renderMock = vi.fn();
const telemetryMocks = vi.hoisted(() => {
  const end = vi.fn();
  return {
    end,
    startAppStartupTimer: vi.fn(() => ({ end })),
    installReactErrorTelemetry: vi.fn()
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

describe('main startup telemetry wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('starts the app startup timer and ends it after the first animation frame', async () => {
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);

    await import('./main');

    expect(telemetryMocks.installReactErrorTelemetry).toHaveBeenCalledTimes(1);
    expect(telemetryMocks.startAppStartupTimer).toHaveBeenCalledTimes(1);
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(telemetryMocks.end).toHaveBeenCalledWith({ phase: 'initial-render' });
  });
});
