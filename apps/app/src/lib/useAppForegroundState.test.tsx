// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAppForegroundState, type AppForegroundStateDeps } from './useAppForegroundState';

function createDocumentLifecycle(initialVisibility: DocumentVisibilityState = 'visible') {
  let visibilityState = initialVisibility;
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const doc = {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.delete(listener);
    }),
  } as AppForegroundStateDeps['doc'];

  return {
    doc,
    setVisibility(next: DocumentVisibilityState) {
      visibilityState = next;
      listeners.forEach((listener) => {
        if (typeof listener === 'function') listener(new Event('visibilitychange'));
        else listener.handleEvent(new Event('visibilitychange'));
      });
    },
  };
}

function createNativeLifecycle() {
  let listener: ((state: { isActive: boolean }) => void) | null = null;
  const remove = vi.fn();
  const appPlugin = {
    addListener: vi.fn(async (_eventName: 'appStateChange', callback: (state: { isActive: boolean }) => void) => {
      listener = callback;
      return { remove };
    }),
  } as unknown as NonNullable<AppForegroundStateDeps['appPlugin']>;

  return {
    appPlugin,
    remove,
    setActive(isActive: boolean) {
      listener?.({ isActive });
    },
  };
}

describe('useAppForegroundState', () => {
  it('tracks browser visibility and coalesces duplicate events', () => {
    const browser = createDocumentLifecycle();
    const transitions: boolean[] = [];
    const { result } = renderHook(() => {
      const isForeground = useAppForegroundState({ doc: browser.doc, isNativePlatform: () => false });
      useEffect(() => {
        transitions.push(isForeground);
      }, [isForeground]);
      return isForeground;
    });

    expect(result.current).toBe(true);
    act(() => browser.setVisibility('hidden'));
    expect(result.current).toBe(false);
    expect(transitions).toEqual([true, false]);

    act(() => browser.setVisibility('hidden'));
    expect(result.current).toBe(false);
    expect(transitions).toEqual([true, false]);

    act(() => browser.setVisibility('visible'));
    expect(result.current).toBe(true);
    expect(transitions).toEqual([true, false, true]);
  });

  it('tracks native inactivity and removes the native listener on unmount', async () => {
    const browser = createDocumentLifecycle();
    const native = createNativeLifecycle();
    const { result, unmount } = renderHook(() => useAppForegroundState({
      doc: browser.doc,
      appPlugin: native.appPlugin,
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
    }));

    await waitFor(() => expect(native.appPlugin.addListener).toHaveBeenCalledTimes(1));
    act(() => native.setActive(false));
    expect(result.current).toBe(false);
    act(() => native.setActive(true));
    expect(result.current).toBe(true);

    unmount();
    expect(native.remove).toHaveBeenCalledTimes(1);
  });

  it('stays backgrounded until both browser and native signals are active', async () => {
    const browser = createDocumentLifecycle();
    const native = createNativeLifecycle();
    const transitions: boolean[] = [];
    const { result } = renderHook(() => {
      const isForeground = useAppForegroundState({
        doc: browser.doc,
        appPlugin: native.appPlugin,
        isNativePlatform: () => true,
        isPluginAvailable: () => true,
      });
      useEffect(() => {
        transitions.push(isForeground);
      }, [isForeground]);
      return isForeground;
    });

    await waitFor(() => expect(native.appPlugin.addListener).toHaveBeenCalledTimes(1));
    act(() => native.setActive(false));
    expect(result.current).toBe(false);
    expect(transitions).toEqual([true, false]);

    act(() => browser.setVisibility('hidden'));
    act(() => native.setActive(true));
    expect(result.current).toBe(false);
    expect(transitions).toEqual([true, false]);

    act(() => browser.setVisibility('visible'));
    expect(result.current).toBe(true);
    expect(transitions).toEqual([true, false, true]);
  });
});
