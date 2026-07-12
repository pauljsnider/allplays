import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAppDataCache, invalidateCachedAppData, loadCachedAppData } from './appDataCache';

function installTestLocalStorage() {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => store.get(key) || null),
      setItem: vi.fn((key: string, value: string) => {
        store.set(key, String(value));
      }),
      removeItem: vi.fn((key: string) => {
        store.delete(key);
      }),
      key: vi.fn((index: number) => Array.from(store.keys())[index] || null),
      clear: vi.fn(() => {
        store.clear();
      }),
      get length() {
        return store.size;
      }
    }
  });
}

describe('invalidateCachedAppData', () => {
  beforeEach(() => {
    installTestLocalStorage();
    clearAppDataCache();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearAppDataCache();
  });

  it('re-runs the loader after invalidation instead of serving the cached value', async () => {
    const loader = vi.fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');

    const initial = await loadCachedAppData('unit-test:key', loader, { ttlMs: 60_000 });
    expect(initial).toBe('first');

    // Within TTL, the loader is not called again.
    const cached = await loadCachedAppData('unit-test:key', loader, { ttlMs: 60_000 });
    expect(cached).toBe('first');
    expect(loader).toHaveBeenCalledTimes(1);

    invalidateCachedAppData('unit-test:key');

    const refreshed = await loadCachedAppData('unit-test:key', loader, { ttlMs: 60_000 });
    expect(refreshed).toBe('second');
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('removes the persisted storage entry for the key', async () => {
    await loadCachedAppData('unit-test:persisted', () => Promise.resolve({ n: 1 }), { ttlMs: 60_000, persist: true });
    // The cache persisted one prefixed storage row.
    expect(window.localStorage.length).toBe(1);

    invalidateCachedAppData('unit-test:persisted');

    expect(window.localStorage.removeItem).toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });

  it('ignores an empty key', () => {
    expect(() => invalidateCachedAppData('')).not.toThrow();
  });
});
