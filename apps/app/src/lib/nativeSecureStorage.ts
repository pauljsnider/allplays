import { Capacitor } from '@capacitor/core';
import { isNativeRuntime } from './nativeRuntime';

const secureStoragePrefix = 'allplays_';
const secureStorageTimeoutMs = 1500;

type SecureStorageApi = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  keys(): Promise<string[]>;
};

export class NativeSecureStorageUnavailableError extends Error {
  constructor(message = 'Native secure storage is unavailable.') {
    super(message);
    this.name = 'NativeSecureStorageUnavailableError';
  }
}

type SecureStorageBackend = { api: SecureStorageApi };

let secureStoragePromise: Promise<SecureStorageBackend> | null = null;
const secureStorageOperationTails = new Map<string, Promise<void>>();

async function loadSecureStorage(): Promise<SecureStorageBackend> {
  if (!isNativeRuntime()) {
    throw new NativeSecureStorageUnavailableError('Secure native storage is not used in the web app.');
  }

  const pluginAvailability = Capacitor.isPluginAvailable('SecureStorage');
  if (pluginAvailability === false) {
    throw new NativeSecureStorageUnavailableError('The native secure-storage plugin is not installed.');
  }

  try {
    const { KeychainAccess, SecureStorage } = await import('@aparajita/capacitor-secure-storage');
    await SecureStorage.setSynchronize(false);
    await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
    await SecureStorage.setKeyPrefix(secureStoragePrefix);
    // Capacitor plugin proxies expose arbitrary properties as methods. Wrapping
    // the proxy prevents Promise resolution from treating `then` as a plugin
    // method and attempting to call an unimplemented SecureStorage.then().
    return { api: SecureStorage };
  } catch (error) {
    secureStoragePromise = null;
    throw new NativeSecureStorageUnavailableError(
      error instanceof Error ? `Unable to initialize native secure storage: ${error.message}` : undefined
    );
  }
}

function getSecureStorage() {
  secureStoragePromise ||= loadSecureStorage();
  return secureStoragePromise;
}

async function withSecureStorageTimeout<T>(operation: Promise<T>, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new NativeSecureStorageUnavailableError(message)), secureStorageTimeoutMs);
      })
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function getConfiguredStorage() {
  try {
    return await withSecureStorageTimeout(getSecureStorage(), 'Native secure-storage initialization timed out.');
  } catch (error) {
    secureStoragePromise = null;
    throw error;
  }
}

/**
 * Keep operations on the same native key ordered even after a caller-facing
 * timeout. Native plugin promises cannot be cancelled; without this queue, a
 * delayed logout removal could complete after the next account writes the same
 * key. Operations that time out before starting are cancelled so they cannot
 * unexpectedly mutate storage later.
 */
function runKeyedSecureStorageOperation<T>(
  key: string,
  operation: (storage: SecureStorageApi) => Promise<T>,
  timeoutMessage: string
) {
  const previousTail = secureStorageOperationTails.get(key) || Promise.resolve();
  let started = false;
  let cancelled = false;
  const scheduled = previousTail.then(async () => {
    if (cancelled) {
      throw new NativeSecureStorageUnavailableError('Native secure-storage operation was cancelled after timing out.');
    }
    started = true;
    const storage = (await getConfiguredStorage()).api;
    return operation(storage);
  });
  const nextTail = scheduled.then(
    () => undefined,
    () => undefined
  );
  secureStorageOperationTails.set(key, nextTail);
  void nextTail.finally(() => {
    if (secureStorageOperationTails.get(key) === nextTail) {
      secureStorageOperationTails.delete(key);
    }
  });

  return withSecureStorageTimeout(scheduled, timeoutMessage).catch((error) => {
    if (!started) cancelled = true;
    throw error;
  });
}

export async function getNativeSecureItem(key: string) {
  return runKeyedSecureStorageOperation(key, (storage) => storage.getItem(key), 'Native secure-storage read timed out.');
}

export async function setNativeSecureItem(key: string, value: string) {
  await runKeyedSecureStorageOperation(
    key,
    (storage) => storage.setItem(key, value),
    'Native secure-storage write timed out.'
  );
}

export async function removeNativeSecureItem(key: string) {
  await runKeyedSecureStorageOperation(
    key,
    (storage) => storage.removeItem(key),
    'Native secure-storage removal timed out.'
  );
}

export async function listNativeSecureKeys() {
  const storage = (await getConfiguredStorage()).api;
  return withSecureStorageTimeout(storage.keys(), 'Native secure-storage key listing timed out.');
}
