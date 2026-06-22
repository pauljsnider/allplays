// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function BrokenScreen(): never {
  throw new Error('render failed');
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete window.__ALLPLAYS_REPORT_REACT_ERROR__;
  });

  it('renders recovery actions and reports render failures', () => {
    const onError = vi.fn();
    const reportHook = vi.fn();
    const goHome = vi.fn();
    window.__ALLPLAYS_REPORT_REACT_ERROR__ = reportHook;

    render(
      <ErrorBoundary name="test-boundary" onError={onError} onGoHome={goHome}>
        <BrokenScreen />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert', { name: 'Screen error' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'This screen ran into a problem.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Go home' }));

    expect(goHome).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      boundaryName: 'test-boundary',
      error: expect.any(Error),
      location: expect.any(String)
    }));
    expect(reportHook).toHaveBeenCalledWith(expect.objectContaining({
      boundaryName: 'test-boundary',
      error: expect.any(Error)
    }));
  });

  it('clears the fallback when the reset key changes', () => {
    const { rerender } = render(
      <ErrorBoundary name="test-boundary" resetKey="/broken">
        <BrokenScreen />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert', { name: 'Screen error' })).toBeTruthy();

    rerender(
      <ErrorBoundary name="test-boundary" resetKey="/healthy">
        <div>Recovered screen</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Recovered screen')).toBeTruthy();
  });

  it('does not clear a newly captured route error when the reset key changed in the same update', () => {
    const onError = vi.fn();
    const reportHook = vi.fn();
    window.__ALLPLAYS_REPORT_REACT_ERROR__ = reportHook;

    const { rerender } = render(
      <ErrorBoundary name="test-boundary" resetKey="/healthy" onError={onError}>
        <div>Healthy screen</div>
      </ErrorBoundary>
    );

    rerender(
      <ErrorBoundary name="test-boundary" resetKey="/broken" onError={onError}>
        <BrokenScreen />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert', { name: 'Screen error' })).toBeTruthy();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(reportHook).toHaveBeenCalledTimes(1);
  });
});
