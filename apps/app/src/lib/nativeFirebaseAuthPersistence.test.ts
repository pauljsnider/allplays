// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const secureStorageMocks = vi.hoisted(() => ({
  getNativeSecureItem: vi.fn(),
  setNativeSecureItem: vi.fn(),
  removeNativeSecureItem: vi.fn()
}));
const runtimeState = vi.hoisted(() => ({ native: true }));

vi.mock('./nativeSecureStorage', () => secureStorageMocks);
vi.mock('./nativeRuntime', () => ({ isNativeRuntime: () => runtimeState.native }));

import {
  clearNativeFirebaseAuthUser,
  getFirebaseAuthPersistenceKey,
  NativeSecureFirebaseAuthPersistence,
  persistNativeFirebaseAuthUser
} from './nativeFirebaseAuthPersistence';

describe('NativeSecureFirebaseAuthPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeState.native = true;
    secureStorageMocks.getNativeSecureItem.mockResolvedValue(null);
    secureStorageMocks.setNativeSecureItem.mockResolvedValue(undefined);
    secureStorageMocks.removeNativeSecureItem.mockResolvedValue(undefined);
  });

  it('stores Firebase auth state only through the native secure-storage bridge', async () => {
    const persistence = new NativeSecureFirebaseAuthPersistence();
    const value = { uid: 'user-1', stsTokenManager: { refreshToken: 'secret' } };

    await persistence._set('firebase:authUser:api-key:[DEFAULT]', value);

    expect(secureStorageMocks.setNativeSecureItem).toHaveBeenCalledWith(
      'firebase-auth-firebase%3AauthUser%3Aapi-key%3A%5BDEFAULT%5D',
      JSON.stringify(value)
    );
  });

  it('restores structured Firebase state and removes corrupted values fail-closed', async () => {
    const persistence = new NativeSecureFirebaseAuthPersistence();
    secureStorageMocks.getNativeSecureItem.mockResolvedValueOnce(JSON.stringify({ uid: 'user-1' }));
    await expect(persistence._get('firebase:key')).resolves.toEqual({ uid: 'user-1' });

    secureStorageMocks.getNativeSecureItem.mockResolvedValueOnce('{broken');
    await expect(persistence._get('firebase:key')).resolves.toBeNull();
    expect(secureStorageMocks.removeNativeSecureItem).toHaveBeenCalledWith('firebase-auth-firebase%3Akey');
  });

  it('reports native secure persistence as the migration target and web as unavailable', async () => {
    const persistence = new NativeSecureFirebaseAuthPersistence();
    expect(persistence.type).toBe('LOCAL');
    expect(persistence._shouldAllowMigration).toBe(true);
    await expect(persistence._isAvailable()).resolves.toBe(true);

    runtimeState.native = false;
    await expect(persistence._isAvailable()).resolves.toBe(false);
  });

  it('uses the exact Firebase auth key for direct REST sign-in persistence and cleanup', async () => {
    const key = getFirebaseAuthPersistenceKey('api-key', '[DEFAULT]');
    expect(key).toBe('firebase:authUser:api-key:[DEFAULT]');

    await persistNativeFirebaseAuthUser('api-key', '[DEFAULT]', { uid: 'user-1' });
    await clearNativeFirebaseAuthUser('api-key', '[DEFAULT]');

    expect(secureStorageMocks.setNativeSecureItem).toHaveBeenCalledWith(
      'firebase-auth-firebase%3AauthUser%3Aapi-key%3A%5BDEFAULT%5D',
      JSON.stringify({ uid: 'user-1' })
    );
    expect(secureStorageMocks.removeNativeSecureItem).toHaveBeenCalledWith(
      'firebase-auth-firebase%3AauthUser%3Aapi-key%3A%5BDEFAULT%5D'
    );
  });
});
