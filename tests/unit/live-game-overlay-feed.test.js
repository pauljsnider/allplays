import { describe, expect, it, vi } from 'vitest';
import { createOverlayEventHistory, createOverlayFeedController } from '../../js/live-game-overlay-feed.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness(loadHistory = async () => [], options = {}) {
    const listeners = { events: [], chat: [] };
    const subscribe = kind => (next, error) => {
        const unsubscribe = vi.fn();
        listeners[kind].push({ next, error, unsubscribe });
        return unsubscribe;
    };
    const callbacks = { onEvents: vi.fn(), onChat: vi.fn(), onError: vi.fn(), onReady: vi.fn(), onInvalidate: vi.fn() };
    const controller = createOverlayFeedController({ subscribeEvents: subscribe('events'),
        subscribeChat: subscribe('chat'), loadHistory, ...callbacks,
        schedule: () => 0, unschedule: vi.fn(), ...options });
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
        const load = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue([{ id: 'second-user-row' }]);
        const h = harness(load);
        h.controller.authChanged('first'); await tick();
        h.listeners.events[0].error({ code: 'permission-denied' });
        for (let n = 0; n < 5; n++) h.controller.recover();
        expect(h.listeners.events).toHaveLength(1);
        h.controller.authChanged('second'); await tick();
        h.onEvents.mockClear();
        pending.resolve([{ id: 'first-user-private' }]); await tick();
        expect(h.onEvents.mock.calls).toEqual([[[{ id: 'second-user-row' }]]]);
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
    let clock = 1000;
    const h = harness(load, { now: () => clock }); h.controller.start(); await tick();
    await h.controller.refresh(); await h.controller.refresh(); await h.controller.refresh();
    expect(load).toHaveBeenCalledTimes(3);
    clock += 300000;
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


it('suspends hidden scans and freshness-throttles repeated resume signals', async () => {
    let clock = 1000;
    let visible = true;
    let timer;
    const load = vi.fn().mockResolvedValue([{ id: 'a' }]);
    const h = harness(load, { now: () => clock, isVisible: () => visible,
        schedule: callback => { timer = callback; return 0; } });
    h.controller.start(); await tick();
    for (let i = 0; i < 29; i++) { clock += 10000; timer(); h.controller.resume(); await tick(); }
    expect(load).toHaveBeenCalledTimes(1);
    clock += 10000; timer(); await tick();
    expect(load).toHaveBeenCalledTimes(2);
    visible = false;
    for (let i = 0; i < 60; i++) { clock += 10000; timer(); h.controller.resume(); await tick(); }
    expect(load).toHaveBeenCalledTimes(2);
    visible = true; h.controller.resume(); await tick();
    expect(load).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 10; i++) h.controller.resume();
    await tick(); expect(load).toHaveBeenCalledTimes(3);
    h.controller.stop();
});

it.each([{ rows: [] }, { rows: [{ id: 'overlap', createdAt: 1 }] }])('confirms deletion overlapping an in-flight scan (%j)', async ({ rows: scanRows }) => {
    const scan = deferred();
    const point = deferred();
    const read = vi.fn().mockReturnValueOnce(point.promise).mockResolvedValue([{ id: 'overlap', row: null }]);
    const h = harness(() => scan.promise, { readEvents: read });
    h.controller.start();
    h.listeners.events[0].next([{ id: 'overlap', createdAt: 1 }]);
    h.listeners.events[0].next([]);
    await tick();
    scan.resolve(scanRows); await tick();
    point.resolve([{ id: 'overlap', row: null }]);
    await vi.waitFor(() => expect(h.onReady).toHaveBeenCalledWith('history'));
    await vi.waitFor(() => expect(h.onReady).toHaveBeenCalledWith('verification'));
    await vi.waitFor(() => expect(h.onEvents).toHaveBeenLastCalledWith([]));
    h.controller.stop();
});

it('never overlaps full scans across auth generations or resume signals', async () => {
    const first = deferred();
    let active = 0;
    let maximum = 0;
    const load = vi.fn(async () => {
        active++; maximum = Math.max(maximum, active);
        const rows = load.mock.calls.length === 1 ? await first.promise : [{ id: 'new-principal' }];
        active--; return rows;
    });
    const h = harness(load);
    h.controller.authChanged('first'); await tick();
    h.controller.authChanged('second');
    h.controller.resume();
    expect(load).toHaveBeenCalledTimes(1);
    first.resolve([{ id: 'old-principal' }]);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(maximum).toBe(1);
    expect(h.onEvents).toHaveBeenLastCalledWith([{ id: 'new-principal' }]);
    h.controller.stop();
});

it('a confirmed reinsertion supersedes its deletion tombstone during an older scan', () => {
    const history = createOverlayEventHistory();
    history.window([{ id: 'same', value: 1 }]);
    const scanRevision = history.revision;
    history.confirm('same', null, history.version('same'));
    history.window([{ id: 'same', value: 2 }]);
    expect(history.replace([], scanRevision)).toEqual([{ id: 'same', value: 2 }]);
});

it('serializes a departing-row deletion check before a requested full scan', async () => {
    const point = deferred();
    const load = vi.fn().mockResolvedValueOnce([{ id: 'departing' }]).mockResolvedValue([]);
    const read = vi.fn(() => point.promise);
    const h = harness(load, { readEvents: read });
    h.controller.start(); await tick();
    h.listeners.events[0].next([{ id: 'departing' }]);
    h.listeners.events[0].next([]); await tick();
    expect(read).toHaveBeenCalledTimes(1);
    const refresh = h.controller.refresh(); await tick();
    expect(load).toHaveBeenCalledTimes(1); // Scan cannot race the in-flight point response.
    point.resolve([{ id: 'departing', row: null }]);
    await refresh;
    expect(load).toHaveBeenCalledTimes(2);
    expect(h.onEvents).toHaveBeenLastCalledWith([]);
    h.controller.stop();
});

it('keeps a failed-verification warning through unrelated success until full reconciliation', async () => {
    const freshness = vi.fn();
    const load = vi.fn().mockResolvedValueOnce([{ id: 'failed' }, { id: 'unrelated' }]).mockResolvedValue([]);
    const read = vi.fn().mockRejectedValueOnce({ code: 'unavailable' })
        .mockResolvedValue([{ id: 'unrelated', row: null }]);
    const h = harness(load, { readEvents: read, onFreshness: freshness });
    h.controller.start(); await tick();
    h.onReady.mockClear();
    h.listeners.events[0].next([{ id: 'failed' }, { id: 'unrelated' }]);
    h.listeners.events[0].next([{ id: 'unrelated' }]); await tick();
    expect(h.onError).toHaveBeenCalledWith('verification', { code: 'unavailable' });
    h.listeners.events[0].next([]); await tick();
    expect(h.onReady).not.toHaveBeenCalledWith('verification');
    expect(freshness.mock.lastCall[0]).toMatchObject({ failed: true, verifying: false });
    await h.controller.refresh();
    expect(h.onReady).toHaveBeenCalledWith('verification');
    expect(freshness.mock.lastCall[0]).toMatchObject({ failed: false });
    expect(h.onEvents).toHaveBeenLastCalledWith([]);
    h.controller.stop();
});

it('does not reinsert capacity-evicted rows from delayed positive confirmations', () => {
    const history = createOverlayEventHistory({ maxEvents: 2 });
    history.window([{ id: 'a', createdAt: 1 }, { id: 'b', createdAt: 2 }]);
    history.window([{ id: 'c', createdAt: 3 }, { id: 'd', createdAt: 4 }]);
    for (const id of ['a', 'b']) history.confirm(id, { id, createdAt: 1 }, history.version(id));
    expect(history.values().map(row => row.id)).toEqual(['c', 'd']);
    expect(history.incomplete).toBe(true);
});

it('keeps a hidden departure backlog within capacity after resume verification', async () => {
    let visible = true;
    const rows = Array.from({ length: 2020 }, (_, i) => ({ id: `cap-${i}`, createdAt: i }));
    const h = harness(async () => rows.slice(0, 2000), { isVisible: () => visible,
        readEvents: async ids => ids.map(id => ({ id, row: rows.find(row => row.id === id) })) });
    h.controller.start(); await tick();
    h.listeners.events[0].next(rows.slice(0, 20));
    visible = false;
    h.listeners.events[0].next(rows.slice(-20));
    expect(h.onEvents.mock.lastCall[0]).toHaveLength(2000);
    visible = true; h.controller.resume(); await tick();
    expect(h.onEvents.mock.lastCall[0]).toHaveLength(2000);
    expect(h.onEvents.mock.lastCall[0].some(row => row.id === 'cap-0')).toBe(false);
    expect(h.onError).toHaveBeenCalledWith('history', expect.objectContaining({ message: 'overlay/history-limit' }));
    h.controller.stop();
});
