import type { Persistence } from './adapters/legacyFirebaseAuthSdk';
import {
  getNativeSecureItem,
  removeNativeSecureItem,
  removeNativeSecureItemEventually,
  setNativeSecureItem
} from './nativeSecureStorage';
import { isNativeRuntime } from './nativeRuntime';

type PersistenceValue = Record<string, unknown> | string;
type StorageEventListener = (value: PersistenceValue | null) => void | Promise<void>;
const signedOutMarkerStorageKeyPrefix = 'allplays-native-firebase-auth-signed-out:';
const storageEventListeners = new Map<string, Set<StorageEventListener>>();

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
      } catch {
        // Keep trying on later reads while secure storage is unavailable.
      }
      // The marker is intentionally retained even after deletion succeeds.
      // Firebase probes every configured persistence during initialization, so
      // clearing it here could let a stale IndexedDB migration source recreate
      // the user. Only a successful replacement _set clears signed-out state.
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
  }

  _addListener(key: string, listener: StorageEventListener) {
    const listeners = storageEventListeners.get(key) || new Set<StorageEventListener>();
    listeners.add(listener);
    storageEventListeners.set(key, listeners);
  }

  _removeListener(key: string, listener: StorageEventListener) {
    const listeners = storageEventListeners.get(key);
    listeners?.delete(listener);
    if (listeners?.size === 0) storageEventListeners.delete(key);
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
  const key = getFirebaseAuthPersistenceKey(apiKey, appName);
  await persistence._set(key, authUser);
  // REST-backed native sign-in writes outside Firebase Auth. Notify the SDK's
  // registered persistence listener and await its _onStorageEvent hydration so
  // Firestore/callable requests can use auth.currentUser immediately.
  await notifyStorageEventListeners(key, authUser);
}

export async function clearNativeFirebaseAuthUser(apiKey: string, appName: string) {
  const persistence = new NativeSecureFirebaseAuthPersistence();
  await persistence._remove(getFirebaseAuthPersistenceKey(apiKey, appName));
}

/**
 * Tombstone immediately, then queue an uncancelled secure removal behind any
 * write whose caller has already timed out. The auth mutation queue owns the
 * returned promise as a barrier so a late write cannot restore a failed login.
 */
export function queueNativeFirebaseAuthUserRemoval(apiKey: string, appName: string) {
  const key = getFirebaseAuthPersistenceKey(apiKey, appName);
  setSignedOutMarker(key);
  return removeNativeSecureItemEventually(toSecureStorageKey(key));
}

/**
 * Firebase Auth's PersistenceUserManager probes every persistence in its
 * hierarchy and migrates the first user it finds into the preferred store.
 * While signed out, omit legacy IndexedDB from that hierarchy so an old copy
 * cannot bypass the secure-store tombstone and recreate the prior account.
 */
export function shouldBlockNativeFirebaseAuthMigration(apiKey: string, appName = '[DEFAULT]') {
  return hasSignedOutMarker(getFirebaseAuthPersistenceKey(apiKey, appName));
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

async function notifyStorageEventListeners(key: string, value: PersistenceValue | null) {
  const listeners = Array.from(storageEventListeners.get(key) || []);
  await Promise.all(listeners.map((listener) => listener(value)));
}
