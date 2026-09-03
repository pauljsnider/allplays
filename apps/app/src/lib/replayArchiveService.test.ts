// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

const adapterMocks = vi.hoisted(() => ({
  functions: { name: 'functions' },
  httpsCallable: vi.fn()
}));

const nativeMocks = vi.hoisted(() => ({ callNativeFirebaseFunction: vi.fn() }));
const runtimeMocks = vi.hoisted(() => ({ isNativeRuntime: vi.fn(() => false) }));
const cacheMocks = vi.hoisted(() => ({
  invalidateCachedAppData: vi.fn(),
  getParentScheduleSummaryCacheKey: (userId: string) => `app-schedule-summary:${userId}`,
  getParentHomeSecondaryCacheKey: (userId: string) => `home-secondary:${userId}`
}));

vi.mock('./adapters/legacyParentTools', () => adapterMocks);
vi.mock('./nativeCallable', () => nativeMocks);
vi.mock('./nativeRuntime', () => runtimeMocks);
vi.mock('./appDataCache', () => cacheMocks);

import {
  createReplayMutationId,
  getGameReplayPlaybackForApp,
  linkGameYouTubeReplayForApp,
  readGameReplayArchiveForApp,
  removeGameReplayForApp
} from './replayArchiveService';

const replayVideo = {
  provider: 'youtube',
  videoId: 'PK1HyC37doc',
  embedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
  publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
  status: 'ready',
  linkedBy: 'private-principal',
  linkedAt: 'private-timestamp'
};

const readyResponse = {
  state: 'ready',
  hasRecordedReplay: true,
  replayArchiveRevision: 'revision-2',
  replayVideo,
  lastMutationId: 'mutation-1'
};

const removedResponse = {
  state: 'removed',
  hasRecordedReplay: false,
  replayArchiveRevision: 'revision-3',
  replayVideo: null,
  lastMutationId: 'mutation-1'
};

function callableError(code: string) {
  return Object.assign(new Error(code), { code: `functions/${code}` });
}

describe('replayArchiveService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMocks.isNativeRuntime.mockReturnValue(false);
    adapterMocks.httpsCallable.mockReturnValue(
      vi.fn().mockResolvedValue({
        data: {
          state: 'none',
          hasRecordedReplay: false,
          replayArchiveRevision: null,
          replayVideo: null,
          lastMutationId: null
        }
      })
    );
  });

  it('uses the authenticated web callable and strips private provenance from the transient result', async () => {
    const callable = vi.fn().mockResolvedValue({ data: readyResponse });
    adapterMocks.httpsCallable.mockReturnValue(callable);

    const result = await readGameReplayArchiveForApp('team-1', 'game-1');

    expect(adapterMocks.httpsCallable).toHaveBeenCalledWith(adapterMocks.functions, 'manageGameReplayArchive');
    expect(callable).toHaveBeenCalledWith({ action: 'read', teamId: 'team-1', gameId: 'game-1' });
    expect(result.replayVideo).toEqual({
      provider: 'youtube',
      videoId: 'PK1HyC37doc',
      embedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
      publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
      status: 'ready'
    });
    expect(result.replayVideo).not.toHaveProperty('linkedBy');
    expect(result.replayVideo).not.toHaveProperty('linkedAt');
    expect(nativeMocks.callNativeFirebaseFunction).not.toHaveBeenCalled();
  });

  it('uses only the native authenticated callable on Capacitor and never falls back to web', async () => {
    runtimeMocks.isNativeRuntime.mockReturnValue(true);
    nativeMocks.callNativeFirebaseFunction.mockRejectedValue(new Error('Native auth unavailable.'));

    await expect(readGameReplayArchiveForApp('team-1', 'game-1')).rejects.toThrow('Native auth unavailable.');

    expect(nativeMocks.callNativeFirebaseFunction).toHaveBeenCalledWith(
      'manageGameReplayArchive',
      { action: 'read', teamId: 'team-1', gameId: 'game-1' },
      { errorLabel: 'Game replay' }
    );
    expect(adapterMocks.httpsCallable).not.toHaveBeenCalled();
  });

  it('sets a canonical URL with an opaque expected revision and invalidates safe schedule caches', async () => {
    const callable = vi.fn().mockResolvedValue({ data: readyResponse });
    adapterMocks.httpsCallable.mockReturnValue(callable);

    const result = await linkGameYouTubeReplayForApp('team-1', 'game-1', 'https://youtu.be/PK1HyC37doc?si=tracking-token', {
      expectedRevision: 'revision-1',
      mutationId: 'mutation-1',
      userId: 'user-1',
      title: '  Final   replay  '
    });

    expect(callable).toHaveBeenCalledWith({
      action: 'set',
      teamId: 'team-1',
      gameId: 'game-1',
      expectedRevision: 'revision-1',
      mutationId: 'mutation-1',
      youtubeUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
      title: 'Final replay'
    });
    expect(result.replayVideo?.videoId).toBe('PK1HyC37doc');
    expect(cacheMocks.invalidateCachedAppData).toHaveBeenCalledWith('app-schedule-summary:user-1');
    expect(cacheMocks.invalidateCachedAppData).toHaveBeenCalledWith('home-secondary:user-1');
    expect(cacheMocks.invalidateCachedAppData).toHaveBeenCalledWith('event-details:team-1:game-1');
  });

  it('retries an ambiguous mutation byte-for-byte, then proves it with a management read', async () => {
    const callable = vi
      .fn()
      .mockRejectedValueOnce(callableError('unavailable'))
      .mockResolvedValueOnce({ data: readyResponse })
      .mockResolvedValueOnce({ data: readyResponse });
    adapterMocks.httpsCallable.mockReturnValue(callable);

    await linkGameYouTubeReplayForApp('team-1', 'game-1', replayVideo.publicUrl, {
      expectedRevision: 'revision-1',
      mutationId: 'mutation-1'
    });

    expect(callable).toHaveBeenCalledTimes(3);
    expect(callable.mock.calls[1]).toEqual(callable.mock.calls[0]);
    expect(callable.mock.calls[2][0]).toEqual({ action: 'read', teamId: 'team-1', gameId: 'game-1' });
  });

  it('reconciles two lost responses only when a management read proves the exact mutation ID', async () => {
    const callable = vi
      .fn()
      .mockRejectedValueOnce(callableError('deadline-exceeded'))
      .mockRejectedValueOnce(callableError('unavailable'))
      .mockResolvedValueOnce({ data: readyResponse });
    adapterMocks.httpsCallable.mockReturnValue(callable);

    const result = await linkGameYouTubeReplayForApp('team-1', 'game-1', replayVideo.publicUrl, {
      expectedRevision: 'revision-1',
      mutationId: 'mutation-1'
    });

    expect(callable).toHaveBeenCalledTimes(3);
    expect(callable.mock.calls[2][0]).toEqual({ action: 'read', teamId: 'team-1', gameId: 'game-1' });
    expect(result.lastMutationId).toBe('mutation-1');
  });

  it.each(['cancelled', 'data-loss'])('reconciles a committed native mutation after a %s transport result', async (code) => {
    runtimeMocks.isNativeRuntime.mockReturnValue(true);
    nativeMocks.callNativeFirebaseFunction
      .mockRejectedValueOnce(callableError(code))
      .mockRejectedValueOnce(callableError(code))
      .mockResolvedValueOnce(readyResponse);

    const result = await linkGameYouTubeReplayForApp('team-1', 'game-1', replayVideo.publicUrl, {
      expectedRevision: 'revision-1',
      mutationId: 'mutation-1'
    });

    expect(result.lastMutationId).toBe('mutation-1');
    expect(nativeMocks.callNativeFirebaseFunction).toHaveBeenCalledTimes(3);
    expect(nativeMocks.callNativeFirebaseFunction.mock.calls[1]).toEqual(
      nativeMocks.callNativeFirebaseFunction.mock.calls[0]
    );
    expect(nativeMocks.callNativeFirebaseFunction.mock.calls[2][1]).toEqual({
      action: 'read',
      teamId: 'team-1',
      gameId: 'game-1'
    });
    expect(adapterMocks.httpsCallable).not.toHaveBeenCalled();
  });

  it('keeps a cancelled native mutation unresolved when its authoritative read fails', async () => {
    runtimeMocks.isNativeRuntime.mockReturnValue(true);
    nativeMocks.callNativeFirebaseFunction
      .mockRejectedValueOnce(callableError('cancelled'))
      .mockRejectedValueOnce(callableError('data-loss'))
      .mockRejectedValueOnce(callableError('unavailable'));

    await expect(linkGameYouTubeReplayForApp('team-1', 'game-1', replayVideo.publicUrl, {
      expectedRevision: 'revision-1',
      mutationId: 'mutation-1'
    })).rejects.toMatchObject({ code: 'replay-mutation-unconfirmed' });

    expect(nativeMocks.callNativeFirebaseFunction).toHaveBeenCalledTimes(3);
    expect(cacheMocks.invalidateCachedAppData).not.toHaveBeenCalled();
  });

  it('keeps an ambiguous response unresolved when the read cannot prove this mutation', async () => {
    const callable = vi
      .fn()
      .mockRejectedValueOnce(callableError('deadline-exceeded'))
      .mockRejectedValueOnce(callableError('unavailable'))
      .mockResolvedValueOnce({ data: { ...readyResponse, lastMutationId: 'another-mutation' } });
    adapterMocks.httpsCallable.mockReturnValue(callable);

    await expect(
      linkGameYouTubeReplayForApp('team-1', 'game-1', replayVideo.publicUrl, {
        expectedRevision: 'revision-1',
        mutationId: 'mutation-1'
      })
    ).rejects.toThrow('could not be confirmed');
    expect(cacheMocks.invalidateCachedAppData).not.toHaveBeenCalled();
  });

  it.each(['permission-denied', 'aborted'])(
    'does not retry the definitive %s failure',
    async (code) => {
    const callable = vi.fn().mockRejectedValue(callableError(code));
    adapterMocks.httpsCallable.mockReturnValue(callable);

    await expect(
      removeGameReplayForApp('team-1', 'game-1', {
        expectedRevision: 'revision-2',
        mutationId: 'mutation-1'
      })
    ).rejects.toMatchObject({ code: `functions/${code}` });
    expect(callable).toHaveBeenCalledTimes(1);
    }
  );

  it('removes through the callable without a direct SDK or REST write path', async () => {
    const callable = vi.fn().mockResolvedValue({ data: removedResponse });
    adapterMocks.httpsCallable.mockReturnValue(callable);

    const result = await removeGameReplayForApp('team-1', 'game-1', {
      expectedRevision: 'revision-2',
      mutationId: 'mutation-1'
    });

    expect(callable).toHaveBeenCalledWith({
      action: 'remove',
      teamId: 'team-1',
      gameId: 'game-1',
      expectedRevision: 'revision-2',
      mutationId: 'mutation-1'
    });
    expect(result).toMatchObject({ state: 'removed', hasRecordedReplay: false, replayVideo: null });
  });

  it('resolves playback transiently and does not touch app data caches', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { ...readyResponse, available: true } });
    adapterMocks.httpsCallable.mockReturnValue(callable);

    const result = await getGameReplayPlaybackForApp('team-1', 'game-1', 'season-1');

    expect(adapterMocks.httpsCallable).toHaveBeenCalledWith(adapterMocks.functions, 'getGameReplayPlayback');
    expect(callable).toHaveBeenCalledWith({ teamId: 'team-1', gameId: 'game-1', seasonId: 'season-1' });
    expect(result.available).toBe(true);
    expect(result.replayVideo?.publicUrl).toBe(replayVideo.publicUrl);
    expect(cacheMocks.invalidateCachedAppData).not.toHaveBeenCalled();
  });

  it.each([
    ['ready without a revision', { ...readyResponse, replayArchiveRevision: null }],
    ['removed without a revision', { ...removedResponse, replayArchiveRevision: null }],
    ['none with a revision', {
      state: 'none',
      hasRecordedReplay: false,
      replayArchiveRevision: 'unexpected-revision',
      replayVideo: null
    }],
    ['ready without a replay video', { ...readyResponse, replayVideo: null }],
    ['none with a replay video', {
      state: 'none',
      hasRecordedReplay: false,
      replayArchiveRevision: null,
      replayVideo
    }]
  ])('rejects a malformed management response: %s', async (_label, malformedResponse) => {
    adapterMocks.httpsCallable.mockReturnValue(vi.fn().mockResolvedValue({ data: malformedResponse }));

    await expect(readGameReplayArchiveForApp('team-1', 'game-1')).rejects.toThrow('response is invalid');
  });

  it('fails closed when secure randomness is unavailable', () => {
    const originalCrypto = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      expect(() => createReplayMutationId()).toThrow('Secure randomness is unavailable');
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto });
    }
  });
});
