// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const uxTimingMocks = vi.hoisted(() => {
    const resumeEnd = vi.fn();
    return {
        resumeEnd,
        startWarmResumeTimer: vi.fn(() => ({ end: resumeEnd }))
    };
});

vi.mock('../../apps/app/src/lib/uxTiming', () => ({
    startWarmResumeTimer: uxTimingMocks.startWarmResumeTimer
}));

import { useRefreshOnResume, type RefreshOnResumeDeps } from '../../apps/app/src/lib/useRefreshOnResume';

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

const mountedRoots: Root[] = [];
const mountedContainers: HTMLDivElement[] = [];

function mountUseRefreshOnResume(
    refresh: () => void,
    options: Parameters<typeof useRefreshOnResume>[1],
    deps: RefreshOnResumeDeps
) {
    function Harness() {
        useRefreshOnResume(refresh, options, deps);
        return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedContainers.push(container);
    mountedRoots.push(root);
    act(() => {
        root.render(<Harness />);
    });
    return {
        unmount() {
            act(() => {
                root.unmount();
            });
        }
    };
}

afterEach(() => {
    vi.clearAllMocks();
    while (mountedRoots.length) {
        const root = mountedRoots.pop();
        act(() => {
            root?.unmount();
        });
    }
    while (mountedContainers.length) {
        mountedContainers.pop()?.remove();
    }
    window.history.replaceState(null, '', '/');
});

describe('useRefreshOnResume', () => {
    it('refreshes when the tab becomes visible after the stale window', () => {
        const doc = makeFakeDoc('visible');
        let clock = 1_000;
        const refresh = vi.fn();
        window.location.hash = '#/home';
        const deps: RefreshOnResumeDeps = {
            doc: doc as unknown as Document,
            isNativePlatform: () => false,
            now: () => clock
        };

        mountUseRefreshOnResume(refresh, { staleAfterMs: 5_000 }, deps);

        clock = 4_000;
        doc.fire('visibilitychange');
        expect(refresh).not.toHaveBeenCalled();

        clock = 7_000;
        doc.fire('visibilitychange');
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(uxTimingMocks.startWarmResumeTimer).toHaveBeenCalledWith({
            source: 'visibilitychange',
            staleAfterMs: 5000,
            elapsedMs: 6000,
            route: 'home'
        });
        return vi.waitFor(() => {
            expect(uxTimingMocks.resumeEnd).toHaveBeenCalledWith({ source: 'visibilitychange' });
        });
    });

    it('does not refresh while the tab is hidden', () => {
        const doc = makeFakeDoc('hidden');
        let clock = 0;
        const refresh = vi.fn();
        mountUseRefreshOnResume(refresh, { staleAfterMs: 1_000 }, {
            doc: doc as unknown as Document,
            isNativePlatform: () => false,
            now: () => clock
        });

        clock = 10_000;
        doc.fire('visibilitychange');
        expect(refresh).not.toHaveBeenCalled();
    });

    it('refreshes only when native app state returns to active after backgrounding', async () => {
        const doc = makeFakeDoc('visible');
        let clock = 0;
        const refresh = vi.fn();
        const native = makeNativeAppPlugin();
        window.location.hash = '#/messages/team-1';
        mountUseRefreshOnResume(refresh, { staleAfterMs: 1_000 }, {
            doc: doc as unknown as Document,
            isNativePlatform: () => true,
            isPluginAvailable: () => true,
            appPlugin: native.plugin as never,
            now: () => clock
        });

        await vi.waitFor(() => expect(native.plugin.addListener).toHaveBeenCalledWith('appStateChange', expect.any(Function)));

        clock = 5_000;
        native.emit(true);
        expect(refresh).not.toHaveBeenCalled();

        clock = 6_000;
        native.emit(false);
        expect(refresh).not.toHaveBeenCalled();

        clock = 7_000;
        native.emit(true);
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(uxTimingMocks.startWarmResumeTimer).toHaveBeenCalledWith({
            source: 'native_app_state',
            staleAfterMs: 1000,
            elapsedMs: 7000,
            route: 'messages'
        });
    });

    it('does nothing when disabled', () => {
        const doc = makeFakeDoc('visible');
        const refresh = vi.fn();
        mountUseRefreshOnResume(refresh, { enabled: false, staleAfterMs: 0 }, {
            doc: doc as unknown as Document,
            isNativePlatform: () => false
        });
        doc.fire('visibilitychange');
        expect(refresh).not.toHaveBeenCalled();
    });

    it('cleans up listeners on unmount', () => {
        const doc = makeFakeDoc('visible');
        const removeSpy = vi.spyOn(doc, 'removeEventListener');
        const refresh = vi.fn();
        const view = mountUseRefreshOnResume(refresh, { staleAfterMs: 0 }, {
            doc: doc as unknown as Document,
            isNativePlatform: () => false
        });
        view.unmount();
        expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    });

    it('logs failed resume refreshes through the structured logger', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const doc = makeFakeDoc('visible');
        let clock = 0;
        window.location.hash = '#/schedule?filter=upcoming-all';
        const refresh = vi.fn(async () => {
            throw Object.assign(new Error('Refresh failed with Bearer unsafe-token'), {
                headers: { Authorization: 'Bearer header-token' }
            });
        });
        mountUseRefreshOnResume(refresh, { staleAfterMs: 1_000 }, {
            doc: doc as unknown as Document,
            isNativePlatform: () => false,
            now: () => clock
        });

        clock = 2_000;
        doc.fire('visibilitychange');
        await vi.waitFor(() => expect(warnSpy).toHaveBeenCalled());

        expect(uxTimingMocks.resumeEnd).toHaveBeenCalledWith({
            source: 'visibilitychange',
            error: expect.any(Error)
        });
        expect(warnSpy).toHaveBeenCalledWith(
            '[refresh-on-resume] Refresh failed.',
            {
                error: {
                    name: 'Error',
                    message: 'Refresh failed with Bearer [REDACTED]',
                    headers: {
                        Authorization: '[REDACTED]'
                    }
                }
            }
        );
    });
});
