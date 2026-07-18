// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  isNativeRuntime: vi.fn()
}));

const secureStorageMocks = vi.hoisted(() => ({
  getNativeSecureItem: vi.fn(),
  setNativeSecureItem: vi.fn(),
  removeNativeSecureItem: vi.fn()
}));

vi.mock('./nativeRuntime', () => runtimeMocks);
vi.mock('./nativeSecureStorage', () => secureStorageMocks);
vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

const session = {
  apiKey: 'secondary-image-project-key',
  idToken: 'secondary-image-id-token',
  refreshToken: 'secondary-image-refresh-token',
  expirationTime: Date.now() + 3_600_000
};

async function loadStore() {
  vi.resetModules();
  return import('./imageUploadSessionStore');
}

describe('imageUploadSessionStore', () => {
  beforeEach(() => {
    installStorage('localStorage');
    installStorage('sessionStorage');
    runtimeMocks.isNativeRuntime.mockReset().mockReturnValue(false);
    secureStorageMocks.getNativeSecureItem.mockReset().mockResolvedValue(null);
    secureStorageMocks.setNativeSecureItem.mockReset().mockResolvedValue(undefined);
    secureStorageMocks.removeNativeSecureItem.mockReset().mockResolvedValue(undefined);
  });

  it('migrates a legacy web credential from localStorage to sessionStorage and removes the source', async () => {
    window.localStorage.setItem('allplays-image-upload-session', JSON.stringify(session));
    const store = await loadStore();

    await expect(store.readImageUploadSession()).resolves.toEqual(session);

    expect(window.localStorage.getItem('allplays-image-upload-session')).toBeNull();
    expect(window.sessionStorage.getItem('allplays-image-upload-session')).toBe(JSON.stringify(session));
    expect(secureStorageMocks.setNativeSecureItem).not.toHaveBeenCalled();

    const reloadedStore = await loadStore();
    await expect(reloadedStore.readImageUploadSession()).resolves.toEqual(session);
  });

  it('keeps a migrated web credential memory-only when sessionStorage is unavailable', async () => {
    window.localStorage.setItem('allplays-image-upload-session', JSON.stringify(session));
    vi.mocked(window.sessionStorage.setItem).mockImplementation(() => {
      throw new Error('session storage disabled');
    });
    const store = await loadStore();

    await expect(store.readImageUploadSession()).resolves.toEqual(session);
    expect(window.localStorage.getItem('allplays-image-upload-session')).toBeNull();
    expect(window.sessionStorage.getItem('allplays-image-upload-session')).toBeNull();
  });

  it('migrates a native legacy credential into OS secure storage and clears all WebView copies', async () => {
    runtimeMocks.isNativeRuntime.mockReturnValue(true);
    window.localStorage.setItem('allplays-image-upload-session', JSON.stringify(session));
    window.sessionStorage.setItem('allplays-image-upload-session', JSON.stringify(session));
    const store = await loadStore();

    await expect(store.readImageUploadSession()).resolves.toEqual(session);

    expect(secureStorageMocks.removeNativeSecureItem).toHaveBeenCalledWith('image-upload-auth-session-v2');
    expect(secureStorageMocks.setNativeSecureItem).toHaveBeenCalledWith('image-upload-auth-session-v2', JSON.stringify(session));
    expect(window.localStorage.getItem('allplays-image-upload-session')).toBeNull();
    expect(window.sessionStorage.getItem('allplays-image-upload-session')).toBeNull();
  });

  it('fails a native legacy restore closed when secure storage is unavailable', async () => {
    runtimeMocks.isNativeRuntime.mockReturnValue(true);
    window.localStorage.setItem('allplays-image-upload-session', JSON.stringify(session));
    secureStorageMocks.getNativeSecureItem.mockRejectedValue(new Error('keychain unavailable'));
    const store = await loadStore();

    await expect(store.readImageUploadSession()).resolves.toBeNull();

    expect(window.localStorage.getItem('allplays-image-upload-session')).toBeNull();
    expect(window.sessionStorage.getItem('allplays-image-upload-session')).toBeNull();
    expect(secureStorageMocks.setNativeSecureItem).not.toHaveBeenCalled();
  });

  it('uses memory only after a native secure write failure and tombstones any stale encrypted value', async () => {
    runtimeMocks.isNativeRuntime.mockReturnValue(true);
    secureStorageMocks.setNativeSecureItem.mockRejectedValue(new Error('device locked'));
    const store = await loadStore();

    await expect(store.writeImageUploadSession(session)).resolves.toBe(false);
    await expect(store.readImageUploadSession()).resolves.toEqual(session);
    expect(window.localStorage.getItem('allplays-image-upload-session')).toBeNull();
    expect(window.sessionStorage.getItem('allplays-image-upload-session')).toBeNull();
    expect(window.localStorage.getItem('allplays-image-upload-session-cleared-v2')).toBe('1');

    secureStorageMocks.removeNativeSecureItem.mockResolvedValue(undefined);
    secureStorageMocks.getNativeSecureItem.mockResolvedValue(JSON.stringify(session));
    const reloadedStore = await loadStore();
    await expect(reloadedStore.readImageUploadSession()).resolves.toBeNull();
    expect(secureStorageMocks.getNativeSecureItem).not.toHaveBeenCalled();
  });

  it('keeps a non-secret tombstone when native deletion fails so an expired credential cannot restore', async () => {
    runtimeMocks.isNativeRuntime.mockReturnValue(true);
    secureStorageMocks.removeNativeSecureItem.mockRejectedValue(new Error('keychain locked'));
    const store = await loadStore();

    await store.clearImageUploadSession();

    expect(window.localStorage.getItem('allplays-image-upload-session-cleared-v2')).toBe('1');
    expect(window.localStorage.getItem('allplays-image-upload-session')).toBeNull();
    expect(window.sessionStorage.getItem('allplays-image-upload-session')).toBeNull();
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
