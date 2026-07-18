// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
});
