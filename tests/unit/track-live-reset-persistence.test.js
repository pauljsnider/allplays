import { describe, it, expect, vi } from 'vitest';
import { runTrackLiveResetPersistence } from '../../js/track-live-state.js';

describe('track live reset persistence orchestration', () => {
  it('runs publish, update, then cleanup in order', async () => {
    const calls = [];

    await runTrackLiveResetPersistence({
      publishResetEvent: async () => { calls.push('publish'); },
      updateResetState: async () => { calls.push('update'); },
      cleanupPersistedState: async () => { calls.push('cleanup'); }
    });

    expect(calls).toEqual(['publish', 'update', 'cleanup']);
  });

  it('continues when publishing reset event fails', async () => {
    const calls = [];
    const logWarn = vi.fn();

    await runTrackLiveResetPersistence({
      publishResetEvent: async () => {
        calls.push('publish');
        throw new Error('permission denied');
      },
      updateResetState: async () => { calls.push('update'); },
      cleanupPersistedState: async () => { calls.push('cleanup'); },
      logWarn
    });

    expect(calls).toEqual(['publish', 'update', 'cleanup']);
    expect(logWarn).toHaveBeenCalledWith('Failed to publish reset event:', expect.any(Error));
  });

  it('continues cleanup when reset state update fails', async () => {
    const calls = [];
    const logError = vi.fn();

    await runTrackLiveResetPersistence({
      publishResetEvent: async () => { calls.push('publish'); },
      updateResetState: async () => {
        calls.push('update');
        throw new Error('missing permissions');
      },
      cleanupPersistedState: async () => { calls.push('cleanup'); },
      logError
    });

    expect(calls).toEqual(['publish', 'update', 'cleanup']);
    expect(logError).toHaveBeenCalledWith('Error updating game reset state:', expect.any(Error));
  });

  it('logs cleanup failures without throwing', async () => {
    const logWarn = vi.fn();

    await expect(runTrackLiveResetPersistence({
      publishResetEvent: async () => {},
      updateResetState: async () => {},
      cleanupPersistedState: async () => {
        throw new Error('delete blocked');
      },
      logWarn
    })).resolves.toBeUndefined();

    expect(logWarn).toHaveBeenCalledWith('Failed to clear persisted tracking records during reset:', expect.any(Error));
  });

  it('is safe when callbacks are omitted', async () => {
    await expect(runTrackLiveResetPersistence()).resolves.toBeUndefined();
  });
});
