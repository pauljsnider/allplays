import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useRefreshOnResume, type RefreshOnResumeDeps } from './useRefreshOnResume';

type FakeDoc = {
  visibilityState: DocumentVisibilityState;
  addEventListener: (type: string, handler: EventListener) => void;
  removeEventListener: (type: string, handler: EventListener) => void;
  fire: (type: string) => void;
};

function makeFakeDoc(initial: DocumentVisibilityState = 'visible'): FakeDoc {
  const handlers = new Map<string, Set<EventListener>>();
  return {
    visibilityState: initial,
    addEventListener: (type, handler) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
    },
    removeEventListener: (type, handler) => {
      handlers.get(type)?.delete(handler);
    },
    fire: (type) => {
      handlers.get(type)?.forEach((handler) => handler(new Event(type)));
    }
  };
}

function makeNativeAppPlugin() {
  let listener: ((state: { isActive: boolean }) => void) | null = null;
  const remove = vi.fn(async () => {});
  return {
    plugin: {
      addListener: vi.fn(async (_event: string, handler: (state: { isActive: boolean }) => void) => {
        listener = handler;
        return { remove };
      })
    },
    emit: (isActive: boolean) => listener?.({ isActive }),
    remove
  };
}

describe('useRefreshOnResume', () => {
  it('refreshes when the tab becomes visible after the stale window', () => {
    const doc = makeFakeDoc('visible');
    let clock = 1_000;
    const refresh = vi.fn();
    const deps: RefreshOnResumeDeps = {
      doc: doc as unknown as Document,
      isNativePlatform: () => false,
      now: () => clock
    };

    renderHook(() => useRefreshOnResume(refresh, { staleAfterMs: 5_000 }, deps));

    clock = 4_000; // 3s elapsed — still fresh
    doc.fire('visibilitychange');
    expect(refresh).not.toHaveBeenCalled();

    clock = 7_000; // 6s elapsed — stale
    doc.fire('visibilitychange');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not refresh while the tab is hidden', () => {
    const doc = makeFakeDoc('hidden');
    let clock = 0;
    const refresh = vi.fn();
    renderHook(() => useRefreshOnResume(refresh, { staleAfterMs: 1_000 }, {
      doc: doc as unknown as Document,
      isNativePlatform: () => false,
      now: () => clock
    }));

    clock = 10_000;
    doc.fire('visibilitychange');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('refreshes on native appStateChange when active and stale', async () => {
    const doc = makeFakeDoc('visible');
    let clock = 0;
    const refresh = vi.fn();
    const native = makeNativeAppPlugin();
    renderHook(() => useRefreshOnResume(refresh, { staleAfterMs: 1_000 }, {
      doc: doc as unknown as Document,
      isNativePlatform: () => true,
      isPluginAvailable: () => true,
      appPlugin: native.plugin as never,
      now: () => clock
    }));

    await vi.waitFor(() => expect(native.plugin.addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function)));

    clock = 5_000;
    native.emit(true);
    expect(refresh).toHaveBeenCalledTimes(1);

    // Going to background (isActive false) must not refresh.
    clock = 20_000;
    native.emit(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does nothing when disabled', () => {
    const doc = makeFakeDoc('visible');
    const refresh = vi.fn();
    renderHook(() => useRefreshOnResume(refresh, { enabled: false, staleAfterMs: 0 }, {
      doc: doc as unknown as Document,
      isNativePlatform: () => false
    }));
    doc.fire('visibilitychange');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('cleans up listeners on unmount', () => {
    const doc = makeFakeDoc('visible');
    const removeSpy = vi.spyOn(doc, 'removeEventListener');
    const refresh = vi.fn();
    const { unmount } = renderHook(() => useRefreshOnResume(refresh, { staleAfterMs: 0 }, {
      doc: doc as unknown as Document,
      isNativePlatform: () => false
    }));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
