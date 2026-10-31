import { describe, expect, it, vi } from 'vitest';
import { createOverlayEventHistory, createOverlayFeedController } from '../../js/live-game-overlay-feed.js';

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness(loadHistory = async () => []) {
    const listeners = { events: [], chat: [] };
    const subscribe = kind => (next, error) => {
        const unsubscribe = vi.fn();
        listeners[kind].push({ next, error, unsubscribe });
        return unsubscribe;
    };
    const callbacks = { onEvents: vi.fn(), onChat: vi.fn(), onError: vi.fn(), onReady: vi.fn(), onInvalidate: vi.fn() };
    const controller = createOverlayFeedController({ subscribeEvents: subscribe('events'),
        subscribeChat: subscribe('chat'), loadHistory, ...callbacks,
        schedule: () => 0, unschedule: vi.fn() });
    return { controller, listeners, ...callbacks };
}

describe('authoritative overlay history', () => {
    it('retains an evicted row, but removes it after authoritative history confirms absence', () => {
        const history = createOverlayEventHistory();
        history.window([{ id: 'old' }, { id: 'new' }]);
        expect(history.window([{ id: 'new' }])).toHaveLength(2);
        expect(history.replace([{ id: 'new' }], history.revision)).toEqual([{ id: 'new' }]);
    });
    it('does not overwrite a newer delivery with delayed history', () => {
        const history = createOverlayEventHistory();
        history.window([{ id: 'correction', value: 1 }]);
        const revision = history.revision;
        history.window([{ id: 'correction', value: -1 }, { id: 'reset', type: 'reset' }]);
        expect(history.replace([{ id: 'correction', value: 1 }], revision)).toEqual([
            { id: 'correction', value: -1 }, { id: 'reset', type: 'reset' }
        ]);
    });
    it('keeps recent delivery moving at capacity and marks totals incomplete', () => {
        const history = createOverlayEventHistory({ maxEvents: 1 });
        history.window([{ id: 'a' }]);
        expect(history.window([{ id: 'b' }])).toEqual([{ id: 'b' }]);
        expect(history.incomplete).toBe(true);
        expect(history.window([{ id: 'c' }])).toEqual([{ id: 'c' }]);
        history.replace([{ id: 'c' }], history.revision);
        expect(history.incomplete).toBe(false);
    });
});

describe('overlay feed ownership', () => {
    it('retries only a failed transient stream and ignores its retired callbacks', async () => {
        const h = harness();
        h.controller.start(); await tick();
        const stale = h.listeners.events[0];
        stale.error({ code: 'unavailable' });
        h.controller.recover();
        expect(h.listeners.events).toHaveLength(2);
        expect(h.listeners.chat).toHaveLength(1);
        expect(stale.unsubscribe).toHaveBeenCalledTimes(1);
        h.onEvents.mockClear();
        stale.next([{ id: 'stale' }]);
        expect(h.onEvents).not.toHaveBeenCalled();
        h.listeners.events[1].next([{ id: 'fresh' }]);
        expect(h.onEvents).toHaveBeenCalledWith([{ id: 'fresh' }]);
        h.controller.stop();
    });
    it('never loops on permission denial and cancels a previous principal history result', async () => {
        const pending = deferred();
        const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue([]);
        const h = harness(load);
        h.controller.authChanged('first');
        h.listeners.events[0].error({ code: 'permission-denied' });
        for (let n = 0; n < 5; n++) h.controller.recover();
        expect(h.listeners.events).toHaveLength(1);
        h.controller.authChanged('second'); await tick();
        h.onEvents.mockClear();
        pending.resolve([{ id: 'first-user-private' }]); await tick();
        expect(h.onEvents).not.toHaveBeenCalled();
        expect(h.onInvalidate).toHaveBeenCalledTimes(2);
        h.controller.stop();
    });
    it('bounds transient retry attempts and cancels callbacks after disposal', async () => {
        const h = harness(); h.controller.start(); await tick();
        for (let n = 0; n < 10; n++) {
            h.listeners.chat.at(-1).error({ code: 'unavailable' });
            h.controller.recover();
        }
        expect(h.listeners.chat).toHaveLength(4);
        h.controller.stop();
        h.onChat.mockClear();
        h.listeners.chat.at(-1).next([{ id: 'late' }]);
        expect(h.onChat).not.toHaveBeenCalled();
    });
    it('reconciles an older deletion on refresh without replay double counting', async () => {
        const load = vi.fn().mockResolvedValueOnce([{ id: 'old' }, { id: 'recent' }])
            .mockResolvedValueOnce([{ id: 'recent' }]);
        const h = harness(load); h.controller.start(); await tick();
        expect(h.onEvents).toHaveBeenLastCalledWith([{ id: 'old' }, { id: 'recent' }]);
        await h.controller.refresh();
        expect(h.onEvents).toHaveBeenLastCalledWith([{ id: 'recent' }]);
        h.controller.stop();
    });
});


it('a fresh resume signal restores transient history recovery after exhausting automatic retries', async () => {
    const load = vi.fn().mockRejectedValueOnce({ code: 'unavailable' })
        .mockRejectedValueOnce({ code: 'unavailable' }).mockRejectedValueOnce({ code: 'unavailable' })
        .mockResolvedValue([{ id: 'recovered' }]);
    const h = harness(load); h.controller.start(); await tick();
    await h.controller.refresh(); await h.controller.refresh(); await h.controller.refresh();
    expect(load).toHaveBeenCalledTimes(3);
    h.controller.resume(); await tick();
    expect(load).toHaveBeenCalledTimes(4);
    expect(h.onEvents).toHaveBeenLastCalledWith([{ id: 'recovered' }]);
    h.controller.stop();
});

it('resume cannot reset a permission-denied history retry boundary', async () => {
    const load = vi.fn().mockRejectedValue({ code: 'permission-denied' });
    const h = harness(load); h.controller.start(); await tick();
    h.controller.resume(); await tick();
    expect(load).toHaveBeenCalledTimes(1);
    h.controller.stop();
});

it('controller reports incomplete history but continues newer plays past capacity', async () => {
    const h = harness(); h.controller.start(); await tick();
    const rows = Array.from({ length: 2000 }, (_, n) => ({ id: `event-${n}`, createdAt: n + 1 }));
    h.listeners.events[0].next(rows);
    h.listeners.events[0].next([{ id: 'new-2001', createdAt: 2001 }]);
    expect(h.onEvents.mock.calls.at(-1)[0]).toHaveLength(2000);
    expect(h.onEvents.mock.calls.at(-1)[0].at(-1).id).toBe('new-2001');
    expect(h.onError).toHaveBeenCalledWith('history', expect.objectContaining({ message: 'overlay/history-limit' }));
    h.listeners.events[0].next([{ id: 'new-2002', createdAt: 2002 }]);
    expect(h.onEvents.mock.calls.at(-1)[0].at(-1).id).toBe('new-2002');
    h.controller.stop();
});
