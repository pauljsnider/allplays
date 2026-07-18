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

export async function getNativeSecureItem(key: string) {
  const storage = (await getConfiguredStorage()).api;
  return withSecureStorageTimeout(storage.getItem(key), 'Native secure-storage read timed out.');
}

export async function setNativeSecureItem(key: string, value: string) {
  const storage = (await getConfiguredStorage()).api;
  await withSecureStorageTimeout(storage.setItem(key, value), 'Native secure-storage write timed out.');
}

export async function removeNativeSecureItem(key: string) {
  const storage = (await getConfiguredStorage()).api;
  await withSecureStorageTimeout(storage.removeItem(key), 'Native secure-storage removal timed out.');
}

export async function listNativeSecureKeys() {
  const storage = (await getConfiguredStorage()).api;
  return withSecureStorageTimeout(storage.keys(), 'Native secure-storage key listing timed out.');
}
