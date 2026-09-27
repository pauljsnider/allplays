// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { isActiveGameForLive, isCompletedGameForReplay } from './youtubeReplay';

const cacheKey = 'replay-lifecycle-non-finite';
const storageKey = `allplays:appDataCache:${encodeURIComponent(cacheKey)}`;

afterEach(() => {
  window.localStorage.clear();
  vi.resetModules();
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
