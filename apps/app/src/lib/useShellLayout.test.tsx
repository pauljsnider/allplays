import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useShellLayout } from './useShellLayout';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => false
  }
}));

function HookProbe() {
  const { isDesktop, isNative, isDesktopWeb } = useShellLayout();
  return (
    <div>
      <span data-testid="desktop">{String(isDesktop)}</span>
      <span data-testid="native">{String(isNative)}</span>
      <span data-testid="desktop-web">{String(isDesktopWeb)}</span>
    </div>
  );
}

describe('useShellLayout', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('supports legacy MediaQueryList listeners without crashing', () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const removeListener = vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    });
    const addListener = vi.fn((listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    });

    const media = {
      matches: false,
      addListener,
      removeListener
    };

    vi.stubGlobal('matchMedia', vi.fn(() => media));

    const { unmount } = render(<HookProbe />);

    expect(screen.getByTestId('desktop')).toHaveTextContent('false');
    expect(screen.getByTestId('native')).toHaveTextContent('false');
    expect(screen.getByTestId('desktop-web')).toHaveTextContent('false');
    expect(addListener).toHaveBeenCalledTimes(1);

    unmount();

    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});
