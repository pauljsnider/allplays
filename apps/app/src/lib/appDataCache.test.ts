// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isActiveGameForLive, isCompletedGameForReplay } from './youtubeReplay';

const cacheKey = 'replay-lifecycle-non-finite';
const storageKey = `allplays:appDataCache:${encodeURIComponent(cacheKey)}`;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
});

describe('appDataCache shared write ordering', () => {
  it('keeps a newer unscoped result when it completes before an older scoped load', async () => {
    const cacheModule = await import('./appDataCache');
    const key = 'shared-write-newer-first';
    const storedKey = `allplays:appDataCache:${encodeURIComponent(key)}`;
    const older = deferred<string>();
    const newer = deferred<string>();
    const olderRefresh = vi.fn();
    const newerRefresh = vi.fn();

    const olderLoad = cacheModule.loadCachedAppData(key, () => older.promise, {
      force: true,
      inFlightScope: 'home-preview',
      onRefresh: olderRefresh
    });
    const newerLoad = cacheModule.loadCachedAppData(key, () => newer.promise, {
      force: true,
      onRefresh: newerRefresh
    });

    newer.resolve('newer');
    await expect(newerLoad).resolves.toBe('newer');
    older.resolve('older');
    await expect(olderLoad).resolves.toBe('older');

    expect(olderRefresh).toHaveBeenCalledWith('older');
    expect(newerRefresh).toHaveBeenCalledWith('newer');
    expect(cacheModule.getCachedAppData(key)).toBe('newer');
    expect(JSON.parse(window.localStorage.getItem(storedKey) || '{}').value).toBe('newer');
  });

  it('allows an older scoped result temporarily, then replaces it with the newer load', async () => {
    const cacheModule = await import('./appDataCache');
    const key = 'shared-write-older-first';
    const older = deferred<string>();
    const newer = deferred<string>();
    const olderLoad = cacheModule.loadCachedAppData(key, () => older.promise, {
      force: true,
      inFlightScope: 'home-preview'
    });
    const newerLoad = cacheModule.loadCachedAppData(key, () => newer.promise, { force: true });

    older.resolve('older');
    await expect(olderLoad).resolves.toBe('older');
    expect(cacheModule.getCachedAppData(key)).toBe('older');
    newer.resolve('newer');
    await expect(newerLoad).resolves.toBe('newer');
    expect(cacheModule.getCachedAppData(key)).toBe('newer');
  });

  it('does not repopulate memory or persisted data after overlapping loads are invalidated', async () => {
    const cacheModule = await import('./appDataCache');
    const key = 'shared-write-invalidated';
    const storedKey = `allplays:appDataCache:${encodeURIComponent(key)}`;
    const scoped = deferred<string>();
    const unscoped = deferred<string>();
    const scopedRefresh = vi.fn();
    const unscopedRefresh = vi.fn();
    const scopedLoad = cacheModule.loadCachedAppData(key, () => scoped.promise, {
      force: true,
      inFlightScope: 'home-preview',
      onRefresh: scopedRefresh
    });
    const unscopedLoad = cacheModule.loadCachedAppData(key, () => unscoped.promise, {
      force: true,
      onRefresh: unscopedRefresh
    });

    cacheModule.invalidateCachedAppData(key);
    unscoped.resolve('newer');
    scoped.resolve('older');
    await expect(unscopedLoad).resolves.toBe('newer');
    await expect(scopedLoad).resolves.toBe('older');

    expect(scopedRefresh).toHaveBeenCalledWith('older');
    expect(unscopedRefresh).toHaveBeenCalledWith('newer');
    expect(cacheModule.getCachedAppData(key)).toBeNull();
    expect(window.localStorage.getItem(storedKey)).toBeNull();
  });

  it.each(['partial', 'error'] as const)(
    'retains the successful scoped result when a newer load ends in %s',
    async (outcome) => {
      const cacheModule = await import('./appDataCache');
      const key = `shared-write-${outcome}`;
      const successful = deferred<string>();
      const newer = deferred<string>();
      const successfulLoad = cacheModule.loadCachedAppData(key, () => successful.promise, {
        force: true,
        inFlightScope: 'home-preview'
      });
      const newerLoad = cacheModule.loadCachedAppData(key, () => newer.promise, {
        force: true,
        shouldCache: (value) => value !== 'partial'
      });

      if (outcome === 'partial') {
        newer.resolve('partial');
        await expect(newerLoad).resolves.toBe('partial');
      } else {
        newer.reject(new Error('refresh failed'));
        await expect(newerLoad).rejects.toThrow('refresh failed');
      }
      successful.resolve('successful');
      await expect(successfulLoad).resolves.toBe('successful');
      expect(cacheModule.getCachedAppData(key)).toBe('successful');
    }
  );

  it.each([
    ['successful-first', 'partial'],
    ['successful-first', 'error'],
    ['newer-first', 'partial'],
    ['newer-first', 'error']
  ] as const)(
    'commits an older successful forced load in the same scope (%s, newer %s)',
    async (completionOrder, newerOutcome) => {
      const cacheModule = await import('./appDataCache');
      const key = `same-scope-${completionOrder}-${newerOutcome}`;
      const storedKey = `allplays:appDataCache:${encodeURIComponent(key)}`;
      await cacheModule.loadCachedAppData(key, async () => 'stale');
      const successful = deferred<string>();
      const newer = deferred<string>();
      const successfulLoad = cacheModule.loadCachedAppData(key, () => successful.promise, {
        force: true,
        inFlightScope: 'home-preview'
      });
      const newerLoad = cacheModule.loadCachedAppData(key, () => newer.promise, {
        force: true,
        inFlightScope: 'home-preview',
        shouldCache: (value) => value !== 'partial'
      });

      const finishSuccessful = async () => {
        successful.resolve('successful');
        await expect(successfulLoad).resolves.toBe('successful');
      };
      const finishNewer = async () => {
        if (newerOutcome === 'partial') {
          newer.resolve('partial');
          await expect(newerLoad).resolves.toBe('partial');
        } else {
          newer.reject(new Error('refresh failed'));
          await expect(newerLoad).rejects.toThrow('refresh failed');
        }
      };

      if (completionOrder === 'successful-first') {
        await finishSuccessful();
        await finishNewer();
      } else {
        await finishNewer();
        await finishSuccessful();
      }

      expect(cacheModule.getCachedAppData(key)).toBe('successful');
      expect(JSON.parse(window.localStorage.getItem(storedKey) || '{}').value).toBe('successful');
    }
  );
});

describe('appDataCache replay lifecycle fidelity', () => {
  it('preserves non-finite Firestore numbers so cached lifecycle checks stay fail-closed', async () => {
    const firstModule = await import('./appDataCache');
    await firstModule.loadCachedAppData(cacheKey, async () => ({
      events: [
        { rawReplayLifecycle: { type: 'game', status: Number.NaN, liveStatus: 'completed' } },
        { rawReplayLifecycle: { type: 'game', status: Number.POSITIVE_INFINITY, liveStatus: 'live' } },
        { rawReplayLifecycle: { type: Number.NEGATIVE_INFINITY, status: 'scheduled', liveStatus: 'live' } }
      ]
    }), { ttlMs: 60_000 });

    const stored = window.localStorage.getItem(storageKey);
    expect(stored).toContain('NonFiniteNumber');
    expect(stored).toContain('"version":2');

    vi.resetModules();
    const reloadedModule = await import('./appDataCache');
    const cached = reloadedModule.getCachedAppData<{
      events: Array<{ rawReplayLifecycle: Record<string, unknown> }>;
    }>(cacheKey);

    expect(Number.isNaN(cached?.events[0].rawReplayLifecycle.status)).toBe(true);
    expect(cached?.events[1].rawReplayLifecycle.status).toBe(Number.POSITIVE_INFINITY);
    expect(cached?.events[2].rawReplayLifecycle.type).toBe(Number.NEGATIVE_INFINITY);
    expect(isCompletedGameForReplay({
      isDbGame: true,
      rawReplayLifecycle: cached?.events[0].rawReplayLifecycle
    })).toBe(false);
    expect(isActiveGameForLive({
      isDbGame: true,
      rawReplayLifecycle: cached?.events[1].rawReplayLifecycle
    })).toBe(false);
    expect(isActiveGameForLive({
      isDbGame: true,
      rawReplayLifecycle: cached?.events[2].rawReplayLifecycle
    })).toBe(false);
  });

  it('discards version-one entries that may have collapsed non-finite lifecycle values', async () => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      value: {
        events: [{ rawReplayLifecycle: { type: 'game', status: null, liveStatus: 'completed' } }]
      },
      expiresAt: Date.now() + 60_000
    }));

    const cacheModule = await import('./appDataCache');
    expect(cacheModule.getCachedAppData(cacheKey)).toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });
});
