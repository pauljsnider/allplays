// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const capacitorState = vi.hoisted(() => ({ available: true }));
const secureStorageMocks = vi.hoisted(() => ({
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  keys: vi.fn(),
  setSynchronize: vi.fn(),
  setDefaultKeychainAccess: vi.fn(),
  setKeyPrefix: vi.fn()
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    isPluginAvailable: () => capacitorState.available
  }
}));

vi.mock('@aparajita/capacitor-secure-storage', () => ({
  KeychainAccess: { whenUnlockedThisDeviceOnly: 1 },
  SecureStorage: secureStorageMocks
}));

async function loadStorage() {
  vi.resetModules();
  return import('./nativeSecureStorage');
}

describe('nativeSecureStorage', () => {
  beforeEach(() => {
    capacitorState.available = true;
    vi.clearAllMocks();
    secureStorageMocks.setSynchronize.mockResolvedValue(undefined);
    secureStorageMocks.setDefaultKeychainAccess.mockResolvedValue(undefined);
    secureStorageMocks.setKeyPrefix.mockResolvedValue(undefined);
    secureStorageMocks.getItem.mockResolvedValue(null);
    secureStorageMocks.setItem.mockResolvedValue(undefined);
    secureStorageMocks.removeItem.mockResolvedValue(undefined);
    secureStorageMocks.keys.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('configures device-only, non-synchronizing secure storage before use', async () => {
    const storage = await loadStorage();

    await storage.setNativeSecureItem('session', 'secret');

    expect(secureStorageMocks.setSynchronize).toHaveBeenCalledWith(false);
    expect(secureStorageMocks.setDefaultKeychainAccess).toHaveBeenCalledWith(1);
    expect(secureStorageMocks.setKeyPrefix).toHaveBeenCalledWith('allplays_');
    expect(secureStorageMocks.setItem).toHaveBeenCalledWith('session', 'secret');
  });

  it('rejects instead of falling back to web storage when the native plugin is unavailable', async () => {
    capacitorState.available = false;
    const storage = await loadStorage();

    await expect(storage.getNativeSecureItem('session')).rejects.toMatchObject({
      name: 'NativeSecureStorageUnavailableError'
    });
    expect(secureStorageMocks.getItem).not.toHaveBeenCalled();
  });

  it('orders a delayed logout removal before a replacement write on the same key', async () => {
    vi.useFakeTimers();
    const removal = createDeferred<void>();
    secureStorageMocks.removeItem.mockReturnValueOnce(removal.promise);
    const storage = await loadStorage();

    const removePromise = storage.removeNativeSecureItem('firebase-auth-user');
    const removeRejection = expect(removePromise).rejects.toThrow('removal timed out');
    await vi.advanceTimersByTimeAsync(1_500);
    await removeRejection;

    const replacementPromise = storage.setNativeSecureItem('firebase-auth-user', 'user-b');
    expect(secureStorageMocks.setItem).not.toHaveBeenCalled();
    removal.resolve();
    await vi.runAllTimersAsync();
    await expect(replacementPromise).resolves.toBeUndefined();

    expect(secureStorageMocks.removeItem.mock.invocationCallOrder[0])
      .toBeLessThan(secureStorageMocks.setItem.mock.invocationCallOrder[0]);
  });

  it('cancels a queued replacement that times out and permits a clean retry after recovery', async () => {
    vi.useFakeTimers();
    const removal = createDeferred<void>();
    secureStorageMocks.removeItem.mockReturnValueOnce(removal.promise);
    const storage = await loadStorage();

    const removePromise = storage.removeNativeSecureItem('firebase-auth-user');
    const removeRejection = expect(removePromise).rejects.toThrow('removal timed out');
    await vi.advanceTimersByTimeAsync(1_500);
    await removeRejection;

    const timedOutReplacement = storage.setNativeSecureItem('firebase-auth-user', 'user-b');
    const replacementRejection = expect(timedOutReplacement).rejects.toThrow('write timed out');
    await vi.advanceTimersByTimeAsync(1_500);
    await replacementRejection;
    expect(secureStorageMocks.setItem).not.toHaveBeenCalled();

    removal.resolve();
    await vi.runAllTimersAsync();
    expect(secureStorageMocks.setItem).not.toHaveBeenCalled();

    await expect(storage.setNativeSecureItem('firebase-auth-user', 'user-b')).resolves.toBeUndefined();
    expect(secureStorageMocks.setItem).toHaveBeenCalledTimes(1);
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
