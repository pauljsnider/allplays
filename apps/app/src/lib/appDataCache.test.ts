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
    expect(stored).toContain('"version":3');

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

  it.each([1, 2])('discards version-%s entries that may retain stale replay capabilities', async (version) => {
    window.localStorage.setItem(storageKey, JSON.stringify({
      version,
      value: {
        events: [{ rawReplayLifecycle: { type: 'game', status: null, liveStatus: 'completed' } }]
      },
      expiresAt: Date.now() + 60_000
    }));

    const cacheModule = await import('./appDataCache');
    expect(cacheModule.getCachedAppData(cacheKey)).toBeNull();
    expect(window.localStorage.getItem(storageKey)).toBeNull();
  });

  it('strips replay identities and URLs from both memory and persisted schedule cache rows', async () => {
    const cacheModule = await import('./appDataCache');
    const loaded = await cacheModule.loadCachedAppData(cacheKey, async () => ({
      events: [{
        id: 'game-1',
        eventKey: 'team-1::game-1::player-1',
        type: 'game',
        date: new Date('2026-08-29T18:00:00.000Z'),
        videoUrl: 'https://youtu.be/PK1HyC37doc',
        replayVideo: {
          provider: 'youtube',
          videoId: 'PK1HyC37doc',
          publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
          linkedBy: 'private-user'
        },
        rawReplayState: {
          replayVideoPublicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc'
        },
        hasRecordedReplay: true,
        hasReplayVideo: true,
        replayArchiveRevision: 'opaque-revision',
        replayArchiveState: 'ready'
      }]
    }), { ttlMs: 60_000 });

    expect(loaded.events[0]).toEqual(expect.objectContaining({
      hasRecordedReplay: true,
      hasReplayVideo: true,
      replayArchiveRevision: 'opaque-revision',
      replayArchiveState: 'ready'
    }));
    expect(loaded.events[0]).not.toHaveProperty('replayVideo');
    expect(loaded.events[0]).not.toHaveProperty('rawReplayState');
    expect(loaded.events[0]).not.toHaveProperty('videoUrl');
    const stored = window.localStorage.getItem(storageKey) || '';
    expect(stored).toContain('opaque-revision');
    expect(stored).not.toContain('PK1HyC37doc');
    expect(stored).not.toContain('private-user');
    expect(stored).not.toContain('youtube.com');
  });

  it('preserves safe loaded object identity when no replay capability needs scrubbing', async () => {
    const cacheModule = await import('./appDataCache');
    const safeValue = {
      events: [{
        id: 'game-1',
        eventKey: 'team-1::game-1::player-1',
        type: 'game',
        date: new Date('2026-08-29T18:00:00.000Z'),
        hasRecordedReplay: true,
        replayArchiveRevision: 'opaque-revision'
      }]
    };

    const loaded = await cacheModule.loadCachedAppData(cacheKey, async () => safeValue, { ttlMs: 60_000 });

    expect(loaded).toBe(safeValue);
  });
});
