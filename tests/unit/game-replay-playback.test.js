import { describe, it, expect, vi } from 'vitest';
import { resolveAuthorizedReplayPlayback, observeReplayPlaybackAuth } from '../../js/game-replay-playback.js';

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
        expect(factory).toHaveBeenCalledWith(deps.firebase.functions, 'getGameReplayPlayback');
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
