// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStorageMocks = vi.hoisted(() => {
  const records = new Map<string, string>();
  return {
    records,
    getNativeSecureItem: vi.fn(async (key: string) => records.get(key) ?? null),
    setNativeSecureItem: vi.fn(async (key: string, value: string) => {
      records.set(key, value);
    }),
    removeNativeSecureItem: vi.fn(async (key: string) => {
      records.delete(key);
    }),
    listNativeSecureKeys: vi.fn(async () => Array.from(records.keys()))
  };
});

vi.mock('./nativeRuntime', () => ({ isNativeRuntime: () => true }));
vi.mock('./nativeSecureStorage', () => secureStorageMocks);
vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

async function loadCache() {
  vi.resetModules();
  return import('./appDataCache');
}

describe('appDataCache native encrypted persistence', () => {
  beforeEach(() => {
    secureStorageMocks.records.clear();
    vi.clearAllMocks();
    installStorage('localStorage');
    installStorage('sessionStorage');
  });

  it('hydrates encrypted schedule data before first use and keeps WebView storage empty', async () => {
    secureStorageMocks.records.set('app-data-cache:app-schedule-summary%3Auser-1', JSON.stringify({
      version: 1,
      value: { events: [{ id: 'game-1' }] },
      expiresAt: Date.now() + 60_000
    }));
    const cache = await loadCache();

    await cache.initializeAppDataCachePersistence();

    expect(cache.getCachedAppData('app-schedule-summary:user-1')).toEqual({ events: [{ id: 'game-1' }] });
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('persists home and fee cache values only through native secure storage', async () => {
    const cache = await loadCache();
    await cache.initializeAppDataCachePersistence();

    await cache.loadCachedAppData('home-secondary:user-1', async () => ({
      fees: [{ id: 'fee-1', balance: 25 }]
    }));
    await cache.flushAppDataCachePersistence();

    expect(secureStorageMocks.setNativeSecureItem).toHaveBeenCalledWith(
      'app-data-cache:home-secondary%3Auser-1',
      expect.stringContaining('fee-1')
    );
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('migrates and deletes legacy plaintext cache values without overwriting a newer encrypted value', async () => {
    const storageKey = 'allplays:appDataCache:home-secondary%3Auser-1';
    window.localStorage.setItem(storageKey, JSON.stringify({
      version: 1,
      value: { source: 'legacy' },
      expiresAt: Date.now() + 60_000
    }));
    secureStorageMocks.records.set('app-data-cache:home-secondary%3Auser-1', JSON.stringify({
      version: 1,
      value: { source: 'encrypted' },
      expiresAt: Date.now() + 60_000
    }));
    const cache = await loadCache();

    await cache.initializeAppDataCachePersistence();

    expect(window.localStorage.getItem(storageKey)).toBeNull();
    expect(cache.getCachedAppData('home-secondary:user-1')).toEqual({ source: 'encrypted' });
  });

  it('flushes encrypted removals before sign-out completes', async () => {
    secureStorageMocks.records.set('app-data-cache:home-secondary%3Auser-1', JSON.stringify({
      version: 1,
      value: { fees: [] },
      expiresAt: Date.now() + 60_000
    }));
    const cache = await loadCache();
    await cache.initializeAppDataCachePersistence();

    cache.clearAppDataCache();
    await cache.flushAppDataCachePersistence();

    expect(secureStorageMocks.records.size).toBe(0);
  });
});

function installStorage(name: 'localStorage' | 'sessionStorage') {
  const records = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      get length() {
        return records.size;
      },
      clear: vi.fn(() => records.clear()),
      getItem: vi.fn((key: string) => records.get(key) ?? null),
      key: vi.fn((index: number) => Array.from(records.keys())[index] ?? null),
      removeItem: vi.fn((key: string) => records.delete(key)),
      setItem: vi.fn((key: string, value: string) => records.set(key, String(value)))
    }
  });
}
