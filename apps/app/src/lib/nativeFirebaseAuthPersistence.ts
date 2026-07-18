import type { Persistence } from './adapters/legacyFirebaseAuthSdk';
import { getNativeSecureItem, removeNativeSecureItem, setNativeSecureItem } from './nativeSecureStorage';
import { isNativeRuntime } from './nativeRuntime';

type PersistenceValue = Record<string, unknown> | string;
type StorageEventListener = (value: PersistenceValue | null) => void;
const signedOutMarkerStorageKeyPrefix = 'allplays-native-firebase-auth-signed-out:';

/**
 * Firebase Auth's public Persistence type intentionally exposes only `type`,
 * while initializeAuth also consumes the underscored storage methods used by
 * its built-in persistence classes. Keeping this adapter isolated makes that
 * compatibility boundary explicit and easy to regression-test.
 */
export class NativeSecureFirebaseAuthPersistence implements Persistence {
  static type = 'LOCAL' as const;
  readonly type = 'LOCAL' as const;
  readonly _shouldAllowMigration = true;

  async _isAvailable() {
    // Native binaries that include this class also include the SecureStorage
    // plugin. Report the intended persistence as available so a missing or
    // broken OS secure store fails closed during _get/_set instead of silently
    // falling back to plaintext WebView persistence.
    return isNativeRuntime();
  }

  async _set(key: string, value: PersistenceValue) {
    await setNativeSecureItem(toSecureStorageKey(key), JSON.stringify(value));
    clearSignedOutMarker(key);
  }

  async _get<T extends PersistenceValue>(key: string): Promise<T | null> {
    if (hasSignedOutMarker(key)) {
      try {
        await removeNativeSecureItem(toSecureStorageKey(key));
        clearSignedOutMarker(key);
      } catch {
        // Keep the tombstone so stale credentials remain ignored until secure
        // storage is available and the old record can be deleted.
      }
      return null;
    }
    const rawValue = await getNativeSecureItem(toSecureStorageKey(key));
    if (!rawValue) return null;
    try {
      return JSON.parse(rawValue) as T;
    } catch {
      // Corrupted credentials must never be treated as an authenticated user.
      await removeNativeSecureItem(toSecureStorageKey(key));
      return null;
    }
  }

  async _remove(key: string) {
    setSignedOutMarker(key);
    await removeNativeSecureItem(toSecureStorageKey(key));
    clearSignedOutMarker(key);
  }

  _addListener(_key: string, _listener: StorageEventListener) {
    // A native WebView has a single Firebase Auth owner. There is no second tab
    // to synchronize, and Firebase updates the active instance directly.
  }

  _removeListener(_key: string, _listener: StorageEventListener) {
    // See _addListener.
  }
}

export function getFirebaseAuthPersistenceKey(apiKey: string, appName = '[DEFAULT]') {
  return `firebase:authUser:${apiKey}:${appName}`;
}

export async function persistNativeFirebaseAuthUser(
  apiKey: string,
  appName: string,
  authUser: Record<string, unknown>
) {
  const persistence = new NativeSecureFirebaseAuthPersistence();
  await persistence._set(getFirebaseAuthPersistenceKey(apiKey, appName), authUser);
}

export async function clearNativeFirebaseAuthUser(apiKey: string, appName: string) {
  const persistence = new NativeSecureFirebaseAuthPersistence();
  await persistence._remove(getFirebaseAuthPersistenceKey(apiKey, appName));
}

function toSecureStorageKey(firebasePersistenceKey: string) {
  return `firebase-auth-${encodeURIComponent(firebasePersistenceKey)}`;
}

function toSignedOutMarkerStorageKey(firebasePersistenceKey: string) {
  return `${signedOutMarkerStorageKeyPrefix}${encodeURIComponent(firebasePersistenceKey)}`;
}

function hasSignedOutMarker(firebasePersistenceKey: string) {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem(toSignedOutMarkerStorageKey(firebasePersistenceKey)) === '1';
  } catch {
    return true;
  }
}

function setSignedOutMarker(firebasePersistenceKey: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.setItem(toSignedOutMarkerStorageKey(firebasePersistenceKey), '1');
  } catch {
    // Secure deletion is still attempted when WebView storage is disabled.
  }
}

function clearSignedOutMarker(firebasePersistenceKey: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage?.removeItem(toSignedOutMarkerStorageKey(firebasePersistenceKey));
  } catch {
    // Cleanup is best-effort when WebView storage is disabled.
  }
}
