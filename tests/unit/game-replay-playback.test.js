import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveAuthorizedReplayPlayback, observeReplayPlaybackAuth, createReplayPlaybackRevalidator } from '../../js/game-replay-playback.js';

const replayVideo = {
    provider: 'youtube', videoId: 'T3f9AjVhn9U', status: 'ready',
    embedUrl: 'https://www.youtube.com/embed/T3f9AjVhn9U',
    publicUrl: 'https://www.youtube.com/watch?v=T3f9AjVhn9U'
};
function setup(data, error) {
    const call = error ? vi.fn().mockRejectedValue(error) : vi.fn().mockResolvedValue({ data });
    const factory = vi.fn(() => call);
    return { call, factory, deps: { firebase: { functions: {}, httpsCallable: factory } } };
}
describe('server-authorized recorded playback', () => {
    it('resolves a marker-only public replay through the existing callable', async () => {
        const { deps, call, factory } = setup({ state: 'ready', available: true, replayVideo });
        const result = await resolveAuthorizedReplayPlayback({ teamId: 'team', gameId: 'game' }, deps);
        expect(factory).toHaveBeenCalledWith(deps.firebase.functions, 'getGameReplayPlayback', { timeout: 10000 });
        expect(call).toHaveBeenCalledWith({ teamId: 'team', gameId: 'game' });
        expect(result).toMatchObject({ hasVideo: true, mode: 'embed', sourceUrl: replayVideo.embedUrl, isPublicProjectionVideo: true });
    });
    for (const [name, data, error] of [
        ['denied', { state: 'ready', available: false, reason: 'team-pass-required', replayVideo }],
        ['private', null, new Error('permission-denied')],
        ['missing', null, new Error('not-found')],
        ['deleted', { state: 'removed', available: false }],
        ['unavailable', null, new Error('unavailable')],
        ['unsafe embed', { state: 'ready', available: true, replayVideo: { ...replayVideo, embedUrl: 'https://evil.test/embed/T3f9AjVhn9U' } }]
    ]) it(`fails closed for ${name}`, async () => {
        const { deps } = setup(data, error);
        expect(await resolveAuthorizedReplayPlayback({ teamId: 'team', gameId: 'game' }, deps))
            .toMatchObject({ hasVideo: false, sourceUrl: null, publicUrl: null });
    });
});

it('observes raw Firebase identity without profile enrichment', async () => {
    const auth = { currentUser: { uid: 'A' } };
    const callback = vi.fn();
    const unsubscribe = vi.fn();
    const onAuthStateChanged = vi.fn(() => unsubscribe);
    expect(await observeReplayPlaybackAuth(callback, { firebase: { auth, onAuthStateChanged } })).toBe(unsubscribe);
    expect(onAuthStateChanged).toHaveBeenCalledWith(auth, callback);
});

it('rejects an old principal response even before a raw observer callback runs', async () => {
    let resolve;
    const auth = { currentUser: { uid: 'A' } };
    const pending = new Promise(done => { resolve = done; });
    const result = resolveAuthorizedReplayPlayback({ teamId: 'team', gameId: 'game' }, {
        firebase: { auth, functions: {}, httpsCallable: () => () => pending }
    });
    auth.currentUser = { uid: 'B' };
    resolve({ data: { state: 'ready', available: true, replayVideo } });
    expect(await result).toMatchObject({ hasVideo: false, sourceUrl: null });
});


describe('explicit replay authorization scheduler', () => {
    afterEach(() => vi.useRealTimers());
    function harness(refresh = vi.fn().mockResolvedValue(true)) {
        vi.useFakeTimers();
        const host = new EventTarget();
        const doc = new EventTarget();
        doc.hidden = false;
        const invalidate = vi.fn();
        const controller = createReplayPlaybackRevalidator({ refresh, invalidate }, { window: host, document: doc });
        return { host, doc, refresh, invalidate, controller };
    }
    it('has one periodic timer and revalidates at 15 seconds after settling', async () => {
        const h = harness();
        await h.controller.refresh();
        expect(h.refresh).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(14999);
        expect(h.refresh).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(h.refresh).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(1);
        expect(h.invalidate).not.toHaveBeenCalled();
        h.controller.stop();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('fails a hung check closed without overlapping it or starving its result generation on ticks', async () => {
        let finish;
        const h = harness(vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(true));
        const pending = h.controller.refresh();
        await vi.advanceTimersByTimeAsync(10000);
        expect(h.invalidate).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(120000);
        expect(h.refresh).toHaveBeenCalledTimes(1);
        expect(h.invalidate).toHaveBeenCalledTimes(1);
        finish(false);
        await pending;
        await vi.advanceTimersByTimeAsync(15000);
        expect(h.refresh).toHaveBeenCalledTimes(2);
        h.controller.stop();
    });
    it('coalesces repeated auth refreshes behind one pending transport', async () => {
        let finish;
        const h = harness(vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(true));
        const pending = h.controller.refresh();
        await vi.advanceTimersByTimeAsync(0);
        void h.controller.invalidateAndRefresh();
        void h.controller.invalidateAndRefresh();
        expect(h.invalidate).toHaveBeenCalledTimes(2);
        expect(h.refresh).toHaveBeenCalledTimes(1);
        finish(false);
        await pending;
        await vi.advanceTimersByTimeAsync(0);
        expect(h.refresh).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(1);
        h.controller.stop();
    });
    it('hides, resumes BFCache, and permanently stops on unload without resurrecting pending work', async () => {
        const h = harness();
        await h.controller.refresh();
        h.host.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
        await vi.advanceTimersByTimeAsync(60000);
        expect(h.refresh).toHaveBeenCalledTimes(1);
        h.host.dispatchEvent(new Event('pageshow'));
        await vi.advanceTimersByTimeAsync(0);
        expect(h.refresh).toHaveBeenCalledTimes(2);
        h.host.dispatchEvent(new Event('beforeunload'));
        h.host.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
        h.host.dispatchEvent(new Event('pageshow'));
        h.doc.dispatchEvent(new Event('visibilitychange'));
        await vi.advanceTimersByTimeAsync(60000);
        expect(h.refresh).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('never starts work queued in a microtask after suspension or stop', async () => {
        const h = harness();
        const pending = h.controller.refresh();
        h.host.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }));
        await pending;
        expect(h.refresh).not.toHaveBeenCalled();
        h.controller.stop();
        expect(vi.getTimerCount()).toBe(0);
    });
    it('clears on a thrown refresh and permits a later periodic retry', async () => {
        const h = harness(vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(true));
        await h.controller.refresh();
        expect(h.invalidate).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(15000);
        expect(h.refresh).toHaveBeenCalledTimes(2);
        h.controller.stop();
    });
});
