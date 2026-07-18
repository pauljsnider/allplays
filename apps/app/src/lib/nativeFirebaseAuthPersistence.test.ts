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
    window.localStorage.clear();
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

  it('tombstones a failed removal so stale secure auth cannot restore on relaunch', async () => {
    const persistence = new NativeSecureFirebaseAuthPersistence();
    const key = 'firebase:authUser:api-key:[DEFAULT]';
    secureStorageMocks.removeNativeSecureItem.mockRejectedValue(new Error('secure storage unavailable'));

    await expect(persistence._remove(key)).rejects.toThrow('secure storage unavailable');
    expect(window.localStorage.getItem(
      'allplays-native-firebase-auth-signed-out:firebase%3AauthUser%3Aapi-key%3A%5BDEFAULT%5D'
    )).toBe('1');

    secureStorageMocks.getNativeSecureItem.mockResolvedValue(JSON.stringify({ uid: 'stale-user' }));
    await expect(persistence._get(key)).resolves.toBeNull();
    expect(secureStorageMocks.getNativeSecureItem).not.toHaveBeenCalled();
  });

  it('clears a failed-removal tombstone only after stale auth is deleted or replaced', async () => {
    const persistence = new NativeSecureFirebaseAuthPersistence();
    const key = 'firebase:key';
    const markerKey = 'allplays-native-firebase-auth-signed-out:firebase%3Akey';
    window.localStorage.setItem(markerKey, '1');

    await expect(persistence._get(key)).resolves.toBeNull();
    expect(secureStorageMocks.removeNativeSecureItem).toHaveBeenCalledWith('firebase-auth-firebase%3Akey');
    expect(window.localStorage.getItem(markerKey)).toBeNull();

    window.localStorage.setItem(markerKey, '1');
    await persistence._set(key, { uid: 'new-user' });
    expect(window.localStorage.getItem(markerKey)).toBeNull();
  });
});
