// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const cacheModulePath = '../../apps/app/src/lib/appDataCache.ts';

async function loadCacheModule() {
  return import(cacheModulePath);
}

describe('appDataCache', () => {
  let localStorageMock: Storage & {
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

  it('uses one shared key for parent schedule summaries across pages', async () => {
    const cache = await loadCacheModule();

    expect(cache.getParentScheduleSummaryCacheKey('parent-1')).toBe('app-schedule-summary:parent-1');
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
