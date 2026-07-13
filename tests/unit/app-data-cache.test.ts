// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheModulePath = '../../apps/app/src/lib/appDataCache.ts';
const cacheSource = readFileSync(`${process.cwd()}/apps/app/src/lib/appDataCache.ts`, 'utf8');

async function loadCacheModule() {
  return import(cacheModulePath);
}

describe('appDataCache', () => {
  let localStorageMock: Storage & {
    removeItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorageMock = installLocalStorageMock();
    vi.resetModules();
  });

  it('deduplicates concurrent loads for the same key', async () => {
    const cache = await loadCacheModule();
    let resolveLoader: ((value: { ok: boolean }) => void) | null = null;
    const loader = vi.fn(() => new Promise<{ ok: boolean }>((resolve) => {
      resolveLoader = resolve;
    }));

    const first = cache.loadCachedAppData('dedup:key', loader);
    const second = cache.loadCachedAppData('dedup:key', loader);

    expect(second).toBe(first);
    expect(loader).toHaveBeenCalledTimes(1);

    resolveLoader?.({ ok: true });
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
  });

  it('does not repopulate memory or storage when an in-flight load resolves after cache clear', async () => {
    const cache = await loadCacheModule();
    let resolveLoader: ((value: { userId: string }) => void) | null = null;
    const loader = vi.fn(() => new Promise<{ userId: string }>((resolve) => {
      resolveLoader = resolve;
    }));

    const load = cache.loadCachedAppData('signed-out:key', loader);
    cache.clearAppDataCache();
    resolveLoader?.({ userId: 'previous-user' });

    await expect(load).resolves.toEqual({ userId: 'previous-user' });
    expect(cache.getCachedAppData('signed-out:key')).toBeNull();
    expect(window.localStorage.getItem('allplays:appDataCache:signed-out%3Akey')).toBeNull();
  });

  it('caches falsy values until their TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T12:00:00Z'));
    const cache = await loadCacheModule();
    const loader = vi.fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(false);

    await expect(cache.loadCachedAppData('falsy:key', loader, { ttlMs: 1000 })).resolves.toBe(0);
    expect(cache.getCachedAppData('falsy:key')).toBe(0);

    vi.setSystemTime(new Date('2026-06-12T12:00:02Z'));

    expect(cache.getCachedAppData('falsy:key')).toBeNull();
    await expect(cache.loadCachedAppData('falsy:key', loader, { ttlMs: 1000, staleWhileRevalidate: false })).resolves.toBe(false);
    expect(cache.getCachedAppData('falsy:key')).toBe(false);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('hydrates persisted data after a module reload and preserves Dates', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T12:00:00Z'));
    const firstCache = await loadCacheModule();

    await firstCache.loadCachedAppData(
      'persisted:key',
      async () => ({ count: 1, startsAt: new Date('2026-06-12T18:30:00Z') }),
      { ttlMs: 60_000 }
    );

    vi.resetModules();
    const secondCache = await loadCacheModule();
    const cached = secondCache.getCachedAppData<{ count: number; startsAt: Date }>('persisted:key');

    expect(cached?.count).toBe(1);
    expect(cached?.startsAt).toBeInstanceOf(Date);
    expect(cached?.startsAt.toISOString()).toBe('2026-06-12T18:30:00.000Z');
  });

  it('awaits a fresh loader result when a hydrated entry is stale by default', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T12:00:00Z'));
    const firstCache = await loadCacheModule();
    await firstCache.loadCachedAppData('stale:key', async () => ({ version: 1 }), { ttlMs: 1000 });

    vi.setSystemTime(new Date('2026-06-12T12:00:02Z'));
    vi.resetModules();
    const secondCache = await loadCacheModule();
    const loader = vi.fn().mockResolvedValue({ version: 2 });

    await expect(secondCache.loadCachedAppData('stale:key', loader, { ttlMs: 1000 })).resolves.toEqual({ version: 2 });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(secondCache.getCachedAppData('stale:key')).toEqual({ version: 2 });
  });

  it('returns stale hydrated data immediately only when stale-while-revalidate is enabled', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-12T12:00:00Z'));
    const firstCache = await loadCacheModule();
    await firstCache.loadCachedAppData('stale:key', async () => ({ version: 1 }), { ttlMs: 1000 });

    vi.setSystemTime(new Date('2026-06-12T12:00:02Z'));
    vi.resetModules();
    const secondCache = await loadCacheModule();
    const loader = vi.fn().mockResolvedValue({ version: 2 });
    const onRefresh = vi.fn();

    await expect(secondCache.loadCachedAppData('stale:key', loader, { ttlMs: 1000, staleWhileRevalidate: true, onRefresh })).resolves.toEqual({ version: 1 });
    expect(loader).toHaveBeenCalledTimes(1);

    await Promise.resolve();
    await Promise.resolve();

    expect(onRefresh).toHaveBeenCalledWith({ version: 2 });
    expect(secondCache.getCachedAppData('stale:key')).toEqual({ version: 2 });
  });

  it('falls back to memory cache when storage persistence fails', async () => {
    const cache = await loadCacheModule();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorageMock.setItem.mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    await expect(cache.loadCachedAppData('quota:key', async () => ({ ok: true }))).resolves.toEqual({ ok: true });

    expect(cache.getCachedAppData('quota:key')).toEqual({ ok: true });
  });

  it('clears matching persisted entries by prefix', async () => {
    const firstCache = await loadCacheModule();
    await firstCache.loadCachedAppData('team:a', async () => ({ team: 'a' }));
    await firstCache.loadCachedAppData('user:b', async () => ({ user: 'b' }));
    firstCache.clearAppDataCache('team:');

    vi.resetModules();
    const secondCache = await loadCacheModule();

    expect(secondCache.getCachedAppData('team:a')).toBeNull();
    expect(secondCache.getCachedAppData('user:b')).toEqual({ user: 'b' });
  });

  it('invalidates one cached key in memory and persisted storage', async () => {
    const firstCache = await loadCacheModule();
    const loader = vi.fn()
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ version: 2 });

    await firstCache.loadCachedAppData('schedule:key', loader, { ttlMs: 60_000 });
    await firstCache.loadCachedAppData('other:key', async () => ({ other: true }), { ttlMs: 60_000 });

    firstCache.invalidateCachedAppData('schedule:key');

    expect(firstCache.getCachedAppData('schedule:key')).toBeNull();
    expect(window.localStorage.getItem('allplays:appDataCache:schedule%3Akey')).toBeNull();
    expect(window.localStorage.getItem('allplays:appDataCache:other%3Akey')).toContain('other');
    await expect(firstCache.loadCachedAppData('schedule:key', loader, { ttlMs: 60_000 })).resolves.toEqual({ version: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keeps cache invalidation best-effort when storage removal fails', async () => {
    const cache = await loadCacheModule();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = vi.fn()
      .mockResolvedValueOnce({ version: 1 })
      .mockResolvedValueOnce({ version: 2 });

    await cache.loadCachedAppData('schedule:key', loader, { ttlMs: 60_000 });
    localStorageMock.removeItem.mockImplementation(() => {
      throw new DOMException('Storage disabled', 'SecurityError');
    });

    expect(() => cache.invalidateCachedAppData('schedule:key')).not.toThrow();
    expect(cache.getCachedAppData('schedule:key')).toBeNull();
    await expect(cache.loadCachedAppData('schedule:key', loader, { ttlMs: 60_000 })).resolves.toEqual({ version: 2 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('prevents an invalidated in-flight key from repopulating without dropping unrelated loads', async () => {
    const cache = await loadCacheModule();
    let resolveSchedule: ((value: { schedule: string }) => void) | null = null;
    let resolveOther: ((value: { other: string }) => void) | null = null;
    const scheduleLoad = cache.loadCachedAppData('schedule:key', () => new Promise((resolve) => {
      resolveSchedule = resolve;
    }));
    const otherLoad = cache.loadCachedAppData('other:key', () => new Promise((resolve) => {
      resolveOther = resolve;
    }));

    cache.invalidateCachedAppData('schedule:key');
    resolveSchedule?.({ schedule: 'stale' });
    resolveOther?.({ other: 'fresh' });

    await expect(scheduleLoad).resolves.toEqual({ schedule: 'stale' });
    await expect(otherLoad).resolves.toEqual({ other: 'fresh' });
    expect(cache.getCachedAppData('schedule:key')).toBeNull();
    expect(cache.getCachedAppData('other:key')).toEqual({ other: 'fresh' });
    expect(window.localStorage.getItem('allplays:appDataCache:schedule%3Akey')).toBeNull();
    expect(window.localStorage.getItem('allplays:appDataCache:other%3Akey')).toContain('fresh');
  });

  it('uses one shared key for parent schedule summaries across pages', async () => {
    const cache = await loadCacheModule();

    expect(cache.getParentScheduleSummaryCacheKey('parent-1')).toBe('app-schedule-summary:parent-1');
    expect(cache.getParentHomeSecondaryCacheKey('parent-1')).toBe('home-secondary:parent-1');
  });

  it('routes handled cache failures through the shared logger', () => {
    expect(cacheSource).toContain("from './logger'");
    expect(cacheSource).not.toContain('console.');
  });
});

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const storage = {
    get length() {
      return store.size;
    },
    clear: vi.fn(() => {
      store.clear();
    }),
    getItem: vi.fn((key: string) => store.get(String(key)) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(String(key));
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(String(key), String(value));
    })
  } as unknown as Storage & { setItem: ReturnType<typeof vi.fn> };

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: storage
  });

  return storage;
}
