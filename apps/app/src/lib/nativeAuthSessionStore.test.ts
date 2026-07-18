// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStorageMocks = vi.hoisted(() => ({
  getNativeSecureItem: vi.fn(),
  setNativeSecureItem: vi.fn(),
  removeNativeSecureItem: vi.fn(),
  removeNativeSecureItemEventually: vi.fn()
}));

vi.mock('./nativeRuntime', () => ({
  isNativeRuntime: () => true
}));

vi.mock('./nativeSecureStorage', () => secureStorageMocks);

vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })
}));

const session = {
  uid: 'user-1',
  email: 'parent@example.com',
  idToken: 'signed-id-token',
  refreshToken: 'rotating-refresh-token',
  expirationTime: Date.now() + 3_600_000,
  apiKey: 'public-firebase-key',
  provider: 'rest' as const
};

async function loadStore() {
  vi.resetModules();
  return import('./nativeAuthSessionStore');
}

describe('nativeAuthSessionStore', () => {
  beforeEach(() => {
    installLocalStorage();
    secureStorageMocks.getNativeSecureItem.mockReset();
    secureStorageMocks.setNativeSecureItem.mockReset();
    secureStorageMocks.removeNativeSecureItem.mockReset();
    secureStorageMocks.removeNativeSecureItemEventually.mockReset();
    secureStorageMocks.getNativeSecureItem.mockResolvedValue(null);
    secureStorageMocks.setNativeSecureItem.mockResolvedValue(undefined);
    secureStorageMocks.removeNativeSecureItem.mockResolvedValue(undefined);
    secureStorageMocks.removeNativeSecureItemEventually.mockResolvedValue(undefined);
  });

  it('restores an encrypted session without writing credentials to localStorage', async () => {
    secureStorageMocks.getNativeSecureItem.mockResolvedValue(JSON.stringify(session));
    const store = await loadStore();

    await expect(store.readNativeAuthSession()).resolves.toEqual(session);

    expect(secureStorageMocks.getNativeSecureItem).toHaveBeenCalledWith('native-auth-session-v2');
    expect(window.localStorage.getItem('allplays-native-auth-session')).toBeNull();
  });

  it('migrates a valid legacy plaintext session once and removes the source', async () => {
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify(session));
    const store = await loadStore();

    await expect(store.readNativeAuthSession()).resolves.toEqual(session);

    expect(secureStorageMocks.setNativeSecureItem).toHaveBeenCalledWith(
      'native-auth-session-v2',
      JSON.stringify(session)
    );
    expect(window.localStorage.getItem('allplays-native-auth-session')).toBeNull();
  });

  it('fails restored sessions closed when secure storage is unavailable', async () => {
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify(session));
    secureStorageMocks.getNativeSecureItem.mockRejectedValue(new Error('keystore unavailable'));
    const store = await loadStore();

    await expect(store.readNativeAuthSession()).resolves.toBeNull();

    expect(window.localStorage.getItem('allplays-native-auth-session')).toBeNull();
    expect(secureStorageMocks.setNativeSecureItem).not.toHaveBeenCalled();
  });

  it('keeps a fresh sign-in memory-only when a secure write fails and requires reauthentication next launch', async () => {
    secureStorageMocks.setNativeSecureItem.mockRejectedValue(new Error('device locked'));
    const firstStore = await loadStore();

    await expect(firstStore.writeNativeAuthSession(session)).resolves.toBe(false);
    await expect(firstStore.readNativeAuthSession()).resolves.toEqual(session);
    expect(window.localStorage.getItem('allplays-native-auth-session')).toBeNull();

    secureStorageMocks.getNativeSecureItem.mockRejectedValue(new Error('device locked'));
    const reloadedStore = await loadStore();
    await expect(reloadedStore.readNativeAuthSession()).resolves.toBeNull();
  });

  it('clears encrypted and legacy session copies idempotently', async () => {
    window.localStorage.setItem('allplays-native-auth-session', JSON.stringify(session));
    const store = await loadStore();

    await store.clearNativeAuthSession();
    await store.clearNativeAuthSession();

    expect(window.localStorage.getItem('allplays-native-auth-session')).toBeNull();
    expect(secureStorageMocks.removeNativeSecureItemEventually).toHaveBeenCalledTimes(2);
    await expect(store.readNativeAuthSession()).resolves.toBeNull();
  });

  it('keeps the tombstone until an uncancelled removal behind a late secure write finishes', async () => {
    const removal = createDeferred<void>();
    secureStorageMocks.removeNativeSecureItemEventually.mockReturnValueOnce(removal.promise);
    const store = await loadStore();

    const cleanup = store.clearNativeAuthSession();
    await Promise.resolve();

    expect(secureStorageMocks.removeNativeSecureItemEventually)
      .toHaveBeenCalledWith('native-auth-session-v2');
    expect(secureStorageMocks.removeNativeSecureItem).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('allplays-native-auth-signed-out-v2')).toBe('1');

    removal.resolve();
    await cleanup;
    expect(window.localStorage.getItem('allplays-native-auth-signed-out-v2')).toBeNull();
  });

  it('keeps a non-secret sign-out tombstone when encrypted deletion fails so a stale token cannot restore', async () => {
    secureStorageMocks.removeNativeSecureItemEventually.mockRejectedValue(new Error('keychain locked'));
    const store = await loadStore();

    await store.clearNativeAuthSession();

    expect(window.localStorage.getItem('allplays-native-auth-signed-out-v2')).toBe('1');
    secureStorageMocks.getNativeSecureItem.mockResolvedValue(JSON.stringify(session));
    const reloadedStore = await loadStore();
    await expect(reloadedStore.readNativeAuthSession()).resolves.toBeNull();
    expect(window.localStorage.getItem('allplays-native-auth-session')).toBeNull();
  });
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installLocalStorage() {
  const records = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => records.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => records.set(key, String(value))),
      removeItem: vi.fn((key: string) => records.delete(key)),
      clear: vi.fn(() => records.clear())
    }
  });
}
