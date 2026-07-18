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
  persistNativeFirebaseAuthUser,
  shouldBlockNativeFirebaseAuthMigration
} from './nativeFirebaseAuthPersistence';

describe('NativeSecureFirebaseAuthPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installLocalStorage();
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
    expect(shouldBlockNativeFirebaseAuthMigration('api-key')).toBe(true);
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

  it('retains a signed-out tombstone after deletion and clears it only after replacement', async () => {
    const persistence = new NativeSecureFirebaseAuthPersistence();
    const key = 'firebase:key';
    const markerKey = 'allplays-native-firebase-auth-signed-out:firebase%3Akey';
    window.localStorage.setItem(markerKey, '1');

    await expect(persistence._get(key)).resolves.toBeNull();
    expect(secureStorageMocks.removeNativeSecureItem).toHaveBeenCalledWith('firebase-auth-firebase%3Akey');
    expect(window.localStorage.getItem(markerKey)).toBe('1');

    await persistence._set(key, { uid: 'new-user' });
    expect(window.localStorage.getItem(markerKey)).toBeNull();
  });

  it('blocks the full Firebase migration hierarchy until a fresh secure user replaces signed-out state', async () => {
    const key = getFirebaseAuthPersistenceKey('api-key');
    let secureValue: string | null = JSON.stringify({ uid: 'user-a' });
    let secureRemovalFails = true;
    secureStorageMocks.getNativeSecureItem.mockImplementation(async () => secureValue);
    secureStorageMocks.setNativeSecureItem.mockImplementation(async (_key: string, value: string) => {
      secureValue = value;
    });
    secureStorageMocks.removeNativeSecureItem.mockImplementation(async () => {
      if (secureRemovalFails) throw new Error('keychain locked');
      secureValue = null;
    });

    const securePersistence = new NativeSecureFirebaseAuthPersistence();
    const legacyPersistence = {
      _shouldAllowMigration: true,
      _isAvailable: vi.fn(async () => true),
      _get: vi.fn(async () => ({ uid: 'user-a' })),
      _set: vi.fn(async () => undefined),
      _remove: vi.fn(async () => {
        throw new Error('IndexedDB cleanup failed');
      })
    };

    await expect(securePersistence._remove(key)).rejects.toThrow('keychain locked');
    expect(shouldBlockNativeFirebaseAuthMigration('api-key')).toBe(true);

    secureRemovalFails = false;
    const guardedHierarchy = shouldBlockNativeFirebaseAuthMigration('api-key')
      ? [securePersistence]
      : [securePersistence, legacyPersistence];
    await expect(initializeLikeFirebasePersistenceManager(guardedHierarchy, key)).resolves.toBeNull();
    expect(legacyPersistence._get).not.toHaveBeenCalled();
    expect(shouldBlockNativeFirebaseAuthMigration('api-key')).toBe(true);

    await securePersistence._set(key, { uid: 'user-b' });
    expect(shouldBlockNativeFirebaseAuthMigration('api-key')).toBe(false);

    const replacementHierarchy = shouldBlockNativeFirebaseAuthMigration('api-key')
      ? [securePersistence]
      : [securePersistence, legacyPersistence];
    await expect(initializeLikeFirebasePersistenceManager(replacementHierarchy, key)).resolves.toEqual({ uid: 'user-b' });
    expect(legacyPersistence._get).not.toHaveBeenCalled();
    expect(legacyPersistence._remove).toHaveBeenCalledWith(key);
  });
});

type SimulatedPersistence = {
  _shouldAllowMigration?: boolean;
  _isAvailable: () => Promise<boolean>;
  _get: (key: string) => Promise<PersistenceValue | null>;
  _set: (key: string, value: PersistenceValue) => Promise<unknown>;
  _remove: (key: string) => Promise<unknown>;
};

type PersistenceValue = Record<string, unknown> | string;

/** Mirrors Firebase 12.16 PersistenceUserManager.create's ordered probing,
 * preferred-store migration, and ignored cleanup failures. */
async function initializeLikeFirebasePersistenceManager(
  hierarchy: SimulatedPersistence[],
  key: string
): Promise<PersistenceValue | null> {
  const available = (
    await Promise.all(hierarchy.map(async (persistence) => ((await persistence._isAvailable()) ? persistence : null)))
  ).filter((persistence): persistence is SimulatedPersistence => Boolean(persistence));
  let selected = available[0];
  let currentUser: PersistenceValue | null = null;
  let userToMigrate: PersistenceValue | null = null;

  for (const persistence of hierarchy) {
    try {
      const candidate = await persistence._get(key);
      if (!candidate) continue;
      currentUser = candidate;
      if (persistence !== selected) userToMigrate = candidate;
      selected = persistence;
      break;
    } catch {
      // Firebase ignores unreadable migration sources.
    }
  }

  const migrationHierarchy = available.filter((persistence) => persistence._shouldAllowMigration);
  if (!selected?._shouldAllowMigration || migrationHierarchy.length === 0) return currentUser;
  selected = migrationHierarchy[0];
  if (userToMigrate) await selected._set(key, userToMigrate);
  await Promise.all(
    hierarchy.map(async (persistence) => {
      if (persistence === selected) return;
      try {
        await persistence._remove(key);
      } catch {
        // Firebase intentionally ignores cleanup failures after selection.
      }
    })
  );
  return currentUser;
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
